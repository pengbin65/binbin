import type { Locator, Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";
import { SheinProcessor, readRowPrices } from "../../src/shein/shein-processor.js";

type FakeLocatorOptions = {
  text?: string | string[] | null;
  textError?: Error;
  visible?: boolean;
  disabled?: boolean | (() => boolean);
  count?: number | (() => number);
  countError?: Error;
  click?: () => void | Promise<void>;
  children?: Record<string, FakeLocator[]>;
};

class FakeLocator {
  readonly text: string | null;
  readonly visible: boolean;
  private readonly disabled: boolean | (() => boolean);
  private readonly clickHandler?: () => void | Promise<void>;
  private readonly children: Record<string, FakeLocator[]>;
  private readonly items?: FakeLocator[];
  private readonly textValues?: string[];
  private readonly textError?: Error;
  private readonly countValue?: number | (() => number);
  private readonly countError?: Error;
  private textIndex = 0;

  constructor(options: FakeLocatorOptions | FakeLocator[] = {}) {
    if (Array.isArray(options)) {
      this.text = null;
      this.visible = false;
      this.disabled = false;
      this.items = options;
      this.children = {};
      return;
    }

    this.textValues = Array.isArray(options.text) ? options.text : undefined;
    this.text = Array.isArray(options.text) ? null : (options.text ?? null);
    this.visible = options.visible ?? true;
    this.disabled = options.disabled ?? false;
    this.clickHandler = options.click;
    this.children = options.children ?? {};
    this.textError = options.textError;
    this.countValue = options.count;
    this.countError = options.countError;
  }

  async textContent(): Promise<string | null> {
    if (this.textError) {
      throw this.textError;
    }

    if (this.textValues) {
      const value = this.textValues[Math.min(this.textIndex, this.textValues.length - 1)] ?? null;
      this.textIndex += 1;
      return value;
    }

    return this.text;
  }

  async count(): Promise<number> {
    if (this.countError) {
      throw this.countError;
    }

    if (this.countValue !== undefined) {
      return typeof this.countValue === "function" ? this.countValue() : this.countValue;
    }

    return this.items?.length ?? 1;
  }

  nth(index: number): FakeLocator {
    if (!this.items) {
      return index === 0 ? this : new FakeLocator({ visible: false });
    }

    return this.items[index] ?? new FakeLocator({ visible: false });
  }

  first(): FakeLocator {
    return this.nth(0);
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this.children[selector] ?? []);
  }

  async isVisible(): Promise<boolean> {
    return this.items ? this.items.some((item) => item.visible) : this.visible;
  }

  async isDisabled(): Promise<boolean> {
    return typeof this.disabled === "function" ? this.disabled() : this.disabled;
  }

  async click(): Promise<void> {
    if (!this.visible || (await this.isDisabled())) {
      throw new Error("cannot click locator");
    }
    await this.clickHandler?.();
  }

  async getAttribute(): Promise<string | null> {
    return null;
  }
}

class FakePage {
  constructor(
    protected readonly pages: FakeLocator[][],
    private readonly options: { nextDisabled?: boolean; nextLocator?: FakeLocator; batchConfirm?: FakeLocator } = {}
  ) {}

  protected pageIndex = 0;

  getByText(pattern: RegExp): FakeLocator {
    if (/新品议价|New Product Negotiation/.test(pattern.source)) {
      return new FakeLocator({ visible: true });
    }

    return new FakeLocator({ visible: false });
  }

  locator(selector: string): FakeLocator {
    if (selector === "tbody tr") {
      return new FakeLocator(this.pages[this.pageIndex] ?? []);
    }

    if (this.options.nextLocator) {
      return this.options.nextLocator;
    }

    if (selector === "button:has-text('批量确认价格'), button:has-text('Batch confirm')") {
      return this.options.batchConfirm ?? new FakeLocator([]);
    }

    if (selector === "button:has-text('下一页'), button:has-text('Next')") {
      const canAdvance = this.pageIndex < this.pages.length - 1;
      return new FakeLocator([
        new FakeLocator({
          visible: true,
          disabled: !canAdvance || this.options.nextDisabled === true,
          click: () => {
            this.pageIndex += 1;
          }
        })
      ]);
    }

    return new FakeLocator([]);
  }
}

