# QA Test Verification Report: Phase 15 — Host Resources Fleet & Usage Analytics (Cycle 3)

Date: 2026-10-16
Plan: `plans/261015-1647-android-native-app/plan.md`
Phase: `phase-15-host-resources-fleet-and-usage.md`
Scope: Cycle 3 verification of remediations addressing Cycle 2 code review critical findings:
1. Session pagination cursor range scoping on page 2 (`UsageController.kt` / `UsageControllerLoadingTest.kt`).
2. UTC-day alignment for range deletion (`UsageBoundsHelper` / `UsageDialogs.kt` / `UsageRepositoryAndControllerTest.kt`).
3. Delete failure safety and re-entrancy fencing (`UsageController.kt` / `UsageRepositoryAndControllerTest.kt`).
4. Full regression suite verification (JVM multiplatform unit tests, Android debug & release unit tests, debug APK assembly, and all 14 invariant test suites).

---

## Test Results Overview

| Suite / Target | Type | Source Inventory | Execution Status | Failed | Skipped | Status | Details |
|---|---|---|---|---|---|---|---|
| `:shared:jvmTest` | KMP JVM Unit Tests | 49 test classes, 272 `@Test` methods | 8 actionable tasks executed | 0 | 0 | PASSED | Includes 4 host feature test classes (20 tests), ~19.6s (`--rerun-tasks`) |
| `:androidApp:testDebugUnitTest` | Android Debug Unit Tests | 14 test classes, 63 `@Test` methods | Task executed | 0 | 0 | PASSED | Includes `HostResourcesPhase15Test` (7 tests), ~22.5s (`--rerun-tasks`) |
| `:androidApp:testReleaseUnitTest` | Android Release Unit Tests | 14 test classes, 63 `@Test` methods | Task executed | 0 | 0 | PASSED | Includes `HostResourcesPhase15Test` (7 tests), executed in joint run |
| Invariant Test Suites (`test-phase-02..15.sh`) | Static Structural Assertions | 14 shell test suites | 1034 assertions executed | 0 | 0 | PASSED | 100% pass rate across all 14 suites (~2.5s) |
| `:androidApp:assembleDebug` | Debug Application Build | — | 55 actionable tasks executed | 0 | 0 | PASSED | Debug APK assembly succeeded without collision (~13.5s) |

---

## Cycle 3 Remediations Verification Details

### 1. Session Pagination Cursor Range Scoping on Page 2 (Critical Issue #1)
- **Root Cause in Cycle 2**: `UsageController.loadSessions` recomputed `from = now - window` and `to = now` on every call. Server rejects queries where `query.from/to != cursor.payload.from/to` with HTTP 400.
- **Cycle 3 Remediation**:
  - `UsageController.kt`: When `cursor != null` (page 2+), `reqFrom` and `reqTo` evaluate to `null`, omitting both query parameters and letting the server enforce the cursor-embedded window.
- **Verification (`UsageControllerLoadingTest.testSessionPaginationPageTwoOmitsRange`)**:
  - Verifies page 1 request carries range query parameters and returns cursor `"c1"`.
  - Verifies page 2 request contains `cursor=c1` while omitting `from=` and `to=` parameters.
  - Verifies page 2 state application: sessions list is concatenated (`[s1, s2]`), `nextCursor` clears to `null`, and `isLoadingSessions` resets to `false`.

### 2. UTC-Day Alignment for Range Deletion (Critical Issue #2)
- **Root Cause in Cycle 2**: `UsageDeleteDialog` calculated `from = now - days * 86_400_000` and `to = now`. Server `parse_delete_range` requires `timestamp % DAY_MS == 0`. Unaligned bounds caused immediate rejection.
- **Cycle 3 Remediation**:
  - `UsageModels.kt`: Extracted `UsageBoundsHelper` with `DAY_MS = 86_400_000L` and `calculateUtcDayRange(nowMs, daysBack)`.
  - `UsageDialogs.kt`: Aligns `todayUtc = (now / DAY_MS) * DAY_MS` and `fromUtc = todayUtc - (days * DAY_MS)`. Displays resolved aligned UTC bounds in the dialog before confirmation.
- **Verification (`UsageRepositoryAndControllerTest.testRangeDeletionSendsUtcAlignedBounds`)**:
  - Exercises `UsageBoundsHelper.calculateUtcDayRange` with an unaligned mid-day timestamp `1729112345678L` (2024-10-16 20:59:05.678 UTC).
  - Explicitly asserts expected UTC day boundary flooring: `todayUtc = 1729036800000L` (2024-10-16 00:00:00 UTC) and `fromUtc = 1728432000000L` (2024-10-09 00:00:00 UTC).
  - Asserts `fromUtc % DAY_MS == 0L`, `todayUtc % DAY_MS == 0L`, `todayUtc - fromUtc == 7 * DAY_MS`, and verifies server DELETE payload transmits exact UTC-aligned boundaries.

