# Production idle-suspend diagnostics design contract

Status: User-approved Phase 01 contract. Phase 02 canonical event foundation
was implemented on 2026-09-13; coordinator/helper instrumentation, the
collector, bundle output, and rollout remain planned Phases 03–07.
Review status: Third reviewer scored 10/10 with no findings.
Phase 01 copied this reviewed contract into `docs/system-architecture.md`
before the Phase 02 production-code mutation.

## Phase 02 implementation disposition

Phase 02 implements the producer foundation described by this contract in
`server/src/idle_suspend/event.rs` and re-exports it from
`server/src/idle_suspend/mod.rs`. The closed 14-event model, 26 reason codes,
typed payload validation, boot/process identity, UUID v4 correlation, checked
producer sequence, and hardened JSONL writer are now available to later
coordinator instrumentation.

The implementation is intentionally isolated: the coordinator does not yet
construct or emit semantic events, the helper audit remains unchanged, and no
collector or bundle writer is shipped. The existing untagged timing/manual
server audit remains byte-compatible. Phase 03 owns lifecycle emission and
must consume these types without changing the frozen schema, path, identity,
sequence, correlation, or durability rules.

## Decision and boundaries

One-shot producer-owned diagnosis. Existing server/coordinator/helper paths emit semantic evidence; `dam-hopper diagnose --json` reads fixed local sources, writes one atomic mode-`0600` JSON file, prints its absolute path plus newline, then exits. No observer daemon, sampling log, UI, telemetry pipeline, alerting, automatic upload, external AI credential, terminal output, shell, operator-selected command/source/path, or default-policy change.

The bundle reconstructs evidence; it does not classify a root cause, prove work completion, or claim a final activity sample eliminates races. Current API and host probes are latest/non-historical.

## Contradictions resolved

| Topic | Frozen resolution |
| --- | --- |
| Existing untagged `ServerAuditRecord` vs new events | Preserve `idle-suspend-audit.jsonl` for timing/manual compatibility. Add a separately tagged server event stream; never add a third variant to the untagged union. |
| Helper events vs duplicate logs | Evolve the existing helper audit file in place. V2 records retain `recordType` and existing accepted/completed/rejected compatibility fields, add optional identity/sequence/code fields, and add milestone variants. Do not write a parallel helper event log. |
| Semantic evidence vs durable intent | Server semantic events and post-action helper milestones are diagnostic best-effort. Existing manual acceptance audit and helper `acceptedIntent` remain required pre-action gates. Helper intent sync failure blocks RTC/suspend. Later write failure records an evidence gap when possible and never rewrites the actual outcome. |
| `available` vs `notHistorical` | Use separate `collectionStatus` and `historicity`. A source can be `available` and `latest`/`nonHistorical`; absence never masquerades as an empty successful source. |
| Best-effort API/probes vs bundle completeness | Historical completeness depends on role-applicable producer streams, compatibility audits, API/helper journals, and unit lifecycle evidence. API status and current probes are attempted and reported but do not downgrade historical completeness. |
| Missing unit on web-only role | `notApplicable`, never `missing`. Missing/invalid role evidence prevents this inference and makes applicability `unknown`, therefore historical completeness is partial. |
| Fixed installed output vs non-root validity | Root output: `/var/lib/dam-hopper-manager/diagnostics`. Non-root output: the invoking user's resolved state directory (`$XDG_STATE_HOME/dam-hopper/diagnostics`, else `$HOME/.local/state/dam-hopper/diagnostics`). No public output-path option. Both directories require trusted ownership, mode `0700`, no symlink traversal; files are `0600`. |
| Root helper evidence vs no sudo | EUID sampled once. Root attempts helper evidence; non-root never invokes sudo/setuid and marks applicable root-only sources `permissionDenied`, yielding exit `2`. |
| Configurable bounds language vs v1 simplicity | Public v1 has fixed 60-minute, 10,000-record-per-record-source, and 8-MiB-final-file limits. No tuning flags. Constants remain internal hard limits and are serialized. |

## Fixed installed paths and authority

