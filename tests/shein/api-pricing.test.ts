import { describe, expect, it } from "vitest";
import { buildBatchHandleCostDiscussPayload, decideBargainPage } from "../../src/shein/api-pricing.js";

describe("SHEIN API pricing decisions", () => {
  it("builds batch submit decisions from bargain_page data with the low-price rule", () => {
    const result = decideBargainPage(
      {
        code: "0",
        msg: "OK",
        info: {
          data: [
            {
              bargain_sn: "YJ-pass",
              document_sn: "DOC-pass",
              skc_name: "skc-pass",
              sku_cost_prices: [
                {
                  cost_price_histories: [{ prime_cost_price: "6.80", prime_currency: "USD" }],
                  suggest_prime_cost_price: "0.70",
                  suggest_prime_cost_currency: "USD"
                },
                {
                  cost_price_histories: [{ prime_cost_price: "7.10", prime_currency: "USD" }],
                  suggest_prime_cost_price: "1.20",
                  suggest_prime_cost_currency: "USD"
                }
              ]
            },
            {
              bargain_sn: "YJ-reject",
              document_sn: "DOC-reject",
              skc_name: "skc-reject",
              sku_cost_prices: [
                {
                  cost_price_histories: [{ prime_cost_price: "8.00", prime_currency: "USD" }],
                  suggest_prime_cost_price: "1.30",
                  suggest_prime_cost_currency: "USD"
                },
                {
                  cost_price_histories: [{ prime_cost_price: "8.20", prime_currency: "USD" }],
                  suggest_prime_cost_price: "0.69",
                  suggest_prime_cost_currency: "USD"
                }
              ]
            }
          ]
        }
      },
      "low_price",
      { lowPriceThreshold: 0.7 }
    );

    expect(result).toMatchObject([
      {
        productId: "YJ-pass",
        documentSn: "DOC-pass",
        passed: true,
        quotedPrice: 6.8,
        officialSuggestedPrice: 0.7,
        reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
      },
      {
        productId: "YJ-reject",
        documentSn: "DOC-reject",
        passed: false,
        quotedPrice: 8.2,
        officialSuggestedPrice: 0.69,
        reason: "OFFICIAL_SUGGESTED_PRICE_BELOW_LOW_PRICE_THRESHOLD"
      }
    ]);

    expect(buildBatchHandleCostDiscussPayload(result)).toEqual({
      confirm_infos: [
        { discuss_audit_type: 1, discuss_sn: "YJ-pass", document_sn: "DOC-pass" },
        { discuss_audit_type: 2, discuss_sn: "YJ-reject", document_sn: "DOC-reject" }
      ]
    });
  });

  it("accepts SHEIN rows that use suggest_cost_price for the platform suggested price", () => {
    const result = decideBargainPage(
      {
        code: "0",
        msg: "OK",
        info: {
          data: [
            {
              bargain_sn: "YJ-suggest-cost",
              document_sn: "DOC-suggest-cost",
              sku_cost_prices: [
                {
                  sku_code: "sku-1",
                  cost_price_histories: [{ prime_cost_price: "8.00" }],
                  suggest_cost_price: "0.80",
                  suggest_cost_currency: "USD"
                }
              ]
            }
          ]
        }
      },
      "low_price",
      { lowPriceThreshold: 0.7 }
    );

    expect(result).toMatchObject([
      {
        productId: "YJ-suggest-cost",
        documentSn: "DOC-suggest-cost",
        passed: true,
        quotedPrice: 8,
        officialSuggestedPrice: 0.8,
        reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
      }
    ]);
  });
});
