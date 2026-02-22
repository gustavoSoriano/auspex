import { execSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { gotScraping } from "got-scraping";
import type { AgentConfig, AgentResult, RunOptions } from "../types.js";
import { agentConfigSchema, runOptionsSchema, type ValidatedConfig } from "../config/schema.js";
import { validateUrl } from "../security/url-validator.js";
import { snapshotFromHtml } from "../browser/snapshot.js";
import { runStaticLoop, runAgentLoop } from "./loop.js";
import { generateReport } from "./report.js";

export class Auspex {
  private config: ValidatedConfig;
  private browser: Browser | null = null;

  constructor(config: AgentConfig) {
    this.config = agentConfigSchema.parse(config);
  }

  // ── Snapshot de PIDs do Chromium antes do launch ─────────────────────────

  private getChromiumPids(): Set<string> {
    try {
      const out = execSync("ps aux | grep -i chromium | grep -v grep | awk '{print $2}'", {
        encoding: "utf-8",
        timeout: 2_000,
      });
      return new Set(out.trim().split("\n").filter(Boolean));
    } catch {
      return new Set();
    }
  }

  // ── Soma RSS de todos os processos Chromium novos (KB) ────────────────────

  private makeChromiumMemoryTracker(pidsBeforeLaunch: Set<string>): () => number {
    return () => {
      try {
        const out = execSync("ps aux | grep -i chromium | grep -v grep | awk '{print $2}'", {
          encoding: "utf-8",
          timeout: 2_000,
        });
        const newPids = out.trim().split("\n").filter(p => p && !pidsBeforeLaunch.has(p));
        if (newPids.length === 0) return 0;

        // Soma o RSS de todos os processos Chromium lançados por este agente
        const pidsArg = newPids.join(",");
        const rssOut = execSync(`ps -o rss= -p ${pidsArg}`, {
          encoding: "utf-8",
          timeout: 2_000,
        });
        return rssOut
          .trim()
          .split("\n")
          .reduce((sum, line) => sum + (parseInt(line.trim(), 10) || 0), 0);
      } catch {
        return 0;
      }
    };
  }

  // ── Garante que o browser Playwright está rodando ─────────────────────────

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  // ── Execução principal ────────────────────────────────────────────────────

  async run(options: RunOptions): Promise<AgentResult> {
    const { url, prompt } = runOptionsSchema.parse(options);

    const validUrl = await validateUrl(url, {
      allowedDomains: this.config.allowedDomains,
      blockedDomains: this.config.blockedDomains,
    });

    // ── 1. Tenta HTTP/Cheerio primeiro (sem browser) ──────────────────────
    //
    // Se o HTML da página já tiver conteúdo suficiente E o LLM conseguir
    // responder com "done" na primeira tentativa → economizamos o Playwright
    // (zero processos externos, ~100-500ms vs ~5-30s).
    //
    try {
      const response = await gotScraping({
        url: validUrl,
        method: "GET",
        headerGeneratorOptions: {
          browsers: [{ name: "chrome", minVersion: 120 }],
          operatingSystems: ["macos", "windows"],
          devices: ["desktop"],
          locales: ["pt-BR", "pt", "en-US"],
        },
        timeout: { request: Math.min(this.config.timeoutMs, 10_000) },
        followRedirect: true,
        maxRedirects: 10,
        throwHttpErrors: false,
        decompress: true,
      });

      const { body: html, statusCode: status } = response as unknown as { body: string; statusCode: number };

      if (html && status < 400) {
        const snapshot = snapshotFromHtml(html, validUrl);

        // Só tenta o loop estático se houver conteúdo mínimo (evita SPA vazia)
        if (snapshot.text.length > 200) {
          const staticResult = await runStaticLoop(snapshot, validUrl, prompt, this.config);
          if (staticResult) return staticResult; // ✅ resolvido sem browser
        }
      }
    } catch {
      // HTTP falhou (timeout, SSL, rede) → vai direto para o Playwright
    }

    // ── 2. Playwright (fallback — página precisa de JS ou de interação) ───
    const pidsBefore = this.getChromiumPids();
    const browser = await this.ensureBrowser();
    const getMemoryKb = this.makeChromiumMemoryTracker(pidsBefore);

    let page: Page | null = null;

    try {
      const context = await browser.newContext();
      page = await context.newPage();
      await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });

      return await runAgentLoop(page, validUrl, prompt, this.config, getMemoryKb);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: import("../types.js").AgentResult = {
        status: "error",
        tier: "playwright",
        data: null,
        report: "",
        durationMs: 0,
        actions: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
        memory: { browserPeakRssKb: 0, nodeHeapUsedMb: 0 },
        error: errorMsg,
      };
      result.report = generateReport(result, validUrl, prompt);
      return result;
    } finally {
      if (page) {
        const context = page.context();
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