Phase 01 validated ownership/modes against staged and installed units. Phase 02
uses this fixed path contract; any mismatch reopens the contract and blocks
Phase 03–06 until the table or deployment assets are corrected and reviewed.

| Source/output | Installed path or authority | Rule |
| --- | --- | --- |
| Server semantic events | `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` | Phase 02 provides the isolated writer, mode `0600`, no-follow, append/sync; Phase 03 will integrate it with the API coordinator. The final rendered API `User=`/`Group=` pair is the runtime owner authority. The API pre-start gate does not provision this file. |
| Server timing/manual audit | `/etc/dam-hopper/idle-suspend-audit.jsonl` for the fixed `/etc/dam-hopper/dam-hopper.toml` deployment | The completed API runtime gate pre-provisions this final-API-UID/GID regular file `0600` beneath the root `0:0` `0755` anchor; existing bytes/inode are preserved. Collector reports alternate/custom layouts unsupported rather than guessing. |
| Helper audit/events | `/var/log/dam-hopper/idle-suspend-helper.jsonl` | Existing helper audit written `0600` by the `root:API_GROUP` helper beneath systemd `LogsDirectory=dam-hopper`; no second helper log. |
| Backend diagnostics | `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/backend-log.jsonl` | Existing API-owned compatibility source, created `0600`; the collector reads it through its bounded no-follow adapter and excludes terminal tails entirely. |
| Host role | `/etc/dam-hopper/host.toml` via `Layout::host_config_path()` | `TargetRole::{Server,Both}` makes idle sources applicable; `Web` makes them `notApplicable`. |
| Units | `dam-hopper-api.service`, `dam-hopper-idle-suspend-helper.service` constants | No operator unit selection. The final API `User=`/`Group=` pair is the only API runtime identity authority; the helper remains `root:API_GROUP`. |
| Local status API | fixed loopback installed API endpoint and fixed server-token path | Bounded request, short deadline, no redirect; auth failures are `authRequired`. Token never enters argv, logs, bundle, or error text. |
| Root bundle output | `/var/lib/dam-hopper-manager/diagnostics/dam-hopper-diagnose-<generatedAtMs>-<bundleId>.json` | Trusted root-owned `0700` directory; exclusive temp in the same directory, sync, atomic rename, directory sync. |
| Non-root bundle output | resolved user state directory with same filename | Trusted invoking-user-owned `0700` directory without symlink traversal; valid partial output; unsafe/missing home resolution is exit `1`, not `/tmp` fallback. |

The completed descriptor-relative, refusal-based API runtime provisioner is the sole provisioning authority for fixed API state and audit paths. It walks from the trusted layout root with directory descriptors and no-follow operations, creates missing objects with final metadata, validates each pre-existing object as exact type/owner/group/mode, and refuses mismatches without repair, replacement, truncation, or content mutation; a failed call cleans only empty objects created by that call in reverse order. This implemented prerequisite provisions only the fixed API state and audit paths above: it does not provision, repair, or lazily create the diagnostics source. The Phase 02 writer requires its already-provisioned parent and does not create it.

The API unit has no `StateDirectory=` or `StateDirectoryMode=`. Its one fixed root-privileged pre-start gate is `ExecStartPre=+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime`, with no operands beyond `provision-api-runtime`; it runs before every API start/restart, and `ExecStart` is unreachable when it refuses. Activation and rollback provision immediately before starting the API. Boot recovery reparses the installed API unit and provisions an active server's fixed paths without starting services. A provisioning, owner, parent-mode, or symlink mismatch is an explicit source error that blocks `complete`; alternate-path scanning is forbidden.

### Fixed source metadata comparators

Every file source begins from the trusted layout-root descriptor and opens only its fixed components with `openat2` `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV`, or an equivalent descriptor walk. A symlink, replacement, mount transition, missing handle-safe primitive, or failed descriptor-continuity check discards the affected source as typed partial evidence; it never follows or scans an alternate path. The `NO_XDEV` rule intentionally makes a separate `/var` or `/var/log` filesystem an `unsupported` partial source rather than a supported alternate layout.

