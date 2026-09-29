# Agent status — OMP-first architecture

Status: **OMP-first Phases 01–05 complete (Linux x86_64 qualified 2026-09-28). The separate Codex/Claude native-hook rollout has Phases 01–03 delivered; Phases 04–06 remain pending. Native lifecycle behavior is not yet qualified.** Updated: 2026-09-29.
OMP-first plan: [OMP-first agent status](../../plans/260928-0318-agent-status-omp-first/plan.md).
The Phase 01 contract and static capability review installed no hooks or ran native model turns. Phase 03 managed installation is now implemented, but no live Codex/Claude provider behavior has been qualified.
OMP baseline evidence: [qualification report](../../plans/reports/qualification-260928-1815-agent-status-omp.md), [brainstorm](../../plans/reports/brainstorm-260928-0300-herdr-agent-status-adoption.md), [review](../../plans/260928-0318-agent-status-omp-first/reports/report-review.md).

OMP-first Phase 01 defines the version-1 Rust contract and in-memory reducer/registry,
plus matching public TypeScript DTOs and decoders. Phase 02 implements the
server-owned reporter runtime, private loopback collector, PTY-incarnation
credentials, protected snapshot, and semantic WebSocket pushes. Phase 03 adds
the standalone OMP producer embedded in the server binary and an explicit
profile installer. Phase 04 delivers profile-safe UI badges across tabs, split
tabs, and Fleet rows, unified preferences (`terminalAgentNotifications`),
toast viewport, and notification history center. Phase 05 delivers full Linux
end-to-end qualification across scenarios C01–C19.

The separate Codex/Claude rollout has delivered the approved Phase 01 contract, Phase 02 private one-shot ingress and 15-second evidence lease, and Phase 03 managed installation/status/update/uninstall. Native event adapters, Agent Settings/notification cutover, and live Linux qualification (Phases 04–06) remain pending; no live native provider turns have been qualified.

## Delivery Scope and Invariants

- OMP status badges in ordinary tabs, split tabs, and Fleet rows, plus per-browser history/toasts/sound/notifications, are operational. Codex notifications still use legacy OSC 9; this is neither native readiness nor verified turn completion. No native UI badge freshness is presented.
- Rust runtime and loopback listener are part of `dam-hopper-server`, not another daemon. The standalone OMP adapter is embedded with `include_str!` and runs inside OMP after explicit installation.
- Linux runtime qualification complete. Windows builds preserved; other server platforms report `platform-unqualified` until live qualification. Browser clients on other operating systems can observe a qualified Linux server.
- No Herdr dependency, VT renderer, screen heuristics, task-success automation, workflow mutation, suspend-policy change, telemetry ingestion, or generic adapter/plugin loader.

## End-to-end data flow (Phases 01–05 implemented)

