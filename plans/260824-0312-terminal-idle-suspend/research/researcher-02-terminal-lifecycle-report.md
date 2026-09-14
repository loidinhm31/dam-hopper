# Terminal lifecycle / WebSocket research

## Findings

- `server/src/pty/manager.rs:516-640` defines `PtySessionManager` over `Inner { live, dead, generation, killed, pending_replacements }`. `live` is the authoritative set of currently running PTYs; `dead` tombstones remain for replay/metadata (normally 60s TTL). `is_alive(id)` checks only `live`; `list()` returns both live and dead, so it is not an “active terminals” count.
- `server/src/pty/session.rs:50-150` defines `SessionMeta`: public `id` is reusable, while `incarnation` identifies a concrete PTY. `alive`, `exit_code`, `restart_count`, `last_exit_at`, `restart_policy`, and `target_unavailable` describe lifecycle. Any coordinator must key transitions by `(id, incarnation)` or reject stale events.
- `manager.rs:963-1315` `create/create_with_buffer` publishes a live session and emits `terminal:changed`. Restart machinery carries incarnation + manager generation (`RespawnCmd`, near file start), preventing stale respawns after kill/dispose. Automatic restart can therefore make `terminal:exit` transient rather than terminal.
- `server/src/pty/event_sink.rs:1-180` is the transport-neutral event boundary. `BroadcastEventSink` sends JSON through bounded Tokio broadcast: `terminal:output {id,data}`, `terminal:exit {id,exitCode,willRestart,restartIn,restartCount}`, `terminal:lifecycle {id,lifecycle,generation,command}`, `process:restarted`, and `terminal:changed`. All connected WS clients receive broadcasts; there is no per-client output subscription/filter.
- `server/src/api/ws.rs:235-250,~390-455` creates one broadcast receiver/pump per WebSocket connection. `terminal:attach` is different: it takes optional `fromOffset`, obtains one atomic `get_attach_snapshot`, and sends `terminal:buffer` only to that connection, followed by an editing lifecycle snapshot when applicable. `pty_order` serializes replay with the output pump, supporting reconnect without output overtaking replay. Multiple clients may attach the same ID and independently replay.
- `server/src/api/ws_protocol.rs:1-60,220-290` inbound terminal commands are only `terminal:write`, `terminal:resize`, `terminal:attach`; outbound protocol has output, buffer replay, lifecycle, exit, and restart messages. There is no server-side “terminal idle/no running terminals” event today.
- `manager.rs:1615-1625` confirms `list()` includes dead sessions; `list_detailed()` additionally reports `buffer_bytes` (around 1790). Use a new manager-level live-count/query (under the same mutex) rather than infer from frontend state or `list()`.
- PTY reader paths around `manager.rs:2040-2140` append output to scrollback and send output; exit handling around `2400-2480` persists final buffer and emits exit/changed/lifecycle. A coordinator should observe these server events directly, because UI’s `packages/ui/src/lib/terminal-output-activity.ts:1-175` is only a 3-second per-session recent-output indicator and requires an attached stream; it does not represent process liveness.

## Recommendation

Put an opt-in `IdleSuspendCoordinator` beside `PtySessionManager` in server state, consuming authoritative lifecycle transitions (create/live, explicit kill/remove, exit, successful restart, dispose) rather than counting WS clients. Maintain `(id, incarnation) -> live` and a monotonic activity/debounce deadline. Arm only when live set becomes empty; cancel on any create/restart. Require a configurable quiet period and an explicit enable/allow-suspend setting. Re-check `live.is_empty()` immediately before spawning the host action; never trigger from `terminal:changed` alone because that event also covers dead/tombstone changes.

Represent host sleep as a typed command/request, not arbitrary UI-provided shell text. Validate duration bounds, authorization, platform/support, and a single-flight state (`Idle`, `Armed`, `Executing`, `Suppressed`, `Failed`). Execute `rtcwake` through a narrowly scoped host-action abstraction with timeout, structured diagnostics, and cancellation on new terminal creation. Prefer an absolute wake deadline converted to `rtcwake -m mem -s <seconds>` at execution time; document that suspend can fail or require privileges. Do not make the browser responsible for deciding “no terminals”: disconnected clients must not prevent energy saving, and a malicious client must not cause sleep by spoofing output.

## Tests / risks

- Unit-test live-count transitions for create, explicit kill/remove, natural exit, auto-restart (exit must not arm), same-ID replacement with stale incarnation, dispose, and failed spawn.
- Test debounce cancellation when a new PTY appears during the quiet period; test final re-check race immediately before execution.
- Test event sink/coordinator integration with multiple WS clients: output remains broadcast, attach replay remains connection-local, and coordinator fires once.
- Test config validation and host-action command construction without actually suspending; integration-test behind a fake executor. Guard Linux-only `rtcwake` and privilege failures.
- Main risks: treating tombstones as live, stale same-ID events, restart windows, duplicate sleep requests, server shutdown races, and sleeping a host while an unmanaged process (outside this server) still needs it.

## Unresolved questions

- Should “no terminal running” mean no `live` PTYs only, or also suppress suspend while target-unavailable/dead sessions are visible?
- Where is the canonical server config schema/CLI surface for an opt-in idle-suspend policy, and should policy be global or workspace-scoped?
- Should the feature support a user-facing cancel/“keep awake” lease, and how is host authorization exposed?
- Is `rtcwake` expected to run via systemd/polkit/sudo, or is passwordless sudo explicitly guaranteed on deployment hosts?
