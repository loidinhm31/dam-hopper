# Code Review: Phase 07 — Terminal Sessions, Replay, Input & Agents (Cycle 2 Remediation Review)

- **Date**: 2026-10-16
- **Reviewer**: Code Quality & Security Specialist
- **Phase**: Phase 07 — Terminal sessions replay input and agents
- **Scope**: Verification of Cycle 1 remediations (CRIT-01, WARN-01 to 05, SUGG-02, SUGG-03), AST invariants, host unit tests, and runtime concurrency boundaries
- **Status**: **REMEDIATIONS VERIFIED — HOST CONTRACTS APPROVED; PHYSICAL DEVICE QUALIFICATION DEFERRED TO PHASE 18**
- **Score**: **8.8 / 10** (Upgraded from 5.8 / 10 in Cycle 1)

---

## 1. Executive Summary

Cycle 2 review evaluated all remediated components across `AgentStatusReducer.kt`, `WorkbenchScreen.kt`, `AndroidTerminalSurface.kt`, and `TerminalInputController.kt`.

All primary defects from Cycle 1 have been successfully addressed:
1. **CRIT-01 (Deadlock)**: Non-reentrant mutex deadlock in `AgentStatusReducer` eliminated by hoisting `reloadSnapshotAsync()` outside `mutex.withLock`. Bounded `seenAttentionIds` prevents unbounded memory accumulation.
2. **WARN-01 (Cross-Profile Leak)**: `WorkbenchScreen` closes all active `TerminalSessionController` instances and flushes controller cache on active profile transitions.
3. **WARN-02 (Attachment Race)**: `getOrCreateController` helper ensures controller registration before issuing `attachTerminal` requests.
4. **WARN-03 (Active Panel Synchronization)**: `isPanelActive` is synchronized across all registered controllers whenever session selection or panel state changes.
5. **WARN-04 (Stream Binding on Jump/Removal)**: `attachTerminal` is explicitly invoked upon agent roster session jump and fallback assignment after session removal.
6. **WARN-05 (Worktree Target)**: User-selected `worktreePath` is forwarded in `CreateSessionRequest`.
7. **SUGG-02 (Bracketed Paste)**: `AndroidTerminalSurface.pasteText` wraps input with `\u001b[200~` and `\u001b[201~`.
8. **SUGG-03 (Keyboard Bridging)**: Modifier unlatching on `ACTION_UP` and supplementary Unicode characters (> 0xFFFF) handled via `Character.toChars(unicode)` in `TerminalInputController`. Alt-special key escape prefix preserved in `TerminalSessionController`.

100% of automated tests pass (45/45 static assertions in `./tests/test-phase-07-terminal-agents.sh`, 327/327 cumulative assertions across Phases 02–07 regression scripts, 103 shared JVM tests, 52 Android debug unit tests, clean `assembleDebug` APK build).

---

## 2. Critical Issues Status (Cycle 1 Verification)

| Issue | Status | Verification Evidence |
|---|---|---|
| **CRIT-01: Non-reentrant Mutex Deadlock on Reducer Invalidation / Epoch Mismatch** | **RESOLVED** | `AgentStatusReducer.kt:155-220, 260-273`: `reloadSnapshotAsync()` is hoisted outside `mutex.withLock` using local flag `var shouldReload = false`. Lock is released before calling `getAgentStatusSnapshot()`, preventing non-reentrant deadlock on subsequent `applySnapshot`. `seenAttentionIds` bounded to 1,000 entries with LRU eviction (`AgentStatusReducer.kt:200-204`). |

---

## 3. High Priority Warnings Status (Cycle 1 Verification)

| Warning | Status | Verification Evidence |
|---|---|---|
| **WARN-01: Cross-Profile Controller & Repository Leak in `WorkbenchScreen`** | **RESOLVED** | `WorkbenchScreen.kt:96-101, 142-146`: `LaunchedEffect(activeProfileId, activeProfile?.baseUrl)` executes `terminalControllers.values.forEach { it.close() }` and `terminalControllers.clear()`, preventing stale controllers and sockets from cross-contaminating profiles. |
| **WARN-02: Attachment Race & Discarded Live/Replay Chunks** | **RESOLVED** | `WorkbenchScreen.kt:181-204`: Centralized `getOrCreateController(id)` ensures controller exists in `terminalControllers` before WebSocket stream collection begins and before `repo.attachTerminal(...)` is called. |
| **WARN-03: Stale Controller Left Active on Session Switch** | **RESOLVED** | `WorkbenchScreen.kt:293-297`: `LaunchedEffect(navState.activePanel, activeTerminalSessionId)` iterates over all controllers in `terminalControllers` and updates `ctrl.isPanelActive = (id == activeTerminalSessionId && navState.activePanel == WorkbenchPanel.TERMINAL)`. Background sessions are strictly un-fenced. |
| **WARN-04: Missing PTY Attachment on Agent Jump and Session Removal** | **RESOLVED** | `WorkbenchScreen.kt:471-473, 487-489`: `attachTerminal(termId)` added inside coroutine scope for `onJumpToTerminalSession` and after removing an active session with remaining fallback sessions. |
| **WARN-05: Selected Worktree Omitted from `CreateSessionRequest`** | **RESOLVED** | `WorkbenchScreen.kt:432`: `worktreePath = snapshot.target.worktreePath` is passed to `CreateSessionRequest`. |

