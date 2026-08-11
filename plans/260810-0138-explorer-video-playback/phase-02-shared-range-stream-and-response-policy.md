# Phase 02 — Shared Range stream and response policy

## Context links

- [HTTP range research](./research/researcher-01-http-range-streaming-report.md)
- [Recorded playback/download stream contract](../../docs/system-architecture.md#explorer-video-playback-and-download-planned)
- [Code standards: async, locking, security](../../docs/code-standards.md)
- [Project PDR: REST authentication and CORS](../../docs/project-overview-pdr.md#pr-006-rest-api--authentication)
- Existing seams: [filesystem download/read](/mnt/data/ws/sharing/dam-hopper/server/src/api/fs.rs), [router/CORS](/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs), [buffering read helper](/mnt/data/ws/sharing/dam-hopper/server/src/fs/ops.rs), [sandbox](/mnt/data/ws/sharing/dam-hopper/server/src/fs/sandbox.rs)

## Overview

- Date: 2026-08-10
- Description: Serve both ticket purposes through one exact GET/HEAD single-range implementation while fixing response disposition from immutable server policy.
- Priority: P2
- Effort: 11h
- Implementation status: Completed — 2026-08-10
- Review status: Approved — implementation and focused API validation complete; Phase 04 resource-safety gates remain pending

## Key Insights

- Existing `ops::read_file()` allocates a response-sized `Vec`; neither playback nor direct video download may use it.
- Existing download proves `ReaderStream` integration. One shared seek/take body factory prevents drift between inline and attachment paths.
- `Content-Disposition` is security policy. Derive it only from stored purpose and a server-derived filename; no query/header can select it.
- Single range satisfies native media seeking and reduces parser/DoS surface. `HEAD` remains metadata-only and ignores Range.

## Requirements

### Exact status and header matrix

| Request | Preconditions | Status | Body and headers for both purposes |
|---|---|---:|---|
| `HEAD` | Valid ticket/resource; ignore any `Range`/`If-Range` | 200 | Empty body; full `Content-Length`; common headers; purpose-fixed disposition |
| `GET` | No `Range` | 200 | Full representation via bounded stream; common headers; purpose-fixed disposition |
| `GET` | Valid single range; no `If-Range` or validator matches | 206 | Exact bounded bytes; common headers + `Content-Range: bytes start-end/size` |
| `GET` | Valid single range; `If-Range` mismatches/invalid | 200 | Ignore Range; full bounded stream; common headers |
| `GET` | Malformed/overflow/zero suffix/duplicate/multi-range/unsatisfiable | 416 | Empty body; `Content-Length: 0`; `Content-Range: bytes */size`; `Accept-Ranges`, validators, cache policy; no `Content-Type` or `Content-Disposition` |
| `GET|HEAD` | Unknown, expired, or revoked ticket | 404 | Same generic capability-not-found shape; no file metadata or purpose |
| `GET|HEAD` | Canonical path or bound file version drift | 410 | Revoke only this ticket; empty generic stale-resource response |
| Unsupported method | Any ticket | 405 | Router-generated method response; no filesystem access |
| `OPTIONS` | Allowed browser-origin preflight | CORS layer | Permit needed methods/headers; expose media response headers |

Common `200/206/HEAD` headers: `Accept-Ranges: bytes`, server-derived media `Content-Type`, exact `Content-Length`, strong opaque `ETag`, `Last-Modified`, and `Cache-Control: private, no-store`. Disposition matrix is fixed: playback → `Content-Disposition: inline`; download → sanitized `attachment; filename="ASCII-fallback"; filename*=UTF-8''percent-encoded` per RFC 5987. `206` adds `Content-Range`. `416` is the exact error row above and omits filename/disposition.

### Purpose-controlled response policy

- Read purpose only from `VideoTicketRecord`; never accept `purpose`, `download`, `disposition`, or filename query parameters/headers on the stream endpoint.
- Playback and download call the same revalidation, Range parser, validator evaluator, seek/take reader, backpressure, and cancellation code.
- Derive download filename from the bound file basename. Strip path separators/control characters, replace unsafe ASCII fallback characters, quote safely, and percent-encode UTF-8 bytes for `filename*`; header construction must be fallible and panic-free.
- Playback never waits on or observes a download response. Separate tickets create separate file handles/bodies and can run simultaneously.

### Range, validators, and streaming

- Accept exactly one `Range: bytes=...` value in closed, open-ended, or suffix form. Reject duplicates and commas.
- Use `u64` checked parsing/arithmetic; clamp end to `size - 1`; reject `start >= size`, `start > end`, suffix `0`, empty-file ranges, and overflow.
- Emit per-ticket opaque strong ETag. Exact strong ETag or valid HTTP date may satisfy `If-Range`; invalid/mismatch means `200`, while malformed Range remains `416`.
- Do not add `304` caching semantics in v1. Validators exist for `If-Range` and continuity under `no-store`.
- Lookup/touch ticket, clone record, and release store lock. Re-resolve through current `ProjectSandbox`, compare canonical path, open file, then compare metadata from the open handle.
- Seek with `AsyncSeekExt`; use `file.take(response_len)`, `ReaderStream::with_capacity(..., 128 KiB)`, and `Body::from_stream` for both purposes.
- No response-sized allocation, producer task, prefetch queue, compression, or media transform. Hyper demand supplies backpressure; body drop closes reader/file.

### CORS and browser profile support

- Allow `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since` alongside current auth/content headers.
- Expose `Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Disposition`, `ETag`, and `Last-Modified`.
- Preserve configured origin/credential policy. Ticket issue/revoke needs normal auth; capability stream requires no cookie or Authorization.
- Browser anchor navigation relies on server attachment policy, not JavaScript access to response bytes.

## Architecture

```text
GET|HEAD /api/fs/video/stream/{ticket}
  -> lookup/touch { purpose, bound version } -> release ticket lock
  -> sandbox resolve -> canonical equality -> open -> handle version equality
  -> one HTTP policy path: HEAD | 200 | 206 | 416 | If-Range
  -> disposition(purpose) + shared seek/take/128 KiB ReaderStream
  -> independent consumer-driven body; disconnect cancels
```

- `http_byte_range.rs` owns pure checked normalization only.
- `video_stream_response.rs` owns shared revalidation/body/header helpers if `fs_video.rs` would exceed 200 lines; handlers remain thin.
- Add only direct `httpdate` if needed for standards-correct HTTP dates. No `axum-range`, multipart, download-specific stream, or media framework.

## Related code files

| Absolute path | Action | Change | Dependencies |
|---|---|---|---|
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/http_byte_range.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/http_byte_range.rs) | Create | Pure checked single-range parser and normalized inclusive bounds | None |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_response.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/video_stream_response.rs) | Create | Shared purpose policy, RFC 5987 filename, validators, revalidation, bounded body; keeps handler focused | Phase 01 record; parser; Tokio |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs) | Modify | GET/HEAD handler orchestration over shared response implementation | Phase 01; parser/response helper |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs) | Modify | Register private parser/response modules | New modules |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs) | Modify | Register capability route outside normal auth; extend CORS allow/expose contract | Stream handler |
| [/mnt/data/ws/sharing/dam-hopper/server/Cargo.toml](/mnt/data/ws/sharing/dam-hopper/server/Cargo.toml) | Modify | Declare locked `httpdate` directly only if required; add no range/media crate | HTTP validator dates |

