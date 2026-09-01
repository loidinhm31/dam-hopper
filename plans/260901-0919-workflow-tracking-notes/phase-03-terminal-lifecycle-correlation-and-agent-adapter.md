# Phase 03 — Terminal Lifecycle Correlation and Agent Adapter

## Context Links
- [Plan](./plan.md)
- [Phase 01](./phase-01-domain-and-relational-persistence.md)
- [Phase 02](./phase-02-workflow-service-and-rest-api.md)
- [PTY lifecycle architecture](../../docs/system-architecture.md#data-flow-terminal-lifecycle)
- [PTY event sink](../../server/src/pty/event_sink.rs)
- [PTY manager](../../server/src/pty/manager.rs)
- Depends on: Phases 01–02. Enables Phase 06.

## Overview
- **Date:** 2026-09-01
- **Description:** Correlate explicit workflow sessions with authoritative PTY create/exit/restart facts and define a harness-neutral, allowlisted observation boundary.
- **Priority:** P2
- **Implementation status:** Complete / DONE (2026-09-02)
- **Progress:** 100%
- **Completed:** 2026-09-02
- **Review status:** Approved / Complete (2026-09-02)
- **Validation:** Workflow observation and PTY lifecycle coverage passed; manual agent harness bounds verified; full server suite 907/907 passed with 2 ignored (100%).
- **Handoff:** Terminal lifecycle correlation, incarnation-ordered link status updates, startup reconciliation of live/dead terminals, target-scoped validation, and bounded manual agent harness links complete; ready for Phase 04.
## Key Insights
- PTY public session IDs persist through respawn; incarnation distinguishes concrete processes. `terminal:exit` carries `willRestart`; `process:restarted` confirms continuation.
- Correlation must happen server-side, not by watching frontend WebSocket delivery. Browser disconnects and profile switches must not lose lifecycle facts.
- Terminal facts never infer task title/status or inspect command text. A workflow session exists only after explicit user start/link.
- Agent-specific command recognition currently lives in client notification code. Do not reuse it as durable truth or persist prompts/output.
- A manual session may attach directly to a Plan with no Phase/Task. Observation/link handling is item-kind agnostic and must not synthesize breakdown records.

## Requirements
- Introduce `WorkflowObservationRecorder` with one non-blocking method accepting a closed MVP `WorkflowObservation` enum: terminal-created, terminal-exit-pending-restart, terminal-restarted, terminal-final-exit, terminal-removed.
- Terminal observations include only session ID, incarnation, configured project, validated worktree target, server time, exit code, and restart count. No command/cwd/env/output.
- Agent resources are manual in MVP: the user supplies a bounded `harnessLabel` and opaque `runId` when linking. Do not inspect terminal commands, auto-detect a harness, or implement Claude/Codex/Antigravity producers.
- Link validation compares terminal `SessionMeta.project/worktree_path` against the requested target and records incarnation; mismatches fail without partial links.
- Terminal and manual harness links inherit the explicit session target/item context, including a direct Plan attachment; linking never reparents the session or creates a Task.
- `willRestart=true` updates only resource-link observed state and appends `terminal_restart_pending`; successful respawn updates incarnation/last-observed. Final exit marks the link exited and may expose a suggested end time, but never ends or timestamps the manual work session.
- Explicit terminal removal marks the link unavailable and may record a suggestion. It never abandons the manual work session or fabricates `ended_at`.
- On server startup, reconcile only after `restore_sessions_with_state`: live/restored links regain observed health; missing/dead links become unavailable. Manual session status/timestamps remain unchanged and stale attention is derived after 24 hours.
- A clean server restart must not create a second observation event or change a manual session. Crash recovery uses persisted snapshots and idempotent observation keys.

## Architecture
- Add a clone-cheap recorder to `PtySessionManager`; production uses `WorkflowService`, tests/default use no-op. Keep workflow SQLite off PTY output/input hot paths.
- Deliver terminal observations through a bounded `sync_channel(256)` worker. Create/final-exit/removal are ordered delivery; restart updates may coalesce by `(resource_id, incarnation, kind)`. Queue/storage failure emits bounded counters/logs and never blocks PTY I/O.
- Observation idempotency key is deterministic from source + external ID + incarnation + kind; unique event ID suppresses restart/replay duplicates.
- Define a narrow future harness-observation interface at the service boundary, but ship no automatic producer or agent lifecycle enum in MVP. Manual harness label/run ID uses the ordinary protected link API.
- Expose no generic observation endpoint or new token scheme. Any future harness producer requires its own plan/security review and must preserve manual timestamp authority.

## Related Code Files
### Modify
- `server/src/pty/manager.rs` — emit observations at successful create, restart decision/result, final exit, kill/remove.
- `server/src/persistence/restore.rs` — expose restored/live identity set for post-restore reconciliation.
- `server/src/main.rs` — start/stop recorder worker and invoke reconciliation after PTY restore.
- `server/src/workflow/service.rs` — validate links, consume observations, reconcile stale/missing resources.
- `server/src/pty/tests.rs` — lifecycle ordering and PTY fault-isolation coverage.
### Create
- `server/src/workflow/observation.rs` — closed observation types, recorder trait, no-op and bounded worker.
- `server/src/workflow/reconcile.rs` — startup and stale-state reconciliation.
- `server/src/workflow/observation_tests.rs` — idempotency/restart/crash/adapter tests.
### Delete
- None.

## Implementation Steps
1. Define the terminal-only observation enum and payload limits. Exclude arbitrary JSON and all free-form text.
2. Add the optional recorder to `PtySessionManager` construction without changing existing `EventSink` WebSocket responsibilities.
3. Emit created only after PTY publication and persistence success boundary; emit exit with actual incarnation and restart decision.
4. Map `willRestart=true` to pending observed state. On `supervisor_loop` success emit restarted; on exhausted/canceled/failed respawn emit final exit. None of these paths may call manual session transitions.
5. Emit removal separately so user removal after exit is idempotent and cannot rewrite manual session status or timestamps.
6. Implement consumer transactions: locate active link, verify incarnation ordering, update observed state/`last_observed_at`/optional suggested end time, append a typed event, and leave the work-session snapshot unchanged.
7. Implement explicit terminal-link validation against `PtySessionManager::get/list`; implement manual agent links with bounded harness label/run ID and authoritative target validation.
8. After restore, reconcile persisted links with `pty_manager.list()`. Mark missing terminal links unavailable; derive stale attention without changing manual session status or times.
9. Test direct Plan sessions with no children, respawn observations, exhausted restart, terminal kill/remove, suggestions, duplicate events, old incarnation, server restart, crash before final event, queue full/store unavailable, manual timestamp preservation, cross-target rejection, no synthesized breakdown, and manual harness bounds.

## Todo List
- [x] Closed terminal observation contract contains no sensitive free-form telemetry.
- [x] PTY lifecycle emits correct incarnation-aware link observations.
- [x] Restart and startup reconciliation preserve every manual timestamp/status.
- [x] Manual harness links and future adapter boundary use explicit target correlation only.
- [x] Direct Plan sessions link resources without requiring or creating Phase/Task records.
- [x] Fault-isolation tests prove PTY input/output remain unaffected.

## Success Criteria
- Auto-restarting a terminal preserves one resource link across incarnations while leaving the manual work session untouched.
- Final process exit/removal changes observed link health and exposes at most a suggested end time; `ended_at` remains user-controlled.
- Missing linked terminal after restart becomes unavailable, not automatically abandoned; manual sessions survive and may display derived stale attention.
- Duplicate/out-of-order observations cannot regress link health, change manual session snapshots, or duplicate events.
- No PTY command/output/prompt/environment appears in workflow DB or API.

## Risk Assessment
- **PTY hot-path regression:** observations avoid output callbacks; bounded queue and no-op fallback isolate failures.
- **Restart race:** compare incarnation and observed-link state within one DB transaction; never couple it to work-session transitions.
- **False timing suggestion:** label suggestions as observed terminal times, require explicit user application, and preserve typed/manual values.
- **Adapter scope creep:** manual label/run ID plus a narrow future boundary; harness-specific launch/control, lifecycle producers, and natural-language inference stay deferred.

## Security Considerations
- MVP agent metadata enters only through the protected manual link API, remains target-validated/size-bounded, and never grants process execution; future automatic adapters require separate security review.
- Opaque external IDs are display-sanitized and not trusted as authorization.
- Logs contain workflow/event IDs and reason codes, not target paths or note content.
- Exit code is allowlisted metadata; signals/commands are not persisted.

## Next Steps
- Phase 04 exposes session health/provenance through profile-scoped client contracts.
- Phase 06 connects terminal navigation to existing `useTerminalManager` actions without remounting terminals.

## Unresolved Questions
None.
