import { describe, expect, it } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";

describe("TaskStateStore", () => {
  const resultRow = {
    productId: "sku-1",
    quotedPrice: 100,
    originalPrice: 90,
    threshold70Percent: 63,
    currentSellingPrice: 62.99,
    officialSuggestedPrice: 8,
    passed: true,
    action: "recorded",
    reason: "OFFICIAL_SUGGESTED_PRICE_AT_LEAST_8"
  } as const;

  it("starts, logs, records results, pauses, and stops", () => {
    const store = new TaskStateStore();

    expect(store.snapshot().status).toBe("idle");

    store.requestPause();
    store.requestStop();
    store.log("previous", "Previous run");
    store.recordResult({
      productId: "old-sku",
      quotedPrice: 10,
      originalPrice: 20,
      threshold70Percent: 14,
      currentSellingPrice: 13,
      officialSuggestedPrice: 8,
      passed: false,
      action: "rejected",
      reason: "PREVIOUS_RUN"
    });

    store.start();
    expect(store.snapshot()).toMatchObject({
      status: "connecting",
      pauseRequested: false,
      stopRequested: false,
      logs: [],
      results: []
    });

    store.log("connecting", "Connecting to Hubstudio");
    const [log] = store.snapshot().logs;
    expect(log).toMatchObject({
      phase: "connecting",
      message: "Connecting to Hubstudio",
      level: "info"
    });
    expect(Date.parse(log.at)).not.toBeNaN();

    store.recordResult(resultRow);
    expect(store.snapshot().results[0]).toEqual(resultRow);

    store.requestPause();
    expect(store.snapshot().pauseRequested).toBe(true);
    expect(store.shouldPause()).toBe(true);

    store.markPaused();
    expect(store.snapshot().status).toBe("paused");

    store.requestStop();

    const snapshot = store.snapshot();
    expect(snapshot.status).toBe("stopped");
    expect(snapshot.pauseRequested).toBe(true);
    expect(snapshot.stopRequested).toBe(true);
    expect(store.shouldStop()).toBe(true);
    expect(snapshot.logs).toHaveLength(1);
    expect(snapshot.results).toHaveLength(1);
  });

  it("keeps stopped terminal when pause is marked after stop is requested", () => {
    const store = new TaskStateStore();

    store.start();
    store.requestStop();
    store.markPaused();

    expect(store.snapshot().status).toBe("stopped");
    expect(store.shouldStop()).toBe(true);
  });

  it("clones recorded results so caller mutations do not alter snapshots", () => {
    const store = new TaskStateStore();
    const row = { ...resultRow, productId: "sku-2" };

    store.recordResult(row);
    row.productId = "mutated-sku";

    expect(store.snapshot().results[0]?.productId).toBe("sku-2");
  });

  it("clones snapshot entries so snapshot mutations do not alter store state", () => {
    const store = new TaskStateStore();

    store.log("pricing", "Recorded price");
    store.recordResult(resultRow);

    const snapshot = store.snapshot();
    snapshot.logs[0]!.message = "Mutated log";
    snapshot.results[0]!.productId = "mutated-sku";

    const laterSnapshot = store.snapshot();
    expect(laterSnapshot.logs[0]?.message).toBe("Recorded price");
    expect(laterSnapshot.results[0]?.productId).toBe("sku-1");
  });

  it("keeps only the latest 200 log entries", () => {
    const store = new TaskStateStore();

    for (let index = 1; index <= 205; index += 1) {
      store.log("pricing", `log-${index}`);
    }

    const logs = store.snapshot().logs;
    expect(logs).toHaveLength(200);
    expect(logs[0]?.message).toBe("log-6");
    expect(logs.at(-1)?.message).toBe("log-205");
  });
});
