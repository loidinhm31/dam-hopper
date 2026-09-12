# Workflow Client Types, Transport, and Query State

**Status:** Phase 04 complete (2026-09-02)

This document describes the shared `@dam-hopper/ui` client foundation for the
workflow REST API. The server contract, authorization rules, persistence model,
and response examples remain in [Workflow API](./workflow-api.md). Phase 04
adds typed client boundaries and query state; it does not add workflow UI,
terminal navigation, or a browser-persisted workflow store.
The responsive presentation and selected-item note/edit controls are documented
in [Workflow Context Surface](./workflow-context-surface.md); this document
keeps the Phase 04 transport/query contract authoritative.

## Module map

| Module | Responsibility |
| --- | --- |
| `packages/ui/src/api/workflow-dto-types.ts` | Wire DTOs, request payloads, and closed string unions. |
| `packages/ui/src/api/workflow-domain-helpers.ts` | Pure hierarchy, status, progress, timestamp, duration, and ordering helpers. |
| `packages/ui/src/api/workflow-types.ts` | Barrel export for DTOs and domain helpers. |
| `packages/ui/src/api/client.ts` | Transport-agnostic `api.workflow` facade and shared target/error types. |
| `packages/ui/src/api/ws-transport.ts` | Channel-to-REST method, path, query, and body mapping used by browser/native clients. |
| `packages/ui/src/api/workflow-queries.ts` | Workflow query keys, overview/events hooks, request IDs, and mutation wrappers. |
| `packages/ui/src/api/queries.ts` | Existing shared hooks for non-workflow surfaces and re-export of workflow hooks from the focused module. |
| `packages/ui/src/api/query-client.ts` | Profile-aware TanStack Query key hashing used by both hosts. |

The focused modules keep `client.ts`, the general query hook module, and the
transport interface from accumulating workflow-specific logic.

## DTO and union contract

`workflow-dto-types.ts` mirrors the server's camelCase JSON boundary with
explicit TypeScript interfaces. The client contract is compile-time strict:
unknown fields are not part of the declared shapes, and domain discriminants
are closed unions rather than arbitrary strings. Runtime request validation and
unknown-field rejection remain server responsibilities; `WsTransport.invoke<T>`
decodes a successful JSON response into the requested TypeScript type.

Closed unions are used for the fields that drive UI/domain branching:

- `ItemKind`: `plan | phase | task`.
- `ItemStatus`: `backlog | next | in_progress | blocked | done | canceled`.
- `SessionStatus`: `running | ended | abandoned`.
- `ResourceLinkType`: `terminal | agent`.
- `ResourceObservedState`: `attached | exited | stale | detached | crashed | unknown`.
- `WorkflowSource`: `manual | terminal | git | agent | system`.
- `WorkflowEventType`: the closed item/session/resource/note/workspace activity set.

The primary response shapes are `TargetDto`, `ItemDto`, `SessionDto`, `NoteDto`,
`LinkDto`, `EventDto`, `ProjectDto`, `ItemOverviewNodeDto`, `OverviewDto`,
`EventsDto`, `PurgeDto`, `MutationDto<T>`, and `TombstoneDto`. Optional fields
preserve server distinctions: a missing or `null` `worktreePath`, `parentId`,
`itemId`, `endedAt`, `completedAt`, `deletedAt`, or `suggestedEndTime` is not
silently replaced by a client default.

Requests carry the same explicit target model as the server. `ProjectTargetRef`
contains `project` and an optional registered `worktreePath`; omitting the path
selects the configured project root. Mutation requests include a caller-owned
UUID `requestId`; CAS mutations additionally carry `updatedAt`. The event query
accepts an opaque `cursor` and bounded `limit`.

Mutation responses use `MutationDto<T>` (`resource`, `replayed`, `eventId`),
while deletes return a typed `TombstoneDto`. A replay response is data from the
server's idempotent request handling, not a reason to generate a new request ID.

## Domain helpers

`workflow-domain-helpers.ts` contains no React, transport, or persistence code.
It provides the shared semantics used by Phase 05 components:

- `allowedChildKinds(null)` returns `plan` and `task`; a `plan` allows `phase`
  and `task`; a `phase` allows `task`; a `task` has no children.
- `isValidParentKind` applies the Plan-first hierarchy without duplicating
  parent checks in each component.
- `isOpenItemStatus`, `isCompletedItemStatus`, and `isOpenSessionStatus` keep
  state labels consistent (`done` is the completed item state and `running` is
  the only open session state).
- `isResourceStateAttentionRequired` flags `stale`, `exited`, `crashed`, and
  `detached`; `unknown` is not silently treated as an incident.
- `formatTrackedTasksProgress` returns `null` when no tracked Tasks exist;
  otherwise it returns a factual `x/y tracked tasks done` label. It never
  computes a percentage or claims that all Plan work is tracked.
- `getIsoNow`, `isValidIsoTimestamp`, and `validateSessionInterval` support
  explicit manual timestamps and reject an `endedAt` earlier than `startedAt`.
- `formatElapsedDuration` derives a local display duration without changing the
  cached session timestamps. `compareWorkflowItems` orders by `sortOrder`, then
  `createdAt` for deterministic rendering.

Observed terminal times and `suggestedEndTime` remain separate from manual
session drafts. A component must apply a suggestion explicitly; helpers do not
rewrite authoritative cached data.

