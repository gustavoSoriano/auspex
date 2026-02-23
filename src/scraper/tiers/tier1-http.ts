import { gotScraping } from "got-scraping";
import { load } from "cheerio";

import type { ScrapeOptions, ScrapeResult } from "../types.js";
import { extractSSRData, hasEnoughContent } from "../extractors/ssr.js";
import { extractContent } from "../extractors/content.js";
import { htmlToMarkdown } from "../extractors/to-markdown.js";

interface GotResponse {
  body: string;
  statusCode: number;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

// ─── Tier 1: got-scraping + TLS Fingerprint + Cheerio ──────────────────────
//
// Pipeline:
//  1. got-scraping com TLS/JA3 fingerprint spoofing que imita Chrome real
//  2. Detectar dados SSR embutidos (Next.js, Nuxt, Gatsby, Remix)
//  3. Verificar se o HTML tem conteúdo sem JS
//  4. Mozilla Readability → Cheerio (fallback) → Markdown
//
// Por que got-scraping em vez de fetch() nativo?
//   ✓ TLS fingerprint (JA3/JA4) idêntico ao Chrome → bypassa Cloudflare, Akamai
//   ✓ HTTP/2 com fingerprint consistente (TLS + ALPN + header order)
//   ✓ Header generator integrado: UA, Sec-Ch-Ua*, Sec-Fetch-* coerentes entre si
//   ✓ ~65-70% dos sites funcionam sem browser (~100-800ms)
//
// Limitações:
//   ✗ Não executa JavaScript → SPAs sem SSR vão falhar
//   → Orquestrador aciona Tier 2 (Stealth) ou Tier 3 (Playwright) se falhar
// ──────────────────────────────────────────────────────────────────────────

// Headers que NÃO são gerados automaticamente pelo got-scraping:
//   - Accept-Language  → precisa ser pt-BR para sites locais
//   - Cache-Control    → garante resposta fresca, sem cache de CDN
//   - Pragma           → backward compat com servidores antigos
//
// got-scraping auto-gera (coerentes com o TLS fingerprint do Chrome):
//   - User-Agent, Accept, Accept-Encoding
//   - Sec-Ch-Ua, Sec-Ch-Ua-Mobile, Sec-Ch-Ua-Platform
//   - Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Fetch-User
//   - Upgrade-Insecure-Requests
const EXTRA_HEADERS: Record<string, string> = {
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

// Códigos HTTP que indicam bloqueio ativo por anti-bot (não erro de servidor)
const ANTIBOT_STATUS = new Set([403, 429, 503]);

export class Tier1HTTP {
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const startTime = Date.now();

    // ── Requisição HTTP com TLS fingerprint spoofing ────────────────────
    // gotScraping() aplica JA3/JA4 fingerprint de Chrome real no handshake TLS.
    // O header generator (useHeaderGenerator: true, padrão) gera User-Agent,
    // Accept, Sec-Ch-Ua* e Sec-Fetch-* consistentes com esse fingerprint.
    // Isso é o que diferencia got-scraping de fetch() e axios.
    let response: GotResponse;

    try {
      response = (await gotScraping({
        url,
        // Mesclamos nossos headers extras com os que got-scraping auto-gera.
        // Se o usuário passar headers customizados, eles têm prioridade.
        headers: { ...EXTRA_HEADERS, ...options.headers },

        // Não lança exceção em 4xx/5xx — tratamos manualmente abaixo
        throwHttpErrors: false,

        // got gerencia decompressão (gzip/br) automaticamente — não setar Accept-Encoding
        timeout: { request: options.timeout ?? 15_000 },

        // Retorna o corpo como string (HTML)
        responseType: "text",
      })) as GotResponse;
    } catch (err) {
      // Erros de rede: DNS, TLS, timeout, ECONNREFUSED, etc.
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Tier1 HTTP: falha na requisição — ${msg}`);
    }

    // ── Verificações de bloqueio por anti-bot ───────────────────────────
    if (ANTIBOT_STATUS.has(response.statusCode)) {
      throw new Error(
        `Tier1 HTTP: status ${response.statusCode} — bloqueado por anti-bot`,
      );
    }

    if (response.statusCode >= 400) {
      throw new Error(`Tier1 HTTP: status HTTP ${response.statusCode}`);
    }

    // Content-Type: em got pode ser string ou string[] dependendo da versão
    const rawCt = response.headers["content-type"];
    const contentType = Array.isArray(rawCt) ? (rawCt[0] ?? "") : (rawCt ?? "");

    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error(
        `Tier1 HTTP: Content-Type "${contentType}" inesperado — esperava text/html`,
      );
    }

    const html = response.body as string;
    const finalUrl = response.url;

    // Single Cheerio parse shared across SSR detection, content check, and extraction
    const $ = load(html);

    const ssrData = extractSSRData(html, $);

    // NOTE: Do NOT pass shared $ to hasEnoughContent — it destructively removes
    // <img>, <svg>, <iframe> etc. which would corrupt $ for extractContent below.
    if (!hasEnoughContent(html) && !ssrData) {
      throw new Error(
        "Tier1 HTTP: conteúdo insuficiente — provavelmente SPA sem SSR ou anti-bot",
      );
    }

    const formats = options.formats ?? ["markdown", "text"];
    const extracted = extractContent(
      html,
      options.onlyMainContent ?? true,
      finalUrl,
      $,
    );

    const result: ScrapeResult = {
      url: finalUrl,
      statusCode: response.statusCode,
      title: extracted.title,
      description: extracted.description || undefined,
      tier: "http",
      durationMs: Date.now() - startTime,
      links: extracted.links.length > 0 ? extracted.links : undefined,
    };

    if (options.getRawHtml) result.rawHtml = html;

    if (formats.includes("markdown")) result.markdown = htmlToMarkdown(extracted.html);
    if (formats.includes("html"))     result.html     = extracted.html;
    if (formats.includes("text"))     result.text     = extracted.text;
    if (ssrData)                      result.ssrData  = ssrData;

    return result;
  }
}
