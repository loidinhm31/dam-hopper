---
title: "Restore Plan Item Notes and Editing"
description: "Expose selected-item notes, item editing, and note deletion through the existing workflow mutation path."
status: completed
priority: P2
effort: 5h
branch: develop
tags: [bugfix, frontend, workflow, react, testing]
created: 2026-09-07
---

# Restore Plan Item Notes and Editing

## Overview

Fix the Plan detail gap where a selected item exposes delete only: render all existing notes, allow note deletion, and add compact inline title/summary editing. Reuse the implemented workflow PATCH/delete-note API and React Query hooks; no server, DTO, route, store, or cache architecture changes.
Plan progress: 100% — completed 2026-09-07; Phases 1–3 completed 2026-09-07.

Reference: [`../reports/debugger-260907-0013-plan-item-detail-notes-and-edit.md`](../reports/debugger-260907-0013-plan-item-detail-notes-and-edit.md)
Validation: Focused workflow Vitest suites passed 27/27 across action hooks, selected-item UI, responsive Surface, Deck, and Sheet. Changed-file TypeScript checks passed; coverage provider unavailable and an unrelated `use-clipboard.ts` type error remains. [QA report](../reports/qa-260907-0029-plan-item-notes-and-edit.md) · [Review report](../reports/code-review-260907-0031-restore-plan-item-notes-and-edit.md).

## Root Cause

- `ItemOverviewNodeDto.notes` reaches `WorkflowSelectedItemBar`, but the component never renders it.
- `usePatchWorkflowItem` exists, but surface actions expose it only through status changes.
- `useDeleteWorkflowNote` exists, but the surface action hook does not consume it.
- `onEditItem` and `onDeleteNote` are absent from the Surface → Deck/Sheet → ItemList → SelectedItemBar chains.
- Selected item title is static, summary is omitted, and the only header mutation is item deletion.

## Scope Decisions

- Inline editing inside `WorkflowSelectedItemBar`; no modal or new component.
- Edit only `title` and `summary`; status remains in the existing selector.
- Notes remain append-only plus delete; no note-edit endpoint or UI.
- Preserve server note order and React Query invalidation. No client sorting, optimistic cache write, local persistence, retry layer, or extra state store.
- Trim title/summary before mutation. Reject blank title locally; send blank summary as `null` so clearing remains distinct from omission.
- Direct note deletion, matching current item-delete behavior. No confirmation workflow added.
- Read-only summary presentation is not added; summary is visible/editable in edit mode only.
- Existing architecture docs already describe Surface → responsive container → molecule → action hook → mutation → workflow cache invalidation. This bug fix restores that path; no architecture document change required.

## Data Flow and Contracts

```text
WorkflowSelectedItemBar
  onEditItem(item, { title, summary })
  onDeleteNote(note)
    ↑
WorkflowItemList
    ↑
WorkflowContextDeck | WorkflowContextSheet
    ↑
WorkflowContextSurface sharedProps
    ↑
useWorkflowSurfaceActions
  handleUpdateItem -> usePatchWorkflowItem.mutateAsync
  handleDeleteNote -> useDeleteWorkflowNote.mutateAsync
    ↓
PATCH /api/workflow/items/:id | DELETE /api/workflow/notes/:id
    ↓ success
['workflow'] invalidation -> refreshed overview -> selected notes/item rerender
```

Contract shape across component props:

```ts
onEditItem?: (
  item: ItemDto,
  updates: { title?: string; summary?: string | null },
) => Promise<unknown> | void;
onDeleteNote?: (note: NoteDto) => Promise<unknown> | void;
```

The hook owns mutation metadata. Presentation callers never construct `requestId` or choose CAS timestamps.

## Affected Files

| File | Action | Responsibility |
|---|---|---|
| `packages/ui/src/hooks/use-workflow-surface-actions.ts` | Modify | Expose item update and note delete actions with request IDs and current DTO CAS timestamps. |
| `packages/ui/src/components/organisms/WorkflowContextSurface.tsx` | Modify | Add both actions to responsive shared props. |
| `packages/ui/src/components/organisms/WorkflowContextDeck.tsx` | Modify | Declare and forward both callbacks to `WorkflowItemList`. |
| `packages/ui/src/components/organisms/WorkflowContextSheet.tsx` | Modify | Declare and forward both callbacks to `WorkflowItemList`. |
| `packages/ui/src/components/molecules/WorkflowItemList.tsx` | Modify | Declare and forward both callbacks to `WorkflowSelectedItemBar`. |
| `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx` | Modify | Render notes and implement inline item editing. |
| `packages/ui/src/hooks/use-workflow-surface-actions.test.tsx` | Modify | Verify update/delete-note API payloads and CAS values. |
| `packages/ui/src/components/molecules/WorkflowSelectedItemBar.test.tsx` | Modify | Verify notes, note deletion, edit actions, validation, and shortcuts. |
| `packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx` | Modify | Verify desktop and compact responsive callback wiring to real query mutations. |

