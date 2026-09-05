# Phase 03 — Privileged Helper, Systemd Enrollment, and Audit

## Context links

- [Parent plan](./plan.md)
- [Phase 01 security gate](./phase-01-policy-config-security-gate.md)
- [Phase 02 coordinator](./phase-02-pty-fleet-coordinator.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-planned-security-gate-required)
- [Deferred remediation threat model](../../docs/system-architecture.md#deferred-remediation-threat-model-abuse-case-matrix)
- [Linux systemd deployment](../../docs/linux-systemd.md)
- [Suspend safety research](./research/researcher-01-suspend-safety-report.md)

## Overview

- Date: 2026-08-24
- Description: After explicit approval, implement and enroll one root-owned fixed suspend-with-RTC-wake boundary with fail-closed preflight and audit.
- Priority: P1
- Implementation status: Done (Completed 2026-09-05)
- Review status: Approved by Security and Operations (2026-09-05)

## Key Insights

- DamHopper server must remain unprivileged. Installing or running it as root would widen every API/PTY compromise into host root access.
- Unrestricted `sudo rtcwake`, a shell, browser-supplied argv, password forwarding, and generic host actions are prohibited.
- `rtcwake -m mem` depends on Linux suspend state and RTC alarm capability. Inhibitors and logind authorization require explicit treatment; success cannot be inferred from process exit alone.
- A same-UID local process may reach a Unix socket unless helper enrollment pins the expected systemd `MainPID`/executable/cgroup peer identity.
- Cancellation/timing mutation is reliable only before coordinator-to-helper queue acceptance. After that exact handoff point, coordinator must surface handed-off state and reject timing mutation until outcome/resume reconciliation.
- Audit availability is part of authorization. If an accepted request cannot be durably recorded, the helper must not mutate host state.

## Requirements

### Functional

- Gate entry on signed support matrix, protocol, peer proof, inhibitor policy, audit retention, residual-risk acceptance, and rollback procedure.
- Install a separately built root-owned helper plus systemd service/socket; server service continues as its configured non-root user.
- Accept one versioned fixed mutation request: `SuspendWithRtcWake { request_id, wake_after_seconds }`. Revalidate bounds helper-side.
- Authenticate the enrolled server peer using approved kernel/systemd identity proof; reject same-UID descendants, inherited sockets, stale MainPID, wrong executable/cgroup, and unapproved namespaces.
- Check Linux/systemd deployment, `/sys/power/state`/selected mem mode, RTC alarm support, logind `CanSuspend`, relevant inhibitors, helper/unit ownership, and audit health before reporting capable.
- Respect inhibitors by default. No override in v1 unless separately approved and represented as a new reviewed protocol version.
- Execute only the approved fixed absolute-path operation without shell. If `rtcwake` is selected, argv is exactly fixed mode plus validated relative seconds; no client-controlled device/mode/path/env.
- Deduplicate request IDs, enforce one frame/connection and bounded size/freshness, serialize execution, and never retry automatically.
- Treat bounded executor-queue acceptance as the server handoff boundary. Snapshot `wake_after_seconds` into the immutable helper request; no later settings write can alter it.
- Emit typed accepted/denied/unsupported/inhibited/auditUnavailable/failed/resumed outcomes; sanitize/cap details.
- On process return after wake, reconcile RTC/helper capability and report resumed. Do not assume WebSocket or PTY continuity.
- Maintain a root-owned bounded audit plus server-side bounded diagnostic/status metadata; both exclude terminal content and secrets.
- Keep root helper-execution audit distinct from Phase 1 server timing audit. Neither store exposes a browser read route or imports the other's authority.

### Non-functional

- Helper, socket, unit, policy, and audit paths are root-owned and not writable by the server user. Use close-on-exec descriptors and one request per connection.
- Apply approved systemd hardening and the minimum capability set. Unknown host/container/namespace layouts remain unavailable.
- Bound IPC frame, timeouts, queue, dedupe retention, audit size/age, outcome codes, and all text.
- Enrollment is explicit and reversible. Repository build/test must not install, elevate, program RTC, or suspend.
- Preserve current monitoring-only resource subsystem. Do not register this action in browser host-action approval routes or alert rules.

## Architecture

- `SystemdIdleSuspendExecutor` replaces `UnavailableExecutor` only when startup enrollment and capability probe succeed. It speaks one local fixed protocol over the root-owned socket.
- Helper flow: accept one close-on-exec peer -> verify enrolled server identity -> decode bounded version/frame -> dedupe and validate -> preflight capability/inhibitors/audit -> persist accepted record -> execute fixed backend -> persist typed result -> return/emit resume result.
- The exact kernel action backend is selected in the signed decision record. Preferred shape is approved RTC alarm programming plus logind suspend when it can preserve inhibitor semantics; otherwise fixed absolute-path `rtcwake` requires an explicit inhibitor check immediately before execution.
- No helper API accepts cancellation or timing mutation after queue acceptance. Before acceptance, disconnect/stale/invalid request produces no host action. Coordinator atomic enqueue defines handoff, snapshots wake timing, and blocks new PTY starts/timing commits until outcome/resume reconciliation.
- Helper audit uses stable request ID, protocol version, snapshotted wake seconds, server identity digest, timestamps, capability result, inhibitor result, and typed outcome only. Phase 1 timing audit separately records capped actor and before/after pair; neither includes the other subsystem's details.
- Systemd packaging extends the existing exact inventory/manifest and guarded operator workflow. No unattended installation or embedded elevation.

## Related code files

| Absolute path | Action | Purpose | Dependencies |
|---|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/Cargo.toml` | Modify | Register helper binary and only approved minimal dependencies | Security-approved backend |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/bin/dam-hopper-idle-suspend-helper.rs` | Create | Minimal privileged process entrypoint | Helper modules/protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/helper_server.rs` | Create | Bounded IPC, peer enrollment, fixed execution flow | Signed peer/protocol design |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/helper_client.rs` | Create | Unprivileged fixed-protocol executor client | Coordinator/protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/preflight.rs` | Create | Linux/RTC/suspend/logind/inhibitor/enrollment checks | Support matrix |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/audit.rs` | Create | Bounded typed helper-execution audit abstraction | Retention decision |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/protocol.rs` | Modify | Final frame/version/dedupe/capability/outcome contract | Signed protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/executor.rs` | Modify | Add real enrolled executor; keep unavailable fallback | Helper client |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/tests.rs` | Modify | Fake OS/IPC/audit/preflight and malformed request tests | Helper modules |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/systemd/dam-hopper-idle-suspend-helper.service` | Create | Root-owned hardened helper service | Approved capabilities/paths |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/systemd/dam-hopper-idle-suspend-helper.socket` | Create | Root-owned local activation/socket permissions | Enrolled server identity |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/systemd/dam-hopper.service` | Modify | Declare narrow dependency/environment only if approved | Existing non-root service |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/reset-linux-production.sh` | Modify | Extend exact manifest, install verification, rollback | Existing guarded workflow |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/linux-systemd.md` | Modify | Enrollment, preflight, canary, audit, rollback runbook | Final unit/helper design |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/terminal-idle-suspend-security.md` | Modify | Record implementation review and residual-risk acceptance | Phase 01 decision record |

## Implementation Steps

1. Verify Phase 01 approvals are complete and architecture matches the exact helper design. Stop if any support, inhibitor, peer-proof, audit, or rollback decision is missing.
2. Implement protocol codec with strict size/version/field/freshness/request-ID checks and property tests for malformed, duplicate, truncated, extra, and multi-frame input.
3. Implement peer enrollment exactly as approved: kernel credentials/pidfd where available, expected systemd MainPID, executable/cgroup/namespace identity, root-owned path/mode checks, and close-on-exec handling.
4. Implement capability/preflight adapters behind fakeable interfaces. Read fixed sysfs/D-Bus/systemd evidence; never accept client paths or execute discovery through a shell.
5. Implement root-owned bounded audit. Write accepted intent before host action and typed outcome after return; make unavailable audit suppress execution.
6. Implement the selected fixed action backend with absolute executable/path and constructed fixed argv or direct API calls. Map only sanitized typed outcomes.
7. Connect the unprivileged helper client to the Phase 2 executor seam. Freeze wake timing at queue acceptance; return every rejection/outcome to release coordinator timing/start admission only through reconciliation. Any probe/IPC/timeout/protocol error falls back to unavailable/suppressed, never local execution.
8. Add service/socket assets with minimum privileges and hardening. Validate units in isolation; keep the main server non-root.
9. Extend exact staged inventory, hashes, ownership/mode checks, rollback manifest, and guarded interactive operator steps. Do not touch an unowned/pre-existing install.
10. Run fake/unit/integration tests without RTC mutation. Perform read-only host capability/enrollment verification; reserve real suspend for approved Phase 5 canary.

## Todo list

- [x] Verify signed gate before any privileged work (Completed 2026-09-05)
- [x] Implement bounded protocol and malformed/replay tests (Completed 2026-09-05)
- [x] Implement enrolled peer proof (Completed 2026-09-05)
- [x] Implement Linux/RTC/logind/inhibitor preflight (Completed 2026-09-05)
- [x] Implement fail-closed bounded audit (Completed 2026-09-05)
- [x] Implement one fixed no-shell action backend (Completed 2026-09-05)
- [x] Connect real executor with unavailable fallback (Completed 2026-09-05)
- [x] Add hardened systemd service/socket (Completed 2026-09-05)
- [x] Extend exact install/rollback manifest (Completed 2026-09-05)
- [x] Complete security and deployment review (Completed 2026-09-05)

## Success Criteria

- Server process remains non-root and has no sudoers rule, shell path, password channel, generic command capability, or direct RTC/suspend execution.
- Helper accepts only an enrolled server peer and one validated fixed action; same-UID impostors, descendants, stale identities, replays, and malformed frames are denied.
- Unsupported RTC/suspend/logind, inhibitor, missing enrollment, audit failure, IPC error, or ownership drift causes no host mutation and a typed unavailable/suppressed result.
- Exactly one fixed action occurs for one accepted request ID; duplicates and retries do not execute.
- After queue acceptance, timing API receives the bounded conflict and cannot change the immutable helper request or canonical timing pair until reconciliation.
- Helper/systemd artifacts pass ownership, mode, hardening, unit verification, secret scan, and fake integration tests.
- Install and rollback are manifest-bound, interactive, documented, and do not disturb unrelated services/files/RTC alarms.
- Security owner and operator sign the implemented boundary before Phase 5 real-host canary.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Compromised server requests host suspend | Critical | Explicit residual-risk acceptance; one action; peer enrollment; bounds/rate/single-flight/audit |
| Same-UID process calls helper | Critical | MainPID/pidfd/executable/cgroup/namespace proof; deny unsupported kernels |
| `rtcwake` bypasses inhibitors | Critical | Approved immediate inhibitor check or logind-based backend; no override |
| Audit omitted/tampered | High | Root ownership, bounded durable write before action, fail closed, enrollment verification |
| Packaging grants broad privilege | Critical | Separate helper, minimal capabilities, exact manifest/hardening, security review |
| Suspend succeeds but RTC wake fails | Critical | Capability/preflight plus helper atomicity policy; canary evidence; typed failure, no retry |
| Timing changes an in-flight request | Critical | Snapshot at queue acceptance; close timing admission through outcome/resume reconciliation |

## Security Considerations

- Never use `sudo`, `sh -c`, PATH lookup, environment-provided executable, browser input, raw polkit agent/password, or a generic host-action enum.
- The helper must treat the server as potentially compromised; peer proof narrows caller identity but does not make payload trustworthy.
- No inhibitor override, arbitrary wake deadline, RTC device selection, suspend mode selection, or cancellation/disable-alarm operation in v1.
- Do not log raw process command lines, environment, terminal data, credentials, IPC bytes, unbounded stderr, or inhibitor details that disclose other users.
- Root helper audit never records Settings actor; server timing audit never records peer proof, helper stderr, request payload bytes, or terminal content.
- SELinux/AppArmor and systemd sandbox policy are part of host qualification; denial remains unavailable rather than prompting for weaker setup.

## Next steps

- Connect authoritative status, timing API/Settings, and read-only popover in [Phase 04](./phase-04-rest-websocket-ui-monitoring.md).
- Run full fake and approved real-host evidence in [Phase 05](./phase-05-integration-release-rollback.md).

## Approved Architectural Decisions (2026-09-05 Sign-Off)

- **Execution Backend**: `systemd-logind` D-Bus `Suspend()` + direct sysfs write to `/sys/class/rtc/rtc0/wakealarm` (epoch timestamp).
- **Peer Authentication**: Linux `SO_PEERCRED` kernel credentials check + systemd `MainPID` validation; rejects same-UID descendants or external callers.
- **Inhibitor Policy & Observability**: Strict fail-closed on active sleep inhibitors. Helper extracts inhibitor metadata (`Who`, `Why`), logs to root audit, and returns typed `Inhibited { reason, who, why }` outcome to coordinator for structured logging and status visibility.
- **Helper Packaging**: Root-owned systemd unit with `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, and private Unix domain socket.

## Remaining Implementation Questions

- How should a helper prove/clear only the RTC alarm it owns during rollback without touching unrelated alarms?
- Is a real suspend/wake canary mandatory on every qualified host class or only the first enrolled host per hardware model?
