# Phase 01 — Typed Capability Probe Taxonomy & Socket IPC

Status: Pending · Priority: P1 · Effort: 6h · Dependencies: none

## Objective & scope
Replace lossy Boolean capability seam with typed, fail-closed outcomes. Preserve transport/access/auth errors, actual hardware absence and transient blockers. Remove socket and sysfs `exists()` gates; direct operations become authoritative. Keep probe read-only and helper peer authorization unchanged.

Context: [overview](./plan.md), [debugger §§1–3](../reports/debugger-261012-0613-idle-suspend-capability.md), [research §§2–3](../reports/researcher-261012-0613-idle-suspend-diagnostics.md).

## Exact files to modify
| File | Change |
|---|---|
| `server/src/idle_suspend/protocol.rs` | Closed reason/dimension/result types; IPC v2 probe request, capability reply and bounded internal helper context; response validation; safe API error enum additions |
| `server/src/idle_suspend/helper_client.rs` | Delete `is_socket_present`; direct connect; classify I/O by stage/errno; validate response version, variant and probe ID |
| `server/src/idle_suspend/executor.rs` | Typed `check_capability` trait and all three implementations; deterministic typed fake probe configuration |
| `server/src/idle_suspend/helper_server.rs` | Preserve typed `PreflightError` over IPC; return structured peer-auth failure context; propagate validated correlation ID after authentication |
| `server/src/idle_suspend/preflight.rs` | Replace sysfs `exists()` gates with fallible reads; preserve OS error/stage in typed probe execution failure |
| `server/src/idle_suspend/peer_auth.rs` | Preserve typed PID-file I/O errno; expose safe-to-log typed actual/expected credential context without reparsing error text |
| `server/src/idle_suspend/audit.rs` | Correlate successful-auth capability audits through existing nullable request ID field; preserve existing schema/intent durability |
| `server/src/idle_suspend/mod.rs` | Export only new types needed by existing callers; remove obsolete Boolean seam exports/comments |
| `server/src/main.rs` | Replace startup `socket_exists = socket_path.exists()` log with configured socket only/explicit unprobed state; update stale phase/presence comments, no startup probe or permanent availability latch |
| `server/src/idle_suspend/coordinator.rs` | Migrate sole production probe caller to typed interface; phase 02 supplies final admission/logging behavior |
| `server/src/idle_suspend/tests.rs`, `server/tests/idle_suspend.rs` | Migrate Boolean assertions, `BlockingTestExecutor`, `InFlightHandoffExecutor`, `PanicExecutor`, fake configuration and wire fixtures with interface cutover |
| `server/src/linux_release/diagnostics/model.rs` | Current helper protocol constant becomes 2; historical records retain recorded version |

No new production module required. Extend existing protocol/executor/preflight boundaries; do not create a parallel diagnostics service.

## Architecture and implementation details
1. Closed **safe** reason enum, no `String` payloads. Dimension derived exhaustively from reason; diagnostic detail remains separate. Define `supported` for public success, not a failure variant. Unknown replies classify as transport/IPC (`unknownHelperFailure`), never fabricated hardware absence.

```rust
// Design sketch: final names must match exports/callers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeFailureReason {
    SocketNotFound, SocketPermissionDenied, ConnectionRefused,
    PeerAuthFailed, IpcIoError, IpcProtocolError, ProtocolVersionMismatch,
    ProbeExecutionError, ProbeTimeout, ExecutorUnavailable, UnknownHelperFailure,
    SuspendStateUnsupported, RtcAlarmMissing,
    InhibitorPresent, RtcAlarmBusy,
}

pub enum ProbeDimension { TransportIpc, Hardware, TransientReadiness }
// ProbeTimeout is a bounded IPC probe failure; readiness reserved for actual blockers.
// ProbeFailureReason::dimension() and safe_code() are exhaustive mappings.

#[derive(Debug, Clone)] // Deliberately NOT Serialize/Deserialize: server-only.
pub struct ProbeFailure {
    pub reason: ProbeFailureReason,
    pub diagnostics: ProbeDiagnostics,
}
#[derive(Debug, Clone)]
pub enum CapabilityProbeOutcome { Supported, Unavailable(ProbeFailure) }
```

`ProbeDiagnostics`: stage enum (connect/write/read/decode/auth/preflight/deadline), optional errno, optional configured socket/sysfs/PID-file path, optional actual/expected UID/PID, bounded diagnostic text. Collect directory/socket mode/UID/GID **only after failure** using fallible non-following metadata; inaccessible inspection stays unknown, never reclassifies failure. Do not allocate paths/details on successful probes.

2. Explicit **IPC v2**, because v1 request/response use `deny_unknown_fields` and unit `ProbeCapability` has no request ID. Preserve framing limit and strict decoding. Add `CapabilityProbeRequest { request_id: String }`; validate existing canonical `ActionCorrelationId` UUIDv4 rules. `HelperRequestPayload::ProbeCapability(CapabilityProbeRequest)` carries ID, not command/device/mode. Capability reply echoes ID with `supported`, optional typed `reason`, and optional bounded internal context. Enforce supported => no reason; unsupported => reason present. Mismatch/unknown enum/invalid combination => protocol failure, not support.

