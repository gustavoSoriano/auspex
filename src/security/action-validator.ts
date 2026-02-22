import { z } from "zod";
import { DEFAULTS } from "../config/defaults.js";

const SELECTOR_BLACKLIST = [/javascript:/i, /on\w+\s*=/i, /<script/i];

const selectorSchema = z.string().trim().min(1, "Selector must not be empty or whitespace-only").refine(
  (s) => !SELECTOR_BLACKLIST.some((pattern) => pattern.test(s)),
  "Selector contains forbidden pattern",
);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: selectorSchema }),
  z.object({
    type: z.literal("type"),
    selector: selectorSchema,
    text: z.string().max(DEFAULTS.maxTypeLength),
  }),
  z.object({ type: z.literal("goto"), url: z.string().url() }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().positive().max(DEFAULTS.maxWaitMs),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
  }),
  z.object({ type: z.literal("done"), result: z.string() }),
]);

export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionValidationError";
  }
}

export function validateAction(raw: unknown) {
  const result = actionSchema.safeParse(raw);
  if (!result.success) {
    throw new ActionValidationError(
      `Invalid action: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  return result.data;
}
