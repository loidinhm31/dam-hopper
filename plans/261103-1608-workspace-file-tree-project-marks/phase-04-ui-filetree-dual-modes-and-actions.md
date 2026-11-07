# Phase 04: UI FileTree Dual Modes & Context Actions

**Status:** Pending execution; implementation/validation evidence required
**Execution Mode:** Sequential integration; one owner for all affected web caller migration
**Prerequisites:** Both `workspace-server-project-actions` and `workspace-editor-identity` terminal, with actual contracts/artifacts handed off
**Effort:** 8h
**Context:** [Overview](./plan.md), [Phase 02](./phase-02-server-apis-and-mark-unmark.md), [Phase 03](./phase-03-client-core-and-canonical-identity.md), [brainstorm](../reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md)

## 1. Requirements & Architecture

1. **End-to-end OS target propagation:** Update `os/types.ts`, `intents.ts`, `OsShell.tsx`, `EditorApp.tsx`, `MonacoKeepAliveHost.tsx`, Files/Search/Terminals apps and affected callers/tests to carry explicit owner/target/current workspace authority. File open/edit/reveal and search intents must support Workspace without fake project IDs; migrate every emitter/handler, not only the Files button.
   - Obtain canonical identity before window/resource deduplication and Monaco allocation. EditorApp claims, parking registry, Monaco URI, editor store and focus-existing behavior all use the same canonical `documentKey`.
   - Opening the same file through another route focuses/reuses the existing model/visible slot; no second dirty buffer, placeholder empty Tab or route-derived provisional model. Preserve undo, view state and dirty content across park/attach, modes and metadata updates.
   - Diff/read-only review resources remain separate; Git blame and other project-only affordances must not authorize workspace access.
2. **FileTree dual modes:**
   - Workspace default uses the explicit authorized root with zero projects. Missing/unsafe root shows actionable config remediation, not an arbitrary project fallback or an empty-success tree.
   - Workspace folders matching canonical marked roots display badges; nested projects do not duplicate file resources. External roots are never fabricated as physical workspace children or reached through escaping symlinks.
   - Projects mode offers All marked projects or one exact project; external projects are separately labelled. No projects: “No marked projects” plus “Return to Workspace”. A stale selected project stays unavailable until the user changes it.
   - Independent bounded expansion, selection, scroll, hidden/ignored visibility and filter state per Files window/mode; restore via Phase 03 persistence and owner/workspace scoping. Switching a view never retargets other windows/resources.
   - Lazy directory children and watched-directory leases; release unused resources on collapse/mode/window change. No recursive project/Git discovery or unconditional project Git queries for workspace targets.
3. **Folder actions / metadata:**
   - Unmarked directories offer “Mark as Project…”; marked directories offer “Project Settings” and “Unmark Project…”. Existing projects are already marks; canonical matching handles aliases/nested roots.
   - Mark dialog confirms name and selected folder, optional advanced settings; reuse supported project type semantics. Submit the captured target-relative folder and owner/authority, disable duplicate submission, keep validation failures visible, and never apply late success to another owner/window.
   - Unmark warns that associated commands/settings/tags are removed; no files/processes are removed. Surface failures without removing badges optimistically as if saved.
   - Refresh owner-scoped config/project queries on success and existing config notifications from another authorized client. Update badges, selectors, Settings and route availability; preserve dirty buffers and live terminals.
   - For in-root dirty files, acquire an explicitly revalidated Workspace save route; revoked external buffers remain readable in memory but unsavable. Project-only Git/Changes/Resolver windows become unavailable, never silently select a different project.
4. **Folder Terminal:** Dispatch `terminal:open` with exact owner, `{ type: "workspace" }`/project target and selected directory CWD through the actual terminal client creation path. Folder launch creates a new terminal at that validated directory, including workspace root; no HOME fallback, unknown-terminal creation bypass, process reuse or `cd` sent to an existing PTY.
5. **Search:** Explicit Workspace, Project and Folder scopes. Workspace means actual root, not union of projects; Folder includes a relative folder under an explicit target. Results retain target-relative path plus owner/authority, acquire canonical identity on open, and navigate to the match. Preserve bounds, cancellation and truncation indicators.
6. **Git entry points:** An unmarked folder/repository shows “Mark as project to use Git”; no Git request until a configured project/worktree is resolved. Marked non-repo shows “No repository”; no automatic init. Explicit Git opening focuses the exact target; selection/mode changes never retarget existing Git/Changes/Resolver windows.
7. **Complete consumer migration:** Apply explicit targets to ImagePreview/VideoPreview/LargeFileViewer, editor tabs/context actions, upload/download/reveal helpers, config/project settings links and all other affected web FS consumers. Remove obsolete FS signatures/aliases/comments and update fixtures. Android implementation remains excluded.

## 2. Writable Ownership & Preservation

