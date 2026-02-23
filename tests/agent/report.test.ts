import { describe, it, expect } from "vitest";
import { generateReport } from "../../src/agent/report.js";
import type { AgentResult } from "../../src/types.js";

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    status: "done",
    tier: "http",
    data: "Result data",
    report: "",
    durationMs: 1200,
    actions: [],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, calls: 1 },
    memory: { browserPeakRssKb: 0, nodeHeapUsedMb: 45.2 },
    ...overrides,
  };
}

describe("generateReport", () => {
  it("should generate report in English", () => {
    const result = makeResult();
    const report = generateReport(result, "https://example.com", "Get the title");
    expect(report).toContain("EXECUTION REPORT");
    expect(report).toContain("URL     : https://example.com");
    expect(report).toContain("Prompt  : Get the title");
    expect(report).toContain("Task completed successfully");
    expect(report).toContain("HTTP/Cheerio");
    expect(report).toContain("1.2s");
  });

  it("should show result data", () => {
    const result = makeResult({ data: "Hello World" });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("RESULT");
    expect(report).toContain("Hello World");
  });

  it("should show step by step for actions", () => {
    const result = makeResult({
      tier: "playwright",
      actions: [
        { action: { type: "click", selector: "#btn" }, iteration: 0, timestamp: Date.now() },
        { action: { type: "done", result: "ok" }, iteration: 1, timestamp: Date.now() },
      ],
    });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("STEP BY STEP");
    expect(report).toContain('1. Clicked element "#btn"');
    expect(report).toContain("2. Finished with result");
  });

  it("should show resource usage", () => {
    const result = makeResult({
      usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200, calls: 3 },
    });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("RESOURCE USAGE");
    expect(report).toContain("3 call(s) | 1200 tokens");
    expect(report).toContain("1000 prompt + 200 completion");
  });

  it("should describe Playwright tier with memory", () => {
    const result = makeResult({
      tier: "playwright",
      memory: { browserPeakRssKb: 400_000, nodeHeapUsedMb: 67 },
    });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("Playwright Chromium");
    expect(report).toContain("Chromium peak");
  });

  it("should describe HTTP tier with no browser", () => {
    const result = makeResult({ tier: "http" });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("HTTP/Cheerio");
    expect(report).toContain("Browser: not used");
  });

  it("should describe error status", () => {
    const result = makeResult({ status: "error", error: "Connection failed" });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("interrupted by error: Connection failed");
  });

  it("should describe timeout status", () => {
    const result = makeResult({ status: "timeout" });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("timeout exceeded");
  });

  it("should describe aborted status", () => {
    const result = makeResult({ status: "aborted" });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain("aborted by user");
  });

  it("should describe new action types", () => {
    const result = makeResult({
      tier: "playwright",
      actions: [
        { action: { type: "select", selector: "select", value: "BR" }, iteration: 0, timestamp: Date.now() },
        { action: { type: "pressKey", key: "Enter" }, iteration: 1, timestamp: Date.now() },
        { action: { type: "hover", selector: ".menu" }, iteration: 2, timestamp: Date.now() },
        { action: { type: "scroll", direction: "down", amount: 1000 }, iteration: 3, timestamp: Date.now() },
      ],
    });
    const report = generateReport(result, "https://example.com", "prompt");
    expect(report).toContain('Selected "BR"');
    expect(report).toContain('Pressed key "Enter"');
    expect(report).toContain('Hovered over ".menu"');
    expect(report).toContain("Scrolled down 1000px");
  });
});
