import { describe, it, expect } from "vitest";
import { validateAction, ActionValidationError } from "../../src/security/action-validator.js";

describe("validateAction", () => {
  // ── Valid actions ──────────────────────────────────────────────────────

  it("should accept valid click action", () => {
    const result = validateAction({ type: "click", selector: "#btn" });
    expect(result).toEqual({ type: "click", selector: "#btn" });
  });

  it("should accept valid type action", () => {
    const result = validateAction({ type: "type", selector: "input[name='q']", text: "hello" });
    expect(result).toEqual({ type: "type", selector: "input[name='q']", text: "hello" });
  });

  it("should accept valid select action", () => {
    const result = validateAction({ type: "select", selector: "select#country", value: "BR" });
    expect(result).toEqual({ type: "select", selector: "select#country", value: "BR" });
  });

  it("should accept valid pressKey action", () => {
    const result = validateAction({ type: "pressKey", key: "Enter" });
    expect(result).toEqual({ type: "pressKey", key: "Enter" });
  });

  it("should accept valid hover action", () => {
    const result = validateAction({ type: "hover", selector: ".menu-trigger" });
    expect(result).toEqual({ type: "hover", selector: ".menu-trigger" });
  });

  it("should accept valid goto action", () => {
    const result = validateAction({ type: "goto", url: "https://example.com" });
    expect(result).toEqual({ type: "goto", url: "https://example.com" });
  });

  it("should accept valid wait action", () => {
    const result = validateAction({ type: "wait", ms: 1000 });
    expect(result).toEqual({ type: "wait", ms: 1000 });
  });

  it("should accept valid scroll action", () => {
    const result = validateAction({ type: "scroll", direction: "down" });
    expect(result).toEqual({ type: "scroll", direction: "down" });
  });

  it("should accept scroll with custom amount", () => {
    const result = validateAction({ type: "scroll", direction: "up", amount: 1000 });
    expect(result).toEqual({ type: "scroll", direction: "up", amount: 1000 });
  });

  it("should accept valid done action", () => {
    const result = validateAction({ type: "done", result: "The title is Hello World" });
    expect(result.type).toBe("done");
  });

  // ── Allowed keys ──────────────────────────────────────────────────────

  it("should accept all allowed keys", () => {
    const keys = [
      "Enter", "Tab", "Escape", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown", "Space",
      "F1", "F2", "F3", "F12",
    ];
    for (const key of keys) {
      expect(() => validateAction({ type: "pressKey", key })).not.toThrow();
    }
  });

  it("should reject unknown keys", () => {
    expect(() => validateAction({ type: "pressKey", key: "Ctrl" })).toThrow(ActionValidationError);
    expect(() => validateAction({ type: "pressKey", key: "a" })).toThrow(ActionValidationError);
  });

  // ── Invalid actions ───────────────────────────────────────────────────

  it("should reject unknown action type", () => {
    expect(() => validateAction({ type: "execute", code: "alert(1)" })).toThrow(ActionValidationError);
  });

  it("should reject null/undefined", () => {
    expect(() => validateAction(null)).toThrow(ActionValidationError);
    expect(() => validateAction(undefined)).toThrow(ActionValidationError);
  });

  it("should reject empty object", () => {
    expect(() => validateAction({})).toThrow(ActionValidationError);
  });

  it("should reject string input", () => {
    expect(() => validateAction("click")).toThrow(ActionValidationError);
  });

  // ── Selector blacklist ────────────────────────────────────────────────

  it("should reject selector with javascript:", () => {
    expect(() => validateAction({ type: "click", selector: "javascript:alert(1)" }))
      .toThrow(ActionValidationError);
  });

  it("should reject selector with onclick=", () => {
    expect(() => validateAction({ type: "click", selector: "div[onclick=evil]" }))
      .toThrow(ActionValidationError);
  });

  it("should reject selector with <script>", () => {
    expect(() => validateAction({ type: "click", selector: "<script>alert(1)</script>" }))
      .toThrow(ActionValidationError);
  });

  it("should reject selector with data:", () => {
    expect(() => validateAction({ type: "click", selector: "data:text/html,hi" }))
      .toThrow(ActionValidationError);
  });

  // ── Selector limits ───────────────────────────────────────────────────

  it("should reject empty selector", () => {
    expect(() => validateAction({ type: "click", selector: "" })).toThrow(ActionValidationError);
    expect(() => validateAction({ type: "click", selector: "   " })).toThrow(ActionValidationError);
  });

  it("should reject selector exceeding max length", () => {
    const longSelector = "a".repeat(600);
    expect(() => validateAction({ type: "click", selector: longSelector })).toThrow(ActionValidationError);
  });

  // ── done.result limit ─────────────────────────────────────────────────

  it("should reject done.result exceeding max length", () => {
    const longResult = "x".repeat(51_000);
    expect(() => validateAction({ type: "done", result: longResult })).toThrow(ActionValidationError);
  });

  // ── wait limit ────────────────────────────────────────────────────────

  it("should reject wait > maxWaitMs", () => {
    expect(() => validateAction({ type: "wait", ms: 10_000 })).toThrow(ActionValidationError);
  });

  it("should reject wait with 0ms", () => {
    expect(() => validateAction({ type: "wait", ms: 0 })).toThrow(ActionValidationError);
  });

  it("should reject wait with negative ms", () => {
    expect(() => validateAction({ type: "wait", ms: -1 })).toThrow(ActionValidationError);
  });

  // ── scroll amount limit ───────────────────────────────────────────────

  it("should reject scroll amount > 5000", () => {
    expect(() => validateAction({ type: "scroll", direction: "down", amount: 6000 }))
      .toThrow(ActionValidationError);
  });
});
