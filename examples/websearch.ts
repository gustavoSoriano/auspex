/**
 * Web search (SearXNG) example — requires a running SearXNG instance.
 *
 * Prerequisite:
 *   export SEARXNG_URL=http://localhost:8080
 *   # or pass searxngUrl in AgentConfig / run()
 *
 * Local SearXNG (Docker):
 *   docker run -d --name searxng -p 8080:8080 \
 *     -e BASE_URL=http://localhost:8080 \
 *     quay.io/searxng/searxng:latest
 */
import "dotenv/config";
import { Auspex } from "../src/index.js";

async function main() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error("Missing LLM_API_KEY in .env");
    process.exit(1);
  }

  const searxngUrl = process.env.SEARXNG_URL ?? "http://localhost:8080";

  // Option A: configure SearXNG on the agent (also works with SEARXNG_URL only via schema transform)
  const agent = new Auspex({
    llmApiKey: apiKey,
    llmBaseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    temperature: 0,
    timeoutMs: 180_000,
    searxngUrl,
  });

  console.log("Web search example — SearXNG:", searxngUrl, "\n");

  // 1) No URL: initial search uses your prompt as the SearXNG `q` parameter, then opens the first result.
  // Avoid asking for file downloads — the agent cannot download binaries. Ask for a fact visible on the page.
  const withoutUrl = await agent.run({
    prompt:
      "Qual é a versão LTS atual do Node.js? Use a página oficial do nodejs.org (encontre-a através da busca, se necessário).",
  });

  console.log("--- Run without url ---");
  console.log("status:", withoutUrl.status);
  console.log("tier:", withoutUrl.tier);
  console.log("data (preview):", withoutUrl.data?.slice(0, 500) ?? withoutUrl.data);
  console.log("error:", withoutUrl.error ?? "(none)");
  console.log();

  // 2) With URL: normal flow; the agent can still use the `search` action if it needs more context.
  const withUrl = await agent.run({
    url: "https://news.ycombinator.com",
    prompt: "Qual é o título da primeira história na página?",
  });

  console.log("--- Run with url ---");
  console.log("status:", withUrl.status);
  console.log("tier:", withUrl.tier);
  console.log("data:", withUrl.data);
  console.log("error:", withUrl.error ?? "(none)");

  await agent.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
