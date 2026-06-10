import { describe, expect, it, vi } from "vitest";
import { HubstudioClient } from "../../src/hubstudio/hubstudio-client.js";

describe("HubstudioClient", () => {
  it("searches profile by name and starts it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "profile-1", name: "女装希音1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc" } }), { status: 200 }));

    const client = new HubstudioClient({
      apiBase: "http://127.0.0.1:6873",
      apiToken: "token",
      fetchImpl: fetchMock
    });

    const profile = await client.findProfileByName("女装希音1");
    const browser = await client.startProfile(profile.id);

    expect(profile).toEqual({ id: "profile-1", name: "女装希音1" });
    expect(browser.wsEndpoint).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
