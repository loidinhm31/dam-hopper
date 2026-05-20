---
title: "IntelliJ Submodule VCS Roots"
description: "Make DamHopper manage nested Git repositories and submodules as IntelliJ-style VCS roots."
status: in-progress
priority: P1
effort: 18h
branch: main
tags: [feature, backend, frontend, git]
created: 2026-05-20
---

# IntelliJ Submodule VCS Roots

## Overview

Fix DamHopper Git management for projects like `/mnt/data/ws/sharing/glean-oak`, where the parent repository has many gitlink submodules and incomplete `.gitmodules` mappings. The Git panel must keep working even when `git submodule status --recursive` fails.

Use IntelliJ-style semantics: detect nested Git repositories as VCS roots, keep parent gitlink state separate from child repository state, and run branch/history/file operations against the selected root by default.

Plan progress: 1/4 phases complete (25%).

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Backend VCS Root Discovery | Complete | 5h | [phase-01](./phase-01-backend-vcs-root-discovery.md) |
| 2 | Root-Aware Git Operations | Pending | 6h | [phase-02](./phase-02-root-aware-git-operations.md) |
| 3 | Frontend VCS Root UI | Pending | 5h | [phase-03](./phase-03-frontend-vcs-root-ui.md) |
| 4 | Tests Docs Validation | Pending | 2h | [phase-04](./phase-04-tests-docs-validation.md) |

## Dependencies

- Existing real Git semantics plan: `plans/260519-0059-intellij-real-git-semantics/`.
- Existing backend Git modules in `server/src/git/`.
- Existing Git UI in `packages/web/src/components/organisms/`.
- Manual validation repository: `/mnt/data/ws/sharing/glean-oak`.

## Design Decisions

- Auto-detect VCS roots from `.git`, gitlink index entries, and `.gitmodules` metadata.
- Treat `.gitmodules` as optional metadata, not source of truth.
- Default all branch/history mutations to the selected root only.
- Preserve existing safe-vs-rewrite history protections.
- Do not implement synchronous all-root branch control in this plan.

## Success Criteria

- `glean-oak` Git panel loads despite missing `.gitmodules` mappings.
- Parent repo shows submodule gitlink rows separately from child repo file changes.
- Child repo stage/discard/commit operations run inside that child repo.
- Branch checkout affects selected root only.
- Backend and web tests cover malformed submodule mapping regressions.

## Unresolved Questions

- None for v1. Synchronous all-root branch workflows are explicitly deferred.
