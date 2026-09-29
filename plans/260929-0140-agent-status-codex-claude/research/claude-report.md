# Claude Code status integration research

Research date: 2026-09-29. Current Anthropic docs reviewed; no minimum version inferred unless explicitly documented. Gemini was attempted as requested but unavailable (no auth configured); findings below come from official docs.

## Recommendation

Claude Code has native lifecycle hooks rich enough to signal prompt start, tool activity, permission-request candidates, normal turn stop, API failure, session switch/end, and subagent start/stop. It is not a continuous lifecycle/status API: each hook is an event callback; hook input includes sensitive prompt/tool content; there is no callback for manual permission resolution or user-interrupt/Escape. Do not claim exact OMP status equivalence from hooks alone. Use hooks as best-effort state transitions only, bound to the existing PTY-incarnation capability; retain OMP-owned process/lease heartbeat for liveness and fall back to unknown on lease/disconnect. Never forward or log prompt, tool input/output, notification text, transcript contents, or last assistant text.

## Event/capability matrix

| Claude event | Documented point and useful fields | Status use / limitation |
|---|---|---|
| `SessionStart` | New or resumed session; `session_id`, `source`=`startup\|resume\|clear\|compact\|fork`; optional model/agent info. Fires on every session. | Establish/reset session association; not a turn-start or success signal. Startup hooks run in background for interactive starts/resumes/clear; first Claude response waits for them. |
| `UserPromptSubmit` | Fires before processing; input includes full `prompt`. | Working transition. Parse only identifiers/event name; discard prompt bytes. |
| `PreToolUse` | After tool parameters are created, before execution; includes `tool_name`, full `tool_input`, `tool_use_id`. Excludes `EndConversation`. | Working transition. Do not inspect/store payload. |
| `PermissionRequest` | Fires when about to ask for permission, and when a non-interactive call would otherwise be auto-denied; gets tool fields (no `tool_use_id`). | Blocked candidate, not proof a visible user prompt is waiting. May allow/deny only through its hook decision; it is not a response callback. |
| `Notification(permission_prompt)` | Permission prompt has waited ~6s in terminal; gets text/message. Network sandbox prompts also notify. | Delayed supporting signal only. Cannot block/change notification; no resolution event. Notification may not fire if user acts sooner in SDK-hosted sessions. |
| `PostToolUse` / `PostToolUseFailure` | After successful completion / after started tool errors. | Work continues; not turn completion. Manual permission denial and Escape are not represented by these events as a documented resolution signal. |
| `PermissionDenied` | Auto-mode denials only (not manual dialog denial, `PreToolUse` block, or deny-rule match). | Not a general approval/denial lifecycle event. |
| `Notification` other types | Includes delayed `idle_prompt` (~60s), `agent_needs_input`, etc.; hook gets message/title/type. | Advisory only; not authoritative state or a complete cancellation signal. |
| `Stop` | Main agent finished responding; not fired on user interrupt; API errors use `StopFailure`. Has `stop_hook_active`, final text and task arrays. | Normal turn-settle candidate only, not task success. `decision:"block"`, exit 2, or `additionalContext` can continue the conversation; limit is 8 consecutive continuations, then Claude forces stop. Guard with `stop_hook_active`. |
| `StopFailure` | Instead of `Stop` for API error; error type/details. | Explicit API-error outcome. Output/exit code ignored (except terminal notification sequence); no continuation/decision control. |
| `SessionEnd` | Session termination; reason `clear`, `resume`, `logout`, `prompt_input_exit`, or `other`. | Session lifecycle cleanup, not task completion. No decision control; default hook timeout 1.5s. |
| `SubagentStart` / `SubagentStop` | Start on spawn/resume and each teammate message; stop when subagent finishes. `session_id`, unique `agent_id`, `agent_type`; stop also includes subagent transcript path and final text. | Track child activity by `agent_id`, never settle root from child stop. Hooks also run in subagents; internal feature agents can emit stop too. `SubagentStop` can itself block/continue the child. |

### Ordering and cancellation limits

Documented broad flow: `SessionStart` → each prompt's `UserPromptSubmit` → nested tool loop (`PreToolUse`, optional `PermissionRequest`, then `PostToolUse` or `PostToolUseFailure`) → `Stop` or `StopFailure` → eventual `SessionEnd`. `Notification(permission_prompt)` is delayed, not ordered as a reply. Subagent events interleave within the agentic loop. Tool calls to `EndConversation` skip Pre/PostToolUse. `Stop` hooks are continuation gates, not immutable end-of-turn evidence: a blocking stop causes more conversation and another stop cycle. A user interrupt suppresses `Stop`; docs identify no matching interrupt hook. `SessionEnd` has coarse reasons and cannot repair all interrupted-turn gaps.