## Transport channel mapping

`api.workflow` calls `getTransport().invoke(...)`; it does not know whether the
active transport uses browser fetch, a native host, or an idle setup transport.
`WsTransport.channelToEndpoint` maps the following 13 operation names to the
protected REST API:

| Channel | HTTP request |
| --- | --- |
| `workflow:overview` | `GET /api/workflow/overview` |
| `workflow:events` | `GET /api/workflow/events`, with optional URL-encoded `cursor` and `limit` query parameters |
| `workflow:createItem` | `POST /api/workflow/items`, body unchanged |
| `workflow:patchItem` | `PATCH /api/workflow/items/{id}`, URL-encoded `id`; `id` removed from JSON body |
| `workflow:deleteItem` | `DELETE /api/workflow/items/{id}`, URL-encoded `id`; `id` removed from JSON body |
| `workflow:createSession` | `POST /api/workflow/sessions`, body unchanged |
| `workflow:endSession` | `POST /api/workflow/sessions/{id}/end`, URL-encoded `id`; body excludes `id` |
| `workflow:abandonSession` | `POST /api/workflow/sessions/{id}/abandon`, URL-encoded `id`; body excludes `id` |
| `workflow:linkResource` | `POST /api/workflow/sessions/{sessionId}/links`, URL-encoded `sessionId`; body excludes `sessionId` |
| `workflow:unlinkResource` | `DELETE /api/workflow/sessions/{sessionId}/links`, URL-encoded `sessionId`; body excludes `sessionId` |
| `workflow:createNote` | `POST /api/workflow/notes`, body unchanged |
| `workflow:deleteNote` | `DELETE /api/workflow/notes/{id}`, URL-encoded `id`; body excludes `id` |
| `workflow:purgeHistory` | `DELETE /api/workflow/history`, body unchanged |

`invoke` joins relative paths to the profile's base URL, adds the profile-bound
Bearer header when available, sends cookies with `credentials: include`, and
JSON-serializes request bodies. Non-2xx responses become `ApiRequestError`
instances with status and optional server error code. The persistent WebSocket
in the same class remains the terminal/event channel; workflow operations are
REST calls even when the class is named `WsTransport`.

## Profile and transport-safe query state

Both `apps/web` and `apps/native` configure their `QueryClient` with
`profileScopedQueryKeyHash` from `query-client.ts`. The hash is the JSON
serialization of `[activeProfileId, queryKey]` (or `no-active-profile`), so
identical workflow keys for two server profiles occupy different cache entries.
Workflow data is not persisted to localStorage or another browser store.

The transport singleton increments a monotonic generation whenever
`initTransport`, `reconfigureTransport`, or `resetTransport` replaces its
instance. `useWorkflowOverview` subscribes with `useSyncExternalStore` and puts
the current generation in its key:

```text
['workflow', 'overview', transportGeneration]
```

This makes a profile/workspace transport replacement produce a fresh overview
key. Destroying the old `WsTransport` closes its WebSocket and rejects pending
requests; an old response can only settle the old query entry, never the new
generation key. `useWorkflowEvents` uses a cursor/limit key under the same root:

```text
['workflow', 'events', { cursor: cursor ?? null, limit: limit ?? null }]
```

Overview and events are enabled by default (or explicitly disabled), use zero
stale time, preserve their prior observer data while refetching, and do not set
a polling interval. Host QueryClient defaults drive focus/reconnect refetches.

## Hooks and mutation policy

`workflowQueryKeys.all` is `['workflow']`; `invalidateWorkflowQueries` invalidates
that root. `workflow-queries.ts` exposes `useWorkflowOverview` and
`useWorkflowEvents`, plus mutation hooks for item create/patch/delete, session
create/end/abandon, resource link/unlink, note create/delete, and history purge.
`queries.ts` re-exports `workflow-queries.ts` so the shared query API entry
point exposes workflow hooks without moving their implementation into the
broad module.

Each mutation passes the typed request to the corresponding `api.workflow`
method. A successful mutation invalidates the workflow root so the authoritative
overview/history is fetched again. A failed mutation does not invalidate or
optimistically rewrite cached data; React Query retains the typed error for the
caller to present and retry with the same request ID. `generateWorkflowRequestId`
uses `crypto.randomUUID()` and has an RFC 4122 v4 fallback for environments
without that API.

React Query owns remote workflow state. Component-local state owns deck/surface
selection, filters, drafts, focus, pending action presentation, and elapsed
clock ticks. Workflow hooks must not read or write `useSearchParams`, Zustand
workflow stores, localStorage, terminal registries, or editor state.

## Verification

The Phase 04 test report records 51/51 targeted UI tests passing: 13 helper
assertions in `workflow-types.test.ts`, 30 transport assertions in
`ws-transport.test.ts`, and 8 query-hook assertions in
`workflow-queries.test.tsx`. The same report records the full UI suite at
1,452/1,452 and the Rust server suite at 907/907 executed tests. Formal source
coverage was not generated because the UI coverage provider is not installed;
these are test execution counts, not line-coverage percentages.

The source-of-truth files are listed in the [Phase 04 plan](../plans/260901-0919-workflow-tracking-notes/phase-04-client-types-transport-and-query-state.md).
