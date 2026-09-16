---
title: Unified multi-profile DamHopper workbench
description: Decision-complete shared-UI ownership refactor with independent connections and preserved server authority.
status: pending
priority: P1
branch: main
tags: [frontend, api, auth, native, refactor]
created: 2026-09-16
---

# Unified multi-profile DamHopper workbench

## Decision

Implement one workbench containing profile/project groups and simultaneous supported connections. Focus is navigation only. Every remote operation and resource retains its originating profile, captured connection generation and endpoint binding. Reuse existing transports/components/server APIs; keep server project registries, PTY persistence, workflow history and authorization authoritative. No application implementation is included in this planning deliverable.

## Reading and execution contract

This is the canonical, self-contained plan: contracts, all nine phase specifications, coverage matrix, dependencies, compatibility/security decisions and thirteen qualification scenarios are embedded below. Linked local files are convenient views, not required missing specifications. The concise overview and command entry point are local://unified-multi-profile/plan.md and local://unified-multi-profile/cmd-plan.md.

All implementation checklists are pending. Source statements are observations; architecture and interfaces are proposed decisions. Planning review checks document consistency only, not application correctness. No application files, migrations, installs, tests or services were changed/run during planning.

## Planning provenance

The planning skill and hard-planning command were explicitly read from ~/.omp/agent/skills/planning/SKILL.md and ~/.omp/agent/commands/cmd-plan__hard.md, with their planning references and repository architecture/summary/standards/PDR context. The native command invocation surface was not available; its workflow was followed through planning tools. Resume metadata says Plan none, branch main and repository naming plans/260916-2031-unified-multi-profile. Hard plan-mode restrictions take precedence over setting active-plan state or creating repository artifacts: every deliverable remains under local://, with canonical slug unified-multi-profile.

Source discovery used focused reads/searches plus parallel scouts. Terminal and Browser/ports reports completed; failed research slices were completed inline. No application checks were used to paper over missing research. LSP reported no configured language servers; source navigation used repository tools.

## Observed load-bearing source findings

- `packages/ui/src/embed/dam-hopper-app.tsx`: `ServerProfileGuard` and `AuthGuard` gate the application on one active profile; `DamHopperApp` invokes `reinitializeTransport(activeProfileUrl, activeProfileId)` and cancels/resets shared queries when the connection key changes (around lines 193, 215, 381–424).
- `packages/ui/src/api/server-config.ts`: persisted `ServerProfile` and profile-scoped token helpers coexist with ambient `getServerUrl()`/active-profile fallback. Existing native scope aliases and deletion events must be preserved.
- `packages/ui/src/contexts/SshForwardHostContext.tsx`: profile `activeChanged` triggers `activate`; native scope lifecycle must be audited before allowing simultaneous forwarding.
- `packages/ui/src/api/query-client.ts:5–9` hashes query keys using the ambient active profile; ordinary query keys in `api/queries.ts` remain unqualified. Replace the hash indirection with explicit owner/generation tuples; merely creating several transports is insufficient.
- `packages/ui/src/api/ws-transport.ts:1543–1549,1663–1680,2187–2288`: transport already freezes its bearer token, but constructor defaults read ambient state; destruction rejects WS pending requests but REST controllers are request-local and PNG upload has no cancellation. Reuse this transport while making owner construction, lifecycle rejection, and REST cancellation explicit.
- `packages/ui/src/hooks/use-sse.ts:362–549`: one global listener installation and unqualified invalidation; `workspace:changed` invalidates all queries. Replace installation with one owner-bound bridge per connection and profile-only invalidation.
- `apps/web/src/main.tsx:33–63` and `apps/native/src/main.tsx:102–120`: both bootstraps create one transport and ambient query hash. Native URL restrictions are enforced in `server-config.ts:628–648` and `transport-utils.ts:50–69`; preserve these restrictions per profile rather than silently substituting same-origin transport.
- `packages/ui/src/api/client.ts:1571–1593`: current server-local project identity is project name plus optional normalized worktree path. `SessionInfo.id` is server-local and `incarnation` is already used to reject stale terminal lifecycle facts. Do not invent backend workspace IDs.
- LSP status: no language servers configured. Source navigation uses focused reads and searches; no application checks executed.
- `server/src/api/auth.rs:79–87,129–154,280–419`: ordinary authorization prefers bearer but falls back to a fixed host cookie; login returns a bearer and sets that cookie, logout clears it. Explicit owner-bound ordinary HTTP requests must use `credentials: "omit"`; authenticated WS construction must always include the captured query token, because WebSocket cookies cannot be suppressed by frontend fetch options.
- `server/src/fs/media_session.rs:9–12,78–101`, `api/fs_video.rs:131–145`, `api/media_stream_response.rs:47–67`: media uses a fixed hostname/path cookie, including for revocation. Browser cookies are not port-scoped; simultaneous same-host servers and same-server duplicate profiles require an explicit media-session isolation design, not only frontend map keys.
- `server/src/api/ws.rs:1654–1662`: disconnect aborts per-socket pumps and filesystem subscriptions, not PTYs. Preserve this backend behavior; frontend disconnect must never call terminal kill/remove.
- `ProjectSwitcher.tsx:19–49` picks the first bare project name; `WorkspaceSwitcher.tsx:30–60` actually changes backend configuration. Replace navigation with grouped profile/project picks and move explicit backend configuration selection to profile-targeted Settings, not a nested product workspace.

- Terminal scout confirmed raw-ID manager/registry/layout/history/notification collisions and existing detach-not-kill server behavior. Canonical design below keeps generation out of stable refs and rejects speculative automatic legacy ownership assignment.
- Browser/ports scout found server Browser artifact create/handoff uses raw terminal ID without incarnation; Phase 05 adds authoritative incarnation capture and atomic write validation.
- Native SSH source confirms single active_scope, global stop on activate_scope and per-client epoch reset; Phase 08 replaces scope exclusivity while retaining true epoch/global shutdown. Windows-only module/permission guards remain unchanged.
- Health exposes schema/status/version/role only, and feature flag hook is a placeholder. Capability handling must use existing endpoint/config-specific evidence, never treat health as authenticated universal support.

## Architecture and dependency outline

Shared app root owns one QueryClient, connection registry, qualified resource stores and keep-alive hosts. Each profile runtime owns its immutable endpoint/credentials, socket generation, API client, event bridge, cancellation and status. Explicit UI selections choose resources or editing targets; they do not mutate another profile runtime. Backend wire IDs remain local to each existing server.

Phase 01 freezes interfaces; Phase 02 shell and Phases 03–08 feature/native/backend slices can then proceed concurrently against those interfaces. Full Phase 01 acceptance is an integrated caller-migration gate, not a claim that removing singleton APIs compiles before callers change. One foundation/shell integration owner serializes shared-file edits and enables concurrency only after complete cutover. Phase 09 contains exact ownership boundaries, real fixture setup, scenarios and commands.

## Canonical frontend contracts — proposed

### Identity and resource bindings

Add `packages/ui/src/api/ownership.ts`; no equivalent currently exists for connection-qualified references. Keep backend DTOs unchanged.

```ts
export type ProfileId = string;
export interface ConnectionRef { readonly profileId: ProfileId; readonly generation: number }
export interface ProjectRef { readonly profileId: ProfileId; readonly project: string }
export interface ProjectTargetRef extends ProjectRef { readonly worktreePath?: string | null }
export interface TerminalRef { readonly profileId: ProfileId; readonly id: string }
export interface TerminalInstanceRef extends TerminalRef { readonly incarnation: number }
export interface ResourceBinding { readonly serverUrl: string; readonly configuredRoot?: string }
export type Owned<T> = T & { readonly profileId: ProfileId };
```

Project identity is `(profileId, project)` using current server project name; worktree target adds `normalizeProjectTargetPath(worktreePath)` or `null`. Terminal identity is `(profileId, id)`; incarnation remains a separate validation field, never replaced by connection generation. Use `JSON.stringify` tuples, not delimiter concatenation. In-flight work additionally carries `ConnectionRef`. UI caches carrying remote content use generation; persistent tabs and terminal layout keys do not.

`ResourceBinding` is attachment metadata, not a new server ID/catalog. On profile URL change, detach old resources; a new connection cannot revive them just because the profile ID/name matches. On server registry changes revalidate project configured root/worktree before allowing operations. Dirty content remains accessible locally; explicit close/reopen is required to adopt a different endpoint/root. Browser origin/path validation is not weakened by frontend normalization.

### Runtime and API boundary

Replace the singleton accessors in `api/transport.ts` with an explicitly keyed registry in `api/connections.ts` (new file; no equivalent registry exists). Preserve the existing `Transport` interface plus lifecycle/cancellation additions. Canonical entry points:

```ts
export interface ConnectionSnapshot {
  readonly owner: ConnectionRef;
  readonly status: "disconnected" | "connecting" | "connected" | "login-required" | "offline" | "unsupported";
  readonly intent: boolean;
  readonly serverUrl: string;
  readonly error: string | null; // redacted display error, never raw credentials
}
export function getConnectionSnapshot(profileId: ProfileId): ConnectionSnapshot | null;
export function connectProfile(profileId: ProfileId): Promise<void>;
export function disconnectProfile(profileId: ProfileId): void;
export function captureConnection(profileId: ProfileId): ConnectionRef;
export function isCurrentConnection(owner: ConnectionRef): boolean;
export function getTransport(owner: ConnectionRef): Transport;
export function getApi(owner: ConnectionRef): ApiClient;
export function subscribeConnections(listener: () => void): () => void;
```

`getApi(owner)` returns a cached `createApiClient(owner, transport)` result, not an API that looks up live ambient state later. The existing API method grouping remains; local wire DTOs are extracted explicitly, never spread `profileId` onto server messages. Project-target methods accept qualified `ProjectTargetRef` and check it matches the bound client. Other server-local identifiers (terminal IDs, workflow IDs, import temp directories) are passed only to an already-bound client. Remove `ProjectTargetInput = string | ProjectTargetRef`; migrate all callers to qualified refs, retaining a distinct transport-only `ServerProjectTarget` with `{project, worktreePath?}`.

Registry snapshots are immutable/stable until an actual state change so `useSyncExternalStore` can subscribe without render loops. `captureConnection`/`getApi`/`getTransport` reject disconnected, unsupported, removed or stale owners before dispatch; query hooks read snapshot then disable rather than falling back. Use one typed connection error with `stale | unavailable | owner-mismatch` reason so stale cancellation is not shown as B's server failure. Retain last-known project/session metadata separately as explicitly stale, read-only display data under its original ResourceBinding; do not reuse it as fresh query data for a new generation.

All public Transport calls validate their captured owner before dispatch. REST accepts external cancellation via `invoke<T>(channel, data?, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<T>`; update `WsTransport` and both idle-transport implementations. Existing REST timeout, FS operation timeout, pending-map rejection and chunk protocols remain. Track active REST/PNG controllers so destroy aborts them. Bound wrappers await response parsing before freshness checks, including rejected responses; stale failures must not alter the new runtime state. Writes already dispatched can have an unknown outcome; show that explicitly, refresh only their owner, and never replay automatically.

`WsTransport` construction requires explicit endpoint/profile/token; remove ambient defaults and invalid-URL same-origin fallback. Runtime registry, not each feature, captures credentials. The registry owns reconnect timers and reuses the current 1s exponential backoff capped at 30s, moved from WsTransport. One transport instance represents one connection generation, so reconnect creates a fresh instance and rejects all prior work. No retry of mutations, terminal input, resize, uploads or encrypted writes. Reads may retry only within the same captured generation; reconnect starts fresh queries under a new generation.

### Query and event contract

Keep one QueryClient with its normal deterministic key hash. Delete `profileScopedQueryKeyHash` and both bootstrap registrations. Canonical prefixes:

```ts
['profile', profileId, generation, 'projects']
['profile', profileId, generation, 'git', project, normalizedWorktreeOrNull, ...parts]
['profile', profileId, generation, 'fs', project, normalizedWorktreeOrNull, path, ...parts]
['profile', profileId, generation, 'terminal-sessions']
['profile', profileId, generation, 'workflow', 'overview']
['profile', profileId, generation, 'usage', ...parts]
```


Add key builders to `api/query-client.ts`: `profileQueryKey(owner, ...parts)` and `profileQueryPrefix(profileId)`. All query/mutation callbacks capture owner in closure/variables. Invalidation uses original owner, not current focus. Remove/refetch one profile prefix on generation change; never `cancelQueries()`/`resetQueries()` without a profile filter. Aggregate project/session lists derive from per-profile queries, returning successful data and per-profile status/error; never cache an unqualified merged remote result. No placeholderData across owner/generation boundaries.

Extend `IpcEvent<T = unknown>` to `{profileId, generation, type, data: T, timestamp}`. `subscribeIpc(profileId, type, cb)` is owner-explicit; a separate `subscribeAllIpc(type, cb)` is for intentional aggregate surfaces. One runtime installs and disposes its `use-sse.ts` bridge. Decorate events from the bound transport, never trust a server-provided profile ID; discard stale generations before fanout. Terminal events additionally pass existing incarnation checks keyed by `TerminalRef`. FS subscription IDs/request IDs stay local to their transport. `workspace:changed` revalidates only that profile's resources/configuration.

### Lifecycle and selections

Runtime status: `disconnected | connecting | connected | login-required | offline | unsupported`. Track connection intent separately: startup autoConnect and explicit Connect set it; explicit Disconnect/Logout clear it for this running app; focus never sets it. Preserve autoConnect setting across manual Disconnect, with UI text that startup will reconnect; Logout stays login-required until explicit Login even for authType none. Auth/URL/token changes invalidate generation before any replacement transport. Names/autoConnect toggles alone do not invalidate a healthy connection. Removal retains a generation tombstone for the app lifetime; re-add cannot accept old completions.