The collector uses the following exact metadata comparators for product-controlled **ancestor directories**. The final-file comparators remain in the source table above; no row repairs or normalizes an existing object.

| Path | Type | UID | GID | Mode | Sole authority and mismatch result |
| --- | --- | ---: | ---: | ---: | --- |
| `/var` | directory | `0` | `0` | `0755` | API runtime provisioner; existing and newly created entries must match. |
| `/var/lib` | directory | `0` | `0` | `0755` | API runtime provisioner; existing and newly created entries must match. |
| `/var/lib/dam-hopper` | directory | final API UID | final API GID | `0700` | API runtime provisioner; existing and newly created entries must match. |
| `/var/lib/dam-hopper/.config` | directory | final API UID | final API GID | `0700` | API runtime provisioner; existing and newly created entries must match. |
| `/var/lib/dam-hopper/.config/dam-hopper` | directory | final API UID | final API GID | `0700` | API runtime provisioner; existing and newly created entries must match. |
| `/var/lib/dam-hopper/.config/dam-hopper/diagnostics` | directory | final API UID | final API GID | `0700` | API `DiagnosticStore` creates a missing parent while the final API unit has `UMask=0077`; collector only verifies an existing entry. Mismatch makes `serverEvents` and `diagnosticEvents` `unsupported` partial sources. |
| `/etc` | directory | `0` | `0` | `0755` | API runtime provisioner; existing and newly created entries must match. |
| `/etc/dam-hopper` | directory | `0` | `0` | `0755` | API runtime provisioner; existing and newly created entries must match. |
| `/var/log/dam-hopper` | directory | `0` | final API GID | `0755` | Fixed helper unit: `User=root`, `Group=API_GROUP`, `LogsDirectory=dam-hopper`, and default `LogsDirectoryMode=0755`. Collector requires the effective fixed helper unit to retain these values; deviation makes only helper audit, journal, and lifecycle sources `unsupported` partial evidence. |

`/` and `/var/log` are host traversal anchors, not product metadata authorities. For them the collector requires only a directory descriptor, no symlink or mount transition, and descriptor continuity before projection; it does not invent an exact UID, GID, or mode. For every product-controlled row and final file, it validates type/owner/group/mode with `fstat` before and after projection, enforces source and line caps before allocation, and reports a replacement, special file, metadata mismatch, or race as typed partial evidence. The collector never locks, compacts, repairs, rotates, truncates, rewrites, or follows a producer path.

## Version contracts

Independent constants; changing one never implies changing another:

- `IDLE_SUSPEND_EVENT_SCHEMA_VERSION = 1`: new server semantic envelope only.
- `HELPER_AUDIT_SCHEMA_VERSION = 2`: in-place helper audit evolution; legacy records have implicit v1.
- `DIAGNOSTIC_BUNDLE_SCHEMA_VERSION = 1`: collector output.
- `HELPER_PROTOCOL_VERSION = 1`: unchanged wire frames and 4-KiB cap. The existing `requestId` carries the UUID correlation ID.

Unknown version, unknown enum, invalid UUID, duplicate producer sequence, partial final line, or malformed JSON is parse evidence. Keep valid surrounding records but mark the source malformed/partial. Never coerce unknowns into success.

## Server event envelope

`IdleSuspendEventEnvelopeV1` is camelCase, deny-unknown-fields, and explicitly tagged:

- `eventSchemaVersion`: strictly `1` (`u32`)
- `timestampMs`: `u64` milliseconds since UNIX epoch (wall-clock evidence, not ordering identity)
- `bootId`: canonical lowercase RFC 4122 UUID string read from `/proc/sys/kernel/random/boot_id` (capped at 128 bytes, trimmed)
- `producerInstanceId`: canonical lowercase UUID v4 string created once per API process at startup
- `producerSequence`: `u64`, `1 ..= (u64::MAX - 1)`, allocated under writer lock, checked increment with no wrap; overflow permanently disables emission
- `eventType`: closed enum matching the 14 event types below
- `correlationId`: canonical lowercase UUID v4 string or `null`
- `mode`: `"automatic" | "manual" | null`
- `data`: closed bounded payload matching `eventType`

