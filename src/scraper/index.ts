import { validateUrl } from "../security/url-validator.js";
import { Tier1HTTP } from "./tiers/tier1-http.js";
import { Tier2Stealth } from "./tiers/tier2-stealth.js";
import { Tier3Browser } from "./tiers/tier3-browser.js";
import { extractLinksWithMetadata } from "./extractors/content.js";
import type {
  MapLink,
  MapOptions,
  MapResult,
  ScrapeOptions,
  ScrapeResult,
  ScraperConfig,
} from "./types.js";

// ─── Scraper ───────────────────────────────────────────────────────────────
//
// Scraper de alta qualidade com fallback automático em 3 tiers:
//
//   Tier 1 → HTTP puro (got-scraping)         (~100-500ms, sem browser)
//              ↓ bloqueado ou conteúdo insuficiente (SPA, anti-bot básico)
//   Tier 2 → HTTP Stealth (got-scraping)      (~200-800ms, TLS fingerprint)
//              ↓ ainda bloqueado ou SPA sem SSR
//   Tier 3 → Playwright Chromium + stealth    (~2-10s, browser completo)
//
// Anti-SSRF integrado: todas as URLs são validadas antes do scrape.
// ──────────────────────────────────────────────────────────────────────────

export class Scraper {
  private readonly tier1: Tier1HTTP;
  private readonly tier2: Tier2Stealth;
  private readonly tier3: Tier3Browser;
  private readonly config: {
    timeout: number;
    verbose: boolean;
    forceTier?: ScraperConfig["forceTier"];
    allowedDomains?: string[];
    blockedDomains?: string[];
  };

  constructor(private readonly fullConfig: ScraperConfig = {}) {
    this.tier1 = new Tier1HTTP();
    this.tier2 = new Tier2Stealth();
    this.tier3 = new Tier3Browser(fullConfig.browserConfig);
    this.config = {
      timeout: fullConfig.timeout ?? 30_000,
      verbose: fullConfig.verbose ?? false,
      forceTier: fullConfig.forceTier,
      allowedDomains: fullConfig.allowedDomains,
      blockedDomains: fullConfig.blockedDomains,
    };
  }

  // ── Scrape de uma única URL ────────────────────────────────────────────

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    // Validação anti-SSRF antes de qualquer requisição
    const validUrl = await validateUrl(url, {
      allowedDomains: this.config.allowedDomains,
      blockedDomains: this.config.blockedDomains,
    });

    const mergedOptions: ScrapeOptions = {
      timeout: this.config.timeout,
      ...options,
    };

    // ── Tier forçado: pula a cascata automática ────────────────────────
    const forced = options.forceTier ?? this.config.forceTier;

    if (forced === "browser") {
      this.log("🌐 Tier 3 (Playwright) forçado");
      return this.tier3.scrape(validUrl, mergedOptions);
    }

    if (forced === "stealth") {
      this.log("🥷 Tier 2 (Stealth HTTP) forçado");
      return this.tier2.scrape(validUrl, mergedOptions);
    }

    if (forced === "http") {
      this.log("🔗 Tier 1 (HTTP) forçado");
      return this.tier1.scrape(validUrl, mergedOptions);
    }

    // ── Modo automático: Tier 1 → Tier 2 → Tier 3 ────────────────────

    // ── Tier 1: HTTP puro (fetch nativo, sem overhead de TLS) ─────────
    let tier1Error: string | null = null;
    try {
      const result = await this.tier1.scrape(validUrl, mergedOptions);
      const content = result.markdown ?? result.text ?? "";

      // Menos de 200 chars sem dados SSR = página quase certamente vazia
      // (SPA sem SSR, Cloudflare challenge, bloqueio silencioso, etc.)
      if (content.length < 200 && !result.ssrData) {
        tier1Error = "Conteúdo insuficiente após HTTP — provavelmente SPA ou bloqueio silencioso";
        this.log(`⚠  Tier 1: ${tier1Error}`);
      } else {
        this.log(`✓ Tier 1 (HTTP) — ${result.durationMs}ms`);
        return result;
      }
    } catch (err) {
      tier1Error = err instanceof Error ? err.message : String(err);
      this.log(`⚠  Tier 1 falhou: ${tier1Error}`);
    }

    // ── Tier 2: HTTP Stealth (got-scraping, TLS fingerprint) ──────────
    let tier2Error: string | null = null;
    this.log("🥷 Ativando fallback → Tier 2 (Stealth HTTP)...");
    try {
      const result = await this.tier2.scrape(validUrl, mergedOptions);
      const content = result.markdown ?? result.text ?? "";

      // Mesmo com TLS spoofing pode ser SPA que precisa de browser
      if (content.length < 200 && !result.ssrData) {
        tier2Error = "Conteúdo insuficiente após Stealth — SPA que precisa de browser";
        this.log(`⚠  Tier 2: ${tier2Error}`);
      } else {
        this.log(`✓ Tier 2 (Stealth) — ${result.durationMs}ms`);
        return result;
      }
    } catch (err) {
      tier2Error = err instanceof Error ? err.message : String(err);
      this.log(`⚠  Tier 2 (Stealth) falhou: ${tier2Error}`);
    }

