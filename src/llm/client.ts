import type { ILLMAdapter, LLMProvider, LLMRequestParams, LLMResponse } from "./types.js";
import { OpenAIAdapter } from "./adapter-openai.js";
import { AgentiumAdapter } from "./adapter-agentium.js";

export interface LLMClientConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  modelPath?: string;
  modelDir?: string;
  gpuLayers?: number | "auto";
  contextSize?: number | "auto";
}

export class LLMClient {
  private adapter: ILLMAdapter;
  private initPromise: Promise<void> | null = null;

  constructor(config: LLMClientConfig) {
    if (config.provider === "agentium") {
      const adapter = new AgentiumAdapter({
        modelPath: config.modelPath,
        modelDir: config.modelDir,
        gpuLayers: config.gpuLayers,
        contextSize: config.contextSize,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
      this.adapter = adapter;
      this.initPromise = adapter.ensureInitialized();
    } else {
      if (!config.apiKey) {
        throw new Error("llmApiKey is required when provider is 'openai'");
      }
      this.adapter = new OpenAIAdapter({
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        baseUrl: config.baseUrl,
      });
    }
  }

  async decideAction(
    prompt: string,
    snapshot: string,
    history: string[],
    schemaDescription?: string,
    screenshot?: string,
    visionAvailable?: boolean,
    searchAvailable?: boolean,
    timeStatus?: { remainingMs: number; totalMs: number; iteration: number; maxIterations: number },
  ): Promise<LLMResponse> {
    if (this.initPromise) await this.initPromise;

    const params: LLMRequestParams = {
      prompt,
      snapshot,
      history,
      schemaDescription,
      screenshot,
      visionAvailable,
      searchAvailable,
      timeStatus,
    };

    return this.adapter.decideAction(params);
  }
}
