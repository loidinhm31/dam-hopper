# Diagnostic Report: Plan Item Detail Notes & Edit Inability

**Date:** 2026-09-07  
**Issue:** Selecting an item in Plan detail view cannot see notes and cannot edit item (only delete action is present)  
**Target Path:** `plans/reports/debugger-260907-0013-plan-item-detail-notes-and-edit.md`  
**Status:** Investigation Complete — No Production Code Modified  

---

## 1. Root Cause Summary

1. **Cannot See Notes:**
   - `WorkflowSelectedItemBar.tsx` receives `selectedNode: ItemOverviewNodeDto` containing `selectedNode.notes: NoteDto[]`, but the component **completely omits rendering `selectedNode.notes`**.
   - The only place in the entire UI that references `notes` is `WorkflowItemRow.tsx` (line 50), which renders solely the single latest note body in a truncated one-line subtitle (`latestNote.body`), eliding previous notes and clipping long text.
   - When an item is selected or a note is added via `WorkflowSelectedItemBar`, the notes array is never displayed, giving the impression that notes cannot be viewed or were lost.

2. **Cannot Edit Item (Only Delete Available):**
   - In `WorkflowSelectedItemBar.tsx`, the item title is hardcoded as static text (`<span>Selected: {selectedNode.item.title}</span>`) and `summary` is completely unrendered.
   - The only action button rendered in the header next to the title is the `<Trash2 />` icon button (`title="Delete item"`), invoking `onDeleteItem(selectedNode.item)`.
   - No Edit button, no inline edit form, no modal, and no edit state exist in `WorkflowSelectedItemBar`.
   - Prop contracts across the hierarchy (`WorkflowSelectedItemBarProps`, `WorkflowItemListProps`, `WorkflowContextDeckProps`, `WorkflowContextSheetProps`) have no `onEditItem` or `onUpdateItem` callback.
   - In `use-workflow-surface-actions.ts`, `usePatchWorkflowItem` is instantiated but solely invoked inside `handleStatusChange(item, status)`; no general item update action exists.
   - **The backend already supports full item patching** (`PATCH /api/workflow/items/:id` with CAS concurrency checks for `title`, `summary`, `status`, `sort_order`, `target`), making this a 100% UI and hook-level integration gap.

---

## 2. Component Breakdown & Evidence

### 2.1 `WorkflowSelectedItemBar.tsx` (`packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx`)
- **Prop Interface (lines 14–21):**
  ```typescript
  export interface WorkflowSelectedItemBarProps {
    selectedNode: ItemOverviewNodeDto;
    onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
    onAddNote?: (itemId: string, noteBody: string) => void;
    onStartSession?: (itemId: string) => void;
    onDeleteItem?: (item: ItemDto) => void;
    onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
  }
  ```
  - **Evidence:** Missing `onEditItem?: (item: ItemDto, updates: ...)` and `onDeleteNote?: (note: NoteDto) => void`.
- **Item Header Rendering (lines 43–59):**
  ```tsx
  <div className="flex items-center justify-between">
    <span className="truncate font-semibold text-[var(--color-text)]">
      Selected: {selectedNode.item.title}
    </span>
    {onDeleteItem && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onDeleteItem(selectedNode.item)}
        className="h-6 w-6 p-0 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
        title="Delete item"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )}
  </div>
  ```
  - **Evidence:** Non-editable title span. Only mutation button provided is `Trash2`. `summary` is not displayed.
- **Action Buttons (lines 61–107):**
  - Renders:
    1. Status dropdown (`<Select>` for `backlog | next | in_progress | blocked | done | canceled`).
    2. Session button (`<Play />` calling `onStartSession`).
    3. Child capture button (`<CornerDownRight />` calling `onOpenQuickCapture`).
    4. Note capture button (`<StickyNote />` setting `isAddingNote = true`).
  - **Evidence:** No Edit button or trigger.
- **Note Input Box (lines 109–150):**
  - Renders `<Textarea>` when `isAddingNote === true`, calling `onAddNote` on submit.
  - **Evidence:** Renders entry form for *new* notes only. `selectedNode.notes` is never mapped or rendered anywhere in the component.

