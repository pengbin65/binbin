import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, LoginNavigationResult } from "../../src/browser/browser-session.js";
import type { AppConfig } from "../../src/config.js";
import { TaskStateStore } from "../../src/domain/task-state.js";
import type { HubstudioClient, HubstudioProfile } from "../../src/hubstudio/hubstudio-client.js";
import { ApiCaptureRunner } from "../../src/runner/api-capture-runner.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3210,
  hubstudioApiBase: "http://hubstudio.test",
  hubstudioApiToken: "token",
  hubstudioProfileNames: ["shop-a"],
  sheinNewProductNegotiationUrl: "https://shein.test/new-product-negotiation",
  retryAttempts: 2,
  retryDelayMs: 0
};

describe("ApiCaptureRunner", () => {
  it("starts one profile and attaches network capture", async () => {
    const state = new TaskStateStore();
    const page = fakePage();
    const profile: HubstudioProfile = { id: "profile-1", name: "shop-a" };
    const runner = new ApiCaptureRunner({
      config,
      state,
      outputDir: "runtime/test-captures",
      hubstudio: {
        findProfileByName: vi.fn(async () => profile),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page as unknown as Page),
        openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page: page as unknown as Page })),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      writeCapture: vi.fn(() => "runtime/test-captures/capture.json")
    });

    await runner.start("shop-a");

    expect(page.on).toHaveBeenCalledWith("request", expect.any(Function));
    expect(page.on).toHaveBeenCalledWith("response", expect.any(Function));
    expect(state.snapshot().status).toBe("pricing");
    expect(state.snapshot().logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "api-capture", message: expect.stringContaining("Capture started for shop-a") })
    ]));
  });

  it("writes capture and closes browser on stop", async () => {
    const state = new TaskStateStore();
    const page = fakePage();
    const close = vi.fn(async () => undefined);
    const writeCapture = vi.fn(() => "runtime/test-captures/capture.json");
    const runner = new ApiCaptureRunner({
      config,
      state,
      outputDir: "runtime/test-captures",
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "shop-a" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page as unknown as Page),
        openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page: page as unknown as Page })),
        close
      } as unknown as BrowserSession,
      writeCapture
    });

    await runner.start("shop-a");
    await runner.stop();

    expect(writeCapture).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("completed");
  });
});

function fakePage() {
  return {
    on: vi.fn(),
    bringToFront: vi.fn(async () => undefined)
  };
}
