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
SEARCHFORGE_LOAD_API_KEY="$search_key" \
  SEARCHFORGE_LOAD_BASE_URL=http://127.0.0.1 \
  SEARCHFORGE_LOAD_QUERIES="javascript,distributed systems,محرك بحث,تطبيع النص العربي" \
  SEARCHFORGE_LOAD_REQUESTS=120 SEARCHFORGE_LOAD_CONCURRENCY=5 SEARCHFORGE_LOAD_WARMUP=20 \
  SEARCHFORGE_LOAD_MAX_ERROR_RATE=0 SEARCHFORGE_LOAD_OUTPUT="$out/search-load.json" \
  node tests/load/search-load.mjs

scripts/backup.sh "$scratch/backup" | tee "$out/backup.log"
scripts/restore-rehearsal.sh "$scratch/backup" | tee "$out/restore.log"
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

docker run -d --name "$minio_container" --network searchforge_default \
  -e MINIO_ROOT_USER="$minio_user" -e MINIO_ROOT_PASSWORD="$minio_password" \
  -v "$restored_minio:/data" "$minio_image" server /data >/dev/null
minio_started=true
restored_object="$(s3 --retry 8 --retry-delay 1 --retry-connrefused "http://$minio_container:9000/ci-recovery/probe.txt")"
[[ "$restored_object" == "$fixture_text" ]]

lscpu > "$out/runner-cpu.txt"
free -b > "$out/runner-memory.txt"
docker compose version > "$out/docker-compose.txt"
node --input-type=module - "$out" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const load = JSON.parse(readFileSync(`${out}/search-load.json`, "utf8"));
const browser = JSON.parse(readFileSync("artifacts/browser-e2e/result.json", "utf8"));
writeFileSync(`${out}/summary.json`, JSON.stringify({
  environment: "GitHub-hosted Ubuntu, disposable Docker Compose stack and load client on the same runner",
  gitSha: process.env.GITHUB_SHA,
  generatedAt: new Date().toISOString(),
  documentCount: browser.playground.indexedDocuments,
  indexVersion: browser.playground.rollback.activeVersion,
  measuredRequests: load.configuration.requests,
  successfulRequests: load.measurement.successes,
  errorRate: load.measurement.errorRate,
  throughputRps: load.measurement.throughputRps,
  wallLatencyMs: load.measurement.wallLatencyMs,
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
