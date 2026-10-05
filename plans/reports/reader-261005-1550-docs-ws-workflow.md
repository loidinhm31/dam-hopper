# Documentation Reader Report: WebSocket Protocol & Workflow System

**Date:** 2026-10-05  
**Target Documents:**
- `docs/ws-protocol-guide.md`
- `docs/workflow-api.md`
- `docs/workflow-context-surface.md`
- `docs/workflow-client-state.md`

---

## 1. Executive Summary

A comprehensive audit was performed across the four target documents and cross-referenced with the current codebase implementation (`server/src/api/ws_protocol.rs`, `server/src/api/ws.rs`, `server/src/api/workflow/`, `server/src/workflow/`, `packages/ui/src/api/workflow-*`, `packages/ui/src/components/organisms/WorkflowContextSurface*`, and recent Git commits `df885ad`, `9040f6c`, `a44703d`).

While core architectural boundaries (Plan-first hierarchy, CAS timestamps, SQLite transactions, PTY observation isolation) remain rock solid, several synchronization gaps exist between the documentation and the live codebase. Primarily, the WebSocket guide omits subsequent additions (raw FS upload protocol, FS mutating ops `fs:op`, tunnel/port push events, and `worktree_path` qualifiers), and the workflow client state/surface documentation predates the multi-profile ownership and reactive query invalidation refactors (`df885ad` / `a44703d`).

---

## 2. Document Analysis

### 2.1 `docs/ws-protocol-guide.md`

#### Purpose
Authoritative protocol reference for real-time bidirectional WebSocket message envelopes (`kind`-tagged JSON) across terminal I/O, file watching, file transfers, zero-knowledge OPAQUE PAKE authentication, process lifecycle, and agent status streaming.

#### Key Sections & Protocol Contracts
1. **Message Envelope:**
   - JSON format tagged with `kind` (`{ "kind": "<namespace>:<action>", ...payload }`).
   - Bidirectional transport on `/ws`.
   - Retired plugin epoch platform notice (socket epochs and plugin context leases retired).
2. **Project Target Context:**
   - REST channel `POST /api/terminal` creates terminals; `ProjectTargetRef` accepts optional `worktreePath` validated against registered Git snapshots.
3. **Client → Server Contracts:**
   - **Terminal:** `terminal:write` (`id`, `data`), `terminal:resize` (`id`, `cols`, `rows`), `terminal:attach` (`id`, `from_offset?`), `terminal:spawn` (legacy), `terminal:kill`.
   - **Attach & Buffer Reconnection:** Delta replay or full reset using `incarnation`, `offset`, `reset`, `truncated`. Exponential backoff and check `terminal:listDetailed`.
   - **FS Subscriptions:** `fs:subscribe_tree` (`req_id`, `project`, `path`), `fs:unsubscribe_tree` (`sub_id`).
   - **FS Read:** `fs:read` (`req_id`, `project`, `path`, `offset?`, `len?`).
   - **FS Write:** Three-phase streaming (`fs:write_begin` with `expected_mtime` OCC guard, `fs:write_chunk` base64 or `fs:write_chunk_binary`, `fs:write_commit`).
   - **OPAQUE Auth:** `auth:register_start`, `auth:register_finish`, `auth:login_start`, `auth:login_finish`.
   - **Encrypted Put:** `fs:put_begin`, `fs:put_chunk`, `fs:put_commit`, `fs:put_save`.
4. **Server → Client Contracts:**
   - **Terminal Output & Buffering:** `terminal:output` (`id`, `data`, `offset`, `incarnation`), `terminal:buffer`, `terminal:lagged` (`dropped`).
   - **Terminal Events:** `terminal:lifecycle` (OSC 633 shell markers), `terminal:exit` (enhanced with restart metadata), `process:restarted`, `terminal:target-unavailable`, `fs:overflow`.
   - **Agent Status Streaming:** `terminal:agentStatusChanged` (`serverEpoch`, `revision`, `row`, `attention?`), `terminal:agentStatusRemoved`, `terminal:agentStatusInvalidated` (prompts `GET /api/agent-status/v1/snapshot`).
   - **FS Results:** `fs:tree_snapshot`, `fs:event`, `fs:read_result`, `fs:write_ack`, `fs:write_chunk_ack`, `fs:write_result`, `fs:error`.
5. **Connection Lifecycle:**
   - V2 session policy, auth deadline verification, watcher close codes (`4403`, `4401`, `1013`, `4001`).

