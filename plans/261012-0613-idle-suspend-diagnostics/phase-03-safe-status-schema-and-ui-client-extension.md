# Phase 03 — Safe Status Schema & UI Client Extension

Status: Pending · Priority: P1 · Effort: 4h · Dependencies: phases 01–02

## Objective & scope
Expose latest probe health as additive status v1 fields; retain older payload compatibility and all policy discriminants. Keep operator detail private, including existing execution `detail`/`lastOutcome` paths. UI decodes the fields instead of dropping them and shows accurate force-sleep errors without interpreting helper blockers as fleet conflicts.

Context: [overview](./plan.md), [coordinator state contract](./phase-02-coordinator-diagnostics-and-server-tracing.md), [status UI docs](../../docs/idle-suspend-status-ui.md).

## Exact files to modify
| File | Change |
|---|---|
| `server/src/idle_suspend/status.rs` | Add optional safe probe reason/timestamp; fallback initialization; semantic-change comparison; safe execution-outcome projection |
| `server/src/idle_suspend/protocol.rs` | Shared safe code conversion for status reason, keeping internal diagnostic types out of public DTOs |
| `server/src/idle_suspend/coordinator.rs` | All status constructors/publishers use latest probe and public-safe execution outcome; bounded raw failure logs before projection |
| `server/src/api/idle_suspend.rs` | GET returns already safe coordinator/fallback DTO; keep no-store |
| `packages/ui/src/api/client.ts` | Optional field interface, reason allowlist and epoch validation, explicit return-object assignments |
| `packages/ui/src/lib/force-sleep-dialog-utils.ts` | Static messages for refined 503 error codes, unchanged fleet conflict strings |
| `server/src/api/tests.rs`, `server/src/idle_suspend/tests.rs`, `server/tests/idle_suspend.rs` | Migrate direct Rust status literals and expected public detail; schema/revision coverage |
| `packages/ui/src/api/idle-suspend-client.test.ts` | Preserve existing decoder/legacy-policy regression coverage with additive fields |
| `packages/ui/src/lib/force-sleep-dialog-utils.test.ts`, `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx` | Messages and 503-vs-409 behavior |

Requested `packages/ui/src/api/client.test.ts` does **not** exist currently. Phase 05 creates it for focused diagnostics contract tests; existing decoder tests stay in `idle-suspend-client.test.ts`, avoiding wholesale test relocation or duplicate assertions. Existing `ForceSleepDialog.tsx` uses utility and conflict decoder; intentionally unchanged unless new tests reveal code change necessary.

## Implementation details & code snippets
1. Add fields with serde defaults and omit absent values. Public reason is a closed flat camelCase wire string. Define `ProbeReasonCode` as Supported or Failure(phase-01 enum), with explicit serde conversion through shared safe-code methods; no duplicated raw-error parser. Never include `ProbeDiagnostics` in status.

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub probe_reason_code: Option<ProbeReasonCode>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub probe_checked_at_ms: Option<u64>,
// ProbeReasonCode wire examples: "supported", "socketPermissionDenied",
// "peerAuthFailed", "rtcAlarmMissing", "inhibitorPresent", "probeTimeout".
```

Semantics: fallback/startup unchecked => both None; a real completed probe => non-null reason and current epoch-ms timestamp; success is `supported`, not missing data. Never reset the last probe on unrelated timer/policy publications. `capabilityCode` retains startup executor/selection contract; amend misleading field comment rather than changing its value/meaning for old clients.
2. Populate every production initializer (coordinator initial snapshot, fallback and both publisher builders) and test literal. Flow latest probe through both empty-fleet/agent-activity and agent-free publication. Keep automatic policy/activity/agentFree/clientPresence/consent mutual exclusions unchanged.
3. Add probe reason to `is_meaningful_change`; ignore only `probeCheckedAtMs` changes. Existing publishers send fresh snapshots even when no semantic change, so REST sees newer timestamp without status revision/invalidation churn. Success after failure changes reason => exactly one semantic revision; repeated success/failure same reason => timestamp fresh, revision/event unchanged (assuming other fields unchanged).
4. Close existing **affected** status leakage: `handle_suspend_outcome` currently retains raw helper `detail`/`error`/inhibitor `who`/`why`. Keep raw failure logs/local audit before projecting to public fields. Build one public-safe `SuspendOutcome` projection reused by both publishers, not HTTP-only sanitizer. Preserve existing variant/request ID/numeric fields and compatible string fields, replacing freeform values with static category text; omit who/why. This protects REST and any transport serializing coordinator status.

```rust
fn public_outcome(outcome: &SuspendOutcome) -> SuspendOutcome {
    match outcome {
        SuspendOutcome::UnsupportedCapability { request_id, .. } =>
            SuspendOutcome::UnsupportedCapability {
                request_id: request_id.clone(),
                detail: "required sleep capability unavailable".into(),
            },
        SuspendOutcome::ExecutionFailed { request_id, .. } =>
            SuspendOutcome::ExecutionFailed {
                request_id: request_id.clone(),
                error: "host sleep execution failed".into(),
            },
        SuspendOutcome::BlockedByInhibitor { request_id, .. } =>
            SuspendOutcome::BlockedByInhibitor {
                request_id: request_id.clone(),
                inhibitor: "active sleep inhibitor".into(), who: None, why: None,
            },
        // RejectedFleetActive: fixed reason; ResumedSuccessfully: preserve numbers.
        // Complete exhaustive match in implementation, no raw fallback clone.
    }
}
```

`status.detail` likewise only known static summaries/reason codes, preserving `coordinatorNotStarted`; never pass arbitrary prior `detail.clone()` to public snapshot. Probe rejection updates new probe fields, not fake last execution outcomes. Do not remove operator evidence from controlled local audit/logs. No unrelated activity-observation/process inventory redesign.
5. Extend TypeScript optional fields; use existing `isValidEpochMs`/`isNonNegativeSafeInteger` helpers and plain-object validation, not unchecked assertions alone. Accept omitted/null values independently for legacy compatibility; reject wrong types, invalid epochs, and unknown reason values. Server emits coherent pair; decoder does not make either field newly mandatory.

```ts
export type IdleSuspendProbeReasonCode =
  | "supported" | "socketNotFound" | "socketPermissionDenied"
  | "connectionRefused" | "peerAuthFailed" | "ipcIoError"
  | "ipcProtocolError" | "protocolVersionMismatch" | "probeExecutionError"
  | "probeTimeout" | "executorUnavailable" | "unknownHelperFailure"
  | "suspendStateUnsupported" | "rtcAlarmMissing"
  | "inhibitorPresent" | "rtcAlarmBusy";
