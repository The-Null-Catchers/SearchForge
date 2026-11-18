# SearchForge portfolio roadmap

Baseline reviewed on November 17, 2026. Repository roadmap published on November 18, 2026.

This roadmap applies to this repository and follows the shared Null Catchers portfolio plan. Verify the documented state against the current code and runs before starting work.

**Estimated initial demo effort** 20–35 hours for a developer familiar with the project. The estimate excludes external reviews, store accounts, target environment setup, and later milestones.

## Project priorities

**Documented state** The search engine supports BM25, Arabic and English analysis, crawling, immutable index versions, and an embeddable interface. It provides load, recovery, and release-evidence tooling. Target deployment evidence remains the main MVP gap.

**P0 — Demo** Collect target-environment load and recovery evidence using a documented corpus. Preserve the existing reproducible Arabic search, typo, filtering, and ranking explanation demo.

**P1 — Validation and depth** Create a small relevance set with published judgments and compare two ranking or analyzer configurations. Report percentiles, throughput and errors with corpus size, hardware, warmup, and concurrency.

**P2 — Later** Publish the SDK once package ownership is resolved. Evaluate hybrid or vector search against measured relevance. Sharding is outside this portfolio milestone.

**Acceptance criteria** Queries give reproducible, explainable results. Index promotion and rollback are verified, and an isolated restore preserves the source.

**Demo scenario** Search with an Arabic typo → inspect ranking → edit a synonym → build an index version → roll back. [Status](https://github.com/The-Null-Catchers/SearchForge/blob/main/docs/status.md), [Release evidence](https://github.com/The-Null-Catchers/SearchForge/blob/main/docs/release-evidence.md).

## Progress

- The [Search Playground guide](docs/playground-demo.md) covers Arabic search, filtering, typo correction, ranking explanations, synonyms, and index rollback on a synthetic corpus.
- CI measures load and verifies PostgreSQL, index, and MinIO recovery. The [release evidence guide](docs/release-evidence.md) documents the scope of that rehearsal.
- Load measurement and isolated recovery in the target environment remain pending.

## Next milestones

1. [ ] Document corpus, hardware, SHA, warmup, concurrency, and queries. Record p50, p95, p99, throughput, and error rate.
2. [ ] Restore to an isolated environment and compare document count, active index, segment hashes, and a known object. Verify a reference Arabic query.
3. [ ] Link the results to a release when the target environment is available and identify the environment for each measurement.

## Portfolio acceptance checklist

- [ ] Another person can reproduce the primary workflow from a clean checkout using the README and test credentials or fixtures.
- [ ] The demo tells one complete story with a defined user, problem, and saved result.
- [ ] Tests cover the main flow, an important failure, and access boundaries when multiple accounts are involved.
- [ ] Demo data is labeled synthetic and reproducible. Review screenshots and recordings for secrets and customer data.
- [ ] Include four to six real screenshots where appropriate, a 60–120 second recording, and working links. Identify the revision used for capture.
- [ ] The README describes implemented capabilities, setup, architecture, limits, tests, and the demo.
- [ ] A short case study explains two engineering decisions, a considered alternative, and how the system handles an actual failure.
- [ ] Release evidence records the commit SHA, CI, prerequisites, and limits. Performance data includes workload, hardware, and method.
- [ ] Licensing and contributor attribution are settled before distribution. Choose the license for each repository individually.

A hosted demo is optional. Code execution, server administration, and secret management can be demonstrated through a recording and a reproducible isolated environment. Keep public demo access scoped to the activities it needs.

## Implementation and follow-up

- Break P0 into tasks with expected behavior, acceptance criteria, and a suitable test.
- Verify existing functionality first. Update this plan when evidence tied to a commit or PR closes a milestone.
- Record the fixture source, the revision used for evidence, and the tested limits.
- Review the final diff and verify required checks for its exact SHA before merging. Follow branch protection.
- For documentation-only changes with no applicable workflow, verify content and links and record the checks actually performed.
- Tie performance, security, and readiness claims to supporting evidence.
