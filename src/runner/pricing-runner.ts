import type { Page } from "playwright";
import { BrowserSession, type LoginNavigationResult } from "../browser/browser-session.js";
import type { AppConfig } from "../config.js";
import type { PricingOptions, PricingRuleId } from "../domain/pricing.js";
import type { TaskStateStore } from "../domain/task-state.js";
import { HubstudioClient } from "../hubstudio/hubstudio-client.js";
import { SheinApiProcessor } from "../shein/api-processor.js";

type ProcessorLike = {
  processAllPages(): Promise<void>;
};

export type PricingRunnerOptions = {
  config: AppConfig;
  state: TaskStateStore;
  hubstudio?: Pick<HubstudioClient, "findProfileByName" | "startProfile">;
  browser?: Pick<BrowserSession, "connect" | "openShein" | "close">;
  createProcessor?: (page: Page, pricingRule: PricingRuleId, pricingOptions: PricingOptions) => ProcessorLike;
};

export class PricingRunner {
  private readonly hubstudio: Pick<HubstudioClient, "findProfileByName" | "startProfile">;
  private readonly browser: Pick<BrowserSession, "connect" | "openShein" | "close">;
  private readonly createProcessor: (page: Page, pricingRule: PricingRuleId, pricingOptions: PricingOptions) => ProcessorLike;

  constructor(private readonly options: PricingRunnerOptions) {
    this.hubstudio = options.hubstudio ?? new HubstudioClient({
      apiBase: options.config.hubstudioApiBase,
      apiToken: options.config.hubstudioApiToken
    });
    this.browser = options.browser ?? new BrowserSession();
    this.createProcessor = options.createProcessor ?? ((page, pricingRule, pricingOptions) => new SheinApiProcessor(
      page,
      options.state,
      pricingRule,
      pricingOptions,
      { delayMs: options.config.retryDelayMs }
    ));
  }

  async stop(): Promise<void> {
    const { state } = this.options;
    state.requestStop();
    await this.closeActiveSession();
  }

  async run(
    profileNames = this.options.config.hubstudioProfileNames,
    pricingRule: PricingRuleId = "women_shein",
    pricingOptions: PricingOptions = {}
  ): Promise<void> {
    const { config, state } = this.options;
    state.start();

    try {
      for (const [index, profileName] of profileNames.entries()) {
        await this.runProfile(profileName, pricingRule, pricingOptions);

        const snapshot = state.snapshot();
        if (snapshot.status !== "completed") {
          return;
        }

        if (index < profileNames.length - 1) {
          await this.closeActiveSession();
        }
      }
    } catch (error) {
      state.log("runner", `Pricing runner failed: ${formatErrorMessage(error)}`, "error");
      state.setStatus("failed");
    } finally {
      if (state.snapshot().status !== "paused") {
        await this.closeActiveSession();
      }
    }
  }

  private async runProfile(profileName: string, pricingRule: PricingRuleId, pricingOptions: PricingOptions): Promise<void> {
    const { state } = this.options;

    state.log("hubstudio", `Finding Hubstudio profile: ${profileName}`);
    state.setStatus("starting_profile");
    const profile = await this.hubstudio.findProfileByName(profileName);
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

    state.log("shein", `Opening SHEIN New Product Negotiation page for ${profile.name}`);
    state.setStatus("navigating");
    const navigation = await this.openSheinWithRetry(page);
    if (!navigation) {
      return;
    }
    if (this.shouldStopAfter("opening SHEIN")) {
      return;
    }

    if (navigation.status === "needs_manual_login") {
      state.setStatus("logging_in");
      state.log("login", `Manual SHEIN login required for ${profile.name}: ${navigation.reason}`, "warn");
      state.requestPause();
      state.markPaused();
      return;
    }

    await this.createProcessor(navigation.page, pricingRule, pricingOptions).processAllPages();
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

  private async openSheinWithRetry(page: Page): Promise<LoginNavigationResult | null> {
    const { config, state } = this.options;
    let lastError: unknown;
    const attempts = Math.max(1, config.retryAttempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (state.shouldStop()) {
        return null;
      }

      try {
        return await this.browser.openShein(page, config.sheinNewProductNegotiationUrl);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          state.log("shein", `Open SHEIN attempt ${attempt} failed`, "warn");
          await delay(config.retryDelayMs);
          if (state.shouldStop()) {
            return null;
          }
        }
      }
    }

    throw new Error(`Open SHEIN failed: ${formatErrorMessage(lastError)}`);
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
