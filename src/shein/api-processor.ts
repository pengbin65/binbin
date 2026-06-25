import type { Page } from "playwright";
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

    while (!this.state.shouldStop()) {
      const pagePayload = await this.postDpas("/discuss/bargain_page", this.bargainPageBody());
      const decisions = decideBargainPage(pagePayload, this.pricingRule, this.pricingOptions);
      if (!decisions.length) {
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
    }
  }

  private bargainPageBody(): Record<string, unknown> {
    const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const start = new Date(end);
    start.setMonth(start.getMonth() - 3);

    return {
      bargain_status: 1,
      start_time: formatDateTime(start, false),
      end_time: formatDateTime(end, true),
      page_num: 1,
      page_size: this.pageSize
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
