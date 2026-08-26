# Phase 01 — Server Media Session and Strict CORS Contract

## Context links

- [Plan](./plan.md)
- [Debugger report](../reports/debugger-260812-1729-video-stream-ticket-access.md)
- [Repository research](./research/researcher-01-repository-auth-media.md)
- [Browser research](./research/researcher-02-browser-cross-site-media.md)
- [Architecture](../../docs/system-architecture.md) · [Standards](../../docs/code-standards.md)

## Overview

- Date: 2026-08-12
- Description: add bounded server-side media-session authority, cookie contract, startup guards, exact credentialed CORS.
- Priority: P1
- Implementation status: Pending
- Review status: Required; security/backend reviewer before Phase 2

## Key Insights

- Current ticket alone authorizes bytes and refreshes idle TTL. CORS mirrors arbitrary origins when list empty/`*`.
- JWT contains only `sub`; media session must be its own random lifecycle. Store digest only; never JWT/session token in URL/logs.
- Cookie path `/api/fs` means `/api/auth/logout` cannot identify it; Phase 2 needs a protected revoke endpoint under `/api/fs`.
- KISS: extend shared in-memory `MediaTicketStore` authority; one lock gives atomic session/ticket validation and revocation.

## Requirements

- 32-byte CSPRNG media-session token; server stores SHA-256 digest, actor subject, idle/absolute deadlines.
- Cookie: `damhopper-media-session`; `HttpOnly; Secure; SameSite=None; Partitioned; Path=/api/fs`; bounded `Max-Age`; deletion repeats attributes.
- Preserve existing 30m idle/8h absolute TTL. Initial bounds: 256 global tickets, 128 tickets/actor, 64 tickets/media session, 256 global media sessions, 8 sessions/actor. Prune expired before admission; no live eviction; return non-secret `429 + Retry-After` at any bound.
- Auth mode: exact parsed origins only; reject empty, `*`, malformed, duplicate/ambiguous origins before serving. Always credentials + `Vary: Origin`.
- Remote media HTTPS only. Cookie always has `Secure`; no insecure variant. Loopback HTTP is supported only if real target engines accept Secure+Partitioned there; otherwise require local HTTPS.

## Architecture

- Add `MediaSessionBinding { actor_subject, session_digest }` and opaque `MediaSessionLease`; ticket records later embed binding.
- Central helpers parse cookie, hash token, produce set/clear attributes; values never leave cookie headers.
- `MediaTicketStore` owns sessions and tickets under one poisoned-lock recovery pattern; workspace `revoke_all()` clears both/generation.
- Alternatives: bearer URL/signed URL remain transferable; Blob/MSE harms Range; service worker adds lifecycle complexity; unpartitioned cookie loses top-level partition. Decision: partitioned media cookie + server binding.

## Related code files

- Modify `server/src/fs/media_ticket.rs` — session map/caps/clock/pruning/atomic authority primitives.
- Create `server/src/fs/media_session.rs` — token digest, cookie constants/lease/attribute builders; focused tests.
- Modify `server/src/fs/mod.rs` — exports.
- Modify `server/src/state.rs` — carry immutable media-cookie policy if not derivable from existing state.
- Modify `server/src/main.rs` — validate auth/CORS/loopback-cookie startup policy before bind.
- Modify `server/src/api/router.rs` — replace mirror CORS with exact-origin builder and validated policy.
- Modify `server/src/api/tests.rs` — startup/CORS/cookie contract integration coverage.
- Delete: none.

## Implementation Steps

1. Define constants/types in `media_session.rs`; hash with existing crypto dependency or minimal `sha2`; constant-time digest comparison where applicable.
2. Extend `MediaTicketInner` with globally and per-actor bounded sessions/tickets. Implement `establish_session`, `revoke_session`, expiry pruning, test-clock support; do not expose raw token in Debug/errors.
3. Define one always-Secure cookie policy. Reject remote HTTP and dangerous origin combinations in `main.rs`; treat loopback HTTP as unsupported until real-engine tests prove Secure+Partitioned cookie acceptance.
4. Refactor `build_cors` to accept validated exact `HeaderValue` origins; fail startup in auth/production on empty/`*`/invalid values. Preserve required methods/headers/exposed Range headers and credentials.
5. Add tests for randomness/digest, idle/absolute expiry, capacity, cookie exact attributes/clear symmetry, malformed/wildcard CORS rejection, exact allow/deny/preflight and `Vary: Origin`.

## Todo list

- [ ] Session model/cookie policy implemented
- [ ] TTL/capacity deterministic tests added
- [ ] Dangerous startup combinations rejected
- [ ] Exact credentialed CORS tests green
- [ ] Security reviewer approves invariants

## Success Criteria

- Raw media-session value appears only in `Set-Cookie`/incoming `Cookie`, never records, JSON, logs, URL, diagnostics.
- Authenticated startup cannot reflect arbitrary origins; unlisted origin receives no CORS authorization.
- `cd server && cargo test media_session` and `cd server && cargo test cors` pass.
- `cd server && cargo clippy --all-targets -- -D warnings` passes or repository-approved lint delta documented.

## Risk Assessment

- Partitioned attribute formatting/library support: assert exact wire header; avoid silently dropped attributes.
- Session/ticket capacity DoS: enforce global, per-actor, and per-session bounds; prune-before-admit; `429 + Retry-After`; no attacker-selected eviction.
- Multi-instance mismatch: document sticky routing; do not claim horizontal support without shared authority.

## Security Considerations

- CORS is browser policy, never authorization. Reject Origin/Referer as identity.
- CSRF: issuance/revoke stay JSON + auth; exact origin/preflight required cross-site. Keep auth cookie Strict.
- Redact cookie/ticket and stream path in all new tracing; use fixed-cardinality reason codes only.

## Next steps

- Phase 2 consumes session authority atomically from issue/stream/revoke/logout handlers.

## Unresolved questions

- Approve proposed global/per-actor/per-session caps and 30m idle/8h absolute TTL.
- Must loopback HTTP work? If target engines reject the always-Secure cookie, require local HTTPS; never emit an insecure Partitioned cookie.
