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
    temperature: 1
  });

  console.log("Starting browser agent...\n");

  const result = await agent.run({
    url: "https://www.z-api.io",
    prompt:
      "Me explique de forma detalhada o que é o Z-API, para que serve, quais são seus principais recursos e funcionalidades, e quanto custa cada plano disponível (preços, limites, diferenças entre os planos).",
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
