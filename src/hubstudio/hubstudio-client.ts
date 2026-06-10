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
