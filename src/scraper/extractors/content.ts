import { load, type CheerioAPI } from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

// ─── Seletores de "ruído" a remover (fallback Cheerio) ────────────────────────

const NOISE_SELECTORS = [
  // Estrutural
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  // Navegação
  "nav",
  "header",
  "footer",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  ".nav",
  ".navbar",
  ".navigation",
  ".menu",
  ".header",
  ".footer",
  ".site-header",
  ".site-footer",
  // Lateral
  "aside",
  ".sidebar",
  ".side-bar",
  "#sidebar",
  '[role="complementary"]',
  // Anúncios e promoções
  ".ad",
  ".ads",
  ".adsbygoogle",
  ".advertisement",
  ".promo",
  ".banner",
  '[id*="google_ads"]',
  '[class*="sponsored"]',
  // Banners legais
  ".cookie-banner",
  ".cookie-notice",
  ".cookie-consent",
  ".gdpr",
  // Overlays
  ".popup",
  ".modal",
  ".overlay",
  ".backdrop",
  // Social e misc
  ".social-share",
  ".share-buttons",
  ".related-posts",
  ".comments",
  "#comments",
  ".comment-section",
  ".newsletter",
  ".subscribe",
] as const;

// ─── Seletores de conteúdo principal (fallback Cheerio) ───────────────────────

const MAIN_CONTENT_SELECTORS = [
  "main",
  "article",
  '[role="main"]',
  "#main-content",
  "#content",
  "#main",
  ".main-content",
  ".content",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".page-content",
  ".blog-post",
  ".blog-content",
  ".post-body",
  ".article-body",
] as const;

// ─── Resultado da extração ─────────────────────────────────────────────────

export interface ExtractedContent {
  html: string;
  text: string;
  title: string;
  description: string;
  links: string[];
}

// ─── Extração de links ─────────────────────────────────────────────────────

function extractLinks($: CheerioAPI, baseUrl?: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("#")) return;
    if (href.startsWith("javascript:")) return;
    if (href.startsWith("mailto:")) return;
    if (href.startsWith("tel:")) return;

    // Tenta resolver URL relativa
    let resolved = href;
    if (baseUrl && (href.startsWith("/") || href.startsWith("."))) {
      try {
        resolved = new URL(href, baseUrl).href;
      } catch {
        return;
      }
    }

    if (!seen.has(resolved)) {
      seen.add(resolved);
      links.push(resolved);
    }
  });

  return links;
}

/** Link com metadados para Map */
export interface LinkWithMetadata {
  url: string;
  title?: string;
}

/**
 * Extrai links da página com texto do âncora (title).
 * Usado pelo map() para descobrir URLs com contexto.
 */
export function extractLinksWithMetadata(
  html: string,
  baseUrl: string,
): LinkWithMetadata[] {
  const $ = load(html);
  const links: LinkWithMetadata[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("#")) return;
    if (href.startsWith("javascript:")) return;
    if (href.startsWith("mailto:")) return;
    if (href.startsWith("tel:")) return;

    let resolved = href;
    if (baseUrl && (href.startsWith("/") || href.startsWith("."))) {
      try {
        resolved = new URL(href, baseUrl).href;
      } catch {
        return;
      }
    }

    if (!seen.has(resolved)) {
      seen.add(resolved);
      const title = ($(el).text().trim() || $(el).attr("title") || "")
        .replace(/\s+/g, " ")
        .slice(0, 200);
      links.push({ url: resolved, title: title || undefined });
    }
  });

  return links;
}

// ─── Extração de metadados ─────────────────────────────────────────────────

function extractMeta($: CheerioAPI): { title: string; description: string } {
  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    "";

  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $('meta[name="twitter:description"]').attr("content")?.trim() ||
    "";

  return { title, description };
}

// ─── Mozilla Readability (caminho principal) ───────────────────────────────────
//
// Mesmo algoritmo que o Firefox usa no Reader Mode.
// Produz conteúdo semanticamente limpo, muito superior a heurísticas manuais.

