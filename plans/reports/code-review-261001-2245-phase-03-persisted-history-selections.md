# Code Review: Phase 03 — Persisted History Selections

**Date:** 2026-10-01 22:45 (Asia/Saigon)  
**Score:** 8.5/10  
**Status:** PASS with recommendations (no critical blockers, 2 high-priority edge-case fixes recommended)

---

## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/src/lib/git-branch-ref.ts` (107 lines)
  - `packages/ui/src/stores/git-history.ts` (700 lines)
  - `packages/ui/src/stores/git-history.test.ts` (448 lines)
- Lines of code analyzed: ~1,255 lines
- Review focus: Phase 03 persisted selection store, branch canonical ref disambiguation, schema validation, denied-storage resiliency, profile lifecycle isolation
- Updated plans: `plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md`

### Overall Assessment
Implementation adheres closely to design contract §3–4 and Phase 03 plan. Pure helper module `git-branch-ref.ts` cleanly isolates canonical ref formatting and branch resolution. `git-history.ts` follows Zustand persist patterns, enforces safe in-memory fallback when localStorage is blocked/denied, drops malformed scope/root entries individually, and retains selected project keys as unavailable tombstones upon profile deletion. Unit tests (23/23 passing) cover edge cases well. Typecheck (`tsc -p tsconfig.json`) passes cleanly. Two high-priority recovery/edge-case issues require attention to prevent subtle state desynchronization under schema migration and non-empty invalid selections.

---

### Critical Issues
None. No security vulnerabilities, credential leaks, crashes, or data loss risks.

---

### High Priority Findings (Warnings)

#### 1. `validateAndMergeGitHistoryState` drops `selectionRecoveryRequired` on unknown-version migration
- **Location:** `packages/ui/src/stores/git-history.ts:267-270`
- **Impact:** When migrating an unknown storage version (e.g. `version: 999`), `options.migrate` initializes `currentInitial.selectionRecoveryRequired = true`. However, `validateAndMergeGitHistoryState` ignores `current.selectionRecoveryRequired` and resets `recoveryRequired = false` unless `selectionRecoveryRequired` was explicitly present in the persisted state object. If stored data had valid keys and `version: 999`, the recovery flag is lost after migration, violating contract §3.60.
- **Fix:** Preserve `current.selectionRecoveryRequired`:
  ```ts
  let recoveryRequired = Boolean(current.selectionRecoveryRequired);
  if ("selectionRecoveryRequired" in persisted) {
    recoveryRequired = recoveryRequired || Boolean(persisted.selectionRecoveryRequired);
  }
  ```

#### 2. Non-empty invalid selection converts to `[]` (explicit all projects)
- **Location:** `packages/ui/src/stores/git-history.ts:281-307`
- **Impact:** If `persisted.gitPageSelection` is a non-empty array where all items are invalid strings (e.g. `["corrupt-item"]`), `validKeys` is `[]`, so `gitPageSelection` is assigned `[]`. In this store, `[]` represents explicit "all projects selected". If the user modifies another preference (e.g. root or branch) before recovery, `gitPageSelection: []` is written to storage. On next reload, it becomes permanent explicit "all", violating the contract: *"never turn corrupted nonempty selection into implicit all, including after another preference write/reload."*
- **Fix:** When `rawSel.length > 0 && validKeys.length === 0`, set `gitPageSelection = null` (or retain tombstones) instead of `[]`:
  ```ts
  if (hadInvalidKey) {
    recoveryRequired = true;
  }
  gitPageSelection =
    rawSel.length > 0 && validKeys.length === 0
      ? null
      : Array.from(new Set(validKeys)).sort();
  ```

---

### Medium Priority Improvements

