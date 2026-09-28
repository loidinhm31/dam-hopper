# Agent status — OMP-first architecture

Status: **Phases 01–03 implemented; Phases 04–05 planned**. Date: 2026-09-28.
Plan: [OMP-first agent status](../../plans/260928-0318-agent-status-omp-first/plan.md).
Evidence: [brainstorm](../../plans/reports/brainstorm-260928-0300-herdr-agent-status-adoption.md), [review](../../plans/260928-0318-agent-status-omp-first/reports/report-review.md).

Phase 01 defines the version-1 Rust contract and in-memory reducer/registry,
plus matching public TypeScript DTOs and decoders. Phase 02 implements the
server-owned reporter runtime, private loopback collector, PTY-incarnation
credentials, protected snapshot, and semantic WebSocket pushes. Phase 03 adds
the standalone OMP producer embedded in the server binary and an explicit
profile installer. Browser consumption, badges, and notifications remain
Phases 04–05.

## Remaining scope and delivery (Phases 04–05 planned)

- The semantic contract is designed to be agent-neutral; `AgentKind` currently supports only OMP. Codex/others remain future work if needed.
- Status badges in ordinary tabs, split tabs, and Fleet terminal rows; per-browser history/toasts/sound/notifications remain planned.
- Rust runtime and loopback listener are part of `dam-hopper-server`, not another daemon. The standalone OMP adapter is embedded with `include_str!` and runs inside OMP after explicit installation.
- Linux runtime qualification first. Preserve Windows builds; other server platforms report `platform-unqualified` until live qualification. Browser clients on other operating systems can observe a qualified Linux server.
- No Herdr dependency, VT renderer, screen heuristics, task-success automation, workflow mutation, suspend-policy change, telemetry ingestion, or generic adapter/plugin loader.

## End-to-end data flow (Phases 02–03 server and OMP producer implemented; browser consumer pending)

```text
installed managed OMP extension -- private loopback WebSocket --> AgentStatusRuntime
          ^                                                    |
PTY spawn injects scoped capability                             +-- protected REST snapshot
                                                               +-- authenticated browser WebSocket
                                                                        |
                                               future app-root per-profile watcher
                                                                        |
                                               future status store + notification service

Phase 02 binds the private collector to Linux loopback TCP and keeps it off the
public API router and tunnel discovery. A persistent local connection lets a
reporter disconnect invalidate status while its parent shell remains alive;
it avoids credentials in terminal output and avoids transcript parsing. The
Phase 03 bundled OMP reporter uses this channel; the browser consumer remains
planned.

## Runtime identity and ownership (Phases 02–03 server/adapter; browser ownership planned)

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
and nonnegative safe integers; they do not reject unknown object fields. `omp`
is the only current agent kind.

### State

`unknown | idle | working | blocked`.

- `unknown`: no authoritative semantic state, including initial admission, release, disconnect, or lease expiry.
- `idle`: connected agent ready for input.
- `working`: active turn, continuation, retry, or active context maintenance.
- `blocked`: awaiting approval/question, or terminal agent error requiring attention.

Process alive/exited/crashed and terminal receiving/quiet remain separate. No semantic `done` or `success` state. Planned UI labels: Unknown, Idle, Running, Needs attention. A turn-ended notification is not task-success verification.

### Implemented private reporter connection (Phase 02)

Listener: `127.0.0.1:0`, fixed route `/v1/agent-status`, WebSocket upgrade. Endpoint injected only into managed PTY child environment.

- Authenticate before upgrade with `Authorization: Bearer <terminal-capability>`; credential identifies exactly one current incarnation. Reject browser `Origin`, wrong Host, non-loopback peer and unexpected path/query. No cookies, CORS, query tokens or use of global server credentials.
- Client sends hello: `{version:1, agentKind:"omp", reporterId, agentSessionId, adapterVersion}`. Unknown protocol/agent versions receive explicit rejection, not silent success.
- Server accepts with `{kind:"accepted", serverEpoch, reporterEpoch, heartbeatMs:5000, leaseMs:15000}`. Admission is complete only after this acknowledgement.
- Reports define outcomes `ended | interrupted | error | unknown` for settled `turn-ended` events. Snapshots may carry an optional outcome but remain silent and do not emit attention.
- State-bearing heartbeat every 5 seconds; lease expires after 15 seconds without a valid current-epoch report. Heartbeats are extension-level, not automatic WebSocket pongs, so a hung extension cannot remain authoritative merely because the runtime answers pings.
- Every accepted report is validated, applied serially, and acknowledged by sequence. Identical duplicate sequences are idempotent, stale lower sequences are ignored, and conflicting duplicates are rejected. No application-level report queue; frames cap at 4 KiB and per-reporter rate is 20/s with burst 40.
- Reporter disconnect/release immediately marks status unknown; missing heartbeats expire after 15 seconds. Neither creates turn-ended attention. WebSocket protocol pings do not renew the semantic lease.
- Reconnect delays (250 ms, 500 ms, 1 s, 2 s, then 5 s), one outstanding attempt, and retry policy belong to the Phase 03 adapter. Retry transport admission only, never AI work.

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

The `AgentStatusSnapshotV1` DTO defines `{version, serverEpoch, revision, availability, terminals:[{id, incarnation, agentKind, agentSessionId, reporterEpoch, state, reason?, turnId?, attentionRevision, lastOutcome?}]}`. The protected `GET /api/agent-status/v1/snapshot` route is implemented. Plain shells do not gain an Unknown row; `availability` distinguishes ready, unavailable, and platform-unqualified.

Changed, removed, and invalidated payloads are broadcast through the existing authenticated browser WebSocket as `terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, and `terminal:agentStatusInvalidated`. The 256-event stream sends invalidation after receiver lag; clients reconcile from the snapshot. Browser consumption and resnapshot handling remain Phase 04 work.

