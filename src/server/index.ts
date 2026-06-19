import http from "node:http";
import { loadConfig } from "../config.js";
import { TaskStateStore } from "../domain/task-state.js";
import { PricingRunner } from "../runner/pricing-runner.js";
import { attachStateWebSocket, createApp } from "./app.js";

const config = loadConfig();
const state = new TaskStateStore();
const runner = new PricingRunner({ config, state });
const app = createApp({ state, runner, profileNames: config.hubstudioProfileNames });
const server = http.createServer(app);

attachStateWebSocket(server, state);

server.listen(config.port, config.host, () => {
  console.log(`Pricing server listening on http://${config.host}:${config.port}`);
});
