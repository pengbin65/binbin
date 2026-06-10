import type { Locator, Page } from "playwright";
import { evaluatePricing, parsePrice, type PricingInput } from "../domain/pricing.js";
import type { TaskStateStore } from "../domain/task-state.js";

export type RowPrices = PricingInput;

export type RetryOptions = {
  attempts: number;
  delayMs: number;
};

type ProductIdentity = {
  productId: string;
  rowText: string;
  hasStableProductId: boolean;
};

const TARGET_PAGE_TEXT_PATTERN = /新品议价|New Product Negotiation/i;
const ROW_SELECTOR = "tbody tr";
const REJECT_BUTTON_SELECTOR = "button:has-text('拒绝'), button:has-text('驳回'), button:has-text('Reject')";
const NEXT_PAGE_BUTTON_SELECTOR = "button:has-text('下一页'), button:has-text('Next')";
const PHASE = "shein";

export async function readRowPrices(row: Pick<Locator, "textContent">): Promise<RowPrices | null> {
  const text = await row.textContent().catch(() => null);
  if (!text) {
    return null;
  }

  const quotedPrice = extractLabelledPrice(text, "报价");
  const currentSellingPrice = extractLabelledPrice(text, "当前销售价");
  const officialSuggestedPrice = extractLabelledPrice(text, "官方建议价");

  if (quotedPrice === null || currentSellingPrice === null || officialSuggestedPrice === null) {
    return null;
  }

  return { quotedPrice, currentSellingPrice, officialSuggestedPrice };
}

export class SheinProcessor {
  private readonly rejectedProductIds = new Set<string>();
  private pageIndex = 1;

  constructor(
    private readonly page: Page,
    private readonly state: TaskStateStore,
    private readonly retry: RetryOptions
  ) {}

  async processAllPages(): Promise<void> {
    this.rejectedProductIds.clear();
    this.pageIndex = 1;
    this.state.setStatus("pricing");
    if (
      (await this.pauseOnFailure(
        () => this.withRetry(() => this.verifyCurrentPage(), "verify SHEIN page"),
        "verify SHEIN page"
      )) === null
    ) {
      return;
    }

    while (!this.state.shouldStop()) {
      if ((await this.pauseOnFailure(() => this.processCurrentPage(), "process SHEIN page")) === null) {
        return;
      }

      if (this.state.shouldStop()) {
        return;
      }

      if (this.state.shouldPause()) {
        this.state.markPaused();
        return;
      }

      const advanced = await this.pauseOnFailure(
        () => this.withRetry(() => this.advanceToNextPage(), "go to next page"),
        "go to next page"
      );
      if (advanced === null) {
        return;
      }

      if (this.state.shouldStop()) {
        return;
      }

      if (this.state.shouldPause()) {
        this.state.markPaused();
        return;
      }

      if (!advanced) {
        this.state.setStatus("completed");
        return;
      }

      this.pageIndex += 1;
    }
  }

  private async processCurrentPage(): Promise<void> {
    const rows = this.page.locator(ROW_SELECTOR);
    const count = await this.withRetry(() => rows.count(), "read product rows");

    for (let index = 0; index < count; index += 1) {
      await this.processRow(rows.nth(index), index);

      if (this.state.shouldStop() || this.state.shouldPause()) {
        return;
      }
    }
  }

  private async processRow(row: Locator, index: number): Promise<void> {
    const prices = await this.withRetry(async () => {
      const rowPrices = await readRowPrices(row);
      if (!rowPrices) {
        throw new Error("SHEIN row price data is unreadable");
      }
      return rowPrices;
    }, "read product prices").catch((error: unknown) => {
      if (isProcessingInterruptedError(error)) {
        this.applyInterruption(error);
        return null;
      }
      this.state.log(PHASE, `Price data unreadable: ${formatErrorMessage(error)}`, "error");
      this.state.requestPause();
      return null;
    });

    if (!prices) {
      return;
    }

    const decision = evaluatePricing(prices);
    const productIdentity = await extractProductIdentity(row, index, this.pageIndex);
    const { productId } = productIdentity;

    if (decision.passed) {
      this.state.recordResult({
        productId,
        ...prices,
        ...decision,
        action: "recorded",
        reason: decision.reason
      });
      return;
    }

    if (this.rejectedProductIds.has(productId)) {
      this.state.recordResult({
        productId,
        ...prices,
        ...decision,
        action: "skipped",
        reason: decision.reason,
        error: "Duplicate failed product id already rejected in this run"
      });
      return;
    }

    await this.withRetry(() => this.verifyCurrentPage(), "verify SHEIN page before reject");
    if (this.state.shouldStop()) {
      return;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return;
    }

    const currentProductIdentity = await this.withRetry(
      () => extractProductIdentity(row, index, this.pageIndex),
      "re-read product identity before reject"
    );
    if (!isSameProductIdentity(productIdentity, currentProductIdentity)) {
      this.state.log(
        PHASE,
        `Row identity changed before reject: expected ${productId}, found ${currentProductIdentity.productId}`,
        "error"
      );
      this.state.requestPause();
      this.state.markPaused();
      return;
    }

    const rejected = await this.withRetry(async () => {
      const rejectButton = await findVisible(row.locator(REJECT_BUTTON_SELECTOR), { propagateCountErrors: true });
      if (!rejectButton) {
        throw new Error("visible reject button not found");
      }
      if (this.state.shouldStop()) {
        return false;
      }
      if (this.state.shouldPause()) {
        this.state.markPaused();
        return false;
      }
      await rejectButton.click();
      return true;
    }, "reject failed product");
    if (!rejected || this.state.shouldStop()) {
      return;
    }
    this.rejectedProductIds.add(productId);

    this.state.recordResult({
      productId,
      ...prices,
      ...decision,
      action: "rejected",
      reason: decision.reason
    });
  }

