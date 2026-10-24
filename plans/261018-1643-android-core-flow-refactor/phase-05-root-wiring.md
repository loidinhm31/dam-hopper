# Phase 05: Root Flow Integration & Wiring
Phase: 05
Dependencies: Phase 02, Phase 03, Phase 04

## Scope
1. Implement `DamHopperMobileApp.kt` in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`:
   - Hosts `AppFlowNavigation` coordinating the 3 core screens:
     - Stage `PROFILE_LOGIN`: renders `ProfileLoginScreen`
     - Stage `PROJECT_LIST`: renders `ProjectListScreen`
     - Stage `TERMINAL`: renders `ProjectTerminalScreen`
   - Handles BackHandler:
     - Back on `TERMINAL` -> navigates to `PROJECT_LIST`
     - Back on `PROJECT_LIST` -> navigates to `PROFILE_LOGIN`
     - Back on `PROFILE_LOGIN` -> exits app (returns false to system)
2. Update `MainActivity.kt` in `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`:
   - Renders `DamHopperMobileApp`.
   - Passes dependencies (`profileRepository`, `preferencesStore`, `lifecycleCoordinator`).

## Acceptance Criteria
- Complete seamless mobile flow: Profile Login -> Project List -> Select Project -> Terminal.
- Back button correctly unwinds stages.
- No crashes or unhandled exceptions on initial launch.

## Implementation Status: Completed
- [x] `DamHopperMobileApp.kt` implemented hosting `AppFlowNavigation` and managing stages.
- [x] `MainActivity.kt` updated to host `DamHopperMobileApp` with root `BackHandler`.
- [x] Dependency wiring for `ProfileRepository`, `ProjectTargetStore`, `PreferencesStore`, and `LifecycleCoordinator`.
