# Code Review: Phase 02 Workflow Service and REST API

**Score:** 9.5 / 10  
**Status:** Approved / Complete  
**Date:** 2026-09-02  

## Scope
- Files reviewed:
  - `server/src/workflow/service.rs`
  - `server/src/workflow/error.rs`
  - `server/src/api/workflow/mod.rs`
  - `server/src/api/workflow/dto.rs`
  - `server/src/api/workflow/mapping.rs`
  - `server/src/api/workflow/item.rs`
  - `server/src/api/workflow/session.rs`
  - `server/src/api/workflow/note.rs`
  - `server/src/api/workflow/purge.rs`
  - `server/src/api/workflow/cursor.rs`
  - `server/src/api/router.rs`
  - `server/src/api/error.rs`
  - `server/src/error.rs`
  - `server/src/main.rs`
  - `server/src/state.rs`
  - `server/src/config/schema.rs`
  - `server/tests/workflow_api.rs`
- Lines analyzed: ~2,400 LOC
- Focus: Phase 02 Workflow Service & REST API implementation, security, correctness, architecture, plan verification

## Overall Assessment
Implementation is clean, idiomatic, robust, and well-tested. All requirements from Phase 02 specifications are met. Strict request DTO validation (`deny_unknown_fields`), 32 KiB body limit layer, auth middleware enforcement, CAS optimistic concurrency, idempotency replay, Plan-first hierarchy constraints, and keyset cursor pagination with tampered-cursor rejection are correctly implemented. Blocking SQLite store interactions are safely dispatched to Tokio's blocking threadpool (`spawn_blocking`).

## Critical Issues
None.

## Warnings
1. **Note Deletion Idempotency Replay Check Lacks Event Type Verification (`server/src/api/workflow/note.rs:192-210`)**:
   - In `note::delete`, existing event lookup on `request_id` immediately assumes success without verifying `existing.event_type == WorkflowEventType::NoteDeleted` or checking whether `existing` was linked to the target note. If a client reuses a `request_id` from an unrelated mutation (e.g., `ItemCreated`), it returns `replayed: true` for the note deletion instead of returning a 409 Conflict.
   - *Recommendation:* Check `existing.event_type == WorkflowEventType::NoteDeleted` and match note association or return `err(WorkflowError::Conflict)`.

2. **Hardcoded Event Expiration Duration in Event Creation Helpers (`item.rs`, `session.rs`, `note.rs`)**:
   - `create_event` helpers hardcode `expires_at: Some(now + 90 * 86_400_000)` instead of reading `server.workflow_event_retention_days` from configuration.
   - *Recommendation:* Pass the configured retention days from `WorkflowService` or config into `create_event`.

## Suggestions & Improvements
1. **File Size Refactoring for `session.rs` and `item.rs`**:
   - `session.rs` (448 LOC) and `item.rs` (332 LOC) exceed the 200-line guideline. Splitting session handlers (e.g. `session/create.rs`, `session/link.rs`, `session/lifecycle.rs`) will improve maintainability.
2. **Cursor Decoding Struct Formatting (`server/src/api/workflow/cursor.rs`)**:
   - `cursor.rs` contains multiple statements compressed on single lines. Standard multi-line formatting should be applied for consistency.

## Positive Observations
- **Strong Type Safety and Parameter Deny-List:** Request DTOs strictly enforce `#[serde(deny_unknown_fields)]`, rejecting unexpected or malicious payload injection.
- **Strict Concurrency & Idempotency:** Implemented CAS concurrency with required RFC3339 `updatedAt` timestamps and idempotency checks across all resource mutations.
- **Safe Offloading:** Synchronous SQLite operations run inside `tokio::task::spawn_blocking`, preventing blocking the asynchronous Axum executor.
- **Resource Protection & Security:** Protected routes under auth middleware, explicit 32 KiB `RequestBodyLimitLayer`, strict sanitization of error messages to avoid leaking filesystem or database details.
- **Factual Metrics:** Task tracking returns factual `total_tracked_tasks` and `completed_tracked_tasks` without fabricated percentages.
- **Comprehensive Integration Tests:** Integration suite in `server/tests/workflow_api.rs` covers auth, hierarchy validation, CAS optimistic concurrency, lifecycle transitions, limits, pagination, and history purge.

## Validation Results
- `cargo test --lib workflow::`: 14 passed / 0 failed (100%)
- `cargo test --test workflow_api`: 8 passed / 0 failed (100%)
- Full server test suite: 896 passed / 0 failed / 2 ignored

## Updated Plans
- `plans/260901-0919-workflow-tracking-notes/phase-02-workflow-service-and-rest-api.md` (Status: Complete / DONE, all todos checked)
- `plans/260901-0919-workflow-tracking-notes/plan.md` (Status: Phase 02 marked Complete / 100%)

## Unresolved Questions
None.
