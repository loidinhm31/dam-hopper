# Agent status — proposed OMP-first architecture

Status: **planned, not implemented**. Date: 2026-09-28.
Plan: [OMP-first agent status](../../plans/260928-0318-agent-status-omp-first/plan.md).
Evidence: [brainstorm](../../plans/reports/brainstorm-260928-0300-herdr-agent-status-adoption.md), [review](../../plans/260928-0318-agent-status-omp-first/reports/report-review.md).

## Scope and delivery

- Agent-neutral semantic status; OMP interactive root session is first producer. Codex/others later, only if needed.
- Status badges in ordinary tabs, split tabs, and Fleet terminal rows. Existing history/toasts/sound/browser notification service; per browser-client delivery.
- Rust runtime and loopback listener are part of `dam-hopper-server`, not another daemon. Bundle standalone OMP TypeScript adapter with `include_str!`; it executes inside OMP after explicit installation.
- Linux runtime qualification first. Preserve Windows builds; other server platforms report `platform-unqualified` until live qualification. Browser clients on other operating systems can observe a qualified Linux server.
- No Herdr dependency, VT renderer, screen heuristics, task-success automation, workflow mutation, suspend-policy change, telemetry ingestion, or generic adapter/plugin loader.

## Data flow

```text
managed OMP extension -- private loopback WebSocket --> AgentStatusRuntime
          ^                                              |
PTY spawn injects terminal-scoped capability              +-- protected REST snapshot
                                                         +-- existing browser WebSocket
                                                                  |
                                                  app-root per-profile watcher
                                                                  |
                                                  status store + notification service
```

A persistent local connection is preferred over OSC or per-event HTTP. It avoids credential-bearing terminal output and lets disconnect invalidate OMP activity even while its parent shell remains alive. Loopback TCP avoids Linux-only Unix-socket paths and Windows named-pipe branches. This listener is not exposed by the public API router or tunnel discovery.

## Identity and ownership

- Server runtime: random `serverEpoch` per process start; no persisted semantic status.
- Terminal: existing `{id, incarnation}`. Browser additionally supplies owning `{profileId, connectionGeneration}` locally, never trusts it from a remote server.
- Reporter: extension-generated `reporterId` per loaded root instance. Server assigns a monotonic `reporterEpoch` to every accepted connection.
- Agent session: opaque `agentSessionId`; never send native session file paths. Session switch resets turn/blocker state, without a completion event.
- Logical turn: adapter-generated `turnId`; continuations/retries keep the current logical turn until actual settle.
- One active reporter per terminal incarnation. Same reporter reconnect may atomically replace its old connection; a different reporter is rejected while the old one is live. Expiry, close, release or PTY retirement permits a new claimant.
- Every callback/close/timeout is fenced by captured terminal incarnation and reporter epoch. An old socket cannot clear or overwrite its replacement.
- This is scoped local reporting, not a sandbox against a malicious process running as the same OS account. Nested-session guards prevent accidental parent overwrites; capabilities are not proof of model truth.

## Semantic contract v1

CamelCase JSON, strict decode, unknown fields rejected for private reporter messages. Numeric sequence/revision values must be nonnegative safe integers on both sides; overflow invalidates authority rather than wrapping.

### State

`unknown | idle | working | blocked`.

- `unknown`: no trustworthy live reporter, disconnected, expired, or malformed/unsupported reporting.
- `idle`: connected agent ready for input.
- `working`: active turn, continuation, retry, or active context maintenance.
- `blocked`: awaiting approval/question, or terminal agent error requiring attention.

Process alive/exited/crashed and terminal receiving/quiet remain separate. No semantic `done` or `success` state. UI labels: Unknown, Idle, Running, Needs attention. A turn-ended notification is not task-success verification.

### Private connection

Listener: `127.0.0.1:0`, fixed route `/v1/agent-status`, WebSocket upgrade. Endpoint injected only into managed PTY child environment.

