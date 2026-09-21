# Debugger Report: Search Input Focus Loss on Keystroke After Multi-Profile Enhancement

**Date:** 2026-09-21  
**Target:** `packages/ui/src/components/organisms/SearchPanel.tsx`, `packages/ui/src/components/pages/WorkspacePage.tsx`  
**Tags:** `search`, `focus`, `multi-profile`, `react-19`, `re-render`

---

## 1. Issue Summary

When using Global Search with `Ctrl+Shift+F`:
- Typing the first character into the search input box causes the input box to immediately lose focus (`document.activeElement` becomes `document.body`).
- Re-selecting (clicking) the input box and typing another character causes it to lose focus again.
- The defect emerged following the unified multi-profile enhancement (commits `ac89bf05`, `699b9174`, `2ae51978`).

---

## 2. Reproduction and Evidence

In a real Chromium browser test (`packages/ui/browser-tests/search-panel-focus.browser.tsx`), logging `focusin` and `focusout` events during user typing confirmed the exact defect:

```text
[FOCUSIN] INPUT Search project target contents…
Typing 'a' into searchInput...
[FOCUSOUT] target: INPUT Search project target contents… relatedTarget: undefined
```

When `focusout` occurs, `relatedTarget` is `undefined`, indicating focus is completely ejected from the search input to `document.body`.

Inspection of the DOM revealed **multiple `SearchPanel` instances mounted simultaneously**:
1. `Input #0` (embedded in `compactIdeSurfaces` inside `MobileWorkspaceShell` under `<section inert="true" aria-hidden="true">`):
   ```html
   <section hidden inert>
     <SearchPanel project="demo-project" ... />
   </section>
   ```
2. `Input #1` (inside the floating search dialog):
   ```html
   <div class="dialog-viewport-fit">
     <SearchPanel project="demo-project" inputRef={searchInputRef} onClose={closeSearch} ... />
   </div>
   ```

---

## 3. Root Cause Analysis

The defect is caused by the confluence of three specific factors:

### Root Cause 1: Over-broad Store Subscription in `WorkspacePage.tsx`
In `WorkspacePage.tsx:884-888`:
```tsx
const {
  open: searchOpen,
  close: closeSearch,
  openWith: openSearch,
} = useSearchUiStore();
```
`WorkspacePage` calls `useSearchUiStore()` without a selector. Consequently, `WorkspacePage` subscribes to the *entire* state of `useSearchUiStore`.
When the user types a character in the search input:
1. `onChange` calls `setQuery(mode, event.target.value)`.
2. `useSearchUiStore` updates `queries[mode]`.
3. Because `WorkspacePage` subscribed to the whole store, `WorkspacePage` **re-renders on every single keystroke**.

### Root Cause 2: Competing `autoFocus` on Inactive/Inert Embedded SearchPanels
In `SearchPanel.tsx:215-230`:
```tsx
<input
  ref={resolvedRef}
  autoFocus
  type="text"
  ...
/>
```
`<input autoFocus ... />` has an unconditional, static `autoFocus` prop.
In `WorkspacePage.tsx`, `SearchPanel` is rendered in multiple locations:
1. In `compactIdeSurfaces` (lines 2201-2216), which `MobileWorkspaceShell` renders for all surfaces (`surfaces.map(surface => <section inert={!isActive}>{surface.content}</section>)`).
2. In `leftTools` (lines 1967-1980), rendered when `activeLeftTopTool` is `"search"`.
3. In the floating search dialog (lines 2566-2591).

When `WorkspacePage` re-renders on every keystroke:
- The embedded `SearchPanel` in `compactIdeSurfaces` is re-rendered.
- React 19 reconciles the input element with `autoFocus` in the inactive `<section inert>`.
- In React 19 client-side reconciliation, elements with `autoFocus` attempt to acquire focus.
- The browser disallows focusing an element inside an `inert` container, which rejects the focus target and immediately blurs the current active element, resetting `document.activeElement` to `document.body`.
- This causes the search input in the active floating dialog to lose focus immediately after every keystroke.

### Root Cause 3: Accidental Deletion of `value={query}` in Commit `ac89bf05`
In commit `ac89bf05b1eed07e00a088f14689bb2f153f1372` (`feat(workbench): qualify files, editor, federated search and git targets for unified profiles`), the diff shows:
```diff
@@ -209,13 +219,12 @@ export function SearchPanel({
             placeholder={
               mode === "filename"
                 ? scope === "workspace"
-                  ? "Find files in all projects…"
-                  : "Find files…"
+                  ? "Find files across all connected profiles…"
+                  : "Find files in project target…"
                 : scope === "workspace"
-                  ? "Search all projects…"
-                  : "Search file contents…"
+                  ? "Search across all connected profiles…"
+                  : "Search project target contents…"
             }
-            value={query}
             onChange={(event) => setQuery(mode, event.target.value)}
```
When updating placeholder strings for the new multi-profile search scopes, `value={query}` was inadvertently deleted. This made `<input>` uncontrolled and desynchronized from the Zustand store's `queries[mode]`.

---

## 4. Remediation Strategy

1. **`WorkspacePage.tsx`**: Use fine-grained Zustand selectors for `useSearchUiStore`:
   ```tsx
   const searchOpen = useSearchUiStore((s) => s.open);
   const closeSearch = useSearchUiStore((s) => s.close);
   const openSearch = useSearchUiStore((s) => s.openWith);
   ```
   This completely stops `WorkspacePage` and its child trees from re-rendering on keystrokes.

2. **`SearchPanel.tsx`**:
   - Restore `value={query}` on `<input>` to keep it controlled and synchronized with `queries[mode]`.
   - Make `autoFocus` conditional: only enable `autoFocus` when rendered in a modal context (`onClose` is provided), or make it an explicit prop defaulting to `Boolean(onClose)`. Never auto-focus embedded/inactive panels:
     ```tsx
     interface SearchPanelProps {
       ...
       autoFocus?: boolean;
     }
     export function SearchPanel({
       ...
       autoFocus = Boolean(onClose),
     })
     ```
3. **`compactIdeSurfaces` in `WorkspacePage.tsx`**: Pass `autoFocus={false}` to the embedded `SearchPanel` in `compactIdeSurfaces` and `leftTools`.

4. **Verification**:
   - Verify focus retention in Chromium browser tests across compact viewport (<= 1280px) and desktop viewport (> 1280px).
   - Verify UI test suite (`pnpm --filter @dam-hopper/ui test`).
