# Code Review: Phase 07 — Terminal Sessions, Replay, Input & Agents

**Date**: 2026-10-16  
**Reviewer**: Code Quality & Security Specialist  
**Phase**: Phase 07 — Terminal sessions replay input and agents  
**Status**: NEEDS WORK / REVISION REQUIRED  
**Score**: 5.8 / 10  

---

## 1. Executive Summary

Phase 07 delivers foundational models, PTY stream reconciliation (`TerminalReplayGate`), monotonic agent status reducers (`AgentStatusReducer`), IME/hardware key translation (`TerminalInputController`), and Compose panels (`TerminalScreens`, `WorkbenchScreen`).

Automated host test suites and static assertions pass (103 JVM tests, 52 Android debug unit tests, 45 Phase 07 static assertions). However, critical concurrency and integration defects exist:
1. **Non-reentrant Mutex deadlock** in `AgentStatusReducer` during epoch mismatch or live status invalidation.
2. **Cross-profile session leak** in `WorkbenchScreen`: controllers retain stale repositories across profile switches.
3. **Attachment-before-controller race condition**: PTY output/replays discarded when arriving before Compose registers controllers.
4. **Leaked active input state**: deselecting terminal sessions fails to deactivate prior controllers.
5. **Missing attachment on navigation/removal**: jumping from agent roster or removing sessions omits PTY re-attach.
6. **Omitted worktree target**: `onCreateSession` drops user-selected worktree paths.
7. **Terminal surface stubbing**: `AndroidTerminalSurface` is an in-memory buffer stub; no real emulator rendering or IME `InputConnection` is wired to the Compose canvas.

---

## 2. Critical Issues

### CRIT-01: Non-Reentrant Mutex Deadlock on Reducer Invalidation / Epoch Mismatch
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt:183, 222, 260, 277`
- **Impact**: Indefinite coroutine hang, permanent freeze of WebSocket agent status stream collector, unrecoverable state freeze.
- **Analysis**:
  - `applyStatusInvalidated` acquires `mutex.withLock`.
  - While holding `mutex`, it invokes `reloadSnapshotAsync()`.
  - `reloadSnapshotAsync()` is a direct suspending function (not a spawned coroutine). It executes `val snapshot = repo.getAgentStatusSnapshot()` and then calls `applySnapshot(snapshot)`.
  - `applySnapshot` begins with `mutex.withLock`.
  - In `kotlinx.coroutines.sync.Mutex`, locks are strictly non-reentrant. The calling coroutine blocks forever waiting for itself to release `mutex`.
  - The same bug occurs in `applyStatusChanged` and `applyStatusRemoved` when `current.serverEpoch != msg.serverEpoch`.
  - Furthermore, network I/O (`repo.getAgentStatusSnapshot()`) is executed while holding `mutex`, blocking all concurrent reducer operations.
- **Remediation**:
  Extract network reloads outside `mutex.withLock`. Flag reload necessity within the critical section, release lock, then trigger `reloadSnapshot()` asynchronously:
  ```kotlin
  suspend fun applyStatusInvalidated(msg: ServerMsg.AgentStatusInvalidated) {
      mutex.withLock {
          val current = _state.value
          _state.value = current.copy(
              serverEpoch = msg.serverEpoch,
              revision = msg.revision,
              agents = emptyMap(),
              unreadAttentions = emptyList(),
          )
      }
      reloadSnapshot()
  }
  ```

---

## 3. High Priority Warnings

### WARN-01: Cross-Profile Controller & Repository Leak in `WorkbenchScreen`
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:85, 128`
- **Impact**: Terminal input dispatched to wrong server/profile; sessions collide across profiles.
- **Analysis**: `terminalControllers` is remembered at composable root and cleared only when `activeProfileId == null`. When switching between two valid profiles, `terminalControllers` is NOT cleared. The controller closure captures `terminalRepo`, which is mutable state; an old controller from Profile A will dispatch keystrokes and attach requests to Profile B's server.
- **Remediation**: Key `terminalControllers` by composite key `(profileId, sessionId)` or clear/close all controllers when `activeProfileId` transitions.

