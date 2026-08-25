# Phase 02 — Image preview and editor routing

## Context links

- Video lifecycle reference: /mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/VideoPreview.tsx, /mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/video-tickets.ts.
- Routing/state: /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tier.ts, /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.ts, /mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts, /mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx.
- Existing profile lifecycle: /mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/server-config.ts and server-config.test.ts.

## Overview

- **Priority:** P2; user-visible Explorer behavior.
- **Status:** Complete; depends on the image API contract from Phase 01.
- **Goal:** route image files before generic binary/large handling and render one direct native <img> with safe lifecycle controls.

## Key Insights

- The editor currently uses a video tier to avoid fsRead on open and repeats video guards in open, save, reload, hydrate, and Git reconciliation paths.
- EditorTabs already routes legacy persisted video tabs by final extension before any viewer can mount; image routing needs the same compatibility guard and must preserve diff-tab behavior.
- VideoPreview already snapshots profile version, aborts issuance, rejects stale results, clears the native source, revokes best-effort, and uses generic errors. Image should reuse the lifecycle shape but not add a speculative generic media component.
- Existing file decorations intentionally recognize broader image-like extensions; decoration breadth is not the preview allowlist and should remain separate.

## Requirements

- Add a closed client helper for PNG/JPG/JPEG/GIF/WebP, final case-insensitive extension only; reject dotfiles, path tricks, excluded formats, and non-final matches.
- Add an image ticket client that snapshots profile origin/auth, uses a bounded issue timeout and abort signal, validates ticket token/response/path strictly, preserves the issuing profile for revoke, and exposes fixed safe errors.
- Add ImagePreview with one native <img> whose src is the opaque capability URL. Use alt="Image preview: {fileName}", onLoad/onError, a loading/ready/error state, retry, stale-result protection, profile-change restart, source cleanup, and best-effort ticket revoke.
- Never call fsRead, fetch(...).blob(), URL.createObjectURL, canvas conversion, or an image download helper. Do not render a download action.
- Add an "image" file tier before binary/large handling. All open, hydration, save, force-overwrite, reload, and Git-reconciliation paths must treat image tabs as preview-only and avoid file materialization.
- Route image before generic binary/large viewers while preserving video precedence/behavior and dedicated diff viewers.

## Architecture / data flow

1. Explorer node enters fileTier; an allowlisted image gets tier image regardless of size/binary hint.
2. Editor store creates a ready, non-hydrating image placeholder and returns without WebSocket/REST bytes.
3. EditorTabs detects both current image tier and legacy tabs whose final name is allowlisted, then mounts ImagePreview before binary/large branches.
4. ImagePreview issues one authenticated ticket, validates generation/profile freshness, assigns only the absolute image capability URL to img src, and lets the browser request the stream natively.
5. On retry, tab switch, profile change, stale response, or unmount: abort issue, clear src, invalidate event generation, revoke old ticket, and ignore late results. onError exposes only generic safe copy.

## Related code files

**Modify**

- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tier.ts — add image tier and check image routing before binary/large classification.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts — skip image byte reads/writes and normalize legacy/hydrated/reconciled image tabs.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx — add image candidate detection and viewer branch before generic binary/large handling.

**Create**

- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/image-file.ts — closed extension/MIME routing contract.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/image-tickets.ts — authenticated issue/revoke client and strict response parser.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ImagePreview.tsx — direct native image preview and lifecycle UI.

**Delete:** none. Do not rename or remove VideoPreview, video-tickets.ts, or the video routing contract.

## Implementation Steps

1. Define imageMimeType, isImageFile, and isImagePreviewCandidate with the same final-extension semantics as the video helper; keep SVG decoration support unrelated to preview routing.
2. Implement image ticket issue/revoke with a strict /api/fs/image/stream/{token} path regex, fixed preview purpose, profile-auth snapshot, timeout, abort, and generic errors.
3. Implement the component with separate refs for issue controller, capability, source URL, and monotonically increasing generation. Clear the element source before revocation and never use object URLs.
4. Add the image tier and update every existing video guard in editor.ts to use an explicit preview-only predicate or image equivalent; ensure persisted tabs recover as image and bump previewRevision on reload.
5. Add the EditorTabs image branch and accessible responsive layout. Keep copy image-specific and omit download controls.
6. Verify a large image never enters fsRead/Blob paths and a .svg/.avif/.bmp/.tiff file still follows the existing generic path.

## Todo

- [x] Add exact image allowlist/MIME helper.
- [x] Add ticket client with auth snapshot, strict URL validation, abort/timeout, revoke, and safe errors.
- [x] Add native <img> preview with retry, stale, profile, cleanup, and error states.
- [x] Add image tier and all editor-store preview-only guards.
- [x] Mount image preview before generic binary/large viewers; keep diff/video compatibility.

## Success Criteria

- Opening any allowlisted image renders a native <img> from an opaque stream URL without JS byte materialization.
- No image open/save/reload/reconciliation path calls fsRead or attempts to write the image tab.
- Late ticket responses cannot replace the active source; retry and profile changes create fresh capabilities; cleanup removes source and revokes.
- UI remains usable at narrow widths, exposes a meaningful alt, and never reveals path/ticket/auth details in error copy.

## Risk Assessment

- **Duplicated lifecycle code:** keep the component small and structurally parallel to the shipped video lifecycle; do not refactor video in this slice unless tests show a safe shared hook boundary.
- **Legacy persisted tabs:** extension fallback must be checked before loading; add explicit tests for old tabs with tier large or binary.
- **Browser decode differences:** treat onError as an unsupported/unavailable state; do not add MIME sniffing or a buffered fallback.
- **Native request observability:** browser image requests do not necessarily pass through window.fetch; use a real browser fixture/server middleware for validation.

## Security Considerations

- Client validates the capability path as same-origin/expected image route and never trusts response body fields beyond the strict contract.
- Auth is sent only to the issue/revoke API; native <img> receives an opaque capability URL, not a bearer JWT.
- Stale/profile cleanup prevents an old capability from remaining attached after context changes; errors omit server response text, paths, tokens, and auth state.
- No SVG support avoids adding an active-document rendering surface in this first slice.

## Next steps

Once the UI is wired, add focused client/component/editor tests, real Chromium raster coverage, backend regression coverage, documentation updates, and the release gate in Phase 03.
