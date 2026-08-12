# Phase 02 — Bind Media Tickets and Stream/Logout Lifecycle

## Context links

- [Plan](./plan.md) · [Phase 1](./phase-01-server-media-session-and-strict-cors-contract.md)
- [Debugger report](../reports/debugger-260812-1729-video-stream-ticket-access.md)
- `server/src/api/fs_video.rs` · `fs_image.rs` · `media_stream_response.rs` · `auth.rs`

## Overview

- Date: 2026-08-12
- Description: bind shared image/video tickets to actor + media session; enforce cookie on GET/HEAD; close logout/profile lifecycle.
- Priority: P1
- Implementation status: DONE — 2026-08-13 00:20:59 +07:00
- Review status: Required; security and streaming regression review

## Key Insights

- `require_auth` currently skips actor insertion in no-auth. Issuers need one actor contract in both modes.
- Failed binding checks must happen before any ticket/session idle extension. Same `404` for unknown, expired, wrong kind, absent, malformed, or foreign cookie.
- Stream body, single Range/If-Range, HEAD, purpose disposition, version revalidation, and direct paths need no redesign.
- `/api/auth/logout` cannot receive Path=`/api/fs` cookie; revoke it through protected `/api/fs/media-session` first.

## Requirements

- Successful issue atomically establishes/reuses media session and ticket; bind actor subject + session digest in `MediaTicketRecord`/stored ticket.
- Response sets media cookie and adds `authorizationMode: "session-cookie-v1"`; no raw binding in JSON.
- Every video/image `GET|HEAD` extracts cookie and calls bound lookup. No bearer-only, Referer, Origin, or auth-cookie fallback.
- Only a fully authorized, current, revalidated file request touches ticket/session TTL. Binding or stale-file checks do not touch. Binding failures return empty non-disclosing `404`; stale file remains `410` after cookie/ticket authorization but before touch.
- Revoke ticket remains actor/session scoped. Add protected current-session revoke route; clear cookie. Logout/profile change calls it before credential removal.

## Architecture

- Issue flow: middleware actor → resolve/open/stat → `issue_bound(actor,cookie?,record)` under authority lock → `201 + Set-Cookie + versioned URL response`.
- Stream flow: ticket + cookie → atomic authorize-without-touch and lease revision → existing file revalidation → atomic final recheck-and-touch → existing HEAD/Range body. Revocation/expiry/change between checks fails closed before response admission.
- Logout flow: authenticated `DELETE /api/fs/media-session` → revoke all bound tickets + session → clear media cookie; then existing auth logout clears JWT.
- Actor binding limits session rotation across profiles. Because JWT lacks JTI, logout revokes current media session, not every login for same account.

## Related code files

- Create `server/src/api/media_session.rs` — cookie extraction, protected revoke-current-session handler, safe response helpers.
- Modify `server/src/api/auth.rs` — insert `AuthenticatedActor("dev-user")` in no-auth; clear media cookie defensively at auth logout.
- Modify `server/src/api/router.rs` — register protected `/api/fs/media-session`; keep stream routes outside bearer middleware but cookie-authorized.
- Modify `server/src/api/fs_video.rs` — actor/jar issue, version marker, scoped revoke, cookie-aware stream.
- Modify `server/src/api/fs_image.rs` — same shared contract.
- Modify `server/src/api/media_stream_response.rs` — bound lookup before TTL touch; preserve native stream implementation.
- Modify `server/src/api/media_stream_headers.rs` — ensure `Cache-Control: private, no-store` on every stream response, including 200/206/HEAD/404/410/416.
- Modify `server/src/fs/media_ticket.rs`, `video_ticket.rs`, `image_ticket.rs` — binding-aware issue/lookup/revoke adapters.
- Modify `server/src/api/tests.rs` and `server/src/fs/media_ticket.rs` tests — full lifecycle matrix.
- Delete: none.

## Implementation Steps

1. Make `require_auth` always insert actor on success, including no-auth `dev-user`; add middleware regression test.
2. Add binding fields and `issue_bound`, `authorize_bound`, `finalize_bound_and_touch`, `revoke_bound`, `revoke_session`. Use a lease revision/generation so finalization rechecks the same live ticket/session after async file validation; mutate deadlines only at finalization.
3. Update both issuers to extract `Extension<AuthenticatedActor>` + `CookieJar`; rotate foreign/expired cookie, revoke replaced session when safely identified, and emit cookie/version only after ticket admission.
4. Update both stream handlers to pass presented cookie into shared responder. Keep GET/HEAD and exact URL shapes unchanged.
5. Scope ticket DELETE to actor/current media session; do not let one session revoke another actor/session ticket via guessed token.
6. Add `DELETE /api/fs/media-session`; update logout response to clear matching media-cookie attributes as defense-in-depth.
7. Audit tracing/diagnostics: log media kind/status/reason class only; never URI ticket segment, Cookie, Authorization, actor+ticket tuple.
8. Test video and image GET/HEAD/full/single Range/If-Range, purpose/kind isolation, copied URL/curl-like no-cookie, foreign cookie, stale file, expiry, revoke-during-validation, logout, profile rotation, workspace revoke, restart, capacity, and `no-store` on all statuses.

## Todo list

- [x] Actor available in auth and no-auth handlers
- [x] Shared binding used by image + video
- [x] Failure paths proven no-touch
- [x] Session logout endpoint and clear cookie complete
- [x] Native Range/HEAD behavior unchanged
- [x] Reviewer finds no capability fallback

## Success Criteria

- Valid owning cookie + ticket: existing `200/206`, HEAD metadata, seek, image body, and download disposition pass.
- Missing/malformed/foreign cookie and stale-file probes do not touch TTL; deterministic clock proves expiry unchanged. All stream statuses are `private, no-store`.
- Logout/profile cleanup denies old URLs; server restart denies all in-memory sessions.
- Commands: `cd server && cargo test media_ticket`; `cd server && cargo test api::tests -- media`; `cd server && cargo test` all pass.

## Risk Assessment

- Revocation/stream race: one authority lock; authorization and touch atomic; file read may continue once admitted, documented request-level semantics.
- Either skew direction causes fail-closed media outage. Deploy server+UI coordinately or use a media maintenance window; never restore capability-only compatibility.
- Cookie rotation could strand tickets: revoke old binding and let components reissue; no partial binding.

## Security Considerations

- Cookie theft still grants one media-session half; ticket remains separately random and actor-bound.
- Account disable is checked at ticket issuance under current auth model; active session lasts bounded TTL. JWT/JTI redesign out of scope.
- CSRF mutation defense: protected JSON requests, exact CORS; optional Fetch Metadata rejection only if tests prove Tauri compatibility.

## Next steps

- Phase 3 requires `authorizationMode` and credentialed HEAD probe before exposing URL to native elements.

## Unresolved questions

- Should account administration gain immediate all-media-sessions-by-actor revocation later? Not needed for current logout scope.
