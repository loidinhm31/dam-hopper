# Phase 05: Validation, migration, docs, and release gates

## Context links

- Parent: [plan.md](./plan.md)
- Architecture gate: [architecture-gate-report.md](./reports/architecture-gate-report.md)
- Updated architecture: [system architecture](../../docs/system-architecture.md#codex-otel-usage-analytics)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** DONE / complete with release follow-ups · **Completed:** 2026-08-05 01:11 +07:00 · **Review:** Approved 8/10; no critical issues

Close the refactor with fresh-reset fixtures, privacy/performance scans, documentation cleanup, and
an explicit clean-reset runbook. Update architecture after implementation to remove legacy wording.

## Key Insights

The user’s clean reset is safe only when DamHopper is stopped; SQLite WAL/SHM sidecars can hold
committed data. Runtime reset is development-only, bounded to the configured telemetry database,
and must never target `sessions.db`. A no-terminal production scan is the strongest guard
against a future Usage middle layer returning to PTY code.

## Requirements

- Rust unit/integration, UI unit, and Chromium usage/settings suites pass.
- Fresh schema reset is tested on a new DB, legacy-table DB, repeated startup, and malformed DB;
  current v1 reopen preserves data and reset does not import legacy telemetry.
- Privacy scan finds no prompt/content/tool/command/cwd/PTY fields in DB/API/logs.
- PTY benchmark compares Codex Usage enabled/disabled with no material regression.
- Docs identify `telemetry.db` and sidecars; remove terminal analytics from Usage guidance.

## Architecture

Post-implementation review compares code to `docs/system-architecture.md`; intended drift updates
the doc, unintended drift is fixed in code. Legacy combined paragraphs are deleted after the
fresh-reset schema ships.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`, `docs/api-reference.md`,
  `docs/configuration-guide.md`, `docs/codebase-summary.md`, `docs/code-standards.md`,
  `docs/CHANGELOG.md`, `docs/project-roadmap.md`.
- **Modify/create tests:** `server/tests/*`, `server/src/telemetry/*_tests.rs`,
  `server/src/api/tests.rs`, `packages/ui/src/components/pages/UsagePage.test.tsx`,
  `packages/ui/browser-tests/*usage*`.

## Implementation Steps

1. Run `rg` negative gates for `TelemetryCmd::TerminalRun`, `CommandClassifier`,
   `TelemetryContext`, `terminal_correlation_enabled`, `terminal_runs`, `command_events`, and
   terminal-shaped Usage DTOs in production code.
2. Run format/type/lint/build and targeted Rust/UI/browser suites, then full `pnpm check` as feasible.
3. Run reset/reopen/delete/retention fixtures and verify `sessions.db` remains intact.
4. Stop server and manually verify clean reset: remove effective DB plus `-wal`/`-shm`, restart,
   confirm empty Codex Usage and recreated Codex-only schema.
5. Update docs/changelog and perform architecture post-implementation review.

## Todo list

- [x] Automated release gates recorded with results.
- [x] Privacy and terminal-dependency scans are clean; focused rollback/IPv6/Settings tests pass.
- [x] Automated reset/reopen/delete/retention coverage passes.
- [x] Legacy architecture wording removed after implementation.
- [ ] Manual PTY enabled-vs-disabled benchmark (environment-gated).
- [ ] Pinned Codex compatibility tests (environment-gated).
- [ ] Signed packaging completion; `pnpm check` stopped when `TAURI_SIGNING_PRIVATE_KEY` was unavailable.

## Success Criteria

Refactor has no terminal Usage behavior, safe automated reset behavior, passing Rust/UI/browser
validation, and documentation matching the live Codex-only architecture. PTY performance regression
and pinned Codex compatibility remain unverified; signed packaging is blocked by missing key.

## Risk Assessment

Browser or old server versions may disagree on removed fields; ship backend/client contract changes
together and document the compatibility boundary. Never delete a DB automatically on migration error.

## Security Considerations

Review file permissions, bearer/key handling, delete authorization, range bounds, and log redaction.
Treat manual DB deletion as an operator action while the server is stopped.

## Validation handoff (2026-08-04)

- Rust 601 passed/0 failed/2 ignored; UI 756/756; browser 69/69.
- UI/web builds and lint pass. `pnpm check` produced web/native builds and DEB/RPM bundles before
  stopping at unavailable `TAURI_SIGNING_PRIVATE_KEY`.
- Automated reset/reopen/privacy/terminal-dependency tests pass.
- Manual PTY benchmark and pinned Codex compatibility tests require target environment access.

## Finalization (2026-08-05 01:11 +07:00)

Phase 05 DONE / complete. Review approved 8/10 with no critical issues. Release follow-ups remain:
provide `TAURI_SIGNING_PRIVATE_KEY` for signed packaging, run the manual PTY enabled-vs-disabled
benchmark, and run pinned Codex compatibility tests in the target environment.

## Next steps

Supply signing key, run manual PTY benchmark, run pinned compatibility tests, then close release
follow-ups.