Phase 01 implementation: `server/src/agent_status/{types.rs,reducer.rs,tests.rs}`,
exported through `mod.rs` and `server/src/lib.rs`; public TypeScript DTOs and
decoders are in `packages/ui/src/api/agent-status-types.ts`, with focused
decoder tests in `agent-status-types.test.ts`. `client.ts` adds OMP to the
existing terminal-agent type union; it does not wire status transport.
Reducer test cases exercise normal turns, blockers, continuation/cancellation,
outcomes, session switches, sequence/epoch fences, reconnect, leases, and
retirement. Phase 02 server integration lives in
`server/src/agent_status/{runtime.rs,collector.rs}`, `server/src/api/agent_status.rs`,
`server/src/api/{router.rs,ws.rs,ws_protocol.rs}`, `server/src/pty/manager.rs`,
`server/src/state.rs`, and `server/src/main.rs`; lifecycle/socket coverage is in
`server/tests/agent_status_runtime.rs` and focused PTY/API tests. Phase 02
verification passed with 100% test success. See the
[Phase 01 plan](../../plans/260928-0318-agent-status-omp-first/phase-01-semantic-contract-and-reducer.md)
and [Phase 02 plan](../../plans/260928-0318-agent-status-omp-first/phase-02-reporter-transport-and-pty-lifecycle.md).

## Implemented PTY/runtime lifecycle (Phase 02)

- On Linux, initialize one runtime and bind the private listener before PTY restore. Share the stable runtime with AppState and PtySessionManager. Bind failure leaves ordinary terminal operation available and status unavailable; other server platforms report `platform-unqualified`.
- For initial create and automatic respawn, reserve a credential after allocating incarnation and before spawn. Inject `DAM_HOPPER_AGENT_STATUS_URL` and `DAM_HOPPER_AGENT_STATUS_TOKEN` directly into the private `CommandBuilder` after user environment and shell integration setup.
- The runtime infers terminal identity from the credential. No public terminal or profile credential is supplied to the reporter.
- Credential names are reserved, including case-insensitive matching on Windows. Apply credentials only to the spawned child; never persist them in PTY options, respawn templates, session metadata, SQLite, diagnostics, or command strings. Strip stale inherited status variables when unavailable.
- Credentials remain pending until the PTY is published live, then activate. Pending admission gets retryable service-unavailable; failed or cancelled publication revokes via the reservation guard. PTY retirement, replacement, kill, exit, and shutdown revoke status authority. Callbacks are fenced by incarnation and reporter epoch.
- Runtime mutations are short and state-only; no network/file I/O under the PTY manager lock. Collector handlers do not acquire the manager lock while holding runtime state.
- Collector bind/admission failure disables reporting, not terminals. No credential is injected when unavailable; listener is not restarted mid-incarnation with a new endpoint.
- No output-byte parsing, process-tree polling, or transcript copying. Runtime state tracks managed terminal records, with one socket per claimed terminal.
- Private frames/messages cap at 4 KiB; hello deadline 3 s; pre-auth concurrency 32; report rate 20/s (burst 40); semantic broadcast capacity 256. Invalid reports are rejected; transport failure affects only that reporter and status becomes unknown.

## Implemented standalone OMP adapter and installation (Phase 03)

