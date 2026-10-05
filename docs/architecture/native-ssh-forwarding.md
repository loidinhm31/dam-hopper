# Native SSH Forwarding Architecture

**Authority:** Native Desktop Host (`apps/native/`, `apps/native/src-tauri/src/ssh_forward/`, `packages/ui/src/contexts/SshForwardHostContext.tsx`)  
**Status:** Maintained Architecture Specification  

This specification defines the multi-scope concurrent SSH forwarding architecture for the DamHopper native desktop host. Each server profile maps to an independent native scope. The native manager treats each profile as an isolated forwarding scope; project focus, route changes, Settings navigation, and page focus do not open, close, or replace another scope.

**Platform Boundary:** SSH forwarding is strictly a Windows desktop capability (`cfg(windows)`). The web browser and native mobile hosts receive no SSH-forward host or Tauri command fallback. Native Browser Debug is a separate child-WebView capability that consumes the explicit Browser target owner defined in [Agent Store, Ports, and Browser Architecture](./agent-store-ports-and-browser.md).

## Lifecycle Contract

The shared contract is in `packages/ui/src/lib/ssh-forward-host.ts`; Rust DTOs are in `apps/native/src-tauri/src/ssh_forward/model.rs`.

```typescript
interface NativeScopeRef {
  context: DesktopClientContext;
  scopeId: string;
  scopeGeneration: WireCounter;
  activationToken: WireCounter;
}

interface ScopeHandle {
  ref: NativeScopeRef;
  snapshot: SshForwardSnapshot;
}

openClient(knownScopes): Promise<{ context: DesktopClientContext }>;
openScope(scopeId): Promise<ScopeHandle>;
closeScope(scope: NativeScopeRef): Promise<void>;
reconcileKnownScopes(knownScopes): Promise<void>;
```

- `openClient` starts a new client epoch. It tears down every live scope, runtime, worker, connection, and in-memory credential, then rehydrates persisted scope metadata. It is the only global reset boundary; old scope references and context checks fail closed.
- `openScope` validates the current desktop/manager/client context, loads one scope, acquires its activity lease, starts configured auto-start connections, and returns a scope reference plus authoritative snapshot. Reopening an already-active scope is idempotent and returns its existing generation.
- `closeScope` validates the supplied reference, removes the scope from live admission before teardown, then stops only that scope's workers and connections, clears its live keys/passwords and host-key challenges, and releases its lease. A sibling scope stays live.
- `reconcileKnownScopes` accepts either `{ status: "available", ids }` or `{ status: "unavailable" }`. It updates retention metadata without opening, closing, changing generations, or advancing the client epoch. Unavailable storage is not interpreted as an empty list and cannot trigger purge.
- `purgeScope(scopeId, knownScopes)` is an inactive-scope retention operation; profile deletion invokes it only after the browser profile is confirmed absent and known-scope state is available.

All snapshot and mutation methods receive `NativeScopeRef`. The reference binds `desktopInstanceId`, `managerSessionId`, `clientEpoch`, `scopeId`, `scopeGeneration`, and `activationToken`. Rust and TypeScript parse canonical unsigned decimal strings numerically; lexical ordering is prohibited and counter overflow returns an error.

## Runtime and Teardown Isolation

`apps/native/src-tauri/src/ssh_forward/manager.rs` owns a `HashMap<scopeId, ActiveScope>`. `connection_runtime.rs` keys the connection registry by `(scopeId, connectionProfileId)` and keeps child forwarding rules under that connection. Consequently, equal imported connection or rule IDs in different server profiles do not collide.

Scope-local cleanup is explicit:

1. Remove the scope and token from live admission;
2. Abort scope-prefixed worker handles;
3. Cancel and close only registry entries for the scope;
4. Force-close remaining scope children;
5. Clear scope-keyed loaded keys/passwords;
6. Clear scope-keyed host-key challenges.

Global limits remain enforced by the registry: 16 established connections, four concurrent handshakes, 64 enabled rules, and 64 channels per connection. Loopback local ports are exclusive across active scopes, so a port collision is reported rather than exposing two ambiguous listeners. Network loss enters reconnect handling and does not close the scope. Explicit disconnect, scope close, profile removal, and application shutdown close its live resources.

A new `openClient` epoch first records the latest intent, then performs global worker/connection/resource teardown before returning its new context. Delayed operations from an older epoch fail context checks and cannot publish a stale snapshot or event. App shutdown uses the same native shutdown coordinator; `beforeunload` also disposes the frontend adapters.

## Desktop IPC Surface

The Tauri facade is in `apps/native/src-tauri/src/ssh_forward/commands.rs`. The canonical list is shared by the Rust handler test, `command_names.in.rs`, and the permission manifest. Windows registers exactly these 20 active commands:

| Lifecycle / Snapshot | Data and Runtime | Credentials / Trust | Retention |
| --- | --- | --- | --- |
| `ssh_forward_open_client` | `ssh_forward_create_connection` | `ssh_forward_list_keys` | `ssh_forward_purge_scope` |
| `ssh_forward_open_scope` | `ssh_forward_update_connection` | `ssh_forward_load_key` | |
| `ssh_forward_close_scope` | `ssh_forward_delete_connection` | `ssh_forward_load_password` | |
| `ssh_forward_reconcile_known_scopes` | `ssh_forward_create_rule` | `ssh_forward_forget_credential` | |
| `ssh_forward_snapshot` | `ssh_forward_update_rule` | `ssh_forward_approve_host` | |
| | `ssh_forward_delete_rule` | | |
| | `ssh_forward_connect` | | |
| | `ssh_forward_disconnect` | | |
| | `ssh_forward_set_rule_enabled` | | |

