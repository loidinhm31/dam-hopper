# Scout Report: F-14 + F-15 Touchpoints

_Generated 2026-04-24 via Explore agent._

## F-14 Terminal Split Panes

### Current terminal component(s)

- `packages/web/src/components/organisms/TerminalPanel.tsx:1` — sole xterm instantiation point. `new Terminal(...)` at line ~65, `FitAddon` loaded immediately after `term.open(container)`. Resize via `ResizeObserver` + 200ms debounce (`fitAddon.fit()` → `transport.terminalResize`). Each `TerminalPanel` is keyed per mount; cleanup disposes xterm but leaves PTY alive.
- `packages/web/src/components/organisms/MultiTerminalDisplay.tsx:1` — renders all `mountedSessions` as stacked `position: absolute` divs; only one is `display: flex` at a time (tab-switching). No split pane logic here — this is the insertion point for a split layout.
- `packages/web/src/components/templates/IdeShell.tsx:1` — top-level IDE shell. Uses a custom `useResizeHandle` hook (localStorage-persisted widths) and manual `mousemove` drag logic for vertical editor/terminal split. No `react-resizable-panels` used anywhere. Handles left file-tree, center editor+terminal, right terminal-tree — all raw CSS flex with drag handles.

### react-resizable-panels usage

`react-resizable-panels@4.9.0` declared in `packages/web/package.json:29` but **zero imports** in `packages/web/src/`. Installed but unused — codebase uses bespoke `useResizeHandle` hook (`packages/web/src/hooks/useResizeHandle.ts`) backed by `mousemove` + `localStorage`.

### Terminal session state

- `packages/web/src/hooks/useTerminalManager.ts:1` — all tab/session state lives here as local `useState`. Key state: `openTabs: TabEntry[]`, `activeTab: string | null`, `mountedSessions: MountedSession[]` (capped at `MAX_MOUNTED = 5`). No zustand store. Session metadata from `@tanstack/react-query` (`useTerminalSessions`, `useProjects`).
- `packages/web/src/hooks/useTerminalTree.ts:1` — derives tree view structure from sessions + projects config.

### PTY broadcast confirmation

- `server/src/pty/event_sink.rs:67` — `BroadcastEventSink` wraps `tokio::sync::broadcast::Sender<String>`. `subscribe()` (line 74) returns fresh `broadcast::Receiver<String>` — multiple subscribers get every message independently.
- `server/src/api/ws.rs:128` — each WebSocket calls `state.event_sink.subscribe()` and spawns `pump_pty(pty_rx_broadcast, pty_out)` (line 906). Confirmed fan-out to multiple simultaneous readers.
- `server/src/pty/manager.rs:523` — `reader_thread` calls `sink.send_terminal_data(...)` for every 4KB chunk from PTY master. Raw bytes in `chunk[..n]` (line 499–523) — **this is the tap point for port detection scanning**.

### xterm.js version + addons

- `@xterm/xterm@^6.0.0` (`packages/web/package.json:34`)
- `@xterm/addon-fit@^0.11.0` (`packages/web/package.json:33`)
- No web-links, search, or web-gl addons.

---

## F-15 Port Forwarding + Reverse Proxy

### Axum router + middleware

- `server/src/api/router.rs:1` — `build_router()` merges `public` (no auth), `protected` (JWT cookie via `auth::require_auth` `.route_layer`), and `ide_routes` (same auth). Global: tower-http `CorsLayer` + `DefaultBodyLimit::max(10MB)`.
- New `/proxy/*` router mergeable as 4th branch, either without auth or with custom token-from-query middleware (matches WS pattern).
- `tower-http = "0.6"` with `["cors", "fs"]` (`server/Cargo.toml:21`).

### WS upgrade + auth pattern

- `server/src/api/ws.rs:65–84` — `ws_handler` on **public** router (`/ws`). Auth inline: reads `?token=` query or cookie, validates JWT manually. Pattern to mirror for `/proxy/*` routes needing auth but unable to use cookie middleware.
- `server/src/api/ws.rs:127–130` — `state.no_auth` is NOT checked in `ws_handler` (gap; proxy route should mirror + add bypass).

