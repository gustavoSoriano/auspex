import type { Page } from "playwright-core";
import * as cheerio from "cheerio";
import type { PageSnapshot, SnapshotLink, SnapshotForm, SnapshotInput } from "../types.js";

// ─── Snapshot limits (calibrated to save tokens) ─────────────────────────────
const TEXT_LIMIT   = 3_500; // chars of page text sent to LLM
const LINKS_LIMIT  = 25;    // max links per snapshot
const FORMS_LIMIT  = 5;     // max forms per snapshot
const INPUTS_LIMIT = 10;    // max inputs per form
const A11Y_LIMIT   = 3_000; // chars of accessibility tree YAML

// ─── Noise link filter ───────────────────────────────────────────────────────
const NOISE_HOSTS = new Set([
  "twitter.com", "x.com", "facebook.com", "instagram.com",
  "linkedin.com", "youtube.com", "tiktok.com",
  "t.me", "wa.me", "discord.gg", "github.com",
]);
const NOISE_EXTENSIONS = /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot)(\?.*)?$/i;

function isNoiseLink(href: string, text: string): boolean {
  if (!href || href === "#" || href.startsWith("javascript:") ||
      href.startsWith("mailto:") || href.startsWith("tel:")) return true;
  if (NOISE_EXTENSIONS.test(href)) return true;
  if (!text.trim()) return true;
  try {
    const { hostname } = new URL(href);
    if (NOISE_HOSTS.has(hostname.replace(/^www\./, ""))) return true;
  } catch { /* relative or invalid URL — keep */ }
  return false;
}

// ─── Snapshot via Playwright (rendered page with JS) ─────────────────────────

type RawSnapshotData = {
  text: string;
  rawLinks: { text: string; href: string; index: number }[];
  forms: { action: string; inputs: { name: string; type: string; placeholder: string; selector: string }[] }[];
};

const EVALUATE_LIMITS = { textLimit: TEXT_LIMIT, linksLimit: LINKS_LIMIT, formsLimit: FORMS_LIMIT, inputsLimit: INPUTS_LIMIT };

function evaluatePageData(page: Page): Promise<RawSnapshotData> {
  return page.evaluate((limits) => {
    const text = document.body?.innerText?.slice(0, limits.textLimit) ?? "";

    const rawLinks = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, limits.linksLimit * 3)
      .map((el, i) => ({
        text: (el as HTMLAnchorElement).innerText.trim().slice(0, 80),
        href: (el as HTMLAnchorElement).href,
        index: i,
      }));

    const forms = Array.from(document.querySelectorAll("form"))
      .slice(0, limits.formsLimit)
      .map((form) => ({
        action: form.action,
        inputs: Array.from(form.querySelectorAll("input, textarea, select"))
          .slice(0, limits.inputsLimit)
          .map((el) => {
            const input = el as HTMLInputElement;
            const id       = input.id   ? `#${input.id}`            : "";
            const name     = input.name ? `[name="${input.name}"]`   : "";
            const tag      = el.tagName.toLowerCase();
            const selector = id || (name ? `${tag}${name}` : tag);
            return {
              name: input.name || input.id || "",
              type: input.type || tag,
              placeholder: input.placeholder || "",
              selector,
            };
          }),
      }));

    return { text, rawLinks, forms };
  }, EVALUATE_LIMITS);
}

export async function takeSnapshot(page: Page): Promise<PageSnapshot> {
  const url   = page.url();
  const title = await page.title().catch(() => url);

  // Retry once if the execution context is destroyed by a mid-navigation
  let data: RawSnapshotData;
  try {
    data = await evaluatePageData(page);
  } catch {
    // Context was destroyed — wait for the new page to settle, then retry
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    try {
      data = await evaluatePageData(page);
    } catch {
      // Still failing — return a minimal snapshot so the loop can continue
      return { url: page.url(), title: page.url(), text: "", links: [], forms: [] };
    }
  }

  const links = data.rawLinks
    .filter(l => !isNoiseLink(l.href, l.text))
    .slice(0, LINKS_LIMIT)
    .map((l, i) => ({ ...l, index: i }));

  // Capture accessibility tree (non-fatal)
  let ariaTree: string | undefined;
  try {
    const yaml = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
    if (yaml) ariaTree = yaml.slice(0, A11Y_LIMIT);
  } catch { /* page in transition or not supported — skip */ }

  return { url, title, text: data.text, links, forms: data.forms, ariaTree };
}

// ─── Snapshot via Cheerio (static HTML, no browser) ──────────────────────────

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
    // Pre-filter raw href before URL resolution (# becomes full URL otherwise)
    if (!href || href === "#" || href.startsWith("javascript:") ||
        href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const linkText = $(el).text().trim().slice(0, 80);
    let absoluteHref = href;
    try {
      absoluteHref = href.startsWith("http") ? href : new URL(href, url).href;
    } catch { /* invalid relative href */ }
    if (!isNoiseLink(absoluteHref, linkText)) {
      links.push({ text: linkText, href: absoluteHref, index: linkIndex++ });
    }
  });

  const forms: SnapshotForm[] = [];
  $("form").slice(0, FORMS_LIMIT).each((_, formEl) => {
    const action = $(formEl).attr("action") ?? "";
    const inputs: SnapshotInput[] = [];
    $(formEl).find("input, textarea, select").slice(0, INPUTS_LIMIT).each((_, inputEl) => {
      const id    = $(inputEl).attr("id")   ? `#${$(inputEl).attr("id")}`           : "";
      const name  = $(inputEl).attr("name") ? `[name="${$(inputEl).attr("name")}"]` : "";
      // cheerio AnyNode: use type guard for Element which has tagName
      const node = inputEl as { tagName?: string };
      const tag  = node.tagName ?? "input";
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

// ─── Screenshot capture (vision mode) ────────────────────────────────────────

export async function captureScreenshot(page: Page, quality: number): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality });
  return buffer.toString("base64");
}

// ─── Format snapshot for LLM ─────────────────────────────────────────────────

const MAX_URL_LEN = 150;

function truncUrl(url: string): string {
  if (url.length <= MAX_URL_LEN) return url;
  try {
    const u = new URL(url);
    const base = `${u.origin}${u.pathname}`;
    if (base.length <= MAX_URL_LEN) return u.search ? `${base}?...` : base;
    return base.slice(0, MAX_URL_LEN) + "...";
  } catch {
    return url.slice(0, MAX_URL_LEN) + "...";
  }
}

export function formatSnapshot(snapshot: PageSnapshot): string {
  const lines: string[] = [
    `## Current Page`,
    `URL: ${truncUrl(snapshot.url)}`,
    `Title: ${snapshot.title.slice(0, 200)}`,
    "",
    `### Page Text`,
    snapshot.text,
    "",
  ];

  if (snapshot.links.length > 0) {
    lines.push(`### Links (${snapshot.links.length})`);
    for (const link of snapshot.links) {
      lines.push(`[${link.index}] "${link.text}" -> ${truncUrl(link.href)}`);
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
    lines.push("");
  }

  if (snapshot.ariaTree) {
    lines.push(`### Accessibility Tree`);
    lines.push(snapshot.ariaTree);
    lines.push("");
  }

  return lines.join("\n");
}
