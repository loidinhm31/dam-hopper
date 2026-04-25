# Scout: Existing Code — Port Detection + Tunnel Combined Panel

**Date:** 2026-04-25
**Purpose:** Ground the implementation plan. Implementers read this first.

---

## 1. Files to Keep (unchanged)

| File | Role |
|---|---|
| `server/src/port_forward/manager.rs` | `PortForwardManager` — tracks ports in memory, broadcasts WS events |
| `server/src/port_forward/detector.rs` | stdout regex + `/proc/net/tcp` poller |
| `server/src/port_forward/session.rs` | `DetectedPort`, `PortState` (Provisional/Listening/Lost), `DetectedVia` |
| `server/src/port_forward/mod.rs` | module re-exports |
| `server/src/api/port_forward.rs` | `GET /api/ports` handler |
| `server/src/tunnel/manager.rs` | `TunnelSessionManager` — create/stop/list, WS broadcast |
| `server/src/tunnel/session.rs` | `TunnelSession`, `TunnelStatus` |
| `server/src/tunnel/cloudflared.rs` + `driver.rs` + `installer.rs` | cloudflared driver |
| `server/src/api/tunnel.rs` | REST handlers for tunnels (create/list/stop/install) |
| `packages/web/src/hooks/useTunnels.ts` | tunnel state hook (WS push, TanStack Query) |
| `packages/web/src/components/organisms/TunnelPanel.tsx` | existing tunnel UI (to be **replaced**, pattern source) |

## 2. Files to Remove (via Phase 00 git rebase + cleanup)

| File | Why |
|---|---|
| `server/src/api/proxy.rs` | dead-end sub-path reverse proxy |
| `server/src/api/proxy_token.rs` | JWT for proxy — no longer needed |
| `server/src/api/router.rs` — proxy/proxy_token wiring (lines 20-22, 96, 145-164) | router entries for removed handlers |
| `packages/web/src/hooks/usePorts.ts` | current version calls `openPortInBrowser(port)` → `localhost:PORT` hardcoded; rebuild |
| `packages/web/src/components/organisms/PortsPanel.tsx` | current version references `proxy_url`, which becomes vestigial; rebuild |

## 3. Key Type Shapes

### Backend — `DetectedPort` (session.rs)
```rust
pub struct DetectedPort {
    pub port: u16,
    pub session_id: String,
    pub project: Option<String>,
    pub detected_via: DetectedVia,   // stdout_regex | proc_net
    pub state: PortState,            // provisional | listening | lost
    pub proxy_url: String,           // "/proxy/{port}/" — stale after proxy removal; will be ignored by UI
}
```
`proxy_url` field will exist on the wire but **the new UI ignores it**. No Rust changes needed to `session.rs`; it is benign dead data.

### Backend — `TunnelSession` (manager create, tunnel.rs)
POST `POST /api/tunnels` body:
```json
{ "port": 5173, "label": "vite-app" }
```
Response (201):
```json
{
  "id": "uuid",
  "port": 5173,
  "label": "vite-app",
  "driver": "cloudflared",
  "status": "starting",
  "url": null,
  "error": null,
  "started_at": 1714000000000,
  "pid": 12345
}
```
WS push events: `tunnel:created` (full session), `tunnel:ready` `{id, url}`, `tunnel:failed` `{id, error}`, `tunnel:stopped` `{id}`.

### Backend — `GET /api/ports` response
```json
{ "ports": [ { "port": 5173, "session_id": "...", "project": "vite-app", "state": "listening", ... } ] }
```
WS push events: `port:discovered` (full DetectedPort), `port:lost` `{port: number}`.

### Frontend — `TunnelInfo` (client.ts:83)
```ts
interface TunnelInfo {
  id: string; port: number; label: string; driver: string;
  status: "starting" | "ready" | "failed" | "stopped";
  url?: string; error?: string; startedAt: number; pid?: number;
}
```

