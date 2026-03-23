import { MacroParseError, auspexMacroSchema, type AuspexMacro } from "./schema.js";

export function macroToJsonString(macro: AuspexMacro): string {
  return JSON.stringify(macro);
}

export function parseMacroJson(json: string): AuspexMacro {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new MacroParseError("Invalid JSON");
  }
  const r = auspexMacroSchema.safeParse(parsed);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join("; ");
    throw new MacroParseError(msg || "Invalid macro");
  }
  return r.data;
}
