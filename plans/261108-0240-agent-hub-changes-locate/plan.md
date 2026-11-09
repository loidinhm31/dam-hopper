# Implementation Plan - Agent Hub Changes Panel & File Locate

**Goal:** Add "Open Changes panel" affordance to Agent Hub right sidebar ("file changes" section) without project selection restrictions, add context menu to locate files in the "files" tree, and add locate feature to DiffViewer panel.

## Architecture & Integration
- `TraditionalProjectFileChanges`: Radix `ContextMenu` for each changed file with "Locate in files", "Open diff", "Open file".
- `TraditionalProjectWorkspaceTree`: Accept `revealRequest` and forward to `FileTree`.
- `TraditionalTerminalProjectsDisplay`: Add Open Changes button in "file changes" header; manage `revealRequest` state for locating files; ensure files sidebar is unhidden if hidden.
- `AgentHubApp`: Provide `onOpenChanges` callback; listen to `file:reveal` intent for current project.
- `DiffViewer`: Add "Locate file in file tree" toolbar button with `onLocateFile` and `file:reveal` dispatch.
- `ChangesApp` & `OsShell`: Set `activeTab: intent.payload.filePath ? "diff" : "changes"` and fallback project resolution.

- [Phase 1: Implement Changes Panel Launch and File Tree Locate](phase-01-changes-and-locate.md) — Complete
