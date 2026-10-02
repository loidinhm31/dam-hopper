# Investigation Report: Git Panel Stuck on "Restoring history preferences..."

- **Date:** 2026-10-03 02:15
- **Investigator:** GitHistoryHydrationDebugger
- **Component:** `@dam-hopper/ui` (Git History Store & View)
- **Status:** Root Cause Identified & Fix Verified

---

## 1. Executive Summary

### Issue Description
In both IDE and TERMINAL modes, navigating to the Git panel in `WorkspaceGitPanel` displays "Restoring history preferences..." permanently. The panel never loads git log entries and triggers zero Git API queries to the backend.

### Business & Functional Impact
Users in both IDE and TERMINAL modes are completely blocked from viewing commit histories, reviewing diffs, inspecting branches, and executing Git history mutations (revert, drop, undo, commit message edits).

### Root Cause
In `packages/ui/src/stores/git-history.ts`, `onRehydrateStorage` invokes `useGitHistoryStore.getState().markHydrated()`. Because `createSafeGitHistoryStorage().getItem` executes synchronously against `localStorage`, Zustand's `persist` middleware completes hydration synchronously *during* the evaluation of the `export const useGitHistoryStore = create(...)` declaration.

At that moment, `useGitHistoryStore` is in the JavaScript **Temporal Dead Zone (TDZ)**. Invoking `useGitHistoryStore.getState()` throws `ReferenceError: Cannot access 'useGitHistoryStore' before initialization`. Zustand's `toThenable` catches the error and aborts setting `isHydrated: true`. As a result, `isHydrated` remains `false` forever.

### Recommended Fix (Priority: High)
Update `onRehydrateStorage` in `packages/ui/src/stores/git-history.ts` to consume the `state` argument passed into the callback (`(state) => { state?.markHydrated(); }`) rather than closing over the outer variable `useGitHistoryStore`.

---

## 2. Technical Analysis & Tracing

### Chain of Events

```
[Module Import] packages/ui/src/stores/git-history.ts
       │
       ▼
const useGitHistoryStore = create(...persist(...)) (TDZ active for useGitHistoryStore)
       │
       ▼
Zustand persist middleware initializes (if (!options.skipHydration) hydrate())
       │
       ▼
storage.getItem() called via createSafeGitHistoryStorage()
       │
       ▼ (SYNCHRONOUS execution: localStorage.getItem returns string or null)
toThenable wraps sync result -> .then() executes immediately and synchronously
       │
       ▼
postRehydrationCallback invoked synchronously:
() => { useGitHistoryStore.getState().markHydrated(); }
       │
       ▼
TDZ ReferenceError: Cannot access 'useGitHistoryStore' before initialization
       │
       ▼
Zustand toThenable.catch intercepts ReferenceError -> postRehydrationCallback(void 0, e)
       │
       ▼
Second TDZ ReferenceError thrown & absorbed by unhandled thenable catch
       │
       ▼
Store creation finishes; initial state assigned to useGitHistoryStore
(markHydrated() was NEVER called; isHydrated remains FALSE)
       │
       ▼
[Component Mount] WorkspacePage.tsx renders WorkspaceGitPanel (IDE & TERMINAL modes)
       │
       ▼
useGitHistoryView calls useGitHistoryHydrated() -> isHydrated === false
       │
       ▼
availability = { isAvailable: false, reason: "Restoring history preferences..." }
       │
       ▼
logQueryOptions.enabled = availability.isAvailable && ... === false (NO API calls)
       │
       ▼
WorkspaceGitPanel renders fallback text: "Restoring history preferences..." (STUCK)
```

### Detailed Code Walkthrough

#### 1. `packages/ui/src/stores/git-history.ts`
- **Lines 389–433 (`createSafeGitHistoryStorage`)**:
  `getItem` is fully synchronous:
  ```ts
  getItem: (name: string): StorageValue<PersistedGitHistory> | null => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const raw = window.localStorage.getItem(name);
      if (raw === null) return null;
      ...
    } catch {
      return null;
    }
  }
  ```
- **Lines 435–445 (`useGitHistoryStore`)**:
  Store is defined with `const useGitHistoryStore = create<GitHistoryStore>()(...)`. The initial state specifies `isHydrated: false`:
  ```ts
  (set, get) => ({
    ...INITIAL_GIT_HISTORY_STATE,
    isHydrated: false,
    markHydrated: () => {
      if (!get().isHydrated) {
        set({ isHydrated: true });
      }
    },
    ...
  })
  ```
- **Lines 673–676 (`onRehydrateStorage`)**:
  ```ts
  onRehydrateStorage: () => () => {
    useGitHistoryStore.getState().markHydrated();
  },
  ```
