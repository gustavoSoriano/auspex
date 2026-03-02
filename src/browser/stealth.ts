import playwrightExtra from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, LaunchOptions } from "playwright";

// ─── playwright-extra + stealth plugin setup ──────────────────────────────────
//
// Applies ~14 evasion modules from puppeteer-extra-plugin-stealth:
//   - chrome.app / chrome.csi / chrome.loadTimes / chrome.runtime
//   - iframe.contentWindow (iframes expose the real window.webdriver)
//   - media.codecs (audio/video codec fingerprinting)
//   - navigator.hardwareConcurrency / languages / permissions / plugins / vendor / webdriver
//   - sourceurl (hides automation source in stack traces)
//   - user-agent-override (consistent UA across requests)
//   - webgl.vendor (masks llvmpipe/SwiftShader GPU string)
//   - window.outerdimensions (fixes 0x0 outerWidth/outerHeight in headless)
//
// Combined with STEALTH_INIT_SCRIPT below (extra patches not covered by the plugin),
// this achieves maximum anti-bot evasion for the Playwright tier.
// ─────────────────────────────────────────────────────────────────────────────

const { chromium: extraChromium } = playwrightExtra as unknown as {
  chromium: {
    use: (plugin: unknown) => void;
    launch: (options?: LaunchOptions) => Promise<Browser>;
  };
};

try {
  extraChromium.use(StealthPlugin());
} catch (err) {
  // Should never happen — StealthPlugin() is a pure constructor with no side effects.
  // Guard against future plugin version issues without crashing the whole process.
  console.error("[auspex/stealth] Failed to register stealth plugin:", err);
}

// ─── Chrome launch args to reduce automation signals ─────────────────────────
//
// Note: --disable-gpu is intentionally OMITTED — it prevents WebGL context
// creation entirely, which is a strong bot signal. Instead, we use
// --use-gl=swiftshader to allow WebGL via software rasterization while our
// STEALTH_INIT_SCRIPT overrides the vendor/renderer strings to look like
// a real Intel GPU (not SwiftShader).
export const STEALTH_ARGS: string[] = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--no-zygote",
  "--use-gl=swiftshader",
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

// ─── Chrome User-Agent (Windows — most common OS = less suspicious) ───────────
export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// ─── Comprehensive stealth init script ───────────────────────────────────────
//
// Injetado via context.addInitScript() ANTES de qualquer script da página.
// Cobre os principais sinais de detecção usados por Cloudflare, DataDome,
// Akamai, PerimeterX e Shape Security.
//
// Complementa o playwright-extra stealth plugin com patches adicionais:
//   - navigator.deviceMemory (plugin não cobre)
//   - navigator.maxTouchPoints
//   - navigator.platform
//   - Notification.permission (headless retorna 'denied')
//   - Canvas fingerprint noise (quebra fingerprinting determinístico)
//   - window.chrome completo com loadTimes/csi com valores randomizados
//   - Remoção de artefatos de outras ferramentas (Selenium, PhantomJS, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export const STEALTH_INIT_SCRIPT = /* language=javascript */ `
(function () {
  // ── 1. navigator.webdriver ────────────────────────────────────────────
  // NOTE: We intentionally do NOT redefine navigator.webdriver here.
  // The playwright-extra stealth plugin runs a dedicated evasion that
  // deletes the property from the prototype entirely, which is more
  // effective than redefining it.  If we redefine it after the plugin
  // deleted it, we'd add it back as an own property and sannysoft's
  // "WebDriver (New)" check would detect it as "present".
  //
  // The plugin handles: webdriver, plugins, languages, hardwareConcurrency,
  // vendor, permissions, WebGL, window.chrome, iframe.contentWindow,
  // media.codecs, user-agent, window.outerdimensions.
  //
  // This script provides EXTRA patches the plugin does NOT cover:
  //   - navigator.deviceMemory
  //   - navigator.maxTouchPoints
  //   - navigator.platform (plugin sets vendor but not platform)
  //   - Notification.permission
  //   - Canvas fingerprint noise (deterministic fingerprinting prevention)
  //   - window.chrome.loadTimes/csi with randomised timing values
  //   - Screen colorDepth/pixelDepth
  //   - Removal of automation artefacts from other tools

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
  const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    const data = _origToDataURL.call(this, type, quality);
    if (data.length < 12) return data;
    const idx = data.length - 2;
    return data.slice(0, idx) + String.fromCharCode(data.charCodeAt(idx) ^ 0x01) + data.slice(idx + 1);
  };

  // ── 8. WebGL — GPU Intel realista em vez de llvmpipe/SwiftShader ─────
  const WEBGL_VENDOR   = 'Google Inc. (Intel)';
  const WEBGL_RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';

  const patchWebGL = (Ctx) => {
    if (!Ctx) return;
    const orig = Ctx.prototype.getParameter;
    Ctx.prototype.getParameter = function (param) {
      if (param === 37445) return WEBGL_VENDOR;
      if (param === 37446) return WEBGL_RENDERER;
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

// ─── Launch a fully stealthy Chromium browser ────────────────────────────────
//
// Uses playwright-extra + stealth plugin for the first layer of evasion.
// The STEALTH_ARGS disable the most obvious automation flags at the process level.
// STEALTH_INIT_SCRIPT (applied separately per context) handles JS-level patches.
// ─────────────────────────────────────────────────────────────────────────────
export async function launchStealthBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const { args: extraArgs = [], ...rest } = options;
  return extraChromium.launch({
    headless: true,
    ...rest,
    args: [...STEALTH_ARGS, ...extraArgs],
  });
}
