# Hubstudio SHEIN Pricing Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web console that starts Hubstudio profile `女装希音1`, opens SHEIN New Product Negotiation, checks all pages against the pricing rules, and rejects failed products.

**Architecture:** Use a small Node.js TypeScript app. Express serves the local console and REST controls, `ws` streams status/log/result events, Playwright connects to the Hubstudio-started browser, and domain logic stays in pure TypeScript modules with unit tests.

**Tech Stack:** Node.js 20+, TypeScript, Express, ws, Playwright, Vitest, native `fetch`.

---

## File Structure

- Create: `package.json` - scripts and dependencies.
- Create: `tsconfig.json` - TypeScript compiler settings.
- Create: `vitest.config.ts` - test configuration.
- Create: `.gitignore` - excludes dependencies, runtime data, logs, and env files.
- Create: `.env.example` - documents runtime settings without secrets.
- Create: `src/config.ts` - reads and validates environment configuration.
- Create: `src/domain/pricing.ts` - pure price parsing and pricing decision logic.
- Create: `src/domain/task-state.ts` - task lifecycle, logs, result rows, pause/stop state.
- Create: `src/hubstudio/hubstudio-client.ts` - configurable Hubstudio local API client.
- Create: `src/browser/browser-session.ts` - connects Playwright to Hubstudio browser and handles login/navigation states.
- Create: `src/shein/shein-processor.ts` - reads product rows, applies pricing, rejects failed rows, paginates.
- Create: `src/server/app.ts` - Express app, REST endpoints, WebSocket broadcast.
- Create: `src/server/index.ts` - server entry point.
- Create: `src/runner/pricing-runner.ts` - orchestrates config, Hubstudio, browser, and SHEIN processor.
- Create: `public/index.html` - local web console UI.
- Create: `public/app.js` - browser-side console logic.
- Create: `tests/domain/pricing.test.ts` - pricing unit tests.
- Create: `tests/domain/task-state.test.ts` - task state tests.
- Create: `tests/hubstudio/hubstudio-client.test.ts` - Hubstudio API client tests using mocked fetch.
- Create: `tests/shein/shein-processor.test.ts` - SHEIN processor tests using mocked Playwright-like objects.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hubstudio-shein-pricing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.45.0",
    "ws": "^8.17.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/ws": "^8.5.10",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true
  }
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.log
runtime/
playwright-report/
test-results/
```

- [ ] **Step 5: Create `.env.example`**

```dotenv
PORT=3210
HUBSTUDIO_API_BASE=http://127.0.0.1:6873
HUBSTUDIO_API_TOKEN=
HUBSTUDIO_PROFILE_NAME=女装希音1
SHEIN_NEW_PRODUCT_NEGOTIATION_URL=
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000
```

- [ ] **Step 6: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 7: Verify scaffold**

Run:

```powershell
npm run typecheck
npm test
```

Expected: typecheck succeeds, Vitest reports no test files or all current tests pass.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: scaffold Node TypeScript app"
```

## Task 2: Pricing Domain Logic

**Files:**
- Create: `src/domain/pricing.ts`
- Test: `tests/domain/pricing.test.ts`

- [ ] **Step 1: Write failing tests in `tests/domain/pricing.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { evaluatePricing, parsePrice } from "../../src/domain/pricing.js";

describe("parsePrice", () => {
  it("parses prices with currency symbols, commas, and spaces", () => {
    expect(parsePrice(" ¥ 1,234.50 ")).toBe(1234.5);
    expect(parsePrice("$8")).toBe(8);
  });

  it("returns null for unreadable prices", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("--")).toBeNull();
  });
});

describe("evaluatePricing", () => {
  it("passes when current selling price is greater than 70 percent threshold", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 64, officialSuggestedPrice: 0 })).toMatchObject({
      passed: true,
      reason: "CURRENT_PRICE_ABOVE_70_PERCENT"
    });
  });

  it("fails when current selling price equals threshold and suggested price is below 8", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 63, officialSuggestedPrice: 7.99 })).toMatchObject({
      passed: false,
      reason: "FAILED_BOTH_RULES"
    });
  });

  it("passes when official suggested price is at least 8", () => {
    expect(evaluatePricing({ quotedPrice: 100, currentSellingPrice: 62.99, officialSuggestedPrice: 8 })).toMatchObject({
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/domain/pricing.test.ts
```

Expected: FAIL because `src/domain/pricing.ts` does not exist.

