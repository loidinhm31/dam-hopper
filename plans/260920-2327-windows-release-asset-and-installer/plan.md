---
title: "Windows Release Asset and Bootstrap Installer"
description: "Publish a deterministic Windows x86_64 server archive with a verified PowerShell installer and release guidance."
status: completed
priority: P1
effort: 16h
branch: main
tags: [feature, infra, release, windows, security, docs]
created: 2026-09-20
---

# Windows Release Asset and Bootstrap Installer

## Context links
- [Release workflow](../../.github/workflows/release-linux.yml), [asset gate](../../deploy/release/check-release-assets.mjs)
- [Linux packager](../../deploy/release/build-release-archive.sh), [Linux installer](../../deploy/release/dam-hopper-install.sh)
- [Publisher guide](../../docs/linux-release-publisher-bootstrap.md), [configuration guide](../../docs/configuration-guide.md)
- [Windows server qualification](../260920-1312-windows-server-build-and-verify/plan.md)

## Overview
Add an independently validated Windows `x86_64-pc-windows-msvc` server asset and non-admin PowerShell bootstrap while preserving the Linux exact-four release contract. Publish one combined six-asset release only after per-profile checks and attestation.
## Status
- **Plan:** COMPLETE (3/3 phases complete; 100%; updated 2026-09-21).
- **Phase 01:** DONE (2026-09-21; 100%). Asset contracts, deterministic Windows ZIP packaging, profile-aware gates, package scripts, and focused harness are complete. See the [Phase 01 plan](./phase-01-asset-schema-and-packaging.md) and [code review](../reports/code-review-260921-0122-phase01-windows-release-asset-packaging.md).
- **Phase 02:** DONE (2026-09-21; 100%). PowerShell bootstrap installer, fixture mock server, 14/14 integration tests passing, and Review Cycle 2 verified. See the [Phase 02 plan](./phase-02-powershell-installer.md).
- **Phase 03:** DONE (2026-09-21; 100%). Release CI workflow, 6-subject attestation, profile gates, and comprehensive user/publisher guidance documentation. See the [Phase 03 plan](./phase-03-release-workflow-and-docs.md).
- **Next:** Complete project-wide validation and tag rehearsal when preparing next public release.

## Key Insights
- Linux remains the default checker profile; Windows has no Linux Manifest v2 or migration-evidence contract.
- Windows profile is exactly the installer plus `dam-hopper-vX.Y.Z-windows-x86_64.zip`; archive has four safe root members.
- Package jobs validate independently; the final publication gate composes Linux and Windows validators.

## Requirements
- Deterministic ZIP containing `dam-hopper-server.exe`, example TOML, `LICENSE`, and `README.md`.
- Installer supports `-Version`/`-Latest`, custom install directory, optional User PATH, attestation, and dry-run.
- CI builds MSVC binary, packages/attests Windows subjects, and publishes copyable Windows guidance.

## Architecture
`build-rust-windows` -> `package-windows-release` -> Windows profile gate -> combined attestation/publication gate; installer downloads release metadata, verifies bytes, safely stages `%LOCALAPPDATA%\Programs\dam-hopper\bin`, and never starts the server.

## Related code files
Modify `package.json`, `deploy/release/check-release-assets.mjs`, `.github/workflows/release-linux.yml`, `README.md`, `docs/configuration-guide.md`, and release docs. Create the Windows packager, installer, and focused PowerShell harness.

## Implementation Steps
1. Specify profile-aware asset contracts and deterministic ZIP bytes.
2. Implement/test the Windows bootstrap and safe extraction/PATH behavior.
3. Wire Windows CI, six-subject attestation, combined gate, and documentation.

## Todo list
- [x] Phase 01 — asset schema and packaging — DONE (2026-09-21)
- [x] Phase 02 — PowerShell installer and harness — DONE (2026-09-21)
- [x] Phase 03 — CI publication and guidance — DONE (2026-09-21)

## Success Criteria
Default Linux checks still require exactly four assets; Windows checks require exactly two plus the four-member ZIP; all-profile publication requires six matching local/remote digests; installer smoke tests pass without elevation or auto-start.

## Risk Assessment
ZIP nondeterminism, GitHub metadata gaps, unsafe archive paths, User PATH corruption, and Linux/Windows gate coupling are the primary risks; each phase adds bounded validation and cleanup.

## Security Considerations
Fail closed on digest/size/attestation mismatch, traversal, links, malformed tags, and unsafe install paths. Use least-privilege User PATH/config writes; never execute archive contents or overwrite an existing sample config.

## Next steps
All 3 phases are complete (3/3 phases; 100%). Repository-wide validation can be run for public release qualification.

## Preflight Contract
- Work from repository root with Node 20+, pnpm 10+, and Windows MSVC target `x86_64-pc-windows-msvc`.
- Preserve Linux default profile, exact-four invariant, Manifest v2 validation, and migration-gate behavior.
- Use fixed release tag/commit, isolated temp directories, deterministic epoch, and no credentials or generated artifacts.
- Validate real ZIP central-directory entries; reject links, directories, traversal, duplicates, and oversized inputs.
- Installer tests use a local HTTP fixture, loopback only where needed, and restore User PATH/cleanup in all paths.

## Side-Effect Review Checklist
- [x] Linux release assets and migration evidence remain unchanged.
- [x] Windows installer never requires elevation, starts a process, or overwrites user config.
- [x] PATH changes are opt-in, de-duplicated, User-scoped, and reversible in tests.
- [x] CI build/package jobs have read-only permissions; only publication has contents write.
- [x] Final release contains exactly six non-empty assets with matching digests.
- [x] Docs distinguish Windows direct-server support from Linux systemd operations.
