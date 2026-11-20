import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, publicAutocomplete } from "./api";

beforeEach(() => {
  const values = new Map<string, string>([["sf_access_token", "old"]]);
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard refresh coordination", () => {
  it("shares one refresh among concurrent expired-token requests", async () => {
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/auth/refresh")) {
        refreshes++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return Response.json({ accessToken: "new" });
      }
      if (new Headers(init?.headers).get("Authorization") === "Bearer new") return Response.json({ accepted: true });
      return Response.json({ error: { message: "Expired" } }, { status: 401 });
    }));
    const results = await Promise.all([api("/first"), api("/second"), api("/third")]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([{ accepted: true }, { accepted: true }, { accepted: true }]);
  });
  it("does not rotate again for a late 401 from an old access token", async () => {
    let release: (response: Response) => void = () => {};
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/auth/refresh")) { refreshes++; return Response.json({ accessToken: "new" }); }
      if (new Headers(init?.headers).get("Authorization") === "Bearer new") return Response.json({ accepted: true });
      if (String(input).endsWith("/slow")) return new Promise<Response>(resolve => { release = resolve; });
      return Response.json({}, { status: 401 });
    }));
    const slow = api("/slow");
    await api("/fast");
    release(Response.json({}, { status: 401 }));
    expect(await slow).toEqual({ accepted: true });
    expect(refreshes).toBe(1);
  });
});


describe("public autocomplete", () => {
  it("sends the selected index, encoded query, and search API key", async () => {
    const suggestions = [{ value: "javascript", score: 3 }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ suggestions }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publicAutocomplete<{ suggestions: typeof suggestions }>(
      "docs", "sf_search_demo", "جاڤا script", 6
    );

    expect(result.suggestions).toEqual(suggestions);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input), "http://localhost");
    expect(url.pathname).toBe("/v1/indexes/docs/autocomplete");
    expect(url.searchParams.get("q")).toBe("جاڤا script");
    expect(url.searchParams.get("limit")).toBe("6");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sf_search_demo");
  });

  it("surfaces API errors without masking the server message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { message: "Index is not ready" } }, { status: 409 })
    ));
    await expect(publicAutocomplete("docs", "sf_search_demo", "search"))
      .rejects.toThrow("Index is not ready");
  });
});
