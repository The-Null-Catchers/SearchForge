import { describe, expect, it, vi } from "vitest";
import { SearchForge, SearchForgeError } from "./index.js";

function client(fetcher: typeof fetch) {
  return new SearchForge({ projectId: "project", apiKey: "sf_search_secret", baseUrl: "https://search.example", indexSlug: "docs/en", fetch: fetcher });
}

describe("SDK HTTP contract", () => {
  it("preserves filters and cursors and encodes the index path", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ hits: [], indexVersion: "17" }));
    await client(transport).search("محرك search", { filters: { published: true }, cursor: "opaque", limit: 5 });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://search.example/v1/indexes/docs%2Fen/search");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sf_search_secret" });
    expect(JSON.parse(init!.body as string)).toEqual({ query: "محرك search", filters: { published: true }, cursor: "opaque", limit: 5 });
  });
  it("retains structured error code, status and request ID without retrying writes", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "FORBIDDEN", message: "Search key cannot index", requestId: "req-1" } }, { status: 403 }));
    await expect(client(transport).upsertDocument({ id: "a/b", title: "Arabic" })).rejects.toMatchObject({ name: "SearchForgeError", code: "FORBIDDEN", status: 403, requestId: "req-1" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("encodes Arabic autocomplete query and reports click position", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ suggestions: [] }));
    const sdk = client(transport);
    await sdk.autocomplete("بحث &", 4);
    expect(new URL(transport.mock.calls[0]![0] as string).searchParams.get("q")).toBe("بحث &");
    await sdk.trackClick({ query: "بحث", documentId: "doc", position: 1, searchEventId: "event" });
    expect(transport.mock.calls[1]![0]).toBe("https://search.example/v1/analytics/click");
  });
  it("forwards caller cancellation", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { init?.signal?.throwIfAborted(); return Response.json({}); });
    const abort = new AbortController(); abort.abort();
    await expect(client(transport).search("test", { signal: abort.signal })).rejects.toBeDefined();
  });
  it("rejects credential-bearing base URLs", () => {
    expect(() => new SearchForge({ projectId: "p", apiKey: "k", baseUrl: "https://user:password@example.com" })).toThrow(TypeError);
    expect(SearchForgeError.prototype).toBeInstanceOf(Error);
  });
});
