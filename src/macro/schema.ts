import { z } from "zod";
import { actionSchema } from "../security/action-validator.js";
import type { SearXNGClient } from "../search/searxng-client.js";

export const macroStepSchema = actionSchema.superRefine((val, ctx) => {
  if (val.type === "done") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Macro step cannot be type done",
    });
  }
});

export const auspexMacroSchema = z.object({
  version: z.literal(1),
  startUrl: z.string().url(),
  sourceTier: z.enum(["http", "playwright"]),
  steps: z.array(macroStepSchema),
  capturedResult: z.string().optional(),
});

export type AuspexMacro = z.infer<typeof auspexMacroSchema>;

export class MacroParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroParseError";
  }
}

export type MacroReplayStatus = "ok" | "error";

export interface MacroReplayResult {
  status: MacroReplayStatus;
  error?: string;
}

export interface MacroReplayOptions {
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Delay in ms after each step except `wait`, `goto`, and `search` (matches the agent loop). Default: 500 */
  actionDelayMs?: number;
  /** Timeout for `page.goto` of `startUrl` and per-step `goto`. Default: 15000 */
  gotoTimeoutMs?: number;
  /** Required when `macro.steps` contains `type: "search"` */
  searxngClient?: SearXNGClient;
  /** Passed through for replay (not stored in macro) */
  signal?: AbortSignal;
}
