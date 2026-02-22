export const DEFAULTS = {
  model: "gpt-4o",
  temperature: 1,
  maxIterations: 30,
  timeoutMs: 120_000,
  maxWaitMs: 5_000,
  maxTypeLength: 1_000,
  maxTokens: 2_500, // limite de completion tokens por chamada LLM
  gotoTimeoutMs: 15_000,
} as const;