Profiles add `autoConnect: boolean`; old records missing it read/migrate as true, new profile UI defaults true, explicitly false survives managed-profile reconciliation. Storage-unavailable is not empty configuration: show it and do not clear aliases/tokens or invent another profile. Per-profile startup tasks settle independently; do not Promise.all gate shell mounting. No remote requests for unsupported native transports.

Connection startup order is per-profile: resolve supported endpoint → read matching credential record → owner-bound auth/status (or explicit login, including initial no-auth login) → open token-authenticated WS → mark connected and enable feature reads. Auth bootstrap is an internal endpoint-bound flow using credentials omit, not a public ambient API exception. Failure settles that profile only. A network loss while intent remains on advances generation, rejects old work, becomes offline and schedules bounded-backoff reconnect; authentication rejection becomes login-required and stops automatic retries until explicit login. A feature endpoint 404/unavailable does not retire an otherwise healthy connection. Connect is idempotent for an already connected/current profile; multiple calls share one in-flight start.

| Transition | Retire generation | Preserved | Remote side effects |
|---|---|---|---|
| Project/layout/Settings focus | No | All connections, credentials, owned resources | None |
| Explicit Disconnect | Yes, intent off | Saved token, autoConnect setting, local drafts/layouts/buffers | Only bounded ephemeral cleanup; no PTY kill/remove |
| Network reconnect | Yes, intent on | Stable refs/layouts; keys must be reacquired | Reattach/read only, never replay writes |
| Login/token/auth/endpoint change | Yes | Same-endpoint stable resources pending revalidation; old-endpoint resources detached | New endpoint receives only matching/new credentials |
| Logout | Yes, intent off | Profile record and recoverable drafts | Own media namespace revoke; clear own credentials/encryption; no global JWT revocation claim |
| Remove | Yes, tombstone retained | Recoverable local drafts/unresolved records | Own native scope/ephemeral cleanup only, no remote terminal deletion |

Native forward scope teardown distinguishes explicit Disconnect/Logout/Remove/endpoint replacement from transient backend network loss; Phase 08 defines its independent client-epoch fences. Frontend runtime ConnectionRef and native NativeScopeRef are different types and must not be substituted.

### Authentication persistence

Credential persistence must also be endpoint-bound across tabs. Existing profile metadata and raw per-profile token use separate localStorage writes and emit intermediate events. Add a versioned `damhopper_profile_auth_v2_<profileId>` record `{version: 2, serverUrl, authType, token}` written atomically as one string; public auth helpers require profileId and return credentials only when its endpoint/auth type match the profile. Migrate existing profile-scoped tokens once against the pre-migration profile snapshot, verify the new record, then remove the obsolete raw key; leave legacy single-server migration private. Never include tokens in query keys, logs, screenshots or plan evidence. On edit failure retain/restore old coherent metadata+auth, but do not revive obsolete in-flight operations. A metadata-new/auth-old cross-tab intermediate state fails closed because endpoint bindings differ. Profile name edits must not churn connections.

Login/test completion additionally compares the captured profile endpoint/auth revision before committing this record; a slow successful login must not install credentials after profile edit/removal. Username display belongs to its profile, not the existing global session username key. The old active-profile storage key is private migration input only after cutover, never a runtime connection selector.

Separate persisted fields: selected project (`ProjectRef | null`), `preferencesProfileId: ProfileId | null`, `settingsProfileId: ProfileId | null`, and explicit Browser target. Seed preference/settings profile from the valid pre-migration active profile once; if absent, require explicit selection, never first healthy server. Preserve preference source last-loaded snapshot during outage and disable its remote saves. Shared global preferences do not include server-local pinned mounts/Codex integration or unqualified resource ordering.

### Migration and duplicate-profile boundary

Version browser-local qualified stores; retain legacy bytes until successful migration. A previously active profile is evidence for preference selection, not proof that every old tab/layout/order belongs to it: previous profile switching did not scope those stores. Quarantine unqualified project/tab/terminal references unless the entry itself contains trustworthy matching owner/endpoint metadata; show restore UI requiring explicit profile assignment and target verification. Do not run terminal creation, file saves or bulk mutation during migration. Preserve recoverable dirty drafts. Parse legacy deep links as unresolved hints requiring owner selection; encode new links with profileId/project/worktreePath/session as appropriate.

Two profiles to the same server are two frontend connection owners, not isolated remote tenants. Keep independent tokens/generations/media leases; never deduplicate by normalized URL alone. Server mutations may be observed through both connections and server settings/fleet/history are shared according to existing authentication authority. Display that warning in Connections and confirmations; do not promise independent remote logout revocation, environments, usage attribution or terminal ownership.

Canonical contracts here override exploratory scout proposals: durable TerminalRef excludes connection generation; ambiguous legacy data is never automatically claimed by old active profile; media requires v2 backend isolation. Reports are evidence inventories, not competing implementation specifications.

### Browser-local persistence cutover

Reuse existing store/key conventions, not a second state framework. Before modifying a legacy resource record, save its exact bytes under `<existingKey>:legacy-unowned` only if no backup exists, and verify the write. Failed backup/persist means migration remains in-memory/unresolved, never destroy old data. Backups are for non-credential resource state only; auth migration follows its separate endpoint-bound contract. Explicit restoration assigns verified owner once and marks that legacy entry resolved; never clone to multiple profiles. Remove a backup only after every recoverable entry is restored or explicitly discarded.

| Store | New persisted contract |
|---|---|
| `dam-hopper:workspace-state` | Zustand version 1; selected qualified ProjectRef or null; old `dam-hopper:active-project` becomes migration-only |
| `dam-hopper:editor-state` | Version 2; qualified target/tab/model metadata and ResourceBinding; retain current metadata-only persistence |
| `dam-hopper:explorer-tree-state` | Version 1; qualified target keys for open/selected paths |
| Project-target/search transient state | Owner-qualified maps in existing stores; no new persistence of search contents/passphrases |
| Traditional/group terminal layout keys | Advance existing layout key family to `dam-hopper:terminal-layout:v3:<encoded owner/group tuple>`; layout payload version 2 contains TerminalRef leaves |
| `dam-hopper:terminal-pins:v2` | Qualified TerminalRef entries; old v1 becomes unresolved restore input |
| `dam-hopper:command-history` | Version 3; profile-owned entries/project usage; original retention/limits; legacy entries unresolved |
| `dam-hopper:browser-debug-address-history` | Version 2; entries grouped by profileId; preserve existing URL stripping and bounds |
| `dam-hopper:preferences-source:v1` | ProfileId or null plus last successful non-secret allowlisted preference snapshot |
| `dam-hopper:settings-target:v1` | ProfileId or null; no remote config/credential duplication |

Any additional resource-bearing layout key discovered during caller migration follows the same owner-qualified tuple convention and verified legacy quarantine; presentation-only widths/modes stay unchanged. Migration performs no remote mutation and no automatic terminal creation.


## Coverage matrix and final decisions

### Scope and non-goals

Deliver one shared DamHopper workbench with simultaneous supported profile connections and `Profile → Project` navigation. Frontend server profile identity qualifies existing server-local resources; it is not a new backend workspace, project registry, authentication tenant or workflow database. No URL deduplication, app-per-profile remount, generic proxy/federation server, cross-server filesystem move, cross-server agent shipping, broad permission relaxation, new host power endpoint or feature-specific active-profile fallback.

All behavior below is proposed implementation, not a claim about current source. Source evidence is embedded in phase sections. Current docs occasionally describe older API paths/conditional feature gates; `api/router.rs`, client source and validated endpoint behavior take precedence.

### Feature-to-phase coverage

| Feature / entry point | Required ownership and behavior | Phase | Proof |
|---|---|---|---|
| Profile CRUD, autoConnect, login/logout/status | Independent runtime/token/intent; legacy true default; unsupported/offline partial shell | 01–02 | S01, S11 |
| HTTP, WS, filesystem chunks, PNG, reconnect | Captured ConnectionRef/endpoint/auth, abort and stale fences; no mutation replay | 01 | S01, S11 |
| Query cache, optimistic mutation, SSE/IPC events | Explicit profile+generation keys/envelopes; original-owner invalidation only | 01 | S03–S11 |
| Project picker, TopNav, Dashboard, deep links | Profile/project refs, URL/path disambiguation; no connection/config switch on focus | 02 | S02 |
| Backend workspace registry setup/switch | Existing server API in targeted Settings only; no new hierarchy | 02,06 | S02,S09 |
| Explorer tree, file CRUD, watchers, language scan | Target+owner+binding; owner-local scan epoch/availability | 03 | S03,S11 |
| Editor tabs, Monaco, dirty saves, diffs | Stable qualified model identity; request generation and root binding; preserve drafts | 03 | S03,S11 |
| File upload, streaming writes, drag/drop | Destination captured before async work; owner-specific progress/cancel; no cross-server move | 03,07 | S03,S07 |
| Large files, binary, HTML, Markdown | Bound reads; content-only renderers preserve sandbox/sanitization | 03 | S03 |
| Image/video preview and downloads | Per-connection media namespace; original cleanup; streaming/range policy preserved | 07 | S07 |
| Project/worktree and federated text/path search | Snapshot eligible owners, concurrency 4, combined cap 500, partial errors/truncation | 03 | S04 |
| Replace Next/All | Exact displayed selected targets, per-file results, dirty/conflict checks, no replay | 03 | S04,S11 |
| Git status/stage/commit/history/conflicts | Owner+target+root refs and matching editor reconciliation | 03 | S04 |
| Worktrees, nested Git roots/submodules | Existing normalized target/root semantics qualified by owner | 03 | S04 |
| Bulk fetch/pull/push and SSH authentication retry | Explicit per-profile partitions; retry failed auth targets only, captured credential prompt | 03 | S04,S11 |
| Terminal launch/build/run/custom/free/saved profile | Owner-bound dispatch; unchanged server ID/CWD/env/config semantics | 04 | S05 |
| Terminal attach/output/input/resize/rename/kill/remove | TerminalRef plus incarnation; one xterm per ref; detach is not kill | 04 | S05,S11 |
| IDE/traditional/Fleet/runtime/floating/maximized/compact layouts | Shared keep-alive lifetime; owner-qualified tabs/splits/pins/navigation | 04 | S05 |
| Terminal histories/suggestions/mobile accessories | Per-profile history and action owner; preferences may be shared | 04 | S05,S12 |
| Workflow Plan/Phase/Task/session/execution/notes | Per-profile server-local IDs/CAS/request UUIDs; preserve backend history | 04 | S06 |
| Workflow terminal/project links and unavailable targets | Exact owner+incarnation navigation; no same-name replacement | 04 | S06,S11 |
| Agent inventory/content/health/distribution/absorb | Explicit catalog profile; same-owner projects only | 05 | S06 |
| Agent repo/local import and memory/templates | Owner-bound tmpDir and draft/preview/confirm; no implicit remote copy | 05 | S06,S11 |
| Detected ports/tunnels/cloudflared install | Qualified rows/events/actions; server numeric-port semantics unchanged | 05 | S08 |
| Browser target/address history/bridge/extension | Explicit target independent of focus; exact-origin/source/nonce trust | 05,08 | S08,S13 |
| Capture/PNG/artifact cleanup/terminal handoff | Owner+target revision+TerminalInstanceRef; atomic server incarnation write | 05,07 | S08,S11 |
| Notifications/browser tags/shortcut navigation | Owner-qualified identity and safe labels; no reconnect on click | 04 | S12 |
| Diagnostics export and redaction | Explicit owner-filtered bundle; output consent; no cross-owner or secret leakage | 04,06 | S12 |
| Encryption prompts/passphrases/OPAQUE/key cache | Owner/project/generation lifetime; same transport through entire write | 07 | S07,S11 |
| Feature flags/capabilities/old server/unavailable resources | Per-profile known availability, no global healthy-server fallback | 02,05 | S01,S08,S10 |
| Preferences and keyboard/appearance settings | Explicit preference source; last snapshot offline; captured debounce chain | 06 | S09,S11 |
| Settings config/import/export/cache/reset | Independent editing target captured before dialog/file read; owner-labelled destructive effects | 06 | S09,S11 |
| Server-local ordering/pinned mounts | Use each server's existing UiConfig only in that owner group | 06 | S09 |
| Usage telemetry/session audit/retention/Codex | Explicit profile, separate data/config; no duplicate-endpoint totals | 06 | S09 |
| Host metrics/alerts/storage/fleet/suspend timing | Profile-labelled host snapshots/revisions; no averaging or cross-owner mutation | 06 | S10 |
| Force sleep and existing process-affecting actions | Captured owner+auth+revision/confirmation; existing server guards; fake execution only in checks | 06 | S10 |
| Native SSH scopes/credentials/trust/lifecycle | Concurrent admitted scopes; scoped teardown, true epoch global teardown | 08 | S13 |
| Native Browser/support matrix and host bootstrap | Shared UI runtime; one explicit Browser child lease; preserve platform restrictions | 02,08 | S13 |
| Legacy browser stores/cross-tab events/duplicate profiles | Versioned explicit restore, coherent endpoint-bound auth; no false tenant isolation | 01–02,04 | S01,S07,S12 |

### Minimal backend changes and compatibility decision

