import type { SearchRequest, SearchResponse } from "@searchforge/shared";
export type { SearchRequest, SearchResponse, SearchHit, HighlightRange } from "@searchforge/shared";

export type SearchOptions = Omit<Partial<SearchRequest>, "query"> & { signal?: AbortSignal };
export type SearchResult<T = Record<string, unknown>> = SearchResponse<T> & { searchEventId?: string };
export type ClientOptions = {
  projectId: string;
  apiKey: string;
  baseUrl: string;
  indexSlug?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export class SearchForgeError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string, public readonly requestId?: string) {
    super(message);
    this.name = "SearchForgeError";
  }
}

/** Project-scoped keys determine the tenant on the server. Never expose an admin key in browsers. */
export class SearchForge {
  private readonly baseUrl: string;
  private readonly indexPath: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    const url = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query or fragment");
    }
    if (!options.projectId || !options.apiKey) throw new TypeError("projectId and apiKey are required");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError("timeoutMs must be positive");
    this.baseUrl = url.toString().replace(/\/$/, "");
    this.indexPath = `/v1/indexes/${encodeURIComponent(options.indexSlug ?? "docs")}`;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("SearchForge request timed out")), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string; requestId?: string } };
        throw new SearchForgeError(payload.error?.message ?? `Request failed (${response.status})`, response.status, payload.error?.code ?? "HTTP_ERROR", payload.error?.requestId);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  search<T = Record<string, unknown>>(query: string, options: SearchOptions = {}): Promise<SearchResult<T>> {
    const { signal, ...body } = options;
    return this.request(`${this.indexPath}/search`, "POST", { ...body, query }, signal);
  }

  autocomplete(query: string, limit = 8, signal?: AbortSignal): Promise<{ suggestions: Array<{ value: string; score: number }> }> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request(`${this.indexPath}/autocomplete?${params}`, "GET", undefined, signal);
  }

  trackClick(click: { query: string; documentId: string; position: number; searchEventId?: string }, signal?: AbortSignal): Promise<{ accepted: boolean }> {
    return this.request("/v1/analytics/click", "POST", click, signal);
  }

  upsertDocument(document: { id: string; [field: string]: unknown }, signal?: AbortSignal): Promise<{ documentId: string; jobId: string }> {
    return this.request(`${this.indexPath}/documents/${encodeURIComponent(document.id)}`, "PUT", document, signal);
  }

  indexDocuments(documents: Array<{ id: string; [field: string]: unknown }>, signal?: AbortSignal): Promise<{ accepted: number; jobId: string }> {
    return this.request(`${this.indexPath}/documents/batch`, "POST", { documents }, signal);
  }

  deleteDocument(id: string, signal?: AbortSignal): Promise<{ documentId: string; jobId: string }> {
    return this.request(`${this.indexPath}/documents/${encodeURIComponent(id)}`, "DELETE", undefined, signal);
  }
}
