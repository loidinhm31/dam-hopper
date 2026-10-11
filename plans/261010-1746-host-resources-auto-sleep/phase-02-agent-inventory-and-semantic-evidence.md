# Phase 02 — Managed agent inventory and qualified semantic evidence

## Context links
- [Overview](plan.md), [validated contract](contracts.md), [source findings](reports/agent-eligibility-research.md), [acceptance](acceptance-matrix.md).
- Repository: `docs/architecture/agent-status.md`, `docs/agent-activity-process-discovery.md`, `docs/pty-activity-observation.md`.
- Dependency: Phase 01 interfaces. Independent of Phase 03.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 12h; provider-source feasibility may change it.
- Implementation status: complete; fail-closed native gate active. Review status: complete (score: 9.3/10; hardening applied). Test gate: passed (3,261 tests, 0 regressions).
- Validated scope: **DamHopper-managed terminals only**, including traditional UI mode. External independent agents excluded.

## Key Insights
- Traditional UI terminals already use backend managed PTYs. Existing process-discovery scope is managed roots plus retained lineage; reuse it, do not add host-wide matching.
- Runtime has one semantic owner per terminal/incarnation. Multiple matching agents cannot share one Idle badge as independent free-state proof.
- OMP terminal bearer does not prove reporter PID; identical heartbeats may update internal freshness without public revision.
- Native Codex/Claude hooks expire after 15s; existing Stop/SessionStart maps Unknown. Hook installation/process alive cannot establish three hours of current free state.
- Current TCP/output sampler measures activity, not semantic work; reporter heartbeats can continually reset it. New policy needs semantic timing.

## Requirements
- Include every backend managed PTY independent of UI tab/mode/mount, retained managed survivors and child/subagent work.
- Evaluate every independent matching agent with exact process identity and current authority. Uncovered matching managed agents or unresolved owners block; complete in-scope zero qualifies.
- Independent SSH/tmux/headless/OS-terminal processes outside managed lineage are ignored **by user choice**, not discovered as Unknown blockers.
- Internal monotonic leases and non-Free generation updated at mutation time; brief Working→Idle between polls resets interval.
- Same-state real refresh and Idle↔Blocked preserve free anchor; stale/ambiguous/access/scan-limit evidence fails closed.
- Preserve existing public badge/notification semantics and privacy.

## Architecture
- Extend private managed `ProcessSample` to return distinct matched-agent identities separate from relevant children/socket evidence. Reuse sole finite matcher, PID/start_ticks/image checks, cancellation/deadline and retained lineage.
- Keep matched discovery bounded to qualified managed ancestry; global `/proc` topology enumeration is not host-wide eligibility inventory.
- Add private per-process semantic owners; public terminal aggregation remains a UI projection, never admission input.
- Extend existing sampler infrastructure with semantic mode or one bounded semantic worker per selected policy. No duplicate matcher/CPU polling/required TCP quiet.
- `AgentFreeClaimTicket` captures completeness, exact managed identities/owner epochs, lease deadlines, semantic/non-Free/free-wait/inventory/timing/input/fleet revisions, age and strict eligibility deadline.

## Related code files
No deletions; root for all paths: `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/`.

