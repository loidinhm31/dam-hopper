# Phase 02 Audit and Implementation Plan — Workflow Service and REST API

**Scope:** Phase 02 only. Audit performed against repository state on 2026-09-02. No source changes. Phase 01 is implemented; Phase 03+ adapters/UI excluded.

## Evidence read

- `README.md`
- `plans/260901-0919-workflow-tracking-notes/{plan.md,phase-01-domain-and-relational-persistence.md,phase-02-workflow-service-and-rest-api.md}`
- `docs/{system-architecture.md,code-standards.md,codebase-summary.md,project-overview-pdr.md,project-roadmap.md}`
- Current Rust config, bootstrap, state, router/error, workspace target resolver, PTY summary, persistence, and all `server/src/workflow/{model,store}` modules.

## Findings

### Existing foundation reusable as-is

- `SessionStore::connection()` exposes the same `Arc<Mutex<rusqlite::Connection>>`; `WorkflowStore::new(...)` must reuse it. No second DB/open lifecycle.
- `AppState::resolve_project_target()` and `WorkspaceTargetResolver::resolve()` provide fresh configured-project/worktree authorization. Root target works for non-Git projects; explicit worktrees require fresh Git registration and live canonical path.
- `workspace_context_guard` already serializes workspace switch against target-sensitive work. A workflow mutation can hold a read guard across config snapshot, fresh target resolution, and blocking DB transaction; this is the documented exception to “no lock across await.”
- Workflow domain types, strict state-transition functions, migration 010, transactional store wrappers, bounded constants, keyset ordering, overview tree assembly, and event/note purge primitives exist.
- Protected router seam exists at `server/src/api/router.rs::build_router_with_web_dir_and_origins`; workflow routes must be added to `protected`, before its `route_layer(require_auth)`.
- Startup already treats `SessionStore::open()` failure as non-fatal (`None` persistence; PTY/server continue). Workflow availability can follow that same optional path.

### Store/API gaps requiring Phase 02 source work

1. **Optimistic concurrency absent.** `WorkflowStore::update_item`, `delete_item`, `soft_delete_note`, `unlink_resource`, and session status changes do not accept expected `updated_at`. SQL mutates by ID/workspace only. Add compare-and-set inside the same transaction, not a service read-then-write check. Ensure new timestamp is `max(server_now_ms, current.updated_at + 1)` so tokens advance even within one millisecond.
2. **Replay incomplete and unsafe for general mutations.** Only `create_item_tx` checks a pre-existing event, and it assumes the retry regenerated the same item ID. Other mutations execute first; `record_event_tx` then silently `INSERT OR IGNORE`s the duplicate event, allowing duplicate transitions. Reusing one request UUID for a different operation is not detected.
3. **Request identity needs an internal contract.** Keep migration 010; use `workflow_events.id == requestId` as the 90-day replay ledger. Persist a canonical SHA-256 request fingerprint plus sanitized tombstone/replay projection in the bounded event payload. Add exact event lookup by ID. On every mutation, check event first: same workspace + operation + fingerprint => return current resource or stored tombstone with `replayed: true`; any mismatch/cross-workspace hit => non-disclosing conflict. Never emit the internal fingerprint/payload in API DTOs. Replay guarantee ends when retention/explicit purge removes the event.
4. **Target-scope checks are incomplete.** `create_item_tx` and `start_session_tx` compare parent/item project only, not `worktree_path`. Enforce exact `(workspace_id, project_name, worktree_path)` equality. Item worktree rebind must validate the proposed target and reject when it would differ from parent or any child; standalone/unattached item rebind remains valid. If note names both item and session, require both to share project/target scope.
5. **Terminal link validation absent.** `link_resource_tx` only validates strings. Before DB lock: require the PTY ID/incarnation to exist in `PtySessionManager::list()`, and require its project/worktree marker to equal the workflow session target. Then freshly resolve that target. Agent links remain manual metadata; do not add the Phase 03 observation endpoint.
6. **Abandon currently fabricates an end.** `update_session_status_tx` sets `ended_at = updated_at` when status is `Abandoned` without an explicit end. Required contract: `end` requires `endedAt`; `abandon` preserves existing `ended_at` (normally `None`) and never invents one.
7. **Workspace isolation is only safe with transaction-time scope stability.** Config path is canonical after `read_config`; resolve/get-or-create the workspace row from that locator. Hold the workspace read guard through commit. Every ID lookup/mutation remains scoped by that UUID. Do not accept `workspaceId` or UI `profileId` in mutation bodies. “Profile isolation” here is server endpoint/profile transport isolation; this schema is intentionally not per-authenticated-user.
8. **Workspace display name can stale.** `get_or_create_workspace` returns an old name after config rename. Update name/`updated_at` for the same locator during scope resolution, while locator remains identity.
9. **Existing overview is not the Phase 02 response.** It lacks workspace name, configured empty projects, per-target summaries, links/session notes, stale/attention projections, and session-truncation detection. `ProjectSummary` groups only by project name and can conflate worktrees. `build_node` performs one notes query per item. Add bounded bulk read projections or extend overview queries; service then maps to API DTOs.
10. **Event pagination cannot fetch a lookahead row.** `list_events_keyset` clamps to 100, preventing `limit + 1` at max API limit. Add an internal lookahead-aware page method or permit `MAX_HISTORY_LIMIT + 1`, returning `nextCursor` only when the extra row exists.
11. **DTO redaction cannot rely on serializing Phase 01 models.** `WorkflowEvent` contains raw `worktree_path` and internal `payload_json`; raw overview structs expose numeric timestamps. Build dedicated API DTOs. Paths may appear only as `target: ProjectTargetRef`; omit registry locator, event payload/fingerprint, commands, cwd, environment, terminal output, repository path, and arbitrary adapter data.
12. **Retention orchestration absent.** Existing methods purge one workspace and one batch. Add service loops using batches of 500, each DB call on `spawn_blocking`, with `tokio::task::yield_now()` between batches. Startup/daily cleanup failures log and stop that run; never disable the service or terminal APIs.
13. **Config validation/serialization incomplete.** `ServerConfig` has no workflow fields; `validate_config` only invokes telemetry validation; `server_to_toml` cannot round-trip new values.
14. **Error boundary incomplete.** `WorkflowStoreError` lacks optimistic/request conflict. `AppError`/`ApiError` have no workflow mapping. SQLite/model text must not escape to clients.
15. **Blocking behavior needs one rule.** All `WorkflowStore` calls synchronously lock/use rusqlite. Offload every service DB operation with `spawn_blocking`; do not hold config locks while awaiting it. This is simpler and safer than per-call measurement.

