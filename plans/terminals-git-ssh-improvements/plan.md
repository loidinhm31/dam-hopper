---
title: "Terminals & Git SSH Improvements"
description: "Remove default build/run commands from Terminals page and add SSH passphrase input UI for git operations"
status: pending
priority: P2
effort: 6h
branch: master
tags: [terminals, git, ssh, ui, electron]
created: 2026-03-24
---

# Terminals & Git SSH Improvements

## Summary

Two independent features improving the Terminals and Git pages:

1. **Remove default build/run commands** from the terminal tree — only show explicitly configured commands
2. **SSH passphrase input from UI** — detect auth failures, prompt for passphrase, load into ssh-agent, retry

## Phases

| # | Phase | Effort | Status | File |
|---|-------|--------|--------|------|
| 01 | [Remove Default Commands](./phase-01-remove-default-commands.md) | 1.5h | done | `useTerminalTree.ts`, `ProjectInfoPanel.tsx` |
| 02 | [SSH Passphrase UI](./phase-02-ssh-passphrase-ui.md) | 4.5h | pending | New SSH service, IPC, dialog component |

## Architecture Impact

- **Phase 01**: Web package only. Remove preset fallback in UI layer; core preset system untouched.
- **Phase 02**: All three packages affected. New IPC channels, Electron SSH service, preload bridge extension, React dialog + retry hook.

## Dependencies

- Phase 01 and Phase 02 are independent — can be implemented in any order or in parallel.

## Validation Summary

**Validated:** 2026-03-24
**Questions asked:** 4

### Confirmed Decisions
- **SSH passphrase method**: Use node-pty wrapper (already a dependency) — cross-platform, reliable
- **No ssh-agent running**: Show error with instructions, don't auto-start
- **SSH key selection**: Show key file picker (scan ~/.ssh/ for key files)
- **Preset badge cleanup**: Remove preset source code from CommandPreview (dead code after Phase 01)

### Action Items
- [ ] Phase 02: Update ssh.ts to use node-pty instead of SSH_ASKPASS for passphrase piping
- [ ] Phase 02: Add key file scanner + dropdown to PassphraseDialog
- [ ] Phase 02: Add ssh-agent detection with user-friendly error message
- [ ] Phase 01: Remove "preset" source option from CommandPreview component
