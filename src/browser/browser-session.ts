import { chromium, type Browser, type Locator, type Page } from "playwright";

export type BrowserSessionOptions = {
  wsEndpoint: string;
  sheinNewProductNegotiationUrl: string;
};

export type LoginNavigationResult =
  | { status: "ready"; page: Page }
  | { status: "needs_manual_login"; page: Page; reason: string };

const LOGIN_BUTTON_SELECTOR = "button:has-text('\u767b\u5f55'), button:has-text('Login')";
const VERIFICATION_TEXT_PATTERN =
  /\u9a8c\u8bc1\u7801|\u9a8c\u8bc1|\u4e8c\u6b21\u9a8c\u8bc1|\u5b89\u5168\u9a8c\u8bc1|Verification|Verify/i;
const NAVIGATION_TIMEOUT_MS = 60_000;

export class BrowserSession {
  private browser?: Browser;

  async connect(wsEndpoint: string): Promise<Page> {
    this.browser = await chromium.connectOverCDP(wsEndpoint);

    const context = this.browser.contexts()[0] ?? await this.browser.newContext();
    return context.pages()[0] ?? await context.newPage();
  }

  async openShein(page: Page, url: string): Promise<LoginNavigationResult> {
    const targetUrl = url.trim();
    if (!targetUrl) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN new product negotiation URL is missing"
      };
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

    if (await isVisible(page.getByText(VERIFICATION_TEXT_PATTERN).first())) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN verification challenge is visible"
      };
    }

    const loginButton = page.locator(LOGIN_BUTTON_SELECTOR).first();
    if (await isVisible(loginButton)) {
      await loginButton.click();
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
    }

    if (await isVisible(page.locator(LOGIN_BUTTON_SELECTOR).first())) {
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

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}
