import type http from "node:http";
import path from "node:path";
import express, { type Express } from "express";
import { WebSocketServer } from "ws";
import type { PricingOptions, PricingRuleId } from "../domain/pricing.js";
import type { TaskStateStore } from "../domain/task-state.js";
import type { AppSettings, SettingsStore } from "../settings.js";

export type RunnerLike = {
  run(profileNames?: string[], pricingRule?: PricingRuleId, pricingOptions?: PricingOptions): Promise<void>;
  stop?: () => Promise<void>;
};

export type CaptureRunnerLike = {
  start(profileName: string): Promise<void>;
  stop(): Promise<void>;
};

export type CreateAppOptions = {
  state: TaskStateStore;
  runner: RunnerLike;
  profileNames?: string[];
  settingsStore?: SettingsStore;
  captureRunner?: CaptureRunnerLike;
  publicDir?: string;
};

export type WebSocketOptions = {
  intervalMs?: number;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  let running = false;
  let stopping = false;
  let activeRunId = 0;
  let activeRunPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  app.use(express.json());

  app.get("/api/state", (_request, response) => {
    response.json(options.state.snapshot());
  });

  app.get("/api/profiles", (_request, response) => {
    response.json({ profileNames: loadSettings(options).profileNames });
  });

  app.get("/api/settings", (_request, response) => {
    response.json(loadSettings(options));
  });

  app.post("/api/settings", (_request, response) => {
    try {
      response.json(saveSettings(options, _request.body));
    } catch (error) {
      response.status(500).json({ error: formatErrorMessage(error) });
    }
  });

  app.post("/api/capture/start", (_request, response) => {
    const profileName = parseCaptureProfileName(_request.body, loadSettings(options).profileNames);
    if (!profileName) {
      response.status(400).json({ error: "Select one shop before starting capture" });
      return;
    }

    if (!options.captureRunner) {
      response.status(501).json({ error: "API capture is not configured" });
      return;
    }

    response.status(202).json({ started: true });
    void options.captureRunner.start(profileName).catch((error: unknown) => {
      options.state.log("api-capture", `Capture runner failed: ${formatErrorMessage(error)}`, "error");
      options.state.setStatus("failed");
    });
  });

  app.post("/api/capture/stop", (_request, response) => {
    if (!options.captureRunner) {
      response.status(501).json({ error: "API capture is not configured" });
      return;
    }

    response.status(202).json({ stopped: true });
    void options.captureRunner.stop().catch((error: unknown) => {
      options.state.log("api-capture", `Capture stop failed: ${formatErrorMessage(error)}`, "error");
      options.state.setStatus("failed");
    });
  });

  app.post("/api/start", (_request, response) => {
    if (stopping) {
      response.status(409).json({ error: "Task is stopping; wait before starting a new run" });
      return;
    }

    if (options.state.snapshot().status === "paused") {
      response.status(409).json({ error: "Task is paused; stop before starting a new run" });
      return;
    }

    if (running) {
      response.status(409).json({ error: "Task is already running" });
      return;
    }

    const settings = loadSettings(options);
    const selectedProfileNames = parseSelectedProfileNames(_request.body, settings.profileNames.length ? settings.profileNames : undefined);
    const pricingRule = parsePricingRule(_request.body, settings.pricingRule);
    const pricingOptions = parsePricingOptions(_request.body, settings.pricingOptions);
    if (selectedProfileNames && selectedProfileNames.length === 0) {
      response.status(400).json({ error: "Select at least one shop before starting" });
      return;
    }

    running = true;
    const runId = ++activeRunId;
    response.status(202).json({ started: true });

    const runPromise = Promise.resolve()
      .then(() => options.runner.run(selectedProfileNames, pricingRule, pricingOptions))
      .catch((error: unknown) => {
        options.state.log("server", `Runner failed: ${formatErrorMessage(error)}`, "error");
        options.state.setStatus("failed");
      })
      .finally(() => {
        if (activeRunId === runId) {
          activeRunPromise = undefined;
          if (!stopping && options.state.snapshot().status !== "paused") {
            running = false;
          }
        }
      });
    activeRunPromise = runPromise;
  });

  app.post("/api/pause", (_request, response) => {
    options.state.requestPause();
    response.status(202).json(options.state.snapshot());
  });

  app.post("/api/stop", (_request, response) => {
    options.state.requestStop();
    response.status(202).json(options.state.snapshot());

    if (stopping) {
      return;
    }

    stopping = true;
    const runPromise = activeRunPromise ?? Promise.resolve();
    const cleanupPromise = Promise.resolve()
      .then(() => options.runner.stop?.())
      .catch((error: unknown) => {
        options.state.log("server", `Runner stop failed: ${formatErrorMessage(error)}`, "warn");
      });
    stopPromise = cleanupPromise;

    void Promise.allSettled([runPromise, cleanupPromise]).then(() => {
      if (stopPromise === cleanupPromise) {
        stopPromise = undefined;
        stopping = false;
        running = false;
      }
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

function loadSettings(options: CreateAppOptions): AppSettings {
  if (options.settingsStore) {
    return options.settingsStore.load();
  }

  return {
    profileNames: options.profileNames ?? [],
    pricingRule: "low_price",
    pricingOptions: { lowPriceThreshold: 0.7 }
  };
}

function saveSettings(options: CreateAppOptions, body: unknown): AppSettings {
  if (!options.settingsStore) {
    return loadSettings(options);
  }

  return options.settingsStore.save(body && typeof body === "object" ? body : {});
}

function parsePricingRule(body: unknown, defaultRule: PricingRuleId): PricingRuleId {
  if (!body || typeof body !== "object") {
    return defaultRule;
  }

  const pricingRule = (body as { pricingRule?: unknown }).pricingRule;
  return pricingRule === "low_price" || pricingRule === "women_shein" ? pricingRule : defaultRule;
}

function parsePricingOptions(body: unknown, defaultOptions: PricingOptions): PricingOptions {
  if (!body || typeof body !== "object") {
    return defaultOptions;
  }

  const rawOptions = (body as { pricingOptions?: unknown }).pricingOptions;
  if (!rawOptions || typeof rawOptions !== "object") {
    return defaultOptions;
  }

  const rawThreshold = (rawOptions as { lowPriceThreshold?: unknown }).lowPriceThreshold;
  const lowPriceThreshold = typeof rawThreshold === "number" ? rawThreshold : Number(rawThreshold);
  return Number.isFinite(lowPriceThreshold) && lowPriceThreshold > 0 ? { lowPriceThreshold } : defaultOptions;
}

function parseSelectedProfileNames(body: unknown, configuredProfileNames: string[] | undefined): string[] | undefined {
  const configured = configuredProfileNames;
  if (!body || typeof body !== "object" || !Array.isArray((body as { profileNames?: unknown }).profileNames)) {
    return configured;
  }

  const allowed = new Set(configured ?? []);
  return (body as { profileNames: unknown[] }).profileNames
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name && (!configured || allowed.has(name)));
}

function parseCaptureProfileName(body: unknown, configuredProfileNames: string[]): string | undefined {
  if (!body || typeof body !== "object") {
    return configuredProfileNames[0];
  }

  const profileName = (body as { profileName?: unknown }).profileName;
  if (typeof profileName !== "string") {
    return configuredProfileNames[0];
  }

  const trimmed = profileName.trim();
  return configuredProfileNames.includes(trimmed) ? trimmed : undefined;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
