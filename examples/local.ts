import "dotenv/config";
import { Auspex } from "../src/index.js";

async function main() {
  const agent = new Auspex({
    provider: "agentium",
    temperature: 0,
    timeoutMs: 180_000,
    log: true,
  });

  console.log("Starting local agent (100% free, no API key needed)...\n");

  agent.on("tier", (tier) => {
    console.log(`[tier] ${tier}`);
  });

  agent.on("iteration", (i, snapshot) => {
    console.log(`\n[iter ${i}] ${snapshot.url} — "${snapshot.title}"`);
  });

  agent.on("action", (action, i) => {
    const desc =
      action.type === "click"    ? `click "${action.selector}"` :
      action.type === "type"     ? `type "${action.text}" into "${action.selector}"` :
      action.type === "pressKey" ? `press ${action.key}` :
      action.type === "goto"     ? `goto ${action.url}` :
      action.type === "scroll"   ? `scroll ${action.direction}` :
      action.type === "wait"     ? `wait ${action.ms}ms` :
      action.type === "done"     ? `done: ${(action.result ?? "").slice(0, 120)}` :
      JSON.stringify(action);
    console.log(`  [action ${i}] ${desc}`);
  });

  const result = await agent.run({
    url: "http://ragup.com.br/",
    prompt: "quais os planos disponíveis, precos e como contratar? Responda em português.",
  });

  console.log("\n--- Result ---");
  console.log("status:", result.status);
  console.log("tier:", result.tier);
  console.log("data:", result.data);
  if (result.error) console.error("error:", result.error);

  await agent.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
