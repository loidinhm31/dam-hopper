# Phase 02: Presence and Setup Gate

Date: 2026-07-25  
Priority: high  
Status: pending

## Context Links

- [Plan](plan.md)
- `apps/browser-extension/src/content.ts`
- `packages/ui/src/hooks/use-browser-debug.ts`
- `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`
- `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`

## Overview

Detect the extension in the Dam Hopper parent page before DOM-selection features
start. Missing clients receive a setup card with a download action and exact
Chromium load-unpacked steps.

## Key Insights

- A webpage cannot enumerate installed extensions or install one silently.
- The extension can set a harmless DOM marker on the parent page at
  `document_start`; the UI can observe that marker and an event.
- The target iframe handshake remains the final proof that the extension also
  has permission for the target origin.

## Requirements

- Extension marks both parent and framed documents without exposing privileges.
- UI distinguishes `checking`, `detected`, `missing`, and target-handshake failure.
- Missing state offers archive download, extraction/load instructions, and a
  user-triggered reload/check action.
- Picker, capture, and terminal handoff stay disabled until bridge-ready.

## Architecture

Create a small UI hook for the extension DOM marker. Pass its state through the
Browser Debug controller/panel. Keep all bridge protocol authority in the
existing iframe host; the marker is only onboarding telemetry.

## Related Code Files

- `apps/browser-extension/src/content.ts`
- `packages/ui/src/hooks/use-browser-debug.ts`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`
- `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`

## Implementation Steps

1. Add an extension-presence marker/event with a version field.
2. Add a UI hook that reads the marker and listens for the event.
3. Add a compact Browser Debug setup card with download and reload controls.
4. Keep preview/selection actions correctly gated and improve missing-target
   permission copy after a parent marker is detected.
5. Add focused tests for all client states.

## Todo List

- [ ] Parent marker and event.
- [ ] UI presence hook.
- [ ] Download/setup UI.
- [ ] State and regression tests.

## Success Criteria

A fresh browser sees setup before DOM selection. After extracting/loading the
archive and refreshing Dam Hopper, the Browser panel detects the extension and
can establish the target handshake.

## Risk Assessment

The marker proves only the parent injection. Target site access, framing, and
network reachability remain separate failure modes and need precise copy.

## Security Considerations

Do not trust the marker for DOM data or authorization; retain source, nonce,
request ID, and protocol validation for all bridge events.

## Next Steps

Validate release packaging and document the client workflow.
