# Phase 07 — Media session isolation and encrypted-write ownership

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01 runtime and Phase 03 target contracts.

### Overview

Date: 2026-09-17. Priority: P1. Status: DONE (100%) — 2026-09-17. Runtime verification: passing (50/50 UI unit tests, 29 server media tests, 0 TS build diagnostics). Scope: Media and encryption.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Concurrent cookie-isolated media and generation-bound encryption without protocol/authorization downgrade.

### Architecture

#### Exact media v2 wire contract

Require `mediaClientId` UUIDv4 in image/video issue and ticket-revoke JSON and required body `{mediaClientId}` in media-session DELETE. Missing/invalid field/body fails request validation; remove media-v1 issue/revoke/stream branches. Client uses a random in-memory UUID per ConnectionRef, not profileId. Issue response retains other fields and requires `authorizationMode: "session-cookie-v2"`. No persistent table/profile ID/new auth authority.

Cookie name is `damhopper-media-session-<canonical UUID>`, preserving existing Path/HttpOnly/SameSite/secure policy. Give v2 cookies an explicit Max-Age no longer than the existing eight-hour absolute server session TTL so abandoned namespaces also expire browser-side. Ignore leftover fixed v1 cookies; they grant no media authorization. Store namespace in `MediaSessionBinding` and `StoredMediaSession`; ticket binding selects the one trusted cookie name during stream authorization. Never authorize by arbitrary cookie/header namespace alone. Require existing bearer actor and namespace match for issuance/reuse; duplicate-cookie parsing still fails closed for the selected name. Preserve ticket incarnation, exact target/file-version revalidation/finalization, range/HEAD behavior, caps and TTLs.

V2 ticket revoke requires captured bearer actor + namespace + ticket ownership. V2 session DELETE revokes only sessions/tickets for `(actor.subject, mediaClientId)` and clears only that namespaced cookie; it does not require a returned third-party cookie, so existing allowed-origin ticket fallback can be reliably revoked. Other actors/namespaces cannot be revoked. Remove v1 actor+fixed-cookie media authorization/revoke and obsolete logout media cleanup; keep ordinary auth-cookie logout policy separate. Namespace is a routing discriminator, not a replacement for bearer authentication or a new tenant boundary.

### Related code files

#### Dependency and files

Consumes Phase 01 bound transport and Phase 03 target/tab contracts; can develop concurrently with feature UI after contract freeze. Security/media owner edits `api/image-tickets.ts`, `video-tickets.ts`, media-session helper, `lib/start-video-download.ts`, ImagePreview/VideoPreview, `contexts/EncryptContext.tsx`, `hooks/use-encrypted-write.ts`, `lib/opaque-session.ts`; backend `server/src/fs/media_session.rs`, `fs/media_ticket.rs`, `api/fs_image.rs`, `api/fs_video.rs`, `api/media_session.rs`, `api/media_stream_response.rs` and corresponding existing media tests. Foundation owner integrates captured cleanup handle and transport cancellation.

#### Source justification

Ordinary auth prefers bearer then fixed `damhopper-auth` cookie. Media uses fixed `damhopper-media-session`, Path `/api/fs`, HttpOnly, SameSite=Lax; stream authorization uses actor/session-bound ticket and only exact configured-origin ticket fallback. Cookies are hostname/path scoped, not port scoped. Thus two real servers on localhost different ports, or two profiles to one server with different credentials, overwrite media state. Frontend map scoping alone cannot satisfy simultaneous preview/logout isolation. Existing helpers capture origin/token for revoke, which must be retained and strengthened. Encryption currently caches by bare project and reacquires global transport between OPAQUE handshake and encrypted upload/save (`use-encrypted-write.ts:106–174,203–232`).

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 07A | Server media namespace issue/revoke/stream compatibility | G0 media protocol | v1 rejected/removed; v2 actor/namespace isolation and duplicate-cookie failure |
| 07B | Runtime namespace, bounded cleanup handle and ticket helpers | Phase 01 runtime; 07A response contract | No unsafe v1 retry; cleanup cannot dispatch general writes |
| 07C | Preview/download integration and browser fixture update | 07B; Phase 03 target/tab refs | Real media across ports/duplicate profiles survives other logout |
| 07D | Owned encryption prompt/key/session and same-transport write | G0 target/generation; Phase 01 transport capability | Lock/retirement races cannot upload/repopulate stale keys |

07A and 07D can be developed independently. G0 must specify cleanup before Phase 05 capture work starts; it need not wait for finished previews. Update `packages/ui/vitest.browser.config.ts` media fixture routes, currently fixed-cookie/v1, to implement only mandatory v2 and negative old/missing-field requests. Remove obsolete v1-success assertions rather than silently converting every fixture to success.


#### Numbered implementation

