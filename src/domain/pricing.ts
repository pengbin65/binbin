export type PricingInput = {
  quotedPrice: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
};

export type PricingRuleId = "women_shein" | "low_price";

export type PricingOptions = {
  lowPriceThreshold?: number;
};

export type PricingDecisionReason =
  | "CURRENT_PRICE_ABOVE_70_PERCENT"
  | "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
  | "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
  | "OFFICIAL_SUGGESTED_PRICE_BELOW_LOW_PRICE_THRESHOLD"
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

export function normalizeLowPriceThreshold(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0.7;
}

export function evaluatePricing(
  input: PricingInput,
  rule: PricingRuleId = "women_shein",
  options: PricingOptions = {}
): PricingDecision {
  const originalPrice = input.quotedPrice - 10;
  const threshold70Percent = (originalPrice * 70) / 100;

  if (rule === "low_price") {
    const lowPriceThreshold = normalizeLowPriceThreshold(options.lowPriceThreshold);
    if (input.officialSuggestedPrice >= lowPriceThreshold) {
      return {
        originalPrice,
        threshold70Percent,
        passed: true,
        reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_LOW_PRICE_THRESHOLD"
      };
    }

    return {
      originalPrice,
      threshold70Percent,
      passed: false,
      reason: "OFFICIAL_SUGGESTED_PRICE_BELOW_LOW_PRICE_THRESHOLD"
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
