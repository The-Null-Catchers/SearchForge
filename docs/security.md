# Security design

## Authentication
Passwords use Argon2id. Access tokens are short lived. Refresh sessions are stored as token-family records so rotation and reuse can revoke the entire family. Password reset and email verification tokens are single-use hashes with expiry.

## API keys
Keys have a public prefix and secret component. Only a keyed digest of the secret is stored. Permissions are scoped to search, indexing, or administration and can additionally restrict IPs, expiry, and request rate.

## Crawler SSRF controls
Every outbound URL is normalized and validated before resolution and again after redirects. The crawler rejects credentials, unsupported schemes, loopback, unspecified, link-local, multicast, private RFC1918, carrier-grade NAT, and IPv6 local/private targets by default. DNS results are validated before creating the request. The HTTP client pins the chosen validated address for each request and revalidates redirects.

Production deployments should also apply egress firewall rules. Application validation is not a substitute for network policy.

## Secrets
No production secret belongs in Git. Inject secrets through environment files readable only by the deployment account or a secret manager. Rotate JWT/API-key peppers if exposure is suspected.

## Audit
Security-sensitive mutations emit immutable audit events with actor, organization/project scope, action, request ID, IP metadata, and timestamp.

## Project scope in the browser

Search and autocomplete accept the optional `X-SearchForge-Project-Id` header.
The Playground sets it to the selected project. The server validates the key and
requires its project to match before charging per-key or project usage and
returning content. The key remains the authorization source for public clients.
