import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, LoginNavigationResult } from "../../src/browser/browser-session.js";
import type { AppConfig } from "../../src/config.js";
import { TaskStateStore } from "../../src/domain/task-state.js";
import type { HubstudioClient, HubstudioProfile } from "../../src/hubstudio/hubstudio-client.js";
import { PricingRunner } from "../../src/runner/pricing-runner.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3210,
  hubstudioApiBase: "http://hubstudio.test",
  hubstudioApiToken: "token",
  hubstudioProfileNames: ["profile-name"],
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

  it("runs multiple Hubstudio profiles sequentially from one start", async () => {
    const state = new TaskStateStore();
    const page1 = { id: "page-1" } as unknown as Page;
    const page2 = { id: "page-2" } as unknown as Page;
    const profile1: HubstudioProfile = { id: "profile-1", name: "女装希音1" };
    const profile2: HubstudioProfile = { id: "profile-2", name: "女装希音2" };
    const hubstudio = {
      findProfileByName: vi.fn(async (name: string) => name === "女装希音1" ? profile1 : profile2),
      startProfile: vi.fn(async (profileId: string) => ({ wsEndpoint: `ws://${profileId}` }))
    };
    const browser = {
      connect: vi.fn(async (endpoint: string) => endpoint.endsWith("profile-1") ? page1 : page2),
      openShein: vi.fn(async (page: Page): Promise<LoginNavigationResult> => ({ status: "ready", page })),
      close: vi.fn(async () => undefined)
    };
    const processAllPages = vi.fn(async () => {
      state.setStatus("completed");
    });
    const runner = new PricingRunner({
      config: {
        ...config,
        hubstudioProfileNames: ["女装希音1", "女装希音2"]
      },
      state,
      hubstudio: hubstudio as unknown as HubstudioClient,
      browser: browser as unknown as BrowserSession,
      createProcessor: vi.fn(() => ({ processAllPages }))
    });

    await runner.run();

    expect(hubstudio.findProfileByName).toHaveBeenNthCalledWith(1, "女装希音1");
    expect(hubstudio.findProfileByName).toHaveBeenNthCalledWith(2, "女装希音2");
    expect(hubstudio.startProfile).toHaveBeenNthCalledWith(1, "profile-1");
    expect(hubstudio.startProfile).toHaveBeenNthCalledWith(2, "profile-2");
    expect(browser.openShein).toHaveBeenCalledTimes(2);
    expect(processAllPages).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalledTimes(2);
    expect(state.snapshot().status).toBe("completed");
  });

  it("passes the selected pricing rule and options to each SHEIN processor", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const profile: HubstudioProfile = { id: "profile-1", name: "profile-name" };
    const processAllPages = vi.fn(async () => {
      state.setStatus("completed");
    });
    const createProcessor = vi.fn(() => ({ processAllPages }));
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => profile),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page),
        openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page })),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      createProcessor
    });

    await runner.run(["profile-name"], "low_price", { lowPriceThreshold: 1.2 });

    expect(createProcessor).toHaveBeenCalledWith(page, "low_price", { lowPriceThreshold: 1.2 });
    expect(processAllPages).toHaveBeenCalledTimes(1);
  });

  it("uses the API processor by default", async () => {
    const state = new TaskStateStore();
    const apiResponses = [
      {
        code: "0",
        msg: "OK",
        info: {
          data: [{
            bargain_sn: "YJ-api",
            document_sn: "DOC-api",
            sku_cost_prices: [{
              cost_price_histories: [{ prime_cost_price: "8.00" }],
              suggest_prime_cost_price: "0.80"
            }]
          }]
        }
      },
      { code: "0", msg: "OK", info: { success_count: 1, fail_count: 0 } },
      { code: "0", msg: "OK", info: { data: [] } }
    ];
    const page = {
      evaluate: vi.fn(async () => apiResponses.shift())
    } as unknown as Page;
    const runner = new PricingRunner({
      config: { ...config, retryDelayMs: 0 },
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page),
        openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page })),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession
    });

    await runner.run(["profile-name"], "low_price", { lowPriceThreshold: 0.7 });

    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(state.snapshot().status).toBe("completed");
    expect(state.snapshot().results).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "YJ-api", action: "confirmed" })
    ]));
  });

  it("retries transient SHEIN navigation failures before processing pages", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const processAllPages = vi.fn(async () => {
      state.setStatus("completed");
    });
    const openShein = vi.fn()
      .mockRejectedValueOnce(new Error("temporary load failure"))
      .mockResolvedValueOnce({ status: "ready", page } satisfies LoginNavigationResult);
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page),
        openShein,
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      createProcessor: vi.fn(() => ({ processAllPages }))
    });

    await runner.run();

    expect(openShein).toHaveBeenCalledTimes(2);
    expect(processAllPages).toHaveBeenCalledTimes(1);
    expect(state.snapshot().logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "warn",
        phase: "shein",
        message: "Open SHEIN attempt 1 failed"
      })
    ]));
    expect(state.snapshot().status).toBe("completed");
  });

  it("pauses when SHEIN needs manual login and does not process pages", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const processAllPages = vi.fn();
    const close = vi.fn(async () => undefined);
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
        close
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
      message: "Manual SHEIN login required for profile-name: verification required"
    });
    expect(processAllPages).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    await runner.stop();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops after finding the profile without starting Hubstudio", async () => {
    const state = new TaskStateStore();
    const profileFound = deferred<HubstudioProfile>();
    const startProfile = vi.fn(async () => ({ wsEndpoint: "ws://browser" }));
    const browser = {
      connect: vi.fn(async () => ({} as Page)),
      openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page: {} as Page })),
      close: vi.fn(async () => undefined)
    };
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(() => profileFound.promise),
        startProfile
      } as unknown as HubstudioClient,
      browser: browser as unknown as BrowserSession
    });

    const run = runner.run();
    await vi.waitFor(() => expect(state.snapshot().status).toBe("starting_profile"));
    state.requestStop();
    profileFound.resolve({ id: "profile-1", name: "profile-name" });
    await run;

    expect(startProfile).not.toHaveBeenCalled();
    expect(browser.connect).not.toHaveBeenCalled();
    expect(browser.openShein).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("stopped");
  });

  it("stops after starting the profile without connecting the browser", async () => {
    const state = new TaskStateStore();
    const profileStarted = deferred<{ wsEndpoint: string }>();
    const browser = {
      connect: vi.fn(async () => ({} as Page)),
      openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page: {} as Page })),
      close: vi.fn(async () => undefined)
    };
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(() => profileStarted.promise)
      } as unknown as HubstudioClient,
      browser: browser as unknown as BrowserSession
    });

    const run = runner.run();
    await vi.waitFor(() => expect(state.snapshot().logs.some((log) => log.message === "Starting Hubstudio profile: profile-name")).toBe(true));
    state.requestStop();
    profileStarted.resolve({ wsEndpoint: "ws://browser" });
    await run;

    expect(browser.connect).not.toHaveBeenCalled();
    expect(browser.openShein).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("stopped");
  });

  it("stops after connecting the browser without opening SHEIN", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const browserConnected = deferred<Page>();
    const browser = {
      connect: vi.fn(() => browserConnected.promise),
      openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page })),
      close: vi.fn(async () => undefined)
    };
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: browser as unknown as BrowserSession
    });

    const run = runner.run();
    await vi.waitFor(() => expect(state.snapshot().status).toBe("connecting"));
    state.requestStop();
    browserConnected.resolve(page);
    await run;

    expect(browser.openShein).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("stopped");
  });

  it("stops after opening SHEIN without processing pages", async () => {
    const state = new TaskStateStore();
    const page = {} as Page;
    const sheinOpened = deferred<LoginNavigationResult>();
    const processAllPages = vi.fn(async () => undefined);
    const runner = new PricingRunner({
      config,
      state,
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "profile-name" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page),
        openShein: vi.fn(() => sheinOpened.promise),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      createProcessor: vi.fn(() => ({ processAllPages }))
    });

    const run = runner.run();
    await vi.waitFor(() => expect(state.snapshot().status).toBe("navigating"));
    state.requestStop();
    sheinOpened.resolve({ status: "ready", page });
    await run;

    expect(processAllPages).not.toHaveBeenCalled();
    expect(state.snapshot().status).toBe("stopped");
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