| Boundary | Change | Why frontend alone cannot solve it | Compatibility |
|---|---|---|---|
| Media session/ticket | Opt-in mediaClientId namespace, actor-bound scoped revoke, session-cookie-v2 response | Cookies collide by host/path across ports/profiles and media elements cannot attach bearer | Old request remains v1; new client requires v2 for media only; no DB migration |
| Browser artifact handoff | Capture/store concrete PTY incarnation; optional create request field, response acknowledgement; atomic incarnation-checked write | Reused raw terminal ID races after frontend snapshot | Old clients receive safer server behavior; new client declines old-server handoff without acknowledgement; ephemeral store only |
| Native SSH IPC | Concurrent scope maps and explicit scope refs/open/close/reconcile commands | Rust manager currently enforces one scope and globally tears down forwards | Bundled TS/Rust atomic cutover; existing persisted stores/vault/trust/aliases unchanged |
| All other server features | No ownership protocol/catalog/database change | Separate existing authenticated connections already identify server | Current API names/permissions/sandbox/PTY/workflow persistence retained |

Media v2 is additive protocol compatibility, not a permanent frontend ambient-dispatch shim. Artifact create rejects incarnation mismatch before creating; handoff checks again atomically. New frontend gates unsupported old-server media/handoff, never pretends secure success. There is no claimed actor tenancy beyond existing server authorization; duplicate profiles to one server can see/mutate the same permitted resources.

### Risks and mitigations

1. **Indirect ambient authority:** compiler-required owners plus exhaustive API/query/event/storage inventory; no concurrent release before all slices integrate. Timers/dialogs/retries/cleanup are mandatory audit targets.
2. **Credential endpoint race:** atomic endpoint-bound credential record, pre-login endpoint revision fence and runtime retirement before replacement. Never reuse token because profile ID stayed equal.
3. **Cookie and third-party behavior:** real same-host/different-port browser matrix, namespace selection from stored ticket binding, actor-bound revoke even with blocked cookies, exact-origin fallback unchanged. Hostname cookies are not a new isolation boundary against an untrusted server on the same hostname; use separate trusted origins/HTTPS as appropriate.
4. **Lost in-flight mutations:** show unknown outcome, refresh only owner, never auto-replay; no fictitious cross-server transaction or rollback.
5. **Legacy ownership ambiguity:** quarantine/explicit verify-and-restore, retain bytes, no first-profile/name guess; no promise of restoring unsaved content that old persistence omitted.
6. **Memory/connection cost:** one runtime/socket per intended supported profile, owner-filtered subscriptions, existing query poll intervals, bounded search/capture/media, keep-alive only intended open terminals; avoid O(profiles×all-resource) recomputation on each event.
7. **Native teardown security:** refactor admission and scope-keyed maps together, preserve global quotas and true epoch shutdown; Windows proof required, Linux compile not substitute.
8. **Preference/resource confusion:** explicit allowlist for shared preferences; ordering/pinned mounts/Codex/telemetry remain server-local. Source, settings target, project and Browser target never implicitly synchronize.
9. **Changed root or duplicate URL:** persistent attachment endpoint/root checks and explicit reopen; duplicate URL remains two client owners but one remote authority.
10. **Fixture collateral damage:** temporary homes/databases/configs/keys, loopback-only services, disabled real idle-suspend, FakeExecutor/FakeActionBackend for power/process assertions, teardown verified owned handles only.

### Decisions and external prerequisites

No unresolved product/design choice is deferred to implementation. Conservative defaults are explicit: legacy autoConnect=true, new=true; one shared shell/query client; explicit preference source; roots-only federated all-profile search; partial results; same-owner Browser handoff/agent shipping; one physical Browser surface; no replay; conservative legacy restore. Required execution prerequisites are disposable MongoDB for real auth, browser media/capture permission/capability, and Windows runner/device plus disposable SSH endpoints for native runtime qualification. If unavailable at implementation time, record the exact blocked gate and finish reachable work; do not label unexercised security/platform behavior complete.

Planning evidence: primary source reads and two completed scout reports; four other delegated research jobs failed without usable output and their coverage was completed inline. No application code changed and no application verification result is claimed. Canonical contracts/phase instructions supersede scout suggestions where they differ.


## Detailed implementation phases

## Phase 01 — Explicit ownership and connection foundation

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: None; freeze contracts before parallel feature implementation.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Runtime and ownership.

### Key Insights

#### Observed constraints

`api/transport.ts` owns one transport and global generation. `api/client.ts` dispatches every API group through it. `api/query-client.ts` hashes using active profile at call time. `WsTransport` already freezes bearer per instance and maintains per-instance FS/write/OPAQUE pending maps, but REST controllers escape destroy and WS reconnect reuses the same instance. `hooks/use-sse.ts` installs one bridge and globally invalidates queries. Preserve these proven transport mechanisms; replace ambient ownership rather than duplicate protocols.

### Requirements

Explicit owner/generation for every remote operation; independent lifecycle and no ambient fallback.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Context and dependency

Depends on none. Foundation owner owns shared API/event modules for all later phases. Read canonical contracts in `local://multi-profile-contracts.md`; final canonical plan will embed them. Proposed implementation, not current behavior.

### Implementation Steps

#### Numbered implementation steps

1. Add `packages/ui/src/api/ownership.ts` with exact qualified refs/key helpers in canonical contracts. Keep server wire DTOs separate. Update project-target normalization without stripping profileId; remove string shorthand from frontend callers. Use current `normalizeProjectTargetPath`.
2. Add `packages/ui/src/api/connections.ts`: keyed external store with immutable runtime snapshots, per-profile generations/tombstones, explicit intent, authentication/capability/status, captured API clients, disposal and connection subscriptions. Preserve all supported profile records even when unsupported/offline. A registry never creates a fallback connection to another endpoint.
3. Refactor `api/client.ts` into `createApiClient(owner, transport)` with unchanged method groups and explicit `getApi(owner)` lookup. Route project-qualified arguments through an owner-match check and explicit wire target projection. Expose the owner-bound WS filesystem/OPAQUE methods through typed transport capabilities so callers do not cast a global singleton. Existing public API DTOs are unchanged except frontend wrappers.
4. Change `WsTransport` to one socket generation per instance, explicit endpoint/profile/token arguments, tracked REST/PNG AbortControllers, external cancellation and stale completion guards. Move its reconnect schedule/backoff to registry, keeping 1s initial/30s cap. Guard all socket callbacks by captured socket and runtime generation; destroy clears buffer callbacks as well as existing maps and rejects pending promises. No replay queue or mutation retry.
5. Add explicit owner query factories in `api/query-client.ts`; remove ambient hash and replace every query/invalidation in `api/queries.ts`, `api/workflow-queries.ts` and consumers. Preserve query-specific stale times/poll intervals; no ownership-based global polling. Mutation variables capture owner before dialogs/prompts/await. Aggregate reads derive from individual per-profile queries, not one all-or-nothing promise.
6. Refactor `hooks/use-sse.ts`, `hooks/use-sse-events.ts`, `hooks/use-transport-generation.ts`: per-runtime bridge, profile/generation event envelopes and owner-filtered cache effects. Wire registry bridge installation exactly once independent of TopNav/route mounts. Preserve payload validators and incarnation checks. Server workspace/config events affect only their profile; no global terminal incarnation reset.
7. Remove singleton `initTransport`, `reconfigureTransport`, `reinitializeTransport`, global generation, `profileScopedQueryKeyHash`, and their obsolete tests once hosts/callers switch. `transport-utils.ts` retains only explicit per-profile support resolution if useful; otherwise delete the obsolete module. Do not retain runtime compatibility aliases that consult active profile. With zero profiles, mount shell without a fake live transport; remove now-unused duplicate idle transports after confirming no references.
8. Mechanical cross-feature caller migration belongs to this foundation boundary and feature slices: explicit owner signatures land with all callers in the integrated cutover. Phase 01 first supplies frozen contracts; its full acceptance gate depends on integrating the callers in Phases 02–08. Do not enable simultaneous connections while any consumer dispatches ambiently. Validate the integrated compile boundary; no active-profile fallback or permanent compatibility alias may be added to make it compile.

### Todo list

- [ ] A/B clients with identical local IDs route independently; owner mismatch rejects before network I/O.
- [ ] Reconnect, URL/auth/token change, removal and late WS callbacks reject old-generation results/events; B remains untouched.
- [ ] Abort reaches HTTP and PNG network requests; disposing A clears all its pending maps/subscriptions only.
- [ ] Query hash is deterministic from its arguments; no active-profile dependency or bearer in keys.
- [ ] Disconnect emits no terminal kill/remove; no automatic mutation replay, including ambiguous transport failure.
- [ ] All feature clients receive explicit owners; no global query reset remains in connection/navigation paths.

### Success Criteria

Phase 01 acceptance checklist and S01/S11; integration typecheck after all callers land.

### Risk Assessment

Stale callbacks and indirect singleton callers are the primary risk; integrate every caller before enabling concurrency.

### Security Considerations

Captured endpoint-bound credentials, owner checks and per-generation aborts are mandatory.

### Next steps

#### Verification and security notes

Implementation commands from repository root: `pnpm --filter @dam-hopper/ui build`; focused new `pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts`. Add regressions only for collision/race/failure contracts, not source-text wiring. Live scenario: delay A response, change A endpoint/token and select B, release A response; neither B state nor A replacement runtime accepts it. Credentials stay private to runtime, endpoint-bound in storage, bearer-authenticated over existing allowed origins. URL parse failure is explicit unavailable, never same-origin fallback.


---

## Phase 02 — Independent connections and unified navigation

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Shell and connections.

### Key Insights

#### Source evidence

`embed/dam-hopper-app.tsx:193–424` blocks routes behind one profile/auth/workspace and reinitializes transport on active selection. `ServerSettingsDialog.tsx:207–352` persists metadata/token separately, activates new profiles and reloads the page; `ServerProfilesDialog.tsx:34–61` revokes previous profile media on switch. `stores/workspace.ts` persists only a project name. `ProjectSwitcher.tsx` falls back to first project; `TopNavUtilityStrip.tsx` embeds the backend `WorkspaceSwitcher`. Web and native main initialize one transport and ambient query hashing.

### Requirements

Independent login/connection controls and one profile→project navigation hierarchy without remount/reconnect on focus.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Context and dependency

Depends on Phase 01 contracts. Integration owner owns shell, bootstrap and profile settings; feature teams do not concurrently edit these shared files.

### Implementation Steps

#### Numbered implementation steps

1. Extend `api/server-config.ts` `ServerProfile` with required `autoConnect: boolean`; read legacy records with missing property as true and persist idempotently after successful storage validation. Update `createProfile`, `migrateToProfiles`, `reconcileManagedProfile`, profile forms and fixtures; preserve an explicit false. Keep storage-unavailable distinct from no profiles and preserve native aliases/tombstones.
2. Implement endpoint-bound credential records exactly as canonical contract. Public token/header helpers require profileId, legacy optional helpers become private migration-only operations. Profile form edits stage URL/auth/token and commit coherent records; invalidate runtime before replacement, and fail closed on partial storage/cross-tab events. Abort late login/test responses after edit/removal. Do not transmit old bearer to an edited URL.
3. Replace app-wide `ServerProfileGuard`, `AuthGuard`, `WorkspaceGuard` with always-available shell and per-profile status/setup/login rows. Keep existing no-auth login request `{}` and credential form behavior bound to each profile; authType basic without token is login-required. Bootstrap auto-connect each enabled supported profile independently. Healthy profiles render while others load/fail; zero projects or zero profiles shows empty-state Connections/Settings, never an unclosable modal.
4. `ServerProfilesDialog.tsx` exposes Connect, Disconnect, Login, Logout, Edit, Remove and Auto-connect on each row with profile URL/status. All handlers take profileId. Disconnect invalidates runtime/aborts client work without clearing token or killing PTYs; Logout additionally clears its credentials/secrets and revokes only its media session. Remove confirms local profile/resource impact, invalidates before deletion, preserves recoverable drafts and scoped native cleanup. Editing inactive B does not reload A; remove page reloads and old Switch action entirely.
5. `stores/workspace.ts` stores qualified `ProjectRef | null` and navigation revision. Aggregate per-profile projects in `ProjectSwitcher`, TopNav and Dashboard; group `Profile → Project` (label may say Workspace/Profile, no additional level), expose sanitized server URL plus configured project path. Encode select values with tuple keys. No missing-name fallback; unavailable selected project stays explicitly unavailable. User selects resource owner through picker, not a connection action.
6. Move backend registry selection (`WorkspaceSwitcher`, known-workspace controls, setup wizard) into selected-profile Settings as “Server configuration”. Keep its existing API terminology/behavior; do not rename backend workspace APIs or make this a workbench hierarchy. TopNav brand is unified workbench; connection summary links to all profile statuses. Dashboard aggregates project/session references, owner-labels activity, and sends kill/export/navigation through row owner.
7. Separate `preferencesProfileId`, `settingsProfileId`, selected project and Browser target; initialize preference/settings IDs from valid pre-migration active profile once. Fresh installs require explicit preference choice; never select first healthy server. Add preference-source choice to Connections/Settings and independent profile selector in Settings. Do not let project selection move either. Removing source retains cached preference snapshot and displays source removed until explicit replacement.
8. Update `apps/web/src/main.tsx` and `apps/native/src/main.tsx`: perform profile migration (and web managed runtime reconciliation), create ordinary QueryClient and shared connection orchestration, then render once. No profile-specific root key. Keep web runtime-config validation/bounds and native Browser/SSH provider/platform detection. Convert `native-server-url.ts` to explicit per-profile support check or remove its now-obsolete active-profile accessor. Browser/Windows allow current HTTP(S) remote transport; non-Windows native stays exact same-origin-only. Unsupported profiles remain editable/listed and produce no fallback traffic.
9. Version browser-local resource stores and deep links using canonical migration rule. Add unresolved-reference restore UI within workbench: original project/path/session label, candidate profile selection, explicit verify-and-restore; never assign by first/equal name. Resource restore cannot create terminals or replay writes. Preserve legacy bytes/drafts until confirmed migration succeeds. New navigation includes `profileId`; legacy `/ide`/`/terminals` redirects preserve hints but require owner selection when unqualified.

