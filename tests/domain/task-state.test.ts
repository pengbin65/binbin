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
