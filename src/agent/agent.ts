import { EventEmitter } from "node:events";
import { type Browser, type Page } from "playwright";
import { gotScraping } from "got-scraping";
import { launchStealthBrowser, STEALTH_INIT_SCRIPT, CHROME_UA } from "../browser/stealth.js";
import { type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentConfig, AgentResult, RunOptions, AuspexEvents, AgentAction, PageSnapshot, CookieParam } from "../types.js";
import { agentConfigSchema, runOptionsSchema, type ValidatedConfig } from "../config/schema.js";
import { validateUrl } from "../security/url-validator.js";
import { snapshotFromHtml } from "../browser/snapshot.js";
import { runStaticLoop, runAgentLoop } from "./loop.js";
import { generateReport } from "./report.js";
import { RunLogger } from "./logger.js";
import type { BrowserPool } from "../browser/pool.js";

export class Auspex extends EventEmitter {
  private config: ValidatedConfig;
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private pool: BrowserPool | null;

  constructor(config: AgentConfig, pool?: BrowserPool) {
    super();
    this.config = agentConfigSchema.parse(config);
    this.pool = pool ?? null;
  }

  // ── Type-safe event emitter methods ────────────────────────────────────────

  override emit<K extends keyof AuspexEvents>(event: K, ...args: AuspexEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AuspexEvents>(event: K, listener: (...args: AuspexEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof AuspexEvents>(event: K, listener: (...args: AuspexEvents[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  // ── Browser lifecycle ────────────────────────────────────────────────────────

  private async acquireBrowser(): Promise<Browser> {
    // Pool mode: acquire from shared pool each run
    if (this.pool) return this.pool.acquire();

    // Singleton mode: reuse the same browser across runs
    if (this.browser?.isConnected()) return this.browser;

    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        const launchOptions = this.config.proxy
          ? {
              proxy: {
                server: this.config.proxy.server,
                username: this.config.proxy.username,
                password: this.config.proxy.password,
              },
            }
          : {};

        const browser = await launchStealthBrowser(launchOptions);
        this.browser = browser;
        this.browserPromise = null;
        return browser;
      })();
    }

    return this.browserPromise;
  }

  private releaseBrowser(browser: Browser): void {
    if (this.pool) this.pool.release(browser);
    // Singleton mode: keep browser alive — no release needed
  }

  // ── Main execution ─────────────────────────────────────────────────────────

  async run<T>(options: RunOptions & { schema: ZodType<T> }): Promise<AgentResult & { data: T | null }>;
  async run(options: RunOptions): Promise<AgentResult>;
  async run(options: RunOptions): Promise<AgentResult> {
    const validated = runOptionsSchema.parse(options);
    const { url, prompt } = validated;
    const signal = options.signal;
    const schema = options.schema as ZodType | undefined;

    // Per-run overrides
    const effectiveConfig = { ...this.config };
    if (validated.maxIterations) effectiveConfig.maxIterations = validated.maxIterations;
    if (validated.timeoutMs) effectiveConfig.timeoutMs = validated.timeoutMs;
    if (validated.actionDelayMs !== undefined) effectiveConfig.actionDelayMs = validated.actionDelayMs;
    if (validated.vision !== undefined) effectiveConfig.vision = validated.vision;

    // ── Logger setup ─────────────────────────────────────────────────────
    const logger = effectiveConfig.log ? new RunLogger(effectiveConfig.logDir) : null;
    logger?.logStart(url, prompt);

    if (signal?.aborted) {
      return this.makeAbortedResult(url, prompt);
    }

    const validUrl = await validateUrl(url, {
      allowedDomains: effectiveConfig.allowedDomains,
      blockedDomains: effectiveConfig.blockedDomains,
    });

    // ── Schema description for structured extraction ────────────────────
    let schemaDescription: string | undefined;
    if (schema) {
      const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });
      schemaDescription = JSON.stringify(jsonSchema, null, 2);
    }

    // Track tokens used during static loop attempt (added to Playwright result if fallback)
    let staticLoopUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };

    // ── 1. Try HTTP/Cheerio first (no browser) ──────────────────────────────
    logger?.logTier("http (attempt)");
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
        timeout: { request: Math.min(effectiveConfig.timeoutMs, 10_000) },
        followRedirect: true,
        maxRedirects: 10,
        throwHttpErrors: false,
        decompress: true,
      });

      const html = response.body as string;
      const status = response.statusCode;

      if (html && status < 400) {
        const snapshot = snapshotFromHtml(html, validUrl);

        if (snapshot.text.length > 200) {
          this.emit("tier", "http");
          const staticLoop = await runStaticLoop(snapshot, validUrl, prompt, effectiveConfig, signal, schemaDescription);
          staticLoopUsage = staticLoop.usage;
          if (staticLoop.result) {
            const finalResult = this.applySchema(staticLoop.result, schema, validUrl, prompt);
            this.emit("done", finalResult);
            return finalResult;
          }
        }
      }
    } catch {
      // HTTP failed (timeout, SSL, network) → go to Playwright
    }

    // ── 2. Playwright (fallback) ─────────────────────────────────────────────
    logger?.logTier("playwright");
    this.emit("tier", "playwright");
    const browser = await this.acquireBrowser();

    let page: Page | null = null;

    try {
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        userAgent: CHROME_UA,
        viewport: { width: 1920, height: 1080 },
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        extraHTTPHeaders: this.config.extraHeaders,
      };

      if (this.config.proxy) {
        contextOptions.proxy = {
          server: this.config.proxy.server,
          username: this.config.proxy.username,
          password: this.config.proxy.password,
        };
      }

      const context = await browser.newContext(contextOptions);

      // Inject cookies if provided
      if (this.config.cookies && this.config.cookies.length > 0) {
        await context.addCookies(
          this.config.cookies.map((c: CookieParam) => ({
            name: c.name,
            value: c.value,
            domain: c.domain ?? new URL(validUrl).hostname,
            path: c.path ?? "/",
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
            expires: c.expires,
          })),
        );
      }

      // Apply comprehensive stealth patches (second layer on top of playwright-extra stealth plugin)
      await context.addInitScript(STEALTH_INIT_SCRIPT);

      page = await context.newPage();
      const gotoTimeout = effectiveConfig.gotoTimeoutMs ?? 15_000;
      await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: gotoTimeout });

      const result = await runAgentLoop(page, validUrl, prompt, effectiveConfig, () => 0, {
        actionDelayMs: effectiveConfig.actionDelayMs,
        maxTotalTokens: effectiveConfig.maxTotalTokens,
        signal,
        schemaDescription,
        onAction: (action: AgentAction, iteration: number) => {
          logger?.logAction(action, iteration);
          this.emit("action", action, iteration);
        },
        onActionResult: (iteration: number, ok: boolean, error?: string) => {
          logger?.logActionResult(iteration, ok, error);
        },
        onInvalidAction: (iteration: number, error: string) => {
          logger?.logInvalidAction(iteration, error);
        },
        onIteration: (iteration: number, snapshot: PageSnapshot) => {
          logger?.logIteration(iteration, snapshot);
          this.emit("iteration", iteration, snapshot);
        },
      });

      // Add tokens consumed during the static loop attempt (if any)
      if (staticLoopUsage.calls > 0) {
        result.usage.promptTokens     += staticLoopUsage.promptTokens;
        result.usage.completionTokens += staticLoopUsage.completionTokens;
        result.usage.totalTokens      += staticLoopUsage.totalTokens;
        result.usage.calls            += staticLoopUsage.calls;
      }

      const finalResult = this.applySchema(result, schema, validUrl, prompt);
      logger?.logResult(finalResult);
      this.emit("done", finalResult);
      return finalResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: AgentResult = {
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
      if (this.listenerCount("error") > 0) {
        this.emit("error", err instanceof Error ? err : new Error(errorMsg));
      }
      return result;
    } finally {
      if (page) {
        const context = page.context();
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
      this.releaseBrowser(browser);
    }
  }

  private applySchema(result: AgentResult, schema: ZodType | undefined, url: string, prompt: string): AgentResult {
    if (!schema || result.status !== "done" || result.data === null) return result;
    try {
      const parsed = JSON.parse(result.data);
      const validated = schema.parse(parsed);
      // Cast: when schema is provided, data becomes the validated object (T | null via overload)
      (result as { data: unknown }).data = validated;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.status = "error";
      result.error = `Schema validation failed: ${msg}`;
      result.data = null;
      result.report = generateReport(result, url, prompt);
      return result;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      // Pool-managed: detach only — caller owns the pool lifecycle
      this.pool = null;
      return;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.browserPromise = null;
  }

  private makeAbortedResult(url: string, prompt: string): AgentResult {
    const result: AgentResult = {
      status: "aborted",
      tier: "http",
      data: null,
      report: "",
      durationMs: 0,
      actions: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
      memory: { browserPeakRssKb: 0, nodeHeapUsedMb: 0 },
      error: "Aborted by user",
    };
    result.report = generateReport(result, url, prompt);
    return result;
  }
}
