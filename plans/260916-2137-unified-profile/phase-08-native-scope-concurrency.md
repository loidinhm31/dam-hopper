# Phase 08 — Native scope concurrency and platform integration

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01–02 and Phase 05 Browser target contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Native scopes.

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

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 08A | Concurrent Rust scope admission and keyed runtime state | G0 NativeScopeRef/wire contract | Scope-local teardown; true epoch/global teardown unchanged |
| 08B | Atomic command/model/TS adapter/permission cutover | 08A contract; native shared-file owner | Exact new command surface; obsolete activate removed |
| 08C | UI scope lifecycle and explicit Browser target adapter | Phase 02 connection intent; Phase 05 target contract | Focus does not openClient/re-epoch or close peers |
| 08D | Windows runtime and support-matrix qualification | Integrated 08A–C; disposable SSH endpoints | S13 traffic, security negatives and evidence |

`openClient` is a real epoch transition, not a profile-list refresh. Invoke once per true host lifetime; `reconcileKnownScopes` never advances epoch. Preserve integer wire validation and global quotas. A Linux successful Cargo run cannot establish Windows-only manager behavior.


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

Exercise real openClient epoch transition separately from known-scope reconciliation; blocked/unavailable profile storage must suspend purge. Include exact command/permission allowlist negatives, wrong Tauri window, stale challenge/revision, same local-port collision, and global capacity shared across scopes.

Phase 08 checklist and S13 on Windows; Linux build cannot substitute for cfg(windows) runtime proof.

### Risk Assessment

Removing stop_all calls alone would bypass scope admission; maps, tokens and lifecycle must change together.

### Security Considerations

Keep Windows/main-window ACL, vault/trust, revision/generation checks, global quotas and real epoch shutdown.

### Next steps

#### Verification and risks

Windows runtime gate S13 uses disposable SSH endpoints with distinct markers, two scopes, equal IDs and conflicting local-port negative test; existing SSH manager/registry/host tests gain scoped teardown and epoch negatives. Run native TS tests/build everywhere supported; Windows Cargo tests are required for Windows-only modules. Existing `smoke:ssh-forward`/evidence validation is not itself runtime proof: record actual forward traffic, scope changes, teardown and security failures, then validate artifact-bound evidence. Current planning workstation is Linux; Windows runtime verification must be performed on a Windows runner/device, not marked passed from this host. Native Browser gate preserves documented WebView2 evidence; Linux runtime must remain explicitly unverified until exercised. No real user keys/trust stores used in qualification.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Windows runner/device and browser runtime access must be established at execution; unexercised platform gates remain blocked.
