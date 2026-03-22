import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runOptionsSchema } from "../../src/config/schema.js";

describe("runOptionsSchema — searxngUrl", () => {
  const prevEnv = process.env.SEARXNG_URL;

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.SEARXNG_URL;
    } else {
      process.env.SEARXNG_URL = prevEnv;
    }
  });

  it("accepts prompt + searxngUrl without url", () => {
    delete process.env.SEARXNG_URL;
    const parsed = runOptionsSchema.parse({
      prompt: "find something",
      searxngUrl: "http://localhost:8080",
    });
    expect(parsed.searxngUrl).toBe("http://localhost:8080");
    expect(parsed.url).toBeUndefined();
  });

  it("accepts prompt without url when SEARXNG_URL is set", () => {
    process.env.SEARXNG_URL = "http://localhost:8080";
    const parsed = runOptionsSchema.parse({
      prompt: "find something",
    });
    expect(parsed.prompt).toBe("find something");
  });
});