1. Ordinary login/status/config/REST/PNG requests use explicit bearer where required and `credentials: omit`; authenticated WS always carries captured token, never relies on shared cookie. No-auth profile obtains existing dev token through its bound login flow. Do not change backend general bearer/cookie compatibility or broaden CORS. Media v2 issue requests are the narrow `credentials: include` exception needed to accept/send their namespaced cookie, always with explicit captured bearer so ambient auth cookie cannot select actor. Revoke may include credentials to clear its cookie but authorizes by bearer+namespace.
2. Add namespace-aware media store methods and cookie parsing; delete old fixed-cookie/v1 compatibility paths and stale protocol tests. Serialize ticket issuance per runtime to prevent concurrent initial responses replacing a just-created same-namespace cookie before use. Existing store caps/TTL remain, and retirement schedules best-effort namespace revoke. If third-party cookies are blocked, preserve only existing exact-origin ticket fallback, not a new wildcard/cookie bypass. Browser host/port cookies may be transmitted together; each server consumes only the trusted ticket namespace and actor binding. HTTPS/trusted-network guidance remains.
3. Ticket helpers require ProjectTargetRef and ConnectionRef; obtain immutable endpoint/token/namespace and validate mandatory v2 response before exposing stream URL. Startup already rejects old servers through protocol marker. If a server admitted as protocol 2 returns an old/invalid mode, retire it as incompatible with upgrade guidance; no media-v1 retry or continued partial old-contract operation. Do not put namespaces/auth in DOM bridge messages, localStorage, logs or diagnostics.
4. Define a narrow `RemoteCleanupHandle` captured when creating remote ephemeral media/artifact resources: immutable endpoint/credentials plus exact allowed ticket/artifact/session identifiers, bounded five-second cleanup request, no retry and no general invoke/write access. It may revoke/delete the original ephemeral object after generation retirement; it cannot update caches, create resources or dispatch to replacement endpoint. Runtime retirement first disables new work and invalidates generation, aborts ordinary pending calls, then best-effort cleans known leases with this handle and destroys transport. Stale successful issue/create response uses original cleanup handle; if server is unreachable, existing TTL removes it. Logout/removal never revokes another profile's v2 namespace.
5. Bind ImagePreview/VideoPreview/download to original tab target and namespace. On explicit owner retirement detach media URLs and release owned leases; ordinary project focus changes do not revoke valid A tickets. Keep image/video limits, MIME checks, ticket timing and browser-managed downloads; don't revoke a download immediately after click. A logout can revoke A's active download as expected, never B's.
6. Encryption maps/prompts/in-flight dedup use project-qualified owner + generation; worktree target remains attached to each write while project-level lock preference is owner-qualified. Queue passphrase prompts with explicit profile/project labels (or deduplicate exact same owned request), rather than replacing A's resolver when B prompts. Never persist passphrases/OPAQUE session IDs/AES keys. On lock/disconnect/logout/URL/token/generation change cancel prompts and invalidate only that owner's cache/in-flight entries; zero mutable key buffers before release, acknowledging immutable JS strings cannot be reliably wiped.
7. Capture one WsTransport, owner, exact target, passphrase/session and operation revision before OPAQUE register/login; use the same transport for encryption/upload/save after awaits. Freshness checks after handshake and WebCrypto completion prevent upload with a stale session. Give each owned project-generation handshake a collision-free random OPAQUE identifier instead of relying on sanitized/truncated bare project names; preserve existing register/login and cryptographic derivation/protocol. No server cryptography redesign. A stale handshake must not repopulate cache after lock; zero its result. Failed/stale A operation cannot clear B's session or passphrase.
8. Preserve fs streaming/encrypted write containment, target unavailable errors, conflict/mtime and progress semantics. Never downgrade a failed encrypted save to plaintext, reuse A's session on B, or auto-replay a partially uploaded write after reconnect. Dirty content survives failure and shows original owner/unknown outcome where relevant.

### Todo list

- [x] Same-host different-port A/B and duplicate same-origin profiles preview concurrently without cookie overwrite; logout/revoke A leaves B usable.
- [x] Missing/invalid mediaClientId and old media requests are rejected; old servers fail protocol admission; no v1 code path or fallback survives.
- [x] Wrong actor/namespace/cookie/expired ticket/file version/worktree target fails closed; exact-origin fallback unchanged.
- [x] Stale ticket/artifact cleanup uses original endpoint only; unreachable cleanup is bounded and relies on TTL.
- [x] Same-name projects on A/B have separate encryption prompts, keys and sessions; generation change between handshake and save prevents dispatch.

### Success Criteria

Exercise selected-cookie duplicates in the raw Cookie header, v1 and v2 cookies present together, forged namespace, invalid UUID, absent third-party cookie, failed cleanup, old server ignoring unknown request fields, and two initial ticket requests in one namespace. Each stream resolves namespace from its stored ticket, not client-supplied routing.

Phase 07 checklist and S07/S11, including real cookie and blocked-third-party-cookie behavior.

### Risk Assessment

Same-host cookies collide despite different ports; stale handshakes/cleanup need original-owner fencing.

### Security Considerations

Namespace supplements bearer/session authority; keep exact-origin fallback, sandbox and cryptographic protocol.

### Next steps

#### Verification and risks

Phase 07 implementation complete. All unit and integration test suites pass (50 UI tests, 29 backend media tests). TypeScript build passes with zero diagnostics. Next step is Phase 08 (native scope concurrency) and integration qualification in Phase 09.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
