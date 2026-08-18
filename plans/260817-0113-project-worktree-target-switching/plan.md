---
title: Project worktree target switching
description: Add a session-scoped worktree target per project so all workspace panels can operate on a registered Git worktree without changing project identity.
status: completed
priority: P2
effort: 44h
branch: feat/project-worktree-switching
tags: [worktree, workspace, filesystem, git, editor, terminal]
created: 2026-08-17
last_reviewed: 2026-08-19
review_status: approved
---

# Project worktree target switching

## Outcome

Each configured project discovers its registered Git worktrees and exposes a selector in the Project panel. Explorer, search, Git, editors, media previews, and newly created terminals use the selected target; the project switcher and configuration remain unchanged. Selection is session-only and defaults to the configured root after restart.

## Current handoff

Implementation and validation gates pass. The follow-up findings are fixed: PTY incarnation events are guarded across replacement, restore hydrates scrollback before reader startup, unavailable-target state is monotonic across retry failures, path identity handles platform aliases, bulk Git failures reconcile per target, and worktree-removal failures fall back without stale-query races. Final independent review approved the implementation after the public contract fields were reconciled.

## Architecture decisions

- Carry `ProjectTargetRef { project, worktreePath? }` on every root-sensitive operation; never mutate `project.path` or store a global server selection.
- Validate worktree paths server-side against `git worktree list --porcelain` for the configured repository before sandbox, Git, media, or PTY use.
- Partition frontend caches, editor tabs, and terminal identities by a stable `targetKey`; keep nested Git `root` as a separate axis.
- Block app removal for dirty tabs/live terminals. On external disappearance, fall back to root for new work while preserving unavailable dirty tabs and running terminals.

## Phases

1. [Target contract and secure resolution](./phase-01-target-contract-and-resolution.md) — 6h — completed
2. [Target-aware filesystem, WebSocket, and media](./phase-02-target-aware-fs-ws-media.md) — 8h — completed
3. [Session selection and live discovery](./phase-03-session-selection-and-discovery.md) — 6h — completed
4. [Git routing and cache isolation](./phase-04-git-routing-and-cache-isolation.md) — 5h — completed
5. [Editor and diff isolation](./phase-05-editor-and-diff-isolation.md) — 6h — completed
6. [Terminal target identity and persistence](./phase-06-terminal-target-identity.md) — 7h — completed
7. [Lifecycle integration and release validation](./phase-07-lifecycle-integration-and-validation.md) — 6h — completed

## Dependency order

Phase 1 is foundational. Phases 2 and 3 follow it; Phases 4–6 require the shared contract and relevant transport/state work. Phase 7 begins only after all feature surfaces are target-aware.

## Definition of done

- A project can switch among its configured root and valid registered worktrees without changing project identity.
- All root-sensitive operations resolve the same selected target and remain isolated across targets.
- Restart, removal, disappearance, migration, and concurrent-resource behavior match the documented lifecycle.
- Rust, UI unit, browser, lint, TypeScript build/type-check, and production build gates pass; API and user-facing documentation are updated.
