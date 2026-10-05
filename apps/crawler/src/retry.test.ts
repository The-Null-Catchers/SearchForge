import { describe, expect, it, vi } from "vitest";
import { RetryDeferred, retryAfterMs, retryPageFetch, retryableNetworkError } from "./retry.js";
const policy = { retryMaxAttempts: 3, retryBaseDelayMs: 100, retryMaxDelayMs: 2000 };
const response = (status: number, retryAfter?: string) => ({ status, url: "https://example.com",
  headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}), body: new Uint8Array(), elapsedMs: 1 });
const hooks = () => ({ checkActive: vi.fn(async () => {}), sleep: vi.fn(async (_ms: number) => {}), random: () => 1 });

describe("page retry policy", () => {
  it("recovers transient responses with exponential backoff", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(502)).mockResolvedValue(response(200));
    const h = hooks();
    expect((await retryPageFetch(fetch, policy, h)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
  });
  it("honors Retry-After seconds and HTTP dates", async () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(retryAfterMs("2", now)).toBe(2000);
    expect(retryAfterMs("Thu, 01 Oct 2026 00:00:01 GMT", now)).toBe(1000);
    expect(retryAfterMs("-1", now)).toBeUndefined();
    expect(retryAfterMs("nonsense", now)).toBeUndefined();
    const fetch = vi.fn().mockResolvedValueOnce(response(429, "1")).mockResolvedValue(response(200));
    const h = hooks();
    await retryPageFetch(fetch, policy, h);
    expect(h.sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(1000);
  });
  it("defers a Retry-After exceeding the bounded in-worker wait", async () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const fetch = vi.fn().mockResolvedValue(response(429, "3600"));
    const h = { ...hooks(), now: () => now };
    let deferred: RetryDeferred | undefined;
    try {
      await retryPageFetch(fetch, policy, h);
    } catch (error) {
      if (error instanceof RetryDeferred) deferred = error;
      else throw error;
    }
    expect(deferred?.response.status).toBe(429);
    expect(deferred?.nextAttempt).toBe(2);
    expect(deferred?.retryAt.toISOString()).toBe("2026-10-01T01:00:00.000Z");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });
  it("resumes at a persisted attempt and does not reset the retry budget", async () => {
    const fetch = vi.fn().mockResolvedValue(response(503));
    const h = { ...hooks(), startAttempt: 3 };
    expect((await retryPageFetch(fetch, policy, h)).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });
  it("limits attempts and does not retry permanent HTTP failures", async () => {
    const exhausted = vi.fn().mockResolvedValue(response(503));
    expect((await retryPageFetch(exhausted, policy, hooks())).status).toBe(503);
    expect(exhausted).toHaveBeenCalledTimes(3);
    const missing = vi.fn().mockResolvedValue(response(404));
    await retryPageFetch(missing, policy, hooks());
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it("retries transport errors and preserves exhausted errors", async () => {
    const error = Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } });
    const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(response(200));
    await retryPageFetch(fetch, policy, hooks());
    expect(fetch).toHaveBeenCalledTimes(2);
    const down = vi.fn().mockRejectedValue(error);
    await expect(retryPageFetch(down, policy, hooks())).rejects.toBe(error);
    expect(down).toHaveBeenCalledTimes(3);
    expect(retryableNetworkError(Object.assign(new Error(), { name: "AbortError" }))).toBe(true);
  });
  it("never retries validation, SSRF, robots or size failures", async () => {
    for (const message of ["Private address blocked", "Redirect blocked by robots.txt", "Response exceeds maximum allowed size"]) {
      const fetch = vi.fn().mockRejectedValue(new Error(message));
      await expect(retryPageFetch(fetch, policy, hooks())).rejects.toThrow(message);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("cancels during retry waits without issuing another fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(response(429, "1"));
    const h = hooks();
    h.checkActive.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error("Job cancelled"));
    await expect(retryPageFetch(fetch, policy, h)).rejects.toThrow("Job cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.sleep.mock.calls).toEqual([[250]]);
  });
});