## Safe Phase 02 contracts

### Current scope and target

- `CurrentWorkflowScope { workspace_id, workspace_name, canonical_locator_internal, projects_snapshot }` is service-internal.
- Acquire `workspace_context_guard.read()`, copy `config_path`, workspace name, configured project names/paths, and workflow retention settings from `config.read()`, then release config lock.
- Keep guard until mutation commit/read snapshot finishes. `get_or_create_workspace` runs from canonical UTF-8 locator; non-UTF-8 locator yields `workflow_store_unavailable` only on workflow routes.
- Create/start/rebind/new link: call authoritative target resolver before DB work. Persist only resolver-canonical `worktree_path`. Root persists `None`.
- Historical reads: missing project/worktree stays visible as `available: false`; no rebinding or path probing. Enrichment performs at most one worktree discovery per referenced configured project, never per row.
- A workspace switch may change config fields but does not reopen the startup sessions DB. Phase 02 must preserve this existing terminal behavior.

### Mutation/replay envelope

- Every mutation request uses strict camelCase `#[serde(deny_unknown_fields)]` and a client UUID `requestId`.
- Response: `MutationResponse<T> { resource: T, replayed: bool, eventId: UUID }`.
- Delete resource: typed `WorkflowTombstoneDto { resourceType, id, deletedAt, parentId? }`; never bare boolean.
- Fingerprint input: endpoint operation tag + current workspace UUID + canonical validated request fields + path ID. Exclude server timestamps/IDs. Hash canonical serialized bytes with existing `sha2`; store hash only.
- Replay lookup occurs in the mutation transaction. Same fingerprint returns current row where present; deletes/purge return stored tombstone/count projection. Different fingerprint or operation returns `workflow_conflict`.
- New server resource/event timestamps use server UTC milliseconds. Request timestamps are accepted only as timezone-qualified RFC3339 values exactly representable in milliseconds; normalize response to UTC RFC3339 with milliseconds. Reject naive or sub-millisecond values rather than silently changing the instant.

### Strict request surface