- [ ] **Step 3: Create `src/domain/pricing.ts`**

```ts
export type PricingInput = {
  quotedPrice: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
};

export type PricingDecisionReason =
  | "CURRENT_PRICE_ABOVE_70_PERCENT"
  | "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
  | "FAILED_BOTH_RULES";

export type PricingDecision = {
  originalPrice: number;
  threshold70Percent: number;
  passed: boolean;
  reason: PricingDecisionReason;
};

export function parsePrice(value: string): number | null {
  const normalized = value.replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluatePricing(input: PricingInput): PricingDecision {
  const originalPrice = input.quotedPrice - 10;
  const threshold70Percent = originalPrice * 0.7;

  if (input.currentSellingPrice > threshold70Percent) {
    return {
      originalPrice,
      threshold70Percent,
      passed: true,
      reason: "CURRENT_PRICE_ABOVE_70_PERCENT"
    };
  }

  if (input.officialSuggestedPrice >= 8) {
    return {
      originalPrice,
      threshold70Percent,
      passed: true,
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
    };
  }

  return {
    originalPrice,
    threshold70Percent,
    passed: false,
    reason: "FAILED_BOTH_RULES"
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/domain/pricing.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/pricing.ts tests/domain/pricing.test.ts
git commit -m "feat: add SHEIN pricing rules"
```

## Task 3: Task State, Logs, Results, Pause And Stop

**Files:**
- Create: `src/domain/task-state.ts`
- Test: `tests/domain/task-state.test.ts`

- [ ] **Step 1: Write failing tests in `tests/domain/task-state.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";

describe("TaskStateStore", () => {
  it("starts, logs, records results, pauses, and stops", () => {
    const store = new TaskStateStore();

    store.start();
    store.log("connecting", "Connecting to Hubstudio");
    store.recordResult({
      productId: "sku-1",
      quotedPrice: 100,
      originalPrice: 90,
      threshold70Percent: 63,
      currentSellingPrice: 62.99,
      officialSuggestedPrice: 8,
      passed: true,
      action: "recorded",
      reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
    });
    store.requestPause();
    store.markPaused();
    store.requestStop();

    const snapshot = store.snapshot();
    expect(snapshot.status).toBe("stopped");
    expect(snapshot.pauseRequested).toBe(true);
    expect(snapshot.stopRequested).toBe(true);
    expect(snapshot.logs).toHaveLength(1);
    expect(snapshot.results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/domain/task-state.test.ts
```

Expected: FAIL because `src/domain/task-state.ts` does not exist.

- [ ] **Step 3: Create `src/domain/task-state.ts`**

```ts
export type TaskStatus =
  | "idle"
  | "connecting"
  | "starting_profile"
  | "logging_in"
  | "navigating"
  | "pricing"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type LogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
};

export type ResultRow = {
  productId: string;
  quotedPrice: number;
  originalPrice: number;
  threshold70Percent: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
  passed: boolean;
  action: "recorded" | "rejected" | "skipped";
  reason: string;
  error?: string;
};

export type TaskSnapshot = {
  status: TaskStatus;
  pauseRequested: boolean;
  stopRequested: boolean;
  logs: LogEntry[];
  results: ResultRow[];
};

export class TaskStateStore {
  private status: TaskStatus = "idle";
  private pauseRequested = false;
  private stopRequested = false;
  private logs: LogEntry[] = [];
  private results: ResultRow[] = [];

  start(): void {
    this.status = "connecting";
    this.pauseRequested = false;
    this.stopRequested = false;
    this.logs = [];
    this.results = [];
  }

  setStatus(status: TaskStatus): void {
    if (this.stopRequested) {
      this.status = "stopped";
      return;
    }
    this.status = status;
  }

  log(phase: string, message: string, level: LogEntry["level"] = "info"): void {
    this.logs.push({ at: new Date().toISOString(), level, phase, message });
  }

  recordResult(row: ResultRow): void {
    this.results.push(row);
  }

  requestPause(): void {
    this.pauseRequested = true;
  }

  markPaused(): void {
    this.status = "paused";
  }

  requestStop(): void {
    this.stopRequested = true;
    this.status = "stopped";
  }

  shouldPause(): boolean {
    return this.pauseRequested;
  }

  shouldStop(): boolean {
    return this.stopRequested;
  }

  snapshot(): TaskSnapshot {
    return {
      status: this.status,
      pauseRequested: this.pauseRequested,
      stopRequested: this.stopRequested,
      logs: [...this.logs],
      results: [...this.results]
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/domain/task-state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/task-state.ts tests/domain/task-state.test.ts
git commit -m "feat: add task state store"
```

