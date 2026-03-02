import "dotenv/config";
import { Auspex } from "../src/index.js";

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
    temperature: 1,
    timeoutMs: 180000,
    log: true,
    vision: true
  });

  console.log("Starting browser agent...\n");

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
      action.type === "done"     ? `done: ${action.result.slice(0, 120)}` :
      JSON.stringify(action);
    console.log(`  [action ${i}] ${desc}`);
  });

  const result = await agent.run({
    url: "https://www.falamatao.com.br",
    prompt:
      "Liste todas as noticias encontradas",
  });

  console.log(result);

  if (result.error) {
    console.error(`Error: ${result.error}`);
  }

  await agent.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
