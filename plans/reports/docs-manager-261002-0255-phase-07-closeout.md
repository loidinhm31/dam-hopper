# Phase 07 Documentation Audit Closeout

**Date:** 2026-10-02  
**Scope:** `docs/api-reference.md`, `docs/frontend-components.md`, `docs/system-architecture.md`, and `docs/CHANGELOG.md`  
**Status:** Documentation audit complete. Implementation and qualification finalization are settled; durable Phase 07 completion remains pending coordinator closeout in explicit advice mode.

## Current state assessment

The four requested documents were reviewed at their Git-history Phase 07 sections, against the parent/phase plans, qualification/test/review reports, current API implementation, current browser-test sources, and the linked Git-history architecture guide. No protected plan, docs, or package file was edited; this report is the only deliverable change.

The API contract is substantially consistent with the current implementation: `messageQuery` is an optional camelCase query; the server trims it, rejects embedded CR/LF/NUL, passes it to Git as a fixed-string case-insensitive filter, applies matching before offset/limit, and retains the subject-only `message` response field for body matches. The API section correctly documents the response shape and links the detailed architecture guide. The docs also capture the shared history controller and owner/root/ref concepts.

The primary closeout risk is not the API behavior text; it is documentation status and qualification-evidence wording. Several current statements imply durable closure or browser/persistence proof stronger than the evidence detail in the checked-in reports and tests supports.

## Findings

### 1. Phase status conflicts with the explicit advice-mode closeout — high

- `docs/CHANGELOG.md` calls Phase 07 “complete” and “100%.”
- `docs/frontend-components.md` says Phase 07 “completes integrated qualification” across both surfaces.
- `docs/system-architecture.md` says Phase 07 “completes end-to-end qualification.”
- The parent plan says Phases 05–07 are implementation/qualification settled but durable completion is pending; it calls Phase 07 the durable completion gate. The execution instructions for this closeout explicitly prohibit marking Phase 07 DONE prematurely.

**Recommendation:** Keep the result as implementation/qualification settled, with durable completion pending, until the coordinator closes the gate. Change completion wording only when the authorized durable status changes. No baseline documentation edits were made because the file-ownership boundary prohibits them.

### 2. Browser qualification and persistence claims need evidence provenance — high

The Changelog describes the feature as “fully qualified” across the live Axum backend and React UI, and says Chromium verified debounce and persisted selections. The qualification report records a live API smoke separately from the browser suites. The current browser sources show narrower coverage:

- `git-history-search-persistence.browser.tsx` mounts a `ToolbarHarness` around the controlled toolbar and directly mutates/reads the Zustand store. Its selection test checks in-memory state in the same runtime; it does not verify reload/rehydration or persistence across browser sessions.
- `project-worktree-target.browser.tsx` mocks query/API and Git presentation dependencies. It verifies target routing, not end-to-end Git search against the live Axum server.
- The plan calls for actual-surface walkthroughs, persistence/reload, and screenshots. The checked-in qualification report does not link screenshots or a browser artifact that demonstrates those walkthroughs.

This does not rule out separate manual Chromium evidence; it means the present test sources and linked report do not make that evidence auditable. If such a walkthrough exists, link its artifact and identify its scope. Otherwise narrow the docs to distinguish live API qualification from browser component/target-routing tests, and avoid claiming browser-proven reload persistence or integrated live-server UI qualification.

### 3. Browser test totals disagree — medium

The qualification report and parent plan record **17** browser tests; the tester report and Changelog record **16** for the triplet. The Changelog additionally says the Git-history browser file passed **5/5**, while the current file contains six active `it()` cases, including the IME composition case. The current suite total cannot be reconciled from these different records alone.

**Recommendation:** Record one latest exact command/result, reconcile the aggregate and per-file counts against the current test sources, then align the phase evidence and Changelog. Do not infer a passing count from the older review summary.

### 4. Linked architecture guide still has pre-Phase-07 status — medium

`docs/architecture/git-history-search.md` is linked from the changed docs, but its status still says end-to-end qualification “remains Phase 07” and repeats that qualification is pending. Reconcile it with the approved durable status and the final evidence record when ownership permits. Under the current advice-mode instruction, the replacement should distinguish completed qualification evidence from pending durable closure.

### 5. API wording and changelog navigation — low

The API introduction says filtering and “pagination before offset”; this is ambiguous and appears to invert the intended order. The parameter detail below is clearer and correctly says matching occurs before offset/limit pagination. The new Changelog entry has no direct link to the Phase 07 plan or qualification report, unlike many neighboring entries.

**Recommendation:** Say plainly that filtering occurs before pagination and link the plan/qualification report from the Changelog entry.

### 6. Documentation size limit — medium

Against the injected `docs.maxLoc` limit of 800 lines, current sizes are:

| File | Lines | Limit status |
|---|---:|---|
| `docs/api-reference.md` | 2,922 | Over |
| `docs/frontend-components.md` | 801 | Over by 1 |
| `docs/system-architecture.md` | 5,486 | Over |
| `docs/CHANGELOG.md` | 349 | Within |

These are current-snapshot sizes; prior line counts were not compared, so this audit does not attribute any threshold crossing to Phase 07. No splitting was attempted because all `docs/*` files are protected by the current ownership boundary. Revisit modularization when documentation edits are authorized.

## Findings cleared from the prior review

The current snapshot no longer shows several earlier review nits: `### Projects` correctly contains `GET /api/projects`; the Changelog has consistent dash bullets and no standalone stray hyphen; and the browser toolbar harness now wires and tests composition-start/end events. These were not carried forward as open defects.

## Recommendations

1. Preserve the explicit advice-mode status: do not label Phase 07 DONE until coordinator durable closeout.
2. Reconcile browser evidence scope and test totals; attach or link actual-surface/reload evidence if it exists.
3. Synchronize the linked Git-history architecture guide and add plan/report links to the Changelog entry.
4. Clarify the API pagination sentence and schedule modularization of the three over-limit docs when their ownership opens.

## Metrics

- Requested documentation files reviewed: **4/4 (100%)**.
- Protected documentation files changed: **0/4**; only this report was written.
- `docs.maxLoc`: **1/4 within limit**, **3/4 over limit**.
- Documentation coverage percentage and update frequency: **not measured** by this phase-focused audit.

## Unresolved questions

1. Is there separate, retained evidence for real Chromium Git-page/Workspace search against the live Axum server and persisted-selection reloads? If so, where should the docs link it?
2. Which exact current browser run is authoritative: 16 or 17 aggregate cases, and five or six cases in `git-history-search-persistence.browser.tsx`?
