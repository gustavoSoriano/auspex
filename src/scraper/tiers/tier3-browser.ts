import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  ScrapeOptions,
  ScrapeResult,
  InterceptedAPI,
  ScraperConfig,
} from "../types.js";
import { extractContent } from "../extractors/content.js";
import { htmlToMarkdown } from "../extractors/to-markdown.js";

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

// User-Agent de Chrome real para Windows (OS mais comum = menos suspeito).
// Atualizar a cada 2-3 versões major do Chrome.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// Args que reduzem sinais de automação detectáveis
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-zygote",
  "--disable-gpu",
  "--window-size=1920,1080",
  "--disable-background-networking",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-domain-reliability",
  "--disable-extensions",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-sync",
  "--metrics-recording-only",
  "--safebrowsing-disable-auto-update",
];

// ─── Script de anti-detecção (injetado antes de qualquer JS da página) ────────
//
// Cobre as principais técnicas usadas por anti-bots modernos
// (Cloudflare, DataDome, Akamai, PerimeterX, Shape Security):
//
//  1. navigator.webdriver          → remove o flag mais óbvio
//  2. navigator.plugins            → simula os 3 plugins reais do Chrome
//  3. Propriedades de hardware     → concurrency, memory, maxTouchPoints, vendor, platform
//  4. window.chrome                → objeto completo (runtime, loadTimes, csi, app)
//  5. Notification.permission      → 'default' (headless retorna 'denied')
//  6. Permission API               → 'prompt' para notifications
//  7. Canvas fingerprint           → ruído de 1 bit no toDataURL (quebra fingerprinting)
//  8. WebGL UNMASKED_VENDOR/RENDERER → GPU Intel realista (em vez de llvmpipe/SwiftShader)
//  9. Screen.colorDepth/pixelDepth → 24 bits
// 10. Remoção de artefatos         → remove vars de outras ferramentas (Selenium, PhantomJS)
// ──────────────────────────────────────────────────────────────────────────────
const STEALTH_INIT_SCRIPT = /* language=javascript */ `
(function () {
  // ── 1. Remove a flag mais básica de automação ─────────────────────────
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // ── 2. Plugins realistas de um Chrome normal ──────────────────────────
  // navigator.plugins.length === 0 é o maior red-flag de headless.
  const makeMime = (type, suffixes, desc, plugin) => {
    const mt = Object.create(MimeType.prototype);
    Object.defineProperties(mt, {
      type:          { value: type,     enumerable: true },
      suffixes:      { value: suffixes, enumerable: true },
      description:   { value: desc,     enumerable: true },
      enabledPlugin: { value: plugin,   enumerable: true },
    });
    return mt;
  };

  const makePlugin = (name, desc, filename, mimeSpecs) => {
    const p = Object.create(Plugin.prototype);
    Object.defineProperties(p, {
      name:        { value: name,     enumerable: true },
      description: { value: desc,     enumerable: true },
      filename:    { value: filename, enumerable: true },
      length:      { value: mimeSpecs.length },
    });
    mimeSpecs.forEach((spec, i) => {
      const mt = makeMime(spec.type, spec.suffixes, spec.desc, p);
      Object.defineProperty(p, i,          { value: mt, enumerable: true });
      Object.defineProperty(p, spec.type,  { value: mt });
    });
    p.item      = (i) => p[i] ?? null;
    p.namedItem = (n) => p[n] ?? null;
    return p;
  };

  const pdfViewer = makePlugin(
    'PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer',
    [
      { type: 'application/pdf', suffixes: 'pdf', desc: '' },
      { type: 'text/pdf',        suffixes: 'pdf', desc: '' },
    ],
  );
  const chromePDF = makePlugin(
    'Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
    [{ type: 'application/pdf', suffixes: 'pdf', desc: '' }],
  );
  const nacl = makePlugin(
    'Native Client', '', 'internal-nacl-plugin',
    [
      { type: 'application/x-nacl',  suffixes: '', desc: 'Native Client Executable' },
      { type: 'application/x-pnacl', suffixes: '', desc: 'Portable Native Client Executable' },
    ],
  );

  const pluginList = [pdfViewer, chromePDF, nacl];
  const pa = Object.create(PluginArray.prototype);
  Object.defineProperty(pa, 'length', { value: pluginList.length });
  pluginList.forEach((plug, i) => {
    Object.defineProperty(pa, i,          { value: plug, enumerable: true });
    Object.defineProperty(pa, plug.name,  { value: plug });
  });
  pa.item      = (i) => pluginList[i] ?? null;
  pa.namedItem = (n) => pa[n] ?? null;
  pa.refresh   = () => {};

  Object.defineProperty(navigator, 'plugins', { get: () => pa });

  // ── 3. Propriedades de hardware realistas ─────────────────────────────
  Object.defineProperty(navigator, 'languages',           { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
  Object.defineProperty(navigator, 'maxTouchPoints',      { get: () => 0 });
  Object.defineProperty(navigator, 'vendor',              { get: () => 'Google Inc.' });
  Object.defineProperty(navigator, 'platform',            { get: () => 'Win32' });

  // ── 4. window.chrome — objeto completo como Chrome real ──────────────
  // Automação headless deixa window.chrome undefined ou com .runtime vazio.
  if (!window.chrome) window.chrome = {};

  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      getDetails: () => null,
      getIsInstalled: () => false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }

  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      id: undefined,
      connect:     () => { throw Object.assign(new Error('Could not establish connection.'), { message: 'Could not establish connection. Receiving end does not exist.' }); },
      sendMessage: () => { throw Object.assign(new Error('Could not establish connection.'), { message: 'Could not establish connection. Receiving end does not exist.' }); },
      PlatformOs:   { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    };
  }

  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = () => {
      const now = Date.now() / 1000;
      return {
        requestTime:             now - 1.5 - Math.random() * 0.5,
        startLoadTime:           now - 1.2 - Math.random() * 0.3,
        commitLoadTime:          now - 0.8 - Math.random() * 0.2,
        finishDocumentLoadTime:  now - 0.3 - Math.random() * 0.1,
        finishLoadTime:          now - 0.1 - Math.random() * 0.05,
        firstPaintTime:          now - 0.9 - Math.random() * 0.2,
        firstPaintAfterLoadTime: now - 0.05,
        navigationType:          'Other',
        wasFetchedViaSpdy:       true,
        wasNpnNegotiated:        true,
        npnNegotiatedProtocol:   'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo:          'h2',
      };
    };
  }

  if (!window.chrome.csi) {
    window.chrome.csi = () => ({
      startE:  Date.now() - 1000,
      onloadT: Date.now(),
      pageT:   500 + Math.random() * 1000,
      tran:    15,
    });
  }

  // ── 5. Notification API — headless retorna 'denied', real retorna 'default' ─
  try {
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    }
  } catch (_) {}

  // ── 6. Permission API — 'notifications' deve retornar 'prompt' ────────
  if (navigator.permissions) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
      }
      return origQuery(params);
    };
  }

  // ── 7. Canvas fingerprint — ruído sutil no último byte do dataURL ─────
  // Técnica: altera 1 bit → output diferente em cada run → quebra fingerprinting.
  // Impacto visual: imperceptível (altera apenas o encoding base64 do último pixel).
  const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    const data = _origToDataURL.call(this, type, quality);
    if (data.length < 12) return data;
    const idx = data.length - 2;
    return data.slice(0, idx) + String.fromCharCode(data.charCodeAt(idx) ^ 0x01) + data.slice(idx + 1);
  };

  // ── 8. WebGL — GPU Intel realista em vez de llvmpipe/SwiftShader ─────
  // llvmpipe/SwiftShader = fingerprint de VM detectado por todos os anti-bots.
  const WEBGL_VENDOR   = 'Google Inc. (Intel)';
  const WEBGL_RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';

  const patchWebGL = (Ctx) => {
    if (!Ctx) return;
    const orig = Ctx.prototype.getParameter;
    Ctx.prototype.getParameter = function (param) {
      if (param === 37445) return WEBGL_VENDOR;    // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return WEBGL_RENDERER;  // UNMASKED_RENDERER_WEBGL
      return orig.call(this, param);
    };
  };

  patchWebGL(typeof WebGLRenderingContext  !== 'undefined' ? WebGLRenderingContext  : null);
  patchWebGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext : null);

  // ── 9. Screen depth realista ──────────────────────────────────────────
  try {
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth',  { get: () => 24 });
  } catch (_) {}

  // ── 10. Remove artefatos de outras ferramentas de automação ──────────
  const automationVars = ['__nightmare', '_phantom', 'callPhantom',
    '__selenium_evaluate', '__webdriver_evaluate', '_Selenium_IDE_Recorder',
    '__webdriver_script_fn', '__lastWatirAlert', '__lastWatirConfirm'];
  automationVars.forEach(v => { try { delete window[v]; } catch (_) {} });

})();
`;

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
        const launchOptions: Parameters<typeof chromium.launch>[0] = {
          headless: this.browserConfig.headless ?? true,
          args: STEALTH_ARGS,
        };

        if (this.browserConfig.executablePath) {
          launchOptions.executablePath = this.browserConfig.executablePath;
        } else if (this.browserConfig.channel) {
          launchOptions.channel = this.browserConfig.channel;
        } else {
          try {
            const browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
            this.browser = browser;
            this.browserPromise = null;
            return browser;
          } catch {
            // Chrome not found → use Playwright's bundled Chromium
          }
        }

        const browser = await chromium.launch(launchOptions);
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
