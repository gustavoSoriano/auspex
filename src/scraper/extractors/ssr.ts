import { load, type CheerioAPI } from "cheerio";
import type { SSRData } from "../types.js";

// ─── Detectores de dados SSR ───────────────────────────────────────────────
//
// Frameworks modernos embutem dados no HTML inicial para hidratação no cliente.
// Extrair esses dados evita a necessidade de browser em ~60-70% dos sites.
//
// Ordem: do mais específico para o mais genérico.
// ──────────────────────────────────────────────────────────────────────────

/** Tenta parsear JSON com segurança; retorna null em caso de erro */
function tryParse(raw: string): unknown | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Tenta extrair dados JSON embutidos por frameworks SSR no HTML inicial.
 * Muitos sites Next.js/Nuxt/SvelteKit não precisam de browser —
 * os dados já estão no HTML e podem ser extraídos com Cheerio!
 */
export function extractSSRData(html: string, existing$?: CheerioAPI): SSRData | null {
  const $ = existing$ ?? load(html);

  // ── Next.js: <script id="__NEXT_DATA__" type="application/json"> ──────
  const nextRaw = $("#__NEXT_DATA__").text().trim();
  const nextData = tryParse(nextRaw);
  if (nextData) return { type: "next", data: nextData };

  // ── Angular Universal: <script id="ng-state" type="application/json"> ─
  const ngRaw = $('script#ng-state[type="application/json"]').text().trim();
  const ngData = tryParse(ngRaw);
  if (ngData) return { type: "angular", data: ngData };

  // ── SvelteKit: <script type="application/json" data-sveltekit-fetched> ─
  // SvelteKit 2+ serializa dados de `load()` em tags script com atributo especial
  const svelteFetchedRaw = $('script[data-sveltekit-fetched]').text().trim();
  const svelteFetchedData = tryParse(svelteFetchedRaw);
  if (svelteFetchedData) return { type: "sveltekit", data: svelteFetchedData };

  // ── Nuxt 2/3: window.__NUXT__ = ... ──────────────────────────────────
  // Nuxt pode usar JSON ou devalue (formato não-JSON proprietário do Nuxt 3)
  // Tentamos capturar JSON puro; devalue é ignorado (precisa de browser)
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (nuxtMatch?.[1]) {
    const nuxtData = tryParse(nuxtMatch[1]);
    if (nuxtData) return { type: "nuxt", data: nuxtData };
  }

  // ── Nuxt 3 alternativo: useNuxtApp / nuxtState ────────────────────────
  const nuxt3Match = html.match(/window\.__nuxt_state__\s*=\s*'([^']+)'/);
  if (nuxt3Match?.[1]) {
    try {
      const decoded = decodeURIComponent(nuxt3Match[1]);
      const nuxt3Data = tryParse(decoded);
      if (nuxt3Data) return { type: "nuxt", data: nuxt3Data };
    } catch {}
  }

  // ── Gatsby: window.___gatsby ou window.___GATSBY ──────────────────────
  const gatsbyMatch = html.match(
    /window\.___(?:gatsby|GATSBY)\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (gatsbyMatch?.[1]) {
    const gatsbyData = tryParse(gatsbyMatch[1]);
    if (gatsbyData) return { type: "gatsby", data: gatsbyData };
  }

  // ── Remix / React Router v7: window.__remixContext ────────────────────
  const remixMatch = html.match(
    /window\.__remix(?:Context|RouterManifest)\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (remixMatch?.[1]) {
    const remixData = tryParse(remixMatch[1]);
    if (remixData) return { type: "remix", data: remixData };
  }

  // ── TanStack Router / Start: window.__TSR_DEHYDRATED__ ───────────────
  const tanstackMatch = html.match(
    /window\.__(?:TSR_DEHYDRATED|TANSTACK_ROUTER_CONTEXT|TRT_DEHYDRATED)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (tanstackMatch?.[1]) {
    const tsrData = tryParse(tanstackMatch[1]);
    if (tsrData) return { type: "tanstack", data: tsrData };
  }

  // ── Vue SSR: window.__VUE_SSR_CONTEXT__ / window.__pinia ─────────────
  const vueMatch = html.match(
    /window\.__(?:VUE_SSR_CONTEXT__|VUE_STORE__|pinia)\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (vueMatch?.[1]) {
    const vueData = tryParse(vueMatch[1]);
    if (vueData) return { type: "vue", data: vueData };
  }

  // ── SvelteKit legado: window.__SVELTEKIT__ ────────────────────────────
  const svelteLegacyMatch = html.match(
    /window\.__(?:SVELTEKIT|sveltekit)__?\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (svelteLegacyMatch?.[1]) {
    const svelteData = tryParse(svelteLegacyMatch[1]);
    if (svelteData) return { type: "sveltekit", data: svelteData };
  }

  // ── Genérico: window.__INITIAL_STATE__ / __APP_STATE__ / __REDUX_STATE__ ─
  // Cobre Redux, MobX, Zustand e qualquer store serializado manualmente
  const genericMatch = html.match(
    /window\.__(?:INITIAL_STATE|APP_STATE|REDUX_STATE|STORE_STATE|DATA|STATE|PROPS)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (genericMatch?.[1]) {
    const genericData = tryParse(genericMatch[1]);
    if (genericData) return { type: "generic", data: genericData };
  }

  return null;
}

/**
 * Verifica se a página tem conteúdo suficiente sem JavaScript.
 *
 * Retorna `false` quando:
 *  - O texto visível é muito curto (< 200 chars) → SPA ainda não renderizou
 *  - Detecta padrões de anti-bot / challenge pages (Cloudflare, DDoS-Guard, etc.)
 *  - Detecta loading screens (texto de JS habilitado, spinners, etc.)
 */
export function hasEnoughContent(html: string, existing$?: CheerioAPI): boolean {
  const $ = existing$ ?? load(html);

  // Remove elementos que não geram conteúdo legível
  $("script, style, noscript, iframe, svg, img").remove();

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  // Heurística básica: texto muito curto = SPA sem SSR ou página vazia
  if (bodyText.length < 200) return false;

  // ── Padrões de anti-bot / challenge pages ────────────────────────────
  // Cada serviço tem uma frase característica que aparece quando bloqueia o bot.
  const antiBotPatterns: RegExp[] = [
    // Cloudflare (mais comum)
    /just a moment/i,
    /checking your browser/i,
    /ddos protection by cloudflare/i,
    /ray id:/i,                             // ID único do Cloudflare

    // DDoS-Guard
    /ddos-guard/i,

    // Imperva / Incapsula
    /incapsula incident id/i,
    /powered by imperva/i,

    // DataDome
    /datadome/i,

    // hCaptcha / reCAPTCHA challenges
    /complete the security check/i,
    /prove you are human/i,
    /please complete the captcha/i,

    // Loading screens / SPA shell genérica
    /please wait/i,
    /enable javascript/i,
    /you need to enable javascript/i,
    /javascript is required/i,
    /javascript is disabled/i,
    /please enable javascript/i,

    // Genérico
    /access denied/i,
    /403 forbidden/i,
    /bot detected/i,
  ];

  const lowerText = bodyText.toLowerCase();
  const isAntiBot = antiBotPatterns.some((p) => p.test(lowerText));

  // Challenge pages tem pouco texto e padrões identificáveis
  if (isAntiBot && bodyText.length < 2_000) return false;

  return true;
}
