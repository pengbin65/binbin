import type { Locator, Page } from "playwright";
import { evaluatePricing, parsePrice, type PricingInput, type PricingRuleId } from "../domain/pricing.js";
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

type PageDecision = {
  productId: string;
  prices: RowPrices;
  decision: ReturnType<typeof evaluatePricing>;
};

type BatchDialogResult = {
  confirmed: boolean;
  appliedProductIds: string[];
  missingProductIds: string[];
  footerMatches: boolean;
};

export type BatchDialogCompletionPlan = {
  shouldCloseDialog: boolean;
  shouldConfirmDialog: boolean;
  shouldRecordResults: boolean;
  shouldRepeatCurrentPage: boolean;
};

type BatchHandleResponse = {
  status: number;
  text: string;
  stale: boolean;
  accepted: boolean;
};

const TARGET_PAGE_TEXT_PATTERN = /新品议价|价格调整|New Product Negotiation|Price Adjustment/i;
const PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN =
  /价格调整待确认|价格调整待办|价格调整|请及时处理|Price Adjustment/i;
const ROW_SELECTOR =
  ".soui-modal-body tbody tr:has-text('议价单号'), tbody tr:has-text('议价单号'), tbody tr:has-text('Bargain')";
const AGREE_BUTTON_SELECTOR =
  "button:has-text('\u540c\u610f\u5e73\u53f0\u5efa\u8bae\u4ef7'), a:has-text('\u540c\u610f\u5e73\u53f0\u5efa\u8bae\u4ef7'), span:has-text('\u540c\u610f\u5e73\u53f0\u5efa\u8bae\u4ef7'), button:has-text('Accept')";
const REJECT_BUTTON_SELECTOR = "button:has-text('拒绝'), button:has-text('驳回'), button:has-text('Reject')";
const ROW_CHECKBOX_SELECTOR =
  "label:has(input[type='checkbox']), input[type='checkbox'], .so-checkinput-checkbox-container, .so-checkinput-checkbox, .so-table-checkbox input[type='checkbox'], .arco-checkbox, .arco-checkbox-mask";
const SELECT_ALL_CHECKBOX_SELECTOR =
  ".soui-modal-body thead label:has(input[type='checkbox']), .soui-modal-body thead input[type='checkbox'], .soui-modal-body th.so-table-checkbox .so-checkinput-checkbox-container, thead label:has(input[type='checkbox']), thead input[type='checkbox'], th.so-table-checkbox .so-checkinput-checkbox-container";
const BATCH_CONFIRM_BUTTON_SELECTOR =
  ".soui-modal-body button:has-text('批量确认价格'), button:has-text('批量确认价格'), button:has-text('Batch confirm')";
const BATCH_DIALOG_CONFIRM_BUTTON_SELECTOR =
  ".soui-modal button:has-text('确定'), .soui-modal-panel button:has-text('确定'), button:has-text('确定'), button:has-text('确认'), button:has-text('Confirm')";
const REJECT_CONFIRM_BUTTON_SELECTOR = "button:has-text('确定'), button:has-text('确认'), button:has-text('Confirm')";
const NEXT_PAGE_TEXT_BUTTON_SELECTOR =
  ".soui-modal-body button:has-text('下一页'), button:has-text('下一页'), button:has-text('Next')";
const NEXT_PAGE_ICON_BUTTON_SELECTOR =
  ".soui-modal-panel .soui-pagination-buttons button, .soui-pagination-buttons button";
const PHASE = "shein";

export async function readRowPrices(
  row: Pick<Locator, "textContent">,
  pricingRule: PricingRuleId = "women_shein"
): Promise<RowPrices | null> {
  const text = await row.textContent().catch(() => null);
  if (!text) {
    return null;
  }

  const quotedPrice = extractFirstLabelledPrice(text, ["报价记录", "报价"]);
  const platformSuggestedPrice = extractFirstLabelledPrice(text, ["平台建议价"]);
  const currentSellingPrice = platformSuggestedPrice ?? extractFirstLabelledPrice(text, ["当前销售价"]);
  const officialSuggestedPrice = platformSuggestedPrice ?? extractFirstLabelledPrice(text, ["官方建议价"]);

  if (quotedPrice !== null && currentSellingPrice !== null && officialSuggestedPrice !== null) {
    return { quotedPrice, currentSellingPrice, officialSuggestedPrice };
  }

  return extractUnlabelledPendingTaskPrices(text, pricingRule);
}

export function extractBatchDialogProductId(text: string): string | null {
  const match =
    /SKC\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i.exec(text) ??
    /SPU\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i.exec(text);
  return match ? match[1] : null;
}

export function chooseBatchDialogItemIndex(
  productId: string | null,
  itemProductIds: readonly string[],
  appliedIndexes: ReadonlySet<number>,
  nextSequentialIndex: number
): number {
  if (productId) {
    const productIndex = itemProductIds.findIndex((itemProductId, index) =>
      itemProductId === productId && !appliedIndexes.has(index)
    );
    if (productIndex >= 0) {
      return productIndex;
    }
  }

  for (let index = Math.max(0, nextSequentialIndex); index < itemProductIds.length; index += 1) {
    if (!appliedIndexes.has(index)) {
      return index;
    }
  }

  return -1;
}

export function planBatchDialogCompletion(
  result: Pick<BatchDialogResult, "confirmed" | "footerMatches" | "missingProductIds">
): BatchDialogCompletionPlan {
  const hasMissingProducts = result.missingProductIds.length > 0;
  const isIncompleteUnconfirmedDialog = hasMissingProducts && !result.footerMatches && !result.confirmed;

  return {
    shouldCloseDialog: isIncompleteUnconfirmedDialog,
    shouldConfirmDialog: !isIncompleteUnconfirmedDialog && !result.confirmed,
    shouldRecordResults: !isIncompleteUnconfirmedDialog,
    shouldRepeatCurrentPage: hasMissingProducts
  };
}

async function readProductLevelRowPrices(
  row: Pick<Locator, "textContent">,
  pricingRule: PricingRuleId = "women_shein"
): Promise<RowPrices | null> {
  const text = await row.textContent().catch(() => null);
  if (!text) {
    return null;
  }

  const pendingPairs = extractUnlabelledPendingTaskPricePairs(text);
  if (pendingPairs.length > 0) {
    return pendingPairs.find((pair) => evaluatePricing(pair, pricingRule).passed) ?? pendingPairs[0] ?? null;
  }

  return readRowPrices(row, pricingRule);
}

export class SheinProcessor {
  private readonly rejectedProductIds = new Set<string>();
  private pageIndex = 1;
  private repeatCurrentPage = false;

