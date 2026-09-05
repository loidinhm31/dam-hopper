# WebSocket/UI terminal stream scout

Scope: terminal output delivery, attach/replay ordering, frontend activity tracking, reconnect/multi-client behavior.

## Server WebSocket path

- `server/src/api/ws.rs:193` `handle_socket`: splits socket into reader/writer; per-connection `pty_tx` queue and `pty_order` mutex. Subscribes each connection to `state.event_sink` at ~232, so every connected client receives PTY broadcast messages.
- `server/src/api/ws.rs:354` reader match handles `ClientMsg::TermWrite`, `TermResize`, and `TermAttach`.
- `server/src/api/ws.rs:391-438` `TermAttach`: locks `pty_order`, calls `pty_manager.get_attach_snapshot(id, from_offset)`, sends connection-local `ServerMsg::TermBuffer` (`id`, `data`, `offset`, `reset`, `truncated`), then optional `terminal:lifecycle` editing snapshot. This is the authoritative replay/attach contract; no attach response is broadcast to other clients.
- `server/src/api/ws.rs:2482` `pump_pty`: receives the global broadcast stream, serializes delivery under `pty_order`, sends to this socket queue; logs and continues after `broadcast::RecvError::Lagged`, meaning a lagging client can miss output and must recover via attach replay.
- `server/src/state.rs:56` documents `event_sink` as PTY event fan-out.
- `server/src/pty/event_sink.rs:89-165`: `BroadcastEventSink` wraps Tokio broadcast; `subscribe()` creates per-client receivers and `broadcast()` emits JSON wire messages.
- `server/src/pty/manager.rs:71-80` `TerminalBufferReplay` / attach snapshot types; `:1405` replay construction; `:1724` and `:2647` output/lifecycle event broadcasts. These are likely locations for server-side “all terminals idle/output observed” telemetry, but current WS fan-out already carries terminal ID in each wire event.
- `server/src/api/ws_protocol.rs:24` client `terminal:attach`; `:238-239` server terminal buffer variant. Inspect protocol definitions before adding a monitor event or changing payload naming.

## Browser transport contract

- `packages/ui/src/api/ws-transport.ts:1208-1280`: `WsTransport` listener maps keyed by terminal/session ID, including data, exit, enhanced-exit, restart, buffer, lifecycle.
- `packages/ui/src/api/ws-transport.ts:1640-1670`: incoming dispatch. `terminal:output` routes `msg.id` + `msg.data` to only listeners for that ID; `terminal:buffer` routes attach replay to buffer listeners; lifecycle is parsed and routed by ID.
- `packages/ui/src/api/ws-transport.ts:2153-2260`: public `onTerminalData(id, cb)`, `onTerminalExit*`, `terminalAttach(id, fromOffset)`, `onTerminalBuffer(id, cb)`, and `onTerminalLifecycle(id, cb)`. `terminalAttach` sends `{kind:"terminal:attach", id, from_offset}` only when socket is open.
- `packages/ui/src/api/transport.ts:18,70-75`: shared transport interface for terminal output, optional buffer, and lifecycle listeners; any new monitor event should be represented here or exposed through `onEvent` if it is not terminal-specific.
- `packages/ui/src/api/ws-transport.test.ts`: WebSocket mock and protocol routing tests. Relevant attach/buffer cases around lines 48-90 and 654-757; add tests for output routing by terminal ID, reconnect listener behavior, and any monitor event.

## Terminal UI lifecycle/activity

- `packages/ui/src/components/organisms/TerminalPanel.tsx:289-350`: creates replay gate and `registerTerminalOutputActivity`; `writeLiveData` marks output only for non-empty live/replayed queued chunks.
- `TerminalPanel.tsx:356-437`: subscribes `onTerminalData` by sanitized `safeSessionId`; suppresses output before first attach buffer, queues output during async xterm replay, then flushes in order on replay completion and sets `streamReady=true`.
- `TerminalPanel.tsx:440-468`: exit/restart reset stream activity and replay state. Transport status/reconnect cleanup is later in the same effect; `useTransportGeneration` at `:150` causes reattachment after transport replacement.
- `packages/ui/src/lib/terminal-stream-replay-gate.ts:1-27`: state machine for attach buffer receipt, replay write, live readiness, generation, and queued live data.
- `packages/ui/src/lib/terminal-output-activity.ts:1-186`: per-session activity store. `markTerminalOutput`/`setTerminalStreamReady` and owner registration are the clean frontend signals for recent output and stream availability; 3-second recent-output window at line 1.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx:15-18,153-178`: subscribes to activity keyed by `session.sessionId`; derives visual output/stream status. This is the existing UI monitor surface.
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:58-82`: keeps terminal panels mounted by `sessionId`, passes `onExit`, and controls visible/WebGL state; relevant when counting active terminal sessions versus merely visible panels.

## Tests and edge cases

- `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx:350-516`: Chromium coverage for queued live chunks, replay completion, exit/disconnect reset, late output suppression; `:571-600` transport generation replacement.
- `packages/ui/src/lib/terminal-output-activity.test.ts`: store timing/ownership/subscription behavior.
- `packages/ui/src/lib/terminal-stream-replay-gate.test.ts`: attach generation and queue reset behavior.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`: navigator activity rendering.
- `server/src/api/ws.rs:2702+`: `pty_pump_waits_behind_attach_order_barrier` and broadcast lag tests around `:2704-2720`; these encode ordering and lag recovery assumptions.

## Design implications for idle/suspend planning

The safest server event signal is existing `terminal:output` (already includes terminal ID and is broadcast to every WebSocket client), with server-side authoritative active-session/PTY state from `pty_manager`; browser activity is intentionally a 3-second UI notification signal, not proof that no PTY is running. “No terminal running” should therefore be computed server-side from PTY manager state, with an explicit idle grace period and a single-owner/single-flight suspend scheduler. A monitor UI can consume per-ID output events via existing `WsTransport.onTerminalData`, while attach replay and reconnect must reset/reconcile state because broadcast lag and disconnects can lose live chunks.

Unresolved questions:

- Whether “no more terminal running” means no PTY processes, no attached browser panels, or no recent output; these have different server semantics.
- Whether `rtcwake` is allowed by deployment policy and how wake time should be configured/validated; avoid letting a browser directly execute privileged commands.
