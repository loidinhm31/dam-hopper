# Agent status — OMP-first architecture

Status: **OMP-first integration qualified on Linux x86_64 (2026-09-28). Codex and Claude native-hook rollout qualified on Linux x86_64 (2026-09-30; Codex 0.158.0 and Claude Code 2.1.250).** Updated: 2026-09-30.

The OMP integration defines the version-1 Rust contract and in-memory reducer/registry,
plus matching public TypeScript DTOs and decoders. It implements the
server-owned reporter runtime, private loopback collector, PTY-incarnation
credentials, protected snapshot, and semantic WebSocket pushes. It includes
the standalone OMP producer embedded in the server binary and an explicit
profile installer. The frontend provides profile-safe UI badges across tabs, split
tabs, and Fleet rows, unified preferences (`terminalAgentNotifications`),
toast viewport, and notification history center. Linux
qualification covers scenarios C01–C19.

The separate Codex and Claude rollout delivers contract definitions, private one-shot ingress and evidence leasing, managed installation, provider-version-specific event adapters, Agent Settings and notification ownership cutover, and Linux qualification (Codex 0.158.0; Claude Code 2.1.250 across scenarios N01–N32).
## Delivery Scope and Invariants

- OMP status badges in ordinary tabs, split tabs, and Fleet rows, plus per-browser history/toasts/sound/notifications, are operational. Codex native hooks provide status only and never generate notifications; Claude alerts are limited to qualified needs-attention events (approval, question, error), not normal turn-ended events. DamHopper's Codex OSC 9 integration and automatic Codex TUI notification-setting writes are removed; there is no OSC 9 fallback. Badges identify the agent and state, show explicit Unknown, and distinguish lifecycle from hook observations with limited-coverage context in the tooltip.
- Rust runtime and loopback listener are part of `dam-hopper-server`, not another daemon. The standalone OMP adapter is embedded with `include_str!` and runs inside OMP after explicit installation.
- Linux runtime qualification complete. Windows builds preserved; other server platforms report `platform-unqualified` until live qualification. Browser clients on other operating systems can observe a qualified Linux server.
- No Herdr dependency, VT renderer, screen heuristics, task-success automation, workflow mutation, suspend-policy change, telemetry ingestion, or generic adapter/plugin loader.

## End-to-end data flow

````text
installed managed OMP extension -- private loopback WebSocket --> AgentStatusRuntime
          ^                                                    |
PTY spawn injects scoped capability                             +-- protected REST snapshot
                                                               +-- authenticated browser WebSocket
                                                                        |
                                               app-root per-profile watcher
                                                                        |
                                               status store + notification service

The server binds the private collector to Linux loopback TCP and keeps it off the
public API router and tunnel discovery. A persistent local connection lets a
reporter disconnect invalidate status while its parent shell remains alive;
it avoids credentials in terminal output and avoids transcript parsing. The
bundled OMP reporter uses this channel; the browser consumer
and notification services connect over authenticated WebSocket and REST snapshot.

## Runtime identity and ownership

- Server runtime: random `serverEpoch` per process start; no persisted semantic status.
- Terminal: existing `{id, incarnation}`. Browser additionally supplies owning `{profileId, connectionGeneration}` locally, never trusts it from a remote server.
- Reporter: extension-generated `reporterId` per loaded root instance. Server assigns a monotonic `reporterEpoch` to every accepted connection.
- Agent session: opaque `agentSessionId`; never send native session file paths. Session switch resets turn/blocker state, without a completion event.
- Logical turn: adapter-generated `turnId`; continuations/retries keep the current logical turn until actual settle.
- One active reporter per terminal incarnation. Same reporter reconnect may atomically replace its old connection; a different reporter is rejected while the old one is live. Expiry, close, release or PTY retirement permits a new claimant.
- Every callback/close/timeout is fenced by captured terminal incarnation and reporter epoch. An old socket cannot clear or overwrite its replacement.
- This is scoped local reporting, not a sandbox against malicious code running as the same OS account. The adapter ignores `OMPCODE=1` nested sessions and non-main agent contexts to avoid accidental parent overwrites; capabilities do not prove model truth.

