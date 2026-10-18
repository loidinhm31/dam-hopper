# QA Test Execution & Validation Report: Worktree Selection Persistence

- **Date:** 2026-10-18
- **Agent:** WorktreeTester (QA Engineer)
- **Target:** Worktree selection persistence across page reload (`feat/worktree-select-persistence`)
- **Report Path:** `plans/reports/qa-261018-1344-worktree-selection-persistence.md`
- **Status:** **FAILED (Automated Verification Gate Blocked)**

---

## 1. Test Results Overview

| Verification Step | Command | Result | Test Files | Total Tests | Passed | Failed | Duration |
|---|---|---|---|---|---|---|---|
| **1a. Prescribed Focused Suite** | `pnpm --filter @dam-hopper/ui test run <7 target test files>` | **FAIL** | 13 (1 failed, 12 passed) | 154 | 151 | 3 | 1.71s (vitest) / 2.27s (wall) |
| **1b. Targeted Focused Suite (exact files)** | `pnpm --filter @dam-hopper/ui test <7 target test files>` | **FAIL** | 7 (1 failed, 6 passed) | 111 | 108 | 3 | 1.29s (vitest) / 1.84s (wall) |
| **2. UI Typecheck** | `pnpm --filter @dam-hopper/ui build` | **PASS** | N/A | N/A | Pass | 0 | 8.61s (wall) |
| **3. Changed-File Lint** | `pnpm exec eslint packages/ui/src/stores/project-target.ts packages/ui/src/lib/fresh-state-reset.ts packages/ui/src/stores/project-target.test.ts packages/ui/src/hooks/use-project-target.test.tsx` | **PASS** | 4 files | N/A | Pass | 0 | 1.64s (wall) |
| **4a. UI Suite (`test run`)** | `pnpm --filter @dam-hopper/ui test run` | **PASS** (narrowed) | 6 | 51 | 51 | 0 | 1.24s (vitest) / 1.79s (wall) |
| **4b. Full UI Suite** | `pnpm --filter @dam-hopper/ui test` | **FAIL** | 327 (1 failed, 326 passed) | ~1,200+ | All passed except 3 | 3 | 20.69s (vitest) / 21.30s (wall) |

> **Note on Command Arguments:** In `packages/ui/package.json`, `"test": "vitest run"`. Passing `test run ...` causes Vitest to treat `run` as a positional filename pattern filter. For Step 1, it matched 6 additional files containing `run` (13 files total). For Step 4, `test run` matched only files containing `run` (6 files / 51 tests). The genuine full UI test suite invocation is `pnpm --filter @dam-hopper/ui test` (327 files total; 326 passed, 1 failed with the exact same 3 test failures).

---

## 2. Coverage Metrics

- **Automated V8 Coverage Instrumentation:** Unavailable (`@vitest/coverage-v8` is not installed in monorepo dependencies; running with `--coverage` terminates with `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`). Per project policy, no inferred or speculative coverage percentages are claimed.
- **Observed Unit Matrix Coverage:**
  - Store persistence happy path, rehydration, and recreation: Covered & passing.
  - Profile isolation (`server-a` vs `server-b` vs bare `demo`): Covered & passing.
  - Envelope validation, corrupted JSON resilience, quota/storage denial handling: Covered & passing.
  - Fresh-state reset integration and bootstrap order: Covered & passing.
  - Hook snapshot restoration before discovery and reactive update on rehydrate: Covered & passing.
  - Prototype pollution & special scope key defenses (`constructor`, `toString`, `__proto__`): **Failing on unavailable target maps**.

---

## 3. Failed Tests Details

### Failures in `packages/ui/src/stores/project-target.test.ts` (3 failed tests)

1. **`project target store persistence > enforces null-prototype active map and defends against prototype pollution for special name 'constructor'`**
   - **Assertion:** `expect(store.getState().unavailableTargetByProject[specialName]).toBeUndefined()`
   - **Expected:** `undefined`
   - **Received:** `[Function Object]`
   - **Location:** `packages/ui/src/stores/project-target.test.ts:818:9`

2. **`project target store persistence > enforces null-prototype active map and defends against prototype pollution for special name 'toString'`**
   - **Assertion:** `expect(store.getState().unavailableTargetByProject[specialName]).toBeUndefined()`
   - **Expected:** `undefined`
   - **Received:** `[Function toString]`
   - **Location:** `packages/ui/src/stores/project-target.test.ts:818:9`

3. **`project target store persistence > enforces null-prototype active map and defends against prototype pollution for special name '__proto__'`**
   - **Assertion:** `expect(store.getState().unavailableTargetByProject[specialName]).toBeUndefined()`
   - **Expected:** `undefined`
   - **Received:** `{}`
   - **Location:** `packages/ui/src/stores/project-target.test.ts:818:9`

