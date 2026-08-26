# Phase 07 — Release Gates, Tests, and Documentation

## Context links

- [Parent plan](./plan.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [System architecture](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md)
- [Code standards](/mnt/data/ws/sharing/dam-hopper/docs/code-standards.md)
- `/mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md`

## Overview

- Date: 2026-08-01
- Description: Validate exact/degraded audit behavior, security/fault/performance boundaries, and update release documentation.
- Priority: P1
- Implementation status: **Completed (2026-08-01; review approved 9.3/10).**
- Review status: Approved after evidence and 100k legacy tree-detail fixes.

## Key Insights

- Existing telemetry has focused Rust, API, UI, Chromium, privacy, and 100k-row tests.
- App-server is experimental; release must pin supported versions and preserve OTel-only fallback.
- Plan completion is not feature completion; all gates need command evidence.

## Requirements

- Rust unit/integration tests for protocol fixtures, marker inheritance, migration, upsert/replay, retention/delete, auth, malformed payload, adapter outage, and privacy canaries.
- Performance tests for aggregate plus root list/tree detail at 100k representative nodes/events; preserve p95 <200 ms target.
- UI tests for exact/partial/unavailable states, totals, keyboard tree, URL filters, empty/error/loading, deletion, and narrow browser layout.
- Docs update API/configuration/architecture/roadmap with explicit opt-in, retention, alias marker, app-server compatibility, and fallback semantics.
- Full validation commands per repository guidelines: format/lint, focused Rust, UI unit/browser, build/check where feasible.

## Architecture

Run the release matrix against both paths:

1. Phase 01 PASS: app-server lineage + OTel exact tree.
2. Phase 01 FAIL: OTel-only flat model/token rows with lineage unavailable; exact-tree routes/UI remain disabled or clearly unavailable.

Never promote a fixture-only protocol assumption to production support without a pinned version/health signal.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — reconcile final implementation with design.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/code-standards.md` — document metadata-only lineage/privacy patterns if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md` — phase status and compatibility support.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md` and configuration docs — endpoints/settings if applicable.
- Add/extend Rust, UI unit, browser, and privacy fixtures under existing module boundaries.

## Implementation Steps

1. Run migration/store/API/privacy/fault tests in isolation and full suite.
2. Run 100k performance benchmark and inspect query plans/index use.
3. Run browser session audit against exact and degraded fixtures.
4. Run alias/marker smoke on the host where Codex 0.146.0 is installed.
5. Run format/lint/build/check commands; record platform-dependent skips explicitly.
6. Reconcile architecture docs and update roadmap only after evidence.
7. Obtain code review focused on security, privacy, and false lineage claims.

## Todo list

- [x] Full Rust focused suite
- [x] Full shared UI/browser suite
- [x] Privacy/content-canary scan
- [x] 100k performance gate
- [x] Alias/Codex smoke
- [x] Docs/roadmap reconciliation
- [x] Independent code review (re-review approved 9.3/10)

## Success Criteria

- All acceptance criteria in brainstorm report are evidenced.
- No PTY latency/availability regression when collector or adapter fails.
- Exact and fallback paths are both tested and user-visible.
- Docs match live behavior and support range/all deletion semantics.

## Risk Assessment

- Host lacks Codex/shell executable: mark smoke unavailable, never pass by simulation.
- Experimental protocol changes: keep fallback and version health signal.
- Browser/native divergence: shared package tests plus host builds.

## Security Considerations

- Review all DB/API/log/fixture outputs for raw IDs/content.
- Verify auth, loopback binding, frame limits, and no bearer leakage.
- Confirm destructive actions remain explicit and HMAC rotation ordering is intact.

## Next steps

Release evidence is captured for the OTel-only fallback. Repository formatting, lint, and supported native Debian/RPM package gates are clean. AppImage is not a project release target; the third-party `linuxdeploy` binary is incompatible with the Fedora 44 validation host. No exact lineage is claimed.

## Unresolved questions

- Final supported Codex CLI version range after compatibility fixtures.
- Operational vacuum/checkpoint policy for permanent compact summaries.
- Exact user-facing wording for overlapping range deletion.
