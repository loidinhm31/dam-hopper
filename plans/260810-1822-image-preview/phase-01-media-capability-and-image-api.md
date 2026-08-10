# Phase 01 — Media capability and image API

## Context links

- Existing video contract: /mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_response.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_headers.rs.
- State/routes: /mnt/data/ws/sharing/dam-hopper/server/src/state.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs, /mnt/data/ws/sharing/dam-hopper/server/src/fs/sandbox.rs.
- Architecture baseline: /mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md (read-only during this planning turn).

## Overview

- **Priority:** P2; backend security boundary and compatibility foundation.
- **Status:** Complete.
- **Goal:** extract shared ticket/stream mechanics, add a closed image adapter, and leave the shipped video API observably unchanged.

## Key Insights

- Current video tickets bind canonical path, project-relative path, MIME, filename, size, mtime, and platform identity; lookup refreshes idle TTL and rejects drift with 410.
- ProjectSandbox and the no-follow regular-file open are the security boundary. /api/fs/read is buffered and is not an image-serving primitive.
- The existing stream supports GET|HEAD, one byte range, If-Range, bounded ReaderStream, inline/attachment disposition, and browser-exposed CORS headers.
- A shared internal primitive must not make public video callers accept image kinds or new purposes.

## Requirements

- Add POST /api/fs/image/tickets behind normal auth. Accept only { project, path }, resolve through the sandbox, require a regular file, and allow only final case-insensitive .png, .jpg, .jpeg, .gif, .webp extensions.
- Map the closed extensions to image/png, image/jpeg, image/gif, and image/webp; reject SVG, AVIF, BMP, TIFF, unknown extensions, traversal, symlinks/FIFOs, and directories without leaking path details.
- Return 201, Cache-Control: no-store, opaque ticket, /api/fs/image/stream/{ticket}, expiry, and fixed purpose: "preview".
- Add authenticated idempotent DELETE /api/fs/image/tickets with { ticket } and capability-only GET|HEAD /api/fs/image/stream/{ticket}.
- Preserve the video request/response shapes, /api/fs/video/* routes, video purpose isolation, existing status/error behavior, TTLs, revoke/generation semantics, and CORS policy.
- Image stream responses are always inline, expose the image MIME, use private, no-store, and retain existing range/HEAD/ETag/Last-Modified/backpressure rules.

## Architecture / data flow

1. Extract token generation, file-version metadata, idle/absolute expiry, shared capacity, lookup-touch, revoke, and generation checks into an internal MediaTicketStore in server/src/fs/media_ticket.rs.
2. Keep video_ticket.rs as a compatibility adapter (names, enum values, allowlist, and video capacity response remain stable). Add an image adapter with a single preview purpose. Both adapters share the same store/generation and cap.
3. Extract revalidated file opening, range parsing, HEAD behavior, bounded body streaming, and common validators/headers into internal media stream modules. Video remains a thin adapter that preserves attachment behavior; image passes an inline-only policy.
4. On an authenticated issue request: acquire the existing read guard, snapshot generation, resolve sandbox path, open no-follow regular file, capture metadata, issue a kind-bound opaque ticket, and return only the capability URL.
5. On an unauthenticated stream request: lookup the expected kind, re-resolve and re-open the canonical path, compare size/mtime/platform identity, revoke on drift, then stream with no auth token, path, or file bytes in the URL.
6. Wire image protected routes and image capability stream routes beside video routes. Workspace/config/settings invalidation revokes the shared store once and advances generation.

## Related code files

**Modify**

- /mnt/data/ws/sharing/dam-hopper/server/src/state.rs — own shared media tickets and preserve video adapter access.
- /mnt/data/ws/sharing/dam-hopper/server/src/fs/mod.rs — export shared/image types while retaining video exports.
- /mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs — adapt to shared internals without changing public video semantics.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs — register image and shared stream modules.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs — add protected image ticket routes and capability image stream routes.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs — delegate to shared primitives while preserving the video contract.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_response.rs and /mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_headers.rs — become compatibility adapters over shared streaming.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/workspace.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/config.rs, /mnt/data/ws/sharing/dam-hopper/server/src/api/settings.rs — revoke the shared generation on context reloads.

**Create**

- /mnt/data/ws/sharing/dam-hopper/server/src/fs/media_ticket.rs — shared ticket store, version record, TTL/capacity/generation lifecycle, and unit tests.
- /mnt/data/ws/sharing/dam-hopper/server/src/fs/image_ticket.rs — image allowlist, preview record/adapter, and image-specific capacity mapping.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/fs_image.rs — image issue/revoke handlers and stream adapter.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/media_stream_response.rs — shared revalidation/range/body response core.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/media_stream_headers.rs — shared validators, inline policy, and safe header construction.

**Delete:** none. Do not remove or rename existing video modules in this slice.

## Implementation Steps

1. Write characterization tests around current video ticket and stream behavior before extraction; keep response/status/header snapshots explicit.
2. Move only mechanics that are media-agnostic. Preserve video adapter names and make all kind/purpose checks explicit at the adapter boundary.
3. Add image records with fixed MIME mapping and preview-only purpose; never accept caller-supplied MIME or purpose.
4. Add routes and shared-state revocation wiring. Verify revocation is called once per context change and does not leave stale image or video tickets alive.
5. Run focused Rust tests and compare video route responses before handing the phase to frontend work.

## Todo

- [x] Extract shared ticket lifecycle with deterministic clock tests.
- [x] Add image allowlist, fixed MIME, issue/revoke handlers, and routes.
- [x] Extract shared stream core and retain video adapter compatibility.
- [x] Add auth, sandbox, regular-file, stale, range, HEAD, CORS, capacity, and generation coverage.
- [x] Confirm no ticket/path/auth data enters logs or response bodies.

## Success Criteria

- Image issue works only for the four formats and returns a strict opaque preview capability.
- Image GET|HEAD streams inline with existing bounded range/validator behavior; invalid, stale, or revoked capabilities fail closed.
- Existing video tests and /api/fs/video/* contract assertions pass unchanged or with only internal helper relocation.
- Workspace/config/settings changes invalidate both media kinds without a generation race.

## Risk Assessment

- **Extraction drift:** video behavior changes silently. Mitigate with characterization tests and adapter-level contract assertions.
- **Shared-capacity coupling:** image previews can consume video capacity. Document the shared 256 cap and test both adapters; revisit only with measured demand.
- **Header regressions:** image inline policy could accidentally expose attachment semantics. Use a kind/purpose policy object and assert headers per route.
- **TOCTOU/FIFO exposure:** reuse the existing no-follow open and metadata revalidation; do not simplify it during extraction.

## Security Considerations

- Authenticate issuance and revoke; stream URLs are bearer capabilities with random URL-safe tokens, short idle TTL, absolute expiry, and no persistent storage.
- Bind ticket to project/path/version/kind; re-check sandbox, regular-file status, canonical identity, size, mtime, device, and inode before bytes leave.
- Keep browser URL free of JWT, absolute path, project name, and file content. Keep errors generic and do not return server response text.
- Preserve CORS allowlist/credential behavior and expose only existing media headers needed by native browser requests.

## Next steps

After focused backend tests pass, implement the client ticket contract, image component, and editor routing in Phase 02. Architecture/API docs are deliberately deferred to Phase 03 implementation and are not edited by this plan-creation turn.
