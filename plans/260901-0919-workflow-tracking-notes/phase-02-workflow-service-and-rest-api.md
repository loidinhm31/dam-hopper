# Phase 02 — Workflow Service and REST API

## Context Links
- [Plan](./plan.md)
- [Phase 01](./phase-01-domain-and-relational-persistence.md)
- [Domain research](./research/researcher-01-workflow-tracking-domain.md)
- [Router](../../server/src/api/router.rs)
- [AppState](../../server/src/state.rs)
- Depends on: Phase 01. Enables Phases 03–04.

## Overview
- **Date:** 2026-09-01
- **Description:** Add a protected service/API boundary that validates current workspace, configured projects, registered targets, ownership, payloads, and retention before persistence.
- **Priority:** P2
- **Implementation status:** Complete / DONE (2026-09-02)
- **Progress:** 100%
- **Completed:** 2026-09-02
- **Review status:** Complete / Approved (2026-09-02)
- **Validation:** Workflow unit tests 14/14 and API integration tests 8/8 passed; full server suite 896/896 executed tests passed (2 ignored). See the [test report](../../reports/tester-260902-0306-workflow-service-rest-api.md) and [review report](../../reports/code-reviewer-260902-0312-phase-02-workflow-service-rest-api.md).
- **Handoff:** Workflow service and protected Axum REST API endpoints complete; ready for Phase 03.

## Key Insights
- All routes under the existing protected Axum router inherit cookie auth/no-auth policy; no route or service is needed.
- `AppState::resolve_project_target` is authoritative for root/worktree ownership. Validation occurs before acquiring the SQLite mutex.
- The API returns an overview shaped for the context surface. The client must not assemble many project queries.
- Server time is authoritative for `recordedAt`, retention, and observation receipt. Validated user-supplied `startedAt`/`endedAt` are authoritative work times; a client **Now** action merely sends the current value and terminal observations cannot replace it.

## Requirements
- Mount protected `/api/workflow/*`; never expose writes through terminal WebSocket.
- Resolve current workspace UUID from `config.config_path`, then validate project exists and worktree is registered/usable for creates/rebinds.
- Return `WorkflowOverview`: workspace UUID/name, server time, project/target summaries, Plans as primary rows, optional Phase/direct-Task trees, standalone Tasks, direct Plan notes/sessions, running/stale sessions, latest activity, factual tracked-Task counts, attention counts, and provenance.
- Do not return registry locator. Absolute worktree paths may appear only inside structured authorized `ProjectTargetRef`, matching existing worktree APIs; display labels use branch/basename and events never duplicate paths.
- Scope every overview and mutation to the current authenticated server profile/workspace. Do not aggregate or cache data from other profiles in this service.
- Item mutations enforce Plan-first rules: Plans require no parent; Phases require a same-target Plan; Tasks accept a same-target Plan/Phase parent or no parent. Creating a Plan never creates placeholder children.
- Notes and sessions may attach directly to a Plan, Phase, Task, or remain target-only where the existing optional item contract permits.
- Session create/end requests require explicit manual timestamps and provenance; validate `endedAt >= startedAt`, accept timezone-qualified RFC3339/ISO values, and preserve the submitted instant. Abandon remains an explicit user action and does not fabricate an end.
- Resource-link requests may carry a bounded manual agent `harnessLabel` and opaque `runId`; no generic agent-observation ingestion endpoint ships in MVP.
- Require client-generated UUID `requestId` on every mutation. Retry returns the current resource and `replayed: true`.
- Use typed error codes: `workflow_not_found`, `workflow_conflict`, `workflow_invalid_transition`, `workflow_target_unavailable`, `workflow_limit_exceeded`, `workflow_store_unavailable`.
- Default event retention 90 days and deleted-note grace 7 days. Keep current items/sessions until explicit deletion/archive; run bounded purge at startup and every 24 hours.
- If workflow DB operations fail, return a local workflow error and keep terminal/IDE APIs operational.

## Architecture
- `WorkflowService` copies config/project data out of locks, resolves target asynchronously, then invokes synchronous store methods via `tokio::task::spawn_blocking` only where measured necessary; never hold config/target locks across DB work.
- Endpoint contract:
  - `GET /api/workflow/overview`
  - `GET /api/workflow/events?cursor=&limit=50`
  - `POST /api/workflow/items`; `PATCH|DELETE /api/workflow/items/{id}`
  - `POST /api/workflow/sessions` with explicit `startedAt`; `POST /api/workflow/sessions/{id}/end` with explicit `endedAt`; `POST /api/workflow/sessions/{id}/abandon`
  - `POST|DELETE /api/workflow/sessions/{id}/links` for terminal links or manual harness label/run ID
  - `POST /api/workflow/notes`; `DELETE /api/workflow/notes/{id}`
  - `DELETE /api/workflow/history?before=` for explicit permanent purge
