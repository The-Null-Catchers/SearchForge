import { readFileSync } from "node:fs";

const [manifestPath, reportPath] = process.argv.slice(2);
if (!manifestPath || !reportPath) {
  console.error("usage: node scripts/verify-release-evidence.mjs <manifest.json> <search-load.json>");
  process.exit(2);
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const expected = manifest.load;
  const actual = report.configuration;
  const target = report.target;
  if (
    !expected || !actual || !target ||
    manifest.target?.baseUrl !== target.baseUrl ||
    manifest.target?.indexSlug !== target.indexSlug ||
    expected.requests !== actual.requests ||
    expected.concurrency !== actual.concurrency ||
    expected.warmupRequests !== actual.warmupRequests ||
    expected.maxErrorRate !== report.thresholds?.maxErrorRate ||
    expected.maxP95Ms !== report.thresholds?.maxP95Ms ||
    !Number.isInteger(manifest.corpus?.documentCount) ||
    manifest.corpus.documentCount <= 0 ||
    !Number.isInteger(expected.requests) || expected.requests <= 0 ||
    !Number.isInteger(report.measurement?.successes) ||
    !Number.isInteger(report.measurement?.failures) ||
    report.measurement?.successes <= 0 ||
    report.measurement?.failures < 0 ||
    !Number.isFinite(report.measurement?.errorRate) ||
    Math.abs(report.measurement.errorRate - report.measurement.failures / expected.requests) > 0.000001 ||
    report.measurement.errorRate > expected.maxErrorRate + 0.000001 ||
    report.measurement?.failures + report.measurement?.successes !== expected.requests ||
    !["p50", "p95", "p99", "max"].every(key =>
      Number.isFinite(report.measurement?.wallLatencyMs?.[key]) &&
      report.measurement.wallLatencyMs[key] >= 0
    ) ||
    report.measurement.wallLatencyMs.p50 > report.measurement.wallLatencyMs.p95 ||
    report.measurement.wallLatencyMs.p95 > report.measurement.wallLatencyMs.p99 ||
    report.measurement.wallLatencyMs.p99 > report.measurement.wallLatencyMs.max ||
    (expected.maxP95Ms !== null && report.measurement.wallLatencyMs.p95 > expected.maxP95Ms) ||
    !Number.isFinite(report.measurement?.durationMs) ||
    report.measurement.durationMs <= 0 ||
    !Number.isFinite(report.measurement?.throughputRps) ||
    report.measurement.throughputRps <= 0 ||
    Math.abs(report.measurement.throughputRps - expected.requests * 1000 / report.measurement.durationMs) > Math.max(0.02, report.measurement.throughputRps * 0.001) ||
    !Number.isFinite(Date.parse(report.measurement?.startedAt)) ||
    !Number.isFinite(Date.parse(report.measurement?.finishedAt)) ||
    Date.parse(report.measurement.finishedAt) < Date.parse(report.measurement.startedAt) ||
    Math.abs(Date.parse(report.measurement.finishedAt) - Date.parse(report.measurement.startedAt) - report.measurement.durationMs) > 2000 ||
    report.thresholds?.passed !== true
  ) throw new Error("release evidence is incomplete, failed, or inconsistent");
  console.log("[release-evidence] manifest and measured results agree");
} catch {
  console.error("[release-evidence] validation failed: evidence inconsistent or unreadable");
  process.exitCode = 1;
}
