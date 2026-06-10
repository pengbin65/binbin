import type { Page } from "playwright";
import { BrowserSession } from "../browser/browser-session.js";
import type { AppConfig } from "../config.js";
import type { TaskStateStore } from "../domain/task-state.js";
import { HubstudioClient } from "../hubstudio/hubstudio-client.js";
import { SheinProcessor } from "../shein/shein-processor.js";

type ProcessorLike = {
  processAllPages(): Promise<void>;
};

export type PricingRunnerOptions = {
  config: AppConfig;
  state: TaskStateStore;
  hubstudio?: Pick<HubstudioClient, "findProfileByName" | "startProfile">;
  browser?: Pick<BrowserSession, "connect" | "openShein" | "close">;
  createProcessor?: (page: Page) => ProcessorLike;
};

export class PricingRunner {
  private readonly hubstudio: Pick<HubstudioClient, "findProfileByName" | "startProfile">;
  private readonly browser: Pick<BrowserSession, "connect" | "openShein" | "close">;
  private readonly createProcessor: (page: Page) => ProcessorLike;

  constructor(private readonly options: PricingRunnerOptions) {
    this.hubstudio = options.hubstudio ?? new HubstudioClient({
      apiBase: options.config.hubstudioApiBase,
      apiToken: options.config.hubstudioApiToken
    });
    this.browser = options.browser ?? new BrowserSession();
    this.createProcessor = options.createProcessor ?? ((page) => new SheinProcessor(page, options.state, {
      attempts: options.config.retryAttempts,
      delayMs: options.config.retryDelayMs
    }));
  }

  async stop(): Promise<void> {
    const { state } = this.options;
    state.requestStop();
    await this.closeActiveSession();
  }

  async run(): Promise<void> {
    const { config, state } = this.options;
    state.start();

    try {
      state.log("hubstudio", `Finding Hubstudio profile: ${config.hubstudioProfileName}`);
      state.setStatus("starting_profile");
      const profile = await this.hubstudio.findProfileByName(config.hubstudioProfileName);
      if (this.shouldStopAfter("finding Hubstudio profile")) {
        return;
      }

      state.log("hubstudio", `Starting Hubstudio profile: ${profile.name}`);
      const connection = await this.hubstudio.startProfile(profile.id);
      if (this.shouldStopAfter("starting Hubstudio profile")) {
        return;
      }

      state.log("browser", "Connecting to Hubstudio browser");
      state.setStatus("connecting");
      const page = await this.browser.connect(connection.wsEndpoint);
      if (this.shouldStopAfter("connecting to Hubstudio browser")) {
        return;
      }

      state.log("shein", "Opening SHEIN New Product Negotiation page");
      state.setStatus("navigating");
      const navigation = await this.browser.openShein(page, config.sheinNewProductNegotiationUrl);
      if (this.shouldStopAfter("opening SHEIN")) {
        return;
      }

      if (navigation.status === "needs_manual_login") {
        state.setStatus("logging_in");
        state.log("login", `Manual SHEIN login required: ${navigation.reason}`, "warn");
        state.requestPause();
        state.markPaused();
        return;
      }

      await this.createProcessor(navigation.page).processAllPages();
    } catch (error) {
      state.log("runner", `Pricing runner failed: ${formatErrorMessage(error)}`, "error");
      state.setStatus("failed");
    } finally {
      if (state.snapshot().status !== "paused") {
        await this.closeActiveSession();
      }
    }
  }

  private shouldStopAfter(step: string): boolean {
    const { state } = this.options;
    if (!state.shouldStop()) {
      return false;
    }

    state.log("runner", `Stop requested after ${step}; skipping remaining startup work`, "warn");
    return true;
  }

  private async closeActiveSession(): Promise<void> {
    const { state } = this.options;
    await this.browser.close().catch((error: unknown) => {
      state.log("browser", `Browser close failed: ${formatErrorMessage(error)}`, "warn");
    });
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
