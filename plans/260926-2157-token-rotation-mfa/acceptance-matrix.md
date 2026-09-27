# Acceptance matrix

Status: planned checks, **not executed**. [Policy contract](./security-contract.md). Test fixtures isolated; deterministic clocks for boundaries, actual server/browser for end-to-end proof.

| ID | Scenario | Required observable result |
| --- | --- | --- |
| A01 | Existing pre-rollout bearer, auth cookie, WS query JWT | Every protected admission rejects; no trusted legacy-claims fallback. Updated UI asks password, then enrollment. |
| A02 | Already-connected pre-rollout clients at deployment | Old serving instances drained/restarted; reconnect cannot keep old authority. |
| A03 | New registration before operator approval | No full session; account remains disabled. After approval password leads to enrollment. |
| A04 | Enrollment setup via QR and via manual key | Both encode identical key/issuer/account/SHA-1/6 digits/30-second parameters; independent authenticator works. No full session before first valid code. |
| A05 | Wrong, malformed, expired, or replayed first code | Enrollment not activated, no full cookie/JWT; errors do not leak seed. |
| A06 | Competing enrollment challenges/two concurrent confirmations | Exactly one factor activation; losing challenge cannot overwrite factor or issue alternative authority. |
| A07 | Correct password for enrolled account | Challenge only; app REST/WS/media/plugin denied until fresh TOTP. |
| A08 | Same code submitted concurrently to login/step-up challenges | Atomic matched-step claim permits at most one success, including separate instances/devices. |
| A09 | Adjacent TOTP windows and leading-zero code | +/-1 step accepted once under chosen policy; older/equal used step rejected. More distant steps rejected. |
| A10 | Immediately before/at/after day-10 MFA deadline | Before allows; exact/after blocks protected APIs and requires MFA without password if absolute session still valid. |
| A11 | Correct day-10/day-20 step-up | Same session ID and issuedAt/expiresAt; credentialVersion advances; old bearer/cookie invalid, new transport works. |
| A12 | Immediately before/at/after day-30 absolute expiry | Exact/after full password+fresh TOTP; no code-only renewal even with pending challenge. Full expiry wins simultaneous MFA deadline. |
| A13 | Session idle, browser sleep, server restart, client clock changed | Neither deadline extends; server clock/store authoritative, TTL deletion delay irrelevant. |
| A14 | Two sessions/devices for same user | Proof in A does not extend B's MFA freshness; replay rule still account-wide for same code. |
| A15 | Challenge used for wrong purpose/session/revision/account | Denied; challenge never works as app bearer/cookie/WS/media authority. |
| A16 | Replay successful challenge; challenge TTL exact edge | No second session/update; at expiresAt denied even if Mongo TTL has not deleted row. |
| A17 | Failure limits, new challenges, server restart | Account window cannot be reset by challenge churn/restart; correct Retry-After; bounded cooldown rather than permanent lockout. |
| A18 | DB failure between proof consumption and session write | No unpersisted full session; replay cursor not rolled back; user can start new flow with next code. |
| A19 | Missing/wrong encryption key or DB unavailable | Authenticated startup/operation fails closed; explicit no-auth still follows its existing restrictions. No plaintext/legacy fallback. |
| A20 | Logout including stale-MFA session; copied JWT | Durable revoke; copied JWT and derived capabilities denied; cookie cleared; idempotent retry. |
| A21 | MongoDB reset while active: atomic unset mfa + authVersion increment | All sessions and pending challenges denied; password -> fresh setup; re-enrollment never revives prior tokens. |
| A22 | Reset wrong ID/stale expected version | Zero matches => operator stops; no unintended account mutation. Password/role/approval unchanged. |
| A23 | Disable/delete account after password challenge | Challenge completion/protected access denied; no stale enablement privilege. |
| A24 | Open WS crosses known MFA/session deadline, idle or backpressured | Close emitted without waiting for next inbound message; pumps, uploads, subscriptions and plugin epoch retired; server PTY retained. |
| A25 | REST/WS operation after DB reset and existing output | New admission checks live state; ongoing output stops within documented <=5-second polling interval + bounded DB timeout. DB failure closes rather than allows indefinitely. |
| A26 | Media cookie and exact-origin ticket-only paths after cutoff | HEAD/GET/range denied non-disclosing 404; no bearer fallback; existing slow stream terminates at deadline/revocation bound. |
| A27 | Media issue/reuse just before cutoff or token replacement | Lease cannot exceed auth deadline or reuse old session revision; replacement acquires fresh bound media session. |
| A28 | Plugin and host-management operations during stale MFA | Denied despite grants/role/old epoch; sensitive-action password checks remain additional. |
| A29 | Profile A stale, profile B healthy | A prompts/retires its transport; B remains connected and unaffected. No global logout/cache wipe. |
| A30 | Late setup/verify response after profile URL/type edit, deletion, draft replacement, generation change | Discarded; token/secret cannot cross endpoint/owner boundary. |
| A31 | Multiple browser tabs, stored token replaced | Old transport retired; new credential loaded for matching endpoint/profile; no endless reconnect or accidental fresh 30-day deadline. |
| A32 | Authenticated storage write unavailable | Error surfaced; no silent token persistence success, unrelated profiles retained. |
| A33 | Auth secrets inspected in logs/storage/caches/network | No plaintext server seed at rest; setup data only in no-store encrypted transport; no OTP/URI/seed in logs, diagnostics or persistent browser storage. |
| A34 | Desktop browser, native shared host, Android Chrome | QR/manual setup and password/code entry usable; actual UI proof, not just rendered mock. Preserve unrelated input policy. |
| A35 | --no-auth locally and production safety restrictions | Local developer flow unchanged; DB/production restrictions still deny forbidden combinations. No production plugin authority granted. |
| A36 | Client/server cutover and rollback | All legacy-only instances out of service; no mixed-mode bypass. Rollback only to compatible MFA build or fail-closed maintenance. |

## Verification layers

- Permanent policy/TOTP tests: boundary precedence, window/replay rules, state transitions, single-use conditions.
- MongoDB integration: atomic races, reset epochs, restart/throttle durability, cross-document failures, actual protected handler decisions.
- Existing UI behavior tests: owned async completion, error classification, retained expiry, token replacement, multi-profile isolation. Avoid source-text/wording/mock echo assertions.
- Real HTTP/WS/slow-stream smoke plus actual browser/app enrollment: mandatory release proof. Independent code generator/app confirms QR and manual-secret interoperability.
- Secret-bearing enrollment screenshots are temporary only; redact or discard before storing evidence.

## Unresolved questions

None. User validated native keyboard entry for authentication only on Android Chrome; A34 must prove that exception while unrelated terminal/editor restrictions stay intact. No MFA exemption.
