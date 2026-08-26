# Phase 01 — Terminal/browser split and active-target handoff

## Context links

- [Overview](plan.md)
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/organisms/BrowserDebugTerminalHandoff.tsx`

## Overview

Date: 2026-07-25 · Priority: high · Status: in progress

## Key insights

`BrowserDebugKeepAliveHost` already preserves the iframe across viewport changes. The desktop terminal renderers can host Browser beside their active terminal; the existing resizable-panel dependency supports the desired split without custom pointer code.

## Requirements

- In wide Terminal and IDE mode, opening Browser shows a right-hand resizable pane beside the active terminal content.
- Browser close restores the full active terminal area; other Terminal tool panels remain floating.
- The active mounted, registered, server-live terminal is used automatically. No target chooser is rendered.
- A prepared artifact stays associated with the terminal selected at preparation, even after active-terminal changes.
- The iframe does not reload on terminal focus changes or resize.
- Compact behavior remains unchanged.

## Architecture

`WorkspacePage` supplies the current terminal target and secure artifact callbacks. `PaneContainer` and `ActiveTerminalRuntimeDisplay` render Browser with a `react-resizable-panels` horizontal group while Git/Ports/Fleet retain the floating panel. `BrowserDebugTerminalHandoff` snapshots the ready target when preparing and revalidates it before insertion.

## Related code files

- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`
- `packages/ui/src/components/organisms/BrowserDebugTerminalHandoff.tsx`
- `packages/ui/src/components/organisms/BrowserDebugTerminalHandoff.test.tsx`
- `packages/ui/src/components/organisms/BrowserDebugTerminalTargetList.tsx` (remove obsolete picker)
- `packages/ui/browser-tests/browser-debug-keep-alive.browser.ts`
- `docs/frontend-components.md`

## Implementation steps

1. Route Browser to desktop horizontal `Group`/`Panel` splits inside both active terminal renderers; make the browser width resizable and closeable.
2. Derive the active browser target in `WorkspacePage`; pass it through Browser panel props. Keep prepared artifact target local to handoff until insert/discard.
3. Remove target selection UI and simplify handoff lifecycle/error copy while retaining capture, review, expiry, liveness, idempotency, and cleanup protections.
4. Update focused tests and add browser evidence for iframe continuity over terminal changes/split viewport changes.
5. Update frontend component documentation after code matches the new architecture.

## Todo list

- [x] Split desktop Terminal and IDE Browser panes with reusable resize primitive.
- [x] Auto-bind artifact preparation to active ready terminal.
- [x] Hide the target chooser from the embedded Browser while retaining it for compact Browser.
- [x] Prove prepared artifacts remain bound to their original terminal.
- [ ] Run build, unit tests, browser tests, and manual responsive check.
- [x] Update docs.

## Success criteria

- Browser appears alongside, not over, the desktop terminal and its divider is operable.
- Browser artifacts require a live active terminal but never ask the user to choose one.
- Selection/review remains explicit, and stale/closed targets fail closed.
- All selected tests and TypeScript build pass.

## Risk assessment

- Resize can leave xterm geometry stale: invoke the existing terminal fit scheduling after panel layout changes.
- Reparenting can reload iframe: preserve the keep-alive host and only change viewport visibility.
- Target drift during review can write to the wrong terminal: capture target with artifact and revalidate its original id.

## Security considerations

No page content becomes terminal input. Preserve the server-generated reference-only handoff, control-byte stripping, untrusted-data warning, explicit confirmation, request size limits, origin checks, and artifact expiry/deletion.

## Next steps

Execute this phase via `/code`, then update phase/overview status after test and review gates.
