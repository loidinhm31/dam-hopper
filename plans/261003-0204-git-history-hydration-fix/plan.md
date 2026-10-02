---
title: "Fix Git history store hydration TDZ ReferenceError"
description: "Resolve permanent 'Restoring history preferences...' and missing Git API calls in IDE and TERMINAL modes caused by synchronous onRehydrateStorage TDZ in useGitHistoryStore."
status: in-progress
priority: P1
effort: 1h
branch: main
tags: [fix, ui, frontend, git, zustand]
created: 2026-10-03
---

# Fix Git History Store Hydration TDZ ReferenceError

## Overview

Opening the Git panel in both IDE and TERMINAL modes displays "Restoring history preferences..." indefinitely and never executes Git log/status API calls.

## Root Cause Analysis

1. In `packages/ui/src/stores/git-history.ts` (lines 673-675):
   ```ts
   onRehydrateStorage: () => () => {
     useGitHistoryStore.getState().markHydrated();
   },
   ```
   When `useGitHistoryStore = create(persist(...))` is evaluated, Zustand's `persist` middleware invokes `rehydrate()` synchronously because `createSafeGitHistoryStorage().getItem` is synchronous.
2. In JavaScript, `const useGitHistoryStore` is in the Temporal Dead Zone (TDZ) during the evaluation of `create(...)`. Calling `useGitHistoryStore.getState()` inside the synchronous `onRehydrateStorage` callback throws `ReferenceError: Cannot access 'useGitHistoryStore' before initialization`.
3. Zustand's internal error boundary catches the error and executes the callback again with `(void 0, error)`, which also fails to invoke `markHydrated()`.
4. As a result, `isHydrated` remains `false` forever.
5. In `packages/ui/src/hooks/use-git-history-view.ts` (lines 309-311 and 336-340):
   ```ts
   if (!isHydrated) {
     return { isAvailable: false, reason: "Restoring history preferences..." };
   }
   ```
   `availability.isAvailable` evaluates to `false`.
6. In `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx` (lines 168-176):
   When `!historyView.availability.isAvailable`, the panel immediately renders a fallback with `historyView.availability.reason` ("Restoring history preferences...").
7. In `packages/ui/src/hooks/use-git-history-view.ts`:
   The Git log query option `enabled` requires `availability.isAvailable`, which is `false`. Thus, no Git log API calls are ever dispatched.
8. Existing tests missed this bug because `packages/ui/src/stores/git-history.test.ts` called `resetGitHistoryStore()` in `beforeEach()`, which manually forces `{ isHydrated: true }`.

## Fix Plan

1. **Update `packages/ui/src/stores/git-history.ts`**:
   Change `onRehydrateStorage` to accept `(state)` directly and invoke `state?.markHydrated()`:
   ```ts
   onRehydrateStorage: () => (state) => {
     state?.markHydrated();
   },
   ```
   This eliminates the closure over `useGitHistoryStore` during initialization and works synchronously with zero TDZ risk.

2. **Add unit test regression in `packages/ui/src/stores/git-history.test.ts`**:
   Verify that:
   - Initial hydration sets `isHydrated: true` without manual `resetGitHistoryStore()`.
   - Hydration settles to `true` even when storage is empty, corrupted, or throwing.

3. **Verify Git History View integration in `packages/ui/src/hooks/use-git-history-view.test.tsx`**:
   Ensure availability becomes `isAvailable: true` when target is valid and hydration completes.

4. **Run TypeScript check and full test suites**:
   - `pnpm test` in `packages/ui`
   - `pnpm build` in `packages/ui`
