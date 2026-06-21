import { describe, expect, it } from "vitest";
import { evaluatePricing, parsePrice } from "../../src/domain/pricing.js";

describe("parsePrice", () => {
  it("parses prices with currency symbols, commas, and spaces", () => {
    expect(parsePrice(" ¥ 1,234.50 ")).toBe(1234.5);
    expect(parsePrice("$8")).toBe(8);
  });

  it("returns null for unreadable prices", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("--")).toBeNull();
  });
});

describe("evaluatePricing", () => {
  it("passes when current selling price is greater than 70 percent threshold", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 64, officialSuggestedPrice: 0 })).toMatchObject({
      passed: true,
      reason: "CURRENT_PRICE_ABOVE_70_PERCENT"
    });
  });

  it("fails when current selling price equals threshold and suggested price is below 8", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 63, officialSuggestedPrice: 7.99 })).toMatchObject({
      passed: false,
      reason: "FAILED_BOTH_RULES"
    });
  });

  it("passes when official suggested price is at least 8", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 62.99, officialSuggestedPrice: 8 })).toMatchObject({
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
    });
  });

  it("passes low-price rule when official suggested price is at least the configured threshold", () => {
    expect(evaluatePricing(
      { quotedPrice: 20, currentSellingPrice: 0, officialSuggestedPrice: 1.2 },
      "low_price",
      { lowPriceThreshold: 1.2 }
    )).toMatchObject({
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
    });
  });

  it("fails low-price rule when official suggested price is below the configured threshold", () => {
    expect(evaluatePricing(
      { quotedPrice: 20, currentSellingPrice: 999, officialSuggestedPrice: 1.19 },
      "low_price",
      { lowPriceThreshold: 1.2 }
    )).toMatchObject({
      passed: false,
      reason: "OFFICIAL_SUGGESTED_PRICE_BELOW_LOW_PRICE_THRESHOLD"
    });
  });

  it("falls back to 0.7 when the low-price threshold is invalid", () => {
    expect(evaluatePricing(
      { quotedPrice: 20, currentSellingPrice: 0, officialSuggestedPrice: 0.7 },
      "low_price",
      { lowPriceThreshold: 0 }
    )).toMatchObject({
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
    });
  });
});