- Authenticate before upgrade with `Authorization: Bearer <terminal-capability>`; credential identifies exactly one current incarnation. Reject browser `Origin`, wrong Host, non-loopback peer and unexpected path/query. No cookies, CORS, query tokens or use of global server credentials.
- Client sends hello: `{version:1, agentKind:"omp", reporterId, agentSessionId, adapterVersion}`. Unknown protocol/agent versions receive explicit rejection, not silent success.
- Server accepts with `{kind:"accepted", serverEpoch, reporterEpoch, heartbeatMs:5000, leaseMs:15000}`. Admission is complete only after this acknowledgement.
- Reporter sends `{kind:"report", seq, event, state, agentSessionId, turnId?, outcome?, blockedReason?}`. Events: `snapshot`, `turn-started`, `state-changed`, `turn-ended`, `session-changed`, `heartbeat`, `release`.
- Outcomes only for explicit settled `turn-ended`: `ended | interrupted | error | unknown`. Block reasons are closed codes `approval | question | error`; no prompt, command, transcript or raw provider-error text.
- State-bearing heartbeat every 5 seconds; lease expires after 15 seconds without a valid current-epoch report. Heartbeats are extension-level, not automatic WebSocket pongs, so a hung extension cannot remain authoritative merely because the runtime answers pings.
- Acknowledge accepted report sequence; duplicate identical sequence is idempotent, stale lower sequence is ignored, conflicting duplicate is rejected. Reports have a bounded in-flight queue. If the queue overflows or transport fails, discard notification history, mark unknown, reconnect with a fresh snapshot; never replay completed turns as fresh alerts.
- Release/connection close immediately marks unknown and clears active authority. Timeout bounds missing-cleanup behavior. Neither creates a turn-ended notification.
- Reconnect delays: 250 ms, 500 ms, 1 s, 2 s, then 5 s, one outstanding connection attempt; stop on retired/invalid capability or shutdown. Retry only transport admission, never AI work. On pending spawn or occupied reporter, bounded backoff may retry while OMP remains alive.

### Reducer and public view

The reducer validates event/state consistency. Notifications require explicit events, not a difference between snapshots:

- `turn-started` establishes current turn. Duplicate start while same turn active is not a second turn.
- Approval/question transition from not blocked to blocked produces one `needs-attention`; changing blocker count does not repeatedly notify.
- `turn-ended` requires the observed current turn. `ended` => idle plus one `turn-ended` attention event. `interrupted` => idle, no normal completion alert. `error` => blocked/error plus one error attention event. `unknown` => unknown, no completion alert.
- Missing/unmatched end, initial idle, reconnect snapshot, session switch, socket release, terminal death and lease expiry never produce normal completion alerts.
- Record a terminal-local `attentionRevision` with each accepted attention event. Attention ID includes server epoch, terminal ID, incarnation and attention revision. Keep at most the latest attention summary in the status snapshot, not an event archive.
- State revision increments only on semantic/availability change, not identical heartbeats. PTY removal increments snapshot revision and removes its row. Credentials and raw reports never enter public state.

Protected endpoint: `GET /api/agent-status/v1/snapshot` returns `{version, serverEpoch, revision, availability, terminals:[{id, incarnation, agentKind, agentSessionId, reporterEpoch, state, reason?, turnId?, attentionRevision, lastOutcome?}]}`. Include only observed agent rows; plain shells do not gain an Unknown badge. `availability` distinguishes ready, unavailable and platform-unqualified.

Browser push: `terminal:agentStatusChanged` carries the current row plus optional attention event, server epoch and snapshot revision. Removal is explicit. `terminal:agentStatusInvalidated` forces reconciliation after channel lag. Use a dedicated bounded semantic broadcast stream pumped into the existing authenticated browser socket; never route it through PTY output parsing. Snapshot is authoritative.

## PTY/runtime lifecycle

