# Phase 03 — Frontend Native-Media Compatibility and Deployment

## Context links

- [Plan](./plan.md) · [Phase 2](./phase-02-bind-media-tickets-and-stream-logout-lifecycle.md)
- [Browser research](./research/researcher-02-browser-cross-site-media.md)
- `packages/ui/src/api/video-tickets.ts` · `image-tickets.ts`
- `VideoPreview.tsx` · `ImagePreview.tsx` · `start-video-download.ts`

## Overview

- Date: 2026-08-12
- Description: require versioned session-cookie contract, credentialed compatibility probe, native credential mode, actionable fail-closed UX, deployment checks.
- Priority: P1
- Implementation status: Review changes required — 2026-08-13; Phase 2 contract consumed
- Review status: Fix stale-profile logout revocation bypass, then re-review; Phase 4 engine qualification remains required

## Key Insights

- Native `<video>/<img>` cannot add Authorization. Credentialed `HEAD` against the issued path can verify cookie+CORS before native assignment without buffering bytes.
- HttpOnly/Partitioned support cannot be inferred safely from JavaScript or UA alone. Runtime probe is authoritative; engine support claims still need Phase 4 evidence.
- New client must reject old capability-only servers: require `authorizationMode: session-cookie-v1`.
- Direct anchor download has no header fallback and must remain browser-managed; qualify cookie delivery or disable with guidance.

## Requirements

- Reject remote non-HTTPS media server URLs. Cookie stays Secure on loopback; allow loopback HTTP only after target-engine tests prove Secure+Partitioned acceptance, otherwise require local HTTPS.
- Ticket issue/revoke/probe use `credentials: "include"`; require exact response version and same-origin stream path.
- Probe issued URL with credentialed `HEAD`; success only 2xx. On 404/CORS/network/privacy failure, revoke best effort and return typed `MEDIA_SESSION_UNSUPPORTED`/`INSECURE_MEDIA_SERVER` without leaking response body.
- Set `crossOrigin="use-credentials"` before assigning image/video `src`; preserve direct opaque URL, no Blob/object URL/service-worker fallback.
- Preview/download UI explains HTTPS, supported Chromium/Edge/Tauri engine, site-data/privacy setting, retry; never suggests copying URL or bearer fallback.
- Profile switch/logout revokes `/api/fs/media-session` before clearing/switching token; network failure remains bounded server-side.
- Ownership is browser media-session + actor within one top-level-site partition. Same partition may reuse that session across tabs/logins for the actor; per-login/JTI binding is out of scope.

## Architecture

- Create shared compatibility helper: validate server transport/version → credentialed HEAD probe → typed safe error category.
- Ticket clients keep media-specific parsing/purpose; reuse helper rather than broad ticket-client refactor.
- Components attach URL only after probe, retain generation/abort/revoke protections, and render shared actionable copy.
- Deployment contract: frontend origin exactly allowlisted; API reachable over HTTPS; Tauri packaged origin allowlisted; no wildcard reflection.

## Related code files

- Create `packages/ui/src/api/media-session.ts` — contract version, HTTPS/loopback validation, credentialed HEAD probe, revoke-current-session helper, typed errors.
- Create `packages/ui/src/api/media-session.test.ts` — version/URL/HEAD/CORS-like failure/abort/redaction cases.
- Modify `packages/ui/src/api/video-tickets.ts` and `.test.ts` — require authorization mode, run shared probe, preserve purpose handles.
- Modify `packages/ui/src/api/image-tickets.ts` and `.test.ts` — same contract.
- Modify `packages/ui/src/components/organisms/VideoPreview.tsx` and `.test.tsx` — credentialed native mode, actionable unsupported/insecure state, download disable/retry.
- Modify `packages/ui/src/components/organisms/ImagePreview.tsx` and `.test.tsx` — credentialed native mode and unsupported state.
- Modify `packages/ui/src/lib/start-video-download.ts` and `.test.ts` — probe before direct anchor; no fetch-body fallback.
- Modify `packages/ui/src/api/server-config.ts` and relevant tests — revoke media session during logout/profile URL or actor change; classify remote HTTP.
- Modify `apps/native/src-tauri/tauri.conf.json` only if exact HTTPS/profile and packaged-origin CSP/connect policy blocks qualified requests; do not add plugins/sidecars.
- Delete: none.

## Implementation Steps

1. Extend ticket response parsers with exact `authorizationMode`; reject absent/unknown value as unsupported old server.
2. Implement `assertMediaTransport` (HTTPS or evidence-approved loopback) and `probeMediaTicket(url, signal)` using `HEAD`, `credentials: include`, no response text/logging.
3. Run probe before returning attachable ticket handle. Best-effort revoke on failure; preserve timeout/abort distinction and source generation guards.
4. Assign `crossOrigin = "use-credentials"` before `src` in imperative paths/JSX; ensure retries detach source before revoke.
5. Add accessible unsupported panel text and retry. Differentiate insecure deployment from privacy/cookie-engine failure; keep details actionable but non-sensitive.
6. Probe download ticket then click temporary anchor. If unsupported, do not click or fetch bytes; show same guidance.
7. Add current-media-session revoke to explicit logout/profile-switch sequence before local token deletion; do not block logout forever—short timeout + bounded server expiry.
8. Document deployment variables and exact origins in Phase 4 only after behavior/tests pass.

## Todo list

- [x] Old/insecure server fails closed
- [x] Shared credentialed probe used by image/video/download
- [x] Native URLs and Range path preserved
- [x] Unsupported UX accessible/actionable
- [ ] Logout/profile lifecycle covered — stale/deleted-profile logout clears token without shared session revoke; fix and regression-test
- [x] No bearer/blob fallback introduced

## Success Criteria

- Tests assert `credentials: include`, `HEAD`, version marker, same-origin path, `crossOrigin=use-credentials`, and no media-body fetch.
- Unsupported engine/privacy block never receives media bytes and displays HTTPS/site-data/supported-engine guidance.
- Direct download creates one anchor only after successful bound probe.
- Commands: `pnpm --filter @dam-hopper/ui test -- media-session video-tickets image-tickets`; `pnpm --filter @dam-hopper/ui test -- VideoPreview ImagePreview start-video-download`; `pnpm --filter @dam-hopper/ui build` pass.

## Risk Assessment

- HEAD probe succeeds while anchor behavior differs: Phase 4 independently gates download per engine; disable unsupported engine claim.
- Extra HEAD adds one request/touch: negligible, no body; preserve ticket absolute deadline.
- Generic native media error may resemble codec failure: pre-probe typed state separates cookie/CORS from decode errors.

## Security Considerations

- Never persist or expose cookie/ticket in DOM text, logger metadata, diagnostics, local/session storage.
- Exact version requirement prevents silent downgrade to old bearer-capability server.
- Fetch Metadata may differ in WebViews; no client-side CSRF assumption.

## Next steps

- Fix `ServerSettingsDialog` stale/deleted-profile logout so it calls `revokeCurrentMediaSession(profile.url, token)` before local token removal; add regression coverage.
- Phase 4 runs actual multi-origin browser and packaged WebView qualification before support/docs claims.

## Unresolved questions

- Exact UI link destination for browser privacy/HTTPS remediation, if any; plain guidance is sufficient MVP.
