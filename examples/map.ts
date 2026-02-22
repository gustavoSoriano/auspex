/**
 * Exemplo do Map — descoberta rápida de URLs de um site
 *
 * O Map extrai todos os links de uma página com título (texto do âncora),
 * filtrando por domínio e permitindo busca por relevância.
 *
 * Para rodar:  npx tsx examples/map.ts
 */

import { Scraper } from "../src/index.js";
import type { MapResult } from "../src/index.js";

async function main() {
  const crawler = new Scraper({ verbose: true });

  try {
    // ── Básico: mapear links do site ───────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  MAP: nodejs.org");
    console.log("═══════════════════════════════════════════════════\n");

    const result = await crawler.map("https://nodejs.org", {
      limit: 20,
    });

    printMapResult(result);

    // ── Com busca: filtrar por "download" ───────────────────────────────────
    console.log("\n\n═══════════════════════════════════════════════════");
    console.log("  MAP: nodejs.org (search: download)");
    console.log("═══════════════════════════════════════════════════\n");

    const downloads = await crawler.map("https://nodejs.org", {
      search: "download",
      limit: 10,
    });

    printMapResult(downloads);

    // ── Opções avançadas ────────────────────────────────────────────────────
    console.log("\n\n═══════════════════════════════════════════════════");
    console.log("  MAP: nodejs.org/docs (search: api)");
    console.log("═══════════════════════════════════════════════════\n");

    const docs = await crawler.map("https://nodejs.org/docs", {
      search: "api",
      limit: 8,
      includeSubdomains: true,
      ignoreQueryParameters: true,
    });

    printMapResult(docs);
  } finally {
    await crawler.close();
  }
}

function printMapResult(result: MapResult): void {
  if (result.error) {
    console.error("  Erro:", result.error);
    return;
  }

  console.log(`  URL base:   ${result.url}`);
  console.log(`  Tier:       ${result.tier}`);
  console.log(`  Duração:    ${result.durationMs}ms`);
  console.log(`  Links:      ${result.links.length}\n`);

  for (const link of result.links) {
    const title = link.title ? ` — ${link.title.slice(0, 50)}${link.title.length > 50 ? "…" : ""}` : "";
    console.log(`  • ${link.url}${title}`);
  }
}

main().catch(console.error);