#### Areas Needing Update / Codebase Synchronization
- **Missing FS Mutating Operations (`fs:op`):** `server/src/api/ws_protocol.rs` implements `ClientMsg::FsOp` (`create_file`, `create_dir`, `rename`, `delete`, `move`) and outbound `ServerMsg::FsOpResult`. The doc does not list `fs:op` or `fs:op_result`.
- **Missing Plain Upload Protocol:** In addition to encrypted `fs:put_*`, the server implements unencrypted binary upload: `fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit`, with outbound `fs:upload_begin_ok`, `fs:upload_chunk_ack`, `fs:upload_result`. Omitted in doc.
- **Missing `worktree_path` Fields in Inbound FS Messages:** `FsSubTree`, `FsRead`, `FsWriteBegin`, `FsOp`, `FsUploadBegin`, `FsPutBegin`, and `FsPutSave` all support an optional `worktree_path` field for target-scoped operations; doc only specifies `project` and `path`.
- **Missing Push Event Kinds:**
  - **Tunnels:** Outbound `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`.
  - **Port Forwarding:** Outbound `port:discovered`, `port:lost`.
  - **Host Alert Broadcast Lag:** Outbound `host:alertsInvalidated` (`payload: { reason: "lagged" }`).
- **Missing Session Removal:** Inbound `auth:session_remove { session_id }` for client AES key cache eviction.

---

### 2.2 `docs/workflow-api.md`

#### Purpose
Authoritative contract and operational specification for the server-side workflow tracking engine and protected REST endpoints under `/api/workflow/*`, covering SQLite persistence (`sessions.db`), CAS optimistic concurrency, bounded diagnostics, terminal lifecycle observation, and automated retention purging.

#### Key Sections & Protocol Contracts
1. **Scope and Authorization:**
   - Scoped to active profile's workspace; 32 KiB request-body cap; camelCase JSON; UUID IDs; RFC3339 ms timestamps; `ProjectTargetRef` (`project`, optional `worktreePath`).
2. **Persistence & Observation Architecture:**
   - Single DB (`sessions.db` with migration `010_workflow_tracking.sql`).
   - `WorkflowStore` calls executed via `tokio::task::spawn_blocking`.
   - PTY lifecycle observer sends allowlisted metadata over bounded `sync_channel(256)` (no PTY commands, cwd, env, or output captured).
   - Startup reconciliation maps restored PTYs against persisted links (`attached`, `stale`, `exited`, `crashed`, `detached`).
3. **Endpoints & REST Contracts:**
   - `GET /api/workflow/overview`: Context snapshot (projects, plans, standaloneTasks, runningSessions, recentEvents, truncated flag).
   - `GET /api/workflow/events`: Keyset pagination using `(recordedAt DESC, id DESC)` and base64 cursor (`limit` default 50, max 100).
   - **Items:** `POST /api/workflow/items` (Plan-first hierarchy: Plan -> Phase -> Task); `PATCH /api/workflow/items/{id}` (CAS with `updatedAt`); `DELETE /api/workflow/items/{id}` (CAS delete with tombstone and descendant cascade).
   - **Sessions:** `POST /api/workflow/sessions` (`startedAt` preserved); `POST /api/workflow/sessions/{id}/end` (`endedAt` validation); `POST /api/workflow/sessions/{id}/abandon`.
   - **Resource Links:** `POST /api/workflow/sessions/{id}/links` (terminal PTY or agent harness); `DELETE /api/workflow/sessions/{id}/links` (CAS unlink).
   - **Notes:** `POST /api/workflow/notes` (targets item, session, or both; max 8 KiB body); `DELETE /api/workflow/notes/{id}` (soft-delete with tombstone).
   - **History Purge:** `DELETE /api/workflow/history?before=...` (RFC3339 cutoff; batches of 500).
4. **Diagnostics:**
   - Fixed-cardinality metrics in `DiagnosticStore` (`workflow_operation_duration_seconds`, `workflow_queue_dropped_total`, `workflow_reconciliation_total`, `workflow_storage_errors_total`).
5. **Errors & Concurrency:**
   - Mutation envelope `{ resource, replayed, eventId }`.
   - Replay idempotency via caller `requestId`.
   - Stale CAS returns `409 workflow_conflict`. Invalid state transition returns `409 workflow_invalid_transition`. Store down returns `503 workflow_store_unavailable`.

