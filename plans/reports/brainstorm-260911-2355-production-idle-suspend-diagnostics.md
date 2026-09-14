# Production idle-suspend diagnostics and AI handoff

## Problem

The configured-agent idle-suspend feature is a production activity heuristic. A later incident may be caused by policy state, activity qualification, PTY/process attribution, TCP observation, coordinator admission, helper IPC/authentication, RTC programming, suspend execution, service restart, or post-resume reconciliation. The current status endpoint is latest-only and the current diagnostics export does not include the idle-suspend audit chain or systemd evidence.

A second observer service would infer transitions from the outside, duplicate coordinator logic, require its own lifecycle and permissions, and could disagree with the authoritative action owner. It is unnecessary for the selected manual-on-failure workflow.

## Agreed requirements

- **Invocation:** host CLI, proposed command `dam-hopper diagnose --json`.
- **Trigger:** manual after an operator observes a failure or suspicious result.
- **Output:** one machine-readable JSON file; stdout prints only the resulting file path for later AI attachment.
- **Evidence:** full idle-suspend stack: server/coordinator, helper, protected status, selected systemd journals, service state, RTC/inhibitor state, and current proc/netlink qualification probes.
- **Privilege:** explicit root invocation for a full bundle, e.g. `sudo dam-hopper diagnose --json`. No automatic sudo. Non-root invocation may produce a valid partial bundle with an explicit unavailable helper source.
- **Retention:** bounded defaults, with explicit source truncation and retention metadata.
- **Acceptance:** reconstruct one incident end-to-end, not heuristic automatic root-cause classification.
- **AI handoff:** local file only. No automatic upload, external API, AI credential, or network egress from the collector.

## Current implementation evidence

- `server/src/idle_suspend/status.rs`: authoritative idle status is latest-only, in-memory, and watch-channel published. The WebSocket `host:idleSuspendChanged` message is a revision hint, not history.
- `server/src/idle_suspend/coordinator.rs`: automatic flow moves through watching, armed, final-check, handoff, and outcome, but automatic attempts/outcomes are not durably recorded as a server chain. Manual flow has server audit records.
- `server/src/idle_suspend/server_audit.rs`: mode `0600`, `O_NOFOLLOW`, synchronized JSONL audit for timing/manual operations. Missing files return empty and malformed lines are silently skipped by current readers.
- `server/src/idle_suspend/audit.rs`: root helper audit is mode `0600`, bounded, synchronized JSONL with accepted intent, execution completion, and rejection records keyed by request ID. Capability probes are not audited. Optional details may contain sensitive operational text and must not be copied raw into an AI bundle.
- `server/src/diagnostics/`: bounded redacted backend diagnostics exist, but the existing export does not include idle status, server/helper audits, or journald. Terminal output must be disabled for this feature.
- `server/src/bin/dam-hopper.rs` and `server/src/linux_release/cli.rs`: status JSON reports manager/service state, but no idle-suspend diagnosis command exists.
- The automatic helper request ID currently uses `epoch-N`; it is ambiguous across API restarts. Manual IDs use UUIDs.

## Evaluated approaches

### Recommended: producer-owned events plus one-shot CLI

The existing API coordinator and helper write typed semantic events at authoritative action boundaries. A one-shot CLI reads known sources, redacts and bounds them, correlates the records, writes an atomic `0600` JSON file, and exits.

**Advantages:** authoritative transition semantics; no resident process; no duplicate state machine; works when the web UI is unavailable; local and auditable; small operational surface.

**Costs:** requires filling the current automatic server-audit gap; explicit root is needed for the root helper audit; source rotation, malformed records, and service restarts must be represented as incomplete evidence.

### Rejected: separate observer daemon

Adds a service, lifecycle, upgrade path, permissions, retention, attack surface, and another interpretation of the same state. It cannot reliably recover a transition that the producer never recorded.

### Rejected for v1: continuous telemetry, alerts, or external upload

Useful for fleet trends, but outside the selected incident-reconstruction requirement. It adds storage, privacy, network, compliance, credential, and prompt-injection risks. It also creates a new production dependency for a feature whose default policy remains conservative.

