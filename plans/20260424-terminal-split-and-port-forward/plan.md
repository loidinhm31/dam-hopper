---
title: "Terminal Split Panes + Port Forwarding"
description: "Multi-pane terminal layout with persistence plus auto-detected port forwarding through reverse proxy."
status: pending
priority: P2
effort: ~38h
branch: main
tags: [terminal, proxy, devex, frontend, backend]
created: 2026-04-24
---

# Terminal Split Panes + Port Forwarding

## Source Docs

- Backlog: `plans/report/2026-04-15-feature-backlog.md` §F-14, §F-15
- Scout: `scout/scout-01-codebase-touchpoints.md` | Research F-14: `research/researcher-01-split-panes.md` | Research F-15: `research/researcher-02-proxy-portdetect.md`
- Pattern ref: `plans/20260422-tunnel-exposer/plan.md` | Conventions: `CLAUDE.md`

## Problem Statement

**F-14:** One terminal visible at a time forces constant tab-switching. `react-resizable-panels@4.9.0` installed but unused.

**F-15:** PTY sessions bind to `127.0.0.1:PORT` on server — invisible to remote browser. No port detection, no proxy, no "Open in Browser".

## Goals

1. Recursive binary-tree split layout; keyboard-triggered; persisted in `localStorage`
2. Drag-to-split via `@dnd-kit/core` (Phase 02, post-MVP)
3. Hybrid port detection: PTY stdout regex (immediate) + `/proc/net/tcp` poll (authoritative, Linux-only)
4. `/proxy/:port/*path` reverse proxy via `axum-reverse-proxy`; `?token=` short-lived JWT auth
5. `GET /api/ports` + `port:discovered` / `port:lost` WS events
6. `PortsPanel` sidebar: list + "Open in Browser"

## Non-Goals (MVP)

- macOS/Windows port detection (`cfg(target_os="linux")` gate; warn on others)
- Subdomain proxy; response body rewriting; server-side layout persistence (F-08B not built)

## Phases

| # | Phase | File | Effort | Depends on |
|---|-------|------|--------|------------|
| 01 | Split panes core (tree + persistence + keyboard) | `phase-01-split-panes-core.md` | ~10h | none |
| 02 | Split panes drag-to-split | `phase-02-split-panes-drag-drop.md` | ~6h | 01 |
| 03 | Port detection backend (PortForwardManager + WS events) | `phase-03-port-detection-backend.md` | ~8h | none |
| 04 | Proxy route backend (/proxy/:port/*, auth, security) | `phase-04-proxy-route-backend.md` | ~10h | 03 |
| 05 | Ports UI (list, Open in Browser, split-pane integration) | `phase-05-ports-ui.md` | ~4h | 03, 04 |

MVP = phases 01, 03, 04, 05. Phase 02 ships after MVP feedback.

## Dependency Graph

```
01 (SplitLayout, keyboard) → 02 (drag-to-split, @dnd-kit)
03 (PortForwardManager, proc scanner, WS events) → 04 (/proxy/:port/*, auth, security) → 05 (PortsPanel, usePorts)
```

## Success Criteria

- `Ctrl+Shift+5` splits pane; layout survives reload. `Alt+Left`/`Alt+Right` navigate panes.
- Port 5173 detected within 2s; `port:discovered` WS event received. `/proxy/5173/` serves app.
- `/proxy/22` → 403; unauthenticated `/proxy/*` → 401.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `axum-reverse-proxy` WS subprotocol passthrough (Vite HMR `vite-hmr`) unverified | Broken HMR | Lab test first; fallback to manual two-leg WS bridge |
| `terminal.open()` single-call + React removes container div | Terminal lost | Imperative `Map<sessionId,Terminal>` outside React; never unmount pane divs |
| `fitAddon.fit()` race during panel resize | Wrong PTY window size | Debounce 100ms; `requestAnimationFrame` |
| `@dnd-kit/core` absent from `package.json` | Phase 02 blocked | Confirm before Phase 02; install if absent |

## Unresolved Questions

1. `axum-reverse-proxy` 0.4.x: does it pass `Sec-WebSocket-Protocol: vite-hmr`? Lab test before Phase 04.
2. `@dnd-kit/core` not found in scout scan — must install for Phase 02.
3. Port disappearance while proxy in-flight: 502 immediately or brief drain? Decide in Phase 04.
4. Detected ports in-memory only — lost on server restart. Persist to state file? Out of MVP scope.
5. Last tab in pane closed: auto-collapse pane or show empty state?