- Overview returns `trackedTaskCount`/`completedTrackedTaskCount`; no percentage is returned when the count is zero, and the API never claims those Tasks represent total Plan completion.
- Mutations return `{ resource, replayed, eventId }`; DELETE returns a typed tombstone, not a bare boolean.
- Overview performs bounded relational reads, then enriches only referenced targets/config projects in memory; no Git invocation per row.

## Related Code Files
### Modify
- `server/src/state.rs` — hold optional shared workflow-capable `Arc<SessionStore>` and service.
- `server/src/main.rs` — construct service from existing store; start bounded purge; reconcile unavailable store non-fatally.
- `server/src/api/mod.rs` — export workflow handlers.
- `server/src/api/router.rs` — register protected workflow routes and focused body limit.
- `server/src/api/error.rs` and `server/src/error.rs` — map workflow errors without path leakage.
- `server/src/config/schema.rs` — add retention/stale defaults under `[server]`.
### Create
- `server/src/workflow/service.rs` — ownership, transition, enrichment, and retention orchestration.
- `server/src/workflow/error.rs` — domain/service errors.
- `server/src/api/workflow.rs` — request DTO validation and handlers.
- `server/tests/workflow_api.rs` — protected API integration coverage with tempfile DB/config.
### Delete
- None.

## Implementation Steps
1. Add `WorkflowError`; map conflicts to 409, validation/limits to 400, missing to 404, unavailable storage to 503. Sanitize messages.
2. Add config defaults: `workflow_event_retention_days=90`, `workflow_deleted_note_retention_days=7`, `workflow_stale_after_hours=24`; reject zero/out-of-range values.
3. Construct `WorkflowService` from the same `Arc<SessionStore>` in `main.rs`; `None` yields 503 only for workflow endpoints.
4. Implement current-scope resolution and project/target validation. Reads may preserve unavailable historical targets; new links/starts require fresh resolution.
5. Define camelCase API DTOs and strict request structs. Reject unknown enum values, invalid parent-kind/scope/depth combinations, overlong strings, non-UUID IDs, timezone-missing/non-finite/order-invalid timestamps, and unexpected path-bearing fields.
6. Implement overview/event handlers and keyset cursor encoding. Group Plans first, preserve optional children/standalone Tasks, expose last activity and factual tracked-Task counts, and apply hard server limits.
7. Implement item/manual-session/link/note mutations with request-id replay semantics and optimistic concurrency via required `updatedAt` on PATCH/DELETE. A **Now** value follows the same timestamp path as typed input.
8. Implement explicit purge and daily/startup retention. Purge events/deleted notes in batches of 500, yielding between batches.
9. Add router integration tests for auth, current-profile/workspace isolation, Plan-only creation, every parent rule, no placeholder children, direct Plan notes/sessions, standalone Tasks, target rejection, null progress/factual counts, manual timestamp round-trip/order, lifecycle conflicts, stale update conflict, replay, manual harness bounds, limits, redaction, pagination, and store-unavailable isolation.

## Todo List
- [x] Manual timestamp and manual harness-link contracts preserve submitted values and current-profile scope.
- [x] Plan-only, optional breakdown, direct ownership, standalone Task, and factual-count contracts are complete.
- [x] Service validates workspace/project/target ownership.
- [x] Protected REST contracts and typed errors complete.
- [x] Mutation replay and optimistic concurrency complete.
- [x] Retention/purge bounded and non-fatal.
- [x] API integration tests cover isolation and redaction.

## Success Criteria
- Cross-workspace IDs and unregistered targets return non-disclosing 404/target errors and write nothing.
- Retrying an identical request ID is safe; reusing it for a different mutation returns conflict.
- A Plan with no children returns useful status/last-activity/session/note context and no fake `0%`; optional tracked Tasks return factual counts only.
- Overview is one bounded request and excludes raw commands, cwd, registry path, environment, terminal output, and arbitrary adapter payload.
- Terminal exit/restart/removal observations can update linked-resource health and suggested times but cannot change session status, `startedAt`, or `endedAt`.
- Workflow DB unavailable/locked does not prevent PTY creation, streaming, input, or restore.

## Risk Assessment
- **Overview growth:** hard row limits, summary DTO, event pagination; show truncation metadata.
- **Workspace switching race:** capture workspace UUID before validation and recheck current config identity immediately before commit.
- **Blocking SQLite:** short transactions and narrow offload; no network/Git work under DB lock.
- **Retention deleting current truth:** purge only expired events and already-soft-deleted notes; never age-delete snapshots.

## Security Considerations
- Existing auth protects every route; tests prove public router excludes them.
- Validate opaque IDs within current workspace before returning existence details.
- Accept absolute target paths only through `ProjectTargetRef` and authoritative resolver; never use them directly for file execution.
- Apply a workflow-specific 32 KiB body limit beneath the router's broader 10 MiB cap.

## Next Steps
- Phase 03 connects PTY lifecycle facts and the harness-neutral observation contract.
- Phase 04 maps these REST operations into typed shared-UI APIs and profile-scoped queries.

## Unresolved Questions
None.