### Exhaustive 14-Event Matrix

| Event Type | Scope | `correlationId` | `mode` | Exact Payload Fields | Allowed Payload Rules & Bounds |
|---|---|---|---|---|---|
| `coordinatorStarted` | Process-wide | `null` | `null` | `automaticPolicy`<br>`quietPeriodSeconds`<br>`wakeAfterSeconds`<br>`timingRevision`<br>`statusRevision` | `automaticPolicy`: `"emptyFleet" \| "agentActivity"`<br>`quietPeriodSeconds`: `60 ..= 86400`<br>`wakeAfterSeconds`: `0 \| 60 ..= 86400`<br>`timingRevision`: `u64`<br>`statusRevision`: `u64` |
| `attemptStarted` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `fleetGeneration`<br>`activityRevision`<br>`timingRevision`<br>`statusRevision`<br>`wakeAfterSeconds` | `fleetGeneration`: `u64`<br>`activityRevision`: `u64 \| null` (must be `null` if `mode == "manual"` or `policy == "emptyFleet"`)<br>`timingRevision`: `u64`<br>`statusRevision`: `u64`<br>`wakeAfterSeconds`: `0 \| 60 ..= 86400` |
| `armStarted` | Attempt | Required UUID v4 | `"automatic"` | `fleetGeneration`<br>`activityRevision`<br>`quietPeriodSeconds`<br>`deadlineAfterSeconds` | `fleetGeneration`: `u64`<br>`activityRevision`: `u64 \| null`<br>`quietPeriodSeconds`: `60 ..= 86400`<br>`deadlineAfterSeconds`: `1 ..= 86400` |
| `armCancelled` | Attempt | Required UUID v4 | `"automatic"` | `reasonCode`<br>`fleetGeneration`<br>`activityRevision` | `reasonCode`: Subset **R_ARM**<br>`fleetGeneration`: `u64`<br>`activityRevision`: `u64 \| null` |
| `measurementUnavailable` | Process-wide | `null` | `null` | `reasonCode` | `reasonCode`: strictly `"measurementUnavailable"` |
| `measurementRecovered` | Process-wide | `null` | `null` | `activityRevision` | `activityRevision`: `u64` |
| `finalCheckStarted` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `fleetGeneration`<br>`activityRevision`<br>`timingRevision` | `fleetGeneration`: `u64`<br>`activityRevision`: `u64 \| null`<br>`timingRevision`: `u64` |
| `finalCheckCompleted` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `accepted`<br>`reasonCode`<br>`fleetGeneration`<br>`activityRevision` | `accepted`: `boolean`<br>If `accepted == true`: `reasonCode` must be `null`<br>If `accepted == false`: `reasonCode` must be Subset **R_FINAL**<br>`fleetGeneration`: `u64`<br>`activityRevision`: `u64 \| null` |
| `handoffClaimAccepted` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `fleetGeneration` | `fleetGeneration`: `u64` |
| `handoffClaimRejected` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `reasonCode`<br>`expectedFleetGeneration`<br>`actualFleetGeneration` | `reasonCode`: Subset **R_HANDOFF**<br>If `reasonCode == "staleFleetGeneration"`: `expectedFleetGeneration` and `actualFleetGeneration` must both be `u64`<br>For all other reasons: both must be `null` |
| `helperRequestDispatched` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `wakeAfterSeconds` | `wakeAfterSeconds`: `0 \| 60 ..= 86400` |
| `helperOutcomeReceived` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `reasonCode` | `reasonCode`: Subset **R_OUTCOME** |
| `reconciliationCompleted` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `reasonCode` | `reasonCode`: Subset **R_OUTCOME** |
| `terminalRejected` | Attempt | Required UUID v4 | `"automatic" \| "manual"` | `reasonCode`<br>`fleetGeneration`<br>`activityRevision` | `reasonCode`: Subset **R_TERMINAL**<br>`fleetGeneration`: `u64 \| null`<br>`activityRevision`: `u64 \| null` |

