# Brainstorm: AI-work suspend gate

Status: user clarified protection policy; proposed adapter contract requires per-harness qualification. No implementation authorized or performed.
Date: 2026-09-10
Supersedes the service-policy and cgroup recommendations in brainstorm-260910-1035-option-b-work-aware-suspend.md.

## Agreed scope

- Services and listening ports on managed PTYs do not independently block automatic sleep. No service-idleness detector or per-service pause settings.
- Preserve unfinished autonomous AI work: model requests/streams, reasoning, tools, retries and agent background jobs/subagents.
- A live AI CLI awaiting a human or another prompt may sleep when no independent AI work remains.
- Connected browser alone does not block; retain accepted-input quiet period.
- Existing host authorization, inhibitor/helper checks and lifecycle admission guards remain. Service exemption does not bypass OS inhibitors.
- No generic process-tree/cgroup monitoring, provider-cache management, CPU thresholds, port scans or terminal-output heuristics in this proposal.
- No changes to manual force-sleep or startup/resume retry policy proposed.

## Cache clarification

Provider prompt caches reuse prompt-prefix computation/KV state for later requests. They are not a durable agent execution snapshot or a guarantee that an in-flight streaming request survives local suspend. Retention and reuse depend on the provider/model/configuration.

Keep the local harness awake for the complete autonomous work chain, not merely until one model response arrives. That allows it to consume responses, run tools and submit subsequent requests while cached prefixes may remain available. Cache availability is an optimization, never a sleep-safety signal. No cache-warming requests or cache-based sleep timers.

Source: https://developers.openai.com/api/docs/guides/prompt-caching

## Minimal proposed architecture

Harness-specific adapter -> server-owned AI activity registry -> existing idle-suspend coordinator.

PTY liveness remains lifecycle metadata. Introduce a separate AI-work eligibility predicate; do not redefine live_count as busy_count or weaken manual force admission.

### Meaning of work

Classify registered execution units by authoritative runtime state:

- working: model/API wait, streaming/reasoning, compaction, finite tool/job execution, subagent work, automatic retry/continuation.
- waitingHuman: explicit unresolved human input with no automatic continuation for that unit.
- idle: settled turn awaiting new input, not just a single response/tool completed.
- unknown: incomplete registration, unsupported producer version, lost state, invalid identity/sequence, unhealthy observation.

Host-level rule: any working or unknown registered AI unit blocks. waitingHuman/idle units do not block after quiet time if all independent units also qualify.

A parent waitingHuman does not override a working child. Track units by stable run/work identifiers; deduplicate and reconcile authoritative snapshots rather than trusting an increment/decrement event counter.

### Background task versus resident service

This is a semantic distinction supplied by the harness, not inferred from ports/process names:

- Agent launched a finite test/build and still awaits its completion/result: protected job.
- Agent launched a persistent development server and received its startup result: resident service, exempt. The agent may remain working on other steps.
- Agent is actively calling that server as part of a tool/model chain: the AI work remains protected, not the port itself.
- Detached job type/completion unknown in an AI session: unknown blocks; do not silently classify as service.

A wrapper that only sees the shell command return may miss background work. Full background-job registry/snapshot coverage is an adapter acceptance requirement. Unsupported coverage must be visible.

### Registration and safety boundary

Supported AI launches must register before beginning work, bound to terminal incarnation and run identity. Executable-name recognition may select an adapter, but cannot infer task state. An uninstrumented AI CLI is not automatically an ordinary pause-safe service.

Guarantee is limited to registered/qualified harness executions. Arbitrary CLI launches that bypass integration cannot be promised protection. Before release, choose a launch integration that covers supported interactive starts and reports unsupported recognized AI sessions as unknown.

### Ordered admission

- Mark/register work before the harness begins model/tool/autonomous execution.
- Settle to idle/waitingHuman only when final runtime state is confirmed, including independent jobs and continuation sources.
- Every accepted terminal input/work-start invalidates quiet eligibility.
- Final suspend claim serializes with new work admission. After claim, defer/reject supported new work until reconciliation.
- On resume or observer reconnection, obtain a fresh authoritative snapshot before allowing automatic sleep.
- Lost reporting never expires into idle. A heartbeat proves health, not lack of work.

A passive notification or hook that silently fails and lets the harness continue cannot provide a strict work-start barrier. Qualified integrations need synchronous pre-work admission or a runtime prepare-to-suspend handshake. If an integration only observes, state that its guarantee is weaker; do not claim atomic safety.

## Feasibility evidence from prior assessment

- Current fleet snapshot counts PTY live/creating/restart-pending state, not AI work: server/src/pty/fleet_state.rs:14-44.
- Input path needs admission integration: server/src/pty/manager.rs:1483-1494.
- Existing UI quiet/title tracking is advisory only: packages/ui/src/lib/agent-activity-tracker.ts:196-226 and terminal-agent-title-activity.ts:8-25.
- Existing Codex usage response.completed event is not whole-agent completion: server/src/telemetry/codex_otlp/decoder.rs:124-126.
- Claude official hooks and Codex App Server offer candidate semantic sources; installed-version coverage, complete background snapshots and pre-work ordering are not yet qualified.
- OMP/agy integration support not established by this assessment. Do not claim all-harness compatibility.

Sources: https://code.claude.com/docs/en/hooks ; https://developers.openai.com/codex/app-server/

## Acceptance criteria

1. Silent long model/API wait never permits sleep, even without human interaction.
2. One model response or tool return does not clear the remaining autonomous work chain.
3. Parent awaiting human with a working background job/subagent blocks; after all units settle it becomes eligible.
4. Resident dev server remains alive without blocking; active AI use of it remains protected by the AI activity unit.
5. Human question with automatic timeout/retry/continuation is not falsely considered permanently human-blocked.
6. Event loss, duplicates, stale incarnation and restart/reconnect do not produce false idle.
7. Concurrent terminal input/autonomous work start versus suspend claim has a defined admission winner.
8. Every supported harness/version demonstrates these scenarios from its actual runtime events before enabling automatic eligibility. Start with observation-only traces, no host suspend.

## Deliverable and touchpoints

Current deliverable: this narrowed decision record and detection contract, not an implementation plan or code.

Likely implementation touchpoints: harness launch/adapters; bounded server AI activity registry; PTY input/lifecycle admission; idle-suspend coordinator/status; read-only blocker reasons; scenario tests and operator compatibility docs. No service classifier or cgroup/systemd delegation solely for this feature.

## Unresolved gates

- Which exact codex/claude/agy/omp runtime versions supply complete authoritative state and background-job/service distinction?
- Can each integration serialize autonomous work-start with suspend admission, rather than merely send a late notification?
- How will supported interactive launches register without leaving an unobserved-start gap?

Next technical step: qualify those interfaces against the acceptance scenarios. Unknown technical feasibility is not resolved by adding output/CPU heuristics. Detailed implementation planning remains gated on this qualification and user approval.