- `POST /api/workflow/items`: `requestId`, `target`, optional `parentId`, `kind`, `title`, optional `summary`, optional `status`, optional `sortOrder`. Server creates resource ID/source/timestamps. No placeholder children.
- `PATCH /api/workflow/items/{id}`: `requestId`, required `updatedAt`, optional `title|summary|status|sortOrder|target`. No `parentId`/`kind` changes in Phase 02.
- `DELETE /api/workflow/items/{id}`: JSON body `requestId`, `updatedAt`; cascade remains Phase 01 behavior; tombstone identifies root deletion.
- `POST /api/workflow/sessions`: `requestId`, `target`, optional `itemId`, required `startedAt`; always manual/running; `endedAt` forbidden.
- `POST /api/workflow/sessions/{id}/end`: `requestId`, required `endedAt`; validate against stored start. `POST .../abandon`: `requestId` only; no end fabricated.
- `POST /api/workflow/sessions/{id}/links`: `requestId`, `resourceType`, `externalId`, optional `incarnation|harnessLabel|runId`. Terminal requires current matching incarnation and forbids harness fields. Agent forbids incarnation; bounded manual harness/run metadata only. Server sets attached/manual/seen timestamps.
- `DELETE /api/workflow/sessions/{id}/links`: JSON body `requestId`, `updatedAt`, `resourceType`, `externalId`; current-workspace session lookup precedes link CAS.
- `POST /api/workflow/notes`: `requestId`, exactly one or both of `itemId|sessionId`, `body`; if both, exact target scope match.
- `DELETE /api/workflow/notes/{id}`: JSON body `requestId`, `updatedAt`; soft delete/tombstone.
- `DELETE /api/workflow/history?before=<RFC3339>`: JSON body with `requestId`; current workspace only, batches events recorded before `before` and notes deleted before `before`. Record one final `workspace_purged` replay event. Partial failure is retryable; no snapshot rows are age-deleted.

### Read DTOs

- `GET /api/workflow/overview`: API-owned `WorkflowOverviewDto` with `workspace { id, name }`, `serverTime`, configured/historical target summaries, Plan trees, standalone Tasks, running sessions, sanitized links/session notes, recent sanitized events, `attentionCounts`, and per-collection truncation metadata.
- Item progress fields: `trackedTaskCount` and `completedTrackedTaskCount` nullable together when no descendant Tasks. Never percentage.
- Stale running session: `serverTime - max(session.updatedAt, each link.lastSeenAt) >= workflow_stale_after_hours`. This changes only DTO attention state; never session status/timestamps or persisted observation.
- `GET /api/workflow/events`: query `cursor`, default `limit=50`, range `1..=100`; URL-safe no-pad base64 JSON cursor containing `(recordedAtMs,id)`. Invalid/non-canonical cursor => typed 400. Return `{ events, nextCursor }`; event DTO excludes internal payload and raw worktree field, using structured target.
- Overview/event mapping always converts milliseconds to RFC3339 and filters event details through a closed API projection.

### Typed errors

| Code | HTTP | Use |
|---|---:|---|
| `workflow_not_found` | 404 | Unknown current-scope item/session/note/project; no cross-workspace existence disclosure |
| `workflow_conflict` | 409 | stale `updatedAt`, request UUID reuse mismatch, already-deleted/terminal lifecycle conflict |
| `workflow_invalid_transition` | 409 | disallowed item/session transition |
| `workflow_target_unavailable` | 409 | configured project known but requested target unregistered, stale, or PTY target/incarnation mismatch |
| `workflow_limit_exceeded` | 400 | semantic field/page/count limit; 32 KiB transport body layer may remain 413 |
| `workflow_store_unavailable` | 503 | absent store, SQLite/poison/spawn failure; sanitized fixed message |

Other invalid syntax/UUID/timestamp/hierarchy input uses 400 with a sanitized validation message and no filesystem value. Add `AppError::Workflow(WorkflowError)` delegating status/code. Do not expose `WorkflowStoreError::Sqlite` text.

## Nine-step implementation checklist

### 1. Typed workflow errors

- [ ] Create `server/src/workflow/error.rs`: `WorkflowError`, fixed public messages, `status_code()`, `api_code()`, conversions from model/store/target errors with transition-vs-validation discrimination.
- [ ] Modify `server/src/workflow/store/error.rs`: add `OptimisticConflict`, `RequestConflict`; avoid string matching.
- [ ] Modify `server/src/error.rs`: add `AppError::Workflow`, delegate status/code.
- [ ] Modify `server/src/api/error.rs`: preserve existing envelope, confirm lowercase workflow codes and sanitized message.
- **Depends on:** none. **Acceptance:** each required code/status maps deterministically; DB/path text absent.

