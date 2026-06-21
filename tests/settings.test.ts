import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSettingsStore } from "../src/settings.js";

describe("JsonSettingsStore", () => {
  it("returns defaults when no settings file exists", () => {
    const store = new JsonSettingsStore(tempSettingsPath(), {
      profileNames: ["shop-a"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });

    expect(store.load()).toEqual({
      profileNames: ["shop-a"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });
  });

  it("saves editable shops and low-price threshold", () => {
    const settingsPath = tempSettingsPath();
    const store = new JsonSettingsStore(settingsPath, {
      profileNames: ["shop-a"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });

    const saved = store.save({
      profileNames: [" shop-b ", "shop-c", "shop-b", ""],
      pricingRule: "women_shein",
      pricingOptions: { lowPriceThreshold: 1.25 }
    });

    expect(saved).toEqual({
      profileNames: ["shop-b", "shop-c"],
      pricingRule: "women_shein",
      pricingOptions: { lowPriceThreshold: 1.25 }
    });
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(saved);
  });

  it("normalizes invalid settings back to safe defaults", () => {
    const settingsPath = tempSettingsPath();
    const store = new JsonSettingsStore(settingsPath, {
      profileNames: ["fallback-shop"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });

    expect(store.save({
      profileNames: [],
      pricingRule: "bad-rule",
      pricingOptions: { lowPriceThreshold: -1 }
    })).toEqual({
      profileNames: ["fallback-shop"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });
  });
});

function tempSettingsPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "pricing-settings-")), "settings.json");
}
