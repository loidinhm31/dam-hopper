# Phase 07 Implementation Report: Current-server Git and real Android qualification

## Executed Phase
- Phase: phase-07-live-qualification
- Plan: plans/261030-1617-android-focused-git-view
- Status: completed (with honest GATE-C hardware blocker ledger)

## Files Modified / Created
- `native/android-app/scripts/git-workspace-fixture.mjs` (created, 1042 LOC)
- `native/android-app/scripts/run-git-workspace-journeys.sh` (created, 179 LOC)
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitServerFixture.kt` (created, 329 LOC)
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitWorkspaceJourneys.kt` (created, 747 LOC)
- `plans/261030-1617-android-focused-git-view/reports/git-qualification.md` (created, 120 LOC)
- `plans/261030-1617-android-focused-git-view/reports/device-qualification.md` (created, 115 LOC)
- `plans/261030-1617-android-focused-git-view/reports/request-contract-audit.md` (created, 90 LOC)
- `plans/261030-1617-android-focused-git-view/phase-07-live-qualification.md` (updated tasks to completed)

## Tasks Completed
- [x] `create-real-git-fixtures`: Created Node standard-library disposable Git fixture/oracle/proxy script, shell runner with strict prerequisite validation, and Android instrumentation fixture helper. Verified via `--self-test` (0 failures) and `--smoke-current-server` (0 failures).
- [x] `qualify-live-git-journeys`: Authored full-fidelity instrumentation test suite `NativeGitWorkspaceJourneys.kt` covering AC01–AC10 on `MainActivity` via `ActivityScenario` and real controller pipelines. Compiled cleanly under `:androidApp:compileDebugAndroidTestKotlin`.
- [x] `qualify-git-failure-boundaries`: Authored three qualification reports documenting AC01–AC10 compliance, drop-ack single dispatch, H1–H5 re-evaluation dispositions, wire request audit, and truthful hardware blocker ledger.

## Tests Status
- Type check / Compilation: PASS (`:shared:compileKotlinJvm`, `:androidApp:compileDebugKotlin`, `:androidApp:compileDebugAndroidTestKotlin`, `:androidApp:assembleDebug`)
- Fixture Self-Test: PASS (`node git-workspace-fixture.mjs --self-test`, 11/11 assertions)
- Current-Server Smoke: PASS (`node git-workspace-fixture.mjs --smoke-current-server`, isolated server + SQLite auth seed + transparent proxy + Git oracle)
- Runner Blocker Validation: PASS (`bash run-git-workspace-journeys.sh`, exited with code 2 and honest `BLOCKED_PENDING_DEVICE` notice)
- JVM Tests: 934 completed, 932 passed, 2 failed in predecessor `TerminalPresentationPolicyTest` (strictly in Phase 02 owned terminal files; returned to Phase 02 for scoped fix)
- Android Unit Tests: PASS (`:androidApp:testDebugUnitTest`)
- Connected Device Journeys: BLOCKED_PENDING_DEVICE (no physical device or emulator platform-tools in workstation environment)

## Issues Encountered
- Workstation environment lacks `adb` in PATH and connected physical/emulator hardware. In accordance with plan rules, recorded honest blocker ledger without synthetic pass waivers.
- Predecessor working-tree terminal regression tests (`TerminalPresentationPolicyTest`) fail 2 tests. Phase 07 strictly preserves file boundaries and returned these failures to Phase 02 without editing unowned product files.

## Next Steps
- Phase 08 qualification report synthesis and release review.
- Hardware qualification gate on ARM64 / API 29 device when platform-tools become available.
