# Phase 01: Foundation & Network Security Configuration
Phase: 01
Dependencies: None

## Scope
1. Update `native-app/androidApp/src/debug/res/xml/network_security_config.xml` to allow cleartext traffic for local development endpoints (including private LAN IP ranges or base-config in debug mode) so real devices running debug builds can connect over local Wi-Fi without OkHttp exceptions. Ensure `ManifestSecurityTest` assertions continue to pass.
2. Define `AppFlowState.kt` and `AppFlowNavigation.kt` in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/`:
   - `enum class AppFlowStage { PROFILE_LOGIN, PROJECT_LIST, TERMINAL }`
   - State machine managing transitions:
     - `navigateToProfiles()`
     - `onProfileAuthenticated(profileId: String)`
     - `selectProject(projectName: String)`
     - `handleBackPress(): Boolean` (unwinding TERMINAL -> PROJECT_LIST -> PROFILE_LOGIN -> exit)

## Acceptance Criteria
- Debug network config allows connecting to local network servers.
- `AppFlowState` and `AppFlowNavigation` provide thread-safe StateFlow tracking the current stage and selected project.
- `handleBackPress()` consumes back press appropriately.

## Implementation Status: Completed
- [x] Debug network configuration updated allowing cleartext for local endpoints (`base-config cleartextTrafficPermitted="true"`).
- [x] Release network security configuration remains TLS-only (`cleartextTrafficPermitted="false"`).
- [x] `AppFlowState` data model created.
- [x] `AppFlowNavigation` state machine created with atomic stage transitions and back-press handling.
