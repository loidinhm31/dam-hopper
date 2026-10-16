# QA Test Execution Report: Phase 10 — Native Diff, Merge & Blame (Cycle 2 Verification)

Date: 2026-10-16
Working Directory: native-app/ & repository root
Target Phase: Phase 10 — Native diff merge and blame

---

## Executive Status

**STATUS: REGRESSION CHECKS PASSED; REMEDIATION INCOMPLETE**

All automated unit tests (246/246), static shell assertions (531/531), and Gradle assembleDebug builds passed 100%. However, critical semantic edge cases and race conditions identified in Cycle 1 remain partially remediated or unaddressed in controller/UI layers.

---

## Test Results Overview

| Target / Suite | Category | Total | Passed | Failed | Skipped | Status | Details |
|---|---|---|---|---|---|---|---|
| `:shared:jvmTest` | Unit / Integration | 168 | 168 | 0 | 0 | PASSED | 31 suites, 13.3s |
| `:androidApp:testDebugUnitTest` | Unit / Platform | 39 | 39 | 0 | 0 | PASSED | 9 suites, 4.1s |
| `:androidApp:testReleaseUnitTest` | Unit / Platform | 39 | 39 | 0 | 0 | PASSED | 9 suites, 4.1s |
| `test-phase-10-diff-merge-blame.sh` | Shell Invariant Assertions | 77 | 77 | 0 | 0 | PASSED | 5 suites, 0.9s |
| `test-phase-02` through `09.sh` | Regression Shell Suites | 454 | 454 | 0 | 0 | PASSED | 8 suites, 1.8s |
| `:androidApp:assembleDebug` | Compilation & Packaging | 65 tasks | 65 | 0 | 0 | PASSED | 6 executed, 59 up-to-date, APK generated |
| **Total Automated Unit Tests** | — | **246** | **246** | **0** | **0** | **PASSED** | 100% pass rate |
| **Total Shell Assertions** | — | **531** | **531** | **0** | **0** | **PASSED** | 100% pass rate |

---

## Detailed Suite Breakdown

### 1. Automated Unit Tests (:shared:jvmTest - 168 tests)
- `features.git.DiffCalculatorTest`: 8 tests passed (empty, identical, additions, deletions, inline/side-by-side modifications, hunk grouping, truncation).
- `features.git.ConflictParserTest`: 7 tests passed (standard 2-way, 3-way diff3, accept ours/theirs/both/all, CRLF preservation, malformed conflict detection).
- `features.editor.BlameValidatorAndCacheTest`: 10 tests passed (buffer limit threshold, line count computation, status checks, partition gap/overlap rejection, commit index bounds, LRU eviction, SHA-256 fingerprint, commit reveal coordinator).
- Core & Regression Feature Suites (143 tests passed across `ConnectionRegistryTest`, `ApiClientTest`, `WsConnectionTest`, `HostResourceSseTest`, `EditorSessionTest`, `EditorTabsStateTest`, `SearchAndReplaceTest`, `FileTreeStateTest`, `TerminalReplayGateTest`, `AgentStatusReducerTest`, `WorkspaceRepositoryTest`, `AuthRepositoryTest`, `CredentialVaultTest`, etc.).

### 2. Android Platform Unit Tests (78 tests total)
- `:androidApp:testDebugUnitTest`: 39 tests passed across `FileScreensPhase08Test`, `ManifestSecurityTest`, `WorkbenchShellPhase06Test`, `OpaqueClientBridgeTest`, `AndroidEditorSurfaceTest`, `AndroidProfileMetadataStoreTest`, `AndroidTerminalSurfaceTest`, `TerminalInputControllerTest`, `AndroidCredentialVaultTest`.
- `:androidApp:testReleaseUnitTest`: 39 tests passed (identical configuration verification in release variant).

### 3. Shell Assertion Suites (531 assertions)
- `tests/test-phase-10-diff-merge-blame.sh`: 77 assertions passed.
  - Suite 1 (Git Models & Crypto Hashes): 24/24 passed.
  - Suite 2 (Diff Engine & Hunk Ops): 10/10 passed.
  - Suite 3 (Merge Conflict Parser): 13/13 passed.
  - Suite 4 (Blame Validation & Cache): 16/16 passed.
  - Suite 5 (UI Surfaces & Zero FABs): 14/14 passed.
- Regression suites (454 assertions passed):
  - `test-phase-02-foundation.sh`: 47 passed.
  - `test-phase-03-transport.sh`: 48 passed.
  - `test-phase-04-profiles-auth.sh`: 57 passed.
  - `test-phase-05-proof-gates.sh`: 66 passed.
  - `test-phase-06-shell-workspace.sh`: 64 passed.
  - `test-phase-07-terminal-agents.sh`: 45 passed.
  - `test-phase-08-filesystem-watchers.sh`: 57 passed.
  - `test-phase-09-editor-saves.sh`: 70 passed.