## Implementation Steps

1. Implement and exhaustively unit-test `ByteRange { start, end, len }`, including empty files and checked-overflow branches.
2. Read all Range header instances; normalize only GET and return deterministic `416` for duplicate/comma/malformed/unsatisfiable input.
3. Implement `If-Range` exact strong-tag/date evaluation independently from Range parsing.
4. Implement safe filename helpers over UTF-8 bytes: sanitized ASCII fallback plus RFC 5987 encoding; reject/control-replace invalid header content.
5. Create one common-header builder whose only disposition input is the stored purpose enum.
6. Revalidate in fixed order: opaque lookup/touch, sandbox resolve, canonical equality, open, handle metadata equality. Revoke the current ticket on drift.
7. Build one bounded body factory for full/range responses with async seek + take + 128 KiB `ReaderStream`; use it unchanged for both purposes.
8. Implement HEAD over the same metadata/header path with no body and ignored Range; implement exact 200/206/416 matrix.
9. Register the ticket-authorized stream route separately from public static content and extend CORS allow/expose headers.
10. Add Phase 04 protocol, purpose-isolation, concurrency, cancellation, and first-chunk tests before marking complete.

## Todo list

- [x] Implement checked single-range parser
- [x] Implement strong validators and `If-Range`
- [x] Implement purpose-fixed inline/attachment header policy
- [x] Sanitize ASCII fallback and RFC 5987 UTF-8 filename
- [x] Revalidate sandbox, canonical identity, and open-handle version
- [x] Reuse one bounded reader for both purposes
- [x] Implement exact HEAD/200/206/416 matrix
- [x] Extend browser CORS allow/expose contract
- [ ] Prove drop cancellation and no response-sized allocation

## Success Criteria

- Every matrix row returns exact status, body length, validators, Range headers, and purpose-correct disposition for zero-byte, small, and sparse 3 GiB resources.
- Playback ticket always yields `inline`; download ticket always yields sanitized attachment; query/header manipulation cannot switch either.
- Concurrent playback and download use independent bodies and lifecycle while sharing identical checked range/revalidation logic.
- End-of-file sparse ranges return only requested bytes with no overflow or response-sized allocation; slow consumers control read progress.
- Disconnect drops the reader/file without detached work; changed resources cannot continue a later request under the old ticket.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Range off-by-one/overflow | Wrong bytes, panic, memory risk | Pure checked parser, boundary matrix, exact take length |
| Filename header injection | Response splitting or unsafe name | Server basename only, control/path stripping, validated HeaderValue, RFC 5987 byte encoding |
| Policy duplication drifts | Playback/download security mismatch | One header/body implementation keyed by closed purpose enum |
| Slow client holds descriptor | Resource pressure | Backpressure, cancellation-by-drop, bounded tickets, deterministic concurrency tests |
| Cross-origin headers unavailable | Browser playback errors | Explicit browser CORS preflight/exposure tests; no Tauri CSP scope in v1 |

## Security Considerations

- Capability route is ticket-authorized, not public static content; it offers no listing, path input, redirects, or disposition override.
- Ticket and sandbox checks precede metadata. Generic unknown ticket reveals neither purpose, filename, MIME, nor size.
- Never log ticket, URI, Range value, JWT, project path, canonical path, or generated disposition. Metrics use fixed labels only.
- Reject multi-range to avoid multipart amplification and many-small-range complexity.
- `private, no-store` limits capability-backed caching; sanitized attachment behavior comes from immutable server state.

## Next steps

- Phase 03 uses purpose-aware ticket handles: native `<video>` receives playback URL; temporary browser anchor receives a separately issued download URL.

## Unresolved Questions

- Phase 04 must add the blocking cancellation, bounded-resource, and no-response-sized-allocation evidence; these are not claimed complete here.
