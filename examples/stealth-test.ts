/**
 * Stealth Integration Test
 *
 * Tests the Playwright + playwright-extra stealth plugin integration against 3 sites:
 *   1. bot.sannysoft.com        — 22+ browser fingerprint checks (DOM query-based)
 *   2. arh.antoinevastel.com    — Bot detection via JavaScript API analysis
 *   3. books.toscrape.com       — Real-world Agent regression test (LLM-driven)
 *
 * Each site is tested in BOTH baseline (raw headless) and stealth mode for comparison.
 */

import "dotenv/config";
import { chromium as rawChromium } from "playwright";
import { launchStealthBrowser, STEALTH_INIT_SCRIPT, CHROME_UA } from "../src/browser/stealth.js";
import { Auspex } from "../src/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

const nowMs = () => Date.now();
const elapsed = (start: number) => `${((Date.now() - start) / 1000).toFixed(2)}s`;
const banner = (title: string) => {
  const line = "─".repeat(62);
  console.log(`\n${line}\n  ${title}\n${line}`);
};

type Mode = "baseline" | "stealth";

async function launchBrowser(mode: Mode) {
  if (mode === "baseline") {
    return rawChromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return launchStealthBrowser();
}

async function createPage(mode: Mode, browser: Awaited<ReturnType<typeof launchBrowser>>) {
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    viewport: { width: 1920, height: 1080 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });

  if (mode === "baseline") {
    // Exactly what agent.ts used BEFORE this integration
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
      (window as unknown as { chrome?: unknown }).chrome = { runtime: {} };
    });
  } else {
    // Full stealth: playwright-extra plugin + comprehensive init script (double layer)
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  }

  return { context, page: await context.newPage() };
}

// ─── Test 1: bot.sannysoft.com ───────────────────────────────────────────────
// Queries the actual DOM result cells (td.passed / td.failed) for accuracy.

interface SannysoftResult {
  passed: number;
  failed: number;
  passRate: number;
  failedItems: string[];
  fingerprintChecks: Record<string, string>;
  durationMs: number;
}

