---
title: "Safe Inline Terminal Suggestions"
description: "Replace silence-based terminal suggestions with verified shell lifecycle, suffix-only ghost text, and explicit accessible history reuse."
status: in_progress
priority: P1
effort: 64h
branch: main
tags: [bugfix, feature, frontend, backend, security]
created: 2026-07-16
---

# Safe Inline Terminal Suggestions

## Overview

Eliminate secret capture, stale acceptance, terminal-key hijacking, and destructive
line replacement before improving reuse and cursor placement. Desktop first. Automatic
suggestions require verified shell lifecycle; unsupported shells fail closed to an
explicit history workflow.

## Agreed invariants

- no PTY-silence prompt detection
- no history outside validated shell `E -> C` submission
- native Tab/Enter/Escape/Ctrl+R/paste/TUI input passes unchanged in passive mode
- passive candidates are exact true prefixes; acceptance sends suffix only, never Enter
- every input/lifecycle revision clears old results synchronously
- lifecycle, geometry, or shell uncertainty hides automatic UI
- local history preserves exact commands and has clear/disable controls
- mobile automatic suggestions remain disabled until input routing is unified

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Security containment + history privacy | Completed 2026-07-16 | 100% | 8h | [Phase 01](./phase-01-security-containment-and-history-privacy.md) |
| 2 | Verified shell lifecycle integration | Pending | 0% | 16h | [Phase 02](./phase-02-shell-lifecycle-integration.md) |
| 3 | Suggestion controller + history/search separation | Pending | 0% | 12h | [Phase 03](./phase-03-suggestion-controller-and-history-search.md) |
| 4 | Ghost geometry + explicit history list | Pending | 0% | 14h | [Phase 04](./phase-04-ghost-geometry-and-explicit-history-list.md) |
| 5 | Release validation, docs, rollout | Pending | 0% | 14h | [Phase 05](./phase-05-release-validation-documentation-and-rollout.md) |

## Dependencies

`Phase 01 -> Phase 02 -> Phase 03 -> Phase 04 -> Phase 05`

Phase 04 may prototype geometry after Phase 03 defines immutable ghost snapshots, but
must not merge automatic UI before lifecycle and controller gates pass.

## Preflight blockers

- Free `/mnt/data` space; current 100% usage causes Vite/Vitest `ENOSPC`.
- Re-scout and reconcile user-owned dirty changes in terminal, settings, API, and server
  config files. Never reset or overwrite them.
- Confirm v1 shell matrix, acceptance key, legacy-history disposition, and marker trust
  scope during plan validation.

## References

- [Brainstorm](../reports/brainstorm-260716-0030-inline-terminal-suggestions.md)
- [Shell lifecycle research](./research/researcher-01-shell-lifecycle-security.md)
- [xterm interaction research](./research/researcher-02-xterm-interaction-geometry.md)
- [System architecture](../../docs/system-architecture.md#inline-terminal-suggestions-planned)

## Validation Summary

**Validated:** 2026-07-16  
**Questions asked:** 4

### Confirmed Decisions

- v1 shells: bash, zsh, fish; PowerShell explicit-history fallback
- accept keys: configurable Alt+Right full, Alt+Shift+Right token
- legacy history: retain unchanged; user will clear browser storage manually
- threat scope: accidental leakage; hostile same-user process documented out of scope

### Completed Action Items

- [x] Revised Phase 01 for no automatic deletion of legacy local history.
- [x] Added user-facing controls to clear browser-local history or disable future persistence.

### Phase 01 Completion

**Completed:** 2026-07-16

- Removed PTY-silence authorization, automatic overlay rendering, interception, and
  outgoing-Enter command recording.
- Added a single unavailable-by-default capability gate; automatic suggestions remain
  off until Phase 02 supplies a verified shell editing lifecycle.
- Preserved original terminal byte sequences in containment mode and removed launch
  path history recording.
- Added local command-history clear/disable controls and exact-command storage.
- Retained existing local history unchanged. No automatic purge or migration runs;
  users may clear it manually from Settings.
