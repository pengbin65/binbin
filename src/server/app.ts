import type http from "node:http";
import path from "node:path";
import express, { type Express } from "express";
import { WebSocketServer } from "ws";
import type { TaskStateStore } from "../domain/task-state.js";

export type RunnerLike = {
  run(): Promise<void>;
  stop?: () => Promise<void>;
};

export type CreateAppOptions = {
  state: TaskStateStore;
  runner: RunnerLike;
  publicDir?: string;
};

export type WebSocketOptions = {
  intervalMs?: number;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  let running = false;

  app.use(express.json());

  app.get("/api/state", (_request, response) => {
    response.json(options.state.snapshot());
  });

  app.post("/api/start", (_request, response) => {
    if (running) {
      response.status(409).json({ error: "Task is already running" });
      return;
    }

    running = true;
    response.status(202).json({ started: true });

    void Promise.resolve()
      .then(() => options.runner.run())
      .catch((error: unknown) => {
        options.state.log("server", `Runner failed: ${formatErrorMessage(error)}`, "error");
        options.state.setStatus("failed");
      })
      .finally(() => {
        running = false;
      });
  });

  app.post("/api/pause", (_request, response) => {
    options.state.requestPause();
    response.status(202).json(options.state.snapshot());
  });

  app.post("/api/stop", (_request, response) => {
    options.state.requestStop();
    response.status(202).json(options.state.snapshot());

    void Promise.resolve()
      .then(() => options.runner.stop?.())
      .catch((error: unknown) => {
        options.state.log("server", `Runner stop failed: ${formatErrorMessage(error)}`, "warn");
      });
  });

  app.use(express.static(options.publicDir ?? path.resolve(process.cwd(), "public")));

  return app;
}

export function attachStateWebSocket(
  server: http.Server,
  state: TaskStateStore,
  options: WebSocketOptions = {}
): WebSocketServer {
  const intervalMs = options.intervalMs ?? 1000;
  const webSocketServer = new WebSocketServer({ server, path: "/ws" });

  webSocketServer.on("connection", (socket) => {
    const sendSnapshot = (): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(state.snapshot()));
      }
    };

    sendSnapshot();
    const interval = setInterval(sendSnapshot, intervalMs);
    socket.on("close", () => clearInterval(interval));
  });

  return webSocketServer;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
