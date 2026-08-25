# Repository Auth and Media Research

## Scope

Read-only repository research. Target: session-bound image/video streams for cross-site clients.

## Findings

- `server/src/api/router.rs:373-409`: ticket issue/revoke routes use `require_auth`; stream GET/HEAD routes deliberately sit outside auth middleware.
- `server/src/api/media_stream_response.rs:39-50`: ticket + media kind alone authorize bytes.
- `server/src/fs/media_ticket.rs:69-77,195-216`: record has no actor/session binding; valid lookup refreshes idle expiry.
- `server/src/fs/media_ticket.rs:11-13`: 30-minute idle, 8-hour absolute lifetime.
- `server/src/api/auth.rs:34-41,119-142`: protected routes expose only `AuthenticatedActor.subject`; JWT has no session/JTI identity.
- `server/src/api/auth.rs:303-309,354-360`: login sets HttpOnly, Secure, SameSite=Strict auth cookie; genuinely cross-site native media cannot rely on it.
- `packages/ui/src/api/server-config.ts:223-314`: cross-origin frontend persists profile bearer JWT and adds `Authorization` to fetch.
- `packages/ui/src/api/video-tickets.ts:112-157` and `image-tickets.ts:111-155`: issue/revoke already use bearer auth plus `credentials: include`.
- `VideoPreview.tsx:126-147` and `ImagePreview.tsx:94-129`: native elements receive opaque stream URL directly; cannot add Authorization header.
- `start-video-download.ts:11-24`: download uses direct anchor navigation and needs same binding.
- `server/src/api/router.rs:428-477`: empty or `*` CORS mirrors arbitrary Origin with credentials. Must change before adding cross-site cookie authority.
- Existing server tests intentionally assert valid capability-only access: `server/src/api/tests.rs:4265-4284` and image equivalent around `4476`.

## Recommended repository design

1. Add random media-session cookie, distinct from JWT: `HttpOnly; Secure; SameSite=None; Partitioned; Path=/api/fs`.
2. Authenticated ticket issuance creates/refreshes media session and binds ticket to its digest plus actor subject.
3. Stream GET/HEAD requires matching cookie; missing/wrong binding returns same `404` as unknown ticket and must not touch TTL.
4. Keep native URL, Range/HEAD, file-version, purpose, shared capacity, explicit revoke, and workspace revoke semantics.
5. Logout clears media cookie and revokes its tickets/session. Profile change keeps existing best-effort ticket cleanup.
6. Require explicit CORS origin allowlist for credentialed authenticated deployments; reject empty/`*` in production/auth mode.
7. `--no-auth`: still issue media-session cookie so behavior remains testable and copied URLs fail. Keep `Secure`; verify loopback acceptance in real engines or require local HTTPS. Never emit insecure `SameSite=None; Partitioned`.

## Test surfaces

- `server/src/fs/media_ticket.rs`: matching/missing/foreign binding, no TTL touch on failure, expiry, revocation, kind/purpose.
- `server/src/api/tests.rs`: cookie attributes; video/image GET/HEAD/Range; foreign/no cookie; logout; wildcard CORS rejection; no-auth.
- `packages/ui/src/api/*-tickets.test.ts`: `credentials: include`, unchanged opaque URL, safe errors.
- Preview/download tests: cookie-backed native URL behavior; no token in DOM/logs.
- Real browser: two isolated contexts/top-level sites; playback seeks, image, direct download, copied URL denial, third-party-cookie restrictions.

## Risks

- Partitioned cookie support differs by browser/WebView. Unsupported clients must fail closed, not fall back to bearer-only URL.
- Same browser top-level site shares partition; this is browser-session/top-level-site binding, not tab binding.
- TLS required for remote cross-site cookie.
- Existing JWT is account identity, not revocable login-session identity; media session needs its own random server-side lifecycle.
- Multi-instance deployment needs sticky routing/shared store; current ticket store is in-memory.

## Unresolved questions

1. Release-gated browser/Tauri matrix?
2. Must loopback HTTP work? If Secure+Partitioned is rejected there, require local HTTPS.
3. Desired media-session and ticket TTL after hardening?
