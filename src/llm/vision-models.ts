/**
 * Whitelist of vision-capable models validated by the auspex team.
 * Partial matching is used: "gpt-4o" matches "gpt-4o-2024-11-20".
 */
const VISION_MODELS: string[] = [
  // OpenAI (direct API — api.openai.com)
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  // Meta via Groq (api.groq.com/openai/v1)
  "meta-llama/llama-4-scout",
  "meta-llama/llama-4-maverick",
];

export function isVisionModel(model: string): boolean {
  const lower = model.toLowerCase();
  return VISION_MODELS.some((v) => lower.includes(v.toLowerCase()));
}

const warnedModels = new Set<string>();

export function warnIfNotVisionModel(model: string): void {
  if (warnedModels.has(model) || isVisionModel(model)) return;
  warnedModels.add(model);
  console.warn(
    `[auspex] vision is enabled but model "${model}" is not in the validated vision models list. ` +
    "Screenshot will still be sent, but the model may not support image inputs. " +
    "Validated models: " + VISION_MODELS.join(", "),
  );
}
