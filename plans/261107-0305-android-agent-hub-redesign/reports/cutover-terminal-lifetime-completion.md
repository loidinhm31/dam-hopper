# Completion Report: cutover-terminal-lifetime (P02 / W03) [Verification Incomplete]

## Status: VERIFICATION_INCOMPLETE
- **Code & Regression Implementation**: Complete. All 4 review critical issues resolved.
- **Successor Admission Gate**: Blocked — Live daemon PTY smoke and full process-death replacement barrier verification remain future qualification prerequisites. W05 remains blocked.

## Resolved Critical & Semantic Fixes
1. **Production PreferencesStore Wiring**:
   - Wired `preferencesStore` throughout `NativeWorkspaceViewModel` (across 8 `TerminalRepository` instantiation sites), `DamHopperMobileApp`, `WorkbenchScreen`, and `ProjectWorkspaceState`.
   - `TerminalRepository.createSession` and `createSessionGuarded` query `preferencesStore.loadUncertainCreateRecords()` for pending create intents across the logical project/worktree scope and fail closed with `IllegalStateException` before network dispatch.
   - Synchronously commits `UncertainCreateRecord` (status PENDING) via `commit()` before POST dispatch. Intent is cleared only upon verified 201 response.
2. **PTY Epoch Disambiguation & UUID Validation**:
   - Added `serverPtyEpoch` to `TerminalSessionMeta` and `TerminalSessionDetailed`.
   - `listSessions()` and `listDetailed()` capture the server's `X-DamHopper-PTY-Epoch` response header and populate `serverPtyEpoch`, preserving `terminationState` for row lifecycle status (`"live"`, etc.).
   - `TerminateSessionRequest` strictly enforces canonical lowercase UUID format (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) and positive decimal u64 strings.
   - `ProjectTerminalScreen` and `WorkbenchScreen` check `serverPtyEpoch` validity and block termination dispatch if absent, invalid, or equals `"live"`.
3. **Consumed Termination Outcomes & Replacement Safety**:
   - `ProjectTerminalScreen` Restart and End handlers consume typed `TerminalTerminationOutcome`.
   - Refusal (409) or error preserves the original row and controller and displays an error banner without spawning a replacement.
   - 202 `terminationRequested` acknowledges that termination is in progress and suppresses spawning a replacement.
   - Local Close View performs local controller eviction with zero server mutation.

## Demonstrated Evidence (Verified)
- **Shared JVM Compilation**: `cmd.exe /c gradlew.bat :shared:compileKotlinJvm` -> 0 (SUCCESS)
- **Android Debug Compilation**: `cmd.exe /c gradlew.bat :androidApp:compileDebugKotlin` -> 0 (SUCCESS)
- **Automated Regressions (JVM Test)**:
  - `TerminalRepositoryIntegrationTest`: 8/8 passed (includes `terminalLifetimeGuardedCreateAndTerminateSmoke` and `createSessionRefusesDuplicateReplacementWhenUnsettledIntentExists`).
  - `TerminalLifetimeContractTest`: 7/7 passed.
  - `TerminalModelsTest`: 6/6 passed.

## Pending Prerequisites (Keeping W05 Blocked)
1. **Live-Daemon PTY Smoke**: Execution against the live running Rust Axum server daemon validating PTY process creation, header emission, and process termination.
2. **Process-Death Recovery Smoke**: Actual OS process termination and recreation proving that stored pending intents prevent replacement before authoritative reconciliation.
