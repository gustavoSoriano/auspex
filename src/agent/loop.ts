import type { Page } from "playwright-core";
import type { AgentResult, ActionRecord, LLMUsage, MemoryUsage, AgentTier, PageSnapshot, AgentAction } from "../types.js";
import type { ValidatedConfig } from "../config/schema.js";
import type { UrlValidationOptions } from "../security/url-validator.js";
import { takeSnapshot, formatSnapshot, captureScreenshot } from "../browser/snapshot.js";
import { executeAction } from "../browser/executor.js";
import { LLMClient } from "../llm/client.js";
import { parseAndValidateAction, formatActionForHistory } from "./actions.js";
import { generateReport } from "./report.js";
import { warnIfNotVisionModel, isVisionModel } from "../llm/vision-models.js";

// Sliding window of history sent to LLM.
// Keeps the first item (initial context) + the N most recent.
const HISTORY_WINDOW = 8;

// Loop detection: sliding window of recent action keys.
const RECENT_WINDOW   = 9;
const MAX_OCCURRENCES = 3;

// Actions that already include their own delay — skip the inter-iteration pause
const SELF_DELAYED_ACTIONS = new Set<AgentAction["type"]>(["wait", "goto"]);

// ─── Blocked page detection ─────────────────────────────────────────────────
const BLOCKED_URL_PATTERNS = [
  "/sorry/",        // Google CAPTCHA
  "/captcha",
  "/challenge",
  "/recaptcha",
  "/blocked",
];
const BLOCKED_TEXT_PATTERNS = [
  "unusual traffic",
  "not a robot",
  "captcha",
  "blocked your ip",
  "access denied",
  "rate limit",
];

// Real CAPTCHA/block pages are very sparse — just the challenge + a short message.
// Only flag as blocked when the page has little content AND matches a pattern,
// to avoid false positives on normal pages that mention "captcha" or "access denied".
const BLOCKED_TEXT_MAX_LENGTH = 2_000;

function isBlockedPage(snapshot: PageSnapshot): boolean {
  const url = snapshot.url.toLowerCase();
  if (BLOCKED_URL_PATTERNS.some(p => url.includes(p))) return true;

  const text = snapshot.text.toLowerCase();
  if (text.length < BLOCKED_TEXT_MAX_LENGTH && BLOCKED_TEXT_PATTERNS.some(p => text.includes(p))) return true;

  return false;
}

function windowedHistory(history: string[]): string[] {
  if (history.length <= HISTORY_WINDOW) return history;
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

// ─── Static loop (no browser) ────────────────────────────────────────────────

export interface StaticLoopResult {
  result: AgentResult | null;
  usage: LLMUsage;
}

export async function runStaticLoop(
  snapshot: PageSnapshot,
  url: string,
  prompt: string,
  config: ValidatedConfig,
  signal?: AbortSignal,
  schemaDescription?: string,
): Promise<StaticLoopResult> {
  const emptyUsage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };

  if (signal?.aborted) return { result: null, usage: emptyUsage };

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
    const response = await llm.decideAction(prompt, formatSnapshot(snapshot), [], schemaDescription);
    raw = response.data;
    usage.promptTokens     = response.usage.promptTokens;
    usage.completionTokens = response.usage.completionTokens;
    usage.totalTokens      = response.usage.totalTokens;
    usage.calls            = 1;
  } catch {
    return { result: null, usage }; // LLM call failed — fall back to Playwright
  }

  let action;
  try {
    action = await parseAndValidateAction(raw, urlOptions);
  } catch {
    return { result: null, usage }; // Invalid action — fall back to Playwright
  }

  if (action.type === "done") {
    const actions: ActionRecord[] = [{ action, iteration: 0, timestamp: Date.now() }];
    const isFailed = typeof action.result === "string" && action.result.startsWith("FAILED:");
    if (isFailed) {
      const reason = action.result.slice(7).trim() || "The agent could not complete the task.";
      return { result: buildResult("error", "http", null, actions, usage, 0, startTime, url, prompt, reason), usage };
    }
    return { result: buildResult("done", "http", action.result, actions, usage, 0, startTime, url, prompt), usage };
  }

  // LLM needs to navigate or interact → Playwright required
  return { result: null, usage };
}

// ─── Interactive loop (Playwright) ───────────────────────────────────────────

export interface LoopOptions {
  actionDelayMs?: number;
  maxTotalTokens?: number;
  signal?: AbortSignal;
  /** JSON Schema description string injected into the LLM prompt for structured extraction */
  schemaDescription?: string;
  onAction?: (action: AgentAction, iteration: number) => void;
  onActionResult?: (iteration: number, ok: boolean, error?: string) => void;
  onInvalidAction?: (iteration: number, error: string) => void;
  onIteration?: (iteration: number, snapshot: PageSnapshot) => void;
}