- Initialize stable runtime and bind local listener before persisted PTYs are restored. Share one runtime handle with AppState and the PTY manager; avoid per-terminal runtimes.
- For both initial create and automatic respawn, reserve a credential after allocating incarnation and before spawn. Apply `DAM_HOPPER_AGENT_STATUS_URL` and `DAM_HOPPER_AGENT_STATUS_TOKEN` directly to the private `CommandBuilder` after user env merge.
- The runtime infers terminal identity from the credential; no public terminal identifiers or profile credentials need to be supplied by the extension.
- Reserved names cannot be user-overridden, case-insensitively on Windows. Never store them in `PtyCreateOpts.env`, `RespawnOpts.env`, SessionMeta, SQLite, diagnostics or command strings. Suppress inherited stale status credentials when feature is unavailable.
- Before PTY publication, credentials are pending: reject/defer reporter admission without publishing state. Activate on committed live publication; revoke on spawn failure, cancelled/disposed create, replacement, kill, exit and shutdown. Reader/supervisor callbacks must match incarnation.
- Maintain existing lock ordering: short state-only runtime mutations; no network/file I/O under PTY manager lock; collector handlers never acquire the manager lock while holding runtime state.
- Binding/admission failure disables status, not terminals. No injected credential when runtime unavailable. Do not auto-restart the listener mid-incarnation using a new endpoint; recover at server restart so child environment remains coherent.
- No per-output-byte parsing, process-tree polling or transcript copying. State memory scales with current managed terminal records, with one socket per claimed terminal and bounded queues.
- Bound private frames/messages to 4 KiB, hello deadline 3 s, pre-auth connection concurrency 32, report rate 20/s per reporter (burst 40), semantic broadcast capacity 256. Failure closes only offending reporter; unknown is safer than silently dropped state.

## OMP adapter and installation

Qualification target: installed OMP 18.3.5. No claim of historical minimum or automatic compatibility with future versions. Protocol/adapter version is independent of OMP version.

- Standalone TS default extension factory; type-only OMP imports, no runtime third-party dependencies. Use OMP's Bun WebSocket support with Authorization header.
- Activate only when valid injected endpoint/token exist, `ctx.hasUI === true`, and `OMPCODE !== "1"`. No network side effect outside managed root interactive sessions; print/RPC/subagents excluded from initial scope.
- `session_start`: snapshot from `ctx.isIdle()`, not a synthetic start/end. `session_switch`: clear pending settle, blockers and logical turn, then snapshot.
- `agent_start`: mark working and establish/reuse logical turn. `agent_end.willContinue === true`: remain working; never report settlement.
- Approval blockers keyed by `{agentSessionId, "approval", toolCallId}`. Ask blockers keyed by `{agentSessionId, "ask", toolCallId}`; only tool name `ask`. Resolution/deletion is idempotent, including denial and cancellation.
- Use `auto_retry_start/end` and `auto_compaction_start/end` where they represent active work. Retry success ends retry hold, not the user turn. Final failure remains needs-attention; cancellation must not become a successful finish.
- Non-continuing `agent_end`: inspect last assistant `stopReason`. `stop` maps to ended; `aborted` to interrupted; `error` to error; `length`, `toolUse`, absent/unsupported outcome to unknown unless current documented semantics prove a safe mapping. Never transmit message content.
- Settle debounce 250 ms, cancelled by a newer start/continuation/session switch. Do not copy Herdr's retryable-error regex or assume a fixed 2.5-second provider retry window. True OMP retry state can last longer.
- Shutdown closes connection and clears timers without waiting for network. Rebinding/reloading releases the previous reporter; duplicate installations must be detected/documented rather than repeatedly stealing authority.

Planned server CLI:

```text
dam-hopper-server integration omp install --agent-dir /absolute/omp/profile/agent
dam-hopper-server integration omp status --agent-dir /absolute/omp/profile/agent
dam-hopper-server integration omp uninstall --agent-dir /absolute/omp/profile/agent
```

Explicit target avoids guessing named profile/custom homes. Default target example: `$HOME/.omp/agent`; named profile example: `$HOME/.omp/profiles/work/agent`; `PI_CODING_AGENT_DIR` users supply that directory explicitly. Run as the same OS user whose OMP runs in server PTYs, on the server host, not merely the browser machine.

