# Implementation Plan: Fix Search Input Focus Loss After Multi-Profile Enhancement

- Target Files:
  - `packages/ui/src/components/organisms/SearchPanel.tsx`
  - `packages/ui/src/components/pages/WorkspacePage.tsx`
  - `packages/ui/browser-tests/search-panel-focus.browser.tsx`
  - `packages/ui/src/components/organisms/SearchPanel.test.tsx`
- Root Cause Report: `plans/reports/debugger-260921-1137-search-panel-focus-root-cause.md`
- Priority: P1 (Core UX interaction blocked)

---

## 1. Context and Problem Statement

When opening Global Search via `Ctrl+Shift+F` (or `openSearch("content")`):
1. Typing the first character into the input causes the input to lose focus (`document.activeElement` becomes `document.body`).
2. Re-focusing the input and typing another character immediately causes it to lose focus again.
3. This was introduced during the unified multi-profile enhancement (commit `ac89bf05`), where:
   - `value={query}` was accidentally deleted from `<input>`, making it uncontrolled.
   - `autoFocus` remained unconditional on all `SearchPanel` instances, including embedded background panels in `<section inert>` within `MobileWorkspaceShell` (for window widths <= 1280px) and `IdeShell` left tools.
   - `WorkspacePage.tsx` called `useSearchUiStore()` without a selector, triggering a full-page re-render on every keystroke (`setQuery`), which prompted React 19 reconciliation on the inactive `autoFocus` inputs, resulting in focus rejection and ejection to `document.body`.

---

## 2. Solution Architecture

### 2.1 Fine-grained Selectors in `WorkspacePage.tsx`
Change:
```tsx
const {
  open: searchOpen,
  close: closeSearch,
  openWith: openSearch,
} = useSearchUiStore();
```
To:
```tsx
const searchOpen = useSearchUiStore((s) => s.open);
const closeSearch = useSearchUiStore((s) => s.close);
const openSearch = useSearchUiStore((s) => s.openWith);
```
**Effect:** Keystrokes in `SearchPanel` update `queries[mode]`, which no longer triggers `WorkspacePage` re-renders.

### 2.2 Controlled Input and Contextual `autoFocus` in `SearchPanel.tsx`
1. Add `autoFocus?: boolean` to `SearchPanelProps`, defaulting to `Boolean(onClose)`:
   - Floating modal dialogs supply `onClose`, so `autoFocus` defaults to `true`.
   - Embedded sidebar/tool panels omit `onClose`, so `autoFocus` defaults to `false`.
2. Restore `value={query}` on `<input>`:
   - Ensures the input element remains controlled and in sync with `queries[mode]`.
3. Pass `autoFocus` to `<input autoFocus={autoFocus}>`.

### 2.3 Explicit `autoFocus={false}` on Embedded Callsites in `WorkspacePage.tsx`
In `leftTools` and `compactIdeSurfaces`, pass `autoFocus={false}` explicitly to `SearchPanel` to ensure embedded panels never compete for focus.

---

## 3. Phase Breakdown

### Phase 1: Implementation
- **Step 1.1:** Update `WorkspacePage.tsx` to use fine-grained selectors for `useSearchUiStore`.
- **Step 1.2:** Update `SearchPanel.tsx` to restore `value={query}` and make `autoFocus` conditional on `Boolean(onClose)`.
- **Step 1.3:** Explicitly pass `autoFocus={false}` in `leftTools` and `compactIdeSurfaces` in `WorkspacePage.tsx`.

### Phase 2: Advisor Consultation Gate
- **Step 2.1:** Execute canonical advisor checkpoint at `review:hard-fix` with test evidence and file digests.
- **Step 2.2:** Record executor disposition (`accept`).
- **Step 2.3:** Record validation outcome.
- **Step 2.4:** Complete advisor task run.

### Phase 3: Verification & Regression Tests
- **Step 3.1:** Verify Chromium browser tests in compact viewport (<= 1280px) and desktop viewport (> 1280px).
- **Step 3.2:** Verify UI unit test suite (`pnpm --filter @dam-hopper/ui test`).
- **Step 3.3:** Run full UI typecheck (`pnpm --filter @dam-hopper/ui build`).

---

## 4. Verification Matrix

| Test Suite | Command | Expected Result |
| :--- | :--- | :--- |
| Focus Browser Test | `pnpm --filter @dam-hopper/ui test:browser run browser-tests/search-panel-focus.browser.tsx` | PASS (1/1) in Chromium |
| SearchPanel Unit Tests | `pnpm --filter @dam-hopper/ui test run src/components/organisms/SearchPanel.test.tsx` | PASS (4/4) |
| WorkspacePage Unit Tests | `pnpm --filter @dam-hopper/ui test run src/components/pages/WorkspacePage.test.tsx` | PASS (27/27) |
| Full UI Package Suite | `pnpm --filter @dam-hopper/ui test` | PASS (all ~260 test files) |
| UI Build | `pnpm --filter @dam-hopper/ui build` | PASS (clean compilation) |
