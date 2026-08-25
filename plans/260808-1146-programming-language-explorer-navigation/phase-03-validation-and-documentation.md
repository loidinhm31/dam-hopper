---
title: "Explorer Navigation, Reveal, and Release Validation"
description: "Render language scan navigation, coordinate reveal, and complete release validation."
status: completed
priority: P2
effort: 6.5h
branch: main
tags: [feature, frontend, explorer, validation]
created: 2026-08-08
---

# Phase 03: Explorer Navigation, Reveal, and Release Validation

## Context links

- Parent: [plan.md](./plan.md)
- Scout: [scout report](../reports/scout-260808-1146-programming-language-explorer-navigation.md)
- Cache/settings: [phase-02](./phase-02-explorer-language-filter-ui.md)
- Explorer: [`FileTree.tsx`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx:253)
- Reveal helper: [`file-tree-reveal.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tree-reveal.ts:21)
- Decoration registry: [`file-decoration.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-decoration.ts:24)
- Browser config: [`vitest.browser.config.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/vitest.browser.config.ts:1)

## Overview

- Date: 2026-08-08
- Priority: P2
- Description: Render the full-project navigation hierarchy, coordinate reveal safely, and complete cross-layer release evidence.
- Implementation status: Complete (2026-08-10 00:36:17 +07:00)
- Review status: Complete (2026-08-10 00:36:17 +07:00)

## Key Insights

- Full-project results cannot be represented by pruning the lazy tree; build deterministic synthetic directories and real-metadata file nodes from scan paths.
- `All` and language modes have different capability boundaries. Language mode is navigation-only so synthetic nodes cannot drive rename/delete/move/upload.
- Persisted filters can hydrate before any in-memory scan exists; show an explicit Scan call-to-action and never auto-run.
- Reveal correctness requires a state machine across React/Arborist commits, not a same-effect `setFilter` followed by reveal.

## Requirements

- Add an accessible selector named `Filter Explorer by language` and explicit Scan/Rescan action with pending, error, stale, truncated, last-scanned, and no-result states.
- `All` renders the existing live lazy tree and all filesystem actions unchanged.
- Language mode filters scan files by family, applies hidden-path presentation recursively, and builds a sorted hierarchy with synthetic directories plus file metadata/IDs.
- Opening a scan file passes an `FsArborNode` with exact path/name/size/mtime to the existing callback.
- Disable context menus, drag/drop, create/rename/delete/upload, and lazy child loading in language mode; keep expand/collapse and file activation.
- Selecting a filter with no cache shows `Scan project to show <language> files`; a stale cache remains usable with `Results may be outdated` and Rescan.
- Truncated results remain usable with a clear `Showing first 20,000 matching files` warning.
- On filter, project, or scan-result replacement, clear Arborist selection/focus and intersect any operation targets with currently rendered live-tree IDs.
- Reveal while filtered: persist/set `all`, record pending nonce, wait until `All` data has committed to Arborist, reveal via live tree/lazy loading, then mark nonce handled. Do not restore the prior filter.
- Unit and Chromium tests cover hierarchy, mappings, no-cache/manual scan, Rescan, stale/truncated/error states, hidden paths, exact open metadata, selection safety, and reveal sequencing.

## Architecture

Test flow:

```text
persisted filter + project scan cache
  -> All: live subscribed lazy tree + filesystem capabilities
  -> Language: family paths -> hidden filter -> synthetic hierarchy -> navigation

reveal nonce while filtered
  -> persist All -> wait committed live tree -> reveal/load ancestors -> consume nonce
```

## Related code files

Modify:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tree-reveal.ts` (only if state-independent sequencing helpers are useful)
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-decoration.test.ts` (parity fixtures only)
- `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md`
- `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`

Create:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/explorer-language-tree.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/explorer-language-tree.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/file-tree-language-navigation.browser.tsx`

Test files from prior phases are also modified/created as listed there.

Delete: none.

## Implementation Steps

1. Implement the pure scan-file-to-tree builder with path normalization checks, deterministic sorting, family filtering, hidden segment filtering, and source immutability tests.
2. Add selector and Scan/Rescan controls to the existing header; preserve compact/terminal layouts and existing Refresh/hidden actions.
3. Route `All` to live data and language choices to the synthetic hierarchy; gate filesystem capabilities by mode.
4. Present manual-scan, pending, error-with-old-results, stale, truncated, empty-family, and last-scanned states.
5. Implement the reset/commit/reveal nonce state machine and clear selection/focus on mode/result changes.
6. Add focused component/unit tests plus a dedicated Chromium regression for Radix/Arborist timing and keyboard behavior.
7. Update frontend/architecture docs and record exact validation results.

## Todo list

- [x] Build deterministic full-project navigation tree.
- [x] Add persisted selector and manual Scan/Rescan states.
- [x] Separate live-tree actions from navigation-only mode.
- [x] Implement commit-gated reveal and selection cleanup.
- [x] Add unit/component/Chromium regressions.
- [x] Update release records and run focused-to-broad validation.

## Success Criteria

- A language selection can navigate every returned project file without loading Explorer directories.
- No scan occurs until Scan/Rescan is activated; stale results never auto-refresh.
- All/live-tree behavior and filesystem actions remain unchanged.
- Reveal resets/persists `All` and cannot consume a nonce before the unfiltered tree commit.
- Hidden or synthetic selections cannot enter destructive operations.
- Focused Rust/API/UI/Chromium tests, UI build, lint, backend tests, and `pnpm check` results are recorded.

## Risk Assessment

- Rendering 20,000 virtual rows can stress Arborist; keep construction O(total path segments), memoized by result/filter/showHidden, and rely on virtualization.
- Synthetic and live nodes can share IDs across mode changes; clear selection and avoid carrying NodeApi references across renders.
- Browser tests need the existing ResizeObserver/Arborist harness and explicit render-boundary assertions.

## Security Considerations

- Reject scan paths that are absolute, empty, or contain `..` before hierarchy construction even though the server is authoritative.
- Language mode exposes no mutating operation from synthetic nodes.
- Test fixtures use only synthetic relative paths and no host data.

## Completion validation (2026-08-10 00:36:17 +07:00)

- Focused UI unit tests, focused Rust/API tests, and `pnpm --filter @dam-hopper/ui build`: passed.
- Focused language-tree/reveal and browser regression coverage: passed for the Phase 03 feature paths.
- Broad browser validation: not fully green because of an unrelated existing `terminalRegistry` import failure in terminal coverage.
- `pnpm check`: reached native package validation but could not complete because of native package disk quota; temporary-file checks need a `TMPDIR` workaround because `/tmp` quota is exhausted.
- Review: implementation scope and acceptance criteria checked; no feature blocker identified. Coverage percentages remain unavailable where the repository coverage dependency is absent.

Known external caveats are recorded without treating environment/baseline failures as Phase 03 feature failures.

## Next steps

Implement phases in order, then perform code review and architecture drift checks. Re-run the pending higher-rank advisor validation when model access is available; do not treat that pending review as implementation approval.
