import type { SafeFetchResult } from "./fetch.js";

type RetryPolicy = { retryMaxAttempts: number; retryBaseDelayMs: number; retryMaxDelayMs: number };
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientCodes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);

export class RetryDeferred extends Error {
  constructor(
    readonly response: SafeFetchResult,
    readonly nextAttempt: number,
    readonly retryAt: Date
  ) {
    super(`Page retry deferred until ${retryAt.toISOString()}`);
    this.name = "RetryDeferred";
  }
}

export function retryableNetworkError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { name?: string; code?: string; cause?: unknown };
    if (value.name === "AbortError" || (value.code && transientCodes.has(value.code))) return true;
    current = value.cause;
  }
  return false;
}

export function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : undefined;
  const date = seconds === undefined && /^[A-Za-z]/.test(value.trim()) ? Date.parse(value) : undefined;
  const delay = seconds !== undefined ? seconds * 1000 : date === undefined ? NaN : Math.max(0, date - now);
  return Number.isFinite(delay) || delay === Infinity ? delay : undefined;
}

export async function retryPageFetch(
  fetchPage: () => Promise<SafeFetchResult>,
  policy: RetryPolicy,
  hooks: {
    checkActive: () => Promise<unknown>;
    onRetry?: (attempt: number, delayMs: number, status?: number) => void;
    sleep?: (delayMs: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
    startAttempt?: number;
  }
): Promise<SafeFetchResult> {
  const sleep = hooks.sleep ?? (delay => new Promise(resolve => setTimeout(resolve, delay)));
  const startAttempt = Math.max(1, Math.floor(hooks.startAttempt ?? 1));
  for (let attempt = startAttempt; ; attempt += 1) {
    await hooks.checkActive();
    let response: SafeFetchResult | undefined;
    try { response = await fetchPage(); }
    catch (error) {
      if (!retryableNetworkError(error) || attempt >= policy.retryMaxAttempts) throw error;
    }
    if (response && (!transientStatuses.has(response.status) || attempt >= policy.retryMaxAttempts)) return response;
    const now = (hooks.now ?? Date.now)();
    const requestedDelay = response ? retryAfterMs(response.headers.get("retry-after"), now) : undefined;
    // Large server-directed backoffs are persisted by the crawler instead of occupying
    // a worker slot or contacting the origin earlier than Retry-After permits.
    if (response && requestedDelay !== undefined && requestedDelay > policy.retryMaxDelayMs) {
      hooks.onRetry?.(attempt + 1, requestedDelay, response.status);
      throw new RetryDeferred(response, attempt + 1, new Date(now + requestedDelay));
    }
    const exponential = Math.min(policy.retryMaxDelayMs, policy.retryBaseDelayMs * 2 ** (attempt - 1));
    const jittered = Math.floor(exponential * (0.5 + (hooks.random ?? Math.random)() * 0.5));
    const delay = Math.max(jittered, requestedDelay ?? 0);
    hooks.onRetry?.(attempt + 1, delay, response?.status);
    // Cancellation checks stay responsive during bounded in-worker waits.
    let remaining = delay;
    while (remaining > 0) {
      await hooks.checkActive();
      const slice = Math.min(250, remaining);
      await sleep(slice);
      remaining -= slice;
    }
  }
}
