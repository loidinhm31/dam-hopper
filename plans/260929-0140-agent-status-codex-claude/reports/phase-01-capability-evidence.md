# Phase 01: Exact-Version Native Hook Capability Evidence

**Date:** 2026-09-29  
**System:** Linux x86-64 (Fedora 44.0.0 [64-bit], kernel 7.1.10-200.fc44.x86_64)  
**Scope:** Read-only exact-version qualification of installed Codex CLI and Claude Code native hooks using isolated environments.  
**Safety & Isolation Notice:** No agent model turns executed; no live credentials accessed; no live user configurations read or modified (`~/.codex`, `~/.claude` preserved untouched); no hooks installed; no build or test commands executed.

---

## 1. Installed Executables and Version Qualification

| Attribute | Codex CLI | Claude Code |
|---|---|---|
| **Binary Path** | `/home/loidinh/.local/bin/codex` | `/home/loidinh/.local/bin/claude` |
| **Physical Target** | `/home/loidinh/.codex/packages/standalone/releases/0.158.0-x86_64-unknown-linux-musl/bin/codex` | `/home/loidinh/.local/share/claude/versions/2.1.250` (symlink target) |
| **Executable Format** | ELF 64-bit LSB pie executable, x86-64, musl libc | ELF 64-bit LSB executable, x86-64, GNU/Linux 3.2.0, dynamically linked |
| **Exact Version** | `codex-cli 0.158.0` | `2.1.250 (Claude Code)` |
| **Build / Commit** | Commit unknown (standalone release) | Commit `2f71b9f41af6`, BuildID `77182fdf9abdf4942c072f3f73059aacd7a33d73` |
| **Inspection Commands** | `codex --version`<br>`codex features list`<br>`CODEX_HOME=/var/tmp/dh-codex-test codex doctor` | `claude --version`<br>`claude --help`<br>`CLAUDE_CONFIG_DIR=/tmp/dh-claude-doc-test claude doctor` |
| **Hook Feature State** | `hooks stable true` (Codex feature flag list) | Built-in native hook runner in runtime bundle |
| **Isolated Doctor Exit** | Exit 1: Expected missing auth (`auth.json` missing in isolated home) | Exit 0: Reports native 2.1.250, clean unauthenticated state |

### Lack of Approved Isolated Account/Model Environment
No isolated sandbox API credentials or dummy model provider endpoint are configured for automated live model turns. In accordance with project instructions, **zero model turns were executed**, preserving provider credits, live project contexts, and external account states. Runtime qualification against live turns is deferred to Phase 06 in a designated test harness.

---

## 2. Documented vs. Actual Hook Schemas

### Codex CLI (0.158.0)
Static analysis of the `0.158.0` binary confirms 23 embedded Draft-07 JSON Schemas (`*.command.input` and `*.command.output`) defining the hook contract:

1. **`session-start.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'session_id', 'source', 'transcript_path']`  
   - `source` enum: `['startup', 'resume', 'clear', 'compact', 'fork']`  
   - `permission_mode` enum: `['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']`  
   - Note: No `turn_id`.
2. **`user-prompt-submit.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'prompt', 'session_id', 'transcript_path', 'turn_id']`  
   - Properties include optional: `agent_id`, `agent_type`.
3. **`pre-tool-use.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'session_id', 'tool_input', 'tool_name', 'tool_use_id', 'transcript_path', 'turn_id']`
4. **`permission-request.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'session_id', 'tool_input', 'tool_name', 'transcript_path', 'turn_id']`  
   - Note: Fires on permission prompt entry. NO resolution hook exists in 0.158.0.
5. **`post-tool-use.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'session_id', 'tool_input', 'tool_name', 'tool_response', 'tool_use_id', 'transcript_path', 'turn_id']`
6. **`pre-compact.command.input` & `post-compact.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'session_id', 'transcript_path', 'trigger', 'turn_id']`  
   - `trigger` enum: `['manual', 'auto']`
7. **`stop.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'last_assistant_message', 'model', 'permission_mode', 'session_id', 'stop_hook_active', 'transcript_path', 'turn_id']`  
   - `stop_hook_active`: boolean. Stop hook can return `decision: "block"` or exit code 2 with continuation reason; therefore `Stop` is a candidate transition, NOT authoritative completion.
8. **`interrupt.command.input`**  
   - Required: `['cwd', 'hook_event_name', 'model', 'permission_mode', 'session_id', 'transcript_path', 'turn_id']`
9. **`subagent-start.command.input` & `subagent-stop.command.input`**  
   - Required: `['agent_id', 'agent_type', ...]`
10. **`session-end.command.input`**  
    - Required: `['cwd', 'hook_event_name', 'reason', 'session_id', 'transcript_path']`  
    - `reason`: `{"const": "other", "type": "string"}`