### Insufficient alone: API-only diagnostics export

The API can be unavailable or unauthenticated during an incident. The endpoint exposes current/latest state, not the complete helper handoff, preflight, RTC, or post-resume history. It remains an optional source, not the collector architecture.

## Final recommended architecture

### A. Canonical event records in existing action paths

Add a typed, bounded idle-suspend event envelope to the existing server audit/diagnostic path. Emit only semantic transitions, admission decisions, and failures; do not emit every one-second sample.

Every action-related event should contain:

- `eventSchemaVersion`
- `timestampMs`
- boot/producer instance identity
- monotonic producer-local sequence number
- closed `eventType`
- `correlationId` when action-related
- `mode` (`automatic` or `manual`) when applicable
- bounded typed event data
- status/activity/timing revisions and fleet generation where relevant

Use one globally unique `correlationId` from candidate creation through helper completion. Reuse it as the helper wire request ID. Revisions and epoch values remain evidence, not identity.

Suggested server events:

- coordinator started
- automatic/manual attempt
- arm started / arm cancelled
- measurement unavailable / recovered
- final check started / completed
- handoff claim accepted / rejected
- helper request dispatched
- helper outcome received
- reconciliation completed
- manual rejection and terminal outcome

Suggested helper events, in addition to preserving the authoritative root audit:

- request rejected
- capability/preflight result
- durable intent
- RTC programming result
- suspend invoked
- suspend returned or execution failed

Record closed reason codes, bounded counts, generations, and revisions. Never record process arguments, environment values, terminal bytes, tokens, socket addresses, raw IPC frames, or unbounded stderr. Inhibitor and systemd failures should be represented by typed/sanitized codes, not raw identity/detail strings.

### B. One-shot diagnostic collector

The CLI reads, without mutating, only an allowlist of sources:

- current protected idle-suspend status, if API authentication succeeds
- server idle-suspend audit/event JSONL
- root helper audit JSONL
- bounded redacted backend diagnostics
- API and helper systemd journal records
- API/helper unit state, `MainPID`, `ExecMainStatus`, `InvocationID`, and boot identity
- socket/PID/enrollment evidence
- RTC wakealarm, suspend capability, and inhibitor snapshots
- current proc/netlink qualification probes, clearly marked non-historical

The collector must use fixed commands/APIs and fixed paths; it must never run a shell or arbitrary operator-supplied command. It must not compact, repair, or truncate source logs.

It writes a temporary file in the destination directory, applies mode `0600`, atomically renames it, and prints the final path only on stdout. Diagnostic errors go to stderr.

### C. Bundle contract

Top-level sections:

- `bundleSchemaVersion`, `generatedAtMs`, `collectorVersion`
- `request`: bounded window and requested source scope
- `completeness`: `complete` or `partial`, with a per-source status
- `bounds`: record/byte/window limits and truncation flags
- `host`: boot identity and safe platform/service metadata
- `idleStatus`: latest protected snapshot, if available
- `events`: canonical server/helper semantic events
- `serverAudit`
- `helperAudit`
- `diagnosticEvents`
- `journald`
- `systemd`
- `currentHostProbes`: explicitly non-historical
- `correlations`: joined chains, orphan records, sequence gaps, and restart boundaries
- `privacy`: applied redaction policy and excluded categories
- `errors`: source-specific collection failures

Each source must have an explicit status such as `available`, `missing`, `permissionDenied`, `authRequired`, `malformed`, `truncated`, `retentionLimited`, or `notHistorical`. Missing evidence must not be serialized as an indistinguishable empty array.

Initial bounded defaults should align with existing retention: last 60 minutes, no more than 10,000 records per audit source, and an 8 MiB final bundle. Every cap is configurable only within a hard maximum and is reported in `bounds`.

Suggested exit semantics:

- `0`: bundle written and required sources complete within bounds
- `2`: valid bundle written but one or more sources are unavailable, malformed, rotated, dropped, or truncated
- `1`: bundle could not be safely written

A non-root run may return `2` while still printing a usable partial bundle path. Full evidence requires explicit root execution.

## Scope boundary

