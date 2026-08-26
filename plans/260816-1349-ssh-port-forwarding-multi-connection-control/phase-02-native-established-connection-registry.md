# Phase 02: Native established-connection registry

## Context Links

- [Plan](./plan.md)
- [Phase 01](./phase-01-v2-contract-atomic-migration.md)
- [Architecture decision](./reports/advisor-architecture-decision.md)
- [Established-connection architecture](../../docs/system-architecture.md#planned-established-connection-forwarding-model)
- Baseline symbols: `SshForwardManager`, `ActiveScope`, `RuntimeEntry`, `run_profile`, `start_inner`, `stop_inner`, `stop_all_workers` in `manager.rs`; `SshSession`, `open_direct_tcpip`, `ChannelLimiter`, `forward_socket` in `ssh_client.rs`.

## Overview

- Date: 2026-08-16
- Description: Replace per-forward workers with a bounded registry of reusable established SSH sessions and independent port children.
- Priority: P2
- Implementation status: Completed 2026-08-17
- Review status: Completed; concurrency and lifecycle findings dispositioned

## Key Insights

- Current `run_profile` creates one `SshSession` per port. Sharing requires moving session ownership above listeners, not caching a profile worker.
- `russh::client::Handle` supports channel opening through shared references. `SshSession::close` can become idempotent/shared-reference shutdown, avoiding session clones.
- One active DamHopper scope remains sufficient: many target registries live inside `ActiveScope`; a scope switch still closes everything.
- Port failure isolation requires child state/generation separate from parent connection state/generation.

## Requirements

- Registry key: stable connection profile ID. Runtime admission also checks active scope ID/generation and numeric expected connection generation.
- Connection states: `disconnected`, `authenticating`, `established`, `reconnecting`, `disconnecting`; errors attach to `disconnected`/runtime metadata, not persisted profile.
- Rule states: `off`, `opening`, `on`, `closing`, `failed`, each with numeric generation, bind metadata, active channel count, timestamps, redacted error code.
- `connect` explicitly establishes/authenticates; `disconnect` closes all children/session and invalidates the generation. A saved profile alone never authorizes a listener.
- `setRuleEnabled(true)` accepts no credentials and opens only after native lookup proves exact scope, profile ID, current generation, and `Established`. Disable is idempotent cleanup-only and may close an existing child during teardown.
- Enforce 16 admitted live connections (`authenticating|established|reconnecting|disconnecting`), 64 desired-enabled rules per scope, four simultaneous handshakes, and 64 channels per connection.
- Duplicate enable/disable is idempotent; stale start/stop/start results cannot resurrect old listeners.
- One rule bind/open failure leaves sibling listeners, channels, and session healthy.

## Architecture

`SshForwardManager.active_scope -> ConnectionRegistry<HashMap<connectionId, ConnectionEntry>> -> Arc<SshSession> + HashMap<ruleId, ForwardChild>`.

- `ConnectionEntry`: profile snapshot, generation, state, lifecycle cancellation, session, memory-lease placeholder, child map, retry state, channel limiter. Persistent vault ownership stays in Phase 03.
- `ForwardChild`: rule snapshot, generation, listener task/cancellation, channel task set, state/error counters.
- Use a short manager map lock only for validation/reservation/snapshot cloning. Never hold it over bind, SSH connect, channel open, shutdown, task join, or store I/O.
- Serialize parent lifecycle per connection; child operations use expected parent+rule generations. Recheck tokens after every await before publishing state.
- Existing activation intent gate remains manager-authoritative. Same-scope webview reload rehydrates runtimes; new scope closes all entries before commit.

## Related Code Files

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\connection_runtime.rs` — **create**: `ConnectionEntry`, `ForwardChild`, lifecycle cancellation, generation-safe child management, snapshot projection.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\manager.rs` — **modify**: replace profile-scoped `runtimes`/workers and `run_profile` with connection registry CRUD/lifecycle/rule controls; preserve activation/purge/dispose gates.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\ssh_client.rs` — **modify**: reusable/idempotently closable `SshSession`, exact verified host identity result, multiplexed channel opening, per-connection channel limit.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` — **modify**: connection/rule runtime states, snapshot projections, generation conflict metadata.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\error.rs` — **modify**: stable `CONNECTION_REQUIRED`, `CONNECTION_LIMIT`, `CONNECTION_NOT_ESTABLISHED`, `STALE_CONNECTION_GENERATION`, `RULE_LIMIT`, `STALE_RULE_GENERATION`, `PORT_CONFLICT`, `CHANNEL_LIMIT` codes.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` — **modify**: register private runtime module.
- No Axum/server file — **no change**.

## Implementation Steps

1. Add runtime structs with snapshot-only safe fields and generation helpers based on `WireCounter::increment`; fail `COUNTER_EXHAUSTED` rather than wrap.
2. Refactor `SshSession` for one authenticated transport serving many `open_direct_tcpip` calls. Capture the exact algorithm/fingerprint/full-key identity accepted by `RusshHandler` for runtime lease binding; do not duplicate it into the connection profile.
3. Add connection admission reservation before handshake; count reservations toward 16 and use existing four-permit semaphore. Release reservation on every cancel/failure.
4. Implement `connect_connection`: validate scope/revision/profile/generation, transition to Authenticating, connect without a listener, then commit Established only if all identities/generations remain current.
5. Implement `disconnect_connection`: transition once, block new enables, cancel/join child listeners/channels, close session, clear the in-memory lease, increment generation, and publish Disconnected without deleting an unexpired vault entry.
6. Implement enable: reserve desired-enabled slot, bind `127.0.0.1`, recheck parent Established/generations, commit child listener, then accept sockets and multiplex channels through the shared session/limiter.
7. Implement disable: cancel listener, drain/abort channel tasks within shutdown grace, remove reservation, increment rule generation, preserve siblings.
8. Replace `auto_start_scope`: load desired-enabled rules but do not authenticate. After explicit establishment, open that connection's desired-enabled rules deterministically by `(createdAt,id)` within the 64-rule cap.
9. Preserve event throttle and authoritative snapshot projection. Events identify optional connection/rule generations but never patch UI state.
10. Add deterministic race tests: simultaneous connections, duplicate connect, connect/disconnect overlap, enable/disable/enable, disconnect during bind/channel open, scope switch, dispose, force-close, sibling port conflict, caps.

## Todo List

- [x] Add connection registry and child runtime module.
- [x] Make `SshSession` reusable across ports.
- [x] Implement explicit connect/disconnect lifecycle.
- [x] Implement generation-safe rule enable/disable.
- [x] Enforce all four resource caps.
- [x] Preserve activation/snapshot/event/shutdown invariants.
- [x] Pass race, isolation, and teardown tests.
- [ ] Phase 4 Tauri/TypeScript snapshot and IPC exposure remains deferred.

## Success Criteria

- Two rules for one connection use exactly one authenticated `SshSession`; different connection IDs use isolated sessions.
- No listener can reach `on` unless its native parent is current and Established.
- One failed rule does not change sibling rule/connection state.
- Scope switch, purge, disconnect, graceful shutdown, and force-close leave no listeners, channels, sessions, memory leases, or join handles. Vault retention/deletion follows Phase 03 policy.
- Numeric generation tests cover `9/10`, `99/100`, stale operations, and exhaustion. **Met** by native model/runtime tests.
- Tauri command registration, generated/shared TypeScript snapshots, and UI consumption remain deferred to Phase 4; they are not claimed as Phase 2 completion evidence.

## Implementation Notes

- Added `connection_runtime.rs` with scope-filtered connection/rule registry, parent/child cancellation, generation-safe admission/commit/cleanup, snapshot projection, and bounded channel accounting.
- `SshForwardManager` now reserves and explicitly establishes connections, reuses one authenticated `SshSession` across rule listeners, supports idempotent disconnect/disable, reconciles desired-enabled rules after explicit establishment, and tears down v2 workers during scope switch, purge, dispose, and force-close.
- `SshSession` supports shared direct-TCP channels with a per-connection limiter. Bind/target validation remains loopback-only; stable redacted error codes cover connection/rule/capacity conflicts.
- Legacy runtime compatibility remains in `manager.rs` until Phase 4 removes command aliases and completes the Tauri/TypeScript contract migration. This does not change the Phase 2 native registry acceptance boundary.

## Review Findings and Dispositions

- **Concurrency/lifecycle races:** Dispositioned with reservation-before-handshake, short registry locks, parent/rule generation rechecks after awaits, cancellation tokens, and stale worker cleanup tests.
- **Shared-session teardown:** Dispositioned with idempotent close, child cancellation/drain, force-close abort handles, and scope/dispose shutdown tests.
- **Resource exhaustion:** Dispositioned with caps for 16 live connections, 64 enabled rules, four handshakes, and 64 channels per connection; transitional states/reservations are counted.
- **Sibling isolation and bind conflicts:** Dispositioned with per-rule child state/generation and port-conflict isolation tests.
- **Secret/vault behavior:** Deferred to Phase 3 by design; Phase 2 does not persist or expose credentials.
- **Tauri/TypeScript snapshot and IPC compatibility:** Deferred to Phase 4; no Phase 2 completion claim for that work.

## Validation Evidence

- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml` — **passed**: 178 passed, 0 failed, 1 ignored; native crate compiled successfully.
- Passing focused evidence includes connection admission bounds, in-flight authentication counting, stale generation rejection, counter exhaustion, duplicate/zero-generation disable, sibling port isolation, disconnect invalidation, cancellation wake-up, stale worker cleanup, force-close, scope filtering, and shared channel-limit tests.
- The Windows OpenSSH end-to-end fixture remains ignored because it requires Windows OpenSSH server/client binaries; packaged Windows release validation remains Phase 6.
- Fresh local validation: `cargo test --lib` from `apps/native/src-tauri` — passed, 178 passed, 0 failed, 1 ignored; `cargo fmt --all -- --check` — passed (2026-08-17). The run includes the Phase 2 registry/lifecycle tests listed above.
- No live authenticated SSH multiplexing test was added in Phase 2; retain that integration/package validation for Phase 6.

## Risk Assessment

- **High — async race resurrects listener:** reserve/recheck/commit pattern plus expected generations after every await.
- **High — shared session teardown races channels:** parent cancellation, bounded child drain, idempotent session close.
- **High — resource exhaustion:** count transitional states and desired-enabled reservations, not only steady state.
- **Medium — manager lock contention:** short critical sections; per-connection lifecycle serialization.

## Security Considerations

- Native state, never UI flags, authorizes session/channel/listener creation.
- Bind and target remain literal IPv4 `127.0.0.1`; reject wildcard, IPv6, hostname, port zero, and duplicate local binds.
- Errors/events exclude usernames, key labels, target details, paths, raw russh chains, and payloads; cap detail at 512 chars.
- Local loopback is reachable by other desktop processes; retain existing warning and release acceptance.

## Next Steps

- Phase 03 fills the credential lease, host trust, and reconnect behavior used by the registry.
- Keep new manager methods private until Phase 04 exposes synchronized IPC. Phase 4 snapshot/TypeScript work remains deferred.

## Unresolved Questions

None.