## Task 4: Configuration And Hubstudio API Client

**Files:**
- Create: `src/config.ts`
- Create: `src/hubstudio/hubstudio-client.ts`
- Test: `tests/hubstudio/hubstudio-client.test.ts`

- [ ] **Step 1: Write failing tests in `tests/hubstudio/hubstudio-client.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { HubstudioClient } from "../../src/hubstudio/hubstudio-client.js";

describe("HubstudioClient", () => {
  it("searches profile by name and starts it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "profile-1", name: "女装希音1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc" } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "token",
      fetchImpl: fetchMock
    });

    const profile = await client.findProfileByName("女装希音1");
    const browser = await client.startProfile(profile.id);

    expect(profile).toEqual({ id: "profile-1", name: "女装希音1" });
    expect(browser.wsEndpoint).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/hubstudio/hubstudio-client.test.ts
```

Expected: FAIL because `HubstudioClient` does not exist.

- [ ] **Step 3: Create `src/config.ts`**

```ts
export type AppConfig = {
  port: number;
  hubstudioApiBase: string;
  hubstudioApiToken: string;
  hubstudioProfileName: string;
  sheinNewProductNegotiationUrl: string;
  retryAttempts: number;
  retryDelayMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3210),
    hubstudioApiBase: env.HUBSTUDIO_API_BASE ?? "http://127.0.0.1:6873",
    hubstudioApiToken: env.HUBSTUDIO_API_TOKEN ?? "",
    hubstudioProfileName: env.HUBSTUDIO_PROFILE_NAME ?? "女装希音1",
    sheinNewProductNegotiationUrl: env.SHEIN_NEW_PRODUCT_NEGOTIATION_URL ?? "",
    retryAttempts: Number(env.RETRY_ATTEMPTS ?? 3),
    retryDelayMs: Number(env.RETRY_DELAY_MS ?? 1000)
  };
}
```

- [ ] **Step 4: Create `src/hubstudio/hubstudio-client.ts`**

```ts
export type HubstudioProfile = {
  id: string;
  name: string;
};

export type HubstudioBrowserConnection = {
  wsEndpoint: string;
};

export type HubstudioClientOptions = {
  apiBase: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
};

type HubstudioListResponse = {
  data?: Array<{ id: string; name: string }>;
};

type HubstudioStartResponse = {
  data?: {
    wsEndpoint?: string;
    ws_endpoint?: string;
    debugUrl?: string;
    debug_url?: string;
  };
};

export class HubstudioClient {
  private readonly apiBase: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HubstudioClientOptions) {
    this.apiBase = options.apiBase.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async findProfileByName(name: string): Promise<HubstudioProfile> {
    const response = await this.request<HubstudioListResponse>(`/api/v1/profiles?name=${encodeURIComponent(name)}`);
    const profile = response.data?.find((item) => item.name === name);
    if (!profile) {
      throw new Error(`Hubstudio profile not found: ${name}`);
    }
    return profile;
  }

  async startProfile(profileId: string): Promise<HubstudioBrowserConnection> {
    const response = await this.request<HubstudioStartResponse>(`/api/v1/profiles/${encodeURIComponent(profileId)}/start`, {
      method: "POST"
    });
    const endpoint = response.data?.wsEndpoint ?? response.data?.ws_endpoint ?? response.data?.debugUrl ?? response.data?.debug_url;
    if (!endpoint) {
      throw new Error("Hubstudio did not return a browser websocket endpoint");
    }
    return { wsEndpoint: endpoint };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    const response = await this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new Error(`Hubstudio API failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/hubstudio/hubstudio-client.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Manual Hubstudio discovery checkpoint**

Open Hubstudio and find the local API documentation/settings. Update only these items if the real API differs:

- `HUBSTUDIO_API_BASE` in `.env`
- `HUBSTUDIO_API_TOKEN` in `.env`
- The list endpoint path in `findProfileByName`
- The start endpoint path in `startProfile`
- The browser endpoint field mapping in `startProfile`

Run:

```powershell
npm test -- tests/hubstudio/hubstudio-client.test.ts
```

Expected: tests still pass after any endpoint mapping changes.

- [ ] **Step 7: Commit**

