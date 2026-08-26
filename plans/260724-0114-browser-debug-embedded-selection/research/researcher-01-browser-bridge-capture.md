# Research Report: Browser Debug Bridge + Embedded Selection/Capture

Date: 2026-07-24 (Asia/Ho_Chi_Minh)

## Executive summary

For controlled loopback or active Cloudflare-tunnel applications, an iframe can host a small, app-owned inspection bridge, but the parent cannot inspect arbitrary cross-origin DOM. Use `postMessage` as the control plane, with strict allowlists for both `event.origin` and `event.source`, a nonce/session handshake, schema validation, and least-privilege commands. Embedding remains conditional on the target app's CSP `frame-ancestors`/`X-Frame-Options` policy.

For visual fallback, `getDisplayMedia()` is user-mediated and cannot silently capture. Request the current tab (`preferCurrentTab`, `displaySurface: "browser"`, and usually `selfBrowserSurface: "include"`), then crop only if the browser supports the Screen Capture crop APIs. Treat dimensions as physical capture pixels; map CSS coordinates using the captured element's `getBoundingClientRect()` and `devicePixelRatio`, accounting for browser zoom. If permission is denied or unsupported, keep bridge/DOM metadata and ask the user for an uploaded screenshot.

## Key findings

### 1. Cooperative iframe bridge

- Same-origin DOM access is unavailable for a cross-origin iframe; cooperation must be code running inside the app (bridge script/SDK or injected route).
- `window.postMessage()` can communicate cross-origin only when the sender already owns a `Window` reference (for iframe, `iframe.contentWindow`). MDN explicitly says to use an exact `targetOrigin`, never `*` when the destination is known, and to validate received `event.origin`; failure to check origin/source enables XSS/data exfiltration. [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage?lang=en)
- Validate `event.source === iframe.contentWindow` in addition to exact origin. Origin is the sender's origin at send time and may no longer match after navigation; re-check source and require a fresh nonce/handshake after iframe `load`/navigation.
- Message protocol recommendation: `{version, nonce, requestId, type, payload}`; allow only read-only selectors, accessibility tree/console/log snapshots, and bounded-size responses. Reject unknown types, oversized payloads, stale nonce, wrong source/origin. Reply via `event.source.postMessage(reply, event.origin)` only after validation.
- Loopback (`http://127.0.0.1:<port>` / `localhost`) and a Cloudflare HTTPS tunnel are different origins (scheme/host/port). Generate an explicit per-session allowlist from the actual configured parent and app origins; do not generalize to all `*.trycloudflare.com` or all localhost ports. Mixed-content policy also means an HTTPS parent should not embed an HTTP app except browser-specific secure-context allowances; prefer HTTPS tunnel for both.

### 2. Frame embedding constraints

- `Content-Security-Policy: frame-ancestors` controls which ancestors may embed a page; every ancestor is checked, and a mismatch cancels loading. It does not fall back to `default-src`. [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- `frame-ancestors 'none'` blocks embedding; `'self'` allows same-origin only; specify exact bridge parent origins (including scheme/port as applicable) for controlled deployments. [MDN CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- Legacy `X-Frame-Options: DENY` or `SAMEORIGIN` can still block iframe loading; remove/adjust it on the controlled debug route, not globally. Nested frames must satisfy all ancestor policies.

### 3. Current-tab capture and cropping

- `navigator.mediaDevices.getDisplayMedia()` always presents a browser picker and requires transient user activation; there is no silent/current-tab guarantee. Handle `NotAllowedError` (cancel/denial), `NotFoundError`, `NotReadableError`, and unsupported APIs as normal states. [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- Suggested constraints (hints, not enforcement):

```js
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { displaySurface: "browser" },
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "include",
  audio: false,
});
```

The user can still select another tab/window/monitor; inspect `track.getSettings().displaySurface` and stop/reject if it is not `browser`.
- A captured tab track may contain physical pixels. W3C notes source pixel ratio can make track width/height larger than CSS display dimensions. [W3C Screen Capture](https://www.w3.org/TR/screen-capture/)
- Map bridge-reported CSS rectangle `(x,y,width,height)` to capture pixels with scale factors derived from `videoWidth / capturedSurfaceCssWidth` and `videoHeight / capturedSurfaceCssHeight`; in the common case scale ≈ `devicePixelRatio × browserZoom`. Do not assume DPR=1 or that `window.devicePixelRatio` in the parent equals the captured tab's value. Clamp crop rectangle to frame bounds and round only at the final bitmap operation.
- Prefer element cropping (`CropTarget.fromElement()` + `track.cropTo()` where implemented) over coordinate math; MDN documents CropTarget as a way to limit a self-capture stream to an element. [MDN Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API.) Feature-detect; current-tab cropping support is browser/version dependent.

### 4. Screenshot denial/unsupported fallback

Implement a deterministic fallback chain:

1. Cooperative bridge returns DOM/semantic snapshot plus element rectangles (works without pixels).
2. Attempt user-initiated `getDisplayMedia`; if denied, cancelled, wrong surface, or capture API/crop unsupported, stop tracks and show clear instructions.
3. Accept user-provided PNG/JPEG upload or paste; optionally allow “open app in new tab” for manual screenshot. Never claim a screenshot was captured when permission failed.

## Recommended architecture

```
Parent debugger (known origin)
  └─ iframe app (controlled route, CSP allowlisted)
       └─ bridge.js: nonce handshake + postMessage RPC + rect/snapshot APIs
Parent: optional getDisplayMedia() ──> inspect displaySurface ──> CropTarget/bitmap crop
                                  └─ denial/unsupported ──> upload/manual screenshot
```

## Unresolved questions

- Which browser/version matrix must be supported for `CropTarget`/`cropTo` and `preferCurrentTab`?
- Can the controlled app expose a dedicated debug route with CSP and X-Frame-Options overrides, or must the bridge run in the production document?
- Are screenshots expected to include browser chrome (impossible with tab capture) or only page pixels?
