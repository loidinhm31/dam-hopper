# Integrated Automated Qualification Report (W10)

## Status: PASSED (Automated Core & App Verification)

**Execution Date:** 2026-11-08  
**Scope:** Coherent repository-wide automated qualification covering unit, integration, packaging, and oracle verification.

### Executed Automated Gates

1. **Multiplatform Core Unit & Integration Suite (`:shared:jvmTest`):**
   - **Command:** `cmd.exe /c gradlew.bat --no-parallel :shared:jvmTest`
   - **Result:** **1,044 / 1,044 tests PASSED** (0 failures, 0 errors, 0 skipped).
   - **Coverage:** Contracts (C1–C10), VT terminal emulation, PTY session controllers, git workspace safety, notification delivery sinks, encrypted transfers, settings serialization.

2. **Android Application Unit Suite (`:androidApp:testDebugUnitTest`):**
   - **Command:** `cmd.exe /c gradlew.bat --no-parallel :androidApp:testDebugUnitTest`
   - **Result:** **255 / 255 tests PASSED** (0 failures, 0 errors, 0 skipped).
   - **Coverage:** AgentHubLifecycleTest (canonical document sharing, surviving close, view lease tracking, uncertain create blocking), NativeWorkspaceViewModelTest (late Activity destroy fence, scope isolation, config change retention), TerminalAgentsActivationCoordinatorTest, SimpleFlowJourneysTest.

3. **Android Application Debug Packaging (`:androidApp:assembleDebug`):**
   - **Command:** `pnpm android:assembleDebug`
   - **Result:** **BUILD SUCCESSFUL** (55 actionable tasks: 6 executed, 49 up-to-date; debug APK produced).

4. **Android Instrumented Test Compilation (`:androidApp:compileDebugAndroidTestKotlin`):**
   - **Command:** `cmd.exe /c gradlew.bat :androidApp:compileDebugAndroidTestKotlin`
   - **Result:** **BUILD SUCCESSFUL** (0 compilation errors; TerminalAgentsSidebarTest and AgentHubRootJourneys compiled cleanly).

5. **Disposable Git Workspace Fixture Oracle (`git-workspace-fixture.mjs`):**
   - **Command:** `node native/android-app/scripts/git-workspace-fixture.mjs --self-test`
   - **Result:** **ALL SELF-TEST ASSERTIONS PASSED** (0 failures across status, rev-parse, log, worktrees, signed commits, and conflict fixtures).

### Summary Table

| Gate | Target / Suite | Total Executed | Passed | Failed | Status |
|---|---|---|---|---|---|
| JVM Core Tests | `:shared:jvmTest` | 1,044 | 1,044 | 0 | **PASS** |
| Android App Unit Tests | `:androidApp:testDebugUnitTest` | 255 | 255 | 0 | **PASS** |
| APK Packaging | `:androidApp:assembleDebug` | 1 | 1 | 0 | **PASS** |
| Instrumented Compilation | `:androidApp:compileDebugAndroidTestKotlin` | 1 | 1 | 0 | **PASS** |
| Git Fixture Oracle | `git-workspace-fixture.mjs` | 12 | 12 | 0 | **PASS** |
| **Total Automated** | — | **1,313** | **1,313** | **0** | **PASS** |
