import OpenAI from "openai";
import type { LLMUsage } from "../types.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

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
  ): Promise<LLMResponse> {
    // max_completion_tokens é o parâmetro correto para modelos mais novos (o1, o3, etc.)
    // max_tokens ainda funciona para gpt-4o/gpt-4o-mini mas é deprecated.
    // Usar max_completion_tokens garante compatibilidade com todos os modelos OpenAI.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.params.temperature,
      max_completion_tokens: this.params.maxTokens,
      top_p: this.params.topP,
      frequency_penalty: this.params.frequencyPenalty,
      presence_penalty: this.params.presencePenalty,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(prompt, snapshot, history) },
      ],
      response_format: { type: "json_object" },
    });

    const choice = response.choices[0];
    const finishReason = choice?.finish_reason;

    // finish_reason "length" = resposta cortada pelo limite de tokens → JSON incompleto
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
  }
}
