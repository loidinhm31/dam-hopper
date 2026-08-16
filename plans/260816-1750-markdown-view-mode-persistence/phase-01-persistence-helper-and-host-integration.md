# Phase 01 — Persistence Helper and Host Integration

## Context Links

- [Plan overview](./plan.md)
- [MarkdownHost](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MarkdownHost.tsx)
- [EditorTabs](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx)
- [Editor tab identity](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts:90)
- [Workspace-mode storage pattern](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/workspace-mode.ts)
- [Architecture invariant](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md:2127)

## Overview

- **Date:** 2026-08-16
- **Priority:** P2
- **Status:** Completed
- **Goal:** replace MarkdownHost's transient mode state with one narrow, validated browser-local preference shared by every MarkdownHost in the app origin.

## Key Insights

- `EditorTabs` already detects `.md`/`.mdx` and passes `activeTab.key` to `MarkdownHost`; that key remains needed by Monaco but is not a persistence scope.
- The requested behavior is global across projects and workspaces, so a `Tab` field or `tabKey` map would create the wrong scope.
- Existing helpers treat browser storage as optional: validate reads, catch access/JSON failures, and return a safe UI default.

## Requirements

- Support only `edit`, `split`, and `preview`; default to `split`.
- Persist one versioned localStorage scalar shared by every project and workspace in the app origin.
- On load, accept only a valid mode string; otherwise return Split without throwing.
- On toggle, update the in-memory mode and write the global value best-effort; no persistence write on initial render.
- Mark exactly the selected mode button with `aria-pressed`; retain the current labels and visual behavior.

## Architecture

`EditorTabs -> MarkdownHost(tabKey) -> loadMarkdownViewMode() -> localStorage`; click: `setMode -> saveMarkdownViewMode(mode)`. The helper is the sole storage boundary. `tabKey` remains an editor identity only. No store, tab schema, transport, server, or project file participates.

## Related Code Files

- **Create:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/markdown-view-mode-persistence.ts` — mode type, versioned global storage key, guarded load/save.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MarkdownHost.tsx` — initialize from the global helper; centralize selection/write; add pressed-state semantics.
- **Do not modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts`, `EditorTabs.tsx`, server, APIs, config, database.

## Implementation Steps

1. Add a self-contained helper patterned after `workspace-mode.ts`; expose the mode union, default, guarded storage interface, and versioned key (`dam-hopper:markdown-view-mode:v1`).
2. Validate the stored scalar against the supported modes. Treat missing or invalid values as Split.
3. Save only the selected global mode; do not infer or migrate values from editor-state tabs.
4. In `MarkdownHost`, initialize from the global helper and keep `tabKey` only for the Monaco/editor identity.
5. Route mode buttons through one handler that updates UI then best-effort saves; add `type="button"` and `aria-pressed={mode === id}`.
6. Preserve lazy Monaco loading, split-pane layout, preview behavior, editor callbacks, and default Split with no unrelated refactor.

## Todo List

- [x] Create validated versioned global helper.
- [x] Load the global mode in MarkdownHost.
- [x] Save only explicit global mode selections.
- [x] Add accessible pressed state to all three controls.
- [x] Confirm no `Tab`/Zustand/API/backend change appears in the diff.

## Success Criteria

- Edit, Split, and Preview each restore for every MarkdownHost after remount.
- Different projects and workspaces all observe the same selected mode.
- Missing, invalid, malformed, or throwing storage results in usable Split mode.
- Exactly one visible selector reports `aria-pressed="true"` after each selection.

## Risk Assessment

- **Stale React state when `tabKey` changes:** global mode is intentionally retained; cover in-place switching in Chromium tests.
- **Corrupt or blocked storage:** contain every storage and JSON operation in the helper; UI remains functional.
- **Storage value unavailable or invalid:** fall back to Split and keep editing usable.

## Security Considerations

- Payload contains only one display-mode string; never persist document content, auth data, tokens, or project/workspace identity.
- Storage is browser-local and must not control authorization, server behavior, or logging.

## Next Steps

Phase 02 covers the focused helper and Chromium cross-project/workspace tests; no follow-on implementation work is required.
