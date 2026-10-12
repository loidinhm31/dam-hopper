# Phase 02 — Coordinator Internal Diagnostics & Server Tracing

Status: Pending · Priority: P1 · Effort: 5h · Dependencies: phase 01

## Objective & scope
Preserve typed outcome through manual admission; record latest real probe independently of last suspend outcome. Add correlated structured operator evidence and accurate safe HTTP mapping. Preserve active-session/fleet/handoff semantics, audit ordering and automatic policy behavior.

Context: [overview](./plan.md), [typed probe contract](./phase-01-typed-capability-probe-and-socket-ipc.md), [debugger masking findings](../reports/debugger-261012-0613-idle-suspend-capability.md).

## Exact files to modify
| File | Change |
|---|---|
| `server/src/idle_suspend/coordinator.rs` | Typed force result, latest-probe state, explicit timeout, probe correlation span, both publisher argument flows, execution-outcome internal logs |
| `server/src/api/idle_suspend.rs` | Exhaustive 503 mapping with standard no-store error envelope; never serialize diagnostic context |
| `server/src/idle_suspend/protocol.rs` | Add `HelperUnavailable`, `Inhibited`, `ProbeTimeout`, `RtcBusy` to existing `IdleSuspendErrorCode`; exhaustive stable code/message mapping |
| `server/src/idle_suspend/helper_client.rs` | Structured transport stage/errno/socket context in probe span; bounded post-failure metadata |
| `server/src/idle_suspend/helper_server.rs` | Structured preflight/auth failure logs; actual/expected UID/PID via typed diagnostic context; validated probe correlation after auth |
| `server/src/idle_suspend/event.rs` | Add safe terminal-rejection reasons for helper unavailable, timeout, RTC missing/busy and preflight failure where existing reasons are insufficient |
| `server/src/linux_release/diagnostics/redaction.rs`, `server/src/linux_release/diagnostics/correlation.rs` | Preserve new closed safe reasons/correlation in existing bundle projection; do not introduce another collector |
| `server/src/idle_suspend/tests.rs`, `server/tests/idle_suspend.rs`, `server/src/api/tests.rs` | Update typed force-result assertions and event/API expectations with cutover |

No new public operator-detail endpoint. Existing audits/journal/diagnostic bundle remain operator evidence surfaces.

## Implementation details & code snippets
1. Replace `CoordinatorForceSuspendResult::CapabilityUnavailable(String)` with `ProbeUnavailable { reason: ProbeFailureReason }`. Internal diagnostic data is logged while owned by coordinator; do not carry arbitrary detail to API mapping. Keep domain validation/fleet result variants unchanged.
2. Add coordinator-owned `LatestProbe` (safe reason + checked-at timestamp); initialized unchecked. Pass mutable reference into `handle_force_suspend`; pass immutable reference to **both** `publish_status_checked` and `publish_agent_free_status_checked` and every caller. No extra shared lock/cache/polling task. Preserve last probe across timing changes, heartbeats, automatic-state publication and unrelated rejected commands.
3. Reuse existing `AttemptContext.correlation_id` and request ID generated before manual probe. Pass request ID to executor; span wraps future with `tracing::Instrument` (never keep entered span guard across `.await`). Add monotonic elapsed time, requested wake duration and structured reason/dimension/stage; no actor token/session payload.

```rust
let started = Instant::now();
let span = tracing::warn_span!(
    "idle_suspend_probe", correlation_id = %ctx.correlation_id,
    wake_after_seconds = cmd.wake_after_seconds,
);
let outcome = match tokio::time::timeout(
    Duration::from_secs(3),
    executor.check_capability(CapabilityProbeRequest {
        request_id: request_id.clone(),
    }).instrument(span),
).await {
    Ok(outcome) => outcome,
    Err(_) => CapabilityProbeOutcome::Unavailable(ProbeFailure::timeout()),
};
latest_probe.record(&outcome, IdleSuspendStatusV1::now_ms());
if let CapabilityProbeOutcome::Unavailable(failure) = outcome {
    tracing::warn!(
        correlation_id = %ctx.correlation_id,
        reason = failure.reason.safe_code(),
        dimension = ?failure.reason.dimension(),
        stage = ?failure.diagnostics.stage,
        errno = ?failure.diagnostics.errno,
        socket = ?failure.diagnostics.socket_path,
        actual_uid = ?failure.diagnostics.actual_uid,
        expected_uid = ?failure.diagnostics.expected_uid,
        actual_pid = ?failure.diagnostics.actual_pid,
        expected_pid = ?failure.diagnostics.expected_pid,
        elapsed_ms = started.elapsed().as_millis() as u64,
        diagnostic = %failure.diagnostics.bounded_detail,
        "idle-suspend admission probe rejected",
    );
    // Retain rejected-capability audit, accurate safe semantic reason,
    // no execution future, no fleet handoff, no effective-force admission.
}
```

