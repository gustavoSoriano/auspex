export const DEFAULTS = {
  provider: "openai" as const,
  model: "gpt-4o",
  temperature: 1,
  maxIterations: 30,
  timeoutMs: 120_000,
  maxWaitMs: 5_000,
  maxTypeLength: 5_000,       // Increased: allow more content when typing
  maxTokens: 8_000,           // Increased: allow longer LLM responses (~2x more detail)
  gotoTimeoutMs: 15_000,
  actionDelayMs: 500,
  maxTotalTokens: 0,          // 0 = unlimited (user sets model context limit)
  maxResultLength: 200_000,   // max chars in done.result (~50K tokens, safe for 100K+ context models)
  maxSelectorLength: 500,     // max chars in CSS selector (DoS protection - keep this)
  vision: false,              // send screenshot to LLM (requires vision-capable model)
  screenshotQuality: 75,      // JPEG quality 1-100 (lower = smaller payload, fewer tokens)
} as const;
