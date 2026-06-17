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

  it("passes low-price rule when official suggested price is at least 0.7", () => {
    expect(evaluatePricing({ quotedPrice: 20, currentSellingPrice: 0, officialSuggestedPrice: 0.7 }, "low_price")).toMatchObject({
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_0_7"
    });
  });

  it("fails low-price rule when official suggested price is below 0.7", () => {
    expect(evaluatePricing({ quotedPrice: 20, currentSellingPrice: 999, officialSuggestedPrice: 0.69 }, "low_price")).toMatchObject({
      passed: false,
      reason: "OFFICIAL_SUGGESTED_PRICE_BELOW_0_7"
    });
  });
});
