# Mandatory MFA and session lifecycle contract

Status: Phases 01–05 complete (2026-09-27). Phase 05 qualification and Cycle 2 review are approved; production rollout remains subject to key provisioning, compatible client/server builds, and the open security gates recorded in the Phase 05 plan.

## Enhanced `/cmd-plan__hard` task

Plan a clean authentication cutover for the Rust/Axum server and shared React UI: require authenticator-app TOTP for every enabled password account; display both a QR code and equivalent plain-text setup key; verify enrollment before admitting workbench access. Reject every pre-rollout login token and force password login plus enrollment. Enforce a fixed 30-day session lifetime, after which password and a fresh TOTP code are required to issue a replacement token. Require TOTP again every **10 days per session**, replacing the original 7-day request, without extending the 30-day deadline. Preserve explicit local no-auth development and all multi-profile ownership boundaries. Recover lost authenticators through direct, privileged MongoDB changes, not an admin page, reset endpoint, or reset CLI. Plan server persistence, API/UI states, all live transport/capability boundaries, migration, security controls, and real acceptance scenarios. Do not implement.

## Confirmed requirements and conservative interpretations

- User selected authenticator TOTP and mandatory enrollment for every account.
- User explicitly changed 7-day verification to **10 days**.
- Fixed 30-day password-plus-TOTP renewal was stated after clarification; no silent/background refresh and no expired-token renewal credential.
- User prefers manual MongoDB recovery because there is no admin page. Plan operator-only recovery; do not add recovery codes, email/SMS, WebAuthn, an admin UI, or a reset command.
- New registration retains existing `isEnabled: false` approval policy. Approval does not waive MFA.
- One account may have several sessions. A new password login always requires its own MFA proof.
- Existing cookies/localStorage credentials are rejected server-side, not merely deleted by updated UI.

## State and deadlines

| State | Allowed | Transition |
| --- | --- | --- |
| Logged out / legacy / expired / revoked | Password login, existing registration, public health | Valid enabled-account password -> enrollment or login-MFA challenge |
| Enrollment required | Read setup payload; submit first TOTP using enrollment challenge | Atomic enrollment confirmation -> full session |
| Login MFA required | Submit TOTP using login challenge | Valid unreplayed TOTP -> full session |
| Authenticated | Protected operations | Earliest of MFA deadline, absolute expiry, revocation |
| MFA due | Status, session-bound step-up, logout only | Fresh TOTP -> replaced credential, same absolute session expiry |
| Recovery reset | No old session or challenge access | Password login -> new enrollment |

- `issuedAt`: server UTC instant when full password+MFA session is created.
- `expiresAt = issuedAt + 2,592,000 seconds` (30 * 24 hours, not calendar months).
- `mfaVerifiedAt`: server instant of most recent successful proof for this session.
- `mfaDueAt = min(mfaVerifiedAt + 864,000 seconds, expiresAt)`.
- At `now >= expiresAt`, full login wins even when MFA is also due. At `now >= mfaDueAt` and before expiry, deny protected access pending TOTP.
- Explicit zero expiry grace; do not inherit JWT-library default leeway. Use server time, checked arithmetic, and injected clocks in tests, never browser timestamps.
- TOTP proof at day 10 or 20 changes only MFA freshness and credential revision. Replacement JWT still expires at day 30. Full login at expiry creates a fresh session ID/deadline.
- Suspension, restart, token copying, changing profile ID, and polling status never advance these timestamps.

## Persistence proposal

MongoDB remains the authoritative account/session store; no Redis or separate identity provider.

### `users` additions (camelCase persisted fields)

- Existing username, passwordHash, isEnabled, role preserved.
- `authVersion: int64`, monotonically incremented by recovery/reset. Missing is normalized to zero only during account migration/read; never default missing JWT claims.
- `mfa`: optional confirmed enrollment object with `secretCiphertext`, `nonce`, `keyId`, `enrolledAt`, `lastAcceptedStep`.
- `mfaAttemptWindowStartedAt`, `mfaAttemptCount`, `mfaBlockedUntil`: persistent account-level throttling survives new challenges and restart.
- A missing `mfa` object means enrollment required, never MFA exempt. Pending setup secret belongs to its enrollment challenge, not confirmed user state.