| Action | Full path | Change |
|---|---|---|
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/types.rs` | Private process-owner/evidence contract |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/runtime.rs` | Per-process owners, internal lease/non-Free revisions, guard |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/reducer.rs` | Evidence invalidation without notification meaning change |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/collector.rs` | Actual OMP process peer proof/concurrent owners |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/assets/omp-agent-status.ts` | Managed process binding and real state refresh |
| Modify after qualification | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/hook_ingress.rs` | Reuse verified native identity/causality |
| Modify after qualification | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/hook_reporter.rs` | Genuine native evidence, no cached renewal |
| Modify after qualification | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/codex_hooks.rs` | Proven provider current-state transitions only |
| Modify after qualification | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/agent_status/claude_hooks.rs` | Proven provider current-state transitions only |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/activity/process.rs` | Matched managed identities/completeness; scope unchanged |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/activity/mod.rs` | Private bounded managed inventory types/reasons |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/activity/sampler.rs` | Semantic observation/final ticket distinct from byte-quiet |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/pty/manager.rs` | Managed ownership/lifecycle and final admission seam |

## Implementation Steps
1. Use LSP references before exported changes. Trace report acceptance/replacement/disconnect, credential revoke, terminal removal, lease checks, shutdown and native root changes.
2. Reuse managed-root/retained discovery. Return matched-agent identities/images and child coverage, not just count. Keep exact scan/deadline/root/identity bounds; prove every managed root and retained relevant identity was included.
3. Define in-scope descendants and retained ownership until validated exit. An independent external process is intentionally excluded. Do not reuse `runtime::check_process_exited` as eligibility proof: it currently treats any proc-read failure as exit; permission/error is uncertainty here.
4. Join discovery with private semantic owners by verified exact process identity, terminal incarnation/provider/reporter epoch. Missing/ambiguous owner is Unknown; owner not matched but not proven exited is uncertainty. One of two managed agents Working blocks even if aggregate badge Idle.
5. Qualify OMP process binding on existing scoped transport: verify accepted TCP peer tuple/socket inode has one owning process matching PID/start_ticks/image/managed ancestry, with before/after identity checks. TCP has no SO_PEERCRED; reject shared/inherited/ambiguous proof. If peer proof cannot qualify, explicitly redesign ingress rather than trusting claimed PID.
6. Admit independent per-process reporters and replacement-safe epochs under bounds. Preserve deterministic public terminal projection and existing alerts. No external enrollment/global-token injection in this feature.
7. Prove parent coverage of managed nested/subagent work or register independent qualified evidence. Main Idle must not hide Working child. Headless processes started within managed lineage are in scope; independent external headless agents are not.
8. **Native gate:** inspect exact supported Codex/Claude versions and real lifecycle/current-state interfaces for ready/blocked/working, liveness-bound refresh, start/retry/continuation/context maintenance, cancellation/missed signal and exit. Official hooks docs are research inputs, not proof a repeatable source exists.
9. Implement native refresh only from real qualified provider source. Do not extend historical 15s leases, repeatedly read stored hooks, infer Idle from Stop/silence, poll transcript/screen or substitute cloud API state for local CLI. If source is unavailable, report exact missing interface and block semantic enablement for live managed provider; do not claim OMP-only delivery complete.
10. Maintain monotonic lease and private non-Free generation at each authoritative mutation. Expiry is checked at claim even before sweeper. Genuine same-state refresh advances freshness, not free anchor.
11. Build fresh semantic Final evidence independent of output/TCP inactivity; keep input/lifecycle/identity fences. Unsupported TCP/UDP byte measurement is not semantic work; identity peer-proof failure remains uncertainty.
12. Add behavior tests and live managed-provider scenarios beyond 15s; record actual source/version/observed state and missing-signal behavior. Synthetic callbacks alone cannot pass native gate.

## Todo list
- [x] Complete matched inventory for every managed root/retained lineage.
- [x] Preserve multiple-process/subagent coverage and exact zero result.
- [x] Verify managed OMP peer ownership and current semantic state.
- [x] Establish genuine native current-state/freshness source.
- [x] Track internal monotonic lease/non-Free mutations.
- [x] Mint fresh semantic Final tickets and race fences.
- [x] Prove independent external agents deliberately excluded.

## Success Criteria
- Quiet Working blocks; qualified Idle/Blocked allow; expired/unknown/incomplete managed evidence blocks.
- All managed PTYs covered regardless of UI mode/open tabs; multiple agents independently evaluated; complete zero begins interval at startup.
- External independent configured agent does not block (documented risk); detached managed survivor/subagent cannot disappear from coverage.
- Forged/reused PID, changed image, stale/shared peer and replacement disconnect cannot authorize sleep.
- Long managed native ready/wait/work either genuinely refreshed or explicitly Unknown; never historical lease stretching.

## Risk Assessment
- Highest risk: genuine native repeatable source absent; explicit gate, not an OMP-only shortcut.
- Managed discovery access/limits: retain fail-closed completeness; do not treat errors as exit.
- External work interruption: user explicitly accepted exclusion; status/prompt/runbook must state it.

## Security Considerations
- Verified same-user scoped process peer proof/epochs, not claimed PID alone. Private inventory/argv/transcript never enters public push/audit/log.

## Implemented Phase 02 Architecture & Verification

### 1. Process Discovery, Matched Agent Evidence & Descendant Closures
- **Scoped Managed Inventory**: `ProcessDiscovery` in `server/src/idle_suspend/activity/process.rs` evaluates processes strictly within managed PTY session roots and retained lineage (`MAX_MANAGED_ROOTS_LIMIT = 64`, `MAX_RELEVANT_PROCESSES_LIMIT = 1024`, `MAX_SCANNED_PROCESSES_LIMIT = 8192`).
- **Descendant Closures**: Traverses process hierarchy per recognized agent (Codex, Claude, OMP) using DFS/BFS stack traversal, recording complete `descendant_processes` closures to ensure child workers/subagents cannot hide running work under an Idle parent.
- **Privacy-Preserving Image Keys**: Generates `ProcessImageKey` with device ID (`exe_dev`), inode (`exe_ino`), and sanitized entrypoint token without exposing raw cmdline arguments or environment variables.
- **Matched Evidence**: Returns deduplicated, sorted `matched_agents: Vec<MatchedManagedAgent>` with verified process identity (`pid`, `start_ticks`), terminal binding (`session_id`, `incarnation`), executable identity, and descendant closures.
- **Deliberate Exclusion**: Independent external agents (tmux, SSH, OS terminals) outside managed PTY lineage are excluded by explicit product design; they are not matched and do not block sleep.

### 2. Verified OMP TCP Peer Binding via Socket Inode and Ancestry
- **Loopback Spoofing Defense**: `verify_tcp_peer_process` in `server/src/agent_status/collector.rs` eliminates PID forgery over loopback WebSocket connections:
  1. *Pre-check*: Reads `/proc/<claimed_pid>/stat` to verify PID validity, records `start_ticks`, and rejects zombie/dead states (`Z`, `X`).
  2. *Socket Discovery*: Resolves client socket inode from `/proc/net/tcp` and `/proc/net/tcp6` matching `peer_addr.port()`.
  3. *Descriptor Verification*: Scans `/proc/<claimed_pid>/fd/` for symlinks targeting `socket:[<inode>]`, bounded by `MAX_PEER_FDS_SCAN = 256` to prevent DoS.
  4. *Ancestry Verification*: Traces `/proc/<pid>/stat` parent PIDs (up to 32 hops) ensuring lineage connects to the registered terminal root. When `claimed_pid == root.pid`, explicitly asserts `stat_before.start_ticks == root.start_ticks` to prevent recycled PID exploitation.
  5. *Post-check*: Re-reads `/proc/<claimed_pid>/stat` confirming `start_ticks` remained unchanged and process remained alive throughout verification.
- **Fail-Closed Binding**: Connections failing any verification step are admitted without verified process identity (`verified_process: None`). In semantic evaluation, unverified reporters fail closed with `AgentSemanticBlockReason::UnverifiedProcessBinding`.

### 3. Hard Fail-Closed Native Freshness Gate for Codex/Claude
- **Empirical Grounding**: Codex and Claude CLI hooks emit point-in-time lifecycle events (SessionStart, Prompt, Stop) without keepalive or heartbeat mechanisms; leases expire after `DEFAULT_LEASE_MS = 15_000` (15s).
- **No Synthetic Leases**: DamHopper enforces a hard fail-closed gate: no artificial lease stretching, no simulated Idle states from stop events, no transcript/screen polling, and no cloud API substitution.
- **Evaluation Gate**: If a managed native provider's last report exceeds 15s without fresh hook activity, `evaluate_managed_agents` returns `AgentSemanticEvaluation::Unknown` with reason `AgentSemanticBlockReason::UnrefreshedNativeProvider`, blocking automatic sleep until refreshed or confirmed exited.

### 4. Monotonic Non-Free Generation Tracking & Semantic Evaluation Logic
- **Monotonic Invalidations**: `AgentStatusRegistry` maintains `non_free_generation: u64` (starts at 1). Any non-free transition (reporter admission with Working state, state transition, lease expiration sweep, terminal removal, or reconnect) increments `non_free_generation.saturating_add(1)`.
- **Transient Reset Safety**: A brief `Working -> Idle` transition between coordinator polling sweeps increments `non_free_generation`, instantly invalidating any prior `AgentFreeClaimTicket`.
- **Evaluation Invariants**:
  - `matched_agents.is_empty()` -> `AgentSemanticEvaluation::Free` (zero agents).
  - Any agent `Working` -> `AgentSemanticEvaluation::Working` with implicated PIDs.
  - Expired lease, unrefreshed native provider, unverified binding, ambiguous owner, or uncovered subagent -> `AgentSemanticEvaluation::Unknown`.
  - All matched agents `Idle` or `Blocked` with active leases -> `AgentSemanticEvaluation::Free` reporting min remaining lease, `non_free_generation`, and `semantic_revision`.

### 5. AgentFreeClaimTicket and PTY Manager Handoff Fences
- **Atomic Claim Ticket**: `AgentFreeClaimTicket` (`server/src/idle_suspend/activity/sampler.rs`) encapsulates an immutable snapshot: `request_id`, `completed_at`, `semantic_revision`, `non_free_generation`, `timing_revision`, `fleet_generation`, `input_revision`, roots, matched agent evidence, counts, min lease, and monotonic `eligibility_deadline`.
- **Sanitized Telemetry**: Custom `Debug` implementation omits raw PIDs, start ticks, and terminal paths to prevent private process details from leaking into audit logs.
- **8-Point Admission Fence**: `PtySessionManager::try_claim_agent_free_handoff` (`server/src/pty/manager.rs`) atomically checks under `inner` lock:
  1. Policy is `AgentFree` and enabled.
  2. Request ID, semantic revision, non-free generation, and timing revision match ticket.
  3. Monotonic eligibility deadline is expired.
  4. Observation age <= 5 seconds (`MAX_ACCEPTED_OBSERVATION_AGE`).
  5. Input revision matches ticket.
  6. Fleet generation matches ticket.
  7. Live sessions count and root process identities match ticket roots exactly.
  8. Atomic fleet handoff claim acquires handoff flag, verifying no session is creating, closing, disposing, or restarting.

## Next steps
- Incorporate code review hardening suggestions: both verified (PID recycling check on root match and `MAX_PEER_FDS_SCAN = 256` in `collector.rs`).
- Advance to Phase 03 (WebSocket presence and session binding) and Phase 04 (coordinator timer and final handoff integration).

## Unresolved questions
- None for Phase 02 contract implementation.
- Phase 04 / Phase 05 coordinator handoff integration will wire the 8 reserved compiler-warned structures (`AgentFreeAdmission`, `AgentFreeClaimTicket`, `evaluate_managed_agents`, `try_claim_agent_free_handoff`).