### Closed Reason Code Subsets (`ServerIdleSuspendReasonCodeV1`)

All reason codes belong to the closed set of 26 variants:
`policyDisabled`, `startupGuard`, `emptyFleet`, `activeFleet`, `recentInput`, `recentOutput`, `recentNetwork`, `measurementUnavailable`, `staleActivityRevision`, `staleFleetGeneration`, `graceCancelled`, `finalCheckFailed`, `handoffBusy`, `handoffLost`, `helperUnavailable`, `capabilityUnsupported`, `inhibitorPresent`, `shutdown`, `auditWriteFailed`, `protocolInvalid`, `duplicateRequest`, `rtcBusy`, `rtcProgrammingFailed`, `suspendFailed`, `suspendReturned`, `resumedSuccessfully`.

- **R_ARM** (`armCancelled`): `recentInput`, `recentOutput`, `recentNetwork`, `staleActivityRevision`, `staleFleetGeneration`, `activeFleet`, `graceCancelled`, `shutdown`.
- **R_FINAL** (`finalCheckCompleted` when `accepted == false`): `finalCheckFailed`, `recentInput`, `recentOutput`, `recentNetwork`, `measurementUnavailable`, `staleActivityRevision`, `staleFleetGeneration`, `activeFleet`, `shutdown`.
- **R_HANDOFF** (`handoffClaimRejected`): `handoffBusy`, `handoffLost`, `staleFleetGeneration`, `activeFleet`, `shutdown`.
- **R_OUTCOME** (`helperOutcomeReceived`, `reconciliationCompleted`): `resumedSuccessfully`, `activeFleet`, `inhibitorPresent`, `capabilityUnsupported`, `rtcBusy`, `rtcProgrammingFailed`, `suspendFailed`, `suspendReturned`, `helperUnavailable`, `protocolInvalid`, `duplicateRequest`.
- **R_TERMINAL** (`terminalRejected`): `policyDisabled`, `startupGuard`, `emptyFleet`, `activeFleet`, `recentInput`, `recentOutput`, `recentNetwork`, `measurementUnavailable`, `staleActivityRevision`, `staleFleetGeneration`, `finalCheckFailed`, `handoffBusy`, `handoffLost`, `helperUnavailable`, `capabilityUnsupported`, `shutdown`, `auditWriteFailed`, `protocolInvalid`.

### Writer Concurrency & Safety Contract

- **Single Process Authority**: Exactly one `IdleSuspendEventWriter` instance in the API process, held in `AppState`. No cross-process file coordination or file locking.
- **Mutex Scope**: A single `parking_lot::Mutex` serializes sequence allocation, formatting, and file I/O across local Tokio threads.
- **Sequence Allocation Point**:
  1. Validate event schema, fields, bounds, and payload rules. Validation failure does **not** consume a sequence.
  2. Under lock, allocate the next checked sequence: `next_seq = current_seq.checked_add(1)`.
  3. Format and serialize the envelope into a bounded buffer (< 16 KiB).
  4. If serialization or subsequent file operations (`open`, `write_all`, `\n`, `sync_data`) fail, the sequence is NOT reused. It remains consumed, generating an observable gap on future writes.
  5. On overflow (`seq == u64::MAX`), the writer permanently fails closed.
- **File Safety & Permissions**:
  - Target path: `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`.
  - **Parent Directory Enforcement**: Verified before opening. If parent is missing, a symlink, not a directory, or not exact mode `0700` owned by effective UID/GID, writer refuses with `EventWriteError::ParentPathRejected`. Writer **never** creates, repairs, or chmods parent.
  - **File Open Flags**: `O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC | O_NOFOLLOW` with mode `0600`.
  - **Pre-existing Target**: If the file exists, `fstat` verifies it is a regular file owned by effective UID/GID with exact mode `0600`. Non-`0600`, non-regular, or symlink targets are rejected with a typed error; writer never chmods or repairs the file.
  - **Sync**: `file.sync_data()` is called synchronously under the writer lock before returning success.
## Correlation lifecycle

