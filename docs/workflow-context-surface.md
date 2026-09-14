# Workflow Context Surface

The shared `@dam-hopper/ui` workflow context surface gives browser and native
hosts one Plan-first view of the active project/worktree. It renders the
ambient ribbon plus a desktop deck or compact mobile sheet, then forwards
selected-item actions to the existing workflow mutation hooks. The server
remains authoritative for item and note timestamps, target ownership, CAS
checks, and replay; see [Workflow API](./workflow-api.md) and [Workflow Client
State](./workflow-client-state.md).

## Surface and callback flow

`WorkflowContextSurface` owns the overview query, target/item selection, and
responsive choice:

```text
WorkflowContextSurface
  -> WorkflowContextDeck | WorkflowContextSheet
  -> WorkflowItemList
  -> WorkflowSelectedItemBar
  -> useWorkflowSurfaceActions
  -> api.workflow PATCH / DELETE
```

The Deck is a non-modal region (`320px`–`440px` current height range). The Sheet
is a bottom Dialog with Projects, Plans & Work, and Execution segments at
`35dvh` collapsed or `90dvh` expanded height. Both paths pass the same item
callbacks; no responsive-only mutation behavior exists.

## Selected-item notes

`WorkflowSelectedItemBar` receives the selected `ItemOverviewNodeDto`, including
its authoritative `notes` array. `WorkflowSelectedItemNotesList`:

- renders every note in the received order, with the body preserved as
  whitespace-aware text;
- exposes `time[datetime]` as the note's `createdAt` and displays a concise
  local time;
- gives each note a `Delete note` button when the callback is available; and
- constrains the notes region to a 100px maximum height with its own vertical
  scrolling.

Delete invokes `onDeleteNote(note)` with the complete `NoteDto`, so the action
hook can send the note's current `updatedAt` for CAS. The mutation is direct
(no confirmation step), soft-deletes the note through
`DELETE /api/workflow/notes/{id}`, and refreshes the workflow query only after a
successful response. Notes remain append-only in this UI; there is no note-edit
control or endpoint. The existing Note action still opens the add-note editor,
which trims the body and supports Add, Cancel, Escape, and Ctrl/Meta+Enter.

## Selected-item editing

When `onEditItem` is available, the selected-item header shows an accessible
`Edit item` Pencil button next to `Delete item`. Editing replaces the header
area with `WorkflowSelectedItemEditForm` while status, session, child, and note
actions remain available. The form:

- starts from the selected item's current `title` and `summary`;
- trims both values before saving;
- rejects a blank title locally and sends a cleared/blank summary as `null`;
- saves with the button, Enter in the title, or Ctrl/Meta+Enter in the summary;
- keeps plain Enter in the summary as a newline; and
- cancels without mutation through Cancel or Escape.

Reopening the form initializes drafts from the current selected item, so
cancelled text is discarded. Save calls `onEditItem(item, { title, summary })`;
`useWorkflowSurfaceActions.handleUpdateItem` adds a fresh request UUID and the
item's current `updatedAt`, then delegates to `usePatchWorkflowItem`. The
status selector remains a separate mutation and is not changed by title or
summary editing.

## State, errors, and authority

The surface keeps open state, selected target/item, mobile segment, drafts, and
elapsed display ticks local to React. React Query owns the overview and
mutation state. Successful item/note mutations invalidate the `['workflow']`
root so the next overview supplies authoritative values; failed mutations do
not perform optimistic cache writes. The surface has no workflow URL or
localStorage persistence and does not introduce a new API or DTO.

For the complete component architecture and keyboard/focus contracts, see
[Frontend Components](./frontend-components.md#workflow-context-surface-phases-05-06)
and [System Architecture](./system-architecture.md#workflow-context-surface-ui-phase-05).
