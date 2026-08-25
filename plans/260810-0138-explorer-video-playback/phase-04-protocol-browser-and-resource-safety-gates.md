# Phase 04 — Protocol, browser, and resource-safety gates

## Context links

- [HTTP validation recommendations](./research/researcher-01-http-range-streaming-report.md#performance-security-and-test-implications)
- [Browser acceptance targets](./research/researcher-02-browser-video-ux-report.md#acceptance-targets-and-regression-tests)
- [Playback/download architecture invariants](../../docs/system-architecture.md#explorer-video-playback-and-download-planned)
- [Repository test guidance](../../docs/codebase-summary.md#test-coverage)
- Existing seams: [API tests](/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs), [editor tests](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts), [browser suite](/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests), [UI scripts](/mnt/data/ws/sharing/dam-hopper/packages/ui/package.json)

## Overview

- Date: 2026-08-10
- Description: Block merge/release on deterministic protocol, purpose-isolation, no-Blob, cancellation, browser, and bounded-resource checks; report hardware-sensitive performance separately as advisory evidence.
- Priority: P2
- Effort: 10h
- Implementation status: Pending
- Review status: Validation decisions incorporated; pending test/release review

## Key Insights

- A runtime sparse 3 GiB file validates 64-bit offsets and bounded streaming without committing large media or consuming equivalent disk blocks.
- Sparse bytes are not playable. Real Chromium lifecycle needs one tiny valid VP8/WebM fixture separate from large-file protocol tests.
- Native download navigation has no reliable page completion callback. Tests should prove issue + anchor activation + immediate streamed response, not wait for a JavaScript completion signal.
- Hardware/cache/codec/network timings vary. Deterministic invariants can block release; latency and throughput observations cannot.

## Requirements

### Blocking unit and component checks

- Range parser covers closed/open/suffix, clamped end, zero/one-byte resources, duplicate/comma/multi-range, malformed numbers, whitespace policy, `u64::MAX`, overflow, and unsatisfiable cases.
- Ticket store covers both purposes, token uniqueness, 256 capacity, prune, exact 30-minute idle/8-hour absolute limits, touch cap, no live eviction, independent revoke/expiry, revoke-all, stale lookup, and generic unknown behavior.
- Classifier/tier covers exactly six extensions in mixed case, unsupported suffixes, dots in directories, and video-before-binary/large.
- Editor store proves open/hydrate/reload/reconcile/save of a 3 GiB candidate performs zero `fsRead`/write and persistence omits transient capability state.
- Ticket client/player covers purpose body/echo validation, profile origin/auth, relative path checks, abort/stale playback revoke, cleanup order, retry, MediaError mapping, and secret-safe errors.
- Direct-download helper covers separate download ticket, one temporary anchor click/removal, no playback handle reuse/revoke, no stream `fetch`, no `response.blob`, and no object URL.
- Non-video guard proves known >100 MiB rejects before fetch/blob and safe small non-video retains current behavior.

### Blocking server protocol and purpose matrix

- Use a real temp project/router. Authenticated cookie and Bearer can issue both purposes; unauthenticated issuance fails; opaque stream works without Authorization.
- Assert Phase 02 HEAD/200/206/416/If-Range/method/CORS matrix exactly for each purpose, including empty HEAD/416 bodies and correct content lengths.
- Assert playback always `inline`; download always sanitized ASCII + RFC 5987 attachment. Query/header attempts to switch purpose, disposition, or filename have no effect.
- Issue playback and download for one file; stream them concurrently, revoke/expire one, and prove the other response/ticket remains valid.
- Cover traversal, cross-project input, symlink escape, directory, unsupported extension/purpose, unknown/revoked/expired ticket, capacity, workspace switch, and resource replacement/drift.
- Captured tracing/diagnostics must contain no ticket, JWT, raw project path, canonical path, stream URL, or generated filename header.

### Blocking sparse 3 GiB, cancellation, and resource checks

- Create sparse 3 GiB temp files outside the repository with `set_len`; write sentinels near byte 0, 1 GiB, 2 GiB, and final MiB. Auto-clean tempdir.
- Request small ranges at each sentinel for both purposes and consume chunks incrementally. Never collect a full/large body or call unbounded `to_bytes`.
- Download `GET` must return headers and first body chunk before the rest is consumed; a throttled consumer proves response start does not wait for full read or completion.
- Cancellation test consumes one chunk then drops playback/download bodies; test-only drop instrumentation must settle within a generous deterministic timeout with no detached producer.
- Instrument the shared body in tests to cap read chunk size and active buffered bytes per stream. One/four concurrent sparse streams must stay proportional to fixed chunk/concurrency, not file or requested range length.
- Static/runtime frontend checks fail if recognized video invokes `fsRead`, `response.blob`, `URL.createObjectURL`, or an object URL. These deterministic no-Blob/resource checks block release.
- Optional RSS/heap sampling may supplement evidence but never replaces or destabilizes the blocking bounded-reader/cancellation assertions.

### Blocking Chromium/browser-host coverage

- Commit one ≤100 KiB, one-second, silent VP8/WebM fixture with source/generation command, license, and checksum note; commit no large fixture.
- Real Chromium test covers `loadedmetadata`, native controls, no autoplay, user play/playing, seek/seeked, pause/resume, and source cleanup.
- Delayed A→B issue/event test proves B remains active and stale A playback ticket is revoked.
- Network/decode/source-not-supported paths expose Retry + separate Download; no unhandled `play()` rejection or Blob fallback.
- Download test proves purpose=`download`, temporary anchor activation, and no JavaScript body consumption while playback remains mounted.
- At 320/375/desktop widths assert no horizontal overflow, controls/heading/status/actions remain usable, live status is polite, and keyboard focus is visible.
- Automated scope is Chromium using the shared UI as shipped by `apps/web`. Packaged Tauri/WebView/CSP is deferred and absent from v1 validation claims.

### Advisory performance report only

Use representative external 1–3 GB media on documented storage/network. Define cold as fresh app/server process and warm as reopen within 60 seconds. Record environment and raw samples; do not require privileged cache dropping.

| Observation | Reference target | Method |
|---|---:|---|
| Metadata | cold p95 ≤1,000 ms; warm ≤500 ms | `open` to `loadedmetadata`, 20 runs |
| First frame | cold p95 ≤2,000 ms; warm ≤1,000 ms | user play to first frame/`playing` |
| Seek 25/50/90% | cold p95 ≤2,000 ms; warm ≤1,000 ms | `seeking` to post-seek frame |
| Transfer | ≥80% direct sequential-read baseline | server bytes/time plus disk/network baseline |
| Pre-metadata bytes | Prefer ≤16 MiB; never infer correctness from amount | Chromium network events |
| RSS/JS heap | Stable, no monotonic growth | Report server/browser/decoder separately |

- Metadata, first-frame, seek, throughput, pre-metadata byte count, RSS, and heap numbers are advisory. Misses trigger profiling notes, not merge/release failure.
- Profile ticket issuance, first range, disk, CORS, network, and decoder separately before tuning chunk size or architecture.

## Architecture

```text
blocking: unit/component -> real router matrix -> sparse 3 GiB + cancellation
         -> Chromium browser-host playback/direct-download/no-Blob

advisory: representative external media -> environment + raw timing/throughput report

deferred: packaged Tauri/WebView/CSP verification
```

- Blocking checks are deterministic and own release correctness/resource claims.
- Advisory measurements characterize experience only; they cannot override a failed safety invariant or block an otherwise correct release.
- Split broad test matrices into focused files under 200 lines where practical instead of growing existing 3,500+ line API tests.

## Related code files

| Absolute path | Action | Change | Dependencies |
|---|---|---|---|
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/http_byte_range.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/http_byte_range.rs) | Modify | Exhaustive pure parser unit tests | Phase 02 parser |
| [/mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs](/mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs) | Modify | Purpose/lifecycle/capacity/independence unit tests | Phase 01 store |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs) | Modify | Minimal auth/router/CORS registration smoke tests only | Existing test state |
| [/mnt/data/ws/sharing/dam-hopper/server/tests/video_stream_protocol.rs](/mnt/data/ws/sharing/dam-hopper/server/tests/video_stream_protocol.rs) | Create | Exact status/header/If-Range/purpose/sandbox matrix | Phase 01–02 API |
| [/mnt/data/ws/sharing/dam-hopper/server/tests/video_stream_resources.rs](/mnt/data/ws/sharing/dam-hopper/server/tests/video_stream_resources.rs) | Create | Sparse 3 GiB sentinels, concurrent independence, first chunk, cancellation, bounded instrumentation | Shared stream core |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.test.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.test.ts) | Create | Exact extension/MIME/tier contract | Phase 03 classifier |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/video-tickets.test.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/video-tickets.test.ts) | Create | Purpose/profile/auth/abort/revoke/privacy tests | Phase 03 client |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/start-video-download.test.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/start-video-download.test.ts) | Create | Anchor activation, separate ticket, no fetch/blob/revoke | Phase 03 helper |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.test.ts) | Modify | Every video path skips read/write and persistence omits transient state | Phase 03 store |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/VideoPreview.test.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/VideoPreview.test.tsx) | Create | Lifecycle, stale events, independent Download, errors, accessibility | Phase 03 player |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-ops.test.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-ops.test.ts) | Create | Video direct path, large non-video prefetch guard, small Blob regression | Phase 03 hook |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/fixtures/one-second-vp8.webm](/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/fixtures/one-second-vp8.webm) | Create | Tiny valid licensed/checksummed browser media | Chromium test |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/explorer-video-playback-download.browser.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/explorer-video-playback-download.browser.tsx) | Create | Real Chromium playback, direct download, switching, error, responsive/a11y | Fixture; Phase 03 UI |

