# Phase 02 — reporter transport and PTY lifecycle

## Context links

- [Plan](./plan.md), [phase 01](./phase-01-semantic-contract-and-reducer.md), [architecture](../../docs/architecture/agent-status.md).
- Existing seams: `server/src/pty/manager.rs:1368-1474,4076-4195`, `server/src/main.rs:275-313`, `server/src/api/ws.rs:352-362`.
- Dependency: phase 01 contract/reducer.

## Overview

Date: 2026-09-28. Priority: P2. Implementation: pending. Review: pending implementation/security review.
Run a private authenticated collector inside the existing server; connect it to PTY lifetimes and existing browser transport. No new daemon or public reporter endpoint.

## Key Insights

- OMP can die while parent shell/PTY stays alive; PTY exit alone cannot revoke authority.
- Initial spawn and automatic respawn have separate environment assembly; both must mint fresh credentials.
- `RespawnOpts.env` and creation templates can be persisted. Never inject capabilities into those maps.
- Existing host-alert/idle-suspend channels demonstrate semantic messages separate from PTY output pressure.

## Requirements

- Bind `127.0.0.1:0` before restore; startup failure leaves ordinary terminals usable and status unavailable.
- Fixed private WebSocket route; authenticate terminal capability before upgrade, exact loopback Host/peer, reject Origin/query credentials.
- One runtime/store and one connection per reporting terminal; bound frames, admission, queues and lease per architecture.
- Private credential lifecycle covers creating/live/failure/replacement/kill/exit/dispose/restore/respawn/shutdown.
- 5-second extension heartbeat, 15-second monotonic lease; immediate unknown on socket close. No stdout/CPU/process polling.
- Protected snapshot + semantic pushes independent of browser terminal attachment. Lag triggers invalidation/reconciliation.

## Architecture

`AgentStatusRuntime` contains reducer state, scoped credentials and bounded semantic event channel. It is shared with AppState and PtySessionManager using an Arc-backed handle. A stable handle exists even when collector unavailable.

Reserve pending credentials after incarnation allocation; inject into CommandBuilder only. Publish live admission only once PTY publication commits. A fast child connecting while pending receives retryable admission response; failed/cancelled creates revoke it. Cleanup compares incarnation and reporter epoch before mutation.

Collector never takes PTY manager locks while holding runtime state. Manager-side short state mutation may reserve/revoke, but file/network operations and awaits stay outside manager locks. Publish immutable events after committed state.

Public snapshot `GET /api/agent-status/v1/snapshot` stays behind existing authentication. Pump `terminal:agentStatusChanged` and `terminal:agentStatusInvalidated` through the existing authenticated WebSocket control stream. Credential-bearing local protocol is never mounted on that router.

## Related code files

Create:
- `server/src/agent_status/runtime.rs` — shared state, credentials, admission, lease and shutdown.
- `server/src/agent_status/collector.rs` — loopback WebSocket protocol and limits.
- `server/src/api/agent_status.rs` — authenticated snapshot.
- `server/tests/agent_status_runtime.rs` — actual sockets/lifecycle isolation.
Modify:
- `server/src/main.rs` — runtime construction before restore; shutdown ownership.
- `server/src/state.rs` — expose the same runtime, not a duplicate state store.
- `server/src/pty/manager.rs`, `session.rs` — spawn guards/private credential lifetime and all revocation paths.
- `server/src/pty/event_sink.rs` — dedicated semantic channel where consistent with existing event ownership.
- `server/src/api/mod.rs`, `router.rs`, `ws.rs`, `ws_protocol.rs` — snapshot, push/invalidation and lifecycle cleanup.
- `server/src/pty/tests.rs`, `server/src/api/tests.rs` — relevant identity/restore/auth regression cases.
Intentionally unchanged: workflow reducers, idle-suspend admission, telemetry sinks, persisted session schema. New status/capability state is memory-only.

## Implementation Steps

1. Add runtime constructor and fail-open availability state for terminal operation. Bind Linux listener and expose explicit platform-unqualified state elsewhere without breaking compilation.
2. Implement credential reservation/activation/revocation guards and terminal-incarnation checks. Fresh credential for create and respawn, restore follows create; revoke guards on every error return.
3. Apply reserved environment names after user environment and shell integration setup; strip inherited/user-supplied stale credentials even if status unavailable. No token in debug/diagnostic/persisted values.
4. Add private WebSocket handshake, current-epoch report acknowledgement, bounded ingress and state-bearing heartbeat expiry. Same-reporter reconnect replaces old socket safely; different live reporter rejected.
5. Wire OMP/socket release and PTY cleanup to unknown/removal without completion. Close runtime sockets before final server teardown; terminal disposal remains reusable for workspace change.
6. Add snapshot API with runtime epoch/revision and observed rows. Add bounded semantic broadcast and lag invalidation, without copying PTY output or requiring per-terminal subscribe.
7. Exercise real local socket tests, PTY child fixtures and fake-clock lease boundaries; record no credentials in public responses/persistence/diagnostics. Test service-unavailable path still permits PTY create.

## Todo list

- [ ] Implement local collector, scoped admission and acknowledgements.
- [ ] Cover initial spawn, restore, respawn and cancellation cleanup.
- [ ] Keep capability data out of persisted/user-visible environments.
- [ ] Implement protected snapshot and independent semantic push.
- [ ] Cover races, hung/lost connection and pressure boundaries.

## Success Criteria

Scenarios C06–C12 and C18 pass. Real OMP-process/socket exit clears working even when shell lives. Old child/readers/socket callbacks cannot affect replacement terminal. Bind failure cannot prevent terminal operations. Browser authentication remains unchanged and remote unauthenticated reporting is impossible through the public router.

## Risk Assessment

Highest-risk slice: spawn-before-publication race, automatic restart wiring, lock-order inversion and credential leakage through env persistence. Use lifecycle guards and capture identities before async work. Do not partially edit only the initial-create path.

## Security Considerations

Constant-time capability comparison, sufficiently random tokens, no global credential delegation. Same-UID malicious code is not isolated by environment capabilities; document trust boundary. Private listener receives only bounded generic lifecycle data. Avoid tracing request headers or payloads; isolate it from port-forward/tunnel advertisement.

## Next steps

Phase 03 supplies real OMP producer and bundled installer. Phase 04 consumes snapshot/events. All slices use phase 01 contract; integration owner resolves shared main/state/transport changes.
