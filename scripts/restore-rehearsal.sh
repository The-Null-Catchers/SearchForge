#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-}"
[[ -n "$BACKUP_DIR" ]] || { echo "usage: $0 <backup-directory>" >&2; exit 2; }
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

for file in postgres.dump index-data.tar.gz minio-data.tar.gz manifest.txt checksums.sha256; do
  [[ -f "$BACKUP_DIR/$file" ]] || { echo "missing backup file: $file" >&2; exit 1; }
done

(
  cd "$BACKUP_DIR"
  sha256sum -c checksums.sha256
)

grep -qx 'searchforge_backup_version=1' "$BACKUP_DIR/manifest.txt" || {
  echo "unsupported backup format" >&2
  exit 1
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PG_CONTAINER="searchforge-restore-pg-$STAMP"
INDEX_VOLUME="searchforge_restore_index_$STAMP"
MINIO_VOLUME="searchforge_restore_minio_$STAMP"
PASSWORD="restore-rehearsal-$STAMP"

cleanup() {
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[restore-test] creating isolated PostgreSQL container"
docker run -d --name "$PG_CONTAINER" \
  -e POSTGRES_USER=searchforge \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -e POSTGRES_DB=searchforge \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U searchforge -d searchforge >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$PG_CONTAINER" pg_isready -U searchforge -d searchforge >/dev/null

cat "$BACKUP_DIR/postgres.dump" | docker exec -i "$PG_CONTAINER" pg_restore \
  --username=searchforge --dbname=searchforge --no-owner --no-privileges --exit-on-error

echo "[restore-test] restored database objects:"
docker exec "$PG_CONTAINER" psql -U searchforge -d searchforge -Atc "select count(*) from pg_catalog.pg_tables where schemaname='public';"

echo "[restore-test] restoring index and object archives into isolated volumes"
docker volume create "$INDEX_VOLUME" >/dev/null
docker volume create "$MINIO_VOLUME" >/dev/null

docker run --rm -v "$INDEX_VOLUME:/data" -v "$BACKUP_DIR:/backup:ro" alpine:3.22 \
  sh -ec 'tar -xzf /backup/index-data.tar.gz -C /data && test -d /data'
docker run --rm -v "$MINIO_VOLUME:/data" -v "$BACKUP_DIR:/backup:ro" alpine:3.22 \
  sh -ec 'tar -xzf /backup/minio-data.tar.gz -C /data && test -d /data'

INDEX_COUNT="$(docker run --rm -v "$INDEX_VOLUME:/data:ro" alpine:3.22 sh -ec 'find /data -type f | wc -l')"
MINIO_COUNT="$(docker run --rm -v "$MINIO_VOLUME:/data:ro" alpine:3.22 sh -ec 'find /data -type f | wc -l')"

echo "[restore-test] index files: $INDEX_COUNT"
echo "[restore-test] object files: $MINIO_COUNT"
echo "[restore-test] rehearsal succeeded"
echo "[restore-test] retained volumes for inspection: $INDEX_VOLUME $MINIO_VOLUME"
echo "[restore-test] remove those isolated rehearsal volumes when finished inspecting them"