## Implemented semantic contract v1

Version 1 uses camelCase JSON. Rust `ReporterHello` and `ReporterReport` reject
unknown fields; server identifiers are non-empty, ASCII graphic, and at most
128 bytes. Sequence, epoch, incarnation, and revision counters are capped at
JavaScript's safe-integer maximum (`9,007,199,254,740,991`). The UI public
decoders validate bounded non-empty strings, closed enums, protocol version,
and nonnegative safe integers; they do not reject unknown object fields. Public
`AgentKind` includes `omp`, `codex`, and `claude`. The persistent WebSocket reporter protocol remains OMP-only; Codex and Claude use separate bounded one-shot hook ingress. Neither path proves provider truth.

### State

`unknown | idle | working | blocked`.

- `unknown`: no authoritative semantic state, including initial admission, release, disconnect, or lease expiry.
- `idle`: connected agent ready for input.
- `working`: active turn, continuation, retry, or active context maintenance.
- `blocked`: awaiting approval/question, or terminal agent error requiring attention.

Process alive/exited/crashed and terminal receiving/quiet remain separate. No semantic `done` or `success` state. Status badges use the labels Unknown, Idle, Running, and Needs attention; they identify the agent and distinguish lifecycle from hook observations, with limited-coverage context for hooks. A turn-ended notification is not task-success verification.

### Implemented private reporter connection

Listener: `127.0.0.1:0`, fixed route `/v1/agent-status`, WebSocket upgrade. Endpoint injected only into managed PTY child environment.

- Authenticate before upgrade with `Authorization: Bearer <terminal-capability>`; credential identifies exactly one current incarnation. Reject browser `Origin`, wrong Host, non-loopback peer and unexpected path/query. No cookies, CORS, query tokens or use of global server credentials.
- Client sends hello: `{version:1, agentKind:"omp", reporterId, agentSessionId, adapterVersion}`. Unknown protocol/agent versions receive explicit rejection, not silent success.
- Server accepts with `{kind:"accepted", serverEpoch, reporterEpoch, heartbeatMs:5000, leaseMs:15000}`. Admission is complete only after this acknowledgement.
- Reports define outcomes `ended | interrupted | error | unknown` for settled `turn-ended` events. Snapshots may carry an optional outcome but remain silent and do not emit attention.
- State-bearing heartbeat every 5 seconds; lease expires after 15 seconds without a valid current-epoch report. Heartbeats are extension-level, not automatic WebSocket pongs, so a hung extension cannot remain authoritative merely because the runtime answers pings.
- Every accepted report is validated, applied serially, and acknowledged by sequence. Identical duplicate sequences are idempotent, stale lower sequences are ignored, and conflicting duplicates are rejected. No application-level report queue; frames cap at 4 KiB and per-reporter rate is 20/s with burst 40.
- Reporter disconnect/release immediately marks status unknown; missing heartbeats expire after 15 seconds. Neither creates turn-ended attention. WebSocket protocol pings do not renew the semantic lease.
- Reconnect delays (250 ms, 500 ms, 1 s, 2 s, then 5 s), one outstanding attempt, and retry policy belong to the OMP adapter. Retry transport admission only, never AI work.

### Implemented reducer and DTO contract

`TerminalAgentReducer` and `AgentStatusRegistry` implement the transition
model in memory without I/O or timers. The registry keys rows by terminal ID
and incarnation; reporter epochs fence replacements, and sequence handling
ignores lower values, accepts exact duplicates idempotently, and rejects
conflicting duplicates. Reports are validated before they update the row.

