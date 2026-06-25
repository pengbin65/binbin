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
    const goto = vi.fn(async () => undefined);
    const page = {
      url: vi.fn(() => "https://sso.geiwohuo.com/#/spmp/commodities/list"),
      goto,
      evaluate: vi.fn(async (_fn: unknown, input: { path: string; body: unknown }) => {
        calls.push(input);
        return apiResponses.shift();
      })
    } as unknown as Page;

    await new SheinApiProcessor(page, state, "low_price", { lowPriceThreshold: 0.7 }).processAllPages();

    expect(goto).toHaveBeenCalledWith(
      "https://sso.geiwohuo.com/#/dpas/discuss-price/list?type=1&id=1&last_page=home_todo_1",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
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

  it("uses the SHEIN page's own bargain_page response after navigation", async () => {
    const state = new TaskStateStore();
    state.start();
    const nativeFirstPage = {
      code: "0",
      msg: "OK",
      info: {
        data: [
          bargainItem("YJ-native", "DOC-native", "8.00", "0.80")
        ]
      }
    };
    const nativeEmptyPage = { code: "0", msg: "OK", info: { data: [] } };
    const nativeResponses = [nativeFirstPage, nativeEmptyPage];
    const calls: Array<{ path: string; body: unknown }> = [];
    const page = {
      url: vi.fn(() => "https://sso.geiwohuo.com/#/spmp/commodities/list"),
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async () => ({
        url: () => "https://sso.geiwohuo.com/dpas-api-prefix/dpas/discuss/bargain_page?page_num=1&page_size=10",
        request: () => ({ method: () => "POST" }),
        json: async () => nativeResponses.shift()
      })),
      evaluate: vi.fn(async (_fn: unknown, input: { path: string; body: unknown }) => {
        calls.push(input);
        return { code: "0", msg: "OK", info: { success_count: 1, fail_count: 0 } };
      })
    } as unknown as Page;

    await new SheinApiProcessor(page, state, "low_price", { lowPriceThreshold: 0.7 }).processAllPages();

    expect(page.waitForResponse).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      {
        path: "/discuss/batch_handle_cost_discuss",
        body: {
          confirm_infos: [
            { discuss_audit_type: 1, discuss_sn: "YJ-native", document_sn: "DOC-native" }
          ]
        }
      }
    ]);
    expect(state.snapshot().results).toMatchObject([
      { productId: "YJ-native", action: "confirmed", passed: true }
    ]);
  });

  it("fails with diagnostics when API rows cannot be parsed into pricing decisions", async () => {
    const state = new TaskStateStore();
    state.start();
    const page = {
      url: vi.fn(() => "https://sso.geiwohuo.com/#/spmp/commodities/list"),
      goto: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async () => ({
        url: () => "https://sso.geiwohuo.com/dpas-api-prefix/dpas/discuss/bargain_page?page_num=1&page_size=10",
        request: () => ({ method: () => "POST" }),
        json: async () => ({
          code: "0",
          msg: "OK",
          info: {
            data: [
              {
                discuss_sn: "YJ-unparsed",
                unknown_prices: [{ price: "0.80" }]
              }
            ]
          }
        })
      })),
      evaluate: vi.fn()
    } as unknown as Page;

    await new SheinApiProcessor(page, state, "low_price", { lowPriceThreshold: 0.7 }).processAllPages();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.logs.map((log) => log.message).join("\n")).toContain("API returned 1 rows but none could be parsed");
    expect(snapshot.logs.map((log) => log.message).join("\n")).toContain("discuss_sn");
    expect(snapshot.logs.map((log) => log.message).join("\n")).toContain("unknown_prices");
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
