# Phase 02 — REST + WS API Surface

## Context Links

- Parent plan: `plans/20260422-tunnel-exposer/plan.md`
- Depends on: Phase 01 complete (`server/src/tunnel/` module compiling)
- Pattern refs: `server/src/api/router.rs`, `ws_protocol.rs`, `ws.rs`
- AppState pattern: `server/src/state.rs`
- WS envelope convention: `server/src/api/ws_protocol.rs` (`#[serde(rename = "tunnel:created")]`)

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-22 |
| Description | Wire TunnelSessionManager into AppState; add 3 REST routes + WS envelope variants; extend transport channelToEndpoint. |
| Priority | P2 |
| Status | done |
| Effort | ~4h |

## Key Insights

- Three REST routes only: `POST /api/tunnels`, `GET /api/tunnels`, `DELETE /api/tunnels/:id`. No sub-resources needed.
- WS events are **server → client push only** — no new `ClientMsg` variants required. All tunnel lifecycle events flow via `BroadcastEventSink.broadcast()` already wired in Phase 01.
- Add 4 `ServerMsg` variants to `ws_protocol.rs` matching colon-separated convention (`tunnel:created`, etc.) — exactly like `terminal:exit`, `process:restarted`.
- WS `onmessage` in `ws-transport.ts` dispatches unknown `kind` to `eventListeners` via the `default` case — tunnel events flow through `transport.onEvent("tunnel:created", cb)` with zero changes to the switch block.
- `AppState` is `Clone` + cheap — add `tunnel_manager: TunnelSessionManager` field (already `Arc`-backed inside).

## Requirements

1. `AppState` gains `tunnel_manager: TunnelSessionManager` field.
2. REST handlers in `server/src/api/tunnel.rs`:
   - `POST /api/tunnels` — body `{ port, label }` → `201 TunnelSession`
   - `GET  /api/tunnels` → `200 Vec<TunnelSession>`
   - `DELETE /api/tunnels/:id` → `204`
3. Routes behind `require_auth` middleware.
4. `ServerMsg` gains 4 new variants.
5. `ws-transport.ts` `channelToEndpoint` gains 3 tunnel cases.
6. `useSSE.ts` `PUSH_EVENT_CHANNELS` gains `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`.

## Architecture

### REST Request/Response Shapes

```
POST /api/tunnels
Body: { "port": 3000, "label": "frontend" }
201:  TunnelSession (full object)
400:  { "error": "port must be 1-65535" }
409:  { "error": "tunnel already running on port 3000" }  // optional guard
503:  { "error": "cloudflared binary not found" }

GET /api/tunnels
200:  TunnelSession[]

DELETE /api/tunnels/:id
204:  (no body)
404:  { "error": "tunnel not found" }
```

### New ServerMsg Variants

```rust
// server/src/api/ws_protocol.rs — append to ServerMsg enum

#[serde(rename = "tunnel:created")]
TunnelCreated {
    id: String,
    port: u16,
    label: String,
    driver: String,
    status: String,    // "starting"
    #[serde(rename = "startedAt")]
    started_at: i64,
},

#[serde(rename = "tunnel:ready")]
TunnelReady {
    id: String,
    url: String,
},

#[serde(rename = "tunnel:failed")]
TunnelFailed {
    id: String,
    error: String,
},

#[serde(rename = "tunnel:stopped")]
TunnelStopped {
    id: String,
},
```

> These are documentation references only. Phase 01 already emits raw JSON via `sink.broadcast()`. Adding typed `ServerMsg` variants here is optional but recommended for test coverage of serialization.

### AppState Extension

```rust
// server/src/state.rs — add field
pub tunnel_manager: TunnelSessionManager,
```

Update `AppState::new()` signature to accept `TunnelSessionManager` (last param before `no_auth`). Update call site in `main.rs`.

### Handler Sketch

```rust
// server/src/api/tunnel.rs

async fn create_tunnel(
    State(state): State<AppState>,
    Json(body): Json<CreateTunnelRequest>,
) -> impl IntoResponse {
    // validate port
    // state.tunnel_manager.create(port, label).await
    // → 201 Json(session) or error
}

async fn list_tunnels(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.tunnel_manager.list())
}

async fn stop_tunnel(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    // state.tunnel_manager.stop(id).await → 204 or 404
}
```

### Router Wiring

```rust
// server/src/api/router.rs — inside protected Router::new()
.route("/api/tunnels",      post(tunnel::create_tunnel))
.route("/api/tunnels",      get(tunnel::list_tunnels))
.route("/api/tunnels/{id}", delete(tunnel::stop_tunnel))
```

### Web Transport Extension

```typescript
// packages/web/src/api/ws-transport.ts — channelToEndpoint()
case "tunnel:create":  return { method: "POST",   url: "/api/tunnels", body: data };
case "tunnel:list":    return { method: "GET",    url: "/api/tunnels" };
case "tunnel:stop": {
  const d = data as { id: string };
  return { method: "DELETE", url: `/api/tunnels/${encodeURIComponent(d.id)}` };
}
```

### useSSE.ts Extension

```typescript
// packages/web/src/hooks/useSSE.ts — extend PUSH_EVENT_CHANNELS
const PUSH_EVENT_CHANNELS = [
  // ... existing ...
  "tunnel:created",
  "tunnel:ready",
  "tunnel:failed",
  "tunnel:stopped",
] as const;
```

The `dispatch()` call in `useSSE.ts` will route these to `subscribeIpc` listeners. Phase 03's `useTunnels.ts` will call `subscribeIpc` for each.

## Related Code Files

**Create:**
- `server/src/api/tunnel.rs`