- Duplicate starts for the same active working turn are idempotent.
- Transitioning from unblocked to blocked (approval, question, or error) emits one `needs-attention`; further blocked reports do not re-notify.
- A normal `turn-ended` attention requires an observed current turn with a matching ID. `ended` becomes idle and emits `turn-ended`; `interrupted` becomes idle without normal completion; `error` becomes blocked/error and emits `needs-attention` only for a matching turn; `unknown` emits no completion attention.
- Snapshots are silent baselines. Unmatched ends, session switches, release, authority loss, and lease expiry do not create normal completion attention.
- Record a terminal-local `attentionRevision` with each accepted attention event. Attention ID includes server epoch, terminal ID, incarnation and attention revision. Keep at most the latest attention summary in the status snapshot, not an event archive.
- Snapshot revision advances for row membership, availability, or semantic status changes; identical heartbeats do not advance it. PTY removal removes its row. Credentials and raw reports never enter public state.

The `AgentStatusSnapshotV1` DTO defines `{version, serverEpoch, revision, availability, terminals:[{id, incarnation, agentKind, agentSessionId, reporterEpoch, state, source, observedAtMs?, expiresAtMs?, reason?, turnId?, attentionRevision, lastOutcome?}]}`. `source` is `lifecycle | hook`; `observedAtMs` and `expiresAtMs` are optional freshness metadata. The protected `GET /api/agent-status/v1/snapshot` route is implemented. Plain shells do not gain an Unknown row; `availability` distinguishes ready, unavailable, and platform-unqualified.

Changed, removed, and invalidated payloads are broadcast through the existing
authenticated browser WebSocket. The 256-event stream sends invalidation after
receiver lag; the browser consumer applies pushes and fetches
a fresh snapshot after invalidation or a revision gap.

The OMP status implementation is in `server/src/agent_status/{types.rs,reducer.rs,tests.rs}`,
exported through `mod.rs` and `server/src/lib.rs`; public TypeScript DTOs and
decoders are in `packages/ui/src/api/agent-status-types.ts`, with focused
decoder tests in `agent-status-types.test.ts`.

The public Rust and TypeScript status DTOs include `omp`, `codex`, and `claude`,
plus `source`, `observedAtMs`, and `expiresAtMs`. The UI decoder treats a missing
`source` on a legacy OMP row as `lifecycle`; native `hook` rows require safe
observation/expiry timestamps for non-Unknown state, with expiry later than
observation. Unknown hook rows have no expiry; lifecycle rows cannot expire.
A separate private one-shot Codex/Claude ingress is provided through
`server/src/agent_status/{hook_reporter.rs,hook_ingress.rs}`; accepted native
evidence uses the 15-second lease, while the persistent WebSocket collector
continues to admit OMP only. Native ingress does not qualify event mappings;
Codex and Claude lifecycle adapters handle provider events.
Reducer test cases exercise normal turns, blockers, continuation/cancellation,
outcomes, session switches, sequence/epoch fences, reconnect, leases, and
retirement. Server integration lives in
`server/src/agent_status/{runtime.rs,collector.rs}`, `server/src/api/agent_status.rs`,
`server/src/api/{router.rs,ws.rs,ws_protocol.rs}`, `server/src/pty/manager.rs`,
`server/src/state.rs`, and `server/src/main.rs`; lifecycle/socket coverage is in
`server/tests/agent_status_runtime.rs` and focused PTY/API tests.
Native infrastructure handles private hook ingress and managed installation without qualifying unobserved provider lifecycle behavior.

## Implemented PTY/runtime lifecycle

