import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";
import { SheinApiProcessor } from "../../src/shein/api-processor.js";

describe("SheinApiProcessor", () => {
  it("processes the first API page repeatedly until it is empty", async () => {
    const state = new TaskStateStore();
    state.start();
    const apiResponses = [
      {
        code: "0",
        msg: "OK",
        info: {
          data: [
            bargainItem("YJ-pass", "DOC-pass", "8.00", "0.80"),
            bargainItem("YJ-reject", "DOC-reject", "8.00", "0.60")
          ]
        }
      },
      { code: "0", msg: "OK", info: { success_count: 2, fail_count: 0 } },
      { code: "0", msg: "OK", info: { data: [] } }
    ];
    const calls: Array<{ path: string; body: unknown }> = [];
    const page = {
      evaluate: vi.fn(async (_fn: unknown, input: { path: string; body: unknown }) => {
        calls.push(input);
        return apiResponses.shift();
      })
    } as unknown as Page;

    await new SheinApiProcessor(page, state, "low_price", { lowPriceThreshold: 0.7 }).processAllPages();

    expect(calls).toEqual([
      {
        path: "/discuss/bargain_page?page_num=1&page_size=10",
        body: expect.not.objectContaining({
          page_num: expect.anything(),
          page_size: expect.anything()
        })
      },
      {
        path: "/discuss/batch_handle_cost_discuss",
        body: {
          confirm_infos: [
            { discuss_audit_type: 1, discuss_sn: "YJ-pass", document_sn: "DOC-pass" },
            { discuss_audit_type: 2, discuss_sn: "YJ-reject", document_sn: "DOC-reject" }
          ]
        }
      },
      {
        path: "/discuss/bargain_page?page_num=1&page_size=10",
        body: expect.not.objectContaining({
          page_num: expect.anything(),
          page_size: expect.anything()
        })
      }
    ]);
    expect(state.snapshot().status).toBe("completed");
    expect(state.snapshot().results).toMatchObject([
      { productId: "YJ-pass", action: "confirmed", passed: true },
      { productId: "YJ-reject", action: "rejected", passed: false }
    ]);
  });
});

function bargainItem(
  bargainSn: string,
  documentSn: string,
  quotedPrice: string,
  suggestedPrice: string
): Record<string, unknown> {
  return {
    bargain_sn: bargainSn,
    document_sn: documentSn,
    sku_cost_prices: [{
      cost_price_histories: [{ prime_cost_price: quotedPrice }],
      suggest_prime_cost_price: suggestedPrice
    }]
  };
}
