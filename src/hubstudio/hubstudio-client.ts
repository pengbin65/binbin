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
  data?: {
    list?: unknown;
  };
};

type HubstudioStartResponse = {
  data?: {
    wsEndpoint?: unknown;
    ws_endpoint?: unknown;
    debugUrl?: unknown;
    debug_url?: unknown;
    debuggingPort?: unknown;
  };
};

type JsonRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | object | null;
};

export class HubstudioClient {
  private readonly apiBase: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HubstudioClientOptions) {
    const trimmedBase = options.apiBase.trim();
    this.apiBase = trimmedBase.endsWith("/") ? trimmedBase : `${trimmedBase}/`;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async findProfileByName(name: string): Promise<HubstudioProfile> {
    const response = await this.request<HubstudioListResponse>("api/v1/env/list", {
      method: "POST",
      body: {
        current: 1,
        size: 200,
        containerName: name
      }
    });
    if (!Array.isArray(response.data?.list)) {
      throw new Error("Hubstudio env list response shape invalid: expected data.list array");
    }

    const env = response.data.list.find((item): item is HubstudioEnv => isHubstudioEnv(item) && item.containerName === name);
    if (!env) {
      throw new Error(`Hubstudio profile not found: ${name}`);
    }
    return { id: String(env.containerCode), name: env.containerName };
  }

  async startProfile(profileId: string): Promise<HubstudioBrowserConnection> {
    const response = await this.request<HubstudioStartResponse>("api/v1/browser/start", {
      method: "POST",
      body: {
        containerCode: profileId,
        isWebDriverReadOnlyMode: false,
        isHeadless: false
      }
    });
    const endpoint = this.resolveBrowserEndpoint(response.data);
    if (!endpoint) {
      throw new Error("Hubstudio did not return a browser endpoint string or valid debuggingPort");
    }
    return { wsEndpoint: endpoint };
  }

  private resolveBrowserEndpoint(data: HubstudioStartResponse["data"]): string | null {
    const endpoint = data?.wsEndpoint ?? data?.ws_endpoint ?? data?.debugUrl ?? data?.debug_url;
    if (typeof endpoint === "string" && endpoint.trim() !== "") {
      return endpoint.trim();
    }

    const port = data?.debuggingPort;
    const portNumber = typeof port === "number" ? port : typeof port === "string" ? Number(port) : NaN;
    if (Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535) {
      return `http://127.0.0.1:${portNumber}`;
    }

    return null;
  }

  private async request<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    const body = init.body && typeof init.body === "object" && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Blob)
      && !(init.body instanceof FormData) && !(init.body instanceof URLSearchParams) && !(init.body instanceof ReadableStream)
      ? JSON.stringify(init.body)
      : init.body;
    if (body) {
      headers.set("content-type", "application/json");
    }
    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    const relativePath = path.replace(/^\/+/, "");
    const response = await this.fetchImpl(new URL(relativePath, this.apiBase).toString(), { ...init, body: body as BodyInit | null | undefined, headers });
    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => "");
      const snippetSuffix = bodySnippet ? ` body: ${bodySnippet.slice(0, 200)}` : "";
      throw new Error(`Hubstudio API failed: ${response.status} ${response.statusText} path: /${relativePath}${snippetSuffix}`);
    }
    return response.json() as Promise<T>;
  }
}

type HubstudioEnv = {
  containerCode: string | number;
  containerName: string;
};

function isHubstudioEnv(value: unknown): value is HubstudioEnv {
  return typeof value === "object"
    && value !== null
    && (typeof (value as HubstudioEnv).containerCode === "string" || typeof (value as HubstudioEnv).containerCode === "number")
    && typeof (value as HubstudioEnv).containerName === "string";
}
