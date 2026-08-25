---
title: "Explorer image preview"
description: "Add direct native image preview with authenticated opaque capabilities and shared media streaming primitives."
status: complete
priority: P2
effort: 3d
branch: main
tags: [feature, frontend, backend, api, auth]
created: 2026-08-10
---

# Explorer image preview

## Outcome

Open PNG, JPG/JPEG, GIF, and WebP Explorer files in a native <img> preview without fsRead, Blob allocation, or object URLs. Keep /api/fs/video/* behavior unchanged.

## Preflight contract

- **Output:** authenticated image-ticket API, capability-only image stream, image tab tier/component, tests, and implementation-time architecture/API/frontend docs updates.
- **Acceptance:** direct inline rendering; strict four-format allowlist; sandbox/regular-file/version revalidation; TTL/revoke/generation/CORS parity; safe retry/stale/profile cleanup; required unit, Rust, and Chromium gates pass.
- **Scope:** preview only. No image download, SVG/AVIF/BMP/TIFF support, thumbnails, transforms, or byte materialization.
- **Risks/public contracts:** new /api/fs/image/* contract, shared ticket capacity/state, CORS, auth boundary, and persisted editor-tab routing; existing video wire behavior is compatibility-gated.
- **Affected systems:** server media capabilities/streaming/router/state; packages/ui tier/store/tabs/ticket client/preview; tests and docs.
- **Testing:** focused Vitest, Rust unit/integration, Chromium with a real raster fixture, then repository release checks.

## Trade-off gate

- **A — generic public media API:** lowest duplication long term, but expands and risks changing the shipped video contract.
- **B — duplicate image implementation:** fastest locally, but repeats ticket, sandbox, revalidation, range, and header security logic.
- **C — shared internal media primitive + separate public adapters (recommended):** extracts lifecycle mechanics while keeping video/image routes, purposes, and compatibility boundaries explicit.

## Phases

| # | Phase | Status | Depends on | Link |
|---|---|---|---|---|
| 1 | Media capability and image API | Complete | None | [phase-01](./phase-01-media-capability-and-image-api.md) |
| 2 | Image preview and editor routing | Complete | Phase 1 | [phase-02](./phase-02-image-preview-and-editor-routing.md) |
| 3 | Tests, docs, and release gate | Complete | Phases 1–2 | [phase-03](./phase-03-tests-docs-and-release-gate.md) |

## Side-effect review checklist

- **Auth/session/permissions:** issuance remains protected; stream is opaque capability-only; no JWT/path in URL.
- **API compatibility:** preserve video routes, payloads, purposes, status codes, headers, and capacity error behavior.
- **Data/schema:** no database or persistent-storage changes; in-memory generation invalidates workspace/config context.
- **Business meaning:** preview-only image action; no download affordance or hidden fallback.
- **Security/privacy:** closed extension/MIME policy, sandbox/open checks, metadata binding, safe errors, no sensitive logs.
- **Performance/concurrency:** native range requests, bounded streaming, no full-file memory, no locks held while streaming.
- **Docs/config/deploy:** update architecture/API/frontend/roadmap docs during implementation; no new config or deployment dependency.

## Assumptions / unresolved questions

- Image issue request is { project, path }; response includes fixed purpose: "preview"; DELETE revoke remains authenticated. No blocking questions.
- One shared in-memory 256-ticket capacity and generation is recommended; video keeps its existing response code/text, while image gets image-specific capacity reporting.
- No additional image-size cap in this slice; native browser decode failure is a safe, retryable UI error. Revisit only if release testing exposes a resource concern.
