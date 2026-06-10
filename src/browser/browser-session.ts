import { chromium, type Browser, type Page } from "playwright";

export type LoginNavigationResult =
  | { status: "ready"; page: Page }
  | { status: "needs_manual_login"; page: Page; reason: string };

const LOGIN_BUTTON_SELECTOR = "button:has-text('\u767b\u5f55'), button:has-text('Login')";
const TARGET_PAGE_TEXT_PATTERN = /\u65b0\u54c1\u8bae\u4ef7|New Product Negotiation/i;
const VERIFICATION_TEXT_PATTERN =
  /\u9a8c\u8bc1\u7801|\u9a8c\u8bc1|\u4e8c\u6b21\u9a8c\u8bc1|\u5b89\u5168\u9a8c\u8bc1|Verification|Verify/i;
const NAVIGATION_TIMEOUT_MS = 60_000;
const BRIEF_VISIBILITY_TIMEOUT_MS = 3_000;
const POST_LOGIN_VISIBILITY_TIMEOUT_MS = 2_000;

type VisibleLocator = {
  click?: () => Promise<void>;
};

type LocatorLike = {
  count?: () => Promise<number>;
  nth?: (index: number) => LocatorLike;
  isVisible?: () => Promise<boolean>;
  click?: () => Promise<void>;
};

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

    if (await findVisible(page.getByText(VERIFICATION_TEXT_PATTERN), BRIEF_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN verification challenge is visible"
      };
    }

    const loginButton = await findVisible(page.locator(LOGIN_BUTTON_SELECTOR), BRIEF_VISIBILITY_TIMEOUT_MS);
    if (loginButton) {
      try {
        await loginButton.click?.();
      } catch (error) {
        return {
          status: "needs_manual_login",
          page,
          reason: `SHEIN login click failed: ${formatErrorMessage(error)}`
        };
      }

      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
    }

    if (await findVisible(page.getByText(VERIFICATION_TEXT_PATTERN), POST_LOGIN_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN verification challenge is visible after login click"
      };
    }

    if (await findVisible(page.getByText(TARGET_PAGE_TEXT_PATTERN), POST_LOGIN_VISIBILITY_TIMEOUT_MS)) {
      return { status: "ready", page };
    }

    if (await findVisible(page.locator(LOGIN_BUTTON_SELECTOR), POST_LOGIN_VISIBILITY_TIMEOUT_MS)) {
      return {
        status: "needs_manual_login",
        page,
        reason: "SHEIN New Product Negotiation page is not visible"
      };
    }

    return {
      status: "needs_manual_login",
      page,
      reason: "SHEIN New Product Negotiation page is not visible"
    };
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
}

async function findVisible(locatorLike: LocatorLike, timeout: number): Promise<VisibleLocator | null> {
  const deadline = Date.now() + timeout;

  do {
    const visible = await findVisibleNow(locatorLike);
    if (visible) {
      return visible;
    }

    await delay(100);
  } while (Date.now() < deadline);

  return null;
}

async function findVisibleNow(locatorLike: LocatorLike): Promise<VisibleLocator | null> {
  if (locatorLike.count && locatorLike.nth) {
    const count = await locatorLike.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locatorLike.nth(index);
      if (await isLocatorVisible(candidate)) {
        return asVisibleLocator(candidate);
      }
    }
    return null;
  }

  if (await isLocatorVisible(locatorLike)) {
    return asVisibleLocator(locatorLike);
  }

  return null;
}

async function isLocatorVisible(locatorLike: LocatorLike): Promise<boolean> {
  if (!locatorLike.isVisible) {
    return false;
  }

  return locatorLike.isVisible().catch(() => false);
}

function asVisibleLocator(locatorLike: LocatorLike): VisibleLocator | null {
  return { click: locatorLike.click?.bind(locatorLike) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
