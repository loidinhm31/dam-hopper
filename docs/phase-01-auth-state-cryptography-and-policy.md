# Phase 01 — Auth State, Cryptography, and Policy

**Status:** Implementation complete; foundational state and policy only. The Phase 01 plan records 5/5 focused unit and integration tests passed. See the [phase plan](../plans/260926-2157-token-rotation-mfa/phase-01-auth-state-and-policy.md) for its requirements and evidence.

## Scope and integration boundary

Phase 01 adds the MongoDB-backed auth-state model, persistence primitives, cryptographic helpers, TOTP verification, and deterministic session-policy evaluator. Phase 02 wires them into challenge-based login, enrollment, verification, status, and logout; see the [Authentication API](./authentication-api.md).

- `AppState` owns an `Arc<AuthService>`; `evaluate_claims` loads current session/user state and invokes the shared policy evaluator.
- Phase 03 uses that evaluator for protected REST middleware and WebSocket admission. `AuthenticatedActor` carries non-secret session identity/version and effective deadline; no raw bearer material is retained.
- WebSockets check the local deadline on inbound frames and outbound writes, with a five-second background session/revocation watcher. Image/video media capabilities bind to the auth session and versions, clamp absolute TTL to the effective deadline, and revalidate live streams.

Session issuance and every protected REST admission enforce the 30-day absolute and 10-day MFA freshness deadlines. Existing WebSocket and media streams also enforce deadline and bounded revocation checks; see the [Phase 03 plan](../plans/260926-2157-token-rotation-mfa/phase-03-transport-enforcement.md) and [security contract](../plans/260926-2157-token-rotation-mfa/security-contract.md).

## Module map

| Path | Responsibility |
| --- | --- |
| `server/src/auth/model.rs` | User, MFA, session, challenge, V2 claims, and policy decision records |
| `server/src/auth/store.rs` | MongoDB collections, indexes, account/challenge attempts, session operations, and compare-and-swap (CAS) mutations |
| `server/src/auth/policy.rs` | Injectable clock, deadline calculation, session decision table, challenge readiness, and throttle constants |
| `server/src/auth/secret.rs` | MFA key-file loading and AES-256-GCM secret encryption/decryption |
| `server/src/auth/totp.rs` | Secret generation/encoding, `otpauth://` URI construction, TOTP verification, and replay check |
| `server/src/auth/mod.rs` | `AuthService`, opaque challenge-token generation/digesting, and state-backed claim evaluation |
| `server/src/state.rs`, `server/src/main.rs` | `AppState` ownership, key loading, and auth-store index initialization |
| `server/src/api/auth.rs` | Password login challenges, full-policy protected-route middleware, status/logout |
| `server/src/api/auth_mfa.rs` | Challenge-gated TOTP enrollment, login verification, and step-up handlers |
| `server/tests/auth_mfa_api.rs` | HTTP lifecycle coverage for enrollment, login MFA, session step-up/status/logout, and edge cases |
| `server/tests/auth_state_and_policy.rs` | Focused policy, encryption, TOTP/replay, throttle, and MongoDB-store coverage |
| `server/tests/transport_enforcement_phase03.rs` | REST, WebSocket admission/live revocation, logout, and reset integration coverage |

## Persisted state and policy

Collections use the existing `users` collection plus `authSessions` and `authChallenges`. Persisted model field names use camelCase; JWT claims use the explicit V2 fields `v`, `sub`, `sid`, `authVersion`, `credentialVersion`, `iat`, and `exp`.

| State | Contract |
| --- | --- |
| User | Retains username, password hash, enablement, and role. `authVersion` defaults to `0` when absent in legacy documents; optional `mfa` stores the confirmed encrypted factor and last accepted TOTP step. Failed-attempt window/count/cooldown are account fields. |
| Session | Binds one username to `authVersion`, `credentialVersion`, issue time, absolute expiry, most recent MFA time, and optional revocation time. |
| Challenge | Stores the SHA-256 digest of the client-facing random token as its ID, account/version, purpose (`enroll`, `loginMfa`, or `stepUp`), issue/expiry times, attempts/consumption state, and purpose-specific encrypted enrollment or session binding data. |
| Session decision | Requires enabled account, V2 claims, matching account/session/claim identity and versions, non-revoked session, and exact JWT/session expiry agreement. At `now >= expiresAt`, full login is required; before expiry, at `now >= mfaDueAt`, MFA step-up is required; otherwise access is allowed. |