class StopOnSecondVerificationPage extends FakePage {
  private verificationCount = 0;

  constructor(pages: FakeLocator[][], private readonly state: TaskStateStore) {
    super(pages);
  }

  override getByText(pattern: RegExp): FakeLocator {
    this.verificationCount += 1;
    if (this.verificationCount === 2) {
      this.state.requestStop();
    }

    return super.getByText(pattern);
  }
}

class PauseOnSecondVerificationPage extends FakePage {
  private verificationCount = 0;

  constructor(pages: FakeLocator[][], private readonly state: TaskStateStore) {
    super(pages);
  }

  override getByText(pattern: RegExp): FakeLocator {
    this.verificationCount += 1;
    if (this.verificationCount === 2) {
      this.state.requestPause();
    }

    return super.getByText(pattern);
  }
}

class TransientMissingNextButtonPage extends FakePage {
  private nextCountReads = 0;

  override locator(selector: string): FakeLocator {
    if (selector.includes("Next")) {
      return new FakeLocator({
        count: () => {
          if (this.pageIndex >= this.pages.length - 1) {
            return 0;
          }
          this.nextCountReads += 1;
          return this.nextCountReads === 1 ? 0 : 1;
        },
        visible: true,
        disabled: false,
        click: () => {
          this.pageIndex += 1;
        }
      });
    }

    return super.locator(selector);
  }
}

const retry = { attempts: 1, delayMs: 0 };

describe("readRowPrices", () => {
  it("extracts labelled prices with currency symbols separated from numbers", async () => {
    const row = new FakeLocator({
      text: "商品ID SKU-1 报价 ¥100 当前销售价 ¥62.99 官方建议价 ¥8"
    });

    await expect(readRowPrices(row as unknown as Locator)).resolves.toEqual({
      quotedPrice: 100,
      currentSellingPrice: 62.99,
      officialSuggestedPrice: 8
    });
  });

  it("extracts pending task prices from quote record and platform suggested price columns", async () => {
    const row = new FakeLocator({
      text: "商品SPU z2606101857088045 SKU l9mq7yg1vtovqe 报价记录(USD) 60.00 平台建议价(USD) 8.05"
    });

    await expect(readRowPrices(row as unknown as Locator)).resolves.toEqual({
      quotedPrice: 60,
      currentSellingPrice: 8.05,
      officialSuggestedPrice: 8.05
    });
  });

  it("returns null when any labelled price is missing", async () => {
    const row = new FakeLocator({ text: "报价 ¥100 当前销售价 ¥62.99" });

    await expect(readRowPrices(row as unknown as Locator)).resolves.toBeNull();
  });

  it("returns null when row text cannot be read", async () => {
    const row = new FakeLocator({ textError: new Error("text unavailable") });

    await expect(readRowPrices(row as unknown as Locator)).resolves.toBeNull();
  });
});