- Generate an unprefixed UUID v4 before each `attemptStarted`. Automatic attempt begins when a candidate enters arm/final-admission flow; manual attempt begins when the coordinator receives the command. Internal numeric sampler request IDs stay internal.
- Store it in one `AttemptContext`; reuse unchanged for arm, final check, handoff, helper dispatch/outcome, and reconciliation.
- Set `SuspendWithRtcWakeRequest.request_id` to the UUID string. Manual API response returns that same value. Do not generate `epoch-N` or `manual-<uuid>` after cutover.
- Revisions/epochs are evidence only. Never join on timestamp, epoch, revision, PID, or proximity.
- Restart abandons in-memory attempts. New `coordinatorStarted` identity plus an open prior chain creates a restart boundary; collector never synthesizes completion.
- Legacy `epoch-N` automatic IDs are `legacyAmbiguous`; legacy manual IDs join only within records whose exact validated ID matches. Never join legacy automatic chains across process restarts.

## Helper audit v2

Keep `HelperAuditRecord` readable for legacy lines. New fields are optional for legacy deserialization but required on every newly emitted line: `auditSchemaVersion: 2`, `timestampMs`, `bootId`, `producerInstanceId`, `producerSequence`, `requestId` when safely parsed, `protocolVersion`, peer numeric PID/UID, wake seconds when relevant, closed `reasonCode`/`outcomeCode`; restricted `detail` may remain only for old record compatibility and is never copied into bundles.

Record types: existing `acceptedIntent`, `executionCompleted`, `executionRejected`; additive `requestRejected`, `capabilityResult`, `preflightResult`, `rtcProgrammingResult`, `suspendInvoked`. Capability requests have no action correlation unless protocol already carries a validated request ID; do not invent one. Authentication/frame failures use null correlation plus a safe reason.

Ordering and durability:

1. authenticate, decode one bounded v1 frame, validate, dedupe;
2. emit rejection/capability/preflight semantic record when safe;
3. persist and `sync_all` `acceptedIntent` before RTC mutation; failure returns execution failure and invokes no backend;
4. emit RTC result; invoke fixed suspend only after success;
5. emit `suspendInvoked` immediately before backend call;
6. capture real backend outcome; attempt `executionCompleted` afterward;
7. post-action write failure cannot change the response/outcome; expose sequence gap/restricted stderr only.

## Source matrix and completeness

Each source has `collectionStatus` (`available`, `missing`, `permissionDenied`, `authRequired`, `malformed`, `truncated`, `retentionLimited`, `notApplicable`, `unsupported`, `ioError`), `historicity` (`historical`, `latest`, `nonHistorical`), `applicability` (`applicable`, `notApplicable`, `unknown`), `requiredForHistoricalCompleteness`, record/byte/malformed counts, truncation/retention/rotation/drop indicators, requested-window coverage with proven start/end or `coverageUnknown`, and typed errors. `records: []` is allowed only with a successfully readable `available` source; unknown role, applicability, or coverage is partial evidence, never an empty success.

| Source | Server/Both root | Server/Both non-root | Web role | Historicity |
| --- | --- | --- | --- | --- |
| serverEvents, serverAudit, diagnosticEvents | required attempt | required attempt | `notApplicable` | historical |
| helperAudit v1/v2 | required attempt | `permissionDenied`, partial | `notApplicable` | historical |
| API/helper journals and unit lifecycle | required attempt | required attempt if readable | `notApplicable` | historical |
| protected idle status | best effort | best effort | `notApplicable` | latest |
| proc/netlink, RTC, inhibitor, socket/PID/enrollment probes | best effort | best effort/permission-explicit | `notApplicable` | nonHistorical |

`completeness = complete` only when host role is known and every applicable required historical source is available, supported, within the requested 60-minute window and all record/byte bounds, and has no malformed tail, unknown version, unexplained sequence gap, producer drop, rotation, or retention loss. Coverage is proven only from the requested interval, accepted timestamps, producer boot/sequence evidence, and available unit invocation/retention evidence; a newest record alone never proves coverage. Otherwise `completeness = partial` with reason codes. Latest/current failures stay visible but do not alone downgrade historical completeness. EUID is sampled once: root attempts helper evidence; non-root never invokes sudo, setuid helpers, or other escalation and marks root-only sources `permissionDenied`.