- CLI branch exits before server token generation, workspace/database initialization or listeners. Do not change privileged Linux release-manager CLI.
- Install exactly `extensions/dam-hopper-agent-status.ts`, embedded in the server binary. No global config mutation, shell wrapper, package-manager install, additional daemon or separate deploy asset.
- Atomic same-directory write; refuse symlink/nonregular target and refuse overwriting locally modified/unmanaged contents. Include managed version/content-hash marker; status reports absent/current/outdated/modified, without secrets. Update by rerunning install; uninstall only verified managed file. Never remove Herdr or other extensions.
- New/restarted OMP sessions load it; already-running pre-integration sessions remain unknown/untracked until restarted. `--no-extensions` disables auto-discovery; explicit `-e` remains an opt-in escape hatch.

## Frontend, reconnect, notifications

- One app-root bridge mounted in `packages/ui/src/embed/dam-hopper-app.tsx`, beside the existing notification viewport, watches connected profiles. Not in TerminalPanel or KeepAliveHost.
- Subscribe before requesting initial snapshot. Buffer at most 256 incoming semantic messages during baseline; install snapshot revision R, discard messages <= R, then apply newer ones. This suppresses historical attention while preserving events genuinely newer than baseline. Overflow/invalid data/gap => resnapshot without replay alerts.
- Reconcile every 15 seconds while connected and immediately on invalidation/reconnect. Coalesce fetches; reject results from retired connection generation/server epoch. No endpoint retry loop on 404: mark unsupported for that connection.
- Key status by existing profile + terminal incarnation identity. On profile disconnect show unavailable for previously known agents and stop notification delivery. Clear on profile removal/server epoch replacement. Local status is not durable truth.
- Dedupe attention IDs before history, toast, sound and browser service. Reconnect snapshots establish a silent baseline, even if lastOutcome says ended. Keep only bounded per-terminal cursors; remove with terminal/profile lifecycle.
- Per-client notifications only. Two devices may each notify; closed browser receives no push and no catch-up toast. Existing enabled-channel policy stays “always,” including focused terminals; no new focus suppression/view acknowledgement or server-side seen state in this delivery.
- Preserve current output dot and process icon. Add separate compact semantic badge, accessible text/tooltip and non-color cue, at TerminalTabBar, split TabBar and TerminalRuntimeNavigatorItem. No project aggregation or new dashboard.
- Reuse notification store, toast viewport, sound and browser service. Qualify shared browser rate-limit keys/tags and selection targets by profile and incarnation. This does not claim exactly-once OS delivery.
- Consolidate preferences under `terminalAgentNotifications: {version:1, agents:{codex:policy, omp:policy}}`; policy contains enabled/toast/browser/sound/volume/pattern. OMP master defaults off; badges independent of notification preference. Preserve Codex channel values by migrating existing `terminalCodex*` fields and the older Codex alias once at hydration/normalization. Explicit new shape wins. Write/export only the new shape; remove obsolete in-memory fields/callers, no dual-write shim. Other agents' policies are added only with real adapters.

## Invariants and release gates

- No report can write another terminal's state, execute input, alter workflow, or authorize host actions.
- No false completion from silence, reconnect, stale epoch, root shutdown, unsupported outcomes, missed events or crashes.
- Privacy: generic notification text only; no credentials, questions, commands, transcripts, session file paths or provider errors in reports/logs.
- Initial qualification includes real Linux OMP lifecycle, packaged server embedding/installer, browser surfaces, reconnect and multi-profile identity. Unit tests alone are insufficient.
- Agent-neutral data contracts are delivered now; Codex behavior, screen reconstruction and universal agent support are explicitly not delivered.

## Unresolved questions

None requiring a product decision. OMP 18.3.5 live event ordering, extension reload cleanup and packaged install paths remain mandatory implementation qualification evidence, not claims established by this design.