#### Areas Needing Update / Codebase Synchronization
- **Wire Target Sanitization Context:** The doc specifies that request DTOs reject unknown fields (`deny_unknown_fields`). In recent frontend updates (`packages/ui/src/api/ownership.ts`), client `ProjectTargetRef` was extended with `profileId`. Client transports must strip `profileId` before sending to `/api/workflow/*` endpoints. Documenting this contract clarifies wire target boundaries.
- **Event Retention Setting Wiring:** The doc accurately states that `server.workflow_event_retention_days` is not yet wired to event creation constructors (hardcoded `DEFAULT_EVENT_RETENTION_DAYS = 90`), while soft-deleted notes obey `workflow_deleted_note_retention_days`. This remains valid but should be noted as an intentional deferred backlog item.
- **Phase Test Counts:** References historical test counts (907 Rust tests); current server test suite has expanded beyond this mark.

---

### 2.3 `docs/workflow-context-surface.md`

#### Purpose
Component and interaction design guide for the responsive Plan-first workflow UI (`WorkflowContextSurface`) in `@dam-hopper/ui`, documenting ambient ribbons, desktop decks, mobile sheets, keyboard navigation, focus restoration, and shell integration.

#### Key Sections & UI Contracts
1. **Surface Flow & Layout:**
   - Component chain: `WorkflowContextSurface` -> Deck / Sheet -> `WorkflowItemList` -> `WorkflowSelectedItemBar` -> `useWorkflowSurfaceActions` -> REST API.
   - Ambient ribbon: `WorkflowContextRibbon` (`h-9` companion row).
   - Desktop Deck: non-modal region (`min-h-[320px]`, `h-[360px]`, `max-h-[440px]`), 2-column on `md`, 3-column on `lg`.
   - Mobile Sheet: Radix bottom sheet (`35dvh` collapsed, `90dvh` expanded) with segmented controls (`projects`, `items`, `execution`).
2. **Selected-Item Notes & Editing:**
   - Notes rendered in order with timestamp; direct Delete button triggers CAS soft-delete via `onDeleteNote(note)`. 100px max height scrolling container. Notes are append-only.
   - Inline edit form (`WorkflowSelectedItemEditForm`) triggered by Pencil icon; trims title/summary, sends empty summary as `null`, validates non-blank title, saves with CAS `updatedAt`.
3. **Shell Integration & Navigation:**
   - `WorkspacePage` creates memoized `workflowToolbarActions` and provides it to `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell`.
   - Navigation via `workflow-workspace-integration.ts` (`resolveWorkflowTerminalReveal`, `resolveWorkflowTargetSelection`, `deriveWorkflowTerminalCandidates`). Keyed by `activeProfileId`.
4. **Keyboard & Focus Safety:**
   - Toggle shortcut `Mod+Shift+KeyW`. Focus guard suppresses shortcut when focused on inputs, textareas, Monaco, or xterm surfaces.

#### Areas Needing Update / Codebase Synchronization
- **Hook Call Signature Discrepancy:**
  - Doc states: "`useWorkflowOverview(effectiveTarget) supplies the current workspace view.`"
  - Code (`packages/ui/src/api/workflow-queries.ts` and `WorkflowContextSurface.tsx`): `useWorkflowOverview` does **not** take `effectiveTarget`. It accepts `options?: { owner?: ConnectionRef; profileId?: ProfileId; enabled?: boolean }`.
  - In commit `a44703d`, `WorkflowContextSurface` was updated to pass:
    ```ts
    const overviewOptions = effectiveTarget.profileId
      ? { profileId: effectiveTarget.profileId }
      : undefined;
    const { ... } = useWorkflowOverview(overviewOptions);
    ```
    The target is then passed separately to pure selectors: `filterOverviewByTarget(overviewForSurface, effectiveTarget)`.
- **Multi-Profile Ownership Integration:** Doc should detail how profile switches and `profileId` propagation in `effectiveTarget` drive query isolation and avoid cross-profile state leakage.

---

### 2.4 `docs/workflow-client-state.md`

#### Purpose
Architectural specification for the `@dam-hopper/ui` client data tier for workflows, detailing TypeScript DTO definitions, domain validation helpers, `WsTransport` REST channel mapping, and TanStack Query cache management.

#### Key Sections & Client Contracts
1. **Module Hierarchy:**
   - `workflow-dto-types.ts`: typed DTOs and closed unions.
   - `workflow-domain-helpers.ts`: pure domain logic (hierarchy validation, status classification, elapsed duration, ordering).
   - `client.ts`: typed `api.workflow` facade.
   - `ws-transport.ts`: maps 13 `workflow:*` channels to Axum REST routes.
   - `workflow-queries.ts`: TanStack Query hooks, query keys, request ID generation, and cache invalidation.
