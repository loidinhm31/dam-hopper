# Phase 02 — Frontend HTTP Media Lifecycle

## Context links

- [Plan](./plan.md) · [Phase 1](./phase-01-preflight-and-backend-http-contract.md)
- `packages/ui/src/api/media-session.ts` · `video-tickets.ts` · `image-tickets.ts`
- `packages/ui/src/components/organisms/VideoPreview.tsx` · `ImagePreview.tsx` · `packages/ui/src/lib/start-video-download.ts`

## Overview

- Date: 2026-08-13
- Description: accept HTTP server profiles for ticket issue/probe/native media/revoke while retaining fail-closed media semantics.
- Priority: P1
- Implementation status: Pending
- Review status: Required; frontend/security review before Phase 3

## Key Insights

- Server profile normalization already accepts HTTP. The blocking guard is `assertMediaTransport`; revocation separately skips HTTP to avoid Bearer cleartext.
- Approved scope accepts cleartext Bearer transport. Revocation must therefore run on HTTP too; otherwise logout/profile change weakens explicit lifecycle control.
- `credentials: "include"` remains required for cross-origin cookie inclusion and harmless same-origin. Native `crossOrigin="use-credentials"` remains needed for configured credentialed CORS.
- Probe and authorization-mode checks remain valuable; remove transport refusal, not fail-closed compatibility behavior.

## Requirements

- Accept well-formed `http:` and `https:` server origins; reject malformed/non-web schemes through existing profile normalization/URL parsing.
- Remove `INSECURE_MEDIA_SERVER` from media ticket error taxonomy and preview/download guidance. Do not replace it with a warning that blocks media.
- Issue image/video tickets using Bearer where available plus `credentials: include`; require `session-cookie-v1`; resolve only exact same-server opaque path; credentialed `HEAD` must return 2xx before native source/anchor.
- Keep native image/video URLs, `crossOrigin=use-credentials`, no media-body fetch, Blob, object URL, service worker, or Bearer URL fallback.
- `revokeCurrentMediaSession` must call valid HTTP and HTTPS origins with Bearer + credentials, five-second bound, before profile token removal/switch/logout; invalid origin remains safe no-op.
- Ticket-specific revoke remains best-effort, bound to request snapshot, and credentialed on HTTP/HTTPS.
- User-facing copy may explain site-data/cookie failure. HTTP interception warning belongs in profile/docs, not a runtime media blocker.

## Architecture

- Client flow unchanged: profile snapshot → authenticated issue → version/path validation → credentialed HEAD → native URL attach/download → best-effort ticket/session revoke.
- Minimal policy: rename transport assertion to web-origin validation or fold into snapshot URL validation; avoid a new config flag or cookie-mode API.
- Cross-site HTTP limitation is deployment-level: browser may omit Lax cookie; probe fails generically and safely. UI must not claim all cross-site HTTP works.

## Related code files

- Modify `packages/ui/src/api/media-session.ts` — accept HTTP/HTTPS; send revoke over HTTP; keep fixed redacted probe errors.
- Modify `packages/ui/src/api/media-session.test.ts` — HTTP/HTTPS acceptance and HTTP revoke contract.
- Modify `packages/ui/src/api/video-tickets.ts`, `video-tickets.test.ts` — remove insecure-server rejection; assert HTTP issue/probe/revoke.
- Modify `packages/ui/src/api/image-tickets.ts`, `image-tickets.test.ts` — same.
- Modify `packages/ui/src/components/organisms/VideoPreview.tsx`, `.test.tsx` — remove HTTPS-only state/title; retain unsupported-browser state.
- Modify `packages/ui/src/components/organisms/ImagePreview.tsx`, `.test.tsx` — same.
- Verify `packages/ui/src/lib/start-video-download.ts`, `.test.ts` — direct anchor remains after credentialed probe; no transport branch.
- Modify `packages/ui/src/api/server-config.test.ts` only if needed — keep HTTP profile normalization and credential-transition revocation coverage.
- Delete: none.

## Implementation Steps

1. Replace HTTPS-only assertion with strict `http:`/`https:` validation, or remove duplicate assertion if `normalizeServerUrl` already proves it; preserve fixed error mapping for malformed/unsupported URLs.
2. Remove the HTTP early-return in `revokeCurrentMediaSession`; test exact DELETE request for HTTP and HTTPS, timeout handling, invalid scheme/no-token leakage, and no response-body/log exposure.
3. Update both ticket clients: HTTP origin can reach POST → parse `session-cookie-v1` → credentialed HEAD → return opaque handle. Assert Authorization remains present only in protected POST/DELETE, never HEAD URL/body.
4. Delete `INSECURE_MEDIA_SERVER` UI branch and HTTPS-specific disabled-download tooltip. Keep one `MEDIA_SESSION_UNSUPPORTED` remediation for absent/rejected cookies/CORS/old server.
5. Preserve ordering: set native credential mode before `src`; direct download anchor created/clicked only after probe; stale selection detaches then revokes.
6. Add HTTP lifecycle tests around profile switch/delete/logout helper: revoke old media session before clearing token, including unreachable-server bounded fallback.
7. Search frontend for `HTTPS`, `INSECURE_MEDIA_SERVER`, and media transport mocks; remove obsolete guards/mocks, not unrelated HTTPS recommendations.

## Todo list

- [ ] HTTP and HTTPS origins accepted by media clients
- [ ] HTTP session revoke runs before credential removal
- [ ] HTTPS-only UI guards/copy removed
- [ ] Bearer protected calls and cookie-only stream calls remain separated
- [ ] Probe/native/direct-download lifecycle preserved
- [ ] Frontend/security reviewer approves

## Success Criteria

- An `http://` profile issues and probes image/video tickets instead of failing locally.
- Tests prove POST/DELETE carry Bearer + cookies; HEAD/native URL never carries Bearer; no Blob/body fallback exists.
- Profile transitions attempt bounded revoke on HTTP before token cleanup.
- Exact commands: `pnpm --filter @dam-hopper/ui test -- media-session video-tickets image-tickets server-config`; `pnpm --filter @dam-hopper/ui test -- VideoPreview ImagePreview start-video-download`; `pnpm --filter @dam-hopper/ui build`.

## Risk Assessment

- Cleartext Bearer exposure increases account takeover risk: accepted and prominently documented; do not log/persist extra copies.
- Lax cookie absent in cross-site HTTP: credentialed probe fails closed; document unsupported topology rather than adding invalid SameSite=None.
- Removing error union can miss stale UI branches: TypeScript build + grep gate.

## Security Considerations

- HTTP support must not become bearer-in-query or bearer-stream support.
- Preserve fixed errors; never surface ticket URL, response body, Authorization, Cookie, project path, or server exception.
- Keep abort/generation checks so profile changes cannot attach a stale session URL.

## Next steps

- Phase 3 proves the complete HTTP cookie and native-media behavior in server and real-browser matrices.

## Unresolved questions

- None.
