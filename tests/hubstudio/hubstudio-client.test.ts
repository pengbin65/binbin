import { describe, expect, it, vi } from "vitest";
import { HubstudioClient } from "../../src/hubstudio/hubstudio-client.js";

describe("HubstudioClient", () => {
  it("searches profile by name and starts it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "profile-1", name: "女装希音1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc" } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: " http://127.0.0.1:6873/api-root/ ",
      apiToken: "token",
      fetchImpl: fetchMock
    });

    const profile = await client.findProfileByName("女装希音1");
    const browser = await client.startProfile(profile.id);

    expect(profile).toEqual({ id: "profile-1", name: "女装希音1" });
    expect(browser.wsEndpoint).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe("http://127.0.0.1:6873/api-root/api/v1/profiles?name=%E5%A5%B3%E8%A3%85%E5%B8%8C%E9%9F%B31");
    expect(new Headers(firstInit.headers).get("accept")).toBe("application/json");
    expect(new Headers(firstInit.headers).get("authorization")).toBe("Bearer token");
    expect(new Headers(firstInit.headers).has("content-type")).toBe(false);

    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe("http://127.0.0.1:6873/api-root/api/v1/profiles/profile-1/start");
    expect(secondInit.method).toBe("POST");
    expect(new Headers(secondInit.headers).get("authorization")).toBe("Bearer token");
  });

  it("throws a clear shape error when profile data is not an array", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "profile-1", name: "女装希音1" } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "",
      fetchImpl: fetchMock
    });

    await expect(client.findProfileByName("女装希音1")).rejects.toThrow(/expected .*data.* array/i);
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

    await expect(client.findProfileByName("女装希音1")).rejects.toThrow(
      /401.*\/api\/v1\/profiles\?name=.*upstream failure: token expired/i
    );
  });
});