### 2. Workflow config defaults and bounds

- [ ] Modify `server/src/config/schema.rs`: add defaults and fields `workflow_event_retention_days: u32 = 90`, `workflow_deleted_note_retention_days: u32 = 7`, `workflow_stale_after_hours: u32 = 24`; aliases for snake_case TOML; `ServerConfig::validate()` with ranges event `1..=3650` days, deleted note `1..=3650` days, stale `1..=8760` hours; call telemetry validation within it.
- [ ] Modify `server/src/config/parser.rs`: call `raw.server.validate()` and round-trip all three keys in `server_to_toml`.
- [ ] Modify `server/src/config/tests.rs`: absent/default, snake/camel aliases, boundaries, zero/overflow rejection, write/read round-trip; update explicit `ServerConfig` literals.
- **Depends on:** step 1 only for error mapping. **Acceptance:** invalid config fails before startup; defaults unchanged for existing files.

### 3. Optional service construction; non-fatal unavailable store

- [ ] Create `server/src/workflow/service/mod.rs`: cloneable `WorkflowService` holding `WorkflowStore`, config lock, target resolver, workspace guard, and PTY manager; central `run_store`/`spawn_blocking` adapter.
- [ ] Modify `server/src/workflow/mod.rs`: export `error` and `service`.
- [ ] Modify `server/src/state.rs`: add `pub workflow: Option<Arc<WorkflowService>>` and builder `AppState::with_workflow_store(Option<WorkflowStore>)`. Keep `AppState::new` signature stable to avoid touching unrelated test factories.
- [ ] Modify `server/src/main.rs`: derive `WorkflowStore` from `session_store.as_ref().map(|s| WorkflowStore::new(s.connection()))`; attach to state. Store `None` remains normal server startup with only workflow returning 503.
- **Depends on:** steps 1–2. **Acceptance:** existing PTY/router startup remains available when DB open fails; no second connection.

### 4. Current-scope and authoritative target validation

- [ ] Create `server/src/workflow/service/scope.rs`: `CurrentWorkflowScope`, guard/snapshot resolution, get-or-create workspace, configured project lookup, fresh `ProjectTargetRef` resolution, canonical target conversion, historical target enrichment.
- [ ] Modify `server/src/workflow/store/workspace.rs` and `store/mod.rs`: update workspace display name for existing locator; add any scoped lookup needed by replay.
- [ ] Modify `server/src/workflow/store/item.rs`, `session.rs`, `note.rs`: exact worktree-scope checks; safe rebind neighbor checks; dual-target note checks.
- [ ] Service terminal-link validation uses `PtySessionManager::list()` ID/incarnation/project/worktree comparison before DB mutation.
- **Depends on:** step 3. **Acceptance:** guard covers validation through commit; cross-workspace IDs do not disclose/write; historical reads survive unavailable targets.

### 5. Strict API DTO and redaction boundary

- [ ] Create `server/src/api/workflow/dto.rs`: strict request structs, mutation envelope/tombstones, overview/event/resource DTOs; source/server fields not deserializable.
- [ ] Create `server/src/api/workflow/mapping.rs`: UUID/RFC3339 conversion, canonical target projection, sanitized event mapping, stale/attention calculation, no raw model serialization.
- [ ] Create `server/src/api/workflow/mod.rs`: handler module exports/shared helpers.
- [ ] Modify `server/src/api/mod.rs`: `pub mod workflow`.
- [ ] Modify `server/src/workflow/store/{item,session,note,event,overview,mod}.rs`: add scoped getters/bulk reads/CAS/replay primitives described in findings. Fix abandon semantics.
- **Depends on:** steps 1, 4. **Acceptance:** unknown fields/path-bearing alternatives rejected; all output timestamps RFC3339; locator/internal event payload never serialized.

### 6. Overview and event reads

- [ ] Create `server/src/api/workflow/cursor.rs`: canonical URL-safe keyset encode/decode and validation.
- [ ] Create `server/src/api/workflow/read.rs`: `overview` and `events` handlers.
- [ ] Modify `server/src/workflow/store/overview.rs`: bounded composite project/target aggregation, bulk notes/links/session-note reads, `max + 1` truncation probes including sessions; retain Plan-first/standalone layout.
- [ ] Modify `server/src/workflow/store/event.rs`: exact request-event getter and API pagination lookahead without exposing payload.
- [ ] Service enriches only configured/referenced targets, at most once per project.
- **Depends on:** step 5. **Acceptance:** one bounded overview call, factual nullable progress, correct next cursor, explicit truncation, no per-row Git invocation.