### `authSessions` (new)

- Random opaque `_id`/session ID; account identity, `authVersion`, `issuedAt`, `expiresAt`, `mfaVerifiedAt`, `credentialVersion`, `revokedAt`.
- JWT contains required `v: 2`, `sid`, `sub`, `authVersion`, `credentialVersion`, `iat`, `exp`; algorithm pinned to current server signing choice. No secrets/roles trusted from claims.
- Session document lookup by ID plus indexed account identity for targeted revocation. TTL index on BSON Date `expiresAt` for garbage collection only; all readers enforce deadlines themselves.
- Every successful periodic MFA compare-and-swap increments `credentialVersion`; old bearer/cookie is unusable immediately at new admission, even if copied before the challenge.
- Logout revokes this session durably, clears cookie, and retires dependent capabilities. Existing broader plugin actor-revocation behavior may remain conservative; do not make logout erase unrelated frontend profiles.

### `authChallenges` (new)

- Cryptographically random opaque 256-bit challenge handle returned to client; only SHA-256 digest stored as lookup key.
- Fields: account identity, authVersion, purpose (`enroll`, `loginMfa`, `stepUp`), createdAt, expiresAt, attempts, consumedAt; step-up also binds exact session ID and credentialVersion.
- Enrollment challenge additionally contains encrypted pending secret. Lifetime 5 minutes; no access credential cookie until completion. Setup response delivered over authenticated-by-challenge flow only.
- TTL cleanup is not authorization. Consume via conditional update; challenges are purpose-bound, expire explicitly, and reject after account reset/disable or session rotation.
- Sessions/challenges are separate collections to avoid growing the user document without bound. Use single-document CAS; do not require MongoDB replica-set transactions solely for this feature.

## Verification and concurrency

1. Validate input shape and purpose, rate limits, current account/version, challenge expiry and session deadline before expensive work.
2. Account enrollment must be absent for setup; present for login/step-up. Competing enrollment challenges may exist but exactly one can commit (`mfa` absent + matching authVersion CAS).
3. Standard TOTP: random 160-bit secret, Base32 manual key, SHA-1 interoperability, six digits, 30-second step, accepted skew +/-1 step. Leading zeroes retained. Reject invalid length/non-digits.
4. Find matched timestep with constant-time comparisons; accept only if strictly newer than confirmed `lastAcceptedStep`. Atomically advance counter with matching encrypted-secret identity/authVersion to prevent concurrent replay. Enrollment confirmation records its used step too.
5. Consume challenge once with a conditional update. Then update session freshness/revision or insert a new session. Recheck enabled account, version, and expected enrollment before returning a credential.
6. Cross-document failure fails closed: consumed proof may require waiting for the next code and restarting login; never roll back replay state or return an unpersisted session. Stale inserted sessions still fail current-account/version checks.
7. Sign replacement before publishing its session revision where practical; a lost response can require full login. No overlap grace accepting old credential and no unbounded retry/idempotency subsystem.
8. At most 5 code attempts per challenge and 10 failed code attempts per account per 10 minutes, then 10-minute cooldown. Add bounded source-IP login/challenge creation throttling; account identifiers from verified challenges, not arbitrary client keys. Challenge creation cannot reset account counters. Do not trust forwarded IPs without the existing trusted proxy boundary.
9. Return `429` + `Retry-After` for limits; generic verification errors; avoid account discovery beyond existing authenticated flow. Database/key unavailability is `503`, never auth bypass.

## Secrets and provisioning

