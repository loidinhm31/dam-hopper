---
parent: plan.md
phase: "03"
status: pending
effort: 1h
dependencies: [phase-01-core.md, phase-02-ui.md]
---

# Phase 03: Integration — Env Auto-Loading & Polish

## Context

- Parent: [plan.md](plan.md)
- Depends on: [Phase 01](phase-01-core.md), [Phase 02](phase-02-ui.md)

## Overview

Ensure that when a command is launched (whether from suggestion or custom), the project's `env_file` is automatically loaded into the terminal environment. Polish the full flow end-to-end.

## Key Insights

- `resolveEnv(project, workspaceRoot)` already loads project `env_file` — this works for project-scoped terminals
- `TERMINAL_CREATE` IPC handler already calls `resolveEnv` when project is known
- Main work: ensure suggested commands route through the same project-aware terminal creation path
- Free terminals (no project) don't load env files — this is correct behavior

## Requirements

1. Verify project env_file loaded for all suggested command launches
2. Ensure terminal tab/tree shows the command name (not raw session ID)
3. Show suggestion source indicator in tree (preset vs custom)
4. Handle edge case: project with no env_file (no-op, just process.env)
5. End-to-end test flow

## Related Code Files

| File | Action |
|------|--------|
| `packages/electron/src/main/ipc/terminal.ts` | **Verify** — env resolution for suggested commands |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` | **Edit** — show command name in tree |
| `packages/web/src/components/organisms/TerminalTabBar.tsx` | **Edit** — show command name in tabs |

## Implementation Steps

### 1. Verify Env Loading Path

The existing `TERMINAL_CREATE` handler resolves env like this:
```
project found → resolveEnv(project, workspaceRoot) → env passed to ptyManager.create()
```

For suggested commands launched via `onLaunchTerminal(projectName, command)`:
- Session ID includes project name → handler looks up project → resolves env ✓
- No changes needed if suggested commands flow through existing launch path

**Action:** Verify in terminal.ts that `custom:` prefixed sessions (which suggested commands will use) go through project env resolution. Add test if missing.

### 2. Display Command Name in Tree & Tabs

Currently `CommandRow` shows `cmd.key` which is the raw key (e.g., "build", "run", "my-custom-cmd").

For suggested commands, the key should be the human-readable name from the definition (e.g., "Build (skip tests)").

Update `TreeCommand` usage:
- `cmd.key` = sanitized ID key
- Add `cmd.label` = display name (from CommandDefinition.name or fallback to key)

### 3. Source Indicator

In the tree, show a subtle indicator for preset commands vs user-defined:
- Preset commands: small icon or muted text "(preset)"
- User custom commands: no indicator (default)
- This helps users understand which commands came from the database

## Todo

- [ ] Verify env loading for suggested command terminals
- [ ] Add `label` field to TreeCommand for display names
- [ ] Update CommandRow to show label instead of key
- [ ] Update TerminalTabBar to show command label
- [ ] Add source indicator (preset vs custom)
- [ ] End-to-end manual test: suggest → select → launch → verify env loaded

## Success Criteria

- Suggested command terminal has correct env vars from project env_file
- Tree and tabs show human-readable command names
- Users can distinguish preset vs custom commands visually
- No regression in existing terminal creation flows

## Risk Assessment

- **Low**: Mostly verification and cosmetic changes
- **Low**: Env loading path already works, just ensuring suggested commands use it