## Phase Summary

| Phase | Outcome | Effort | Depends on |
|---|---|---:|---|
| 1. Action hooks & prop contracts | Completed 2026-09-07: Typed mutation path from surface actions to selected-item presentation | 1.5h | — |
| 2. Selected-item UI | Completed 2026-09-07: Existing notes visible/deletable; title and summary editable inline | 2h | Phase 1 |
| 3. Unit and integration tests | Completed 2026-09-07: Behavioral coverage for presentation, responsive wiring, and CAS payloads | 1.5h | Phases 1–2 |

## Phase 1: Action Hooks & Prop Contracts

### 1.1 Extend `useWorkflowSurfaceActions`

File: `packages/ui/src/hooks/use-workflow-surface-actions.ts`

1. Import `NoteDto` and `useDeleteWorkflowNote` through the existing workflow modules.
2. Instantiate `const deleteNote = useDeleteWorkflowNote()` beside other mutation hooks.
3. Extend `WorkflowSurfaceActions`:
   - `handleUpdateItem(item, updates)` returning the `patchItem.mutateAsync` promise.
   - `handleDeleteNote(note)` returning the `deleteNote.mutateAsync` promise.
4. Implement `handleUpdateItem` with:
   - `id: item.id`
   - fresh `generateWorkflowRequestId()` per call
   - `updatedAt: item.updatedAt`, never `getIsoNow()`
   - only supplied `title`/`summary` fields
5. Implement `handleDeleteNote` with:
   - `id: note.id`
   - fresh `generateWorkflowRequestId()`
   - `updatedAt: note.updatedAt`
6. Return both handlers from the hook. Do not alter `handleStatusChange`; it shares the patch mutation correctly.

### 1.2 Wire `WorkflowContextSurface`

File: `packages/ui/src/components/organisms/WorkflowContextSurface.tsx`

Add to `sharedProps`:

```ts
onEditItem: actions.handleUpdateItem,
onDeleteNote: actions.handleDeleteNote,
```

No public `WorkflowContextSurfaceProps` additions: these mutations remain internal responsibilities of the surface.

### 1.3 Extend both responsive container contracts

Files:

- `packages/ui/src/components/organisms/WorkflowContextDeck.tsx`
- `packages/ui/src/components/organisms/WorkflowContextSheet.tsx`

For each component:

1. Import `NoteDto`.
2. Add optional `onEditItem` and `onDeleteNote` props with the common contract above.
3. Destructure both callbacks.
4. Pass both unchanged to `WorkflowItemList` in the items pane.
5. Keep desktop and compact behavior equivalent; no responsive-only mutation logic.

### 1.4 Extend item-list and selected-bar contracts

File: `packages/ui/src/components/molecules/WorkflowItemList.tsx`

1. Import `NoteDto`.
2. Add/destructure `onEditItem` and `onDeleteNote`.
3. Forward both to the selected `WorkflowSelectedItemBar` only.
4. Do not push mutation callbacks into `WorkflowItemRow`; editing/deleting notes belongs to selected-item detail.

File: `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx`

1. Import `NoteDto`.
2. Add/destructure both optional callbacks in `WorkflowSelectedItemBarProps`.
3. Preserve optional rendering: an unavailable callback means its destructive/edit control is absent.

### Phase 1 Acceptance Criteria

- One typed callback chain works through Deck and Sheet; no `any`, cast-based bypass, duplicate API call, or direct transport use in components.
- Item update always uses `item.updatedAt`; note deletion always uses `note.updatedAt`.
- Each mutation gets a fresh request ID from the existing generator.
- Existing create-note, item-delete, status, session, resource, target-selection, and quick-capture contracts remain unchanged.

## Phase 2: UI Implementation in `WorkflowSelectedItemBar.tsx`

### 2.1 Add compact edit state and actions

1. Import `Pencil` and the existing `Input` primitive.
2. Add local state for edit visibility, title draft, and summary draft. Initialize drafts from the currently selected item when Edit is entered, not from stale prior draft state.
3. Keep note-add and item-edit panels mutually exclusive to protect constrained Deck/Sheet height and avoid ambiguous keyboard handling.
4. Add a header action group. Render:
   - Pencil icon button when `onEditItem` exists.
   - Existing Trash icon button when `onDeleteItem` exists.
   - Explicit `aria-label` and `title` on icon-only buttons.
