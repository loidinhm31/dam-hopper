---
title: "Terminal Files Explorer and Git Changes"
description: "Add accessible Explorer and Changes tabs to terminal mode's floating Files panel while sharing Git-diff state."
status: completed
priority: P2
effort: 6h
issue: null
branch: main
tags: [feature, frontend]
created: 2026-07-18
---

# Terminal Files Explorer and Git Changes

## Overview

In terminal workspace mode, extend the floating Files panel's left pane with Explorer and Changes tabs. Explorer stays default. Changes reuses `ChangedFilesList`; the right editor and separate Git popup stay unchanged.

## Preflight contract

- **Output:** accessible tabbed left pane, shared Git change actions, debounced FS-event Git cache refresh.
- **Done:** Explorer badges and Changes list share one aggregate query; stage/unstage, discard, commit, and diff-open work; 1920×1080 panel remains resizable; Git popup still owns branch/history/remotes.
- **In:** terminal floating Files panel, Workspace wiring, client query invalidation, tests, component docs.
- **Out:** server/API/auth/config/database changes, embedding `WorkspaceGitPanel`, redesigning ChangedFilesList, Git popup changes.
- **Risk areas:** tab focus/keyboard behavior, deleted-file diff open, multi-root entry routing, bursty FS events, stale index-only changes.
- **Tests:** unit scheduler + keyboard state; component tab/render checks; Workspace action wiring; browser/manual accessibility and Git workflow checks.
- **Open questions:** none. Index-only Git changes made wholly outside DamHopper may not emit an FS event because the server intentionally watches working-tree directories, not `.git`; tab activation/refetch remains the no-backend freshness fallback.

## Options considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Tabs in floating Files left pane | One familiar terminal workspace; shares FileTree, ChangedFilesList, and one query key; preserves editor | Needs focus semantics and compact layout care | **Selected** |
| Embed full WorkspaceGitPanel | Broad Git capability | Duplicates branch/history/remotes and creates a dense terminal panel | Rejected |
| Keep separate Explorer and Git popups only | Lowest code change | Does not make local changes reusable beside Explorer | Rejected |

## Architecture and side-effect review

- Shared state: both views call `useGitDiff(project, "*")`; TanStack Query deduplicates an identical active query.
- Refresh: a single client scheduler keyed by `(QueryClient, project)` coalesces FS events before invalidating Git-diff-related caches; existing `ChangedFilesList` mutation invalidation remains authoritative for its own actions.
- No auth, permissions, API, data, config, logging, database, deployment, or backend protocol changes.
- Performance: debounce and project scoping avoid an invalidation per watcher event. Do not poll or add a second diff API.
- Compatibility: preserve terminal panel layout persistence, Escape-to-close, FileTree decorations, and Git popup behavior.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Compose accessible terminal tabs | Completed 2026-07-18 | 2h | [phase-01](./phase-01-accessible-terminal-tabs.md) |
| 2 | Centralize Git refresh from FS events | Completed 2026-07-18 | 2h | [phase-02](./phase-02-git-diff-fs-invalidation.md) |
| 3 | Validate reuse and regressions | Completed 2026-07-18 | 2h | [phase-03](./phase-03-validation-and-documentation.md) |

## Affected files

- Modify `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx`
- Modify `packages/ui/src/components/pages/WorkspacePage.tsx`
- Modify `packages/ui/src/hooks/use-fs-subscription.ts`
- Create `packages/ui/src/lib/git-fs-invalidation.ts`
- Modify/create focused tests beside those modules
- Modify `docs/frontend-components.md` (architecture gate complete)

## Handoff

Implement phases in order. Do not replace `ChangedFilesList` or duplicate its mutations. Recheck the FS watcher limitation before claiming external index-only Git changes are instant.

## Phase 01 completion evidence

- Completed 2026-07-18: Explorer and Changes tabs are composed in the terminal floating Files panel while preserving the editor and separate Git popup.
- Validation passed: 595 UI tests, 28 browser tests, TypeScript check, and Prettier check.
- Review approved at 9/10. Subsequent phases were pending at that review point.

## Phase 03 completion evidence

- Completed 2026-07-18: validated the shared Explorer/Changes implementation, FS-event Git refresh behavior, and panel lifecycle lint regression fix without changing the Git popup's ownership of branch, history, or remotes.
- Automated validation passed: UI build, 601 unit tests, and 28 browser tests.
- Known verification limits: real-PTY/manual desktop checks (keyboard, watcher timing, resize, and destructive Git actions) remain release verification; root lint was run but remains blocked by pre-existing errors in `MultiTerminalDisplay.tsx` and `use-coarse-pointer.ts`.