### 3. Delete Failure Safety & Re-Entrancy Guard (Cycle 2 Review Warning)
- **Root Cause in Cycle 2**: On deletion failure or timeout, UI could clear state prematurely without reload; `isDeleting` lacked re-entry protection; state could become desynchronized.
- **Cycle 3 Remediation**:
  - `UsageController.kt`: Added re-entrancy and disposal check `if (disposed || _uiState.value.isDeleting) { onComplete(false); return }`.
  - On failure: resets `isDeleting = false`, records `deleteError = err.message`, and triggers `reloadAll()` to re-synchronize state with server truth without clearing existing data.
  - On success: bumps `summaryGeneration++` and `sessionsGeneration++` (fencing out stale in-flight loads), clears local cache, triggers `reloadAll()`, and signals `onComplete(true)`.
  - `UsageDeleteDialog.kt`: Disables Cancel and Delete buttons while `isDeleting == true` and renders "Deleting..." indicator.
- **Verification (`UsageRepositoryAndControllerTest.testDeleteUsageFailurePreservesStateAndResetsDeleting`)**:
  - Populates non-empty summary (`inputTokens = 12345`) and sessions (`id = "sess-pre-delete"`).
  - Verifies concurrent/re-entrant `deleteUsage` calls return `false` while `isDeleting` is active.
  - Verifies server HTTP 500 error reports failure, resets `isDeleting = false`, preserves summary and session contents without loss, and records `deleteError`.
  - Verifies subsequent retry succeeds when server responds 204.

---

## Static Regression Test Suites Breakdown (1034 Assertions Total)

All 14 invariant suites passed with zero failures:
- `tests/test-phase-02-foundation.sh`: 47 passed, 0 failed (exit 0)
- `tests/test-phase-03-transport.sh`: 48 passed, 0 failed (exit 0)
- `tests/test-phase-04-profiles-auth.sh`: 57 passed, 0 failed (exit 0)
- `tests/test-phase-05-proof-gates.sh`: 66 passed, 0 failed (exit 0)
- `tests/test-phase-06-shell-workspace.sh`: 64 passed, 0 failed (exit 0)
- `tests/test-phase-07-terminal-agents.sh`: 45 passed, 0 failed (exit 0)
- `tests/test-phase-08-filesystem-watchers.sh`: 57 passed, 0 failed (exit 0)
- `tests/test-phase-09-editor-saves.sh`: 70 passed, 0 failed (exit 0)
- `tests/test-phase-10-diff-merge-blame.sh`: 77 passed, 0 failed (exit 0)
- `tests/test-phase-11-encrypted-transfers-media.sh`: 84 passed, 0 failed (exit 0)
- `tests/test-phase-12-git-history.sh`: 139 passed, 0 failed (exit 0)
- `tests/test-phase-13-workflow-plans.sh`: 100 passed, 0 failed (exit 0)
- `tests/test-phase-14-agent-store-memory.sh`: 99 passed, 0 failed (exit 0)
- `tests/test-phase-15-host-resources-usage.sh`: 81 passed, 0 failed (exit 0)
- **Total Assertions**: 1034 passed, 0 failed.

---

## Performance & Build Metrics

- Gradle Task Pipeline:
  - `:shared:jvmTest`: ~19.6s execution time (`--rerun-tasks`).
  - `:androidApp:testDebugUnitTest :androidApp:testReleaseUnitTest`: ~22.5s execution time (`--rerun-tasks`).
  - `:androidApp:assembleDebug`: ~13.5s execution time (`--rerun-tasks`).
  - Static Invariants: 14 test scripts completed in ~2.5s wall time.
- Compiler Warnings:
  - Kotlin Multiplatform expect/actual in Beta warning (`PlatformCrypto.kt` / `PlatformCrypto.android.kt` / `PlatformCrypto.jvm.kt`). Non-blocking.
  - Android native library strip warning: `libandroidx.graphics.path.so` packaged as-is. Non-blocking.

---

## Critical Issues

- None blocking automated test execution or debug APK assembly.

---

## Recommendations & Next Steps

1. **Commit Phase 15 Source Files**: Ensure all untracked implementation files (`features/host/*.kt`, test classes, and regression script) are tracked and committed together.
2. **Physical Device Validation**: Execute physical Android device smoke run to validate Compose rendering under continuous SSE streaming and physical hardware back button gestures across unified Resources tabs.
3. **Settings UI Expansion**: Consider expanding `UsageSettingsSection` in subsequent iterations to provide full UI controls for Codex exporter toggling and retention day patches beyond current pause/resume.

---

## Unresolved Questions

- None blocking automated test execution, static invariant validation, or debug APK assembly.
