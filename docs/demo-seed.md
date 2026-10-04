# Demo seed data

SearchForge includes an idempotent demo seed for local development, screenshots, portfolio walkthroughs, and browser E2E setup.

Run migrations first, then seed:

```bash
pnpm db:migrate
pnpm db:seed
```

The seed recreates only the reserved demo organizations/users, so running it again produces a clean deterministic demo without touching unrelated tenant data.

## Seeded tenants

Two organizations are created to make tenant isolation visible in the dashboard:

- `searchforge-demo` with the bilingual `docs-search` project.
- `searchforge-labs` with the separate `product-catalog` project.

The demo owner and analyst have different roles across those organizations. This makes organization/project switching and permission boundaries testable without hand-entering setup data.

## Synonyms and analytics

The docs project receives English and Arabic synonym sets plus API terminology. Analytics contains repeated English and Arabic queries, clicks, zero-result searches, latency variation, and one low-frequency query. The low-frequency query intentionally stays below the analytics privacy threshold so the disclosure guard can be demonstrated.

The second tenant has its own synonym set and analytics events, giving browser and integration tests data that must remain isolated from the first tenant.

## Demo credentials

The local default password is `SearchForgeDemo123!`. Override it with `SEARCHFORGE_DEMO_PASSWORD` whenever desired. The script prints whether the password came from the environment or the development default, but never prints the password itself.

The seed refuses to run when `NODE_ENV=production` unless `SEARCHFORGE_ALLOW_DEMO_SEED=true` is explicitly set. Demo seeding is not intended as a production bootstrap mechanism.
