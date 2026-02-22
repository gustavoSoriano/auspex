import { z } from "zod";
import { DEFAULTS } from "./defaults.js";

export const agentConfigSchema = z.object({
  llmApiKey: z.string().min(1, "llmApiKey is required"),
  llmBaseUrl: z.string().url().optional(),
  port: z.number().int().positive().default(9222),
  model: z.string().default(DEFAULTS.model),
  temperature: z.number().min(0).max(2).default(DEFAULTS.temperature),
  maxTokens: z.number().int().positive().default(DEFAULTS.maxTokens),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  maxIterations: z.number().int().positive().default(DEFAULTS.maxIterations),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
  maxWaitMs: z.number().int().positive().default(DEFAULTS.maxWaitMs),
  allowedDomains: z.array(z.string()).optional(),
  blockedDomains: z.array(z.string()).optional(),
});

export const runOptionsSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  prompt: z.string().min(1, "prompt is required"),
});

export type ValidatedConfig = z.infer<typeof agentConfigSchema>;
