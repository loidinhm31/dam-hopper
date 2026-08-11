# Research Report: HTTP range streaming for Explorer video playback

Timestamp: 2026-08-10 (Asia/Ho_Chi_Minh)

## Executive summary

Use one authenticated `GET` endpoint serving a selected file with byte-range support. Browser media elements use random access; a 1–3 GB file must never be read into RAM or returned as an unbounded buffered body. Open the file, stat it, validate a single requested range, seek to the offset, and stream only that bounded interval with backpressure.

Implement single-range `Range: bytes=...` first, plus `Accept-Ranges: bytes`, `Content-Range`, exact `Content-Length`, `206`, `416`, `ETag`/`Last-Modified`, and `If-Range`. Multi-range (`multipart/byteranges`) is standards-supported but adds parsing, framing, and DoS surface; it is not needed for normal HTML5 video playback and can be rejected/ignored safely.

## Sources and facts

- [MDN: HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests): media players and large-file random access are primary use cases; single-range success is `206`, invalid/out-of-bounds is `416`; `If-Range` yields `206` when validator matches, otherwise `200`.
- [RFC 9110 §§13–14](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests): evaluate normal authorization/resource checks before preconditions; evaluate `If-Range` before `Range`; a false `If-Range` means ignore `Range`; `Content-Range` describes the selected representation; clients should avoid inefficient/many small ranges and servers may reject suspicious sets as DoS indicators.
- [MDN: 206 Partial Content](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/206): one range uses the resource media type and `Content-Range`; multiple ranges require `multipart/byteranges` and per-part headers.
- [axum `Body::from_stream`](https://docs.rs/axum/latest/axum/body/struct.Body.html): response bodies can be constructed from a `Stream`, avoiding whole-file buffering.
- [axum-extra `FileStream`](https://docs.rs/axum-extra/latest/axum_extra/response/struct.FileStream.html): provides a file-oriented streaming response and direct range support; inspect version/features before adopting.
- [axum-range](https://docs.rs/axum-range): `KnownSize<File>` uses async read + seek from start and emits ranged responses; possible implementation reference, not a reason to add a dependency without checking current project versions.

## Recommendation for DamHopper

1. Route path should identify a server-side project/file ID or validated relative path, never an arbitrary filesystem path. Resolve against the configured project root, canonicalize (or securely component-walk), and reject traversal, symlink escape, directories, unsupported extension/MIME, and files exceeding policy if needed. Re-check metadata after opening to reduce TOCTOU risk.
2. Reuse existing auth middleware and apply it before opening the file. Do not expose a public static-file route. Preserve existing `no_auth` development-only safeguards. Add authorization tests proving a token/session cannot read another project or a path outside roots.
3. `HEAD`/initial `GET` should return size, stable media MIME, `Accept-Ranges: bytes`, and a strong validator (e.g., size + mtime only if that is acceptable; hash is expensive for 3 GB). For `GET`, parse and cap to one range. Normalize suffix ranges and overflow with checked arithmetic. Return `416` plus `Content-Range: bytes */size` when unsatisfiable.
4. Stream bounded bytes using `tokio::fs::File`/`AsyncSeek` and an async stream or a vetted file-stream responder. Keep chunk buffers modest (64 KiB–1 MiB; benchmark). Do not `read_to_end`, `fs::read`, or create a `Vec` proportional to the video. Set `Content-Length` to range length and avoid compression/transcoding in this endpoint.
5. Let disconnect cancellation stop the stream and close the file. Avoid holding global locks while reading. Tokio/Hyper backpressure should be allowed to propagate; do not spawn an unconstrained producer or prefetch the whole file. Limit concurrent video streams/range size if local-server resource exhaustion is a concern.

## Trade-offs

**Manual single-range handler:** minimal dependency and clear security policy; requires careful RFC parsing and tests. **`axum-range`/`FileStream`:** less protocol code and likely correct seek/length behavior; verify API/version, auth integration, path handling, and whether its multi-range behavior matches policy. Recommended default: small project-local handler or vetted responder, single-range only.

Multi-range is unnecessary for the target UX. Supporting it may help unusual clients but requires multipart boundary generation, aggregate length calculation, and limits against many tiny/overlapping ranges. RFC 9110 explicitly permits rejecting suspicious sets. Start with one range and observe real browser requests.

## Performance, security, and test implications

- Cold-start latency: stat/open + first bounded chunk; no full-file scan. Seek cost is generally cheap on local disks but concurrent random seeks can contend; measure HDD/network mounts separately.
- Memory target: O(chunk size × active streams), independent of 1–3 GB file size. Test with RSS and concurrent streams; abort clients mid-range and ensure tasks/files terminate.
- Browser tests: initial play, seek forward/backward, pause/resume, reload, slow network, missing/unsupported MIME, and file mutation between requests (`If-Range`/validator behavior).
- HTTP tests: no `Range` (`200` policy), one open-ended/suffix/closed range (`206`), zero-byte file, overflow/negative/malformed/many ranges, `416`, `HEAD`, `If-None-Match`/`304` if implemented, auth failure, traversal/symlink escape, and disconnect cancellation. Use sparse/temp files (not real 3 GB fixtures) plus a bounded RSS/concurrency test.

## Unresolved questions

- Which existing Explorer API/path and auth extractor should the endpoint reuse?
- Are project roots allowed to contain symlinks, and is access intended to follow them?
- Minimum browser support and deployment storage types (local SSD vs network mount)?
- Should `200` without `Range` be allowed, or require a range to avoid accidental full 3 GB transfers?
- Need CORS/media credentials or download authorization distinct from normal API authorization?
