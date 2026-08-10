# Browser video UX research: Explorer panel

**Conducted:** 2026-08-10 (Asia/Ho_Chi_Minh)
**Scope:** React 19/Vite Explorer playback, 1–3 GB local files, low-latency perceived UX.

## Executive recommendation

For MVP, use the browser's native `<video>` pipeline backed by an authenticated HTTP URL and byte-range responses. Do not download a 1–3 GB file into a `Blob` or build MSE/HLS/transcoding first. Range playback lets the browser fetch metadata/nearby byte windows and seek without materializing the entire file; MDN explicitly identifies range requests as useful for media players with random access. Require `Accept-Ranges: bytes`, correct `206`/`Content-Range`, stable `Content-Length`, `Content-Type`, and cache validators (`ETag`/`Last-Modified`). [MDN HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)

Prefer broadly compatible MP4 containing H.264/AVC + AAC; MDN calls this combination supported by every major browser. Accept extension as a hint only: container support does not guarantee codec support. [MDN video codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs), [MDN containers](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers)

## Findings and design implications

### Source and large-file strategy

* Use a direct media URL (or short-lived signed URL) so the media element can issue its own range requests. If auth is cookie-based, ensure same-origin credentials and CSRF policy; if token-based, avoid putting long-lived secrets in query strings and confirm the browser/media request can send the chosen credential.
* Avoid `fetch()` + `response.blob()` for 1–3 GB: it incurs full transfer, storage/memory pressure, delayed first frame, and object-URL lifecycle complexity. `URL.revokeObjectURL()` must be called when an object URL is no longer needed to release the reference. [MDN revokeObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
* Local filesystem `File` objects are different: a user-selected file can be assigned through an object URL, but the full file is still a poor fit for remote/server-backed Explorer assets. If this product explicitly means browser-local files, use `URL.createObjectURL(file)` and revoke on unmount/file replacement; test seeking on 3 GB samples.
* Verify the server with `HEAD` and a small `Range: bytes=0-1` probe in integration tests. A non-range `200` response means the browser may need the whole body for seek; `206` is the expected partial response. [MDN 206 Partial Content](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/206)

### Loading and perceived latency

* In the Explorer list, render poster/thumbnail and do not preload every item. For the selected item use `preload="metadata"` initially; MDN defines it as fetching metadata such as duration, while `auto` permits downloading the whole file and is only a hint browsers may ignore. [MDN preload](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload)
* On explicit user activation, set the active source, call `load()`, then `play()` and show a compact loading state until `loadeddata`/`playing`. Use `poster`, fixed dimensions/aspect ratio, and `playsinline` to avoid layout shift and mobile fullscreen surprises.
* Do not use `<link rel="preload" as="video">` as the core optimization: web.dev notes current Chrome and Safari support has changed and range requests are incompatible with link preload. [web.dev fast playback](https://web.dev/articles/fast-playback-with-preload)
* Use `buffered`, `readyState`, `networkState`, `waiting`, `stalled`, `progress`, `seeking`, and `seeked` for honest UI. `seekable` reports time ranges currently available for seeking. [MDN media delivery](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery), [MDN HTMLMediaElement events](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement)
* Debounce rapid list selection: cancel/ignore stale media events and revoke prior object URLs only after the element no longer uses them. Keep one active `<video>` to limit decoder/network pressure.

### Autoplay, failures, and extension-based routing

* Treat extension mapping as a source/type hint, not proof of playability. Provide ordered `<source>` candidates only when known variants exist; the browser chooses a supported source based on `type`, then emits an error if none work. [MDN `<source>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/source)
* Never require audible autoplay when opening an Explorer item. Browsers commonly block it; `play()` returns a rejected Promise on failure. Start only from the user's click/keyboard activation, or use muted preview autoplay with `playsinline`. [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
* Map `video.error.code` (`MEDIA_ERR_NETWORK`, `MEDIA_ERR_DECODE`, `MEDIA_ERR_SRC_NOT_SUPPORTED`) to actionable UI: retry/network, unsupported/corrupt codec, or “download/open externally.” `networkState === NETWORK_NO_SOURCE` detects all sources failing. [MDN MediaError](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/message), [MDN delivery failures](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery)
* For unsupported extensions/codecs, show filename, detected MIME/codec if backend metadata has it, and a clear fallback. Do not silently spin forever.

### Accessibility and interaction

* Use native `controls` for MVP, a visible accessible name (`aria-label` or adjacent heading), keyboard-operable selection, and focus management when the preview opens. Preserve captions via `<track kind="captions">` when available; offer download/open fallback.
* Keep loading/error status in an `aria-live="polite"` region, but do not announce every `timeupdate`. Ensure contrast, focus ring, reduced-motion compatibility, and no auto-audio.

## MVP versus HLS/MSE/transcoding

| Option | Benefit | Cost/risk | Decision |
|---|---|---|---|
| Native progressive + ranges | Lowest code/latency to first frame; native controls; random seek | Requires compatible encoding and correct HTTP semantics | **MVP** |
| Client-side MSE/WebCodecs | Custom buffering/transmuxing possible | Complex codec/container logic, memory/CPU, browser variance; not needed for static files | Defer |
| Server-side transcode | Makes unsupported media playable; can normalize MP4 | 1–3 GB CPU/disk/time cost, queueing, duplicate storage; operational complexity | Add only on measured incompatibility demand |
| HLS/DASH | Adaptive bitrate and resilient long-form delivery | Packaging, manifests, segments, player/DRM complexity; overkill for local Explorer preview | Defer unless variable networks/ABR is a product requirement |

Use server-side asynchronous proxy/transcode later for known unsupported formats, never block the Explorer click waiting for a 3 GB conversion. Preserve original and expose job state/preview URL.

## Acceptance targets and regression tests

* On a representative 1–3 GB MP4, first metadata visible ≤1 s on a warm LAN and first frame/playback ≤2 s; define a slower-network target separately. No full-file transfer before play.
* Initial request and seeks produce `206` responses; seeking to 25%, 50%, and 90% starts/recovers within ≤2 s on the test network, with no >250 MB client heap growth attributable to the player.
* Unsupported/corrupt/network failures reach a visible, actionable state within 3 s; autoplay rejection does not create an unhandled Promise rejection.
* Browser matrix: current Chromium, Firefox, and Safari (desktop where available); test MP4/H.264+A​AC, WebM/VP8 or VP9, and at least one unsupported extension. Use Playwright to assert `loadedmetadata`, `playing`, seek completion, error UI, request status/headers, and rapid item switching. Add Rust/API integration tests for `HEAD`, ranges, `416`, auth, and cache validators.
* Manual accessibility pass: keyboard-only Explorer selection/play/seek, screen-reader status, captions, focus return, and reduced-motion behavior.

## Unresolved questions

1. Does “local video” mean browser-selected `File` objects, server workspace files, or both?
2. Which auth mechanism does the existing media endpoint use (cookie, bearer, signed URL), and can it support range requests/CORS?
3. What browser/device minimum and codec inventory must MVP support?
4. Are thumbnails/posters and caption tracks already available?
