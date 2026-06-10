import { describe, expect, it } from "vitest";
import { TaskStateStore } from "../../src/domain/task-state.js";

describe("TaskStateStore", () => {
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

    const result = {
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
    store.recordResult(result);
    expect(store.snapshot().results[0]).toEqual(result);

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
});
