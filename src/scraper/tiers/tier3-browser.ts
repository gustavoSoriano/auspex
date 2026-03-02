import { type Browser, type BrowserContext } from "playwright";
import type {
  ScrapeOptions,
  ScrapeResult,
  InterceptedAPI,
  ScraperConfig,
} from "../types.js";
import { extractContent } from "../extractors/content.js";
import { htmlToMarkdown } from "../extractors/to-markdown.js";
import { launchStealthBrowser, STEALTH_INIT_SCRIPT, CHROME_UA } from "../../browser/stealth.js";

// ─── Tier 3: Playwright Chromium (fallback final) ──────────────────────────
//
// Acionado quando Tier 1 (HTTP) e Tier 2 (Stealth HTTP) falham.
// Casos típicos: SPAs complexas, anti-bot pesado (Cloudflare, Akamai, etc.).
//
// Estratégias aplicadas:
//   1. Stealth scripts injetados antes de qualquer script da página
//   2. Interceptar chamadas de API JSON (melhor para SPAs — dados diretos)
//   3. Bloquear recursos desnecessários (fonts, media, analytics)
//   4. Aguardar networkidle ou seletor específico
//   5. Extrair DOM completo e converter para Markdown
// ──────────────────────────────────────────────────────────────────────────

// Note: CHROME_UA and STEALTH_INIT_SCRIPT are imported from the shared stealth module.

// Recursos que bloqueamos para economizar banda/tempo.
// "image" incluído: extraímos texto/markdown, não renderizamos visualmente.
const BLOCKED_RESOURCE_TYPES = new Set(["font", "media", "image"]);

// Padrões de analytics/rastreamento a bloquear
const BLOCKED_URL_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net/en_US/fbevents.js",
  "connect.facebook.net",
  "hotjar.com",
  "fullstory.com",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "sentry.io",
  "clarity.ms",
  "doubleclick.net",
  "adnxs.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
];

export class Tier3Browser {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private readonly browserConfig: NonNullable<ScraperConfig["browserConfig"]>;

  constructor(browserConfig: ScraperConfig["browserConfig"] = {}) {
    this.browserConfig = browserConfig;
  }

  // ── Lifecycle do browser (singleton with mutex) ────────────────────────

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        const launchOptions = {
          headless: this.browserConfig.headless ?? true,
          ...(this.browserConfig.executablePath && { executablePath: this.browserConfig.executablePath }),
          ...(this.browserConfig.channel && { channel: this.browserConfig.channel }),
        };

