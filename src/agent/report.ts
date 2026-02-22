import type { AgentResult, AgentAction, ActionRecord } from "../types.js";

function describeAction(record: ActionRecord): string {
  const { action } = record;
  switch (action.type) {
    case "click":
      return `Clicou no elemento "${action.selector}"`;
    case "type":
      return `Digitou "${action.text}" no campo "${action.selector}"`;
    case "goto":
      return `Navegou para ${action.url}`;
    case "wait":
      return `Aguardou ${action.ms}ms`;
    case "scroll":
      return `Fez scroll ${action.direction === "down" ? "para baixo" : "para cima"}`;
    case "done": {
      const r = action.result;
      if (typeof r === "string" && r.startsWith("FAILED:")) {
        return `Falhou: ${r.slice(7).trim()}`;
      }
      return `Finalizou com resultado`;
    }
  }
}

function describeStatus(result: AgentResult): string {
  switch (result.status) {
    case "done":
      return "Tarefa concluída com sucesso.";
    case "max_iterations":
      return `Tarefa interrompida: atingiu o limite de ${result.actions.length} iterações sem concluir.`;
    case "timeout":
      return "Tarefa interrompida: tempo limite excedido.";
    case "error":
      return `Tarefa interrompida por erro: ${result.error}`;
  }
}

function describeTier(result: AgentResult): string {
  if (result.tier === "http") {
    return "🟢 HTTP/Cheerio  (sem browser — página estática)";
  }
  return "🟡 Playwright Chromium  (browser completo — JS necessário)";
}

function describeMemory(result: AgentResult): string {
  const node = `Node.js heap ${result.memory.nodeHeapUsedMb} MB`;

  if (result.tier === "http") {
    return `${node}  |  Browser: não utilizado`;
  }

  if (result.memory.browserPeakRssKb > 0) {
    const browserMb = (result.memory.browserPeakRssKb / 1024).toFixed(1);
    return `${node}  |  Chromium pico ${browserMb} MB`;
  }

  return `${node}  |  Chromium: RSS não disponível`;
}

export function generateReport(result: AgentResult, url: string, prompt: string): string {
  const lines: string[] = [];
  const duration = (result.durationMs / 1000).toFixed(1);

  lines.push("═══════════════════════════════════════════");
  lines.push("  RELATÓRIO DE EXECUÇÃO");
  lines.push("═══════════════════════════════════════════");
  lines.push("");
  lines.push(`  URL    : ${url}`);
  lines.push(`  Prompt : ${prompt}`);
  lines.push(`  Status : ${describeStatus(result)}`);
  lines.push(`  Método : ${describeTier(result)}`);
  lines.push(`  Duração: ${duration}s`);
  lines.push("");

  if (result.actions.length > 0) {
    lines.push("───────────────────────────────────────────");
    lines.push("  PASSO A PASSO");
    lines.push("───────────────────────────────────────────");
    lines.push("");

    for (const record of result.actions) {
      const step = record.iteration + 1;
      lines.push(`  ${step}. ${describeAction(record)}`);
    }
    lines.push("");
  }

  if (result.data) {
    lines.push("───────────────────────────────────────────");
    lines.push("  RESULTADO");
    lines.push("───────────────────────────────────────────");
    lines.push("");
    lines.push(`  ${result.data}`);
    lines.push("");
  }

  lines.push("───────────────────────────────────────────");
  lines.push("  CONSUMO DE RECURSOS");
  lines.push("───────────────────────────────────────────");
  lines.push("");
  lines.push(`  LLM    : ${result.usage.calls} chamada(s) | ${result.usage.totalTokens} tokens`);
  lines.push(`           ↳ ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion`);
  lines.push(`  RAM    : ${describeMemory(result)}`);
  lines.push("");
  lines.push("═══════════════════════════════════════════");

  return lines.join("\n");
}
