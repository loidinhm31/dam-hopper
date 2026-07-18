# Fallback scout

Gemini was installed but unauthenticated, so a local scout mapped the same repair seams.

- Branch select: `GitBranchControl.tsx`, `GitBranchControl.test.tsx`.
- Menu presenters: `GitBranchContextMenu.tsx`, `TerminalDiagnosticsContextMenu.tsx`, their integration tests.
- Terminal lifecycle: `TerminalKeepAliveHost.tsx`, `MultiTerminalDisplay.tsx`, `TerminalPanel.tsx`, `terminal-renderer.ts`, and renderer tests.

The shared ContextMenu primitive is not the defect source and should remain untouched.
