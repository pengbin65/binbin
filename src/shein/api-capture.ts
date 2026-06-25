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
const DEFAULT_RESPONSE_PREVIEW_LIMIT = 2_000;
const DPAS_API_JSON_RESPONSE_PREVIEW_LIMIT = 500_000;

export function classifyCaptureUrl(url: string): CaptureClassification {
  return CANDIDATE_PATTERN.test(url) ? "candidate" : "ignore";
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    SENSITIVE_HEADER_PATTERN.test(key) ? "[redacted]" : value
  ]));
}

export function responsePreviewLimit(url: string, contentType: string): number {
  if (url.includes("/dpas-api-prefix/") && contentType.toLowerCase().includes("json")) {
    return DPAS_API_JSON_RESPONSE_PREVIEW_LIMIT;
  }

  return DEFAULT_RESPONSE_PREVIEW_LIMIT;
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
