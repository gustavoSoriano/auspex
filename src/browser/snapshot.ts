import type { Page } from "playwright-core";
import * as cheerio from "cheerio";
import type { PageSnapshot, SnapshotLink, SnapshotForm, SnapshotInput } from "../types.js";

// ─── Limites do snapshot (calibrados para economizar tokens) ──────────────────
const TEXT_LIMIT   = 3_500; // chars de texto da página enviados ao LLM
const LINKS_LIMIT  = 25;    // máximo de links por snapshot
const FORMS_LIMIT  = 5;     // máximo de forms por snapshot
const INPUTS_LIMIT = 10;    // máximo de inputs por form

// ─── Filtro de links ruído ────────────────────────────────────────────────────
//
// Descarta links que não ajudam o LLM a navegar:
//   - domínios de redes sociais / ícones de compartilhamento
//   - links de assets (imagens, fontes, CSS, JS)
//   - âncoras vazias, javascript: e mailto:
//   - links sem texto visível
//
const NOISE_HOSTS = new Set([
  "twitter.com", "x.com", "facebook.com", "instagram.com",
  "linkedin.com", "youtube.com", "tiktok.com",
  "t.me", "wa.me", "discord.gg", "github.com",
]);
const NOISE_EXTENSIONS = /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|pdf)(\?.*)?$/i;

function isNoiseLink(href: string, text: string): boolean {
  if (!href || href === "#" || href.startsWith("javascript:") ||
      href.startsWith("mailto:") || href.startsWith("tel:")) return true;
  if (NOISE_EXTENSIONS.test(href)) return true;
  if (!text.trim()) return true; // sem texto visível → irrelevante pro LLM
  try {
    const { hostname } = new URL(href);
    if (NOISE_HOSTS.has(hostname.replace(/^www\./, ""))) return true;
  } catch { /* URL relativa ou inválida — mantém */ }
  return false;
}

// ─── Snapshot via Playwright (página renderizada com JS) ─────────────────────

export async function takeSnapshot(page: Page): Promise<PageSnapshot> {
  const url   = page.url();
  const title = await page.title();

  const text = await page.evaluate((limit) => {
    return document.body?.innerText?.slice(0, limit) ?? "";
  }, TEXT_LIMIT);

  const rawLinks: SnapshotLink[] = await page.evaluate((limit) => {
    return Array.from(document.querySelectorAll("a[href]"))
      .slice(0, limit * 3) // coleta mais para filtrar depois no Node.js
      .map((el, i) => ({
        text: (el as HTMLAnchorElement).innerText.trim().slice(0, 80),
        href: (el as HTMLAnchorElement).href,
        index: i,
      }));
  }, LINKS_LIMIT);

  const links = rawLinks
    .filter(l => !isNoiseLink(l.href, l.text))
    .slice(0, LINKS_LIMIT)
    .map((l, i) => ({ ...l, index: i }));

  const forms: SnapshotForm[] = await page.evaluate((limits) => {
    return Array.from(document.querySelectorAll("form")).slice(0, limits.forms).map((form) => ({
      action: form.action,
      inputs: Array.from(form.querySelectorAll("input, textarea, select"))
        .slice(0, limits.inputs)
        .map((el) => {
          const input = el as HTMLInputElement;
          const id       = input.id   ? `#${input.id}`            : "";
          const name     = input.name ? `[name="${input.name}"]`   : "";
          const tag      = el.tagName.toLowerCase();
          const selector = id || (name ? `${tag}${name}` : tag);
          return { name: input.name || input.id || "", type: input.type || tag, placeholder: input.placeholder || "", selector };
        }),
    }));
  }, { forms: FORMS_LIMIT, inputs: INPUTS_LIMIT });

  return { url, title, text, links, forms };
}

// ─── Snapshot via Cheerio (HTML estático, sem browser) ───────────────────────

export function snapshotFromHtml(html: string, url: string): PageSnapshot {
  const $ = cheerio.load(html);
  const title = $("title").text().trim();

  $("script, style, noscript").remove();
  const text = ($("body").text() ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);

  const links: SnapshotLink[] = [];
  let linkIndex = 0;
  $("a[href]").each((_, el) => {
    if (links.length >= LINKS_LIMIT) return false; // break
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim().slice(0, 80);
    let absoluteHref = href;
    try {
      absoluteHref = href.startsWith("http") ? href : new URL(href, url).href;
    } catch { /* href relativo inválido */ }
    if (!isNoiseLink(absoluteHref, text)) {
      links.push({ text, href: absoluteHref, index: linkIndex++ });
    }
  });

  const forms: SnapshotForm[] = [];
  $("form").slice(0, FORMS_LIMIT).each((_, formEl) => {
    const action = $(formEl).attr("action") ?? "";
    const inputs: SnapshotInput[] = [];
    $(formEl).find("input, textarea, select").slice(0, INPUTS_LIMIT).each((_, inputEl) => {
      const id    = $(inputEl).attr("id")   ? `#${$(inputEl).attr("id")}`           : "";
      const name  = $(inputEl).attr("name") ? `[name="${$(inputEl).attr("name")}"]` : "";
      const tag   = ("name" in inputEl ? (inputEl as { name: string }).name : "input").toLowerCase();
      const selector = id || (name ? `${tag}${name}` : tag);
      inputs.push({
        name:        $(inputEl).attr("name") || $(inputEl).attr("id") || "",
        type:        $(inputEl).attr("type") || tag,
        placeholder: $(inputEl).attr("placeholder") || "",
        selector,
      });
    });
    forms.push({ action, inputs });
  });

  return { url, title, text, links, forms };
}

// ─── Formata snapshot para envio ao LLM ──────────────────────────────────────

export function formatSnapshot(snapshot: PageSnapshot): string {
  const lines: string[] = [
    `## Current Page`,
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    "",
    `### Page Text`,
    snapshot.text, // já truncado em TEXT_LIMIT no momento da coleta
    "",
  ];

  if (snapshot.links.length > 0) {
    lines.push(`### Links (${snapshot.links.length})`);
    for (const link of snapshot.links) {
      lines.push(`[${link.index}] "${link.text}" -> ${link.href}`);
    }
    lines.push("");
  }

  if (snapshot.forms.length > 0) {
    lines.push(`### Forms (${snapshot.forms.length})`);
    for (const form of snapshot.forms) {
      lines.push(`Form action: ${form.action}`);
      for (const input of form.inputs) {
        lines.push(`  - ${input.type} name="${input.name}" placeholder="${input.placeholder}" selector="${input.selector}"`);
      }
    }
  }

  return lines.join("\n");
}
