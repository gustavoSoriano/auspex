import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAction, PageSnapshot, AgentResult } from "../types.js";

export class RunLogger {
  private filePath: string;

  constructor(dir = "logs") {
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.filePath = join(dir, `auspex-${ts}.txt`);
    this.write(`=== Auspex Run — ${new Date().toISOString()} ===\n`);
  }

  private write(line: string) {
    appendFileSync(this.filePath, line + "\n", "utf-8");
  }

  logStart(url: string, prompt: string) {
    this.write(`URL   : ${url}`);
    this.write(`Prompt: ${prompt}\n`);
  }

  logTier(tier: string) {
    this.write(`[tier] ${tier}`);
  }

  logIteration(i: number, snapshot: PageSnapshot) {
    this.write(`\n[iter ${i}] ${snapshot.url}`);
    this.write(`  title: ${snapshot.title}`);
    this.write(`  text (${snapshot.text.length} chars) | ${snapshot.links.length} links | ${snapshot.forms.length} forms`);
  }

  logAction(action: AgentAction, i: number) {
    const desc =
      action.type === "click"    ? `click "${action.selector}"` :
      action.type === "type"     ? `type "${action.text}" into "${action.selector}"` :
      action.type === "select"   ? `select "${action.value}" in "${action.selector}"` :
      action.type === "pressKey" ? `press ${action.key}` :
      action.type === "hover"    ? `hover "${action.selector}"` :
      action.type === "goto"     ? `goto ${action.url}` :
      action.type === "scroll"   ? `scroll ${action.direction}${action.amount ? ` ${action.amount}px` : ""}` :
      action.type === "wait"     ? `wait ${action.ms}ms` :
      action.type === "done"     ? `done: ${action.result.slice(0, 200)}` :
      JSON.stringify(action);
    this.write(`  [action ${i}] ${desc}`);
  }

  logActionResult(i: number, ok: boolean, error?: string) {
    if (ok) {
      this.write(`  [action ${i}] -> OK`);
    } else {
      this.write(`  [action ${i}] -> ERROR: ${error}`);
    }
  }

  logInvalidAction(i: number, error: string) {
    this.write(`  [iter ${i}] INVALID ACTION: ${error}`);
  }

  logResult(result: AgentResult) {
    this.write(`\n${"─".repeat(50)}`);
    this.write(`Status  : ${result.status}`);
    this.write(`Duration: ${result.durationMs}ms`);
    this.write(`Tokens  : ${result.usage.totalTokens} (${result.usage.calls} calls)`);
    this.write(`Actions : ${result.actions.length}`);
    if (result.error) this.write(`Error   : ${result.error}`);
    if (result.data !== null && result.data !== undefined) {
      const dataStr = typeof result.data === "string"
        ? result.data.slice(0, 500)
        : JSON.stringify(result.data).slice(0, 500);
      this.write(`Data    : ${dataStr}`);
    }
    this.write(`\nLog file: ${this.filePath}`);
  }

  getPath(): string {
    return this.filePath;
  }
}
