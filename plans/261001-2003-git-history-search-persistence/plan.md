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

Implementation remains in progress. Phases 01–04 are durably complete. Phases 05–07 implementation, qualification, and review are settled, but durable completion is pending coordinator closeout in explicit advice mode; do not mark them DONE. Durable delivery: 4/7 phases (57%; 15/26h, 58%); implementation/review settled through Phase 07: 7/7 (100%; 26/26h, 100%).

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
| 03 | [Persisted selection store](./phase-03-persisted-history-selections.md) | DONE / 100% (2026-10-01 22:59:53 +07:00) | 4h | Contract |
| 04 | [Shared history controller and controls](./phase-04-shared-history-view.md) | DONE / 100% (2026-10-02 00:16 +07:00) | 4h | 02, 03 |
| 05 | [Workspace integration](./phase-05-workspace-git-integration.md) | Implementation/finalization settled; durable completion pending (explicit advice mode; not DONE) | 3h | 04 |
| 06 | [Git page integration](./phase-06-git-page-integration.md) | Implementation/finalization settled; durable completion pending (explicit advice mode; not DONE) | 4h | 04 |
| 07 | [End-to-end qualification and docs](./phase-07-qualification-documentation.md) | Implementation/qualification settled; review complete (9.4/10 PASS) | 4h | 01–06 |

## Execution contract

- Read [design-contract.md](./design-contract.md) first; exact state/wire/UX/lifecycle requirements. Each phase has numbered steps, ownership, acceptance, risks and security checks.
- Parallel wave A: 01 + 03; 02 can join against frozen optional-field contract. Wave B: 04. Wave C: 05 + 06. Wave D: 07. No concurrent edits to shared files.
- Coordinator owns integration and final verification. Workers edit their listed files, add consumer-visible regressions, report changed symbols/risks; skip builds/tests/lint/formatters mid-flight. Shared APIs and both caller slices cut over atomically; run integration checks and real smoke after all slices land, not while old callers remain incompatible.
- No completion by scaffold, mocks, local page filtering, lost selections, ambient-owner refresh, or tests alone. Record real API/browser evidence before marking complete.
- Current LSP status: no configured servers. If available during implementation, use references before exported-symbol changes.

## Evidence

- [Enhanced hard-planning brief](./research/planning-brief.md); [history research](./research/history-search-research.md); [persistence research](./research/selection-persistence-research.md).
- [System architecture](../../docs/system-architecture.md) and [Git-history architecture guide](../../docs/architecture/git-history-search.md) document the shared feature architecture. Phases 01–04 are durably complete; Phases 05–06 implementation/finalization is settled but durable completion is pending in explicit advice mode; Phase 07 remains pending. Phase 05 scoped evidence: [test report](../reports/tester-261002-0051-phase-05-workspace-git-integration.md), [code review](../reports/code-review-261002-0051-phase-05-workspace-git-integration.md), [Docs Manager closeout](../reports/docs-manager-261002-0051-phase-05-workspace-git-integration.md), and [PM closeout](../reports/project-manager-261002-0051-phase-05-workspace-git-integration.md). See the [Phase 04 plan](./phase-04-shared-history-view.md) and [Phase 04 closeout](../reports/project-manager-261002-0016-phase-04-shared-history-view.md).
- Phase 06 scoped evidence: [tester report](../reports/tester-261002-0145-phase-06-git-page-integration.md) records the focused Git page suite passing 9/9 and the UI suite passing 2,186/2,186; [code review](../reports/code-review-261002-0148-phase-06-git-page-integration.md) scored 9.5/10 PASS and reports clean TypeScript checking. Production build and integrated API/browser qualification were not run for this phase. [Project Manager closeout](../reports/project-manager-261002-0148-phase-06-git-page-integration.md). Phase 07 remains the durable completion gate.
- Phase 07 scoped evidence: [qualification report](../reports/qualification-261002-0245-git-history-qualification.md), [tester report](../reports/tester-261002-0238-phase-07-qualification.md), and [code review](../reports/code-review-261002-0240-phase-07-qualification.md). Live Axum loopback smoke (10/10 scenarios passed), Chromium browser tests (17/17 passed), and sub-15ms search latency measured on disposable repository.
- Current-tree Phase 03 focused store tests passed 26/26 after follow-up recovery/selection/canonical-ref fixes. The earlier UI package suite passed 2,102/2,102 before those fixes and was not rerun afterward; the initial review scored 8.5/10 PASS with recommendations, and no post-fix code review was recorded. See the [test report](../reports/tester-261001-2241-phase-03-persisted-history-selections.md) and [code review](../reports/code-review-261001-2245-phase-03-persisted-history-selections.md).
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
