# Herdr agent status: OMP-first adoption

## Decision and gate

Agreed direction: adopt lifecycle-based agent status for dam-hopper badges and notifications. OMP is the first supported adapter, not a permanent architectural restriction. Add Codex/other adapters only when needed. No implementation or detailed implementation plan authorized in this session.

- Final artifact: this feasibility/decision report. Proposed product behavior: server-owned per-terminal agent status, attention badges, and turn-ended notifications.
- Initial scope: OMP interactive root sessions inside dam-hopper terminals; working, blocked, idle, unknown; reconnect-safe presentation.
- Future scope: Codex and other agents consume the same semantic contract, with agent-specific evidence producers.
- Out of scope now: screen detector, full Herdr runtime, agent orchestration, automatic task completion, idle-suspend changes, telemetry redesign, automatic approval/input, native session restore, subagent dashboard.
- Constraints: preserve existing Rust/Axum + React architecture, PTY ownership and profile isolation; function without an open browser; no inference that silence means completion; no global credential exposure in agent environments. No delivery deadline specified.
- Acceptance: explicit lifecycle transitions, continuation/retry handling, nested-agent isolation, stale-event rejection, reconnect reconciliation, deduplicated notifications, and no workflow/suspend behavior changes. Detailed scenarios below.

## Research basis

- Herdr source inspected at commit `87c08c6b7a1dbd250fa3a8e9424a47b3176f99eb`.
- Runtime screen-classifier smoke: official Herdr v0.9.1 executable, SHA-256 `2a02fed16beb651ef006e1d43f048f652ca4dc58ad053cd2d44450563d5c54b7`, verified against upstream release metadata. Bundled Codex manifest used by that executable: `2026.09.14.1`; source checkout contains newer rules. Runtime results are not claimed as a build of the inspected commit.
- OMP smoke: unmodified extension from the inspected commit, executed with Bun 1.4.0 in an isolated synthetic-event/Unix-socket harness. Not a live OMP session or dam-hopper integration.
- Local code inspection; no application code changed, no project build/tests run.

## How Herdr works

### 1. Agent identity and one status authority

Herdr identifies the foreground agent and associates reports with a pane/session. Complete lifecycle integrations author state; screen detection does not compete with an effective lifecycle authority. Reports carry a source and increasing sequence number. Authority is tied to current process/session identity, not an arbitrary unscoped report.

Herdr's current agent table distinguishes:

- OMP, Pi, Kimi, OpenCode, Kilo, MastraCode: lifecycle authority when active.
- Codex, Claude Code and several others: screen rules remain state authority; their integrations primarily supply native session identity.

