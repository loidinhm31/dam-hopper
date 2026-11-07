# Frontend Editor & Settings Repair Implementation Plan

## Scope & File Ownership
- **Exclusively Owned**: `packages/ui/**` and `apps/web/**` (except docs).
- **External Dependencies**: Backend API provided by `UnifiedServerConfig` (`server/**`), parent owns integration, machine data migration, and live browser smoke.

## Root Cause Analysis

### 1. Files Double-Click & Event Routing
- **Problem**: In `react-arborist`, `DefaultRow` handles `onClick` by running `this.select(); this.activate();` on every single click. `this.activate()` immediately invoked `FileTree`'s `handleActivate` -> `onFileOpen`, triggering an editor launch on single click instead of selecting only.
- **Missing Double-Click & Enter**: Neither `react-arborist` nor `FileTree` implemented `onDoubleClick` or `onKeyDown` with `Enter` for file opening. Arborist's `Enter` key is dedicated to inline renaming (`edit(node)`) and was ignored.
- **Arborist ContextMenu Trigger & Hit Testing**: In `FileTree.tsx`, `TreeContextMenu` wrapped every individual row in `<ContextMenu.Root><ContextMenu.Trigger asChild>`. Radix's `ContextMenu.Trigger` attaches pointer handlers and contextmenu markers onto `NodeRenderer`'s DOM div. In Puppeteer's automated locator checks, `_checkDisabled` tests `closest('[disabled]')` or `closest('[inert]')` or `pointer-events: none`. Hit-testing also required clear propagation between Arborist's virtualized row container and the inner node renderer.
- **Premature Blocking in Intent Handler**: In `OsShell.tsx`, the `file:open` intent handler `await`ed `useEditorStore.getState().open(targetRef, fileNode)` before calling `openWindow(...)`. If the file was large, binary, preview-only, or experienced transport latency, the window creation was delayed or failed to dispatch promptly.
- **Reopen / Deduplication**: Re-opening an already open file must focus the existing window and avoid duplicate window instances or duplicate tab buffers.

### 2. Format-Aware Renderer & Monaco Parking
- **Problem**: `EditorApp.tsx` only had branching for `isImageFile` and `isVideoFile`. All other files unconditionally mounted an empty slot and expected `attachMonacoToSlot(...)`.
- **Hidden Monaco for Preview Files**: `MonacoKeepAliveHost.tsx` unconditionally created `ParkedMonacoItem` instances for any file that was not an image or video, keeping hidden Monaco editors alive for HTML, Markdown, binary, and large files.
- **Media Target Support**: `issueImageTicket`, `issueVideoTicket`, and `LargeFileViewer` had hardcoded expectations for `ProjectTargetInput` and used `normalizeProjectTarget`, coercing or failing on workspace targets `{ kind: "workspace", profileId }`.
- **Format Coverage**: Format-aware rendering must route:
  - Images -> `ImagePreview`
  - Videos -> `VideoPreview`
  - Markdown -> `MarkdownHost` (with edit/preview mode support)
  - HTML -> `HtmlHost` (with preview support)
  - Large (>= 5MB) -> `LargeFileViewer`
  - Text / Code -> `MonacoHost` via KeepAlive parking host

### 3. Settings Global Workspace Cutover
- **Problem**: Settings UI previously referenced `defaults.workspace` and local workspace config discovery.
- **Canonical Model**: Aligned with `UnifiedServerConfig`:
  - `GET /api/global-config` returns `{ workspace: { name, root }, workspaces, ui, server }`.
  - Display actual canonical active root and selected config path.
  - Save workspace root mutations via `POST /api/global-config/workspace` `{ root, name? }`.
  - Remove all mentions of `defaults.workspace` and local per-directory `dam-hopper.toml`.

### 4. Window Placement Default (Float vs Tile)
- **Problem**: The prior `defaultWindowPlacement` implementation was incomplete. Settings state hydration, clamping, and persistence needed finishing. Previous edits may have damaged adjacent settings properties such as `terminalSuggestionsEnabled` or `sourceUnset`.
- **Central Window Creation Boundary**: Central window opening (`openWindow` in `window-store.ts` and manifests in `app-registry.ts`) must default ordinary new app windows to `float`, while respecting user's configured `defaultWindowPlacement` from settings ("float" | "tile") for initial placement. Existing tile restoration, explicit user mode toggles, and drag-to-dock actions must be preserved.