### Todo list

- [ ] A/B/C boot independently with A healthy, B login-required, C unsupported/offline; Connections/Settings remain accessible.
- [ ] Existing profiles migrate autoConnect=true; explicit false remains false, including managed-profile reconciliation.
- [ ] A project selection never changes socket count, credentials, server config, Browser target or preference source.
- [ ] Equal project names have distinct grouped rows, URL/path disambiguation and qualified deep links.
- [ ] Profile edit/removal/cross-tab credential changes cannot dispatch old token to new endpoint.
- [ ] Unqualified legacy references remain recoverable and require explicit verified owner assignment.

### Success Criteria

Phase 02 acceptance checklist and S01/S02/S12.

### Risk Assessment

Legacy ownership cannot be inferred from the previously active profile; preserve unresolved resources.

### Security Considerations

No old-token/new-endpoint traffic; preserve native origin restrictions and storage-unavailable handling.

### Next steps

#### Verification and security notes

Focused existing tests: `src/api/server-config.test.ts`, `src/components/organisms/ServerProfilesDialog.test.tsx`, `ServerSettingsDialog.test.tsx`, `TopNav.test.tsx`; add shell regression for one blocked profile not gating another. Delete tests whose only purpose is old switching/reload wording, replace only observable ownership behavior. Live two-server scenario must prove socket continuity and no workspace-switch request on navigation. Read connection URLs without embedded credentials; retain exact CORS/origin policy. Profile tokens remain frontend-readable as before; no new secret persistence except endpoint metadata around existing token.


---

## Phase 03 — Files, editor, federated search and Git

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Files and Git.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

All file/Git/search/replace actions target captured qualified resources and expose partial failures.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and ownership

Consumes Phase 01 contracts and Phase 02 qualified selections. Files/Git owner owns feature modules below; foundation owner alone edits `api/client.ts`, `api/queries.ts`, `hooks/use-sse.ts`. Supply exact callsite changes to that owner. Shell owner integrates `WorkspacePage.tsx` props once.

#### Evidence and files

- `stores/editor.ts`: `compositeTabKey`, per-tab request generations, global transport lookup, `persistedTab`, versioned metadata-only persistence; `stores/project-target.ts`, `stores/explorer-tree.ts`, `stores/search-ui.ts` retain bare project/target state.
- `hooks/use-file-search.ts`: 350ms debounce, minimum two characters, 200-character input cap, project/workspace scopes and previous-data placeholder. `hooks/use-search-panel-replace.ts` reads/writes through a newly looked-up transport after awaits. `hooks/use-fs-upload.ts` snapshots target but not connection.
- `lib/explorer-language-scan.ts`: QueryClient-wide epoch and project/target caches. `hooks/use-git-with-ssh-retry.ts` saves a callback for authentication retry; bulk replay must be narrowed to failed targets.
- Components: `FileTree.tsx`, `EditorTabs.tsx`, `MonacoHost.tsx`, `LargeFileViewer.tsx`, `BinaryPreview.tsx`, `MarkdownHost.tsx`, `MarkdownPreview.tsx`, `HtmlHost.tsx`, `HtmlPreview.tsx`, `SearchPanel.tsx`, `SearchPanelResults.tsx`, `UploadDropzone.tsx`; existing Git/worktree components and their query consumers.
- Backend `server/src/api/fs.rs:309–404` supports project-target search or server-local workspace root search; workspace scope rejects worktreePath. `server/src/fs/ops.rs` caps workspace results at 500 and project search at 1000. Reuse these endpoints; no federation server or database migration.

### Implementation Steps

#### Numbered implementation

1. Qualify editor tab identity with profile, project, normalized worktree, path, kind, Git root/commit/diff identity. Use this stable key as Monaco model path/key and view-state key; do not include connection generation in durable editor identity. Tab retains ResourceBinding and each read/save captures current ConnectionRef. On reconnect reload clean content only after target binding verification; never overwrite dirty content. Stale read/save responses cannot clear dirty state or update another tab's mtime.
2. Qualify target availability, selected worktree, explorer open/selected paths, language scans, rename/move/delete reconciliation and file watchers. Watcher teardown disposes the originating transport subscription only. Project/root changes detach affected resources, preserving dirty drafts; deletion on A cannot mark B's equal path unavailable. Scope scan epochs by owner/generation/target, not the whole QueryClient.
3. Bind create/rename/move/delete/read/save/streaming text/chunked large-file operations and ordinary/encrypted upload to captured destination. Drop handlers snapshot the drop target before asynchronous file enumeration, confirmation or passphrase entry; progress, cancellation and invalidation stay on that owner. Preserve existing sandbox/worktree/mtime checks, upload acknowledgements and bounds. No cross-server drag-and-drop filesystem move is introduced; reject mixed-owner move rather than copying implicitly.
4. Preview ownership follows the tab, not selected project. Markdown/HTML remain content-only renderers with existing sanitization/sandbox; do not inject server tokens, authenticated base URLs or bridge routing into their documents. Large-file/binary reads stay bound. Image/video/download helpers consume Phase 07 media leases; preserve browser-managed streaming/range downloads, not whole-file buffering. Revoke object URLs/tickets through their original owner where current semantics permit; download tickets retain their intended lifetime.
5. Replace ambiguous search scope with explicit `Project target` and `All connected profiles`. Project search includes selected worktree; federated search calls each eligible connected profile's existing `scope=workspace` root search, never forwards one selected worktree to other profiles. Snapshot eligible owners at dispatch, maximum four concurrent server searches, retain existing debounce/query limits. Aggregate results carry ProjectTargetRef with root target plus captured generation and path/line. Stable ordering: profile display order, project, path, line; render at most 500 combined matches and show a truncation warning if local cap or any server truncates. Request each server's existing bounded result set; don't assert completeness after truncation.
6. Federated search exposes per-profile loading/error/unsupported/disconnected status and usable successes, not a whole-search failure. New query/scope/profile generation cancels obsolete work and discards late responses; requests dispatched before disconnect may finish server-side but cannot commit. A newly connected profile is incorporated through a new search snapshot, never mixed into an old generation's results. Keyboard navigation and open-result actions use result owner. Remove cross-owner placeholderData.
7. Replace Next/All operates only on the displayed, explicitly selected result snapshot; confirmation lists profile/project/file counts and warns when results are truncated or profiles failed. Capture all target bindings before confirmation. Partition operations by profile, preserve existing dirty-tab conflict checks and mtime/concurrent-write behavior, stop changed/unavailable targets, return per-file success/failure/cancelled/unknown results. Cancellation stops undispatched writes; do not claim rollback for committed writes or replay unknown outcomes. Refetch only original owners. Never silently expand truncated search to undisplayed files.
8. Qualify all Git operations: status/diff/untracked, stage/unstage/discard and hunks, conflicts, commit/amend/history rewrite/revert/cherry-pick/reset, branches, worktrees, nested roots/submodules, fetch/pull/push and bulk operations. Keep project target plus Git root separately; no flattening submodule/root identity into profile. Partition explicit bulk selections by owner and call existing server APIs per partition. Undefined “all projects” must mean the explicitly chosen profile, never current focus after an await. Refresh/reconcile only matching owned editor tabs and query prefixes.
9. Git SSH prompts carry ConnectionRef, operation and exact failed targets/key path. Success on A is not replayed when B needs credentials. After prompt, validate owner generation; list/add/forget keys and retry only explicitly retryable authentication failures on the original client. A reconnect/URL/token change cancels the prompt; no retry against replacement connection. Keep server SSH credentials distinct from native desktop forwarding credentials.
10. Migrate persisted editor/target/tree/search resource keys using canonical quarantine rules. Persist metadata only as existing editor contract; preserve live dirty drafts and any actually recoverable legacy content, do not claim to recover bytes never stored. Presentation-only panel widths may remain device-global.

### Todo list

- [ ] A/B `web/src/marker.txt` opens as distinct models; editing/saving A while B is selected changes A only.
- [ ] Same worktree/submodule names and paths do not share target availability, Git state or watcher invalidation across owners.
- [ ] Search succeeds partially with B offline, labels ownership/truncation, cancels stale queries, and result navigation opens the originating project.
- [ ] Replace shows exact affected owners and does not touch B's dirty tab or undisplayed/truncated results; partial success is honest.
- [ ] Upload/download/preview completion after focus change stays on origin; URL/root change detaches rather than retargets.
- [ ] Authentication retry never repeats successful bulk targets or dispatches to a new generation.

### Success Criteria

Phase 03 checklist and S03/S04/S07/S11.

### Risk Assessment

Delayed save/upload/credential retry can retarget unless owner is captured before every asynchronous boundary.

### Security Considerations

Keep filesystem sandbox/worktree/mtime checks and original-owner SSH credentials; no cross-server move.

### Next steps

#### Verification and risks

Use existing editor, project-target, file-search, search-panel-replace, fs-upload, Git retry and preview tests; add regression only for collision, stale-save, partial search, partial bulk retry and cancellation boundaries. Live scenarios S03/S04/S07 exercise real files/Git/worktrees on both servers. Backend sandbox/search/worktree tests remain unchanged unless a contract change requires adjustment. Main risk is partial ownership migration in indirect helpers; foundation owner inventories every old `ProjectTargetInput`, ambient API/transport use and broad invalidation before enabling concurrency. No backend search protocol expansion required.


---

## Phase 04 — Terminal continuity, workflow and owner-directed navigation

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Terminals and workflows.

### Key Insights

#### Source constraints

Manager/maps/layouts currently use raw session IDs. `TerminalKeepAliveHost` keys xterms by session ID; `use-terminal-layout` initializes once per storage key. Panel cleanup detaches and disposes xterm but does not kill PTY. Server WS cleanup aborts pumps, not PTYs; kill and durable remove remain explicit different operations. Workflow service resolves server workspace from config locator and keeps history in its existing store (`server/src/workflow/service.rs:125–197,262–278`). Workflow DTO workspace/project IDs and saved terminal launch-profile IDs are not frontend server profile IDs.

### Requirements

Keep owned terminals/layouts/workflow links stable across every shell and project focus change.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and files

Consumes Phase 01 identity/event contracts and Phase 02 navigation. Terminal owner owns `hooks/use-terminal-manager.ts`, `use-terminal-layout.ts`, `use-terminal-tree.ts`, `use-terminal-suggestions.ts`; `lib/terminal-{registry,incarnation-state,output-activity,mounted-sessions,host-attachment,auto-attach,target-identity,launch-context,layout-tree,runtime-tree}.ts`; `command-history.ts`, terminal suggestion/notification/navigation helpers; `stores/terminal-notifications.ts`; terminal display/pane/keep-alive components. Workflow changes cover `api/workflow-queries.ts` via foundation owner, `lib/workflow-focus.ts`, `workflow-workspace-integration.ts`, `hooks/use-workflow-surface-actions.ts`, WorkflowContextSurface/Deck/Sheet and workflow item/session/note components. Integration owner edits `WorkspacePage.tsx`, shell templates and global shortcuts.

### Implementation Steps

#### Numbered implementation

