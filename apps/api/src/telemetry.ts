import { randomBytes } from "node:crypto";

export type TelemetryConfig = {
  endpoint?: string;
  serviceName: string;
  sampleRatio: number;
  exportTimeoutMs: number;
  serviceVersion?: string;
};

export type HttpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  name: string;
  startTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  error?: string;
};

type OtlpSpan = HttpSpan & {
  endTimeUnixNano: string;
  statusCode: number;
};

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function nowUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function validNonZeroHex(value: string): boolean {
  return !/^0+$/.test(value);
}

function parseTraceparent(value?: string): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  if (!value) return null;
  const match = TRACEPARENT_RE.exec(value.trim());
  if (!match) return null;
  const traceId = match[1]!.toLowerCase();
  const parentSpanId = match[2]!.toLowerCase();
  if (!validNonZeroHex(traceId) || !validNonZeroHex(parentSpanId)) return null;
  return { traceId, parentSpanId, sampled: (Number.parseInt(match[3]!, 16) & 1) === 1 };
}

function id(bytes: number): string {
  let value = randomBytes(bytes).toString("hex");
  while (!validNonZeroHex(value)) value = randomBytes(bytes).toString("hex");
  return value;
}

function attribute(key: string, value: string | number | boolean) {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") return Number.isInteger(value)
    ? { key, value: { intValue: String(value) } }
    : { key, value: { doubleValue: value } };
  return { key, value: { stringValue: value } };
}

function resolveTraceEndpoint(endpoint?: string): string | null {
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("OTEL_EXPORTER_OTLP_ENDPOINT must use HTTP(S)");
  if (url.username || url.password || url.search || url.hash) throw new TypeError("OTEL_EXPORTER_OTLP_ENDPOINT must not contain credentials, query, or fragment");
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`.replace(/^\/\//, "/");
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OtlpHttpTelemetry {
  private readonly endpoint: string | null;
  private readonly queue: OtlpSpan[] = [];
  private readonly timer: NodeJS.Timeout | null;
  private flushing = false;
  private dropped = 0;

  constructor(private readonly config: TelemetryConfig) {
    if (!Number.isFinite(config.sampleRatio) || config.sampleRatio < 0 || config.sampleRatio > 1) {
      throw new TypeError("OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1");
    }
    this.endpoint = resolveTraceEndpoint(config.endpoint);
    this.timer = this.endpoint ? setInterval(() => void this.flush(), 1_000) : null;
    this.timer?.unref();
  }

  get enabled() { return this.endpoint !== null; }
  get droppedSpans() { return this.dropped; }

  startHttpSpan(method: string, target: string, traceparent?: string): HttpSpan {
    const parent = parseTraceparent(traceparent);
    const sampled = parent ? parent.sampled : Math.random() < this.config.sampleRatio;
    return {
      traceId: parent?.traceId ?? id(16),
      spanId: id(8),
      ...(parent ? { parentSpanId: parent.parentSpanId } : {}),
      sampled,
      name: `${method} ${target}`,
      startTimeUnixNano: nowUnixNano(),
      attributes: {
        "http.request.method": method,
        "server.address": this.config.serviceName
      }
    };
  }

  traceparent(span: HttpSpan): string {
    return `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`;
  }

  recordError(span: HttpSpan, error: unknown) {
    span.error = error instanceof Error ? error.name : "Error";
  }

  finishHttpSpan(span: HttpSpan, route: string, statusCode: number) {
    if (!span.sampled || !this.endpoint) return;
    span.name = `${span.attributes["http.request.method"]} ${route}`;
    span.attributes["http.route"] = route;
    span.attributes["http.response.status_code"] = statusCode;
    if (statusCode >= 500 && !span.error) span.error = "HTTP 5xx";
    const finished: OtlpSpan = {
      ...span,
      endTimeUnixNano: nowUnixNano(),
      statusCode: span.error ? 2 : 1
    };
    if (this.queue.length >= 2_048) {
      this.dropped += 1;
      return;
    }
    this.queue.push(finished);
    if (this.queue.length >= 64) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.endpoint || this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const spans = this.queue.splice(0, 64);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.exportTimeoutMs);
    timeout.unref();
    try {
      const payload = {
        resourceSpans: [{
          resource: {
            attributes: [
              attribute("service.name", this.config.serviceName),
              attribute("service.version", this.config.serviceVersion ?? "unknown")
            ]
          },
          scopeSpans: [{
            scope: { name: "searchforge.api.http", version: "1.0.0" },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: 2,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: Object.entries(span.attributes).map(([key, value]) => attribute(key, value)),
              status: { code: span.statusCode, ...(span.error ? { message: span.error } : {}) }
            }))
          }]
        }]
      };
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) this.dropped += spans.length;
    } catch {
      this.dropped += spans.length;
    } finally {
      clearTimeout(timeout);
      this.flushing = false;
      if (this.queue.length >= 64) void this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    while (this.flushing) await delay(10);
    while (this.queue.length > 0) {
      await this.flush();
      while (this.flushing) await delay(10);
    }
  }
}
