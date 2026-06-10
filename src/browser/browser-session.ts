import { chromium, type Browser, type Locator, type Page } from "playwright";

export type LoginNavigationResult =
  | { status: "ready"; page: Page }
  | { status: "needs_manual_login"; page: Page; reason: string };

const LOGIN_BUTTON_SELECTOR = "button:has-text('\u767b\u5f55'), button:has-text('Login')";
const VERIFICATION_TEXT_PATTERN =
  /\u9a8c\u8bc1\u7801|\u9a8c\u8bc1|\u4e8c\u6b21\u9a8c\u8bc1|\u5b89\u5168\u9a8c\u8bc1|Verification|Verify/i;
const NAVIGATION_TIMEOUT_MS = 60_000;
const BRIEF_VISIBILITY_TIMEOUT_MS = 3_000;
const POST_LOGIN_VISIBILITY_TIMEOUT_MS = 2_000;

export class BrowserSession {
  private browser?: Browser;

  async connect(wsEndpoint: string): Promise<Page> {
    if (this.browser) {
      await this.close();
    }

    this.browser = await chromium.connectOverCDP(wsEndpoint);

    const context = this.browser.contexts()[0] ?? await this.browser.newContext();
    return context.pages()[0] ?? await context.newPage();
  }

  async openShein(page: Page, url?: string | null): Promise<LoginNavigationResult> {
    const targetUrl = url?.trim();
    if (!targetUrl) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN_NEW_PRODUCT_NEGOTIATION_URL is not configured"
      };
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

    if (await waitForVisible(page.getByText(VERIFICATION_TEXT_PATTERN).first(), BRIEF_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN verification challenge is visible"
      };
    }

    const loginButton = page.locator(LOGIN_BUTTON_SELECTOR).first();
    if (await waitForVisible(loginButton, BRIEF_VISIBILITY_TIMEOUT_MS)) {
      try {
        await loginButton.click();
      } catch (error) {
        return {
          status: "needs_manual_login",
          page,
          reason: `SHEIN login click failed: ${formatErrorMessage(error)}`
        };
      }

      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
    }

    if (await waitForVisible(page.getByText(VERIFICATION_TEXT_PATTERN).first(), POST_LOGIN_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN verification challenge is visible after login click"
      };
    }

    if (await waitForVisible(loginButton, POST_LOGIN_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN login button is still visible after navigation"
      };
    }

    return { status: "ready", page };
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
}

async function waitForVisible(locator: Locator, timeout: number): Promise<boolean> {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
