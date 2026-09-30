import { Agent, fetch } from "undici";
import { resolveSafeDestination } from "./url.js";

export type SafeFetchResult = {
  url: string;
  status: number;
  headers: Headers;
  body: Uint8Array;
  elapsedMs: number;
};

export async function safeFetch(
  input: string,
  options: {
    userAgent: string;
    timeoutMs: number;
    maxBytes: number;
    allowPrivateNetworks: boolean;
    headers?: Record<string, string>;
    maxRedirects?: number;
    validateUrl?: (url: URL) => Promise<void> | void;
  }
): Promise<SafeFetchResult> {
  let current = input;
  const maxRedirects = options.maxRedirects ?? 5;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const { url, address, family } = await resolveSafeDestination(current, options.allowPrivateNetworks);
    await options.validateUrl?.(url);
    const dispatcher = new Agent({ connect: { autoSelectFamily: false, lookup: (_hostname, _options, callback) => callback(null, address, family) } });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        redirect: "manual",
        dispatcher,
        signal: controller.signal,
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.8,*/*;q=0.2",
          ...(options.headers ?? {})
        }
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect response is missing Location");
        await response.body?.cancel();
        current = new URL(location, url).toString();
        continue;
      }

      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > options.maxBytes) throw new Error("Response exceeds maximum allowed size");
      if (!response.body) return {
        url: url.toString(),
        status: response.status,
        headers: new Headers([...response.headers.entries()]),
        body: new Uint8Array(),
        elapsedMs: performance.now() - started
      };

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > options.maxBytes) {
          await reader.cancel();
          throw new Error("Response exceeded maximum allowed size while streaming");
        }
        chunks.push(value);
      }

      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        url: url.toString(),
        status: response.status,
        headers: new Headers([...response.headers.entries()]),
        body,
        elapsedMs: performance.now() - started
      };
    } finally {
      clearTimeout(timeout);
      await dispatcher.destroy();
    }
  }
  throw new Error("Too many redirects");
}