---

## 4. Medium Priority Suggestions Status (Cycle 1 Verification)

| Suggestion | Status | Verification Evidence |
|---|---|---|
| **SUGG-02: Bracketed Paste Bypass in `AndroidTerminalSurface.pasteText`** | **RESOLVED** | `AndroidTerminalSurface.kt:152-155`: `override fun pasteText(text: String)` wraps payload in `\u001b[200~$text\u001b[201~` prior to dispatching bytes. |
| **SUGG-03: Modifier Key Latching & Supplementary Unicode** | **RESOLVED** | `TerminalInputController.kt:50-62`: `ACTION_UP` unlatches active modifier keys. Lines 102-109 use `Character.toChars(unicode)` to preserve surrogate pairs and dispatch supplementary code points (> 0xFFFF). `TerminalSessionController.kt:285-289` unconditionally prefixes ESC (`0x1B`) for Alt-modified special keys. |

---

## 5. New Findings & Edge Cases (Cycle 2 Observations)

### 5.1 Warning: Redundant Duplicate `requestReattach()` on Queue Overflow
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:111-115`
- **Impact**: Emits two identical re-attach requests over WebSocket/REST in immediate succession upon buffer overflow, causing redundant gate resets.
- **Analysis**:
  `TerminalSessionController.init` wires `gate.onQueueOverflow = { requestReattach() }`. Inside `gate.enqueueLiveChunk()`, when capacity is exceeded, it triggers `onQueueOverflow?.invoke()` and returns `false`. `handleLiveChunk()` then tests `if (!enqueued) requestReattach()`, firing a second reattach.
- **Recommendation**:
  Remove the redundant call in `handleLiveChunk`:
  ```kotlin
  if (!gate.isLiveStreamReady) {
      gate.enqueueLiveChunk(QueuedLiveChunk(data, offset, chunkIncarnation))
      // onQueueOverflow callback handles reattach if queue capacity is exceeded
      return
  }
  ```

### 5.2 Warning: Alt Encoder Truncation on Non-ASCII Characters
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:254-256`
- **Impact**: Non-ASCII characters (e.g. umlauts, accented letters, CJK) typed with Alt are truncated to a single signed byte instead of full UTF-8 encoding.
- **Analysis**:
  `encodeKey` executes `return byteArrayOf(0x1B, char.code.toByte())`. When `char.code > 127`, `toByte()` truncates bits.
- **Recommendation**:
  Encode character as complete UTF-8 payload:
  ```kotlin
  if (isAlt) {
      return byteArrayOf(0x1B) + char.toString().encodeToByteArray()
  }
  ```

### 5.3 Warning: Unused `truncated` Flag in Buffer Replay
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:138-161`
- **Impact**: Client does not expose truncation banner or notify terminal surface when server drops earlier history due to scrollback limits.
- **Recommendation**:
  Store `isTruncated` state on controller and notify UI when historical scrollback has been trimmed by server.

### 5.4 Suggestion: Bounded-Time Unit Test for Reducer Deadlock / Invalidation
- **Location**: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducerTest.kt`
- **Detail**: Add explicit test exercising `applyStatusInvalidated` and epoch mismatch with a mock `TerminalRepository` ensuring `reloadSnapshotAsync` completes without mutex contention.

---

## 6. Reviewed Files