```powershell
git add src/config.ts src/hubstudio/hubstudio-client.ts tests/hubstudio/hubstudio-client.test.ts
git commit -m "feat: add Hubstudio API client"
```

## Task 5: Browser Session

**Files:**
- Create: `src/browser/browser-session.ts`

- [ ] **Step 1: Create `src/browser/browser-session.ts`**

```ts
import { chromium, type Browser, type Page } from "playwright";

export type BrowserSessionOptions = {
  wsEndpoint: string;
  sheinNewProductNegotiationUrl: string;
};

export type LoginNavigationResult =
  | { status: "ready"; page: Page }
  | { status: "needs_manual_login"; page: Page; reason: string };

export class BrowserSession {
  private browser: Browser | null = null;

  async connect(wsEndpoint: string): Promise<Page> {
    this.browser = await chromium.connectOverCDP(wsEndpoint);
    const context = this.browser.contexts()[0] ?? await this.browser.newContext();
    return context.pages()[0] ?? await context.newPage();
  }

  async openShein(page: Page, url: string): Promise<LoginNavigationResult> {
    if (!url) {
      return { status: "needs_manual_login", page, reason: "SHEIN_NEW_PRODUCT_NEGOTIATION_URL is not configured" };
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const verificationVisible = await page
      .locator("text=/验证码|验证|二次验证|安全验证|Verification|Verify/i")
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (verificationVisible) {
      return { status: "needs_manual_login", page, reason: "SHEIN verification is visible" };
    }

    const loginButton = page.locator("button:has-text('登录'), button:has-text('Login')").first();
    if (await loginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginButton.click();
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    }

    const stillLogin = await loginButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (stillLogin) {
      return { status: "needs_manual_login", page, reason: "Login did not complete after clicking saved credentials login" };
    }

    return { status: "ready", page };
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/browser/browser-session.ts
git commit -m "feat: add browser session connector"
```

## Task 6: SHEIN Processor

**Files:**
- Create: `src/shein/shein-processor.ts`
- Test: `tests/shein/shein-processor.test.ts`

- [ ] **Step 1: Write failing tests in `tests/shein/shein-processor.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { readRowPrices } from "../../src/shein/shein-processor.js";

describe("readRowPrices", () => {
  it("extracts all three prices from row text", async () => {
    const row = {
      textContent: vi.fn().mockResolvedValue("报价 ¥100 当前销售价 ¥62.99 官方建议价 ¥8")
    };

    await expect(readRowPrices(row)).resolves.toEqual({
      quotedPrice: 100,
      currentSellingPrice: 62.99,
      officialSuggestedPrice: 8
    });
  });

  it("returns null when prices are missing", async () => {
    const row = {
      textContent: vi.fn().mockResolvedValue("报价 -- 当前销售价 -- 官方建议价 --")
    };

    await expect(readRowPrices(row)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/shein/shein-processor.test.ts
```

Expected: FAIL because `src/shein/shein-processor.ts` does not exist.

- [ ] **Step 3: Create `src/shein/shein-processor.ts`**

