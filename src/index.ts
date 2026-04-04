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
  ReplayableAction,
} from "./types.js";

// ── LLM Adapters ──────────────────────────────────────────────────────────
export type { ILLMAdapter, LLMProvider, LLMRequestParams, LLMResponse } from "./llm/types.js";
export { OpenAIAdapter } from "./llm/adapter-openai.js";
export { AgentiumAdapter } from "./llm/adapter-agentium.js";

// ── Macro (record & replay) ──────────────────────────────────────────────────
export {
  buildMacro,
  macroToJsonString,
  parseMacroJson,
  replayMacro,
  replayMacroWithBrowser,
  auspexMacroSchema,
  macroStepSchema,
  MacroParseError,
} from "./macro/index.js";
export type {
  AuspexMacro,
  MacroReplayOptions,
  MacroReplayLaunchOptions,
  MacroReplayResult,
  MacroReplayStatus,
} from "./macro/index.js";

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

// ── Web search (SearXNG) ─────────────────────────────────────────────────────
export { SearXNGClient } from "./search/index.js";
export type { SearchResult, SearXNGResponse, SearXNGClientOptions } from "./search/index.js";
