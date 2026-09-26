# Documentation Update — Phase 02 Authentication API

**Date:** 2026-09-27  
**Scope:** Enrollment, verification, session API, and related authentication documentation

## Current state assessment

The API reference and Phase 01 guide still described the old password-only login boundary. Response examples omitted challenge states and session deadlines. Developer/configuration examples also treated `server-token` as a user Bearer token, although it is the server JWT signing secret. The new reference separates the Phase 02 auth API from the still-pending broad protected-route enforcement.

## Changes made

- Added [`docs/authentication-api.md`](../../docs/authentication-api.md) with request/success shapes for login, setup, confirm, verify, step-up challenge, status, and logout. Documented normal and `--no-auth` responses, deadlines, cookies, no-store behavior, and auth errors.
- Updated [`docs/api-reference.md`](../../docs/api-reference.md) to link the dedicated reference and scope legacy-token rejection to `/api/auth/status`.
- Updated [`docs/phase-01-auth-state-cryptography-and-policy.md`](../../docs/phase-01-auth-state-cryptography-and-policy.md), [`docs/system-architecture.md`](../../docs/system-architecture.md), and [`docs/codebase-summary.md`](../../docs/codebase-summary.md) with Phase 02 implementation and Phase 03 enforcement boundaries.
- Added auth API navigation in [`docs/README.md`](../../docs/README.md). Updated auth guidance in [`docs/code-standards.md`](../../docs/code-standards.md), [`docs/configuration-guide.md`](../../docs/configuration-guide.md), and [`docs/linux-nohup.md`](../../docs/linux-nohup.md) so session JWTs are not confused with the signing secret.
- Updated [`docs/linux-release-manager.md`](../../docs/linux-release-manager.md) to call out its current local status-probe credential mismatch.
- Generated `repomix-output.xml` and refreshed the auth boundary summary in `docs/codebase-summary.md`.

## Gaps identified

1. **Protected-route enforcement remains Phase 03 work.** General `require_auth` still validates JWT signature/expiry without checking persisted session policy. WebSocket, media, plugin, and other long-lived enforcement is not claimed as complete here.
2. **Release diagnostics credential mismatch.** The local idle-status probe sends the raw `server-token` signing secret as Bearer. That value is not an MFA-issued session JWT and cannot authenticate in normal mode. The mismatch is now documented; the diagnostics credential source needs a supported service/session design.
3. **Profile-owned MFA UI remains a later phase.** The server API contract is documented; no claim of completed client migration is made.
4. **Existing oversized documentation remains.** New auth reference is 209 LOC; `codebase-summary.md` is 796 LOC and `linux-release-manager.md` is 798 LOC. Pre-existing API reference, configuration, standards, and architecture monoliths remain above the 800-LOC target; this pass did not restructure unrelated sections.

## Recommendations

1. Resolve the diagnostics adapter credential source alongside Phase 03 protected-route/session-policy integration. Do not use the signing-secret file as a Bearer credential.
2. When Phase 03 and the profile MFA UI land, update the auth boundary note and examples against those implementations.
3. Split oversized legacy guides in separate scoped documentation work; avoid adding feature details to the monoliths.

## Metrics and validation

- **Requested route coverage:** 100% — all four MFA routes plus login and status documented; logout included as a related session operation.
- **Auth document size:** 209 LOC; below `docs.maxLoc` 800.
- **Documentation validator:** Ran `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`; the repo-local `.omp/evcrate/scripts/validate-docs.cjs` was absent. It scanned 41 Markdown files and verified 683 internal links.
  It reported 1,524 code-reference and 367 config-key heuristic warnings across the repository; sample findings include changelog symbols and HTTP error constants. No broken-link warning was reported.
- **Update frequency:** one pass recorded for 2026-09-27; repository-wide historical frequency not measured.

## Unresolved questions

None. The diagnostics credential mismatch and Phase 03 work are documented implementation gaps, not questions blocking this documentation update.