### 2.2 `WorkflowItemRow.tsx` (`packages/ui/src/components/molecules/WorkflowItemRow.tsx`)
- **Note Handling (lines 41, 50, 101–104):**
  ```typescript
  const { item, activeSessions, notes } = node;
  ...
  const latestNote = notes.length > 0 ? notes[notes.length - 1] : null;
  ...
  <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
    <span className="truncate">
      {latestNote ? `Note: ${latestNote.body}` : progressText}
    </span>
  ```
  - **Evidence:** Only extracts the single latest note (`notes[notes.length - 1]`). Subtitle truncated with `truncate`. Earlier notes are invisible. When row is selected, selection detail does not surface them either.

### 2.3 `WorkflowItemList.tsx` (`packages/ui/src/components/molecules/WorkflowItemList.tsx`)
- **Selection & Bottom Docking (lines 40–41, 121–130):**
  ```typescript
  const allNodes = flattenOverviewNodes([...plans, ...standaloneTasks]);
  const selectedNode = allNodes.find((n) => n.item.id === selectedItemId);
  ...
  {selectedNode && (
    <WorkflowSelectedItemBar
      selectedNode={selectedNode}
      onStatusChange={onStatusChange}
      onAddNote={onAddNote}
      onStartSession={onStartSession}
      onDeleteItem={onDeleteItem}
      onOpenQuickCapture={onOpenQuickCapture}
    />
  )}
  ```
  - **Evidence:** `selectedNode` already carries full `notes: NoteDto[]` and `item: ItemDto`. `WorkflowItemListProps` lacks `onEditItem` and `onDeleteNote`.

### 2.4 `WorkflowContextDeck.tsx` & `WorkflowContextSheet.tsx`
- Both organisms render `WorkflowItemList` in their items pane:
  - `WorkflowContextDeck.tsx` lines 155–165
  - `WorkflowContextSheet.tsx` lines 169–179
- Neither organism defines or forwards `onEditItem` or `onDeleteNote`.

### 2.5 `WorkflowContextSurface.tsx` (`packages/ui/src/components/organisms/WorkflowContextSurface.tsx`)
- **State & Action Wiring (lines 44, 126–131, 133–159):**
  - Manages `selectedItemId` via `useState<string | null>(null)`.
  - Defines `handleDeleteItem` which calls `actions.handleDeleteItem(item)`.
  - Does NOT define `handleEditItem` or `handleDeleteNote`.
  - Passes down `onDeleteItem: handleDeleteItem`, `onStatusChange: actions.handleStatusChange`, `onAddNote: actions.handleAddNote`.

### 2.6 `use-workflow-surface-actions.ts` (`packages/ui/src/hooks/use-workflow-surface-actions.ts`)
- **Action Hook Definitions (lines 48–168):**
  ```typescript
  const patchItem = usePatchWorkflowItem();
  const createNote = useCreateWorkflowNote();
  const deleteItem = useDeleteWorkflowItem();
  ...
  const handleStatusChange = (item: ItemDto, status: ItemStatus) =>
    patchItem.mutateAsync({
      id: item.id,
      requestId: generateWorkflowRequestId(),
      updatedAt: item.updatedAt,
      status,
    });
  ```
  - **Evidence:**
    1. `patchItem` mutation is invoked **only** for status changes (`status`). No `handleUpdateItem` exists for editing title/summary.
    2. `createNote` is used for `handleAddNote`.
    3. `useDeleteWorkflowNote` is **not imported**; no `handleDeleteNote` exists.

---

## 3. API & Backend Capability Assessment

