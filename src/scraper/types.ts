// ─── Tipos do Firecrawl ────────────────────────────────────────────────────

/**
 * Qual tier foi usado para fazer o scrape:
 *  - "http"       → Tier 1: fetch nativo + Cheerio (sem browser, ~100-500ms)
 *  - "stealth"    → Tier 2: got-scraping com TLS fingerprint spoofing (~200-800ms)
 *  - "browser"    → Tier 3: Playwright Chromium (browser completo, fallback final)
 */
export type ScrapeTier = "http" | "stealth" | "browser";

/** Resultado interno retornado por cada tier (não exposto ao usuário final) */
export interface TierRawResult {
  /** HTML completo da página */
  html: string;
  /** URL final após redirecionamentos */
  finalUrl: string;
  /** HTTP status code */
  statusCode: number;
  /**
   * true  = conteúdo suficiente (sem loading screen / anti-bot).
   * false = deve tentar o próximo tier na cascata.
   */
  sufficient: boolean;
}

/** Configuração global do Firecrawl */
export interface FirecrawlConfig {
  /** Timeout padrão em ms. Default: 30_000 */
  timeout?: number;

  /**
   * Forçar uso de um tier específico em todos os scrapes desta instância.
   * Pode ser sobrescrito por opção na chamada de `scrape()`.
   */
  forceTier?: ScrapeTier;

  /** Domínios permitidos (whitelist anti-SSRF). Qualquer URL fora da lista é rejeitada. */
  allowedDomains?: string[];

  /** Domínios bloqueados (blacklist anti-SSRF). */
  blockedDomains?: string[];

  /** Log detalhado mostrando qual tier foi usado e por quê. Default: false */
  verbose?: boolean;

  /** Configurações do browser Chromium (Tier 3) */
  browserConfig?: {
    /** Rodar em modo headless. Default: true */
    headless?: boolean;
    /**
     * Canal do browser instalado no sistema.
     * Exemplos: 'chrome', 'chromium', 'msedge'.
     * Se omitido, tenta 'chrome' (sistema) e depois playwright-chromium.
     */
    channel?: string;
    /** Caminho explícito para o executável do browser */
    executablePath?: string;
  };
}

/** Formatos de saída do conteúdo */
export type ContentFormat = "markdown" | "html" | "text";

/** Opções de scraping passadas pelo usuário */
export interface ScrapeOptions {
  /** Formatos de saída desejados. Default: ['markdown', 'text'] */
  formats?: ContentFormat[];
  /** Timeout em ms. Default: 30_000 */
  timeout?: number;
  /** Só tentar extrair o conteúdo principal (remove nav, footer, ads). Default: true */
  onlyMainContent?: boolean;
  /** Headers HTTP extras */
  headers?: Record<string, string>;
  /**
   * Forçar uso de um tier específico (ignora a cascata automática).
   *  - "http"    → só HTTP + Cheerio
   *  - "stealth" → pula HTTP, usa got-scraping diretamente
   *  - "browser" → vai direto ao Playwright Chromium
   */
  forceTier?: ScrapeTier;

  // ── Opções exclusivas do Tier 3 (browser) ──────────────────────────────
  /** Aguardar esse seletor CSS aparecer e estar visível antes de extrair */
  waitForSelector?: string;
  /** Interceptar respostas JSON das APIs chamadas pela SPA */
  interceptAPIs?: boolean;
}

/** Dados SSR embutidos em tags <script> pelo framework */
export interface SSRData {
  /**
   * Framework que gerou o dado:
   *  - "next"      → Next.js (#__NEXT_DATA__)
   *  - "nuxt"      → Nuxt 2/3 (window.__NUXT__)
   *  - "gatsby"    → Gatsby (window.___gatsby)
   *  - "remix"     → Remix (window.__remixContext)
   *  - "sveltekit" → SvelteKit (script[data-sveltekit-fetched] ou window.__SVELTEKIT__)
   *  - "vue"       → Vue SSR (window.__VUE_SSR_CONTEXT__ / window.__VUE_STORE__)
   *  - "angular"   → Angular Universal (script#ng-state)
   *  - "tanstack"  → TanStack Router / Start (window.__TSR_DEHYDRATED__)
   *  - "generic"   → Outros (window.__INITIAL_STATE__, __APP_STATE__, etc.)
   */
  type: "next" | "nuxt" | "gatsby" | "remix" | "sveltekit" | "vue" | "angular" | "tanstack" | "generic";
  /** Objeto JSON extraído */
  data: unknown;
}

/** Chamada de API interceptada durante renderização do browser */
export interface InterceptedAPI {
  url: string;
  method: string;
  statusCode: number;
  contentType: string;
  data: unknown;
}

/** Resultado completo do scrape */
export interface ScrapeResult {
  /** URL final (após redirecionamentos) */
  url: string;
  /** HTTP status code */
  statusCode: number;
  /** Título da página */
  title: string;
  /** Meta description */
  description?: string;

  // ── Conteúdo ────────────────────────────────────────────────────────────
  /** Conteúdo em Markdown */
  markdown?: string;
  /** Conteúdo em HTML limpo */
  html?: string;
  /** Conteúdo em texto puro */
  text?: string;

  // ── Metadados ───────────────────────────────────────────────────────────
  /** Tier usado para fazer o scrape */
  tier: ScrapeTier;
  /** Tempo total em ms */
  durationMs: number;
  /** Links encontrados na página */
  links?: string[];

  // ── Dados extras ────────────────────────────────────────────────────────
  /** Dados SSR extraídos (Next.js, Nuxt, etc.) */
  ssrData?: SSRData;
  /** Chamadas JSON interceptadas durante renderização (só Tier 3) */
  interceptedAPIs?: InterceptedAPI[];

  /** Motivo de falha, se houver */
  error?: string;
}