// IdleSuspendStatusV1 additions:
probeReasonCode?: IdleSuspendProbeReasonCode | null;
probeCheckedAtMs?: number | null;
```

Validate with own-property lookup in closed reason table (avoid inherited-key acceptance like `constructor`/`__proto__`). Explicitly return `probeReasonCode: value.probeReasonCode ?? null` and `probeCheckedAtMs: value.probeCheckedAtMs ?? null` after validation; cast only to validated union/number. Existing explicit decoder otherwise drops additions.
6. Add utility switch cases for `idleSuspendHelperUnavailable`, `idleSuspendInhibited`, `idleSuspendProbeTimeout`, `idleSuspendRtcBusy`; refine hardware-only existing capability message. Use static client strings, never display helper stderr/diagnostic fields. Existing 503 follows error banner; 409 fleet/handoff remains conflict flow. No disabling manual sleep from possibly stale cached probe or inventing retries/operator repair commands.

## Acceptance & verification commands
After integrated changes:

```bash
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --lib api::tests
pnpm --filter @dam-hopper/ui test src/api/client.test.ts src/api/idle-suspend-client.test.ts src/lib/force-sleep-dialog-utils.test.ts src/components/organisms/ForceSleepDialog.test.tsx
pnpm --filter @dam-hopper/ui build
```

Required: pre-extension status decodes unchanged; omitted/null fields normalize; valid fields retained across API transport; malformed reason/timestamp rejected without dropping valid old policies. Rust deserializes old snapshots using defaults. No internal sentinel in public detail/lastOutcome/probe/status; no event revision churn for timestamp-only refresh. 503 helper/inhibitor/timeout/RTC-busy shows error, never confirmation-conflict state. No false success from stale startup capability selection.

## Risks & invariants
- **Requirement 48:** new fields are code/time only; existing affected `detail`/`lastOutcome` sanitized at common publisher, not a per-route omission that WebSocket can bypass. Public DTO shape preserved; no raw executor result serialization.
- New Rust fields require updating all struct literals in same integration; omitted serde defaults alone don't make Rust literals compile.
- Unknown safe reason is rejected by new decoder, matching existing strict enum conventions; older server missing additions is accepted. Keep v1 and automatic-policy compatibility unchanged.
- Sanitizing public strings must not destroy raw controlled operator evidence. Do not claim UI authentication makes private paths safe to expose.
- Cached latest probe may be stale; timestamp describes observation, not continuously monitored availability. Preserve enabled/startup configuration separately.

## Unresolved questions
None. New requested client.test.ts is an explicit creation in phase 05, not a missing prerequisite.