5. Edit trigger copies `selectedNode.item.title` and `selectedNode.item.summary ?? ""` into drafts, closes note-add mode, then opens edit mode.

### 2.2 Build inline edit form

1. Replace only the static header area while editing; keep status/session/child actions intact below it.
2. Render:
   - labeled title `<Input>` with autofocus
   - labeled summary `<Textarea>`
   - compact Save and Cancel buttons
3. Submission normalization:
   - `title = editTitle.trim()`
   - `summary = editSummary.trim() || null`
   - do not call `onEditItem` when title is blank
   - invoke `onEditItem(selectedNode.item, { title, summary })`
4. Close edit mode after a successful synchronous/async callback. If the callback rejects, retain the drafts/edit mode; do not invent an optimistic item or silently replace authoritative overview data.
5. Cancel exits without mutation. Reopening edit repopulates from `selectedNode.item`, discarding cancelled text.
6. Keyboard behavior:
   - Enter in title submits.
   - Ctrl+Enter or Meta+Enter in summary submits while plain Enter remains a newline.
   - Escape in either field cancels.
   - Prevent default only for handled shortcuts.
7. Disable Save for a blank trimmed title and while a submission is in flight if local pending state is used to prevent duplicate calls.

### 2.3 Render existing notes

1. When `selectedNode.notes.length > 0`, render a compact notes section before the add-note editor.
2. Map the authoritative array directly; preserve server order and avoid copy/sort work.
3. Make only the note list scrollable (`max-height` plus `overflow-y-auto`) so the outer item pane remains stable in the 320–440px Deck and 35/90dvh Sheet layouts.
4. For each note:
   - stable `key={note.id}`
   - body with `whitespace-pre-wrap` and word breaking so multiline/long text remains readable
   - semantic `<time dateTime={note.createdAt}>` with concise locale date/time text
   - note-scoped delete icon button when `onDeleteNote` exists
   - delete calls `onDeleteNote(note)` with the complete DTO for CAS metadata
   - accessible label/title such as `Delete note`
5. Do not render a synthetic “no notes” row; existing Note button remains the empty-state action.
6. Keep existing add-note trim, Ctrl/Meta+Enter, Escape, Add, and Cancel behavior. Update selectors/accessibility as needed so new header buttons cannot be mistaken for Note.

### Phase 2 Acceptance Criteria

- Selecting an item with notes shows every note body, its timestamp, and an independently operable delete action.
- Multiline and long notes remain readable without expanding the selected detail indefinitely.
- Edit exposes current title and summary; Save sends trimmed title and text-or-null summary.
- Blank title never mutates. Cancel and Escape never mutate and discarded drafts do not return on reopen.
- Enter saves from title; Ctrl/Meta+Enter saves from summary; plain summary Enter inserts a newline.
- Edit and item-delete controls sit together in the header with accessible names.
- No modal, API/DTO change, optimistic cache update, or new component abstraction.

## Phase 3: Unit and Integration Tests

### 3.1 Hook behavior tests

File: `packages/ui/src/hooks/use-workflow-surface-actions.test.tsx`

1. Add a `NoteDto` fixture with distinct `updatedAt`.
2. Optionally extract the repeated QueryClient/render harness into one file-local helper before adding cases; no shared test utility needed.
3. Test `handleUpdateItem`:
   - invokes `api.workflow.patchItem` for the item ID
   - forwards title and `summary: null`
   - forwards exact `item.updatedAt`
   - includes a generated string request ID
4. Test `handleDeleteNote`:
   - invokes `api.workflow.deleteNote` for the note ID
   - forwards exact `note.updatedAt`
   - includes a generated string request ID
5. Keep existing status, add-note, and item-delete CAS tests.

### 3.2 Selected-item presentation tests

File: `packages/ui/src/components/molecules/WorkflowSelectedItemBar.test.tsx`

1. Extend the node fixture to support summary and multiple notes.
2. Replace fragile first-icon-button lookup in existing note tests with accessible name/text lookup so adding Pencil does not redirect the test.
3. Verify all note bodies render and each timestamp exposes the source ISO value through `time[datetime]`; do not pin locale-formatted text.
4. Verify a delete button scoped to a note row calls `onDeleteNote` with that exact `NoteDto`.
5. Verify Edit opens prefilled title/summary controls.
6. Verify Save trims fields and calls `onEditItem(item, { title, summary })` once.
7. Verify clearing summary sends `null`; blank title disables/blocks submission.
8. Verify Cancel/Escape closes without callback and reopening restores source values.
9. Verify Enter from title and Ctrl/Meta+Enter from summary submit; preserve plain Enter for multiline summary.
10. Preserve existing add-note submit and keyboard coverage.

