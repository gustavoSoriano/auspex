import type { AgentResult, ReplayableAction } from "../types.js";
import type { AuspexMacro } from "./schema.js";

export function buildMacro(result: AgentResult, startUrl: string): AuspexMacro | null {
  if (result.status !== "done") return null;

  const steps: ReplayableAction[] = [];
  for (const { action } of result.actions) {
    if (action.type === "done") continue;
    steps.push(action);
  }

  const last = result.actions[result.actions.length - 1]?.action;
  const capturedResult = last?.type === "done" ? last.result : undefined;

  const macro: AuspexMacro = {
    version: 1,
    startUrl,
    sourceTier: result.tier,
    steps: steps as AuspexMacro["steps"],
  };
  if (capturedResult !== undefined) {
    macro.capturedResult = capturedResult;
  }
  return macro;
}