- One integration owner takes sequential ownership of `packages/ui/src` after both Parallel A writers are terminal. Directory ownership is deliberately explicit so every affected caller/test can migrate; only workspace-file/identity/marking integration is in scope, not unrelated UI refactors.
- Key existing files: `components/organisms/FileTree.tsx`, `TreeContextMenu.tsx`, `MonacoHost.tsx`, `EditorTabs.tsx`, preview components; `os/MonacoKeepAliveHost.tsx`, `os/OsShell.tsx`, `os/intents.ts`, `os/types.ts`, app adapters; file utilities and relevant hooks.
- Create MarkProjectDialog/UnmarkProjectDialog and targeted component/integration tests. Reuse existing dialog/focus/Cognito/input-arbiter patterns so keyboard input cannot leak into terminals.
- All server, Android, plan and non-UI-source files are read-only. Product contract changes must be escalated to the coordinator and propagated through phases, not patched silently.
- Preserve all existing `packages/ui` modifications, especially FileTree/FilesApp. Integrate with current contents; never replace them with a historical snapshot or reset the worktree.

## 3. Implementation Steps / Task Ownership

### workspace-os-integration

1. Consume both completed handoffs and migrate typed intents/window state, serialization consumers and actual terminal creation.
2. Replace route-derived key consumers in EditorApp, parking host and Monaco/resource claims with Phase 03's canonical resolved identity; eliminate placeholder-tab creation.
3. Migrate previews/media/download/encrypted saves and all project-only editor actions; preserve meaningful existing project behavior.
4. Author integration regressions for alias focus/dirty/undo/claims, unmark and stale-owner completion. Do not infer working Monaco behavior from store-only tests.

- [ ] <!-- evcrate-task:workspace-os-integration --> Integrate actual OS resources and all affected target callers

### workspace-tree-actions

1. Add tree modes, per-window state, lazy roots/children and badges; remove zero-project gate.
2. Implement mark/settings/unmark dialogs, owner-scoped config refresh and revoked-target availability.
3. Wire search scopes/result open, folder terminal and Git CTA to actual migrated intent paths.
4. Author FileTree and FilesApp component tests, isolation/persistence/empty/error cases and affected old-fixture migration.

- [ ] <!-- evcrate-task:workspace-tree-actions --> Deliver dual-mode Files, mark actions, search and gated Git journeys

```evcrate-tasks
[
  {
    "id": "workspace-os-integration",
    "title": "Integrate canonical editor resources, intents and complete web caller migration",
    "blocked_by": ["workspace-server-project-actions", "workspace-editor-identity"],
    "allowed_files": ["packages/ui/src"],
    "constraints": ["One sequential integration owner, only after both parallel workers are terminal.", "Only affected filesystem/identity/metadata consumers and tests; no unrelated refactors or server/Android/plan writes.", "Preserve all pre-existing UI edits and dirty buffers; no placeholder model or global-project fallback.", "No mid-flight checks; coordinator owns coherent integration verification."],
    "acceptance": ["Intent emitters/handlers, EditorApp claims, parking host and Monaco URI share resolved canonical identity before model allocation.", "Workspace/project aliases focus or attach the same dirty model with preserved undo/save boundaries; diffs remain separate.", "Media/upload/download/encrypted and remaining web FS consumers use explicit targets without compatibility shims.", "Folder terminal creation carries the exact target/CWD and cannot reuse or retarget an existing terminal."],
    "verification": ["Coordinator runs pnpm --filter @dam-hopper/ui build and targeted intent/resource/editor/preview regressions after all integration edits.", "Exercise actual Monaco parking/focus and client-to-server target requests; record evidence separately from mocked boundary tests."]
  },
  {
    "id": "workspace-tree-actions",
    "title": "Implement Workspace and Projects trees with explicit folder actions",
    "blocked_by": ["workspace-os-integration"],
    "allowed_files": ["packages/ui/src"],
    "constraints": ["Same integration owner; affected Files/Search/Git/settings consumers and tests only.", "No project discovery, automatic git init, disk deletion, PTY termination or unrelated target retargeting.", "Preserve user edits and use existing modal/input isolation patterns; no mid-flight checks."],
    "acceptance": ["Zero-project safe-root Files supports normal operations; unsafe root shows actionable failure.", "Both modes, external/nested roots, badges, settings/mark/unmark and persisted per-window state work without arbitrary stale-filter fallback.", "Search Workspace/Project/Folder and selected-directory terminal work with exact owners/targets.", "Unmarked Git CTA and revoked project-only windows fail closed while dirty buffers and processes survive.", "Lazy children/watch teardown and bounded search remain intact; configuration updates from another client refresh marks."],
    "verification": ["Coordinator runs focused FileTree/FilesApp/search/intent/persistence regressions and the full UI suite once after integration.", "Phase 05 exercises all twelve full-app journeys, including unmarked direct Git denial, external revocation and fresh visual review."]
  }
]
```

## 4. Failure / Rollback

Missing authority, inaccessible roots, stale filters and mark failures remain visible and actionable; never disguise them as empty success or broaden the route. Qualification defects return to their owning task before retry. Revert only feature-owned integration changes after preserving user modifications and dirty-buffer data; do not clear all persisted OS state or terminate processes as recovery.
