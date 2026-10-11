# Phase 02 — Process retention and semantic freshness

## Context links
- [Overview](plan.md); [Phase 01 admission consumer](phase-01-coordinator-admission-and-cooldown.md).
- [Original managed inventory/semantic contract](../261010-1746-host-resources-auto-sleep/contracts.md#scope-and-enablement).
- [Architecture](../../docs/system-architecture.md#semantic-agent-free-automatic-sleep); [agent-status contract](../../docs/architecture/agent-status.md); [code standards](../../docs/code-standards.md#agent-status).

## Overview
- Date: 2026-10-11. Priority: P1. Estimated effort: 10h.
- Implementation: complete. Review: complete. Validation: passed.
- Issues: **4** live retained workers disappear from semantic inventory when their agent parent exits; **5** wall-clock rollback extends semantic leases; **6** same PID/start-ticks evidence survives executable/provider replacement.

## Key Insights
- Discovery retains all relevant living identities (`process.rs:1174–1185,1337–1365`) but publishes `matched_agents` from recognized executable matches only (`1604–1618`). A nonmatching orphan worker can remain in `process_evidence` while reducer's empty-match shortcut (`1706–1720`) incorrectly returns Free.
- Descendants of retained non-agent survivors are traced for terminal attribution (`1215–1245`) but relevant-process closure currently extends only retained **matched agents** (`1342–1359`). New grandchildren of an orphan worker need the same retention coverage.
- `ProcessImageKey` already records `(exe_dev, exe_ino, entrypoint_token)`; reducer compares only exact PID/start ticks (`1756–1805`). `exec` preserves these process identity values.
- Lease evaluation uses `now_ms.saturating_sub(last_report_time_ms)` (`1819–1822`); rollback makes old evidence appear age zero. Report admission and sweeper also use this predicate (`929–930,1231–1235`), so fixing evaluation alone is insufficient.
- Runtime receives wall-clock timestamps at report/hook admission and lease sweeps. Preserve wire display timestamps while introducing one real monotonic authority for all lease predicates.

## Requirements
### Functional
- Complete zero-agent/Free is valid only when no recognized managed agents **and no unresolved live retained agent-lineage survivors** remain.
- Retain worker/subagent scope through shell/tab/agent exit, reparenting and child creation until exact validated exit; no host-wide agent discovery.
- Every semantic Free decision uses a current monotonic lease and server-verified process image/provider binding.
- Same PID/start ticks with changed executable device/inode or script entrypoint, provider mismatch, missing proof, or uncovered descendant yields Unknown; existing evidence cannot silently rebind.
- Lease expires at exactly 15,000ms. Rejected, duplicate/stale, disconnected or otherwise non-authoritative events do not renew it.
- Keep native providers fail-closed after lease expiration; no cached-heartbeat renewal, synthetic Idle, or CPU/output inactivity inference.
### Non-functional
- Preserve existing root/relevant/process-scan bounds, sorted/deduplicated output, transactional prepare/commit and sanitized diagnostics.
- Avoid per-process image I/O under runtime locks; read bounded proof off-lock and validate generation/incarnation on commit.
- Public badge DTOs, attention semantics and historical timestamps remain compatible; new image/time evidence is private.

## Architecture
### Retained survivor coverage
Keep `matched_agents` truthful: do **not** rename a generic worker into a recognized executable or manufacture a dead parent entry.

- Extend private `ProcessSample` with `uncovered_retained_processes: Vec<RetainedManagedProcess>` containing exact identity, terminal/incarnation and image key. Reuse retained attribution; no global enrollment.
- Expand relevant closure from every living retained process, including non-agent survivors, so newly spawned descendants remain scoped and are retained in the next committed sample.
- After building matched-agent closures, compute uncovered relevant identities: relevant retained lineage minus the union of live recognized agents and their current descendant closures. Sorted unique residuals become uncovered retained evidence.
- Reducer evaluation consumes the **complete semantic inventory** (matched + uncovered); any residual lacking independent verified authority returns Unknown before the empty-match Free shortcut. Use existing unresolved-owner/subagent block reasons with sanitized public projection; a generic live worker is not Free simply because it is no longer named `omp`.
- If a recognized agent still owns a covered child closure, retain existing semantic coverage rules. Independent recognized subagents still require their own valid evidence; sharing a terminal row cannot authorize unrelated processes.
- Zombie/dead/PID-reused identities retire only after current exact-identity checks; read failures/deadlines degrade inventory rather than remove uncertainty. Ordinary shells never previously in agent lineage remain outside residual coverage.

### Monotonic lease authority
Add private `last_report_at: Instant` (or lease deadline) to reducer. Keep `last_report_time_ms`/`observed_at_ms` only for displayed observations. Sample `Instant` and epoch time together at accepted server ingress; propagate both explicitly to reducer constructors/reconnect/report/hook APIs.

- All authority checks use `now.saturating_duration_since(last_report_at) >= Duration::from_millis(lease_ms)`; check expiry before accepting a renewal.
- Evaluation, sweeper and report admission share that predicate. `min_lease_remaining_ms` derives from the same monotonic deadline with checked/saturating duration conversion; at/past deadline it is never Free.
- Only genuinely accepted current evidence advances `last_report_at`; preserve existing sequence/event dedupe and reporter epoch fences. Disconnect/retirement invalidates authority immediately.
- Update registry/runtime test-time seams to accept explicit monotonic instants; migrate wall-time-only lease helpers and every test/caller. No wall-clock fallback or parallel lease implementation.
- Phase 01 stores the returned generation and validates live lease again at dispatch, including when sweeper has not yet run.

### Executable/provider binding
Add a small private `VerifiedAgentProcessBinding` near existing agent-status private types:

`{ identity: ProcessIdentity, image_key: ProcessImageKey, safe_executable_identity: Option<String>, agent_kind: AgentKind }`.

- Capture proof only on the server, after existing TCP peer/UDS credential/PTY ancestry verification. Reuse `ProcessSource`, bounded matcher/entrypoint extraction and pre/post identity validation in `activity/process.rs`; do not duplicate JavaScript entrypoint parsing or trust a reporter-supplied image key.
- Capture image metadata before and after inspection; reject unstable/missing image or start ticks. Device/inode alone cannot distinguish two scripts under the same Node interpreter: include sanitized entrypoint token already used by discovery.
- Pass proof separately from untrusted `ReporterHello`/`PrivateHookEnvelope`; no client wire field grants authority. Unverified admission may still produce its existing public badge, but cannot authorize automatic sleep.
- Reducer stores binding for the owner epoch. At evaluation require exact process + terminal/incarnation + provider kind + safe executable identity + full image key equality with current discovery.
- A matching configured executable with unsupported/unknown provider mapping remains Unknown; do not invent aliases that let an OMP row cover Codex/Claude or arbitrary executables.
- Native hook acceptance gets newly OS-verified proof with its accepted observation. OMP reconnection may establish a new epoch/proof; ordinary same-socket heartbeat cannot replace an old image binding. Missing/replaced proof clears authority and increments non-free generation when owner evidence mutates.
- Shared locked evaluation interface used by Phase 01 accesses only stored proof and fresh sample, with no procfs I/O while locked.

## Related code files
| Action | File and researched lines | Purpose |
|---|---|---|
| Modify | `server/src/idle_suspend/activity/process.rs:35–47,796–957,974–981,1174–1245,1316–1479,1604–1637` | Shared bounded image capture and retained residual/descendant closure |
| Modify | `server/src/idle_suspend/activity/mod.rs:283–298` and `ProcessSample` declaration | Private residual inventory and reusable image/proof types |
| Modify | `server/src/agent_status/reducer.rs:47–82,86–185,311–381,773,902–983,1231–1258,1451–1477,1659–1675,1706–1889` | Monotonic lease mutation/expiry and complete inventory/provider/image validation |
| Modify | `server/src/agent_status/runtime.rs:461–526,597–705,775–817` | Off-lock proof capture handoff, explicit lease clocks and locked final evaluation |
| Modify | `server/src/agent_status/types.rs` | Private verified-image binding and typed Unknown reasons, only if existing reasons cannot express failure |
| Modify | `server/src/agent_status/collector.rs:613–749,819–828` | OMP OS proof includes stable image, not PID alone |
| Modify | `server/src/agent_status/hook_ingress.rs:155–344` and runtime hook caller(s) found by references | Extend existing native verification with server image proof |
| Modify | `server/src/idle_suspend/coordinator.rs:1634–1664,2681–2693` | Pass complete inventory and monotonic evaluation time |
| Modify | `server/src/agent_status/tests.rs:2172–2470`, `server/tests/agent_status_runtime.rs`, `server/tests/agent_status_hooks.rs`, `server/tests/agent_status_integration.rs` | Image/time/ownership regressions; migrate constructors and time seams |
| Modify | Colocated `activity/process.rs` discovery tests (`1659+`) | Parent exit, orphan grandchildren, exit/procfs-limit coverage |
| Modify | `docs/system-architecture.md:236–261`, `docs/architecture/agent-status.md`, `docs/terminal-idle-suspend-security.md`, `docs/CHANGELOG.md` | Correct semantic completeness, monotonic freshness, image authority |

No new provider adapter, host-wide inventory or long-lived state store. No production file deletion; remove superseded wall-clock authority predicates rather than keep compatibility shims.

## Implementation Steps
1. Locate every `ProcessSample`/matched evidence constructor, all reducer ingress methods and all runtime lease helper consumers. Freeze complete-inventory signature and proof/time types with Phase 01.
2. Expand retained survivor closure; produce residual coverage evidence transactionally in `prepare_sample`, publish only in `commit_sample`, and update change detection as needed when coverage/image changes.
3. Change reducer empty-inventory semantics and unresolved-survivor evaluation. Preserve recognized executable counts separately from unresolved coverage counts; do not label unknown worker count as zero.
4. Add monotonic private lease timestamps. Migrate constructors, reconnect, hook/report acceptance, sweeper, evaluator and runtime/test seams in one clean cutover. Keep epoch display data intact.
5. Extract the minimal existing bounded image capture helper for discovery/ingress reuse. Verify pre/post metadata/identity and interpreter entrypoint; capture only in verified managed ancestry.
6. Store and compare full provider/image binding at owner admission/evaluation; invalidate on replacement. Maintain original sequence, capability, reporter epoch and native turn fences.
7. Add regression matrix below using explicit domain instants and real/procfs-fixture process identities. Add a coordinator-level assertion that residual workers block dispatch through the integrated sample.
8. Update existing docs/changelog after implementation, removing claims that PID/start ticks alone proves current executable. Parent runs gates after integration.

## Todo list
- [x] Preserve residual retained workers and their newly spawned descendants.
- [x] Make semantic zero-inventory Free require complete absence of residual scope.
- [x] Replace all wall-clock authority predicates with monotonic lease checks.
- [x] Capture private stable executable/provider proof at verified ingress.
- [x] Validate image/provider binding and extend unit/integration documentation coverage.

## Success Criteria
| Regression | Required observable result |
|---|---|
| Managed agent exits; non-agent worker survives/reparents | Complete sample retains survivor; evaluator Unknown, zero helper dispatch |
| Shell/terminal retires while worker survives | Same blocker until exact validated survivor exit; stale terminal row cannot prove Free |
| Orphan worker creates a grandchild | Both remain scoped through next samples; no loss at original-parent exit |
| Survivor exits / PID reused / becomes zombie | Exact old identity retired; Free only after complete qualified absence |
| Ordinary zero-agent managed shell, no retained lineage | Genuine empty inventory Free remains valid |
| Idle report at epoch T, epoch rolls backward, monotonic age reaches 15s | Evaluation Unknown at 15s without requiring a sweeper; report admission rejects expired authority |
| Same-state genuine renewal at <15s | Monotonic lease extends; free interval/attention semantics unchanged |
| Duplicate/stale/rejected event | No lease extension or executable rebinding |
| Same PID/start ticks changes inode/device or Node entrypoint | Old Idle evidence rejected as Unknown until new verified owner evidence |
| Claimed provider disagrees with current matched executable | Unknown for both OMP and native paths, including custom unmatched provider mapping |
| Stable verified identity/image/provider and fresh Idle/Blocked | Free with bounded remaining lease and current generation |
| Procfs failure, unstable image, scan cap/deadline | Degraded/Unknown, never qualified zero agents |

Main-agent commands after integration: `cargo test --manifest-path server/Cargo.toml --lib agent_status`; `cargo test --manifest-path server/Cargo.toml --lib process`; relevant `--test agent_status_runtime`, `--test agent_status_hooks`, `--test agent_status_integration`; then full server suite. Planner runs none. Explicit `Instant` inputs make rollback tests deterministic without real sleeps.

## Risk Assessment
- **Overblocking:** marking every managed shell Unknown would regress clean boot. Residuals come only from previously qualified recognized-agent lineage, not generic ancestry.
- **Retention churn:** union/dedup must handle nested agent closures and reparented workers without duplicating counts. Use existing bounded identity maps/sets; stable sorted output.
- **Clock migration scope:** missed sweeper/admission predicates could resurrect expired reporters. Migrate all `last_report_time_ms` authority consumers, retaining display-only uses deliberately.
- **Provider/image drift:** updater/exec changes can cause legitimate Unknown. Require a new verified owner/report baseline; do not silently bind old Idle authority to a new program.
- **Lock coupling:** existing runtime acquires reporter/credential/registry locks. Keep OS reads outside and respect Phase 01 presence → PTY → registry admission order.

## Security Considerations
- PID and start ticks are lifetime identity, not executable identity; validate image and interpreter entrypoint before authorizing host-wide effects.
- Only SO_PEERCRED/TCP socket association plus exact managed ancestry creates trusted binding; client assertions, generic Node identity and terminal capability alone do not.
- Image metadata remains private; never log raw argv, environment, native session paths or prompts. Reuse sanitized Debug/status reasons.
- Lease rollback cannot restore authority; missing monotonic evidence fails closed. Native hooks still lack continuous keepalive qualification.

## Next steps
Provide Phase 01 complete semantic inventory, original-generation and monotonic-remaining-lease contracts. Integrate final dispatch lease recheck before backend verification. Phase 04 fixtures must not fabricate native three-hour Idle evidence.

## Unresolved questions
None blocking these fixes. Sustained authoritative native-provider refresh remains a separate original feature qualification, not solved by extending leases.
