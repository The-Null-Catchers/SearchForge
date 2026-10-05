#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${SEARCHFORGE_LOAD_BASE_URL:?SEARCHFORGE_LOAD_BASE_URL is required}"
: "${SEARCHFORGE_LOAD_API_KEY:?SEARCHFORGE_LOAD_API_KEY is required}"
: "${SEARCHFORGE_RELEASE_CORPUS:?SEARCHFORGE_RELEASE_CORPUS is required}"
: "${SEARCHFORGE_RELEASE_DOCUMENT_COUNT:?SEARCHFORGE_RELEASE_DOCUMENT_COUNT is required}"
: "${SEARCHFORGE_RELEASE_BACKUP_DIR:?SEARCHFORGE_RELEASE_BACKUP_DIR is required}"

[[ "$SEARCHFORGE_RELEASE_DOCUMENT_COUNT" =~ ^[1-9][0-9]*$ ]] || {
  echo "SEARCHFORGE_RELEASE_DOCUMENT_COUNT must be a positive integer" >&2
  exit 2
}

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
docker compose version >/dev/null

BACKUP_DIR="$(cd "$SEARCHFORGE_RELEASE_BACKUP_DIR" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${SEARCHFORGE_RELEASE_OUTPUT_DIR:-$ROOT_DIR/artifacts/release/$STAMP}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
chmod 700 "$OUT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "tracked repository files must be clean before release evidence is captured" >&2
  exit 1
fi

GIT_SHA="$(git rev-parse HEAD)"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_SHA GENERATED_AT

{
  echo "generated_at_utc=$GENERATED_AT"
  echo "git_sha=$GIT_SHA"
  echo "hostname=$(hostname 2>/dev/null || echo unknown)"
  echo "kernel=$(uname -srmo 2>/dev/null || uname -a)"
} > "$OUT_DIR/system.txt"

if command -v lscpu >/dev/null; then lscpu > "$OUT_DIR/cpu.txt"; fi
if command -v free >/dev/null; then free -b > "$OUT_DIR/memory.txt"; fi
if command -v df >/dev/null; then df -h > "$OUT_DIR/disk.txt"; fi
docker version > "$OUT_DIR/docker-version.txt" 2>&1
docker compose version > "$OUT_DIR/docker-compose-version.txt" 2>&1
docker compose ps > "$OUT_DIR/compose-ps.txt" 2>&1 || true

node <<'NODE' > "$OUT_DIR/manifest.json"
const manifest = {
  evidenceVersion: 1,
  generatedAt: process.env.GENERATED_AT,
  gitSha: process.env.GIT_SHA,
  target: {
    baseUrl: process.env.SEARCHFORGE_LOAD_BASE_URL,
    indexSlug: process.env.SEARCHFORGE_LOAD_INDEX || "docs"
  },
  corpus: {
    description: process.env.SEARCHFORGE_RELEASE_CORPUS,
    documentCount: Number(process.env.SEARCHFORGE_RELEASE_DOCUMENT_COUNT)
  },
  load: {
    requests: Number(process.env.SEARCHFORGE_LOAD_REQUESTS || 500),
    concurrency: Number(process.env.SEARCHFORGE_LOAD_CONCURRENCY || 10),
    warmupRequests: Number(process.env.SEARCHFORGE_LOAD_WARMUP || 25),
    maxErrorRate: Number(process.env.SEARCHFORGE_LOAD_MAX_ERROR_RATE || 0.01),
    maxP95Ms: process.env.SEARCHFORGE_LOAD_MAX_P95_MS ? Number(process.env.SEARCHFORGE_LOAD_MAX_P95_MS) : null
  },
  restoreRehearsal: true,
  apiKeyIncluded: false
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "[release-evidence] running authenticated search load measurement"
SEARCHFORGE_LOAD_OUTPUT="$OUT_DIR/search-load.json" \
  node tests/load/search-load.mjs 2>&1 | tee "$OUT_DIR/search-load.log"

echo "[release-evidence] running isolated restore rehearsal"
./scripts/restore-rehearsal.sh "$BACKUP_DIR" 2>&1 | tee "$OUT_DIR/restore-rehearsal.log"

(
  cd "$OUT_DIR"
  find . -maxdepth 1 -type f ! -name checksums.sha256 -printf '%P\0' \
    | sort -z \
    | xargs -0 sha256sum > checksums.sha256
  sha256sum -c checksums.sha256 >/dev/null
)

chmod 600 "$OUT_DIR"/*
echo "[release-evidence] complete: $OUT_DIR"
echo "[release-evidence] no API key is written to the evidence bundle"
