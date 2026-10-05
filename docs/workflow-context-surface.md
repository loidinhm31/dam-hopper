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

For the complete component architecture and keyboard/focus contracts, see the
[Frontend Components index](./frontend-components.md) and
[System Architecture](./system-architecture.md#workflow-tracking-engine).

## Workflow context surface components

**Status:** Responsive workflow context UI and `WorkspacePage` shell
integration complete (2026-09-02). The surface reads the
bounded workflow overview and keeps presentation state local; the server
remains authoritative for workflow validation, timestamps, target ownership,
and mutation replay. Selected-item note rendering, per-note deletion, and inline
title/summary editing are detailed in the [selected-item notes](#selected-item-notes)
and [selected-item editing](#selected-item-editing) contracts below.

**Locations:**

| Module                                                                   | Responsibility                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/lib/workflow-focus.ts`                                  | Shortcut matching, editable/native/Monaco/xterm/dialog suppression, and safe focus restoration.                        |
| `packages/ui/src/api/workflow-selectors.ts`                              | Target filtering, active-item selection, attention aggregation, tree flattening, and factual progress labels.          |
| `packages/ui/src/components/molecules/WorkflowQuickCapture.tsx`          | Compact Plan-first item form with optional parent, summary, status, and immediate session start.                       |
| `packages/ui/src/components/molecules/WorkflowItemRow.tsx`               | Hierarchical row with depth, status icon/color, selection, active-session marker, note/progress copy, and child count. |
| `packages/ui/src/components/molecules/WorkflowItemList.tsx`              | Plan and standalone-Task trees plus selection and New Plan entry point.                                                |
| `packages/ui/src/components/molecules/WorkflowSelectedItemBar.tsx`       | Selected item status/session/child actions, note drafting, note rendering/deletion, and edit entry point.              |
| `packages/ui/src/components/molecules/WorkflowSelectedItemEditForm.tsx`  | Inline title/summary editor with trim, blank-title guard, Save/Cancel, and keyboard shortcuts.                         |
| `packages/ui/src/components/molecules/WorkflowSelectedItemNotesList.tsx` | Ordered, independently scrollable note list with timestamps and note-scoped deletion.                                  |
| `packages/ui/src/components/molecules/WorkflowSessionCard.tsx`           | Running/past session details, duration, manual end/abandon controls, links, and suggested end-time review.             |
| `packages/ui/src/components/molecules/WorkflowExecutionList.tsx`         | Start/end session controls and manual Agent Harness/Agent Run linking.                                                 |
| `packages/ui/src/components/molecules/WorkflowProjectList.tsx`           | Project/worktree target switcher with plan, task, and running-session counts.                                          |
| `packages/ui/src/components/organisms/WorkflowContextRibbon.tsx`         | Compact ambient summary with loading, retry, status, duration, progress, and live-region output.                       |
| `packages/ui/src/components/organisms/WorkflowContextDeck.tsx`           | Non-modal desktop context region with project, item, quick-capture, and execution panes.                               |
| `packages/ui/src/components/organisms/WorkflowContextSheet.tsx`          | Mobile bottom Dialog with Projects, Plans & Work, and Execution segments.                                              |
| `packages/ui/src/components/organisms/WorkflowContextSurface.tsx`        | Top-level overview query, selectors, timer, keyboard handling, and deck/sheet orchestration.                           |
| `packages/ui/src/hooks/use-workflow-surface-actions.ts`                  | Request-ID-bearing workflow mutation callbacks used by the surface.                                                    |

### WorkspacePage and shell integration

`WorkspacePage` builds one memoized `workflowToolbarActions` node containing
`WorkflowContextSurface`. The same node passes through the existing
`toolbarActions` prop in every workspace branch:

| Shell                    | Placement                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `IdeShell`               | 40px companion row above editor/tool content.                                           |
| `TerminalWorkspaceShell` | 40px companion row above terminal/overlay content.                                      |
| `MobileWorkspaceShell`   | Safe-area-aware inline action row; existing compact surface selector remains unchanged. |

The surface is not a route, activity-bar tool, mobile surface, TopNav item, or
second PTY lifecycle. Shell mode changes therefore preserve the existing
terminal manager, terminal buffers, editor state, and Browser keep-alive.

Navigation uses existing owners and pure decisions from
`packages/ui/src/lib/workflow-workspace-integration.ts`:

- `resolveWorkflowTerminalReveal` rejects blank, profile-mismatched, or unknown
  session IDs, then `WorkspacePage` calls existing `handleSelectTerminal`.
  Compact mode additionally requests the existing Terminal surface; it does
  not force workspace mode or add URL parameters.
- `resolveWorkflowTargetSelection` requires a configured project and available
  worktree. Successful selection calls `setActiveProject` and
  `useProjectTargetStore.selectTarget`; unavailable historical targets stay
  display-only.
- `deriveWorkflowTerminalCandidates` merges stable-ID observations from
  `sessionMap` and `mountedSessions`, carries project/worktree/alive/incarnation
  state, and marks unavailable targets. It excludes command, CWD, and output.

Callback paths are explicit: `onOpenTerminal` flows from
`WorkflowContextSurface` through `WorkflowContextDeck` /
`WorkflowContextSheet`, `WorkflowExecutionList`, and `WorkflowSessionCard`;
the card invokes it only for a clicked linked terminal. `onSelectTarget` flows
from the surface through the deck/sheet to `WorkflowProjectList`, then returns
to `WorkspacePage` for store selection.

`WorkflowContextSurface` is keyed by `activeProfileId`. A profile switch
remounts only workflow presentation state (open state, target/item selections,
mobile segment, quick-capture drafts, elapsed clock); terminal/editor and
Browser keep-alive state remain outside the key boundary. Terminal observations
and suggested end times remain read-only until the user explicitly submits a
workflow mutation.

### Data and state flow

`useWorkflowOverview(effectiveTarget)` supplies the current workspace view.
`filterOverviewByTarget` applies exact project matching and exact
`worktreePath` matching when a path is selected; a filter with only a project
matches that project's configured-root and worktree results. The selectors
then choose the first root Plan or standalone Task with a directly or
descendant-active session, otherwise the best status priority and newest
`updatedAt`. Tree flattening is pre-order, and the progress label is factual
(`{completed}/{total} tracked tasks done`) or `Breakdown not tracked`.

The surface passes the selected target, active item, running session,
attention summary, and mutation callbacks to the ribbon and one responsive
context region:

```text
useWorkflowOverview
  -> target selectors
  -> WorkflowContextSurface
     -> WorkflowContextRibbon
     -> WorkflowContextDeck (desktop) | WorkflowContextSheet (compact)
        -> ProjectList / ItemList / QuickCapture / ExecutionList
           -> useWorkflowSurfaceActions
              -> api.workflow mutations -> ['workflow'] cache invalidation
```

TanStack Query owns server data. Surface-local React state owns open/closed
presentation, selected target/item, quick-capture drafts, mobile segment, and
the elapsed clock. Workflow state is not written to URL parameters,
`localStorage`, terminal registries, or Zustand stores. While a running
session is present, the surface shares one visible-document-aware one-second
timer across the ribbon and session cards; it does not start an interval when
no running session is reported.

### Ambient ribbon

`WorkflowContextRibbon` is a compact `h-9` companion row (the implementation
utility is shorter than a strict 40px guarantee), exposed as a `region` with
an assertive error state and polite active-plan live text. It shows the
selected project and worktree basename, the active Plan or standalone Task,
status icon/color/text, elapsed duration for a running session, the latest
note as `Next: ...` when available, or the factual tracked-Task label. A
blocked indicator is shown for blocked/running attention. Loading renders a
skeleton and errors expose Retry. The ribbon opens/closes the context region
and offers New Plan only when no active item is selected.

### Desktop deck

`WorkflowContextDeck` renders only while open as a non-modal `role="region"`
with `id="workflow-context-deck"`. Its current height utilities are
`min-h-[320px]`, `h-[360px]`, and `max-h-[440px]`. At `md` it uses two columns;
at `lg` it uses project, work, and execution columns
(`220px 1fr 300px`). The Projects pane is hidden below `lg`. The desktop
deck listens for Escape to close and does not install a focus trap.

### Mobile sheet

`WorkflowContextSheet` uses a bottom Radix Dialog with safe-area-bottom
padding and segmented navigation for `projects`, `items`, and `execution`.
Project selection returns to the Items segment. The current implementation
uses `h-[35dvh]` when collapsed and `h-[90dvh]` when expanded, with a drag
handle/toggle. Segment controls use `h-11` with `min-h-[44px]`; browser-level
touch target, overscroll, focus-return, and geometry qualification remain outside
the unit-tested contract.

### Items, capture, and sessions

The item tree renders root Plans, recursive Phase/Task children, and
standalone Tasks. Selecting a row toggles it off when selected again. Rows
show status-specific icon/color, active-session state, the latest note in
preference to progress text, and child count. `WorkflowQuickCapture` requires
a trimmed title, defaults to Plan and Backlog, supports Phase/Task with an
optional parent, accepts summary text, and can request an immediate session.
Selecting a row also reveals `WorkflowSelectedItemBar`. The selected detail
keeps status/session/child actions alongside Note and Delete item controls;
when wired, Edit opens the inline title/summary form. Existing notes render in
server order with timestamps and per-note Delete note actions. Item updates
trim title/summary, encode an empty summary as `null`, and use the selected
item's `updatedAt` for CAS; note deletion uses the note's `updatedAt`.

Session cards calculate elapsed duration from explicit ISO timestamps and the
shared `nowMs`. Running cards accept manual end timestamps, provide Now,
validate the interval before End, and expose Abandon. Resource links show
bounded labels and observed state. An observed `suggestedEndTime` is displayed
only after an explicit Use suggestion action fills the draft; it never changes
manual session status or timestamps automatically. Execution controls start a
session from a manual timestamp (or Now) and currently expose manual Agent
Harness/Agent Run fields when a running session is available.

### Focus and action safety

The default toggle is `Mod+Shift+KeyW` (Cmd on macOS, Ctrl elsewhere). The
focus guard rejects native inputs/selects/textareas, contenteditable elements,
Monaco editors, xterm surfaces/helper textareas, dialogs, and elements marked
with suppression/native-input attributes. Handlers prevent the browser default
only after ownership is established. Mutation callbacks generate a UUID
`requestId`, preserve target scope, and use the workflow API's typed
success/error boundary; create-with-immediate-session starts that session with
the current ISO time.

### Verification and current qualification

Historical verification recorded on 2026-09-02 confirms targeted UI workflow
coverage at 62/62 tests (13 pure-helper, 26 WorkspacePage, 6 IdeShell, 12
TerminalWorkspaceShell, and 5 MobileWorkspaceShell assertions), full UI suite
at 1,515/1,515 tests passing, relevant Chromium smoke at 8/8 tests, Rust server
suite at 907/907 executed (two ignored), and UI TypeScript compilation passing.

Formal source coverage remains unavailable because `@vitest/coverage-v8` and
Rust coverage tools are not installed. Focused Chromium verification completed
geometry, safe-area/accessibility, focus-continuity, and host-integration
checks; no blanket claim is made for untested browsers or devices.
Resource-attention projection remains a separate selector/UI follow-up; the
selected-item detail now renders item edit and note controls. `onEditItem` and
`onDeleteNote` are forwarded through both responsive containers to the selected
bar; see [selected-item notes](#selected-item-notes) and
[selected-item editing](#selected-item-editing).

