// ── Agente LLM (automação via Playwright) ─────────────────────────────────
export { Auspex } from "./agent/agent.js";

export type {
  AgentConfig,
  AgentResult,
  AgentAction,
  AgentStatus,
  ActionRecord,
  LLMUsage,
  MemoryUsage,
  RunOptions,
  PageSnapshot,
  SnapshotLink,
  SnapshotForm,
  SnapshotInput,
} from "./types.js";

// ── Scraper (fallback automático HTTP → Stealth → Browser) ─────────────────
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

// ── Segurança ─────────────────────────────────────────────────────────────
export { UrlValidationError } from "./security/url-validator.js";
export { ActionValidationError } from "./security/action-validator.js";