- Reuse `aes-gcm`, `rand`, `sha2`, `zeroize`; select maintained TOTP crate after version/MSRV/dependency review. No homemade HMAC/TOTP algorithm.
- Dedicated 32-byte MFA encryption key supplied by an explicitly configured secret file (`DAM_HOPPER_MFA_KEY_FILE` proposed); load into zeroizing memory at startup. Key not sourced from JWT secret, database, OPAQUE, or browser.
- Nonce unique/random per encryption; AAD binds account identity, key format/version, and enrollment purpose. Versioned ciphertext envelope enables future controlled key migration without implementing key rotation UI now.
- Authenticated mode fails startup if key absent/invalid/insecure; no auto-regeneration that silently loses existing factors. Local `--no-auth` does not require an MFA key. Extend the existing deployment secret-file ownership/permission model, including Windows ACL documentation.
- Back up encryption key separately from MongoDB; restore both together. Loss of key requires operator resets/re-enrollment, not plaintext fallback. Deploy all instances with matching key and signing configuration.
- QR encodes `otpauth://totp/...` with issuer `DamHopper`, correctly encoded account label, same key/algorithm/digits/period displayed in text. Use existing `react-qr-code` locally; never external QR service.
- `Cache-Control: no-store` for challenge/setup/session responses; no URI, secret, code, password, or token in logs/analytics/URLs/diagnostic exports. Client keeps challenge/setup secret only in ephemeral dialog state; no persistence.
- Preserve exact-origin CORS and no-referrer sensitive UI. Enrollment/step-up require JSON and explicit challenge/bearer authorization; reject cross-site cookie-only mutation. Auth cookies retain HttpOnly/SameSite; Secure under trusted HTTPS deployment, no untrusted forwarded-header inference.
- TOTP is phishable. The requested 10-day interval is product policy, not a claim of NIST AAL2 compliance.

## Proposed HTTP contract

Preserve `workbenchProtocol: 2` for transport compatibility; auth payloads introduce `authProtocol: 2` and explicit states. Existing clients cannot bypass MFA by ignoring fields.

| Endpoint | Credentials | Success |
| --- | --- | --- |
| `POST /api/auth/register` | Existing registration body | Existing pending-approval result, no session |
| `POST /api/auth/login` | username/password | `state: enrollmentRequired` or `mfaRequired`, challengeToken, challengeExpiresAt; no app token/cookie |
| `POST /api/auth/mfa/setup` | Enrollment challenge in JSON | secret, otpauthUri, issuer, accountName, algorithm, digits, period; repeated fetch returns same pending secret |
| `POST /api/auth/mfa/confirm` | Enrollment challenge + code | `state: authenticated`, token, expiresAt, mfaDueAt, user, role, authProtocol |
| `POST /api/auth/mfa/verify` | Login/step-up challenge + code | Same full-session response; step-up preserves absolute expiry |
| `POST /api/auth/mfa/challenge` | Current, unexpired Bearer session (MFA may be stale) | Purpose-bound step-up challenge; no protected access |
| `GET /api/auth/status` | Bearer or cookie | Full auth metadata while fresh; `401` with code `MFA_REQUIRED` and deadlines when stale |
| `POST /api/auth/logout` | Existing session credential; stale MFA permitted | Durable revoke + clear cookie; idempotent for missing/invalid credentials |