- On Linux, initialize one runtime and bind the private listener before PTY restore. Share the stable runtime with AppState and PtySessionManager. Bind failure leaves ordinary terminal operation available and status unavailable; other server platforms report `platform-unqualified`.
- For initial create and automatic respawn, reserve a credential after allocating incarnation and before spawn. Inject `DAM_HOPPER_AGENT_STATUS_URL` and `DAM_HOPPER_AGENT_STATUS_TOKEN` directly into the private `CommandBuilder` after user environment and shell integration setup.
- The runtime infers terminal identity from the credential. No public terminal or profile credential is supplied to the reporter.
- Credential names are reserved, including case-insensitive matching on Windows. Apply credentials only to the spawned child; never persist them in PTY options, respawn templates, session metadata, SQLite, diagnostics, or command strings. Strip stale inherited status variables when unavailable.
- Credentials remain pending until the PTY is published live, then activate. Pending admission gets retryable service-unavailable; failed or cancelled publication revokes via the reservation guard. PTY retirement, replacement, kill, exit, and shutdown revoke status authority. Callbacks are fenced by incarnation and reporter epoch.
- Runtime mutations are short and state-only; no network/file I/O under the PTY manager lock. Collector handlers do not acquire the manager lock while holding runtime state.
- Collector bind/admission failure disables reporting, not terminals. No credential is injected when unavailable; listener is not restarted mid-incarnation with a new endpoint.
- No output-byte parsing, process-tree polling, or transcript copying. Runtime state tracks managed terminal records, with one socket per claimed terminal.
- Private frames/messages cap at 4 KiB; hello deadline 3 s; pre-auth concurrency 32; report rate 20/s (burst 40); semantic broadcast capacity 256. Invalid reports are rejected; transport failure affects only that reporter and status becomes unknown.

## Standalone OMP adapter and installation

The standalone adapter is embedded in the existing `dam-hopper-server` binary.
Testing was performed against OMP 18.3.5, and full Linux
end-to-end qualification passed with OMP 18.4.1. Other OMP
versions have not received this full qualification. The installed file is
`extensions/dam-hopper-agent-status.ts`; it has no runtime package dependency.

- The extension is dormant unless both server-injected
  `DAM_HOPPER_AGENT_STATUS_URL` and `DAM_HOPPER_AGENT_STATUS_TOKEN` are valid.
  It accepts only a loopback WebSocket URL at `/v1/agent-status`, without URL
  credentials or query parameters, and a nonempty printable-ASCII token of at
  most 128 characters.
- It connects only for interactive UI sessions (`ctx.hasUI === true`), skips
  `OMPCODE=1`, and ignores a known non-`main` agent context. OMP outside a
  managed DamHopper PTY has no injected capability and does not report.
- `session_start` snapshots `ctx.isIdle()`; `session_switch` clears blockers and
  the prior logical turn before a new snapshot. `agent_start` begins or
  continues a logical turn. `agent_end.willContinue` never settles it.
- Approval blockers use tool-call IDs; question blockers use tool-call IDs for
  the `ask` tool. Resolution is idempotent. OMP retry and compaction keep
  activity working; retry completion alone is not turn completion.
- A non-continuing `agent_end` settles after 250 ms, cancelled by a newer start
  or session switch. The adapter inspects only the last assistant
  `stopReason`: `stop` → `ended`, `aborted` → `interrupted`, `error` → `error`;
  missing or unsupported reasons → `unknown`. It sends no message or prompt
  text. Turn end does not prove task success.
- One reporter connection sends a current-state heartbeat every 5 seconds.
- Connection failures retry after 250 ms, 500 ms, 1 s, 2 s, then 5 s intervals;
  server rejection stops retries. Reconnect sends a current snapshot, not missed
  historical events. Shutdown closes the socket and clears timers without
  waiting on the network.

`--agent-dir` is required and must name an existing absolute OMP agent
directory. Run the CLI as the OS user whose OMP sessions run in DamHopper
PTYs. For OMP's default profile, pass `$HOME/.omp/agent`; named/custom
profiles need their explicit agent-directory path.

