---
title: "Explorer editor Git blame annotations"
description: "Add current-buffer Git blame beside editor line numbers and reveal exact commits in Workspace Git."
status: in_progress
priority: P2
effort: "unestimated; sequence and acceptance gates defined"
branch: main
tags: [feature, frontend, backend, api, git, editor]
created: 2026-10-05
---

# Explorer editor Git blame — implementation plan

## Authority and outcome

- Phase 01 (Native semantics and contract proof) complete and verified. Ready to proceed with Phase 02 (Native blame and read-only Git API).
- [Accepted brainstorm](../reports/brainstorm-261005-2106-editor-git-blame-annotations.md) defines scope, refined by the validated decisions below; this plan supersedes its earlier decision to stop without planning.
- Right-click **line-number gutter** → toggle native blame column; normal author/date, compact author-only with full timestamp/hash/subject hover/focus; current unsaved edits are **Uncommitted**.
- **Show Commit in Git** reveals exact full message/files in **Workspace Git panel**, including old/filter-excluded commits. Preserve editor/dirty bytes and existing marker primary-click file diff.
- Normal/degraded Monaco + Markdown/HTML source panes; session per-tab toggle. No Explorer-tree menu, inline hunk popup, Git-page navigation, historical annotate UI, plugin, DB/settings migration or CLI fallback.

## Read first

1. [Frozen API/state/ownership/resource contracts](./contracts.md).
2. [Acceptance matrix, commands and actual-runtime recipe](./verification.md).
3. [Backend evidence](./research/backend-native-blame.md), [frontend evidence](./research/frontend-lifecycle-navigation.md), [workflow/runtime limits](./reports/planning-workflow.md).
4. [Workbench architecture design gate](../../docs/architecture/workbench-files-editor-and-git.md#planned-git-blame-annotation-contract).
5. [Current progress overview](./progress.md).

## Phases

| # | Phase | Dependency | Status / progress |
|---|---|---|---|
| 01 | [Native semantics and contract proof](./phase-01-native-semantics-and-contract-proof.md) | none | complete · 100% |
| 02 | [Native blame and read-only Git API](./phase-02-native-blame-and-read-only-git-api.md) | 01 | ready · 0% |
| 03 | [Owner-bound client and buffer lifecycle](./phase-03-owner-bound-client-and-buffer-lifecycle.md) | 01 contracts; 02 for runtime | pending · 0% |
| 04 | [Monaco annotation gutter and context menu](./phase-04-monaco-annotation-gutter-and-context-menu.md) | 03 | pending · 0% |
| 05 | [Workspace Git reveal and full commit details](./phase-05-workspace-git-reveal-and-full-commit-details.md) | 02–03 | pending · 0% |
| 06 | [Editor host integration and edge states](./phase-06-editor-host-integration-and-edge-states.md) | 03–05 | pending · 0% |
| 07 | [Qualification, evidence and documentation](./phase-07-qualification-evidence-and-documentation.md) | 01–06 | pending · 0% |

## Execution rules

- Follow phase order by default. 04/05 independent after interfaces fixed; one integration owner for shared client/query/editor/workspace files. Never run format/build/tests while sibling edits are in flight.
- Reread current files before implementation; plan line anchors are evidence, not edit snapshots. Preserve unexpected user changes. Use LSP references for exported signature changes when available.
- Each phase: complete scoped edits → focused regression once → exercise changed runtime path → record evidence → advance. Final full-app smoke and human visual review cannot be replaced by mocked component tests.
- Native proof precedes backend semantics. Git2 docs/CLI probe do not prove local native behavior; copy/move flags may be unimplemented.
- No silent scope reduction, shim, fake commit metadata, placeholder, auto-save/checkout or alternate-owner fallback. Stop a gate only with exact unreachable prerequisite/evidence.

## Decisions and hard risks

- Two new reads: protected POST `/api/git/{project}/blame`; exact GET `/api/git/{project}/commit/{hash}/details`. Existing edit-message snapshot API remains branch/CAS constrained.
- Buffer/baseline `<5 MiB`; blame JSON route32MiB only; bounded32MiB result; **two shared native workers/no queue**. HTTP abort is not native cancellation; permit remains with actual work.
- Latest-only hook state,250ms debounce; no source cache-per-keystroke. Every result/action tied to profile/generation, target/root/path, model identity/version, snapshot and repository epoch.
- Event-driven external refresh: window focus/visibility restoration, source activation or explicit Refresh Annotations; no feature-added periodic polling. Editor/FS/in-app Git triggers remain; continuously focused external changes may wait for a relevant event.
- Stable wrapper width: ≥640px →220px author/date; below640 →author-only `min(120px, wrapperWidth / 3)`, full hover/focus metadata. Public Monaco geometry, resize and context-menu ordering need actual-browser proof.
- Separate read-only inspection from canonical history selection/mutations. Ensure-open, not shortcut toggle, across IDE/terminal/compact.

## Completion gate

All A01–A11 in [verification](./verification.md) exercised; dirty-buffer→exact old commit/body full-app journey, no writes/owner leaks, bounds and existing Git safety preserved, docs/changelog updated, fresh local captures human-reviewed. No claim of unexercised native-host qualification.

## Validation Summary

**Validated/reconciled:** 2026-10-05 · **Questions asked:** 3 · [Answers and completed revision map](./reports/validation-interview.md).

### Confirmed Decisions
- Narrow editor: compact author-only column; date/full metadata in hover. Normal widths retain author/date.
- External changes: focus or manual refresh only, not periodic polling.
- Commit opened from blame: read-only inspection; existing history-row actions unchanged.

### Action Items
- [x] Contracts, affected phases and verification reconciled with compact layout, focus/manual refresh and no polling.
- [x] Revision map completed; read-only inspection confirmed. Planning ready for Phase01; implementation and runtime qualification remain pending.

## Unresolved questions

- No unresolved product choices or native runtime semantics. Native rename/CRLF/display-row proof completed in Phase 01. Phase 02 implementation ready.
- Container/browser/native-host availability and human review are execution prerequisites. Session plan helper could not persist activation (`EVCRATE_SESSION_ID` absent); use this file path directly.
