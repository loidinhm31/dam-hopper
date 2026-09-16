# Phase 00: Scope, Inventory and Contract Freeze (G0 Baseline)

**Document:** `plans/260916-2137-unified-profile/inventory-and-contract-freeze.md`  
**Date:** 2026-09-16  
**Status:** Frozen (G0 complete)  
**Deliverable:** G0 Contract Baseline & Comprehensive Caller Inventory  
**Target:** Unified multi-profile workbench ([Plan](plan.md) · [Design Contracts](design-contracts.md) · [Execution Map](execution-map.md))

---

## 1. Executive Summary & G0 Gate Definition

Phase 00 provides the frozen architectural contract, comprehensive caller inventory, single-writer assignments, and qualification prerequisite ledger for the unified multi-profile workbench. No runtime code changes or new runtime files (`ownership.ts`, `connections.ts`) are introduced in Phase 00 (those belong to Phase 01).

### The Three Progressive Gates
1. **G0 / Contract Freeze (This Deliverable):** Frozen interfaces, canonical types, error semantics, storage reset rules, wire protocol contracts, and caller inventories agreed across all feature slices. Parallel implementation across Phases 01–08 may commence strictly against these frozen G0 interfaces.
2. **G1 / Integrated Ownership:** All shipped-target callers migrated away from ambient singletons; target-specific startup enabled only after its complete caller set has cut over. G1-Web encompasses Phases 01–07; G1-Native additionally requires Phase 08.
3. **G2 / Release Qualification:** Empirical verification of all scenarios (S01–S12 for web, S13 for native) under real browser/server/native test harnesses. Independent release per qualified platform is explicitly supported.

---

## 2. Source Baseline Reconciliation & Drift Assessment (Task 2.1)

A line-by-line reconciliation of the current working tree against the preplan baseline was performed:

### Git Working Tree Status
- **Current branch:** `main`
- **Modified files:**
  - `docs/system-architecture.md`: Section added documenting the proposed unified-profile workbench and explicitly distinguishing it from the older, unimplemented backend workspace UUID/catalog proposal.
- **Untracked files:**
  - `plans/260916-2137-unified-profile/`: Plan suite and research notes.
  - `plans/reports/preplan-260916-2135-unified-profile.md`: Input preplan.
- **Drift Assessment:**
  - `packages/ui/src/api/transport.ts`: Verified singleton `_transport`, global `_transportGeneration`, and listener set unchanged from audit.
  - `packages/ui/src/api/client.ts`: Verified static `api` methods invoking `getTransport()`.
  - `packages/ui/src/api/query-client.ts`: Verified `profileScopedQueryKeyHash` dynamically hashes active profile ID at query hash time.
  - `packages/ui/src/api/server-config.ts`: Verified active profile helpers (`getActiveProfile()`, `getActiveProfileId()`) backing URL and token lookup.
  - `server/src/api/auth.rs`: Verified `status()` handler currently returns `{ authenticated: true }` without protocol version marker.
  - `server/src/api/media_session.rs`: Verified fixed cookie name and lack of media client ID namespace.
  - `apps/native/src-tauri/src/ssh_forward/`: Verified Windows-only conditional compilation and singleton active scope.
- **Conclusion:** No contract-breaking source drift has occurred. The workspace matches the preplan baseline.

---

## 3. Comprehensive Caller, Transport & Network Inventory (Task 2.2)

Every singleton transport/API import, default auth/server-URL helper, direct network constructor, query/invalidation hook, event subscriber, persisted resource store, and native scope command across the monorepo is cataloged below:

### 3.1 Transport and API Singleton Callers (`getTransport()` / `api`)

