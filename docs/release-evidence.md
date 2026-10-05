# Release evidence

SearchForge does not publish performance or recovery claims without measured evidence. The release tooling records the corpus, target, hardware context, exact Git SHA, load results, restore rehearsal output, and checksums needed to make v1 evidence reviewable.

## Full VPS evidence

Run the full evidence collector on the deployed Linux host after creating a fresh backup set. It requires a search-only API key; the key is consumed from the environment and is never written to the evidence bundle.

```bash
BACKUP_DIR="$(./scripts/backup.sh 2>&1 | sed -n 's/^\[backup\] complete: //p' | tail -1)"

SEARCHFORGE_LOAD_BASE_URL="https://search.example.com" \
SEARCHFORGE_LOAD_API_KEY="sf_search_..." \
SEARCHFORGE_LOAD_INDEX="docs" \
SEARCHFORGE_LOAD_REQUESTS="1000" \
SEARCHFORGE_LOAD_CONCURRENCY="20" \
SEARCHFORGE_LOAD_WARMUP="50" \
SEARCHFORGE_LOAD_MAX_ERROR_RATE="0.01" \
SEARCHFORGE_LOAD_MAX_P95_MS="100" \
SEARCHFORGE_RELEASE_CORPUS="Production documentation corpus, Arabic + English" \
SEARCHFORGE_RELEASE_DOCUMENT_COUNT="25000" \
SEARCHFORGE_RELEASE_BACKUP_DIR="$BACKUP_DIR" \
./scripts/release-evidence.sh
```

The p95 threshold above is an example engineering gate, not a published benchmark. Choose the gate before running the measurement and keep the value in the evidence manifest.

The collector refuses to run when tracked repository files are dirty. It records:

- Git SHA and UTC timestamp
- kernel/host information
- CPU, memory, and disk information when available
- Docker and Compose versions
- current Compose service state
- corpus description and document count
- authenticated search throughput, p50/p95/p99, error rate, and engine-reported latency
- isolated PostgreSQL/index/MinIO restore rehearsal output
- SHA-256 checksums for the evidence files

`SEARCHFORGE_LOAD_API_KEY` is deliberately excluded from all output.

## Independent search measurement from GitHub Actions

The manual **Release Search Load Evidence** workflow measures the public HTTPS endpoint from a GitHub-hosted runner. This provides a useful second network vantage point and produces a 30-day artifact.

Before running it, configure the repository or environment secret:

```text
SEARCHFORGE_RELEASE_API_KEY
```

Use a dedicated search-only key with the smallest practical rate limit and revoke it after release validation if it is not needed afterward.

The workflow requires:

- production HTTPS base URL
- index slug
- request count
- concurrency
- warmup count
- preselected p95 gate
- corpus description
- indexed document count

The workflow never prints or stores the API key.

## Restore rehearsal

`./scripts/restore-rehearsal.sh` restores a backup into an isolated PostgreSQL container and isolated Docker volumes. It verifies backup checksums before restoring and does not overwrite production state. The rehearsal intentionally retains restored index/MinIO volumes for inspection; remove those isolated volumes after evidence review.

A release should not be marked as recovery-validated until the restore rehearsal has succeeded against a backup created from the target deployment.

## Benchmark reporting rules

When adding measured numbers to README or release notes, always include:

1. Git SHA.
2. date/time of the run.
3. document count and corpus description.
4. target host CPU/RAM and deployment topology.
5. load-generator location/hardware.
6. request count and concurrency.
7. p50, p95, p99, throughput, and error rate.
8. whether the cache was warm and how many warmup requests were used.

Do not compare SearchForge against another engine unless both systems are measured with the same corpus, query set, hardware class, and load methodology.
