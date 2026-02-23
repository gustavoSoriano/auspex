import type { AgentResult, ActionRecord } from "../types.js";

function describeAction(record: ActionRecord): string {
  const { action } = record;
  switch (action.type) {
    case "click":
      return `Clicked element "${action.selector}"`;
    case "type":
      return `Typed "${action.text}" into "${action.selector}"`;
    case "select":
      return `Selected "${action.value}" in "${action.selector}"`;
    case "pressKey":
      return `Pressed key "${action.key}"`;
    case "hover":
      return `Hovered over "${action.selector}"`;
    case "goto":
      return `Navigated to ${action.url}`;
    case "wait":
      return `Waited ${action.ms}ms`;
    case "scroll":
      return `Scrolled ${action.direction}${action.amount ? ` ${action.amount}px` : ""}`;
    case "done": {
      const r = action.result;
      if (typeof r === "string" && r.startsWith("FAILED:")) {
        return `Failed: ${r.slice(7).trim()}`;
      }
      return `Finished with result`;
    }
  }
}

function describeStatus(result: AgentResult): string {
  switch (result.status) {
    case "done":
      return "Task completed successfully.";
    case "max_iterations":
      return "Task interrupted: reached the iteration limit without completing.";
    case "timeout":
      return "Task interrupted: timeout exceeded.";
    case "aborted":
      return "Task aborted by user.";
    case "error":
      return `Task interrupted by error: ${result.error}`;
  }
}

function describeTier(result: AgentResult): string {
  if (result.tier === "http") {
    return "HTTP/Cheerio (no browser — static page)";
  }
  return "Playwright Chromium (full browser — JS required)";
}

function describeMemory(result: AgentResult): string {
  const node = `Node.js heap ${result.memory.nodeHeapUsedMb} MB`;

  if (result.tier === "http") {
    return `${node}  |  Browser: not used`;
  }

  if (result.memory.browserPeakRssKb > 0) {
    const browserMb = (result.memory.browserPeakRssKb / 1024).toFixed(1);
    return `${node}  |  Chromium peak ${browserMb} MB`;
  }

  return `${node}  |  Chromium: RSS not available`;
}

export function generateReport(result: AgentResult, url: string, prompt: string): string {
  const lines: string[] = [];
  const duration = (result.durationMs / 1000).toFixed(1);

  lines.push("═══════════════════════════════════════════");
  lines.push("  EXECUTION REPORT — auspex");
  lines.push("═══════════════════════════════════════════");
  lines.push("");
  lines.push(`  URL     : ${url}`);
  lines.push(`  Prompt  : ${prompt}`);
  lines.push(`  Status  : ${describeStatus(result)}`);
  lines.push(`  Method  : ${describeTier(result)}`);
  lines.push(`  Duration: ${duration}s`);
  lines.push("");

  if (result.actions.length > 0) {
    lines.push("───────────────────────────────────────────");
    lines.push("  STEP BY STEP");
    lines.push("───────────────────────────────────────────");
    lines.push("");

    for (const record of result.actions) {
      const step = record.iteration + 1;
      lines.push(`  ${step}. ${describeAction(record)}`);
    }
    lines.push("");
  }

  if (result.data !== null && result.data !== undefined) {
    lines.push("───────────────────────────────────────────");
    lines.push("  RESULT");
    lines.push("───────────────────────────────────────────");
    lines.push("");
    const dataStr = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2);
    const maxResultChars = 10_000;
    lines.push(dataStr.length <= maxResultChars ? dataStr : dataStr.slice(0, maxResultChars) + "\n... (truncated)");
    lines.push("");
  }

  lines.push("───────────────────────────────────────────");
  lines.push("  RESOURCE USAGE");
  lines.push("───────────────────────────────────────────");
  lines.push("");
  lines.push(`  LLM    : ${result.usage.calls} call(s) | ${result.usage.totalTokens} tokens`);
  lines.push(`           > ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion`);
  lines.push(`  RAM    : ${describeMemory(result)}`);
  lines.push("");
  lines.push("═══════════════════════════════════════════");

  return lines.join("\n");
}
