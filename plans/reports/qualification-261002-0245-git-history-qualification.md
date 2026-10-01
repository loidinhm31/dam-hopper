# Git History Search and Selection Persistence — End-to-End Qualification Report

**Date:** 2026-10-02  
**Feature:** Git history search and selection persistence (Phases 01–07)  
**Status:** Complete / Qualified  
**Evaluator:** Coordinator / Advisor Mentored Workflow  

---

## 1. Overview and Scope

This qualification report provides the end-to-end evidence record required by Phase 07 of the Git history search and selection persistence plan. Verification exercises both Git surfaces (Workspace Git panel and standalone Git page) against a real disposable repository running on a live local Axum server loopback instance, combined with headless Chromium browser automation via Vitest and Playwright.

---

## 2. Disposable Real Repository Architecture

A deterministic throwaway Git repository was constructed with >225 commits:
- **Initial Baseline Commit (`HASH_INITIAL`):**
  - Subject: `chore: initial baseline`
  - Body: `this contains needle-body in commit body`
- **History Gap:** 215 filler commits (`chore: filler commit 1` through `chore: filler commit 215`), placing the target commit >200 commits behind HEAD.
- **Multiple Distinct Matches:**
  - `feat: release needle alpha`
  - 5 filler commits (`chore: filler commit 216` through `220`)
  - `fix: release needle beta\n\nbody details for beta`
- **Literal String Punctuation & Flag Commits:**
  - `refactor: literal .* regex symbols`
  - `chore: literal --flag CLI argument`
  - `test: literal + & # ? % chars in message`
- **Local Feature Branch:** `feature/disposable-qualification` containing unique commit `feat: unique feature branch commit`.
- **Nested VCS Root:** Sub-repository in `packages/subpkg` with initial commit `feat(subpkg): nested root commit`.
- **Pre-Test HEAD SHA:** `06e52d719f2bdf7fb96891b8c09d7f7a4a816cba`.

---

## 3. Live Backend Loopback Smoke Results

The Axum backend was launched with `--no-auth` and an isolated configuration registering the disposable repository. Direct REST API calls to `GET /api/git/qual-project/log` verified all target scenarios:

| # | Scenario | Request Query | Observed Result | Invariant Verified |
|---|---|---|---|---|
| S1 | Older-than-200 body match | `?messageQuery=needle-body` | Returns 1 commit (`HASH_INITIAL`), message is `chore: initial baseline` | Search filters full message (subject & body) before 200-row pagination; DTO `message` remains subject-only text |
| S2 | Filtered pagination | `?messageQuery=release+needle&limit=1&offset=0` | Returns 1 commit (`release needle beta`) | Offset 0 retrieves newest match |
| S2b | Filtered pagination offset 1 | `?messageQuery=release+needle&limit=1&offset=1` | Returns 1 commit (`release needle alpha`) | Offset 1 retrieves second match; offsets count matching commits |
| S2c | Filtered pagination offset 2 | `?messageQuery=release+needle&limit=1&offset=2` | Returns 0 commits (`[]`) | Past-end offset returns empty array without error |
| S3 | Literal `--flag` | `?messageQuery=--flag` | Returns 1 commit (`chore: literal --flag CLI argument`) | Fixed-string matching prevents CLI argument injection |
| S4 | Literal `.*` regex | `?messageQuery=.*` | Returns 1 commit (`refactor: literal .* regex symbols`) | Regex wildcards are not interpreted; only literal `.*` matches |
| S5 | Punctuation encoding | `?messageQuery=%2B%20%26%20%23%20%3F%20%25` | Returns 1 commit (`test: literal + & # ? % chars in message`) | URL-encoded special characters pass through to Git search intact |
| S6 | Branch ref isolation | `?ref=feature/disposable-qualification&messageQuery=unique+feature` | Returns 1 commit on feature branch; returns 0 commits on `?ref=main` | Ref query isolates traversal to selected branch |
| S7 | Nested root query | `?root=packages/subpkg` | Returns 1 commit (`feat(subpkg): nested root commit`) | Root parameter addresses nested Git repositories |
| S8 | Validation boundaries | `?messageQuery=hello%0Aworld`, `?messageQuery=hello%00world` | HTTP `400 Bad Request` | Embedded CR, LF, and NUL are strictly rejected |
| S9 | HEAD immutability | `git rev-parse HEAD` post-queries | SHA remains `06e52d719f2bdf7fb96891b8c09d7f7a4a816cba` | History reading and branch view navigation never checkout or mutate HEAD |
| S10 | Latency benchmark | 20 rapid queries with nonexistent term | Avg: **10.37ms**, Min: **9.13ms**, Max: **12.09ms** | Fast Git traversal without indexing overhead |

---

## 4. Chromium Browser Automation & Surface Qualification

Headless Chromium browser suites were executed via Vitest and Playwright:

### 4.1 Git History Search & Persistence (`git-history-search-persistence.browser.tsx`)
- **Keyboard & Typing Debounce:** Search input debounced 300ms; user typing updates input and triggers query.
- **Escape & Clear Action:** Pressing `Escape` or clicking the Clear (X) button instantly clears search text and restores unfiltered view.
- **IME Composition Guard:** Verified `compositionstart` and `compositionend` event lifecycle; typing during composition defers search application.
- **Pagination & Notice Dismissal:** Page offset display (e.g. `201–250 commits`, `401–450 commits`), Next/Previous page buttons, and notice dismissal work accurately.
- **Compact Layout:** Verified responsive rendering in 400x600 viewport without layout overflow or broken controls.
- **SVG Graph Suppression in List Mode:** In `presentation="list"` (used during active search filtering), `<svg>` ancestry lanes and commit dots are completely omitted (0 SVGs found in DOM), preventing misleading ancestry edges. In `presentation="graph"`, SVGs render normally.
- **State Store Persistence:** `useGitHistoryStore` verified for qualified `[profileId, project, worktreePath, rootId]` scopes, canonical ref branch pinning (`refs/heads/...`, `refs/remotes/...`), return to `follow-active`, and Git page selection array persistence.

### 4.2 Workspace Git Panel Integration (`project-worktree-target.browser.tsx`)
- Verified target routing and switching across Workspace desktop IDE dock, floating panel, and compact surfaces.
- Reconciled mocks for `useGitHistoryView`, `useGitHistoryActions`, and `markHydrated()`.

---

## 5. Automated Verification Summary

| Suite | Scope | Passed | Failed | Status |
|---|---|---:|---:|---|
| Backend Git | `server/src/git/` and `api/git.rs` integration | 123 | 0 | PASS |
| UI Focused Unit | Store, hook, GitPage, WorkspaceGitPanel, branch control | 72 | 0 | PASS |
| Chromium Browser | Full browser triplet in Playwright Chromium | 17 | 0 | PASS |
| UI TypeScript | `packages/ui` (`tsc -p tsconfig.json`) | Clean | 0 | PASS |
| Web Production | `apps/web` (`vite build`) | Clean | 0 | PASS |
| Live API Smoke | Throwaway repo loopback Axum API | 10 | 0 | PASS |

---

## 6. Conclusion

Phase 07 qualification confirms that Git history message filtering, branch preference persistence, and Git page selection persistence satisfy all acceptance criteria and security invariants defined in the design contract.