### WARN-02: Attachment Race & Discarded Live/Replay Chunks
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:177, 189-204, 256-281`
- **Impact**: Historical replay buffer lost, input locked permanently (`isReplayCompleted` stays `false`).
- **Analysis**: Initial session listing and `onCreateSession` trigger `repo.attachTerminal(...)` immediately. Meanwhile, the `TerminalSessionController` is created lazily inside Compose body (`val activeTerminalController = activeTerminalSessionId?.let { terminalControllers.getOrPut(...) }`). If the WebSocket returns `ServerMsg.TermBuffer` or `TermOutput` before composition evaluates, `terminalControllers[msg.id]` is null. The incoming chunk is silently dropped, causing replay to never complete.
- **Remediation**: Centralize controller instantiation via eager `getOrCreateController(id)` in event collectors and register controllers before invoking `attachTerminal`.

### WARN-03: Stale Controller Left Active on Session Switch
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:282-284`
- **Impact**: Background sessions accept input or stay un-fenced.
- **Analysis**: `LaunchedEffect(navState.activePanel, activeTerminalController)` sets `activeTerminalController?.isPanelActive = ...`. When switching from Session 1 to Session 2, `activeTerminalController` points to Session 2. Session 1's `isPanelActive` flag is never set back to `false`.
- **Remediation**: Whenever active session changes, explicitly set `previousController?.isPanelActive = false` or synchronize all controllers in `terminalControllers`.

### WARN-04: Missing PTY Attachment on Agent Jump and Session Removal
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:446, 482`
- **Impact**: Jumping from agent roster opens dead session view without stream binding.
- **Analysis**:
  - `onJumpToTerminalSession` sets `activeTerminalSessionId = termId` and navigates to `TERMINAL` panel, but never triggers `terminalRepo.attachTerminal(termId)`.
  - When removing an active session, fallback assignment `activeTerminalSessionId = detailed.firstOrNull()?.id` also neglects to call `attachTerminal`.
- **Remediation**: Call `attachTerminal` whenever active session ID changes.

### WARN-05: Selected Worktree Omitted from `CreateSessionRequest`
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:417-425`
- **Impact**: Terminals spawn in default repository directory instead of user-selected worktree target.
- **Analysis**: `WorkbenchScreen` resolves `snapshot.target.worktreePath`, but passes only `project` and `command` to `CreateSessionRequest`.
- **Remediation**: Pass `worktreePath = snapshot.target.worktreePath` to `CreateSessionRequest`.

---

## 4. Medium Priority Suggestions

### SUGG-01: Terminal Surface Stub vs Actual Emulator
- **Location**: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt`
- **Detail**: `AndroidTerminalSurface` writes to an in-memory `ByteArrayOutputStream` stub. In `TerminalScreens.kt`, Compose renders only static text lines. A real VT100/Xterm emulator surface (or ConnectBot termlib JNI binding) remains required for functional terminal operation.

### SUGG-02: Bracketed Paste Bypass in `AndroidTerminalSurface.pasteText`
- **Location**: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt:151`
- **Detail**: Direct calls to `AndroidTerminalSurface.pasteText(text)` dispatch raw UTF-8 bytes without `\u001b[200~` and `\u001b[201~` guards. While `TerminalInputController` wraps paste, the surface method itself should enforce bracketed paste.

### SUGG-03: Hardware Modifier Key Latching & Alt-Arrow Encoding
- **Location**:
  - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/TerminalInputController.kt:50-58`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt:285`
- **Detail**:
  - Hardware modifiers use `toggleModifier` on key down without release synchronization on key up, and get unconditionally cleared on character consumption.
  - `encodeSpecialKey` discards `Alt` for escape-prefixed arrow keys (`!seq.startsWith("\u001b")`), breaking readline/bash word jump shortcuts (`Alt+Left`/`Alt+Right`).
  - Unicode conversion `unicode.toChar()` truncates supplementary code points (> 0xFFFF). Use `Character.toChars(unicode)` instead.

