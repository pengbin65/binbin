import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults and numeric overrides", () => {
    expect(loadConfig({})).toMatchObject({
      port: 3210,
      hubstudioProfileNames: ["女装希音1"],
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

  it("loads multiple Hubstudio profile names from comma-separated env", () => {
    expect(loadConfig({
      HUBSTUDIO_PROFILE_NAMES: "女装希音1, 女装希音2"
    }).hubstudioProfileNames).toEqual(["女装希音1", "女装希音2"]);
  });

  it("loads the configured SHEIN shop batch", () => {
    expect(loadConfig({
      HUBSTUDIO_PROFILE_NAMES: "女装希音1,女装希音2,希音9,希音61,希音68,希音75,希音78,希音G1_001,希音G1_002,希音G1_003,希音G1_004,希音90"
    }).hubstudioProfileNames).toEqual([
      "女装希音1",
      "女装希音2",
      "希音9",
      "希音61",
      "希音68",
      "希音75",
      "希音78",
      "希音G1_001",
      "希音G1_002",
      "希音G1_003",
      "希音G1_004",
      "希音90"
    ]);
  });

  it("falls back to the legacy single Hubstudio profile name env", () => {
    expect(loadConfig({
      HUBSTUDIO_PROFILE_NAME: "女装希音2"
    }).hubstudioProfileNames).toEqual(["女装希音2"]);
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
