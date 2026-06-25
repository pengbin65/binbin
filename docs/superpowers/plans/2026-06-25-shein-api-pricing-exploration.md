# SHEIN API Pricing Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exploration mode that captures SHEIN seller-center pricing network requests from a logged-in Hubstudio browser session.

**Architecture:** Keep the existing UI pricing runner unchanged. Add a separate capture service and runner that start one selected Hubstudio profile, open SHEIN, listen to network traffic, sanitize captured request/response metadata, and write a timestamped JSON file under `runtime/api-captures/`. Add server and panel controls to start and stop capture independently from normal pricing.

**Tech Stack:** Node.js, TypeScript, Express, Playwright `Page` events, Vitest.

---

## File Structure

- Create `src/shein/api-capture.ts`: pure capture helpers, request classifier, sanitizer, in-memory recorder, JSON writer.
- Create `tests/shein/api-capture.test.ts`: TDD coverage for classifier, sanitization, response capture, and file output.
- Create `src/runner/api-capture-runner.ts`: orchestration for Hubstudio profile startup, SHEIN navigation, attaching capture listeners, and stopping capture.
- Create `tests/runner/api-capture-runner.test.ts`: runner behavior with fake Hubstudio/browser/page objects.
- Modify `src/server/app.ts`: add `/api/capture/start` and `/api/capture/stop`.
- Modify `src/server/index.ts`: instantiate `ApiCaptureRunner` and pass it to the app.
- Modify `public/index.html`: add compact capture controls.
- Modify `public/app.js`: wire capture buttons to the new endpoints.
- Modify `tests/server/app.test.ts`: assert capture endpoints call the capture runner.
- Modify `tests/public/app-controls.test.ts`: assert capture controls exist and are wired.

---

### Task 1: Capture Helpers

**Files:**
- Create: `src/shein/api-capture.ts`
- Test: `tests/shein/api-capture.test.ts`

- [ ] **Step 1: Write failing tests for classifier, sanitizer, recorder, and writer**

Add `tests/shein/api-capture.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApiCaptureRecorder,
  classifyCaptureUrl,
  sanitizeHeaders,
  writeApiCaptureFile
} from "../../src/shein/api-capture.js";

describe("SHEIN API capture helpers", () => {
  it("classifies likely pricing endpoints", () => {
    expect(classifyCaptureUrl("https://seller.test/dpas/discuss-price/list?type=1")).toBe("candidate");
    expect(classifyCaptureUrl("https://seller.test/api/batch_handle_cost_discuss")).toBe("candidate");
    expect(classifyCaptureUrl("https://seller.test/static/app.js")).toBe("ignore");
  });

  it("sanitizes sensitive request headers", () => {
    expect(sanitizeHeaders({
      cookie: "session=secret",
      authorization: "Bearer secret",
      "x-csrf-token": "secret",
      accept: "application/json"
    })).toEqual({
      cookie: "[redacted]",
      authorization: "[redacted]",
      "x-csrf-token": "[redacted]",
      accept: "application/json"
    });
  });

  it("records matching request and response summaries", () => {
    const recorder = new ApiCaptureRecorder();
    recorder.recordRequest({
      id: "1",
      method: "POST",
      url: "https://seller.test/api/batch_handle_cost_discuss",
      headers: { cookie: "secret" },
      postData: "{\"hello\":\"world\"}"
    });
    recorder.recordResponse({
      requestId: "1",
      status: 200,
      url: "https://seller.test/api/batch_handle_cost_discuss",
      contentType: "application/json",
      bodyPreview: "{\"ok\":true}"
    });

    expect(recorder.snapshot()).toMatchObject({
      requests: [{
        method: "POST",
        classification: "candidate",
        headers: { cookie: "[redacted]" },
        response: {
          status: 200,
          bodyPreview: "{\"ok\":true}"
        }
      }],
      candidateCount: 1
    });
  });

  it("writes a timestamped capture file", () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), "shein-capture-"));
    const recorder = new ApiCaptureRecorder();
    recorder.recordRequest({
      id: "1",
      method: "GET",
      url: "https://seller.test/dpas/discuss-price/list",
      headers: {},
      postData: null
    });

    const filePath = writeApiCaptureFile(outputDir, "shop-a", recorder.snapshot(), new Date("2026-06-25T01:02:03Z"));

    expect(path.basename(filePath)).toBe("2026-06-25T01-02-03-000Z-shop-a.json");
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
      shop: "shop-a",
      candidateCount: 1
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm.cmd test -- --run tests/shein/api-capture.test.ts
```

