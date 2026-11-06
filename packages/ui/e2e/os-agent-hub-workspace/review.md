# Visual Review — os-agent-hub-workspace

- **Status:** PENDING_HUMAN_REVIEW
- **Reviewer:** Pending
- **Reviewed At:** Pending
- **Run ID:** local-run
- **Git HEAD:** HEAD
- **Target:** Agent Hub Terminal-First Workspace & Floating OS File Panels

## Inspected Checkpoints
- [ ] **screenshot.png** (1440×900, default viewport)
- [ ] **fhd.png** (1920×1080, full HD viewport)
- [ ] **compact.png** (1024×640, minimum supported tier)
- [ ] **workspace-open.png** (project opened with zero-terminal empty state)
- [ ] **file-float.png** (floating editor window opened with owner badge above Hub)
- [ ] **terminal-streaming.png** (Hub terminal created and streaming output)

## Review Checklist
1. **AC1 / AC4 (Hub workspace & sidebar rows):** Hub renders maximized on desktop; sidebar cleanly displays projects and worktrees with disclosure chevron, activity indicator, and file tree.
2. **AC1 / B2 (Float file open & stacking):** Opening a file from the tree floats an editor above the maximized Hub with owner badge showing the clicked project/profile; focused float stays above maximized plane.
3. **AC2 (Instance isolation & refocus):** Opening the same relative path in a second profile/worktree creates a distinct window; clicking the same tuple refocuses the existing window without duplicate instances.
4. **AC3 / AC6 (PTY streaming continuity & no remount):** [+ New Terminal] launches a terminal that streams live output; switching projects, toggling sidebar, and splitting panes preserve streaming without xterm remount.
5. **AC5 (Agent row focus):** Agent list section renders appropriate status (in live E2E, indicates no observed agents without backend integration; verified with mock agents in browser test suite).
6. **B1 / B4 (Placeholder & Tab Actions):** Denied terminal panes display Go to window reveal placeholder; terminal tabs support target-fenced pin and close without closing Hub.

## Decision
- **Outcome:** PENDING_HUMAN_REVIEW
