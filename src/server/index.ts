import http from "node:http";
import { loadConfig } from "../config.js";
import { TaskStateStore } from "../domain/task-state.js";
import { ApiCaptureRunner } from "../runner/api-capture-runner.js";
import { PricingRunner } from "../runner/pricing-runner.js";
import { JsonSettingsStore } from "../settings.js";
import { attachStateWebSocket, createApp } from "./app.js";

const config = loadConfig();
const state = new TaskStateStore();
const runner = new PricingRunner({ config, state });
const captureRunner = new ApiCaptureRunner({ config, state });
const settingsStore = new JsonSettingsStore("data/settings.json", {
  profileNames: config.hubstudioProfileNames,
  pricingRule: "low_price",
  pricingOptions: { lowPriceThreshold: 0.7 }
});
const app = createApp({ state, runner, settingsStore, captureRunner });
const server = http.createServer(app);

attachStateWebSocket(server, state);

server.listen(config.port, config.host, () => {
  console.log(`Pricing server listening on http://${config.host}:${config.port}`);
});
