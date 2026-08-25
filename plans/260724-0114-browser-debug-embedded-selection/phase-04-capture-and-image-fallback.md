# Phase 04 — Screen Capture, Crop, and Image Fallback

## Context links

- Parent: [plan.md](./plan.md)
- Research: [bridge/capture](./research/researcher-01-browser-bridge-capture.md)
- UI surface: [phase 03](./phase-03-browser-tool-and-iframe-bridge.md)
- MDN: [getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

## Overview

- Date: 2026-07-24
- Description: Add explicit current-tab capture, selected-region crop, and
  deterministic DOM-only/manual image fallback.
- Priority: P1
- Implementation status: Done (2026-07-24 18:20 +07, Asia/Ho_Chi_Minh)
- Review status: Approved (2026-07-24 18:20 +07, Asia/Ho_Chi_Minh)

## Key Insights

- Capture permissions require transient user activation and cannot be persisted.
- Capture dimensions are physical pixels; CSS rect mapping must account for
  captured surface size, DPR, zoom, scroll, and clamping.
- The browser may let the user choose another surface; do not claim capture
  identity from hints alone.

## Requirements

- Start capture only from an explicit button.
- Prefer current browser tab; disable audio; inspect track settings.
- Crop the selected iframe region to PNG with hard size cap.
- Stop all tracks on Browser close, denial, wrong surface, upload, or Workspace
  unmount; stopping capture must not dispose the parked iframe.
- Preserve semantic selection when capture is denied or unsupported.
- Allow explicit PNG/JPEG upload/paste fallback; never auto-upload.

## Architecture

Create a pure capture helper that returns typed outcomes:
`captured`, `denied`, `wrong-surface`, `unsupported`, `invalid-rect`, and
`manual-image`. Derive scale from captured frame dimensions and bridge-reported
surface metadata; clamp at final bitmap operation. Feature-detect
`CropTarget`/`cropTo`, but keep coordinate crop as the baseline.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-capture.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-capture.test.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugPanel.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-browser-debug.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/transport.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/browser-debug-panel.browser.tsx`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/fixtures/browser-debug-target.html`.

## Implementation Steps

1. Feature-detect secure context, `getDisplayMedia`, video/canvas/Blob, and
   optional crop APIs.
2. Request `{ displaySurface: "browser", preferCurrentTab: true, audio: false }`.
3. Inspect `track.getSettings().displaySurface`; reject wrong surface safely.
4. Map iframe-relative CSS bounds to captured pixels using measured surface
   dimensions, not an assumed DPR.
5. Clamp zero/negative/out-of-frame rectangles and encode PNG.
6. Send binary PNG through the authenticated specialized transport method.
7. On denial/unsupported, retain DOM result and expose manual image action.
8. Add manual Chromium check for chooser, zoom, HiDPI, scrolling, crop, and
   Browser close/reopen track cleanup.

## Todo list

- [x] Test `NotAllowedError`, `NotFoundError`, and `NotReadableError`.
- [x] Test wrong tab/window selection and track-ended callback.
- [x] Test DPR/zoom/scroll/nested iframe rectangle mapping.
- [x] Test oversized PNG rejection and track cleanup.

## Success Criteria

- DOM selection works without capture permission.
- Correct crop at normal zoom and HiDPI in supported Chromium.
- Denial never blocks preview/attach of semantic metadata.
- No `MediaStream` survives Browser panel close; the keep-alive iframe remains
  mounted without retaining capture pixels.

## Risk Assessment

- Browser chooser cannot be automated reliably in headless CI.
- Capture API support differs by browser/version and secure-context status.
- Wrong-surface detection may need visual/manual confirmation.

## Security Considerations

- Capture only the current tab when the user explicitly chooses it; never ask
  for monitor capture by default.
- Do not send audio, full tab frames, or browser chrome.
- Bound image pixels/bytes before upload and revoke object URLs after use.

## Next steps

Pass the resulting optional PNG plus semantic JSON to the artifact API. If crop
reliability is below the release bar, ship DOM-only + manual upload and defer
automatic crop rather than adding a proxy or changing the extension trust
boundary.

## Validation

- Capture helper unit tests cover API detection, permission/device errors,
  wrong-surface rejection, track-ended cleanup, rectangle mapping/clamping,
  PNG limits, and manual image fallback.
- Chromium browser tests cover explicit capture/manual-image controls and track
  cleanup when the Browser panel closes; DOM selection remains usable without
  capture.
- Review approved; no blocking security, privacy, or lifecycle issues found.

## Unresolved questions

- Browser matrix for `CropTarget`/`cropTo`.
- Whether manual image paste needs clipboard permissions or plain file input.
