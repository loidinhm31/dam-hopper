---
title: "Mandatory TOTP, 10-day MFA checks, and 30-day token replacement"
description: "Plan mandatory QR/manual-key enrollment, bounded sessions, transport enforcement, and MongoDB-only recovery."
status: in-progress
priority: P1
effort: not-estimated
branch: feat/token-rotation-mfa
tags: [feature, auth, backend, frontend, database, api]
created: 2026-09-26
---

# Mandatory MFA and token lifecycle

Phase 01 implementation completed 2026-09-26; Phase 02, Phase 03, and Phase 04 completed 2026-09-27. Phase 05 remains pending. No production data changed.

## Policy

- Mandatory authenticator-app TOTP for every enabled password account.
- Enrollment shows **QR + equivalent plain-text setup key**; first correct code required before app access.
- Reject all legacy JWTs/cookies; existing users log in again and enroll. Newly approved accounts enroll too.
- Require TOTP again every **10 days per session**; user superseded the original 7-day request.
- Fixed **30-day** session lifetime. Expiry requires password + fresh TOTP to issue a new token/session; periodic MFA never extends it.
- Lost-factor recovery: privileged atomic MongoDB reset + session invalidation. No admin page, reset API/CLI, or recovery-code feature.
- Keep explicit development `--no-auth` restrictions and independent profile/generation ownership.

## Architecture decisions

Keep bcrypt, JWT transport, MongoDB, existing shared UI, and `react-qr-code`. Add MongoDB session/challenge state, encrypted TOTP secrets, user authVersion, and session credentialVersion. Challenge-only credentials never authorize workbench access. One policy covers REST, WebSockets, plugin epochs, and media capabilities. No refresh-token subsystem or identity-provider migration.

The [security contract](./security-contract.md) specifies states, schemas, API responses, concurrency, deadlines, secret provisioning, and MongoDB recovery. Phases 01–03 implement the auth-state/policy foundation, enrollment/session API, and transport enforcement; Phase 04 completes the profile-owned UI cutover, leaving qualification and rollout to Phase 05.

## Phases

| # | Phase | Status | Progress |
| --- | --- | --- | --- |
| 01 | [Auth state, cryptography, and policy](./phase-01-auth-state-and-policy.md) | DONE (2026-09-26) | 100% |
| 02 | [Enrollment, MFA, and session APIs](./phase-02-authentication-api.md) | DONE (2026-09-27) | 100% |
| 03 | [REST/live transport enforcement](./phase-03-transport-enforcement.md) | DONE (2026-09-27) | 100% |
| 04 | [Profile-owned enrollment and MFA UI](./phase-04-profile-mfa-flow.md) | DONE (2026-09-27) | 100% |
| 05 | [Qualification, rollout, and recovery](./phase-05-qualification-and-rollout.md) | Pending | 0% |


Plan progress: **IN PROGRESS (4/5 phases; 80%; updated 2026-09-27).**
Dependencies: Phases 01 -> 02 -> 03 -> 04 are complete; Phase 05 depends on all implementation phases. Do not deploy any intermediate password-only or UI-only state.

## Evidence and risks

Pre-Phase 01 baseline: `server/src/api/auth.rs` minted 30-day `sub`/`exp` JWTs after password verification, with no MFA/session revocation state. WebSocket authorization occurred at upgrade; media used independent capability auth. Phase 03 closes the remaining transport admission and live-session enforcement gaps; see its [phase plan](./phase-03-transport-enforcement.md) and [review](../reports/code-review-260927-0302-phase03-transport-enforcement.md).

- Shared UI owns connections by profile and generation; a global login gate would regress multi-server operation.
- Legacy JWT fixtures were migrated to V2 claims and hermetic mock-session evaluation; legacy-token rejection remains covered by Phase 03 transport tests. See the [review report](../reports/code-review-260927-0302-phase03-transport-enforcement.md).
- [Server findings](./research/server-auth-inventory.md), [TOTP security research](./research/totp-security.md), [client flow research](./research/client-auth-flow.md).
- [Acceptance matrix](./acceptance-matrix.md): exact deadline edges, replay races, legacy logout, live sockets/streams, profile isolation, recovery, fail-closed outages.
- Deployment prerequisites: dedicated protected MFA key file, compatible client/server rollout, isolated MongoDB for auth qualification, encrypted network transport.
- Manual MongoDB reset is privileged recovery. New admissions fail immediately; existing output has a documented bounded revalidation delay. Restart/disconnect instances for immediate containment.
- Phase 02 evidence: scoped validation passed 28/28; code review approved (8.5/10) with findings. Review items remain follow-ups before release qualification; see [tester report](../reports/tester-260927-0056-phase-02-authentication-api.md) and [review report](../reports/code-review-260927-0031-phase-02-auth-api.md).

## Workflow status

Planning kickoff recorded direct instructions from published OMP skill files. The active-plan helper found no `EVCRATE_SESSION_ID`, so runtime activation was not persisted. Planning-time validation was documentation-only; Phase 01 implementation and scoped verification have since completed (see [phase plan](./phase-01-auth-state-and-policy.md) and [review report](../reports/code-review-260926-2258-phase01-auth-state-and-policy.md)). The review's key-loader TOCTOU concern remains a production-qualification follow-up.

## Validation Summary

Validated: 2026-09-26. Questions asked: 3. User explicitly confirmed:

- **Day 30:** password + fresh authenticator code; 10-day MFA checks do not extend absolute expiry.
- **Recovery:** MongoDB reset only; no recovery codes, admin page, reset endpoint, or reset CLI.
- **Android Chrome:** allow native keyboard for authentication only; keep terminal/editor restrictions.

Phase 04 decision: implement a narrow native-input exemption covering username/password/TOTP and required login controls, including the global input-policy guard; do not build a custom auth keyboard. This validation resolved the interaction decision; Phase 04 implementation and review are now complete (see the phase plan and Cycle 2 review).

Phases 01–04 implementation and development are complete; Phase 05 qualification/rollout remains pending.

## Unresolved questions

Product decisions: none. Phase 02 engineering follow-ups: (1) enforce the contract's Bearer-only step-up challenge policy (the current handler accepts cookie credentials); (2) decide whether source-IP throttling is proxy-owned or implemented in-process. See the [review report](../reports/code-review-260927-0031-phase-02-auth-api.md).
Key-file provisioning, isolated MongoDB, and actual desktop/native/mobile qualification remain Phase 05 qualification prerequisites, not unanswered product decisions.
