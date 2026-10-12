## Code Review Summary

### Scope
- Files: server/src/idle_suspend/{protocol,preflight,executor,coordinator,helper_client,helper_server,status}.rs, server/src/api/idle_suspend.rs, packages/ui/src/api/client.ts, packages/ui/src/lib/force-sleep-dialog-utils.ts (+ audit.rs, mod.rs, tests read for context)
- Focus: working-tree diff vs HEAD
- Verified by running: `cargo check --all-targets` (no warnings from changed files; only pre-existing unused-import warning in tests/browser_debug_artifacts.rs, untouched), `cargo fmt --check` (all changed files clean; 800 diffs are pre-existing in untouched files), `cargo clippy --all-targets` (idle_suspend hits are pre-existing patterns: too_many_arguments, range_contains). UI tsc/tests NOT run.
- Plans updated: none (no plan file given)

### Overall Assessment
Probe path (`force_suspend` 503 mapping) is well sanitized: closed `ProbeFailureReason` enum -> fixed code+message, diagnostics only to `tracing`. Version 2 + request_id correlation + 3s bound + fail-closed all present. BUT sanitization is incomplete elsewhere: `status.detail` still carries raw helper strings. UI error/reason-code maps do not match server codes. Dead code in status.rs.

### Critical / High Issues