### HTTP client available

- `reqwest = "0.12"` with `["rustls-tls", "stream"]` (`server/Cargo.toml:94`) — streaming response bodies work.
- `tokio-tungstenite = "0.26"` with `native-tls` (`server/Cargo.toml:111`) — for WS proxying.
- `hyper` NOT direct dep — transitive only. Direct use (e.g., `hyper::upgrade`) requires explicit add.

### PTY output tap points

- `server/src/pty/manager.rs:468–523` — `reader_thread()` is single choke point for all PTY output. Port detection regex scan should hook here, after `buf.push(data)` (501) before `sink.send_terminal_data` (523). `session_id` in scope.
- `server/src/pty/event_sink.rs:82` — `send_terminal_data` serialises JSON then broadcasts. Alternative: subscribe + parse `terminal:output` — works but JSON encode+decode overhead per chunk.
- `server/src/pty/buffer.rs:1` — `ScrollbackBuffer` holds raw bytes; `snapshot()` callable from any thread via `Arc<Mutex<ScrollbackBuffer>>` from `LiveSession::buffer_ref()` (session.rs:170).

### AppState + WS protocol

- `server/src/state.rs:18–40` — `AppState` has `pty_manager: PtySessionManager`, `event_sink: BroadcastEventSink`, `tunnel_manager: TunnelSessionManager`. New `port_forward_manager: PortForwardManager` follows `TunnelSessionManager` pattern. `AppState` derives `Clone`; new fields must be `Arc`-backed.
- `server/src/api/ws_protocol.rs:ServerMsg` — tagged enum `#[serde(tag = "kind")]`. New variants follow `TunnelReady`/`TunnelFailed` pattern (~175–205):
  - `ServerMsg::PortDetected { session_id, port }` → `kind: "port:detected"`
  - `ServerMsg::PortForwardReady { port, proxy_path }` → `kind: "port:forward_ready"`
  - `ServerMsg::PortLost { port }` → `kind: "port:lost"`

### Auth middleware

- `server/src/api/auth.rs:require_auth` (~78) — Axum `middleware::from_fn_with_state`. Checks `state.no_auth` first, then JWT from `Authorization: Bearer` or `damhopper-auth` cookie.
- For `/proxy/:port/*`: NOT under `protected` layer. Handle auth inline (like `ws_handler`) for flexible token sources: `?token=` query for browser nav, cookie for fetch, subprotocol for WebSocket.

---

## Key findings / gotchas

- `react-resizable-panels` installed but unused — split-pane work starts clean. Can adopt library for first time OR extend bespoke `useResizeHandle`.
- `MultiTerminalDisplay` uses `display: none` / `display: flex` toggling (not unmount) for tab switching — split-pane impl must preserve this "keep alive" pattern.
- `TerminalPanel` intentionally runs `useEffect` once (eslint disable, empty deps) — use `key` prop to force remount when needed.
- `IdeShell` vertical split is manual mouse drag (no lib). Adding horizontal split within terminal zone: either nest another manual drag or adopt `react-resizable-panels` scoped to terminal area.
- PTY broadcast is `tokio::sync::broadcast` with no per-session filtering at channel level — every WS client gets every session's output and filters client-side by `id`. Fine for split panes (two panels watching two sessions) but port-detection scanner must also filter by session.
- `BroadcastEventSink.subscribe()` returns fresh receiver — safe to call from port-detection service without mutex changes.
- `reqwest` has `stream` feature but no `json` feature listed — check if `serde` deserialize of upstream responses is needed (likely not, we stream bytes).
- WS auth does NOT check `state.no_auth` (unlike HTTP middleware) — proxy route should mirror `ws_handler` and add no_auth bypass explicitly.
- `AppState::new()` validates no-auth + MongoDB combination — new `PortForwardManager` field needs corresponding ctor param.
- `server/Cargo.toml` has no `hyper` direct dep — CONNECT-style WS proxying needs `hyper` added explicitly, OR `tokio-tungstenite` for upstream leg, OR use `axum-reverse-proxy` crate which bundles the plumbing.
