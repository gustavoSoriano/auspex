// ─── Conversor HTML → Markdown ─────────────────────────────────────────────
// Usa Turndown (CJS) + plugin GFM para tabelas pipe nativas

import TurndownService from "turndown";
import { tables, strikethrough } from "turndown-plugin-gfm";

let _td: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (_td) return _td;

  _td = new TurndownService({
    headingStyle: "atx",       // # Título em vez de sublinhado
    bulletListMarker: "-",
    codeBlockStyle: "fenced",  // ```code``` em vez de indentado
    hr: "---",
    strongDelimiter: "**",
    emDelimiter: "_",
    linkStyle: "inlined",
  });

  // ── Plugin GFM: tabelas pipe e strikethrough ────────────────────────────
  // Converte <table> → | col1 | col2 | em vez de HTML bruto
  _td.use(tables);
  _td.use(strikethrough);

  // ── Regras customizadas ──────────────────────────────────────────────────

  // Remove completamente elementos que não geram conteúdo útil
  // Nota: Turndown.remove() aceita apenas tag names, não CSS selectors
  _td.remove([
    "script",
    "style",
    "noscript",
    "iframe",
    "nav",
    "footer",
    "header",
    "button",
    "form",
  ]);

  // figcaption dentro de figure: remove (evita legenda solta no Markdown)
  _td.addRule("removeFigcaption", {
    filter(node) {
      return (
        node.nodeName === "FIGCAPTION" &&
        node.parentNode?.nodeName === "FIGURE"
      );
    },
    replacement: () => "",
  });

  // Classes de anúncio (.ad, .ads) — Turndown.remove() não aceita CSS selectors
  _td.addRule("removeAds", {
    filter(node) {
      if (node.nodeType !== 1) return false;
      const cls = (node as Element).getAttribute("class") ?? "";
      return /\bad\b|\bads\b/.test(cls);
    },
    replacement: () => "",
  });

  // Imagens: extrai alt text de forma limpa
  _td.addRule("images", {
    filter: "img",
    replacement(_content, node) {
      const img = node as HTMLImageElement;
      const alt = img.getAttribute("alt")?.trim() ?? "";
      const src = img.getAttribute("src") ?? "";
      if (!src) return "";
      return alt ? `![${alt}](${src})` : `![image](${src})`;
    },
  });

  // Links: remove links vazios ou com href #
  _td.addRule("cleanLinks", {
    filter(node) {
      return (
        node.nodeName === "A" &&
        (!node.getAttribute("href") ||
          node.getAttribute("href") === "#" ||
          node.getAttribute("href")?.startsWith("javascript:") === true)
      );
    },
    replacement(content) {
      return content; // Mantém apenas o texto, sem o link
    },
  });

  return _td;
}

/**
 * Converte HTML em Markdown limpo e legível por humanos/LLMs.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";

  const td = getTurndown();
  let markdown = td.turndown(html);

  // ── Limpeza pós-conversão ──────────────────────────────────────────────

  // Remove linhas que são só espaços/pontuação
  markdown = markdown
    .split("\n")
    .filter((line) => line.trim().length > 0 || line === "")
    .join("\n");

  // Colapsa 3+ linhas em branco para no máximo 2
  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  // Remove espaços trailing
  markdown = markdown
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n");

  return markdown.trim();
}
