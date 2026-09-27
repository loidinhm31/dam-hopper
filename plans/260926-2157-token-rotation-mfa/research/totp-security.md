# TOTP security and Rust implementation choices

Scope: research only; recommendations for the MFA rollout. No source changes. The parent plan’s architecture is proposed, not implemented: MongoDB-backed sessions and purpose-bound challenges, a user `authVersion`, operator-only MongoDB reset, no recovery codes/UI/CLI, and an existing local `react-qr-code` dependency.

**Adopted plan overrides:** [security contract](../security-contract.md) is authoritative: 5-minute challenges; 5 attempts/challenge plus 10 failed attempts/account/10 minutes and a 10-minute cooldown; `DAM_HOPPER_MFA_KEY_FILE` key provisioning. Enrollment is bound to password-authenticated account/epoch, not a nonexistent full session; only step-up binds an existing full session. Recommendations below are research options, not additional requirements.

## Verified repository facts

- `server/Cargo.toml` has `mongodb = 3.5.2`, `bson = 3.1.0`, `aes-gcm = 0.10`, `hmac = 0.12`, `sha2 = 0.10`, `hkdf = 0.12`, `rand = 0.8`, `subtle = 2`, and `zeroize = 1` (lines 83–84, 146–162, 171–181). These provide useful building blocks for secret encryption and authentication, but do **not** provide a TOTP library: no TOTP crate is declared. Existing crypto dependencies do not imply a TOTP implementation.
- Per parent’s repository inspection, UI already depends on `react-qr-code`; render the provisioning URI locally in that component instead of adding a Rust QR encoder or sending the secret to a QR service. This is parent-reported, not independently inspected here.

## Recommendations

### TOTP profile and validation

- Use RFC 6238 with a 30-second time step, 6 decimal digits, `T0 = 0`, and HMAC-SHA-1 for broad authenticator-app interoperability. Generate a fresh, CSPRNG-backed 20-byte (160-bit) secret per account; encode it as Base32 for provisioning. RFC 6238’s SHA-1 compatibility is not a recommendation to use SHA-1 for password hashing.
- Permit at most one step of clock skew in either direction (three candidate steps total). This is a usability/security tradeoff; keep the window narrow. Use the server’s UTC Unix time. If a submitted value matches multiple candidate steps, use the greatest matching step so the replay cursor cannot move backward.
- Store `lastAcceptedStep` with the enrolled factor. After matching the code, claim it with one conditional atomic update on the user document: require the same user/factor and `lastAcceptedStep < matchedStep` (or absent), then set the matched step. Only the request whose update matches may authenticate. A separate read-then-write permits two concurrent requests to accept the same OTP. Do not store raw OTPs. A monotonic cursor intentionally rejects older still-window-valid steps after a newer one succeeds.
- Consider `totp-rs` as the Rust verification/provisioning-URI library rather than hand-writing HOTP truncation and URI encoding. It is **not** currently in Cargo dependencies; select and pin a maintained release only after confirming its documented algorithm/skew/check-at behavior and feature set. Return an `otpauth://` URI and let the existing browser QR dependency encode it locally; Rust-side QR generation adds no necessary capability. The library is an implementation convenience, not a substitute for atomic replay prevention, rate limits, or secret-at-rest protection.

### Secret storage and enrollment isolation

- Encrypt each TOTP secret at rest with AES-256-GCM, fresh unique random nonce per encryption, and authenticated associated data binding at least user ID plus purpose/version. Keep ciphertext, nonce, and key version; zeroize transient plaintext where practical. Keep the encryption key outside MongoDB in deployment secret storage. Use an independently generated `TOTP_ENCRYPTION_KEY`, not the JWT signing key, OPAQUE session key, or a key copied from the database. If operations require derivation, derive a distinct labelled key with HKDF from a separately held root; simplest is a separate secret-manager key. Existing `aes-gcm`, `hkdf`, `rand`, and `zeroize` crates are available; key custody/rotation remain operational requirements.
- Enrollment must not activate a factor merely because a secret/QR was generated. Create a short-lived pending secret and a purpose-bound challenge tied to the authenticated user, current session, and `authVersion`; require a valid TOTP from that pending secret, then atomically consume the challenge and activate the factor. Use a short fixed expiry (e.g. 10 minutes), enforce expiry in the handler (MongoDB TTL cleanup is asynchronous), and prevent login/step-up/reset challenges from being used as enrollment confirmation. Encrypt pending secrets too; do not share pending fields with the active factor.
- Show the QR and its same Base32 setup key only to the authenticated enrolling user over TLS, during pending enrollment. Both representations disclose the same credential. Keep the `otpauth://` URI out of query strings, logs, tracing, analytics, error reports, screenshots/session-replay capture, and persistent browser storage. Render QR locally; set no-store/no-cache response policy for secret-bearing enrollment responses; remove/revoke the pending secret on successful confirmation, cancellation, or expiry. Do not log submitted OTPs.