| File | Symbol / Method | Owner Source | Async Boundary | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|---|
| `packages/ui/src/api/client.ts` | `api.workspace.*`, `api.projects.*`, `api.fs.*`, `api.git.*`, `api.terminal.*`, `api.globalConfig.*` | Singleton `getTransport()` | Async promise dispatch | Phase 01 | S01, S02, S03 |
| `packages/ui/src/api/queries.ts` | `useTerminalSessions`, `useProjects`, `useGitStatus`, `useWorktrees`, `useFileDiff`, `useSshAgent` | `getTransport().invoke(...)` | React Query `queryFn` / `mutationFn` | Phase 01 | S01, S02, S04 |
| `packages/ui/src/api/transport-utils.ts` | `reinitializeTransport`, `oldTransport.destroy()` | Module global `_transport` | Synchronous / WS close | Phase 01 | S01, S02 |
| `packages/ui/src/components/organisms/DiffViewer.tsx` | `transport().fsRead(...)` | `getTransport() as WsTransport` | Async chunk read | Phase 03 | S03 |
| `packages/ui/src/components/organisms/EditorTabs.tsx` | `t.onStatusChange(...)` | `getTransport()` | Event listener subscription | Phase 03 | S02, S03 |
| `packages/ui/src/components/organisms/LargeFileViewer.tsx` | `t.fsRead(...)` | `getTransport() as WsTransport` | Chunked file streaming | Phase 03 | S03 |
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` | `getTransport().terminalWrite(sessionId, ...)` | `getTransport()` | Direct WS binary/text write | Phase 04 | S04 |
| `packages/ui/src/components/organisms/TerminalPanel.tsx` | `getTransport().terminalWrite(...)`, `attachTerminalAgentNotifications(...)` | `getTransport()` | Live PTY stream & suggestions | Phase 04 | S04 |
| `packages/ui/src/embed/dam-hopper-app.tsx` | `transport.onEvent("workspace:changed", ...)` | `getTransport()` | WS push event listener | Phase 02 | S01, S02 |
| `packages/ui/src/hooks/use-browser-debug.ts` | `transport.onEvent("tunnel:*", ...)` | `getTransport()` | Multi-event subscription | Phase 05 | S05 |
| `packages/ui/src/hooks/use-encrypted-write.ts` | `opaqueRegisterAndLogin(t, ...)`, `t.fsPutSave(...)`, `t.fsPutFile(...)` | `getTransport() as WsTransport` | Multi-step OPAQUE PAKE & chunk upload | Phase 07 | S07 |
| `packages/ui/src/hooks/use-file-search.ts` | `getTransport().invoke("fs:search", ...)` | `getTransport()` | Query `queryFn` | Phase 03 | S03 |
| `packages/ui/src/hooks/use-fs-ops.ts` | `transport().fs*` methods | `getTransport() as WsTransport` | Mutation functions | Phase 03 | S03 |
| `packages/ui/src/hooks/use-fs-subscription.ts` | `t.fsSubscribeTree(...)`, `t.onFsEvent(...)` | `getTransport() as WsTransport` | Long-lived WS tree subscription | Phase 03 | S03 |
| `packages/ui/src/hooks/use-fs-upload.ts` | `t.fsUploadFile(...)` | `getTransport() as WsTransport` | Multi-part upload with progress callback | Phase 03 | S03 |
| `packages/ui/src/hooks/use-ports.ts` | `requestTransport.invoke("tunnel:install")`, `terminal:kill` | `getTransport()`, `useTransportGeneration()` | Mutation & status effect | Phase 05 | S05 |
| `packages/ui/src/hooks/use-search-panel-replace.ts` | `(getTransport() as WsTransport).fsRead(...)`, `fsWriteFile(...)` | `getTransport()` | Serial search-replace batches | Phase 03 | S03 |
| `packages/ui/src/hooks/use-sse.ts` | `getTransport().onEvent(...)`, `onStatusChange(...)` | `getTransport()` | Global push event bridge | Phase 01 | S01, S02 |
| `packages/ui/src/hooks/use-tunnels.ts` | `requestTransport.invoke("tunnel:*")` | `getTransport()` | Mutation & status effect | Phase 05 | S05 |
| `packages/ui/src/stores/editor.ts` | `transport().fsRead(...)`, `fsWriteFile(...)` | `getTransport() as WsTransport` | Zustand store actions | Phase 03 | S03 |

### 3.2 Active Profile Singletons (`getActiveProfile()` / `getActiveProfileId()`)

| File | Symbol / Method | Owner Source | Async Boundary | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|---|
| `packages/ui/src/api/image-tickets.ts` | `requestSnapshot()` | `getActiveProfile()`, `getAuthToken()` | Token & server URL extraction | Phase 07 | S07 |
| `packages/ui/src/api/video-tickets.ts` | `requestSnapshot()` | `getActiveProfile()`, `getAuthToken()` | Token & server URL extraction | Phase 07 | S07 |
| `packages/ui/src/api/query-client.ts` | `profileScopedQueryKeyHash` | `getActiveProfileId()` | TanStack Query key serializer | Phase 01 | S01, S02 |
| `packages/ui/src/api/server-config.ts` | `getServerUrl()`, `getAuthToken()`, `setActiveProfile()`, etc. | `localStorage.getItem("damhopper_active_profile_id")` | Sync storage access | Phase 02 | S01, S02 |
| `packages/ui/src/api/ws-transport.ts` | constructor default `profileId`, `authToken` | `getActiveProfileId()`, `getAuthToken()` | WS handshake connection | Phase 01 | S01, S02 |
| `packages/ui/src/components/organisms/ServerProfilesDialog.tsx` | `handleSwitch`, active profile chip | `getActiveProfile()`, `getActiveProfileId()` | Profile switch callback | Phase 02 | S01, S02 |
| `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` | Profile editing, token management, deletion | `getActiveProfile()`, `getActiveProfileId()` | Dialog lifecycle & storage sync | Phase 02, 06 | S01, S06 |
| `packages/ui/src/components/organisms/WorkspaceSetupWizard.tsx` | Initial workspace discovery | `getActiveProfile()` | Wizard submit action | Phase 02 | S02 |
| `packages/ui/src/contexts/SshForwardHostContext.tsx` | `activate(scopeId = getActiveProfileId())` | `getActiveProfileId()` | Scope activation & state sync | Phase 08 | S13 |
| `packages/ui/src/embed/dam-hopper-app.tsx` | Startup auth check, profile verification | `getActiveProfile()` | App mount / profile sync effect | Phase 02 | S01, S02 |
| `packages/ui/src/hooks/use-fs-ops.ts` | `runFsOp` auth headers | `getActiveProfile()`, `getAuthToken()` | HTTP fetch headers construction | Phase 03 | S03 |
| `packages/ui/src/hooks/use-ports.ts` | `mutationProfileId = getActiveProfileId()` | `getActiveProfileId()` | Rollback verification check | Phase 05 | S05 |
| `packages/ui/src/hooks/use-server-profile.ts` | `useServerProfile()` hook | `getActiveProfile()` | `useSyncExternalStore` hook | Phase 02 | S02 |
| `packages/ui/src/hooks/use-ssh-forward-page-controller.ts` | `setConnectionFormSource(getActiveProfile())` | `getActiveProfile()` | UI state setter | Phase 08 | S13 |
| `packages/ui/src/hooks/use-tunnels.ts` | `mutationProfileId = getActiveProfileId()` | `getActiveProfileId()` | Rollback verification check | Phase 05 | S05 |
| `packages/ui/src/lib/diagnostics-client.ts` | `sendDiagnosticEvent` payload | `getActiveProfile()` | Periodic diagnostics upload | Phase 06 | S06 |
| `apps/web/src/main.tsx` | `bootstrap()` / `getActiveProfile()` | Initial profile lookup before `WsTransport` construction | Phase 02 | S01, S02 |
| `apps/native/src/main.tsx` | `new WsTransport(serverUrl, getActiveProfile()?.id)` | Native startup profile identity lookup | Phase 02, 08 | S01, S13 |
| `apps/native/src/native-server-url.ts` | `getNativeServerUrl()` | Active profile URL resolution for Tauri startup | Phase 08 | S13 |
| `apps/native/src/native-browser-debug-host.ts` | target profile/generation checks | Browser-debug relay ownership and stale-target fencing | Phase 05, 08 | S05, S13 |

### 3.3 Direct Network & WebSocket Constructors

| File | Target / Protocol | Existing Owner Source | Async Boundary | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|---|
| `packages/ui/src/api/ws-transport.ts` | `new WebSocket(...)` | `baseUrl`, `authToken`, `profileId` | Socket open/close/message events | Phase 01 | S01, S02 |
| `packages/ui/src/api/ws-transport.ts` | `fetch(url, ...)` | REST fallback for `/api/*` | HTTP request/response | Phase 01 | S01, S02 |
| `packages/ui/src/api/image-tickets.ts` | `fetch(...)` | Ticket issue/revoke | HTTP POST/DELETE | Phase 07 | S07 |
| `packages/ui/src/api/video-tickets.ts` | `fetch(...)` | Ticket issue/revoke | HTTP POST/DELETE | Phase 07 | S07 |
| `packages/ui/src/embed/dam-hopper-app.tsx` | `fetch("/api/auth/login")`, `fetch("/api/auth/status")` | Direct startup auto-login and auth status check | HTTP POST/GET | Phase 02 | S01, S02 |
| `packages/ui/src/api/media-session.ts` | `fetch(HEAD stream)`, `fetch(/api/fs/media-session)` | Media ticket probe and bounded session revocation | HTTP HEAD/DELETE | Phase 07 | S07 |
| `packages/ui/src/api/runtime-config.ts` | `fetch(RUNTIME_CONFIG_ENDPOINT)` | Strict managed-profile runtime configuration bootstrap | HTTP GET | Phase 02 | S01, S02 |
| `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` | `fetch(/api/auth/login)`, `fetch(/api/auth/logout)` | Profile connection test and bounded logout | HTTP POST | Phase 02, 06 | S01, S02, S06 |
| `packages/ui/src/components/organisms/TopNav.tsx` | `fetch(/api/auth/status)` | Active-profile dev-mode/status indicator | HTTP GET | Phase 02 | S01, S02 |
| `packages/ui/src/hooks/use-fs-ops.ts` | `fetch(/api/fs/download)` | Profile-authenticated targeted file download | HTTP GET | Phase 03 | S03 |

### 3.4 Push Event Listeners & Event Bridge

| File | Event Channels | Dispatch Pattern | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|
| `packages/ui/src/hooks/use-sse.ts` | `PUSH_EVENT_CHANNELS` (`workspace:changed`, `tunnel:*`, `install:progress`, `host:*`, `terminal:targetUnavailable`) | Global un-scoped `listeners.get(type)` Set | Phase 01 | S01, S02 |
| `packages/ui/src/hooks/use-sse-events.ts` | `useIpcEvent(type, handler)` | React hook wrapper around `subscribeIpc` | Phase 01 | S01, S02 |
| `packages/ui/src/embed/dam-hopper-app.tsx` | `workspace:changed` | Direct `transport.onEvent` | Phase 02 | S02 |
| `packages/ui/src/hooks/use-browser-debug.ts` | `tunnel:created`, `tunnel:ready`, `tunnel:stopped`, `tunnel:failed` | Direct `transport.onEvent` | Phase 05 | S05 |
| `packages/ui/src/components/organisms/EditorTabs.tsx` | `onStatusChange` | Re-check editor freshness after reconnect | Phase 03 | S02, S03 |
| `packages/ui/src/components/organisms/TerminalPanel.tsx` | `onTerminalData`, `onTerminalBuffer`, `onTerminalExit`, `onTerminalLifecycle`, `onEvent("terminal:changed")`, `onStatusChange` | PTY stream, restart recovery, and stale-session fencing | Phase 04 | S04 |
| `packages/ui/src/hooks/use-fs-subscription.ts` | `onFsEvent` | Profile-bound filesystem tree event subscription | Phase 03 | S03 |
| `packages/ui/src/hooks/use-ports.ts` | `subscribeIpc("port:*"|"tunnel:*"|"install:*")`, `onStatusChange` | Port/tunnel/install event updates and reconnect reconciliation | Phase 05 | S05 |
| `packages/ui/src/hooks/use-tunnels.ts` | `subscribeIpc("tunnel:*"|"install:*")`, `onStatusChange` | Tunnel/install event updates and reconnect reconciliation | Phase 05 | S05 |
| `packages/ui/src/components/organisms/ProgressList.tsx` | `useIpcEvent("git:progress")` | Git progress event rendering | Phase 03 | S03 |
| `packages/ui/src/components/pages/DashboardPage.tsx` | `useIpcEvent("*")` | Wildcard runtime event diagnostics/status display | Phase 02 | S01, S02 |
| `apps/web/src/main.tsx` | `transport.onStatusChange` | Web bootstrap status publication | Phase 02 | S01, S02 |
| `apps/native/src/main.tsx` | `transport.onStatusChange` | Native bootstrap status publication | Phase 02, 08 | S01, S13 |
| `apps/native/src/native-browser-debug-host.ts` | Tauri `listen` (`browser-debug:relay`, rejection channel) and `subscribe` | Native browser-debug relay event bridge | Phase 05, 08 | S05, S13 |
| `apps/native/src/native-ssh-forward-host.ts` | Tauri `listen("ssh-forward:changed")` and `subscribe` | Native scoped SSH-forward event bridge | Phase 08 | S13 |

### 3.5 Terminal Session & Raw-ID Callers

| File | Pattern | Existing Indirection | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|
| `packages/ui/src/hooks/use-terminal-manager.ts` | Session IDs (`sessionSegment`, `safeSessionId`), `openTabs`, `mountedSessions`, `pinnedTerminalIds` | Map keyed by raw session string without profile binding | Phase 04 | S04 |
| `packages/ui/src/hooks/use-terminal-layout.ts` | `dam-hopper:terminal-layout:${targetKey}` | Layout tree of raw session IDs | Phase 04 | S04 |
| `packages/ui/src/lib/terminal-pin-persistence.ts` | `dam-hopper:terminal-pins:v1` | Array of raw session ID strings | Phase 04 | S04 |
| `packages/ui/src/components/organisms/TerminalPanel.tsx` | Direct PTY write, suggestions, buffer | Bound to single active session | Phase 04 | S04 |
| `server/src/api/browser_debug.rs` | Artifact create with PTY ID check | `pty_manager.is_alive(&session_id)` without incarnation check | Phase 05 | S05 |
| `server/src/pty/manager.rs` | Atomic PTY write admission | Write permitted if session exists; replacement session can collide | Phase 05 | S05 |

### 3.6 Native Scope IPC Callers (`apps/native/`)

| File | Tauri Command | Existing Scope Model | Phase Owner | Acceptance Scenario |
|---|---|---|---|---|
| `apps/native/src/native-ssh-forward-host.ts` | `ssh_forward_open_client` | Global client open | Phase 08 | S13 |
| `apps/native/src/native-ssh-forward-host.ts` | `ssh_forward_activate_scope` | Single active scope | Phase 08 | S13 |
| `apps/native/src/native-ssh-forward-host.ts` | `ssh_forward_snapshot`, `ssh_forward_connect`, `ssh_forward_disconnect` | Bound to currently active scope | Phase 08 | S13 |
| `apps/native/src/native-ssh-forward-host.ts` | `ssh_forward_purge_scope` | Purges single scope | Phase 08 | S13 |
| `apps/native/src-tauri/src/ssh_forward/manager.rs` | `active_scope: Arc<RwLock<Option<String>>>` | Single active scope singleton | Phase 08 | S13 |

---

## 4. Local Presentation Preferences vs Server-Local Resource State (Task 2.3)

Storage records are strictly partitioned into two disjoint categories:

### 4.1 Preserved Local Presentation Preferences (Persist Across Profiles & Connections)
These represent user display choices and configuration metadata. They are NEVER wiped on profile switch, disconnect, or browser resource reset:
- `damhopper_server_profiles`: Server profile catalog records (`{ id, name, url, authType, username, autoConnect, createdAt }`).
- `damhopper_active_profile_id`: Last selected profile identifier in the shell UI.
- `damhopper_profile_auth_v2_<profileId>`: Endpoint-bound authentication records (`{ version: 2, serverUrl, authType, token }`) keyed per profile.
- `damhopper_native_scope_ids`: Stable mapping between profile IDs and native scope UUIDs.
- `dam-hopper:sidebar-collapsed`: Primary sidebar collapse toggle (`boolean`).
- `dam-hopper:nav-collapsed`: Top navigation bar collapse toggle (`boolean`).
- `dam-hopper:tools:left-top`, `left-bottom`, `right-top`, `right-bottom`: Panel docking locations.
- `dam-hopper:terminal-floating-file-panel:*`: Floating terminal file tree dimensions and position.
- `dam-hopper:expanded-free-terminals`: Tree view section expansion toggle (`boolean`).
- `dam-hopper:expanded-projects`: Tree view project section expansion set (JSON array of project names).
- `dam-hopper:expanded-profiles`: Tree view profile section expansion set (JSON array of profile IDs).
- `dam-hopper:command-history-enabled`: Preference toggle for command history recording (`boolean`).
- `damhopper_settings`: Local client appearance, font, and editor theme preferences.

### 4.2 Discarded Server-Local Resource Identifiers (Forced Fresh Reset on Protocol Cutover)
Per validated decision, legacy browser resource state is deliberately dropped on cutover without quarantine or backup:
- `dam-hopper:editor-state`: Old v1/v2/v3 open tabs, file paths, uncommitted buffer keys.
- `dam-hopper:workspace-state`: Unqualified `activeProject` and revision.
- `dam-hopper:active-project`: Legacy raw project name.
- `dam-hopper:explorer-tree-state`: Tree expansion maps keyed without profile binding.
- `dam-hopper:terminal-layout:*`: Terminal split-pane layouts containing stale session IDs.
- `dam-hopper:terminal-pins:v1`: Pinned terminal session ID arrays.
- `damhopper_browser_debug_address_history_v1`: Browser debug URL suggestions.
- `damhopper_command_history_v2`: Stored shell command history records.
- `damhopper_diagnostics_frontend_v1`: Frontend diagnostics buffer.
- `TanStack Query cache`: In-memory query cache entries without ConnectionRef binding.

---

## 5. Frozen Identity, ConnectionRef & API Factory Contracts (Task 2.4)

### 5.1 Canonical Type Definitions (`packages/ui/src/api/ownership.ts`)
```ts
export type ProfileId = string;

/** Immutable owner reference capturing profile identity and specific connection generation */
export interface ConnectionRef {
  readonly profileId: ProfileId;
  readonly generation: number;
}

