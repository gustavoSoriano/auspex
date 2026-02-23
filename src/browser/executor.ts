import type { Page, Locator } from "playwright-core";
import type { AgentAction } from "../types.js";
import { validateUrl, type UrlValidationOptions } from "../security/url-validator.js";

// ─── Role-based locator resolution ──────────────────────────────────────────
// Matches: role=button, role=button[name="Submit"], role=textbox[name="Search"]
const ROLE_SELECTOR_RE = /^role=(\w+)(?:\[name="(.*)"\])?$/;

function resolveLocator(page: Page, selector: string): Locator | null {
  const match = selector.match(ROLE_SELECTOR_RE);
  if (!match) return null;
  const role = match[1] as Parameters<Page["getByRole"]>[0];
  const name = match[2]?.replace(/\\"/g, '"');
  const loc = name ? page.getByRole(role, { name }) : page.getByRole(role);
  return loc.first();
}

export async function executeAction(
  page: Page,
  action: AgentAction,
  urlOptions: UrlValidationOptions,
): Promise<void> {
  switch (action.type) {
    case "click": {
      const loc = resolveLocator(page, action.selector);
      if (loc) {
        await loc.click({ timeout: 10_000 });
      } else {
        const [clickResult] = await Promise.allSettled([
          page.click(action.selector, { timeout: 10_000 }),
        ]);
        if (clickResult.status === "rejected") throw clickResult.reason;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
      break;
    }

    case "type": {
      const loc = resolveLocator(page, action.selector);
      if (loc) {
        await loc.fill(action.text, { timeout: 5_000 });
      } else {
        await page.fill(action.selector, action.text, { timeout: 5_000 });
      }
      break;
    }

    case "select": {
      const loc = resolveLocator(page, action.selector);
      if (loc) {
        await loc.selectOption(action.value, { timeout: 5_000 });
      } else {
        await page.selectOption(action.selector, action.value, { timeout: 5_000 });
      }
      break;
    }

    case "pressKey":
      await page.keyboard.press(action.key);
      // Enter/Return often triggers navigation — wait for it to settle
      if (/^enter$/i.test(action.key)) {
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
      }
      break;

    case "hover": {
      const loc = resolveLocator(page, action.selector);
      if (loc) {
        await loc.hover({ timeout: 5_000 });
      } else {
        await page.hover(action.selector, { timeout: 5_000 });
      }
      break;
    }

    case "goto": {
      const validUrl = await validateUrl(action.url, urlOptions);
      await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      break;
    }

    case "wait":
      await page.waitForTimeout(action.ms);
      break;

    case "scroll": {
      const amount = action.amount ?? 500;
      await page.evaluate(({ dir, px }: { dir: string; px: number }) => {
        window.scrollBy(0, dir === "down" ? px : -px);
      }, { dir: action.direction, px: amount });
      break;
    }

    case "done":
      break;
  }
}
