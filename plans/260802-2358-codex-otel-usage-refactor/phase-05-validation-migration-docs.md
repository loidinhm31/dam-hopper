# Phase 05: Validation, migration, docs, and release gates

## Context links

- Parent: [plan.md](./plan.md)
- Architecture gate: [architecture-gate-report.md](./reports/architecture-gate-report.md)
- Updated architecture: [system architecture](../../docs/system-architecture.md#codex-otel-usage-analytics)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** Pending · **Review:** Pending

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

- [ ] All release gates recorded with commands/results.
- [ ] Privacy and terminal-dependency scans are clean.
- [ ] Clean reset runbook verified (Phase 5 follow-up).
- [ ] Legacy architecture wording removed after implementation.

## Success Criteria

Release candidate has no terminal Usage behavior, no PTY performance regression, safe development
reset behavior, passing tests, and documentation that matches the live Codex-only architecture.

## Risk Assessment

Browser or old server versions may disagree on removed fields; ship backend/client contract changes
together and document the compatibility boundary. Never delete a DB automatically on migration error.

## Security Considerations

Review file permissions, bearer/key handling, delete authorization, range bounds, and log redaction.
Treat manual DB deletion as an operator action while the server is stopped.

## Next steps

Phase 5 release gates and the clean-reset runbook remain pending; this document does not claim them
complete.
