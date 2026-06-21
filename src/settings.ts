import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PricingOptions, PricingRuleId } from "./domain/pricing.js";

export type AppSettings = {
  profileNames: string[];
  pricingRule: PricingRuleId;
  pricingOptions: Required<Pick<PricingOptions, "lowPriceThreshold">>;
};

export type SettingsInput = {
  profileNames?: unknown;
  pricingRule?: unknown;
  pricingOptions?: unknown;
};

export type SettingsStore = {
  load(): AppSettings;
  save(settings: SettingsInput): AppSettings;
};

export class JsonSettingsStore implements SettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: AppSettings
  ) {}

  load(): AppSettings {
    if (!existsSync(this.filePath)) {
      return normalizeSettings({}, this.defaults);
    }

    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, "utf8")), this.defaults);
    } catch {
      return normalizeSettings({}, this.defaults);
    }
  }

  save(settings: SettingsInput): AppSettings {
    const normalized = normalizeSettings(settings, this.defaults);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }
}

export function normalizeSettings(settings: SettingsInput, defaults: AppSettings): AppSettings {
  return {
    profileNames: normalizeProfileNames(settings.profileNames, defaults.profileNames),
    pricingRule: normalizePricingRule(settings.pricingRule, defaults.pricingRule),
    pricingOptions: {
      lowPriceThreshold: normalizeLowPriceThreshold(settings.pricingOptions, defaults.pricingOptions.lowPriceThreshold)
    }
  };
}

function normalizeProfileNames(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const profileNames = Array.from(new Set(value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean)));

  return profileNames.length > 0 ? profileNames : fallback;
}

function normalizePricingRule(value: unknown, fallback: PricingRuleId): PricingRuleId {
  return value === "women_shein" || value === "low_price" ? value : fallback;
}

function normalizeLowPriceThreshold(value: unknown, fallback: number): number {
  const options = value && typeof value === "object" ? value as { lowPriceThreshold?: unknown } : {};
  const rawThreshold = options.lowPriceThreshold;
  const threshold = typeof rawThreshold === "number" ? rawThreshold : Number(rawThreshold);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : fallback;
}
