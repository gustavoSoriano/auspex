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

// ── Firecrawl (scraping com fallback automático HTTP → Browser) ───────────
export { Firecrawl } from "./scraper/index.js";

export type {
  FirecrawlConfig,
  ScrapeOptions,
  ScrapeResult,
  ScrapeTier,
  ContentFormat,
  SSRData,
  InterceptedAPI,
  TierRawResult,
} from "./scraper/index.js";

// ── Segurança ─────────────────────────────────────────────────────────────
export { UrlValidationError } from "./security/url-validator.js";
export { ActionValidationError } from "./security/action-validator.js";