1. Keep one shared terminal manager or one manager partition per profile under a shared host; choose a single manager with owner-keyed maps to avoid duplicating shell/providers. Move its lifetime and `TerminalKeepAliveHost` above workspace mode/route content so IDE/terminals/Settings navigation does not remount healthy xterms. Key sessions, tabs, pins, mounted registry, activity, replay offsets, pending launch/removal, suppressed autoattach and local-stopped sets by TerminalRef; validate lifecycle by incarnation and ConnectionRef. Keep backend session IDs unchanged.
2. Render profile/project groups in runtime and traditional navigators, including owner-qualified free terminals. Every terminal carries profile badge and target label where ambiguity exists. `TerminalPanel`, runtime output, pane container, scroll/zoom buttons, mobile accessories and input handlers receive immutable owner/session refs. Capture one transport for attach/replay/input/resize; remove its ambient workspace-status/history calls. One xterm per TerminalRef; display shells move/hide/fit hosts rather than create parallel instances. B output must continue while A is focused.
3. Preserve tabs, active session, project group selection, split tree/docking, pins, floating/maximized selection and scroll/view state across IDE, traditional, Fleet/runtime, standalone terminals, floating and compact/mobile layouts. Owner-qualified storage keys exclude generation. `use-terminal-layout` must reload on actual key change or use an owner-keyed remount for presentation only, not the keep-alive host. Unavailable sessions remain visible with buffered output and disabled input. After reconnect attach to authoritative existing sessions; don't recreate a missing session automatically because it was in a layout.
4. Route build/run/custom/saved terminal profile/free-terminal launch, rename, restart, close/remove, kill, writes, resize and environment configuration to the initiating owner. Keep `terminal-target-identity` raw IDs, normalized worktree CWD and backend containment/env-file resolution. Distinguish frontend DamHopper profile from server saved terminal launch profile in types/labels. Disconnect/log out/remove connection performs local detach only; explicit terminal close/remove preserves current durable-close semantics and confirms owner, while kill retains existing tombstone behavior.
5. Reconnect clears only generation-bound subscriptions and credentials; preserve stable layout and reconcile incarnation before attaching. Old incarnation exit/output/disposer cannot erase newer owner state. Profile endpoint change detaches old tabs even if new endpoint exposes same ID; server root change retains orphan/target-unavailable display rather than silently relaunching. A→B focus does neither.
6. Scope command-history entries and per-project usage by profile; enablement/presentation preference may remain global. Keep verified submitted-command recording, bounded retention and replay suppression. Qualify suggestion controller, raw-key handlers, keyboard shortcuts, mobile accessory input and command-palette/new-terminal actions. Legacy history is quarantined for explicit owner assignment, not assigned to old active profile or copied into every profile. Do not export command history in diagnostics.
7. Qualify workflow overview/query/selection/focus/caches by profile and connection generation. Aggregate Fleet/context surfaces as profile groups with per-profile availability; item/project/session/execution/note references retain owning profile plus server-local ID. Scope mutation variables, request UUID/idempotency and optimistic CAS revision to original owner. Notes/drafts remain owner-local when focus changes or target is unavailable; conflicts refetch only originating profile. Do not merge histories, synthesize backend workspace IDs, or migrate workflow database.
8. Workflow terminal links navigate using profile + terminal ID + authoritative incarnation; unavailable/orphan links show reason and cannot redirect to B's same ID. Quick capture, create/edit/reorder/archive/restore, execution lifecycle, notes and target navigation all snapshot owner. A workflow endpoint 404 means that profile's workflow unsupported, not app-wide empty history. Backend history remains per server/configuration and duplicate profiles see the same remote history.
9. Add owner/generation to frontend notification and diagnostic records at creation. Notification rate keys, browser tags, DOM navigation and registry lookups use qualified terminal identity; click selects its profile/project/surface/pane without reconnecting. Preserve sanitization, limits, replay suppression and sound/browser permission rules. Browser notification metadata contains safe labels/opaque refs, never token, URL credentials, CWD, env values or command text.
10. Diagnostic export explicitly selects one owner (default originating surface), filters frontend logs and terminal IDs to it, invokes its backend, then downloads. A multi-profile export is explicit separate per-owner sections/files with visible partial failures, never an unlabelled merged bundle. Global local-only diagnostic entries may be included separately after existing redaction; ownerless legacy remote entries are excluded. Preserve existing terminal-output consent and server redaction. Settings export cannot accidentally inherit currently focused terminal from another profile.

### Todo list

- [ ] Same ID `shared-session` on A/B streams distinct markers concurrently; input, resize, close, kill and launch affect chosen owner only.
- [ ] A→B→A across every listed layout and Settings preserves xterms/layouts and unchanged remote session incarnation/PID; navigation emits no kill/remove/create.
- [ ] Offline/reconnect keeps buffers and reattaches correctly; stale callbacks cannot modify newer incarnation or other profile.
- [ ] History/suggestions, workflow IDs/notes and notifications with colliding IDs remain distinct; notification/workflow navigation reaches exact owner.
- [ ] Exports contain requested owner only and no bearer, passphrase, private key, env values or cross-owner terminal output.

### Success Criteria

Phase 04 checklist and S05/S06/S12 with unchanged remote PID/incarnation across navigation.

### Risk Assessment

Raw-ID collisions and keep-alive pruning can dispose the wrong xterm; qualify maps and reconcile incarnation.

### Security Considerations

Navigation/detach must never kill PTYs; exports/notifications cannot leak another owner’s content.

### Next steps

#### Verification and boundaries

Extend existing terminal manager/registry/output/keep-alive/layout/autoattach, workflow-queries/focus/surface, notification-navigation and diagnostics behavior tests. Live S05/S06/S12 provides visual and process evidence; no new backend terminal protocol, workspace identifier or database migration. Existing server PTY/workflow tests defend detach/kill/remove/incarnation/CAS semantics. Runtime footprint grows with intentionally open terminals, not all remote sessions: retain current mounted-session policy but make pruning owner-local and never evict a visible or explicitly retained terminal from another profile.


---

## Phase 05 — Agent tools, ports, Browser and capability isolation

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01–02 and TerminalInstanceRef contract.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Agents and Browser.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Owner-stable catalogs, imports, ports, Browser target and same-owner incarnation-safe handoff.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependencies, evidence and files

Consumes Phase 01/02 and TerminalInstanceRef contract from Phase 04 (implementation may proceed concurrently). Files: `components/pages/AgentStorePage.tsx`; StoreInventory, ItemDetail, DistributionMatrix, ShipDialog, HealthStatus, ImportDialog, MemoryEditor; `hooks/use-ports.ts`, `use-tunnels.ts`, `use-browser-debug.ts`, `use-browser-capture.ts`; PortsPanel, BrowserDebugPanel/CaptureControls/TerminalHandoff/IframeHost/KeepAliveHost, terminal runtime navigator components; `lib/browser-debug-origin.ts`, `browser-debug-host.ts`, `browser-terminal-handoff.ts`, `browser-debug-address-history.ts`, `browser-capture.ts`; `hooks/use-feature-flag.ts`. Foundation owner updates API/query groups; shell owner integrates WorkspacePage. Native Browser adapter work belongs to Phase 08.

Observed: agent item/matrix/project and import temporary paths are unqualified; memory editor defaults to first project. Ports merge by numeric port, tunnel callbacks omit owner. Browser hook has one target resolved against ambient tunnels; delayed create/upload/handoff can observe new focus. Bridge already validates exact origin/source/nonce/request IDs and bounded messages. Health endpoint reports only schema/status/version/role, not feature capabilities; `useFeatureFlag` is a placeholder returning true.

### Implementation Steps

#### Numbered implementation

1. Agent Store gets an explicit profile selector independent of project focus (initialise from selected project only when opening a new page context, never retarget an existing operation). Inventory, content, scan, health, category/item keys and distribution matrices remain server-local under that owner. Ship/unship/absorb/bulk ship accepts only projects from the item's owner. Do not invent cross-server distribution or merge same-named catalogs; mixed-owner target selection is invalid. Report per-target failures and refresh only the originating owner.
2. Import scan/confirm holds `{ConnectionRef, tmpDir, scanRevision}` from initiation. Repo URLs/local directory paths are evaluated by that server, not browser machine. Changing displayed profile parks/cancels the old dialog; no confirm can send A's tmpDir to B. Preserve existing server cleanup/retention semantics; do not invent an API to delete arbitrary paths. Memory/templates/apply/preview/save retain explicit owner/project/agent and dirty draft identity; arriving data for B cannot replace an A draft. Template preview is not a save.
3. Aggregate ports/tunnels by owner: detected-port identity `(profileId, port, terminalId, incarnation)` and tunnel `(profileId, tunnelId)`; distinct equal numeric ports get distinct rows. Reuse server-local numeric-port detection, owner rechecks and tunnel installation/platform constraints. Start/stop/install/kill session/open URL callbacks capture origin owner; manual ownerless tunnels still require an explicit profile. Event updates/invalidation affect only their profile generation. Local-server/address decisions take that profile's URL explicitly, not active state.
4. Browser selection is an explicit target `{owner: ConnectionRef, url, origin, source, tunnelId?}`. Keep logical target/address history/selection state partitioned by profile, but one visible physical iframe/native child lease. Selecting a project alone does not switch Browser target or destroy it. Explicit Browser target change destroys old trust/nonce/pending commands and capture streams before activating new target; a parked target requires a new handshake on resumption. Target/tunnel loss from B cannot invalidate active A. Preserve exact tunnel-origin/loopback/redirect and credential-free URL policy.
5. Terminal handoff choices include profile/project/worktree/session/incarnation. Only same-profile live terminal instances may receive the target's artifact; cross-owner handoff is rejected before create. Capture operation snapshots owner, Browser target revision and TerminalInstanceRef through selection → create → PNG upload → handoff. Check all three after every await. Stale artifacts are deleted through a narrow original-endpoint cleanup handle (Phase 07), not a newly resolved client. Stop stale screen streams immediately; keep existing secure-context, browser-surface, PNG byte/pixel bounds.
6. Keep profile IDs, server URLs, bearer tokens and routing decisions outside page/extension bridge messages. No generic native IPC is exposed. Existing exact schema, source/origin/nonce/request/generation checks and console redaction remain. Browser presentation viewport preference may stay device-global; selectable address history is owner-scoped and continues stripping query/hash. External page URLs never choose an API connection.
7. Fix the evidenced server artifact race: `server/src/api/browser_debug.rs:28–118` checks raw terminal ID at create and handoff; `server/src/browser_debug/store.rs` stores raw ID; `server/src/pty/manager.rs` has incarnation-bearing live sessions. Add optional `terminalIncarnation` to create request for old-client compatibility; new frontend requires it. Resolve concrete live incarnation on create, reject supplied mismatch (409 with existing structured API error shape), and persist authoritative incarnation in in-memory artifact metadata. Add PTY `write_if_incarnation(id, incarnation, bytes)` using the same locked/live-session write path as current write so lookup/check/write admission cannot target a replacement session. Handoff uses stored incarnation, releases handoff claim on failure, never falls back to ID-only. Add response `terminalIncarnation`; new frontend rejects old-server responses lacking it before upload/handoff. Preserve TTL, one-upload/one-handoff, private temp storage, payload bounds and no artifact read/list endpoint. No database migration or frontend profileId is sent. Preserve existing shared-server authorization rather than claiming profiles are actor-isolated tenants.

   Extend artifact metadata/response/error definitions in `server/src/browser_debug/mod.rs` and `store.rs`, frontend DTO in `api/client.ts`, and existing API error mapping for an incarnation conflict. The PTY helper must preserve current handoff/closing/disposing/input-revision guards and rollback-on-write-failure from `PtySessionManager::write`, not introduce a weaker second write path.
8. Feature availability is owner-local, derived from existing profile support status, server config features, endpoint-specific 404/structured unavailable responses and capability-bearing host/usage/Browser results. Replace placeholder-only gating where used; do not infer support from another profile or version string. Public health success is not authentication or feature support. Use explicit states unknown/loading/available/unavailable with reason; reconnect refetches. Distinguish auth/network/unsupported/target-unavailable from empty data. Do not add a broad capability API; media v2 and artifact-incarnation compatibility are explicit response contracts.

### Todo list

- [ ] Equal agent item/project names and temporary scan paths never cross servers; owner switch cannot save/import a stale draft into B.
- [ ] A/B identical port numbers and terminal IDs remain distinct; tunnel operations and Browser target resolution stay owner-bound.
- [ ] Project selection leaves Browser target unchanged; explicit target change invalidates capture/bridge state safely.
- [ ] Same-owner-only handoff and server-side incarnation check reject a reused terminal ID race without writing to replacement PTY.
- [ ] Offline/unsupported Browser/workflow/usage/host feature on A does not disable B or display B's cached data as A's.

### Success Criteria

Phase 05 checklist and S06/S08/S11.

### Risk Assessment

DOM or delayed capture must not select routing; old raw terminal ID can refer to a replacement PTY.

### Security Considerations

Preserve bridge origin/source/nonce checks, PNG bounds and server authorization; atomic incarnation write required.

### Next steps

#### Verification and risks

Live S06/S08 plus existing agent/ports/Browser/handoff/capture/origin tests. Extend `server/tests/browser_debug_artifacts.rs` with create on incarnation N, replace same ID with N+1, handoff denied and N+1 input unchanged; include a race at write admission, not merely two separate is_alive calls. Run bridge/extension security regressions unchanged where possible. No expansion of pre-existing tunnel-port safety policy or cross-actor tenancy in this refactor; document duplicate-profile shared authority and preserve current server permission checks.


---

## Phase 06 — Preference source, Settings target, usage and host resources

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Settings and host.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Separate preference source, Settings target and focused resource; host and usage remain server-local.

### Architecture

#### Exact semantics

- `preferencesProfileId` chooses the single source of workbench appearance, fonts, shortcuts, notification preferences, terminal suggestion/display preferences, explorer presentation and mobile keyboard settings already in `PersistedSettingsState`. It does not choose the backend for other actions.
- `settingsProfileId` chooses the server whose global/workspace configuration, setup, maintenance, usage integration and host policy are being edited. Changing it does not change loaded workbench preferences.
- Resource ordering (`projectOrder`, `terminalOrder`, `projectCommandOrder`, `runtimeGroupOrder`, `runtimeItemOrder`) and `hostResourcePinnedMount` remain stored in each owning server's existing UiConfig, using its existing local resource IDs. Read/apply each server's arrays only within that profile group; never copy them from preference source to all servers. Cross-profile group order stays browser-local presentation state. Dragging an item across profile groups cannot move a remote resource or rewrite another server's ordering.
- Usage is profile-targeted, not automatically summed across profiles; duplicate endpoints could double-count. Host status/alerts show one labelled host per profile or explicitly selected profile, never averaged CPU/memory/free space/fleet. Duplicate profiles may describe the same host.

### Related code files

#### Dependency, source and files

Depends on Phase 01/02 contracts. Settings owner edits `stores/settings.ts`, `components/pages/SettingsPage.tsx`, `components/pages/settings-page/*`, GlobalConfigEditor, ConfigEditor, SettingsAppearanceSection, SettingsKeyboardShortcutsSection, SettingsUsageInsightsSection/CodexRow, SettingsIdleSuspendTimingSection, `components/pages/UsagePage.tsx`, `components/usage/*`, HostResourcePopover/Glance/Diagnosis/StorageDetails/IncidentDetails, HostIdleSuspendStatus, ForceSleepDialog, `hooks/use-host-resource-alert-presentation.ts`, `lib/host-resource-state.ts`. Foundation owner updates corresponding query/API methods; shell owner integrates host selector/summary and per-owner ordering consumers.