| File | Purpose / Scope |
|---|---|
| `native-app/shared/src/commonMain/kotlin/.../terminal/AgentStatusReducer.kt` | Epoch/revision fencing, snapshot reload hoisting, bounded attention LRU |
| `native-app/shared/src/commonMain/kotlin/.../ui/screens/WorkbenchScreen.kt` | Profile transition cleanup, controller lifecycle, attach triggers, worktree routing |
| `native-app/androidApp/src/main/kotlin/.../terminal/AndroidTerminalSurface.kt` | Surface contract implementation, bracketed paste wrapping, search/selection |
| `native-app/androidApp/src/main/kotlin/.../terminal/TerminalInputController.kt` | Hardware modifier key unlatching, supplementary Unicode preservation |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalSessionController.kt` | PTY input isolation, replay gate coordination, ANSI key encoding |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalReplayGate.kt` | Stream reconciliation, offset slicing, gap detection |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalScreens.kt` | Terminal and agent panel Compose UI |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalModels.kt` | Session CRUD, agent status, and attention DTOs |
| `native-app/shared/src/jvmTest/kotlin/.../terminal/AgentStatusReducerTest.kt` | Unit tests for agent status reducer |
| `native-app/androidApp/src/test/kotlin/.../terminal/TerminalInputControllerTest.kt` | Unit tests for hardware key and IME input controller |
| `native-app/androidApp/src/test/kotlin/.../terminal/AndroidTerminalSurfaceTest.kt` | Unit tests for surface buffer, search, and input isolation |
| `plans/261015-1647-android-native-app/phase-07-terminal-sessions-replay-input-and-agents.md` | Phase 07 plan file |
| `plans/261015-1647-android-native-app/plan.md` | Master plan file |
| `tests/test-phase-07-terminal-agents.sh` | Static invariant verification script |

---

## 7. Validation Commands and Results

| Command | Result | Notes |
|---|---|---|
| `./tests/test-phase-07-terminal-agents.sh` | **PASSED** (45/45 assertions) | Static AST & token assertions |
| `cd native-app && ./gradlew :shared:jvmTest` | **PASSED** (103/103 tests) | KMP host JVM unit tests |
| `cd native-app && ./gradlew testDebugUnitTest` | **PASSED** (52/52 tests) | Android debug unit tests |
| `cd native-app && ./gradlew testReleaseUnitTest` | **PASSED** (52/52 tests) | Android release unit tests |
| `./tests/test-phase-06-shell-workspace.sh` | **PASSED** (64/64 assertions) | Regression: Phase 06 |
| `./tests/test-phase-05-proof-gates.sh` | **PASSED** (66/66 assertions) | Regression: Phase 05 |
| `./tests/test-phase-04-profiles-auth.sh` | **PASSED** (57/57 assertions) | Regression: Phase 04 |
| `./tests/test-phase-03-transport.sh` | **PASSED** (48/48 assertions) | Regression: Phase 03 |
| `./tests/test-phase-02-foundation.sh` | **PASSED** (47/47 assertions) | Regression: Phase 02 |
| `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml` | **PASSED** (5/5 tests) | Rust OPAQUE Crypto Bridge |
| `cd native-app && ./gradlew assembleDebug` | **SUCCESS** | APK generated |

*Total static invariant assertions passed across Phases 02–07: 327 / 327 (100%).*

---

## 8. Positive Observations

1. Clean hoisting of snapshot reload outside non-reentrant mutex eliminates coroutine deadlock while maintaining state consistency.
2. Robust `getOrCreateController` eliminates race condition where incoming PTY replay chunks could be dropped before Compose tree rendered.
3. Proper controller disposal and cache flushing on active profile switch prevents cross-profile data leakage.
4. Comprehensive hardware key release modifier unlatching and supplementary Unicode preservation ensure compatibility with external keyboards and emoji/multibyte input.
5. Strict adherence to sole TERMINAL and TRADITIONAL invariants verified: zero FloatingActionButtons across entire UI.

---

## 9. Recommended Actions

1. Fix double `requestReattach()` call on queue overflow in `TerminalSessionController.kt:111-115`.
2. Fix Alt non-ASCII character encoding in `TerminalSessionController.kt:254-256`.
3. Add bounded-time unit test for `applyStatusInvalidated` and epoch mismatch in `AgentStatusReducerTest.kt`.
4. Proceed to Phase 08 (Filesystem watchers, search, and replace).
5. Retain ConnectBot `libvterm.so` JNI binding, physical IME candidate composition, window insets, and live daemon streaming for Phase 18 runtime qualification.

---

## 10. Metrics

- Type Safety: 100% strict Kotlin Multiplatform / Compose Multiplatform types
- Test Coverage: 327 static assertions + 155 JVM/Android unit tests passing (100% pass rate)
- Gradle Build Status: `:androidApp:assembleDebug` SUCCESS
- Unit Test Status: `:androidApp:testDebugUnitTest`, `:androidApp:testReleaseUnitTest`, `:shared:jvmTest` 100% PASS
- Rust Crypto Bridge: `cargo test` 5/5 PASS

---

## 11. Unresolved Questions

1. Should the ConnectBot `libvterm.so` JNI library be integrated via JNA/JNI ahead of Phase 18 or deferred entirely to device qualification?
2. Should `TerminalSessionController` expose a UI notification when `truncated == true` occurs in historical buffer replay?
3. In physical device deployments with external Bluetooth keyboards, should Alt+arrow word navigation shortcuts support configurable readline keymaps (Emacs vs Vi mode)?