1. **[HIGH – acceptance #1 FAIL] `status.detail` leaks raw helper/IPC text.** coordinator.rs `handle_outcome` (~L3688-3703) builds `detail` from raw outcome strings: `"suspend failed: {error}"`, `"unsupported capability: {d}"`, `"inhibited by {inhibitor}"`, `"fleet active: {reason}"`. `IdleSuspendStatusV1.detail` is serialized to REST/SSE and decoded by UI. Only `last_outcome` goes through `public_safe()`; `detail` bypasses it. Raw sources: executor.rs L116 `"Helper IPC communication error: {e}"` (io errno/"os error N"), helper_client.rs L257 `"{code}: {message}"` where helper_server L61-63 message = `"Peer authentication failed: Peer UID {actual} does not match expected enrolled UID {expected}"` / PID file path (peer_auth.rs L31-37) -> UIDs/PIDs/paths reach every status subscriber. Also `UnavailableExecutor` reason, preflight `Failed to read {path}: {e}`.
   Fix: derive `detail` from `outcome.public_safe()` (e.g. `let safe = outcome.public_safe();` then format from `safe`), or emit fixed strings. Add test: ExecutionFailed with path/uid string -> serialized status JSON contains none of it.

2. **[HIGH] UI error codes don't match server codes.** Server emits `idleSuspendHelperUnavailable`, `idleSuspendInhibited`, `idleSuspendRtcBusy`, `idleSuspendProbeTimeout`, `idleSuspendCapabilityUnavailable` (protocol.rs L187-190). force-sleep-dialog-utils.ts handles `idleSuspendProbeUnavailable`, `idleSuspendProbePermissionDenied`, `idleSuspendProbePeerAuthFailed`, `idleSuspendProbeSocketNotFound` — never emitted (dead; server deliberately collapses these into HelperUnavailable). `idleSuspendInhibited` and `idleSuspendRtcBusy` have NO UI case -> fall to generic message. Remove 4 dead cases, add Inhibited/RtcBusy.

3. **[HIGH] `getProbeDiagnosticsMessage` reason codes mismatch server `safe_code()`.** UI: `permissionDenied, unsupportedSuspend, unsupportedRtc, inhibited, timedOut, probeFailed, helperUnavailable`; server (protocol.rs ~L425): `socketPermissionDenied, suspendStateUnsupported, rtcAlarmMissing, inhibitorPresent, probeTimeout, rtcAlarmBusy, connectionRefused, ipcIoError, ipcProtocolError, protocolVersionMismatch, probeExecutionError, executorUnavailable, unknownHelperFailure`. Only `socketNotFound`/`peerAuthFailed` match. Function also has zero callers (grep) -> dead code + hardcodes `/run/dam-hopper/idle-suspend.sock` and `/run/dam-hopper` (path assumption in client; socket path is configurable). Either wire it up with correct codes and no literal paths, or delete along with `probeReasonCode` UI surface if unused. Also `default:` echoes raw server string into UI text.

### Medium

4. **Dead code `LatestProbe`** (status.rs L371-392): never referenced (grep). Same logic duplicated inline in coordinator.rs L3885-3895 (DRY). Mid-file `use` at L370. Delete `LatestProbe` or use it (`record`) in coordinator.
5. **Probe status bypasses revision bump.** coordinator L3886 `status_tx.send_modify` mutates probe fields without bumping `status_revision`/`timestamp_ms`; subscribers see changed content with stale revision. `has_material_change` includes `probe_reason_code` but not `probe_checked_at_ms` (probably intended). Also `publish_*` now `tx.borrow().clone()` whole status just to copy two fields (L3030, L3105) -> avoidable alloc; read fields via `let (c, t) = { let p = tx.borrow(); (p.probe_reason_code.clone(), p.probe_checked_at_ms) };`.
6. **Protocol-version detection weak.** helper_client.rs L101-104 matches `ProtocolError::UnsupportedVersion` from `read_frame_async`, which never returns it (serde-only) -> dead arm. `resp_frame.validate()` failure (L123-137) blanket-maps to `ProtocolVersionMismatch` even for bad request_id. Helper replies to wrong-version request with `Error{code:"invalidFrame"}` -> client maps to `UnknownHelperFailure`; a v1 helper just drops the connection -> `IpcProtocolError`. Fail-closed holds, but `ProtocolVersionMismatch` is effectively reachable only for a v2-typed frame with bad version. Map `invalidFrame` w/ version text, or match `e` variant in validate branch (`UnsupportedVersion` -> mismatch, else `IpcProtocolError`).
7. **Timeout is only an outer wrapper.** coordinator L3873 hardcodes `Duration::from_secs(3)`; protocol.rs `ProbeFailure::timeout()` hardcodes "3 seconds" string. Extract `const CAPABILITY_PROBE_TIMEOUT: Duration` shared by both. HelperClient itself has no connect/read timeouts (safe today since sole caller wraps; document or add). Helper-side `handle_connection` read has no timeout (pre-existing).
8. **Missing tests** for: timeout path (`ProbeFailure::timeout` -> `idleSuspendProbeTimeout` 503), HelperClient error->reason mapping, request_id mismatch -> IpcProtocolError, `public_safe`/`public_error` leak checks (grep of tests found none), v1->v2 rejection. `test_helper_protocol_v1_frame_compatibility` name now misleading (asserts v2).
9. `ProbeDiagnostics` carries `actual_uid/expected_uid/pid` fields but nothing ever populates them (all `None`); `bounded_detail` is not actually bounded (unbounded `format!("{e}")`/helper detail, helper frame cap 4 KiB only). Truncate or drop unused fields (YAGNI). Verbose per-site struct literals in helper_client.rs (~12 copies) -> add `ProbeFailure::new(reason, stage, detail)` helper / `Default` spread.

### Low
10. Unrelated formatting churn (audit.rs, api consent handlers, protocol variant collapse, mod.rs export reordering, main.rs line removal, blank line removal coordinator L682). Inflates diff; harmless.
11. api/idle_suspend.rs: `AuditFailed(msg)` in consent decision (L~630) returns raw `msg` to client and `ValidationFailed(err)` echoes internal error — pre-existing, outside this change, but inconsistent with Requirement 48 claim.
12. `HelperResponsePayload::Capability.detail` ("Preflight check failed: {e}" with sysfs paths) is sent over IPC; acceptable (local, peer-authenticated) because client only logs it — keep it out of DTOs (currently is).
13. `ProbeFailureReason::public_error` wildcard `_` -> HelperUnavailable swallows future variants silently; prefer exhaustive match.

### Positive
- Closed reason taxonomy, `safe_code()` fixed strings, `ProbeFailureReason::dimension()`.
- `deny_unknown_fields` on probe request; request_id validated on both encode and decode; correlation id checked on response.
- Fail-closed everywhere: any IO/decode/mismatch/unexpected payload/timeout -> Unavailable; coordinator rejects before handoff, audited as RejectedCapability, event reason mapped.
- `HELPER_PROTOCOL_VERSION=2` enforced both directions via `validate()`.
- `public_safe()` applied to `last_outcome` at both publish sites.
- Preflight switched from exists()+read (TOCTOU) to single read with NotFound mapping.
- API 503 mapping uses fixed messages only; tracing carries diagnostics.

### Acceptance Verdict
1. REST error sanitization: probe-failure REST response PASS; status DTO `detail` FAIL (issue 1).
2. IPC invariants: v2 negotiation PASS (weak detection, issue 6); bounded timeout PASS (3s outer, magic number, issue 7); fail-closed PASS.
3. Cleanliness: no new compiler warnings; fmt clean on changed files; dead code (LatestProbe, getProbeDiagnosticsMessage, 4 UI cases) and UI/server code mismatch FAIL.

### Metrics
- Compiler warnings from changed files: 0
- fmt diffs in changed files: 0
- New clippy warnings attributable: none observed (existing too_many_arguments etc.)

### Unresolved Questions
- Is `probeReasonCode` intended to be rendered by UI anywhere (no consumer found)? If not, drop decoder + field.
- Should socket path be surfaced in UI hint text at all given it is configurable?
