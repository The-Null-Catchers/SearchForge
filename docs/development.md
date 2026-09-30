# Development

Publish Mailpit port 1025 to loopback when running the API on the host.
Use Node 22 and the pnpm version pinned in package.json.

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio mailpit
pnpm build
```

Export these variables in the shell running the API and workers (pnpm does not
load .env automatically):

```bash
export POSTGRES_URL=postgresql://searchforge:searchforge@localhost:5432/searchforge
export REDIS_URL=redis://localhost:6379
export JWT_ACCESS_SECRET=local-development-access-secret-change-me-123456
export JWT_REFRESH_SECRET=local-development-refresh-secret-change-me-123456
export API_KEY_PEPPER=local-development-api-key-pepper
export SMTP_URL=smtp://localhost:1025
export WEB_ORIGIN=http://localhost:3000
export PUBLIC_WEB_URL=http://localhost:3000
export NEXT_PUBLIC_API_URL=http://localhost:4000
export INDEX_STORAGE_PATH="$PWD/storage/indexes"
pnpm db:migrate
pnpm dev
```

`pnpm test` tests analyzers, ranking, robots, URL safety, immutable storage,
auth route contracts and the JavaScript SDK. `pnpm typecheck` checks application
and package types. The Dart SDK has its own test job in CI.

The full Compose stack uses Caddy on port 80; the host Next.js dev server uses
port 3000 and calls the API on port 4000. Configure browser API origins at build
time, not only in the final web container environment.
