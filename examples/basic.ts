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
  });

  console.log("Starting browser agent...\n");

  const result = await agent.run({
    url: "https://www.ragup.com.br/",
    prompt:
      "Me explique de forma detalhada o que é o ragup, para que serve, quais são seus principais recursos e funcionalidades",
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