## Implementation Steps

1. Add focused unit tests beside each new module before route/component integration.
2. Keep only router-registration smoke in existing API tests; split protocol and resource matrices into dedicated integration files.
3. Build sparse-file helper with sentinel writes and tempdir cleanup; consume every response incrementally.
4. Assert both purpose matrices and manipulation resistance, then run concurrent playback/download with independent revoke/expiry.
5. Add first-chunk and drop guards around the shared reader under tests; assert fixed chunk/buffer bounds for one and four streams.
6. Add frontend tests that spy/fail on `fsRead`, stream fetch, blob, and object URL for every recognized video path.
7. Generate tiny WebM once; document source/license/checksum without committing generated large artifacts.
8. Add real Chromium player test plus deterministic ticket, anchor, stale-selection, failure, responsive, and accessibility branches.
9. Run blocking checks: Rust format/targeted/full tests, UI unit/browser tests, UI build/typecheck, lint, then repository `pnpm check`.
10. Optionally run representative-media observations and attach raw environment/sample report; do not turn values into pass/fail.

## Todo list

- [ ] Add parser/store/classifier/client/player/download unit coverage
- [ ] Add exact HTTP/auth/CORS/purpose-isolation matrix
- [ ] Add sparse 3 GiB sentinel and concurrent stream tests
- [ ] Prove response starts before download completion
- [ ] Prove cancellation and fixed-buffer resource bounds
- [ ] Prove recognized video never uses Blob/object URL/fsRead
- [ ] Add tiny licensed/checksummed WebM fixture
- [ ] Add Chromium browser-host playback/download/error/responsive coverage
- [ ] Run all deterministic blocking validation
- [ ] Record advisory timing/throughput evidence when environment permits