```ts
import type { Locator, Page } from "playwright";
import { evaluatePricing, parsePrice, type PricingInput } from "../domain/pricing.js";
import type { TaskStateStore } from "../domain/task-state.js";

export type RetryOptions = {
  attempts: number;
  delayMs: number;
};

export async function readRowPrices(row: Pick<Locator, "textContent">): Promise<PricingInput | null> {
  const text = (await row.textContent()) ?? "";
  const quoted = matchPrice(text, /报价\s*([^\s]+)/);
  const current = matchPrice(text, /当前销售价\s*([^\s]+)/);
  const suggested = matchPrice(text, /官方建议价\s*([^\s]+)/);

  if (quoted === null || current === null || suggested === null) {
    return null;
  }

  return {
    quotedPrice: quoted,
    currentSellingPrice: current,
    officialSuggestedPrice: suggested
  };
}

function matchPrice(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? parsePrice(match[1]) : null;
}

export class SheinProcessor {
  constructor(
    private readonly page: Page,
    private readonly state: TaskStateStore,
    private readonly retry: RetryOptions
  ) {}

  async processAllPages(): Promise<void> {
    this.state.setStatus("pricing");
    await this.assertNewProductNegotiationPage();

    while (!this.state.shouldStop()) {
      await this.processCurrentPage();
      if (this.state.shouldPause()) {
        this.state.markPaused();
        return;
      }
      const moved = await this.goNextPage();
      if (!moved) {
        this.state.setStatus("completed");
        return;
      }
    }
  }

  private async assertNewProductNegotiationPage(): Promise<void> {
    const textVisible = await this.page.locator("text=/新品议价|New Product Negotiation/i").first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!textVisible) {
      throw new Error("Current page is not SHEIN New Product Negotiation");
    }
  }

  private async processCurrentPage(): Promise<void> {
    const rows = this.page.locator("[data-testid='product-row'], tr:has-text('报价')");
    const count = await rows.count();

    for (let index = 0; index < count; index += 1) {
      if (this.state.shouldStop()) return;

      const row = rows.nth(index);
      const prices = await this.withRetry(() => readRowPrices(row), "read product prices");
      if (!prices) {
        this.state.log("pricing", `Price data unreadable for row ${index + 1}`, "error");
        this.state.markPaused();
        return;
      }

      const decision = evaluatePricing(prices);
      const productId = await this.productIdFor(row, index);
      const baseResult = {
        productId,
        quotedPrice: prices.quotedPrice,
        originalPrice: decision.originalPrice,
        threshold70Percent: decision.threshold70Percent,
        currentSellingPrice: prices.currentSellingPrice,
        officialSuggestedPrice: prices.officialSuggestedPrice,
        passed: decision.passed,
        reason: decision.reason
      };

      if (decision.passed) {
        this.state.recordResult({ ...baseResult, action: "recorded" });
      } else {
        await this.withRetry(async () => {
          await row.locator("button:has-text('拒绝'), button:has-text('驳回'), button:has-text('Reject')").first().click({ timeout: 5000 });
          return true;
        }, "reject failed product");
        this.state.recordResult({ ...baseResult, action: "rejected" });
      }
    }
  }

  private async goNextPage(): Promise<boolean> {
    const next = this.page.locator("button:has-text('下一页'), button:has-text('Next')").first();
    const enabled = await next.isEnabled({ timeout: 3000 }).catch(() => false);
    if (!enabled) return false;
    await next.click();
    await this.page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    return true;
  }

  private async productIdFor(row: Locator, index: number): Promise<string> {
    const attr = await row.getAttribute("data-product-id").catch(() => null);
    return attr ?? `row-${index + 1}`;
  }

  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        this.state.log(label, `Attempt ${attempt} failed`, "warn");
        await new Promise((resolve) => setTimeout(resolve, this.retry.delayMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/shein/shein-processor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Manual selector checkpoint**

Open SHEIN New Product Negotiation in Hubstudio and inspect the actual row, price, reject button, and next page selectors. Replace these selectors in `src/shein/shein-processor.ts` if needed:

```ts
"[data-testid='product-row'], tr:has-text('报价')"
"button:has-text('拒绝'), button:has-text('驳回'), button:has-text('Reject')"
"button:has-text('下一页'), button:has-text('Next')"
```

Run:

```powershell
npm run typecheck
```

Expected: PASS after selector updates.

- [ ] **Step 6: Commit**

```powershell
git add src/shein/shein-processor.ts tests/shein/shein-processor.test.ts
git commit -m "feat: add SHEIN negotiation processor"
```

## Task 7: Runner And Local Server

**Files:**
- Create: `src/runner/pricing-runner.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`

- [ ] **Step 1: Create `src/runner/pricing-runner.ts`**

```ts
import { BrowserSession } from "../browser/browser-session.js";
import type { AppConfig } from "../config.js";
import type { TaskStateStore } from "../domain/task-state.js";
import { HubstudioClient } from "../hubstudio/hubstudio-client.js";
import { SheinProcessor } from "../shein/shein-processor.js";

export class PricingRunner {
  constructor(
    private readonly config: AppConfig,
    private readonly state: TaskStateStore
  ) {}