```text
dam-hopper-server integration omp install --agent-dir <absolute-agent-dir>
dam-hopper-server integration omp status --agent-dir <absolute-agent-dir>
dam-hopper-server integration omp uninstall --agent-dir <absolute-agent-dir>
````

`--json` is optional for each action. These local integration commands dispatch
before server token, database, and listener startup; they do not require normal
server configuration or a running server.

- `install` writes or upgrades only the managed extension using a same-directory
  atomic write; current content is a no-op. It refuses modified or unmanaged
  contents, symlinks, and nonregular targets.
- `status` reports `absent`, `current`, `outdated`, or `modified`, plus version,
  path, and content-hash metadata; it does not expose credentials.
- `uninstall` removes only a hash-verified managed extension, refuses modified
  or unmanaged contents, and never removes Herdr or other extensions.
- Install/update does not alter OMP global configuration. OMP must load
  extensions, and existing OMP sessions must restart to load a new installation.

Duplicate `turn-ended` reports on inactive turns are guarded in `omp-agent-status.ts`; CRLF headers are normalized across LF and CRLF in `server/src/agent_status/integration.rs`.

Implementation and focused tests: `server/src/agent_status/assets/omp-agent-status.ts`,
`server/src/agent_status/integration.rs`, `server/src/main.rs`,
`server/tests/omp-agent-status.test.ts`, and
`server/tests/agent_status_integration.rs`.
## Frontend, reconnect, and notifications

- One app-root bridge mounted in `packages/ui/src/embed/dam-hopper-app.tsx`, beside the existing notification viewport, watches connected profiles. Not in TerminalPanel or KeepAliveHost.
- Reconcile every 15 seconds while connected and immediately on invalidation/reconnect. Coalesce fetches; reject results from retired connection generation/server epoch. No endpoint retry loop on 404: mark unsupported for that connection.
- Key status by existing profile + terminal incarnation identity. On profile disconnect show unavailable for previously known agents and stop notification delivery. Clear on profile removal/server epoch replacement. Local status is not durable truth.
- Dedupe attention IDs before history, toast, sound and browser service. Reconnect snapshots establish a silent baseline, even if lastOutcome says ended. Keep only bounded per-terminal cursors; remove with terminal/profile lifecycle.
- Per-client notifications only. Two devices may each notify; closed browser receives no push and no catch-up toast. Existing enabled-channel policy stays “always,” including focused terminals; no new focus suppression/view acknowledgement or server-side seen state in this delivery.
- Preserve the current output dot and process icon; the semantic agent badge is separate at TerminalTabBar, split TabBar, and TerminalRuntimeNavigatorItem. Badges use human-readable agent/state labels, show Unknown explicitly, and identify hook source and limited coverage in the tooltip.
- Reuse notification store, toast viewport, sound and browser service. Qualify shared browser rate-limit keys/tags and selection targets by profile and incarnation. This does not claim exactly-once OS delivery.
- Consolidate preferences under `terminalAgentNotifications: {version:2, agents:{codex:policy, omp:policy, claude:policy}}`; each policy contains `enabled`, `toast`, `browser`, `sound`, `volume`, and `pattern`. Version-1 migration preserves Codex and OMP channel values and adds Claude disabled; older Codex aliases still normalize once. OMP defaults off when no policy exists; badges remain independent of notification preferences. Write/export only the new shape, remove obsolete in-memory fields/callers, and avoid a dual-write shim. Add policies for other agents only with real adapters.

### Traditional navigator presentation

Traditional mode adds a separate Agents list after Projects, scoped to admitted observations in currently open, alive terminal incarnations across registered profiles. It retains the original status DTO and source/limited-coverage context. The display subscribes to existing status/profile/connection stores; no new polling, ingress, terminal-content parsing, notifications or backend state is introduced.

This list uses **Working** for `working`; existing terminal badges retain their current vocabulary. **Idle**, **Needs attention** (Approval/Question/Error) and **Unknown** preserve reducer meaning. The secondary **Done (turn ended)** hint requires ready current-owner evidence, nonexpired `idle`, explicit `lastOutcome: ended` and no current `turnId`. Interrupted/failed/expired/unavailable evidence never shows it. Silent snapshots may retain historical hints without sending alerts; notification policy does not gate roster status.

Canonical qualified UI terminal IDs are projected to raw server metadata only at the display's builder boundary after exact identity agreement. Mounted/tab ownership, concrete incarnation and status identity must agree; stale callbacks cannot activate replacements. Settings links carry the selected registered project owner; ownerless Settings requires choice and invalid/disconnected/removed owners cannot mount query-bearing UI. `WorkspacePage` keeps the sole `TerminalKeepAliveHost` stable above responsive shell switches. See [runtime qualification report](../../plans/261008-0233-traditional-terminal-agents-sidebar/reports/04-runtime-qualification.md) for full qualification matrix results across OMP, Codex, and Claude; prior backend version qualifications do not certify newer installed CLIs.


## Agent Store path verification

- The Agent Store's **Agent Settings** tab replaces the former Integrations tab and Appearance notification panel. It configures OMP, Codex, and Claude paths for the selected server profile; installation state and runtime readiness are shown separately. `agentSettingsPaths` and v2 `terminalAgentNotifications` are persisted in that server's global UI config. Status badges remain independent of notification policy.
- The UI requests `GET /api/agent-status/paths?agentDir=...&codexDir=...&claudeDir=...`. The response reports configured/runtime paths, OMP managed-extension status, Codex configuration/hook presence, Claude settings-file presence, and per-agent `canEnable`/reason fields. `~/` expands against `service_user` or `plugin_owner_user` from `/etc/dam-hopper/host.toml` when resolvable, otherwise the API process home (`/` is the fallback); relative paths and `..` components are rejected.
- Runtime directories come from absolute `PI_CODING_AGENT_DIR`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR` values in the server process environment when set; otherwise they are `<effective-home>/.omp/agent`, `<effective-home>/.codex`, and `<effective-home>/.claude`. The endpoint does not inspect per-PTY `HOME` or other per-terminal environment.
- Enable-toggle eligibility requires exact configured/runtime path equality after `~/` expansion; paths are not filesystem-canonicalized. OMP also requires the managed extension to be `current`. Codex configuration presence is informational: Codex notification enablement is unsupported because Codex is status-only. Claude requires a matching path and native hook readiness `ready`.
- Global-config updates recheck OMP path/current-extension status and Claude path/hook readiness before accepting enabled policies, and reject enabled Codex notifications. They do not synchronize Codex TUI notification settings.
- **Saved notification policies are not revalidated against filesystem paths at dispatch.** Agent Settings gates enablement using current verification and the server validates eligible saves, but browser dispatch checks the current connection, matching status/attention identity, agent policy, and saved `enabled` flag. An external path or hook change does not itself revoke a saved policy.
- Filesystem reads/writes run with API-service OS permissions. Linux production defaults to `dam-hopper`; it receives no automatic access to a separate PTY user's home or agent directory. `~` only selects the server-side home resolution above; it does not switch identity or grant permissions.

