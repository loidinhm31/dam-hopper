---
title: "Linux Release Installer Architecture"
description: "Deliver one attested Fedora 44 release, role-selected systemd deployment, and health-gated rollback without target-host builds."
status: in-progress
priority: P1
effort: 136h
branch: autoresearch/session-20260903
tags: [feature, infra, backend, frontend, security]
created: 2026-09-03
---

# Linux Release Installer Architecture

## Outcome

Replace the checkout-built format-2 Linux runner with one immutable, attested GitHub Release. A Rust manager stages a lockstep CLI/API/web release, independent API/web units run selected host roles, and explicit activation commits only after exact-version health remains stable.
Progress: 57% (78h/136h; Phases 01–05 complete, Phases 06–09 pending).

## Fixed Decisions

- Profile: Fedora 44 x86_64 GNU, glibc 2.43, systemd 259; direct API `4801`, web `4802`.
- Assets: installer, one `.tar.gz`, strict manifest, SBOM, GitHub attestations; no npm/native-package authority.
- Trust: SHA-256 and exact inventory are mandatory; GitHub attestation is published and optional to verify before privilege. Detached signing key deferred.
- CLI grammar: `fetch`, `install`, `role set`, `start`, `status`, `rollback`, `recover`, `version`; bootstrap never activates.
- Runtime: concrete per-release unit paths, authoritative durable metadata, active + previous + pending/latest-failed retention.
- Health: 20s startup deadline, then 20 consecutive 500ms exact-version probes (10s stability).
- Cutover: migrate only verified format-2 state; unknown or format-1 drift fails closed; remove old production scripts/unit after coverage lands.

## Phases

| # | Phase | Status | Progress | Effort |
|---|---|---|---:|---:|
| 01 | [Contract, version, and manifest](./phase-01-contract-version-manifest.md) | DONE 2026-09-03 16:07:45 +07:00 | 100% | 10h |
| 02 | [Rust CLI acquisition and staging](./phase-02-rust-cli-safe-acquisition-staging.md) | DONE 2026-09-03 | 100% | 18h |
| 03 | [Dedicated web host and runtime origin](./phase-03-web-host-runtime-origin-health.md) | DONE 2026-09-03 | 100% | 14h |
| 04 | [Role-aware systemd and ownership](./phase-04-role-aware-systemd-ownership.md) | DONE 2026-09-03 20:57:20 +07:00 | 100% | 12h |
| 05 | [Durable activation, rollback, and recovery](./phase-05-durable-activation-rollback-recovery.md) | DONE 2026-09-03 23:45:08 +07:00 | 100% | 24h |
| 06 | [Central publisher and bootstrap](./phase-06-central-github-publisher-bootstrap.md) | Pending | 0% | 16h |
| 07 | [Format-2 migration and runner retirement](./phase-07-format-2-migration-runner-retirement.md) | Pending | 0% | 14h |
| 08 | [Behavioral, security, and failure validation](./phase-08-behavioral-security-failure-validation.md) | Pending | 0% | 20h |
| 09 | [Documentation and release cutover](./phase-09-documentation-roadmap-changelog-cutover.md) | Pending | 0% | 8h |

## Dependency Chain

`01 → 02`; `01 → 03`; `02 + 03 → 04`; `02 + 04 → 05`; `01–05 → 06`; `04 + 05 → 07`; `01–07 → 08 → 09`.

Every code phase ends with its listed compile checks and a scoped reviewer gate. Phase 08 owns the terminal tester gate, fixes/retest loop, Fedora 44 evidence, and holistic reviewer approval. Phase 09 runs only after those gates and owns the docs-manager handoff.

## Source of Truth

Accepted architecture: [brainstorm decision](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md). Supporting research: [publisher](./research/researcher-01-release-publisher.md), [systemd transactions](./research/researcher-02-systemd-transaction-runtime.md).

## Validation Summary

**Validated:** 2026-09-03  
**Questions asked:** 8

### Confirmed Decisions

- One `start` command owns both pending-release activation and ordinary committed-service startup; remove the separate `activate` verb.
- SHA-256 verification is mandatory. GitHub attestation remains published and optional to verify; `gh` is not a target prerequisite. This explicitly accepts that checksums from the same compromised release do not independently authenticate publisher identity.
- Web/both install does not require or generate an API URL. A new web UI starts in the existing server-profile setup flow; saved user profiles remain authoritative.
- API service runs as `root` for this MVP by owner direction. This overrides the plan's `loidinh` identity and least-privilege claim. Any API/auth/PTY/filesystem compromise becomes full-host compromise; web remains separately unprivileged.
- Automatic legacy takeover supports only an exact, active, healthy format-2 installation. Format 1, drift, and ambiguity fail before mutation.
- Published release artifacts must never contain or derive from any developer/CI host `.env`, `server.env`, `dam-hopper.toml`, MongoDB URI/database name, token, credential, SQLite file, or other machine-local runtime value. Each installed machine supplies and retains its own environment/config, including its own optional `MONGODB_URI` and `MONGODB_DATABASE`. Install, upgrade, start, and release rollback never copy runtime values between machines or replace/restore machine-local application data. Any future incompatible application-data migration requires a separate maintenance plan.

### Remaining Plan Revisions Before Later Phases

- [ ] Propagate the unified `start` contract from the completed Phase 02 CLI through the remaining state-machine, bootstrap, tests, and docs phases.
- [ ] Propagate optional GitHub attestation verification, mandatory SHA-256, and the accepted checksum-only authenticity limit through publisher/bootstrap phases.
- [ ] Propagate the no-install-time-`--api-url` web bootstrap boundary through the remaining web, bootstrap, and docs phases.
- [ ] Revise later API unit, manifest identity, preflight, migration, security, and validation tasks for owner-directed `User=root`; retain the explicit critical-risk evidence.
- [ ] Propagate the runtime-value exclusion and machine-local configuration contract through publisher, migration, validation, and docs phases.
- [ ] Recheck every phase dependency, success criterion, and failure test after these cross-cutting contract changes.

**Readiness:** Phases 02–04 are implemented and reviewed. Revise remaining phase files before their implementation; they still contain superseded decisions.

## Unresolved Questions

None. Remaining revisions are tracked above; no unresolved questions.
