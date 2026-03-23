/**
 * Macro recording + replay example
 *
 * 1. Runs the agent once with a URL prompt (on success, `result.macro` is filled).
 * 2. Prints the canonical JSON string (`macroToJsonString`).
 * 3. Replays the macro with `replayMacroWithBrowser` (stealth launch + context + steps; no LLM).
 *
 * Requires: LLM_API_KEY in .env, Chromium for Playwright (`npx playwright install chromium`).
 */
import "dotenv/config";
import { Auspex, macroToJsonString, replayMacroWithBrowser } from "../src/index.js";

async function main() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error("Missing LLM_API_KEY in .env");
    process.exit(1);
  }

  const agent = new Auspex({
    llmApiKey: apiKey,
    llmBaseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    timeoutMs: 120_000,
  });

  console.log("--- 1) Agent run (macro is recorded on success) ---\n");

  const result = await agent.run({
    url: "https://www.omelete.com.br/busca?q=melhores+filmes",
    prompt: "Retorne o titulo do primeiro filme.",
    includeMacro: true,
  });

  await agent.close();

  if (result.status !== "done") {
    console.error("Run did not succeed:", result.status, result.error ?? "");
    process.exit(1);
  }

  if (!result.macro) {
    console.error("No macro on result (unexpected if includeMacro is true).");
    process.exit(1);
  }

  console.log(`tier: ${result.tier}`);
  console.log(`replayable steps: ${result.macro.steps.length}`);
  if (result.macro.capturedResult) {
    console.log(`captured result (reference): ${result.macro.capturedResult.slice(0, 200)}${result.macro.capturedResult.length > 200 ? "…" : ""}`);
  }

  console.log("\n--- Macro JSON ---\n");
  console.log(macroToJsonString(result.macro));

  console.log("\n--- 2) Replay (deterministic, no LLM) ---\n");

  const replay = await replayMacroWithBrowser(result.macro, {
    actionDelayMs: 300,
    gotoTimeoutMs: 15_000,
  });

  console.log("replayMacroWithBrowser:", replay);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
