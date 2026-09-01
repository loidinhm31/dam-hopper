# Phase 07 — Verification, Rollout, Observability, and Docs

## Context Links
- [Plan](./plan.md)
- [Phases 01–06](./phase-01-domain-and-relational-persistence.md)
- [Web-testing skill target conventions](../../packages/ui/package.json)
- [Project requirements](../../docs/project-overview-pdr.md)
- [Code standards](../../docs/code-standards.md)
- Depends on: Phases 01–06.

## Overview
- **Date:** 2026-09-01
- **Description:** Prove migration, API, lifecycle, responsive UI, and continuity contracts; add privacy-safe diagnostics, compatibility behavior, rollout notes, and repository documentation.
- **Priority:** P2
- **Implementation status:** Pending
- **Review status:** Pending

## Key Insights
- This feature spans durable state, PTY lifecycle, three responsive shells, remote profiles, and focus ownership; unit tests alone are insufficient.
- Browser proof must exercise the real WorkspacePage surface and confirm xterm buffer/input survival, not only component markup.
- Older remote profiles may return 404 for workflow routes. Treat that as feature unavailable for that profile, not global app failure.
- Rollback to an older binary is schema-safe because migration 010 is additive; old binaries ignore workflow tables. Never down-migrate automatically.

## Requirements
- Add store/domain tests, protected API integration tests, PTY lifecycle correlation tests, TypeScript helper/component tests, shell integration tests, and Chromium browser flows.
- Test observable contracts and failures; use tempfile SQLite/config/Git/worktrees and real state transitions. No mock DB, fake migration, source-text assertion, or terminal-output capture.
- Browser sizes: desktop 1440×900, narrow 900×700, mobile 390×844, safe-area emulation where harness supports CSS env; document real-device limits.
- Verify loading, empty, unavailable-old-server, error/retry, stale, blocked, running, ended, abandoned, truncation, and retention states.
- Verify typed and **Now** manual timestamps round-trip identically, terminal observations never mutate them, suggested end times require explicit application, and manual harness labels/run IDs remain bounded and current-profile scoped.
- Verify Plan-only creation/resume, direct Plan notes/sessions/execution links, optional Phase/direct Task, standalone Task, no placeholder children, and factual tracked-Task copy without fake percentage.
- Add fixed-cardinality diagnostics only: operation/result, observation kind/result, reconciliation result, store availability, overview latency/counts. Never labels for IDs, project, path, title, note, external run, or terminal.
- Release without a feature flag. API 404 hides/disables workflow controls only for that active profile with an explanatory state; auth/5xx remain explicit errors.
- Update architecture, product requirements, component docs, configuration, roadmap, README, and changelog after behavior passes.

## Architecture
- Validation pyramid:
  1. Rust domain/store invariants and migration.
  2. Axum protected route and scope tests.
  3. PTY observation/restart/reconciliation tests.
  4. React pure/state/component/shell tests.
  5. Chromium actual-surface workflow and continuity flows.
  6. Isolated-server manual smoke against persistent SQLite and restart.
- Add structured tracing spans around workflow service calls with `operation`, `outcome`, `duration_ms`, row counts, and event count only.
- Feed bounded failure/drop counts into existing `DiagnosticStore`; do not add a second telemetry DB or export workflow content.

## Related Code Files
### Modify
- `server/src/workflow/tests.rs`, `server/src/workflow/observation_tests.rs`, `server/tests/workflow_api.rs`, `server/src/pty/tests.rs` — final behavioral matrix.
- Relevant `packages/ui/src/**/**.test.ts(x)` from Phases 04–06 — final unit/integration matrix.
- `README.md` — feature summary and privacy boundary.
- `docs/system-architecture.md` — data flow/schema/lifecycle/rollback diagram.
- `docs/codebase-summary.md` — delivered modules and test boundary.
- `docs/frontend-components.md` — ambient row/deck/sheet behavior and focus rules.
- `docs/project-overview-pdr.md` — workflow continuity requirement/acceptance.
- `docs/configuration-guide.md` — retention/stale settings and database location.
- `docs/project-roadmap.md` — milestone status only after implementation passes.
### Create
- `packages/ui/browser-tests/workflow-context-surface.browser.tsx` — responsive, focus, state, and actions.
- `packages/ui/browser-tests/workspace-workflow-terminal-continuity.browser.tsx` — actual WorkspacePage terminal buffer/input preservation.
- `docs/project-changelog.md` — repository-convention changelog is absent; add concise dated feature entry.
### Delete
- None.