  async run(): Promise<void> {
    this.state.start();
    const hubstudio = new HubstudioClient({
      apiBase: this.config.hubstudioApiBase,
      apiToken: this.config.hubstudioApiToken
    });
    const browserSession = new BrowserSession();

    try {
      this.state.log("hubstudio", `Searching profile ${this.config.hubstudioProfileName}`);
      const profile = await hubstudio.findProfileByName(this.config.hubstudioProfileName);
      this.state.setStatus("starting_profile");

      const connection = await hubstudio.startProfile(profile.id);
      const page = await browserSession.connect(connection.wsEndpoint);

      this.state.setStatus("logging_in");
      const login = await browserSession.openShein(page, this.config.sheinNewProductNegotiationUrl);
      if (login.status !== "ready") {
        this.state.log("login", login.reason, "warn");
        this.state.markPaused();
        return;
      }

      const processor = new SheinProcessor(login.page, this.state, {
        attempts: this.config.retryAttempts,
        delayMs: this.config.retryDelayMs
      });
      await processor.processAllPages();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.log("runner", message, "error");
      this.state.setStatus("failed");
    }
  }
}
```

- [ ] **Step 2: Create `src/server/app.ts`**

```ts
import express from "express";
import { WebSocketServer } from "ws";
import { loadConfig } from "../config.js";
import { TaskStateStore } from "../domain/task-state.js";
import { PricingRunner } from "../runner/pricing-runner.js";

export function createApp() {
  const app = express();
  const state = new TaskStateStore();
  const config = loadConfig();
  let running = false;

  app.use(express.json());
  app.use(express.static("public"));

  app.get("/api/state", (_req, res) => {
    res.json(state.snapshot());
  });

  app.post("/api/start", async (_req, res) => {
    if (running) {
      res.status(409).json({ error: "Task is already running" });
      return;
    }

    running = true;
    res.json({ ok: true });
    await new PricingRunner(config, state).run();
    running = false;
  });

  app.post("/api/pause", (_req, res) => {
    state.requestPause();
    res.json({ ok: true });
  });

  app.post("/api/stop", (_req, res) => {
    state.requestStop();
    running = false;
    res.json({ ok: true });
  });

  return { app, state };
}

export function attachStateSocket(server: import("http").Server, state: TaskStateStore) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const interval = setInterval(() => {
    const payload = JSON.stringify(state.snapshot());
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }, 1000);
  wss.on("close", () => clearInterval(interval));
}
```

- [ ] **Step 3: Create `src/server/index.ts`**

```ts
import http from "node:http";
import { loadConfig } from "../config.js";
import { attachStateSocket, createApp } from "./app.js";

const config = loadConfig();
const { app, state } = createApp();
const server = http.createServer(app);
attachStateSocket(server, state);

server.listen(config.port, () => {
  console.log(`Hubstudio SHEIN pricing console: http://127.0.0.1:${config.port}`);
});
```

- [ ] **Step 4: Typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/runner/pricing-runner.ts src/server/app.ts src/server/index.ts
git commit -m "feat: add pricing runner and server"
```

