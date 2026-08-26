# Repository Scout: Terminal Usage Analytics

Date: 2026-07-18  
Scope: read-only server/UI scout

## Server capture path

- `server/src/pty/manager.rs`
  - `PtySessionManager::{create,write,get_attach_snapshot,resize,remove}`.
  - Reader thread strips private markers, buffers visible output, broadcasts lifecycle/output, snapshots persistence, scans ports.
  - Correct analytics capture point: validated lifecycle in reader path before broadcast.
  - `write()` forwards bytes only; do not infer commands there.
- `server/src/pty/shell_integration.rs`
  - Integrates only empty/default shell or explicit `bash` launch.
  - Selects Bash/Zsh/Fish adapter from `$SHELL`.
- `server/assets/shell-integration/{bash.sh,zsh.zsh,fish.fish}`
  - Emits nonce-authenticated OSC 633 `A/B/E/C/D`.
  - Bash fails closed for compound/multiline/substitution/redirection syntax and existing DEBUG traps.
- `server/src/pty/shell_lifecycle.rs`
  - `ShellLifecycle` states: Editing -> Submitted(command) -> Opaque -> Finished.
  - Validates nonce/order and strips valid private markers.
  - Completion does not currently surface child command status.
- `server/src/pty/event_sink.rs`
  - Broadcasts terminal output/lifecycle/exit/changed.
- `server/src/api/ws_protocol.rs`, `server/src/api/ws.rs`
  - `{kind}` WS envelope; lifecycle already sent to clients.
  - Lag can drop broadcast messages. Persist before fan-out.

## Persistence

- `server/src/persistence/mod.rs`: `SessionStore` with `rusqlite`.
- `server/src/persistence/worker.rs`: bounded `PersistCmd` worker, 5-second batching.
- `server/src/persistence/migrations/{001..003}`: migrations explicitly included.
- `server/src/config/schema.rs`: `session_db_path`, buffer TTL.
- `server/src/main.rs`: store/worker startup, restore, shutdown.
- Existing DB is mode `0600` but stores env JSON and scrollback. Use separate `telemetry.db`.
- New telemetry worker should stay bounded/non-blocking and expose drop counters.
- Add WAL, busy timeout, separate read connection, retention purge.

## API

- `server/src/api/router.rs`: protected route registration.
- `server/src/state.rs`: add cheap-clone usage query/store handle.
- Prefer aggregate REST endpoints under `/api/usage/*`.
- No raw event endpoint and no per-event WS stream.
- Optional low-rate `usage:changed` invalidation only if polling proves inadequate.

## UI

- Real shared UI: `packages/ui`, not legacy `packages/web` references.
- `packages/ui/src/embed/dam-hopper-app.tsx`: lazy route ownership.
- `packages/ui/src/lib/navigation.ts`: centralized top navigation.
- `packages/ui/src/components/pages/DashboardPage.tsx`: existing operational dashboard.
- `packages/ui/src/components/organisms/TerminalPanel.tsx`: xterm + lifecycle consumer.
- `packages/ui/src/api/{client.ts,queries.ts,ws-transport.ts}`: mirrored DTOs, TanStack queries, endpoint mapping.
- Existing exact command history is browser localStorage; not a server analytics source.
- No chart library installed. Prefer accessible SVG/CSS MVP visuals.
- Add `/usage`, dashboard teaser, compact responsive navigation/overflow.

## Existing agent integration

- `packages/ui/src/lib/agent-command-recognizer.ts` recognizes agent commands.
- `agent-activity-tracker.ts` has activity concepts.
- `terminal-agent-notification-integration.ts` primarily handles Codex OSC 9 notifications.
- `server/src/api/config.rs::sync_codex_tui_config` edits Codex notification settings only.
- No server token collector exists.

## Test surfaces

- Rust lifecycle: `server/src/pty/tests.rs`, inline `shell_lifecycle.rs` tests.
- Persistence: `server/src/persistence/{mod.rs,worker.rs}` tests.
- API/auth: `server/src/api/tests.rs`.
- UI transport: `packages/ui/src/api/ws-transport.test.ts`.
- Add classifier/privacy fixtures, lifecycle status/duration, dedupe/replay, DB fault/backpressure, retention/query, aggregate DTO, accessibility, responsive nav, empty/partial/error UI tests.

## Constraints

- Scope only DamHopper-managed top-level integrated shells.
- Exact raw commands never persisted.
- Unsupported coverage explicit, never guessed.
- Existing terminal replay/suggestion/notification behavior cannot regress.
- Telemetry errors cannot affect PTY liveness or responsiveness.

## Unresolved questions

- Exact OTLP crate/decoder choice requires dependency-size and interoperability spike.
- Long-term aggregate retention remains a config default decision.
