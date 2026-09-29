# Codex status integration research

**Research date:** 2026-09-29. Scope: ordinary interactive Codex CLI vs app-server-controlled CLI, with Herdr as prior art. No implementation or project validation performed.

## Executive finding

Ordinary interactive CLI hooks provide trustworthy *edges* for root session start, prompt submission, pending tool approval, turn stop, and active-turn interrupt. They do **not** provide a complete authoritative status stream: no approval-resolution hook, generic user-question hook, distinct error/end outcome, immediate thread-switch/end signal, or periodic heartbeat. Therefore hooks improve on completion-only OSC 9 alerts but cannot promise full unknown/idle/working/blocked semantics without inference.

The app-server stream is the stronger structured contract: explicit thread/turn lifecycle, terminal outcomes, approval/question server requests and resolutions, and runtime waiting-on-approval status. However it is a different host/launch architecture; official docs call the app-server command and WebSocket transport experimental and unsupported for production. Do not silently treat it as an ordinary-CLI drop-in.

## Event and capability matrix

| Need | Ordinary interactive CLI hooks | App-server-controlled mode |
|---|---|---|
| Session start / identity | `SessionStart` on `startup`, `resume`, `clear`, `compact`; supplies `session_id`, `cwd`. | `thread/start`, `thread/resume`, `thread/started`; thread has `id` and root `sessionId`. Host owns selection. |
| Work starts | `UserPromptSubmit` carries `turn_id` and full prompt. Event is a sound start edge; implementation must ignore `prompt` and not read transcript. | `turn/start` request plus `turn/started`; input need not enter status reporting. |
| Ongoing work | No recurring heartbeat/model-start event. Tool hooks are only discrete tool events. Long reasoning/silent intervals are not represented. | A persistent event stream keeps turn `inProgress`; `item/started`/`completed` give structured progress. Keep transport alive/reconnect explicitly. |
| Approval blocker | `PermissionRequest` fires before supported tool-approval prompt; provides `turn_id`, tool name/input and optional description. Entry is detectable, but there is no hook for user's decision/resolution. Tool args can contain sensitive data: do not forward them. | Server requests include `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval`; replies resolve them, `serverRequest/resolved` confirms resolution, and final item status is `completed|failed|declined`. `thread/status/changed` can expose `activeFlags: ["waitingOnApproval"]`. |
| Agent asks user a question | No generic semantic question event; assistant-text inspection would violate no-transcript/output-heuristics boundary. | `tool/requestUserInput` gives explicit request/resolution, but this API is experimental. MCP elicitation is also structured; it is not a detector for arbitrary assistant prose. |
| Turn settles | `Stop` fires at turn stop, but is not a success/failure outcome and exposes `last_assistant_message` (ignore it). Hook can continue the turn, so stop is not task success. | `turn/completed` carries `status: completed|interrupted|failed`; failures include structured error. `completed` means turn finished, not that the user's task succeeded. |
| Interrupt / error | `Interrupt` explicitly means active main-thread turn interrupted; it cannot prevent/restart interruption. No documented generic error hook. Process death/disconnect must remain `unknown`, not inferred completion. | `turn/interrupt` ends with `status: interrupted`; failed turns include error info. Transport loss still means unknown until re-established. |
| Session switch/end | `SessionEnd` is main-thread only, `reason` is currently always `other`; fires on normal close/archive/delete or after 30 minutes idle and not open in any connected client. Switching conversation or unsubscribing does not immediately end session. | Host sees its own thread operations and `thread/closed`/archive events. `thread/resume` can reattach. Root session is `thread.sessionId`; forked threads retain root sessionId while having their own thread ID. |
| Subagents | Subagent hooks have `agent_id`/`agent_type`, but their `session_id` is the parent session. `SubagentStop` also exposes message/transcript fields—ignore. Do not create separate PTY reporters for these callbacks. | Thread IDs/items can represent child work; `collabToolCall` exposes child references. Parent-thread filters are experimental. Keep one OMP root reporter per terminal; don't count child completion as root completion. |

**Answer:** Hooks can authoritatively emit several lifecycle edges, not the full requested ordinary-CLI state machine. In particular they can mark approval *entry*, not approval *resolution*; cannot recognize arbitrary questions or errors; and cannot report immediate thread switching. A Stop/Interrupt/SessionEnd callback is not a heartbeat.

## Integration and coexistence constraints