Expected: fail because `src/shein/api-capture.ts` does not exist.

- [ ] **Step 3: Implement capture helpers**

Create `src/shein/api-capture.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type CaptureClassification = "candidate" | "ignore";

export type CapturedRequestInput = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  postData: string | null;
};

export type CapturedResponseInput = {
  requestId: string;
  status: number;
  url: string;
  contentType: string;
  bodyPreview: string;
};

export type CapturedRequest = CapturedRequestInput & {
  classification: CaptureClassification;
  headers: Record<string, string>;
  response?: Omit<CapturedResponseInput, "requestId">;
};

export type ApiCaptureSnapshot = {
  capturedAt: string;
  requests: CapturedRequest[];
  candidateCount: number;
};

const CANDIDATE_PATTERN = /price|pricing|discuss|negotiation|batch|pending|task|dpas|cost/i;
const SENSITIVE_HEADER_PATTERN = /cookie|authorization|token|csrf|secret/i;

export function classifyCaptureUrl(url: string): CaptureClassification {
  return CANDIDATE_PATTERN.test(url) ? "candidate" : "ignore";
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    SENSITIVE_HEADER_PATTERN.test(key) ? "[redacted]" : value
  ]));
}

export class ApiCaptureRecorder {
  private readonly requests = new Map<string, CapturedRequest>();

  recordRequest(input: CapturedRequestInput): void {
    const classification = classifyCaptureUrl(input.url);
    if (classification === "ignore") {
      return;
    }

    this.requests.set(input.id, {
      ...input,
      headers: sanitizeHeaders(input.headers),
      classification
    });
  }

  recordResponse(input: CapturedResponseInput): void {
    const request = this.requests.get(input.requestId);
    if (!request) {
      return;
    }

    request.response = {
      status: input.status,
      url: input.url,
      contentType: input.contentType,
      bodyPreview: input.bodyPreview
    };
  }

  snapshot(now = new Date()): ApiCaptureSnapshot {
    const requests = [...this.requests.values()];
    return {
      capturedAt: now.toISOString(),
      requests,
      candidateCount: requests.filter((request) => request.classification === "candidate").length
    };
  }
}

export function writeApiCaptureFile(
  outputDir: string,
  shop: string,
  snapshot: ApiCaptureSnapshot,
  now = new Date()
): string {
  mkdirSync(outputDir, { recursive: true });
  const safeShop = shop.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `${now.toISOString().replace(/[:.]/g, "-")}-${safeShop}.json`;
  const filePath = path.join(outputDir, filename);
  writeFileSync(filePath, `${JSON.stringify({ shop, ...snapshot }, null, 2)}\n`, "utf8");
  return filePath;
}
```

- [ ] **Step 4: Run test to verify pass**

Run:

```powershell
npm.cmd test -- --run tests/shein/api-capture.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/shein/api-capture.ts tests/shein/api-capture.test.ts
git commit -m "feat: add shein api capture helpers"
```

---

### Task 2: API Capture Runner

**Files:**
- Create: `src/runner/api-capture-runner.ts`
- Test: `tests/runner/api-capture-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `tests/runner/api-capture-runner.test.ts`:

```ts
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, LoginNavigationResult } from "../../src/browser/browser-session.js";
import type { AppConfig } from "../../src/config.js";
import { TaskStateStore } from "../../src/domain/task-state.js";
import type { HubstudioClient, HubstudioProfile } from "../../src/hubstudio/hubstudio-client.js";
import { ApiCaptureRunner } from "../../src/runner/api-capture-runner.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3210,
  hubstudioApiBase: "http://hubstudio.test",
  hubstudioApiToken: "token",
  hubstudioProfileNames: ["shop-a"],
  sheinNewProductNegotiationUrl: "https://shein.test/new-product-negotiation",
  retryAttempts: 2,
  retryDelayMs: 0
};

