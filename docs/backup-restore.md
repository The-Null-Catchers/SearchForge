# Backup and restore

SearchForge's authoritative state spans PostgreSQL, immutable index files, and MinIO object storage. Redis is intentionally treated as disposable queue/cache state because durable job/outbox state lives in PostgreSQL.

## Create a consistent backup

Run from the repository root on the Docker Compose host:

```bash
bash scripts/backup.sh
```

Pass a directory to choose the destination:

```bash
bash scripts/backup.sh /srv/searchforge-backups/2026-10-04
```

The backup script briefly stops `api`, `crawler`, `indexer`, and `worker` so database rows and immutable index files are captured from one quiescent point. It keeps PostgreSQL and MinIO available, produces a PostgreSQL custom-format dump plus compressed index/MinIO archives, writes a manifest, calculates SHA-256 checksums, and restarts only the writer services that were running before the backup.

The output contains:

- `postgres.dump`
- `index-data.tar.gz`
- `minio-data.tar.gz`
- `manifest.txt`
- `checksums.sha256`

Keep backup directories outside the repository and protect them as sensitive production data. They can contain customer documents, metadata, hashed authentication material, analytics aggregates, and uploaded objects.

## Verify integrity

```bash
cd /srv/searchforge-backups/2026-10-04
sha256sum -c checksums.sha256
```

Do not consider a backup usable until both checksum verification and a restore rehearsal succeed.

## Restore rehearsal

The repository provides an isolated restore drill that does **not** replace the active SearchForge database or active application volumes:

```bash
bash scripts/restore-rehearsal.sh /srv/searchforge-backups/2026-10-04
```

It restores PostgreSQL into a temporary PostgreSQL 17 container, extracts index and MinIO archives into isolated Docker volumes, reports restored object/file counts, and keeps the rehearsal volumes for operator inspection. The temporary PostgreSQL container is removed automatically.

After inspection, remove only the named `searchforge_restore_*` rehearsal volumes printed by the script.

## Production recovery procedure

Production recovery should be an operator-controlled maintenance event rather than an automatic destructive script:

1. Put the deployment behind maintenance/access control and stop `api`, `crawler`, `indexer`, `worker`, and `web`.
2. Verify `checksums.sha256` and confirm the intended backup timestamp and Git SHA from `manifest.txt`.
3. Take a final emergency snapshot of the current PostgreSQL and Docker volumes before replacing anything.
4. Restore the PostgreSQL custom dump into the target `searchforge` database with PostgreSQL 17-compatible tooling.
5. Replace `index_data` and `minio_data` from the matching archives as one recovery set; never mix these artifacts from different backup timestamps.
6. Clear Redis rather than restoring stale queue/cache state. Durable PostgreSQL outbox/job state is the recovery source of truth.
7. Run current migrations, start services, and wait for PostgreSQL/API/indexer health checks.
8. Verify login, project isolation, an existing document search, one index rebuild/activation path, object retrieval, and job recovery before returning traffic.

## Recovery invariants

A restore is valid only when PostgreSQL, immutable index data, and MinIO come from the same backup set. Restoring the database alone can reference missing segment files or uploaded objects; restoring files without the matching database can expose orphaned state. Redis is the exception: it is intentionally reconstructed after recovery.

## Automation and retention

Schedule `backup.sh` from systemd/cron on the host and copy completed backup directories to a second failure domain. Apply retention after a backup has passed checksum verification; do not delete the newest known-good restore-tested backup. SearchForge does not claim an RPO/RTO until measured in a real deployment and restore rehearsal.