- **Config home:** Codex uses `CODEX_HOME` when set; otherwise `~/.codex` (`$HOME/.codex`). Resolve and qualify against the actual runtime environment, not the installer process's assumed home. Herdr requires the chosen config directory to exist.
- **Hook install:** current docs support `hooks.json` and inline `[hooks]` in `config.toml`; matching hooks from all config layers run, and same-layer JSON+TOML hooks merge with a startup warning. Add/remove only the managed hook entries/script; preserve unrelated hooks and all other settings. Non-managed definitions require user trust by exact hook hash. Current docs say hooks default enabled and `codex_hooks` is a deprecated alias for canonical `[features].hooks`; parent probe reports local `codex-cli 0.158.0` with `hooks` stable/enabled. Do not classify that local release as experimental or claim it is the first supported release.
- **`notify` and OSC 9:** Keep any existing user `notify` value untouched; hooks can be installed separately and do not require replacing notification configuration. Preserve Codex's existing OSC 9 completion-alert behavior as a distinct notification surface. The OMP hook should report status only—not emit another completion notification—so native alert and OMP notification do not double-fire. Install/uninstall should round-trip the existing notification/config value rather than normalize or overwrite it.
- **Heartbeat / isolation:** command hooks are short-lived event callbacks (most default to 600s; `Interrupt`/`SessionEnd` default to 1s and cap at 3s). They cannot meet the existing 5s heartbeat / 15s lease. Forward only whitelisted event metadata through the existing authenticated per-PTY reporter; keep its heartbeat/lease and incarnation fencing. A stale active state after no resolution is not evidence of ongoing work; reporter/process loss remains `unknown`.
- **Exec is not interactive lifecycle:** app-server `command/exec` runs one sandboxed command without a thread/turn and returns exit/stdout/stderr; optional `command/exec/outputDelta` streams command output. Experimental `process/*` is explicit process control outside Codex's sandbox and requires `experimentalApi=true`. Neither is a substitute for interactive session lifecycle, and status integration must not ingest output.

## App-server tradeoff and version gate

App-server gives the authoritative event shape needed for status when DamHopper (or its managed host) owns the app-server connection: `turn/started`, `turn/completed`, item lifecycles, explicit server requests/resolutions, and thread/session identity. It is not a passive hook attachment to a user's existing bare `codex` process. Official remote-TUI flow starts `codex app-server --listen ws://127.0.0.1:...` and attaches `codex --remote ...`; the docs explicitly mark app-server command and WebSocket transport experimental/unsupported for production. Some APIs/fields require `initialize.capabilities.experimentalApi=true` (e.g. user-input request, process control, parent-thread filters/additional permissions). The protocol/schema is per installed Codex version; generate schemas from the exact binary and qualify that version. Local probe is 0.158.0 only; documentation does not establish earliest supported version.

**Recommendation:** Keep normal-CLI hooks as a clearly limited lifecycle integration only if the product can honestly expose unresolved/unknown states rather than inventing approval/question/error completion. If full semantic parity is required without VT/transcript parsing, choose app-server-controlled mode as an explicit opt-in launch-mode decision, gated by experimental/unsupported API qualification—not as a silent implementation detail. Do not use `notify`/OSC 9 as status authority.

## Herdr prior art (not authority)

Latest Herdr integration docs explicitly classify **Codex and Claude as “Session identity” only**; state still comes from Herdr screen-manifest detection. Codex integration installs a session hook/script, updates `hooks.json`, ensures `[features] hooks=true`, and removes deprecated `codex_hooks`; uninstaller removes its entries/script but leaves `config.toml` unchanged. It uses `CODEX_HOME` or `~/.codex`, requires directory existence, and current integration version 5 enables session restore. This is not evidence of lifecycle status support. It is a useful config-preservation/install precedent, not proof that native Codex hooks close state gaps.

## Sources (primary first)

1. [OpenAI Codex hooks docs](https://developers.openai.com/codex/hooks/) — event inventory/payloads, hook merge/trust/config, release behavior; explicitly warns transcript format is unstable.
2. [OpenAI Codex app-server docs](https://developers.openai.com/codex/app-server/) — transport stability warning, protocol, turn/thread/item lifecycle, approvals, questions, exec, experimental gates; schema generated from exact CLI version.
3. [OpenAI Codex source repository](https://github.com/openai/codex) and [app-server source](https://github.com/openai/codex/tree/main/codex-rs/app-server); [generated hook schemas](https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated). Docs state main-branch schema may be ahead of release; use docs/exact installed binary for qualification.
4. [Herdr integrations](https://herdr.dev/docs/integrations/) and [agent status authority model](https://herdr.dev/docs/agents/) — implementation classification and install behavior; prior art only.

## Unresolved questions

- Is the product willing to support an explicit app-server/remote-TUI launch mode with its experimental/unsupported production status, or must ordinary CLI remain the only mode?
- If ordinary CLI remains required, should OMP expose the real event gaps as unknown/limited status, or is screen-based detection an acceptable user-approved fallback? Do not claim parity either way without qualification.
- Exact minimum Codex release/OS matrix for hooks, hook trust behavior, `CODEX_HOME`, and app-server transport remains to be qualified; the local evidence supplied is Linux CLI 0.158.0 only.
