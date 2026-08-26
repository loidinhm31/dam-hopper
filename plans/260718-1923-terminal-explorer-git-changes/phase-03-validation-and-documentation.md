---
title: "Phase 03: Validation and documentation"
status: completed
priority: P2
created: 2026-07-18
---

# Phase 03: Validation and documentation

## Context links

- [Plan overview](./plan.md)
- [Phase 01](./phase-01-accessible-terminal-tabs.md)
- [Phase 02](./phase-02-git-diff-fs-invalidation.md)
- [Frontend components](../../docs/frontend-components.md)
- [Terminal panel tests](../../packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx)

## Overview

**Date:** 2026-07-18. **Priority:** P2. **Status:** completed 2026-07-18. Reuse, accessibility, freshness, and regressions validated; component documentation remains accurate.

## Key insights

- Query reuse is observable through one aggregate `['git-diff', project, '*']` key, not by asserting implementation internals of TanStack Query.
- File operations and Git mutations cover different freshness routes: FS events versus explicit mutation invalidation.
- Browser tests cannot fully emulate a real PTY; desktop keyboard/resize checks remain required release verification.

## Requirements

- Validate happy path, no project, deleted/conflicted file, multiple Git roots, action failure, rapid FS events, and panel resize.
- Maintain strict TypeScript and existing terminal accessibility behavior.
- Do not update unrelated docs or alter server behavior to make a test pass.

## Architecture

Tests form three layers: pure scheduler/state tests, React component integration tests with mocked transport/API boundaries, then browser/manual terminal checks against a local project with tracked, modified, deleted, untracked, staged, and multi-root files.

## Related code files

- **Modify:** `packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx`.
- **Modify/create:** `packages/ui/src/components/pages/WorkspacePage.test.tsx`.
- **Modify:** `packages/ui/src/components/organisms/ChangedFilesList.test.tsx` only for exposed regression helpers; do not duplicate action tests without need.
- **Create:** scheduler/hook tests listed in Phase 02.
- **Modify only if design drifts:** `docs/frontend-components.md`.

## Implementation steps

1. Run focused Vitest files for panel, Workspace, ChangedFilesList, Git state, and scheduler/hook tests; fix genuine regressions.
2. Run package type-check/lint/test commands available in the checkout. Record environmental blockers separately; do not substitute fake passing output.
3. Browser/manual: terminal mode → open Files → tab via keyboard → verify focus/announcements → create/modify/delete file from terminal → verify debounced badges/list → stage/unstage/discard/commit → open diffs including deleted/conflicted/multi-root entry.
4. Resize Files panel near viewport width/height at 1920×1080 and ensure both tabs remain usable; then open the separate Git popup and verify branch/history/remotes remain there.
5. Compare implementation with this plan and the frontend component doc; patch only intentional documented drift.

## Todo list

- [x] Run unit/component coverage.
- [x] Run type-check, lint, and package tests.
- [x] Complete browser coverage and record real-PTY/manual release-check limits.
- [x] Review implementation against plan/docs.

## Success criteria

- All available automated checks pass, or external environment blockers are explicitly reported.
- Explorer | Changes is keyboard accessible and neither creates duplicate aggregate diff fetches nor stale FS-event state.
- Git local-change actions work through reused `ChangedFilesList`; Git popup functionality remains separate.

## Risk assessment

- **Flaky timer tests:** use fake timers and explicit disposal/reset hooks.
- **PTY test gap:** retain manual desktop verification; browser mocks are insufficient for actual shell lifecycle and watcher timing.
- **Destructive discard:** manual test only in a disposable fixture repository.

## Security considerations

Use a temporary fixture repository for discard/commit tests. Never include credentials, tokens, or private remote URLs in test fixtures or docs.

## Next steps

Phase completed and approved 2026-07-18. Manual real-PTY desktop verification remains a release check; root lint was run but is blocked by pre-existing errors in `MultiTerminalDisplay.tsx` and `use-coarse-pointer.ts`.