  private async verifyCurrentPage(): Promise<void> {
    const marker = await findVisible(this.page.getByText(TARGET_PAGE_TEXT_PATTERN));
    if (!marker) {
      throw new Error("SHEIN New Product Negotiation page is not visible");
    }
  }

  private async advanceToNextPage(): Promise<boolean> {
    const nextButtons = this.page.locator(NEXT_PAGE_BUTTON_SELECTOR);
    const nextButtonCount = await this.countNextButtons(nextButtons);
    if (nextButtonCount === 0) {
      return false;
    }

    const nextButton = await findVisible(nextButtons, { propagateCountErrors: true });
    if (!nextButton) {
      throw new Error("Next page button selector found no visible button");
    }

    if (await nextButton.isDisabled()) {
      return false;
    }

    if (this.state.shouldStop()) {
      return false;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return false;
    }

    await nextButton.click();
    await waitForLoadStateIfAvailable(this.page);
    await this.verifyCurrentPage();
    return true;
  }

  private async countNextButtons(nextButtons: Locator): Promise<number> {
    const attempts = Math.max(1, this.retry.attempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      this.throwIfInterrupted();
      const count = await nextButtons.count();
      if (count > 0 || attempt === attempts) {
        return count;
      }

      this.state.log(PHASE, `Next page button absent on attempt ${attempt}`, "warn");
      await delay(this.retry.delayMs);
    }

    return 0;
  }

  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    const attempts = Math.max(1, this.retry.attempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      this.throwIfInterrupted();
      try {
        return await operation();
      } catch (error) {
        if (isProcessingInterruptedError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < attempts) {
          this.state.log(PHASE, `${label} attempt ${attempt} failed`, "warn");
          this.throwIfInterrupted();
          await delay(this.retry.delayMs);
        }
      }
    }

    throw new Error(`${label} failed: ${formatErrorMessage(lastError)}`);
  }

  private async pauseOnFailure<T>(operation: () => Promise<T>, label: string): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      if (isProcessingInterruptedError(error)) {
        this.applyInterruption(error);
        return null;
      }
      this.state.log(PHASE, `${label} failed: ${formatErrorMessage(error)}`, "error");
      this.state.requestPause();
      this.state.markPaused();
      return null;
    }
  }

  private throwIfInterrupted(): void {
    if (this.state.shouldStop()) {
      throw new ProcessingInterruptedError("stop");
    }

    if (this.state.shouldPause()) {
      throw new ProcessingInterruptedError("pause");
    }
  }

  private applyInterruption(error: ProcessingInterruptedError): void {
    if (error.reason === "pause") {
      this.state.markPaused();
    }
  }
}

async function findVisible(
  locator: Locator,
  options: { propagateCountErrors?: boolean } = {}
): Promise<Locator | null> {
  const count = await locator.count().catch((error: unknown) => {
    if (options.propagateCountErrors) {
      throw error;
    }
    return 0;
  });
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  if (count === 0 && (await locator.isVisible().catch(() => false))) {
    return locator;
  }

  return null;
}

async function extractProductIdentity(row: Locator, index: number, pageIndex: number): Promise<ProductIdentity> {
  const attr = await row.getAttribute("data-product-id").catch(() => null);
  if (attr) {
    return { productId: attr, rowText: "", hasStableProductId: true };
  }

  const text = (await row.textContent().catch(() => null)) ?? "";
  const match = /(?:商品ID|Product\s*ID|SKU|SPU)\s*[:：]?\s*([A-Za-z0-9_-]+)/i.exec(text);
  if (match) {
    return { productId: match[1], rowText: text, hasStableProductId: true };
  }

  return { productId: `page-${pageIndex}-row-${index + 1}`, rowText: text, hasStableProductId: false };
}

function isSameProductIdentity(expected: ProductIdentity, actual: ProductIdentity): boolean {
  if (expected.productId !== actual.productId) {
    return false;
  }

  return expected.hasStableProductId || expected.rowText === actual.rowText;
}

function extractLabelledPrice(text: string, label: string): number | null {
  const escapedLabel = escapeRegExp(label);
  const match = new RegExp(`${escapedLabel}\\s*[:：]?\\s*((?:[^\\d\\s-]+\\s*)?-?\\d[\\d,]*(?:\\.\\d+)?|--|—|-)`).exec(
    text
  );
  if (!match) {
    return null;
  }

  return parsePrice(match[1]);
}

async function waitForLoadStateIfAvailable(page: Page): Promise<void> {
  await page.waitForLoadState?.("domcontentloaded").catch(() => undefined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ProcessingInterruptedError extends Error {
  constructor(readonly reason: "pause" | "stop") {
    super(`Processing interrupted: ${reason}`);
  }
}

function isProcessingInterruptedError(error: unknown): error is ProcessingInterruptedError {
  return error instanceof ProcessingInterruptedError;
}