### 5. Stale Workspace Root Fencing
- **Problem**: In-flight editor tabs or file operations retaining paths from a prior workspace root must not save into a newly switched workspace root.
- **Client Retained Epoch**: Retain `workspaceEpoch` from document open / initial fetch and send it explicitly on workspace-target mutation requests (`workspaceEpoch`), handling `STALE_WORKSPACE_AUTHORITY` by alerting the user and preventing dirty overwrites.

## Implementation Steps

### Step 1: FileTree Double-Click & Enter Accessible Activation
- In `packages/ui/src/components/organisms/FileTree.tsx`:
  - Separate node selection from file opening.
  - Single click on a file node selects the node in Arborist (`node.select()`) without calling `onFileOpen`.
  - Double click (`onDoubleClick`) on a file node calls `onFileOpen(node.data)`.
  - `Enter` key on a focused file node calls `onFileOpen(node.data)` (preventing Arborist's rename/edit default).
  - Ensure `NodeRenderer` passes through proper hit-testing attributes, avoiding invalid attribute spreading (e.g. `tree` instance onto DOM element).
  - Ensure `TreeContextMenu` wrapping does not interfere with click/double-click event bubbling.

### Step 2: Intent Handling, Window Deduplication & Focus
- In `packages/ui/src/os/OsShell.tsx`:
  - `file:open` intent handler:
    - If window for this file/target already exists: restore (if minimized), focus, update appState, and return immediately.
    - If no window exists: create/open window immediately with target context and documentKey, initiating content load concurrently.
  - Ensure canonical documentKey / tabKey resolution is stable for workspace and project targets.

### Step 3: Format-Aware Renderer & Monaco Parking Optimization
- In `packages/ui/src/os/apps/EditorApp.tsx`:
  - Detect file type format:
    - Images: `isImageFile(filePath)` -> render `ImagePreview`.
    - Videos: `isVideoFile(filePath)` -> render `VideoPreview`.
    - Markdown: `.md`, `.markdown` -> render `MarkdownHost`.
    - HTML: `.html`, `.htm` -> render `HtmlHost`.
    - Large: `>= 5 * 1024 * 1024` bytes -> render `LargeFileViewer`.
    - Text/Code: render keep-alive Monaco slot.
  - Ensure `claimStatus` properly manages window claims for all formats.
- In `packages/ui/src/os/MonacoKeepAliveHost.tsx`:
  - Do NOT create `ParkedMonacoItem` for preview-only formats (images, videos, large files).
- In `packages/ui/src/api/image-tickets.ts`, `video-tickets.ts`, `ImagePreview.tsx`, `VideoPreview.tsx`, `LargeFileViewer.tsx`:
  - Support explicit `FsTargetRef` (`{ kind: "workspace", profileId }` and `{ kind: "project", ... }`) without casts or invalid project coercion.

### Step 4: Window Placement Configuration & Central Boundary
- In `packages/ui/src/stores/settings.ts`:
  - Validate and clamp `defaultWindowPlacement` ("float" | "tile", default "float").
  - Restore damaged settings fields (`terminalSuggestionsEnabled`, etc.).
  - Ensure `hydrate()` loads `defaultWindowPlacement` from `/api/global-config`.
  - Ensure saving persists to `/api/global-config/ui` (`{ defaultWindowPlacement }`).
- In `packages/ui/src/os/window-store.ts`:
  - Central creation boundary: when opening a new window without explicit mode, consult `defaultWindowPlacement` from settings store.
  - Preserve explicit docking, tiling, and restoration logic.

### Step 5: Settings Global Workspace Cutover
- In `packages/ui/src/components/pages/settings-page/SettingsConfigPanels.tsx` and `GlobalConfigEditor.tsx`:
  - Remove all UI language referring to `defaults.workspace` or local `dam-hopper.toml`.
  - Display authoritative active workspace root and selected config path.
  - Wire workspace root switch to `POST /api/global-config/workspace` (or `POST /api/workspace/switch`).

### Step 6: Workspace Epoch Retention in Editor Store
- In `packages/ui/src/stores/editor.ts` & fs ops hooks:
  - Track `workspaceEpoch` on tab when opening files in a workspace target.
  - Supply `workspaceEpoch` in mutation payloads (`fs:write_begin`, `fs:put_save`, `fs:op`, `fs:upload_begin`).
  - Handle `STALE_WORKSPACE_AUTHORITY` error gracefully without dirty buffer corruption.

## Verification & Acceptance
- Regression tests for FileTree double-click vs single-click behavior.
- Regression tests for format-aware renderer dispatch in EditorApp.
- Regression tests for Settings defaultWindowPlacement persistence and workspace root display.
- No tests/build mid-flight; parent will execute live browser smoke verification.