### In scope

- Durable semantic tracking for existing coordinator/helper action paths.
- A bounded, redacted, versioned one-shot host CLI collector.
- Correlation, orphan/gap detection, source completeness, and atomic local file output.
- Tests for successful and failed automatic/manual chains, restart boundaries, malformed/permission-denied sources, caps, redaction, and partial results.
- Operator/API/security documentation for invocation and AI handoff.

### Explicitly out of scope

- A second observer daemon or polling service.
- Continuous fleet telemetry, dashboards, alerting, or automatic incident detection.
- Automatic upload to an AI provider or support service.
- Terminal scrollback, raw PTY bytes, command lines, environment variables, credentials, tokens, raw socket data, or unbounded helper/journal detail.
- Claiming that the heuristic proves work completion or that a final polling sample prevents a race.
- Changing the default `empty-fleet` policy or enabling automatic suspend by default.

## Touchpoints

Likely implementation surfaces:

- `server/src/idle_suspend/coordinator.rs`
- `server/src/idle_suspend/server_audit.rs`
- `server/src/idle_suspend/helper_server.rs`
- `server/src/idle_suspend/audit.rs`
- `server/src/idle_suspend/helper_client.rs`, `executor.rs`, and protocol types as needed for correlation/probe evidence
- `server/src/linux_release/cli.rs`
- `server/src/bin/dam-hopper.rs`
- `server/src/diagnostics/` for shared redaction/bounds or collector integration
- server idle-suspend tests and integration fixtures
- deployment paths for fixed helper/API audit and journal sources
- `docs/api-reference.md`, `docs/configuration-guide.md`, `docs/linux-systemd.md`, `docs/terminal-idle-suspend-security.md`, and release/operator documentation

Documentation must be reconciled with actual event coverage; current claims of automatic server audit or detailed coordinator journaling are not yet true in source.

## Acceptance and validation

1. Automatic quiet path produces a durable correlated chain from arm through final check, claim, helper dispatch, helper intent, RTC/suspend outcome, and reconciliation.
2. Automatic rejection paths (recent input/output/network, unavailable measurement, stale generation, active fleet, inhibitor, capability failure) produce a typed terminal event with no private process or command data.
3. Manual records continue to correlate server and helper records by one request ID.
4. API restart, helper restart, audit rotation, malformed JSONL, dropped diagnostic events, and orphan intent are reported as evidence discontinuities rather than false “no activity.”
5. A full root invocation writes a valid `0600` JSON bundle and prints only its path; a non-root invocation reports helper evidence as unavailable without attempting sudo.
6. The collector never changes RTC state, suspend state, service state, audit files, or configuration.
7. Bundle and event caps are enforced; truncation and retention limitations are explicit.
8. Automated checks prove redaction of tokens, credentials, argv/env, terminal data, socket addresses, inhibitor identity, and raw helper/systemd detail.
9. An operator can attach the file to an AI agent and reconstruct one incident without consulting hidden server state.
10. No additional long-running process or systemd unit is installed.

## Risks and mitigations

- **Root helper audit unavailable:** require explicit root for full collection; preserve partial bundles and source status.
- **Event writes add latency:** use bounded append-only writes outside coordinator locks where safe; never make a safety-critical mutation proceed after a required durable audit failure.
- **Event volume growth:** semantic events only, hard record/byte caps, existing retention alignment.
- **Sensitive error details:** typed closed reason codes and shared redaction before bundle serialization; preserve raw restricted audit only at its authoritative source.
- **False reconstruction after restart:** globally unique correlation IDs, boot/producer identity, sequence numbers, and explicit orphan/gap reporting.
- **Current-state confusion:** label API/status and host probes as latest or non-historical; never present them as incident-time facts.

## Success metric

For a manually reported production incident, one bounded local JSON file can show what the existing authoritative components decided, which evidence was available at each boundary, where the action stopped or succeeded, and which evidence is missing—without adding a resident observer or leaking private workload data.

## Next step

Create a detailed implementation plan for this bounded instrumentation and one-shot collector, then execute it as a separate feature phase after reviewing the exact event schema and source-access contract.
