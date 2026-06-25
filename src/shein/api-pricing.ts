import {
  evaluatePricing,
  parsePrice,
  type PricingDecisionReason,
  type PricingOptions,
  type PricingRuleId
} from "../domain/pricing.js";

type RawBargainPage = {
  info?: {
    data?: unknown[];
  };
  [key: string]: unknown;
};

type RawBargainItem = {
  bargain_sn?: unknown;
  document_sn?: unknown;
  skc_name?: unknown;
  sku_cost_prices?: RawSkuCostPrice[];
};

type RawSkuCostPrice = {
  cost_price_histories?: RawCostHistory[];
  suggest_prime_cost_price?: unknown;
  suggest_cost_price?: unknown;
  [key: string]: unknown;
};

type RawCostHistory = {
  prime_cost_price?: unknown;
  [key: string]: unknown;
};

export type ApiPricingDecision = {
  productId: string;
  documentSn: string;
  skcName?: string;
  quotedPrice: number;
  originalPrice: number;
  threshold70Percent: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
  passed: boolean;
  reason: PricingDecisionReason;
};

export type BatchHandleCostDiscussPayload = {
  confirm_infos: Array<{
    discuss_audit_type: 1 | 2;
    discuss_sn: string;
    document_sn: string;
  }>;
};

export function decideBargainPage(
  payload: RawBargainPage,
  pricingRule: PricingRuleId,
  pricingOptions: PricingOptions = {}
): ApiPricingDecision[] {
  const rows = Array.isArray(payload.info?.data) ? payload.info.data.filter(isRecord) as RawBargainItem[] : [];
  return rows.flatMap((row) => {
    const productId = toText(row.bargain_sn);
    const documentSn = toText(row.document_sn);
    if (!productId || !documentSn) {
      return [];
    }

    const skuInputs = (Array.isArray(row.sku_cost_prices) ? row.sku_cost_prices : [])
      .map(toPricingInput)
      .filter((input): input is { quotedPrice: number; officialSuggestedPrice: number } => Boolean(input));

    if (!skuInputs.length) {
      return [];
    }

    const skuDecisions = skuInputs.map((input) => ({
      input,
      decision: evaluatePricing(
        {
          quotedPrice: input.quotedPrice,
          currentSellingPrice: input.officialSuggestedPrice,
          officialSuggestedPrice: input.officialSuggestedPrice
        },
        pricingRule,
        pricingOptions
      )
    }));
    const selected = skuDecisions.find((skuDecision) => !skuDecision.decision.passed) || skuDecisions[0];

    return [{
      productId,
      documentSn,
      skcName: toText(row.skc_name) || undefined,
      quotedPrice: selected.input.quotedPrice,
      originalPrice: selected.decision.originalPrice,
      threshold70Percent: selected.decision.threshold70Percent,
      currentSellingPrice: selected.input.officialSuggestedPrice,
      officialSuggestedPrice: selected.input.officialSuggestedPrice,
      passed: selected.decision.passed,
      reason: selected.decision.reason
    }];
  });
}

export function buildBatchHandleCostDiscussPayload(decisions: ApiPricingDecision[]): BatchHandleCostDiscussPayload {
  return {
    confirm_infos: decisions.map((decision) => ({
      discuss_audit_type: decision.passed ? 1 : 2,
      discuss_sn: decision.productId,
      document_sn: decision.documentSn
    }))
  };
}

function toPricingInput(row: RawSkuCostPrice): { quotedPrice: number; officialSuggestedPrice: number } | undefined {
  const latestHistory = Array.isArray(row.cost_price_histories) ? row.cost_price_histories.at(-1) : undefined;
  const quotedPrice = parseNumber(latestHistory?.prime_cost_price);
  const officialSuggestedPrice = parseNumber(row.suggest_prime_cost_price) ?? parseNumber(row.suggest_cost_price);
  if (quotedPrice === undefined || officialSuggestedPrice === undefined) {
    return undefined;
  }

  return { quotedPrice, officialSuggestedPrice };
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return parsePrice(value) ?? undefined;
  }

  return undefined;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