describe("ApiCaptureRunner", () => {
  it("starts one profile and attaches network capture", async () => {
    const state = new TaskStateStore();
    const page = fakePage();
    const profile: HubstudioProfile = { id: "profile-1", name: "shop-a" };
    const runner = new ApiCaptureRunner({
      config,
      state,
      outputDir: "runtime/test-captures",
      hubstudio: {
        findProfileByName: vi.fn(async () => profile),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => page as unknown as Page),
        openShein: vi.fn(async (): Promise<LoginNavigationResult> => ({ status: "ready", page: page as unknown as Page })),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserSession,
      writeCapture: vi.fn(() => "runtime/test-captures/capture.json")
    });

    await runner.start("shop-a");

    expect(page.on).toHaveBeenCalledWith("request", expect.any(Function));
    expect(page.on).toHaveBeenCalledWith("response", expect.any(Function));
    expect(state.snapshot().status).toBe("pricing");
    expect(state.snapshot().logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "api-capture", message: expect.stringContaining("Capture started for shop-a") })
    ]));
  });

  it("writes capture and closes browser on stop", async () => {
    const state = new TaskStateStore();
    const close = vi.fn(async () => undefined);
    const writeCapture = vi.fn(() => "runtime/test-captures/capture.json");
    const runner = new ApiCaptureRunner({
      config,
      state,
      outputDir: "runtime/test-captures",
      hubstudio: {
        findProfileByName: vi.fn(async () => ({ id: "profile-1", name: "shop-a" })),
        startProfile: vi.fn(async () => ({ wsEndpoint: "ws://browser" }))
      } as unknown as HubstudioClient,
      browser: {
        connect: vi.fn(async () => fakePage() as unknown as Page),
        openShein: vi.fn(async ({ } as never): Promise<LoginNavigationResult> => ({ status: "ready", page: fakePage() as unknown as Page })),
        close
      } as unknown as BrowserSession,
      writeCapture
    });

    await runner.start("shop-a");
    await runner.stop();

    expect(writeCapture).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(state.snapshot().status).toBe("completed");
  });
});

function fakePage() {
  return {
    on: vi.fn(),
    bringToFront: vi.fn(async () => undefined)
  };
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm.cmd test -- --run tests/runner/api-capture-runner.test.ts
```

Expected: fail because `ApiCaptureRunner` does not exist.

- [ ] **Step 3: Implement runner**

Create `src/runner/api-capture-runner.ts` with:

```ts
import type { Page, Request, Response } from "playwright";
import { BrowserSession, type LoginNavigationResult } from "../browser/browser-session.js";
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
```

- [ ] **Step 4: Run runner tests**

Run:

```powershell
npm.cmd test -- --run tests/runner/api-capture-runner.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/runner/api-capture-runner.ts tests/runner/api-capture-runner.test.ts
git commit -m "feat: add shein api capture runner"
```

---

### Task 3: Server Endpoints

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/app.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Add to `tests/server/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run server test to verify failure**

Run:

```powershell
npm.cmd test -- --run tests/server/app.test.ts
```

Expected: fail because `captureRunner` is not supported and endpoints do not exist.

- [ ] **Step 3: Implement endpoint wiring**

In `src/server/app.ts`, add:

```ts
export type CaptureRunnerLike = {
  start(profileName: string): Promise<void>;
  stop(): Promise<void>;
};
```

Add `captureRunner?: CaptureRunnerLike` to `CreateAppOptions`.

Add routes before static middleware:

```ts
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
```

Add helper:

```ts
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
```

In `src/server/index.ts`, instantiate:

```ts
import { ApiCaptureRunner } from "../runner/api-capture-runner.js";

const captureRunner = new ApiCaptureRunner({ config, state });
const app = createApp({ state, runner, settingsStore, captureRunner });
```

- [ ] **Step 4: Run endpoint tests**

Run:

```powershell
npm.cmd test -- --run tests/server/app.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/app.ts src/server/index.ts tests/server/app.test.ts
git commit -m "feat: expose shein api capture endpoints"
```

---

### Task 4: Control Panel Capture Controls

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `tests/public/app-controls.test.ts`

- [ ] **Step 1: Write failing front-end control test**

Add to `tests/public/app-controls.test.ts`:

```ts
describe("control panel API capture controls", () => {
  it("renders and wires API capture buttons", () => {
    const html = readFileSync("public/index.html", "utf8");
    const script = readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="startCaptureButton"');
    expect(html).toContain('id="stopCaptureButton"');
    expect(script).toContain('postCaptureAction("start")');
    expect(script).toContain('postCaptureAction("stop")');
    expect(script).toContain("/api/capture/");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm.cmd test -- --run tests/public/app-controls.test.ts
```

Expected: fail because capture buttons are not present.

- [ ] **Step 3: Add HTML controls**

In `public/index.html`, add two secondary buttons near the existing task controls:

```html
<button type="button" class="secondary-button" id="startCaptureButton">开始接口探测</button>
<button type="button" class="secondary-button" id="stopCaptureButton">停止接口探测</button>
```

- [ ] **Step 4: Wire JavaScript actions**

In `public/app.js`, add element references:

```js
startCaptureButton: document.getElementById("startCaptureButton"),
stopCaptureButton: document.getElementById("stopCaptureButton"),
```

Add event listeners:

```js
elements.startCaptureButton.addEventListener("click", () => postCaptureAction("start"));
elements.stopCaptureButton.addEventListener("click", () => postCaptureAction("stop"));
```

Add helper:

```js
async function postCaptureAction(action) {
  state.pendingAction = `capture-${action}`;
  clearError();
  renderButtons();
  try {
    const body = action === "start" ? { profileName: selectedProfileNames()[0] } : undefined;
    const response = await fetch(`/api/capture/${action}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await readJsonOrEmpty(response);
    if (!response.ok) {
      throw new Error(actionErrorMessage(`capture-${action}`, response, payload));
    }
    await fetchState();
  } catch (error) {
    showError(formatError(error));
  } finally {
    state.pendingAction = undefined;
    renderButtons();
  }
}
```

In `renderButtons()`, disable start capture unless exactly one shop is selected:

```js
elements.startCaptureButton.disabled = isBusy || isActive || selectedProfileNames().length !== 1;
elements.stopCaptureButton.disabled = isBusy;
```

- [ ] **Step 5: Run front-end tests**

Run:

```powershell
npm.cmd test -- --run tests/public/app-controls.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add public/index.html public/app.js tests/public/app-controls.test.ts
git commit -m "feat: add api capture controls"
```

---

### Task 5: Full Verification and Package

**Files:**
- No source changes expected unless verification reveals a defect.

- [ ] **Step 1: Run full tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm.cmd run typecheck
```