describe("SheinProcessor", () => {
  it("records a passing product and does not click reject", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow("商品ID SKU-1 报价 ¥100 当前销售价 ¥64 官方建议价 ¥1", rejectClick);
    const processor = new SheinProcessor(new FakePage([[row]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    expect(rejectClick).not.toHaveBeenCalled();
    expect(state.snapshot().results).toMatchObject([
      { productId: "SKU-1", action: "recorded", passed: true }
    ]);
  });

  it("clicks reject and records a failed product as rejected", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow("商品ID SKU-2 报价 ¥100 当前销售价 ¥62.99 官方建议价 ¥7.99", rejectClick);
    const processor = new SheinProcessor(new FakePage([[row]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    expect(rejectClick).toHaveBeenCalledTimes(1);
    expect(state.snapshot().results).toMatchObject([
      { productId: "SKU-2", action: "rejected", passed: false }
    ]);
  });

  it("selects passing pending-task rows and clicks batch confirm price", async () => {
    const checkboxClick = vi.fn();
    const batchConfirmClick = vi.fn();
    const state = new TaskStateStore();
    const row = makePendingTaskRow(
      "商品SPU z2606101857088045 SKU l9mq7yg1vtovqe 报价记录(USD) 60.00 平台建议价(USD) 8.05",
      checkboxClick
    );
    const processor = new SheinProcessor(
      new FakePage([[row]], {
        batchConfirm: new FakeLocator([new FakeLocator({ visible: true, click: batchConfirmClick })])
      }) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(checkboxClick).toHaveBeenCalledTimes(1);
    expect(batchConfirmClick).toHaveBeenCalledTimes(1);
    expect(state.snapshot().results).toMatchObject([
      { productId: "z2606101857088045", action: "confirmed", passed: true }
    ]);
  });

  it("pauses without clicking reject when row identity changes before reject", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow(
      [
        "\u5546\u54c1ID SKU-11 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99",
        "\u5546\u54c1ID SKU-11 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99",
        "\u5546\u54c1ID SKU-CHANGED \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99"
      ],
      rejectClick
    );
    const processor = new SheinProcessor(new FakePage([[row]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    const snapshot = state.snapshot();
    expect(rejectClick).not.toHaveBeenCalled();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.logs).toMatchObject([{ level: "error", phase: "shein" }]);
    expect(snapshot.logs[0]?.message).toContain("Row identity changed before reject");
    expect(snapshot.results).toHaveLength(0);
  });

  it("pauses without clicking reject when pause is requested immediately before reject", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow(
      "\u5546\u54c1ID SKU-12 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99",
      rejectClick
    );
    const page = new PauseOnSecondVerificationPage([[row]], state);
    const processor = new SheinProcessor(page as unknown as Page, state, retry);

    await processor.processAllPages();

    expect(rejectClick).not.toHaveBeenCalled();
    expect(state.snapshot()).toMatchObject({
      status: "paused",
      pauseRequested: true,
      results: []
    });
  });

  it("does not click reject when stop is requested during pre-reject page verification", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow(
      "\u5546\u54c1ID SKU-10 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99",
      rejectClick
    );
    const page = new StopOnSecondVerificationPage([[row]], state);
    const processor = new SheinProcessor(page as unknown as Page, state, retry);

    await processor.processAllPages();

    expect(rejectClick).not.toHaveBeenCalled();
    expect(state.snapshot()).toMatchObject({
      status: "stopped",
      stopRequested: true,
      results: []
    });
  });

  it("pauses and logs when price data is unreadable without clicking reject", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const row = makeRow("商品ID SKU-3 报价 ¥100 当前销售价 -- 官方建议价 ¥7.99", rejectClick);
    const processor = new SheinProcessor(new FakePage([[row]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    const snapshot = state.snapshot();
    expect(rejectClick).not.toHaveBeenCalled();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.logs).toMatchObject([{ level: "error", phase: "shein" }]);
    expect(snapshot.results).toHaveLength(0);
  });

  it("pauses instead of completing when the first page has no product rows", async () => {
    const state = new TaskStateStore();
    const processor = new SheinProcessor(new FakePage([[]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.results).toHaveLength(0);
    expect(snapshot.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "error",
        phase: "shein",
        message: "No product rows found on first pricing page"
      })
    ]));
  });

  it("retries unreadable price reads using configured attempts", async () => {
    const state = new TaskStateStore();
    const row = makeRow(
      [
        "商品ID SKU-6 报价 -- 当前销售价 -- 官方建议价 --",
        "商品ID SKU-6 报价 ¥100 当前销售价 ¥64 官方建议价 ¥1"
      ],
      vi.fn()
    );
    const processor = new SheinProcessor(
      new FakePage([[row]]) as unknown as Page,
      state,
      { attempts: 2, delayMs: 0 }
    );

    await processor.processAllPages();

    expect(state.snapshot().results).toMatchObject([
      { productId: "SKU-6", action: "recorded", passed: true }
    ]);
  });

  it("completes pagination when the next button is disabled", async () => {
    const state = new TaskStateStore();
    const firstPageRow = makeRow("商品ID SKU-4 报价 ¥100 当前销售价 ¥64 官方建议价 ¥1", vi.fn());
    const secondPageRow = makeRow("商品ID SKU-5 报价 ¥100 当前销售价 ¥64 官方建议价 ¥1", vi.fn());
    const processor = new SheinProcessor(
      new FakePage([[firstPageRow], [secondPageRow]], { nextDisabled: true }) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(state.snapshot().results).toMatchObject([{ productId: "SKU-4" }]);
    expect(state.snapshot().status).toBe("completed");
  });

  it("does not click next page when stop is requested during disabled check", async () => {
    const state = new TaskStateStore();
    const nextClick = vi.fn();
    const row = makeRow(
      "\u5546\u54c1ID SKU-17 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const nextButton = new FakeLocator({
      visible: true,
      disabled: () => {
        state.requestStop();
        return false;
      },
      click: nextClick
    });
    const processor = new SheinProcessor(
      new FakePage([[row]], { nextLocator: new FakeLocator([nextButton]) }) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(nextClick).not.toHaveBeenCalled();
    expect(state.snapshot()).toMatchObject({
      status: "stopped",
      stopRequested: true
    });
  });

  it("does not click next page when pause is requested during disabled check", async () => {
    const state = new TaskStateStore();
    const nextClick = vi.fn();
    const row = makeRow(
      "\u5546\u54c1ID SKU-18 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const nextButton = new FakeLocator({
      visible: true,
      disabled: () => {
        state.requestPause();
        return false;
      },
      click: nextClick
    });
    const processor = new SheinProcessor(
      new FakePage([[row]], { nextLocator: new FakeLocator([nextButton]) }) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(nextClick).not.toHaveBeenCalled();
    expect(state.snapshot()).toMatchObject({
      status: "paused",
      pauseRequested: true
    });
  });

  it("completes when the next page selector is absent on the terminal page", async () => {
    const state = new TaskStateStore();
    const row = makeRow(
      "\u5546\u54c1ID SKU-13 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const processor = new SheinProcessor(
      new FakePage([[row]], { nextLocator: new FakeLocator([]) }) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(state.snapshot()).toMatchObject({
      status: "completed",
      results: [{ productId: "SKU-13" }]
    });
  });

  it("retries a transiently absent next page button before completing pagination", async () => {
    const state = new TaskStateStore();
    const firstPageRow = makeRow(
      "\u5546\u54c1ID SKU-19 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const secondPageRow = makeRow(
      "\u5546\u54c1ID SKU-20 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const processor = new SheinProcessor(
      new TransientMissingNextButtonPage([[firstPageRow], [secondPageRow]]) as unknown as Page,
      state,
      { attempts: 2, delayMs: 0 }
    );

    await processor.processAllPages();

    expect(state.snapshot()).toMatchObject({
      status: "completed",
      results: [
        { productId: "SKU-19" },
        { productId: "SKU-20" }
      ]
    });
    expect(state.snapshot().logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "warn",
        phase: "shein",
        message: "Next page button absent on attempt 1"
      })
    ]));
  });

  it("pauses and logs when reject click retry attempts are exhausted", async () => {
    const state = new TaskStateStore();
    const row = makeRow(
      "商品ID SKU-7 报价 ¥100 当前销售价 ¥62.99 官方建议价 ¥7.99",
      vi.fn(() => {
        throw new Error("reject unavailable");
      })
    );
    const processor = new SheinProcessor(new FakePage([[row]]) as unknown as Page, state, retry);

    await expect(processor.processAllPages()).resolves.toBeUndefined();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.logs).toMatchObject([{ level: "error", phase: "shein" }]);
    expect(snapshot.logs[0]?.message).toContain("reject failed product");
    expect(snapshot.results).toHaveLength(0);
  });

  it("does not retry reject click after pause is requested between attempts", async () => {
    const state = new TaskStateStore();
    const rejectClick = vi.fn(() => {
      state.requestPause();
      throw new Error("transient reject failure");
    });
    const row = makeRow(
      "\u5546\u54c1ID SKU-16 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99",
      rejectClick
    );
    const processor = new SheinProcessor(
      new FakePage([[row]]) as unknown as Page,
      state,
      { attempts: 2, delayMs: 0 }
    );

    await processor.processAllPages();

    expect(rejectClick).toHaveBeenCalledTimes(1);
    expect(state.snapshot()).toMatchObject({
      status: "paused",
      pauseRequested: true,
      results: []
    });
  });

  it("pauses and logs when next page lookup retry attempts are exhausted", async () => {
    const state = new TaskStateStore();
    const row = makeRow("商品ID SKU-8 报价 ¥100 当前销售价 ¥64 官方建议价 ¥1", vi.fn());
    const processor = new SheinProcessor(
      new FakePage([[row], []], {
        nextLocator: new FakeLocator({ countError: new Error("pagination detached") })
      }) as unknown as Page,
      state,
      retry
    );

    await expect(processor.processAllPages()).resolves.toBeUndefined();

    const snapshot = state.snapshot();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.logs).toMatchObject([{ level: "error", phase: "shein" }]);
    expect(snapshot.logs[0]?.message).toContain("go to next page");
  });

  it("does not click reject twice for the same failed product id in one run", async () => {
    const rejectClick = vi.fn();
    const state = new TaskStateStore();
    const duplicateText = "商品ID SKU-9 报价 ¥100 当前销售价 ¥62.99 官方建议价 ¥7.99";
    const processor = new SheinProcessor(
      new FakePage([[makeRow(duplicateText, rejectClick), makeRow(duplicateText, rejectClick)]]) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(rejectClick).toHaveBeenCalledTimes(1);
    expect(state.snapshot().results).toMatchObject([
      { productId: "SKU-9", action: "rejected", passed: false },
      { productId: "SKU-9", action: "skipped", passed: false }
    ]);
  });

  it("uses unique fallback product ids across pages and does not falsely skip rejects", async () => {
    const firstRejectClick = vi.fn();
    const secondRejectClick = vi.fn();
    const failedNoIdText = "\u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a562.99 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a57.99";
    const state = new TaskStateStore();
    const processor = new SheinProcessor(
      new FakePage([[makeRow(failedNoIdText, firstRejectClick)], [makeRow(failedNoIdText, secondRejectClick)]]) as unknown as Page,
      state,
      retry
    );

    await processor.processAllPages();

    expect(firstRejectClick).toHaveBeenCalledTimes(1);
    expect(secondRejectClick).toHaveBeenCalledTimes(1);
    expect(state.snapshot().results).toMatchObject([
      { productId: "page-1-row-1", action: "rejected", passed: false },
      { productId: "page-2-row-1", action: "rejected", passed: false }
    ]);
  });

  it("records successful rows from multiple pages", async () => {
    const state = new TaskStateStore();
    const firstPageRow = makeRow(
      "\u5546\u54c1ID SKU-14 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const secondPageRow = makeRow(
      "\u5546\u54c1ID SKU-15 \u62a5\u4ef7 \u00a5100 \u5f53\u524d\u9500\u552e\u4ef7 \u00a564 \u5b98\u65b9\u5efa\u8bae\u4ef7 \u00a51",
      vi.fn()
    );
    const processor = new SheinProcessor(new FakePage([[firstPageRow], [secondPageRow]]) as unknown as Page, state, retry);

    await processor.processAllPages();

    expect(state.snapshot()).toMatchObject({
      status: "completed",
      results: [
        { productId: "SKU-14", action: "recorded", passed: true },
        { productId: "SKU-15", action: "recorded", passed: true }
      ]
    });
  });
});

function makeRow(text: string | string[], rejectClick: () => void | Promise<void>): FakeLocator {
  return new FakeLocator({
    text,
    children: {
      "button:has-text('拒绝'), button:has-text('驳回'), button:has-text('Reject')": [
        new FakeLocator({ visible: true, click: rejectClick })
      ]
    }
  });
}

function makePendingTaskRow(text: string, checkboxClick: () => void | Promise<void>): FakeLocator {
  return new FakeLocator({
    text,
    children: {
      "label:has(input[type='checkbox']), input[type='checkbox'], .arco-checkbox, .arco-checkbox-mask": [
        new FakeLocator({ visible: true, click: checkboxClick })
      ]
    }
  });
}
