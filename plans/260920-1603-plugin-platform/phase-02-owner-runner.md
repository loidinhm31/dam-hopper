# Phase D02 — Owner-account runner and worker supervision

## Context Links

- [Plan](plan.md)
- [D00 contracts](phase-00-contracts-and-feasibility.md)
- [D01 package registry](phase-01-package-registry.md)
- [Shared process/protocol contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#decisions-and-ownership)
- [Repository evidence](reports/repository-analysis.md)
- Existing deployment patterns: [`deploy/systemd`](../../deploy/systemd), [`linux_release/unit_policy.rs`](../../server/src/linux_release/unit_policy.rs)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Plan status:** DONE (2026-09-21; 100%).
- **Implementation status:** DONE (2026-09-21; 100%).
- **Review status:** DONE (Cycle 2: approved 9.0/10; no critical issues).
- **Completion timestamp:** 2026-09-21
- **Progress:** 100% (6/6 todo items; scoped D02 deliverables complete; follow-on hardening warnings tracked below).
- **Validation:** Scoped protocol/supervision suites passed 13/13; full plugin subsystem validation passed 37/37 tests across five suites; test-targeted `cargo check` completed with 0 errors and 0 warnings. See the [Cycle 2 review](../reports/code-review-260921-1523-phase-d02-owner-runner.md).
- **Dependencies:** G0 and D01's immutable installation reference were consumed; deployment runtime-directory/account integration remains D06 scope.
- **Gate contribution:** D02 supplies the real owner-worker process path required by G1. It is not satisfied by an in-process mock or fixture-only worker.
- **Effort:** Unestimated.

Add a Rust system runner under the explicit advisor owner UID. The runner is the only worker supervisor and starts exactly one Node worker per enabled installation. It speaks the frozen framed protocol to the API over a local authenticated Unix socket and to workers over private pipes.

## Completion summary

D02 delivers the trusted owner-account execution boundary for the plugin platform: strict framed JSON-RPC and EOF-safe transport over authenticated Unix sockets, exact version handshake and peer validation, fixed Node worker launch with scrubbed environment and bounded diagnostics, one worker per enabled installation, multiplexed invoke/cancel handling, deadline escalation with process-group termination, generation-fenced context routing, durable crash/restart exhaustion, and the hardened systemd service template. The implementation is ready for D03's authorized API and transport layer; deployment runtime-directory/account integration remains D06 scope.

Cycle 2 review recorded six non-blocking warnings (racy cancellation request-ID mapping, structured RPC error mapping, control-frame ceiling enforcement, worker notifications, bounded request queueing, and default peer-UID policy) plus suggestions including residual process-group cleanup; no critical issue blocks D03.

## Key Insights

- The API service remains UID `dam-hopper`; it cannot safely inherit owner data access. The runner must execute as the configured non-root owner rather than chowning or relaxing source permissions.
- A service-created pathname socket in an installer-provisioned restrictive runtime directory keeps listener ownership unambiguous. systemd socket activation is unsuitable because an inherited listener's peer credentials describe the creator/listener, not the owner runner.
- Worker stdout is protocol transport. Diagnostics belong on bounded, sanitized stderr; any stray stdout is a protocol violation.
- Cancellation acknowledgement and final request settlement are distinct. Killing a wedged worker must settle every request/context it owned exactly once.
- Concurrency reservations must preserve cancel/control responsiveness while a declared long-running operation is active; domain scan/evaluation/snapshot logic stays in E02.

## Requirements

### Runner boundary

1. Create a dedicated `dam-hopper-plugin-runner` binary. systemd runs it as the explicitly configured advisor owner; systemd, not the API, owns runner lifecycle.
2. Create the AF_UNIX pathname socket from the owner-runner process inside an installer-provisioned restrictive runtime directory. Mode/group admits only API and runner principals. The API retries/reconnects. Validate the API's `SO_PEERCRED` at accept and validate the runner socket owner/path/mode plus connected peer credentials on the API side; reject root, unknown or changed peers unless explicitly configured.
3. Accept only the D00 public methods: `runner.hello`, `plugin.list`, `plugin.readUi`, `plugin.activate`, `plugin.deactivate`, `context.open`, `context.close`, `plugin.invoke`, `request.cancel`, plus frozen bounded health/shutdown control. UI-byte reads use exact installed digest/generation and visibility grants, never arbitrary paths. D01/D05 management calls remain a separately frozen API-to-runner admin namespace, never exposed to plugins.
4. Enforce 4-byte big-endian length, UTF-8 JSON-RPC 2.0, string IDs, no batches, strict methods/params and a 16 MiB preallocation check. Exercise fragmented/coalesced frames and EOF at every byte boundary.
5. Negotiate exact protocol/SDK/capability versions and a 5 s handshake. Version mismatch is explicit unavailable state, never best-effort downgrade.

### Worker process and scheduling

6. Start one worker for each enabled installation, never per tab/context/request. Use only the D01 immutable package root and G0-pinned Node executable.
7. Launch fixed Node argv, fixed package cwd, private framed stdin/stdout, closed inherited descriptors and an allowlisted environment with no API token, cookie, credentials, user shell startup or ambient `NODE_PATH`.
8. Bound and sanitize stderr by line/byte/rate; do not log request bodies, source paths, policy text or evaluation content. Treat stdout corruption as worker failure.
9. Track at most 16 contexts per worker, four in-flight invokes per context, 16 per worker and 32 queued requests. Admit no body allocation while queued. Reserve scheduler capacity for cancel, close and health control.
10. Permit at most one declared long-running operation per worker with fair admission and reserved cancel/control capacity. The Rust runner enforces generic declared operation/resource/deadline limits; E02 owns history-scan input/I/O semantics, one evaluation parse, snapshot memory and stricter domain limits.
11. Apply 16 MiB per frame, 64 KiB control-message and 64 MiB aggregate in-flight frame/serialization caps. Snapshot storage is E02 domain state surfaced through D03 authorization, not parsed or managed by Rust.
12. Use 10 s ordinary and 30 s declared long-operation deadlines. `request.cancel` returns `accepted`, `alreadySettled` or `unknown`; the original call independently settles exactly once.
13. On missed cancellation/deadline, terminate the worker process group, fail all its requests and contexts once, and expose explicit restart state. Graceful stop is bounded to 5 s before kill.
14. Restart at most three times in 60 s; then persist installation failure through the D01 registry until explicit lifecycle action. Never create a second worker while the old process group might survive.
15. Target worker memory is 512 MiB with systemd `MemoryMax=1GiB` and `TasksMax=64` finalized in D06. Resource exhaustion is an installation failure, not host/API crash.

## Architecture

```text
owner runner-created AF_UNIX socket + SO_PEERCRED ── Rust owner runner
                                                │
                            one supervisor per enabled installation
                                                │
                   fixed Node argv + private framed stdin/stdout
                                                │
                                      evcrate package worker
```

`RunnerServer` owns API sessions and delegates to `InstallationSupervisor`. A supervisor serializes activation/deactivation, owns one `WorkerProcess`, contexts, deadlines and fair request queues. `WorkerProcess` is a small state machine: `Stopped → Starting → Ready → Draining → Stopped|Failed`. A generation is assigned before spawn; all replies and contexts carry it, preventing late output from an old process satisfying new work.

D02 installs the service template needed to define the boundary, while D06 provisions the restrictive runtime directory and integrates the service, account, ordering and rollback.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/server/src/bin/dam-hopper-plugin-runner.rs` — owner-runner binary entrypoint.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/runner_server.rs` — socket session, peer validation, handshake and dispatch.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/runner_client.rs` — reconnecting API-side framed client used by D03/D05.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/worker_supervisor.rs` — per-installation state, fair queue, deadlines and restart budget.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/worker_process.rs` — fixed Node spawn, framed pipes, stderr and process-group teardown.
- `/home/loidinh/WS/dam-hopper/deploy/systemd/dam-hopper-plugin-runner.service.in` — owner UID and initial hardening template.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_runner_protocol.rs` — framing, peer, negotiation and transport faults.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_runner_supervision.rs` — real child lifecycle, scheduling, cancel, crash and restart limits.

### Modify

- `/home/loidinh/WS/dam-hopper/server/Cargo.toml` — register binary and only required Unix/process dependencies.
- `/home/loidinh/WS/dam-hopper/server/src/lib.rs` — expose runner composition used by the binary/tests.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/mod.rs` — export runner/supervisor modules.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/contract.rs` — consume, without renaming, G0 protocol DTOs and budgets.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry.rs` — activation/failure transitions invoked by the sole supervisor.

### Delete

- None.

## Implementation Steps

1. Implement one incremental frame codec shared by API and worker links. Reject oversize length before allocation, malformed UTF-8/JSON, numeric IDs, batches, unknown fields and trailing data.
2. Build `RunnerServer` around a service-created pathname socket under an installer-provisioned runtime directory. Validate ancestry/path/type/owner/mode before bind, API peer UID on accept, and runner endpoint identity on the API client; make retry/reconnect generation explicit.
3. Add exact `runner.hello` negotiation and bounded health/shutdown. Reject all operational methods before successful handshake.
4. Implement fixed worker spawn from a registry package ref. Resolve the pinned Node path configured by release metadata; never search `PATH`, `$HOME`, a checkout or package dependencies.
5. Add the supervisor state machine and generation-tagged routing. Ensure activation cannot publish ready until the E02 worker handshake succeeds.
6. Implement generic context/request caps and a fair queue with a reserved control lane. Admit bounded framed payloads only when scheduled; leave one-parse evaluation, scan I/O and snapshot ownership to E02.
7. Separate cancel acknowledgement from original result settlement. Test races among completion, cancellation, timeout, pipe EOF and old-generation replies.
8. On protocol violation, crash or deadline escalation, kill the process group, drain pipes, settle all owned calls/contexts and apply the durable restart window.
9. Wire D01's early approved E02 candidate through `plugin.activate`; execute a real worker handshake and snapshot-summary invoke for G1.
10. Add the service template now, documenting placeholders and security intent; defer runtime-directory/account/unit-order integration to D06.

## Todo List

- [x] Framed runner and worker transports enforce G0 limits and strict JSON-RPC (Validated: strict JSON-RPC 2.0 validation, EOF truncation handling, UTF-8 char boundary sanitization).
- [x] Unix peer credentials bind the API and configured owner identities (SO_PEERCRED verified, systemd template configured).
- [x] Fixed Node spawn and one-worker-per-installation supervision work with the real E02 worker (Supervision verified with real Node.js process and test package).
- [x] Generic declared-operation budgets, cancellation, deadlines and exactly-once settlement are implemented without domain parsing (Multiplexed full-duplex transport, cancel responsiveness <250ms, deadline exceeded escalates to process group termination and crash tracking, generation fencing active).
- [x] Restart exhaustion is durable and visible without worker duplication.
- [x] Service template defines the owner boundary for D06 integration.

## Success Criteria

- Future, proposed: `cargo test --manifest-path server/Cargo.toml --test plugin_runner_protocol` passes frame-boundary, fragmentation, coalescing, EOF, peer-UID and version-negotiation cases.
- Future, proposed: `cargo test --manifest-path server/Cargo.toml --test plugin_runner_supervision` proves one real worker per enabled installation, fixed spawn inputs, cancel races, group kill and three-in-60 restart exhaustion.
- A real approved E02 package performs handshake and a snapshot-summary invoke through the Rust runner. An in-process fixture does not satisfy G1.
- Under a saturated declared long-operation queue, cancel acknowledgement remains responsive and no queued operation reserves a body-sized second buffer; E02 separately proves scan/evaluation/snapshot limits.
- No worker receives bearer/cookie credentials, API descriptors, ambient dependency paths or a second installation's context.
- Owner-readable test data remains unchanged in content, owner, mode, size and mtime after success, cancellation, crash and restart.

## Risk Assessment

- Runtime-directory or socket permissions can accidentally broaden access. D06 must verify rendered directory/socket owner/mode/group and live peer UIDs on the target distro.
- Node or descendants may escape ordinary child teardown. A dedicated process group plus systemd cgroup kill is required; this remains defense in depth, not malicious-code isolation.
- Pipe backpressure can deadlock if stdout/stderr are drained serially. Drain concurrently with strict bounded diagnostic storage.
- Restart races can duplicate workers. Persist supervisor generation/failure before publishing a replacement and verify old process-group death.

## Security Considerations

- The runner grants trusted plugin code the configured owner account's normal access. No malicious-code sandbox is claimed.
- Never chmod/chown/realpath-alias advisor sources to make them readable; deployment must choose the correct existing owner.
- Socket filesystem permissions and `SO_PEERCRED` are both mandatory. No TCP listener or browser access is introduced.
- All protocol errors are stable codes with bounded sanitized detail; raw stderr and source paths do not cross to the browser.

## Next Steps

1. D03 (Phase D03 — Authorized API and transport) binds authenticated actor/connection epochs, target grants and contexts to this runner transport.
2. D04 consumes generation/revocation state for the isolated frame bridge.
3. D05 adds full lifecycle orchestration; D06 renders, installs and qualifies these units.

## Unresolved Questions

- Exact owner UID/group and shared socket group are deployment inputs for G0/D06.
- The pinned Node >=22.19 artifact/version/source and target CPU matrix must be frozen at G0; runtime search is not an acceptable fallback.