Exit `0`: safely written bundle with historical completeness `complete`. Exit `2`: safely written valid partial bundle. Exit `1`: no safely written valid bundle. Exit `0` or `2` prints exactly one absolute path plus newline; exit `1` prints no stdout. All bounded diagnostics use sanitized stderr.
Output uses a no-follow exclusive temporary file in the final trusted directory, applies `0600`, flushes and syncs the file, atomically renames it, then syncs the directory. Output directories are trusted, mode `0700`, and have no symlink traversal.

## Bundle v1 and bounds

Top-level keys: `bundleSchemaVersion`, `bundleId`, `generatedAtMs`, `collectorVersion`, `request`, `completeness`, `bounds`, `host`, `idleStatus`, `events`, `serverAudit`, `helperAudit`, `diagnosticEvents`, `journald`, `systemd`, `currentHostProbes`, `correlations`, `privacy`, `errors`.

- Window: `[collectionStartMs - 3_600_000, collectionStartMs]`; capture the clock once.
- Fixed internal limits: 10,000 accepted records per record source; 8,388,608 final JSON bytes including syntax; 16 KiB JSONL line; 16 MiB file scan per source; 2 MiB stdout for every fixed host command and journal/unit query; 256 KiB local API body; 512 bytes per retained redacted text string; 256 source errors; 32 warning/probe examples; 10,000 items for every record or correlation array; 512 bytes per serialized string; maximum nested DTO depth eight; and five-second fixed command/API deadlines.
- Closed DTOs have no generic maps. Enforce every array, string, nested record, and command-output bound before allocation. There are no public cap or path flags.
- The fixed source metadata comparator table above is the sole authority for product-controlled ancestor directories; host anchors use its structural-only rule. Source files are read-only/no-follow.
- Projection occurs before sizing and serialization. Immutable top-level metadata/privacy manifest and required systemd identity/lifecycle metadata for retained endpoint records are never evicted; ancillary `systemd` and `journald` records are evictable.
- If final JSON exceeds 8,388,608 bytes, repeatedly evict one whole non-endpoint record in this global order: ancillary `journald`, ancillary `systemd`, backend diagnostics, compatibility server audit, semantic server events, then helper audit. Within a source priority use `(timestampMs, producerInstanceId, producerSequence, sourceName, sourceOffset)`; source priority precedes the tuple. Protect `attemptStarted`, `terminalRejected`, `reconciliationCompleted`, `helperRequestDispatched`, `helperOutcomeReceived`, `acceptedIntent`, `executionCompleted`, and `executionRejected` while any non-endpoint record remains. If only endpoints remain, evict them under the same order. Mark every affected source `truncated`, recompute correlations after each reduction, and never byte-slice JSON.

`correlations` contains deterministic `chains`, `orphans`, `sequenceGaps`, and `restartBoundaries`. Join exact UUID only, preserve source offset, and order by `(timestampMs, producerInstanceId, producerSequence, sourceName, sourceOffset)`. Open chain, orphan helper intent/completion, dispatch without outcome, duplicate sequence/ID, boot/producer change, malformed/rotated source, and legacy ambiguity are evidence discontinuities, not diagnoses.

## Privacy mapping

