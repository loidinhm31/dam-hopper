# Research: producer event/audit contract

Research snapshot: 2026-09-12. Scope: current Rust server/helper idle-suspend action paths, audit persistence, correlation, and privacy boundaries. No UI, fleet telemetry, observer daemon, upload, or implementation.

## Executive findings

- The approved decision record requires producer-owned semantic events plus a one-shot local collector; it explicitly says the automatic server chain is currently missing (`plans/reports/brainstorm-260911-2355-production-idle-suspend-diagnostics.md:20-38`).
- Keep existing timing/manual and root helper JSONL contracts readable. Add a separately versioned canonical event stream rather than inserting a third variant into the existing untagged `ServerAuditRecord`; mixed untagged lines create ambiguous migration/reader behavior (`server/src/idle_suspend/server_audit.rs:171-176`).
- Generate one UUID-shaped correlation ID at attempt creation (automatic and manual), pass the same value as helper wire `requestId`, and never use epoch/revision values as identity. Existing automatic `epoch-N` IDs are restart-ambiguous (approved record: `:20-29`).
- Durable intent must precede any irreversible suspend backend call. Required event/audit failure is fail-closed; post-action diagnostic writes cannot undo the action and must be represented as incomplete evidence.

## Current facts (not proposed)

1. `IdleSuspendCoordinator` owns the state machine (`coordinator.rs:128-134`); `run_coordinator` is the main loop (`:361-967`), with fleet, deadline, outcome, and manual handlers (`:1298-1478`, `:1481-1809`). Status is latest-only/watch-published, not history (approved record `:20-24`; `status.rs`).
2. Automatic flow currently has no durable server chain. Manual timing/force paths use `IdleSuspendServerAudit`; timing and manual records are separate structs (`server_audit.rs:58-70`, `:116-131`) wrapped by an untagged `ServerAuditRecord` (`:171-176`). Existing bounds include 10,000 records and actor/request lengths (`:15-18`).
3. Current server audit behavior: mode `0600`, `O_NOFOLLOW`, synchronized JSONL; absent file reads as empty and malformed lines are silently skipped (approved record `:20-25`). These semantics are insufficient for incident completeness unless the collector reports them explicitly.
4. Root helper audit is already bounded/synchronized JSONL, mode `0600`, with capacity 10,000 (approved record `:24-26`; helper binary constructs `HelperAudit` with `10_000`, `dam-hopper-idle-suspend-helper.rs:75-78`). Its closed record type is only `acceptedIntent`, `executionCompleted`, `executionRejected`; fields include request ID, protocol version, optional wake seconds/outcome/detail, peer PID/UID, and epoch timestamp (`audit.rs:13-40`).
5. Helper handling order is authoritative: peer authentication, one frame read, frame validation, then dispatch (`helper_server.rs:40-94`); dispatch implementation covers dedupe/preflight/audit intent/backend/completion (`:96-242`). Capability probes use the same protocol client path but are not currently audited (approved record `:24-26`).
6. IPC has protocol version 1 and a 4 KiB frame cap (`protocol.rs:228-232`), bounded request-ID and wake-duration validation (`:263-289`), FIFO replay dedupe (`:291-322`), and tagged request/response payloads (`:324-437`). Preserve these boundaries; diagnostics must not expose raw frames.
7. `HelperClient::check_capability` sends a probe and returns a detail string (`helper_client.rs:30-49`); `execute_suspend` turns protocol/error payloads into `SuspendOutcome` (`:52-77`). The detail/error strings are not safe canonical event data.
8. `dam-hopper` currently dispatches release-manager commands only; no `diagnose` command (`server/src/bin/dam-hopper.rs:12-24`, `:24-364`).

## Minimal proposed canonical event contract

Use a new append-only canonical event JSONL source (server and helper producers may have separate files). Event schema version is independent of bundle schema and helper protocol version.

Envelope (all fields fixed/bounded):

