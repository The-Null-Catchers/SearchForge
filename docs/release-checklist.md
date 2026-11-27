# Release checklist

- [ ] Review the feature branch against `main` and confirm that Node, security baseline, Dart SDK, and container smoke pass for the intended SHA.
- [ ] Reproduce the demo from a fresh disposable stack and verify the six captures, including the Arabic results and active/retired version state. Record the source SHA and keep the credentials out of the capture.
- [ ] Preserve the raw search and recovery evidence with its methodology, Git revision and checksums.
- [ ] Validate deployment-specific HTTPS, SMTP delivery, restricted admin ports and crawler egress on an authorized target.
- [ ] Run representative load and restore rehearsals on that target and verify search, active versions and object reads after restoration. Set deployment SLOs, RPO and RTO from that evidence.
- [ ] Review project licensing and attribution with the maintainers. The repository currently has no top-level license file. Review contributor history with `git shortlog -sne HEAD` and inspect the lockfile and `pnpm licenses list --prod -r`. Include the bundled MinIO image and other container components in the review.
- [ ] Obtain authorization before publishing a GitHub release or either SDK package. Review the proposed release notes against the [changelog](../CHANGELOG.md).

See [deployment](deployment.md), [security](security.md), [release evidence](release-evidence.md), and [backup and restore](backup-restore.md).
