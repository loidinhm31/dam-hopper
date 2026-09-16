# Unified-profile design contracts

Status: proposed; implementation pending. [Plan](plan.md) · [Execution map](execution-map.md).

Based on the requested preplan, amended by [confirmed validation decisions](validation-decisions.md): fresh browser resources, mandatory new protocol and platform-specific release gates. Phase-specific media v2, Browser artifact and native IPC details are normative in Phases 07, 05 and 08. All source observations in phase files are planning evidence, not implemented behavior.

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

Connection startup order is per-profile: resolve supported endpoint → read matching credential record → owner-bound auth/status (or explicit login, including initial no-auth login) → require successful status field `workbenchProtocol: 2` → open token-authenticated WS → mark connected and enable feature reads. Auth bootstrap is an internal endpoint-bound flow using credentials omit, not a public ambient API exception. Failure settles that profile only. A network loss while intent remains on advances generation, rejects old work, becomes offline and schedules bounded-backoff reconnect; authentication rejection becomes login-required and stops automatic retries until explicit login. A feature endpoint 404/unavailable does not retire an otherwise healthy connection. Connect is idempotent for an already connected/current profile; multiple calls share one in-flight start.

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

Separate persisted fields: selected project (`ProjectRef | null`), `preferencesProfileId: ProfileId | null`, `settingsProfileId: ProfileId | null`, and explicit Browser target. Start preference/settings profile unset after the resource cutover and require explicit selection; never seed from old active profile or first healthy server. Preserve preference source last-loaded snapshot during outage and disable its remote saves. Shared global preferences do not include server-local pinned mounts/Codex integration or unqualified resource ordering.

### Fresh-state and duplicate-profile boundary

User chose a forced fresh start for old browser resource state. Discard legacy project selections, editor metadata/draft records, tree/target/search state, terminal layouts/pins, command history and Browser history. Do not attribute by old active profile, migrate resource entries, save archives/backups, or build a restore UI. First-run notice describes the intentional data loss. Resource reset never dispatches terminal creation/kill/removal, file saves or other remote writes.

Saved connection profiles and endpoint-bound auth conversion remain separate and preserved. Presentation-only widths/modes can stay. New-schema live dirty drafts remain preserved during normal lifecycle events. Reject old unqualified resource deep links with a fresh-navigation notice; new links carry profileId/project/worktree/session.

Two profiles to the same server are two frontend connection owners, not isolated remote tenants. Keep independent tokens/generations/media leases; never deduplicate by normalized URL alone. Server mutations may be observed through both connections and settings/fleet/history remain shared according to existing authority. Display that warning; never promise independent remote tenant/logout/usage isolation.

Validated contracts override the original preplan and scouts where changed. Durable TerminalRef still excludes generation. No legacy browser resource is guessed, restored or cloned.

### Browser-local persistence cutover

Reuse existing store/key conventions. Enumerate the legacy resource key families below; reset their old-version contents to empty new-schema values and remove obsolete resource keys plus associated `:legacy-unowned` backups. No broad `localStorage.clear()`, resource archive or restore machinery. Make reset idempotent per store: valid new-version records survive subsequent/partially completed startups. Verify writes/removals; on unavailable/quota-failing storage, use empty in-memory resource state, ignore old records and show persistence failure rather than claiming reset succeeded. Do not touch profile/auth/native stores. Credential conversion follows its separate endpoint-bound contract.

| Store | New persisted contract |
|---|---|
| `dam-hopper:workspace-state` | Zustand version 1; selected qualified ProjectRef or null; remove old `dam-hopper:active-project`; start selected project null |
| `dam-hopper:editor-state` | Version 2; qualified target/tab/model metadata and ResourceBinding; retain current metadata-only persistence |
| `dam-hopper:explorer-tree-state` | Version 1; qualified target keys for open/selected paths |
| Project-target/search transient state | Owner-qualified maps in existing stores; no new persistence of search contents/passphrases |
| Traditional/group terminal layout keys | Advance existing layout key family to `dam-hopper:terminal-layout:v3:<encoded owner/group tuple>`; layout payload version 2 contains TerminalRef leaves |
| `dam-hopper:terminal-pins:v2` | Qualified TerminalRef entries; discard old v1 values |
| `dam-hopper:command-history` | Version 3; profile-owned entries/project usage; original retention/limits; discard legacy entries |
| `dam-hopper:browser-debug-address-history` | Version 2; entries grouped by profileId; preserve existing URL stripping and bounds |
| `dam-hopper:preferences-source:v1` | ProfileId or null plus last successful non-secret allowlisted preference snapshot |
| `dam-hopper:settings-target:v1` | ProfileId or null; no remote config/credential duplication |

