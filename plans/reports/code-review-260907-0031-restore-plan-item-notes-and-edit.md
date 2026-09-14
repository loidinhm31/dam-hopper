# Code Review: Restore Plan Item Notes and Editing

**Date:** 2026-09-07  
**Plan:** `plans/260907-0013-plan-item-notes-and-edit/plan.md`  
**Reviewer:** FixReviewer (Senior Software Engineer)  
**Score:** 8.5 / 10  

---

## Code Review Summary

### Scope
- **Files reviewed (11 files):**
  - `packages/ui/src/hooks/use-workflow-surface-actions.ts`
  - `packages/ui/src/hooks/use-workflow-surface-actions.test.tsx`
  - `packages/ui/src/components/organisms/WorkflowContextSurface.tsx`
  - `packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx`
  - `packages/ui/src/components/organisms/WorkflowContextDeck.tsx`
  - `packages/ui/src/components/organisms/WorkflowContextSheet.tsx`
  - `packages/ui/src/components/molecules/WorkflowItemList.tsx`
  - `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx`
  - `packages/ui/src/components/molecules/WorkflowSelectedItemBar.test.tsx`
  - `packages/ui/src/components/molecules/WorkflowSelectedItemEditForm.tsx` (new)
  - `packages/ui/src/components/molecules/WorkflowSelectedItemNotesList.tsx` (new)
- **Lines of code analyzed:** ~620 lines added/modified
- **Review focus:** Concurrency / CAS optimistic locking, prop contracts, modularization, security, a11y, error handling
- **Updated plans:** `plans/260907-0013-plan-item-notes-and-edit/plan.md`

### Overall Assessment
Implementation correctly restores item editing and note deletion across the entire workflow hierarchy. CAS optimistic locking invariants are strictly upheld (`item.updatedAt` on patch, `note.updatedAt` on delete note, unique `requestId` on each call). Decomposition into helper components (`WorkflowSelectedItemEditForm`, `WorkflowSelectedItemNotesList`) is clean and adheres to component size limits. Minor edge cases exist around form draft leakage on item switch, lack of mutual exclusion between edit and add-note panels, unawaited mutation promises in the bar component, and an omitted `<time>` timestamp in note rendering.

---

## Critical Issues
*None.* (No security vulnerabilities, injection vectors, data corruption, or breaking changes.)

---

## High Priority Findings

### 1. Stale draft state leakage when switching selected items
- **Location:** `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx:79-89` & `WorkflowSelectedItemEditForm.tsx:23-24`
- **Impact:** If item A is selected and put into edit mode, and the user clicks item B in the item list, `WorkflowSelectedItemBar` receives the new `selectedNode` but retains `isEditingItem = true`. Because `WorkflowSelectedItemEditForm` is not keyed (`key={selectedNode.item.id}`), its internal `useState(initialTitle)` retains item A's title and summary. Submitting saves item A's content into item B.
- **Remedy:** Key the edit form or reset edit state on selection change:
  ```tsx
  {isEditingItem && (
    <WorkflowSelectedItemEditForm
      key={selectedNode.item.id}
      initialTitle={selectedNode.item.title}
      initialSummary={selectedNode.item.summary}
      onSave={handleSaveItem}
      onCancel={() => setIsEditingItem(false)}
    />
  )}
  ```

---

## Medium Priority Improvements

### 2. Omitted `<time>` timestamp in `WorkflowSelectedItemNotesList.tsx`
- **Location:** `packages/ui/src/components/molecules/WorkflowSelectedItemNotesList.tsx:25-46`
- **Impact:** Plan specification (Phase 2.3 item 4 and Definition of Done) explicitly requires `semantic <time dateTime={note.createdAt}> with concise locale date/time text`. Only `note.body` is currently rendered.
- **Remedy:** Add semantic `<time>` tag beside or below the note body:
  ```tsx
  <div className="flex flex-col flex-1 gap-0.5">
    <span className="whitespace-pre-wrap break-words text-[var(--color-text)]">{note.body}</span>
    <time dateTime={note.createdAt} className="text-[10px] text-[var(--color-text-muted)]">
      {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
    </time>
  </div>
  ```