- `eventSchemaVersion: u32` (start at 1).
- `timestampMs: u64` (wall clock evidence only; never ordering identity).
- `bootId: bounded opaque string` and `producerInstanceId: UUID`; producer identity changes on process restart. Avoid hostnames/user text.
- `producerSequence: u64`, allocated under the producer writer lock, starting at 1 per producer instance; never reuse. Gaps are evidence (write failure/crash/rotation), not silently repaired.
- `eventType: closed enum`; `correlationId: Option<bounded UUID>`; `mode: Option<automatic|manual>`.
- `data: closed tagged event payload`, containing only typed bounded values: revisions/generations, counts, durations, wake seconds, policy booleans, and sanitized reason/outcome codes. No free-form detail.

Recommended event enum (small closed set):

- `coordinatorStarted`; `attemptStarted`; `armStarted`; `armCancelled`.
- `measurementUnavailable`; `measurementRecovered`; `finalCheckStarted`; `finalCheckCompleted`.
- `handoffClaimAccepted`; `handoffClaimRejected`; `helperRequestDispatched`; `helperOutcomeReceived`.
- `reconciliationCompleted`; `terminalRejected` (covers non-action terminal decisions).
- Helper-owned: `requestRejected`; `capabilityResult`; `preflightResult`; `intentPersisted`; `rtcProgrammingResult`; `suspendInvoked`; `suspendCompleted`.

Use a closed `ReasonCode` enum, not arbitrary strings. Minimum codes needed to reconstruct existing branches: `policyDisabled`, `startupGuard`, `emptyFleet`, `activeFleet`, `recentInput`, `recentOutput`, `recentNetwork`, `measurementUnavailable`, `staleActivityRevision`, `staleFleetGeneration`, `graceCancelled`, `finalCheckFailed`, `handoffBusy`, `handoffLost`, `helperUnavailable`, `peerRejected`, `protocolInvalid`, `duplicateRequest`, `capabilityUnsupported`, `rtcBusy`, `rtcProgrammingFailed`, `inhibitorPresent`, `suspendFailed`, `suspendReturned`, `shutdown`, and `auditWriteFailed`. Unknown future codes must be surfaced as unsupported/malformed source status, not interpreted as success.

## Correlation and lifecycle rules

- On candidate/attempt creation, allocate a cryptographically random UUID; automatic and manual use identical lifecycle. UUID remains unchanged through coordinator, helper IPC request ID, helper audit join, outcome, and reconciliation. Existing protocol `requestId` validation accepts UUID-compatible IDs (`protocol.rs:263-277`).
- Emit one `attemptStarted`, then semantic boundaries only (never one-second activity samples). Automatic events follow actual coordinator transitions; include activity revision, fleet generation, and status revision where available as evidence, never identity.
- Emit `armStarted`/`armCancelled`, measurement availability transitions, final-check start/result, and claim result. Every rejection path gets a typed terminal event, including recent activity, unavailable measurement, stale generation, active fleet, inhibitor, and capability failure.
- Emit `helperRequestDispatched` before sending. Helper emits auth/request rejection when a safe correlation is available; then capability/preflight, durable intent, RTC result, invocation, and completion. Durable intent precedes backend invocation. Helper audit's existing accepted/completed/rejected record remains authoritative and is joined by the same request ID.
- Coordinator emits `helperOutcomeReceived` only on an actual response, then exactly one `reconciliationCompleted` for a completed attempt. A crash/restart can leave an open chain; collector reports it as incomplete/orphaned, never synthesizes success.
- Exactly one producer sequence per emitted event; server and helper sequences are independent. Sequence continuity is only asserted within `(bootId, producerInstanceId)`; restart boundaries are explicit.

## Durability, retention, and corruption