## Task 8: Web Console UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hubstudio SHEIN 核价</title>
    <style>
      body { margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; background: #f6f7f9; color: #1f2937; }
      header { padding: 16px 24px; background: #ffffff; border-bottom: 1px solid #e5e7eb; }
      main { padding: 20px 24px; display: grid; gap: 16px; }
      button { padding: 8px 14px; border: 1px solid #cbd5e1; background: #ffffff; border-radius: 6px; cursor: pointer; }
      button.primary { background: #2563eb; color: #ffffff; border-color: #2563eb; }
      section { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
      .toolbar { display: flex; gap: 8px; align-items: center; }
      .status { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; }
      pre { max-height: 260px; overflow: auto; background: #111827; color: #f9fafb; padding: 12px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <header>
      <h1>Hubstudio SHEIN 核价</h1>
    </header>
    <main>
      <section class="toolbar">
        <button id="start" class="primary">开始</button>
        <button id="pause">暂停</button>
        <button id="stop">停止</button>
        <span>状态：<span id="status" class="status">idle</span></span>
      </section>
      <section>
        <h2>本次结果</h2>
        <table>
          <thead>
            <tr>
              <th>商品</th><th>报价</th><th>原价</th><th>7折线</th><th>当前售价</th><th>官方建议价</th><th>结果</th><th>动作</th><th>原因</th>
            </tr>
          </thead>
          <tbody id="results"></tbody>
        </table>
      </section>
      <section>
        <h2>日志</h2>
        <pre id="logs"></pre>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `public/app.js`**

```js
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const logsEl = document.querySelector("#logs");

async function post(path) {
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
}

function render(snapshot) {
  statusEl.textContent = snapshot.status;
  resultsEl.innerHTML = snapshot.results.map((row) => `
    <tr>
      <td>${escapeHtml(row.productId)}</td>
      <td>${row.quotedPrice}</td>
      <td>${row.originalPrice}</td>
      <td>${row.threshold70Percent}</td>
      <td>${row.currentSellingPrice}</td>
      <td>${row.officialSuggestedPrice}</td>
      <td>${row.passed ? "通过" : "不通过"}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>
  `).join("");
  logsEl.textContent = snapshot.logs.map((log) => `[${log.at}] ${log.level} ${log.phase}: ${log.message}`).join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

document.querySelector("#start").addEventListener("click", () => post("/api/start").catch(alert));
document.querySelector("#pause").addEventListener("click", () => post("/api/pause").catch(alert));
document.querySelector("#stop").addEventListener("click", () => post("/api/stop").catch(alert));

const socket = new WebSocket(`ws://${location.host}/ws`);
socket.addEventListener("message", (event) => render(JSON.parse(event.data)));

fetch("/api/state").then((response) => response.json()).then(render);
```

- [ ] **Step 3: Typecheck and run server**

Run:

```powershell
npm run typecheck
npm run dev
```

Expected: console prints `http://127.0.0.1:3210`.

- [ ] **Step 4: Open UI manually**

Open:

```text
http://127.0.0.1:3210
```

Expected: page shows Start, Pause, Stop, status, results table, and logs.

- [ ] **Step 5: Commit**

```powershell
git add public/index.html public/app.js
git commit -m "feat: add local web console"
```

## Task 9: End-To-End Manual Verification

**Files:**
- Modify: `.env`
- Modify only if live verification proves the documented assumptions wrong: `src/hubstudio/hubstudio-client.ts`
- Modify only if live verification proves the documented assumptions wrong: `src/shein/shein-processor.ts`

- [ ] **Step 1: Create local `.env`**

Create `.env` from `.env.example` and fill the real values:

```dotenv
PORT=3210
HUBSTUDIO_API_BASE=http://127.0.0.1:6873
HUBSTUDIO_API_TOKEN=
HUBSTUDIO_PROFILE_NAME=女装希音1
SHEIN_NEW_PRODUCT_NEGOTIATION_URL=https://seller.shein.com/
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000
```

If Hubstudio shows a different local API base or token in its settings, replace `HUBSTUDIO_API_BASE` and `HUBSTUDIO_API_TOKEN` with those values. If the SHEIN New Product Negotiation page has a direct URL after manual navigation, replace `SHEIN_NEW_PRODUCT_NEGOTIATION_URL` with that direct URL.

- [ ] **Step 2: Run full automated checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start the console**

Run:

```powershell
npm run dev
```

Expected: server starts at `http://127.0.0.1:3210`.

- [ ] **Step 4: Manual live test with a small SHEIN page sample**

In the console, click Start with Hubstudio open and SHEIN account saved.

Expected:

- Profile `女装希音1` starts.
- SHEIN opens or navigates to New Product Negotiation.
- Login is clicked if saved credentials are visible.
- Verification pauses the task if it appears.
- At least one product row is read.
- A row with official suggested price `8` or higher is recorded as passed.
- A row failing both rules is rejected without rejection reason.
- Logs and result rows update in the console.

- [ ] **Step 5: Commit any selector/API fixes**

If real Hubstudio API fields or SHEIN selectors required changes:

```powershell
git add src/hubstudio/hubstudio-client.ts src/shein/shein-processor.ts
git commit -m "fix: align automation with live Hubstudio and SHEIN pages"
```

If no code changes were needed:

```powershell
git status --short
```

Expected: clean working tree.

## Self-Review Checklist

- Spec coverage:
  - Hubstudio API/profile startup: Task 4 and Task 9.
  - Saved login and manual pause for verification: Task 5 and Task 7.
  - New Product Negotiation row reading: Task 6.
  - Pricing rules including official suggested price >= 8: Task 2 and Task 6.
  - Reject failed products without reason: Task 6.
  - All-page pagination: Task 6.
  - Start/Pause/Stop web console: Task 3, Task 7, and Task 8.
  - Retry and safe pause behavior: Task 6 and Task 9.
- Placeholder scan:
  - The plan contains no unfinished markers or angle-bracket values.
  - No implementation step says to add unspecified validation or unspecified tests.
- Type consistency:
  - `PricingDecision.reason` values match task state result `reason`.
  - `TaskStateStore` method names used by runner and processor match Task 3.
  - `HubstudioClient.startProfile` returns `wsEndpoint`, used by `BrowserSession.connect`.
