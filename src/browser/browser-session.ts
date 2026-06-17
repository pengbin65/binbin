import { chromium, type Browser, type Page } from "playwright";

export type LoginNavigationResult =
  | { status: "ready"; page: Page }
  | { status: "needs_manual_login"; page: Page; reason: string };

const LOGIN_BUTTON_SELECTOR = "button:has-text('\u767b\u5f55'), button:has-text('Login')";
const TARGET_PAGE_TEXT_PATTERN = /\u65b0\u54c1\u8bae\u4ef7|New Product Negotiation/i;
const PRICE_ADJUSTMENT_PAGE_TEXT_PATTERN =
  /\u4ef7\u683c\u5f85\u529e\u5217\u8868|\u62a5\u4ef7\u8bb0\u5f55|\u5e73\u53f0\u5efa\u8bae\u4ef7|Price Task List|Quote Record|Platform Suggested/i;
const PRICE_ADJUSTMENT_TASK_TEXT_PATTERN =
  /\u62a5\u4ef7\u8bb0\u5f55|\u5e73\u53f0\u5efa\u8bae\u4ef7|\u6279\u91cf\u786e\u8ba4\u4ef7\u683c|\u8bae\u4ef7\u5355\u53f7|Quote Record|Platform Suggested|Batch confirm/i;
const COMMODITY_LIST_TEXT_PATTERN = /\u5546\u54c1\u5217\u8868|Commodity List/i;
const PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN =
  /\u4ef7\u683c\u8c03\u6574\u5f85\u786e\u8ba4|\u4ef7\u683c\u8c03\u6574\u5f85\u529e|\u8bf7\u53ca\u65f6\u5904\u7406|Price Adjustment/i;
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

type PageLike = Page & {
  context?: () => {
    pages?: () => Page[];
  };
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

    const existingTaskPage = await findPricingTaskPage(page, POST_LOGIN_VISIBILITY_TIMEOUT_MS);
    if (existingTaskPage) {
      return { status: "ready", page: existingTaskPage };
    }

    const existingAdjustmentEntryPage = await findAdjustmentEntryPage(page, 500);
    if (existingAdjustmentEntryPage) {
      return { status: "ready", page: existingAdjustmentEntryPage };
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

    const adjustmentEntryPage = await findAdjustmentEntryPage(page, POST_LOGIN_VISIBILITY_TIMEOUT_MS);
    if (adjustmentEntryPage && adjustmentEntryPage !== page) {
      return { status: "ready", page: adjustmentEntryPage };
    }

    const adjustmentEntry = await findVisible(page.getByText(PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN), POST_LOGIN_VISIBILITY_TIMEOUT_MS);
    if (adjustmentEntry) {
      const readyTaskPage = await findPricingTaskPage(page, 500);
      if (readyTaskPage) {
        return { status: "ready", page: readyTaskPage };
      }
      return { status: "ready", page };
    }

    const readyPage = await findReadySheinPage(page, POST_LOGIN_VISIBILITY_TIMEOUT_MS);
    if (readyPage) {
      return { status: "ready", page: readyPage };
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

async function findReadySheinPage(page: Page, timeout: number, excludePages?: Set<Page>): Promise<Page | null> {
  const deadline = Date.now() + timeout;

  do {
    for (const candidatePage of getCandidatePages(page).filter((candidatePage) => !excludePages?.has(candidatePage))) {
      if (
        await findVisibleNow(candidatePage.getByText(TARGET_PAGE_TEXT_PATTERN))
        || await findVisibleNow(candidatePage.getByText(PRICE_ADJUSTMENT_PAGE_TEXT_PATTERN))
      ) {
        return candidatePage;
      }
    }

    await delay(100);
  } while (Date.now() < deadline);

  return null;
}

async function findPricingTaskPage(page: Page, timeout: number): Promise<Page | null> {
  const deadline = Date.now() + timeout;

  do {
    for (const candidatePage of getCandidatePages(page)) {
      const pageWithEvaluate = candidatePage as Page & {
        evaluate?: <T>(pageFunction: string) => Promise<T>;
      };
      if (typeof pageWithEvaluate.evaluate !== "function") {
        continue;
      }
      const hasPricingTaskText = await pageWithEvaluate.evaluate<string>("document.body ? document.body.innerText : ''")
        .then((text) => PRICE_ADJUSTMENT_TASK_TEXT_PATTERN.test(text))
        .catch(() => false);
      if (hasPricingTaskText) {
        await candidatePage.bringToFront().catch(() => undefined);
        return candidatePage;
      }
    }

    await delay(100);
  } while (Date.now() < deadline);

  return null;
}

async function findAdjustmentEntryPage(page: Page, timeout: number): Promise<Page | null> {
  const deadline = Date.now() + timeout;

  do {
    for (const candidatePage of getCandidatePages(page)) {
      const pageWithEvaluate = candidatePage as Page & {
        evaluate?: <T>(pageFunction: string) => Promise<T>;
      };
      if (typeof pageWithEvaluate.evaluate !== "function") {
        if (await findVisibleNow(candidatePage.getByText(PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN))) {
          return candidatePage;
        }
        continue;
      }

      const hasAdjustmentEntry = await pageWithEvaluate.evaluate<string>("document.body ? document.body.innerText : ''")
        .then((text) => PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN.test(text))
        .catch(() => false);
      if (hasAdjustmentEntry) {
        await candidatePage.bringToFront().catch(() => undefined);
        return candidatePage;
      }
    }

    await delay(100);
  } while (Date.now() < deadline);

  return null;
}

async function findReadyMarkerOnPage(page: Page, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;

  do {
    if (
      await findVisibleNow(page.getByText(TARGET_PAGE_TEXT_PATTERN))
      || await findVisibleNow(page.getByText(PRICE_ADJUSTMENT_PAGE_TEXT_PATTERN))
    ) {
      return true;
    }

    await delay(100);
  } while (Date.now() < deadline);

  return false;
}

function getCandidatePages(page: Page): Page[] {
  const contextPages = (page as PageLike).context?.().pages?.() ?? [];
  return [page, ...contextPages.filter((candidatePage) => candidatePage !== page)];
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
