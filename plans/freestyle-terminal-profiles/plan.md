---
title: "Freestyle Terminal Profiles"
description: "Add saved terminal profiles with custom cwd and command per project, supporting multiple concurrent instances"
status: done
priority: P1
effort: 4h
branch: main
tags: [terminal, config, ux, electron, core]
created: 2026-03-25
---

# Freestyle Terminal Profiles

## Summary

Add saved terminal profiles per project where users can define a working directory + command, persist them in `dev-hub.toml`, and launch multiple concurrent instances from the same profile.

## Validated Design Decisions

**Project-level `[[projects.terminals]]`** in `dev-hub.toml`.

- Terminals belong to projects (cwd relative to project root)
- One saved terminal can spawn multiple concurrent instances
- Replaces existing auto-save shell behavior (no more `shell-${timestamp}` keys)
- Minimal launch UX: path + command to launch, save is a separate action

### Config Format

```toml
[[projects]]
name = "api-server"
path = "./api-server"
type = "npm"

[[projects.terminals]]
name = "Claude Agent"
command = "claude"
cwd = "./src"              # relative to project root

[[projects.terminals]]
name = "Dev Server"
command = "pnpm dev"
cwd = "."
```

### Tree Layout (multi-instance)

```
[▼ api-server]
  ├─ build
  ├─ run
  ├─ [▼ Claude Agent]     ▶ (click = new instance)
  │   ├─ ● instance #1     (running)
  │   └─ ● instance #2     (running)
  └─ [▼ Dev Server]
      └─ ○ (no instances)   (idle)
```

### UX Flow

1. **Launch**: minimal form — path + command only → spawns terminal immediately
2. **Save**: from running terminal tab → save button → prompted for name → persists to config
3. **Re-launch**: click saved terminal in tree → spawns new instance
4. **Multiple instances**: each click spawns a new session, all listed as children

## Implementation Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Core: Schema & Config | done | [phase-01](./phase-01-core-schema.md) |
| 2 | Electron: IPC & PTY | done | [phase-02](./phase-02-electron-ipc.md) |
| 3 | Web: UI Components | done | [phase-03](./phase-03-web-ui.md) |

## Key Files to Modify

### @dev-hub/core
- `packages/core/src/config/schema.ts` — Add TerminalProfileSchema to ProjectConfigSchema
- `packages/core/src/config/parser.ts` — Serialize/deserialize project terminals array
- `packages/core/src/index.ts` — Export new types

### @dev-hub/electron
- `packages/electron/src/main/ipc/terminal.ts` — Accept optional `cwd` in TERMINAL_CREATE
- `packages/electron/src/main/pty/session-manager.ts` — Add `cwd` to SessionMeta
- `packages/electron/src/main/ipc/config.ts` — Add terminal profile CRUD IPC handlers
- `packages/electron/src/preload/index.ts` — Expose profile APIs
- `packages/electron/src/ipc-channels.ts` — Add new channels

### @dev-hub/web
- `packages/web/src/pages/TerminalsPage.tsx` — Launch form, save action, remove old shell auto-save
- `packages/web/src/components/organisms/TerminalTreeView.tsx` — Expandable profiles with instance children
- `packages/web/src/hooks/useTerminalTree.ts` — Include saved terminals + multi-instance tracking
- `packages/web/src/types/electron.d.ts` — Type definitions
- `packages/web/src/api/queries.ts` — Profile query hooks

## Validation Summary

**Validated:** 2026-03-25
**Questions asked:** 3

### Confirmed Decisions
- **Scope**: Project-level (cwd relative to project root), not workspace-level
- **Multi-instance**: One saved terminal can spawn many concurrent sessions
- **Auto-save**: Replace existing shell timestamp auto-save with explicit save-as-profile
- **UX**: Minimal form (path + command) to launch; save is a separate action from running tab
- **Tree**: Expandable parent node per saved terminal, child nodes per running instance

### Action Items
- [x] Revise plan from workspace-level `[[terminals]]` to project-level `[[projects.terminals]]`
- [x] Update phase files to reflect multi-instance session tracking
- [x] Remove old shell auto-save logic from phase-03
