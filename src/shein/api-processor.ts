import type { Page, Response } from "playwright";
import type { PricingOptions, PricingRuleId } from "../domain/pricing.js";
import type { TaskStateStore } from "../domain/task-state.js";
import {
  buildBatchHandleCostDiscussPayload,
  decideBargainPage,
  type BatchHandleCostDiscussPayload
} from "./api-pricing.js";

type SheinApiProcessorOptions = {
  pageSize?: number;
  delayMs?: number;
};

type DpasApiResponse = {
  code?: unknown;
  msg?: unknown;
  info?: {
    data?: unknown[];
    success_count?: unknown;
    fail_count?: unknown;
  };
};

const PHASE = "shein-api";
const DPAS_DISCUSS_PRICE_ROUTE = "/#/dpas/discuss-price/list?type=1&id=1&last_page=home_todo_1";
const NAVIGATION_TIMEOUT_MS = 60_000;
const NATIVE_BARGAIN_TIMEOUT_MS = 30_000;

export class SheinApiProcessor {
  private readonly pageSize: number;
  private readonly delayMs: number;

  constructor(
    private readonly page: Page,
    private readonly state: TaskStateStore,
    private readonly pricingRule: PricingRuleId = "women_shein",
    private readonly pricingOptions: PricingOptions = {},
    options: SheinApiProcessorOptions = {}
  ) {
    this.pageSize = options.pageSize ?? 10;
    this.delayMs = options.delayMs ?? 1000;
  }

  async processAllPages(): Promise<void> {
    this.state.setStatus("pricing");
    let nextPagePayload = await this.ensureDiscussPricePage();

    while (!this.state.shouldStop()) {
      const pagePayload = nextPagePayload ?? await this.postDpas(
        `/discuss/bargain_page?page_num=1&page_size=${this.pageSize}`,
        this.bargainPageBody()
      );
      nextPagePayload = undefined;
      const decisions = decideBargainPage(pagePayload, this.pricingRule, this.pricingOptions);
      if (!decisions.length) {
        const rowCount = countBargainRows(pagePayload);
        if (rowCount > 0) {
          this.state.log(PHASE, `API returned ${rowCount} rows but none could be parsed into pricing decisions`, "error");
          this.state.log(PHASE, `First API row shape: ${describeFirstBargainRow(pagePayload)}`, "error");
          this.state.setStatus("failed");
          return;
        }

        this.state.log(PHASE, "No API bargain rows found on first page; pricing complete");
        this.state.setStatus("completed");
        return;
      }

      this.state.log(
        PHASE,
        `API first page decisions: agree ${decisions.filter((decision) => decision.passed).length}, reject ${decisions.filter((decision) => !decision.passed).length}`
      );
      const submitPayload = buildBatchHandleCostDiscussPayload(decisions);
      const submitResult = await this.postDpas("/discuss/batch_handle_cost_discuss", submitPayload);
      this.assertSuccessfulSubmit(submitResult, submitPayload);

      for (const decision of decisions) {
        this.state.recordResult({
          productId: decision.productId,
          quotedPrice: decision.quotedPrice,
          originalPrice: decision.originalPrice,
          threshold70Percent: decision.threshold70Percent,
          currentSellingPrice: decision.currentSellingPrice,
          officialSuggestedPrice: decision.officialSuggestedPrice,
          passed: decision.passed,
          action: decision.passed ? "confirmed" : "rejected",
          reason: decision.reason
        });
      }

      await delay(this.delayMs);
      nextPagePayload = await this.reloadAndWaitForNativeBargainPage();
    }
  }

  private async ensureDiscussPricePage(): Promise<DpasApiResponse | undefined> {
    const currentUrl = this.page.url();
    this.state.log(PHASE, `Current SHEIN URL before API pricing: ${currentUrl}`);
    if (currentUrl.includes("/dpas/discuss-price/list")) {
      return this.reloadAndWaitForNativeBargainPage();
    }

    const targetUrl = `${new URL(currentUrl).origin}${DPAS_DISCUSS_PRICE_ROUTE}`;
    const nativeResponse = this.waitForNativeBargainPage("navigation");
    await this.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    this.state.log(PHASE, `Navigated to SHEIN API pricing page: ${targetUrl}`);
    return nativeResponse;
  }

  private async reloadAndWaitForNativeBargainPage(): Promise<DpasApiResponse | undefined> {
    if (typeof this.page.reload !== "function") {
      return undefined;
    }

    const nativeResponse = this.waitForNativeBargainPage("reload");
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch((error: unknown) => {
      this.state.log(PHASE, `Reload DPAS pricing page failed before native API wait: ${formatErrorMessage(error)}`, "warn");
    });
    return nativeResponse;
  }

