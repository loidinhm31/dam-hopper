# Phase 04: Manager-Authoritative Lifecycle, Tauri IPC, and Shutdown

## Context links

- [Plan](./plan.md)
- [Phase 01 ACL/platform gates](./phase-01-dependency-platform-gates.md)
- [Phase 02 contracts/storage](./phase-02-native-contracts-persistence.md)
- [Phase 03 SSH/trust](./phase-03-ssh-transport-trust.md)
- [Architecture correction](./reports/02-native-ipc-architecture-correction.md)
- [Native bootstrap](../../apps/native/src-tauri/src/lib.rs)
- [System architecture](../../docs/system-architecture.md#ssh-port-forwarding-control-planned-native-desktop-v1)

## Overview

- **Priority:** P1
- **Status:** Complete — Windows native runtime validation passed (2026-08-14)
- **Effort:** 16h
- **Description:** Implement Rust-authoritative activation ordering, serialized forward lifecycle, deterministic auto-start, 14-command ACL surface, ephemeral password retry credentials, scope purge, bounded events, and actual Tauri close/exit disposal coordinated with Browser Debug.

## Current status

The reviewed lifecycle fixes are implemented:

- Worker shutdown signals all workers before awaiting, joins workers concurrently against one aggregate deadline, then force-cancels/reaps pending worker joins in the final deadline slice. Channel cleanup is deadline-bound.
- During `Reconnecting`, the bound listener accept-drops new local connections while an independently spawned reconnect handshake continues; new clients cannot backlog or starve the handshake.
- Auto-start sorts and reserves candidates deterministically, then launches independent starts concurrently; the worker handshake semaphore limits concurrent handshakes to four.

Windows native runtime validation now passes. The earlier `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` was caused by missing Common Controls v6 activation in Cargo test executables; the MSVC manifest fix embeds the dependency for all native executables. Runtime evidence includes a real in-process russh server, production listener start/stop, unknown-host challenge approval followed by explicit start, scope-switch/dispose closure, staged purge denial, force-close lock contention, 1,000 randomized activation schedules, deterministic barriers at every activation slow boundary, and bounded one-shot shutdown/event seams. `cargo test --no-fail-fast` passes with 139 passed and 1 ignored; formatting, check, Clippy, and diff checks pass. Phase 04 is complete for the native Windows scope; packaged release gates remain Phase 07.

## Key Insights

- An adapter epoch can discard a late response but cannot stop a delayed native activation from overwriting newer intent. Rust must admit/order/recheck activation before, during, and after slow work.
- New webviews need a higher Rust-issued client epoch. Within that epoch, caller-monotonic activation tokens express A/B/C order; lower old-client tokens can never regain ownership.
- Commands own truth; events only request a snapshot. Every command is bound to desktop, manager session, client epoch, activation token, scope generation, and relevant profile generation/revision.
- Main-window `Destroyed` is too late for graceful async shutdown. `WindowEvent::CloseRequested` and `RunEvent::ExitRequested` must prevent exit while one bounded coordinator disposes SSH and existing Browser Debug resources.
- Auto-start cap handling must be deterministic and visible, not HashMap order or silent omission.

## Requirements

### Exact 14-command IPC surface

TypeScript calls `invoke(commandName,{input})`; every nested field is camelCase and rejects unknown fields.

| # | Command | Exact input beyond nested DTO bodies | Success |
|---:|---|---|---|
| 1 | `ssh_forward_open_client` | `{ knownScopes }` | `OpenClientResult` |
| 2 | `ssh_forward_activate_scope` | `{ context, activationToken, scopeId: string \| null }` | `SshForwardScopeActivation` |
| 3 | `ssh_forward_snapshot` | `{ context, activationToken, scopeId, scopeGeneration }` | `SshForwardSnapshot` |
| 4 | `ssh_forward_create_profile` | `{ context, activationToken, scopeId, scopeGeneration, expectedProfilesRevision, profile }` | `SshForwardSnapshot` |
| 5 | `ssh_forward_update_profile` | `{ context, activationToken, scopeId, scopeGeneration, expectedProfilesRevision, profileId, expectedGeneration, profile }` | `SshForwardSnapshot` |
| 6 | `ssh_forward_delete_profile` | `{ context, activationToken, scopeId, scopeGeneration, expectedProfilesRevision, profileId, expectedGeneration }` | `SshForwardSnapshot` |
| 7 | `ssh_forward_start` | `{ context, activationToken, scopeId, scopeGeneration, profileId, expectedGeneration }` | `SshForwardSnapshot` |
| 8 | `ssh_forward_stop` | `{ context, activationToken, scopeId, scopeGeneration, profileId, expectedGeneration }` | `SshForwardSnapshot` |
| 9 | `ssh_forward_restart` | `{ context, activationToken, scopeId, scopeGeneration, profileId, expectedGeneration }` | `SshForwardSnapshot` |
| 10 | `ssh_forward_list_keys` | `{ context, activationToken, scopeId, scopeGeneration }` | `SshKeyInventory` |
| 11 | `ssh_forward_load_key` | `{ context, activationToken, scopeId, scopeGeneration, profileId, keyId, passphrase }` | `SshForwardSnapshot` |
| 12 | `ssh_forward_load_password` | `{ context, activationToken, scopeId, scopeGeneration, profileId, username, password }` | `SshForwardSnapshot` |
| 13 | `ssh_forward_approve_host` | `{ context, activationToken, scopeId, scopeGeneration, profileId, expectedGeneration, challengeId, algorithm, fingerprint, expectedTrustRevision }` | `SshForwardSnapshot` |
| 14 | `ssh_forward_purge_scope` | `{ context, activationToken, scopeId, knownScopes: {status:"available",ids:string[]} }` | `{scopeId:string,purged:boolean}` |

- All revision/generation/epoch/token fields are canonical decimal strings on IPC only. Handlers parse them to `u64` before numeric comparison; lexicographic comparison is forbidden. All handlers require main webview label and Phase 01 `ssh-forward` permission.
- `open_client` is the only command without prior context. It validates known scopes, allocates higher client epoch, and never changes active scope.
- `purge_scope` requires explicit available known-scope list excluding target, target inactive/not staged, valid current client/activation owner, and safe hashed store. Idempotent missing directory returns `purged:false`.
- App manifest, permission TOML, capability, invoke handler, adapter map, ACL tests, and command-count test all assert exactly the same 14 names. Password input is bounded, Windows-only, profile-scoped in memory, and never part of the durable profile DTO.

### Manager-authoritative activation ordering

- Keep short `intent` state `{desktopInstanceId,managerSessionId,latestClientEpoch,latestActivationToken,desiredScopeId}` separate from serialized slow `activationApply` gate.
- `open_client` checked-increments `latestClientEpoch`; any lower epoch becomes stale immediately. A client token must be strictly greater than the last accepted token for its epoch.
- Activation first validates IDs/canonical strings, parses both counters to `u64`, then under the short intent lock atomically records a strictly newer numeric `(clientEpoch,activationToken)` tuple and desired scope before waiting for the apply gate. Compare epoch numerically first and token numerically only within equal epoch; `9 < 10` and `99 < 100` regardless of wire length.
- Under apply gate, recheck that exact tuple: before stopping prior scope; after bounded stop await; after store/meta load await; before active-scope/scope-generation commit; before auto-start admission; before response/event publication.
- If superseded at a recheck, cancel/drop staged loads/tasks, close any staged handle, never publish/auto-start/commit, and return `ACTIVATION_SUPERSEDED` with current ordering context. Do not roll back newer intent.
- Delayed A after accepted B/C fails at admission. A paused during stop/load cannot commit after B/C record newer intent. B paused behind A cannot commit if C supersedes it. Only C commits.
- New client epoch on same-scope reload records ownership but returns existing live runtime/listener, same scope generation, no stop/reload/auto-start/worker generation. Old webview commands fail `CLIENT_EPOCH_STALE`.
- Process restart creates new manager session; adapter must open client again. Persistent desktop ID remains; runtime/token/client/scope generations reset safely because prior process owns no surviving listener/task/IPC.

### Profile lifecycle and deterministic auto-start

- One managed `Arc<SshForwardManager>`; short state locks, per-profile operation queues, cancellation tokens, semaphores, join handles. No lock across connect/store/stop/event await.
- Different committed scope/null closes every prior listener/channel/session within one aggregate 5-second grace before scope commit. Force-close handles then abort leftover tasks. New scope loads stopped generation `"0"` runtimes.
- Auto-start candidates sort by `(createdAt,id)` ascending. Reserve at most 16 active slots deterministically before launching; mark admitted `queued`, then `started`; remaining candidates stay stopped with `skippedActiveLimit` and `AUTO_START_SKIPPED_LIMIT`. Launch handshakes with max concurrency 4. Explicit later Start can admit a skipped profile when capacity exists.
- Start from stopped/failed increments generation once on worker admission, verifies trust/auth, then binds exact desktop `127.0.0.1:localPort`. Remote target is exact SSH-side `127.0.0.1:targetPort`.
- Matching Start while starting/running/reconnecting is idempotent. Stop is idempotent and never increments; active Stop closes listener/channels/session within 5 seconds. Restart stops observed generation then admits one replacement generation.
- Update/delete active returns `PROFILE_ACTIVE`. Delete stopped clears challenge. Stale scope/revision/generation calls have no side effect.
- Unknown challenge: repeated Start/Restart returns existing challenge/no generation; Stop clears; expiry permits a new Start/generation; approval consumes but requires explicit new Start. Changed key/algorithm never challenge/approve.
- Reconnect retains listener and generation, rejects new local clients while reconnecting, re-verifies trust, uses <=5 attempts/fixed backoff. Existing channels close on transport loss. No channel idle timeout; SSH keepalive handles transport death.

### Event hint

| Event | Exact camelCase payload | Consumer gate |
|---|---|---|
| `ssh-forward:changed` | `{desktopInstanceId,managerSessionId,clientEpoch,activationToken,scopeId,scopeGeneration,profilesRevision,trustRevision,profileId?,generation?,reason}` | Exact desktop/manager/clientEpoch/activationToken/scopeId, then numeric freshness/refetch only |

- Emit only `ssh-forward:changed` with Phase 02 hint. It includes desktop instance, manager session, client epoch, activation token, scope ID/generation, revisions, optional profile/generation, and reason.
- Adapter refetch requires exact `desktopInstanceId + managerSessionId + clientEpoch + activationToken + scopeId` equality with current context before numeric generation/revision freshness checks. Mismatch drops the hint. This filter is not authority; Rust admission and command snapshots remain authoritative.
- Coalesce per profile to <=4/sec; transitions/challenge/durable mutations only. Channel-count-only/per-packet events prohibited.
- Event contains no error detail, endpoint, target, username, key label/path/fingerprint, payload, full snapshot, or raw source.

### Actual Tauri shutdown lifecycle

- Replace direct `Builder::run(...).expect` with `Builder::build(...).expect` then `App::run` callback so `RunEvent` is observable.
- One `NativeShutdownCoordinator` has `Running -> Disposing -> Disposed` atomic state and owns idempotent triggers from main `WindowEvent::CloseRequested` and `RunEvent::ExitRequested`.
- On main close/exit request: call the event API's prevent-close/prevent-exit once; reject new forwarding commands with `SHUTDOWN_IN_PROGRESS`; spawn one Tauri async task with a 5-second aggregate deadline; dispose SSH manager and invoke existing Browser Debug `cleanup_on_main_close` exactly once; force-close/abort SSH leftovers; then request final main-window close/app exit.
- `RunEvent::Exit` is non-async last-chance fallback: close listener/SSH handles synchronously and abort tasks if coordinator was bypassed. OS force-kill cannot guarantee graceful disposal and is not claimed.
- Existing Browser Debug `Destroyed` cleanup remains idempotent fallback, not a second owner. Webview reload does not close the Tauri main window; adapter unlistens, native forwards survive for same-scope hydration.
- `createUpdaterArtifacts` emits bundle metadata only; no runtime updater/relaunch exists. V1 must not register an updater plugin/capability, call Tauri restart/relaunch, or expose in-app update/restart. CI source/manifest checks enforce this. Future updater support is blocked until install/relaunch enters this coordinator, awaits bounded disposal, and passes packaged listener-closure tests.

## Architecture

```text
open_client -> Rust clientEpoch
adapter A/B/C -> increasing activationToken
short intent admission -> serialized apply -> recheck after every await -> one commit

main CloseRequested OR RunEvent::ExitRequested
  -> prevent -> one ShutdownCoordinator
  -> SSH dispose + BrowserDebug cleanup (<=5s)
  -> force close/abort -> final close/exit
```

Commands remain authoritative. Existing Axum server, `server/src/port_forward/**`, PTY port detection, `/api/ssh/*`, and shared WS transport remain unrelated and unchanged.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\manager.rs` - intent ordering, scopes, lifecycle, auto-start, purge, snapshots.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\commands.rs` - exact 12 Tauri handlers.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\shutdown.rs` - idempotent close/exit coordinator shared with Browser Debug cleanup.

### Modify

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\lib.rs` - managed state, exact handler list, build/run event lifecycle, Browser Debug coordination.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` - manager/commands exports.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` - 12 inputs/results/event DTOs.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\error.rs` - current-value conflict fields.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\permissions\ssh-forward.toml` - keep exact 14-command allowlist synchronized.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\capabilities\ssh-forward.json` - main desktop inclusion only.

### Delete

- None.

## Implementation Steps

1. Implement context/open-client allocation and short intent state separately from activation apply serialization.
2. Implement activation admission/recheck/cleanup at every slow boundary. Add injectable barriers after intent, prior stop, after stop, after load, before commit, before auto-start, before publish.
3. Add A/B/C tests: delayed A after B/C; A paused while B then C supersede; B queued then C; old-client high token vs new-client low token; numeric token/epoch boundaries `9 -> 10` and `99 -> 100`; same-scope reload epoch; manager restart/session mismatch.
4. Implement deterministic scope stop/load/commit and auto-start sort/reservation/concurrency/skipped visibility.
5. Implement start/stop/restart/update/delete/challenge/reconnect semantics with decimal generation conflicts and no channel idle timeout.
6. Implement inactive explicit purge and 30-day reconciliation calls from open-client; test active/staged/racing purge denial.
7. Register exact 12 handlers and assert equality with AppManifest/permission/adapter fixtures; add command-side main label check.
8. Implement bounded redacted hint coalescer; prove client-epoch/context mismatch plus missing/reordered/duplicate hints cannot trigger refetch or change manager truth.
9. Refactor Tauri run lifecycle to shutdown coordinator. Integrate Browser Debug cleanup exactly once and add close/exit/reload/reentrant/timeout tests. Add a static/manifest test proving runtime updater/restart/relaunch remains absent; future enablement must add coordinator and packaged disposal tests first.
10. Prove Stop, scope switch, and graceful app exit make listener unreachable; no task/handle remains in manager maps.

## Todo list

- [x] Exactly 14 commands synchronized across manifest/permission/handler/tests — native suite passes.
- [x] A/B/C activation ordering implemented and exercised by randomized native schedules.
- [x] Same-scope reload behavior implemented and tested.
- [x] Process restart/session reset behavior implemented and tested.
- [x] Auto-start order/cap/concurrency/skipped implementation and tests pass.
- [x] Challenge repeat/approval/explicit restart behavior passes — manager and known-host runtime tests pass.
- [x] Inactive purge and retention races pass — active, staged, idempotent, and store race tests pass.
- [ ] Hint requires exact desktop/manager/client-epoch/activation/scope context before refetch — Phase 05 adapter work.
- [x] Tauri close/exit coordinates SSH and Browser Debug within 5 seconds — mock-runtime coordinator and event seam tests pass.
- [x] Runtime updater/relaunch remains blocked pending coordinator-backed packaged disposal proof.
- [x] Stop/switch/exit close listeners and channels — production russh and manager loopback probes pass.

## Success Criteria

- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::manager`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::commands`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml shutdown`
- `cargo clippy --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings`
- 1,000 randomized concurrent A/B/C activation schedules end with only maximum `(clientEpoch,activationToken)` scope committed; deterministic tests cover barriers after intent, before/after stop, after load, before commit, before auto-start, and before publish.
- Deterministic `"9" -> "10"` and `"99" -> "100"` activation/revision/generation fixtures prove numeric ordering and reject lexical comparators.
- Reload same scope produces one listener; Stop/switch/exit probes fail to reconnect after <=5 seconds.
- Main allowed/unauthorized denied/mobile absent tests pass for all 14 commands.

## Risk Assessment

- **ABA/late activation:** Stable desktop + manager session + Rust client epoch + strict caller token + rechecks.
- **Shutdown reentrancy:** One atomic coordinator; Browser Debug cleanup remains idempotent fallback.
- **Auto-start nondeterminism:** Sort/reserve before concurrent handshakes; explicit skipped disposition.
- **Purge race:** Inactive/not-staged check under activation intent, tombstone rename, idempotency.
- **Long idle channel resource use:** Hard 64 cap and explicit lifecycle; no hidden idle disconnect.

## Security Considerations

- ACL is exact and main-window-only; handler validates label/context too. Existing effective `core:default` is not misrepresented.
- Stale/superseded activations never auto-start or emit a state snapshot as if committed.
- Forced shutdown closes network handles before task abort, minimizing orphan reachability.
- Target and bind addresses are native literals; IPC cannot tunnel to remote LAN hosts.

## Next steps

- Phase 05 adapter must issue/open client context and strictly increasing decimal activation tokens.
- Phase 07 packages A/B/C, shutdown, listener-closure, and loopback acceptance evidence.

### Unresolved Questions

- None for the native Windows Phase 04 scope.
