# Phase 1: Implement Changes Panel Launch and File Tree Locate

## Context & Requirements
- Agent Hub right sidebar contains "files" and "file changes" sections.
- At "file changes" section header, add button to open "Changes" panel.
- Ensure opening Changes panel is not restricted by project selection (fallback to inventory/active project).
- Add context menu to changed file items in `TraditionalProjectFileChanges` with "Locate in files", "Open diff", and "Open file".
- When "Locate in files" is triggered, auto-expand folders in the "files" section, select and scroll to the file, and unhide files tree if hidden.
- In `DiffViewer` (Diff view panel), add a "Locate file in file tree" toolbar button to reveal the file.
## Tasks
- [x] Step 2.1: Extend `TraditionalProjectWorkspaceTree` with `revealRequest` prop forwarding to `FileTree`.
- [x] Step 2.2: Extend `TraditionalProjectFileChanges` with context menu and `onLocateFile` callback.
- [x] Step 2.3: Update `TraditionalTerminalProjectsDisplay` with Open Changes button and file tree locate.
- [x] Step 2.4: Update `AgentHubApp` with `onOpenChanges` and `file:reveal` intent handler.
- [x] Step 2.5: Update `DiffViewer` with locate button and ChangesApp integration.
- [x] Step 2.6: Fix OsShell changes:diff activeTab when filePath is not specified.
- [x] Step 3.1: Add unit tests for `TraditionalProjectFileChanges` context menu and locate.
- [x] Step 3.2: Add unit tests for `TraditionalTerminalProjectsDisplay` changes button and locate integration.
- [x] Step 3.3: Add unit tests for `DiffViewer` locate button.
- [x] Step 3.4: Verify full test suite and typechecks.
