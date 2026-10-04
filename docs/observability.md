# Observability and OpenTelemetry

SearchForge exposes Prometheus metrics from the API and can emit sampled server spans over OTLP/HTTP to an OpenTelemetry Collector.

## Enable tracing

Tracing is disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is empty. For the bundled collector profile:

```bash
export COMPOSE_PROFILES=observability
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export OTEL_SERVICE_NAME=searchforge-api
export OTEL_TRACE_SAMPLE_RATIO=0.1
docker compose up -d
```

The API appends `/v1/traces` when the configured endpoint is only a collector base URL. A full endpoint ending in `/v1/traces` is also accepted.

## Trace semantics

API requests create SERVER spans with W3C `traceparent` continuation. The response returns a `traceparent` header for correlation and CORS exposes that header to browser clients.

Spans include only bounded operational attributes:

- HTTP method
- matched route template
- response status
- service name and optional Git SHA

Search queries, request bodies, API keys, Authorization headers, user identifiers, document bodies, and client IP addresses are intentionally not recorded as trace attributes.

The exporter batches spans in memory, limits its queue to 2,048 spans, uses a configurable timeout, and drops telemetry rather than blocking API traffic when the collector is unavailable. This makes tracing best-effort and keeps observability failures outside the request critical path.

## Sampling

`OTEL_TRACE_SAMPLE_RATIO` accepts a value from `0` to `1` and defaults to `0.1`. New root traces use ratio sampling. Valid inbound W3C parents keep the upstream sampled decision so distributed traces are not broken at the API boundary.

## Bundled collector

`infra/monitoring/otel-collector.yml` enables OTLP over gRPC and HTTP, memory limiting, and batching. The current bundled profile uses the collector `debug` exporter so operators can verify trace delivery without requiring a hosted tracing vendor.

Production deployments should replace or extend the exporter with the chosen backend (for example Tempo, Jaeger-compatible infrastructure, or a managed OTLP endpoint) and keep collector ports private. Compose binds host OTLP ports to loopback only.

## Prometheus metrics

The existing `/metrics` endpoint remains the source for process and HTTP latency metrics. OpenTelemetry tracing complements rather than replaces those metrics.

## Verification

1. Start the observability profile with `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`.
2. Send API traffic.
3. Inspect `docker compose logs otel-collector` and confirm exported trace batches.
4. Send a request containing a valid `traceparent` header and verify the exported span continues the same trace ID.
5. Confirm queries, credentials, bodies, and IP addresses are absent from exported span attributes.

The repository unit suite also verifies OTLP HTTP delivery and W3C parent continuation with a disposable local HTTP collector.
