import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
