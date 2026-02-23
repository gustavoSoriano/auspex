import { describe, it, expect } from "vitest";
import { formatActionForHistory } from "../../src/agent/actions.js";
import type { AgentAction } from "../../src/types.js";

describe("formatActionForHistory", () => {
  it("should format click action", () => {
    const action: AgentAction = { type: "click", selector: "#btn" };
    expect(formatActionForHistory(action, 0)).toBe('[0] click "#btn"');
  });

  it("should format type action", () => {
    const action: AgentAction = { type: "type", selector: "input", text: "hello" };
    expect(formatActionForHistory(action, 1)).toBe('[1] type "hello" into "input"');
  });

  it("should format select action", () => {
    const action: AgentAction = { type: "select", selector: "select#lang", value: "pt" };
    expect(formatActionForHistory(action, 2)).toBe('[2] select "pt" in "select#lang"');
  });

  it("should format pressKey action", () => {
    const action: AgentAction = { type: "pressKey", key: "Enter" };
    expect(formatActionForHistory(action, 3)).toBe('[3] press key "Enter"');
  });

  it("should format hover action", () => {
    const action: AgentAction = { type: "hover", selector: ".menu" };
    expect(formatActionForHistory(action, 4)).toBe('[4] hover ".menu"');
  });

  it("should format goto action", () => {
    const action: AgentAction = { type: "goto", url: "https://example.com" };
    expect(formatActionForHistory(action, 5)).toBe("[5] navigate to https://example.com");
  });

  it("should format wait action", () => {
    const action: AgentAction = { type: "wait", ms: 2000 };
    expect(formatActionForHistory(action, 6)).toBe("[6] wait 2000ms");
  });

  it("should format scroll action without amount", () => {
    const action: AgentAction = { type: "scroll", direction: "down" };
    expect(formatActionForHistory(action, 7)).toBe("[7] scroll down");
  });

  it("should format scroll action with amount", () => {
    const action: AgentAction = { type: "scroll", direction: "up", amount: 1000 };
    expect(formatActionForHistory(action, 8)).toBe("[8] scroll up 1000px");
  });

  it("should format done action", () => {
    const action: AgentAction = { type: "done", result: "Task completed" };
    expect(formatActionForHistory(action, 9)).toBe("[9] done: Task completed");
  });
});