### SUGG-04: Unbounded `seenAttentionIds` Cache Growth
- **Location**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt:77`
- **Detail**: `seenAttentionIds` set accumulates IDs indefinitely over long runs. Bound with LRU / sliding window (e.g. 1,000 entries).

---

## 5. Reviewed Files

| File | Purpose / Scope |
|---|---|
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalModels.kt` | Session CRUD, agent status, and attention DTOs |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalReplayGate.kt` | Stream reconciliation, offset slicing, gap detection |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalRepository.kt` | REST endpoints and WebSocket stream routing |
| `native-app/shared/src/commonMain/kotlin/.../terminal/AgentStatusReducer.kt` | Epoch/revision fencing and snapshot reconciliation |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalSurface.kt` | Native terminal surface multiplatform contract |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalSessionController.kt` | Session lifecycle, input gating, ANSI encoding |
| `native-app/shared/src/commonMain/kotlin/.../terminal/TerminalScreens.kt` | Terminal and agent panel Compose UI |
| `native-app/androidApp/src/main/kotlin/.../terminal/TerminalInputController.kt` | Android IME and hardware keyboard bridge |
| `native-app/androidApp/src/main/kotlin/.../terminal/AndroidTerminalSurface.kt` | Candidate ConnectBot termlib adapter stub |
| `native-app/shared/src/commonMain/kotlin/.../ui/screens/WorkbenchScreen.kt` | Multi-panel hosting, repository wiring, controller retention |
| `native-app/shared/src/commonMain/kotlin/.../features/profiles/ProfileRepository.kt` | WebSocket connection factory wiring |
| `native-app/shared/src/commonMain/kotlin/.../core/transport/WsConnection.kt` | Suspend auth token provider signature |
| `tests/test-phase-07-terminal-agents.sh` | Static invariant verification script |

---

## 6. Validation Commands and Results

| Command | Result | Notes |
|---|---|---|
| `./tests/test-phase-07-terminal-agents.sh` | **PASSED** (45/45 assertions) | Static AST / token assertions |
| `cd native-app && ./gradlew :shared:jvmTest` | **PASSED** (103/103 tests) | Host JVM unit tests |
| `cd native-app && ./gradlew testDebugUnitTest` | **PASSED** (52/52 tests) | Android debug unit tests |
| `cd native-app && ./gradlew assembleDebug` | **SUCCESS** (APK generated) | Packaging verification |

*Note: Automated tests ran against in-memory mocks without exercising live PTY streams, physical IME composition, or real Android View window insets.*

---

## 7. Plan File Updates

Update `plans/261015-1647-android-native-app/phase-07-terminal-sessions-replay-input-and-agents.md`:
- Mark Phase 07 status as **remediation required** pending fix of CRIT-01 (reducer deadlock), WARN-01 (cross-profile isolation), WARN-02 (attachment race), and WARN-04 (agent jump attachment).
- Update todo checklist:
  - [x] Session CRUD REST models and repository operations.
  - [x] Stream replay gate and offset reconciliation algorithm.
  - [ ] Resolve agent reducer non-reentrant mutex deadlock.
  - [ ] Implement robust controller attachment lifecycle in `WorkbenchScreen`.
  - [ ] Connect native emulator canvas to `TerminalScreens`.

---

## 8. Unresolved Questions

1. Will the project bind the ConnectBot `libvterm.so` JNI library via JNA/JNI in Phase 07 or defer real terminal rendering to Phase 18?
2. Should profile switching in `WorkbenchScreen` terminate all active remote PTY sessions or detach client sockets while keeping sessions running on the server?
3. What is the target behavior for physical hardware keyboard shortcuts (e.g. `Ctrl+C`, `Ctrl+Z`, `Alt+F`) across external Bluetooth keyboards on tablet/desktop mode?