    // ── Tier 3: Playwright Chromium + stealth (fallback final) ────────
    this.log("🌐 Ativando fallback final → Tier 3 (Playwright)...");
    try {
      const result = await this.tier3.scrape(validUrl, mergedOptions);
      this.log(`✓ Tier 3 (Playwright) — ${result.durationMs}ms`);
      return result;
    } catch (err) {
      const tier3Error = err instanceof Error ? err.message : String(err);
      this.log(`✗ Tier 3 (Playwright) falhou: ${tier3Error}`);

      // Todos os tiers falharam — retorna resultado com erro consolidado
      return {
        url: validUrl,
        statusCode: 0,
        title: "",
        tier: "browser",
        durationMs: 0,
        error: [
          "Todos os tiers falharam:",
          `  Tier 1 (HTTP):    ${tier1Error ?? "não tentado"}`,
          `  Tier 2 (Stealth): ${tier2Error ?? "não tentado"}`,
          `  Tier 3 (Browser): ${tier3Error}`,
        ].join("\n"),
      };
    }
  }

  // ── Map: descobrir URLs de um site ──────────────────────────────────────

  /**
   * Mapeia links de uma página (URL + texto do âncora).
   * Reutiliza a cascata de tiers (HTTP → Stealth → Browser).
   *
   * @param url - URL base para extrair links
   * @param options - Filtros e limites
   */
  async map(url: string, options: MapOptions = {}): Promise<MapResult> {
    const startTime = Date.now();
    const limit = options.limit ?? 2000;  // Increased: allow comprehensive link discovery
    const includeSubdomains = options.includeSubdomains ?? true;
    const ignoreQueryParameters = options.ignoreQueryParameters ?? true;
    const searchTerm = options.search?.toLowerCase().trim();

    let scrapeResult: ScrapeResult;

    try {
      scrapeResult = await this.scrape(url, {
        getRawHtml: true,
        forceTier: options.forceTier,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        url,
        links: [],
        tier: "http",
        durationMs: Date.now() - startTime,
        error: `Falha ao carregar a página: ${errorMsg}`,
      };
    }

    if (scrapeResult.error) {
      return {
        url: scrapeResult.url,
        links: [],
        tier: scrapeResult.tier,
        durationMs: scrapeResult.durationMs,
        error: scrapeResult.error,
      };
    }

    const rawHtml = scrapeResult.rawHtml ?? scrapeResult.html ?? "";
    if (!rawHtml) {
      return {
        url: scrapeResult.url,
        links: [],
        tier: scrapeResult.tier,
        durationMs: scrapeResult.durationMs,
        error: "HTML não disponível para extração de links",
      };
    }

    const baseUrl = scrapeResult.url;
    const baseHostname = new URL(baseUrl).hostname;
    const baseDomain = baseHostname.replace(/^www\./, "");

    let links = extractLinksWithMetadata(rawHtml, baseUrl);

    // Filtrar por mesmo domínio
    links = links.filter((link) => {
      try {
        const linkHost = new URL(link.url).hostname.replace(/^www\./, "");
        if (includeSubdomains) {
          return linkHost === baseDomain || linkHost.endsWith(`.${baseDomain}`);
        }
        return linkHost === baseDomain;
      } catch {
        return false;
      }
    });

    // Normalizar URL (remover query string) e deduplicar
    const normalizeUrl = (href: string): string => {
      if (!ignoreQueryParameters) return href;
      try {
        const u = new URL(href);
        u.search = "";
        return u.href;
      } catch {
        return href;
      }
    };

    const seen = new Set<string>();
    const deduped: MapLink[] = [];
    for (const link of links) {
      const key = ignoreQueryParameters ? normalizeUrl(link.url) : link.url;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        url: link.url,
        title: link.title || undefined,
      });
    }
    links = deduped;

    // Filtrar e ordenar por search (relevância simples)
    if (searchTerm) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const scored = links
        .map((link) => {
          const urlLower = link.url.toLowerCase();
          const titleLower = (link.title ?? "").toLowerCase();
          const urlMatches = (urlLower.match(regex) ?? []).length;
          const titleMatches = (titleLower.match(regex) ?? []).length;
          const score = urlMatches * 2 + titleMatches * 3; // title tem mais peso
          return { link, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ link }) => link);
      links = scored;
    }

    const result: MapResult = {
      url: baseUrl,
      links: links.slice(0, limit),
      tier: scrapeResult.tier,
      durationMs: Date.now() - startTime,
    };

    this.log(`✓ Map: ${result.links.length} links (${result.tier})`);
    return result;
  }

  // ── Scrape em lote com concorrência controlada ─────────────────────────

  /**
   * Scrapia múltiplas URLs em paralelo com concorrência limitada.
   * Erros em URLs individuais não derrubam o lote inteiro.
   *
   * @param urls - Lista de URLs a scrapeiar
   * @param options - Opções aplicadas a todas as URLs
   * @param concurrency - Máximo de scrapes simultâneos. Default: 3
   */
  async scrapeMany(
    urls: string[],
    options: ScrapeOptions = {},
    concurrency = 3,
  ): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    const queue = [...urls];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const settled = await Promise.allSettled(
        batch.map((u) => this.scrape(u, options)),
      );

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          results.push(outcome.value);
        } else {
          results.push({
            url: "unknown",
            statusCode: 0,
            title: "",
            tier: "http",
            durationMs: 0,
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          });
        }
      }
    }

    return results;
  }

  // ── Encerrar recursos ──────────────────────────────────────────────────

  /**
   * Fecha o browser Playwright (Tier 3).
   * Sempre chamar ao terminar para evitar processos Chromium órfãos.
   */
  async close(): Promise<void> {
    await this.tier3.close();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private log(msg: string): void {
    if (this.config.verbose) {
      console.log(`[Scraper] ${msg}`);
    }
  }
}

// Re-exporta tipos para conveniência
export type {
  ScrapeOptions,
  ScrapeResult,
  ScrapeTier,
  ContentFormat,
  SSRData,
  InterceptedAPI,
  ScraperConfig,
  TierRawResult,
  MapLink,
  MapOptions,
  MapResult,
} from "./types.js";