| Input | Bundle projection |
| --- | --- |
| UUID action/producer/boot/invocation IDs | retain after strict syntax/length validation |
| PID/UID/MainPID/status/counts/revisions/durations | retain bounded numeric/closed values; never resolve argv/env |
| server audit `actor` | omit; emit `actorPresent: true/false` only |
| helper `detail`, `SuspendOutcome` free text | map exhaustively to closed code; unknown becomes `restrictedDetailOmitted` |
| inhibitor `who/why/description` | omit; retain count/presence and closed result |
| journal `MESSAGE` and stderr | omit; retain fixed unit, priority, timestamps, boot/invocation ID, exit/result codes |
| backend diagnostics | exclude terminal sources/tails; re-redact allowed bounded message/fields and label text untrusted |
| proc/netlink/socket evidence | retain support/result/counts and a strictly validated safe executable identity: literal case-sensitive basename, or normalized absolute path of 1–256 UTF-8 bytes with components limited to ASCII letters, digits, `_`, `-`, `.`, `+`, and `@`; reject controls, NUL, whitespace, glob/regex or shell metacharacters, relative slash-containing paths, traversal, repeated/trailing `/`, and generic interpreter basenames; omit addresses, inode/cookie, payload bytes |
| tokens/credentials/Authorization/cookies | omit without replacement |

One shared bundle projector applies before sizing and serialization. Typed source errors never embed `io::Error`, command stderr, paths outside the fixed allowlist, or source line text.

## Collector architecture

Create focused modules under `server/src/linux_release/diagnostics/`: `model.rs`, `collector.rs`, `file_sources.rs`, `host_commands.rs`, `local_api.rs`, `host_probes.rs`, `correlation.rs`, `redaction.rs`, `output.rs`. No generic plugin registry. `CollectorAdapters` holds narrow fixed seams: `Clock`, `EuidProvider`, `ReadOnlyFileSystem`, closed-enum `HostCommandRunner`, `LocalIdleStatusClient`, and `CurrentHostProbeReader`; tests supply fakes/temp paths.

`HostCommand` is closed: show exact API/helper unit properties, journal exact API/helper unit for the fixed window, list inhibitors. Production compilation sets executable/argv, null stdin, locale `C`, timeout, and stdout cap. No shell or user interpolation. Local API uses fixed loopback URL, bounded response, no redirects, fixed auth-file lookup, and never external egress.

Collection order: capture clock/EUID/role and bounds; attempt each applicable source independently; parse/project; correlate; enforce final cap; write atomic output; return exit class. A source failure never prevents other collection. Output failure is the only collector-fatal class after model construction.

## Validation and rollout invariants

Automated checks use temp directories, fake clock/EUID/commands/API/host probes/helper backends. They never touch real RTC, suspend, systemd service state, production audits, or configuration. One read-only Linux target-host smoke runs only after deterministic and architecture gates; it proves file mode, valid JSON, path-only stdout, role/source metadata, and unchanged before/after RTC/service/audit metadata.

Roll forward is additive: protocol v1 and existing audit files remain readable; no systemd unit or observer is added; only a new collector may claim historical completeness. Compatibility is explicit:

| Server | Helper | Collector | Result |
| --- | --- | --- | --- |
| old | old | new | Partial: legacy timing/manual and helper v1 records may be projected; absent canonical streams/milestones prevent complete. |
| new | old | new | Partial: server semantic events join established helper v1 records; missing helper v2 milestones prevent complete. |
| old | new | new | Partial: helper v2 records remain visible; absent server semantic chain prevents complete. |
| new | new | old | Partial: old reader keeps established records and ignores additive streams; it cannot claim the v1 bundle contract complete. |
| new | new | new | Complete only when every applicable required source, coverage interval, and gap gate passes. |

Mixed-version, restart, rotation, malformed, and dropped evidence always remain partial. Legacy automatic `epoch-N` IDs never join across producer restarts; legacy manual IDs join only on an exact validated ID. A manual API response returns the same UUID used as `correlationId` and helper protocol-v1 `requestId`; it never creates a `manual-<uuid>` alias. Older readers may ignore additive helper-v2 milestones while retaining existing action names and fields. Rollback stops new emission and collector use but never deletes evidence; withdrawing this approval reverts only the planned collector subsection. Phase 02 canonical event foundation is implemented; coordinator/helper instrumentation, collector implementation, and rollout remain pending. Architecture, security, and release-owner approval is complete.

## Unresolved questions

None for the frozen contract or Phase 02 foundation. Phase 03 must validate coordinator emission and later phases must validate helper evolution, collection, correlation, redaction, bounded output, and mixed-version rollback before any collector can claim historical completeness.