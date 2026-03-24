# Analysis Report: Terminals & Git SSH Improvements

**Date**: 2026-03-24

## Feature 1: Remove Default Commands

**Root cause**: `useTerminalTree.ts` lines 59-60 and 73-74 use `??` fallback to `BUILD_PRESET`/`RUN_PRESET` maps, showing default commands for every project type regardless of user config.

**Fix scope**: 1 file, ~15 lines changed (remove 2 constants + 2 line changes). `ProjectInfoPanel.tsx` CommandsSection already correct. Core presets untouched.

**Risk**: Low. Guard clauses already handle `undefined`.

## Feature 2: SSH Passphrase UI

**Current state**: Zero SSH handling. `simpleGit` calls fail silently on auth. `GitError` with `category: "auth"` exists but is only shown as error text.

**Approach**: New IPC service (`ssh.ts`) using `SSH_ASKPASS` env var + `ssh-add`. UI dialog prompts on auth failure, retries operation after successful key load. Session-level cache prevents re-prompting.

**Touches**: All 3 packages — `ipc-channels.ts`, new `ssh.ts` handler, preload bridge, types, new dialog component, new retry hook, GitPage + ProjectInfoPanel integration.

**Risk**: Medium. SSH agent behavior varies by platform. Primary target is Linux.
