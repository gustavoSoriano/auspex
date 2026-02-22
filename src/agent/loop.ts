import type { Page } from "playwright-core";
import type { AgentResult, ActionRecord, LLMUsage, MemoryUsage, AgentTier, PageSnapshot } from "../types.js";
import type { ValidatedConfig } from "../config/schema.js";
import type { UrlValidationOptions } from "../security/url-validator.js";
import { takeSnapshot, formatSnapshot } from "../browser/snapshot.js";
import { executeAction } from "../browser/executor.js";
import { LLMClient } from "../llm/client.js";
import { parseAndValidateAction, formatActionForHistory } from "./actions.js";
import { generateReport } from "./report.js";

// Janela deslizante do histórico enviado ao LLM.
// Mantém o primeiro item (contexto inicial) + os N mais recentes.
// Evita que o histórico cresça indefinidamente e consuma tokens desnecessários.
const HISTORY_WINDOW = 8;

// Detecção de loop: janela deslizante das últimas N action keys.
// Se uma mesma ação aparecer MAX_OCCURRENCES vezes dentro de RECENT_WINDOW
// iterações, o agente está preso (captura padrões A,A,A e também A,B,A,B,A).
const RECENT_WINDOW   = 9; // quantas ações recentes rastrear
const MAX_OCCURRENCES = 3; // máximo de vezes que a mesma ação pode aparecer na janela

function windowedHistory(history: string[]): string[] {
  if (history.length <= HISTORY_WINDOW) return history;
  // Primeiro item = contexto de início de navegação → sempre preservado
  return [history[0], ...history.slice(-(HISTORY_WINDOW - 1))];
}

function buildResult(
  status: AgentResult["status"],
  tier: AgentTier,
  data: string | null,
  actions: ActionRecord[],
  usage: LLMUsage,
  peakRssKb: number,
  startTime: number,
  url: string,
  prompt: string,
  error?: string,
): AgentResult {
  const mem = process.memoryUsage();
  const memory: MemoryUsage = {
    browserPeakRssKb: peakRssKb,
    nodeHeapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
  };
  const durationMs = Date.now() - startTime;
  const result: AgentResult = { status, tier, data, report: "", durationMs, actions, usage, memory, error };
  result.report = generateReport(result, url, prompt);
  return result;
}

// ─── Loop estático (sem browser) ──────────────────────────────────────────────
//
// Tenta resolver o prompt em UMA chamada LLM usando snapshot do HTML via Cheerio.
// Retorna AgentResult com tier="http" se o LLM conseguir responder com "done".
// Retorna null se o LLM precisar de interação → sinal para lançar o Playwright.
//
// ─────────────────────────────────────────────────────────────────────────────

export async function runStaticLoop(
  snapshot: PageSnapshot,
  url: string,
  prompt: string,
  config: ValidatedConfig,
): Promise<AgentResult | null> {
  const startTime = Date.now();
  const urlOptions: UrlValidationOptions = {
    allowedDomains: config.allowedDomains,
    blockedDomains: config.blockedDomains,
  };

  const llm = new LLMClient(
    config.llmApiKey,
    config.model,
    {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
    },
    config.llmBaseUrl,
  );

  const usage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };

  let raw: unknown;
  try {
    const response = await llm.decideAction(prompt, formatSnapshot(snapshot), []);
    raw = response.data;
    usage.promptTokens     = response.usage.promptTokens;
    usage.completionTokens = response.usage.completionTokens;
    usage.totalTokens      = response.usage.totalTokens;
    usage.calls            = 1;
  } catch {
    return null; // Falha na chamada LLM → cai para o Playwright
  }

  let action;
  try {
    action = await parseAndValidateAction(raw, urlOptions);
  } catch {
    return null; // Ação inválida → cai para o Playwright
  }

  if (action.type === "done") {
    // LLM conseguiu extrair os dados do HTML estático ✅ sem precisar de browser
    const actions: ActionRecord[] = [{ action, iteration: 0, timestamp: Date.now() }];
    return buildResult("done", "http", action.result, actions, usage, 0, startTime, url, prompt);
  }

  // LLM precisa navegar ou interagir (click, goto, etc.) → Playwright necessário
  return null;
}

// ─── Loop interativo (Playwright) ────────────────────────────────────────────
//
// getMemoryKb: callback que retorna o RSS do processo do browser em KB.
// Passado pelo agent.ts usando o PID do processo Chromium lançado.
//
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgentLoop(
  page: Page,
  url: string,
  prompt: string,
  config: ValidatedConfig,
  getMemoryKb: () => number = () => 0,
): Promise<AgentResult> {
  const llm = new LLMClient(
    config.llmApiKey,
    config.model,
    {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
    },
    config.llmBaseUrl,
  );
  const urlOptions: UrlValidationOptions = {
    allowedDomains: config.allowedDomains,
    blockedDomains: config.blockedDomains,
  };

  // Auto-dismiss any dialogs (alert, confirm, prompt) to prevent browser from hanging
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  const actions: ActionRecord[] = [];
  const history: string[] = [];
  const usage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
  let peakRssKb = 0;
  const recentActionKeys: string[] = []; // janela deslizante para detecção de loop
  const startTime = Date.now();

  for (let i = 0; i < config.maxIterations; i++) {
    const currentRss = getMemoryKb();
    if (currentRss > peakRssKb) peakRssKb = currentRss;

    if (Date.now() - startTime > config.timeoutMs) {
      return buildResult("timeout", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt, `Timeout after ${config.timeoutMs}ms`);
    }

    const snapshot = await takeSnapshot(page);
    const formatted = formatSnapshot(snapshot);

    let raw: unknown;
    try {
      const response = await llm.decideAction(prompt, formatted, windowedHistory(history));
      raw = response.data;
      usage.promptTokens     += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens      += response.usage.totalTokens;
      usage.calls++;
    } catch (err) {
      return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
        `LLM error: ${err instanceof Error ? err.message : String(err)}`);
    }

    let action;
    try {
      action = await parseAndValidateAction(raw, urlOptions);
    } catch (err) {
      return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
        `Action validation error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Detecção de loop (padrão A,A,A e também alternados A,B,A,B,A) ─────
    // Conta quantas vezes esta ação aparece nas últimas RECENT_WINDOW iterações.
    // Se atingir MAX_OCCURRENCES, o agente está preso e precisa tentar outra abordagem.
    const actionKey = JSON.stringify(action);
    const occurrencesInWindow = recentActionKeys.filter(k => k === actionKey).length;
    if (occurrencesInWindow >= MAX_OCCURRENCES) {
      history.push(
        `[${i}] STUCK: action repeated ${MAX_OCCURRENCES} times in the last ${RECENT_WINDOW} steps. ` +
        "You MUST try a completely different approach.",
      );
      recentActionKeys.length = 0; // reseta a janela para permitir nova tentativa
      continue;
    }
    recentActionKeys.push(actionKey);
    if (recentActionKeys.length > RECENT_WINDOW) recentActionKeys.shift();

    actions.push({ action, iteration: i, timestamp: Date.now() });
    history.push(formatActionForHistory(action, i));

    if (action.type === "done") {
      return buildResult("done", "playwright", action.result, actions, usage, peakRssKb, startTime, url, prompt);
    }

    try {
      await executeAction(page, action, urlOptions);
      history.push(formatActionForHistory(action, i) + " -> OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      history.push(
        `[${i}] ERROR executing ${action.type}: ${msg}. Try a different approach.`,
      );
    }

    await page.waitForTimeout(1_000);
  }

  return buildResult("max_iterations", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
    `Reached max iterations (${config.maxIterations})`);
}