### Claude Code (2.1.250)
Static analysis of the bundled JavaScript in `/home/loidinh/.local/share/claude/versions/2.1.250` reveals 31 hook event schemas defined in Zod registry `r2t`:

- **Common Base Schema (`Ie`)**:
  - `session_id: string` (required)
  - `transcript_path: string` (required)
  - `cwd: string` (required)
  - `prompt_id: string?` (optional; absent until first user prompt; joins with OTel `prompt.id`)
  - `permission_mode: string?`
  - `agent_id: string?` (subagent discriminator; absent for main thread)
  - `agent_type: string?`
  - `effort: string?`
- **Hook Events Verified (31)**:
  - Core lifecycle: `SessionStart` (source: `['startup', 'resume', 'clear', 'compact', 'fork']`), `SessionEnd` (reason: `['clear', 'resume', 'logout', 'prompt_input_exit', 'other']`), `UserPromptSubmit` (source: `['user', 'sdk', 'system', 'loop_wakeup', 'schedule_wakeup', 'poll_event']`), `Stop` (`stop_hook_active: boolean`, `last_assistant_message: string?`), `StopFailure` (`error: object`, `error_details: string?`).
  - Tools & permissions: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest` (`permission_suggestions: array?`), `PermissionDenied` (auto-mode only).
  - Notifications: `Notification` (`notification_type: string`, `message: string`, `title: string?`). Specific types include `permission_prompt` (delayed ~6s wait), `idle_prompt`, `agent_needs_input`.
  - Child agents: `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`.
  - Compaction & environment: `PreCompact`, `PostCompact`, `Setup`, `ConfigChange`, `InstructionsLoaded`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `FileChanged`, `DirectoryAdded`, `MessageDisplay`, `UserPromptExpansion`, `Elicitation`, `ElicitationResult`.
- **Key Gaps in 2.1.250**:
  - No general `Interrupt` / Escape hook (unlike Codex). Escape aborts turn without firing a hook.
  - No permission decision/resolution hook (neither manual approve nor manual deny).
  - `Stop` can continue turn (via `decision: "block"`, `additionalContext`, or exit code 2 up to 8 continuations).

---

## 3. Candidate event allowlist and semantic mapping (not runtime-qualified)

The table describes proposed mappings from static binary schemas, not observed event sequences. No mapping is enabled by this evidence alone; each requires an isolated live PTY turn and root/turn ordering proof. Without that proof, the effective status is Unknown and readiness is unverified.

| Native Event | Codex (0.158.0) Mapping | Claude Code (2.1.250) Mapping | Native Correlation ID | Mapped Agent Status | Attention Signal |
|---|---|---|---|---|---|
| **`SessionStart`** | Silent baseline | Silent baseline | `session_id` | `Unknown` (silent) | None |
| **`UserPromptSubmit`** | Root working start | Root working start | `session_id`, `turn_id` / `prompt_id` | `Working` | None |
| **`PreToolUse`** | Tool execution ongoing | Tool execution ongoing | `session_id`, `turn_id` / `prompt_id`, `tool_use_id` | `Working` | None |
| **`PostToolUse`** | Tool completed, turn active | Tool completed, turn active | `session_id`, `turn_id` / `prompt_id`, `tool_use_id` | `Working` | None |
| **`PostToolUseFailure`** | *N/A (not in Codex)* | Tool error, turn active | `session_id`, `prompt_id`, `tool_use_id` | `Working` | None |
| **`PermissionRequest`** | Candidate entry only | Candidate entry only | `session_id`, `turn_id` / `prompt_id` | `Unknown` (no prompt proof) | None |
| **`Notification(permission_prompt)`** | *N/A (not in Codex)* | Observed visible prompt wait | `session_id`, `prompt_id` | `Blocked` | Needs-attention |
| **`StopFailure`** | *N/A (not in Codex)* | Terminal API failure | `session_id`, `prompt_id` | `Blocked` | Needs-attention (error) |
| **`Stop`** | Settle candidate; can continue | Settle candidate; can continue | `session_id`, `turn_id` / `prompt_id` | `Unknown` (no completion alert) | None |
| **`Interrupt`** | Active turn aborted | *N/A (no hook in Claude)* | `session_id`, `turn_id` | `Idle` (expiring observation) | None |
| **`PreCompact` / `PostCompact`** | Compaction ongoing | Compaction ongoing | `session_id`, `turn_id` / `prompt_id` | `Working` (if within active turn) | None |
| **`SubagentStart` / `SubagentStop`** | Subagent work | Subagent work | `agent_id != null` | Ignored (root status unchanged) | None |
| **`SessionEnd`** | Terminal session exit | Terminal session exit | `session_id` | `Unknown` (release claim) | None |
| **Lease Expiry (15s)** | Automatic staleness bound | Automatic staleness bound | Terminal incarnation token | `Unknown` | None |

### Explicit Unknown Justifications
1. **Turn Settlement from `Stop`**: Both Codex and Claude allow Stop hooks to block termination, supply `additionalContext`, or trigger continuations (Claude supports up to 8 loops; Codex supports hook command return code 2). A bare `Stop` event does NOT prove user task completion.
2. **Permission Resolution**: Neither agent provides a hook when the user manually presses Enter/y/n to resolve a permission prompt. State must remain `Unknown` or expire via lease rather than guessing approval.
3. **Claude Interrupt**: Claude Code emits no event on Escape/Ctrl+C. The active observation lease expires to `Unknown` after 15 seconds.
4. **General Questions**: No native hook distinguishes assistant question prompts from standard text generation without parsing output text/heuristics (violating the design contract).

---

## 4. Privacy and Content-Free Evidence Contract

The proposed launcher and Rust report subcommand (`dam-hopper-server integration <codex|claude> report-hook`) must enforce strict content-free processing; neither is implemented in Phase 01:

- **Retained Metadata Only**:
  - `agent_kind`: `"codex"` or `"claude"`
  - `event`: native hook event name
  - `agent_session_id`: native session UUID string
  - `turn_id` / `prompt_id`: native turn UUID string (if present)
  - `agent_id`: string (used solely to drop subagent events where `agent_id != null`)
  - `source` / `reason` / `notification_type`: closed enums where specified
- **Discarded Without Materialization**:
  - `prompt`: user input text
  - `last_assistant_message`: assistant output text
  - `tool_input` and `tool_response`: arbitrary tool payloads
  - `transcript_path`: filesystem transcript reference
  - `cwd`: process working directory
  - `error` / `error_details`: raw exception messages (only closed category retained)
- **Root Process Validation**:
  - Root PID and start time ticks derived strictly via Linux `/proc/<pid>/stat` process ancestry traversal of the reporting launcher.
  - Native payload PID or environment PID labels are ignored.

---

## 5. Bounded Ingress, Lease, and Readiness Contract Decisions

Aligned with `design-contract.md`:

1. **Private Ingress Route**:
   - Proposed `POST /v1/agent-hooks` on the existing loopback listener.
   - Requires valid `Authorization: Bearer <terminal-incarnation-token>`.
   - Rejects non-loopback connections, browser Origin headers, and payload size > 4 KiB.
2. **Evidence Lease (15 Seconds)**:
   - Proposed accepted hook observations receive a 15-second evidence window (`observedAtMs` to `expiresAtMs`).
   - If no subsequent observation arrives within 15 seconds, status drops to `Unknown` without attention. Runtime native expiry remains Phase 02 work.
   - OMP's 5-second heartbeat / 15-second WebSocket connection lease remains untouched and authoritative.
3. **Readiness and Installation State Separation**:
   - Installation states: `absent | current | outdated | modified`.
   - Readiness states: `ready | restart-required | trust-required | policy-disabled | path-mismatch | permission-denied | unsupported-version | unverified`.
   - Physical file presence does not imply readiness.
4. **Notification Preference Persistence (v2 Migration)**:
   - Schema version bumped to `2`.
   - v1 settings (`omp`, `codex`) migrated with exact preserved values.
   - `claude` added with default `enabled: false`.
   - Future versions (`> 2`) rejected with fail-closed deserialization.
5. **OSC 9 Removal**:
   - Phase 05 must remove DamHopper's legacy Codex OSC 9 notification handler and automatic TUI sync. They remain active in Phase 01; no hook-derived turn completion alerts exist.

---

## 6. Correlation and runtime admission boundary

The static Codex schema requires `turn_id` for prompt/tool/Stop/Interrupt, but SessionStart and SessionEnd have only `session_id`. Claude's `prompt_id` is optional even on its common hook base. Static schemas do not establish callback delivery order, stable IDs across clear/resume, or whether child tool events omit `agent_id`. No content-free live root event sequence was captured. Consequently neither native provider has a runtime-approved state or attention allowlist yet.

Phase 02 must reserve a private envelope v1 with closed provider/event/reason fields, opaque session/turn/tool IDs and a random event ID; reject unknown versions, payloads over the 4 KiB normalized limit, unverified root ancestry and old incarnation tokens. Bound native stdin to 1 MiB without materializing prompt/tool/error text. On accepted ingress, assign a server epoch/sequence; deduplicate event IDs and fence retired session/turn IDs. A callback lacking a verified current turn may invalidate to Unknown but must not clear a later blocker or settle a turn. One `{terminalId, incarnation}` owner: live OMP connection cannot be displaced by a native report. OMP's reporter remains the only consumer of its persistent WebSocket protocol.

Native readiness remains `unverified` until exact binary, hook trust/effective policy, runtime config path, root identity and live reporting have all been checked. No status or attention should be emitted from a static schema alone.

## 7. Review addendum: reachable behavior and deferral gates

Phase 01 is a **contract-only** change. On Linux x86-64, the installed Codex `0.158.0` and Claude Code `2.1.250` binaries supplied static schemas and isolated unauthenticated CLI probes, **not** live hook callbacks. No native installation, ingress, root claim, runtime expiry, UI-ready status, or native attention was enabled. The private WebSocket collector rejects non-OMP hello kinds (`server/src/agent_status/collector.rs:193-200`); the reducer rejects native kinds on OMP's report protocol (`server/src/agent_status/reducer.rs:234-241`). The decoder rejects native `turn-ended` attention (`packages/ui/src/api/agent-status-types.ts`); no native Stop reaches the runtime. OMP lifecycle reports, blocker attention, settled turn ends, and heartbeat/non-refresh behavior remain covered by `server/src/agent_status/tests.rs` and the passing Rust suite.

The *existing* `codexCanEnable` flag in `server/src/api/agent_status.rs:214-254` checks only a matching path and `config.toml` presence. It is eligibility for the legacy notification path, **not native-hook readiness**; it must not be reused to certify hook trust, effective policy, root identity, or reporting. Claude has no corresponding ready flag. Existing `packages/ui/src/lib/terminal-agent-notification-integration.ts:172-193` registers an OSC 9 PTY parser; if the saved Codex legacy policy is enabled it can still issue history/toast/sound/browser alerts. This signal comes from terminal control text, **not a native Stop callback or a confirmed task/turn outcome**. `server/src/api/config.rs:430-440` still syncs Codex TUI notification config on toggle. None of these paths was introduced or removed in Phase 01. They are a reachable legacy limitation; users must not be told Codex native status or status-only alerts are delivered yet.

| Review warning | Phase 01 disposition | Activation prerequisite |
|---|---|---|
| False Codex native readiness and OSC9 completion interpretation | Legacy `codexCanEnable`/OSC9 must be named only as legacy notification eligibility, not native readiness/completion. **Not resolved for rollout.** | Phase 05 removes OSC9 parser/registration, TUI writes, and legacy notification claims; Phase 02/03 implement separate verified native admission/install readiness. |
| Hook expiry not exercised | DTO source/timestamps and 15s limit are specified; native observations cannot yet be admitted, so they cannot leave stale native Working/Blocked rows in Phase 01. | Phase 02 implements monotonic lease, accepted-observation refresh, fake-clock expiry and late-event fencing before admitting native reports. |
| Badge lacks limited-coverage/age label | No native row can be produced by current collector; OMP rows remain lifecycle-sourced. | Phase 05 adds hook-age/Unknown UI before native reporting is exposed by a matched server/UI rollout. |
| v1/OMP-only architecture text and pending phase tasks | Preserve the user's pre-existing `docs/architecture/agent-status.md` edits; do not mark native behavior implemented. This report records contract-only progress, not release qualification. | After review approval, docs/status owners update wording precisely; Phase 06 live PTY/browser runs gate release claims. |
| Formatter-expanded Rust diff | Formatter-only changes in unrelated files were removed; touched config files still carry substantial style churn. | Reviewer checks semantic diff; no new native behavior is authorized by formatting. |

Validation after implementation: `cargo test` 1,586 passed/5 ignored; UI unit 1,942 passed; UI browser 220 passed/4 skipped; UI TypeScript build passed. The four skipped browser cases require a server; no real native PTY/model turn or browser-native-hook check ran. Phase 06 must use an approved isolated account/environment to establish real event order, root/child attribution, trust/policy and end-to-end delivery. Until then, native readiness stays unverified.

## 8. Unresolved Questions

1. **Claude Code Subagent Hook Isolation**: When Claude Code invokes an internal feature agent (e.g. general-purpose subagent), does `Ie.agent_id` guarantee 100% discrimination across all 31 hook events in 2.1.250, or do certain tool events emit with `agent_id = null`?
2. **Codex Hook Trust Prompt**: When a managed hook is installed in `$CODEX_HOME/hooks.json`, does Codex 0.158.0 display an interactive `/hooks` trust review prompt on the first interactive run if `--dangerously-bypass-hook-trust` is not set? (Requires PTY scenario validation in Phase 06).
3. **Ancestry Resolution under Containerized Environments**: For environments where Linux PID namespaces mask parent PID ancestry between the hook launcher child and the PTY master, what is the exact fallback boundary (fail closed to `unverified` vs. PTY socket attribution)?
