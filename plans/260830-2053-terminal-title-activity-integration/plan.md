---
title: "Integrate terminal title ordinals and activity indicators"
description: "Merge local develop without losing the dirty worktree, Traditional project panels, output-activity state, or project-scoped visible terminal ordinals."
status: pending
priority: P1
effort: 6h 30m
branch: feat/terminal-traditional-projects-panel
tags: [integration, frontend, terminal, merge]
created: 2026-08-30
---

# Terminal Title and Activity Integration

## Overview

Merge local `develop` into `feat/terminal-traditional-projects-panel`. Keep the current dirty worktree untouched during reconciliation by using a sibling integration worktree. Preserve complete develop ancestry, Traditional terminal project navigation, unified browser-local activity/restart behavior, and project-scoped visible title ordinals.

## Baseline

- Merge base: `68d9a609`; feature HEAD at research: `964506ba`; local `develop`: `b6ad672b`.
- Develop title commit: `6160ede8`.
- Feature commits: `7a8ae3b7` (Traditional projects), `964506ba` (unified activity indicators).
- Current original worktree: 121 staged, 7 unstaged, 1 untracked path group at inspection. Treat all as user-owned/unverified.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---:|---:|---|
| 1 | Preserve boundary and forecast merge | Pending | 1h | [phase-01](./phase-01-preserve-worktree-and-forecast.md) |
| 2 | Merge and reconcile terminal contracts | Pending | 3h | [phase-02](./phase-02-merge-and-reconcile-terminal-contracts.md) |
| 3 | Compile and behavior validation | Pending | 1h 45m | [phase-03](./phase-03-compile-and-behavior-validation.md) |
| 4 | Review, docs, and safe branch adoption | Pending | 45m | [phase-04](./phase-04-review-docs-and-adoption.md) |

## Design decisions

- Real `--no-ff` merge of local `develop`; no rebase, cherry-pick reconstruction, or broad ours/theirs resolution.
- Raw `TabEntry` remains identity/state. `DisplayTabEntry` adds ephemeral structured title projection.
- Visible `project:bash #N` ordinals count per exact project. Existing notification `Project · Bash #N` keeps global 1-based open-tab order.
- Activity and title are sibling projections. Neither becomes identity; `sessionId` remains authoritative.
- Original dirty worktree remains untouched until final, explicit preservation/adoption steps.

## Dependencies

- Local `develop` ref unchanged or Phase 1 repeated on ref drift.
- Sibling worktree path available.
- pnpm dependencies and Playwright Chromium available for Phase 3.

## Unresolved questions

- None. Ref drift or new dirty paths triggers re-inventory, not a design change.
