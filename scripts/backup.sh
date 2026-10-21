#!/usr/bin/env bash
set -Eeuo pipefail

# Restrict newly created backup and evidence files even if a command fails.
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${COMPOSE_PROJECT_NAME:-searchforge}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-$ROOT_DIR/backups/$STAMP}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
chmod 700 "$OUT_DIR"

# Refuse to overwrite a previous backup before quiescing application writers.
for file in postgres.dump index-data.tar.gz minio-data.tar.gz manifest.txt checksums.sha256; do
  if [[ -e "$OUT_DIR/$file" || -L "$OUT_DIR/$file" ]]; then
    echo "[backup] backup output already contains $file; choose a new directory" >&2
    exit 2
  fi
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker compose version >/dev/null
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }

declare -a WRITERS=(api crawler indexer worker)
declare -a WAS_RUNNING=()

for service in "${WRITERS[@]}"; do
  if docker compose ps --services --status running | grep -qx "$service"; then
    WAS_RUNNING+=("$service")
  fi
done

resume() {
  local status=$?
  trap - EXIT
  if ((${#WAS_RUNNING[@]})); then
    if ! docker compose start "${WAS_RUNNING[@]}" >/dev/null; then
      echo "[backup] ERROR: could not restart previously running writer services" >&2
      if ((status == 0)); then status=1; fi
    fi
  fi
  if ((status == 0)); then
    echo "[backup] complete: $OUT_DIR"
      echo "[backup] verify with: (cd '$OUT_DIR' && sha256sum -c checksums.sha256)"
  fi
  exit "$status"
}
trap resume EXIT

echo "[backup] quiescing write services"
docker compose stop "${WRITERS[@]}" >/dev/null

echo "[backup] ensuring stateful services are running"
docker compose up -d postgres redis minio >/dev/null

for volume in index_data minio_data; do
  if ! docker volume inspect "${PROJECT}_${volume}" >/dev/null 2>&1; then
    echo "missing Docker volume: ${PROJECT}_${volume}" >&2
    exit 1
  fi
done

echo "[backup] dumping PostgreSQL"
docker compose exec -T postgres pg_dump \
  --username=searchforge \
  --dbname=searchforge \
  --format=custom \
  --no-owner \
  --no-privileges > "$OUT_DIR/postgres.dump"

echo "[backup] archiving immutable index storage"
docker run --rm \
  -v "${PROJECT}_index_data:/data:ro" \
  -v "$OUT_DIR:/backup" \
  alpine:3.22 sh -ec 'cd /data && tar -czf /backup/index-data.tar.gz .'

echo "[backup] archiving MinIO object storage"
docker run --rm \
  -v "${PROJECT}_minio_data:/data:ro" \
  -v "$OUT_DIR:/backup" \
  alpine:3.22 sh -ec 'cd /data && tar -czf /backup/minio-data.tar.gz .'

cat > "$OUT_DIR/manifest.txt" <<EOF
searchforge_backup_version=1
created_at_utc=$STAMP
compose_project=$PROJECT
git_sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)
postgres_format=custom
redis_included=false
redis_reason=ephemeral queue/cache state is rebuilt from PostgreSQL durable state
EOF

(
  cd "$OUT_DIR"
  sha256sum postgres.dump index-data.tar.gz minio-data.tar.gz manifest.txt > checksums.sha256
)

for file in postgres.dump index-data.tar.gz minio-data.tar.gz manifest.txt; do
  if [[ ! -s "$OUT_DIR/$file" ]]; then
    echo "[backup] missing or empty backup artifact: $file" >&2
    exit 1
  fi
done

(
  cd "$OUT_DIR"
  sha256sum -c checksums.sha256 >/dev/null
)

chmod 600 "$OUT_DIR"/*
