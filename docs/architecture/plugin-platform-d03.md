# Trusted Plugin Platform — Phase D03

**Status:** DONE — 2026-09-22 (100%; re-review approved 9.2/10).
D03 adds the authenticated REST façade, WebSocket connection epochs, explicit
actor grants, and short-lived contexts over the D02 owner runner. It is still
trusted same-identity execution, not a malicious-code sandbox. Joint G1 remains
pending the cross-repository installed-worker sign-off.

- [D00 contract candidate](../plugin-platform-d00.md)
- [D01 registry and trust staging](./plugin-platform-d01.md)
- [D02 owner runner](./plugin-platform-d02.md)
- [D03 implementation plan](../../plans/260920-1603-plugin-platform/phase-03-authorized-api.md)
- [D03 review](../../plans/reports/code-review-260922-0649-phase-d03-authorized-api-re-review.md)
- [API Reference](../api-reference.md#trusted-plugin-api-phase-d03)
- [System architecture](../system-architecture.md)

## Boundary and data flow

```text
owner-bound UI client
  ├─ Bearer/cookie-authenticated REST + live /ws
  └─ local profile/generation (never sent as server authority)
       │ actor subject + JWT expiry + random connection epoch
       ▼
Axum auth/router ── PluginApiService
       │ current grant + epoch + registered project target
       ▼
RunnerClient ── owner-account RunnerServer ── InstallationSupervisor ── worker
```

The server accepts only `{ project, worktreePath? }` as the project target. It
resolves that reference through `WorkspaceTargetResolver`; `profileId`, browser
generation, filesystem roots, grant claims, and history hashes are not server
inputs. The runner receives the exact configured/resolved target identity. The
API's `PluginContextTable` stores opaque associations, actor/epoch ownership,
expiry, and generic counters; it is not a durable grant database.

## Protected REST API

All routes below are mounted in the protected Axum router and require the
`AuthenticatedActor` installed by `auth::require_auth`. Listing requires actor
visibility; context open/close, invoke, and cancel additionally require the
matching live WebSocket connection epoch. `--no-auth` is an explicit denial for
every production plugin route (`403`, `NoAuthForbidden`), not a synthetic
plugin identity. Request DTOs use camelCase.

| Route | Request | Success result |
| --- | --- | --- |
| `GET /api/plugins?project=<name>&worktreePath=<path>` | Required project and optional registered worktree | `{ plugins: PluginMetadataItem[] }` visible to actor/target |
| `POST /api/plugins/contexts/open` | `epoch`, `installationId`, `target`, optional `allowedOperations`, optional `allowCurrentAccountPolicy` | `contextId`, `bindingRevision`, `grantRevision`, `activationGeneration`, `expiresAt` |
| `POST /api/plugins/contexts/close` | `epoch`, `contextId` | `{ closed: boolean }`; client close is idempotent |
| `POST /api/plugins/invoke` | `epoch`, `contextId`, `operation`, opaque JSON `payload`, optional `deadlineMs` | `{ result: unknown }` |
| `POST /api/plugins/cancel` | `epoch`, `contextId`, `requestId` | `{ outcome: "accepted" | "alreadySettled" | "unknown" }` |

### List

`project` and optional `worktreePath` select the navigation target. The runner
returns metadata only; package or UI bytes are not returned. Visibility filters
metadata to installations for which the actor has a matching grant (exact
configured project or `*`). Visibility does not authorize an invoke.

```http
GET /api/plugins?project=evcrate&worktreePath=%2Ftmp%2Fevcrate-wt
Authorization: Bearer <token>
```

```json
{
  "plugins": [{
    "id": "advisor",
    "version": "0.1.0",
    "publisher": "evcrate",
    "capabilities": ["advisor.scan"],
    "hasUi": true,
    "activeGeneration": 3,
    "enabled": true
  }]
}
```

### Open and close

The open target contains no browser profile or filesystem root:

```json
{
  "epoch": 739128,
  "installationId": "advisor-evcrate",
  "target": { "project": "evcrate", "worktreePath": "/tmp/evcrate-wt" },
  "allowedOperations": ["advisor.scan", "policy.readCurrent"],
  "allowCurrentAccountPolicy": true
}
```

Open checks the live actor/epoch, matching grant, installation state, and
registered target. It then asks the runner to open a context and records the
opaque ID locally. `expiresAt` is an idle deadline, not a reusable lease or a
replacement for invoke authorization. Close removes the local record first and
best-effort closes the runner context; repeated close returns `closed: true`.

### Invoke and cancel

Every invoke checks the actor, epoch, context ownership/expiry, requested
operation, current grant, and context concurrency before forwarding opaque
payload bytes to the runner. The host does not parse domain evaluation bodies.
`requestId` is the runner request identifier used by cancellation; cancellation
is scoped to the same actor, epoch, context, and request. A worker deadline or
connection failure settles once; the API does not replay a non-idempotent call.

The handler maps plugin failures to bounded HTTP responses with `{ error, code }`:

| Condition | HTTP |
| --- | ---: |
| Missing/invalid actor or epoch | 401 |
| Grant, operation, or policy denial | 403 |
| Invalid DTO or target reference | 400 |
| Missing installation/source | 404 |
| Context revoked/expired | 410 |
| Overloaded admission | 429 |
| Deadline exceeded | 504 |
| Cancelled | 409 |
| Worker/runner unavailable | 503 |

Messages are sanitized; worker stderr, tokens, source paths, and policy text do
not cross the API boundary.

## Grant and authorization model

`GrantKey` is the explicit allow tuple:

```text
(actorSubject,
 installationId,
 configuredProjectTarget,
 allowedOperations,
 allowCurrentAccountPolicy)
```

- `actorSubject` must equal the authenticated JWT subject.
- `installationId` identifies one registered installation.
- `configuredProjectTarget` is an exact project name or `*`; it is not a path.
- `allowedOperations` is an explicit operation list or `*`.
- `allowCurrentAccountPolicy` must be true in the grant before a caller may
  request account-wide policy access.

No configured grant is default deny. Open validates the epoch and the complete
requested operation/policy set. Invoke repeats the epoch and grant check for
its single operation; a previous open decision is never sufficient. The API
rechecks current grants, while the runner fences context activation and worker
generation before work starts. Durable management grant/binding replacement
remains a separate D05 boundary.

## WebSocket connection epoch lifecycle

1. **Authenticate:** `/ws` accepts the bearer query token or auth cookie after
   origin checks. A valid token becomes `AuthenticatedActor { subject, exp }`.
2. **Issue:** for authenticated sockets the server issues a cryptographically
   random, non-zero epoch and binds it to the actor and JWT expiry. `--no-auth`
   sockets use epoch `0`, but plugin REST/service operations still deny them.
3. **Discover:** the client may send `{ "kind": "plugin:get_epoch", "req_id": 1 }`.
   The socket replies with `plugin:epoch` carrying `req_id`, `epoch`, `actor`,
   and optional `expiresAt`. The epoch is supplied in plugin REST DTOs.
4. **Use:** context open, invoke, cancel, and close require the same epoch and
   authenticated actor. An epoch cannot be transferred between profiles,
   actors, sockets, or client generations.
5. **Revoke:** socket teardown calls `revoke_epoch`, removes its contexts, and
   best-effort closes runner contexts. HTTP logout calls `revoke_actor`, which
   revokes that actor's epochs and contexts. Epoch validation also fails after
   JWT expiry. Runner reconnect invalidates the local context table so stale
   contexts cannot reach a new worker generation.

`plugin:revoked` is defined as a bounded server message for context revocation,
but the current D03 teardown path enforces revocation by removing the context
and rejecting later requests; it does not claim a push event for every cause.
Clients must treat transport generation changes, close/disconnect, and revoked
context errors as terminal for the old context.

## Context and runner limits

The generic host/runner ceilings are:

| Resource | Limit |
| --- | ---: |
| Contexts per installation worker | 16 |
| In-flight invokes per context | 4 |
| In-flight invokes per worker | 16 |
| Declared long-running operation per worker | 1 |
| Context idle TTL | 15 minutes |
| Ordinary invoke deadline | 10 seconds |
| Long-running/scan deadline | 30 seconds |
| Generic invoke payload | 16 MiB |

Current over-limit behavior is immediate `OVERLOADED`; the contract's 32-entry
queue constant is not a shipped fair FIFO. Full-duplex runner/worker transport
keeps cancellation and close control responsive while an invoke is running.
Domain snapshot, history, evaluation, and page budgets remain E02-owned.

## Client contract and ownership

`packages/ui/src/api/plugin-types.ts` defines the DTOs and closed cancellation
union. `createApiClient(owner, transport)` exposes `api.plugins.list`,
`openContext`, `closeContext`, `invoke`, and `cancel`. `WsTransport` maps these
channels to the REST routes above, captures its profile connection generation,
and ignores messages from a replaced socket. The wire target projection sends
only `project` and optional `worktreePath`; local `profileId` remains an
ownership key. A profile/project/worktree switch must close the old context
rather than move it to a new owner.

## Source map and evidence

| Area | Source of truth |
| --- | --- |
| Grant/epoch checks | `server/src/plugins/authorization.rs` |
| Context ownership/TTL/counters | `server/src/plugins/contexts.rs` |
| API orchestration | `server/src/plugins/api_service.rs` |
| REST DTOs/error/status mapping | `server/src/api/plugins.rs` |
| Auth actor/logout and epoch issuance | `server/src/api/auth.rs`, `server/src/api/ws.rs` |
| Epoch protocol messages | `server/src/api/ws_protocol.rs` |
| Router/state composition | `server/src/api/router.rs`, `server/src/state.rs` |
| UI DTO/client/transport mapping | `packages/ui/src/api/plugin-types.ts`, `client.ts`, `ws-transport.ts` |
| Focused evidence | `server/tests/plugin_authorization.rs`, `plugin_api_integration.rs`, `plugin_runner_supervision.rs` |

D03 scoped evidence: authorization 7/7, supervision 6/6, API integration 3/3,
UI transport 1,845/1,845, and a clean UI build. These are phase checks, not a
claim that joint G1 or production lifecycle/deployment is complete.

## Unresolved questions

- Should logout/actor revocation emit an immediate push event so clients discard
a token before their next request, or is transport teardown sufficient?
- Should actor revocation remove epoch map entries eagerly and should a periodic
expiry sweep run independently of context traffic?
- What canonical `EVCRATE_ROOT`/relative lookup should standalone packaging use?
- How should a public REST caller obtain or choose the runner request ID for
active invoke cancellation? The current invoke DTO returns only `{ result }`;
the focused integration uses a synthetic cancellation ID.