## Subsystem invariants and release gates

- No report can write another terminal's state, execute input, alter workflow, or authorize host actions.
- No false completion from silence, reconnect, stale epoch, root shutdown, unsupported outcomes, missed events or crashes.
- Privacy: generic notification text only; no credentials, questions, commands, transcripts, session file paths or provider errors in reports/logs.
- Linux x86_64 qualification covers OMP 18.4.1 across scenarios C01–C19, including live OMP/browser behavior and standalone binary installation.
- The persistent private WebSocket collector admits only OMP. Codex and Claude use separate one-shot hook ingress and managed installation, native event adapters, Agent Settings, notification ownership, and removal of Codex OSC 9/TUI notification integration. Live Linux qualification is complete for Codex 0.158.0 and Claude Code 2.1.250 across scenarios N01–N32.

## Codex and Claude native-hook integration

Design date: 2026-09-29.
The integration uses ordinary CLI native hooks with explicit Unknown for gaps,
not screen detection or a controlled app-server launch mode. It delivers a frozen contract,
private one-shot ingress and 15-second evidence expiry, managed installation,
provider-version-specific Codex/Claude event adapters and conservative normalization,
Agent Settings, installation/readiness presentation, notification ownership,
version-2 policy migration, and complete Codex OSC 9 and automatic TUI
notification-setting removal. OMP reporter and lifecycle semantics remain unchanged.