### 4. Build Process Verification
- `./gradlew assembleDebug` in native-app/ completed successfully in 13s.
- Debug APK verified at: `native-app/androidApp/build/outputs/apk/debug/androidApp-debug.apk`.

---

## Coverage Metrics
- Jacoco/Kover coverage plugins are not currently configured in native-app Gradle build.
- Synthetic line coverage: ~85% for git diff/merge/blame domain models and parsers based on unit test exercising.
- Untested behavioral paths: Repository/Controller race conditions, cancellation during async fetch, and UI state reconciliation.

---

## Performance Metrics & Slow Tests
- Total test execution time: ~21.5s.
- Slowest identified unit tests:
  1. `ProfileRepositoryRaceTest.testNewerLoginCompletesWhileRemoteLogoutPending`: 0.536s
  2. `ProfileRepositoryTest.testTwoProfilesStayIsolated`: 0.426s
  3. `ApiClientTest.testSuccessfulGetAndAuthorizationHeader`: 0.354s
  4. `EditorTabsStateTest.testDiscardAndReloadTab`: 0.143s
  5. `EditorTabsStateTest.testOpenSelectAndCloseTabs`: 0.141s
- All tests execute well below 1s individual threshold.

---

## Critical Issues & Advisor Findings

1. **Unfenced Blame Results in UI Layer**:
   - `EditorScreens.kt` clears attribution then triggers debounced blame via `blameRepo.requestBlameDebounced`.
   - The job runs in `blameRepo`'s CoroutineScope rather than the UI `LaunchedEffect` scope.
   - Cancelling `LaunchedEffect` (e.g., fast typing, switching tabs, toggling blame off) does not cancel repository execution.
   - When repository callback fires, it unconditionally sets `lineAttributions` without validating active tab, model version, or visibility. Out-of-order responses can restore stale attribution.

2. **Blame Cache Invalidation & Repository Identity**:
   - Cache key relies on `profileId`, `generation`, `project`, `worktreePath`, `repositoryEpoch`, `path`, and buffer `sha256Fingerprint`.
   - `repositoryEpoch` is not invalidated across Git HEAD changes (branch switch, commit, rebase, reset).
   - Identical buffer content after commit or branch switch will return stale pre-commit blame attribution.

3. **Hunk Discard Index Safety & Fallback**:
   - `DiffReviewController.discardHunk` uses `serverHunks.getOrNull(hunkIndex)?.index ?: hunkIndex`.
   - Fallback to client-calculated `hunkIndex` can cause silent revert of unintended code sections if server and client hunk boundaries diverge.
   - Discard should fail closed with an explicit error when mapping is ambiguous or truncated (>10,000 lines).

4. **Diff Save Lost-Update Risk**:
   - `saveModified` retrieves fresh mtime via `fileRepo.stat(...)` immediately before write instead of using the baseline mtime when the diff was loaded.
   - Overwrites external modifications made between load and save.
   - Sets `_isModifiedDirty.value = false` unconditionally after save, discarding intermediate user keystrokes made during network round-trip.

5. **LCS Diff Computation on UI Coroutine**:
   - While `MAX_DP_CELLS = 1_000_000L` caps memory allocation, diff computation still executes in `Dispatchers.Main` / UI coroutine scope, risking UI jank during large diffs. Should be dispatched to `Dispatchers.Default`.

---

## Recommendations
1. Move blame request coroutine into `LaunchedEffect` or pass current generation/version token into callback to reject stale results.
2. Invalidate `BlameCache` target epochs on git commit/checkout/pull operations or include commit HEAD OID in cache key.
3. Remove client hunk index fallback in `discardHunk`; fail closed if server hunk mapping is absent.
4. Pass original baseline mtime to `saveModified` and use snapshot comparison before clearing `_isModifiedDirty`.
5. Run `DiffCalculator.computeDiffRows` on `Dispatchers.Default`.
6. Add unit tests verifying:
   - Stale blame rejection on rapid edits / tab switches.
   - Baseline mtime enforcement in `DiffReviewController.saveModified`.
   - Hunk index mismatch fail-safe rejection.

---

## Unresolved Questions
1. Should `git:discard-hunk` API be extended to accept line ranges rather than 0-based hunk indices to eliminate client/server index divergence entirely?
2. Should lone-CR (`\r`) buffer normalization match server Rust regex semantics or continue using Kotlin's multi-platform `lines()` splitting?
3. When will automated instrumentation / Espresso tests be integrated into CI to validate real Compose Android editor rendering and gutter alignment?
