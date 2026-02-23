import { z, type ZodType } from "zod";
import { DEFAULTS } from "./defaults.js";

const proxySchema = z.object({
  server: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
}).optional();

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  expires: z.number().optional(),
});

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
  gotoTimeoutMs: z.number().int().positive().default(DEFAULTS.gotoTimeoutMs),
  allowedDomains: z.array(z.string()).optional(),
  blockedDomains: z.array(z.string()).optional(),
  actionDelayMs: z.number().int().min(0).default(DEFAULTS.actionDelayMs),
  maxTotalTokens: z.number().int().min(0).default(DEFAULTS.maxTotalTokens),
  proxy: proxySchema,
  cookies: z.array(cookieSchema).optional(),
  extraHeaders: z.record(z.string()).optional(),
  log: z.boolean().default(false),
  logDir: z.string().default("logs"),
  vision: z.boolean().default(DEFAULTS.vision),
  screenshotQuality: z.number().int().min(1).max(100).default(DEFAULTS.screenshotQuality),
});

export const runOptionsSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  prompt: z.string().min(1, "prompt is required"),
  maxIterations: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  actionDelayMs: z.number().int().min(0).optional(),
  schema: z.custom<ZodType>().optional(),
  vision: z.boolean().optional(),
});

export type ValidatedConfig = z.infer<typeof agentConfigSchema>;
