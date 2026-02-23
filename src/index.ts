// ── LLM Agent (automation via Playwright) ───────────────────────────────────
export { Auspex } from "./agent/agent.js";

export type {
  AgentConfig,
  AgentResult,
  AgentAction,
  AgentStatus,
  AgentTier,
  ActionRecord,
  LLMUsage,
  MemoryUsage,
  RunOptions,
  PageSnapshot,
  SnapshotLink,
  SnapshotForm,
  SnapshotInput,
  ProxyConfig,
  CookieParam,
  AuspexEvents,
} from "./types.js";

// ── Browser Pool ─────────────────────────────────────────────────────────────
export { BrowserPool } from "./browser/pool.js";
export type { BrowserPoolOptions } from "./browser/pool.js";

// ── Scraper (automatic fallback HTTP → Stealth → Browser) ───────────────────
export { Scraper } from "./scraper/index.js";

export type {
  ScraperConfig,
  ScrapeOptions,
  ScrapeResult,
  ScrapeTier,
  ContentFormat,
  SSRData,
  InterceptedAPI,
  TierRawResult,
  MapLink,
  MapOptions,
  MapResult,
} from "./scraper/index.js";

// ── Security ─────────────────────────────────────────────────────────────────
export { UrlValidationError } from "./security/url-validator.js";
export { ActionValidationError } from "./security/action-validator.js";
