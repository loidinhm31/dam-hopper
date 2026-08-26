# Phase 01 — Shared Session Export Controls

## Context Links

- [Overview](./plan.md)
- [Existing scoped export plan](../260707-2246-scoped-diagnostics-export/plan.md)
- [Diagnostics architecture](../../docs/system-architecture.md)

## Overview

- **Date:** 2026-07-15
- **Priority:** P1
- **Status:** Pending
- **Goal:** establish one controlled time window and one workspace-owned session export flow without changing the export contract.

## Key Insights

- `DiagnosticsExportButton` currently owns both window state and button UI; workspace needs the same window without a permanent export button.
- `exportDiagnosticsBundle` already creates the unchanged request and download.
- Recommended: extract the controlled selector, keep other pages' button behavior, and let `WorkspacePage` own menu/export state.
- Alternatives rejected: separate export handlers per mode duplicate state/error handling; React context is excessive for two explicit component branches.

## Requirements

- Preserve window choices `[2, 5, 10, 30, 60]` and workspace default `10` minutes.
- Render the selector in the common terminal header, beside existing terminal controls, in both modes.
- Export with `terminalIds: [clickedSessionId]`, `scope.terminalIds` matching, and clicked session project when known.
- Preserve `includeTerminalOutput=true`, `terminalTailBytes=65536`, response schema, JSON layout, and filename prefix.
- Keep `DiagnosticsExportButton` behavior on non-workspace pages unchanged.
- Retain current frontend time/scope filtering. Add strict session filtering only if existing entries carry a reliable `sessionId`; never drop global browser/React/route errors.

## Architecture

```text
Terminal header selector -> WorkspacePage.windowMinutes
Title right-click -> WorkspacePage.menuTarget(sessionId, x, y)
Menu select -> exportDiagnosticsBundle(existing mutation, exact session options)
             -> unchanged POST /api/diagnostics/export -> unchanged download
```

One owner prevents traditional/runtime drift. Pure export request construction remains in `diagnostics-export.ts`.

## Related Code Files

### Create

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/molecules/DiagnosticsTimeWindowSelect.tsx` — controlled selector using existing tokens and options.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.tsx` — fixed, clamped, dismissible one-action menu with pending/error feedback.

### Modify

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/DiagnosticsExportButton.tsx` — compose the extracted selector; preserve public defaults.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx` — own selector/menu/mutation state and exact-session export handler; remove workspace toolbar export action.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/diagnostics-export.ts` — only if a small pure exact-session options helper materially reduces request duplication.

### Delete

- None.

## Implementation Steps

1. Extract the existing select markup into a controlled component typed from `DIAGNOSTICS_WINDOW_OPTIONS`.
2. Recompose `DiagnosticsExportButton` with it; do not alter other pages' internal state or terminal-selection behavior.
3. Add menu state to `WorkspacePage`: target session/coordinates, selected window, pending error.
4. Build export options from the target session map; use exact one-element terminal IDs at request and `frontend.exportScope` levels.
5. Close menu on success/outside click/Escape; retain an actionable error on failure and prevent duplicate exports while pending.
6. Remove `workspaceDiagnosticsAction` and its shell `toolbarActions` wiring only where it represented this workspace export.

## Todo List

- [ ] Controlled window selector extracted.
- [ ] Existing page export controls unchanged.
- [ ] Workspace window/menu/export state centralized.
- [ ] Clicked session project and ID resolved safely.
- [ ] Existing API/download behavior retained.

## Success Criteria

- The shared terminal header shows the same time value before and after mode switches.
- An export request contains exactly the clicked session ID and selected minutes.
- Other routed pages still show and operate their current export button.
- No backend/client type changes appear in the diff.

## Risk Assessment

- **State regression:** selector could reset on mode switch. Mitigate by owning state above both mode branches.
- **Scope leak:** active session could replace clicked inactive session. Mitigate by storing ID from the context-menu event only.
- **Silent failure:** menu may close too early. Close only after success; show failure in menu.

## Security Considerations

- Continue existing protected mutation and best-effort redaction path.
- Do not place raw terminal output in client logs or UI error details.
- Keep current warning/documentation that downloaded tails may contain secrets.

## Next Steps

- Wire the shared callback through traditional and runtime title surfaces in Phase 02.

## Unresolved Questions

- None.
