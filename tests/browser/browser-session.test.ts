import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectOverCDP = vi.hoisted(() => vi.fn());

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP
  }
}));

import { BrowserSession } from "../../src/browser/browser-session.js";

type FakeCandidate = {
  visible: boolean;
  click?: () => void;
};

class FakeLocator {
  constructor(private readonly candidates: FakeCandidate[]) {}

  first(): FakeLocator {
    return new FakeLocator(this.candidates.slice(0, 1));
  }

  async waitFor(): Promise<void> {
    if (this.candidates.some((candidate) => candidate.visible)) {
      return;
    }
    throw new Error("not visible");
  }

  async count(): Promise<number> {
    return this.candidates.length;
  }

  nth(index: number): FakeLocator {
    return new FakeLocator(this.candidates.slice(index, index + 1));
  }

  async isVisible(): Promise<boolean> {
    return this.candidates[0]?.visible ?? false;
  }

  async click(): Promise<void> {
    const candidate = this.candidates[0];
    if (!candidate?.visible) {
      throw new Error("cannot click hidden candidate");
    }
    candidate.click?.();
  }
}

class FakePage {
  readonly goto = vi.fn(async () => undefined);
  readonly waitForLoadState = vi.fn(async () => undefined);

  constructor(private readonly candidates: {
    target?: FakeCandidate[];
    commodityList?: FakeCandidate[];
    adjustmentEntry?: FakeCandidate[];
    verification?: FakeCandidate[];
    login?: FakeCandidate[];
  } = {}, private readonly contextPages?: FakePage[]) {}

  context(): { pages: () => FakePage[] } {
    return { pages: () => this.contextPages ?? [this] };
  }

  getByText(pattern: RegExp): FakeLocator {
    if (/New Product Negotiation/.test(pattern.source)) {
      return new FakeLocator(this.candidates.target ?? []);
    }

    if (/Commodity List/.test(pattern.source)) {
      return new FakeLocator(this.candidates.commodityList ?? []);
    }

    if (/Price Adjustment/.test(pattern.source)) {
      return new FakeLocator(this.candidates.adjustmentEntry ?? []);
    }

    return new FakeLocator(this.candidates.verification ?? []);
  }

  locator(): FakeLocator {
    return new FakeLocator(this.candidates.login ?? []);
  }
}

describe("BrowserSession.connect", () => {
  afterEach(() => {
    connectOverCDP.mockReset();
    vi.useRealTimers();
  });

  it("uses an extended timeout when connecting to a Hubstudio browser", async () => {
    const page = {};
    connectOverCDP.mockResolvedValueOnce({
      contexts: () => [{ pages: () => [page] }],
      close: vi.fn(async () => undefined)
    });
    const session = new BrowserSession();

    const result = await session.connect("ws://browser");

    expect(result).toBe(page);
    expect(connectOverCDP).toHaveBeenCalledWith("ws://browser", { timeout: 120_000 });
  });

  it("retries when the Hubstudio browser DevTools endpoint is not ready yet", async () => {
    vi.useFakeTimers();
    const page = {};
    connectOverCDP
      .mockRejectedValueOnce(new Error("Timeout 30000ms exceeded"))
      .mockResolvedValueOnce({
        contexts: () => [{ pages: () => [page] }],
        close: vi.fn(async () => undefined)
      });
    const session = new BrowserSession();

    const resultPromise = session.connect("ws://browser");
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toBe(page);
    expect(connectOverCDP).toHaveBeenCalledTimes(2);
  });
});

describe("BrowserSession.openShein", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns manual login when URL is missing and does not navigate", async () => {
    const page = new FakePage();
    const session = new BrowserSession();

    const result = await session.openShein(page as unknown as Page, "   ");

    if (result.status !== "needs_manual_login") {
      throw new Error(`Expected manual login, got ${result.status}`);
    }
    expect(result.reason).toMatch(/not configured/i);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("clicks a visible login candidate after hidden candidates and returns ready when target marker is visible", async () => {
    const click = vi.fn();
    const page = new FakePage({
      target: [{ visible: true }],
      login: [
        { visible: false },
        { visible: true, click }
      ]
    });
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(click).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
  });

  it("returns ready from the commodity list when the price adjustment entry is visible", async () => {
    const targetMarker = { visible: false };
    const entryClick = vi.fn(() => {
      targetMarker.visible = true;
    });
    const page = new FakePage({
      target: [targetMarker],
      commodityList: [{ visible: true }],
      adjustmentEntry: [{ visible: true, click: entryClick }]
    });
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(entryClick).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
  });

  it("returns ready when the price adjustment entry is visible even if the commodity heading is not detected", async () => {
    const targetMarker = { visible: false };
    const entryClick = vi.fn(() => {
      targetMarker.visible = true;
    });
    const page = new FakePage({
      target: [targetMarker],
      adjustmentEntry: [{ visible: true, click: entryClick }]
    });
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(entryClick).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
  });

  it("does not click the price adjustment entry during navigation when it could open a new tab", async () => {
    const contextPages: FakePage[] = [];
    const targetPage = new FakePage({
      target: [{ visible: true }]
    }, contextPages);
    const entryClick = vi.fn(() => {
      contextPages.push(targetPage);
    });
    const page = new FakePage({
      target: [{ visible: false }],
      adjustmentEntry: [{ visible: true, click: entryClick }]
    }, contextPages);
    contextPages.push(page);
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(entryClick).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ready", page });
  });

  it("ignores stale negotiation tabs when the current page has a visible task entry", async () => {
    const contextPages: FakePage[] = [];
    const staleTargetPage = new FakePage({
      target: [{ visible: true }]
    }, contextPages);
    const freshTargetPage = new FakePage({
      target: [{ visible: true }]
    }, contextPages);
    const entryClick = vi.fn(() => {
      contextPages.push(freshTargetPage);
    });
    const page = new FakePage({
      target: [{ visible: false }],
      adjustmentEntry: [{ visible: true, click: entryClick }]
    }, contextPages);
    contextPages.push(page, staleTargetPage);
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(entryClick).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ready", page });
  });

  it("returns manual login when verification is visible after login", async () => {
    const verification = { visible: false };
    const click = vi.fn(() => {
      verification.visible = true;
    });
    const page = new FakePage({
      target: [{ visible: true }],
      verification: [verification],
      login: [{ visible: true, click }]
    });
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    expect(click).toHaveBeenCalledTimes(1);
    if (result.status !== "needs_manual_login") {
      throw new Error(`Expected manual login, got ${result.status}`);
    }
    expect(result.reason).toMatch(/verification challenge is visible after login click/i);
  });

  it("returns manual login when target marker is not visible after login", async () => {
    const page = new FakePage({ login: [{ visible: true, click: vi.fn() }] });
    const session = new BrowserSession();

    const result = await runOpenShein(session, page);

    if (result.status !== "needs_manual_login") {
      throw new Error(`Expected manual login, got ${result.status}`);
    }
    expect(result.reason).toMatch(/New Product Negotiation page is not visible/i);
  });
});

async function runOpenShein(session: BrowserSession, page: FakePage) {
  const result = session.openShein(page as unknown as Page, "https://example.test/shein");

  for (let attempt = 0; attempt < 250; attempt += 1) {
    await vi.advanceTimersByTimeAsync(100);
  }

  return result;
}