### 3. Lack of mutual exclusivity between Note creation and Item editing
- **Location:** `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx:57, 132`
- **Impact:** Entering edit mode does not close an open add-note panel, and vice versa. Both panels can be open simultaneously, consuming limited vertical viewport in compact Deck/Sheet layouts.
- **Remedy:** When opening edit mode:
  ```tsx
  onClick={() => {
    setIsAddingNote(false);
    setIsEditingItem(true);
  }}
  ```
  And when opening note mode:
  ```tsx
  onClick={() => {
    setIsEditingItem(false);
    setIsAddingNote(true);
  }}
  ```

### 4. Unawaited async mutation on save closes edit form prematurely
- **Location:** `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx:83-86`
- **Impact:** `WorkflowSelectedItemBarProps` types `onEditItem` as `() => void` instead of `() => Promise<unknown> | void`. `setIsEditingItem(false)` is invoked synchronously before the network mutation resolves. If a CAS 409 conflict or network failure occurs, the form has already closed, discarding user edits.
- **Remedy:** Align prop type with parent (`Promise<unknown> | void`) and await callback before closing:
  ```tsx
  onSave={async (updates) => {
    try {
      await onEditItem?.(selectedNode.item, updates);
      setIsEditingItem(false);
    } catch {
      // Retain edit form and drafts on rejection
    }
  }}
  ```

---

## Low Priority Suggestions

### 5. Missing `aria-label` on icon-only action buttons
- **Location:** `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx:53-75` & `WorkflowSelectedItemNotesList.tsx:34-44`
- **Impact:** Screen readers rely on `aria-label` for icon-only buttons (`Pencil`, `Trash2`, delete note `Trash2`). Currently only `title` is set.
- **Remedy:** Add `aria-label="Edit item"`, `aria-label="Delete item"`, and `aria-label="Delete note"`.

---

## Positive Observations
- **Strict CAS Optimistic Locking:** `useWorkflowSurfaceActions` uses exact `item.updatedAt` and `note.updatedAt` timestamps and fresh request IDs on every mutation.
- **Clean Input Sanitization:** Whitespace trimming on title and summary; empty summary string is cleanly converted to `null` to distinguish clearing from omission.
- **Keyboard Usability:** Natural keyboard navigation with Enter / Ctrl+Enter / Escape correctly mapped and prevented only when handled.
- **Modular Design:** Clear separation into `WorkflowSelectedItemEditForm` and `WorkflowSelectedItemNotesList` keeps line counts well under modularization limits.
- **Test Quality:** 27/27 vitest tests pass with behavioral assertions covering CAS payload verification across desktop Deck and mobile Sheet contexts.

---

## Validation Commands & Results
- **Target Vitest Suite:**  
  `pnpm --filter @dam-hopper/ui test src/hooks/use-workflow-surface-actions.test.tsx src/components/molecules/WorkflowSelectedItemBar.test.tsx src/components/organisms/WorkflowContextSurface.test.tsx`  
  *Result:* **3 passed, 20 passed (100%), duration 1.56s.**
- **Workflow Context Vitest Suite:**  
  `pnpm --filter @dam-hopper/ui test src/components/organisms/WorkflowContextDeck.test.tsx src/components/organisms/WorkflowContextSheet.test.tsx`  
  *Result:* **2 passed, 7 passed (100%), duration 0.96s.**
- **TypeScript Verification (`tsc --noEmit`):**  
  Zero TypeScript errors across all 11 changed / newly created files. (Pre-existing error in unrelated `src/hooks/use-clipboard.ts` remains isolated).

---

## Unresolved Questions
*None.*
