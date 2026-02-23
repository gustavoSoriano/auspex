export const DEFAULTS = {
  model: "gpt-4o",
  temperature: 1,
  maxIterations: 30,
  timeoutMs: 120_000,
  maxWaitMs: 5_000,
  maxTypeLength: 1_000,
  maxTokens: 2_500,
  gotoTimeoutMs: 15_000,
  actionDelayMs: 500,
  maxTotalTokens: 0,        // 0 = unlimited
  maxResultLength: 50_000,   // max chars in done.result
  maxSelectorLength: 500,    // max chars in CSS selector (DoS protection)
  vision: false,              // send screenshot to LLM (requires vision-capable model)
  screenshotQuality: 75,      // JPEG quality 1-100 (lower = smaller payload, fewer tokens)
} as const;