| Capability | Backend Endpoint | Request DTO / Logic | Frontend Client & Hook | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Edit Item** | `PATCH /api/workflow/items/{id}` (`router.rs:76`, `item.rs:154-253`) | `PatchItemRequest` (`dto.rs:31-40`): `title`, `summary`, `status`, `sort_order`, `target`. CAS check on `updated_at`. Returns `MutationDto<ItemDto>`. | `api.workflow.patchItem` (`client.ts:1749`), `usePatchWorkflowItem` (`workflow-queries.ts:137`) | **Fully Functional on Server & API Client**; missing action handler & UI. |
| **Delete Item** | `DELETE /api/workflow/items/{id}` (`router.rs:76`, `item.rs:255-332`) | `DeleteRequest`: `request_id`, `updated_at`. Soft delete with CAS. | `api.workflow.deleteItem` (`client.ts:1754`), `useDeleteWorkflowItem` (`workflow-queries.ts:146`) | **Fully Functional end-to-end**. |
| **Retrieve Notes** | `GET /api/workflow/overview` (`router.rs:73`, `mod.rs:16-41`) | Loads all non-deleted notes into `ItemOverviewNodeDto.notes` (`mapping.rs:117`). | `useWorkflowOverview` returns `ItemOverviewNodeDto.notes: NoteDto[]`. | **Fully Functional on Server & Query Layer**; omitted in selected item UI. |
| **Create Note** | `POST /api/workflow/notes` (`router.rs:81`, `note.rs:49-174`) | `CreateNoteRequest`: `itemId`, `sessionId`, `body`. | `api.workflow.createNote`, `useCreateWorkflowNote`, `handleAddNote` | **Fully Functional end-to-end**. |
| **Delete Note** | `DELETE /api/workflow/notes/{id}` (`router.rs:83`, `note.rs:176-253`) | `DeleteRequest`: `request_id`, `updated_at`. Soft delete with CAS. | `api.workflow.deleteNote` (`client.ts:1792`), `useDeleteWorkflowNote` (`workflow-queries.ts:213`) | **Fully Functional on Server & API Client**; missing in surface actions & UI. |

### Backend Patch Details (`server/src/api/workflow/item.rs`):
- Accepts `title: Option<String>` (validated for length 1..=255).
- Accepts `summary: Option<Option<String>>` (supports setting text or clearing to `None`).
- Enforces CAS via `current.updated_at != expected` (returns HTTP 409 Conflict if stale).
- Validates status transitions via `validate_item_transition`.
- Updates target via `resolve_target`.
- Records `WorkflowEventType::ItemUpdated`.

---

## 4. Gap Analysis

```
[ Backend REST API ]
  ├─ PATCH /api/workflow/items/:id   ✅ FULLY IMPLEMENTED (title, summary, status, target)
  ├─ DELETE /api/workflow/items/:id  ✅ FULLY IMPLEMENTED
  ├─ GET /api/workflow/overview      ✅ FULLY IMPLEMENTED (returns notes[] per item)
  ├─ POST /api/workflow/notes        ✅ FULLY IMPLEMENTED
  └─ DELETE /api/workflow/notes/:id  ✅ FULLY IMPLEMENTED
          │
[ Transport & React Query Layer ]
  ├─ api.workflow.patchItem / usePatchWorkflowItem   ✅ IMPLEMENTED & TESTED
  ├─ api.workflow.deleteItem / useDeleteWorkflowItem ✅ IMPLEMENTED & TESTED
  ├─ api.workflow.createNote / useCreateWorkflowNote ✅ IMPLEMENTED & TESTED
  └─ api.workflow.deleteNote / useDeleteWorkflowNote ✅ IMPLEMENTED & TESTED
          │
[ Hook Layer: useWorkflowSurfaceActions ]
  ├─ handleStatusChange   ✅ IMPLEMENTED (calls patchItem)
  ├─ handleDeleteItem     ✅ IMPLEMENTED (calls deleteItem)
  ├─ handleAddNote        ✅ IMPLEMENTED (calls createNote)
  ├─ handleUpdateItem     ❌ MISSING (not implemented or returned)
  └─ handleDeleteNote     ❌ MISSING (not implemented or returned)
          │
[ Container Layer: WorkflowContextSurface / Deck / Sheet ]
  ├─ onStatusChange       ✅ WIRED
  ├─ onDeleteItem         ✅ WIRED
  ├─ onAddNote            ✅ WIRED
  ├─ onEditItem           ❌ MISSING (no prop, no handler)
  └─ onDeleteNote         ❌ MISSING (no prop, no handler)
          │
[ Presentation Layer: WorkflowSelectedItemBar ]
  ├─ Status Dropdown      ✅ RENDERS & WORKS
  ├─ Delete Button        ✅ RENDERS & WORKS (Trash2)
  ├─ Add Note Form        ✅ RENDERS & WORKS (toggleable textarea)
  ├─ View Notes List      ❌ MISSING (selectedNode.notes completely ignored)
  ├─ Delete Note Button   ❌ MISSING
  ├─ Edit Item Trigger    ❌ MISSING (no edit button, title is static span)
  └─ Edit Title/Summary   ❌ MISSING (no inline form or modal)
```

---

## 5. Recommended Fix Plan (Modular, KISS, DRY, YAGNI)