Any additional legacy resource-bearing layout key discovered follows the same explicit reset allowlist; future entries use owner-qualified tuples. Presentation-only widths/modes stay unchanged. Reset performs no remote mutation or automatic terminal creation. No old browser-resource recovery is promised on rollback.



## Implementation clarifications

- `Transport` remains the protocol boundary, not a lifecycle singleton. Add explicit disposal/cancellation as needed in its interface; every method, including subscriptions and fire-and-forget terminal writes, checks captured owner. Do not make wrappers silently resolve a replacement transport.
- Runtime event installation must be an imperative, non-React function with a disposer; `use-sse`/`use-sse-events` hooks subscribe to that service. No React hook is invoked from registry construction.
- API client factory has no runtime dependency on `getApi`; separate exported types from registry access where needed to avoid initialization cycles. Keep current method groups and local DTOs.
- A profile edit/login flow needs a captured monotonic in-app auth/endpoint revision in addition to URL equality. A→B→A edits cannot make an old completion current again. Cross-tab storage reconciliation retires changed authority before enabling requests; profile name/autoConnect changes alone do not churn transport.
- Preserve mutation retry defaults only for safe reads; explicitly disable mutation replay where a library or SSH retry wrapper could otherwise repeat successful/unknown writes. Abort after dispatch does not prove server rollback.
- Shared preferences and UI configuration are distinct: an allowlisted preference snapshot contains no resource order, host mount or server integration authority.
- The native scout suggested idempotent `openClient`; reject that suggestion. Per the source/preplan contract, a real `openClient` establishes a new client epoch and globally retires old scopes. Call it once per host lifetime; only `openScope` for an already-current scope and known-scope reconciliation are idempotent within that epoch.
- Artifact create requires `terminalIncarnation`; missing/invalid field fails validation, mismatch returns conflict before persistence. Response acknowledges the captured instance. No old-client omission path; handoff never falls back to raw ID.
- Media has only the namespaced v2 contract. Stream authorization selects the canonical UUID cookie from the stored ticket binding; fixed old cookies are ignored. Use raw-header duplicate detection for the selected name; request-supplied namespace alone grants no authority.
- Phase 02 owns the idempotent fresh-state reset boundary; each feature supplies its explicit old-store key/version list and empty new schema. No legacy backup/quarantine/restore components are created.

## Mandatory workbench protocol

Add `workbenchProtocol: 2` to successful `GET /api/auth/status` responses in `server/src/api/auth.rs`, including dev mode. Bound startup authenticates first, then requires this exact marker before WS/feature reads. Missing/different marker on a successful status makes only that profile `unsupported` with mandatory-upgrade guidance and stops automatic reconnect until explicit retry/configuration change; auth/network failures retain their distinct states. No new endpoint or broad capability catalogue. Marker 2 promises namespaced media-only and mandatory artifact-incarnation contracts; misbehaving responses fail closed and retire that runtime as incompatible. Test both normal and no-auth status responses.

Old frontend/backend protocol combinations are unsupported. Remove media-v1 and optional-incarnation branches; keep existing ordinary auth/origin/permission policy. Coordinate frontend/backend upgrades; no claim that unchanged endpoints identify every old client. See [validation-decisions.md](validation-decisions.md) for platform-specific G1/G2 gates and deliberately lossy browser-state reset.

## Contract example

A delayed save snapshots A's `ConnectionRef`, qualified target and resource binding **before** confirmation/passphrase/file enumeration. It uses A's cached bound client throughout. Selecting B changes no captured field. Retiring A cancels undispatched work and prevents completion from clearing the replacement draft; if a write may have reached A, label its outcome unknown and reconcile A without replay.

## Unresolved questions

No unresolved product choice after the validation interview. Qualifying actual MongoDB auth, blocked-cookie media, and Windows-native execution requires the environments listed in Phase 09. Their availability is not assumed or claimed.