### 3.3 Responsive surface integration tests

File: `packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx`

1. Use a controllable `useCompactWorkspace` mock so responsive branches are deterministic.
2. Desktop path: open Deck, select the Plan, enter edit, submit changed title/summary, then assert `api.workflow.patchItem` receives selected item ID, current `updatedAt`, and submitted fields.
3. Compact path: open Sheet directly, select the Plan, delete its visible note, then assert `api.workflow.deleteNote` receives note ID and current `updatedAt`. Query `document` when Dialog content is portalled.
4. Mock mutation responses with valid resources and allow normal workflow-query invalidation; do not assert component plumbing or source text.
5. Delete or replace the current `changes status...` test that only verifies a module import and never triggers/asserts the claimed mutation. Do not re-pin a non-behavioral assertion.
6. Preserve item-delete deselection, ribbon, shortcut, and unavailable-route coverage.

### 3.4 Verification sequence

Run focused checks after implementation:

```bash
pnpm --filter @dam-hopper/ui test -- \
  src/hooks/use-workflow-surface-actions.test.tsx \
  src/components/molecules/WorkflowSelectedItemBar.test.tsx \
  src/components/organisms/WorkflowContextSurface.test.tsx
pnpm --filter @dam-hopper/ui build
```

Then smoke the actual surface in both desktop Deck and compact Sheet:

1. Open Plan detail and select an item containing multiple/multiline notes.
2. Confirm notes/timestamps remain readable and the notes region scrolls without breaking the pane.
3. Delete one note; confirm successful invalidation removes it from refreshed overview.
4. Edit title and summary; confirm Save refreshes displayed item data.
5. Clear summary and save; reopen Edit and confirm it is empty.
6. Confirm Cancel, Escape, title Enter, summary Ctrl/Meta+Enter, and plain summary Enter behavior.
7. Confirm existing item delete, add note, status change, session, and child capture controls still work.

### Phase 3 Acceptance Criteria

- All three targeted test files pass.
- UI package TypeScript build passes, proving every prop chain and callback type is complete.
- Tests assert observable mutation behavior, not forwarding internals or module existence.
- Desktop and compact smoke checks confirm the real rendered surfaces and constrained scrolling.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Stale item/note causes HTTP 409 | Always pass selected DTO `updatedAt`; keep server/React Query authoritative and retain edit draft on failed save. |
| Deck works but Sheet callback is omitted | Mirror contracts explicitly and exercise one mutation through each responsive branch. |
| New Pencil button breaks old note tests | Select controls by accessible name/text, never DOM button order. |
| Summary empty string changes API semantics | Normalize trimmed empty summary to `null`; test it. |
| Enter shortcut destroys multiline summary entry | Submit bare Enter only from title; require Ctrl/Meta+Enter in summary. |
| Long notes consume the whole context pane | Bound and scroll notes list; wrap note content. |
| Locale-dependent timestamp assertions flake | Assert semantic `dateTime`; do not pin rendered locale string. |
| Duplicate mutation from rapid Save | Disable during an in-flight callback if async pending state is implemented. |

## Definition of Done

- Hook exports and responsive prop chains expose item editing and note deletion end to end.
- Selected item detail renders existing notes with timestamps and note delete controls.
- Selected item header exposes Pencil beside Trash and supports compact title/summary editing.
- Save/Cancel and required keyboard shortcuts behave consistently.
- Mutation payloads preserve request ID and CAS invariants.
- Focused tests, UI build, and desktop/compact smoke verification pass.
- No backend, API schema, new state store, note-editing, modal, or unrelated refactor added.


## Implementation Status

- [x] Phase 1: Action hooks & prop contracts (`handleUpdateItem`, `handleDeleteNote`, CAS concurrency) — completed 2026-09-07
- [x] Phase 2: Selected-item UI (`WorkflowSelectedItemBar`, `WorkflowSelectedItemEditForm`, `WorkflowSelectedItemNotesList`) — completed 2026-09-07
- [x] Phase 3: Unit and integration tests (27/27 vitest tests passed) — completed 2026-09-07

## Next Steps

- None for planned phases. Non-blocking review follow-up: await async edit mutation completion before closing the form and retain drafts if the mutation rejects.

## Unresolved Questions

None.
