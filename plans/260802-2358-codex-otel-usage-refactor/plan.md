---
title: "Codex OTel-only Usage refactor"
description: "Remove terminal Usage overhead, make Codex OTLP the sole usage source, and redesign Usage and Settings around Codex data."
status: completed
priority: P1
effort: 8d
branch: main
tags: [refactor, backend, frontend, database, performance, codex]
created: 2026-08-02
---

# Codex OTel-only Usage refactor

## Overview

Make Codex OTLP `response.completed` events the only Usage write source. Remove the Usage middle
layer from every PTY hot path (not merely disable it), migrate storage to Codex-only facts, retain
compatible `/api/usage/*` routes, and redesign Usage/Settings without terminal concepts.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | PTY decoupling and performance gate | Complete | 1.5d | [phase-01](./phase-01-pty-decoupling-performance.md) |
| 2 | Codex-only runtime and SQLite schema | Complete | 2d | [phase-02](./phase-02-codex-runtime-schema.md) |
| 3 | Codex-only API and configuration contracts | Complete | 1.5d | [phase-03](./phase-03-codex-api-config.md) |
| 4 | Usage and Settings redesign | Complete | 2d | [phase-04](./phase-04-codex-usage-settings-ui.md) |
| 5 | Migration, tests, docs, and release/reset gates | Complete | 1d | [phase-05](./phase-05-validation-migration-docs.md) |

## Decisions

- Keep `/api/usage/*` and `[server.telemetry]` for compatibility; remove terminal fields, project
  exclusions, and `terminal_correlation_enabled`.
- Keep bounded flat Codex session summaries and model/date filters; omit cost until authoritative
  versioned pricing exists.
- Default clean reset is `~/.config/dam-hopper/telemetry.db` plus `-wal`/`-shm` while stopped;
  custom `server.telemetry.db_path` overrides it. Never delete `sessions.db`.
- Preserve eligible Codex facts during runtime migration, but explicitly support full DB deletion.

## Dependencies and gates

Phase 1 must land before removing runtime types; Phase 2 defines the DTOs consumed by Phases 3–4.
Phase 5 is the release gate: negative PTY dependency scan, Rust/UI/browser tests, migration/reset
verification, privacy scan, and enabled-vs-disabled PTY performance comparison.

## Completion evidence (2026-08-05 01:11 +07:00)

- Rust: 601 passed, 0 failed, 2 ignored.
- UI: 756/756; browser: 69/69.
- Focused rollback, IPv6, Settings, automated reset/reopen/privacy, and terminal-dependency tests pass.
- UI/web builds and lint pass. `pnpm check` produced web/native builds and DEB/RPM bundles, then
  stopped because `TAURI_SIGNING_PRIVATE_KEY` is unavailable.
- Manual PTY enabled-vs-disabled benchmark and pinned Codex compatibility tests remain
  environment-gated; no release claim is made for those gates.

Complete for implemented refactor and automated validation; code review approved 8/10 with no
critical issues. Packaging/signing and manual environment-gated gates remain release follow-ups.

## Evidence

- [Backend/data research](./research/researcher-01-backend-data-report.md)
- [Frontend/UX research](./research/researcher-02-frontend-ux-report.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [Updated architecture](../../docs/system-architecture.md#codex-otel-usage-analytics)

## Unresolved questions

No implementation blockers. Release follow-ups: provide `TAURI_SIGNING_PRIVATE_KEY`, run the manual
PTY benchmark, and run pinned Codex compatibility tests in their target environment.
