import type { ZodType } from "zod";

// ─── Agent Actions ────────────────────────────────────────────────────────────

export type AgentAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "select"; selector: string; value: string }
  | { type: "pressKey"; key: string }
  | { type: "hover"; selector: string }
  | { type: "goto"; url: string }
  | { type: "wait"; ms: number }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "done"; result: string };

// ─── Proxy ────────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  /** Proxy server URL (e.g. "http://proxy:8080" or "socks5://proxy:1080") */
  server: string;
  /** Username for proxy authentication */
  username?: string;
  /** Password for proxy authentication */
  password?: string;
}

// ─── Cookie ───────────────────────────────────────────────────────────────────

export interface CookieParam {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
}

// ─── Agent Config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  llmApiKey: string;
  llmBaseUrl?: string;
  port?: number;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxIterations?: number;
  timeoutMs?: number;
  maxWaitMs?: number;
  gotoTimeoutMs?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Delay in ms between agent loop iterations. Default: 500 */
  actionDelayMs?: number;
  /** Maximum total tokens budget across all LLM calls. Aborts if exceeded. */
  maxTotalTokens?: number;
  /** Proxy configuration for browser and HTTP requests */
  proxy?: ProxyConfig;
  /** Cookies to inject into browser context */
  cookies?: CookieParam[];
  /** Extra HTTP headers for browser context */
  extraHeaders?: Record<string, string>;
  /** Enable file logging for each run. Logs are saved to ./logs/ */
  log?: boolean;
  /** Directory for log files. Default: "logs" */
  logDir?: string;
  /** Enable vision as auto-fallback. Screenshots are sent to the LLM only after consecutive failures
   *  (invalid actions, execution errors, stuck loops). Requires a vision-capable model. Default: false */
  vision?: boolean;
  /** JPEG quality for screenshots (1-100). Lower = smaller payload, fewer tokens. Default: 75 */
  screenshotQuality?: number;
}

// ─── Run Options (per-execution overrides) ────────────────────────────────────

export interface RunOptions {
  url: string;
  prompt: string;
  /** Override maxIterations for this run */
  maxIterations?: number;
  /** Override timeoutMs for this run */
  timeoutMs?: number;
  /** Override actionDelayMs for this run */
  actionDelayMs?: number;
  /** AbortSignal to cancel this run */
  signal?: AbortSignal;
  /** Zod schema for structured data extraction. When provided, the agent returns validated, typed data. */
  schema?: ZodType;
  /** Override vision auto-fallback setting for this run */
  vision?: boolean;
}

// ─── Action Record ────────────────────────────────────────────────────────────

export interface ActionRecord {
  action: AgentAction;
  iteration: number;
  timestamp: number;
}

// ─── Status & Tier ────────────────────────────────────────────────────────────

export type AgentStatus = "done" | "max_iterations" | "error" | "timeout" | "aborted";

/** Execution method used by the agent */
export type AgentTier =
  | "http"        // Cheerio/HTTP — static page, no browser
  | "playwright"; // Playwright Chromium — full browser

// ─── Usage & Memory ───────────────────────────────────────────────────────────

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

export interface MemoryUsage {
  /** RSS of the Playwright browser process in KB. 0 when tier="http". */
  browserPeakRssKb: number;
  /** Node.js heap used at completion time (MB) */
  nodeHeapUsedMb: number;
}

// ─── Agent Result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  status: AgentStatus;
  /** Method used: "http" = Cheerio without browser | "playwright" = full browser */
  tier: AgentTier;
  data: string | null;
  report: string;
  durationMs: number;
  actions: ActionRecord[];
  usage: LLMUsage;
  memory: MemoryUsage;
  error?: string;
}

// ─── Page Snapshot ────────────────────────────────────────────────────────────

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: SnapshotLink[];
  forms: SnapshotForm[];
  /** YAML accessibility tree from Playwright (only present in browser tier) */
  ariaTree?: string;
  /** Base64-encoded JPEG screenshot of the viewport (only present when vision is enabled) */
  screenshot?: string;
}

export interface SnapshotLink {
  text: string;
  href: string;
  index: number;
}

export interface SnapshotForm {
  action: string;
  inputs: SnapshotInput[];
}

export interface SnapshotInput {
  name: string;
  type: string;
  placeholder: string;
  selector: string;
}

// ─── Agent Events ─────────────────────────────────────────────────────────────

export interface AuspexEvents {
  action: [action: AgentAction, iteration: number];
  iteration: [iteration: number, snapshot: PageSnapshot];
  tier: [tier: AgentTier];
  error: [error: Error];
  done: [result: AgentResult];
}