Sources: [agent authority documentation](https://herdr.dev/docs/agents/#status-authority), [integration documentation](https://herdr.dev/docs/integrations/#how-herdr-uses-integrations), `src/terminal/state.rs:931-1057,2032-2100`, `src/detect/mod.rs:323-337`.

### 2. Screen detection is rendered-screen matching, not log grep

For screen-authority agents, Herdr evaluates per-agent TOML manifests against recent live bottom-buffer content, with region selection, priorities, text/regex predicates, and optional OSC title/progress evidence. Scrolling the client does not change the live detection target. Known-agent unmatched screens fall back to idle. Recognized blockers include approval/question UIs; working rules include live activity/timer shapes. Transcript-viewer rules can suppress state updates.

Example: Codex rules recognize `Action Required` in the title, spinner titles, visible approval text, and a live working timer. New UI shapes can evade rules. Herdr has transition stabilization to avoid transient working-to-idle flicker, but stabilization cannot prove task success.

Sources: [Codex manifest](https://github.com/herdrdev/herdr/blob/87c08c6b7a1dbd250fa3a8e9424a47b3176f99eb/distribution/agent-detection/codex.toml), `src/pane/agent_detection.rs:24-78`, [detection documentation](https://herdr.dev/docs/agents/#detection-manifests).

### 3. OMP lifecycle mapping

| OMP signal | Herdr behavior |
|---|---|
| `session_start` | Publish current idle/working state; capture native session identity |
| `agent_start` | Working |
| `tool_approval_requested` | Blocked; track outstanding blockers |
| `tool_approval_resolved` | Clear blocker; return to working if agent remains active |
| `tool_execution_start/end` for `ask` | Blocked while user question is pending |
| `agent_end` with `willContinue` | Stay working |
| Settled `agent_end` | Debounce idle by 250 ms |
| Retryable provider failure | Hold working for 2.5 s; become blocked if no continuation arrives |
| `session_switch` | Reset session activity and republish |

Nested OMP processes (`OMPCODE=1`) do not report over the parent. Root activation also requires `ctx.hasUI === true`; this is an interactive-session integration, not universal headless OMP coverage.

Transport: serialized JSON requests over Herdr's local socket/named pipe, pane identity, source, agent identity and monotonic sequence. The extension is Herdr-specific; copying it unchanged does not integrate dam-hopper.

Source: [OMP extension](https://github.com/herdrdev/herdr/blob/87c08c6b7a1dbd250fa3a8e9424a47b3176f99eb/src/integration/assets/omp/herdr-agent-state.ts), especially lines 11-24, 79-90, 167-209, 281-327, 375-470.

### 4. “Done” is attention state, not verified success

Herdr's internal activity states are `idle`, `working`, `blocked`, `unknown`. Display/API `done` is idle with unseen attention state. A working/blocked-to-idle transition records completion; viewing the relevant tab marks it seen. Process-exit paths can also publish idle and enter completion handling.

Therefore:

- Agent process alive does not imply working.
- Idle does not imply successful task completion.
- Turn ended does not imply process exited.
- Done can mean “stopped and not reviewed,” including interruption/failure paths.

Sources: [status projection](https://github.com/herdrdev/herdr/blob/87c08c6b7a1dbd250fa3a8e9424a47b3176f99eb/src/app/api_helpers.rs#L96-L108), `src/app/actions.rs:22-29,1721-1728,1767-1818`.

## Fit with dam-hopper

| Existing surface | Current meaning | Adoption decision |
|---|---|---|
| `packages/ui/src/lib/terminal-output-activity.ts:3-21` | Receiving/quiet based on a 3-second output window | Keep distinct from semantic activity |
| `packages/ui/src/lib/session-status.ts:5-30` | Alive/restarting/crashed/exited process | Keep distinct from turn state |
| `server/src/pty/shell_lifecycle.rs:11-25` and `server/src/api/ws_protocol.rs:255-264` | Shell prompt/edit/submit lifecycle | Do not overload with agent activity |
| `server/src/pty/activity.rs:23-43` | Process identity and terminal incarnation | Reuse identity concepts for stale-report isolation |
| `server/src/pty/event_sink.rs` and `server/src/api/ws.rs` | Server event distribution | Reuse push architecture; include state in reconnect reconciliation |
| `packages/ui/src/api/client.ts`, `ws-transport.ts`, `ownership.ts` | Typed transport and profile/terminal ownership | Extend with agent-neutral status contract |
| `packages/ui/src/lib/terminal-agent-notification-integration.ts:83-117` | Active integration hardcodes Codex and parses OSC 9 | Do not treat it as existing OMP lifecycle support |
| `packages/ui/src/lib/terminal-notification-signal-parser.ts:4-37`, `stores/terminal-notifications.ts` | Notification event/history presentation | Reuse/generalize instead of creating parallel notification UI |
| `packages/ui/src/components/atoms/TerminalActivityIndicator.tsx`, `TerminalPanel.tsx` | Activity display and terminal integration | Present agent state without relabeling raw output activity |
| `server/src/pty/buffer.rs:1-6` | Raw terminal byte scrollback; xterm.js handles rendering | Insufficient for Herdr-style server-side screen matching |

A browser-only classifier would lose observation when disconnected. Backend-owned semantic status fits the current persistent PTY architecture. OMP lifecycle reports avoid adding a server-side VT emulator now.

## Options

| Option | Benefits | Costs/risks | Decision |
|---|---|---|---|
| Agent-neutral lifecycle status with OMP first | Precise events; no screen parser; small initial surface; later adapters fit same contract | Requires extension install, secure correlation, lifecycle coverage and delivery semantics | Recommended; user agreed |
| Port Herdr's hybrid detection engine now | Earlier broad CLI coverage; reuse manifests | Requires rendered server-side screen, rule engine, identity integration, fixtures and ongoing CLI compatibility work | Defer until additional agents need it |
| Run Herdr underneath dam-hopper | Reuse complete upstream lifecycle/detection stack | Second terminal/session owner, deployment dependency, bridge and reconnect complexity | Reject for status badges alone |

## Recommended design boundary

One small contract, one initial adapter. No generic plugin platform.

- Semantic state: `unknown | idle | working | blocked`; UI may label working as “Running.”
- Agent-neutral identity: agent kind, terminal incarnation, native agent session identity where available, report source, ordered revision/sequence. Preserve owning server/profile in client state.
- Backend stores the current snapshot and emits state changes. Browser is a subscriber, not authority.
- Keep process lifecycle separate. Terminated OMP must not remain “working”; terminal replacement must invalidate the old reporter even when public terminal ID is reused.
- Keep turn-ended/review-needed notification separate from idle state. First observation of an idle session must not produce a finished notification. Errors/interruption must not be presented as verified success.
- Authenticate and scope the reporting channel to the terminal/run; do not hand the extension a global server credential. Treat reported messages as untrusted display text, bounded and never executable.
- One authoritative producer per running agent. Later screen fallback must not override active complete lifecycle reports.
- Missing/unverified evidence remains unknown. Do not copy known-agent-unmatched-screen => idle into safety-sensitive consumers.
- Reuse notification history/settings and terminal ownership conventions; avoid a second alert system. Existing Codex-specific settings need deliberate generalization rather than silently applying Codex toggles to OMP.

### Later Codex/other rollout

New adapter, same server/UI contract. Re-evaluate each agent's actual lifecycle coverage at rollout time. Herdr's current Codex/Claude hooks are session-only; do not assume a completion hook covers permissions, interruptions and all continuations.

If adequate lifecycle events exist, use them. Otherwise add server-side terminal rendering and an explicitly heuristic screen adapter, porting selected manifests with compatible region semantics. This is the substantive future cost; an agent-neutral enum alone does not make Codex support free. No screen engine, remote manifest updater, or second adapter should be built for the OMP delivery.

## Risks to address in a later implementation plan

- OMP version compatibility: `willContinue` and approval hooks must exist and behave as expected in the deployed version. Older events can settle differently.
- Nested agents share inherited environments; preserve root-session discrimination.
- Upstream extension's `session_shutdown` only clears timers, not authority. Cleanup must also follow actual agent/process lifecycle, including OMP exit while its parent shell remains alive.
- [INFERENCE] An extension failure while the agent remains alive can leave last-known state stale; transport/reconnect and authority-loss behavior must be explicit. A quiet but healthy long-running operation is not itself evidence of failure.
- Upstream transport treats any response bytes as delivery; a dam-hopper adapter should distinguish acceptance from rejection. Initial adoption must not blindly copy this behavior.
- Duplicate/out-of-order events, resumed sessions, browser replay, and terminal reuse can cause incorrect badges or repeated notifications without identity/revision checks.
- Approval/question text can contain sensitive content. Prefer generic notifications; never forward full terminal output merely to report state.

## Licensing

Herdr is Apache-2.0; dam-hopper is MIT. Reuse is feasible, but copied source/manifests retain Apache obligations: distribute the license, preserve applicable notices, mark modified files, and carry applicable NOTICE attribution if present. Do not present copied Herdr code as solely MIT. Independently implementing the architectural idea avoids source-copy attribution, but copied expression/assets still need review.

Sources: [Herdr LICENSE section 4](https://github.com/herdrdev/herdr/blob/87c08c6b7a1dbd250fa3a8e9424a47b3176f99eb/LICENSE#L89-L128), local `LICENSE:1-13`.

## Exercised evidence

### Official classifier

Command shape: `herdr agent explain --file <screen.txt> --agent codex --json`, isolated HOME/config/state.

| Synthetic screen | Observed result |
|---|---|
| `Working (3s • esc to interrupt)` plus prompt | working; `screen_working_fallback` |
| `Allow command?` / confirmation UI | blocked; `live_strong_blocker` |
| Finished response and empty prompt | idle; `default_known_agent_idle_fallback` |
| Unrecognized UI text describing waiting | idle; same fallback |

All four exited 0. These samples demonstrate classifier behavior, not measured production accuracy.

### Upstream OMP extension

Synthetic events sent to the unmodified extension; real local socket captured its emitted requests:

```text
continuation: working
lifecycle: ["idle","working","blocked","working","idle"]
retry-grace: working
retry-expired: blocked
```

Harness exited 0. No live provider, native OMP interactive session, dam-hopper transport, browser UI, or notification permission flow exercised.

## Success criteria for implementation

1. Starting OMP shows idle; submitting a turn shows working even without terminal output.
2. Approval and `ask` prompts show blocked; resolving the final blocker restores the correct activity state.
3. Settled turn produces idle and at most one turn-ended notification; initial idle/replayed state produces none.
4. Scheduled continuation/retry does not briefly appear successfully finished; exhausted retry needs attention.
5. Nested OMP cannot overwrite its parent; old terminal incarnations and stale sequences cannot overwrite new state.
6. OMP exit, terminal replacement and reporting disconnect have explicit non-working/unknown behavior; process exit is not task success.
7. Status continues updating with browser disconnected; reconnect obtains latest state without replaying old notifications.
8. Existing Codex OSC notifications, output activity, shell suggestions, process statuses, workflow completion and suspend policy retain their existing meanings.
9. A later adapter can use the same state/identity contract without rewriting the badges or notification reducer; no unimplemented future adapter is required now.

## Next steps and unresolved questions

User selected adoption report only, not a detailed plan. Next step, if requested: plan OMP adapter, reporting-channel ownership, backend reducer/snapshot, transport, UI integration and scenario validation.

Planning decisions still open: minimum supported OMP version; exact local reporting transport and acknowledgement contract; loss-of-authority detection; which badge locations to prioritize; viewed/notification suppression behavior across clients. These do not block the feasibility conclusion. Codex/other support is deferred by user intent, not silently excluded from the architecture.