Linux x86_64 live native lifecycle qualification is complete for Codex CLI
0.158.0 and Claude Code 2.1.250 across scenarios N01–N32.
### Managed installation and removal

The server binary provides local Codex and Claude install, status, and uninstall
commands. Each action requires an existing absolute native configuration
directory; `--json` is optional. These commands dispatch before normal server
authentication, database, and listener startup:

```text
dam-hopper-server integration codex install --agent-dir <absolute-agent-dir>
dam-hopper-server integration codex status --agent-dir <absolute-agent-dir>
dam-hopper-server integration codex uninstall --agent-dir <absolute-agent-dir>
dam-hopper-server integration claude install --agent-dir <absolute-agent-dir>
dam-hopper-server integration claude status --agent-dir <absolute-agent-dir>
dam-hopper-server integration claude uninstall --agent-dir <absolute-agent-dir>
```

The protected API exposes `GET`, `POST`, and `DELETE` on
`/api/agent-status/integrations/{agent}` for `codex` or `claude`.
`agentDir` is a query parameter for status/uninstall and a camelCase JSON
property for install. Without it, absolute `CODEX_HOME` or `CLAUDE_CONFIG_DIR`
values are used, falling back to `<effective-home>/.codex` or
`<effective-home>/.claude`. CLI and API dispatch through the same managers.

Implementation spans `server/src/agent_status/{integration.rs,codex_integration.rs,claude_integration.rs,assets/native-agent-status.sh}`,
`server/src/api/{agent_status.rs,router.rs,error.rs}`, `server/src/error.rs`, and
`server/src/main.rs`; lifecycle coverage is in
`server/tests/agent_status_integration.rs` and
`server/tests/agent_status_runtime.rs`. The Cycle 2 review scored 9.5/10 and
recorded 87 passing agent-status test executions.

- Codex uses an existing `hooks.json`; if absent, an existing `config.toml`
  `[hooks]` table is updated in place, otherwise `hooks.json` is the target.
  Claude registrations merge into `settings.json`. Existing user hooks,
  unrelated settings, and sibling matchers are preserved.
- Install stages a packaged-binary launcher and ownership manifest, then
  registers hooks. Per-file writes are atomic. The manifest records the exact
  launcher hash and managed entries/assets; symlinks, malformed/oversized
  configuration, and locally modified owned launchers are rejected.
- Uninstall removes managed registrations before the verified launcher and
  manifest, preserves user-owned configuration, and removes only files and
  empty directories recorded as created by DamHopper. Modified managed assets
  or conflicting entries are reported rather than overwritten or deleted.
- Installation state (`absent`, `current`, `outdated`, `modified`) is reported
  separately from runtime readiness. A current install is not proof of hook
  trust, policy eligibility, loaded configuration, or qualified live reporting.
  Codex `/hooks` trust remains user-controlled; Claude policy is not bypassed.
- Native applications may cache hook configuration in active sessions. Reload or
  restart affected sessions after install/removal; until then, do not claim that
  cached invocations are impossible. OMP installation and event semantics are
  unchanged.

### Native event adapters and ingress

The adapters implement the event inventories for Codex CLI 0.158.0
and Claude Code 2.1.250. Live qualification verified these versions on Linux
x86_64; other provider versions and operating systems remain unqualified.
Managed registrations and normalizers use these provider-specific allowlists:

