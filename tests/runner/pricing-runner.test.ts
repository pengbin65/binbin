import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, LoginNavigationResult } from "../../src/browser/browser-session.js";
import type { AppConfig } from "../../src/config.js";
import { TaskStateStore } from "../../src/domain/task-state.js";
import type { HubstudioClient, HubstudioProfile } from "../../src/hubstudio/hubstudio-client.js";
import { PricingRunner } from "../../src/runner/pricing-runner.js";

const config: AppConfig = {
  port: 3210,
  hubstudioApiBase: "http://hubstudio.test",
  hubstudioApiToken: "token",
  hubstudioProfileName: "profile-name",
  sheinNewProductNegotiationUrl: "https://shein.test/new-product-negotiation",
  retryAttempts: 2,
  retryDelayMs: 0
};

describe("PricingRunner", () => {
  it("starts Hubstudio, opens SHEIN, and processes all pages", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const profile: HubstudioProfile = { id: "profile-1", name: "profile-name" };
    const hubstudio = {
      findProfileByName: vi.fn(async () => profile),
      startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
    };
    const browser = {
      connect: vi.fn(async () => page),
      openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page })),
      close: vi.fn(async () => undefined)
    };
    const processAllPages = vi.fn(async () => {
      state.setStatus("completed");
    });
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: hubstudio as unknown as HubstudioClient,
      browser: browser as unknown as BrowserSession,
      createProcessor: vi.fn(() => ({ processAllPages }))
    });

    await runner.run();

    expect(hubstudio.findProfileByName).toHaveBeenCalledWith("profile-name");
    expect(hubstudio.startProfile).toHaveBeenCalledWith("profile-1");
    expect(browser.connect).toHaveBeenCalledWith("ws://browser");
    expect(browser.openShein).toHaveBeenCalledWith(page, "https://shein.test/new-product-negotiation");
    expect(processAllPages).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("completed");
  });

  it("pauses when SHEIN needs manual login and does not process pages", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const processAllPages = vi.fn();
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page),
        openShein: vi.fn(async () => ({ status: "needs_manual_login", page, reason: "verification required" })),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      createProcessor: vi.fn(() => ({ processAllPages }))
    });

    await runner.run();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.pauseRequested).toBe(true);
    expect(snapshot.logs.at(-1)).toMatchObject({
      level: "warn",
      phase: "login",
      message: "Manual SHEIN login required: verification required"
    });
    expect(processAllPages).not.toHaveBeenCalled();
  });

  it("logs and marks failed when an orchestration step throws", async () => {
    const state = new TaskStateStore();
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => {
          throw new Error("Hubstudio unavailable");
        })
      } as unknown as HubstudioClient,
      browser: {
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession
    });

    await runner.run();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.logs.at(-1)).toMatchObject({
      level: "error",
      phase: "runner",
      message: "Pricing runner failed: Hubstudio unavailable"
    });
  });
});