async function testSannysoft(mode: Mode): Promise<SannysoftResult> {
  const start = nowMs();
  const browser = await launchBrowser(mode);
  const { context, page } = await createPage(mode, browser);

  try {
    await page.goto("https://bot.sannysoft.com", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tr"));
      const passed: string[] = [];
      const failed: string[] = [];
      const checks: Record<string, string> = {};

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 2) continue;
        const name = cells[0]?.textContent?.trim() ?? "";
        const value = cells[1]?.textContent?.trim() ?? "";
        const status = cells[1]?.className ?? "";

        checks[name] = value;

        if (status.includes("passed") || status.includes("ok")) {
          passed.push(name);
        } else if (status.includes("failed") || status.includes("warn")) {
          failed.push(`${name}: ${value}`);
        }
      }

      // Also extract navigator properties directly
      const navChecks: Record<string, string> = {
        "navigator.webdriver": String((navigator as Navigator & { webdriver?: unknown }).webdriver),
        "navigator.plugins.length": String(navigator.plugins.length),
        "window.chrome": typeof (window as Window & { chrome?: unknown }).chrome,
        "navigator.hardwareConcurrency": String(navigator.hardwareConcurrency),
        "navigator.languages": JSON.stringify(navigator.languages),
      };

      return { passed, failed, checks, navChecks };
    });

    const total = result.passed.length + result.failed.length;
    const passRate = total > 0 ? Math.round((result.passed.length / total) * 100) : 0;

    return {
      passed: result.passed.length,
      failed: result.failed.length,
      passRate,
      failedItems: result.failed,
      fingerprintChecks: result.navChecks,
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ─── Test 2: arh.antoinevastel.com/bots/areyouabot ──────────────────────────
// Tests multiple bot detection signals and shows a "you are a bot" / "you are not a bot" verdict.

interface BotDetectionResult {
  isBot: boolean | null;
  verdict: string;
  signals: Record<string, string>;
  durationMs: number;
}

async function testBotDetection(mode: Mode): Promise<BotDetectionResult> {
  const start = nowMs();
  const browser = await launchBrowser(mode);
  const { context, page } = await createPage(mode, browser);

  try {
    await page.goto("https://arh.antoinevastel.com/bots/areyouabot", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);

    const result = await page.evaluate(() => {
      const bodyText = document.body.innerText ?? "";
      const title = document.title ?? "";

      // Extract signals from the page
      const signals: Record<string, string> = {
        "navigator.webdriver": String((navigator as Navigator & { webdriver?: unknown }).webdriver),
        "navigator.plugins.length": String(navigator.plugins.length),
        "window.chrome": typeof (window as Window & { chrome?: unknown }).chrome,
        "navigator.platform": navigator.platform,
        "navigator.hardwareConcurrency": String(navigator.hardwareConcurrency),
        "screen.colorDepth": String(screen.colorDepth),
      };

      const isBot =
        bodyText.toLowerCase().includes("you are a bot") ||
        bodyText.toLowerCase().includes("bot detected");
      const notBot =
        bodyText.toLowerCase().includes("you are not a bot") ||
        bodyText.toLowerCase().includes("not detected as a bot");

      return { bodyText: bodyText.slice(0, 500), title, signals, isBot, notBot };
    });

    return {
      isBot: result.isBot ? true : result.notBot ? false : null,
      verdict: result.isBot
        ? "BOT DETECTED"
        : result.notBot
          ? "NOT A BOT (PASS)"
          : `INCONCLUSIVE — page: "${result.bodyText.slice(0, 120)}"`,
      signals: result.signals,
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ─── Test 3: books.toscrape.com (Agent + LLM) ────────────────────────────────

interface AgentTestResult {
  status: string;
  tier: string;
  data: string | null;
  durationMs: number;
  tokens: number;
  error?: string;
}

async function testBooksToScrape(): Promise<AgentTestResult> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("Missing LLM_API_KEY in .env");

  const agent = new Auspex({
    llmApiKey: apiKey,
    llmBaseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    timeoutMs: 120_000,
    maxIterations: 15,
  });

  agent.on("tier", (tier) => console.log(`    [tier] ${tier}`));
  agent.on("action", (action, i) => {
    const desc =
      action.type === "click" ? `click "${action.selector}"` :
      action.type === "goto"  ? `goto ${action.url}` :
      action.type === "done"  ? "done" : action.type;
    console.log(`    [action ${i}] ${desc}`);
  });

  const result = await agent.run({
    url: "https://books.toscrape.com",
    prompt: "Find the Mystery category and return the title and price of the first 3 books listed.",
  });

  await agent.close();

  return {
    status: result.status,
    tier: result.tier,
    data: result.data,
    durationMs: result.durationMs,
    tokens: result.usage.totalTokens,
    error: result.error,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  AUSPEX — Stealth Integration Test Suite                      ║");
  console.log("║  playwright-extra v4 + puppeteer-extra-plugin-stealth v2      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nStarted at: ${new Date().toISOString()}\n`);

  // ── Test 1: bot.sannysoft.com ────────────────────────────────────────────
  banner("TEST 1 / 3 — bot.sannysoft.com (22+ Bot Detection Checks)");

  const t1Start = nowMs();
  let baselineSannysoft!: SannysoftResult;
  let stealthSannysoft!: SannysoftResult;

  console.log("Running BASELINE (raw headless Chromium)...");
  try {
    baselineSannysoft = await testSannysoft("baseline");
    console.log(`  Result: ${baselineSannysoft.passed}/${baselineSannysoft.passed + baselineSannysoft.failed} passed (${baselineSannysoft.passRate}%) in ${baselineSannysoft.durationMs}ms`);
    console.log(`  navigator.webdriver = ${baselineSannysoft.fingerprintChecks["navigator.webdriver"]}`);
    console.log(`  window.chrome       = ${baselineSannysoft.fingerprintChecks["window.chrome"]}`);
    console.log(`  plugins.length      = ${baselineSannysoft.fingerprintChecks["navigator.plugins.length"]}`);
    if (baselineSannysoft.failedItems.length > 0) {
      console.log(`  Failed: ${baselineSannysoft.failedItems.slice(0, 4).join(" | ")}`);
    }
  } catch (err) {
    console.error(`  BASELINE ERROR: ${err}`);
    baselineSannysoft = { passed: 0, failed: 0, passRate: 0, failedItems: [`${err}`], fingerprintChecks: {}, durationMs: 0 };
  }

  console.log("\nRunning STEALTH (playwright-extra + stealth plugin + init script)...");
  try {
    stealthSannysoft = await testSannysoft("stealth");
    console.log(`  Result: ${stealthSannysoft.passed}/${stealthSannysoft.passed + stealthSannysoft.failed} passed (${stealthSannysoft.passRate}%) in ${stealthSannysoft.durationMs}ms`);
    console.log(`  navigator.webdriver = ${stealthSannysoft.fingerprintChecks["navigator.webdriver"]}`);
    console.log(`  window.chrome       = ${stealthSannysoft.fingerprintChecks["window.chrome"]}`);
    console.log(`  plugins.length      = ${stealthSannysoft.fingerprintChecks["navigator.plugins.length"]}`);
    if (stealthSannysoft.failedItems.length > 0) {
      console.log(`  Still failing: ${stealthSannysoft.failedItems.slice(0, 4).join(" | ")}`);
    }
  } catch (err) {
    console.error(`  STEALTH ERROR: ${err}`);
    stealthSannysoft = { passed: 0, failed: 0, passRate: 0, failedItems: [`${err}`], fingerprintChecks: {}, durationMs: 0 };
  }

  const improvement1 = stealthSannysoft.passRate - baselineSannysoft.passRate;
  console.log(`\n  Δ Improvement: ${improvement1 >= 0 ? "+" : ""}${improvement1}pp (${baselineSannysoft.passRate}% → ${stealthSannysoft.passRate}%)`);
  console.log(`  Total test duration: ${elapsed(t1Start)}`);

  // ── Test 2: arh.antoinevastel.com ───────────────────────────────────────
  banner("TEST 2 / 3 — arh.antoinevastel.com (Bot Signal Analysis)");

  const t2Start = nowMs();
  let baselineBot!: BotDetectionResult;
  let stealthBot!: BotDetectionResult;

  console.log("Running BASELINE...");
  try {
    baselineBot = await testBotDetection("baseline");
    console.log(`  Verdict: ${baselineBot.verdict}`);
    console.log(`  navigator.webdriver = ${baselineBot.signals["navigator.webdriver"]}`);
    console.log(`  window.chrome       = ${baselineBot.signals["window.chrome"]}`);
    console.log(`  plugins.length      = ${baselineBot.signals["navigator.plugins.length"]}`);
  } catch (err) {
    console.error(`  BASELINE ERROR: ${err}`);
    baselineBot = { isBot: null, verdict: `error: ${err}`, signals: {}, durationMs: 0 };
  }

  console.log("\nRunning STEALTH...");
  try {
    stealthBot = await testBotDetection("stealth");
    console.log(`  Verdict: ${stealthBot.verdict}`);
    console.log(`  navigator.webdriver = ${stealthBot.signals["navigator.webdriver"]}`);
    console.log(`  window.chrome       = ${stealthBot.signals["window.chrome"]}`);
    console.log(`  plugins.length      = ${stealthBot.signals["navigator.plugins.length"]}`);
    console.log(`  navigator.platform  = ${stealthBot.signals["navigator.platform"]}`);
  } catch (err) {
    console.error(`  STEALTH ERROR: ${err}`);
    stealthBot = { isBot: null, verdict: `error: ${err}`, signals: {}, durationMs: 0 };
  }

  console.log(`\n  Total test duration: ${elapsed(t2Start)}`);

  // ── Test 3: books.toscrape.com ───────────────────────────────────────────
  banner("TEST 3 / 3 — books.toscrape.com (Auspex Agent + LLM Regression)");
  console.log("Running Agent (stealth Playwright used internally)...\n");

  const t3Start = nowMs();
  let agentResult!: AgentTestResult;
  try {
    agentResult = await testBooksToScrape();
    console.log(`\n  Status:  ${agentResult.status}`);
    console.log(`  Tier:    ${agentResult.tier}`);
    console.log(`  Tokens:  ${agentResult.tokens}`);
    console.log(`  Time:    ${agentResult.durationMs}ms`);
    if (agentResult.data) {
      console.log(`  Data:\n    ${agentResult.data}`);
    }
    if (agentResult.error) {
      console.log(`  Error: ${agentResult.error}`);
    }
  } catch (err) {
    console.error(`  AGENT ERROR: ${err}`);
    agentResult = { status: "error", tier: "unknown", data: null, durationMs: Date.now() - t3Start, tokens: 0, error: String(err) };
  }

  console.log(`\n  Total test duration: ${elapsed(t3Start)}`);

  // ── Final Summary ─────────────────────────────────────────────────────────
  banner("FINAL SUMMARY");
  const t1Icon = stealthSannysoft.passRate >= baselineSannysoft.passRate ? "✓" : "✗";
  const t2Icon = stealthBot.isBot === false ? "✓" : stealthBot.isBot === true ? "✗" : "?";
  const t3Icon = agentResult.status === "done" ? "✓" : "✗";

  console.log(`  ${t1Icon} [Test 1] bot.sannysoft.com        ${stealthSannysoft.passRate}% pass (was ${baselineSannysoft.passRate}%, Δ${improvement1 >= 0 ? "+" : ""}${improvement1}pp)`);
  console.log(`  ${t2Icon} [Test 2] arh.antoinevastel.com    Stealth: ${stealthBot.verdict}`);
  console.log(`  ${t3Icon} [Test 3] books.toscrape.com       Status: ${agentResult.status} | Tier: ${agentResult.tier} | ${agentResult.tokens} tokens\n`);

  // ── JSON output for report generation ─────────────────────────────────────
  const reportData = {
    timestamp: new Date().toISOString(),
    tests: {
      sannysoft: {
        baseline: { passed: baselineSannysoft.passed, failed: baselineSannysoft.failed, passRate: baselineSannysoft.passRate, failedItems: baselineSannysoft.failedItems, fingerprintChecks: baselineSannysoft.fingerprintChecks },
        stealth: { passed: stealthSannysoft.passed, failed: stealthSannysoft.failed, passRate: stealthSannysoft.passRate, failedItems: stealthSannysoft.failedItems, fingerprintChecks: stealthSannysoft.fingerprintChecks },
        improvement: improvement1,
      },
      botDetection: {
        baseline: { isBot: baselineBot.isBot, verdict: baselineBot.verdict, signals: baselineBot.signals },
        stealth: { isBot: stealthBot.isBot, verdict: stealthBot.verdict, signals: stealthBot.signals },
      },
      agentRegression: {
        status: agentResult.status,
        tier: agentResult.tier,
        tokens: agentResult.tokens,
        durationMs: agentResult.durationMs,
        dataPreview: agentResult.data?.slice(0, 500) ?? null,
        error: agentResult.error,
      },
    },
  };

  console.log("\n__REPORT_JSON_START__");
  console.log(JSON.stringify(reportData, null, 2));
  console.log("__REPORT_JSON_END__");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
