export type LLMProvider = "openai" | "agentium";

export interface LLMResponse {
  data: unknown;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface LLMRequestParams {
  prompt: string;
  snapshot: string;
  history: string[];
  schemaDescription?: string;
  screenshot?: string;
  visionAvailable?: boolean;
  searchAvailable?: boolean;
  timeStatus?: {
    remainingMs: number;
    totalMs: number;
    iteration: number;
    maxIterations: number;
  };
}

export interface ILLMAdapter {
  decideAction(params: LLMRequestParams): Promise<LLMResponse>;
  dispose?(): Promise<void>;
}