        const browser = await launchStealthBrowser(launchOptions);
        this.browser = browser;
        this.browserPromise = null;
        return browser;
      })();
    }

    return this.browserPromise;
  }

  // ── Scraping principal ─────────────────────────────────────────────────

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const startTime = Date.now();
    const browser = await this.getBrowser();

    let context: BrowserContext | null = null;

    try {
      context = await browser.newContext({
        userAgent: CHROME_UA,
        viewport: { width: 1920, height: 1080 },
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        extraHTTPHeaders: {
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          ...(options.headers ?? {}),
        },
        javaScriptEnabled: true,
        // Desabilita WebRTC para evitar vazamento de IP real em ambientes com proxy
        // (equivalente a --disable-webrtc nos args, mas via context)
      });

      const page = await context.newPage();

      // ── Injetar stealth script ANTES de qualquer script da página ─────
      await page.addInitScript(STEALTH_INIT_SCRIPT);

      // ── Bloquear recursos desnecessários ──────────────────────────────
      await page.route("**/*", (route) => {
        const req = route.request();
        const type = req.resourceType();
        const reqUrl = req.url();

        if (BLOCKED_RESOURCE_TYPES.has(type)) {
          return route.abort();
        }
        if (
          type === "script" &&
          BLOCKED_URL_PATTERNS.some((p) => reqUrl.includes(p))
        ) {
          return route.abort();
        }

        return route.continue();
      });

      // ── Interceptação de APIs JSON (fundamental para SPAs) ────────────
      const interceptedAPIs: InterceptedAPI[] = [];
      const shouldIntercept = options.interceptAPIs !== false;

      if (shouldIntercept) {
        page.on("response", async (response) => {
          try {
            const contentType = response.headers()["content-type"] ?? "";
            if (!contentType.includes("application/json")) return;

            const apiUrl = response.url();
            // Ignora analytics e recursos JS/CSS
            if (BLOCKED_URL_PATTERNS.some((p) => apiUrl.includes(p))) return;
            if (/\.(js|css|png|jpg|gif|svg|woff)/.test(apiUrl)) return;

            // Ignora respostas muito grandes (provavelmente não são dados da view)
            const contentLength = parseInt(
              response.headers()["content-length"] ?? "0",
              10,
            );
            if (contentLength > 500_000) return;

            const data = await response.json().catch(() => null);
            if (!data) return;

            interceptedAPIs.push({
              url: apiUrl,
              method: response.request().method(),
              statusCode: response.status(),
              contentType,
              data,
            });
          } catch {
            // Resposta já consumida ou parse inválido — ignora silenciosamente
          }
        });
      }

      // Auto-dismiss dialogs (alert/confirm/prompt) para não travar a navegação
      page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

      // ── Navegação com retry ────────────────────────────────────────────
      // Em sites com anti-bot, a 1ª tentativa pode receber um challenge (403/503).
      // A 2ª tentativa (com cookies/state acumulados) frequentemente passa.
      const timeout = options.timeout ?? 30_000;
      let statusCode = 200;
      let lastNavError: Error | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const navResponse = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: Math.min(timeout, 30_000),
          });
          statusCode = navResponse?.status() ?? 200;
          lastNavError = null;
          break; // Sucesso — sai do loop
        } catch (navErr) {
          lastNavError = navErr instanceof Error ? navErr : new Error(String(navErr));
          if (attempt < 2) {
            await page.waitForTimeout(1_500).catch(() => {});
          }
        }
      }

      if (lastNavError) {
        throw new Error(`Tier3 Browser: falha na navegação — ${lastNavError.message}`);
      }

      // ── Aguardar conteúdo dinâmico ────────────────────────────────────
      // networkidle sinaliza que a SPA terminou de carregar
      await page
        .waitForLoadState("networkidle", {
          timeout: Math.min(timeout * 0.5, 15_000),
        })
        .catch(() => {
          // Timeout é aceitável — prosseguimos com o que tiver
        });

      // Seletor específico do usuário (ex: '.product-list', '#app')
      if (options.waitForSelector) {
        await page
          .waitForSelector(options.waitForSelector, {
            state: "visible",
            timeout: 10_000,
          })
          .catch(() => {
            // Seletor não apareceu — prosseguimos assim mesmo
          });
      }

      // ── Scroll para ativar lazy-loading ───────────────────────────────
      // Muitos sites usam IntersectionObserver para carregar conteúdo apenas
      // quando o usuário rola até ele. Varrer a página simula esse comportamento
      // e garante que todo o conteúdo seja carregado antes da extração.
      await page
        .evaluate(() => {
          return new Promise<void>((resolve) => {
            const totalHeight = document.body.scrollHeight;
            if (totalHeight <= window.innerHeight) {
              resolve();
              return;
            }

            const step = Math.max(Math.floor(totalHeight / 6), 300);
            let scrolled = 0;

            const tick = () => {
              scrolled += step;
              window.scrollTo({ top: scrolled, behavior: "smooth" });
              if (scrolled < totalHeight) {
                // Intervalo variado simula comportamento humano e dá tempo ao
                // IntersectionObserver disparar e buscar conteúdo novo
                setTimeout(tick, 120 + Math.floor(Math.random() * 130));
              } else {
                window.scrollTo({ top: 0, behavior: "instant" });
                resolve();
              }
            };

            setTimeout(tick, 400);
          });
        })
        .catch(() => {
          // Scroll falhou (página sem body ou JS bloqueado) — ignora
        });

      // ── Extração de conteúdo ──────────────────────────────────────────
      const [html, pageTitle] = await Promise.all([
        page.content(),
        page.title(),
      ]);

      const finalUrl = page.url();
      const formats = options.formats ?? ["markdown", "text"];
      const extracted = extractContent(
        html,
        options.onlyMainContent ?? true,
        finalUrl,
      );

      const result: ScrapeResult = {
        url: finalUrl,
        statusCode,
        title: pageTitle || extracted.title,
        description: extracted.description || undefined,
        tier: "browser",
        durationMs: Date.now() - startTime,
        links: extracted.links.length > 0 ? extracted.links : undefined,
        interceptedAPIs:
          interceptedAPIs.length > 0 ? interceptedAPIs : undefined,
      };

      if (options.getRawHtml) result.rawHtml = html;

      if (formats.includes("markdown")) result.markdown = htmlToMarkdown(extracted.html);
      if (formats.includes("html"))     result.html = extracted.html;
      if (formats.includes("text"))     result.text = extracted.text;

      return result;
    } finally {
      await context?.close().catch(() => {});
    }
  }

  // ── Encerrar browser ───────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