### Step 1: Extend Surface Actions (`packages/ui/src/hooks/use-workflow-surface-actions.ts`)
1. Import `useDeleteWorkflowNote` alongside `usePatchWorkflowItem`.
2. Add `handleUpdateItem`:
   ```typescript
   handleUpdateItem: (
     item: ItemDto,
     updates: { title?: string; summary?: string | null },
   ) => Promise<unknown>;
   ```
   Implementation: calls `patchItem.mutateAsync({ id: item.id, requestId: generateWorkflowRequestId(), updatedAt: item.updatedAt, ...updates })`.
3. Add `handleDeleteNote`:
   ```typescript
   handleDeleteNote: (note: NoteDto) => Promise<unknown>;
   ```
   Implementation: calls `deleteNote.mutateAsync({ id: note.id, requestId: generateWorkflowRequestId(), updatedAt: note.updatedAt })`.

### Step 2: Propagate Handlers Through Container Components
1. Add `onEditItem?: (item: ItemDto, updates: { title?: string; summary?: string | null }) => Promise<unknown> | void` and `onDeleteNote?: (note: NoteDto) => Promise<unknown> | void` to:
   - `WorkflowContextSurfaceProps` / `WorkflowContextSurface.tsx` (wire to `actions.handleUpdateItem` and `actions.handleDeleteNote`).
   - `WorkflowContextDeckProps` / `WorkflowContextDeck.tsx`.
   - `WorkflowContextSheetProps` / `WorkflowContextSheet.tsx`.
   - `WorkflowItemListProps` / `WorkflowItemList.tsx`.
   - `WorkflowSelectedItemBarProps` / `WorkflowSelectedItemBar.tsx`.

### Step 3: Enhance `WorkflowSelectedItemBar.tsx`
1. **Item Edit Capability:**
   - Add state `isEditingItem: boolean`, `editTitle: string`, `editSummary: string`.
   - In the header bar, add an Edit button (`<Pencil className="h-3.5 w-3.5" />`, `title="Edit item"`) beside `<Trash2 />`.
   - When in edit mode:
     - Render an inline editing block with `<Input>` for `title` and `<Textarea>` for `summary`.
     - "Save" button triggers `onEditItem(selectedNode.item, { title: editTitle.trim(), summary: editSummary.trim() || null })`.
     - "Cancel" button exits edit mode without mutating.
     - Keyboard shortcuts: Enter on title / Ctrl+Enter saves; Escape cancels.
2. **Notes Display Capability:**
   - When `selectedNode.notes.length > 0`:
     - Render a scrollable list of notes within the selected item bar (e.g. max-height `100px`, `overflow-y-auto`).
     - Each note row renders: note text (preserving line breaks), formatted relative timestamp or date, and a delete button (`<Trash2 />`) invoking `onDeleteNote(note)`.
     - When a note is added via `onAddNote`, React Query invalidation refreshes overview, immediately showing the new note in the list.

### Step 4: Unit & Integration Testing
1. Update `WorkflowSelectedItemBar.test.tsx`:
   - Verify rendering of existing notes from `selectedNode.notes`.
   - Verify clicking delete on a note calls `onDeleteNote`.
   - Verify clicking edit enters edit mode, changes title/summary, and invokes `onEditItem`.
   - Verify cancellation reverts values.
2. Update `WorkflowContextSurface.test.tsx`:
   - Verify end-to-end trigger of `patchItem` when item edit is submitted.
   - Verify end-to-end trigger of `deleteNote` when note delete is clicked.

---

## 6. Unresolved Questions

1. **Inline Edit vs Modal:**  
   Given that `WorkflowContextDeck` has constrained vertical space (`320px–440px`), inline expansion inside `WorkflowSelectedItemBar` keeps the UI compact and avoids modal-dialog stacking conflicts with the deck. Should item editing remain inline within `WorkflowSelectedItemBar`, or is a dedicated modal preferred?
2. **Note Editing:**  
   The current backend provides `POST /api/workflow/notes` (create) and `DELETE /api/workflow/notes/{id}` (soft-delete), but **no `PATCH /api/workflow/notes/{id}`** endpoint exists. Are notes intended to be append-only / deletable (typical log/audit pattern), or will an edit endpoint for notes be required later?
3. **Summary Visibility in Read Mode:**  
   When not editing, should the item's existing `summary` be rendered as a collapsible block or subtitle in `WorkflowSelectedItemBar` above the action row?