import OpenAI from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";
import type { ILLMAdapter, LLMRequestParams, LLMResponse } from "./types.js";
import { buildSystemPrompt, buildUserMessage, buildVisionContent } from "./prompt.js";

export interface OpenAIAdapterConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  baseUrl?: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || err.status === 408 || (err.status !== undefined && err.status >= 500);
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("econnreset") || msg.includes("etimedout") ||
           msg.includes("socket hang up") || msg.includes("fetch failed");
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAIAdapter implements ILLMAdapter {
  private client: OpenAI;
  private model: string;
  private params: { temperature: number; maxTokens?: number; topP?: number; frequencyPenalty?: number; presencePenalty?: number };

  constructor(config: OpenAIAdapterConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    this.model = config.model;
    this.params = {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
    };
  }

  async decideAction(params: LLMRequestParams): Promise<LLMResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const textContent = buildUserMessage(params.prompt, params.snapshot, params.history, params.schemaDescription, params.timeStatus);
        const userContent: string | ChatCompletionContentPart[] = params.screenshot
          ? buildVisionContent(textContent, params.screenshot)
          : textContent;

        const completionParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: this.model,
          temperature: this.params.temperature,
          max_completion_tokens: this.params.maxTokens,
          top_p: this.params.topP,
          frequency_penalty: this.params.frequencyPenalty,
          presence_penalty: this.params.presencePenalty,
          messages: [
            { role: "system", content: buildSystemPrompt(!!params.visionAvailable, !!params.searchAvailable) },
            { role: "user", content: userContent },
          ],
        };

        if (!params.screenshot) {
          completionParams.response_format = { type: "json_object" };
        }

        const response = await this.client.chat.completions.create(completionParams);

        const choice = response.choices[0];
        const finishReason = choice?.finish_reason;

        if (finishReason === "length") {
          throw new Error(
            `LLM response cut off by token limit (max_completion_tokens=${this.params.maxTokens}). ` +
            "Increase maxTokens in AgentConfig if this happens frequently.",
          );
        }

        const content = choice?.message?.content;
        if (!content) {
          throw new Error(`LLM returned empty response (finish_reason: ${finishReason ?? "unknown"})`);
        }

        const usage = response.usage;

        return {
          data: JSON.parse(content),
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
          },
        };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && isRetryableError(err)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}
