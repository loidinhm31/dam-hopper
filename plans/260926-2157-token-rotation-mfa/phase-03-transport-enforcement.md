# Phase 03 — Protected routes and continuous access

## Context links

[Plan](./plan.md) · [Continuous enforcement contract](./security-contract.md#continuous-access-enforcement) · [Server inventory](./research/server-auth-inventory.md) · [Phase 02](./phase-02-authentication-api.md)

## Overview

Date: 2026-09-26. Priority: P1. Implementation: pending. Review: pending. Close JWT-only and capability-only paths, including already-open connections.

## Key Insights

`require_auth` currently checks signature/expiry without MongoDB account/session validation. WebSockets authorize only at upgrade and continue reading/pumping. Media routes bypass bearer middleware by design and use independent ticket/session TTLs. Plugin epochs bind actor/JWT expiry, not MFA freshness.

## Requirements

All protected admissions share policy. Legacy tokens denied server-side; day-10/day-30 cutoffs apply to existing streams and sockets. Direct MongoDB resets invalidate new requests and retire existing output within the explicit bounded polling window. Never kill PTYs solely for reauthentication.

## Architecture

Extend authenticated actor with non-secret session binding and effective authorization deadline. Introduce one session lease/cancellation guard reusable by live surfaces; no per-byte database query. HTTP admissions remain authoritative reads. WS incoming operations recheck before dispatch/commit, outgoing data checks local cutoff; a deadline watcher bypasses full queues. Live revocation watcher uses <=5-second interval and bounded database timeouts, failing closed.

## Related code files

Modify: `server/src/api/auth.rs`, `router.rs`, `ws.rs`, `ws_protocol.rs`, `fs_video.rs`, `fs_image.rs`, `media_stream_response.rs`, `media_session.rs`; `server/src/fs/media_ticket.rs`, `media_session.rs`, `video_ticket.rs`, `image_ticket.rs`; `server/src/plugins/authorization.rs`; `server/src/state.rs`.

During implementation inventory all additional streaming/upgrade routes and AuthenticatedActor consumers through LSP (if configured) or precise search. Include any discovered dependent capability boundaries in the same cutover; do not claim this initial list exhaustive.

## Implementation Steps

1. Replace signature-only middleware/status/WS validation with async shared policy. Remove obsolete JWT-only admission helpers and update all callers; no dual legacy path.
2. Ensure actor binding carries session identity/version and effective deadline without raw bearer material. Preserve bearer-only management, enabled user roles, exact-origin checks, and plugin no-auth restrictions.
3. Add WS full-policy admission, pre-operation checks, deadline timer and revocation cancellation. Reserve distinct close codes/reasons for MFA due, full login, and unavailable state; align Phase 04 handling. No automatic reauthentication over the old socket.
4. Reuse existing teardown to cancel subscriptions/pumps, abort unfinished uploads and pending calls, revoke epoch/context, and close socket. Timer/revocation cannot starve behind continuous incoming traffic or blocked outgoing send. PTY server process persists for later reattachment.
5. Clamp plugin epoch expiry to min(MFA due, session expiry); preserve existing grant checks. Bound HTTP-held operation capabilities and recheck state at security-sensitive commit points.
6. Bind media sessions/tickets to auth session + credentialVersion + authVersion and clamp TTLs. Do not reuse old media cookie binding after credential replacement solely because actor/client match.
7. Revalidate media HEAD/GET/range against session state, including allowed-origin ticket-only paths. Preserve 404 concealment and existing sandbox/file-version/origin checks; guard ongoing body emission against deadlines/revocation without whole-file buffering.
8. Ensure logout, revision change, reset/disable, and database failure revoke applicable leases. In-process changes can signal immediately; out-of-band MongoDB update relies on bounded watcher. Define and test timeout plus propagation bound.
9. Inventory public auth/health/static exceptions and other long-lived routes; document intentional exclusions (e.g. already-delivered browser bytes cannot be recalled).

## Todo list

- [ ] Shared policy across all admissions; eliminate JWT-only path.
- [ ] Deadline/revocation-aware WS teardown and pending-operation cleanup.
- [ ] Session-bound plugin and media capabilities, including active bodies.
- [ ] Explicit live-revocation bound and complete surface inventory.

## Success Criteria

An open socket at day 10/day 30 closes even if idle or output-backpressured; copied tokens and old media URLs cannot bypass the gate. Reset/disable stops new admission and live output within documented bound. Database outage closes/denies rather than reusing an indefinitely cached permit. Other profiles/sessions remain unaffected except intentionally account-wide reset.

## Risk Assessment

Per-message database reads can affect high-rate terminal input; use indexed narrow projections and one evaluation per admitted frame/batch, not per byte. Share periodic outbound-stream checks per session, but keep incoming operation admission authoritative. Prove throughput remains usable without weakening policy. Long-lived body cleanup must release file descriptors and tasks.

## Security Considerations

MFA remains server-authoritative. A UI timer, claims-only timestamp, expired media cookie, or a plugin grant cannot independently authorize access. Do not allow no-auth to instantiate production plugin authority.

## Next steps

Integrate Phase 04 state transitions and Phase 05 actual socket/media qualification; no deployment of middleware-only enforcement.
