/**
 * Exemplo completo do Scraper — 3 tiers com fallback automático
 *
 * Fluxo de fallback:
 *   Tier 1 (HTTP puro)          →  fetch nativo, ~100-500ms
 *       ↓ bloqueado ou SPA sem SSR
 *   Tier 2 (HTTP Stealth)       →  got-scraping TLS fingerprint, ~200-800ms
 *       ↓ ainda bloqueado ou SPA complexa
 *   Tier 3 (Playwright)         →  browser completo + stealth scripts, ~2-10s
 *
 * Para rodar:  npx tsx examples/scraper.ts
 */

import "dotenv/config";
import { Scraper } from "../src/scraper/index.js";
import type { ScrapeResult } from "../src/scraper/types.js";

const LINE = "─".repeat(62);

function tierLabel(tier: ScrapeResult["tier"]): string {
  switch (tier) {
    case "http":    return "🔗 Tier 1 — HTTP puro (fetch nativo)";
    case "stealth": return "🥷 Tier 2 — HTTP Stealth (TLS fingerprint)";
    case "browser": return "🌐 Tier 3 — Playwright Chromium (browser completo)";
    default:        return `❓ ${tier}`;
  }
}

function printResult(label: string, result: ScrapeResult): void {
  console.log(`\n${LINE}`);
  console.log(`  ${label}`);
  console.log(LINE);
  console.log(`  URL:        ${result.url}`);
  console.log(`  Status:     ${result.statusCode}`);
  console.log(`  Tier:       ${tierLabel(result.tier)}`);
  console.log(`  Título:     ${result.title}`);
  console.log(`  Duração:    ${result.durationMs}ms`);

  if (result.description) {
    const desc = result.description.slice(0, 120);
    console.log(`  Descrição:  ${desc}${result.description.length > 120 ? "…" : ""}`);
  }

  if (result.ssrData) {
    console.log(`  SSR:        ✓ dados ${result.ssrData.type} embutidos encontrados`);
  }

  if (result.interceptedAPIs?.length) {
    console.log(`  APIs:       ${result.interceptedAPIs.length} chamada(s) JSON interceptada(s)`);
    for (const api of result.interceptedAPIs.slice(0, 3)) {
      const shortUrl = api.url.slice(0, 80);
      console.log(`              • ${api.method} ${shortUrl}`);
    }
  }

  if (result.links?.length) {
    console.log(`  Links:      ${result.links.length} encontrado(s)`);
  }

  if (result.markdown) {
    const preview = result.markdown.slice(0, 600).replace(/\n/g, "\n    ");
    console.log(`\n  Conteúdo (Markdown, primeiros 600 chars):\n`);
    console.log(`    ${preview}${result.markdown.length > 600 ? "\n    […]" : ""}`);
  }

  if (result.error) {
    console.error(`\n  ⚠  Erro: ${result.error}`);
  }
}

async function main() {
  // verbose: true → mostra no console qual tier está sendo usado e por quê
  // O browser Playwright (Tier 3) é mantido aberto e reutilizado entre requisições
  const crawler = new Scraper({ verbose: true });

  try {
    // ── Teste 1: Site estático → deve resolver no Tier 1 ─────────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 1: Site estático — Wikipedia");
    console.log("  Esperado: 🔗 Tier 1 (HTTP puro)");
    console.log("══════════════════════════════════════════════════════════════");

    const wiki = await crawler.scrape(
      "https://pt.wikipedia.org/wiki/Intelig%C3%AAncia_artificial",
      { formats: ["markdown", "text"], onlyMainContent: true },
    );
    printResult("Wikipedia — Inteligência Artificial", wiki);

    // ── Teste 2: SSR (Next.js) → SSR detectado no Tier 1 ou 2 ────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 2: E-commerce Next.js — ragup.com.br");
    console.log("  Esperado: Tier 1 com SSR data OU 🥷 Tier 2 (Stealth HTTP)");
    console.log("══════════════════════════════════════════════════════════════");

    const ragup = await crawler.scrape("https://www.ragup.com.br", {
      formats: ["markdown"],
      onlyMainContent: true,
      interceptAPIs: true,
    });
    printResult("Ragup — Home", ragup);

    // ── Teste 3: Forçar Tier 2 (Stealth HTTP) ────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 3: Forçar 🥷 Tier 2 (Stealth HTTP / TLS fingerprint)");
    console.log("  Útil para sites que bloqueiam por JA3/JA4 fingerprint.");
    console.log("══════════════════════════════════════════════════════════════");

    const stealth = await crawler.scrape("https://www.ragup.com.br", {
      formats: ["markdown"],
      forceTier: "stealth",
    });
    printResult("Ragup — Home (Stealth HTTP forçado)", stealth);

    // ── Teste 4: Forçar Tier 3 (Playwright) — SPA complexa ───────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 4: Forçar 🌐 Tier 3 (Playwright Chromium + stealth)");
    console.log("  Útil para SPAs com anti-bot pesado (Cloudflare, Akamai…)");
    console.log("══════════════════════════════════════════════════════════════");

    const spa = await crawler.scrape("https://www.ragup.com.br/planos", {
      formats: ["markdown"],
      forceTier: "browser",
      interceptAPIs: true,
      // Aguarda o conteúdo principal carregar
      waitForSelector: "main, [class*='plan'], [class*='price']",
    });
    printResult("Ragup — Planos (Playwright forçado)", spa);

    // ── Teste 5: Auto-fallback completo em SPA ────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 5: Auto-fallback — Tier 1 → Tier 2 → Tier 3");
    console.log("  Sem forceTier: o Scraper decide o melhor tier automaticamente.");
    console.log("══════════════════════════════════════════════════════════════");

    const autoFallback = await crawler.scrape("https://www.ragup.com.br/planos", {
      formats: ["markdown"],
      interceptAPIs: true,
      waitForSelector: "main, .container, [class*='plan']",
    });
    printResult("Ragup — Planos (auto-fallback)", autoFallback);

    // ── Teste 6: Scrape em lote ───────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  TESTE 6: Scrape em lote (3 URLs simultâneas)");
    console.log("  Cada URL tenta os 3 tiers de forma independente.");
    console.log("══════════════════════════════════════════════════════════════");

    const urls = [
      "https://pt.wikipedia.org/wiki/TypeScript",
      "https://pt.wikipedia.org/wiki/Node.js",
      "https://pt.wikipedia.org/wiki/Web_scraping",
    ];

    const batchResults = await crawler.scrapeMany(
      urls,
      { formats: ["text"] },
      3, // concorrência máxima
    );

    console.log("\n  Resultados do lote:\n");
    for (const r of batchResults) {
      const status = r.error ? `⚠ ${r.error.slice(0, 60)}` : "✓";
      console.log(
        `  ${status} | ${tierLabel(r.tier)} | ${r.durationMs}ms | ${(r.text ?? "").length} chars`,
      );
      console.log(`    ${r.url}`);
    }
  } finally {
    // SEMPRE chamar close() para liberar o processo Chromium
    await crawler.close();
    console.log("\n✓ Scraper encerrado.\n");
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
