#!/usr/bin/env bash
set -Eeuo pipefail

# This scenario uses the stock disposable Compose stack created by CI.
[[ "${GITHUB_ACTIONS:-}" == true && "${CI:-}" == true ]] || {
  echo "This rehearsal must run against the GitHub Actions demo stack." >&2
  exit 2
}

out="artifacts/ci-recovery"
mkdir -p "$out"
scratch="$(mktemp -d)"
restored_index=""
restored_minio=""
minio_container="searchforge-ci-restored-minio-${BASHPID}"
minio_started=false
cleanup() {
  if [[ "$minio_started" == true ]]; then
    docker rm -f "$minio_container" >/dev/null || true
  fi
  if [[ -n "$restored_index" && -n "$restored_minio" ]]; then
    docker volume rm "$restored_index" "$restored_minio" >/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

minio_id="$(docker compose ps -q minio)"
minio_image="$(docker inspect --format '{{.Image}}' "$minio_id")"
minio_user="$(docker compose exec -T minio printenv MINIO_ROOT_USER)"
minio_password="$(docker compose exec -T minio printenv MINIO_ROOT_PASSWORD)"
s3() {
  docker run --rm --network searchforge_default curlimages/curl:8.12.1 \
    --silent --show-error --fail --max-time 15 --aws-sigv4 "aws:amz:us-east-1:s3" \
    --user "$minio_user:$minio_password" "$@"
}
fixture_text="SearchForge synthetic recovery object"
s3 -X PUT --data-binary "" "http://minio:9000/ci-recovery/"
s3 -X PUT --data-binary "$fixture_text" "http://minio:9000/ci-recovery/probe.txt"

search_key="$(node tests/recovery/search-key.mjs)"
# Record only the public, synthetic CI workload. The generic harness omits real query text.
export BENCHMARK_QUERIES="javascript,distributed systems,محرك بحث,تطبيع النص العربي"
SEARCHFORGE_LOAD_API_KEY="$search_key" \
  SEARCHFORGE_LOAD_BASE_URL=http://127.0.0.1 \
  SEARCHFORGE_LOAD_QUERIES="$BENCHMARK_QUERIES" \
  SEARCHFORGE_LOAD_REQUESTS=120 SEARCHFORGE_LOAD_CONCURRENCY=5 SEARCHFORGE_LOAD_WARMUP=20 \
  SEARCHFORGE_LOAD_MAX_ERROR_RATE=0 SEARCHFORGE_LOAD_OUTPUT="$out/search-load.json" \
  node tests/load/search-load.mjs

backup_start_ms="$(date +%s%3N)"
scripts/backup.sh "$scratch/backup" | tee "$out/backup.log"
export BACKUP_DURATION_MS="$(( $(date +%s%3N) - backup_start_ms ))"
restore_start_ms="$(date +%s%3N)"
SEARCHFORGE_RESTORE_PRINT_ACTIVE_SEGMENTS=1 scripts/restore-rehearsal.sh "$scratch/backup" | tee "$out/restore.log"
export RESTORE_DURATION_MS="$(( $(date +%s%3N) - restore_start_ms ))"
restore_pattern='^\[restore-test\] retained volumes for inspection: (searchforge_restore_index_[0-9]{8}T[0-9]{6}Z-[0-9]+) (searchforge_restore_minio_[0-9]{8}T[0-9]{6}Z-[0-9]+)$'
restored_volumes="$(grep -E "$restore_pattern" "$out/restore.log")"
[[ "$restored_volumes" =~ $restore_pattern ]]
restored_index="${BASH_REMATCH[1]}"
restored_minio="${BASH_REMATCH[2]}"
grep -Fxq '[restore-test] live documents: 8' "$out/restore.log"
grep -Fxq '[restore-test] active indexes: 1' "$out/restore.log"

segment_hashes() {
  docker run --rm -v "$1:/data:ro" alpine:3.22 \
    sh -eo pipefail -c 'find /data -type f -name "*.segment.json" -exec sha256sum {} \; | sort'
}
segment_hashes searchforge_index_data > "$scratch/source-segments"
segment_hashes "$restored_index" > "$scratch/restored-segments"
test -s "$scratch/restored-segments"
cmp "$scratch/source-segments" "$scratch/restored-segments"

segment_pattern='^\[restore-test\] active segment: ([0-9a-f-]{36}) ([1-9][0-9]*)$'
active_segment="$(grep -E "$segment_pattern" "$out/restore.log")"
[[ "$active_segment" =~ $segment_pattern ]]
active_index_id="${BASH_REMATCH[1]}"
active_sequence="${BASH_REMATCH[2]}"
api_image="$(docker inspect --format '{{.Image}}' "$(docker compose ps -q api)")"
docker run --rm -i --network none --entrypoint node \
  -v "$restored_index:/data/indexes:ro" "$api_image" \
  --input-type=module - "$active_index_id" "$active_sequence" <<'NODE' > "$out/restored-arabic-search.json"
import assert from "node:assert/strict";
import { FileSegmentStore, SegmentSearchEngine } from "./packages/search-core/dist/index.js";
import { searchRequestSchema } from "./packages/shared/dist/index.js";

const [indexId, version] = process.argv.slice(2);
const segment = await new FileSegmentStore("/data/indexes").read(indexId, version);
const query = "محرك بحث";
const expectedHit = "search-ar";
const request = searchRequestSchema.parse({ query, limit: 10 });
const result = new SegmentSearchEngine(segment).search(request);
assert(result.hits.some(hit => hit.id === expectedHit), "Restored active segment missed the Arabic fixture");
console.log(JSON.stringify({ query, expectedHit, indexVersion: result.indexVersion, total: result.total }, null, 2));
NODE
export ACTIVE_INDEX_BYTES="$(docker run --rm -v "$restored_index:/data:ro" alpine:3.22 \
  stat -c '%s' "/data/$active_index_id/$active_sequence.segment.json")"

docker run -d --name "$minio_container" --network searchforge_default \
  -e MINIO_ROOT_USER="$minio_user" -e MINIO_ROOT_PASSWORD="$minio_password" \
  -v "$restored_minio:/data" "$minio_image" server /data >/dev/null
minio_started=true
restored_object="$(s3 --retry 8 --retry-delay 1 --retry-connrefused "http://$minio_container:9000/ci-recovery/probe.txt")"
[[ "$restored_object" == "$fixture_text" ]]

lscpu > "$out/runner-cpu.txt"
free -b > "$out/runner-memory.txt"
docker compose version > "$out/docker-compose.txt"
docker version > "$out/docker-engine.txt"
uname -a > "$out/runner-kernel.txt"
cat /etc/os-release > "$out/runner-os.txt"
export EVIDENCE_SOURCE_SHA="$(git rev-parse HEAD)"
node --input-type=module - "$out" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const load = JSON.parse(readFileSync(`${out}/search-load.json`, "utf8"));
const browser = JSON.parse(readFileSync("artifacts/browser-e2e/result.json", "utf8"));
const restoredSearch = JSON.parse(readFileSync(`${out}/restored-arabic-search.json`, "utf8"));
if (restoredSearch.indexVersion !== browser.playground.rollback.activeVersion) {
  throw new Error("Restored segment version differs from the browser's active version");
}
if (browser.gitSha !== process.env.EVIDENCE_SOURCE_SHA) {
  throw new Error("Browser evidence was captured from a different source SHA");
}
writeFileSync(`${out}/summary.json`, JSON.stringify({
  environment: "GitHub-hosted Ubuntu, disposable Docker Compose stack and load client on the same runner",
  gitSha: process.env.EVIDENCE_SOURCE_SHA,
  generatedAt: new Date().toISOString(),
  documentCount: browser.playground.indexedDocuments,
  indexVersion: browser.playground.rollback.activeVersion,
  indexBytes: Number(process.env.ACTIVE_INDEX_BYTES),
  indexLifecycleMs: browser.playground.indexLifecycleMs,
  measuredRequests: load.configuration.requests,
  concurrency: load.configuration.concurrency,
  warmupRequests: load.configuration.warmupRequests,
  queries: process.env.BENCHMARK_QUERIES.split(","),
  restoredSearch,
  successfulRequests: load.measurement.successes,
  errorRate: load.measurement.errorRate,
  throughputRps: load.measurement.throughputRps,
  wallLatencyMs: load.measurement.wallLatencyMs,
  measuredDurationMs: load.measurement.durationMs,
  backupDurationMs: Number(process.env.BACKUP_DURATION_MS),
  restoreDurationMs: Number(process.env.RESTORE_DURATION_MS),
  restoredLiveDocuments: 8,
  restoredActiveIndexes: 1,
  immutableSegmentHashesMatch: true,
  minioFixtureReadVerified: true
}, null, 2) + "\n");
NODE
(
  cd "$out"
  sha256sum ./* > checksums.sha256
)
cat "$out/summary.json"
