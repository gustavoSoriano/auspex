import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright-core";
import { buildMacro } from "../../src/macro/build.js";
import { macroToJsonString, parseMacroJson } from "../../src/macro/serialize.js";
import { replayMacro } from "../../src/macro/replay.js";
import { MacroParseError } from "../../src/macro/schema.js";
import type { AgentResult } from "../../src/types.js";

function donePlaywrightResult(): AgentResult {
  return {
    status: "done",
    tier: "playwright",
    data: "ok",
    report: "",
    durationMs: 1,
    actions: [
      { action: { type: "scroll", direction: "down", amount: 1000 }, iteration: 0, timestamp: 1 },
      { action: { type: "scroll", direction: "down", amount: 1000 }, iteration: 1, timestamp: 2 },
      { action: { type: "done", result: "Lista" }, iteration: 2, timestamp: 3 },
    ],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, calls: 1 },
    memory: { browserPeakRssKb: 0, nodeHeapUsedMb: 1 },
  };
}

describe("buildMacro", () => {
  it("returns null when status is not done", () => {
    const r: AgentResult = {
      ...donePlaywrightResult(),
      status: "error",
    };
    expect(buildMacro(r, "https://example.com")).toBeNull();
  });

  it("builds steps without done and sets capturedResult", () => {
    const m = buildMacro(donePlaywrightResult(), "https://example.com/");
    expect(m).not.toBeNull();
    expect(m!.version).toBe(1);
    expect(m!.startUrl).toBe("https://example.com/");
    expect(m!.sourceTier).toBe("playwright");
    expect(m!.steps).toHaveLength(2);
    expect(m!.steps.every((s) => s.type !== "done")).toBe(true);
    expect(m!.capturedResult).toBe("Lista");
  });

  it("HTTP tier success yields empty steps", () => {
    const r: AgentResult = {
      status: "done",
      tier: "http",
      data: "x",
      report: "",
      durationMs: 1,
      actions: [{ action: { type: "done", result: "x" }, iteration: 0, timestamp: 1 }],
      usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1, calls: 1 },
      memory: { browserPeakRssKb: 0, nodeHeapUsedMb: 1 },
    };
    const m = buildMacro(r, "https://example.com/");
    expect(m!.steps).toHaveLength(0);
    expect(m!.sourceTier).toBe("http");
  });
});

describe("macroToJsonString / parseMacroJson", () => {
  it("roundtrips a valid macro", () => {
    const m = buildMacro(donePlaywrightResult(), "https://example.com/");
    const json = macroToJsonString(m!);
    const parsed = parseMacroJson(json);
    expect(parsed).toEqual(m);
  });

  it("throws MacroParseError on invalid JSON", () => {
    expect(() => parseMacroJson("not json")).toThrow(MacroParseError);
  });

  it("rejects steps that include done", () => {
    const bad = {
      version: 1,
      startUrl: "https://example.com/",
      sourceTier: "playwright",
      steps: [{ type: "done", result: "x" }],
    };
    expect(() => parseMacroJson(JSON.stringify(bad))).toThrow(MacroParseError);
  });
});

describe("replayMacro", () => {
  it("returns error when search step has no searxngClient", async () => {
    const page = { on: vi.fn(), off: vi.fn() } as unknown as Page;
    const macro = {
      version: 1 as const,
      startUrl: "https://example.com/",
      sourceTier: "playwright" as const,
      steps: [{ type: "search" as const, query: "test" }],
    };
    const r = await replayMacro(page, macro);
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/searxngClient/);
  });

  it("completes goto and empty steps with a stub page", async () => {
    const page = {
      on: vi.fn(),
      off: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const macro = {
      version: 1 as const,
      startUrl: "https://example.com/",
      sourceTier: "http" as const,
      steps: [] as [],
    };
    const r = await replayMacro(page, macro);
    expect(r.status).toBe("ok");
    expect(vi.mocked(page.goto)).toHaveBeenCalled();
    expect(vi.mocked(page.off)).toHaveBeenCalled();
  });

  it("does not insert actionDelay after search (matches agent loop)", async () => {
    const searxngClient = { search: vi.fn().mockResolvedValue([]) };
    const page = {
      on: vi.fn(),
      off: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const macro = {
      version: 1 as const,
      startUrl: "https://example.com/",
      sourceTier: "playwright" as const,
      steps: [
        { type: "search" as const, query: "q" },
        { type: "scroll" as const, direction: "down" as const, amount: 100 },
      ],
    };
    const r = await replayMacro(page, macro, {
      searxngClient,
      actionDelayMs: 400,
    });
    expect(r.status).toBe("ok");
    expect(searxngClient.search).toHaveBeenCalledWith("q", 5);
    expect(vi.mocked(page.waitForTimeout)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(page.waitForTimeout)).toHaveBeenCalledWith(400);
  });
});