A `PermissionRequest` can represent either an interactive ask or an imminent non-interactive auto-denial; `Notification(permission_prompt)` confirms only a prompt waiting ~6 seconds, never its outcome. No native event documents the user's approve/reject/Escape response. Therefore blocked→working/idle transitions after a manual decision or interrupt cannot be guaranteed from Claude hooks alone. This is a material fidelity gap; keep status unknown when reporter lease expires rather than infer completion.

## Hook/install and privacy contract

- Command hooks receive event JSON on stdin and are separate event handlers, not a persistent reporter/session stream. On Linux/macOS they run in a session without a controlling terminal; hook/child processes cannot use `/dev/tty` or send UI escape sequences directly. Commands may block up to their timeout (normally 600s; `UserPromptSubmit` 30s; `SessionEnd` 1.5s). Keep status forwarding local, bounded, and fast; a timed-out command hook generally yields no decision. `async:true` is available for command hooks, but is not a heartbeat/liveness contract.
- Common input includes `session_id`, `cwd`, `transcript_path`, `hook_event_name`, and sometimes `prompt_id` (documented since 2.1.196). Transcript writes may lag. No documented hook field supplies the Claude CLI PID or PTY-incarnation capability. Bind events through OMP's existing authenticated PTY reporter/capability, not an untrusted `cwd`/transcript path alone; treat `session_id` as per-session correlation, not process identity. `agent_id` is the documented child discriminator.
- Hooks can receive sensitive `prompt`, `tool_input`, notification text, transcript path, and final assistant text. Parse a narrow allowlist (`session_id`, `hook_event_name`, `agent_id`/`agent_type`, relevant event reason/type); discard remaining stdin without logging, forwarding, or transcript access.
- Default user settings: `~/.claude/settings.json`; `CLAUDE_CONFIG_DIR` relocates settings, session history, and plugins to the configured directory. Install to the detected effective runtime home, not hard-coded `~/.claude`.
- Precedence high→low: managed settings → CLI `--settings` → project-local `.claude/settings.local.json` → shared `.claude/settings.json` → user settings. Hook entries from settings sources merge; hooks can also come from plugins, skills, and subagent frontmatter. Settings edits normally hot-reload. Avoid writing shared project config for a user-level Agent Store install.
- `disableAllHooks` disables hooks at its effective settings precedence; no per-hook disable switch. A higher-priority project-local `false` can override user `true`; user/project/local cannot disable managed hooks. `allowManagedHooksOnly` blocks user/project/local/plugin hooks (with documented managed-enabled-plugin exception). Detect and report these policies rather than bypassing/editing them.
- Docs say remove a hook by deleting its entry; they document no stable per-handler ownership ID. **[Inference]** Installer should narrowly merge only OMP-owned entries into the selected hook arrays and persist exact ownership/signature metadata; uninstall only those exact entries, preserving every other setting and hook. Do not replace the whole settings file or silently re-enable hooks.

## Version and qualification

Main-session read-only probe reports local Claude Code `2.1.250`; this is an observed binary version, not a minimum-support guarantee. Current docs explicitly gate some ancillary fields/features at later releases (for example `scratchpad_dir` 2.1.257, some `StopFailure` matcher behavior 2.1.267, MCP provenance 2.1.274). Do not couple status to these fields. Exact runtime availability/behavior of the required event set on the packaged CLI must be qualified against that binary; current docs do not establish earliest support for every event. `prompt_id` is documented from 2.1.196, but is unnecessary for the status contract.

## Primary sources

- [Hooks reference](https://code.claude.com/docs/en/hooks) — event lifecycle, schemas, decisions, disabling, execution.
- [Settings and precedence](https://code.claude.com/docs/en/settings) — paths, `CLAUDE_CONFIG_DIR`, merge/precedence, reload behavior.
- [Environment variables](https://code.claude.com/docs/en/env-vars) — `CLAUDE_CONFIG_DIR` reference.
- [Settings reference: `disableAllHooks` / managed hook policy](https://code.claude.com/docs/en/settings-reference#disableallhooks).

## Unresolved questions

- Does the exact packaged Claude Code `2.1.250` reliably emit the needed base events and payloads across interactive CLI, resume/clear, permission wait/answer/deny, and interruption? Current documentation is not an exact-version qualification run.
- What safe signal, if any, can resolve manual permission approval/rejection and Escape interruption without screen/transcript heuristics? Native hooks document no complete answer.
- How should Agent Store expose effective `CLAUDE_CONFIG_DIR`, managed-hook-only policy, and global `disableAllHooks` when settings are active through multiple precedence layers?
- Should Claude integration be presented as best-effort status under hook-only mode, with explicit unknown gaps, or gated on the PTY-owned heartbeat bridge plus live qualification?
