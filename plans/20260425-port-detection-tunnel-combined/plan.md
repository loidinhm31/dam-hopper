---
title: "Combined Ports + Tunnel Panel"
description: "Unified Ports panel: detect ports, open localhost when same-host, start Cloudflare tunnels for sharing. Drops dead-end /proxy/* approach."
status: in_progress
priority: P2
effort: ~11h
branch: main
tags: [ports, tunnel, cloudflare, frontend, devex]
created: 2026-04-25
---

# Combined Ports + Tunnel Panel

> **Supersedes:** `plans/20260424-terminal-split-and-port-forward/` phases 04-05 (proxy route + ports UI). See that plan for split-pane terminal work (phases 01-03) which is complete.

## Source Docs

- Feasibility report (proxy verdict): `plans/20260424-terminal-split-and-port-forward/research/feasibility-port-forwarding.md`
- Scout findings: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md`
- Tunnel plan (pattern source): `plans/20260422-tunnel-exposer/plan.md`
- Codebase conventions: `CLAUDE.md`

## Problem Statement

The previous attempt built a sub-path reverse proxy (`/proxy/{port}/*`) to let users reach detected ports through the DamHopper server. The feasibility report (2026-04-25) showed this approach is a dead end: modern dev servers (Vite, webpack, Next.js, HMR WebSocket) break when served under a sub-path because they emit absolute `/asset` URLs and hard-coded WS paths. The existing port detection backend and Cloudflare tunnel manager are sound; only the glue between them is wrong. This plan drops the proxy, combines port detection and tunnels into one coherent "Ports" panel, and adds a same-host check so local users get a direct "open localhost" shortcut without a tunnel.

## Goals

1. Git cleanup — drop proxy commits, preserve drag-split on top.
2. Remove `proxy.rs`, `proxy_token.rs`, and all router wiring.
3. Add `isLocalServer()` to `server-config.ts`.
4. Rebuild `usePorts` hook with tunnel-action support.
5. New combined `PortsPanel`: detected ports + per-port tunnel actions + custom port form.
6. Replace both `<TunnelPanel />` and `<PortsPanel />` in Sidebar with single combined panel.

## Non-Goals

- Sub-path or subdomain reverse proxy.
- TCP-over-WebSocket multiplexing (separate plan, deferred).
- Auto-start tunnel on port discovery (always explicit click).
- Cross-platform port detection (Linux-only stays).
- Changes to `TunnelSessionManager` or port detection backend.

## Phases

| # | Phase | Status | Effort | Depends On |
|---|---|---|---|---|
| 00 | Git cleanup — extract patches, rebase, verify | done | ~1h | — |
| 01 | Backend cleanup — remove proxy code, verify build+tests | done | ~0.5h | 00 |
| 02 | Panel design — ASCII mockup, state machine, behavior matrix | pending | ~1.5h | 01 |
| 03 | Web client — `isLocalServer`, `usePorts` rebuild, `PortsPanel` rebuild | pending | ~5h | 02 |
| 04 | Layout integration — replace TunnelPanel + PortsPanel in Sidebar | pending | ~2h | 03 |
| 05 | Smoke tests + docs update | pending | ~1h | 04 |

## Dependency Graph

```
00 → 01 → 02 → 03 → 04 → 05
```
Strictly sequential; each phase depends on the previous.

## Success Criteria

- `cargo check` and `cargo test` pass after Phase 01.
- `pnpm build` passes after Phase 04.
- No `/proxy/*` routes in router; no `proxy_token` endpoint.
- "Open localhost" button visible only when `isLocalServer()` is true.
- "Start tunnel" creates a cloudflared tunnel for the detected port.
- Tunnel URL appears inline in the port row when ready.
- Custom port form starts a tunnel for manually entered ports.
- `TunnelPanel` component is gone; Sidebar imports only `PortsPanel`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rebase conflict on `ef591e0` (drag-split) | Medium | High | Create backup branch first; resolve conflicts in TerminalPanel/Sidebar only |
| `proxy_url` field in `DetectedPort` confuses future devs | Low | Low | Add JSDoc comment "(vestigial, ignored)" in client.ts |
| `isLocalServer()` false positive in dev mode | Low | Low | Documented caveat — only affects dev workflow, not production |
| cloudflared binary missing on fresh install | Medium | Medium | InstallerRow UX from existing TunnelPanel handles this; reuse in combined panel |

## Unresolved Questions

1. Should `proxy_url` field be removed from `DetectedPort` struct and wire format? Cheapest: ignore in UI (no Rust change). Plan assumes ignore; can be cleaned up later.
2. Should the combined panel replace `TunnelPanel` file entirely (delete + new file) or rename? Plan assumes: delete `TunnelPanel.tsx`, create `PortsPanel.tsx` (already exists, will be rewritten).
