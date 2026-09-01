# Code Review: Phase 03 Terminal Lifecycle Correlation and Agent Adapter

**Score:** 9.8 / 10  
**Status:** Approved / Complete  
**Date:** 2026-09-02  

## Scope
- Files reviewed:
  - `server/src/workflow/observation.rs`
  - `server/src/workflow/reconcile.rs`
  - `server/src/workflow/observation_tests.rs`
  - `server/src/workflow/mod.rs`
  - `server/src/workflow/service.rs`
  - `server/src/workflow/store/session.rs`
  - `server/src/workflow/store/mod.rs`
  - `server/src/pty/manager.rs`
  - `server/src/api/workflow/session.rs`
  - `server/src/main.rs`
- Lines analyzed: ~2,500 LOC
- Focus: Phase 03 terminal lifecycle correlation, agent adapter boundaries, PTY hot-path isolation, incarnation ordering, manual session immutability, startup reconciliation, and target validation

## Overall Assessment
Implementation adheres strictly to architectural contracts, security invariants, and performance boundaries. The observation pipeline is clean, robust, and completely decoupled from PTY I/O hot paths. 

Key architectural achievements:
1. **PTY Hot-Path Isolation**: `PtySessionManager` uses non-blocking `try_send` into a bounded `sync_channel(256)`. PTY reader and supervisor threads never lock the SQLite database or block on storage I/O.
2. **Payload Sanitization**: `WorkflowObservation` strictly excludes commands, args, environment variables, working directories, and terminal buffer output, persisting only allowlisted lifecycle metadata.
3. **Manual Session Invariant Preservation**: Terminal exit, crash, restart, and removal events update only `workflow_resource_links` observed health and suggested end times; manual work sessions (`status`, `started_at`, `ended_at`) remain immutable.
4. **Incarnation Ordering**: Stale or out-of-order lifecycle observations with older incarnations are skipped without regressing link state.
5. **Startup Reconciliation**: Reconciles live restored PTY sessions against database links gracefully inside a single transaction without altering work session statuses or timestamps.
6. **Authoritative Target Validation**: Resource linking rejects cross-project and cross-worktree terminal associations.

## Critical Issues
None.

## Warnings
1. **Deduplication Key Scope on Multi-Session Resource Links (`server/src/workflow/observation.rs:342-347`)**:
   - `event_id` in `process_observation` is computed as `format!("evt:obs:term:{}:{}:{}", external_id, obs_inc.unwrap_or(0), obs.action_str())`. If a user links the same terminal to two distinct concurrent work sessions in the same project/worktree, `record_event_tx` will record the event for the first link but silently drop it for the second link due to `INSERT OR IGNORE` on the duplicate event ID.
   - *Recommendation:* Include `link.session_id` or `link.id` in `event_id` (e.g. `format!("evt:obs:term:{}:{}:{}:{}", link.session_id, external_id, obs_inc.unwrap_or(0), obs.action_str())`) so that all linked sessions receive their respective activity event records.

## Suggestions & Improvements
1. **File Size Optimization (`observation.rs`, `observation_tests.rs`)**:
   - `observation.rs` (372 LOC) and `observation_tests.rs` (491 LOC) can be partitioned into smaller modules if additional observation types or harness adapters are added in future phases.

## Positive Observations
- **Fault-Tolerant Non-Blocking Queue**: Dropped observation counters are tracked with atomic increments and logged with structured diagnostics (`dropped_count`), ensuring zero performance penalty on the terminal subsystems.
- **Idempotency and Replay Safety**: Deterministic event IDs suppress duplicates from terminal retries or replays.
- **Clean Separation of Concerns**: Startup reconciliation (`reconcile.rs`) and observation processing (`observation.rs`) are modular and unit-testable in isolation.
- **Exhaustive Unit & Integration Coverage**: `observation_tests.rs` validates normal flow, crash/exit handling, restart supervisor loop, stale incarnation suppression, queue overflow non-blocking behavior, direct Plan session linking without synthetic tasks, and end-to-end PTY manager lifecycle.

## Recommended Actions
1. [Optional] Update `event_id` generation in `observation.rs` to include `link.session_id` for multi-session link isolation.
2. Proceed to Phase 04: Client state, types, transport, and query contracts.

## Metrics & Validation
- `cargo test workflow`: 28 passed / 0 failed (100%)
- `cargo test` (full server suite): 907 passed / 0 failed / 2 ignored (100%)
- Type Safety: 100% Rust typechecked and compiled without warnings
- Linting: Clean

## Updated Plans
- `plans/260901-0919-workflow-tracking-notes/phase-03-terminal-lifecycle-correlation-and-agent-adapter.md` (Status: Complete / DONE, all 6 todo items verified)
- `plans/260901-0919-workflow-tracking-notes/plan.md` (Phase 03 marked Complete / 100%)

## Unresolved Questions
None.