The adapter is a standalone TypeScript extension embedded in the existing
`dam-hopper-server` binary. Its qualification target is installed OMP 18.3.5;
other OMP versions remain unqualified. The installed file is
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

The server-host CLI requires an existing absolute OMP agent directory. Run it
as the OS user whose OMP sessions run inside DamHopper PTYs; the default is
`$HOME/.omp/agent`, while named/custom profiles require their own explicit path.

```text
dam-hopper-server integration omp install --agent-dir <absolute-agent-dir>
dam-hopper-server integration omp status --agent-dir <absolute-agent-dir>
dam-hopper-server integration omp uninstall --agent-dir <absolute-agent-dir>
```

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

- Open Phase 03 review findings: a late inactive `agent_end` may emit duplicate
  `turn-ended` reports; CRLF headers may misclassify managed extensions during
  updates. Resolve before end-to-end release qualification; see the
  [Phase 03 plan](../../plans/260928-0318-agent-status-omp-first/phase-03-omp-adapter-and-installer.md).

Implementation and focused tests: `server/src/agent_status/assets/omp-agent-status.ts`,
`server/src/agent_status/integration.rs`, `server/src/main.rs`,
`server/tests/omp-agent-status.test.ts`, and
`server/tests/agent_status_integration.rs`. See the
[Phase 03 plan](../../plans/260928-0318-agent-status-omp-first/phase-03-omp-adapter-and-installer.md).

## Planned frontend, reconnect, and notifications (Phase 04)

- One app-root bridge mounted in `packages/ui/src/embed/dam-hopper-app.tsx`, beside the existing notification viewport, watches connected profiles. Not in TerminalPanel or KeepAliveHost.
- Subscribe before requesting initial snapshot. Buffer at most 256 incoming semantic messages during baseline; install snapshot revision R, discard messages <= R, then apply newer ones. This suppresses historical attention while preserving events genuinely newer than baseline. Overflow/invalid data/gap => resnapshot without replay alerts.
- Reconcile every 15 seconds while connected and immediately on invalidation/reconnect. Coalesce fetches; reject results from retired connection generation/server epoch. No endpoint retry loop on 404: mark unsupported for that connection.
- Key status by existing profile + terminal incarnation identity. On profile disconnect show unavailable for previously known agents and stop notification delivery. Clear on profile removal/server epoch replacement. Local status is not durable truth.
- Dedupe attention IDs before history, toast, sound and browser service. Reconnect snapshots establish a silent baseline, even if lastOutcome says ended. Keep only bounded per-terminal cursors; remove with terminal/profile lifecycle.
- Per-client notifications only. Two devices may each notify; closed browser receives no push and no catch-up toast. Existing enabled-channel policy stays “always,” including focused terminals; no new focus suppression/view acknowledgement or server-side seen state in this delivery.
- Preserve current output dot and process icon. Add separate compact semantic badge, accessible text/tooltip and non-color cue, at TerminalTabBar, split TabBar and TerminalRuntimeNavigatorItem. No project aggregation or new dashboard.
- Reuse notification store, toast viewport, sound and browser service. Qualify shared browser rate-limit keys/tags and selection targets by profile and incarnation. This does not claim exactly-once OS delivery.
- Consolidate preferences under `terminalAgentNotifications: {version:1, agents:{codex:policy, omp:policy}}`; policy contains enabled/toast/browser/sound/volume/pattern. OMP master defaults off; badges independent of notification preference. Preserve Codex channel values by migrating existing `terminalCodex*` fields and the older Codex alias once at hydration/normalization. Explicit new shape wins. Write/export only the new shape; remove obsolete in-memory fields/callers, no dual-write shim. Other agents' policies are added only with real adapters.

## Cross-phase invariants and release gates

- No report can write another terminal's state, execute input, alter workflow, or authorize host actions.
- No false completion from silence, reconnect, stale epoch, root shutdown, unsupported outcomes, missed events or crashes.
- Privacy: generic notification text only; no credentials, questions, commands, transcripts, session file paths or provider errors in reports/logs.
- Initial qualification includes real Linux OMP lifecycle, packaged server embedding/installer, browser surfaces, reconnect and multi-profile identity. Unit tests alone are insufficient.
- Phase 01 recognizes only OMP as an agent kind. Codex behavior, screen reconstruction and universal agent support are not delivered.

## Unresolved questions

None requiring a product decision. OMP 18.3.5 live event ordering, extension reload cleanup and packaged install paths remain mandatory implementation qualification evidence, not claims established by this design.
