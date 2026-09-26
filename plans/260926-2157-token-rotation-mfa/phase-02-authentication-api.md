# Phase 02 — Enrollment, verification, and session API

## Context links

[Plan](./plan.md) · [Contract/API table](./security-contract.md#proposed-http-contract) · [Phase 01](./phase-01-auth-state-and-policy.md) · [Existing API docs](../../docs/api-reference.md#authentication)

## Overview

Date: 2026-09-27. Priority: P1. Status: DONE (2026-09-27; 100%). Implementation: complete. Review: approved with findings.

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

- [x] Replace login token response with restricted states.
- [x] Implement setup, confirm, login verify, and periodic challenge/verify.
- [x] Converge status/logout with durable policy.
- [x] Freeze error/deadline DTOs for Phase 04.

## Success Criteria

Password alone cannot call a protected endpoint. First code completes enrollment exactly once; wrong/expired/replayed codes never issue a session. A day-10 code replaces credential but preserves day-30 expiry; at day 30 only fresh password+code works. Logout makes copied JWT unusable.

## Risk Assessment

Lost successful response may require full login; never accept an old credential as a convenience fallback. Old clients will not understand challenges and must fail closed, with an actionable upgrade/login message in new clients.
Code review approved Phase 02 with findings (8.5/10); account-enumeration/timing, public-login body/IP throttling, the legacy status fallback, and the step-up credential policy require explicit follow-up disposition before release. See [review report](../reports/code-review-260927-0031-phase-02-auth-api.md).

## Security Considerations

Session and challenge tokens are distinct types/purposes. Restrict stale credentials to status/challenge/logout only; media/plugin/terminal access remains denied. Keep stricter sensitive-action password confirmation unchanged.

## Next steps

Phase 02 — DONE (2026-09-27; 100%). Scoped tests passed 28/28. Review approved with findings; this is not production qualification. Next is Phase 03: enforce authentication and session policy across remaining subsystems (WebSocket, media streaming, plugin runner/epochs, and filesystem/terminal routes). Phase 04 consumes the frozen DTOs in the React workbench UI. See the [test report](../reports/tester-260927-0056-phase-02-authentication-api.md) and [review report](../reports/code-review-260927-0031-phase-02-auth-api.md).
