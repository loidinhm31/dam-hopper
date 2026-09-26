# Phase 02 — Enrollment, verification, and session API

## Context links

[Plan](./plan.md) · [Contract/API table](./security-contract.md#proposed-http-contract) · [Phase 01](./phase-01-auth-state-and-policy.md) · [Existing API docs](../../docs/api-reference.md#authentication)

## Overview

Date: 2026-09-26. Priority: P1. Implementation: pending. Review: pending. Replace password-only token issuance with purpose-bound enrollment/login/step-up flows.

## Key Insights

Current `login()` sets JWT and cookie immediately after password verification. `logout()` clears cookie and plugin epochs but does not revoke JWTs. `status()` and ordinary middleware have different account checks. These paths must converge on the same policy.

## Requirements

No usable session before first correct code. New login always proves TOTP; stale-but-unexpired session can prove TOTP without password; expired session cannot. Setup supplies equivalent QR URI/manual key. Registration still awaits approval. No reset API or recovery-code API.

## Architecture

Use the security-contract endpoint table as the sole wire definition. Login returns discriminated challenge state. Setup and verification endpoints validate restricted opaque challenge credentials directly; they do not pass through ordinary full-access middleware. Session minting and cookie creation occur only after persisted verification and enrollment/session state.

## Related code files

Modify: `server/src/api/auth.rs`, `server/src/api/router.rs`, `server/src/api/mod.rs`; Phase 01 auth modules.

Create: `server/src/api/auth_mfa.rs` if splitting enrollment handlers keeps `auth.rs` focused. No separate login implementation or compatibility aliases.

## Implementation Steps

1. Add camelCase DTOs, `authProtocol: 2`, typed auth error codes, and cache prevention. Preserve `workbenchProtocol: 2`, role handling, and existing `--no-auth` response semantics.
2. Change password login to create 5-minute enrollment/login challenges after enabled-account bcrypt verification. Clear password buffers, and never mint JWT or authenticated cookie here in normal mode.
3. Implement setup endpoint returning the same pending secret on repeat fetch; encode issuer/account safely in otpauth URI. No setup lookup by username or authenticated session alone.
4. Implement enrollment confirmation: validate challenge/purpose/epoch, verify code, CAS absent enrollment, record consumed step, consume challenge, persist full session, issue JWT/cookie. A stale competing setup cannot replace confirmed enrollment.
5. Implement login-code verification through same verifier; consume challenge and replay step before session issuance. Deny disabled/reset/deleted accounts even if password was checked moments earlier.
6. Implement restricted step-up challenge issuance for unexpired current bearer credentials even when MFA stale. Bind challenge to session ID/revision. Successful code atomically changes freshness and credentialVersion only; keep issuedAt/expiresAt fixed.
7. Make status return deadlines and structured MFA-required/full-login state without granting access. At simultaneous expiry, return full login; do not offer code-only renewal.
8. Make logout revoke persisted session even when MFA stale, clear cookie idempotently, and revoke dependent resources through Phase 03 integration. Do not require successful MFA to log out.
9. Apply body-size limits, challenge/account/IP rate limits, JSON/origin restrictions, no-store headers, and secret-free errors. No trust in body-supplied subject or server timestamps.

## Todo list

- [ ] Replace login token response with restricted states.
- [ ] Implement setup, confirm, login verify, and periodic challenge/verify.
- [ ] Converge status/logout with durable policy.
- [ ] Freeze error/deadline DTOs for Phase 04.

## Success Criteria

Password alone cannot call a protected endpoint. First code completes enrollment exactly once; wrong/expired/replayed codes never issue a session. A day-10 code replaces credential but preserves day-30 expiry; at day 30 only fresh password+code works. Logout makes copied JWT unusable.

## Risk Assessment

Lost successful response may require full login; never accept an old credential as a convenience fallback. Old clients will not understand challenges and must fail closed, with an actionable upgrade/login message in new clients.

## Security Considerations

Session and challenge tokens are distinct types/purposes. Restrict stale credentials to status/challenge/logout only; media/plugin/terminal access remains denied. Keep stricter sensitive-action password confirmation unchanged.

## Next steps

Phase 03 enforces the policy everywhere; Phase 04 uses the frozen DTOs. No intermediate deployment before both are complete.