**Modify:**
- `server/src/api/mod.rs` — add `pub mod tunnel;`
- `server/src/api/router.rs` — 3 routes + import
- `server/src/api/ws_protocol.rs` — 4 ServerMsg variants (optional but adds test coverage)
- `server/src/state.rs` — `tunnel_manager` field + constructor param
- `server/src/main.rs` — construct `TunnelSessionManager`, pass to `AppState::new()`
- `packages/web/src/api/ws-transport.ts` — 3 channelToEndpoint cases
- `packages/web/src/hooks/useSSE.ts` — 4 channel strings in `PUSH_EVENT_CHANNELS`
- `packages/web/src/api/client.ts` — add `TunnelInfo` interface

## Implementation Steps

1. Add `pub mod tunnel;` to `server/src/api/mod.rs`.
2. Create `server/src/api/tunnel.rs` with `CreateTunnelRequest`, `create_tunnel`, `list_tunnels`, `stop_tunnel`.
3. Add 3 routes to `router.rs` inside `protected` block (after terminal routes).
4. Add `tunnel_manager: TunnelSessionManager` field to `AppState` in `state.rs`.
5. Update `AppState::new()` to accept `tunnel_manager: TunnelSessionManager` and store it.
6. In `main.rs`: construct `CloudflaredDriver`, construct `TunnelSessionManager::new(event_sink.clone(), Arc::new(driver))`, pass to `AppState::new()`. On shutdown, call `state.tunnel_manager.dispose_all().await` before existing cleanup.
7. (Optional) Add 4 `ServerMsg` variants to `ws_protocol.rs`; add serialization tests.
8. Update `channelToEndpoint` in `ws-transport.ts` with 3 tunnel cases.
9. Add 4 tunnel channel strings to `PUSH_EVENT_CHANNELS` in `useSSE.ts`.
10. Add `TunnelInfo` interface to `packages/web/src/api/client.ts`:
    ```typescript
    export interface TunnelInfo {
      id: string;
      port: number;
      label: string;
      driver: string;
      status: "starting" | "ready" | "failed" | "stopped";
      url?: string;
      error?: string;
      startedAt: number;
    }
    ```
11. `cargo test` green. `pnpm check` (lint) green.

## Todo List

- [x] Add `pub mod tunnel;` to `api/mod.rs`
- [x] Create `api/tunnel.rs` — 3 handlers
- [x] Wire 3 routes in `router.rs`
- [x] Add `tunnel_manager` field to `AppState`
- [x] Update `AppState::new()` signature
- [x] Wire manager construction + shutdown in `main.rs`
- [x] Add 4 `ServerMsg` variants (optional but add tests)
- [x] Extend `channelToEndpoint` in `ws-transport.ts`
- [x] Extend `PUSH_EVENT_CHANNELS` in `useSSE.ts`
- [x] Add `TunnelInfo` to `client.ts`
- [x] `cargo test` green (200/200; 1 pre-existing git test failure due to missing `git` binary in test env)
- [ ] `pnpm check` green — 13 pre-existing lint errors unrelated to Phase 02; Phase 02 files themselves are lint-clean

## Review Notes (2026-04-23)

### Bugs found
1. **label byte-vs-char bug**: `label.len() > 64` counts UTF-8 **bytes**, not Unicode chars (Rust `String::len()` contract). A label of 64 two-byte chars (e.g. `é` × 64) is 128 bytes and passes the guard, violating the "max 64 chars" intent. Fix: `label.chars().count() > 64`.
2. **empty-label not rejected**: control-char strip runs *after* length check. A label of `"\x01"` × 5 passes len check, strips to `""`, and creates a tunnel with an empty label. Fix: check `label.is_empty()` after stripping.
3. **dispose_all unreachable on SIGTERM**: `axum::serve(...).await?` only resolves on clean listener close; on SIGINT/SIGTERM the process is killed before `dispose_all()`. Tunnel children orphan. Fix: use `axum::serve(...).with_graceful_shutdown(signal_handler)`.

### Warnings
- `label.len()` vs `label.chars().count()` is a correctness issue, not just style.
- `ServerMsg::TunnelCreated` duplicates fields already on `TunnelSession`; plan notes this is intentional (typed variant for test coverage) — acceptable.

## Success Criteria

- `POST /api/tunnels` with `{"port":3000,"label":"test"}` returns 201 with session object
- `GET /api/tunnels` returns array (empty if no tunnels)
- `DELETE /api/tunnels/:id` returns 404 for unknown id, 204 for known
- `ServerMsg::TunnelCreated` serializes `kind` as `"tunnel:created"` (test)
- `pnpm lint` zero errors on `ws-transport.ts` and `useSSE.ts`

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| AppState::new() signature change breaks main.rs call | Compile error | Update call site in same PR |
| Missing `super::tunnel` import in router.rs | Compile error | Add to `use super::{...}` block at top of router.rs |
| `PUSH_EVENT_CHANNELS` type inference breaks with added strings | TS error | Use `as const` already present; just append literals |

## Security Considerations

- All 3 routes behind `require_auth` middleware — same as terminal routes.
- Port validation: reject port < 1 or > 65535; reject port 0.
- Label validation: max 64 chars, strip control characters.
- No tunnel operation modifies disk or config.

## Next Steps

After Phase 02: Phase 03 builds `TunnelPanel` organism + `useTunnels` hook consuming the API + WS events.

## Unresolved Questions

- Should `POST /api/tunnels` return 409 if a tunnel is already in `Starting`/`Ready` state on the same port? Decision: yes, emit 409 with clear message to prevent duplicates.
