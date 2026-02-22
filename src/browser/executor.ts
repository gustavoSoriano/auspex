import type { Page } from "playwright-core";
import type { AgentAction } from "../types.js";
import { validateUrl, type UrlValidationOptions } from "../security/url-validator.js";

export async function executeAction(
  page: Page,
  action: AgentAction,
  urlOptions: UrlValidationOptions,
): Promise<void> {
  switch (action.type) {
    case "click": {
      const urlBefore = page.url();
      await page.click(action.selector, { timeout: 10_000 });
      // If click triggered navigation, wait for it to settle
      if (page.url() !== urlBefore) {
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      }
      break;
    }

    case "type":
      await page.fill(action.selector, action.text, { timeout: 5_000 });
      break;

    case "goto": {
      const validUrl = await validateUrl(action.url, urlOptions);
      await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      break;
    }

    case "wait":
      await page.waitForTimeout(action.ms);
      break;

    case "scroll":
      await page.evaluate((dir: string) => {
        window.scrollBy(0, dir === "down" ? 500 : -500);
      }, action.direction);
      break;

    case "done":
      break;
  }
}