Observed `stores/settings.ts:73–106,116–124,218–263,374–416` has a UI-preference allowlist but a global debounce/save chain that calls ambient API. Host pinned mount is written through `useUpdateUiConfig`; `UiConfig` also contains raw project/terminal/runtime orders. Settings file import awaits `file.text()` before mutation; confirmation currently names only active workspace. Usage page/query keys omit owner; host metrics/alerts/idle-suspend status do likewise. `ForceSleepDialog` is host-wide and carries fleet/revision semantics; no new process-management API is required.

### Implementation Steps

#### Numbered implementation

1. Hydrate preference source through captured ConnectionRef with owner/generation fencing. Keep last successful allowlisted snapshot offline; first load without a chosen source uses local defaults with visible source-unset status. Disable remote preference saving while unavailable. Source change is explicit: flush an already-dispatched old-source save only to that source, cancel undispatched debounce, preserve unresolved draft/error, then load new source. Never reroute pending patches or use first healthy server.
2. Partition debounce timer, edit revision, pending patch and save chain by selected source transaction; capture the bound client at edit scheduling. Keep current clamp/merge/rollback behavior, but late rollback can alter only that source/revision. Persist source choice and last successful non-secret preference snapshot locally; no remote resource identifiers/secrets in shared snapshot. Do not let settings-target config fetch overwrite workbench preferences unless that target is the chosen source and the user edits its preference allowlist.
3. Add persistent labelled Settings target selector and separate preference-source control. Pass explicit owner to ConfigEditor, GlobalConfigEditor, server configuration selection/setup, workspace discover/init/known list/switch, project CRUD and environment/launch-profile editors. Display server URL/configuration name before write. Configuration switch may have existing server-local destructive effects; confirm them for the owning server and invalidate/revalidate only that profile. It is never invoked by project navigation.
4. Settings export binds request and filename context to target. Import captures target/generation before confirmation and `file.text()`, preserves 1 MiB limit and server backup/validation, rejects stale target before dispatch and labels result with original owner. Clear cache/reset actions operate on selected server only; frontend cache clearing filters that profile. Reset's kill/dispose behavior is explicit in confirmation and is not a connection-management action. Tests must delete obsolete wording-only assertions rather than re-pin them.
5. Usage health/settings/setup, summary/trends/coverage, sessions/detail/audit, pause/resume/configure, data/range deletion and Codex integration all take explicit profile owner. Deep links include profileId. Codex files/collector endpoints and telemetry retention are server-local; never apply preference-source configuration to another server. Destructive actions snapshot owner plus selected range and do not retry after uncertain completion.
6. Host metrics/resource snapshots/alerts/incident history/storage/pinned mount/presentation state key by profile and generation; events patch matching owner only. Keep metric-specific availability/staleness and Linux-deep-metric limitations. Pin a mount only on its server. Per-profile suspend status/timing/fleet refresh use existing capabilities and revisions, not aggregate fleet counts.
7. Force-sleep/power/process-affecting existing actions bind a complete intent before dialog: owner, endpoint label, host snapshot/revision/fleet and request ID. A generation/endpoint/auth change invalidates confirmation. Recheck server revision/conflict response and require refreshed confirmation; never retry ambiguous POST. Keep enabled database-backed actor requirement, no-auth rejection, exact origin policy and all backend inhibitors/executors. User may keep A's labelled dialog while navigating B, but submission still targets A; no implicit retargeting. No new reboot/shutdown/process-kill endpoints are added.
8. Logout/removal of preference source retains last known presentation and marks unavailable; removal of settings target clears target selection and requires explicit replacement. Local keyboard shortcuts route actions using focused resource owner, not preference source. Shared profile labels are safe metadata; credentials and host-sensitive configuration remain outside diagnostics unless existing consent/redaction allows them.

### Todo list

- [ ] Preference source A, Settings target B, project C coexist; each read/save goes to its intended server.
- [ ] Delayed preference save/import/config update cannot reroute after focus/source/target change; outages retain last snapshot and disable saves.
- [ ] Server-local ordering, pinned mount and Codex/usage settings never propagate from preference source.
- [ ] Host statuses/fleet/revisions remain distinct; duplicate profiles are not summed or presented as distinct physical machines.
- [ ] Destructive confirmation names original owner, rejects stale generation/revision, and has no automatic replay.

### Success Criteria

Phase 06 checklist and S09/S10/S11.

### Risk Assessment

Global debounce/import state can reroute saves; duplicate profiles must not produce false aggregate host/usage totals.

### Security Considerations

Power/process checks use fakes; existing actor/origin/fleet/revision/inhibitor guards remain intact.

### Next steps

#### Verification and safety

Live S09/S10 verifies preference/config/import/export/usage isolation using temporary servers. Existing settings, usage, host resource and ForceSleepDialog tests cover meaningful state/behavior; extend stale-owner/debounce/import races and per-profile alert isolation. Host suspend/power/process execution is tested only with existing fake executors/in-process test fixtures or a browser transport test adapter; never call a real machine power action, kill an unrelated process or mutate developer Codex/config files. No host permission/backend authorization relaxation is in scope.


---

## Phase 07 — Media session isolation and encrypted-write ownership

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01 runtime and Phase 03 target contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Media and encryption.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Concurrent cookie-isolated media and generation-bound encryption without protocol/authorization downgrade.

### Architecture

#### Exact media v2 wire contract

Add optional `mediaClientId` UUIDv4 to image/video issue and ticket-revoke JSON, and optional JSON body `{mediaClientId}` to existing media-session DELETE. Absent field/body preserves existing v1 behavior for old clients; supplied invalid UUID is rejected, never interpreted as v1. New frontend always supplies a random in-memory UUID per ConnectionRef, not profileId. V2 issue response keeps existing fields and returns `authorizationMode: "session-cookie-v2"` (v1 response unchanged). No new persistent table, public profile ID or authentication authority.

Cookie name is `damhopper-media-session-<canonical UUID>`, preserving existing Path/HttpOnly/SameSite/secure policy. Give v2 cookies an explicit Max-Age no longer than the existing eight-hour absolute server session TTL so abandoned namespaces also expire browser-side; v1 stays unchanged. Store namespace in `MediaSessionBinding` and `StoredMediaSession`; ticket binding selects the one trusted cookie name during stream authorization. Never authorize by arbitrary cookie/header namespace alone. Require existing bearer actor and namespace match for issuance/reuse; duplicate-cookie parsing still fails closed for the selected name. Preserve ticket incarnation, exact target/file-version revalidation/finalization, range/HEAD behavior, caps and TTLs.

V2 ticket revoke requires captured bearer actor + namespace + ticket ownership. V2 session DELETE revokes only sessions/tickets for `(actor.subject, mediaClientId)` and clears only that namespaced cookie; it does not require a returned third-party cookie, so existing allowed-origin ticket fallback can be reliably revoked. Other actors/namespaces cannot be revoked. Existing v1 actor+cookie behavior and logout's fixed-cookie cleanup remain available for old clients. Namespace is a routing discriminator, not a replacement for bearer authentication or a new tenant boundary.

### Related code files

#### Dependency and files

Consumes Phase 01 bound transport and Phase 03 target/tab contracts; can develop concurrently with feature UI after contract freeze. Security/media owner edits `api/image-tickets.ts`, `video-tickets.ts`, media-session helper, `lib/start-video-download.ts`, ImagePreview/VideoPreview, `contexts/EncryptContext.tsx`, `hooks/use-encrypted-write.ts`, `lib/opaque-session.ts`; backend `server/src/fs/media_session.rs`, `fs/media_ticket.rs`, `api/fs_image.rs`, `api/fs_video.rs`, `api/media_session.rs`, `api/media_stream_response.rs` and corresponding existing media tests. Foundation owner integrates captured cleanup handle and transport cancellation.

#### Source justification

Ordinary auth prefers bearer then fixed `damhopper-auth` cookie. Media uses fixed `damhopper-media-session`, Path `/api/fs`, HttpOnly, SameSite=Lax; stream authorization uses actor/session-bound ticket and only exact configured-origin ticket fallback. Cookies are hostname/path scoped, not port scoped. Thus two real servers on localhost different ports, or two profiles to one server with different credentials, overwrite media state. Frontend map scoping alone cannot satisfy simultaneous preview/logout isolation. Existing helpers capture origin/token for revoke, which must be retained and strengthened. Encryption currently caches by bare project and reacquires global transport between OPAQUE handshake and encrypted upload/save (`use-encrypted-write.ts:106–174,203–232`).

### Implementation Steps

#### Numbered implementation

1. Ordinary login/status/config/REST/PNG requests use explicit bearer where required and `credentials: omit`; authenticated WS always carries captured token, never relies on shared cookie. No-auth profile obtains existing dev token through its bound login flow. Do not change backend general bearer/cookie compatibility or broaden CORS. Media v2 issue requests are the narrow `credentials: include` exception needed to accept/send their namespaced cookie, always with explicit captured bearer so ambient auth cookie cannot select actor. Revoke may include credentials to clear its cookie but authorizes by bearer+namespace.
2. Add namespace-aware media store methods and cookie parsing; keep v1 code paths explicit. Serialize ticket issuance per runtime to prevent concurrent initial responses replacing a just-created same-namespace cookie before use. Existing store caps/TTL remain, and retirement schedules best-effort namespace revoke. If third-party cookies are blocked, preserve only existing exact-origin ticket fallback, not a new wildcard/cookie bypass. Browser host/port cookies may be transmitted together; each server consumes only the trusted ticket namespace and actor binding. HTTPS/trusted-network guidance remains.
3. Ticket helpers require ProjectTargetRef and ConnectionRef; obtain immutable endpoint/token/namespace and validate v2 response before using stream URL. Old backend 422/unsupported mode marks media unavailable for that profile with upgrade guidance; do not silently downgrade to collision-prone v1. Other features stay usable. Do not add namespace/auth tokens to DOM bridge messages, localStorage, logs or diagnostics.
4. Define a narrow `RemoteCleanupHandle` captured when creating remote ephemeral media/artifact resources: immutable endpoint/credentials plus exact allowed ticket/artifact/session identifiers, bounded five-second cleanup request, no retry and no general invoke/write access. It may revoke/delete the original ephemeral object after generation retirement; it cannot update caches, create resources or dispatch to replacement endpoint. Runtime retirement first disables new work and invalidates generation, aborts ordinary pending calls, then best-effort cleans known leases with this handle and destroys transport. Stale successful issue/create response uses original cleanup handle; if server is unreachable, existing TTL removes it. Logout/removal never revokes another profile's v2 namespace.
5. Bind ImagePreview/VideoPreview/download to original tab target and namespace. On explicit owner retirement detach media URLs and release owned leases; ordinary project focus changes do not revoke valid A tickets. Keep image/video limits, MIME checks, ticket timing and browser-managed downloads; don't revoke a download immediately after click. A logout can revoke A's active download as expected, never B's.
6. Encryption maps/prompts/in-flight dedup use project-qualified owner + generation; worktree target remains attached to each write while project-level lock preference is owner-qualified. Queue passphrase prompts with explicit profile/project labels (or deduplicate exact same owned request), rather than replacing A's resolver when B prompts. Never persist passphrases/OPAQUE session IDs/AES keys. On lock/disconnect/logout/URL/token/generation change cancel prompts and invalidate only that owner's cache/in-flight entries; zero mutable key buffers before release, acknowledging immutable JS strings cannot be reliably wiped.
7. Capture one WsTransport, owner, exact target, passphrase/session and operation revision before OPAQUE register/login; use the same transport for encryption/upload/save after awaits. Freshness checks after handshake and WebCrypto completion prevent upload with a stale session. Give each owned project-generation handshake a collision-free random OPAQUE identifier instead of relying on sanitized/truncated bare project names; preserve existing register/login and cryptographic derivation/protocol. No server cryptography redesign. A stale handshake must not repopulate cache after lock; zero its result. Failed/stale A operation cannot clear B's session or passphrase.
8. Preserve fs streaming/encrypted write containment, target unavailable errors, conflict/mtime and progress semantics. Never downgrade a failed encrypted save to plaintext, reuse A's session on B, or auto-replay a partially uploaded write after reconnect. Dirty content survives failure and shows original owner/unknown outcome where relevant.

### Todo list

- [ ] Same-host different-port A/B and duplicate same-origin profiles preview concurrently without cookie overwrite; logout/revoke A leaves B usable.
- [ ] v1 old clients still work against upgraded server; new client refuses unsafe v1 media on old server without blocking shell/files.
- [ ] Wrong actor/namespace/cookie/expired ticket/file version/worktree target fails closed; exact-origin fallback unchanged.
- [ ] Stale ticket/artifact cleanup uses original endpoint only; unreachable cleanup is bounded and relies on TTL.
- [ ] Same-name projects on A/B have separate encryption prompts, keys and sessions; generation change between handshake and save prevents dispatch.

### Success Criteria

Phase 07 checklist and S07/S11, including real cookie and blocked-third-party-cookie behavior.

### Risk Assessment

Same-host cookies collide despite different ports; stale handshakes/cleanup need original-owner fencing.

### Security Considerations

Namespace supplements bearer/session authority; keep exact-origin fallback, sandbox and cryptographic protocol.

### Next steps

#### Verification and risks

