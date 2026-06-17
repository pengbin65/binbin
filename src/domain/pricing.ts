export type PricingInput = {
  quotedPrice: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
};

export type PricingRuleId = "women_shein" | "low_price";

export type PricingDecisionReason =
  | "CURRENT_PRICE_ABOVE_70_PERCENT"
  | "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
  | "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_0_7"
  | "OFFICIAL_SUGGESTED_PRICE_BELOW_0_7"
  | "FAILED_BOTH_RULES";

export type PricingDecision = {
  originalPrice: number;
  threshold70Percent: number;
  passed: boolean;
  reason: PricingDecisionReason;
};

export function parsePrice(value: string): number | null {
  const normalized = value.replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluatePricing(input: PricingInput, rule: PricingRuleId = "women_shein"): PricingDecision {
  const originalPrice = input.quotedPrice - 10;
  const threshold70Percent = (originalPrice * 70) / 100;

  if (rule === "low_price") {
    if (input.officialSuggestedPrice >= 0.7) {
      return {
        originalPrice,
        threshold70Percent,
        passed: true,
        reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_0_7"
      };
    }

    return {
      originalPrice,
      threshold70Percent,
      passed: false,
      reason: "OFFICIAL_SUGGESTED_PRICE_BELOW_0_7"
    };
  }

  if (input.currentSellingPrice > threshold70Percent) {
    return {
      originalPrice,
      threshold70Percent,
      passed: true,
      reason: "CURRENT_PRICE_ABOVE_70_PERCENT"
    };
  }

  if (input.officialSuggestedPrice >= 8) {
    return {
      originalPrice,
      threshold70Percent,
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
    };
  }

  return {
    originalPrice,
    threshold70Percent,
    passed: false,
    reason: "FAILED_BOTH_RULES"
  };
}