Snippet describes contract; adapt fields to phase 01 actual diagnostics type. Log absent values as absent, never expected=actual guesses. Probe-level client events inherit span; coordinator rejection event includes correlation explicitly because future's span has ended. Helper auth rejection occurs before request read: its local log has connection ID, while client/coordinator logs associate returned typed peer fields with server attempt ID. Never trust an unauthenticated correlation claim.
4. Retain best-effort `ManualAuditResult::RejectedCapability` compatibility; enrich safe terminal event reason without embedding diagnostic detail. No handoff/executor suspend invocation on any failed probe, including `force:true`. Keep handoff rejection before probe and active-fleet confirmation after a successful probe. Unchecked commands (invalid actor/wake, disabled, handoff busy) do not overwrite latest real probe.
5. Success records `supported` and fresh timestamp, clearing old reason; no failed probe pretends an execution outcome occurred. `detail`/`lastOutcome` are projected safely in phase 03, not overwritten with raw probe strings or stale failure context. A successful probe followed by fleet conflict legitimately reports supported with 409 fleet conflict.
6. Automatic execution currently dispatches helper without this manual capability probe. Do not introduce new admission probes or polling/retry behavior. Retain helper execution preflight/audit; raw later execution failure context gets bounded correlated tracing before safe status projection. Latest probe remains latest actual probe, not fabricated automatic execution evidence.
7. Central exhaustive mapping on closed reason; API handler consumes only safe `(IdleSuspendErrorCode, &'static str)`:

| Reasons | HTTP/code | Static public message |
|---|---|---|
| Socket missing/denied/refused, peer auth, I/O/frame/version mismatch, execution probe error, executor unavailable, unknown | 503 `idleSuspendHelperUnavailable` | `idle-suspend helper is unavailable or inaccessible` |
| `ProbeTimeout` | 503 `idleSuspendProbeTimeout` | `idle-suspend capability probe timed out` |
| `InhibitorPresent` | 503 `idleSuspendInhibited` | `host sleep is blocked by an active system inhibitor` |
| `RtcAlarmBusy` | 503 `idleSuspendRtcBusy` | `host wake timer is currently in use` |
| `SuspendStateUnsupported`, `RtcAlarmMissing` | 503 `idleSuspendCapabilityUnavailable` | `host lacks required sleep or timed-wake capability` |

```rust
CoordinatorForceSuspendResult::ProbeUnavailable { reason } => {
    let (code, message) = reason.public_error();
    idle_suspend_error_response(
        StatusCode::SERVICE_UNAVAILABLE, code.as_code_str(), message,
    )
}
```

Use existing error helper, no `detail`/correlation/PID/status snapshot additions to standard error body. Don't return 409 for inhibitors/RTC busy. API boundary need not duplicate already correlated internal rejection log.
8. Logging policy: one actionable warn per rejected manual attempt; error for unexpected invariant/encoding failures. Bound/sanitize helper strings before operator logging too (control characters, arbitrary command stderr, secrets). Log known errno/path/credential fields; never body/environment/argv/cookies. No generic-debug serialization of entire request/state. Do not add background probe logging or a new rate-limit framework.

## Acceptance & verification commands
After phases 01–04 integrate:

```bash
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --lib api::tests
cargo test --manifest-path server/Cargo.toml --test idle_suspend
cargo test --manifest-path server/Cargo.toml --test idle_suspend_diagnostics
```

Test each reason: correct 503 code/static message/no-store, accurate safe event, latest probe updated, rejected audit retained, no handoff/no execution. Test explicit elapsed timeout with deterministic pending executor and Tokio clock; success clears stale reason; fleet/handoff 409 regression. Capture structured tracing for EACCES, peer mismatch, preflight error and timeout; assert correlation, stage/errno/socket and actual/expected UID/PID where available. Assert malicious diagnostic sentinel never appears in HTTP.

## Risks & invariants
- **Requirement 48:** domain logs preserve bounded context; API owns safe response mapping. Internal details must not reach standard error envelope, lastOutcome/detail or safe semantic event fields.
- Missing peer fields are legitimate (connect denied before auth); do not claim observed peer mismatch. Logging requires real returned context, not parsing human error prose.
- Outer deadline is 3s; helper subprocess may outlive dropped client future. Route timeout classification must remain accurate without claiming helper cancellation.
- New event reasons require updating bundle projection/test exhaustiveness. Keep old audit records readable; do not rename unrelated schema fields.
- Synchronous coordinator ownership remains serial; preserve lock order and never hold lock across IPC await. Do not alter fleet-consent paths while adding diagnostics.

## Unresolved questions
None.
