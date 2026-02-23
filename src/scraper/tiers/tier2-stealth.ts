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

// ─── Tier 2: HTTP Stealth com TLS Fingerprint ──────────────────────────────
//
// Pipeline:
//  1. gotScraping → HTTP com TLS fingerprint spoofing (JA3/JA4 anti-bot)
//  2. Gera headers realistas de Chrome automaticamente via headerGeneratorOptions
//  3. Detectar dados SSR embutidos (Next.js, Nuxt, Gatsby, Remix)
//  4. Verificar se o HTML tem conteúdo sem JS
//  5. Extrair conteúdo principal + converter para Markdown
//
// Ativado quando o Tier 1 (HTTP simples) for bloqueado por anti-bot básico.
// Resolve a maioria dos casos de TLS/JA3 fingerprinting.
//
// Se ainda falhar (SPA sem SSR, anti-bot avançado) → lança Error para o
// orquestrador acionar o Tier 3 (Playwright Chromium).
// ──────────────────────────────────────────────────────────────────────────

// Códigos HTTP que indicam bloqueio por anti-bot
const ANTIBOT_STATUS = new Set([403, 429, 503]);

export class Tier2Stealth {
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const startTime = Date.now();

    // ── Requisição HTTP com TLS fingerprint de browser real ─────────────
    let response: GotResponse;
    try {
      response = (await gotScraping({
        url,
        method: "GET",
        // Gera headers realistas de Chrome automaticamente
        headerGeneratorOptions: {
          browsers: [{ name: "chrome", minVersion: 120 }],
          operatingSystems: ["macos", "windows"],
          devices: ["desktop"],
          locales: ["pt-BR", "pt", "en-US"],
        },
        // Headers extras para parecer mais humano
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
          ...options.headers,
        },
        timeout: { request: options.timeout ?? 30_000 },
        followRedirect: true,
        maxRedirects: 10,
        retry: { limit: 2, methods: ["GET"] },
        throwHttpErrors: false,
        decompress: true,
      })) as GotResponse;
    } catch (err) {
      throw new Error(
        `Tier2 Stealth: falha na requisição — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const html = response.body as string;
    const statusCode = response.statusCode;
    const finalUrl = response.url ?? url;
    const $ = load(html);

    // ── Verificações de bloqueio ────────────────────────────────────────
    if (ANTIBOT_STATUS.has(statusCode)) {
      throw new Error(
        `Tier2 Stealth: status ${statusCode} — bloqueado por anti-bot`,
      );
    }

    if (statusCode >= 400) {
      throw new Error(`Tier2 Stealth: status ${statusCode}`);
    }

    const contentType = response.headers["content-type"] ?? "";
    if (
      !String(contentType).includes("text/html") &&
      !String(contentType).includes("text/plain")
    ) {
      throw new Error(
        `Tier2 Stealth: Content-Type inesperado "${contentType}" — esperava text/html`,
      );
    }

    const ssrData = extractSSRData(html, $);

    // NOTE: Do NOT pass shared $ to hasEnoughContent — it destructively removes
    // <img>, <svg>, <iframe> etc. which would corrupt $ for extractContent below.
    if (!hasEnoughContent(html) && !ssrData) {
      throw new Error(
        "Tier2 Stealth: conteúdo insuficiente — página precisa de JavaScript para renderizar",
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
      statusCode,
      title: extracted.title,
      description: extracted.description || undefined,
      tier: "stealth",
      durationMs: Date.now() - startTime,
      links: extracted.links.length > 0 ? extracted.links : undefined,
    };

    if (options.getRawHtml) result.rawHtml = html;

    if (formats.includes("markdown")) result.markdown = htmlToMarkdown(extracted.html);
    if (formats.includes("html"))     result.html = extracted.html;
    if (formats.includes("text"))     result.text = extracted.text;
    if (ssrData)                      result.ssrData = ssrData;

    return result;
  }
}
