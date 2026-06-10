import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults and numeric overrides", () => {
    expect(loadConfig({})).toMatchObject({
      port: 3210,
      retryAttempts: 3,
      retryDelayMs: 1000
    });

    expect(loadConfig({
      PORT: "4321",
      RETRY_ATTEMPTS: "5",
      RETRY_DELAY_MS: "250"
    })).toMatchObject({
      port: 4321,
      retryAttempts: 5,
      retryDelayMs: 250
    });
  });

  it.each([
    ["PORT", "abc"],
    ["PORT", "0"],
    ["PORT", "1.5"],
    ["RETRY_ATTEMPTS", "NaN"],
    ["RETRY_ATTEMPTS", "-1"],
    ["RETRY_DELAY_MS", "Infinity"],
    ["RETRY_DELAY_MS", ""]
  ])("throws with the variable name when %s is invalid", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(new RegExp(name));
  });
});