#### 1. `setGitPageSelection(["invalid-key"])` converts to `[]` and clears recovery flag
- **Location:** `packages/ui/src/stores/git-history.ts:457-490`
- **Impact:** Calling `setGitPageSelection(["invalid-key"])` filters out invalid keys, resulting in `sorted = []`. It then updates state to `gitPageSelection: []` (all projects) and clears `selectionRecoveryRequired: false`.
- **Recommendation:** Validate passed keys and throw an `Error` on invalid project keys, matching the contract pattern in `setBranchPreference` and `resolveTargetKey`, or reject the update if `keys.length > 0 && validKeys.length === 0`.

#### 2. `isBranchCanonicalRef` accepts whitespace-only ref names
- **Location:** `packages/ui/src/lib/git-branch-ref.ts:56-62`
- **Impact:** `isBranchCanonicalRef("refs/heads/   ")` returns `true` because `"refs/heads/   ".length > 11`. `setBranchPreference` then trims it to `"refs/heads/"`, which is an invalid canonical ref.
- **Fix:**
  ```ts
  export function isBranchCanonicalRef(ref: string): boolean {
    if (typeof ref !== "string") return false;
    return (
      (ref.startsWith("refs/heads/") && ref.slice(11).trim().length > 0) ||
      (ref.startsWith("refs/remotes/") && ref.slice(13).trim().length > 0)
    );
  }
  ```

---

### Low Priority Suggestions

#### 1. Consistent string trimming in `resolveTargetKey`
- **Location:** `packages/ui/src/stores/git-history.ts:191`
- **Suggestion:** `resolveTargetKey` checks `!target.profileId || !target.project` without trimming, whereas `gitHistoryScopeKey` checks `scope.profileId?.trim()`. Trim before empty check for consistency.

#### 2. Add explicit unit test for version migration with valid keys
- **Location:** `packages/ui/src/stores/git-history.test.ts:371-388`
- **Suggestion:** Existing test `migrates unknown version by flagging selectionRecoveryRequired` used `gitPageSelection: ["some-key"]`. Because `"some-key"` is invalid JSON, `hadInvalidKey` triggered recovery. Add a test case with a valid project key and `version: 999` to ensure version mismatch alone triggers recovery.

---

### Positive Observations
- **KISS/YAGNI/DRY:** Only the 4 contracted state fields persisted (`gitPageSelection`, `rootByTarget`, `branchByScope`, `selectionRecoveryRequired`). No unnecessary store dependencies or premature abstraction.
- **Absence-as-default:** Store deletes entries when default `.` root or `follow-active` mode is set, keeping storage compact and preventing unbounded dictionary growth.
- **Shallow equality guards:** Actions verify equality before dispatching `set`, avoiding redundant Zustand re-renders.
- **Resilient storage adapter:** `createSafeGitHistoryStorage` wraps `localStorage` access/parse/quota exceptions cleanly; store remains functional in memory when storage is denied.
- **Clean modularization:** Branch canonical ref logic isolated into pure functions in `lib/git-branch-ref.ts`.
- **Profile lifecycle protection:** `handleProfileRemoved` clears root/branch mappings for deleted profiles while preserving selected project keys as unavailable tombstones, preventing unintended bulk all-projects expansion.

---

### Validation Commands & Results
- **TypeScript build/typecheck:**
  ```bash
  pnpm --filter ui build
  # tsc -p tsconfig.json -> Exit 0 (0 errors)
  ```
- **Focused test execution:**
  ```bash
  pnpm --filter ui test src/stores/git-history.test.ts
  # Tests: 23 passed (23) | Duration: 411ms -> Exit 0
  ```
- **Package test suite (tester subagent):**
  - Files: 286 | Tests: 2,102 passed (0 failed) -> Exit 0

---

### Metrics
- **Type Coverage:** 100% (Strict TypeScript, no `any`, typed parameters and return types throughout).
- **Test Coverage:** 23 focused unit tests covering disambiguation, scope/root parsing, defaults, profile lifecycle, recovery, corrupt storage, and storage denial.
- **Lint / Typecheck Issues:** 0 errors.

---

### Unresolved Questions
None.
