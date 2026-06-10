import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";
import { attachStateWebSocket, createApp } from "../../src/server/app.js";

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