export async function runAgentLoop(
  page: Page,
  url: string,
  prompt: string,
  config: ValidatedConfig,
  getMemoryKb: () => number = () => 0,
  loopOptions: LoopOptions = {},
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

  const actionDelayMs = loopOptions.actionDelayMs ?? config.actionDelayMs;
  const maxTotalTokens = loopOptions.maxTotalTokens ?? config.maxTotalTokens;
  const signal = loopOptions.signal;
  const maxIterations = config.maxIterations;

  // Auto-dismiss dialogs to prevent browser from hanging
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  const actions: ActionRecord[] = [];
  const history: string[] = [];
  const usage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
  let peakRssKb = 0;
  const recentActionKeys: string[] = [];
  const startTime = Date.now();

  // ── Vision auto-fallback ─────────────────────────────────────────────
  // When vision=true, screenshots are NOT sent from the start.
  // They activate automatically after consecutive failures (invalid actions,
  // execution errors, stuck loops) so the LLM can "see" the page.
  const VISION_ESCALATION_THRESHOLD = 3;
  const visionAvailable = config.vision && isVisionModel(config.model);
  let useVision = false;
  let consecutiveFailures = 0;

  if (config.vision) {
    warnIfNotVisionModel(config.model);
  }

  for (let i = 0; i < maxIterations; i++) {
    // ── Abort check ──────────────────────────────────────────────────────
    if (signal?.aborted) {
      return buildResult("aborted", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt, "Aborted by user");
    }

    const currentRss = getMemoryKb();
    if (currentRss > peakRssKb) peakRssKb = currentRss;

    if (Date.now() - startTime > config.timeoutMs) {
      return buildResult("timeout", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt, `Timeout after ${config.timeoutMs}ms`);
    }

    // ── Budget check ─────────────────────────────────────────────────────
    if (maxTotalTokens > 0 && usage.totalTokens >= maxTotalTokens) {
      return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
        `Token budget exceeded: ${usage.totalTokens} >= ${maxTotalTokens}`);
    }

    const snapshot = await takeSnapshot(page);
    loopOptions.onIteration?.(i, snapshot);

    // ── Blocked page detection (CAPTCHA, consent, rate-limit) ────────
    if (isBlockedPage(snapshot)) {
      return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
        `Blocked by target site (CAPTCHA/rate-limit detected at ${snapshot.url.slice(0, 100)})`);
    }

    const formatted = formatSnapshot(snapshot);

    // ── Vision: capture viewport screenshot (only after escalation) ────
    let screenshot: string | undefined;
    if (useVision) {
      try {
        screenshot = await captureScreenshot(page, config.screenshotQuality);
      } catch { /* screenshot failed — continue without it */ }
    }

    let raw: unknown;
    try {
      const response = await llm.decideAction(prompt, formatted, windowedHistory(history), loopOptions.schemaDescription, screenshot, visionAvailable);
      raw = response.data;
      usage.promptTokens     += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens      += response.usage.totalTokens;
      usage.calls++;
    } catch (err) {
      return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
        `LLM error: ${err instanceof Error ? err.message : String(err)}`);
    }

    let action: AgentAction;
    try {
      action = await parseAndValidateAction(raw, urlOptions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loopOptions.onInvalidAction?.(i, msg);
      consecutiveFailures++;
      history.push(
        `[${i}] INVALID ACTION: ${msg}. Use shorter, simpler CSS selectors (#id, [name="..."], tag). Max 500 chars. No JavaScript or data: URIs.`,
      );
      if (!useVision && visionAvailable && consecutiveFailures >= VISION_ESCALATION_THRESHOLD) {
        useVision = true;
        history.push(`[${i}] VISION ACTIVATED: A screenshot of the page is now included to help you understand the layout.`);
      }
      continue;
    }

    // ── Loop detection (normalized: ignore quote style & whitespace in selectors)
    const actionKey = JSON.stringify(action).replace(/['"]/g, "'").replace(/\s+/g, " ");
    const occurrencesInWindow = recentActionKeys.filter(k => k === actionKey).length;
    if (occurrencesInWindow >= MAX_OCCURRENCES) {
      consecutiveFailures++;
      history.push(
        `[${i}] STUCK: action repeated ${MAX_OCCURRENCES} times in the last ${RECENT_WINDOW} steps. ` +
        "You MUST try a completely different approach.",
      );
      if (!useVision && visionAvailable && consecutiveFailures >= VISION_ESCALATION_THRESHOLD) {
        useVision = true;
        history.push(`[${i}] VISION ACTIVATED: A screenshot of the page is now included to help you understand the layout.`);
      }
      recentActionKeys.length = 0;
      continue;
    }
    recentActionKeys.push(actionKey);
    if (recentActionKeys.length > RECENT_WINDOW) recentActionKeys.shift();

    actions.push({ action, iteration: i, timestamp: Date.now() });
    loopOptions.onAction?.(action, i);

    if (action.type === "done") {
      const isFailed = typeof action.result === "string" && action.result.startsWith("FAILED:");
      if (isFailed) {
        const reason = action.result.slice(7).trim() || "The agent could not complete the task.";
        return buildResult("error", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt, reason);
      }
      return buildResult("done", "playwright", action.result, actions, usage, peakRssKb, startTime, url, prompt);
    }

    try {
      await executeAction(page, action, urlOptions);
      history.push(formatActionForHistory(action, i) + " -> OK");
      loopOptions.onActionResult?.(i, true);
      consecutiveFailures = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loopOptions.onActionResult?.(i, false, msg);
      consecutiveFailures++;
      history.push(
        `[${i}] ERROR executing ${action.type}: ${msg}. Try a different approach.`,
      );
      if (!useVision && visionAvailable && consecutiveFailures >= VISION_ESCALATION_THRESHOLD) {
        useVision = true;
        history.push(`[${i}] VISION ACTIVATED: A screenshot of the page is now included to help you understand the layout.`);
      }
    }

    // Action-specific delay: skip for actions that already have their own wait
    if (!SELF_DELAYED_ACTIONS.has(action.type) && actionDelayMs > 0) {
      await page.waitForTimeout(actionDelayMs);
    }
  }

  return buildResult("max_iterations", "playwright", null, actions, usage, peakRssKb, startTime, url, prompt,
    `Reached max iterations (${maxIterations})`);
}
