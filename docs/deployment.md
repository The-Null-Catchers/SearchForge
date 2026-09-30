# Linux VPS deployment

Use a Docker Engine installation with Compose v2, a domain whose DNS points to
the VPS, and inbound ports 80/443. Copy .env.example to .env. Set NODE_ENV to
production, remove the development COMPOSE_PROFILES value, set SEARCHFORGE_DOMAIN to your hostname, WEB_ORIGIN and
PUBLIC_WEB_URL to the HTTPS origin. Leave NEXT_PUBLIC_API_URL blank for same-origin
requests through Caddy. Changing it requires rebuilding the web image.

Replace JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and API_KEY_PEPPER with independent
random secrets. Configure SMTP_URL and MAIL_FROM for verification/reset delivery.
Set a strong POSTGRES_PASSWORD and put the matching URL-encoded password in
POSTGRES_URL. Set distinct MINIO_SECRET_KEY and GRAFANA_ADMIN_PASSWORD values.
Keep .env private (chmod 600), outside git and off public backup locations.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 migrate api crawler indexer worker
```

The migrate service serializes migrations using a PostgreSQL advisory lock and
tracks checksums. Failed migrations stop API/worker startup. Existing applied
migrations must not be edited. Create a new numbered SQL migration instead.

All application images use frozen dependencies and run as the node user. Index
segments live in a shared persistent volume. PostgreSQL, Redis and index storage
must survive container replacement. MinIO is provisioned for future raw HTML and
object storage use; current search segments use the persistent filesystem.

Prometheus stays internal; /metrics is not routed by Caddy. Bind the optional
Grafana and MinIO console ports to loopback or protect them using network rules
before exposing the VPS. For monitoring, use the observability Compose profile.

## Backup and restore

Before a consistent backup, pause all mutations and workers, drain jobs, then dump
PostgreSQL and archive the index_data volume as a matched pair. Record the image
commit, environment configuration and migration checksums with the backup.
Encrypt backups, including project configuration, metadata and index contents.
Never treat an independent database dump plus unrelated segments as a valid pair.

Restore metadata into a clean database and segments into a clean index_data
volume while services are stopped. Restore secrets through your secret manager,
run migrations, then start services. Verify readiness, an English and an Arabic
query, and activation/rollback on a nonproduction project before reopening traffic.
Automated backup scripts and a rehearsed restore test remain release requirements.

## Release status

This is a working foundation under review, not a certified production release.
See docs/status.md for tested behavior and remaining requirements. Docker image
builds and the full Caddy stack must be exercised on a Docker host; local Node
checks alone do not verify container deployment.