function extractWithReadability(
  html: string,
  baseUrl?: string,
): { html: string; text: string; title: string } | null {
  try {
    const dom = new JSDOM(html, {
      // URL necessária para Readability resolver links relativos corretamente
      url: baseUrl ?? "https://example.com",
    });

    const reader = new Readability(dom.window.document, {
      // Aceita conteúdo com no mínimo 50 caracteres (padrão é 500)
      charThreshold: 50,
    });

    const article = reader.parse();

    // Rejeita se não produziu conteúdo suficiente
    if (
      !article ||
      !article.content ||
      (article.textContent?.trim()?.length ?? 0) < 100
    ) {
      return null;
    }

    return {
      html: article.content,
      text: (article.textContent ?? "").replace(/\s+/g, " ").trim(),
      title: article.title ?? "",
    };
  } catch {
    // JSDOM ou Readability falharam — aciona fallback Cheerio
    return null;
  }
}

// ─── Cheerio (fallback) ───────────────────────────────────────────────────────

function extractWithCheerio(
  $: CheerioAPI,
  onlyMain: boolean,
): { html: string; text: string } {
  // Remove ruído
  NOISE_SELECTORS.forEach((selector) => {
    try {
      $(selector).remove();
    } catch {
      // Seletor inválido no contexto — ignora
    }
  });

  // Inicia com body como padrão seguro
  let contentEl: ReturnType<typeof $> = $("body");

  if (onlyMain) {
    // Tenta encontrar área de conteúdo principal
    for (const selector of MAIN_CONTENT_SELECTORS) {
      const el = $(selector);
      if (el.length > 0) {
        const text = el.first().text().replace(/\s+/g, " ").trim();
        if (text.length > 150) {
          contentEl = el.first();
          break;
        }
      }
    }
  }

  // Limpa atributos de rastreamento e estilos inline
  contentEl.find("[style]").removeAttr("style");
  contentEl.find("[onclick]").removeAttr("onclick");
  contentEl.find("[class]").each((_, el) => {
    $(el).removeAttr("class");
  });

  const contentHtml = contentEl.html() ?? "";
  const text = contentEl.text().replace(/\s+/g, " ").trim();

  return { html: contentHtml, text };
}

// ─── Extração principal ────────────────────────────────────────────────────────

/**
 * Extrai o conteúdo significativo de um HTML.
 *
 * Estratégia em dois níveis:
 *  1. Mozilla Readability — mesmo algoritmo do Firefox Reader Mode.
 *     Produz conteúdo muito mais limpo e semântico que heurísticas manuais.
 *  2. Cheerio + seletores heurísticos — fallback quando Readability falha
 *     (ex: páginas muito simples ou layouts não-convencionais).
 *
 * @param html     - HTML completo da página
 * @param onlyMain - Tentar extrair apenas o conteúdo principal
 * @param baseUrl  - URL base para resolver links e contextualizar o Readability
 */
export function extractContent(
  html: string,
  onlyMain = true,
  baseUrl?: string,
): ExtractedContent {
  const $ = load(html);

  // Extrai metadados e links ANTES de remover elementos de navegação
  const { title, description } = extractMeta($);
  const links = extractLinks($, baseUrl);

  // ── Caminho 1: Mozilla Readability ────────────────────────────────────────
  if (onlyMain) {
    const readable = extractWithReadability(html, baseUrl);
    if (readable) {
      return {
        html: readable.html,
        text: readable.text,
        // Título do Readability é mais preciso (remove sufixos de site)
        title: readable.title || title,
        description,
        links,
      };
    }
  }

  // ── Caminho 2: Cheerio (fallback) ─────────────────────────────────────────
  const cheerio = extractWithCheerio($, onlyMain);
  return {
    html: cheerio.html,
    text: cheerio.text,
    title,
    description,
    links,
  };
}
