import type { Page, Request, Response } from "playwright";
import { BrowserSession } from "../browser/browser-session.js";
import type { AppConfig } from "../config.js";
import type { TaskStateStore } from "../domain/task-state.js";
import { HubstudioClient } from "../hubstudio/hubstudio-client.js";
import { ApiCaptureRecorder, writeApiCaptureFile, type ApiCaptureSnapshot } from "../shein/api-capture.js";

type CaptureBrowser = Pick<BrowserSession, "connect" | "openShein" | "close">;
type CaptureHubstudio = Pick<HubstudioClient, "findProfileByName" | "startProfile">;

export type ApiCaptureRunnerOptions = {
  config: AppConfig;
  state: TaskStateStore;
  outputDir?: string;
  hubstudio?: CaptureHubstudio;
  browser?: CaptureBrowser;
  writeCapture?: (outputDir: string, shop: string, snapshot: ApiCaptureSnapshot) => string;
};

export class ApiCaptureRunner {
  private readonly hubstudio: CaptureHubstudio;
  private readonly browser: CaptureBrowser;
  private readonly outputDir: string;
  private readonly writeCapture: (outputDir: string, shop: string, snapshot: ApiCaptureSnapshot) => string;
  private recorder: ApiCaptureRecorder | undefined;
  private activeShop: string | undefined;

  constructor(private readonly options: ApiCaptureRunnerOptions) {
    this.hubstudio = options.hubstudio ?? new HubstudioClient({
      apiBase: options.config.hubstudioApiBase,
      apiToken: options.config.hubstudioApiToken
    });
    this.browser = options.browser ?? new BrowserSession();
    this.outputDir = options.outputDir ?? "runtime/api-captures";
    this.writeCapture = options.writeCapture ?? writeApiCaptureFile;
  }

  async start(profileName: string): Promise<void> {
    const { state } = this.options;
    state.start();
    state.setStatus("starting_profile");
    state.log("hubstudio", `Finding Hubstudio profile: ${profileName}`);
    const profile = await this.hubstudio.findProfileByName(profileName);
    state.log("hubstudio", `Starting Hubstudio profile: ${profile.name}`);
    const connection = await this.hubstudio.startProfile(profile.id);
    state.setStatus("connecting");
    const page = await this.browser.connect(connection.wsEndpoint);
    state.setStatus("navigating");
    const navigation = await this.browser.openShein(page, this.options.config.sheinNewProductNegotiationUrl);
    if (navigation.status === "needs_manual_login") {
      state.log("login", `Manual SHEIN login required for ${profile.name}: ${navigation.reason}`, "warn");
      state.requestPause();
      state.markPaused();
      return;
    }

    this.activeShop = profile.name;
    this.recorder = new ApiCaptureRecorder();
    this.attach(navigation.page);
    await navigation.page.bringToFront?.().catch(() => undefined);
    state.setStatus("pricing");
    state.log("api-capture", `Capture started for ${profile.name}`);
  }

  async stop(): Promise<void> {
    const { state } = this.options;
    if (this.recorder && this.activeShop) {
      const filePath = this.writeCapture(this.outputDir, this.activeShop, this.recorder.snapshot());
      state.log("api-capture", `Capture saved to ${filePath}`);
    }
    await this.browser.close();
    state.setStatus("completed");
  }

  private attach(page: Page): void {
    const requestIds = new WeakMap<Request, string>();
    page.on("request", (request) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requestIds.set(request, id);
      this.recorder?.recordRequest({
        id,
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        postData: request.postData()
      });
    });
    page.on("response", async (response: Response) => {
      const request = response.request();
      const id = requestIds.get(request);
      if (!id) {
        return;
      }
      const bodyPreview = await response.text().catch(() => "");
      this.recorder?.recordResponse({
        requestId: id,
        status: response.status(),
        url: response.url(),
        contentType: response.headers()["content-type"] ?? "",
        bodyPreview: bodyPreview.slice(0, 2000)
      });
    });
  }
}