2. **DTO & Closed Unions:**
   - `ItemKind` (`plan | phase | task`), `ItemStatus`, `SessionStatus`, `ResourceLinkType`, `ResourceObservedState`, `WorkflowSource`, `WorkflowEventType`.
   - Closed DTO models: `TargetDto`, `ItemDto`, `SessionDto`, `NoteDto`, `LinkDto`, `EventDto`, `OverviewDto`, `MutationDto<T>`, `TombstoneDto`.
3. **Transport Channel Mapping:**
   - 13 mapped channels: `workflow:overview`, `workflow:events`, `workflow:createItem`, `workflow:patchItem`, `workflow:deleteItem`, `workflow:createSession`, `workflow:endSession`, `workflow:abandonSession`, `workflow:linkResource`, `workflow:unlinkResource`, `workflow:createNote`, `workflow:deleteNote`, `workflow:purgeHistory`.
4. **Cache & Invalidation Contract:**
   - Query keys: `['profile', profileId, generation, 'workflow', ...]` for owner-scoped callers, `['workflow']` for compatibility root.
   - Zero stale time; focus/reconnect refetches; no automatic polling interval; feature 404 disables retries (`availability: "unavailable"`).

#### Areas Needing Update / Codebase Synchronization
- **Profile-Scoped Invalidation Enhancement (`a44703d`):**
  - Live code in `workflow-queries.ts` now features:
    ```ts
    export function invalidateWorkflowQueries(
      queryClient: QueryClient,
      ownerOrOptions?: ConnectionRef | { owner?: ConnectionRef; profileId?: ProfileId },
    ): Promise<void>
    ```
  - When `profileId` is supplied, `invalidateWorkflowQueries` invalidates `profileQueryPrefix(profileId)` in addition to `workflowQueryKeys.all` and `profileQueryKey(owner, "workflow")`. This fixes reactive query refresh across multi-window/multi-connection sessions.
- **`resolveWorkflowOwner` Helper:**
  - Code introduced `resolveWorkflowOwner(options?: { owner?: ConnectionRef; profileId?: ProfileId })` which queries `getConnectionSnapshot(options.profileId)` when only `profileId` is known. The doc only mentions explicit `ConnectionRef` passing.
- **Wire Target Sanitization (`restTargetFields`):**
  - In `ws-transport.ts`, `workflow:createItem`, `workflow:patchItem`, and `workflow:createSession` strip `profileId` from `target` using `restTargetFields` to comply with server DTOs that enforce `deny_unknown_fields`. This boundary detail is currently omitted.

---

## 3. Cross-Cutting Gap Analysis Matrix

| Domain / Contract | Document | Code Implementation | Status / Recommended Fix |
|---|---|---|---|
| **FS Mutating Ops** | `docs/ws-protocol-guide.md` | `ClientMsg::FsOp`, `ServerMsg::FsOpResult` in `server/src/api/ws_protocol.rs` | **Missing in docs.** Add `fs:op` protocol section and parameters. |
| **Raw Binary Uploads** | `docs/ws-protocol-guide.md` | `fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit` in `ws_protocol.rs` | **Missing in docs.** Add table and explanation for unencrypted uploads. |
| **Push Notifications** | `docs/ws-protocol-guide.md` | `tunnel:*`, `port:*`, `host:alertsInvalidated` in `ws.rs` & `ws_protocol.rs` | **Missing in docs.** Document tunnel and port discovery WS pushes. |
| **Worktree Scoping on WS** | `docs/ws-protocol-guide.md` | `worktree_path` present on all inbound FS messages | **Incomplete in docs.** Update FS request tables with optional `worktree_path`. |
| **`useWorkflowOverview` API** | `docs/workflow-context-surface.md` | Takes `options?: { owner?, profileId?, enabled? }`, not `effectiveTarget` | **Inaccurate in docs.** Update to show `overviewOptions` and selector separation. |
| **Cache Invalidation** | `docs/workflow-client-state.md` | `invalidateWorkflowQueries` accepts `{ profileId }` and invalidates profile prefix | **Outdated in docs.** Document reactive profile prefix invalidation (`a44703d`). |
| **Wire Target Sanitization** | `docs/workflow-api.md`, `docs/workflow-client-state.md` | `restTargetFields` strips `profileId` before dispatch | **Omitted in docs.** Clarify why `profileId` is stripped before REST transmission. |

---

## 4. Unresolved Questions

1. Should `tunnel:*` and `port:*` push notifications remain directly on the main `/ws` connection, or are they planned for segregation under dedicated SSE or sub-protocols in future releases?
2. Is there a timeline to wire `server.workflow_event_retention_days` dynamically into `WorkflowStore` event constructors, or will 90-day retention remain fixed for the lifecycle of Phase 03/04?
