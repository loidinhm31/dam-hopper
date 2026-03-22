---
title: "Desktop App Migration (Electron + PTY Terminal)"
description: "Migrate dev-hub from server+web to Electron desktop app with full interactive PTY terminals"
status: pending
priority: P1
effort: 12h
branch: master
tags: [electron, pty, terminal, desktop, migration]
created: 2026-03-23
---

# Desktop App Migration

## Summary

Replace the current server+web architecture with an Electron desktop app. All commands (build, run, custom) execute in interactive PTY terminals (xterm.js + node-pty). No separate server process — just launch the app. CLI package removed.

## Decision: Electron over Tauri

- Codebase is 100% TypeScript — Electron gives native Node.js integration
- `@dev-hub/core` imports directly in main process, zero bridging
- `node-pty` is battle-tested (VS Code, Hyper use it)
- Rust toolchain often unavailable on enterprise Windows (needs Visual Studio)
- Tauri sidecar approach negates its size advantage

## Architecture (Target)

```
Electron Main Process (Node.js)
├── @dev-hub/core (direct import)
├── node-pty session manager (Map<id, IPty>)
├── IPC handlers (terminal, config, git, build, process)
└── Window management

Electron Renderer (Chromium)
├── React 19 + Vite + Tailwind v4 (existing @dev-hub/web)
├── xterm.js terminal panels (per command)
├── TanStack Query (for non-streaming APIs via IPC)
└── IPC bridge via contextBridge (preload.ts)
```

## Migration Strategy

Strip execa execution from `@dev-hub/core` (becomes pure config+state+git). Replace HTTP fetch → IPC invoke (Electron-only, no HTTP fallback). Replace SSE → IPC events. All process execution via node-pty in Electron. Absorb `@dev-hub/server` route logic into IPC handlers. Build with `electron-vite`. Package for Windows + Linux.

## Phases

| Phase | Title | Status | Effort | File |
|-------|-------|--------|--------|------|
| 01 | Electron Shell + IPC Foundation | done | 3h | [phase-01](./phase-01-electron-shell.md) |
| 02 | IPC API Layer (Replace HTTP) | done | 3h | [phase-02-ipc-api-layer.md](./phase-02-ipc-api-layer.md) |
| 03 | PTY Terminal Integration | pending | 3h | [phase-03-pty-terminal.md](./phase-03-pty-terminal.md) |
| 04 | Cleanup + Packaging | pending | 3h | [phase-04-cleanup-packaging.md](./phase-04-cleanup-packaging.md) |

## Dependency Graph

```
Phase 01 (Electron shell, preload, window)
    ↓
Phase 02 (IPC handlers replacing Hono routes)
    ↓
Phase 03 (node-pty + xterm.js terminal panels)
    ↓
Phase 04 (remove CLI/server, electron-builder packaging)
```

Sequential: each phase depends on the previous.

## Package Changes

| Package | Action |
|---------|--------|
| `@dev-hub/core` | Keep — imported directly in main process |
| `@dev-hub/cli` | Remove in Phase 04 |
| `@dev-hub/server` | Absorb into Electron main process, remove in Phase 04 |
| `@dev-hub/web` | Becomes renderer app, add xterm.js |
| `@dev-hub/electron` (new) | Electron main process + preload |

## Validation Summary

**Validated:** 2026-03-23
**Questions asked:** 6

### Confirmed Decisions

1. **No HTTP fallback** — Electron-only. Remove all fetch/SSE code. No dual-mode.
2. **Workspace init** — Last-used workspace persisted in Electron userData. First launch shows folder picker.
3. **Strip execution from core** — Remove execa-based execute/spawn from core services. Core becomes pure config+state+git. PTY session manager owns all process execution.
4. **Target platforms** — Windows + Linux. No macOS initially.
5. **Single window** — Keep WorkspaceSwitcher pattern. One window, switch context.
6. **Build tool** — `electron-vite` for Vite-native DX (main + preload + renderer in one config).

### Action Items (Plan Updates Applied)

- [x] Phase 01: Replace `electron-builder` references with `electron-vite` setup
- [x] Phase 01: Add `electron-store` for persisting last workspace path
- [x] Phase 02: Remove HTTP fallback section — IPC only, no dual-mode detection
- [x] Phase 03: Expand scope — strip execa execution from core BuildService/RunService/CommandService
- [x] Phase 04: Packaging for Windows (nsis/portable) + Linux (AppImage/deb) only, remove macOS targets
