# Phase 03 — Tests, docs, and release gate

## Context links

- Existing Rust coverage: /mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs video ticket/stream tests and shared make_state_with_project helpers.
- Existing browser harness: /mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/explorer-video-playback-download.browser.tsx, /mnt/data/ws/sharing/dam-hopper/packages/ui/vitest.browser.config.ts, and packages/ui/browser-tests/fixtures/one-second-vp8.webm.
- Documentation targets: /mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md, /mnt/data/ws/sharing/dam-hopper/docs/api-reference.md, /mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md, /mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md.

## Overview

- **Priority:** P2; release confidence and implementation handoff.
- **Status:** Complete; depends on backend and frontend phases.
- **Goal:** prove security/compatibility/lifecycle behavior, document the shipped design, and apply repository quality gates without weakening unrelated worktree changes.

## Key Insights

- Video already has focused Rust range/stale/CORS tests and a browser-host fixture plugin; image coverage should extend the same observable contracts, not duplicate unbounded infrastructure.
- A real raster fixture is required because jsdom cannot validate native image decode or direct browser media requests.
- Documentation must distinguish image preview from video playback/download and state that the public video contract remains unchanged.

## Requirements

### Client and component tests

- Add image-file.test.ts for case-insensitive final-extension allowlisting, MIME mapping, dotfiles, path names, and all excluded formats.
- Add image-tickets.test.ts for strict response/path/purpose validation, auth snapshot, profile-origin revoke, timeout/abort, fixed status errors, and response-body non-leakage.
- Add ImagePreview.test.tsx for direct img.src, alt, loading/ready/error states, retry, stale issue resolution, profile change, unmount cleanup/revoke, generic safe errors, and spies proving no Blob/object URL use.
- Extend editor.test.ts (and the existing tier/helper tests) to prove large images bypass fsRead, preview-only persistence/reload/reconciliation, diff preservation, and excluded formats remain generic.

### Rust tests

- Add shared-store unit tests for expiry, absolute deadline, capacity, token uniqueness, lookup touch, revoke, generation mismatch, and shared image/video invalidation.
- Extend server/src/api/tests.rs for image auth issuance/revoke, unsupported formats, traversal/sandbox escape, symlink/FIFO/directory rejection, fixed MIME/inline disposition, opaque response, one-range/invalid-range, HEAD-with-range ignored, stale replacement 410, unknown/revoked 404, CORS exposure, and workspace/config/settings revocation.
- Keep the full existing video ticket/stream suite green, including response/status/header/capacity compatibility assertions.

### Chromium and release checks

- Create a small real raster fixture at packages/ui/browser-tests/fixtures/one-pixel.png (or equivalent checked-in PNG) and add image ticket/stream middleware to the browser config without changing video fixture behavior.
- Add explorer-image-preview.browser.tsx: assert actual naturalWidth/naturalHeight, inline capability URL, no autoplay/download UI, no Response.blob()/URL.createObjectURL, retry/error cleanup, stale ticket protection, profile refresh, and narrow viewport layout.
- Run focused tests first, then formatting/typecheck/build/check commands. Record any environment-only native signing limitation without changing config or skipping relevant image gates.

### Documentation deliverables during implementation

- Update docs/system-architecture.md with shared media core, separate image/video adapters, data flow, invariants, image routes, and no-buffering lifecycle.
- Update docs/api-reference.md with image issue/revoke/stream payloads, auth/capability boundaries, statuses, headers, range/HEAD semantics, and allowlist.
- Update docs/frontend-components.md with image tier routing and ImagePreview lifecycle/accessibility behavior.
- Update docs/project-roadmap.md with the image-preview milestone and validation caveats.

## Architecture / data flow

1. Client unit/component tests validate contracts locally; Rust tests validate sandbox/capability/stream behavior independently of a browser.
2. Chromium serves a real raster file through the image capability path, so native <img> performs the request and decode. Browser assertions observe rendered pixels/metadata and lifecycle cleanup.
3. Documentation mirrors the final implementation: image is preview-only and inline; video remains playback/download with its existing public paths and purposes.
4. Release gate runs with existing unrelated worktree modifications preserved; no generated screenshots, logs, dependencies, or environment secrets are added.

## Related code files

**Modify**

- /mnt/data/ws/sharing/dam-hopper/server/src/fs/media_ticket.rs — shared lifecycle unit tests.
- /mnt/data/ws/sharing/dam-hopper/server/src/fs/image_ticket.rs — image allowlist/adapter tests.
- /mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs — authenticated API, stream, revalidation, CORS, and revocation integration tests.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts — image preview-only editor guards.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.test.ts — shared tier regression assertions if tier tests remain here.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/vitest.browser.config.ts — real image fixture middleware and ticket allowlist.
- /mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md — architecture/data-flow/invariant documentation.
- /mnt/data/ws/sharing/dam-hopper/docs/api-reference.md — public image API reference.
- /mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md — frontend routing/lifecycle documentation.
- /mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md — milestone/status entry.

