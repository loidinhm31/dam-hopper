# Phase 01 — Auth state, cryptography, and policy

## Context links

[Plan](./plan.md) · [Security contract](./security-contract.md) · [Server inventory](./research/server-auth-inventory.md) · [TOTP research](./research/totp-security.md)

## Overview

Date: 2026-09-26. Priority: P1. Status: DONE (2026-09-26; 100%). Implementation: complete. Review: complete.

## Key Insights

- Existing MongoDB `users` hold bcrypt password, enablement, and role; JWT secret is already persisted separately.
- Existing `aes-gcm`, `rand`, `sha2`, and `zeroize` avoid a new encryption stack. TOTP still needs a maintained implementation.
- No configured LSP in planning session. At implementation, check availability before changing exported actors/helpers and resolve all references.

## Requirements

Mandatory claim version; strict 30-day expiry and 10-day session-local MFA; confirmed enrollment; atomic replay protection; durable reset/logout. Support standalone MongoDB using conditional document updates, not mandatory transactions. Secret key absent/invalid => authenticated-mode startup fails.

## Architecture

Introduce a narrowly scoped `server/src/auth/` module: model, store, policy, TOTP/encryption. Keep Axum DTO/handlers in `api/auth.rs` and small `api/auth_mfa.rs` if necessary. `AppState` owns one auth service; user/session/challenge documents follow security-contract fields. Auth decision distinguishes authenticated, MFA required, full login required, and unavailable. Only explicitly named development mode bypasses production state.

## Related code files

Modify: `server/src/api/auth.rs` (User/actor representation); `server/src/state.rs`; `server/src/main.rs`; `server/src/lib.rs`; `server/Cargo.toml`; `server/Cargo.lock`.

Create: `server/src/auth/mod.rs`, `model.rs`, `store.rs`, `policy.rs`, `totp.rs`, `secret.rs` (Rust snake_case by repo convention). These are proposed paths, not existing modules. Reuse existing configuration/secret-loading conventions; no second user repository.

## Implementation Steps

1. Inventory all auth helper/actor references and current database initialization; freeze protocol fields from contract. Extract account lookup without changing password hashing or registration approval semantics.
2. Add explicit authVersion and confirmed MFA decoding, sessions, and hashed opaque challenges. Pin auth protocol claims; reject missing fields instead of legacy defaults. Migrate users lacking version safely without changing passwords/roles.
3. Create indexed session/challenge lookups and BSON-date TTL cleanup. Expiration checks must work before TTL deletion. Audit username duplicates before adding any uniqueness constraint; do not silently delete or merge accounts.
4. Implement injectable server clock and pure decision table: account disable/reset -> deny; absolute expiry -> full login; stale MFA -> restricted step-up; otherwise allow. Require claim/document identity, version, revision, and absolute-expiry agreement.
5. Add dedicated MFA key-file loader with safe permissions/ACL and no overwrite/regeneration. Use AES-GCM envelope + account/purpose AAD for pending and confirmed secrets; decrypt only during verification.
6. Add maintained TOTP crate after dependency/MSRV review; configure SHA-1/6 digits/30 seconds/+/-1 step, preserve leading zeros, expose matched step for atomic replay fencing. Reuse frontend QR renderer later.
7. Implement store CAS primitives: enrollment absent+epoch fence, monotonic TOTP step, one-time challenge consumption, session revision update, session revocation. Explicitly handle partial cross-document failure by denial, never replay rollback.
8. Add bounded persistent account/challenge attempt tracking and source throttling. Missing MongoDB/key fails closed; never enable no-auth as operational fallback.

## Todo list

- [x] Freeze actor/claims/database contract and migration behavior.
- [x] Add auth store/index initialization and pure timing policy.
- [x] Add encrypted secret storage and strict TOTP verification.
- [x] Add CAS/replay/attempt-limit primitives and controlled clock seam.

## Success Criteria

Deterministic boundary/race tests demonstrate expired/stale/disabled/reset states denied and only one concurrent TOTP consumption wins. Restart preserves sessions, replay counter, attempts, and encrypted enrollment. DB contains no plaintext setup secret. No production credentials required for tests.

## Risk Assessment

Cross-document writes can consume proof without returning a session; safe failure requires a new code/login. Authenticated requests gain database dependency; use indexed narrow projections and bounded I/O. Do not cache admission long enough to revive reset sessions.

Review follow-ups remain visible for qualification: key-file loading still has the reported metadata/read TOCTOU risk; account attempt updates are non-atomic; index-creation errors are ignored. The review report also records sequential lookup, constant-time TOTP-window, and raw-key parsing improvements. Current policy code enforces claim/session expiry agreement.

## Security Considerations

Separate signing/encryption keys; no legacy claim fallback. Never serialize secret fields into public user DTOs. TOTP seeds cannot be one-way hashed because verification needs the seed. Keep account reset epoch monotonic, including re-enrollment.

## Next steps

Phase 01 — DONE (2026-09-26; 100%). The code-review report records 5/5 targeted auth tests and 1,515 server tests passed (5 ignored), review score 9.0/10, no critical issues. The key-loader TOCTOU concern remains a production-qualification follow-up. Proceed to Phase 02; Phases 02–05 and release gates remain pending. See [review report](../reports/code-review-260926-2258-phase01-auth-state-and-policy.md).
