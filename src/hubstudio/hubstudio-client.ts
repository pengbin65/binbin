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
  data?: unknown;
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
    const trimmedBase = options.apiBase.trim();
    this.apiBase = trimmedBase.endsWith("/") ? trimmedBase : `${trimmedBase}/`;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async findProfileByName(name: string): Promise<HubstudioProfile> {
    const response = await this.request<HubstudioListResponse>(`api/v1/profiles?name=${encodeURIComponent(name)}`);
    if (!Array.isArray(response.data)) {
      throw new Error("Hubstudio profile response shape invalid: expected data array");
    }

    const profile = response.data.find((item): item is HubstudioProfile => isHubstudioProfile(item) && item.name === name);
    if (!profile) {
      throw new Error(`Hubstudio profile not found: ${name}`);
    }
    return profile;
  }

  async startProfile(profileId: string): Promise<HubstudioBrowserConnection> {
    const response = await this.request<HubstudioStartResponse>(`api/v1/profiles/${encodeURIComponent(profileId)}/start`, {
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
    headers.set("accept", "application/json");
    if (init.body) {
      headers.set("content-type", "application/json");
    }
    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    const relativePath = path.replace(/^\/+/, "");
    const response = await this.fetchImpl(new URL(relativePath, this.apiBase).toString(), { ...init, headers });
    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => "");
      const snippetSuffix = bodySnippet ? ` body: ${bodySnippet.slice(0, 200)}` : "";
      throw new Error(`Hubstudio API failed: ${response.status} ${response.statusText} path: /${relativePath}${snippetSuffix}`);
    }
    return response.json() as Promise<T>;
  }
}

function isHubstudioProfile(value: unknown): value is HubstudioProfile {
  return typeof value === "object"
    && value !== null
    && typeof (value as HubstudioProfile).id === "string"
    && typeof (value as HubstudioProfile).name === "string";
}
