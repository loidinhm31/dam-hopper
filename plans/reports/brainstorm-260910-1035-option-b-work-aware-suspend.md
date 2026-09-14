# Brainstorm: Work-aware terminal suspend

Status: policy clarified; detection architecture proposed, not approved for implementation.
Date: 2026-09-10
Scope: architecture assessment only. No application code, configuration, services, or host suspend operations changed.

## Agreed objective

- Open AI CLI processes may remain alive during suspend.
- AI generation, API waits, tools, finite background jobs and autonomous subagents must keep the host awake without human interaction.
- A CLI explicitly waiting for a human, or finished and waiting for another prompt, may allow sleep after the configured quiet period if no independent work remains.
- Idle services may pause with the host; continuous service availability is not required by this policy.
- A connected browser alone does not block. Accepted terminal input resets quiet time.

## Corrections to previous review

The earlier architecture-review-260910-1035-terminal-idle-suspend-pty-liveness.md is not a reliable implementation recommendation:

- Foreground PGID equal to shell PGID does not establish idle state. Builtins, non-job-control commands and background children break that inference.
- CPU/PSI and output silence cannot distinguish human wait from API, I/O or retry wait.
- Empty startup and one-attempt-per-epoch behavior are policy choices, not deadlocks; preserve unless explicitly changed.
- Existing empty-fleet policy was not proved 100% safe. Manager removal can precede confirmed process termination.
- Suspend normally pauses processes and preserves RAM; it does not inherently kill them or corrupt files. Network sessions, remote deadlines and application recovery remain risks.
- portable-pty 0.8.1 Unix process_group_leader() returns tcgetpgrp(master fd), not a stable shell PID.

## Current implementation evidence

- server/src/pty/fleet_state.rs:14-44: aggregate live/creating/restart-pending state only, not task activity.
- server/src/pty/manager.rs:1483-1494: input write checks live membership but does not invalidate fleet eligibility or reject handoff.
- server/src/pty/manager.rs:2487-2567: shell lifecycle parsing is separate from fleet generation/admission.
- server/src/pty/shell_integration.rs:22-54: Bash/Zsh/Fish shell adapters, not agent task state.
- packages/ui/src/lib/agent-activity-tracker.ts:196-226: quiet timeout creates a notification, not authoritative idleness.
- packages/ui/src/lib/terminal-agent-title-activity.ts:8-25: Codex title/spinner heuristic; presentation-only evidence.
- server/src/telemetry/codex_otlp/decoder.rs:124-126: model response.completed usage records, not proof that the entire agent turn/tools finished.
- server/src/workflow/observation.rs:85-124: terminal lifecycle observations, not live agent execution state.
- Existing procfs collector is bounded/top-RSS telemetry; existing cgroup collector is server-level resource telemetry. Neither is complete per-terminal workload ownership.

Two independent read-only scouts examined process evidence and admission safety. No project test/build/format gates run for this consultation.

## Evaluated approaches

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Generic PTY/output/CPU/PGID heuristic | Easy deployment, broad superficial coverage | Silent active work indistinguishable from idle; no reliable service classification | Reject as sleep authority |
| Explicit user marking of pause-safe sessions/services | Simple, predictable policy | Requires human configuration; does not automatically track agent turn state | Useful for service policy, insufficient for agent goal alone |
| Harness-aware state plus workload ownership and admission | Can distinguish human wait, model/tool work and background execution | Per-harness integration/version qualification; unknowns block | Recommended direction, feasibility gate remains |

## Proposed detection contract

Separate three questions:

1. Ownership: which session/run owns each local process and background job?
2. Activity: can any owned work progress without a human?
3. Policy: may this specific workload pause despite remaining alive?

Keep process liveness truthful. A sleeping-eligible CLI is still live. Never redefine live_count to mean busy.

### Harness state

Maintain incarnation/run-bound, versioned, ordered observations using existing lifecycle identity patterns. Conceptual states:

- working: model request, streaming, tools, compaction, scheduled autonomous continuation, retry/network wait.
- awaitingHuman: explicit outstanding human response, not merely text resembling a question.
- idle: final turn complete, no automatic continuation pending.
- unknown: unsupported version, incomplete reporting, dropped events, stale identity, ambiguous/disconnected producer.

State is per work unit, not just the parent agent. A parent awaitingHuman does not clear a running child, background tool or pending automatic continuation. Track work IDs and reconcile a snapshot; do not blindly increment/decrement counters from potentially duplicate events.

No event timeout changes working to idle. Silence leaves it working or makes reporting unknown. A heartbeat proves reporter health, not workload idleness.

### Harness feasibility

Claude Code official hooks expose UserPromptSubmit, tool events, PermissionRequest, SubagentStart/Stop and Stop. Current documentation describes background_tasks and session_crons on Stop. Missing arrays are not equivalent to empty arrays. Stop hooks can cause automatic continuation, and permission hooks can answer automatically; neither event alone authorizes sleep. Exact installed versions and final-state/resume coverage need qualification.

Codex App Server documents turn/started, turn/completed, thread/status/changed, approval/user-input requests, and experimental background-terminal enumeration. These are viable semantic sources for sessions owned by that app-server. Do not assume a separate app-server observes an arbitrary existing standalone codex PTY. Some user-input requests have autoResolutionMs: a prompt that may resolve itself is not purely human-blocked.