- **Zustand `persist` implementation (`node_modules/zustand/esm/middleware.mjs:303–326, 378–436, 468`)**:
  - `toThenable` transforms non-promise return values into synchronous thenable objects (`{ then(onFulfilled) { return toThenable(onFulfilled)(result); } }`).
  - `hydrate()` runs inside `persistImpl` before `create()` finishes.
  - Chained `.then()` triggers `postRehydrationCallback(get(), void 0)` synchronously.
  - In `useGitHistoryStore.getState().markHydrated()`, JavaScript evaluates `useGitHistoryStore`. Since the `const useGitHistoryStore` assignment has not resolved, JavaScript throws:
    `ReferenceError: Cannot access 'useGitHistoryStore' before initialization`.
  - The error prevents `markHydrated()` from executing and skips `hasHydrated = true`.
  - `isHydrated` remains `false`.

#### 2. `packages/ui/src/hooks/use-git-history-view.ts`
- **Line 91**: `const isHydrated = useGitHistoryHydrated();` (reads `s.isHydrated`, which is `false`).
- **Lines 302–313**:
  ```ts
  const availability = useMemo<GitHistoryAvailability>(() => {
    if (!targetRef.project) {
      return { isAvailable: false, reason: "No project selected" };
    }
    if (!available) {
      return { isAvailable: false, reason: "Target unavailable" };
    }
    if (!isHydrated) {
      return { isAvailable: false, reason: "Restoring history preferences..." };
    }
    return { isAvailable: true };
  }, [targetRef.project, available, isHydrated]);
  ```
  `availability.isAvailable` is `false`, and `reason` is `"Restoring history preferences..."`.
- **Lines 325–350**:
  ```ts
  const logQueryOptions = useMemo(() => {
    const base = gitLogQueryOptions(...);
    return {
      ...base,
      enabled:
        availability.isAvailable &&
        !isScopeResolving &&
        Boolean(targetRef.project),
    };
  }, [...]);
  ```
  Because `availability.isAvailable` is `false`, `logQueryOptions.enabled` evaluates to `false`. TanStack Query's `useQuery(logQueryOptions)` is disabled and never issues network requests.

#### 3. `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`
- **Lines 168–176**:
  ```tsx
  if (!historyView.availability.isAvailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">
          {historyView.availability.reason || "Git history unavailable"}
        </span>
      </div>
    );
  }
  ```
  Renders the fallback text permanently.

#### 4. `packages/ui/src/components/pages/WorkspacePage.tsx`
- **Line 1971**: Renders `WorkspaceGitPanel` in TERMINAL mode sidebar.
- **Lines 2113, 2184**: Renders `WorkspaceGitPanel` in IDE mode panels.
- Both modes share this single component and hook, experiencing identical failure symptoms.

---

## 3. Why Existing Tests Failed to Catch This

In both `packages/ui/src/stores/git-history.test.ts` (line 24) and `packages/ui/src/hooks/use-git-history-view.test.tsx` (line 113):
```ts
beforeEach(() => {
  resetGitHistoryStore();
  ...
});
```
`resetGitHistoryStore()` in `packages/ui/src/stores/git-history.ts` (lines 683–691) explicitly runs:
```ts
export function resetGitHistoryStore(
  initial?: Partial<PersistedGitHistory>,
): void {
  useGitHistoryStore.setState({
    ...INITIAL_GIT_HISTORY_STATE,
    ...initial,
    isHydrated: true,
  });
}
```
This manually forced `isHydrated: true` before every test case, completely bypassing the initial rehydration flow and masking the TDZ bug during real application startup.

---

## 4. Empirical Verification

Direct node execution in `packages/ui` confirmed the behavior:
- **Test with current code (`useStore.getState()` inside callback)**:
  - Throws `ReferenceError: Cannot access 'useStore' before initialization`.
  - Store initializes with `isHydrated: false`.
- **Test with parameter-based callback (`(state) => { state?.markHydrated(); }`)**:
  - No error thrown.
  - Store initializes with `isHydrated: true`.

---

## 5. Actionable Recommendations

### Immediate Fix
Edit `packages/ui/src/stores/git-history.ts` around line 673:
```ts
// Before:
onRehydrateStorage: () => () => {
  useGitHistoryStore.getState().markHydrated();
},

// After:
onRehydrateStorage: (initialState) => (state, error) => {
  if (!error && state) {
    state.markHydrated();
  } else {
    (state ?? initialState)?.markHydrated();
  }
},
```
*(Or simply `onRehydrateStorage: () => (state) => { state?.markHydrated(); },` matching `packages/ui/src/stores/workspace.ts:57`)*.

### Test Hardening
Add a regression test in `git-history.test.ts` verifying that a store configured with `createSafeGitHistoryStorage()` has `isHydrated === true` immediately after construction without requiring an explicit call to `resetGitHistoryStore()`.

---

## 6. Unresolved Questions
None. The root cause, failure mechanism, and remedy are verified and unambiguous.