## Success Criteria

- Blocking validation proves exact protocol, sandbox/auth, purpose-fixed disposition, concurrent independent playback/download, cancellation, privacy, and no live-ticket eviction.
- Sparse 3 GiB tests pass with fixed per-stream buffers and no body collection proportional to file/range size.
- Download headers and first bytes arrive before completion; Chromium triggers native download without JavaScript Blob/body consumption while playback remains usable.
- Chromium decodes the tiny fixture and completes metadata/play/seek/cleanup with accessible native controls and visible error/download fallback.
- Advisory latency/seek/throughput results are reported honestly when collected but never determine pass/fail.
- No Tauri config, packaged-host claim, large fixture, ticket, credential, raw path, or media content enters validation artifacts.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Browser download manager is hard to observe in component test | False confidence | Assert issue + anchor + no JS body; server proves attachment/first chunk; Chromium owns real activation |
| Codec absent in CI Chromium | False failure | Use tiny VP8/WebM fixture verified in target Chromium; no MP4 codec claim |
| Sparse support varies | Portability issue | Semantic 64-bit offsets still use temp files; record explicit platform skip only if sparse creation unsupported |
| RSS timing flakes | Unstable release | Keep RSS advisory; deterministic buffer/drop instrumentation is blocking |
| Secret appears in failure output | Capability leakage | Synthetic canaries, sanitized match assertions, reporters never print currentSrc/request body |

## Security Considerations

- Tests use ephemeral synthetic tickets/tokens and never commit them to snapshots, fixture metadata, screenshots, or reports.
- Captured log/diagnostic assertions search canaries but sanitize failure output; browser failures never print `currentSrc`, Authorization, raw path, or ticket response.
- Purpose-manipulation tests verify server state is the only disposition authority.
- External benchmark media stays outside the repository; advisory reports include only non-sensitive environment, size, container, codec, and aggregate samples.

## Next steps

- After blocking gates pass, request review focused on Range arithmetic, purpose authorization, filename sanitization, capability lifetime, stale React effects, browser download navigation, CORS, and bounded-stream evidence.
- Defer packaged Tauri/CSP, thumbnails, custom controls, captions discovery, transcoding, MSE, HLS/DASH, multi-range, and generalized large non-video download until separately justified.

## Unresolved Questions

- None.
