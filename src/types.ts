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
}

export interface RunOptions {
  url: string;
  prompt: string;
}

export type AgentAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "goto"; url: string }
  | { type: "wait"; ms: number }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "done"; result: string };

export interface ActionRecord {
  action: AgentAction;
  iteration: number;
  timestamp: number;
}

export type AgentStatus = "done" | "max_iterations" | "error" | "timeout";

/** Método de execução utilizado pelo agente */
export type AgentTier =
  | "http"        // Cheerio/HTTP — página estática, sem browser
  | "playwright"; // Playwright Chromium — browser completo necessário

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

export interface MemoryUsage {
  /** RSS do processo do browser Playwright em KB. 0 quando tier="http". */
  browserPeakRssKb: number;
  /** Heap usado pelo processo Node.js no momento da conclusão (MB) */
  nodeHeapUsedMb: number;
}

export interface AgentResult {
  status: AgentStatus;
  /** Método usado: "http" = Cheerio sem browser | "playwright" = browser completo */
  tier: AgentTier;
  data: string | null;
  report: string;
  durationMs: number;
  actions: ActionRecord[];
  usage: LLMUsage;
  memory: MemoryUsage;
  error?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: SnapshotLink[];
  forms: SnapshotForm[];
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
