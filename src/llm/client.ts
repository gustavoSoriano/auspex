import OpenAI from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";
import type { LLMUsage } from "../types.js";
import { buildSystemPrompt, buildUserMessage, buildVisionContent } from "./prompt.js";

export interface LLMParams {
  temperature: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface LLMResponse {
  data: unknown;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    // Retry on rate limit (429), server errors (5xx), and timeout (408)
    return err.status === 429 || err.status === 408 || (err.status !== undefined && err.status >= 500);
  }
  // Retry on network errors
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

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private params: LLMParams;

  constructor(apiKey: string, model: string, params: LLMParams, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
    this.params = params;
  }

  async decideAction(
    prompt: string,
    snapshot: string,
    history: string[],
    schemaDescription?: string,
    screenshot?: string,
    visionAvailable?: boolean,
  ): Promise<LLMResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const textContent = buildUserMessage(prompt, snapshot, history, schemaDescription);
        const userContent: string | ChatCompletionContentPart[] = screenshot
          ? buildVisionContent(textContent, screenshot)
          : textContent;

        const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: this.model,
          temperature: this.params.temperature,
          max_completion_tokens: this.params.maxTokens,
          top_p: this.params.topP,
          frequency_penalty: this.params.frequencyPenalty,
          presence_penalty: this.params.presencePenalty,
          messages: [
            { role: "system", content: buildSystemPrompt(!!visionAvailable) },
            { role: "user", content: userContent },
          ],
        };

        // JSON mode is not reliably supported alongside vision on all providers
        if (!screenshot) {
          params.response_format = { type: "json_object" };
        }

        const response = await this.client.chat.completions.create(params);

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