### Replay, brute force, and reset

- Make replay claiming race-safe using MongoDB’s single-document atomic conditional update (MongoDB documents single-document writes as atomic). Verify the TOTP match before attempting the claim, but never treat the initial read as the final replay check. For multi-step tolerance, write the matched step, not merely the current wall-clock step.
- Enforce failed-code limits per account across server instances, with atomic counter/window updates; add an IP/network limit as a second control, not a replacement. Concrete starting policy: 5 consecutive failed TOTP attempts per account in 15 minutes, then temporary escalating cool-off capped at 15 minutes; clear the account failure state on success. Avoid permanent account lockout (easy denial of service); return generic authentication failures. These are recommended product defaults, not thresholds mandated by RFC/OWASP; monitor false lockouts and tune deliberately. Apply the same controls to enrollment confirmation and day-10 step-up, not just password login.
- Operator-only lost-factor recovery: one atomic update to the user record must `$unset` the active encrypted TOTP secret and replay cursor (and any pending enrollment fields) and `$inc` `authVersion` in the same operation. This is a manual MongoDB reset, not a page, endpoint, CLI, or recovery-code path. Since existing JWTs have only `sub`/`exp`, an epoch field alone cannot revoke a self-contained token: every protected request must resolve its MongoDB session and enforce session/user `authVersion` equality (or equivalent revocation check). Bind pending challenges to the same epoch so reset makes them unusable. The operator’s follow-up is normal enrollment again; do not expose the former secret. Audit the operator action through existing operational controls, never by recording the secret.

### 10-day step-up, 30-day hard expiry, and boundaries

- Record immutable `session.createdAt` and absolute `session.expiresAt = createdAt + 30 days`, plus the timestamp/step of latest successful MFA. At `now >= lastMfaAt + 10 days`, require fresh TOTP; on success update only MFA freshness/credential version. **Do not move `expiresAt`**. At `now >= expiresAt`, reject the old session and require password plus fresh TOTP for a new full session; activity and day-10 step-up never slide the 30-day deadline.
- Compare server-side UTC instants and define expiry as inclusive at the deadline (`now >= deadline` means expired). Apply the same equality rule to challenge expiry. Define day-10 due as `now >= lastMfaAt + 10 days`; success at or after due starts a new 10-day interval. TOTP’s 30-second counter uses Unix time, independently of the session cadence. Do not add a grace period beyond the explicitly chosen ±1 TOTP step.
- Enforce expiry and epoch on each protected request/message, not only at connection setup. Long-lived streams/output need bounded periodic session checks; parent’s proposed ~5-second check plus a bounded database timeout is a practical upper bound for observing out-of-band operator resets. Reject new work against the live session state. State any residual in-flight work boundary explicitly; a periodic check cannot retract bytes already delivered.

## Compliance note

The custom 10-day MFA re-check and 30-day session expiry are product policy, **not a claim of NIST AAL2 compliance**. Do not label this design NIST-compliant: AAL assessment covers the complete authenticator, verifier, session, and reauthentication controls, not just the TOTP algorithm. Use the current NIST SP 800-63B publication if a compliance target is later required.

## Sources

- [RFC 6238 — TOTP](https://www.rfc-editor.org/rfc/rfc6238.html): TOTP construction, time-step definition, SHA-1/SHA-256/SHA-512 options, 30-second recommended default, clock-drift handling and shared-secret protection.
- [RFC 4226 — HOTP](https://www.rfc-editor.org/rfc/rfc4226.html): underlying HOTP construction and key-generation/security considerations.
- [OWASP Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html): factor lifecycle, secure enrollment, recovery, throttling, and secret handling guidance.
- [`totp-rs` crate documentation](https://docs.rs/totp-rs/latest/totp_rs/): candidate Rust API/library documentation; dependency is not present in `server/Cargo.toml`.
- [MongoDB Rust driver compound operations](https://www.mongodb.com/docs/drivers/rust/current/crud/compound-operations/) and [MongoDB single-document atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/): conditional `find_one_and_update`-style claim and atomicity basis. Validate exact builder API against the pinned driver version.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): current digital identity and authentication requirements; compliance target is intentionally out of scope.

## Unresolved questions

- None for this research slice. Product defaults above (especially ±1 step and 5 failures/15 minutes) are recommendations requiring explicit adoption in implementation.