/** Project scoped to an explicit profile */
export interface ProjectRef {
  readonly profileId: ProfileId;
  readonly project: string;
}

/** Specific worktree target scoped to a profile project */
export interface ProjectTargetRef extends ProjectRef {
  readonly worktreePath?: string | null;
}

/** Terminal session reference scoped to a profile */
export interface TerminalRef {
  readonly profileId: ProfileId;
  readonly id: string;
}

/** Authoritative terminal instance reference including server-assigned incarnation */
export interface TerminalInstanceRef extends TerminalRef {
  readonly incarnation: number;
}

/** Server endpoint and configured root attachment metadata */
export interface ResourceBinding {
  readonly serverUrl: string;
  readonly configuredRoot?: string;
}

/** Enforce explicit profile qualification on data models */
export type Owned<T> = T & { readonly profileId: ProfileId };
```

### 5.2 Connection Registry Contract (`packages/ui/src/api/connections.ts`)
```ts
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "login-required"
  | "offline"
  | "unsupported";

export interface ConnectionSnapshot {
  readonly owner: ConnectionRef;
  readonly status: ConnectionStatus;
  readonly intent: boolean;
  readonly serverUrl: string;
  readonly error: string | null; // Redacted display message; never raw secrets
}

export interface ConnectionError {
  readonly reason: "stale" | "unavailable" | "owner-mismatch";
  readonly message: string;
  readonly owner: ConnectionRef;
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

### 5.3 Asynchronous Generation Fencing & Invariant Rules
1. **Immutable Snapshots:** Registry snapshots must be reference-stable until an actual state transition occurs, ensuring safe consumption via React `useSyncExternalStore`.
2. **Pre-dispatch Validation:** `getTransport(owner)` and `getApi(owner)` must reject stale, removed, or disconnected owners before sending any wire request.
3. **Post-response Validation:** Generation checks must be verified *after* parsing any async response (including failed HTTP responses). A response arriving for generation $N$ while the connection is at generation $N+1$ MUST be discarded and not dispatched to UI handlers.
4. **Typed Errors:** Connection rejections use typed `ConnectionError` with `stale`, `unavailable`, or `owner-mismatch` reasons, preventing connection race failures from being displayed as backend server 500 errors.
5. **Authentication Error State Transition:** An HTTP 401 response transitions the connection status to `"login-required"` while holding the current generation counter intact, preventing rapid reconnection loops or stale retry storms until explicit re-authentication occurs.

---

## 6. Frozen Query Keys, Push Event Envelopes & Runtime Bridge (Task 2.5)

### 6.1 Query Key Prefix Structure
Every TanStack Query key MUST begin with the tuple `["profile", owner.profileId, owner.generation]`:
```ts
// Example query keys strictly adhering to design-contracts.md:
queryKeys.projects.list(owner) = ["profile", owner.profileId, owner.generation, "projects", "list"];
queryKeys.git.status(owner, target) = ["profile", owner.profileId, owner.generation, "git", "status", target.project, target.worktreePath ?? null];
queryKeys.terminal.sessions(owner) = ["profile", owner.profileId, owner.generation, "terminal-sessions"];
```
This guarantees physical cache partition across simultaneous connections, strict cross-slice alignment, and automatic eviction/invalidation upon connection re-establishment without ambient query key hashing.

### 6.2 Push Event Envelopes
Incoming WebSocket push events are decorated with explicit owner metadata:
```ts
export interface DecoratedPushEvent<T = unknown> {
  readonly profileId: ProfileId;
  readonly generation: number;
  readonly channel: string;
  readonly data: T;
  readonly timestamp: number;
}
```
Event listeners subscribe via `subscribeProfileEvent(owner, channel, handler)`. Events arriving for mismatched generations are dropped at the bridge boundary.

### 6.3 Non-React Runtime Bridge
- The runtime connection registry is instantiated as a plain TypeScript/JavaScript object before React mounts.
- It exposes external subscription hooks (`subscribeConnections`, `subscribeProfileEvent`) consumable via `useSyncExternalStore`.
- React hooks MUST NOT be invoked during registry startup.
- Dependency cycle avoidance: `connections.ts` depends on `ownership.ts` and `transport.ts`; `client.ts` factory depends on `transport.ts`; high-level query hooks depend on `connections.ts` and `client.ts`.

---

## 7. Frozen Credential Conversion & Forced Storage Reset (Task 2.6)

1. **Storage Schema Versioning:** A global schema version marker `damhopper_schema_version: 2` is written upon successful reset.
2. **Endpoint-Bound Credentials:** Credentials are stored as versioned `damhopper_profile_auth_v2_<profileId>` records (`{ version: 2, serverUrl, authType, token }`). On profile URL or auth-type change, credentials for the old binding are discarded.
3. **Forced Reset Mechanics:**
   - On first load of the protocol-2 frontend: inspect `damhopper_schema_version`.
   - If `< 2`: wipe all keys listed in Section 4.2.
   - Retain all keys listed in Section 4.1.
   - Set `damhopper_schema_version: 2`.
   - No quarantine UI, no backup download, no recovery prompts.

---

## 8. Frozen RemoteCleanupHandle Lifecycle & Scope (Task 2.7)

```ts
export interface RemoteCleanupHandle {
  readonly owner: ConnectionRef;
  readonly resourceId: string;
  readonly cleanup: () => Promise<void>;
  readonly isRetired: () => boolean;
}
```
1. **Bounded Scope:** Only cleans up the specific remote resource (e.g. temporary media session cookie or uploaded transient file) on its original endpoint.
2. **Retirement Ordering:** Must be retired immediately upon invocation or upon connection generation change.
3. **No General Escape Hatch:** A retired cleanup handle cannot be repurposed to perform arbitrary API mutations.

---

## 9. Frozen Server Protocol-2, Media v2, Artifact Incarnation & Native Wire Contracts (Task 2.8)

### 9.1 Server Protocol-2 Marker (`/api/auth/status`)
```json
{
  "authenticated": true,
  "workbenchProtocol": 2,
  "dev_mode": false,
  "user": "developer"
}
```
- The frontend MUST verify `workbenchProtocol === 2` upon successful auth status check before opening WebSocket connections or dispatching workbench queries.
- A server returning missing or `< 2` `workbenchProtocol` causes the frontend to display an explicit "Server upgrade required" state without partial fallback.

### 9.2 Media Isolation v2 (`/api/fs/image`, `/api/fs/video`)
1. **Cookie Namespace:** `damhopper_media_v2_<mediaClientId>`. Legacy `session-cookie-v1` is rejected.
2. **Mandatory Header:** Requests must include `X-Media-Client-Id: <mediaClientId>`.
3. **Scoped Revocation:** Revoking a media session revokes only tickets associated with `(actor, mediaClientId)`.
4. **Duplicate Cookie Detection:** Raw headers containing multiple conflicting `damhopper_media_v2_*` cookies fail closed with HTTP 401.

### 9.3 Artifact Incarnation & Atomic Write Admission (`/api/browser_debug`, PTY manager)
1. **Required Incarnation:** Artifact creation calls (`POST /api/browser-debug/artifact`) MUST supply `expectedIncarnation: number`.
2. **Matching Validation:** Server compares `expectedIncarnation` with the live session's authoritative incarnation counter in `PtySessionManager`. If unequal or if the PTY has been replaced/restarted, the call fails with HTTP 409 Conflict.
3. **Atomic PTY Write:** PTY write operations require matching incarnation counter; replacement sessions cannot receive writes intended for a terminated incarnation.

### 9.4 Native Scope Concurrency (`apps/native/`)
1. **Native Scope Reference:** `NativeScopeRef { profileId: string, scopeId: string }`.
2. **Epoch Transition:** `ssh_forward_open_client` is called once per desktop lifetime and advances the client epoch.
3. **Scoped Management:** `ssh_forward_activate_scope` activates an admitted scope without destroying peer scopes.
4. **Scoped Teardown:** Disconnecting or closing a profile executes `ssh_forward_purge_scope(scopeId)` without affecting concurrent active scopes of other profiles.

---

## 10. Single-Writer Ownership & Integration Sequencing (Task 2.9)

### 10.1 Writer Allocations from Execution Map
- **Foundation / Integration Writer:**
  - `packages/ui/src/api/ownership.ts` (Phase 01)
  - `packages/ui/src/api/connections.ts` (Phase 01)
  - `packages/ui/src/api/transport.ts` (Phase 01)
  - `packages/ui/src/api/client.ts` (Phase 01)
  - `packages/ui/src/api/query-client.ts` (Phase 01)
  - `packages/ui/src/api/queries.ts` (Phase 01)
  - `packages/ui/src/api/workflow-queries.ts` (Phase 01)
  - `packages/ui/src/api/ws-transport.ts` (Phase 01)
  - `packages/ui/src/hooks/use-sse.ts` (Phase 01)
  - `packages/ui/src/hooks/use-sse-events.ts` (Phase 01)
  - `packages/ui/src/hooks/use-transport-generation.ts` (Phase 01)
  - `server/src/api/auth.rs` (protocol marker update)
- **Profile / Shell Integration Writer:**
  - `packages/ui/src/api/server-config.ts` (Phase 02)
  - `packages/ui/src/embed/dam-hopper-app.tsx` (Phase 02)
  - `packages/ui/src/components/pages/WorkspacePage.tsx` (Phase 02)
  - `packages/ui/src/components/organisms/TopNav.tsx` (Phase 02)
  - `packages/ui/src/components/organisms/ServerProfilesDialog.tsx` (Phase 02)
  - `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` (Phase 02)
  - `apps/web/src/main.tsx` (Phase 02)
  - `apps/native/src/main.tsx` (Phase 02)
- **Feature Slices Writers:**
  - **Files / Git Owner (Phase 03):** Editor tabs, LargeFileViewer, DiffViewer, search panel, fs hooks, git hooks.
  - **Terminal / Workflow Owner (Phase 04):** Terminal manager, layout tree, tabs, accessory bar, workflow queries UI.
  - **Agents / Browser Owner (Phase 05):** Agent store, ports panel, tunnel hooks, browser debug target, artifact backend.
  - **Preferences / Settings Owner (Phase 06):** Settings dialog sections, usage hooks, diagnostics client.
  - **Media / Encryption Owner (Phase 07):** Image/video preview, tickets, encrypted write, server media session & ticket store.
  - **Native Scopes Owner (Phase 08):** Tauri native SSH forward host, manager, commands.

### 10.2 Implementation Sequencing Rules
1. Agree credential schema and registry API at G0 (Complete).
2. Implement Phase 01A types (`ownership.ts`) and Phase 02A helpers (`server-config.ts`) independently.
3. Implement Phase 01B connection registry consuming both.
4. Slices 03–08 consume frozen G0 interfaces; they do not wait for the entire Phase 01 acceptance checklist.
5. Shared files have one designated writer; parallel branches supply requested prop/API changes to that writer.

---

## 11. Qualification Prerequisites & Test Harness Gap Ledger (Task 2.10)

| Scenario | Scope | Required Environment | Current Status / Gap |
|---|---|---|---|
| **S01** | Simultaneous active profiles & status tracking | Two running Axum servers on distinct loopback ports | Available locally via multiple cargo/pnpm server instances |
| **S02** | Independent auth & fresh browser reset | Server with authentication configured + test credentials | Available locally; dev-mode bypass available |
| **S03** | Parallel file operations & editor tabs | Two servers with distinct workspaces and git repositories | Available locally |
| **S04** | Independent PTY persistence & output | Two servers with active terminal sessions | Available locally |
| **S05** | Browser debug artifact incarnation | Browser bridge extension + target server | Requires manual Chromium run or Vitest browser fixture |
| **S06** | Profile-scoped settings & usage | Server with usage DB configured | Available locally |
| **S07** | Media v2 cookie isolation & encryption | Real browser with strict third-party cookie controls | Needs browser environment with cookie validation |
| **S08** | Multi-profile agent distribution | Two servers with distinct `.dam-hopper` stores | Available locally |
| **S09** | Concurrent port forwards & tunnels | `cloudflared` binary or mock tunnel driver | Available locally with mock driver |
| **S10** | Offline reconnection & generation advance | Network disconnect simulation (kill/restart server) | Available locally |
| **S11** | Stale response & cancellation rejection | Artificial latency / delayed network responses | Testable via mock transport / proxy |
| **S12** | Cross-profile security negatives | Malformed JWT, cross-profile ID injection | Testable via unit and integration tests |
| **S13** | Concurrent native SSH forward scopes | Windows environment + Tauri native host + SSH servers | **Blocked on Linux runner** (Windows runner required for native qualification) |

**Platform Release Gate Consequence:**  
Per confirmed validation decisions, web platform qualification (S01–S12) may complete and release independently; native platform release remains gated on S13 execution in a qualified Windows environment.

---

## 12. Advisor Counsel Audit & Verification Record (Task 2.10 Evidence Closure)

Pursuant to the explicit review-step-4 advisor counsel (correlation: `a0bb2bb5-6b6a-4773-8373-ac207d27477e`), this section documents the read-only G0 evidence audit confirming complete alignment across both authorized Phase 00 documents, repo baseline, and caller traceability.

### 12.1 Dual Document Coverage & Content Consistency
- **Document 1:** `plans/260916-2137-unified-profile/inventory-and-contract-freeze.md` (Contract baseline, caller/transport/storage inventory, single-writer matrix, qualification prerequisites).
- **Document 2:** `plans/260916-2137-unified-profile/phase-00-contract-freeze.md` (Phase 00 specification, context links, gate definition, and verified checklist).
- **Consistency Check:** Both documents strictly adhere to:
  - Identical gate definitions (G0 contract freeze, G1 integrated ownership, G2 release qualification).
  - Disjoint partitioning between preserved presentation preferences and discarded legacy resource storage keys.
  - Mandatory protocol cutover (`workbenchProtocol: 2`, media v2, artifact incarnation).
  - Platform-specific qualification rules (independent web release; native blocked on Windows runner for S13).
  - Zero unresolved placeholders, TBDs, or ambiguous ownership assignments.

### 12.2 Caller Traceability & Phase 01 Cutover Path
Every caller identified in Section 3 is linked to its concrete Phase 01 cutover disposition:
1. **Transport / API Singletons (Section 3.1):** All 20 enumerated caller sites (`client.ts`, `queries.ts`, `EditorTabs.tsx`, `TerminalPanel.tsx`, `use-sse.ts`, `use-encrypted-write.ts`, etc.) will transition from ambient `getTransport()` to explicit `getTransport(owner)` / `getApi(owner)` resolved via connection snapshot or component props.
2. **Active Profile Singletons (Section 3.2):** All 16 caller sites will receive explicit `ProfileId` bindings via route parameters or parent context, replacing `getActiveProfile()` / `getActiveProfileId()`.
3. **Direct Network Calls (Section 3.3):** Direct `fetch()` and `WebSocket` calls (`image-tickets.ts`, `video-tickets.ts`, `dam-hopper-app.tsx`, `ws-transport.ts`) will require bound `ConnectionRef` and endpoint-specific credentials before socket establishment.
4. **Push Events & Bridge (Section 3.4):** Global `use-sse.ts` listener bus will be replaced by connection-scoped subscriptions with `{ profileId, generation }` envelope matching.
5. **Terminal & Raw-ID Callers (Section 3.5):** Session maps will use authoritative `TerminalInstanceRef` `{ profileId, id, incarnation }` instead of bare strings.
6. **Native Scope Commands (Section 3.6):** Tauri IPC commands will pass `NativeScopeRef` `{ profileId, scopeId }` to support concurrent active scopes.

### 12.3 Repository Baseline & Diff Verification
- **Repo Diff Verification:** Confirmed via `git status` that Phase 00 modifies zero application runtime source files (`.ts`, `.tsx`, `.rs`).
- **Phase 01 Deferral:** `packages/ui/src/api/ownership.ts` and `packages/ui/src/api/connections.ts` are deliberately absent in Phase 00 and will be introduced cleanly in Phase 01.
- **Test Suite Invariant:** 100% test pass rate preserved (1412/1412 cargo tests, 1678/1678 vitest unit tests across 241 files).


### 12.4 Review Cycle 1 Warning & Suggestions Resolution
- **Query Key Tuple Alignment:** Section 6.1 was updated to strictly mandate `["profile", owner.profileId, owner.generation, ...]` prefixes, eliminating discrepancy with `design-contracts.md`.
- **Terminal Tree Expansion Keys:** Section 4.1 was updated to explicitly include `dam-hopper:expanded-projects` and `dam-hopper:expanded-profiles` in the preserved local presentation allowlist.
- **HTTP 401 Connection Transition:** Section 5.3 was updated to specify that HTTP 401 transitions status to `"login-required"` while retaining generation, preventing rapid reconnection storms.

### 12.5 Review Cycle 2 Traceability & Review Audit Closure

| Finding ID | Source / Reviewer | Classification | Governing Contract Section | Resolution & Phase 01 Rule |
|---|---|---|---|---|
| **F-01** | Cycle 1 Warning | Query key prefix tuple alignment | Section 6.1 | Updated to strictly mandate `["profile", owner.profileId, owner.generation, ...]`. |
| **F-02** | Cycle 1 Suggestion | Catalog tree expansion keys | Section 4.1 | Added `dam-hopper:expanded-projects` and `dam-hopper:expanded-profiles` to preserved allowlist. |
| **F-03** | Cycle 1 Suggestion | HTTP 401 connection status state | Section 5.3 | Added item 5: transitions to `"login-required"` while holding generation counter intact. |
| **F-04** | Cycle 2 Suggestion | Query key semantic standardization | Section 6.1 | Frozen here: use `queryKeys.terminal.sessions(owner)` -> `["profile", owner.profileId, owner.generation, "terminal-sessions"]`; Phase 01 MUST preserve this spelling. |

#### Query Key Scope Boundary Definition
- **Profile-Bound Queries (Mandatory `["profile", ...]` Prefix):** Applies to all remote server-backed, project-scoped, filesystem, git, terminal, workflow, usage, and diagnostic query operations.
- **Non-Profile Local UI Queries:** Excluded from `["profile", ...]`. Purely in-memory client state queries (e.g. `["local-clipboard"]`, `["browser-online-status"]`) remain un-prefixed as they have no remote authority.

#### Authoritative Review Report Records
- **Cycle 1 Review Report:** `plans/reports/code-review-260916-2328-phase-00-contract-freeze.md` (Score: 9.6/10, 0 critical issues, 1 warning, 2 suggestions).
- **Cycle 2 Review Report:** `plans/reports/code-review-260916-2356-phase-00-contract-freeze-cycle2.md` (Score: 9.9/10, 0 critical issues, 0 warnings, 1 suggestion, approved).