Live S07/S11 must exercise real cookies/media elements on same hostname different ports and duplicate same-origin credentials, including blocked third-party cookies and original-origin revocation. Extend media session/ticket/API/browser regressions for namespace collisions, concurrent issue ordering, stale cleanup, actor mismatch and v1 compatibility. Extend encryption context/write tests for lock-during-handshake and owner change between awaits; keep actual crypto/sandbox server tests. Cookie count and abandoned namespace leases remain bounded by serialized issue, retirement cleanup, existing store capacity/TTL and browser cookie expiry; don't increase limits merely to hide leaks. No secrets in captured evidence.


---

## Phase 08 — Native scope concurrency and platform integration

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: Phase 01–02 and Phase 05 Browser target contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Native scopes.

### Key Insights

#### Evidence

`SshForwardHostContext.tsx:60–210` activates on active profile and calls `openClient` again on list changes. `manager.rs:935–979` open_client advances true client epoch and intentionally stops all workers/connections/secrets. `activate_scope:981–1126` stops all on scope switch and failure; `checked_scope:5133–5153` accepts only one active scope. `commit_scope:5220–5242` discards other scope secrets. `ConnectionRegistry` stores `HashMap<String, ConnectionEntry>` by connection-profile ID, while snapshots filter scope; equal imported IDs could collide. Existing 16-live-connection/64-enabled-rule bounds must remain global. SSH implementation and Tauri permission are Windows-only (`ssh_forward/mod.rs:8–48,90–97`); this plan does not broaden platform access.

### Requirements

Concurrent Windows SSH scopes with scoped teardown, preserved true epoch teardown and unchanged platform limits.

### Architecture

#### Proposed native contract (complete cutover, no active-scope shim)

Keep `DesktopClientContext` desktopInstanceId/managerSessionId/clientEpoch. Replace global activation with explicit per-scope context:

```ts
interface NativeScopeRef {
  context: DesktopClientContext;
  scopeId: string;
  scopeGeneration: WireCounter;
  activationToken: WireCounter; // monotonic within this scope + client epoch
}
interface OpenClientResult { context: DesktopClientContext }
interface ScopeHandle { ref: NativeScopeRef; snapshot: SshForwardSnapshot }
openClient(knownScopes: KnownScopesInput): Promise<OpenClientResult>;
openScope(scopeId: string): Promise<ScopeHandle>;
closeScope(scope: NativeScopeRef): Promise<void>;
reconcileKnownScopes(knownScopes: KnownScopesInput): Promise<void>;
```

All existing snapshot/configure/connect/disconnect/rule/key/password/host-approval/repair/forget/export/retention operations receive NativeScopeRef explicitly (or a bound per-scope facade holding it). Choose explicit first argument in the shared `SshForwardHost` interface; native adapter owns token/revision advancement and returns refreshed refs/snapshots. Scope activation token supersedes only pending operations for that scope. Commands validate full client context, scope membership/token/generation, existing revisions, connection/rule generation and policy. Preserve strict decimal WireCounter validation/overflow rejection. `reconcileKnownScopes` validates global client context, never advances epoch and cannot represent unavailable storage as an empty list.

### Related code files

#### Dependency and exact boundaries

Consumes Phase 01/02 contracts and Phase 05 Browser target contract; native scope core can develop independently of feature UI. Native owner edits `apps/native/src/native-ssh-forward-host.ts`, `native-browser-debug-host.ts`, corresponding tests; `packages/ui/src/lib/ssh-forward-host.ts`, `contexts/SshForwardHostContext.tsx`, `hooks/use-ssh-forward.ts`, `use-ssh-forward-page-controller.ts`, SSH forwarding page/dialog consumers; Rust `apps/native/src-tauri/src/ssh_forward/{manager,connection_runtime,model,commands,instance,scope_retention,store,credential_lease,credential_vault,known_hosts,trust_repair}.rs`, command registration in `src/lib.rs`, `ssh_forward/command_names.in.rs`, permissions/capability manifests where command names change. Store/credential/trust persistence formats remain unchanged unless compilation exposes a strictly necessary wire representation change; no re-enrollment/rekeying migration.

### Implementation Steps

#### Numbered implementation

1. Replace `active_scope: Option<ActiveScope>` with live-scope map and per-scope generation/token tombstones for current client epoch. Scope staging loads the existing store/activity lease/trust/revisions and commits only that scope under command/admission gates. Same-scope open is idempotent when current; close invalidates scope admission before teardown. Failure while staging or starting A cleans A only, never B. Refactor `checked_scope`, `ensure_context`, admission/intent checks and commit helpers accordingly; don't merely delete stop_all calls and bypass authorization.
2. Key runtime/abort/retry/challenge/connection entries by `(scopeId, connectionProfileId)` and children by their owning connection plus ruleId. Existing loaded key/password maps already use scope+profile; preserve and clear selectively. Scope workers/events/snapshots carry scope generation and filter late completions. Global limits, local TCP bind exclusivity, global admission/lifecycle locks and shutdown cancellation remain global, so A/B same local port fails deterministically rather than stealing binding. Do not multiply limits per scope.
3. Add scoped stop-workers/stop-connections/clear-live-secrets helpers. Explicit profile Disconnect/Logout/Remove closes only associated native scope; transient backend WS outage/reconnect or project focus does not stop independent local forwards. URL/auth replacement retires that profile's native scope and requires normal re-open admission. A deleted-scope purge requires not-live/not-pending plus existing tombstone/retention/lease checks; remove only its vault/trust data. Storage unavailable pauses deletion reconciliation, never purges unknown scopes.
4. Preserve true epoch/global teardown: app reload calling openClient, manager-session change, desktop identity change, real shutdown/dispose and force-close cancel all scopes/workers/connections and clear all live secrets. Do not auto-replay native mutations across epoch change. Snapshot rehydration may retry as an explicit read only after new context; an ambiguous connect/trust/credential mutation requires reconciliation, not blind replay. Cross-window/Tauri main-label checks stay mandatory on every new command.
5. Update TS host adapter to maintain Map<scopeId, ScopeHandle> and per-scope command queues/revision refresh, not one ambient active context. Shared context opens client once per real lifetime, reconciles known scopes without epoch reset, and opens/closes scopes according to explicit connection intent. UI SSH page profile selection only picks displayed snapshot. Dialogs capture full NativeScopeRef for host-key approval, password/key load, connect and rule writes; selection changes do not reuse challenge/credential attempt IDs across scopes.
6. Update Rust serde inputs/responses and command names atomically with TS types/validation, Tauri invoke registration and `permissions/ssh-forward.toml`. Add open/close/reconcile commands; remove obsolete activate-scope command. Preserve Windows-only `capabilities/ssh-forward.json`, main-window labels, no browser-debug-child/native mobile access, DPAPI/vault/ACL/storage/trust checks, secret redaction and bounds. Existing store schema/UUID scope aliases remain authoritative. DamHopper profile IDs map through current scope alias resolution, not by guessing a new vault directory.
7. Native Browser remains one child WebView, matching controller `active: Option<ActiveBrowser>` and fixed child label. `native-browser-debug-host.ts` receives explicit Phase 05 target owner, never `getActiveProfileId`. Project focus does not call setTarget. Explicit Browser target change destroys/leases child trust safely, preserves per-profile storage partition and removes stale relay callbacks. Do not expose auth tokens or generic Tauri IPC; capture/console unsupported capabilities remain unsupported in native v1. Target disconnect removes only that target's physical child state; unrelated profile connection changes do not.
8. Bootstrap remains shared UI orchestration, not a native-only second connection manager. Preserve current transport matrix: web and Windows HTTP(S) profiles; non-Windows native exact same-origin transport restriction with explicit unsupported rows/no fallback traffic. Browser child: Windows supported, Linux implemented/experimental with runtime proof required, macOS unsupported, Android iframe fallback. SSH forwarding: Windows only. Do not claim Linux build validates Windows manager code gated by cfg(windows).

### Todo list

- [ ] Windows A/B forwarding scopes stay concurrently live through project/Settings/SSH-page focus changes; same imported connection/rule IDs cannot collide.
- [ ] Closing/deleting/failing A leaves B forwards, credentials, trust and timers intact; global port/connection/rule limits still enforced.
- [ ] Stale scope token/generation/client epoch, wrong window, wrong manager or desktop identity remains rejected.
- [ ] Real client-epoch change and shutdown still stop every scope and clear live secrets.
- [ ] Non-Windows SSH and unsupported transport/Browser capabilities remain explicit unavailable, never insecure fallback.

### Success Criteria

Phase 08 checklist and S13 on Windows; Linux build cannot substitute for cfg(windows) runtime proof.

### Risk Assessment

Removing stop_all calls alone would bypass scope admission; maps, tokens and lifecycle must change together.

### Security Considerations

Keep Windows/main-window ACL, vault/trust, revision/generation checks, global quotas and real epoch shutdown.

### Next steps

#### Verification and risks

Windows runtime gate S13 uses disposable SSH endpoints with distinct markers, two scopes, equal IDs and conflicting local-port negative test; existing SSH manager/registry/host tests gain scoped teardown and epoch negatives. Run native TS tests/build everywhere supported; Windows Cargo tests are required for Windows-only modules. Existing `smoke:ssh-forward`/evidence validation is not itself runtime proof: record actual forward traffic, scope changes, teardown and security failures, then validate artifact-bound evidence. Current planning workstation is Linux; Windows runtime verification must be performed on a Windows runner/device, not marked passed from this host. Native Browser gate preserves documented WebView2 evidence; Linux runtime must remain explicitly unverified until exercised. No real user keys/trust stores used in qualification.


---

## Phase 09 — Integration and end-to-end qualification

### Context links

