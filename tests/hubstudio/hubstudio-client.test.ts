import { describe, expect, it, vi } from "vitest";
import { HubstudioClient } from "../../src/hubstudio/hubstudio-client.js";

describe("HubstudioClient", () => {
  it("searches Hubstudio env by name and starts its browser", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          list: [
            { containerCode: "other", containerName: "other profile" },
            { containerCode: 12345, containerName: "profile-name" }
          ]
        }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { debuggingPort: 9222 } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: " https://api.example.test/api-root/ ",
      apiToken: "token",
      fetchImpl: fetchMock
    });

    const profile = await client.findProfileByName("profile-name");
    const browser = await client.startProfile(profile.id);

    expect(profile).toEqual({ id: "12345", name: "profile-name" });
    expect(browser.wsEndpoint).toBe("http://127.0.0.1:9222");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe("https://api.example.test/api-root/api/v1/env/list");
    expect(firstInit.method).toBe("POST");
    expect(JSON.parse(firstInit.body as string)).toEqual({
      current: 1,
      size: 200,
      containerName: "profile-name"
    });
    expect(new Headers(firstInit.headers).get("accept")).toBe("application/json");
    expect(new Headers(firstInit.headers).get("authorization")).toBe("Bearer token");
    expect(new Headers(firstInit.headers).get("content-type")).toBe("application/json");

    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe("https://api.example.test/api-root/api/v1/browser/start");
    expect(secondInit.method).toBe("POST");
    expect(JSON.parse(secondInit.body as string)).toEqual({
      containerCode: "12345",
      isWebDriverReadOnlyMode: false,
      isHeadless: false
    });
    expect(new Headers(secondInit.headers).get("authorization")).toBe("Bearer token");
  });

  it("throws a clear shape error when env list data is not an array", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { list: { containerCode: "profile-1", containerName: "profile-name" } }
      }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "",
      fetchImpl: fetchMock
    });

    await expect(client.findProfileByName("profile-name")).rejects.toThrow(/expected .*data\.list.* array/i);
  });

  it("throws a clear endpoint error when start response has no endpoint or valid debuggingPort", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { debuggingPort: 99999 } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "",
      fetchImpl: fetchMock
    });

    await expect(client.startProfile("profile-1")).rejects.toThrow(/browser .*endpoint string.*debuggingPort/i);
  });

  it("still accepts legacy endpoint aliases from start response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ws_endpoint: "ws://127.0.0.1:9222/devtools/browser/abc" }
      }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "",
      fetchImpl: fetchMock
    });

    await expect(client.startProfile("profile-1")).resolves.toEqual({
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc"
    });
  });

  it("includes status path and response body snippet in non-OK errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream failure: token expired and request denied", {
        status: 401,
        statusText: "Unauthorized"
      }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873/",
      apiToken: "token",
      fetchImpl: fetchMock
    });

    await expect(client.findProfileByName("profile-name")).rejects.toThrow(
      /401.*\/api\/v1\/env\/list.*upstream failure: token expired/i
    );
  });
});
