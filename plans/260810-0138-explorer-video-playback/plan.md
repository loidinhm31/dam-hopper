---
title: "Explorer Browser Video Playback and Direct Download"
description: "Add low-latency native playback and direct streaming download for 1–3 GB Explorer videos without whole-file browser buffering."
status: completed
priority: P2
effort: 38h
branch: main
tags: [feature, frontend, backend, api, security]
created: 2026-08-10
---

# Explorer Browser Video Playback and Direct Download Plan

## Outcome

Explorer opens six recognized video containers in a native browser player and downloads them through the browser download manager. Playback and download use separate purpose-bound tickets over one bounded byte-stream core, run concurrently, and never require `fsRead`, base64, or multi-gigabyte `Blob` allocation.

## Architecture decision

- Authenticated `POST /api/fs/video/tickets` accepts server-validated `playback | download`; one memory-only ticket binds one purpose, resource version, and sandboxed path.
- Capability-only `GET|HEAD /api/fs/video/stream/{ticket}` revalidates the resource and uses checked single-range streaming with backpressure. Stored purpose fixes `inline` versus sanitized RFC 5987 `attachment`; clients cannot switch disposition.
- Extension-first routing recognizes only case-insensitive `.mp4`, `.m4v`, `.webm`, `.ogv`, `.ogg`, `.mov`. Playback uses `<video controls preload="metadata" playsInline>`; download activates a temporary anchor.
- V1 ships the browser host. Packaged Tauri/CSP support, transcoding, MSE, HLS/DASH, thumbnails, codec probing, custom controls, and multi-range remain deferred.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Purpose-bound ticket store and issuance | Completed | 100% | 7h | [phase-01](./phase-01-purpose-bound-ticket-store-and-issuance.md) |
| 2 | Shared Range stream and response policy | Completed | 100% | 11h | [phase-02](./phase-02-shared-range-stream-and-response-policy.md) |
| 3 | Explorer browser playback and direct-download UX | Completed | 100% | 10h | [phase-03](./phase-03-explorer-browser-playback-and-direct-download-ux.md) |
| 4 | Protocol, browser, and resource-safety gates | Completed | 100% | 10h | [phase-04](./phase-04-protocol-browser-and-resource-safety-gates.md) |

## Dependencies

- Existing `ProjectSandbox`, Axum/Tokio/Hyper streaming, profile-scoped auth, Zustand editor tabs, FileTree download action, and Chromium browser-test harness.
- [HTTP range research](./research/researcher-01-http-range-streaming-report.md), [browser UX research](./research/researcher-02-browser-video-ux-report.md), and [recorded architecture](../../docs/system-architecture.md#explorer-video-playback-and-download-planned).
- One tiny valid VP8/WebM browser fixture; runtime sparse 3 GiB files for protocol/resource tests; no committed large media.

## Delivery constraints

- Ticket policy is fixed: 256 live tickets, 30-minute idle expiry, 8-hour absolute lifetime, no eviction of live tickets. Download completion is not observable, so expiry is authoritative.
- Keep focused Rust/TypeScript modules under 200 lines where practical. Reuse one byte-stream implementation; do not duplicate playback/download readers or add a range/media framework.
- Source/download URLs remain memory-only. Recognized video download never uses `fetch().blob()`; known large unsupported non-video fails before Blob allocation while safe small non-video behavior stays unchanged.
- Deterministic protocol, sandbox, purpose isolation, cancellation, no-Blob, and bounded-memory/resource-safety checks block merge/release. Latency, first-frame, seek, and throughput measurements are advisory evidence only.

## Validation Summary

**Revalidated:** 2026-08-10 15:25:44 +07:00 — Phases 1–4 implementation and focused validation complete; browser-host scope validated. `pnpm check` remains blocked by missing `TAURI_SIGNING_PRIVATE_KEY`. Final reviewer noted the stale-ticket Chromium assertion accepts any `DELETE`; this caveat was reviewed and approved by the user.

## Action Items

- [x] Implement Phase 01 purpose-bound ticket store and issuance.
- [x] Implement Phase 02 shared Range stream and response policy.
- [x] Implement Phase 03 Explorer browser playback and direct-download UX.
- [x] Implement Phase 04 protocol, browser, and resource-safety gates.
- [x] Keep Tauri support and performance tuning as separately justified follow-ups, not v1 release claims.

## Unresolved questions

- None.
