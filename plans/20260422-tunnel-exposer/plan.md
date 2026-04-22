---
title: "Localhost Tunnel Exposer"
description: "Click-and-play cloudflared Quick Tunnel panel that exposes remote localhost ports as public HTTPS URLs with zero account setup."
status: in_progress
priority: P2
effort: 22h
branch: main
tags: [tunnel, cloudflared, devex, backend, frontend]
created: 2026-04-22
---

# Localhost Tunnel Exposer

## Source Docs

- Brainstorm: `docs/brainstorm-tunnel-exposer-2026-04-21.md`
- Research A (cloudflared subprocess): `plans/20260422-tunnel-exposer/research/researcher-01-cloudflared-subprocess.md`
- Research B (UI patterns + web stack): `plans/20260422-tunnel-exposer/research/researcher-02-ui-patterns.md`
- Reference — PTY manager: `server/src/pty/{mod.rs,manager.rs,session.rs,event_sink.rs}`
- Reference — WS protocol: `server/src/api/ws_protocol.rs`, `ws.rs`
- Reference — router wiring: `server/src/api/router.rs`
- Reference — AppState: `server/src/state.rs`
- Reference — frontend hook: `packages/web/src/hooks/useSSE.ts`, `useTerminalTree.ts`
- Reference — transport: `packages/web/src/api/ws-transport.ts`

## Problem Statement

dam-hopper runs on a remote box. Dev servers started inside that workspace bind to `localhost:PORT` — invisible to the developer's laptop, teammates, and webhook providers. No public IP, likely NAT. Need zero-config expose of a port as a public HTTPS URL with single-click stop.

## Goals

1. User types port + label → public `https://*.trycloudflare.com` URL within 5s
2. Works from NATted boxes with no firewall changes
3. Zero Cloudflare/GitHub account required
4. Stop kills child process (verified clean, no zombie)
5. Server shutdown reaps all children — no orphaned processes
6. Second driver slot proven via `TunnelDriver` trait

## Non-Goals (MVP)

- Auth overlay (Basic / passcode)
- Auto port detection
- Stable URLs (named CF tunnels)
- Multi-port / path routing per tunnel
- TCP/UDP forwarding
- Audit log (`tunnel-audit.log` deferred)
- SHA256 verification of downloaded binary (TLS-only for MVP)
- Windows support in installer

## Phases

| # | Phase | File | Effort | Status |
|---|-------|------|--------|--------|
| 1 | Backend core + driver trait | `phase-01-backend-core.md` | ~10h | done |
| 2 | REST + WS API surface | `phase-02-api-surface.md` | ~4h | done |
| 3 | Web UI | `phase-03-web-ui.md` | ~8h | pending |

## Dependency Graph

```
Phase 01 (TunnelSessionManager, CloudflaredDriver, installer)
    │
    ▼
Phase 02 (REST routes, WS handler, AppState extension)
    │
    ▼
Phase 03 (TunnelPanel, useTunnels, Sidebar wiring)
```

Phases are sequential; each merges independently after passing tests.

## Success Criteria

- `POST /api/tunnels` → session with `status=starting` in <100ms
- `tunnel:ready` WS event arrives with URL in <5s on warm binary
- `DELETE /api/tunnels/:id` sends SIGTERM, SIGKILL after 2s, no zombie
- Server `ctrl+C` reaps all children (verified via `pgrep cloudflared`)
- `TunnelDriver` trait: adding a no-op second impl compiles without touching UI
- QR popover renders for ready tunnel; copy button shows checkmark 2s

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| cloudflared binary absent | Blocker | Lazy installer flow; clear error + Install button in UI |
| Quick Tunnel URL format changes across releases | Broken URL detection | Regex matches URL substring, not banner text |
| 30s startup timeout fires on congested network | Poor UX | Show amber spinner + elapsed time; allow retry |
| cloudflared child zombies after crash | Leaked process | `kill_on_drop(true)` + explicit reap in stop() |
| Port not listening → 502 at edge | Confusing error | Surface 502 silently; document in tooltip |
| Concurrent stop + shutdown race | Double-free / panic | `Arc<RwLock>` guards all session access |

## Unresolved Questions

- Radix `Popover` availability in current web package — verify before Phase 03 starts; fallback to headless `<details>` if absent. (Phase 03 spec already uses plain controlled `<div>`, so this is informational only.)

## Validation Summary

**Validated:** 2026-04-22
**Questions asked:** 7

### Confirmed Decisions

- **Installer UX**: Dedicated SSE/WS progress endpoint + `install:progress` / `install:done` events (NOT inline polling). Phase 02 and Phase 03 must reflect this.
- **Binary verification**: TLS-only for MVP. TODO comment in installer for future SHA256 verify.
- **macOS Gatekeeper**: Out of scope — **Linux-only installer for MVP**. Darwin detection emits `BinaryMissing` with "install via `brew install cloudflared`" hint; no `xattr -d` logic, no `.tgz` extraction.
- **WS ServerMsg typing**: Add 4 typed `ServerMsg::Tunnel*` variants with serialization tests (confirms colon-separated kind strings compile correctly).
- **Duplicate port guard**: `POST /api/tunnels` returns **409 Conflict** with `{ error: "tunnel already running on port X" }` if a tunnel for the same port is in `Starting` or `Ready` state.
- **Sidebar placement**: `TunnelPanel` renders **between project list and `TerminalTreeView`** in `Sidebar.tsx`.
- **WS reconnect resync**: `useTunnels` listens for WS `connected` event and calls `qc.invalidateQueries({ queryKey: ["tunnels"] })` to resync state after reconnect.

### Action Items (plan revisions required before implementation)

- [ ] **Phase 01**: Scope installer to **Linux x86_64 + arm64 only**. Add darwin/windows detection → `TunnelError::BinaryMissing` with manual-install hint. Drop `.tgz` extraction branch.
- [ ] **Phase 02**: Add `POST /api/tunnels/install` endpoint + 2 new WS events (`install:progress` with `{ downloaded, total }`, `install:done` with `{ path }` or `install:failed` with `{ error }`). Add 2 new `ServerMsg` variants. Update `channelToEndpoint` + `PUSH_EVENT_CHANNELS`.
- [ ] **Phase 02**: Add duplicate-port check in `create_tunnel` handler → 409 response.
- [ ] **Phase 03**: Change `InstallerRow` to subscribe to `install:progress` via `subscribeIpc` (remove poll loop). Show real % bar.
- [ ] **Phase 03**: Add `subscribeIpc("ws:connected", ...)` hook in `useTunnels` that calls `qc.invalidateQueries(["tunnels"])`. Verify event name matches existing WS reconnect signal in `ws-transport.ts` — may need to add one if not present.

### Recommendation

Revise Phase 01 (installer scope), Phase 02 (install endpoint + 409), and Phase 03 (SSE progress + reconnect resync) **before** starting implementation. ~1-2h of plan edits; prevents rework.
