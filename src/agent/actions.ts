import type { AgentAction } from "../types.js";
import { validateAction } from "../security/action-validator.js";
import { validateUrl, type UrlValidationOptions } from "../security/url-validator.js";

export async function parseAndValidateAction(
  raw: unknown,
  urlOptions: UrlValidationOptions,
): Promise<AgentAction> {
  const action = validateAction(raw);

  if (action.type === "goto") {
    await validateUrl(action.url, urlOptions);
  }

  return action;
}

export function formatActionForHistory(action: AgentAction, iteration: number): string {
  switch (action.type) {
    case "click":
      return `[${iteration}] click "${action.selector}"`;
    case "type":
      return `[${iteration}] type "${action.text}" into "${action.selector}"`;
    case "select":
      return `[${iteration}] select "${action.value}" in "${action.selector}"`;
    case "pressKey":
      return `[${iteration}] press key "${action.key}"`;
    case "hover":
      return `[${iteration}] hover "${action.selector}"`;
    case "goto":
      return `[${iteration}] navigate to ${action.url}`;
    case "wait":
      return `[${iteration}] wait ${action.ms}ms`;
    case "scroll":
      return `[${iteration}] scroll ${action.direction}${action.amount ? ` ${action.amount}px` : ""}`;
    case "done":
      return `[${iteration}] done: ${action.result}`;
  }
}