## Implementation Steps
1. Complete Rust domain/store tests for all transitions, Plan-first parent-kind/scope/depth rules, Plan-only direct ownership, standalone Tasks, no placeholder children, factual counts/null progress, request replay, overlapping sessions, manual timestamp preservation/order, observation isolation, row limits, retention, migration 009→010, reopen, and corrupt/locked/unavailable isolation.
2. Complete Axum tests for protected routing, current-profile/server scope, workspace switch isolation, Plan-only overview/mutations, optional children, direct Plan notes/sessions, standalone Tasks, target validation, factual count/null-progress DTOs, manual timestamp round-trip, optimistic conflict, redaction, cursor pagination, purge, body limits, and 503 isolation.
3. Complete PTY tests for create/link, respawn, exhausted restart, final exit, removal, old incarnation, duplicate/out-of-order observation, queue pressure, restore reconciliation, and manual stale state; assert every path preserves manual status/`started_at`/`ended_at`.
4. Complete Vitest tests for Plan-first grouping, Plan-only detail, optional children, standalone Tasks, `Breakdown not tracked`, factual count copy, direct Plan notes/sessions, typed/**Now** equivalence, suggestion non-application, manual harness links, transport paths, profile-scoped cache, request-ID stability, UI states/actions, focus guard, row caps, and shell pass-through.
5. Browser-test desktop three/two-pane deck and mobile sheet with a Plan that has no children: create/resume, add note, start/end direct Plan session, link terminal/harness, verify no `0%`/warning, then add optional Phase/direct Task and standalone Task without losing Plan history.
6. Browser-test keyboard/focus return, screen-reader labels, 44px touch sizes, 35/90dvh states, no horizontal overflow, reduced motion, and factual `x/y tracked tasks done` wording.
7. Browser-test a real terminal: type marker, create a manually timed direct Plan session, link terminal, trigger observed exit/restart state, confirm timestamps remain unchanged, open/edit/close workflow surface, switch IDE↔terminal and compact surface, then confirm same session ID, marker buffer, focus, and subsequent input.
8. Run targeted gates during implementation: `cargo test workflow`, `cargo test --test workflow_api`, focused `pnpm --filter @dam-hopper/ui test -- <changed tests>`, and `pnpm --filter @dam-hopper/ui test:browser -- workflow-context-surface workspace-workflow-terminal-continuity`.
9. Run final package build/full applicable suites once after all phases, per main workflow; do not duplicate mid-phase project-wide runs.
10. Start an isolated server with temp config/session DB and non-production port; create Plan-only data/note/manual session, link terminal and harness, restart server, verify direct ownership/link reconciliation without session mutation, add optional breakdown, explicitly end with a suggested time, then purge history and inspect sanitized logs.
11. Add diagnostics and assert fixed label sets plus zero content/path leakage. Define healthy baseline: no observation drops; overview p95 <200ms at caps; migration/startup addition <250ms; PTY behavior unaffected when store fails.
12. Update listed docs from verified behavior. Include Plan-first optional breakdown, direct Plan notes/sessions, factual count semantics, manual timestamp authority/**Now**, observation suggestions, manual harness metadata, current-profile scope, 90/7-day defaults, 24-hour stale rule, old-server state, rollback, and privacy exclusions.
13. Roll out additive migration with backup guidance. On rollback keep tables/data; on re-upgrade migration reopens idempotently. Never delete workflow data as rollback automation.

## Todo List
- [ ] Manual timestamp/**Now** authority, suggestion non-application, and manual harness contracts pass.
- [ ] Plan-only direct ownership, optional breakdown, standalone Tasks, null progress, and factual-count contracts pass.
- [ ] Rust store/API/lifecycle matrix passes.
- [ ] React contract/shell tests pass.
- [ ] Chromium responsive/focus/terminal-continuity flows pass.
- [ ] Isolated restart/purge/privacy smoke passes.
- [ ] Diagnostics fixed-cardinality and content-free.
- [ ] Docs, roadmap, README, and changelog match verified behavior.

## Success Criteria
- Every named MVP behavior has a failing-before/fixed-after behavioral gate; no project-wide suite is run until integration is complete.
- Existing 009 DB data and terminal restore survive migration and binary rollback.
- Actual browser terminal retains session, buffer, input, and focus semantics through workflow interactions and shell modes.
- Plan-only records remain fully resumable across refresh/restart; optional breakdown can be added later without moving or rewriting Plan notes/sessions/history.
- Remote profile/workspace data never flashes across switches; old servers degrade only the workflow surface.
- Manual timestamps remain byte-for-byte the submitted instants across refresh/restart; resource observations and suggestions never alter them without explicit user submission.
- Logs/diagnostics/DB event payload inspection finds no command, cwd duplication, env, prompt, output, note body, raw path event field, or unbounded identifier.

## Risk Assessment
- **Flaky timers:** inject/freeze clocks in unit tests; browser asserts bounded ranges/status, not exact seconds.
- **Safe-area emulation gap:** verify CSS contract in Chromium and record real iOS/Android device check as release evidence, not automated certification.
- **Migration rollback:** additive only, backup before first production upgrade, no down migration.
- **Observability cardinality/privacy:** enum-only labels and tests rejecting dynamic values/content.

## Security Considerations
- Run redaction assertions for API errors, tracing, diagnostics exports, and activity payloads.
- Verify cross-workspace/profile IDs are non-disclosing and rejected before data return.
- Confirm notes are plain text, length-limited, and permanently purged after explicit deletion/grace.
- Confirm old-server handling does not convert auth failures into benign unavailable state.

## Next Steps
- After all gates pass, mark phases complete, update roadmap/changelog, and release through the normal review/deployment workflow.
- Deferred work requires separate product evidence and plan; none is silently enabled here.

## Unresolved Questions
None.
