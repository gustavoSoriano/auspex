import type { Browser, LaunchOptions } from "playwright";
import type { Page } from "playwright-core";
import { launchStealthBrowser, STEALTH_INIT_SCRIPT, CHROME_UA } from "../browser/stealth.js";
import { DEFAULTS } from "../config/defaults.js";
import { executeAction } from "../browser/executor.js";
import { validateUrl } from "../security/url-validator.js";
import type { AgentAction, CookieParam, ProxyConfig } from "../types.js";
import type { AuspexMacro, MacroReplayOptions, MacroReplayResult } from "./schema.js";

/**
 * Matches `runAgentLoop`: no inter-step `actionDelayMs` after `wait`/`goto` (intrinsic timing)
 * or after `search` (same as `continue` before the delay block in the agent).
 */
const SKIP_INTER_STEP_DELAY_AFTER = new Set<AgentAction["type"]>(["wait", "goto", "search"]);

/** Same knobs as `Auspex` browser runs: stealth launch + context + `replayMacro`. */
export interface MacroReplayLaunchOptions extends MacroReplayOptions {
  proxy?: ProxyConfig;
  cookies?: CookieParam[];
  extraHTTPHeaders?: Record<string, string>;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  /** Merged into `launchStealthBrowser` (e.g. `{ headless: false }`) */
  browserLaunchOptions?: LaunchOptions;
}

/**
 * Launches stealth Chromium, creates a context (aligned with the agent defaults), runs
 * {@link replayMacro}, then closes browser resources. Use when you do not already hold a `Page`.
 */
export async function replayMacroWithBrowser(
  macro: AuspexMacro,
  options: MacroReplayLaunchOptions = {},
): Promise<MacroReplayResult> {
  const launchOpts: LaunchOptions = { ...options.browserLaunchOptions };
  if (options.proxy) {
    launchOpts.proxy = {
      server: options.proxy.server,
      username: options.proxy.username,
      password: options.proxy.password,
    };
  }

  const browser = await launchStealthBrowser(launchOpts);
  try {
    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      userAgent: options.userAgent ?? CHROME_UA,
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      locale: options.locale ?? "pt-BR",
      timezoneId: options.timezoneId ?? "America/Sao_Paulo",
      extraHTTPHeaders: options.extraHTTPHeaders,
    };
    const context = await browser.newContext(contextOptions);

    if (options.cookies && options.cookies.length > 0) {
      const host = new URL(macro.startUrl).hostname;
      await context.addCookies(
        options.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? host,
          path: c.path ?? "/",
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
          expires: c.expires,
        })),
      );
    }

    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();
    try {
      return await replayMacro(page, macro, options);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function replayMacro(
  page: Page,
  macro: AuspexMacro,
  options: MacroReplayOptions = {},
): Promise<MacroReplayResult> {
  const urlOptions = {
    allowedDomains: options.allowedDomains,
    blockedDomains: options.blockedDomains,
  };
  const actionDelayMs = options.actionDelayMs ?? DEFAULTS.actionDelayMs;
  const gotoTimeoutMs = options.gotoTimeoutMs ?? DEFAULTS.gotoTimeoutMs;
  const signal = options.signal;

  const needsSearch = macro.steps.some((s) => s.type === "search");
  if (needsSearch && !options.searxngClient) {
    return {
      status: "error",
      error: "macro.steps contains search but searxngClient was not provided",
    };
  }

  const dismissDialog = (dialog: { dismiss: () => Promise<void> }) => dialog.dismiss().catch(() => {});
  page.on("dialog", dismissDialog);

  try {
    try {
      await validateUrl(macro.startUrl, urlOptions);
      await page.goto(macro.startUrl, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Initial navigation failed: ${msg}` };
    }

    for (const step of macro.steps) {
      if (signal?.aborted) {
        return { status: "error", error: "Aborted by user" };
      }

      if (step.type === "search") {
        const client = options.searxngClient;
        if (!client) {
          return { status: "error", error: "searxngClient required for search step" };
        }
        try {
          await client.search(step.query, 5);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "error", error: `search failed: ${msg}` };
        }
      } else {
        try {
          await executeAction(page, step, urlOptions);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "error", error: `step ${step.type} failed: ${msg}` };
        }
      }

      if (!SKIP_INTER_STEP_DELAY_AFTER.has(step.type) && actionDelayMs > 0) {
        await page.waitForTimeout(actionDelayMs);
      }
    }

    return { status: "ok" };
  } finally {
    page.off("dialog", dismissDialog);
  }
}