[Overview](local://unified-multi-profile/plan.md) · [Canonical plan](local://unified-multi-profile-plan.md) · [Contracts](local://multi-profile-contracts.md) · [Coverage](local://unified-multi-profile/coverage-and-decisions.md). Dependency: All phases; final integration and qualification gate.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning review: complete; runtime verification: not run. Scope: Qualification.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Complete atomic cutover with real two-server UI/remote-effect evidence and no unsafe host actions.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and release gate

All phases. Integration owner accepts feature patches against frozen contracts, removes obsolete ambient paths, then enables multi-profile startup in one complete release. No phase is independently advertised as multi-profile complete. Planning has run no application tests, migrations or services; every command/scenario below is future implementation verification.

#### Disposable two-server fixture (real runtime, not mocked API)

Create a throwaway fixture under a unique temporary directory during implementation verification, never in the user's workspace/config. A fixture manifest records generated absolute paths and process handles; no bearer/password logging.

- A: `http://127.0.0.1:14801`; B: `http://127.0.0.1:14802`; frontend: `http://127.0.0.1:15173`. Reserve/check availability first, choose another documented port triplet if occupied; never terminate unrelated listeners.
- Both expose project named `web`, same relative paths `src/marker.txt`, image/video names and Git branch/worktree/submodule names, and terminal ID `shared-session`; contents/output distinguish `SERVER_A` and `SERVER_B`. Separate real Git repositories, configured absolute roots and worktrees, separate bare Git remotes for push/pull tests. Create marker files, a small/large text file, HTML/Markdown, known-good PNG and WebM copied from existing media browser fixtures.
- Each process gets distinct HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, TMPDIR, global registry/config, agent-store root, session DB and telemetry DB; preserve only required executable/library environment. Set explicit `--config`, run binary with cwd inside its fixture (main loads dotenv), strip inherited DAM_HOPPER_*, MongoDB and production variables unless explicitly supplied. Do not use repo `.env` or real SSH/Codex config. Separate JWT secret files are generated under isolated config dirs.
- Fixture TOML includes `[workspace] name="Fixture A"` / B, `[[projects]] name="web", path="<absolute owned repo>", type="custom"`; `[server] session_db_path="<own sessions.db>"`; `[server.telemetry] enabled=false, db_path="<own telemetry.db>"`; `[server.telemetry.collector] enabled=false, host="127.0.0.1", port=14811` / 14812; `[server.idle_suspend] enabled=false`. Give agent store a fixture-only path using existing config format. Enable telemetry only for S09 with distinct collector ports; no real provider secrets or external traffic.
- Build once using `cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server`; launch resulting absolute binary twice with `--host 127.0.0.1 --port 14801|14802 --config <own config> --cors-origins http://127.0.0.1:15173`. Use supervised process handles and wait for `/api/health`, then authenticated `/api/projects` proving `web` maps to the expected absolute root. Readiness log alone is insufficient.
- Authentication gate uses disposable MongoDB, not a guessed fallback token: `auth.rs` login verifies enabled DB users. Use a loopback-only disposable Mongo container/service with isolated databases A/B, set `MONGODB_URI` and `MONGODB_DATABASE` per server. Register temporary credentials through `/api/auth/register`, enable only those fixture users via Mongo `users.isEnabled`, then log in through actual UI/API. A second enabled actor in A's database supports same-origin/different-credential duplicate-profile media testing. Passwords/tokens exist only in fixture memory/browser test profile; never commit or include in evidence. Container runtime availability must be established during execution; tools were located during planning, no container was started.
- Separate no-auth gate restarts fixture servers with Mongo/prod variables absent and `--no-auth`; profile authType none obtains existing dev JWT. Do not claim no-auth checks prove authentication isolation, and do not use no-auth for host power acceptance.
- Start frontend with `pnpm --filter @dam-hopper/web dev --host 127.0.0.1 --port 15173 --strictPort`; unset production/managed VITE_DAM_HOPPER_SERVER_URL overrides so two explicit profiles aren't reconciled away. Use fresh browser context on that exact origin. Runtime manager/profile records use actual A/B URLs, not proxy aliases.
- Create both PTYs via existing authenticated `POST /api/terminal`: same `{id:"shared-session", project:"web", command:<fixture marker/echo loop>, cwd:<own root>, cols:80, rows:24, env:{}}`. Fixture command prints server marker plus its PID, accepts an input line and echoes owner-tagged acknowledgement, periodically emits output. Record authoritative incarnation and printed PID; never issue host process kill. Additional build/run/profile launches are generated through UI. Teardown uses only owned process handles and fixture session IDs.

Concrete Linux PTY fixture: write `terminal_fixture.py` in each temporary root, set request env `FIXTURE_MARKER=SERVER_A` or `SERVER_B`, and command `python3 -u <absolute fixture path>`. Its loop uses only the owned PTY, not host power/process controls:

```python
import os
import select
import sys

marker = os.environ["FIXTURE_MARKER"]
print(f"{marker} pid={os.getpid()}", flush=True)
while True:
    ready, _, _ = select.select([sys.stdin], [], [], 1.0)
    if ready:
        line = sys.stdin.readline()
        if not line:
            break
        print(f"{marker} input={line.rstrip()}", flush=True)
    else:
        print(f"{marker} heartbeat", flush=True)
```

### Implementation Steps

#### Integration sequence and ownership

1. Foundation owner freezes `ownership.ts`, runtime lifecycle, bound API signatures, query/event factories and cleanup handle. First milestone is contract availability; full Phase 01 acceptance is reached only after callers and shell integrate. Existing single-profile code may remain untouched while slices are being developed, but no compatibility accessor may dispatch implicitly and no concurrent connections are enabled until migration is complete.
2. In parallel after freeze: files/search/Git (03), terminals/workflow (04), agents/ports/Browser (05), settings/host (06), media/encryption/backend (07), native (08). Phase 02 shell/profile work proceeds under integration owner. Native Browser depends on the Browser target contract, not finished UI; media depends on the target contract, not finished editor. Server Browser incarnation and media changes own disjoint backend modules except any shared error/router edits, which backend integration owner serializes.
3. Single-writer shared boundaries: `api/client.ts`, `api/queries.ts`, `api/workflow-queries.ts`, `hooks/use-sse.ts`, `api/connections.ts`, `api/server-config.ts` belong to foundation/integration owner; `WorkspacePage.tsx`, app embed, TopNav and both bootstrap files to shell/integration owner. Feature owners submit exact signature/prop/query changes, not concurrent edits. Rust PTY write helper belongs to Browser backend owner; media backend owner does not edit it. No universal provider per profile, duplicate query clients or second ownership encoding.
4. Foundation owner migrates every exported caller, tests and hosts together; use LSP references where available (none configured during planning), otherwise exhaustive scoped import/symbol searches plus TypeScript compile. Reject zero-argument API/transport/auth/header/server-URL access outside private legacy migration; reject dynamic active-profile query hashing, unqualified remote events/caches and global connection-triggered query reset. Inspect indirect callbacks, dialogs, timers, retries, cleanup and user-supplied deep links, not only direct imports.
5. Integrate backend compatibility before frontend requires media v2/incarnation acknowledgement. Existing server workspace registry, filesystem sandbox, auth authority, WS payload identifiers, PTY persistence and workflow database remain unchanged. Native IPC is bundled with its frontend and cuts over atomically, no legacy activateScope shim. Browser-local migrations are versioned/idempotent and retain unresolved legacy backups; no server schema migration.

### Todo list

- [ ] All feature matrix rows have implementation owner, contract, scenario and actual evidence.
- [ ] Two real servers satisfy same-name/ID collision, independent auth and stale-generation checks.
- [ ] Browser UI and remote file/PTY effects agree; required native runtime proof is recorded separately.
- [ ] No real host power/process action or developer config/credential mutation occurred during qualification.
- [ ] All affected callers/tests/docs migrated; no ambient remote authority, obsolete switch/reload path or permanent shim remains.
- [ ] Product behavior is complete before release; unsupported platforms/features are explicit, not fake success.

### Success Criteria

Every S01–S13 and matrix row has actual evidence or an explicitly blocked platform gate; no partial release claim.

### Risk Assessment

A passing compile or mock suite does not prove continuity/auth/cookie/native behavior; run named scenarios.

### Security Considerations

Temporary homes/configs/DBs/credentials only; power/process execution faked; sanitized evidence only.

### Next steps

#### Live scenarios and observable proof

| ID | Actions | Required observation |
|---|---|---|
| S01 Connections/auth | Boot A valid, B logged out, third saved profile autoConnect=false, fourth unreachable. Login B, connect/disconnect explicitly, edit inactive profile, logout A, reload. | Shell always usable; B independent; no autoConnect=false traffic; legacy profiles default true; editing does not reload app; A logout doesn't invalidate B. Tokens never sent to other endpoint, keys contain no token. |
| S02 Navigation/identity | Same project name/paths on A/B; switch project picker repeatedly, open qualified deep links and an ambiguous legacy link; select empty/unsupported profile. | Grouped profile→project identity and URL/path labels; stable sockets/resource owners; no workspace:switch, auth change or implicit first-project fallback; legacy link asks owner selection. |
| S03 Files/editor/uploads | Open A/B equal file paths, make A dirty, select B, save A, upload to A while focusing B; rename/delete A target; exercise large/binary/HTML/Markdown. | Distinct Monaco models/view state; only A filesystem changes; dirty B untouched; A target-unavailable doesn't affect B; previews remain sandboxed and owner-bound. |
| S04 Search/replace/Git | Federated root search with shared needle, B offline/slow; cancel/new query, exceed cap; replace selected A/B matches with dirty-file conflict. Create equal worktrees/submodules; stage/commit/push selected A and authenticate failed B bulk target. | Partial labelled results/truncation; stale results suppressed; exact per-file replace outcomes; no undisplayed writes; root/worktree/submodule scopes preserved; successful bulk A is not replayed when retrying B. |
| S05 Terminal continuity | Stream shared-session on A/B; type/resize each. A→B→A through IDE/traditional/Fleet/runtime/floating/maximized/standalone/compact and Settings; disconnect/reconnect A; close/kill a fixture terminal explicitly. | Owner-specific acknowledgements and continuous other-owner output; same printed PIDs/incarnations through navigation; layout/pins restored; no navigation-triggered create/kill/remove; close/remove and kill retain distinct semantics. |
| S06 Workflow/agents | Create same-named workflow items/sessions/notes on A/B; navigate terminal link while B selected; edit A note during B navigation. Ship/unship item in A, scan import in A then display B, edit separate memory drafts. | Histories/UUIDs/targets/notes remain owner-bound; link reaches A incarnation; unavailable links stay unavailable; A scan tmpDir never confirmed on B; distribution never crosses server catalogs. |
| S07 Media/encryption | Preview/download A/B same image/video path concurrently on same hostname different ports. Add A2 pointing to A with second actor. Logout A; block third-party cookies and test exact-origin fallback. Start encrypted A save, switch B; lock/reconnect A during handshake. | B/A2 media remains usable; A namespace revoked; wrong actor/namespace denied; no unsafe old-server downgrade; encryption prompts/keys/session IDs never shared, stale handshake cannot upload or repopulate cache. |
| S08 Ports/Browser | Expose same port numbers in isolated network namespaces/hosts where needed; otherwise use seeded detector fixture for collision and real distinct ports for traffic. Open A loopback/ready tunnel target; select B project, then explicitly B Browser target. Capture/prepare artifact, replace terminal ID incarnation, submit handoff. | Rows/tunnels distinguish owners; project focus doesn't change Browser; explicit switch resets trust/capture; DOM-forged routing ignored; old-incarnation artifact denied and new PTY receives no text. Real public tunnel test uses disposable approved endpoint only, no production service exposure. |
| S09 Preferences/settings/usage | Preference A, Settings B, project A; change font then B config; switch target during delayed file import/debounced save. Pin B mount/order, configure fixture usage/Codex location, export config and delete only B fixture usage range. | Preference save only A; server config/pin/order/usage only B; target switch doesn't reroute old transaction; unavailable preference source retains snapshot and disables writes; no global telemetry sum/double-count. |
| S10 Host safety | In fake-executor API fixture, open A sleep dialog then navigate B; change A generation/revision; simulate conflict and lost response. Mix available/unsupported host metrics. | Dialog never changes owner; stale confirmation rejected, refreshed fleet belongs A; exactly zero real power/process actions; no ambiguous replay; no-auth rejection and enabled-actor/origin/inhibitor checks preserved. |
| S11 Lifecycle races | Delay A read, save response, upload, media issue, login/test, Git credential prompt and Browser artifact; change A URL/token/remove while B healthy, then release. Crash/restart only A server, send old WS event/disposer. | No old-token/new-URL request; new A/B state ignores old generation; cleanup targets original endpoint; unknown writes not replayed; B unaffected; endpoint/root replacement cannot revive detached drafts/terminal refs. |
| S12 Notifications/migration/diagnostics | Equal terminal IDs send notifications; click A while B focused. Restore legacy raw tabs/layout/history through explicit owner verification; simulate localStorage unavailable/malformed and cross-tab token edits. Export A terminal diagnostics. | Click reaches A; legacy data isn't cloned/guessed; storage failure isn't empty deletion; only A output included with existing consent/redaction; no credentials/history/env values in export or browser tags. |
| S13 Native | Windows two disposable SSH scopes; equal imported IDs, independent markers, port conflict; focus changes, close/delete/fail A; actual openClient epoch transition. Native Browser explicit target switching/stale relay/security negatives. | Both scopes survive focus; A teardown doesn't affect B; global quotas/port conflicts and vault/trust/main-window guards hold; true epoch stops all. Windows artifact-bound runtime evidence required; Linux unsupported SSH generates no invoke/fallback. |

For each scenario retain sanitized screenshot(s), relevant request endpoint/method/owner correlation without tokens/query secrets, expected/actual marker or file diff, terminal incarnation/PID where relevant, and pass/fail. A request log alone does not prove UI continuity or correct filesystem effect. Use actual Chromium UI through browser automation, screenshots for visual grouping/layout, and API/filesystem observation for remote effects. Runtime fault injection may delay/drop responses in test browser/network layer; don't add production debug switches.

#### Focused regression and command gates

Run after integrated ownership migration, not concurrently against partially edited shared files. Update broken existing tests; add permanent tests for plausible collisions/races/authority boundaries, not implementation strings or wording. New planned files are explicitly new: `packages/ui/src/api/connections.test.ts`, encrypted-owner regression beside existing hook/context, and a browser multi-profile regression under the existing browser-test discovery pattern if the scenario needs permanent browser coverage. A throwaway fixture driver is proof machinery, not a new product subsystem.

Commands from repository root:

```text
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts
pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/stores/project-target.test.ts src/hooks/use-search-panel-replace.test.tsx src/hooks/use-fs-upload.test.tsx
pnpm --filter @dam-hopper/ui test src/api/image-tickets.test.ts src/api/video-tickets.test.ts src/api/media-session.test.ts
cargo test --manifest-path server/Cargo.toml media
cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts
cargo test --manifest-path server/Cargo.toml --test workspace_targets --test project_worktree_lifecycle --test workflow_api --test settings_import_export --test auth_no_auth
cargo test --manifest-path server/Cargo.toml --test idle_suspend --test idle_suspend_phase07
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
pnpm --filter @dam-hopper/native test
pnpm --filter @dam-hopper/native build
pnpm build:extension
pnpm check
```

`pnpm check` includes web build, native Linux deb/rpm build, lint and backend tests; requires platform dependencies. Run Windows-native `cargo test --manifest-path apps/native/src-tauri/Cargo.toml` and `pnpm --filter @dam-hopper/native test:e2e:ssh-forward` on Windows with disposable SSH fixture, plus existing `smoke:ssh-forward --runtime` and `--validate-evidence` workflow and native Browser `tauri:probe`/`smoke:evidence`. A smoke script prerequisite report is not a pass; record actual behavior first. Select only one configured Chromium channel/executable for UI browser suite as its config requires. Format touched files with project Prettier/Rust formatter once at integration; avoid repo-wide unrelated reflow.

#### Completion, documentation and rollback

After live smoke proves behavior, update existing `docs/user-guide-multi-server-profiles.md`, `system-architecture.md`, `api-reference.md`, `configuration-guide.md`, `frontend-components.md`, `workflow-client-state.md`, `workflow-context-surface.md`, `native-browser-debug-support.md`, `ws-protocol-guide.md` where ownership—not wire identifiers—changes, and `docs/CHANGELOG.md`. Explain independent connection actions, startup autoConnect, explicit preference/Settings targets, duplicate-profile shared authority, legacy restore, media upgrade requirement and native support. No plan-time repo edits. Remove throwaway fixture scripts/secrets/services and retain sanitized evidence; keep only justified regressions.

Rollback deploys previous application build with previous browser-local backup available; new version never overwrites legacy ambiguous resource bytes until verified migration. Server media v2 is additive, artifact-incarnation storage is ephemeral, native persistence format unchanged, so no database rollback/migration is needed. Reverting to old frontend also reverts to old single-active UX; do not keep an ambient compatibility switch in new production code. Windows-native release is blocked until its real runtime/security gate passes; mark platform limitation explicitly rather than silently reducing scope.


## Planning deliverable status

Plan specification complete; implementation and runtime qualification pending. No unresolved product/design decision is deferred. Disposable MongoDB, browser capabilities and Windows runtime access are execution prerequisites, not claimed verification. Submit this canonical plan for approval; do not start application implementation in plan mode.
