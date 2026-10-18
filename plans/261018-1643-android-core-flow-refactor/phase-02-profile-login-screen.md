# Phase 02: Profile & Login Screen
Phase: 02
Dependencies: Phase 01

## Scope
Implement `ProfileLoginScreen.kt` in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt`:
1. Mobile-friendly, clear presentation of available Server Profiles.
2. Form to Add/Edit a Server Profile:
   - Server Name, Base URL (with quick-fill buttons/chips for "Emulator: http://10.0.2.2:4803", "Loopback: http://127.0.0.1:4803").
   - Username and Password.
3. Actions:
   - "Connect & Login": calls `authRepo.login(u, p)` or dev login.
   - "Dev Login": queries server status / dev mode token directly.
   - "Test Connection": calls `authRepo.checkAuthStatus()` and displays reachable/unreachable with status code.
4. Active profile selection and credential persistence via existing `ProfileRepository` and `CredentialVault`.
5. Error feedback with clear red alert text on invalid credentials or connection timeout.
6. Once authenticated, triggers callback `onAuthenticated(profileId)`.

## Acceptance Criteria
- Clean Compose UI with no WebView or floating action buttons.
- Supports both standard password auth and dev-mode `--no-auth`.
- Calls into existing `ProfileRepository`.

## Status: Implementation delivered; disposal-lifecycle review follow-up open (2026-10-18)
- [x] Mobile-friendly presentation of available Server Profiles with active indicators and auth status badges.
- [x] Form to Add/Edit a Server Profile with Name, Base URL, preset quick-fill chips, Username, and transient Password.
- [x] Actions implemented: Connect & Login, Dev Login (strictly capability-gated), Test Connection & Capability Probe, Save Profile, and Continue if authenticated.
- [x] Operation-generation fencing covers profile switches, URL edits, and MFA attempts.
- [ ] Unverified disposal cleanup: `onDispose` increments `operationGeneration` synchronously and the observed login path checks it before `applyAuthenticatedSession`, but atomicity/commit-race behavior is unverified. `attemptTracker.invalidate()` is launched from `rememberCoroutineScope`, which may already be cancelled; no focused lifecycle regression test was identified.
- [x] Outbound bearer gating: REST tokens only over HTTPS/recognized loopback; WebSocket tokens only over secure/loopback handshakes.
- [x] Token custody exclusively via ProfileRepository and CredentialVault; password state cleared on auth/switch.
- [x] Red alert error banners for invalid credentials or connection failures.
- [x] Verified compilation with `./gradlew.bat compileKotlinJvm compileDebugKotlin`.