### 7. Mutations, replay, and optimistic concurrency

- [ ] Create `server/src/workflow/service/replay.rs`: canonical fingerprint, existing-request classification, sanitized replay projection parsing.
- [ ] Create handlers `server/src/api/workflow/{item.rs,session.rs,note.rs}` for item/session/link/note routes.
- [ ] Modify store mutation signatures and `_tx` helpers: request check first; CAS expected timestamp where required; event/snapshot commit atomically; monotonic `updated_at`; typed tombstones; same request/different operation conflict.
- [ ] Generate server resource UUIDs only after replay classification; use request UUID as event ID. Set event `expires_at` from current event-retention config.
- [ ] End requires supplied end; abandon preserves no end. Manual inputs always `WorkflowSource::Manual`.
- **Depends on:** steps 4–6. **Acceptance:** identical retry has no second transition/event; stale token writes nothing; request-ID mismatch conflicts; direct Plan/standalone/target-only contracts work.

### 8. Explicit and scheduled bounded purge

- [ ] Create `server/src/workflow/service/retention.rs`: batch-500 current-scope event/deleted-note purge loops; yield between calls; startup/daily scheduling; errors logged and local.
- [ ] Create `server/src/api/workflow/purge.rs`: explicit current-workspace history purge, replay-safe result/tombstone.
- [ ] Modify `server/src/workflow/store/event.rs`/`store/mod.rs`: bounded explicit-before variants and replay event support; snapshots never age-purged.
- [ ] Modify `server/src/main.rs`: run one non-blocking startup purge and a 24-hour task only when service exists. Each run snapshots the then-current workspace config so retention is not applied across workspaces with another workspace's settings.
- **Depends on:** step 7. **Acceptance:** each transaction deletes at most 500; PTY unaffected by absent/locked DB; daily task survives individual run failure.

### 9. Protected router and integration verification

- [ ] Modify `server/src/api/router.rs`: merge all `/api/workflow/*` routes into `protected`; apply `RequestBodyLimitLayer::new(32 * 1024)` to the workflow subrouter before auth merge; no public/WS routes.
- [ ] Create `server/tests/workflow_api.rs`: real Axum router + tempfile config/SQLite; no mocks for persistence/target ownership.
- [ ] Add focused store unit cases in `server/src/workflow/tests.rs` only for new atomic store contracts (CAS, replay mismatch, target scope, abandon, pagination lookahead).
- **Depends on:** steps 1–8. **Acceptance:** focused workflow store/API tests pass; no project-wide suite required during implementation handoff.

## File and symbol ownership

| Path | Action | Symbols/ownership |
|---|---|---|
| `server/src/workflow/error.rs` | create | `WorkflowError`, status/code mapping |
| `server/src/workflow/service/{mod.rs,scope.rs,replay.rs,retention.rs}` | create | orchestration, scope/target validation, blocking adapter, replay, purge |
| `server/src/workflow/mod.rs` | modify | module exports |
| `server/src/workflow/store/mod.rs` | modify | public scoped/CAS/replay/bulk method signatures |
| `server/src/workflow/store/error.rs` | modify | optimistic/request conflict variants |
| `server/src/workflow/store/workspace.rs` | modify | rename refresh/current locator identity |
| `server/src/workflow/store/item.rs` | modify | CAS, replay, exact target hierarchy/rebind |
| `server/src/workflow/store/session.rs` | modify | CAS/replay, exact target, no fabricated abandon end, scoped link mutation |
| `server/src/workflow/store/note.rs` | modify | public scoped getter, CAS/replay, dual-target validation |
| `server/src/workflow/store/event.rs` | modify | exact event lookup, lookahead page, explicit purge |
| `server/src/workflow/store/overview.rs` | modify | bounded bulk/composite target overview and truncation |
| `server/src/state.rs` | modify | optional workflow service + stable-signature builder |
| `server/src/main.rs` | modify | shared-store service wiring and purge scheduler |
| `server/src/config/{schema.rs,parser.rs,tests.rs}` | modify | defaults, validation, TOML round-trip/tests |
| `server/src/error.rs`, `server/src/api/error.rs` | modify | sanitized workflow error integration |
| `server/src/api/workflow/{mod.rs,dto.rs,mapping.rs,cursor.rs,read.rs,item.rs,session.rs,note.rs,purge.rs}` | create | strict transport surface split by concern |
| `server/src/api/mod.rs`, `server/src/api/router.rs` | modify | export/protected routes/body limit |
| `server/src/workflow/tests.rs` | modify | focused new store invariants |
| `server/tests/workflow_api.rs` | create | protected REST/current-scope integration matrix |