Expected: TypeScript passes with no errors.

- [ ] **Step 3: Build green package**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\package-green.ps1
```

Expected output includes:

```text
Package created:
C:\Users\win\Documents\指纹浏览器核价\release\pricing-console-green
C:\Users\win\Documents\指纹浏览器核价\release\pricing-console-green.zip
```

- [ ] **Step 4: Restart local dev server**

Run:

```powershell
$connections = Get-NetTCPConnection -LocalPort 3210 -ErrorAction SilentlyContinue
$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) { if ($processId) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 1
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\win\Documents\指纹浏览器核价' -WindowStyle Hidden
Start-Sleep -Seconds 3
Get-NetTCPConnection -LocalPort 3210 -ErrorAction SilentlyContinue | Select-Object -First 10 LocalAddress,LocalPort,State,OwningProcess
```

Expected: `0.0.0.0 3210 Listen`.

- [ ] **Step 5: Commit packaging-adjacent changes if any**

Only commit tracked source/test/doc changes. Do not commit `release/`, `dist/`, `runtime/`, or `data/`.

```powershell
git status --short
```

Expected: no uncommitted tracked source changes after prior task commits.

---

## Self-Review

Spec coverage:

- Capture network traffic: Task 2.
- Request classifier and sanitizer: Task 1.
- Save sanitized files under `runtime/api-captures/`: Task 1 and Task 2.
- Control-panel start/stop: Task 3 and Task 4.
- Avoid replacing existing pricing runner: Task 2 creates separate runner and Task 3 separate endpoints.
- Verification: Task 5.

Placeholder scan: no placeholder tasks remain. Each task has exact files, commands, and expected results.

Type consistency:

- `ApiCaptureRecorder`, `ApiCaptureSnapshot`, and `writeApiCaptureFile` are defined in Task 1 and used in Task 2.
- `ApiCaptureRunner` is defined in Task 2 and used in Task 3.
- `/api/capture/start` and `/api/capture/stop` are defined in Task 3 and called by Task 4.
