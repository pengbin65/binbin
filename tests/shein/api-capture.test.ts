import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApiCaptureRecorder,
  classifyCaptureUrl,
  responsePreviewLimit,
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

  it("keeps longer previews for captured DPAS API JSON responses", () => {
    expect(responsePreviewLimit(
      "https://sso.geiwohuo.com/dpas-api-prefix/dpas/discuss/bargain_page",
      "application/json"
    )).toBeGreaterThan(100_000);
    expect(responsePreviewLimit("https://seller.test/static/app.js", "application/javascript")).toBe(2_000);
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
