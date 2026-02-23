import { z } from "zod";
import { DEFAULTS } from "../config/defaults.js";
import type { AgentAction } from "../types.js";

const SELECTOR_BLACKLIST = [/javascript:/i, /on\w+\s*=/i, /<script/i, /data:/i];
const ROLE_SELECTOR_RE = /^role=\w+(\[name=".*"\])?$/;

const selectorSchema = z
  .string()
  .trim()
  .min(1, "Selector must not be empty or whitespace-only")
  .max(DEFAULTS.maxSelectorLength, `Selector exceeds max length of ${DEFAULTS.maxSelectorLength}`)
  .refine(
    (s) => {
      // Role-based locators (from a11y tree) are always safe
      if (ROLE_SELECTOR_RE.test(s)) return true;
      return !SELECTOR_BLACKLIST.some((pattern) => pattern.test(s));
    },
    "Selector contains forbidden pattern",
  );

// Allowed keyboard keys for pressKey action
const ALLOWED_KEYS = [
  "Enter", "Tab", "Escape", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
  "Space", "F1", "F2", "F3", "F4", "F5", "F6",
  "F7", "F8", "F9", "F10", "F11", "F12",
] as const;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: selectorSchema }),
  z.object({
    type: z.literal("type"),
    selector: selectorSchema,
    text: z.string().max(DEFAULTS.maxTypeLength),
  }),
  z.object({
    type: z.literal("select"),
    selector: selectorSchema,
    value: z.string().max(500),
  }),
  z.object({
    type: z.literal("pressKey"),
    key: z.enum(ALLOWED_KEYS),
  }),
  z.object({
    type: z.literal("hover"),
    selector: selectorSchema,
  }),
  z.object({ type: z.literal("goto"), url: z.string().url() }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().positive().max(DEFAULTS.maxWaitMs),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive().max(5000).optional(),
  }),
  z.object({
    type: z.literal("done"),
    result: z.string().max(DEFAULTS.maxResultLength),
  }),
]);

export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionValidationError";
  }
}

export function validateAction(raw: unknown): AgentAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success) {
    throw new ActionValidationError(
      `Invalid action: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  return result.data as AgentAction;
}
