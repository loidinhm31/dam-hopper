---
title: "Git history message search and selection persistence"
description: "Search commit subjects/bodies on both Git surfaces and restore owner-scoped project/history-branch selections."
status: in-progress
priority: P2
effort: 26h
branch: main
tags: [feature, frontend, backend, api, git]
created: 2026-10-01
---

# Git history search and selection persistence

Implementation in progress. Phases 01 and 02 are complete; Phases 03–07 remain pending. Paths relative to repository root `/home/loidinh/WS/dam-hopper`; phase ownership assumes that root.

## Deliverables

1. Workspace Git panel: search full commit messages across selected branch history, before pagination.
2. Git page: same search, branch-view selection and paging; preserve existing bulk operations.
3. Restore selected project and per-target/root history branch across navigation/remount/reload; no automatic checkout.

## Decisions

- Existing Git CLI `log` filter; literal, case-insensitive subjects/bodies; 300 ms debounce; 200 matching commits/page; no response-envelope change.
- Reuse canonical persisted Workspace project; separate persisted Git-page checkbox set preserves empty=all without clearing Workspace focus.
- Shared branch/root preference store and controller. Profile/project/worktree/root isolation; follow-active vs pinned canonical branch ref.
- Filtered list omits misleading graph edges. Search/page/commit/dialogs transient. No author/hash/diff filters, indexing, automatic checkout, or worktree-persistence expansion.
- Loading/offline does not erase preferences; missing saved selection never silently widens bulk requests to all projects.

## Phases

| # | Phase | Status / progress | Effort | Depends on |
|---|---|---|---|---|
| 01 | [Server message filtering](./phase-01-server-message-search.md) | DONE / 100% (2026-10-01 21:12:48 +07:00) | 4h | Contract |
| 02 | [Transport and owned queries](./phase-02-transport-query-contract.md) | DONE / 100% (2026-10-01 21:55:00 +07:00) | 3h | 01 contract |
| 03 | [Persisted selection store](./phase-03-persisted-history-selections.md) | Pending / 0% | 4h | Contract |
| 04 | [Shared history controller and controls](./phase-04-shared-history-view.md) | Pending / 0% | 4h | 02, 03 |
| 05 | [Workspace integration](./phase-05-workspace-git-integration.md) | Pending / 0% | 3h | 04 |
| 06 | [Git page integration](./phase-06-git-page-integration.md) | Pending / 0% | 4h | 04 |
| 07 | [End-to-end qualification and docs](./phase-07-qualification-documentation.md) | Pending / 0% | 4h | 01–06 |

## Execution contract

- Read [design-contract.md](./design-contract.md) first; exact state/wire/UX/lifecycle requirements. Each phase has numbered steps, ownership, acceptance, risks and security checks.
- Parallel wave A: 01 + 03; 02 can join against frozen optional-field contract. Wave B: 04. Wave C: 05 + 06. Wave D: 07. No concurrent edits to shared files.
- Coordinator owns integration and final verification. Workers edit their listed files, add consumer-visible regressions, report changed symbols/risks; skip builds/tests/lint/formatters mid-flight. Shared APIs and both caller slices cut over atomically; run integration checks and real smoke after all slices land, not while old callers remain incompatible.
- No completion by scaffold, mocks, local page filtering, lost selections, ambient-owner refresh, or tests alone. Record real API/browser evidence before marking complete.
- Current LSP status: no configured servers. If available during implementation, use references before exported-symbol changes.

## Evidence

- [Enhanced hard-planning brief](./research/planning-brief.md); [history research](./research/history-search-research.md); [persistence research](./research/selection-persistence-research.md).
- [Architecture overview](../../docs/system-architecture.md#git-history-search-and-selection-persistence-2026-10-01-phase-01-server-implementation): Phase 01 server implementation and Phase 02 client transport/owned-query contract are complete; persisted selection and integrated qualification remain pending.
- Read-only installed-Git filter smoke succeeded; no feature tests/builds/browser scenarios run during planning.
- Workflow/skills loaded directly from global OMP files. Slash-dispatch tool unavailable; applied `/cmd-plan__hard` procedure directly. Activation helper ran, but missing `EVCRATE_SESSION_ID` prevents active-plan session persistence.

## Validation Summary

Validated 2026-10-01: three decision topics plus one branch-intent clarification.

- User confirmed subject-and-body search.
- User confirmed restoring Git page's own last project selection, not following later Workspace navigation.
- User confirmed history selector independent of checkout: every explicit selected branch stays pinned, including the current branch. Follow-active only default/explicit opt-in.
- Contract and affected phases updated; no decision revisions remain pending. Repository/Markdown checks recorded in [planning validation](./reports/planning-validation.md); application qualification remains Phase 07.

## Unresolved questions

None blocking; search semantics, follow-active behavior, checkbox/focus separation and worktree scope explicitly selected in the contract.
