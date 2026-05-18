---
title: "IntelliJ Real Git Semantics"
description: "Refactor DamHopper Git operations so Rust server executes real Git porcelain semantics while preserving the current IntelliJ-like web UI."
status: pending
priority: P1
effort: 28h
issue:
branch: main
tags: [feature, refactor, backend, frontend, git]
created: 2026-05-19
---

# IntelliJ Real Git Semantics

## Overview

Refactor DamHopper Git behavior around real `git` CLI porcelain executed by the Rust server. Keep the current web UI shape where possible because it already targets IntelliJ-like workflows. Change internals and mutation contracts where current behavior diverges from IntelliJ IDEA semantics.

Primary outcomes:

- File rollback/drop does not feel like app reload.
- Drop commit works for local unpushed history with descendants.
- Pushed/shared history uses revert semantics by default.
- UI exposes operation state and recovery instead of generic errors.

Plan progress: 1/4 phases complete (25%).

## Phases

| #   | Phase                       | Status               | Effort | Link                                                  |
| --- | --------------------------- | -------------------- | ------ | ----------------------------------------------------- |
| 1   | Backend Real Git Semantics  | Completed 2026-05-19 | 10h    | [phase-01](./phase-01-backend-real-git-semantics.md)  |
| 2   | Frontend Operation State    | Pending              | 7h     | [phase-02](./phase-02-frontend-operation-state.md)    |
| 3   | IntelliJ-Compatible Actions | Pending              | 7h     | [phase-03](./phase-03-intellij-compatible-actions.md) |
| 4   | Verification and Docs       | Pending              | 4h     | [phase-04](./phase-04-verification-and-docs.md)       |

## Dependencies

- Existing Git modules in `server/src/git/`.
- Existing Git UI components in `packages/web/src/components/organisms/`.
- Existing brainstorm report: [brainstorm report](../reports/brainstorm-260519-0043-intellij-git-operations.md).

## Design Decisions

- Use real `git` CLI porcelain for mutating operations. No shell interpolation. Use `Command::new("git").args(...)`.
- Keep `git2` only for read-heavy operations where behavior is proven equivalent and easier, such as simple status/diff reads.
- Do not port IntelliJ source. Port behavior contracts.
- Preserve current UI components unless state model forces local refactor.
- Block pushed commit drop by default. Add revert for shared history first. Force-push policy can come later.

## Success Criteria

- `cargo test` passes for Git operation tests.
- Web tests cover mutation invalidation and status banner behavior.
- Dropping selected file or rolling back local file does not trigger `window.location.reload()`.
- Open editor tabs are coherent after rollback/drop.
- Drop commit succeeds for HEAD and non-HEAD unpushed commits.
- Rebase/cherry-pick/merge in-progress states are visible and recoverable.

## Unresolved Questions

- Should force-push workflows be added after safe revert/drop are stable?
- Should open editor tabs auto-refresh after Git rollback, or show a stale-file prompt?
- Should IntelliJ changelists be modeled later, or should DamHopper stay with plain Git staging?