  private async waitForNativeBargainPage(reason: string): Promise<DpasApiResponse | undefined> {
    if (typeof this.page.waitForResponse !== "function") {
      return undefined;
    }

    try {
      const response = await this.page.waitForResponse(isBargainPageResponse, { timeout: NATIVE_BARGAIN_TIMEOUT_MS });
      const payload = await response.json() as DpasApiResponse;
      if (payload.code !== "0") {
        this.state.log(PHASE, `Native bargain_page during ${reason} returned ${String(payload.msg ?? payload.code ?? "unknown")}`, "warn");
        return undefined;
      }

      const dataCount = Array.isArray(payload.info?.data) ? payload.info.data.length : 0;
      this.state.log(PHASE, `Native bargain_page during ${reason} returned ${dataCount} rows`);
      return payload;
    } catch (error) {
      this.state.log(PHASE, `Timed out waiting for native bargain_page during ${reason}: ${formatErrorMessage(error)}`, "warn");
      return undefined;
    }
  }

  private bargainPageBody(): Record<string, unknown> {
    const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const start = new Date(end);
    start.setMonth(start.getMonth() - 3);

    return {
      bargain_status: 1,
      start_time: formatDateTime(start, false),
      end_time: formatDateTime(end, true)
    };
  }

  private async postDpas(path: string, body: unknown): Promise<DpasApiResponse> {
    const response = await this.page.evaluate(async ({ path, body }) => {
      const request = await fetch(`/dpas-api-prefix/dpas${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lt-language": "zh-CN",
          LAN: "zh-CN"
        },
        body: JSON.stringify(body)
      });
      const text = await request.text();
      try {
        return JSON.parse(text);
      } catch {
        return { code: String(request.status), msg: text };
      }
    }, { path, body });

    if (!response || typeof response !== "object") {
      throw new Error(`SHEIN API ${path} returned an unreadable response`);
    }

    if (response.code !== "0") {
      throw new Error(`SHEIN API ${path} failed: ${String(response.msg ?? response.code ?? "unknown")}`);
    }

    return response as DpasApiResponse;
  }

  private assertSuccessfulSubmit(response: DpasApiResponse, payload: BatchHandleCostDiscussPayload): void {
    const info = response.info && typeof response.info === "object"
      ? response.info as { success_count?: unknown; fail_count?: unknown }
      : {};
    const successCount = Number(info.success_count ?? payload.confirm_infos.length);
    const failCount = Number(info.fail_count ?? 0);
    if (!Number.isFinite(successCount) || !Number.isFinite(failCount) || failCount > 0) {
      throw new Error(`SHEIN API batch submit failed: success ${String(info.success_count)}, fail ${String(info.fail_count)}`);
    }
    this.state.log(PHASE, `API batch submitted: success ${successCount}, fail ${failCount}`);
  }
}

function formatDateTime(date: Date, endOfDay: boolean): string {
  if (endOfDay) {
    date.setHours(23, 59, 59, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isBargainPageResponse(response: Response): boolean {
  return response.url().includes("/dpas-api-prefix/dpas/discuss/bargain_page")
    && response.request().method().toUpperCase() === "POST";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countBargainRows(payload: DpasApiResponse): number {
  return Array.isArray(payload.info?.data) ? payload.info.data.length : 0;
}

function describeFirstBargainRow(payload: DpasApiResponse): string {
  const first = Array.isArray(payload.info?.data) ? payload.info.data[0] : undefined;
  if (!first || typeof first !== "object") {
    return "no object row";
  }

  const row = first as Record<string, unknown>;
  const details = Object.keys(row).slice(0, 30);
  const nested = Object.entries(row)
    .filter(([, value]) => value && typeof value === "object")
    .slice(0, 8)
    .map(([key, value]) => `${key}=[${Object.keys(value as Record<string, unknown>).slice(0, 12).join(",")}]`);
  return `keys=[${details.join(",")}]; nested=${nested.join("; ") || "none"}; ${describeFirstSku(row)}`;
}

function describeFirstSku(row: Record<string, unknown>): string {
  const skuPrices = row.sku_cost_prices;
  if (!Array.isArray(skuPrices) || !skuPrices.length) {
    return "firstSkuKeys=none";
  }

  const firstSku = skuPrices[0];
  if (!firstSku || typeof firstSku !== "object") {
    return "firstSkuKeys=not_object";
  }

  const sku = firstSku as Record<string, unknown>;
  const skuKeys = Object.keys(sku).slice(0, 40);
  const nested = Object.entries(sku)
    .filter(([, value]) => value && typeof value === "object")
    .slice(0, 10)
    .map(([key, value]) => `${key}=[${Object.keys(value as Record<string, unknown>).slice(0, 20).join(",")}]`);
  return `firstSkuKeys=[${skuKeys.join(",")}]; firstSkuNested=${nested.join("; ") || "none"}`;
}