### Frontend — `DetectedPort` (client.ts:97)
```ts
interface DetectedPort {
  port: number; session_id: string; project: string | null;
  detected_via: "stdout_regex" | "proc_net";
  proxy_url: string;   // vestigial after proxy removal — UI ignores
  state: "provisional" | "listening" | "lost";
}
```

## 4. Transport Layer

### IPC channel → REST mapping (ws-transport.ts)
- `port:list` → `GET /api/ports`
- `tunnel:list` → `GET /api/tunnels`
- `tunnel:create` → `POST /api/tunnels` body `{port, label}`
- `tunnel:stop` → `DELETE /api/tunnels/{id}`
- `tunnel:install` → `POST /api/tunnels/install`
- `tunnel:install:status` → `GET /api/tunnels/install`

### WS push events (useSSE.ts PUSH_EVENT_CHANNELS)
Already registered: `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`, `install:progress`, `install:done`, `install:failed`, `port:discovered`, `port:lost`.

### subscribeIpc pattern (useTunnels.ts:32-58)
```ts
subscribeIpc("tunnel:created", ({ data }) => { /* patch TanStack Query cache */ })
```

## 5. UI Mount Point

`packages/web/src/components/organisms/Sidebar.tsx` lines 157-161:
```tsx
{!collapsed && <TunnelPanel />}
{!collapsed && <PortsPanel />}
```
New `PortsPanel` (combined) replaces BOTH lines — just one `<PortsPanel />`.

## 6. server-config.ts — `getServerUrl()` (line 27)

Returns active profile URL → legacy localStorage → `VITE_DAM_HOPPER_SERVER_URL` env → `location.origin` fallback. In dev mode (`import.meta.env.DEV`), always returns `location.origin` regardless of env var (line 49-50).

`isLocalServer()` implementation:
```ts
export function isLocalServer(): boolean {
  try {
    return new URL(getServerUrl()).host === location.host;
  } catch {
    return true; // fallback: assume local
  }
}
```
Dev-mode caveat: `getServerUrl()` returns `location.origin` → `isLocalServer()` always true in dev. Acceptable — documented as dev-only behavior.

## 7. Existing TunnelPanel UX Patterns to Reuse

From `TunnelPanel.tsx`:
- Row layout: `group flex items-start gap-1.5 pl-2 pr-2 py-1 text-xs hover:bg-[var(--color-surface-2)]`
- Actions on group-hover: `opacity-0 group-hover:opacity-100 transition-opacity`
- Status dot color: `bg-green-500` (ready), `bg-amber-400 animate-pulse` (starting), `bg-red-500` (failed)
- Header: `text-[10px] font-semibold tracking-widest uppercase opacity-60` + `└─ ports` label
- Warning banner pattern (amber alert)
- `InstallerRow` component with progress bar — keep for cloudflared missing case

## 8. Existing PortsPanel UX Patterns to Reuse

From current `PortsPanel.tsx` (in working tree — **will be rebuilt**):
- State badge: `shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold capitalize` + color class per state
- Port count in header: small muted count span
- Empty state: italic muted text

## 9. Commits to Drop

```
cde6245  feat(proxy): /proxy/:port/* reverse-proxy route
1deec79  feat(web): Ports UI (PortsPanel, usePorts, proxy open)
```
Keep: `ef591e0` (drag-split, on top), `1256f11` (port detection backend, keep as base).
Rebase: `git rebase --onto 1256f11 cde6245~1 ef591e0`

## 10. Open Questions / Cautions

- `proxy_url` field will persist in `DetectedPort` struct on server; field is vestigial. Cheapest option: ignore in UI (no Rust change). Could remove field in a follow-up.
- `client.ts:DetectedPort.proxy_url` type field: update description comment to "(vestigial, ignored)" to avoid confusion.
- `ws-transport.ts:268` still has `proxy-token:get` channel mapping — remove in Phase 00/01 cleanup.
