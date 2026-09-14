# Backend PTY lifecycle scout

Scope: authoritative PTY state, lifecycle/output/exit/restart, cleanup/incarnation, public status APIs, websocket transport/tests.

## Core state and lifecycle

- `server/src/pty/manager.rs:557-670` — `Inner` owns `live: HashMap<String, LiveSession>`, `dead: HashMap<String, DeadSession>`, `killed`, `pending_replacements`, `failed_replacements`, and incarnation allocation. `allocate_incarnation`, replacement bookkeeping, and `IncarnationEventSink::with_current` are the authoritative stale-event guard.
- `server/src/pty/manager.rs:963` — `PtySessionManager::create`; `create_with_buffer` at 969. Creates metadata/live session, allocates concrete incarnation, wires reader/event sink, and emits terminal-changed.
- `server/src/pty/manager.rs:1510` — `kill`; `remove` at 1542 immediately evicts metadata and persists a removal watermark. `is_alive` at 1611 checks only `live`; `list` at 1615 returns live + dead metadata; `list_detailed` at 1790 includes buffer/diagnostic details.
- `server/src/pty/manager.rs:2360-2470` — reader/exit path: final buffer persistence, exit/restart scheduling, `send_terminal_exit` + `send_terminal_changed`, and visible output/lifecycle ordering (`send_visible_output_then_lifecycle` at 2454).
- `server/src/pty/manager.rs:2480+` — respawn supervisor and restart path; inspect around `RespawnCmd`, `mark_replacement_*`, and incarnation checks when adding idle/running semantics.
- `server/src/pty/session.rs:92-129` — `SessionMeta` public model. Important fields: `id`, `incarnation`, `alive`, `exit_code`, `started_at`, `restart_count`, `last_exit_at`, `target_unavailable`, restart policy. `LiveSession::new` at 208 stores concrete incarnation and process handles.
- `server/src/pty/shell_lifecycle.rs:12-110` — shell prompt/editing state machine; lifecycle events are shell-state, not process-running state. Do not use `LifecycleState` as terminal liveness.

## Event transport / websocket path

- `server/src/pty/event_sink.rs:4-48` — `EventSink` contract: terminal output, exit, changed, lifecycle, enhanced exit, process restarted. `BroadcastEventSink` at 93 publishes JSON on bounded Tokio broadcast channel.
- `server/src/pty/event_sink.rs:122-219` — wire payloads: `terminal:output` `{kind,id,data}`, `terminal:exit` `{id,exitCode,willRestart,...}`, `terminal:changed` empty payload, lifecycle `{id,lifecycle,generation}`, restart `{id,...}`. Current public events do not include `incarnation`; internal `IncarnationEventSink` filters stale emissions before this layer.
- `server/src/api/ws.rs:235-240` — each websocket subscribes to `state.event_sink`, starts `pump_pty`; channel is bounded (`PTY_CHAN_CAP=512`) and writer uses PTY backpressure.
- `server/src/api/ws.rs:2485` — `pump_pty`; inspect its deserialization/filtering and ordering behavior before adding a monitor event. Websocket connection cleanup aborts pumps near socket handler teardown.
- `server/src/api/ws_protocol.rs:235-280` — `ServerMsg` typed terminal output/buffer/lifecycle/exit/restarted variants; protocol tests around 509-590 assert JSON compatibility. Add any new event/fields here plus tests.
- `server/src/api/ws.rs:400-460` — `terminal:attach` request handling and buffer replay; useful for monitor initial synchronization but not authoritative running-state discovery.

## Public APIs and frontend discovery implications

- `server/src/api/terminal.rs:204-223` — `GET /api/terminal` calls `pty_manager.list`; `GET /api/terminal/detailed` calls `list_detailed`. These snapshots include `alive` and `incarnation`; `GET /api/terminal/:id/buffer` is replay only.
- `server/src/api/terminal.rs:270+` — kill/remove handlers; distinguish kill (tombstone retained) from remove (evicted) when defining “no terminals running”.
- `server/src/api/tests.rs:831+` — detailed-session API usage; tests around terminal creation/listing and cleanup are the likely API regression locations.
- `packages/ui/src/hooks/use-sse.ts:102,447` — terminal-changed subscription triggers refresh; existing UI can use the snapshot for authoritative state while output/exit events are streamed.

## Existing backend tests to extend

- `server/src/pty/manager.rs:3876-4045` — incarnation/stale reader and event emission tests, including output suppression for replaced sessions.
- `server/src/pty/manager.rs:4160-4375` — replacement failure, unavailable-target tombstone, restart/cleanup persistence tests.
- `server/src/pty/tests.rs:751-930` — recording event sink and output/lifecycle ordering tests.
- `server/src/pty/event_sink.rs:222-255` — broadcast sink wire-contract test pattern.
- `server/src/api/ws_protocol.rs:480-600` — serialization/deserialization contract tests for terminal events.
- `server/tests/browser_debug_artifacts.rs:150` — HTTP terminal status/not-found assertion pattern.

## Dependency path for idle monitor

PTY reader -> `IncarnationEventSink` -> `BroadcastEventSink` -> per-WS `pump_pty` -> `ServerMsg` JSON -> UI subscription. Running state should derive server-side from `live`/`dead` plus lifecycle transitions, with `GET /api/terminal` or `terminal:changed` snapshot as reconciliation. A client seeing no output is not equivalent to no running process. For suspend, server must own the final “all live sessions empty” decision and guard against races with create/restart/replacement; `rtcwake` execution should be gated/configured and observable, not triggered solely by a browser disconnect.

## Unresolved questions

- Whether “running” means any live PTY process, only user-attached terminals, or excludes sessions pending automatic restart.
- Whether idle suspend is server-global or scoped to a workspace/profile, and how to cancel a scheduled suspend when a new PTY is created.
- Required authorization/configuration for invoking `sudo rtcwake`; current PTY APIs expose no suspend scheduler.