| Provider    | Qualified events                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`, `Interrupt`, `SessionEnd`                                         |
| Claude Code | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `PostCompact`, `Notification`, `Stop`, `StopFailure`, `SessionEnd` |

Each native callback invokes
`dam-hopper-server integration {codex|claude} report-hook` before ordinary
server startup. The reporter reads at most 1 MiB from stdin, canonicalizes
allowlisted event-name spellings, validates opaque session/turn/tool IDs, and
captures only the fields needed for status. Prompt and tool content, assistant
messages, transcript paths, working directories, and free-form errors are
discarded. It creates a private envelope capped at 4 KiB with a fresh event ID,
provider/session/turn metadata, and process identity/ancestry, then posts it to
`/v1/agent-hooks` over the local Unix socket with a 250 ms deadline and no
retry. The managed hook fails silently; it never blocks or changes the native
agent's decision.

The server revalidates the envelope, checks the socket peer against the
reported reporter process, and verifies `/proc` process identities and ancestry
from the native CLI through the registered PTY shell. The reducer fences
callbacks by native root, session, exact current turn, retired identities, and
event ID. Unknown, missing, stale, or unmatched causal evidence cannot settle a
turn. Native hook status uses the existing 15-second evidence lease.

- **Subagents:** Presence of either `agent_id` or `agent_type` in the native
  payload rejects that callback before reporting, regardless of its value.
  Server ancestry verification also rejects nested Codex or Claude CLIs between
  the reporter and PTY shell, including a different provider nested inside the
  claimed root. Child callbacks never update root status.
- **Codex:** Status-only; it emits no `Blocked` state or attention. Prompt,
  tool, and compaction activity with the current turn ID indicate `Working`.
  A matching `PermissionRequest` or `Stop` invalidates certainty to `Unknown`;
  `Stop` preserves the current turn ID for a possible continuation. A matching
  `Interrupt` settles to `Idle` with `interrupted` outcome, not a completion
  alert. Codex has no qualified notification, `StopFailure`, or
  `PostToolUseFailure` mapping.
- **Claude Code:** For the matching current turn, `Notification(permission_prompt)`
  maps to `Blocked/approval`, `Notification(agent_needs_input)` to
  `Blocked/question`, and `StopFailure` to `Blocked/error`. Repeated
  notifications for the same blocked reason do not emit repeated attention.
  Claude notifications are attention-only: qualified approval, question, and
  error events can alert; normal turn-ended alerts are not supported.
  `PermissionRequest` and `PreToolUse(AskUserQuestion)` are candidates only and
  become `Unknown`, not a guessed wait. A tool failure alone is not a terminal
  agent error. Claude has no native `Interrupt` on Escape/Ctrl+C; without
  renewed evidence, status expires to `Unknown`.
- **Parallel blockers:** Claude blocker notifications retain supplied tool-call
  IDs. Later matching `PreToolUse`, `PostToolUse`, or `PostToolUseFailure`
  callbacks clear only the blocker with that ID; unrelated parallel tool IDs
  leave other blockers active. `Working` resumes only after all tracked
  blockers resolve. If a resolving callback lacks an ID, the reducer prefers
  `Unknown` over guessing.
- **Continuation and Stop:** `Stop` is only a settle candidate. For the exact
  current turn it sets `Unknown` and retains the turn identity; it emits no
  normal turn-ended/completion attention and schedules no fixed settle timer.
  Only a later qualified event for that turn (such as tool or compaction
  activity) can resume `Working`; a new prompt with a new turn ID can establish
  a new turn after uncertainty. Delayed or mismatched callbacks cannot settle
  either turn.

Implementation: `server/src/agent_status/{codex_hooks.rs,claude_hooks.rs,hook_reporter.rs,hook_ingress.rs,reducer.rs}`;
focused coverage is in `server/src/agent_status/tests.rs` and
`server/tests/agent_status_hooks.rs`.

### Native qualification status and remaining gates

- Linux x86_64 end-to-end qualification is complete for Codex CLI 0.158.0 and Claude Code 2.1.250 across all 32 acceptance scenarios (N01–N32). Windows and other non-Linux server platforms remain runtime platform-unqualified. Future native agent versions require re-qualification against this test ledger before claiming support.
Sources: [Codex hooks](https://developers.openai.com/codex/hooks/),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Herdr's differing screen-authority model](https://herdr.dev/docs/agents/).

## Unresolved questions

None for the Linux x86_64 release path against OMP 18.4.1, Codex 0.158.0, and Claude Code 2.1.250. Windows and other non-Linux server runtimes, plus other agent versions, remain unqualified; Linux evidence does not establish those platform/version combinations.