  constructor(
    private readonly page: Page,
    private readonly state: TaskStateStore,
    private readonly retry: RetryOptions,
    private readonly pricingRule: PricingRuleId = "women_shein"
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

    await this.openPriceAdjustmentTasksIfPresent();

    while (!this.state.shouldStop()) {
      this.repeatCurrentPage = false;
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

      if (this.repeatCurrentPage) {
        continue;
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
    const count = await this.withRetry(() => this.readProductRowCount(), "read product rows").catch((error: unknown) => {
      if (this.pageIndex === 1 && formatErrorMessage(error).includes("no product rows rendered yet")) {
        this.state.log(PHASE, "No product rows found on first pricing page", "error");
        this.state.requestPause();
        this.state.markPaused();
        return 0;
      }
      throw error;
    });
    if (count === 0 && this.pageIndex === 1) {
      return;
    }

    const batchProcessed = await this.processCurrentPageWithBatchDialog(count);
    if (batchProcessed) {
      return;
    }

    let selectedRows = 0;
    const rows = this.page.locator(ROW_SELECTOR);
    for (let index = 0; index < count; index += 1) {
      if (await this.processRow(rows.nth(index), index)) {
        selectedRows += 1;
      }

      if (this.state.shouldStop() || this.state.shouldPause()) {
        return;
      }
    }

    if (selectedRows > 0) {
      await this.confirmSelectedRowsIfAvailable();
    }
  }

  private async processCurrentPageWithBatchDialog(count: number): Promise<boolean> {
    await this.closeExistingBatchDialogIfPresent();
    await this.openPriceAdjustmentTasksIfPresent();

    if (!(await this.selectCurrentPageRowsForBatch(count))) {
      return false;
    }

    const pageDecisions = await this.readCurrentPageDecisions(count);
    if (pageDecisions.length === 0) {
      return false;
    }

    if (!(await this.isBatchDialogOpen())) {
      const batchConfirm = await this.findEnabledBatchConfirmButton();
      if (!batchConfirm) {
        throw new Error("batch confirm button is not enabled after selecting current page");
      }

      await this.openBatchConfirmationDialog(batchConfirm);
      const pageWithEvaluate = this.page as Page & {
        evaluate?: <T>(pageFunction: string) => Promise<T>;
      };
      if (typeof pageWithEvaluate.evaluate === "function" && !(await this.isBatchDialogOpen())) {
        throw new Error("batch confirmation dialog did not open after clicking batch confirm price");
      }
    }

    const batchResult = await this.applyBatchDialogDecisions(pageDecisions);
    const completionPlan = planBatchDialogCompletion(batchResult);
    let batchConfirmOutcome: "not-needed" | "clicked" | "backend-accepted" | "backend-stale" = "not-needed";
    if (completionPlan.shouldCloseDialog) {
      await this.closeExistingBatchDialogIfPresent();
    } else if (completionPlan.shouldConfirmDialog || await this.isBatchDialogOpen()) {
      batchConfirmOutcome = await this.clickBatchDialogConfirm();
    }
    if (!completionPlan.shouldCloseDialog && this.hasPageEvaluate()) {
      await this.refreshPendingTaskDrawerAfterBatchSubmit();
      this.repeatCurrentPage = true;
    } else if (!completionPlan.shouldCloseDialog) {
      await this.waitAfterSheinAction("batch confirm selected rows");
    }

    const appliedProductIds = batchResult.appliedProductIds.length > 0
      ? new Set(batchResult.appliedProductIds)
      : new Set(pageDecisions.map((pageDecision) => pageDecision.productId));
    const recordedDecisions = completionPlan.shouldRecordResults
      ? pageDecisions.filter((pageDecision) => appliedProductIds.has(pageDecision.productId))
      : [];
    if (completionPlan.shouldRepeatCurrentPage) {
      this.state.log(
        PHASE,
        `Batch dialog did not include ${batchResult.missingProductIds.length} selected products; will reprocess current page`,
        "warn"
      );
    }
    if (completionPlan.shouldCloseDialog) {
      this.repeatCurrentPage = true;
      return true;
    }

    for (const pageDecision of recordedDecisions) {
      this.state.recordResult({
        productId: pageDecision.productId,
        ...pageDecision.prices,
        ...pageDecision.decision,
        action: pageDecision.decision.passed ? "confirmed" : "rejected",
        reason: pageDecision.decision.reason
      });
      if (!pageDecision.decision.passed) {
        this.rejectedProductIds.add(pageDecision.productId);
      }
    }

    return true;
  }

  private async openBatchConfirmationDialog(batchConfirm: Locator): Promise<void> {
    if (!this.hasPageEvaluate()) {
      await batchConfirm.click();
      return;
    }

    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      this.throwIfInterrupted();
      this.state.log(PHASE, `Waiting before opening batch confirmation dialog attempt ${attempt}`, "info");
      if (this.hasPageEvaluate()) {
        await delay(Math.max(this.retry.delayMs * 12, 12000));
      }
      const clickedInDom = await this.clickEnabledBatchConfirmButtonInDom();
      if (clickedInDom !== "clicked") {
        this.state.log(PHASE, `DOM batch confirmation click unavailable on attempt ${attempt}: ${clickedInDom}`, "warn");
        await batchConfirm.click({ timeout: 5000 }).catch((error: unknown) => {
          this.state.log(PHASE, `Locator batch confirmation click failed on attempt ${attempt}: ${formatErrorMessage(error)}`, "warn");
        });
      }
      this.state.log(PHASE, `Clicked batch confirmation button attempt ${attempt}: ${clickedInDom}`, "info");
      await this.waitForBatchDialogOpen(15000);
      if (await this.isBatchDialogOpen()) {
        this.state.log(PHASE, `Batch confirmation dialog opened on attempt ${attempt}`, "info");
        return;
      }
      if (attempt < attempts) {
        this.state.log(PHASE, `Batch confirmation dialog did not open on attempt ${attempt}; retrying slowly`, "warn");
        await delay(Math.max(this.retry.delayMs * 10, 10000));
      }
    }
  }

  private async closeExistingBatchDialogIfPresent(): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
      keyboard?: Page["keyboard"];
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    const closed = await pageWithEvaluate.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const modal = [...document.querySelectorAll("[class*='batchConfirmPrice_Content']")].filter(visible)[0];
        if (!modal) {
          return false;
        }
        const root = modal.closest(".soui-modal, .soui-modal-panel, [role='dialog'], [class*='modal']") || modal;
        const close = [...root.querySelectorAll(".soui-modal-header-close, [class*='modal-header-close'], button")]
          .filter(visible)
          .find((element) => {
            const text = (element.innerText || element.textContent || "").trim();
            return text === "" || text === "\\u53d6\\u6d88" || text === "Cancel";
          });
        if (!close) {
          return false;
        }
        close.click();
        return true;
      })()
    `).catch(() => false);

    const deadline = Date.now() + 15000;
    do {
      if (!(await this.isBatchDialogOpen())) {
        return;
      }
      await delay(500);
    } while (Date.now() < deadline);
  }

  private hasPageEvaluate(): boolean {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    return typeof pageWithEvaluate.evaluate === "function";
  }

  private async clickEnabledBatchConfirmButtonInDom(): Promise<"clicked" | "unsupported" | string> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
      mouse?: Page["mouse"];
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return "unsupported";
    }

    const target = await pageWithEvaluate.evaluate<{ x: number; y: number } | string>(`
      (async () => {
        const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        const buttons = [...document.querySelectorAll("button")]
          .filter((button) => visible(button)
            && textOf(button) === "\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c"
            && !button.disabled
            && !String(button.className).includes("disabled"));
        const button = buttons.find((candidate) => {
          const rootText = textOf(candidate.closest(".soui-modal-panel, .soui-modal, .soui-drawer-body, [class*='drawer']") || document.body);
          return /\\u5f85\\u529e\\u4efb\\u52a1|\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7/.test(rootText)
            && !/\\u65b0--\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u5171\\u6279\\u91cf\\u64cd\\u4f5c/.test(rootText);
        }) || buttons[0];
        if (!button) {
          return "not_found";
        }
        button.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(1200);
        const rect = button.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          return JSON.stringify({ reason: "button_offscreen_after_scroll", rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
        }
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `).catch((error: unknown) => `error:${error instanceof Error ? error.message : String(error)}`);
    if (typeof target === "string") {
      return target;
    }
    if (!pageWithEvaluate.mouse) {
      return "unsupported";
    }
    await this.page.bringToFront?.().catch(() => undefined);
    await pageWithEvaluate.mouse.move(target.x, target.y);
    await delay(500);
    await pageWithEvaluate.mouse.down();
    await delay(250);
    await pageWithEvaluate.mouse.up();
    return "clicked";
  }

  private async waitForBatchDialogOpen(timeoutMs = 180000): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    const deadline = Date.now() + timeoutMs;
    do {
      if (await this.isBatchDialogOpen()) {
        await delay(Math.min(Math.max(this.retry.delayMs, 1000), 3000));
        return;
      }
      await delay(500);
    } while (Date.now() < deadline);
  }

  private async selectCurrentPageRowsForBatch(count: number): Promise<boolean> {
    await this.logSelectionPageDiagnostics();
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: (() => T | Promise<T>) | string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate === "function" && await this.waitForSelectedRowCount(count, 3000)) {
      return true;
    }

    const clickedInDom = await this.clickDrawerSelectAllInDom();
    if (clickedInDom === "unsupported") {
      const selectAll = await findVisible(this.page.locator(SELECT_ALL_CHECKBOX_SELECTOR));
      if (!selectAll) {
        return false;
      }
      this.throwIfInterrupted();
      await selectAll.click();
    } else if (clickedInDom !== "clicked") {
      throw new Error(`select all checkbox in SHEIN price adjustment drawer was not found: ${clickedInDom}`);
    }

    await delay(Math.min(Math.max(this.retry.delayMs * 4, 3000), 6000));
    if (await this.waitForSelectedRowCount(count, 6000)) {
      return true;
    }

    const rowClicks = await this.clickCurrentPageRowCheckboxesInDom(count);
    if (rowClicks === "unsupported") {
      return false;
    }
    if (rowClicks !== "clicked") {
      throw new Error(`current page row checkboxes in SHEIN price adjustment drawer were not found: ${rowClicks}`);
    }

    await delay(Math.min(Math.max(this.retry.delayMs * 4, 3000), 6000));
    if (await this.waitForSelectedRowCount(count, 6000)) {
      return true;
    }

    throw new Error("select all did not select current page rows");
  }

  private async logSelectionPageDiagnostics(): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    const diagnostics = await pageWithEvaluate.evaluate<string>(`
      (() => {
        const text = document.body ? document.body.innerText : "";
        return JSON.stringify({
          href: window.location.href,
          hasQuote: text.includes("\\u62a5\\u4ef7\\u8bb0\\u5f55"),
          modalBoxes: document.querySelectorAll(".soui-modal-body .soui-checkbox-wrapper").length,
          checked: [...document.querySelectorAll(".soui-modal-body .soui-checkbox-wrapper")]
            .filter((element) => String(element.className).includes("checked")).length
        });
      })()
    `).catch((error: unknown) => `diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    this.state.log(PHASE, `Selection page diagnostics: ${diagnostics}`, "info");
  }

  private async clickDrawerSelectAllInDom(): Promise<"clicked" | "unsupported" | string> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: (() => T | Promise<T>) | string) => Promise<T>;
      mouse?: Page["mouse"];
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return "unsupported";
    }

    const target = await pageWithEvaluate.evaluate<{ x: number; y: number } | string>(`
      (async () => {
        const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const contextRe = new RegExp("\\u57fa\\u7840\\u4fe1\\u606f|\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7|\\u8bae\\u4ef7\\u5355\\u53f7");
        const taskTable = [...document.querySelectorAll("table, .soui-table-wrapper, .soui-table, [class*='table']")]
          .filter((element) => contextRe.test(element.innerText || ""))
          .sort((left, right) => {
            const leftText = left.innerText || "";
            const rightText = right.innerText || "";
            const leftHasPrice = /\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7/.test(leftText) ? 0 : 1;
            const rightHasPrice = /\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7/.test(rightText) ? 0 : 1;
            return leftHasPrice - rightHasPrice || rightText.length - leftText.length;
          })[0];
        if (!taskTable) {
          return JSON.stringify({
            reason: "task_table_not_found",
            href: window.location.href,
            modalBodies: [...document.querySelectorAll(".soui-modal-body, .soui-drawer-body, [class*='drawer-body']")].filter(visible).length,
            bodyText: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 300)
          });
        }
        let scrollParent = taskTable;
        for (let depth = 0; scrollParent && depth < 8; depth += 1, scrollParent = scrollParent.parentElement) {
          if (scrollParent.scrollHeight > scrollParent.clientHeight + 20) {
            scrollParent.scrollTop = 0;
          }
        }
        await sleep(800);
        const modal = taskTable.closest(".soui-modal, .soui-modal-panel, [class*='modal'], .soui-drawer, [class*='drawer']") || taskTable;
        const candidates = [...taskTable.querySelectorAll(
          "thead .allCheckBox, thead label.so-checkinput, thead .so-checkinput-checkbox-container, "
            + ".soui-table-header .allCheckBox, .soui-table-header label.so-checkinput, "
            + ".soui-table-header .so-checkinput-checkbox-container, "
            + "th .allCheckBox, th .soui-checkbox-wrapper, th [class*='checkbox'], th [role='checkbox']"
        )]
          .filter((element, index, elements) => visible(element) && elements.indexOf(element) === index)
          .sort((left, right) => {
            const leftText = (left.closest("table, .soui-modal-body, .soui-drawer-body, [class*='drawer-body']") || left.parentElement || left).innerText || "";
            const rightText = (right.closest("table, .soui-modal-body, .soui-drawer-body, [class*='drawer-body']") || right.parentElement || right).innerText || "";
            const leftInTaskTable = contextRe.test(leftText) ? 0 : 1;
            const rightInTaskTable = contextRe.test(rightText) ? 0 : 1;
            if (leftInTaskTable !== rightInTaskTable) {
              return leftInTaskTable - rightInTaskTable;
            }
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return (leftRect.top - rightRect.top) || (leftRect.left - rightRect.left);
          });
        const target = candidates[0];
        if (!target) {
          return JSON.stringify({
            reason: "not_found",
            href: window.location.href,
            taskTableText: (taskTable.innerText || "").slice(0, 300),
            taskCheckboxes: [...taskTable.querySelectorAll(".soui-checkbox-wrapper, .allCheckBox, label.so-checkinput, [role='checkbox']")].filter(visible).length,
            tableHeaders: [...taskTable.querySelectorAll("thead, .soui-table-header")].filter(visible).length
          });
        }
        target.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(800);
        const rect = target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          return JSON.stringify({
            reason: "target_offscreen_after_scroll",
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            taskTableText: (taskTable.innerText || "").slice(0, 200)
          });
        }
        const center = document.elementFromPoint(
          rect.left + Math.max(1, rect.width / 2),
          rect.top + Math.max(1, rect.height / 2)
        );
        if (center && !modal.contains(center)) {
          return JSON.stringify({
            reason: "target_center_intercepted",
            centerTag: center.tagName,
            centerClass: String(center.className),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          });
        }
        return { x: rect.left + Math.max(1, rect.width / 2), y: rect.top + Math.max(1, rect.height / 2) };
      })()
    `)
      .catch((error: unknown) => `not_found: ${error instanceof Error ? error.message : String(error)}`);
    if (typeof target === "string") {
      return target;
    }
    if (!pageWithEvaluate.mouse) {
      return "unsupported";
    }
    await this.page.bringToFront?.().catch(() => undefined);
    await pageWithEvaluate.mouse.move(target.x, target.y);
    await delay(500);
    await pageWithEvaluate.mouse.down();
    await delay(250);
    await pageWithEvaluate.mouse.up();
    return "clicked";
  }

  private async clickCurrentPageRowCheckboxesInDom(count: number): Promise<"clicked" | "unsupported" | string> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return "unsupported";
    }

    const maxRows = Math.max(1, count);
    return pageWithEvaluate.evaluate<string>(`
      (async () => {
        const expected = ${maxRows};
        const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        const contextRe = new RegExp("\\u57fa\\u7840\\u4fe1\\u606f|\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7|\\u8bae\\u4ef7\\u5355\\u53f7");
        const taskTable = [...document.querySelectorAll("table, .soui-table-wrapper, .soui-table, [class*='table']")]
          .filter((element) => contextRe.test(textOf(element)))
          .sort((left, right) => {
            const leftText = textOf(left);
            const rightText = textOf(right);
            const leftHasPrice = /\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7/.test(leftText) ? 0 : 1;
            const rightHasPrice = /\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7/.test(rightText) ? 0 : 1;
            return leftHasPrice - rightHasPrice || rightText.length - leftText.length;
          })[0];
        if (!taskTable) {
          return JSON.stringify({ reason: "task_table_not_found" });
        }
        let scrollParent = taskTable;
        for (let depth = 0; scrollParent && depth < 8; depth += 1, scrollParent = scrollParent.parentElement) {
          if (scrollParent.scrollHeight > scrollParent.clientHeight + 20) {
            scrollParent.scrollTop = 0;
          }
        }
        const rows = [...taskTable.querySelectorAll("tbody tr")]
          .filter((row) => visible(row) && /\\u8bae\\u4ef7\\u5355\\u53f7|SKU|SPU/.test(textOf(row)));
        if (rows.length === 0) {
          return JSON.stringify({ reason: "rows_not_found", taskTableText: textOf(taskTable).slice(0, 200) });
        }
        let clicked = 0;
        for (const row of rows.slice(0, expected)) {
          const alreadyChecked = [...row.querySelectorAll(".soui-checkbox-wrapper, label, [role='checkbox']")]
            .some((element) => visible(element) && String(element.className).includes("checked"));
          if (alreadyChecked) {
            clicked += 1;
            continue;
          }
          const target = [...row.querySelectorAll(".soui-checkbox-wrapper, label.so-checkinput, .so-checkinput-checkbox-container, [role='checkbox'], input[type='checkbox']")]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            })[0];
          if (!target) {
            continue;
          }
          target.scrollIntoView({ block: "center", inline: "nearest" });
          await sleep(350);
          const rect = target.getBoundingClientRect();
          const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) || target;
          for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
            center.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
          }
          target.click();
          clicked += 1;
          await sleep(450);
        }
        return clicked > 0 ? "clicked" : JSON.stringify({ reason: "no_row_checkbox_clicked", rowCount: rows.length });
      })()
    `).catch((error: unknown) => `not_found: ${error instanceof Error ? error.message : String(error)}`);
  }

  private async waitForSelectedRowCount(expectedCount = 1, timeoutMs = 30000): Promise<boolean> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: (() => T | Promise<T>) | string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return true;
    }

    const deadline = Date.now() + timeoutMs;
    let lastSelected = 0;
    do {
      const selected = await pageWithEvaluate.evaluate<number>(`
        (() => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
          const contextRe = new RegExp("\\u57fa\\u7840\\u4fe1\\u606f|\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7|\\u8bae\\u4ef7\\u5355\\u53f7");
          const bodies = [...document.querySelectorAll(".soui-modal-body, .soui-drawer-body, [class*='drawer-body']")]
            .filter((element) => visible(element) && contextRe.test(textOf(element)));
          const text = bodies.length > 0 ? textOf(bodies[0]) : (document.body.innerText || "");
          const selectedTextMatch = new RegExp("\\\\u5df2\\\\u9009\\\\u62e9\\\\s*(\\\\d+)\\\\s*\\\\u9879|\\\\u5df2\\\\u9009\\\\s*(\\\\d+)\\\\s*\\\\u6761").exec(text);
          if (selectedTextMatch) {
            return Number(selectedTextMatch[1] || selectedTextMatch[2] || 0);
          }
          return 0;
        })()
      `).catch(() => 0);
      lastSelected = selected;
      if (selected >= expectedCount) {
        return true;
      }
      await delay(500);
    } while (Date.now() < deadline);

    this.state.log(PHASE, `Timed out waiting for selected rows; last selected marker was ${lastSelected}`, "warn");
    return false;
  }

  private async readCurrentPageDecisions(count: number): Promise<PageDecision[]> {
    const rows = this.page.locator(ROW_SELECTOR);
    const pageDecisions: PageDecision[] = [];

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const rowPrices = await readProductLevelRowPrices(row, this.pricingRule);
      if (!rowPrices) {
        throw new Error("SHEIN row price data is unreadable");
      }

      const productIdentity = await extractProductIdentity(row, index, this.pageIndex);
      pageDecisions.push({
        productId: productIdentity.productId,
        prices: rowPrices,
        decision: evaluatePricing(rowPrices, this.pricingRule)
      });
    }

    const passed = pageDecisions.filter((pageDecision) => pageDecision.decision.passed).length;
    this.state.log(PHASE, `Current page batch decisions: agree ${passed}, reject ${pageDecisions.length - passed}`, "info");

    return pageDecisions;
  }

  private async applyBatchDialogDecisions(pageDecisions: PageDecision[]): Promise<BatchDialogResult> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return {
        confirmed: false,
        appliedProductIds: [],
        missingProductIds: [],
        footerMatches: false
      };
    }

    const itemsJson = JSON.stringify(pageDecisions.map((pageDecision) => ({
      productId: pageDecision.productId,
      passed: pageDecision.decision.passed
    })));
    const result = await pageWithEvaluate.evaluate<{
      applied: number;
      appliedProductIds?: string[];
      missing: string[];
      footerMatches: boolean;
      confirmed: boolean;
    }>(`
      (async () => {
        const items = ${itemsJson};
        const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textOf = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim();
        const centerY = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.y + rect.height / 2;
        };
        const findClickable = (element) => {
          let current = element;
          for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
            const tag = current.tagName;
            const role = current.getAttribute("role");
            const className = String(current.className);
            if (tag === "LABEL" || role === "radio" || className.includes("radio-wrapper")) {
              return current;
            }
          }
          return null;
        };
        const modal = [...document.querySelectorAll("[class*='batchConfirmPrice_Content']")]
          .filter(visible)
          .find((element) => {
            const text = textOf(element);
            return /\\u65b0--\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u4ef7\\u683c\\u64cd\\u4f5c|\\u62a5\\u4ef7\\u8bb0\\u5f55/.test(text);
          });
        if (!modal) {
          return { applied: 0, missing: items.map((item) => item.productId) };
        }

        let applied = 0;
        const missing = [];
        const expectedAgree = items.filter((item) => item.passed).length;
        const expectedReject = items.length - expectedAgree;
        const optionElements = [...modal.querySelectorAll("label, [role='radio'], .soui-radio-wrapper, input[type='radio']")]
          .filter(visible);
        const uniqueClickableOptions = (label) => {
          const seen = new Set();
          return optionElements
            .filter((element) => textOf(element).includes(label) || textOf(element.closest("label, .soui-radio-wrapper") || element).includes(label))
            .map((element) => findClickable(element))
            .filter((element) => element && visible(element))
            .filter((element) => {
              if (seen.has(element)) {
                return false;
              }
              seen.add(element);
              return true;
            })
            .sort((left, right) => centerY(left) - centerY(right));
        };
        const agreeOptions = uniqueClickableOptions("\\u540c\\u610f\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7");
        const rejectOptions = uniqueClickableOptions("\\u62d2\\u7edd\\uff0c\\u653e\\u5f03\\u4e0a\\u65b0");

        void agreeOptions;
        void rejectOptions;

        const rowProductId = (row) => {
          const match = /SKC\\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)|SPU\\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i.exec(textOf(row));
          return match ? (match[1] || match[2]) : null;
        };
        const scrollable = [...modal.querySelectorAll("*")]
          .filter((element) => visible(element) && element.scrollHeight > element.clientHeight + 40)
          .sort((left, right) => {
            const leftText = textOf(left);
            const rightText = textOf(right);
            const leftIsBatchTable = /\\u4ef7\\u683c\\u64cd\\u4f5c|\\u6279\\u91cf\\u9009\\u4e2d|\\u65b0\\u62a5\\u4ef7|\\u91cd\\u65b0\\u62a5\\u4ef7\\u539f\\u56e0/.test(leftText) ? 0 : 1;
            const rightIsBatchTable = /\\u4ef7\\u683c\\u64cd\\u4f5c|\\u6279\\u91cf\\u9009\\u4e2d|\\u65b0\\u62a5\\u4ef7|\\u91cd\\u65b0\\u62a5\\u4ef7\\u539f\\u56e0/.test(rightText) ? 0 : 1;
            if (leftIsBatchTable !== rightIsBatchTable) {
              return leftIsBatchTable - rightIsBatchTable;
            }
            const leftHasRows = left.querySelectorAll("tbody tr").length > 0 ? 0 : 1;
            const rightHasRows = right.querySelectorAll("tbody tr").length > 0 ? 0 : 1;
            if (leftHasRows !== rightHasRows) {
              return leftHasRows - rightHasRows;
            }
            return right.clientHeight - left.clientHeight;
          })[0] || modal;
        scrollable.scrollTop = 0;
        await sleep(700);
        const rowIsInView = (row) => {
          const rowRect = row.getBoundingClientRect();
          const scrollRect = scrollable.getBoundingClientRect();
          return rowRect.bottom > scrollRect.top + 20 && rowRect.top < scrollRect.bottom - 20;
        };
        const appliedIndexes = new Set();
        let nextSequentialIndex = 0;
        const chooseItemIndex = (productId) => {
          if (productId) {
            const productIndex = items.findIndex((item, index) => !appliedIndexes.has(index) && item.productId === productId);
            if (productIndex >= 0) {
              return productIndex;
            }
          }
          for (let index = nextSequentialIndex; index < items.length; index += 1) {
            if (!appliedIndexes.has(index)) {
              return index;
            }
          }
          return -1;
        };
        const markAlreadyApplied = () => {
          for (let index = 0; index < items.length; index += 1) {
            if (appliedIndexes.has(index)) {
              continue;
            }
            const item = items[index];
            const row = [...modal.querySelectorAll("tbody tr")]
              .filter((candidate) => visible(candidate) && rowIsInView(candidate) && rowProductId(candidate) === item.productId)[0];
            if (!row) {
              continue;
            }
            const label = item.passed ? "\\u540c\\u610f\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7" : "\\u62d2\\u7edd\\uff0c\\u653e\\u5f03\\u4e0a\\u65b0";
            const option = [...row.querySelectorAll(".soui-radio-wrapper")]
              .find((candidate) => textOf(candidate).includes(label));
            if (option && String(option.className).includes("checked")) {
              appliedIndexes.add(index);
              nextSequentialIndex = Math.max(nextSequentialIndex, index + 1);
            }
          }
        };

        for (let pass = 0; pass < 20 && appliedIndexes.size < items.length; pass += 1) {
          const rows = [...modal.querySelectorAll("tbody tr")]
            .filter((row) => visible(row) && rowIsInView(row))
            .sort((left, right) => centerY(left) - centerY(right));
          for (const row of rows) {
            const productId = rowProductId(row);
            const itemIndex = chooseItemIndex(productId);
            if (itemIndex < 0) {
              continue;
            }
            const item = items[itemIndex];
            const label = item.passed ? "\\u540c\\u610f\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7" : "\\u62d2\\u7edd\\uff0c\\u653e\\u5f03\\u4e0a\\u65b0";
            const option = [...row.querySelectorAll(".soui-radio-wrapper")]
              .find((candidate) => textOf(candidate).includes(label));
            if (!option) {
              continue;
            }
            option.scrollIntoView({ block: "center", inline: "nearest" });
            await sleep(250);
            option.click();
            appliedIndexes.add(itemIndex);
            nextSequentialIndex = Math.max(nextSequentialIndex, itemIndex + 1);
            applied += 1;
            await sleep(350);
          }

          markAlreadyApplied();
          if (appliedIndexes.size >= items.length) {
            break;
          }
          const before = scrollable.scrollTop;
          scrollable.scrollTop = before + Math.max(300, Math.floor(scrollable.clientHeight * 0.7));
          await sleep(700);
          if (scrollable.scrollTop === before) {
            break;
          }
        }

        const footerText = textOf(modal.querySelector(".soui-modal-footer, [class*='modal-footer']") || modal);
        const totalMatch = new RegExp("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c\\\\s*(\\\\d+)\\\\s*\\u4e2a\\u54c1").exec(footerText);
        const agreeMatch = new RegExp("\\u540c\\u610f\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7\\uff1a\\\\s*(\\\\d+)").exec(footerText);
        const rejectMatch = new RegExp("\\u62d2\\u7edd\\u5efa\\u8bae\\u4ef7\\uff1a\\\\s*(\\\\d+)").exec(footerText);
        const footerTotal = totalMatch ? Number(totalMatch[1]) : null;
        const footerAgree = agreeMatch ? Number(agreeMatch[1]) : null;
        const footerReject = rejectMatch ? Number(rejectMatch[1]) : null;
        const appliedItems = items.filter((_, index) => appliedIndexes.has(index));
        const appliedAgree = appliedItems.filter((item) => item.passed).length;
        const appliedReject = appliedItems.length - appliedAgree;
        const footerMatches =
          (footerAgree === expectedAgree && footerReject === expectedReject)
          || (footerTotal === appliedItems.length && footerAgree === appliedAgree && footerReject === appliedReject);

        let confirmed = false;
        if (footerMatches) {
          const footer = modal.querySelector(".soui-modal-footer, [class*='modal-footer']");
          const consent = footer
            ? [...footer.querySelectorAll(".soui-checkbox-wrapper, input[type='checkbox'], label, [class*='checkbox']")]
              .filter(visible)
              .find((element) => textOf(element).includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c") || String(element.className).includes("checkbox-wrapper"))
            : null;
          if (consent && !String(consent.className).includes("checked")) {
            const clickTarget = consent.querySelector(".soui-checkbox-indicator-wrapper, .soui-checkbox-indicator, input[type='checkbox']") || consent;
            clickTarget.click();
            await sleep(500);
          }
          const confirm = footer
            ? [...footer.querySelectorAll("button")]
              .filter(visible)
              .find((button) => /^(\\u786e\\u5b9a|\\u786e\\u8ba4|Confirm)$/.test(textOf(button)))
            : null;
          if (confirm && !confirm.disabled && !String(confirm.className).includes("disabled")) {
            confirm.click();
            confirmed = true;
            await sleep(500);
          }
        }

        const unapplied = items
          .map((item, index) => ({ item, index }))
          .filter(({ index }) => !appliedIndexes.has(index))
          .map(({ item }) => item.productId);
        const appliedProductIds = items
          .map((item, index) => ({ item, index }))
          .filter(({ index }) => appliedIndexes.has(index))
          .map(({ item }) => item.productId);

        return {
          applied,
          appliedProductIds,
          missing: unapplied.length > 0 ? unapplied : footerMatches ? [] : ["footer count mismatch"],
          footerMatches,
          confirmed
        };
      })()
    `);

    if (result.missing.length > 0 && !result.footerMatches && !result.confirmed) {
      this.state.log(
        PHASE,
        `Batch dialog decisions missing ${result.missing.length} products: ${result.missing.slice(0, 5).join(", ")}`,
        "warn"
      );
    }
    this.state.log(PHASE, `Applied ${result.applied} batch dialog decisions; footer match: ${result.footerMatches}; confirmed: ${result.confirmed}`, "info");
    return {
      confirmed: result.confirmed,
      appliedProductIds: result.appliedProductIds ?? [],
      missingProductIds: result.missing,
      footerMatches: result.footerMatches
    };
  }

  private async isBatchDialogOpen(): Promise<boolean> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return false;
    }

    return pageWithEvaluate.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        return [...document.querySelectorAll("[class*='batchConfirmPrice_Content'], .soui-modal-panel, .soui-modal, [role='dialog']")]
          .filter(visible)
          .some((element) => String(element.className).includes("batchConfirmPrice_Content")
            && /\\u65b0--\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u5171\\u6279\\u91cf\\u64cd\\u4f5c|\\u4ef7\\u683c\\u64cd\\u4f5c/.test(textOf(element))
            && [...element.querySelectorAll("button")].filter(visible).some((button) => /^(\\u786e\\u5b9a|\\u786e\\u8ba4|Confirm)$/.test(textOf(button))));
      })()
    `).catch(() => false);
  }

  private async clickBatchDialogConfirm(): Promise<"clicked" | "backend-accepted" | "backend-stale"> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
      mouse?: Page["mouse"];
    };
    if (typeof pageWithEvaluate.evaluate === "function" && pageWithEvaluate.mouse) {
      const deadline = Date.now() + 90000;
      let lastTargetResult = "not_started";
      do {
        const target = await pageWithEvaluate.evaluate<{ x: number; y: number } | string>(`
          (async () => {
            const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
            const visible = (element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            };
            const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
            const content = [...document.querySelectorAll("[class*='batchConfirmPrice_Content']")]
              .filter((element) => visible(element) && /\\u65b0--\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u4ef7\\u683c\\u64cd\\u4f5c/.test(textOf(element)))[0];
            const modal = content
              ? (content.closest(".soui-modal-panel, .soui-modal, [role='dialog']") || content)
              : [...document.querySelectorAll(".soui-modal-panel, .soui-modal, [role='dialog']")]
                .filter((element) => visible(element) && /\\u65b0--\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u4ef7\\u683c\\u64cd\\u4f5c/.test(textOf(element)))
                .sort((left, right) => {
                  const leftClass = String(left.className);
                  const rightClass = String(right.className);
                  const leftScore = leftClass.includes("merchant-ui-modal") ? 0 : leftClass.includes("drawer") ? 2 : 1;
                  const rightScore = rightClass.includes("merchant-ui-modal") ? 0 : rightClass.includes("drawer") ? 2 : 1;
                  if (leftScore !== rightScore) {
                    return leftScore - rightScore;
                  }
                  const leftRect = left.getBoundingClientRect();
                  const rightRect = right.getBoundingClientRect();
                  return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
                })[0];
            if (!modal) {
              return "no_modal";
            }
            const footer = [...modal.querySelectorAll(".soui-modal-footer, [class*='modal-footer']")]
              .filter((element) => visible(element) && textOf(element).includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c"))[0];
            if (!footer) {
              return "no_footer";
            }
            const consent = [...footer.querySelectorAll(".soui-checkbox-wrapper, input[type='checkbox'], label, [class*='checkbox']")]
              .filter(visible)
              .find((element) => textOf(element).includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c") || String(element.className).includes("checkbox-wrapper"));
            if (consent && !String(consent.className).includes("checked")) {
              const clickTarget = consent.querySelector(".soui-checkbox-indicator-wrapper, .soui-checkbox-indicator, input[type='checkbox']") || consent;
              clickTarget.click();
              await sleep(500);
            }
            const confirm = [...footer.querySelectorAll("button")]
              .filter(visible)
              .find((button) => /^(\\u786e\\u5b9a|\\u786e\\u8ba4|Confirm)$/.test(textOf(button)));
            if (!confirm) {
              return "no_confirm";
            }
            if (confirm.disabled || String(confirm.className).includes("disabled") || String(confirm.className).includes("loading")) {
              return "confirm_disabled";
            }
            confirm.scrollIntoView({ block: "center", inline: "nearest" });
            await sleep(500);
            const rect = confirm.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()
        `).catch((error: unknown) => `error:${error instanceof Error ? error.message : String(error)}`);
        lastTargetResult = typeof target === "string" ? target : "target_found";
        if (target === "no_modal") {
          return "clicked";
        }
        if (typeof target === "string") {
          await delay(700);
          continue;
        }
        const batchHandleResponse = this.waitForBatchHandleResponse(60000);
        await this.page.bringToFront?.().catch(() => undefined);
        await pageWithEvaluate.mouse.move(target.x, target.y);
        await delay(400);
        await pageWithEvaluate.mouse.down();
        await delay(200);
        await pageWithEvaluate.mouse.up();
        const backendResponse = await batchHandleResponse;
        if (backendResponse) {
          this.state.log(
            PHASE,
            `Batch handle backend response ${backendResponse.status}: ${backendResponse.text.slice(0, 180)}`,
            backendResponse.stale ? "warn" : "info"
          );
          if (backendResponse.stale) {
            return "backend-stale";
          }
          if (backendResponse.accepted) {
            return "backend-accepted";
          }
        }
        await delay(1200);
        if (!(await this.isBatchDialogOpen())) {
          return "clicked";
        }
        await delay(1000);
      } while (Date.now() < deadline);
      this.state.log(PHASE, `Batch confirmation mouse confirm target not found: ${lastTargetResult}`, "warn");
    }

    if (typeof pageWithEvaluate.evaluate === "function" && !(await this.isBatchDialogOpen())) {
      return "clicked";
    }

    if (typeof pageWithEvaluate.evaluate === "function") {
      const deadline = Date.now() + 90000;
      let lastResult = "not_started";
      do {
        const result = await pageWithEvaluate.evaluate<string>(`
          (() => {
            const visible = (element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            };
            const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
            const modals = [...document.querySelectorAll("[class*='batchConfirmPrice_Content'], .soui-modal-panel, .soui-modal, [role='dialog']")]
              .filter(visible);
            const modal = modals.find((element) =>
              String(element.className).includes("batchConfirmPrice_Content")
                && [...element.querySelectorAll("button")].filter(visible).some((button) => /^(\\u786e\\u5b9a|\\u786e\\u8ba4|Confirm)$/.test(textOf(button)))
            );
            if (!modal) {
              return JSON.stringify({
                status: "no_modal",
                modalCount: modals.length,
                modalTexts: modals.slice(-3).map((element) => textOf(element).slice(0, 80))
              });
            }
            const footerCandidates = [...modal.querySelectorAll("div, label, span")]
              .filter((element) => visible(element) && textOf(element).includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c"));
            const footer = footerCandidates.sort((left, right) => {
              const leftRect = left.getBoundingClientRect();
              const rightRect = right.getBoundingClientRect();
              return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
            })[0];
            const footerRoot = footer && (footer.closest(".soui-modal-footer, [class*='modal-footer']") || footer.parentElement);
            const consent = footerRoot
              ? [...footerRoot.querySelectorAll(".soui-checkbox-wrapper, input[type='checkbox'], label, [class*='checkbox']")]
                .filter(visible)
                .sort((left, right) => {
                  const leftText = textOf(left);
                  const rightText = textOf(right);
                  const leftScore = leftText.includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c") ? 0 : 1;
                  const rightScore = rightText.includes("\\u5171\\u6279\\u91cf\\u64cd\\u4f5c") ? 0 : 1;
                  return leftScore - rightScore
                    || Math.abs(left.getBoundingClientRect().y - footer.getBoundingClientRect().y)
                      - Math.abs(right.getBoundingClientRect().y - footer.getBoundingClientRect().y);
                })[0]
              : null;
            if (consent && !String(consent.className).includes("checked")) {
              const clickTarget = consent.querySelector(".soui-checkbox-indicator-wrapper, .soui-checkbox-indicator, input[type='checkbox']") || consent;
              const rect = clickTarget.getBoundingClientRect();
              const centerTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) || clickTarget;
              for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
                centerTarget.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
              }
              clickTarget.click();
              consent.click();
            }
            const buttons = [...modal.querySelectorAll("button")].filter(visible);
            const confirm = buttons.find((button) => /^(\\u786e\\u5b9a|\\u786e\\u8ba4|Confirm)$/.test(textOf(button)));
            if (!confirm) {
              return JSON.stringify({
                status: "no_confirm",
                modalText: textOf(modal).slice(0, 160),
                footerFound: Boolean(footer),
                consentFound: Boolean(consent),
                buttons: buttons.map((button) => textOf(button)).slice(-8)
              });
            }
            if (confirm.disabled || String(confirm.className).includes("disabled")) {
              return JSON.stringify({
                status: "confirm_disabled",
                footerFound: Boolean(footer),
                consentFound: Boolean(consent),
                consentClass: consent ? String(consent.className) : "",
                confirmClass: String(confirm.className)
              });
            }
            confirm.click();
            return "clicked";
          })()
        `).catch((error: unknown) => `error:${error instanceof Error ? error.message : String(error)}`);
        lastResult = result;
        if (result === "clicked") {
          const backendResponse = await this.waitForBatchHandleResponse(60000);
          if (backendResponse) {
            this.state.log(
              PHASE,
              `Batch handle backend response ${backendResponse.status}: ${backendResponse.text.slice(0, 180)}`,
              backendResponse.stale ? "warn" : "info"
            );
            if (backendResponse.stale) {
              return "backend-stale";
            }
            if (backendResponse.accepted) {
              return "backend-accepted";
            }
          }
          return "clicked";
        }
        await delay(500);
      } while (Date.now() < deadline);
      this.state.log(PHASE, `Batch confirmation dialog confirm diagnostics: ${lastResult}`, "warn");
    }

    const dialogConfirm = await findVisibleEnabledButtonByExactText(
      this.page.locator(BATCH_DIALOG_CONFIRM_BUTTON_SELECTOR),
      ["确定", "确认", "Confirm"]
    );
    if (!dialogConfirm) {
      throw new Error("batch confirmation dialog confirm button not found");
    }
    this.throwIfInterrupted();
    await dialogConfirm.click();
    return "clicked";
  }

  private async waitForBatchHandleResponse(timeoutMs: number): Promise<BatchHandleResponse | null> {
    const pageWithResponse = this.page as Page & {
      waitForResponse?: Page["waitForResponse"];
    };
    if (typeof pageWithResponse.waitForResponse !== "function") {
      return null;
    }

    const response = await pageWithResponse.waitForResponse(
      (candidate) => /batch_handle_cost_discuss|batch.*discuss|handle.*discuss/i.test(candidate.url()),
      { timeout: timeoutMs }
    ).catch(() => null);
    if (!response) {
      return null;
    }

    const status = response.status();
    const text = await response.text().catch(() => "");
    const stale = /没有待商家处理状态订单需要处理|\\u6ca1\\u6709\\u5f85\\u5546\\u5bb6\\u5904\\u7406\\u72b6\\u6001\\u8ba2\\u5355\\u9700\\u8981\\u5904\\u7406|dpas0100/i.test(text);
    const failed = /失败|错误|异常|error|fail/i.test(text) && !stale;
    const accepted = status >= 200 && status < 300 && !failed;
    return { status, text, stale, accepted };
  }

  private async refreshPendingTaskDrawerAfterBatchSubmit(): Promise<void> {
    await this.closeExistingBatchDialogIfPresent();

    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      await waitForLoadStateIfAvailable(this.page);
      return;
    }

    const clicked = await pageWithEvaluate.evaluate<string>(`
      (() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        const drawer = [...document.querySelectorAll(".soui-modal-panel, .soui-modal, [role='dialog']")]
          .filter(visible)
          .find((element) => /\\u5f85\\u529e\\u4efb\\u52a1|\\u4ef7\\u683c\\u8c03\\u6574\\u5f85\\u529e/.test(textOf(element)));
        if (!drawer) {
          return "no_drawer";
        }
        const clear = [...drawer.querySelectorAll("button, a, span")]
          .filter(visible)
          .find((element) => textOf(element) === "\\u6e05\\u7a7a");
        if (clear) {
          clear.click();
        }
        const search = [...drawer.querySelectorAll("button")]
          .filter(visible)
          .find((element) => textOf(element) === "\\u641c\\u7d22" && !element.disabled);
        if (!search) {
          return clear ? "cleared_no_search" : "no_search";
        }
        search.click();
        return clear ? "cleared_and_searched" : "searched";
      })()
    `).catch((error: unknown) => `error:${formatErrorMessage(error)}`);

    this.state.log(PHASE, `Refreshed pending task drawer after batch submit: ${clicked}`, "info");
    await waitForLoadStateIfAvailable(this.page);
    await delay(Math.max(this.retry.delayMs * 8, 8000));
    await this.refreshPendingTaskDrawerIfLoadFailed();
  }

  private async openPriceAdjustmentTasksIfPresent(): Promise<void> {
    if (await this.isPendingTaskModalOpen()) {
      await this.refreshPendingTaskDrawerIfLoadFailed();
      if (await this.hasPendingTaskContent()) {
        return;
      }
    }

    const entry = await findVisible(this.page.getByText(PRICE_ADJUSTMENT_ENTRY_TEXT_PATTERN));
    if (!entry) {
      if (await this.isPendingTaskDrawerVisible()) {
        return;
      }
      return;
    }

    if (this.state.shouldStop()) {
      return;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return;
    }

    await this.clickPriceAdjustmentEntry(entry);
    await waitForLoadStateIfAvailable(this.page);
    await delay(Math.max(this.retry.delayMs * 6, 6000));
    await this.refreshPendingTaskDrawerIfLoadFailed();
    await this.withRetry(async () => {
      await this.refreshPendingTaskDrawerIfLoadFailed();
      if (!(await this.isPendingTaskDrawerVisible())) {
        throw new Error("price adjustment task drawer is not visible after click");
      }
    }, "open price adjustment task drawer");
  }

  private async clickPriceAdjustmentEntry(entry: Locator): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };

    const clickedInDom = typeof pageWithEvaluate.evaluate === "function"
      ? await pageWithEvaluate.evaluate<boolean>(`
        (() => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const clickableAncestor = (element) => {
            let current = element;
            for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
              const style = window.getComputedStyle(current);
              const role = current.getAttribute("role");
              if (current.tagName === "BUTTON" || current.tagName === "A" || role === "button" || style.cursor === "pointer") {
                return current;
              }
            }
            return element;
          };
          const pattern = new RegExp("\\\\u4ef7\\\\u683c\\\\u8c03\\\\u6574\\\\u5f85\\\\u786e\\\\u8ba4|\\\\u4ef7\\\\u683c\\\\u8c03\\\\u6574\\\\u5f85\\\\u529e|\\\\u8bf7\\\\u53ca\\\\u65f6\\\\u5904\\\\u7406|Price Adjustment", "i");
          const pageArea = window.innerWidth * window.innerHeight;
          const candidates = [...document.querySelectorAll("button,a,[role='button'],div,span")]
            .filter((element) => pattern.test(element.innerText || element.textContent || ""))
            .filter(visible)
            .map((element) => clickableAncestor(element))
            .filter((element, index, elements) => elements.indexOf(element) === index)
            .filter(visible)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const text = element.innerText || element.textContent || "";
              const cursor = window.getComputedStyle(element).cursor;
              const area = rect.width * rect.height;
              return {
                element,
                area,
                score: (cursor === "pointer" ? 1000 : 0) + (text.includes("\\\\u8bf7\\\\u53ca\\\\u65f6\\\\u5904\\\\u7406") ? 200 : 0) - (area / Math.max(pageArea, 1))
              };
            })
            .filter((candidate) => candidate.area > 0 && candidate.area < pageArea * 0.35)
            .sort((left, right) => right.score - left.score || left.area - right.area);
          const target = candidates[0] && candidates[0].element;
          if (!target) {
            return false;
          }
          target.click();
          return true;
        })()
      `).catch(() => false)
      : false;

    if (!clickedInDom) {
      await entry.click();
    }
  }

  private async refreshPendingTaskDrawerIfLoadFailed(): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const clicked = await pageWithEvaluate.evaluate<boolean>(`
        (() => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const textOf = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
          const drawer = [...document.querySelectorAll(".soui-modal-panel, .soui-modal, [role='dialog']")]
            .filter(visible)
            .find((element) => /\\u5f85\\u529e\\u4efb\\u52a1|\\u4ef7\\u683c\\u8c03\\u6574\\u5f85\\u529e/.test(textOf(element)));
          if (!drawer || !/\\u52a0\\u8f7d\\u5931\\u8d25|\\u518d\\u6b21\\u5237\\u65b0/.test(textOf(drawer))) {
            return false;
          }
          const refresh = [...drawer.querySelectorAll("button, a, span, div")]
            .filter(visible)
            .find((element) => textOf(element) === "\\u518d\\u6b21\\u5237\\u65b0" || textOf(element) === "\\u5237\\u65b0");
          if (!refresh) {
            return false;
          }
          refresh.click();
          return true;
        })()
      `).catch(() => false);

      if (!clicked) {
        return;
      }

      this.state.log(PHASE, `Pending task drawer load failed; clicked refresh attempt ${attempt}`, "warn");
      await delay(Math.max(this.retry.delayMs * 4, 4000));
      if (await this.hasPendingTaskContent()) {
        return;
      }
    }
  }

  private async isPendingTaskDrawerVisible(): Promise<boolean> {
    return this.hasPendingTaskContent();
  }

  private async hasPendingTaskContent(): Promise<boolean> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return Boolean(await findVisible(this.page.locator(BATCH_CONFIRM_BUTTON_SELECTOR)) || await findVisible(this.page.locator(ROW_SELECTOR)));
    }

    return pageWithEvaluate.evaluate<boolean>(`
      (() => {
        const text = document.body ? document.body.innerText : "";
        return /\\u62a5\\u4ef7\\u8bb0\\u5f55|\\u5e73\\u53f0\\u5efa\\u8bae\\u4ef7|\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u8bae\\u4ef7\\u5355\\u53f7/.test(text);
      })()
    `).catch(() => false);
  }

  private async isPendingTaskModalOpen(): Promise<boolean> {
    return Boolean(await findVisible(this.page.locator(".soui-modal-body")));
  }

  private async processCurrentPageBatchIfAvailable(): Promise<"processed" | "unavailable" | "empty"> {
    const count = await this.page.locator(ROW_SELECTOR).count().catch(() => 0);
    if (count === 0) {
      const hasBatchControls =
        (await findVisible(this.page.locator(SELECT_ALL_CHECKBOX_SELECTOR)))
        || (await findVisible(this.page.locator(BATCH_CONFIRM_BUTTON_SELECTOR)));
      return hasBatchControls ? "empty" : "unavailable";
    }

    const selectAll = await findVisible(this.page.locator(SELECT_ALL_CHECKBOX_SELECTOR));
    if (!selectAll) {
      return "unavailable";
    }

    if (this.state.shouldStop()) {
      return "empty";
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return "empty";
    }

    await selectAll.click();
    await delay(Math.min(Math.max(this.retry.delayMs, 500), 1500));

    const batchConfirm = await this.findEnabledBatchConfirmButton();
    if (!batchConfirm) {
      return "unavailable";
    }

    await batchConfirm.click();
    await delay(Math.min(Math.max(this.retry.delayMs, 800), 2000));

    const dialogConfirm = await findVisibleEnabledButtonByExactText(
      this.page.locator(BATCH_DIALOG_CONFIRM_BUTTON_SELECTOR),
      ["确定", "确认", "Confirm"]
    );
    if (!dialogConfirm) {
      throw new Error("batch confirmation dialog confirm button not found");
    }

    await dialogConfirm.click();
    await waitForLoadStateIfAvailable(this.page);
    await delay(Math.min(Math.max(this.retry.delayMs, 1500), 3000));
    await this.clickFollowUpConfirmIfPresent();

    this.state.recordResult({
      productId: `batch-page-${this.pageIndex}`,
      quotedPrice: count,
      originalPrice: 0,
      threshold70Percent: 0,
      currentSellingPrice: 0,
      officialSuggestedPrice: 0,
      passed: true,
      action: "confirmed",
      reason: `BATCH_CONFIRMED_${count}`
    });
    this.state.log(PHASE, `Batch confirmed current page selection: ${count} rows`, "info");
    return "processed";
  }

  private async findEnabledBatchConfirmButton(): Promise<Locator | null> {
    const attempts = Math.max(1, this.retry.attempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const button = await findVisible(this.page.locator(BATCH_CONFIRM_BUTTON_SELECTOR));
      if (button && !(await button.isDisabled().catch(() => false))) {
        return button;
      }
      if (attempt < attempts) {
        await delay(this.retry.delayMs);
      }
    }
    return null;
  }

  private async clickFollowUpConfirmIfPresent(): Promise<void> {
    const followUpConfirm = await findVisibleEnabledButtonByExactText(
      this.page.locator(BATCH_DIALOG_CONFIRM_BUTTON_SELECTOR),
      ["确定", "确认", "Confirm"]
    );
    if (followUpConfirm) {
      await followUpConfirm.click();
      await waitForLoadStateIfAvailable(this.page);
      await delay(Math.min(Math.max(this.retry.delayMs, 1000), 2500));
    }
  }

  private async ensureHundredRowsPerPage(): Promise<void> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    const clicked = await pageWithEvaluate.evaluate(() => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const controls = [...document.querySelectorAll<HTMLElement>(".soui-pagination-options, .soui-select, [class*='pagination']")];
      const current = controls.reverse().find((element) => /\/\s*页|\/\s*page/i.test(element.textContent ?? "") && visible(element));
      current?.click();
      return Boolean(current);
    }).catch(() => false);

    if (!clicked) {
      return;
    }

    await delay(500);
    const hundredOption = await findVisible(this.page.getByText(/100\s*\/\s*页|100\s*\/\s*page/i));
    if (!hundredOption) {
      return;
    }

    await hundredOption.click();
    await waitForLoadStateIfAvailable(this.page);
    await delay(Math.min(Math.max(this.retry.delayMs, 1000), 2500));
  }

  private async processRow(row: Locator, index: number, retriedAfterRowShift = false): Promise<boolean> {
    const prices = await this.withRetry(async () => {
      const rowPrices = await readRowPrices(row, this.pricingRule);
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
      return false;
    }

    const decision = evaluatePricing(prices, this.pricingRule);
    const productIdentity = await extractProductIdentity(row, index, this.pageIndex);
    const { productId } = productIdentity;

    if (decision.passed) {
      const agreed = await this.agreePlatformPriceIfAvailable(row);
      if (agreed) {
        this.state.recordResult({
          productId,
          ...prices,
          ...decision,
          action: "confirmed",
          reason: decision.reason
        });
        return false;
      }

      const selected = await this.selectRowForBatchConfirm(row);
      this.state.recordResult({
        productId,
        ...prices,
        ...decision,
        action: selected ? "confirmed" : "recorded",
        reason: decision.reason
      });
      return selected;
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
      return false;
    }

    await this.withRetry(() => this.verifyCurrentPage(), "verify SHEIN page before reject");
    if (this.state.shouldStop()) {
      return false;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return false;
    }

    const rejectRow = await this.withRetry(
      () => this.findCurrentRowForProduct(productIdentity, row, index),
      "locate product row before reject"
    );
    if (!rejectRow) {
      const currentProductIdentity = await extractProductIdentity(row, index, this.pageIndex);
      const message = `Row identity changed before reject: expected ${productId}, found ${currentProductIdentity.productId}`;
      if (!retriedAfterRowShift) {
        this.state.log(PHASE, `${message}; retrying current row`, "warn");
        return this.processRow(row, index, true);
      }

      this.state.log(PHASE, `${message}; skipping stale row`, "warn");
      return false;
    }

    const rejected = await this.withRetry(async () => {
      const rejectButton = await findVisible(rejectRow.locator(REJECT_BUTTON_SELECTOR), { propagateCountErrors: true });
      if (!rejectButton) {
        throw new Error("visible reject button not found");
      }
      if (await rejectButton.isDisabled()) {
        if (await this.confirmActionIfAvailable()) {
          return true;
        }
        return false;
      }
      if (this.state.shouldStop()) {
        return false;
      }
      if (this.state.shouldPause()) {
        this.state.markPaused();
        return false;
      }
      await rejectButton.click();
      await this.confirmActionWithRetry();
      await this.waitAfterSheinAction("reject failed product");
      return true;
    }, "reject failed product");
    if (!rejected || this.state.shouldStop()) {
      return false;
    }
    this.rejectedProductIds.add(productId);

    this.state.recordResult({
      productId,
      ...prices,
      ...decision,
      action: "rejected",
      reason: decision.reason
    });
    return false;
  }

  private async agreePlatformPriceIfAvailable(row: Locator): Promise<boolean> {
    const agreeButton = await findVisible(row.locator(AGREE_BUTTON_SELECTOR), { propagateCountErrors: true });
    if (!agreeButton) {
      return false;
    }

    if (this.state.shouldStop()) {
      return false;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return false;
    }

    await agreeButton.click();
    await this.confirmActionWithRetry();
    await this.waitAfterSheinAction("agree platform suggested price");
    return true;
  }

  private async findCurrentRowForProduct(
    expected: ProductIdentity,
    originalRow: Locator,
    originalIndex: number
  ): Promise<Locator | null> {
    const current = await extractProductIdentity(originalRow, originalIndex, this.pageIndex);
    if (isSameProductIdentity(expected, current)) {
      return originalRow;
    }

    if (!expected.hasStableProductId) {
      return null;
    }

    const rows = this.page.locator(ROW_SELECTOR);
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = rows.nth(index);
      const candidateIdentity = await extractProductIdentity(candidate, index, this.pageIndex);
      if (candidateIdentity.hasStableProductId && candidateIdentity.productId === expected.productId) {
        return candidate;
      }
    }

    return null;
  }

  private async readProductRowCount(): Promise<number> {
    const count = await this.page.locator(ROW_SELECTOR).count();
    if (count === 0 && this.pageIndex === 1) {
      throw new Error("no product rows rendered yet");
    }
    return count;
  }

  private async confirmActionWithRetry(): Promise<void> {
    const attempts = Math.max(1, this.retry.attempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (await this.confirmActionIfAvailable()) {
        return;
      }
      if (attempt < attempts) {
        await delay(this.retry.delayMs);
      }
    }
  }

  private async confirmActionIfAvailable(): Promise<boolean> {
    const confirmButton = await findVisibleEnabledButtonByExactText(
      this.page.locator(REJECT_CONFIRM_BUTTON_SELECTOR),
      ["确定", "确认", "Confirm"]
    );
    if (!confirmButton) {
      return false;
    }

    if (this.state.shouldStop()) {
      return false;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return false;
    }

    await confirmButton.click();
    await waitForLoadStateIfAvailable(this.page);
    return true;
  }

  private async verifyCurrentPage(): Promise<void> {
    const marker = await findVisible(this.page.getByText(TARGET_PAGE_TEXT_PATTERN));
    if (!marker) {
      throw new Error("SHEIN New Product Negotiation page is not visible");
    }
  }

  private async selectRowForBatchConfirm(row: Locator): Promise<boolean> {
    const checkbox = await findVisible(row.locator(ROW_CHECKBOX_SELECTOR));
    if (!checkbox) {
      return false;
    }

    if (this.state.shouldStop()) {
      return false;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return false;
    }

    await checkbox.click();
    await delay(Math.min(Math.max(this.retry.delayMs, 800), 2000));
    return true;
  }

  private async confirmSelectedRowsIfAvailable(): Promise<void> {
    const confirmButton = await findVisible(this.page.locator(BATCH_CONFIRM_BUTTON_SELECTOR));
    if (!confirmButton) {
      return;
    }

    if (this.state.shouldStop()) {
      return;
    }

    if (this.state.shouldPause()) {
      this.state.markPaused();
      return;
    }

    await confirmButton.click();
    await waitForLoadStateIfAvailable(this.page);
    await this.waitAfterSheinAction("batch confirm selected rows");
  }

  private async waitAfterSheinAction(label: string): Promise<void> {
    await waitForLoadStateIfAvailable(this.page);

    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return;
    }

    await delay(this.actionSettleDelayMs());

    const deadline = Date.now() + 30000;
    do {
      if (label.includes("batch confirm") && !(await this.isBatchDialogOpen())) {
        return;
      }
      if (!(await this.hasVisibleSheinLoading())) {
        return;
      }
      await delay(1000);
    } while (Date.now() < deadline);

    throw new Error(`${label} still loading after wait`);
  }

  private actionSettleDelayMs(): number {
    return Math.max(this.retry.delayMs * 8, 8000);
  }

  private async hasVisibleSheinLoading(): Promise<boolean> {
    const pageWithEvaluate = this.page as Page & {
      evaluate?: <T>(pageFunction: string) => Promise<T>;
    };
    if (typeof pageWithEvaluate.evaluate !== "function") {
      return false;
    }

    return pageWithEvaluate.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const inViewport = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        };
        const blockingModal = [...document.querySelectorAll(".soui-modal-body, .soui-drawer-body")]
          .filter((element) => visible(element) && inViewport(element))
          .find((element) => /\\u6279\\u91cf\\u786e\\u8ba4\\u4ef7\\u683c|\\u5171\\u6279\\u91cf\\u64cd\\u4f5c|\\u786e\\u5b9a|Confirm/i.test(element.innerText || ""));
        const loadingCandidates = blockingModal
          ? [...blockingModal.querySelectorAll(".soui-button-loading, .soui-spin, [aria-busy='true']")]
          : [...document.querySelectorAll(".soui-button-loading, button[aria-busy='true']")];
        return loadingCandidates.some((element) => visible(element) && inViewport(element));
      })()
    `).catch(() => false);
  }

  private async advanceToNextPage(): Promise<boolean> {
    const nextButton = await this.findNextPageButtonWithRetry();
    if (!nextButton) {
      return false;
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

  private async findNextPageButtonWithRetry(): Promise<Locator | null> {
    const attempts = Math.max(1, this.retry.attempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      this.throwIfInterrupted();
      const nextButton = await this.findNextPageButton();
      if (nextButton || attempt === attempts) {
        return nextButton;
      }

      this.state.log(PHASE, `Next page button absent on attempt ${attempt}`, "warn");
      await delay(this.retry.delayMs);
    }

    return null;
  }

  private async findNextPageButton(): Promise<Locator | null> {
    const textButtons = this.page.locator(NEXT_PAGE_TEXT_BUTTON_SELECTOR);
    if ((await textButtons.count()) > 0) {
      const textButton = await findVisible(textButtons, {
        propagateCountErrors: true
      });
      if (textButton) {
        return textButton;
      }
    }

    const paginationButtons = this.page.locator(NEXT_PAGE_ICON_BUTTON_SELECTOR);
    const count = await paginationButtons.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = paginationButtons.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    return null;
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

async function findVisibleEnabledButtonByExactText(locator: Locator, exactTexts: string[]): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const text = ((await candidate.textContent().catch(() => null)) ?? "").trim();
    if (!exactTexts.includes(text)) {
      continue;
    }
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    if (await candidate.isDisabled().catch(() => true)) {
      continue;
    }
    return candidate;
  }

  return null;
}

async function extractProductIdentity(row: Locator, index: number, pageIndex: number): Promise<ProductIdentity> {
  const attr = await row.getAttribute("data-product-id").catch(() => null);
  if (attr) {
    return { productId: attr, rowText: "", hasStableProductId: true };
  }

  const text = (await row.textContent().catch(() => null)) ?? "";
  const match =
    /SKC\s*[^A-Za-z0-9_-]*(sz\d+)/i.exec(text) ??
    /SPU\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i.exec(text) ??
    /(?:议价单号|商品ID|Product\s*ID|SKU)\s*[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i.exec(text);
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

function extractFirstLabelledPrice(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const price = extractLabelledPrice(text, label);
    if (price !== null) {
      return price;
    }
  }

  return null;
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

function extractUnlabelledPendingTaskPrices(
  text: string,
  pricingRule: PricingRuleId = "women_shein"
): RowPrices | null {
  if (!/议价单号|Bargain/i.test(text)) {
    return null;
  }

  const priceMatches = [...text.matchAll(/\d+\.\d{2}/g)].map((match) => Number(match[0]));
  const skuCount = (text.match(/SKU\s*[:：]/gi) ?? []).length;
  const pairCount = skuCount > 0 ? skuCount : Math.floor(priceMatches.length / 2);
  if (pairCount <= 0 || priceMatches.length < pairCount * 2) {
    return null;
  }

  const pairs: RowPrices[] = [];
  for (let index = 0; index < pairCount; index += 1) {
    const quotedPrice = priceMatches[index];
    const platformSuggestedPrice = priceMatches[index + pairCount];
    if (!Number.isFinite(quotedPrice) || !Number.isFinite(platformSuggestedPrice)) {
      return null;
    }

    pairs.push({
      quotedPrice,
      currentSellingPrice: platformSuggestedPrice,
      officialSuggestedPrice: platformSuggestedPrice
    });
  }

  return pairs.find((pair) => !evaluatePricing(pair, pricingRule).passed) ?? pairs[0] ?? null;
}

function extractUnlabelledPendingTaskPricePairs(text: string): RowPrices[] {
  if (!/璁环鍗曞彿|Bargain/i.test(text)) {
    return [];
  }

  const priceMatches = [...text.matchAll(/\d+\.\d{2}/g)].map((match) => Number(match[0]));
  const skuCount = (text.match(/SKU/gi) ?? []).length;
  const pairCount = skuCount > 0 ? skuCount : Math.floor(priceMatches.length / 2);
  if (pairCount <= 0 || priceMatches.length < pairCount * 2) {
    return [];
  }

  const pairs: RowPrices[] = [];
  for (let index = 0; index < pairCount; index += 1) {
    const quotedPrice = priceMatches[index];
    const platformSuggestedPrice = priceMatches[index + pairCount];
    if (!Number.isFinite(quotedPrice) || !Number.isFinite(platformSuggestedPrice)) {
      return [];
    }

    pairs.push({
      quotedPrice,
      currentSellingPrice: platformSuggestedPrice,
      officialSuggestedPrice: platformSuggestedPrice
    });
  }

  return pairs;
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