**Create**

- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/image-file.test.ts — helper and tier allowlist tests.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/image-tickets.test.ts — client contract/lifecycle tests.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ImagePreview.test.tsx — component lifecycle/error tests.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/explorer-image-preview.browser.tsx — Chromium raster preview regression.
- /mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/fixtures/one-pixel.png — checked-in real raster fixture.

**Delete:** none. Do not commit generated browser screenshots, logs, local environment files, or unrelated worktree artifacts.

## Implementation Steps

1. Add unit tests and Rust integration cases alongside each contract before broad release checks.
2. Add the real PNG fixture and browser middleware/test; assert native rendering rather than simulating image bytes in JavaScript.
3. Run focused Vitest, UI build/typecheck, Rust format/check/tests, and Chromium tests. Use repository commands from AGENTS.md; do not rewrite unrelated failures.
4. Run pnpm check as the broad gate where environment permits. If native signing or unrelated baseline issues block it, report the exact command and preserve the focused gates.
5. Review the diff for compatibility, security, performance, YAGNI/KISS/DRY, docs accuracy, generated artifacts, and secrets before implementation handoff is considered complete.

## Todo

- [x] Add client/helper/component/editor tests.
- [x] Add Rust shared-store and image API/stream/security tests.
- [x] Add real raster fixture and Chromium no-Blob/object-URL/lifecycle coverage.
- [x] Update architecture, API, frontend, and roadmap docs during implementation.
- [x] Run focused and broad release gates; record environment blockers only.
- [x] Perform final compatibility/security review with video regressions green.

## Validation evidence

- Full Rust suite: **655 passed, 0 failed, 2 ignored**; `cargo fmt --check` passed.
- Focused Rust image tests: **9 passed**; shared media-ticket tests: **6 passed**.
- UI unit tests: **958 passed**; UI build and `pnpm lint` passed.
- Chromium browser suite: **106 passed** across 25 files, including the checked-in 1×1 RGB PNG fixture and authenticated image ticket/stream lifecycle coverage.
- `pnpm check`: web/native builds and bundling completed, then the gate stopped only because `TAURI_SIGNING_PRIVATE_KEY` is unset while a public signing key is configured. Signing configuration was not changed.
- Final review: no Critical, High, or Medium findings; video compatibility, sandboxing, capability revocation, range/HEAD behavior, CORS, and bounded streaming were reviewed as green.

## Handoff record

- Parent plan status changed from `pending` to `complete` in `plans/260810-1822-image-preview/plan.md`.
- Phase 03 status changed from `Pending` to `Complete`, all six Phase 03 todos were checked, and this validation record was added in `plans/260810-1822-image-preview/phase-03-tests-docs-and-release-gate.md`.
- The PM handoff changed only those two plan files. Source, documentation, unrelated plan directories, and generated artifacts were not touched during this handoff.

## Success Criteria

- All confirmed image formats render through native <img> in Chromium from a capability URL; excluded formats do not route to image preview.
- Rust tests prove auth, sandbox, regular-file, metadata, range/HEAD, CORS, revocation, generation, and stale behavior.
- Client/component tests prove no byte materialization, robust cleanup, stale/profile safety, and generic errors.
- Video tests and public behavior remain green; docs accurately describe both media contracts.
- No non-plan files are touched during this planning turn; implementation changes are made only in a later approved /code handoff.

## Risk Assessment

- **Flaky native decode:** use a deterministic small PNG and wait on load/intrinsic dimensions, not arbitrary sleeps.
- **Test middleware masks production behavior:** keep Rust route tests authoritative and assert browser uses the exact public image paths.
- **Broad check blocked by environment:** preserve focused release evidence and report the blocker; never edit signing/config files to force green.
- **Documentation drift:** update architecture/API/frontend docs in the same implementation change and review route names against tests.

## Security Considerations

- Test both protected issuance and capability-only stream access; ensure missing/invalid auth cannot issue image capabilities.
- Assert no response body, URL, logs, or fixed client error contains token, absolute path, project name, JWT, or server canary text.
- Assert stale replacement revokes the capability and prevents subsequent access; test context generation invalidation for image and video.
- Keep CORS assertions limited to the configured origin/header policy; do not broaden origins or credential behavior for image support.

## Next steps

Phase 03 is complete and handed off. The image-preview implementation and its documented validation evidence are ready for release follow-up; the only incomplete broad-gate item is environment-owned native signing configuration.

## Unresolved Questions

- None blocking. The plan assumes a fixed preview response purpose, shared 256-ticket capacity/generation, and no additional image-size cap for v1; revise only with evidence or an explicit product decision.