```text
installed managed OMP extension -- private loopback WebSocket --> AgentStatusRuntime
          ^                                                    |
PTY spawn injects scoped capability                             +-- protected REST snapshot
                                                               +-- authenticated browser WebSocket
                                                                        |
                                               app-root per-profile watcher (Phase 04)
                                                                        |
                                               status store + notification service (Phase 04)

Phase 02 binds the private collector to Linux loopback TCP and keeps it off the
public API router and tunnel discovery. A persistent local connection lets a
reporter disconnect invalidate status while its parent shell remains alive;
it avoids credentials in terminal output and avoids transcript parsing. The
Phase 03 bundled OMP reporter uses this channel; the Phase 04 browser consumer
and notification services connect over authenticated WebSocket and REST snapshot.

## Runtime identity and ownership (Phases 01–05 complete)

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
`AgentKind` includes `omp`, `codex`, and `claude`. The persistent WebSocket reporter protocol remains OMP-only; Codex and Claude use the separate bounded one-shot hook ingress delivered in Phase 02. Neither path proves provider truth.

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

The `AgentStatusSnapshotV1` DTO defines `{version, serverEpoch, revision, availability, terminals:[{id, incarnation, agentKind, agentSessionId, reporterEpoch, state, source, observedAtMs?, expiresAtMs?, reason?, turnId?, attentionRevision, lastOutcome?}]}`. `source` is `lifecycle | hook`; `observedAtMs` and `expiresAtMs` are optional freshness metadata. The protected `GET /api/agent-status/v1/snapshot` route is implemented. Plain shells do not gain an Unknown row; `availability` distinguishes ready, unavailable, and platform-unqualified.

Changed, removed, and invalidated payloads are broadcast through the existing
authenticated browser WebSocket. The 256-event stream sends invalidation after
receiver lag; Phase 04's completed browser consumer applies pushes and fetches
a fresh snapshot after invalidation or a revision gap.

OMP-first Phase 01 implementation: `server/src/agent_status/{types.rs,reducer.rs,tests.rs}`,
exported through `mod.rs` and `server/src/lib.rs`; public TypeScript DTOs and
decoders are in `packages/ui/src/api/agent-status-types.ts`, with focused
decoder tests in `agent-status-types.test.ts`.

The public Rust and TypeScript status DTOs include `omp`, `codex`, and `claude`,
plus `source`, `observedAtMs`, and `expiresAtMs`. The UI decoder treats a missing
`source` on a legacy OMP row as `lifecycle`; native `hook` rows require safe
observation/expiry timestamps for non-Unknown state, with expiry later than
observation. Unknown hook rows have no expiry; lifecycle rows cannot expire.
Phase 02 adds a separate private one-shot Codex/Claude ingress through
`server/src/agent_status/{hook_reporter.rs,hook_ingress.rs}`; accepted native
evidence uses the 15-second lease, while the persistent WebSocket collector
continues to admit OMP only. Native ingress does not qualify event mappings;
Codex/Claude lifecycle adapters remain Phase 04 work.
Reducer test cases exercise normal turns, blockers, continuation/cancellation,
outcomes, session switches, sequence/epoch fences, reconnect, leases, and
retirement. OMP-first Phase 02 server integration lives in
`server/src/agent_status/{runtime.rs,collector.rs}`, `server/src/api/agent_status.rs`,
`server/src/api/{router.rs,ws.rs,ws_protocol.rs}`, `server/src/pty/manager.rs`,
`server/src/state.rs`, and `server/src/main.rs`; lifecycle/socket coverage is in
`server/tests/agent_status_runtime.rs` and focused PTY/API tests. See the
[OMP Phase 01 plan](../../plans/260928-0318-agent-status-omp-first/phase-01-semantic-contract-and-reducer.md)
and [OMP Phase 02 plan](../../plans/260928-0318-agent-status-omp-first/phase-02-reporter-transport-and-pty-lifecycle.md).
The separate Codex/Claude [Phase 01 contract](../../plans/260929-0140-agent-status-codex-claude/phase-01-capabilities-and-observation-contract.md),
[Phase 02 ingress plan](../../plans/260929-0140-agent-status-codex-claude/phase-02-private-hook-ingress.md),
and [Phase 03 managed installation plan](../../plans/260929-0140-agent-status-codex-claude/phase-03-managed-hook-installation.md)
document delivered native infrastructure. They do not qualify provider lifecycle behavior.

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

The standalone adapter is embedded in the existing `dam-hopper-server` binary.
Phase 03 implementation evidence used OMP 18.3.5; Phase 05 full Linux
end-to-end and release qualification passed with OMP 18.4.1. Other OMP
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

- Resolved Phase 03 review findings: duplicate `turn-ended` reports on inactive turns
  are guarded in `omp-agent-status.ts`; CRLF headers are normalized across LF and CRLF
  in `server/src/agent_status/integration.rs`. Both verified in Phase 04/05 qualification.

Implementation and focused tests: `server/src/agent_status/assets/omp-agent-status.ts`,
`server/src/agent_status/integration.rs`, `server/src/main.rs`,
`server/tests/omp-agent-status.test.ts`, and
`server/tests/agent_status_integration.rs`. See the
[Phase 03 plan](../../plans/260928-0318-agent-status-omp-first/phase-03-omp-adapter-and-installer.md).

## Frontend, reconnect, and notifications (Phase 04)
- One app-root bridge mounted in `packages/ui/src/embed/dam-hopper-app.tsx`, beside the existing notification viewport, watches connected profiles. Not in TerminalPanel or KeepAliveHost.
- Subscribe before requesting initial snapshot. Buffer at most 256 incoming semantic messages during baseline; install snapshot revision R, discard messages <= R, then apply newer ones. This suppresses historical attention while preserving events genuinely newer than baseline. Overflow/invalid data/gap => resnapshot without replay alerts.
- Reconcile every 15 seconds while connected and immediately on invalidation/reconnect. Coalesce fetches; reject results from retired connection generation/server epoch. No endpoint retry loop on 404: mark unsupported for that connection.
- Key status by existing profile + terminal incarnation identity. On profile disconnect show unavailable for previously known agents and stop notification delivery. Clear on profile removal/server epoch replacement. Local status is not durable truth.
- Dedupe attention IDs before history, toast, sound and browser service. Reconnect snapshots establish a silent baseline, even if lastOutcome says ended. Keep only bounded per-terminal cursors; remove with terminal/profile lifecycle.
- Per-client notifications only. Two devices may each notify; closed browser receives no push and no catch-up toast. Existing enabled-channel policy stays “always,” including focused terminals; no new focus suppression/view acknowledgement or server-side seen state in this delivery.
- Preserve the current output dot and process icon; the OMP semantic badge is separate at TerminalTabBar, split TabBar and TerminalRuntimeNavigatorItem. Native source/freshness presentation is not implemented.
- Reuse notification store, toast viewport, sound and browser service. Qualify shared browser rate-limit keys/tags and selection targets by profile and incarnation. This does not claim exactly-once OS delivery.
- Consolidate preferences under `terminalAgentNotifications: {version:2, agents:{codex:policy, omp:policy, claude:policy}}`; each policy contains `enabled`, `toast`, `browser`, `sound`, `volume`, and `pattern`. Version-1 migration preserves Codex and OMP channel values and adds Claude disabled; older Codex aliases still normalize once. OMP defaults off when no policy exists; badges remain independent of notification preferences. Write/export only the new shape, remove obsolete in-memory fields/callers, and avoid a dual-write shim. Add policies for other agents only with real adapters.

## Agent Store path verification

- The Agent Store's **Agent Settings** tab replaces the former Integrations tab for agent setup and the former Appearance agent-notification panel. It uses one OMP install path and one Codex config path for the selected server profile. Global `agentSettingsPaths` also persists optional `claudeDir`, but the current Agent Settings UI and path-verification endpoint do not configure or verify Claude readiness. `agentSettingsPaths` and `terminalAgentNotifications` are persisted in that server's global UI config. Status badges remain independent of notification policy.
- The UI asks the selected server for `GET /api/agent-status/paths?agentDir=...&codexDir=...`. The response contains configured and runtime paths, OMP managed-extension status, Codex `config.toml` or `hooks.json` file-presence state, and per-agent `canEnable`/reason fields. `~/` is expanded against the home of `service_user` or `plugin_owner_user` from `/etc/dam-hopper/host.toml` when resolvable, otherwise against the API process's home (`/` is the endpoint fallback if no home can be resolved). Relative paths and `..` components are rejected.
- Runtime directories come from absolute `PI_CODING_AGENT_DIR` and `CODEX_HOME` values in the server process environment when set; otherwise they are `<effective-home>/.omp/agent` and `<effective-home>/.codex`. This endpoint does not inspect per-PTY `HOME` or other per-terminal environment.
- **Enable-toggle eligibility requires strict path matching:** each configured directory must compare equal to its distinct runtime directory after `~/` expansion; paths are not filesystem-canonicalized. OMP also requires the managed extension status `current`. Codex path eligibility accepts either `config.toml` or `hooks.json` passing `is_file`; this presence check does not establish read access or syntax validity.
- The global-config update path separately rechecks OMP path equality and current-extension status before persisting an enabled OMP policy. Codex persistence requires the configured `config.toml` to exist, then sync reads and parses it on a master-policy transition; the config update path does not independently compare the Codex directory with `CODEX_HOME`.
- **Existing enabled policies are not revalidated at notification dispatch.** Agent Settings gates the enable control using the latest path verification, but runtime dispatch reads the saved `enabled` flag. A path/config/installation change can therefore make the UI control appear unchecked/disabled while leaving the saved policy enabled and delivery active; this is not fail-closed dispatch-time revalidation.
- Filesystem reads/writes run with API-service OS permissions. Linux production defaults to `dam-hopper`; it receives no automatic access to a separate PTY user's home or Codex directory. `~` only selects the server-side home resolution above; it does not switch identity or grant permissions.

## Cross-phase invariants and release gates

- No report can write another terminal's state, execute input, alter workflow, or authorize host actions.
- No false completion from silence, reconnect, stale epoch, root shutdown, unsupported outcomes, missed events or crashes.
- Privacy: generic notification text only; no credentials, questions, commands, transcripts, session file paths or provider errors in reports/logs.
- Phase 05 qualified the Linux x86_64 release path against OMP 18.4.1 across
  C01–C19, including live OMP/browser behavior and standalone binary installation.
  See the [qualification report](../../plans/reports/qualification-260928-1815-agent-status-omp.md).
- The persistent private WebSocket collector admits only OMP. Codex and Claude have a separate Phase 02 one-shot ingress and Phase 03 managed installer; native event adapters, settings/notification cutover, and live qualification are not delivered.

## Codex and Claude native-hook rollout — Phases 01–03 delivered; Phases 04–06 pending

Design date: 2026-09-29. [Rollout plan](../../plans/260929-0140-agent-status-codex-claude/plan.md).
The user selected ordinary CLI native hooks with explicit Unknown for gaps,
not Herdr-style screen detection or a controlled app-server launch mode. Phase 01
froze the contract; Phase 02 delivered private one-shot ingress, incarnation and
generation fencing, and 15-second evidence expiry; Phase 03 delivered the
managed installation lifecycle. OMP reporter/lifecycle semantics remain unchanged.
No Codex/Claude event adapter, Agent Settings/notification cutover, or live
provider qualification has shipped; no live native model turns have been run.

### Managed installation and removal (Phase 03 delivered)

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
`<effective-home>/.claude`. CLI and API dispatch through the same managers. See
the [Phase 03 plan](../../plans/260929-0140-agent-status-codex-claude/phase-03-managed-hook-installation.md)
and [Cycle 2 review](../../plans/reports/code-review-260929-0953-phase-03-managed-installation-and-complete-removal.md).

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

### Remaining native rollout gates

- Phase 04 adds exact-version Codex/Claude event adapters. Root/session/turn
  attribution, delayed callbacks, and subagent exclusion require qualification;
  ambiguous, stale, or uncorrelated events cannot overwrite a current root turn.
- Native hooks remain passive: no model calls, prompt/context injection,
  approval or continuation decisions, or transcript access. `Stop` is not
  final-settle proof; unsupported transitions become Unknown, not success.
  Codex is initially status-only; any Claude attention/error signals require
  qualification.
- Phase 05 completes Agent Settings, profile/path/delivery readiness gates, and
  notification ownership. It also removes DamHopper's legacy Codex OSC 9
  parser/alerts and automatic TUI-config writes; there is no fallback handler.
  Matched server/UI releases and explicit v1-to-v2 preference migration remain
  required; the v2 schema already includes Claude disabled by default.
- Phase 06 performs live Linux qualification. Codex CLI 0.158.0 and Claude Code
  2.1.250 are research targets, not qualified version promises. Static schemas
  and version probes do not establish native lifecycle behavior.

Sources: [Codex hooks](https://developers.openai.com/codex/hooks/),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Herdr's differing screen-authority model](https://herdr.dev/docs/agents/).

## Unresolved questions

None for the Linux x86_64 release path against OMP 18.4.1. Windows and other
non-Linux server runtimes, plus other OMP versions, remain unqualified; Linux
evidence does not establish those platform/version combinations.