OMP and agy: named binaries exist locally, but this assessment has not verified their activity integration contracts. No support promise. agy's exact product/runtime identity and supported extension interface must be established before adapter design.

### Workload ownership and service policy

Prefer per-terminal/run cgroup-v2 ownership where operationally available; membership survives ordinary fork/reparenting within the group. Requires actual delegation/launch integration, currently absent from the inspected collector. It identifies processes, not whether they are doing useful work. Escaped or independently hosted/remote workloads require explicit boundaries.

Classify every remaining owned workload as reported agent/tool work, explicitly pause-allowed service, or unknown. Unknown blocks. Do not allowlist every node/python process, infer service status from an open port, or assume a returned shell command means a detached build completed.

For services, distinguish two policies:
- pauseAllowed: may pause even if processing a request; explicit acceptance of interruption/delay.
- idleOnly: may pause only when a service-specific signal proves no in-flight work; no generic reliable detector.

Start with explicit per-service policy rather than a universal service-idleness detector. The user's acceptance of service pause does not yet resolve whether in-flight service requests may be interrupted.

### Final suspend admission

Eligibility requires no working/unknown protected units, no creating/restart/teardown ambiguity, no recent accepted input, and only idle/awaitingHuman or explicitly permitted services remaining. Existing helper/inhibitor/authentication gates still apply.

Every accepted input or work-start transition invalidates the quiet epoch before being acted on. At deadline, reconcile current evidence and perform generation-fenced handoff. After claim, reject/defer all new server-admitted input/work, not only PTY creation. Resume reconciles state before reopening admission.

Passive hooks alone may leave a work-start-versus-suspend race. Strict assurance requires that supported harnesses participate in a pre-work admission or prepare-to-suspend handshake. A read-only event adapter that cannot prevent autonomous continuation provides bounded observation, not an atomic guarantee. Cgroup freezing is not proof of idleness and is not recommended as an initial shortcut.

## UX

Expose a small set of reasons, without recording prompts/commands/output:

- Awake: agent waiting for model response.
- Awake: background build still running.
- Awake: unsupported or unknown activity.
- Eligible: agent waiting for your answer, no other work.
- Eligible: service explicitly allowed to pause.
- Countdown: eligible and no recent terminal input.

No browser connection requirement. Do not reuse the frontend needs-attention notification as a suspend signal.

## Validation evidence and required acceptance

A disposable Linux observation executed two finite Bash processes: read -t 2 answer (human-input wait) and sleep 2 & wait (background-work wait). Both sampled shell processes reported Linux state S and zero user/system CPU ticks. This demonstrates the insufficiency of those indicators alone; it is not an AI adapter or end-to-end suspend test.

Required proof before implementation endorsement:

1. Per exact harness/version: slow silent API response remains working; explicit human question/approval becomes awaitingHuman only with no autonomous continuation.
2. Root idle/waiting with active subagent, detached build or pending retry still blocks.
3. Turn completion is not mistaken for model response completion, tool-return, or a Stop hook that continues execution.
4. Unknown/disconnected/dropped/reordered events never authorize sleep; stale run/incarnation cannot clear current blockers.
5. Input and autonomous work-start racing handoff have an explicit admission outcome; no silent acceptance after claim.
6. Pause-allowed service survives controlled suspend/resume; sockets/timeouts surface truthfully. Idle-only services need their own activity evidence.
7. Multiple terminals aggregate correctly: one busy/unknown workload blocks host suspend.
8. Actual staged host acceptance only on an operator-approved test machine, after fake/no-suspend eligibility traces pass.

## Touchpoints and constraints

Likely implementation surface: PTY manager/session/fleet state; harness adapters and launcher integration; idle-suspend coordinator/status; protected status/UI reason rendering; service policy/config; cgroup/systemd launch ownership; existing lifecycle and race tests; architecture/config/security docs.

Preserve current manual force behavior, authorization, timing bounds, RTC/helper policy and startup/resume epoch policy. No database migration or new framework justified yet. Keep observation metadata-minimal and bounded; no output-hot-path process scans or top-N telemetry as authority. Unknown state favors correctness over energy saving. No delivery timeline or all-harness compatibility commitment is made before qualification.

## Unresolved decisions / next steps

- Review and approve or reject the hybrid direction; no detailed implementation plan authorized yet.
- Confirm whether pause-allowed services may pause during an in-flight request, or require idle-only semantics.
- Qualify actual codex/claude/agy/omp integration and version support, including pre-work admission and final human-wait semantics.
- If a harness lacks reliable integration, agree whether its sessions stay awake or require explicit pause permission. Do not silently substitute a heuristic.
- Decide per-terminal cgroup delegation versus a documented narrower ownership boundary.
- After architecture agreement, ask whether to create the detailed implementation plan.

## Sources

- https://code.claude.com/docs/en/hooks — lifecycle, Stop/background_tasks/session_crons, continuation and permission behavior.
- https://developers.openai.com/codex/app-server/ (redirects to https://learn.chatgpt.com/docs/app-server) — turn/thread events, approvals, auto-resolution and background terminals; runtime compatibility unverified.
- Context7 lookup returned documentation-not-found for two queries; direct official documentation supplied the evidence instead.
