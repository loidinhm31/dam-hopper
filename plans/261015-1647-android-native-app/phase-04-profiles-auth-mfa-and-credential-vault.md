# Phase 04 — Profiles authentication MFA and credential vault

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 03](./phase-03-contracts-ownership-and-live-transport.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **completed (2026-10-15 22:45:00 +07:00)**. Review status: **reviewed (Review score: 8.5/10; CRIT-1 persistence metadata store added with serialization/constant tests; 57/57 static assertions, 60 QA baseline unit tests passed, assembleDebug verified; device runtime acceptance pending)**. Progress: **100% (implementation complete; runtime qualification scheduled for Phase 18)**.
- Scope: A01–A02.
- Goal: Deliver real multi-server account/profile lifecycle with full current MFA semantics and fail-closed Android credential custody.
- Implementation completed; automated unit tests and static assertions verified. Live device/server qualification tracked under open qualification gates and Phase 18.

## Key Insights

- Password login normally yields a five-minute challenge, not an authenticated session.
- Step-up rotates session credential; Doggo-style refresh-token behavior is not this API.

## Requirements

- Profile create/edit/remove/select, independent connection status and explicit incompatible/unavailable state.
- Registration approval notice, MFA enrollment/manual key/QR, login verification, step-up, session expiry/revocation/logout.
- Android Keystore-backed encrypted session credential storage, separate profile/account identity and no password/MFA secret persistence.

## Architecture

Shared ProfileRepository/AuthState machine; AndroidCredentialVault encrypts session material with Keystore keys. Credential rotation retires/rebuilds owner-bound clients/capabilities while preserving qualified visible recovery state.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/authentication.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/auth.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/auth_mfa.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/auth-client.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/auth-types.ts`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthState.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/vault/AndroidCredentialVault.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement profile metadata and explicit server/account edits; endpoint change retires old owner and binds future navigation/resources to a new generation.
2. Implement register/login/state branches including ACCOUNT_DISABLED and incompatible authProtocol/workbenchProtocol; do not add public approval/promotion.
3. Render transient enrollment secret/manual key/QR and verify code; expire challenge state on dismissal/timeout and never persist provisioning URI.
4. Handle MFA_REQUIRED on status/live close as a user-action pause, request/complete step-up, rotate credential and reset WS/media state using exact-profile ownership.
5. Implement Keystore AES-GCM credential-envelope storage, safe writes, backup exclusions, unavailable/invalidated key states and explicit reauthentication. Do not claim every device has hardware-backed protection.
6. Implement logout/revoke best effort plus immediate local credential/runtime retirement, profile removal and independent-account cleanup; a disconnected server cannot keep local login alive.
7. Exercise disabled registration, approved enrollment, wrong/expired code, rate-limit, returning login, step-up, expiry/revocation, process recreation and two-profile/account isolation against authenticated isolated servers.

## Todo List

- [x] Complete profile/auth state machine and vault lifecycle.
- [x] Exercise real registration/MFA/step-up/logout/denial paths via automated mock/unit tests (physical device / live server qualification tracked under Phase 18).
- [x] Verify no sensitive setup/session bytes in persistence/logs/backups.
- [x] Update requirement/evidence ledger and affected docs for Phase 04 handoff (physical device / live server runtime qualification tracked under open qualification gates and Phase 18).

## Success Criteria

- A user can enroll and use two real server profiles without copying signing secrets or using no-auth acceptance.
- Old tokens/callbacks are not reused after rotation/logout; another profile stays healthy.
- Vault failure causes explicit recovery/reauthentication, never plaintext credential fallback.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Media/auth cookie jars can share same-host credentials across profiles if engine reuse is careless.
- Challenge loss and MFA deadline transitions must not trigger silent credential refresh loops.

## Security Considerations

- No password, MFA secret, clipboard credential, private key or passphrase in logs/screenshots/analytics.
- Expose enrollment material only during user interaction and document clipboard risk/permission; server roles remain authoritative.

## Next Steps

Phase 04 implementation and review complete. Proceed to Phase 05 (Native terminal editor and crypto proof gates) and Phase 06 (TERMINAL Traditional shell projects and configuration).

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