No migration file planned. Migration 010 event payload is sufficient for the bounded replay ledger; adding a new table/column is unnecessary for Phase 02.

## Test matrix

| Area | Cases | Expected proof |
|---|---|---|
| Auth/router | no cookie rejected; valid cookie/no-auth accepted; `/api/workflow/*` absent from public router/WS; 32 KiB cap | Existing terminal endpoints still respond independently |
| Store unavailable | state built without store; SQLite busy/error path | Workflow 503/code only; health/PTY route operational |
| Workspace/profile | workspace A ID cannot read/mutate under B; switch race during target validation; no `workspaceId/profileId` accepted | 404/non-disclosing, zero writes; transport/server profile remains natural isolation |
| Item hierarchy | Plan-only; Phase→Plan; Task standalone/Plan/Phase; illegal combinations; no placeholder; exact worktree mismatch; rebind neighbor mismatch | Typed validation/conflict; factual tree |
| Overview | configured empty project; unavailable historical target; direct Plan note/session; session note/link; standalone Task; 0 Tasks => null counts; direct+nested factual counts; project/worktree separation; item/project/session truncation | One sanitized bounded DTO |
| Timestamps | offset RFC3339 round-trip normalized UTC; naive/sub-ms invalid; end before start; **Now** same path; abandon leaves end null | Manual instant preserved to DB precision |
| Lifecycle/CAS | legal item transitions; invalid item/session transitions; stale item/note/link delete/update; same-ms consecutive updates | Correct code, no event/write; tokens strictly advance |
| Replay | each POST/PATCH/DELETE/end/abandon/purge identical retry; same request with changed body/path/workspace; create retry after server-generated ID; delete retry after row gone | One mutation/event; `replayed=true`; mismatches 409 |
| Target/link | unknown project; relative/arbitrary/unregistered/missing worktree; historical unavailable read; terminal wrong ID/incarnation/project/worktree; agent bounds/conditional fields | Fresh target rejection; no path leak/write |
| Limits/redaction | title/note/external/harness/run/page/body boundaries; registry locator, raw event payload/fingerprint, repo path, command/cwd/env/output sentinel scan | Required typed limit errors; forbidden strings absent |
| Pagination | empty, one page, duplicate recorded time tie-break, max 100 lookahead, malformed/noncanonical cursor, workspace cursor reuse | Stable no-duplicate pages; typed 400 |
| Retention | expiry exactly at cutoff; deleted-note grace; >500 rows; yield/batch continuation; startup/daily failure; explicit before; snapshot survival | ≤500 per transaction; correct totals; items/sessions remain |
| Terminal isolation | DB absent/locked while create/list/input-equivalent terminal API path exercised | Existing terminal behavior unaffected |

## Ordered delivery dependencies

1. Store error/CAS/replay/target invariants and config contract.
2. Optional service wiring and current-scope guard.
3. Strict DTO/mapping/cursor boundary.
4. Reads, then mutations, then retention.
5. Protected router mount.
6. Focused store tests and API integration matrix.

Do not start Phase 03 lifecycle ingestion, Phase 04 client/query types, UI work, WebSocket events, offline queue, search, analytics, or automatic harness producers.

## Blockers / ambiguities

- **No implementation blocker.** Required primitives and dependencies exist.
- Phase 02 prose does not specify maximum config bounds; this plan fixes conservative explicit ranges above.
- Phase 02 does not define stale activity precisely; this plan uses latest session update/resource observation and keeps staleness DTO-only.
- Phase 02 says all mutations need `requestId` but does not define DELETE transport; this plan consistently uses strict JSON bodies for DELETE mutation metadata.
- Request replay and 90-day event retention imply a 90-day replay window. Explicit history purge shortens it intentionally.
- Retention config is workspace config while one startup DB may contain multiple workspace rows. This plan purges only the current scope per run to prevent one workspace’s settings deleting another’s history; inactive workspace cleanup resumes when it becomes current.

## Unresolved Questions

None.
