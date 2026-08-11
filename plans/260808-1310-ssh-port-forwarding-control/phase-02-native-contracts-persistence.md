# Phase 02: Native Contracts, Persistence, and Scope Retention

## Context links

- [Plan](./plan.md)
- [Phase 01 feasibility gates](./phase-01-dependency-platform-gates.md)
- [Native IPC research](./research/researcher-03-native-ipc-report.md)
- [Native codebase delta](./research/researcher-04-native-codebase-delta.md)
- [Architecture correction](./reports/02-native-ipc-architecture-correction.md)
- [System architecture](../../docs/system-architecture.md#ssh-port-forwarding-control-planned-native-desktop-v1)
- [Code standards](../../docs/code-standards.md)

## Overview

- **Priority:** P1
- **Status:** In progress — final review/remediation accepted (6/10); residual validation risks remain
- **Effort:** 12h
- **Description:** Freeze decimal-string IPC counters, client/activation ordering identities, profile/runtime DTOs, independent stores, stable desktop identity, and deterministic orphan-scope retention/purge.

## Key Insights

- JavaScript cannot represent every Rust `u64`; all unbounded revisions/generations/tokens cross IPC as canonical decimal strings.
- Caller order alone resets on reload. A stable desktop identity, random manager-session identity, Rust-issued client epoch, and caller-monotonic activation token form a safe ordering tuple.
- Durable intent and runtime remain separate. Profiles/trust/scope retention persist; sockets, tasks, challenges, manager session, client epoch, activation token, generations, and errors reset with the native process.
- Native scope data can outlive a deleted browser `ServerProfile`; observed deletion needs explicit purge while unobserved or transiently missing scopes need a quarantine, not immediate deletion.
- V1 remote target policy is intentionally narrow: host is exactly `127.0.0.1`; only target port is editable.

## Requirements

### Scalar wire rules

- `WireCounter` is a JSON string matching `^(0|[1-9][0-9]{0,19})$`, parsed once to `u64`; no sign, whitespace, decimal point, exponent, or leading zero. Rust serializes canonical base-10. Strings are wire representation only: ordering/equality/conflicts use parsed numeric values, and lexicographic string comparison is prohibited.
- Encode `profilesRevision`, `trustRevision`, `scopeGeneration`, runtime `generation`, `clientEpoch`, `activationToken`, and any current/expected variants as `WireCounter`. Ports and bounded counts remain JSON integers.
- Every increment uses `checked_add(1)`. Overflow returns `COUNTER_EXHAUSTED`; revisions refuse writes, generations refuse new workers, and client/activation ordering refuses new admission. Never wrap, reset, saturate, or silently regenerate.
- Every timestamp is RFC3339 UTC with exactly millisecond precision and `Z`, e.g. `2026-08-08T06:10:00.123Z`. Reject offsets, missing milliseconds, leap/invalid dates, and non-UTC wire values.
- All DTO structs use `#[serde(rename_all="camelCase", deny_unknown_fields)]`; tagged unions use exact lower-camel tags.

### Exact shared DTOs

```ts
type WireCounter = string;
type UtcTimestamp = string;
type DesktopClientContext = {
  desktopInstanceId: string; managerSessionId: string; clientEpoch: WireCounter;
};
type KnownScopesInput =
  | { status: "available"; ids: string[] }
  | { status: "unavailable" };
type OpenClientResult = {
  context: DesktopClientContext; activationTokenFloor: WireCounter;
  activeScopeId: string | null; scopeGeneration: WireCounter;
};
type SshForwardAuth = { mode: "agent" } | { mode: "key"; keyId: string };
type ReconnectPolicy = { enabled: boolean; maxAttempts: number }; // 0 or 1..5
type SshForwardProfile = {
  id: string; scopeId: string; name: string; sshHost: string; sshPort: number;
  sshUser: string; auth: SshForwardAuth; localPort: number;
  targetHost: "127.0.0.1"; targetPort: number; autoStart: boolean;
  reconnect: ReconnectPolicy; createdAt: UtcTimestamp; updatedAt: UtcTimestamp;
};
type SshForwardState = "stopped" | "starting" | "running" | "reconnecting" | "stopping" | "failed";
type AutoStartDisposition = "notRequested" | "queued" | "started" | "skippedActiveLimit";
type SshForwardRuntime = {
  profileId: string; generation: WireCounter; state: SshForwardState;
  bindHost: "127.0.0.1"; localPort: number; retryAttempt: number;
  activeChannels: number; autoStartDisposition: AutoStartDisposition;
  stateChangedAt: UtcTimestamp; startedAt?: UtcTimestamp; errorCode?: SshForwardErrorCode;
};
type HostKeyChallenge = {
  challengeId: string; profileId: string; generation: WireCounter;
  sshHost: string; sshPort: number; algorithm: string; fingerprint: string;
  expiresAt: UtcTimestamp;
};
type SshForwardSnapshot = {
  context: DesktopClientContext; scopeId: string; activationToken: WireCounter;
  scopeGeneration: WireCounter; profilesRevision: WireCounter; trustRevision: WireCounter;
  profiles: SshForwardProfile[]; runtimes: SshForwardRuntime[];
  hostKeyChallenges: HostKeyChallenge[];
};
type SshForwardScopeActivation = {
  context: DesktopClientContext; activationToken: WireCounter;
  scopeId: string | null; scopeGeneration: WireCounter;
  snapshot: SshForwardSnapshot | null;
};
type SshKeyInventoryItem = { keyId: string; label: string; algorithm: string; fingerprint: string };
type SshKeyInventory = {
  context: DesktopClientContext; scopeId: string; scopeGeneration: WireCounter;
  keys: SshKeyInventoryItem[];
};
type SshForwardEventHint = {
  desktopInstanceId: string; managerSessionId: string; clientEpoch: WireCounter;
  activationToken: WireCounter;
  scopeId: string; scopeGeneration: WireCounter; profilesRevision: WireCounter;
  trustRevision: WireCounter; profileId?: string; generation?: WireCounter;
  reason: "profilesChanged" | "runtimeChanged" | "trustChanged";
};
```

### Identity, activation, revision, and generation semantics

- `desktopInstanceId`: UUID v4 stored once at `app_config_dir()/ssh-forward/desktop-instance.toml`; stable across native restarts/reloads. Corruption fails closed. Deliberate deletion while app stopped creates a new identity on next start; old webviews cannot survive the native-process restart.
- `managerSessionId`: random UUID v4 generated per native process, memory-only. Every command/event after open-client carries it; mismatch rejects stale IPC after restart.
- `ssh_forward_open_client` atomically increments process-local `clientEpoch`, returns context plus current activation-token floor. A later opened webview has a higher epoch; all commands from lower epochs are stale.
- Within one client epoch, adapter issues strictly increasing `activationToken` wire strings for activate/deactivate. Rust strictly parses both tuple members to `u64` and orders intents numerically by `clientEpoch`, then numerically by `activationToken` within the same epoch. Never compare serialized strings: `"10"` is newer than `"9"`, and `"100"` is newer than `"99"`.
- Activation records latest intent before waiting for the serialized apply gate, then rechecks after every stop/load await and before publish/auto-start. Superseded work closes staged resources and returns `ACTIVATION_SUPERSEDED`; it cannot overwrite the latest scope.
- Same-scope activation from a newer reload epoch updates ordering ownership and returns the existing runtime/listeners without incrementing `scopeGeneration`. Different scope/null stops prior resources, then increments `scopeGeneration` once at commit.
- Process restart safely resets manager session/client epoch/activation token/scope/runtime generations because old IPC clients/tasks are gone; persistent desktop identity and profile/trust revisions do not reset.
- `profilesRevision` and `trustRevision` are independent persisted `u64`s. Successful profile CRUD or trust approval respectively increments once. Runtime/lifecycle/inventory/snapshot/purge does not increment them.
- Runtime generation starts `"0"`; each newly admitted worker increments once even if later connect/auth/bind fails. Idempotent start and stop do not increment; replacement after restart increments once.

### Validation, storage, and orphan policy

- UUID v4 IDs; SSH endpoint canonicalization defined in Phase 03; name/user <=64 scalars; host <=253 safe ASCII; opaque key ID <=128 safe ASCII; ports exactly `1..=65535`.
- Local bind and remote target hosts are Rust literals `127.0.0.1`. Reject port 0, wildcard, IPv6, hostname, or client-supplied target host. V1 can reach only services listening on remote IPv4 loopback.
- Per-scope directory: Tauri-resolved `app_config_dir()/ssh-forward/scopes/<lowercase sha256(scope UUID)>/` containing `profiles.toml`, `known-hosts.toml`, and `scope-meta.toml`. Profiles cap 64.
- Resolve/open the app-config and `ssh-forward` roots once through platform APIs; reject symlink/junction/reparse components and retain contained directory handles. Every profile/trust/meta read, temp write, atomic replace, backup, quarantine rename, tombstone delete, and purge is root-relative through those handles; reject escapes, swaps, non-regular files, and multi-link files. Never re-open a validated path by string.
- `scope-meta.toml` stores schema version, scope UUID, `last_seen_at`, and optional `orphaned_at`; it contains no runtime/secret. Writes are serialized/atomic through `spawn_blocking`.
- `open_client` accepts all current browser server-profile UUIDs as `KnownScopesInput.available` (max 256). Present scopes refresh `lastSeenAt`/clear `orphanedAt`; absent scopes set `orphanedAt` once. `unavailable` never starts/advances orphan aging.
- Absent scope data is quarantined 30 continuous days. On open-client/startup reconciliation, expired inactive scopes are atomically renamed to a tombstone then deleted. Active/staged scope never purges.
- Observed `ServerProfile` deletion invokes explicit `ssh_forward_purge_scope` after deactivation. Purge requires current client context, deleted scope absent from the supplied available known-scope list, and scope inactive; it removes profiles/trust/meta, is idempotent, and returns `{scopeId,purged}`. No secure-erasure claim.
- TOML denies unknown/secret-shaped fields. Never store HTTP URL/token, password/passphrase, key bytes/path, challenge, socket/task/runtime/raw error.

## Architecture

```text
desktop-instance.toml -> stable desktopInstanceId
native process -> managerSessionId + clientEpoch + activation ordering (memory only)

app_config_dir/ssh-forward/scopes/<sha256(ServerProfile UUID)>/
  profiles.toml | known-hosts.toml | scope-meta.toml

known browser scopes -> refresh / 30-day quarantine
observed deletion -> deactivate -> purge_scope (inactive only)
```

One Rust model module feeds persistence, manager, commands, TypeScript fixtures, and tests. No HTTP/WS mirror.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` - desktop-only exports.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` - exact DTO/scalar validators and limits.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\error.rs` - stable error DTO/code type.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\instance.rs` - stable desktop ID and process/client context.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store.rs` - profile/trust/meta atomic stores.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\scope_retention.rs` - known-scope reconciliation, quarantine, purge.

### Modify

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.toml` - accepted desktop-target storage/serde/time dependencies.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.lock` - lock reviewed graph.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\lib.rs` - declare module under `cfg(desktop)`.

### Delete

- None.

## Implementation Steps

1. Implement strict `WireCounter` and UTC-millisecond timestamp serde adapters plus shared JSON fixtures for Rust/TypeScript.
2. Implement stable desktop instance store and memory-only manager-session/client-epoch allocation. Corrupt identity fails; intentional stopped-app reset produces new ID.
3. Implement all DTO/domain validation. Target/bind hosts are literals, not accepted create/update inputs.
4. Implement independent profile/trust/meta stores using Phase 01 atomic helper; exact checked revisions and no partial in-memory commit on failure.
5. Implement hashed scope directories and meta timestamps using contained root/directory handles. Apply no-follow/reparse, same-object, regular/single-link, and descendant checks to every profile/trust/meta read/write/backup/quarantine/purge operation.
6. Implement available/unavailable known-scope reconciliation, 30-day continuous quarantine, inactive tombstone-delete cleanup, and explicit idempotent inactive purge.
7. Add tests: malformed/overflow counters; numeric `9 -> 10` and `99 -> 100` activation/revision/generation ordering; timestamp variants; identity corruption/reset; hashing; secret/unknown fields; concurrent writes; transient unavailable known scopes; absent->present recovery; 29/30-day boundary; observed deletion; active purge denial; crash during tombstone delete.
8. Adversarially swap each scope/root/file component with symlink, junction/reparse point, hard link, or renamed directory between validation and read/write/replace/quarantine/purge; every operation must fail closed outside the retained contained handle.
9. Prove saved SSH endpoint remains unchanged after its browser `ServerProfile.url` changes and native does not persist that URL.

## Todo list

- [ ] Decimal counter and UTC timestamp fixtures pass Rust/TypeScript parity.
- [ ] Overflow fails closed for every counter class.
- [ ] Numeric 9/10 and 99/100 counter boundaries never use lexical ordering.
- [ ] Stable desktop/process/client identity semantics pass restart/reload tests.
- [ ] Independent revisions and atomic stores pass.
- [ ] Target and bind hosts are fixed `127.0.0.1`.
- [ ] 30-day quarantine and available/unavailable semantics pass.
- [ ] Explicit inactive scope purge passes and cannot touch active scope.
- [ ] No protected server/query/WS source changes.

## Success Criteria

- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::model`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::instance`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::store`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::scope_retention`
- JSON fixtures never emit numeric revision/generation/token values or non-UTC/non-millisecond timestamps.
- A/B/C and reload ordering prerequisites (desktop/manager/client/token tuple) are deterministic before manager implementation.
- Missing browser storage for 30 days is distinguishable from one `unavailable` read and cannot immediately erase scope data.

## Risk Assessment

- **Identity/counter reset ambiguity:** Bind every call/event to stable desktop plus random manager session; old process clients cannot cross restart.
- **Accidental orphan deletion:** Available/unavailable distinction, 30-day continuous quarantine, active denial, tombstone rename.
- **Revision overflow/corruption:** Checked increment and fail closed; never reset.
- **Schema overreach:** Fixed local forwarding/remote loopback only; no generic target or SSH options.

## Security Considerations

- Hashed paths avoid raw UUID directory names; store files still validate embedded scope UUID against requested hash.
- All native store operations, not only key inventory, use retained no-follow/reparse-safe contained handles and fail closed under component-swap races.
- Purge removes non-secret profiles/public trust records only; no secure-erasure promise.
- Error/serialization tests exclude paths, endpoints, usernames, labels, source chains, and secret material.
- `desktopInstanceId` is an IPC binding identifier, not authentication or a secret.

## Next steps

- Phase 03 consumes these exact wire/scalar/store contracts.
- Phase 04 implements manager-authoritative activation admission using the identity/token tuple.
- Close the approved residual risks before marking Phase 02 complete: deterministic staging-file race coverage, decoded-fingerprint canonicality validation, and a real process-crash/restart proof covering replacement recovery and restart-idempotent purge.

### Unresolved Questions

- Final desktop instance reset UX remains implementation documentation; silent reset is prohibited.
- Thirty-day orphan retention is accepted here as conservative v1 policy and should be revisited only with product data-retention requirements.
- The final review did not authorize completion; implementation remains in progress pending the three residual proofs above.