```rust
pub const HELPER_PROTOCOL_VERSION: u32 = 2;
// Existing tagged enum, strict fields retained.
Capability {
    request_id: String,
    supported: bool,
    reason: Option<ProbeFailureReason>,
    diagnostic: Option<HelperProbeDiagnostic>, // Local IPC only, never public DTO.
},
// Existing Error variant gains optional bounded internal context.
Error {
    code: String,
    message: String,
    diagnostic: Option<HelperProbeDiagnostic>,
},
```

Do not serialize all OS metadata blindly. Diagnostic strings capped (e.g. 512 UTF-8 bytes each), fields optional, total encoded frame still <=4096. Oversized/unexpected/malformed frames fail closed. `HelperProbeDiagnostic` carries errno/stage and expected/actual values as typed fields; public projection cannot accept this type.

3. Authenticate peer **before reading/dispatching** request, as today. Explicit `permissionDenied` helper Error alone maps `peerAuthFailed`; EOF is read/protocol failure, never evidence of auth rejection. Early auth error cannot echo an unread request ID: client associates it with its own outstanding probe ID for API-side tracing. Helper logs peer context under a local connection ID; no unauthenticated input is accepted for audit correlation. After auth, validated probe ID appears in helper audit/log and response. Do not weaken UID/PID checks to obtain diagnostics.
4. Keep typed preflight variants: successful `/sys/power/state` read lacking configured `mem` => `suspendStateUnsupported`; `NotFound` for required node => corresponding hardware reason; `PermissionDenied`, other read errors and inhibitor-tool failures => `probeExecutionError` with errno/stage. Nonempty foreign RTC => `rtcAlarmBusy`; sleep WHAT + block MODE => `inhibitorPresent`. Delay/idle-only inhibitors remain nonblocking. No wakealarm writes to prove readiness. Preserve current `run_all()` order and wake=0 RTC contract.
5. Direct socket transport; no pre-check, no automatic retries or string matching:

```rust
let mut stream = match tokio::net::UnixStream::connect(&self.socket_path).await {
    Ok(stream) => stream,
    Err(error) => return CapabilityProbeOutcome::Unavailable(
        ProbeFailure::from_connect_error(error, &self.socket_path)),
};
// Connect ErrorKind: NotFound -> SocketNotFound;
// PermissionDenied -> SocketPermissionDenied;
// ConnectionRefused -> ConnectionRefused; otherwise IpcIoError.
// Preserve raw_os_error(); write/read failures keep their actual stage.
write_frame_async(&mut stream, &HelperRequestFrame::new_probe(request)).await?;
let response: HelperResponseFrame = read_frame_async(&mut stream).await?;
response.validate()?; // Current client does not call this; both operations must.
```

Sketch `?` requires typed conversion at each stage; implement explicit `map_err`/match preserving stage rather than blanket `From<ProtocolError>`. Validate execution replies too when migrating version; do not accept v1 suspend response accidentally.
6. Trait becomes `check_capability(&self, request: CapabilityProbeRequest) -> BoxFuture<'_, CapabilityProbeOutcome>`. `SystemdIdleSuspendExecutor` forwards full outcome. `UnavailableExecutor` reports `executorUnavailable`, not asserted hardware absence; fix stale sign-off comments. `FakeExecutor` uses existing mutex pattern for a typed configurable probe outcome; migrate `capability_available` users, delete obsolete AtomicBool control. Fake remains test seam, never production fallback.
7. One coordinator-owned outer 3s deadline remains; phase 02 records timeout explicitly. Windows cfg remains compiling and returns typed unavailable; no Unix socket transport on Windows. No Boolean compatibility adapter. Matched server/helper binaries activate/rollback together; v1/v2 mismatch produces accurate helper-unavailable, not generic capability false.

## Acceptance and verification commands
After integrated 01–04 changes; do not run mid-flight against half-migrated interfaces:

```bash
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --test idle_suspend
cargo test --manifest-path server/Cargo.toml --test idle_suspend_diagnostics
```

Required assertions: absent socket, permission-denied parent, stale listener, explicit auth denial, EOF, malformed/oversized frame, version/ID mismatch, missing mem/RTC, unreadable sysfs, inhibitor failure/busy/block, success; typed fake and all executor trait implementations migrate. Phase 05 specifies privilege-safe socket tests.

## Risks & invariants
- **Requirement 48:** server-only result/diagnostics never serialized into HTTP/status. IPC structured detail is local privileged transport only; all public mapping uses reason enum + static messages.
- IPC v2 is a coordinated internal breaking change. No rolling mixed-pair support; mismatch is explicit safe failure. Historical diagnostic audits remain readable, not rewritten to v2.
- `mem` advertisement/empty RTC is read-only preflight evidence, not proof of suspend/wake reliability. Cloud detection cannot replace these observations.
- Coordinator timeout drops client future, not necessarily helper's synchronous inhibitor subprocess. Do not claim process cancellation or add unrequested retry/subprocess redesign.
- Metadata inspection is diagnostic-only; directory/socket ownership cannot be inferred when inaccessible. Preserve errno rather than masking inspection failure.

## Unresolved questions
None. IPC cutover and unchanged wake=0 semantics are explicit decisions; deployment qualification prerequisites are in phase 05.
