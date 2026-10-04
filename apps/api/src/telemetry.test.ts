import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OtlpHttpTelemetry } from "./telemetry.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("OtlpHttpTelemetry", () => {
  it("exports an OTLP HTTP span without query-string or secret attributes", async () => {
    let body = "";
    const received = new Promise<void>((resolve) => {
      const server = createServer((request, response) => {
        expect(request.url).toBe("/v1/traces");
        expect(request.headers["content-type"]).toBe("application/json");
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          response.statusCode = 200;
          response.end("{}");
          resolve();
        });
      });
      servers.push(server);
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Expected TCP address");
        const telemetry = new OtlpHttpTelemetry({
          endpoint: `http://127.0.0.1:${address.port}`,
          serviceName: "searchforge-api-test",
          sampleRatio: 1,
          exportTimeoutMs: 2_000,
          serviceVersion: "test-sha"
        });
        const span = telemetry.startHttpSpan("GET", "/v1/indexes/docs/search");
        telemetry.finishHttpSpan(span, "/v1/indexes/:slug/search", 200);
        await telemetry.flush();
        await telemetry.close();
      });
    });

    await received;
    const payload = JSON.parse(body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }> };
    const span = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.name).toBe("GET /v1/indexes/:slug/search");
    expect(span.kind).toBe(2);
    expect(body).not.toContain("apiKey");
    expect(body).not.toContain("Authorization");
    expect(body).not.toContain("?query=");
  });

  it("continues a valid sampled W3C traceparent", () => {
    const telemetry = new OtlpHttpTelemetry({ serviceName: "test", sampleRatio: 0, exportTimeoutMs: 500 });
    const traceId = "1234567890abcdef1234567890abcdef";
    const parentSpanId = "1234567890abcdef";
    const span = telemetry.startHttpSpan("POST", "/v1/search", `00-${traceId}-${parentSpanId}-01`);
    expect(span.traceId).toBe(traceId);
    expect(span.parentSpanId).toBe(parentSpanId);
    expect(span.sampled).toBe(true);
    expect(telemetry.traceparent(span)).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
  });
});
