# API key controls

SearchForge API keys support server-enforced expiration, exact-IP allowlists, and optional per-key request ceilings.

## Creation and updates

Admins and organization owners can create configured keys from the dashboard. A configured key may include:

- an expiration timestamp;
- up to 20 exact IPv4 or IPv6 addresses;
- a per-key requests-per-minute limit from 1 to 10,000.

The secret is returned only at creation time. SearchForge stores only the HMAC digest and public prefix. Existing controls can be changed without rotating the secret; revoked keys cannot be edited.

## Authentication order

A request using an API key is accepted only after all of these checks succeed:

1. key syntax and requested scope;
2. active project and non-revoked key lookup;
3. expiration check;
4. source-IP allowlist check, when configured;
5. constant-time secret digest comparison;
6. Redis-backed per-key rate limit check, when configured.

Per-key limits use a fixed minute bucket keyed by the durable API key ID. Buckets expire automatically after two minutes. The global Fastify rate limiter still applies independently, so a key-specific limit can only make a credential more restrictive.

## Dashboard status

The API Keys dashboard labels credentials as active, expiring soon, expired, or revoked. `expiring soon` means the expiration timestamp is within seven days. This is an in-product warning; email or webhook expiration notifications remain future work.

## Audit and privacy

Creation and control changes are audited. Audit metadata records control values and IP allowlist counts, never the secret itself. The raw secret is never persisted after creation.

## Current boundary

This workflow provides credential-level controls. Project-wide usage quotas and quota notification delivery remain separate MVP work.