- Protected routes: `401` + machine-readable `AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, or `MFA_REQUIRED`; `503 AUTH_UNAVAILABLE` for state backend failure. Invalid/legacy tokens may use generic `AUTH_REQUIRED`.
- Never emit full account/session metadata for invalid token. A valid-but-stale session may receive only challenge UX metadata.
- Full expiration always wins over MFA. No refresh endpoint; replacement at 30 days is password login -> TOTP -> new session.
- Setup/confirm/verify endpoints sit outside full-auth middleware but require their own challenge validator; no public setup-by-username API.

## Continuous access enforcement

- One server auth service resolves signed claims + current session + enabled/enrolled user. Both full-access and restricted challenge eligibility call the same evaluator; no JWT-signature-only production admission remains.
- REST admissions are authoritative current-state reads; WebSocket admission uses the same full policy. The local session lease/effective deadline gates inbound dispatch/commit and outbound emission, avoiding per-frame database reads.
- A cancellation/deadline guard ends an already-open WebSocket at `min(mfaDueAt, expiresAt)`, even with no inbound messages or saturated output. Same teardown cancels pumps/uploads/subscriptions and revokes plugin epoch. Do not kill server PTY processes merely to require reauthentication.
- Live sockets/stream bodies revalidate account/session revocation at most every 5 seconds, sharing a per-session check where feasible rather than per-byte MongoDB reads. Bound each complete auth-state evaluation to 2 seconds, including driver selection/retries; fail closed on timeout. No output after known deadline; out-of-band reset cutoff is at most 7 seconds (5-second interval + 2-second evaluation). New HTTP/WS admission does not use this cache.
- Direct MongoDB updates have no application broadcast: document the above bound. For immediate operational containment, disconnect/restart serving instances during reset. Do not promise zero-latency invalidation from an out-of-band database edit.
- Media session/ticket records bind actual auth session ID/version and deadline in addition to actor/profile/client. Exact-origin ticket-only and cookie stream paths consult the same session policy; ticket possession cannot skip MFA.
- Media issue/reuse clamps capability expiry to auth deadline. HEAD/GET/range admissions recheck auth and preserve non-disclosing `404`; ongoing bodies terminate via deadline/revocation guard. Bytes already delivered/cached cannot be recalled.
- Plugin epochs expire no later than the auth deadline. HTTP admissions use current session policy; WebSocket operation boundaries enforce the local lease/deadline, while the watcher bounds out-of-band revocation. Preserve role/grant checks and host-action password confirmations; MFA is additional, not a substitute.
- Scope includes long-lived authenticated streams discovered during implementation inventory, not a login-only patch. Public exceptions must remain explicitly enumerated.
- WebSocket private close codes: `4403` MFA required; `4401` full login required (expired/revoked/legacy); standard `1013` temporary auth-backend unavailable. Keep existing `4001` overflow distinct. Browser handshake failures may hide HTTP bodies, so client performs typed HTTP status evaluation before deciding to reconnect.

## MongoDB recovery runbook design

Operator-only. No credentials or production database access used during planning. Verify the person's identity out-of-band first; MongoDB write access is privileged account-takeover authority.

One atomic change by immutable user `_id` (not unverified display name), with expected current version predicate, e.g. in an already authenticated `mongosh` session:

```javascript
// Substitute verified _id and observed version. Omit expected-version equality
// only for a legacy document and explicitly match authVersion: {$exists: false}.
db.users.updateOne(
  { _id: verifiedUserId, authVersion: observedVersion },
  {
    $inc: { authVersion: NumberLong(1) },
    $unset: {
      mfa: "",
      mfaAttemptWindowStartedAt: "",
      mfaAttemptCount: "",
      mfaBlockedUntil: ""
    }
  }
)
```

- Require matchedCount=1 and modifiedCount=1; otherwise stop and re-read, never blind retry with guessed identity/version.
- Epoch invalidates every old session and pending challenge without requiring a multi-collection transaction. Removing secret alone is insufficient: re-enrollment must never revive old tokens.
- Do not change passwordHash, isEnabled, role, signing key, or auth settings to bypass MFA. Optional expired-row cleanup is not part of correctness.
- Restart/disconnect serving instances if immediate stream cutoff is required. Verify old bearer/cookie/WS/media access denied; verify password leads to new QR/manual setup, and access remains blocked until first valid code.
- Do not manually insert an unencrypted secret or grant an `mfaDisabled` exception. Audit operator action outside application secret logs.

## Unresolved questions

None. User confirmed password+TOTP at day 30, MongoDB-only recovery without recovery codes, and Android Chrome native keyboard for auth fields only; see [validation summary](./plan.md#validation-summary). Deployment must supply the MFA key file and a real isolated MongoDB test instance; these are implementation prerequisites, not secrets to provide in chat.
