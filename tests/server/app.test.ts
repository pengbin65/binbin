import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";
import { attachStateWebSocket, createApp } from "../../src/server/app.js";
import type { AppSettings, SettingsInput } from "../../src/settings.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
});

describe("createApp", () => {
  it("returns state snapshots from the shared store", async () => {
    const state = new TaskStateStore();
    state.log("test", "hello");
    const baseUrl = await listen(createApp({ state, runner: { run: vi.fn() } }));

    const response = await fetch(`${baseUrl}/api/state`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "idle",
      logs: [{ phase: "test", message: "hello" }]
    });
  });

  it("returns configured profile names", async () => {
    const state = new TaskStateStore();
    const baseUrl = await listen(createApp({
      state,
      runner: { run: vi.fn() },
      profileNames: ["女装希音1", "女装希音2"]
    }));

    const response = await fetch(`${baseUrl}/api/profiles`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profileNames: ["女装希音1", "女装希音2"]
    });
  });

  it("returns and saves editable settings", async () => {
    const state = new TaskStateStore();
    let settings: AppSettings = {
      profileNames: ["shop-a"],
      pricingRule: "low_price" as const,
      pricingOptions: { lowPriceThreshold: 0.7 }
    };
    const baseUrl = await listen(createApp({
      state,
      runner: { run: vi.fn() },
      settingsStore: {
        load: () => settings,
        save: (nextSettings: SettingsInput) => {
          settings = {
            profileNames: Array.isArray(nextSettings.profileNames) ? nextSettings.profileNames.filter((name): name is string => typeof name === "string") : settings.profileNames,
            pricingRule: nextSettings.pricingRule === "women_shein" || nextSettings.pricingRule === "low_price" ? nextSettings.pricingRule : settings.pricingRule,
            pricingOptions: nextSettings.pricingOptions && typeof nextSettings.pricingOptions === "object"
              ? { lowPriceThreshold: Number((nextSettings.pricingOptions as { lowPriceThreshold?: unknown }).lowPriceThreshold) }
              : settings.pricingOptions
          };
          return settings;
        }
      }
    }));

    const getResponse = await fetch(`${baseUrl}/api/settings`);
    const saveResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileNames: ["shop-b", "shop-c"],
        pricingRule: "low_price",
        pricingOptions: { lowPriceThreshold: 1.15 }
      })
    });

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      profileNames: ["shop-a"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 0.7 }
    });
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toEqual({
      profileNames: ["shop-b", "shop-c"],
      pricingRule: "low_price",
      pricingOptions: { lowPriceThreshold: 1.15 }
    });
  });

  it("starts and stops API capture", async () => {
    const state = new TaskStateStore();
    const captureRunner = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined)
    };
    const baseUrl = await listen(createApp({
      state,
      runner: { run: vi.fn() },
      profileNames: ["shop-a"],
      captureRunner
    }));

    const start = await fetch(`${baseUrl}/api/capture/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileName: "shop-a" })
    });
    const stop = await fetch(`${baseUrl}/api/capture/stop`, { method: "POST" });

    expect(start.status).toBe(202);
    expect(stop.status).toBe(202);
    expect(captureRunner.start).toHaveBeenCalledWith("shop-a");
    expect(captureRunner.stop).toHaveBeenCalledTimes(1);
  });

  it("passes selected profile names, pricing rule, and low-price threshold to the runner on start", async () => {
    const state = new TaskStateStore();
    const run = vi.fn(async () => undefined);
    const baseUrl = await listen(createApp({
      state,
      runner: { run },
      profileNames: ["女装希音1", "女装希音2"]
    }));

    const response = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileNames: ["女装希音2"],
        pricingRule: "low_price",
        pricingOptions: { lowPriceThreshold: 1.2 }
      })
    });

    expect(response.status).toBe(202);
    expect(run).toHaveBeenCalledWith(["女装希音2"], "low_price", { lowPriceThreshold: 1.2 });
  });

  it("uses saved settings when start omits profile and pricing choices", async () => {
    const state = new TaskStateStore();
    const run = vi.fn(async () => undefined);
    const baseUrl = await listen(createApp({
      state,
      runner: { run },
      settingsStore: {
        load: () => ({
          profileNames: ["saved-shop"],
          pricingRule: "low_price",
          pricingOptions: { lowPriceThreshold: 1.3 }
        }),
        save: () => ({
          profileNames: ["saved-shop"],
          pricingRule: "low_price",
          pricingOptions: { lowPriceThreshold: 1.3 }
        })
      }
    }));

    const response = await fetch(`${baseUrl}/api/start`, { method: "POST" });

    expect(response.status).toBe(202);
    expect(run).toHaveBeenCalledWith(["saved-shop"], "low_price", { lowPriceThreshold: 1.3 });
  });

  it("rejects start when no selected profile names are provided", async () => {
    const state = new TaskStateStore();
    const run = vi.fn(async () => undefined);
    const baseUrl = await listen(createApp({
      state,
      runner: { run },
      profileNames: ["女装希音1", "女装希音2"]
    }));

    const response = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileNames: [] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Select at least one shop before starting" });
    expect(run).not.toHaveBeenCalled();
  });

  it("schedules start without waiting for the runner and rejects concurrent starts", async () => {
    const state = new TaskStateStore();
    let resolveRun: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => {
      resolveRun = resolve;
    }));
    const baseUrl = await listen(createApp({ state, runner: { run } }));

    const first = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    const second = await fetch(`${baseUrl}/api/start`, { method: "POST" });

    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ started: true });
    expect(second.status).toBe(409);
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    const third = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    expect(third.status).toBe(202);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("resets running and marks failed when the scheduled runner rejects", async () => {
    const state = new TaskStateStore();
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const baseUrl = await listen(createApp({ state, runner: { run } }));

    const first = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    await vi.waitFor(() => expect(state.snapshot().status).toBe("failed"));
    const second = await fetch(`${baseUrl}/api/start`, { method: "POST" });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(state.snapshot().logs.at(-1)).toMatchObject({
      level: "error",
      phase: "server",
      message: "Runner failed: boom"
    });
  });

  it("requires stop before restarting after the runner pauses for manual login", async () => {
    const state = new TaskStateStore();
    const run = vi.fn(async () => {
      state.requestPause();
      state.markPaused();
    });
    const stop = vi.fn(async () => undefined);
    const baseUrl = await listen(createApp({ state, runner: { run, stop } }));

    const first = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    await vi.waitFor(() => expect(state.snapshot().status).toBe("paused"));
    const second = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    const stopResponse = await fetch(`${baseUrl}/api/stop`, { method: "POST" });
    const third = await fetch(`${baseUrl}/api/start`, { method: "POST" });

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Task is paused; stop before starting a new run"
    });
    expect(stopResponse.status).toBe(202);
    expect(third.status).toBe(202);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it("rejects start while a stopped run and stop cleanup are still settling", async () => {
    const state = new TaskStateStore();
    const runDeferred = deferred<void>();
    const stopDeferred = deferred<void>();
    const run = vi.fn(() => runDeferred.promise);
    const stop = vi.fn(() => stopDeferred.promise);
    const baseUrl = await listen(createApp({ state, runner: { run, stop } }));

    const first = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const stopResponse = await fetch(`${baseUrl}/api/stop`, { method: "POST" });
    const second = await fetch(`${baseUrl}/api/start`, { method: "POST" });

    expect(first.status).toBe(202);
    expect(stopResponse.status).toBe(202);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Task is stopping; wait before starting a new run"
    });
    expect(run).toHaveBeenCalledTimes(1);

    runDeferred.resolve();
    stopDeferred.resolve();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    const third = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    expect(third.status).toBe(202);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps rejecting start until stop cleanup settles", async () => {
    const state = new TaskStateStore();
    const runDeferred = deferred<void>();
    const stopDeferred = deferred<void>();
    const run = vi.fn(() => runDeferred.promise);
    const stop = vi.fn(() => stopDeferred.promise);
    const baseUrl = await listen(createApp({ state, runner: { run, stop } }));

    await fetch(`${baseUrl}/api/start`, { method: "POST" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await fetch(`${baseUrl}/api/stop`, { method: "POST" });
    runDeferred.resolve();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    const blocked = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toEqual({
      error: "Task is stopping; wait before starting a new run"
    });
    expect(run).toHaveBeenCalledTimes(1);

    stopDeferred.resolve();
    const accepted = await fetch(`${baseUrl}/api/start`, { method: "POST" });
    expect(accepted.status).toBe(202);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pause and stop endpoints update the shared state", async () => {
    const state = new TaskStateStore();
    state.start();
    const stop = vi.fn(async () => undefined);
    const baseUrl = await listen(createApp({ state, runner: { run: vi.fn(), stop } }));

    const pause = await fetch(`${baseUrl}/api/pause`, { method: "POST" });
    const stopResponse = await fetch(`${baseUrl}/api/stop`, { method: "POST" });

    expect(pause.status).toBe(202);
    expect(stopResponse.status).toBe(202);
    expect(state.snapshot()).toMatchObject({
      pauseRequested: true,
      stopRequested: true,
      status: "stopped"
    });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});

describe("attachStateWebSocket", () => {
  it("broadcasts state snapshots", async () => {
    const state = new TaskStateStore();
    state.log("ws", "snapshot");
    const server = http.createServer(createApp({ state, runner: { run: vi.fn() } }));
    attachStateWebSocket(server, state, { intervalMs: 10 });
    const baseUrl = await listenServer(server);
    const wsUrl = baseUrl.replace("http:", "ws:").replace("https:", "wss:");
    const { WebSocket } = await import("ws");

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`${wsUrl}/ws`);
      socket.once("message", (data) => {
        socket.close();
        resolve(data.toString());
      });
      socket.once("error", reject);
    });

    expect(JSON.parse(message)).toMatchObject({
      status: "idle",
      logs: [{ phase: "ws", message: "snapshot" }]
    });
  });
});

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  return listenServer(http.createServer(app));
}

async function listenServer(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

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