Every command strictly requires the Tauri `main` webview label. The `ssh-forward` capability grants the permission only to `main` on Windows; secondary child WebViews, browser hosts, Android, and iOS do not receive this surface. The Axum server has no native forwarding CRUD route or WebSocket authority.

## Persistence and Trust

The Windows store lives below Tauri `app_config_dir`:

```text
ssh-forward/
├── desktop-instance.toml
├── scopes/<sha256(scope UUID)>/
│   ├── profiles.toml
│   ├── known-hosts.toml
│   └── scope-meta.toml
└── ssh-forward.lock
```

Persisted profile/rule/trust revisions survive restart. Client epochs, activation tokens, scope generations, connection generations, workers, sockets, credentials, and runtime snapshots are memory-only. Contained no-follow handles, atomic replacement, protected locks, and mode-appropriate permissions remain required for every store operation.

Host trust is endpoint-first. An unknown endpoint creates one bounded challenge; approval must echo the exact algorithm and fingerprint. Only elliptic curve algorithms are supported (`ssh-ed25519`, `ecdsa-sha2-nistp256/384/521`); RSA is rejected. Changed keys or algorithms require stopped-app trust repair (`dam-hopper.exe --ssh-forward-trust-repair`) and explicit later approval/start. Snapshots and events expose status and redacted error codes, never passphrases, private keys, vault targets, or raw SSH options. Live keys and passwords are zeroized/cleared at scope close, global epoch reset, and shutdown; an unexpired Windows Credential Manager entry may remain for later explicit reconnect.

## React Host Lifecycle

`apps/native/src/native-ssh-forward-host.ts` maps the command names and keeps `Map<scopeId, ScopeHandle>` plus per-scope mutation/snapshot freshness state. The adapter:

- Installs one event listener and calls `openClient` once per native client initialization;
- Clears all local scope state when a new client context is returned;
- Validates exact context, token, scope, generation, revision, DTO keys, UUIDs, timestamps, ports, and bounded strings before accepting any result;
- Serializes mutations per scope and treats `ssh-forward:changed` as a refetch hint, never as patch authority;
- Drops stale or mismatched hints and results; and
- Returns `null` from `createNativeSshForwardHost` unless the platform is Windows (`platform === "windows"`).

`SshForwardScopeBridge` in `packages/ui/src/contexts/SshForwardHostContext.tsx` derives known native scope IDs from the server profile list, opens the client once, reconciles on profile list changes, and purges a deleted profile only after storage reports an available list. `useSshForward` accepts an explicit `NativeScopeRef` (or scope ID for host-assisted opening) and sends that reference with every operation.

Profile connection lifecycle and native scope lifecycle remain related but separate: a profile Connect/Disconnect/Remove event may open, close, or purge that profile's scope, while project focus and selected Browser/Settings target changes do not switch native forwarding state.

## Native Browser Debug Owner Boundary

`BrowserDebugTarget` is defined as:

```typescript
{
  owner: ConnectionRef;
  url: string;
  origin: string;
  source: "loopback" | "tunnel";
  tunnelId?: string;
  revision: number;
}
```

`NativeBrowserDebugHost.setTarget` receives this complete target. It creates one labeled `browser-debug` child, binds the child to `target.owner.profileId`, committed origin, URL, navigation generation, nonce, and session identity, and rejects stale relay messages. Target navigation invalidates selection/picker state; replacing or clearing the target destroys only that child. Project focus or terminal focus does not infer a new owner. Native Browser Debug exposes picker/navigation only; console relay remains disabled.

This Browser lease is independent from SSH scope selection. The application does not derive a Browser target from whichever SSH scope was opened most recently, and does not route a target through an active-profile fallback after an owner or generation mismatch.

## Platform Capability Matrix

| Surface | Windows (x64) | Linux (x64) | macOS / Mobile |
| --- | --- | --- | --- |
| Native SSH forwarding | Release-gated (`cfg(windows)`, pending Windows S13 packaged runtime qualification) | Unsupported | Unsupported |
| Native Browser child | Release-gated (WebView2, pending Windows S13 packaged runtime qualification) | Partial (WebKitGTK, runtime unverified) | Mobile iframe host only |
| Shared web Browser | iframe / extension policy | iframe / extension policy | iframe / extension policy |

## Source Map

| Boundary | Source |
| --- | --- |
| Rust lifecycle/manager | `apps/native/src-tauri/src/ssh_forward/manager.rs` |
| Rust DTOs and wire counters | `apps/native/src-tauri/src/ssh_forward/model.rs` |
| Scope-keyed runtime | `apps/native/src-tauri/src/ssh_forward/connection_runtime.rs` |
| Tauri handler boundary | `apps/native/src-tauri/src/ssh_forward/commands.rs` |
| ACL and capability | `apps/native/src-tauri/permissions/ssh-forward.toml`, `apps/native/src-tauri/capabilities/ssh-forward.json` |
| React host adapter | `apps/native/src/native-ssh-forward-host.ts` |
| Scope bridge and hook | `packages/ui/src/contexts/SshForwardHostContext.tsx`, `packages/ui/src/hooks/use-ssh-forward.ts` |
| Shared contract | `packages/ui/src/lib/ssh-forward-host.ts`, `packages/shared/src/ssh-forward-contract-fixtures.json` |
| Browser owner adapter | `packages/ui/src/lib/browser-debug-origin.ts`, `apps/native/src/native-browser-debug-host.ts` |