### Root Cause Analysis

In `packages/ui/src/stores/project-target.ts`:
- `activeTargetByProject` was refactored with `createEmptyTargetMap()` (`Object.create(null)`) and `copyTargetMap()`.
- However, `unavailableTargetByProject` and `unavailableTargetsByProject` were initialized as `{}` (ordinary JavaScript objects inheriting from `Object.prototype`) and updated using standard object spread (`{ ...state.unavailableTargetByProject }`), which creates ordinary `Object.prototype` objects.
- In `clearUnavailableTarget(specialName)`:
  ```ts
  const next = { ...state.unavailableTargetByProject };
  delete next[key];
  ```
  Deleting the own property `key` from an object inheriting `Object.prototype` causes subsequent property access (`next[specialName]`) to resolve inherited properties from `Object.prototype` (`Object.prototype.constructor`, `Object.prototype.toString`, `Object.prototype.__proto__`).
- Consequently, accessing `store.getState().unavailableTargetByProject['constructor']` returns `[Function: Object]`, not `undefined`.

---

## 4. Performance Metrics

- **Step 1 (Focused Unit & Integration Tests):** 1.71s vitest duration / 2.27s wall clock.
- **Step 2 (UI TypeScript Build):** 8.61s wall clock (`tsc -p tsconfig.json`).
- **Step 3 (ESLint on Changed Files):** 1.64s wall clock (0 errors, 0 warnings).
- **Step 4 (Full UI Test Suite):** 20.69s vitest duration / 21.30s wall clock across 327 test files.
- No slow tests, timeouts, or intermittent test retries observed.

---

## 5. Build & Lint Status

- **Build (`tsc -p tsconfig.json`):** Clean pass. No syntax errors, no type errors.
- **Lint (`eslint`):** Clean pass across all 4 touched UI files (`project-target.ts`, `fresh-state-reset.ts`, `project-target.test.ts`, `use-project-target.test.tsx`). No warnings.

---

## 6. Critical Issues

1. **Automated Verification Gate Blocked:** 3 unit tests fail in `packages/ui/src/stores/project-target.test.ts`. Feature cannot be verified as complete until this is resolved.
2. **File Ownership Violation Prevention:** Per `plan.md`, Phase 01 (`Phase01StorePersistence`) exclusively owns `packages/ui/src/stores/project-target.ts`. QA must not patch source code out-of-band; fix must be routed to Phase 01.

---

## 7. Recommendations for Remediation (Phase 01)

1. **Durable Null-Prototype Records:**
   Create generic null-prototype record helpers in `packages/ui/src/stores/project-target.ts`:
   ```ts
   function createEmptyRecord<T>(): Record<string, T> {
     return Object.create(null) as Record<string, T>;
   }

   function copyRecord<T>(source?: Record<string, T>): Record<string, T> {
     const next = createEmptyRecord<T>();
     if (source) {
       Object.assign(next, source);
     }
     return next;
   }
   ```
2. **Initialize and Clone Both Unavailable Maps with Null Prototypes:**
   - Initialize `unavailableTargetByProject: createEmptyRecord<string>()` and `unavailableTargetsByProject: createEmptyRecord<string[]>()`.
   - In `resetTarget`, `markTargetUnavailable`, and `clearUnavailableTarget`, use `copyRecord(...)` instead of `{ ...state.unavailable... }`.
   - Never use object spread syntax (`{ ... }`) on null-prototype maps as spread returns a plain object inheriting `Object.prototype`.
3. **Verify Both Maps:**
   Ensure both `unavailableTargetByProject` and `unavailableTargetsByProject` defend against special-name keys (`constructor`, `toString`, `__proto__`) across marking, clearing, and reset.

---

## 8. Evidence Boundaries & Next Steps

- **Unverified Items:**
  - Real browser page reload and persistence in DOM (`vitest.browser.config.ts` was not part of this unit command run).
  - PTY/cwd preservation and native desktop host reload.
  - Code coverage instrumentation (missing `@vitest/coverage-v8`).
- **Unrelated Modified Files Observed:**
  - `docs/configuration-guide.md` and `server/src/api/tests.rs` are modified in the working tree. Their changes are outside the declared feature ownership matrix and were not modified or reverted.
- **Next Steps:**
  1. Route the null-prototype dictionary fix in `packages/ui/src/stores/project-target.ts` to `Phase01StorePersistence`.
  2. Rerun the focused suite, UI build, ESLint, and full UI test suite.
  3. Perform Main's manual reload and side-effect review checklist per `plan.md`.

---

## 9. Unresolved Questions

- None.
