# Token rotation and mandatory MFA — command overview

Planning only; no application implementation. [Main plan](./plan.md) · [Security contract](./security-contract.md) · [Acceptance matrix](./acceptance-matrix.md).

| Phase | Status | Progress |
| --- | --- | --- |
| [01 Auth state and policy](./phase-01-auth-state-and-policy.md) | Pending | 0% |
| [02 Authentication API](./phase-02-authentication-api.md) | Pending | 0% |
| [03 Transport enforcement](./phase-03-transport-enforcement.md) | Pending | 0% |
| [04 Profile MFA flow](./phase-04-profile-mfa-flow.md) | Pending | 0% |
| [05 Qualification and rollout](./phase-05-qualification-and-rollout.md) | Pending | 0% |

Policy: mandatory TOTP; QR + manual setup key; all old sessions rejected; MFA every **10 days**; fixed **30-day** password+TOTP renewal; operator-only MongoDB reset. No recovery-code feature, admin page, reset endpoint/CLI, or refresh-token subsystem.

Dependencies: 01 -> 02 -> 03, with 04 consuming frozen 02 contracts; 05 gates release after all phases. Standalone MongoDB, dedicated protected MFA key, matched server/client deployment, actual browser/socket/media verification.

Active-plan helper ran, but runtime did not supply EVCRATE_SESSION_ID: plan activation not persisted. No application tests/build/smoke run for this planning-only task.

## Unresolved questions

None. [Validation summary](./plan.md#validation-summary): password+TOTP at day 30, MongoDB-only recovery, native keyboard allowed for auth only on Android Chrome. Plan ready for separate implementation authorization.
