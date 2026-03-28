---
title: "Agent Store — Central AI Agent Config Management"
description: "Add a central store in Dev-Hub to manage AI agent skills, commands, hooks, MCP servers, subagents, and project memory files (CLAUDE.md, GEMINI.md), then distribute them to individual projects via symlinks or copy"
status: pending
priority: P1
effort: ~20h
branch: feat/agent-store
tags: [electron, agent, skills, commands, mcp, ipc, core]
created: 2026-03-28
---

# Agent Store — Central AI Agent Config Management

## Goal
Extend Dev-Hub with a **central agent config store** that lets users install skills, commands, hooks, MCP configs, and subagent definitions once, then ship (symlink/copy) them to any number of managed projects. Also manage project memory files (`CLAUDE.md`, `GEMINI.md`) via templates.

## Architecture Overview

```
Dev-Hub Workspace Root
├── .dev-hub/agent-store/          ← central store (new)
│   ├── skills/                    ← SKILL.md folders
│   ├── commands/                  ← slash command .md files
│   ├── hooks/                     ← hook scripts
│   ├── mcp-servers/               ← MCP server config fragments
│   ├── subagents/                 ← agent definition files
│   └── memory-templates/          ← CLAUDE.md / GEMINI.md templates
│
├── dev-hub.toml                   ← extended with [agent_store] section
│
├── project-a/
│   ├── .claude/skills/planning → ../../.dev-hub/agent-store/skills/planning (symlink)
│   └── CLAUDE.md                  ← generated from template
│
└── project-b/
    ├── .gemini/skills/planning → ../../.dev-hub/agent-store/skills/planning (symlink)
    └── GEMINI.md
```

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 01 | Core Types, Schema & Store Service | done | ~4h | [phase-01](./phase-01-core-types-schema-store.md) |
| 02 | Scanner & Distributor (Ship/Unship) | done | ~4h | [phase-02](./phase-02-scanner-distributor.md) |
| 03 | IPC Channels & Electron Handlers | done | ~4h | [phase-03](./phase-03-ipc-electron-handlers.md) |
| 04 | Web API, Queries & Agent Store Page | pending | ~5h | [phase-04](./phase-04-web-ui-agent-store-page.md) |
| 05 | Memory Templates & Import from Repo | pending | ~3h | [phase-05](./phase-05-memory-templates-import.md) |

## Key Design Decisions

- **Symlink-first distribution**: Both Claude Code and Gemini resolve symlinks for skills. Symlink by default, with copy as per-item fallback.
- **TOML = manifest, filesystem = content**: `dev-hub.toml` tracks assignments (which items go to which projects); actual skill files (MD, JS, Python) stay as regular files.
- **Workspace-scoped**: Central store lives at `.dev-hub/agent-store/` under workspace root — not global. Each workspace manages its own agent configs.
- **Agent-aware distributor**: When shipping to a project, the distributor knows the target agent's directory convention (`.claude/skills/`, `.gemini/skills/`) and adapts.
- **Non-destructive**: Absorbing existing project skills into central store creates symlink back at original location — nothing breaks.
- **Follows existing patterns**: New IPC module follows same `registerXxxHandlers(holder)` pattern as git, config, settings handlers.

## Supported Agents (Phase 1)

| Agent | Skills Dir | Commands Dir | Hooks Dir | MCP Config | Memory File |
|---|---|---|---|---|---|
| Claude Code | `.claude/skills/` | `.claude/commands/` | `.claude/hooks/` | `.claude/.mcp.json` | `CLAUDE.md` |
| Gemini | `.gemini/skills/` | `.gemini/commands/` | `.gemini/hooks/` | `.gemini/.mcp.json` | `GEMINI.md` |

## Extended `dev-hub.toml` Format

```toml
[workspace]
name = "my-workspace"

[agent_store]
path = ".dev-hub/agent-store"   # relative to workspace root

[[projects]]
name = "api-server"
path = "./api-server"
type = "maven"

[projects.agents.claude]
skills = ["planning", "backend-development"]
commands = ["plan", "debug"]
distribution = "symlink"
memory_template = "backend-service"

[projects.agents.gemini]
skills = ["planning"]
memory_template = "backend-service"
```

## Validation Summary

**Validated:** 2026-03-28
**Questions asked:** 6

### Confirmed Decisions

1. **Store git tracking**: Keep local-only for now (gitignored). Git-tracked team sharing is backlogged for future.
2. **Agent scope**: Claude + Gemini only. No extensible registry needed yet — add other agents when there's demand.
3. **Unship safety for copies**: Compare hash of copied file vs store original. If modified, warn user and require confirmation before deleting.
4. **Git clone for repo import**: Use `PtySessionManager` instead of `execSync` — non-blocking, shows progress, follows existing execution patterns.
5. **MCP server distribution**: Append-only merge strategy. Each MCP store item is a JSON fragment with one server entry. Ship appends to `.mcp.json`, unship removes that entry.
6. **Template engine**: Use `handlebars` package for full template power (if/each/helpers). Remove the hand-rolled `{{var}}` replacement approach from Phase 05.

### Action Items
- [ ] Phase 02: Add file hash comparison to `unship()` for copied (non-symlinked) files — warn if content differs from store original
- [ ] Phase 05 Part B: Replace `execSync` git clone with `PtySessionManager`-based execution
- [ ] Phase 05 Part A: Replace custom `{{var}}` renderer with `handlebars` package. Update `renderTemplate()` implementation and add `handlebars` to core dependencies
- [ ] Phase 02/03: Implement append-only MCP JSON merge in distributor — ship adds server entry, unship removes it
- [ ] Add `.dev-hub/` to `.gitignore` template (local-only for now). Backlog: add `git_tracked` option to `[agent_store]` config