Policy bounds are fixed in `policy.rs`:

| Bound | Value |
| --- | --- |
| Absolute session lifetime | 30 days; no expiry grace |
| MFA freshness | 10 days per session, clamped to absolute session expiry |
| Challenge lifetime | 5 minutes |
| Challenge verification attempts | 5 maximum |
| Account failed attempts | 10 within a 10-minute window, then a 10-minute cooldown |
| Auth protocol | V2 |

`AuthDecision` distinguishes full access, MFA-required step-up, full-login-required, and unavailable state. MongoDB TTL indexes support cleanup; request-time policy checks enforce expiries independently of TTL deletion.

`AuthStore` provides conditional enrollment confirmation, monotonic accepted-step advancement, one-time challenge consumption, session MFA revision advancement, and session revocation. Index setup checks for duplicate usernames before requesting a unique username index, and requests username lookup plus expiry TTL indexes for sessions and challenges. TTL deletion is garbage collection only; request-time checks enforce authorization deadlines.

## Cryptography and TOTP

`DAM_HOPPER_MFA_KEY_FILE` selects the dedicated 32-byte MFA encryption key. The file loader accepts 32 raw bytes, 64 hexadecimal characters, or 44 Base64 characters; it rejects symlinks and non-regular files, and on Unix rejects group/world permission bits. The key is held in zeroizing memory. When configured, malformed or unreadable key material fails startup. Production authenticated startup requires the key; non-production may construct the service without it.

MFA secrets are encrypted with AES-256-GCM using a random 12-byte nonce. Authenticated associated data binds the key ID, username, and purpose; ciphertext and nonce are Base64 encoded. Decryption requires the matching key ID and AAD and returns a zeroizing buffer. The key ID uses the configured file's UTF-8 stem, or `mfa-key-v1` when unavailable. Provision and back up this key separately from MongoDB; this phase does not create or rotate it.

TOTP uses a CSPRNG-generated 20-byte secret, Base32 provisioning, SHA-1, six decimal digits, a 30-second step, and a ±1-step window. Verification uses constant-time code comparisons and returns the greatest matching step. A step is eligible only if it is newer than `lastAcceptedStep`; the store CAS makes persisted advancement monotonic under concurrent use. Keep leading zeroes in submitted codes.

Challenge handles are generated from 32 random bytes and returned as hex; only their SHA-256 digest is persisted. Challenge checks validate purpose, consumption, expiration, and attempt limit. Account failure tracking is persisted so issuing a new challenge does not reset the account window.

## Startup and operational boundary

When MongoDB is configured, `main.rs` constructs `AuthStore` and requests index initialization; returned initialization errors are logged as warnings and do not abort startup. `AppState::new` constructs the shared service and loads `DAM_HOPPER_MFA_KEY_FILE` when configured. Production mode is identified by `RUST_ENV=production` or `ENVIRONMENT=production`; production startup requires MongoDB and the MFA key, and rejects the development bypass.

The MFA key is encryption material, not the JWT signing secret. Do not put it in MongoDB, expose it to the browser, or log its contents. Missing database state or failed session/user lookups result in an unavailable policy decision rather than an allow decision.

## Related documentation

- [Authentication API](./authentication-api.md) — Phase 02 route contract and JSON examples
- [API Reference](./api-reference.md#authentication) — server-wide route index
- [Configuration Guide](./configuration-guide.md#environment-variables) — environment-variable index
- [System Architecture](./system-architecture.md) — server-wide subsystem architecture
- [Phase 01 plan](../plans/260926-2157-token-rotation-mfa/phase-01-auth-state-and-policy.md) and [parent auth plan](../plans/260926-2157-token-rotation-mfa/plan.md) — implementation record and next-phase sequencing
