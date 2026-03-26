---
title: "Free Terminals"
description: "Add standalone terminals not tied to any project, like VS Code's integrated terminal"
status: done
priority: P2
effort: 3h
branch: main
tags: [terminal, ux, electron, react]
created: 2026-03-26
completed: 2026-03-26
---

# Free Terminals

Add a "Free Terminal" type — standalone terminals not tied to any project. Users can open terminals freely (like VS Code's integrated terminal) without selecting a project or saving a profile path.

## Motivation

Currently all terminals are project-scoped. Users who just want a quick shell at the workspace root must pick a project first. This adds friction for common tasks like running ad-hoc commands, exploring the workspace, or using tools not associated with any project.

## Approach

- New session ID prefix: `free:${timestamp}` → derives type `"free"`
- `project` field becomes optional in IPC/types
- Default cwd: workspace root directory
- New "Terminals" section in tree sidebar (above projects)
- Quick-launch button for instant terminal creation
- Auto-incrementing labels: "Terminal 1", "Terminal 2", etc.

## Implementation Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Backend: Types + IPC + PTY | done | 45min | [phase-01-backend.md](./phase-01-backend.md) |
| 2 | Frontend: Tree + UI + Handlers | done | 1.5h | [phase-02-frontend.md](./phase-02-frontend.md) |
| 3 | Polish: Keyboard shortcut + UX | done | 45min | [phase-03-polish.md](./phase-03-polish.md) |

## Research

- [Backend research](./research/researcher-01-backend.md)
- [Frontend research](./research/researcher-02-frontend.md)

## Key Design Decisions

1. **Session ID prefix**: `free:` — simple, consistent with existing prefix-based type derivation
2. **No config persistence**: Free terminals don't save to `dev-hub.toml` — they're ephemeral
3. **Workspace root as cwd**: Default working directory is workspace root, not home dir
4. **Tree placement**: "Terminals" section at top of tree, before project nodes
5. **Optional project**: `project` field becomes optional across IPC/types rather than using sentinel values
6. **Interactive login shell**: Empty command — node-pty spawns user's default shell with login profile (matches VS Code)

## Validation Summary

**Validated:** 2026-03-26
**Questions asked:** 4

### Confirmed Decisions
- **Tree placement**: "Terminals" section above projects (top of tree)
- **Default CWD**: Workspace root directory
- **Phase 03 scope**: Include all of Phase 03 (keyboard shortcut, dashboard card, empty state UX)
- **Shell command**: Interactive login shell (empty command, node-pty spawns default shell)

### Action Items
- [ ] Update Phase 01 to use empty command (not `/bin/bash`) for free terminal shell
- [ ] Phase 03 stays in full scope — no trimming needed