- Preserve current mode `0600`, no-follow, synchronized append semantics. New canonical writers need a trusted fixed path, bounded line/record size, and exclusive writer synchronization. Do not make coordinator locks span disk I/O when avoidable.
- For safety-critical boundaries, append + newline + flush/sync according to the writer contract before proceeding. In particular, helper `intentPersisted`/existing accepted intent must fail closed before RTC/suspend. If a required pre-action event cannot persist, reject/stop rather than execute untraceably. A post-action write failure is an evidence gap and must not be mislabeled as a failed suspend.
- Keep source logs untouched: collector only reads allowlisted fixed paths/APIs; never compacts, repairs, truncates, or runs shell/arbitrary commands. Apply 60-minute window, 10,000 records/source, and 8 MiB final-bundle defaults, with hard maxima and reported bounds (approved record `:96-113`, `:135-145`).
- Missing/permission-denied/rotated source is not an empty array. Per-source status must distinguish `available`, `missing`, `permissionDenied`, `malformed`, `truncated`, `retentionLimited`, `authRequired`, and `notHistorical`. Include valid records around malformed lines only with a malformed count/status; do not copy malformed raw text. Partial final line is malformed/truncated tail evidence.
- Pruning/retention can create sequence gaps; classify gaps at a known retention boundary separately from unexplained gaps. Unknown schema versions, duplicate sequence values, and invalid correlation IDs are parse evidence, not records to coerce.

## Compatibility and privacy/security boundaries

- Do not alter helper protocol v1 merely to add audit metadata: keep `requestId` field and send the new UUID. Event, bundle, and protocol versions remain independently versioned. Do not add canonical events to the untagged server audit union; if a shared file is unavoidable, introduce an explicit discriminator/version and a migration reader before writing new lines.
- Existing server timing/manual and helper audit files remain readable. Legacy automatic `epoch-N` records must be marked legacy/ambiguous and never joined across producer restarts; UUID manual records can join only when validation proves identity. No fabricated correlation from timestamp/revision.
- Canonical event data excludes terminal bytes, process arguments, environment, credentials/tokens, raw IPC/frame data, socket addresses, inhibitor identity, raw systemd/journal detail, and unbounded stderr. Replace all operational text with closed codes and bounded numeric evidence. Existing helper `detail` and `SuspendOutcome` error text stay restricted to source audit (if retained) and are redacted/dropped before bundle serialization.
- Numeric peer PID/UID and service `MainPID`/status may be included only as bounded host/auth evidence; never resolve them to command lines or environment. Collector is local-only, no network egress/upload/AI credential, atomic output mode `0600`, stdout path only; diagnostics to stderr (approved record `:9-18`, `:110-113`).

## Implementation phase boundary and test seams

Recommended boundary: land and review the event schema, IDs, writers, and server/helper producer instrumentation first; only after both producers emit stable durable records build collector correlation/redaction. This prevents a collector contract built around missing automatic events.

Test seams (existing fixtures to extend):

- Event serde/closed-enum rejection, UUID/request-ID compatibility, per-producer sequence and restart-gap behavior.
- Coordinator quiet/countdown/final-claim and invalidation paths (`tests.rs:2627-2813`), unavailable executor and audit-write-failure fail-closed paths (`:501-518`, `:806-835`), and manual rejection/success/capability paths (`:2009-2509`).
- Helper record bounds/pruning and IPC success/auth/dedupe/malformed-frame/fail-closed paths (`tests.rs:1182-1247`, `:1288-1478`, `:1577-1665`, `:1856-2007`).
- Collector fixtures for restart boundaries, orphan/gap joins, malformed/permission-denied/rotated files, caps, redaction, root complete versus non-root partial output, and atomic `0600` path-only stdout. Verify collector never mutates RTC, suspend, service, audit, or config.

## Unresolved questions

1. Which fixed server/helper event paths and parent-directory ownership are the deployment contract on every installed layout?
2. Does the project require `sync_data`/`sync_all` per required event, or is existing synchronized `flush` semantics the accepted durability boundary?
3. Should helper capability probes use the canonical event stream with no correlation, or receive a collector-only probe record type?
4. Which existing `SuspendOutcome` variants map to the closed `ReasonCode` list, and which fields are safe to retain in restricted audit versus bundle?
5. Is boot identity always available through the supported host API, and what opaque producer-instance format should be standardized across server/helper?
