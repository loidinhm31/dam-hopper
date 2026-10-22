# Device login management contract

## Scope
Account login sessions on the selected DamHopper server. Not physical device identity, per-project permissions, enrollment approval, IP tracking, or session lifetime changes. Reuse AuthSession and existing live authorization enforcement.

## Backend API
- Protected `GET /api/auth/sessions?cursor=<opaque>`.
- Response `{ sessions: AuthSessionInfo[], nextCursor: string | null }`.
- `AuthSessionInfo`: `{ id: string, userAgent: string | null, issuedAt: string, expiresAt: string, mfaVerifiedAt: string, current: boolean }`. Dates RFC3339 UTC.
- Only caller username, matching current account authVersion, unrevoked, expiresAt > now. MFA-due sessions remain listed. Newest first by `(issuedAt DESC, id DESC)`.
- Page size fixed 50, fetch 51 to determine next cursor. Stable validated cursor encodes last row timestamp and ID; invalid cursor => 400. No silent truncation. Current session may occur on later pages; use `current`, never assume first row.
- Protected `DELETE /api/auth/sessions/{id}` requires a validated explicit Bearer credential; cookie-only or malformed-header fallback cannot authorize mutation. Storage predicate includes authenticated username and ID. Return 204 for owned existing record including already revoked; preserve original revokedAt. Return indistinguishable 404 for foreign/missing record. Never emit Set-Cookie: self-revocation invalidates the server-side session and clears the owning profile's local credentials, without erasing unrelated or replacement browser cookies. A retained revoked cookie grants no access.
- Both endpoints Cache-Control: no-store including errors; use existing auth error conventions. `--no-auth`: 409 with code `DEVICE_SESSIONS_UNAVAILABLE`, no fabricated devices or successful revocation.
- New optional AuthSession.userAgent defaults null for legacy Mongo. Capture only at full MFA session creation from HeaderMap, bounded to <=512 UTF-8 bytes on a character boundary, empty/absent => null. Preserve across step-up. Never store IP, browser fingerprint, token, or arbitrary extra headers.
- Additive versioned SQLite migration, legacy database upgrade. Mongo and SQLite equivalent list/revoke semantics, deterministic ties and useful query index.

## Frontend
- Add `Login devices` section to ServerSettingsDialog for saved authenticated target only; do not use editable unsaved URL/token as device authority.
- Typed auth-client helpers accept explicit server URL/token and abort signal; follow secure bearer transport rules and selected profile authentication policy, never accidentally use another profile's cookie. Session DTO decoded at boundary.
- List user agent as an untrusted browser/client hint, login time, expiry and `This session`; legacy fallback `Unknown browser/client`. Explain account/server-wide scope.
- Initial loading, load failure + retry, empty list, unsupported no-auth, refresh, load more and mutation failure states. Bounded scroll/word-wrap at narrow viewport.
- Explicit confirmation before each revoke, stronger warning for current session. Only remove item after server acknowledgement. Revoking another session preserves current login. Self revoke clears/disconnects only exact captured profile credential/connection; no global username clearing or ambient-profile mutation. Handle WS revocation arriving before DELETE response.
- Capture and fence profile ID, URL, credential and connection generation across async boundaries; superseded results never affect newer login, edited/deleted profile or newly selected profile. Cancel stale requests. No secrets persisted in query keys or UI data.
- On acknowledged self-revocation, clear only the dialog draft/initial credential belonging to that revoked login; Save must not restore it or overwrite a replacement login. Preserve any new in-progress login draft.

## Parallel ownership
- Backend phase owns server/** exclusively, including server regression tests and all constructors impacted by AuthSession addition.
- Frontend phase owns packages/ui/** exclusively, including client DTOs/helpers and UI behavior regressions.
- Parent owns integration/runtime smoke, plans/** and docs/** until documentation delegation.
- Both implementation phases start only after this contract and plan freeze; no shared file ownership. Build/lint/tests/formatters run once after implementation gate, not mid-flight.

## Acceptance / verification
- Real SQLite persistence: legacy migration; optional/oversized metadata; own active-session pagination, timestamp ties, authVersion filtering, MFA-due visibility; foreign and missing mutation isolation; idempotent revoke from survivor; current-session revocation without cookie writes; cookie-only/invalid bearer mutation rejection without storage writes; no-auth unavailable; no secrets in DTO.
- Real authenticated runtime: at least two same-account sessions plus foreign user; revoked token rejected for protected HTTP/new WS, existing WS closes while survivor works. Exercise issued media tickets/live stream and resource events where supported; describe periodic/read-driven cutoff honestly.
- Actual full app Chromium: open selected server settings, inspect device hints/current marker; revoke other login and confirm access denied, preserve current; self revoke; narrow viewport. Use real backend, no mocked endpoint success.
- Run requested existing full suite through tester; report environment failures/skips honestly and resolve reachable failures. Independent code/security review. Update API/auth usage, architecture, roadmap/changelog and plan evidence after runtime proof.
