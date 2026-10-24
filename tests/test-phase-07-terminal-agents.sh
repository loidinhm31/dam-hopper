#!/usr/bin/env bash
set -euo pipefail

# Terminal Sessions, Replay, Input & Agents Verification for Phase 07
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS_COUNT=0
FAIL_COUNT=0

assert_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (pattern '$pattern' not found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_not_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if ! grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (prohibited pattern '$pattern' found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=== Suite 1: Terminal Session CRUD & Traditional Shell Invariants (T01) ==="
MODELS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt"
assert_contains "TerminalSessionMeta defines id and incarnation" 'val id: String' "$MODELS_FILE"
assert_contains "TerminalSessionMeta defines incarnation ULong" 'val incarnation: ULong' "$MODELS_FILE"
assert_contains "TerminalSessionMeta specifies traditional session type" 'val sessionType: String = "traditional"' "$MODELS_FILE"
assert_contains "TerminalSessionDetailed includes buffer_bytes" 'val bufferBytes: Long = 0L' "$MODELS_FILE"
assert_contains "CreateSessionRequest defines command and project" 'val command: String' "$MODELS_FILE"
assert_contains "RenameSessionRequest defined" 'data class RenameSessionRequest(' "$MODELS_FILE"

REPO_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt"
assert_contains "TerminalRepository lists sessions" 'suspend fun listSessions(): List<TerminalSessionMeta>' "$REPO_FILE"
assert_contains "TerminalRepository lists detailed" 'suspend fun listDetailed(): List<TerminalSessionDetailed>' "$REPO_FILE"
assert_contains "TerminalRepository creates session" 'suspend fun createSession(request: CreateSessionRequest)' "$REPO_FILE"
assert_contains "TerminalRepository renames session" 'suspend fun renameSession(id: String, name: String?)' "$REPO_FILE"
assert_contains "TerminalRepository kills session" 'suspend fun killSession(id: String)' "$REPO_FILE"
assert_contains "TerminalRepository removes session" 'suspend fun removeSession(id: String)' "$REPO_FILE"
assert_contains "TerminalRepository gets buffer" 'suspend fun getBuffer(id: String)' "$REPO_FILE"

echo "=== Suite 2: Stream Replay & Byte Reconciliation Invariants (T02) ==="
GATE_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalReplayGate.kt"
assert_contains "TerminalReplayGate defines activeReplayWrites" 'var activeReplayWrites: Int = 0' "$GATE_FILE"
assert_contains "TerminalReplayGate defines hasAttachBufferBeenReceived" 'var hasAttachBufferBeenReceived: Boolean = false' "$GATE_FILE"
assert_contains "TerminalReplayGate defines isLiveStreamReady" 'var isLiveStreamReady: Boolean = false' "$GATE_FILE"
assert_contains "TerminalReplayGate defines shouldForwardTerminalData" 'fun shouldForwardTerminalData(): Boolean' "$GATE_FILE"
assert_contains "TerminalReplayGate bounds queue capacity" 'val maxQueuedChunks: Int = DEFAULT_MAX_QUEUED_CHUNKS' "$GATE_FILE"
assert_contains "TerminalReplayGate defines onQueueOverflow callback" 'var onQueueOverflow: (() -> Unit)? = null' "$GATE_FILE"
assert_contains "reconcileTerminalOutput handles duplicate discard" 'ReconcileOutputResult.Discard(currentOffset)' "$GATE_FILE"
assert_contains "reconcileTerminalOutput handles gap detection" 'ReconcileOutputResult.Gap(' "$GATE_FILE"
assert_contains "reconcileTerminalOutput handles partial overlap slicing" 'ReconcileOutputResult.Render(slicedData, endOffset)' "$GATE_FILE"

echo "=== Suite 3: Server-Authoritative Agent Status & Fencing (T03, N01) ==="
REDUCER_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt"
assert_contains "AgentStatusReducer tracks serverEpoch" 'serverEpoch = snapshot.serverEpoch' "$REDUCER_FILE"
assert_contains "AgentStatusReducer enforces revision ordering" 'msg.revision <= current.revision' "$REDUCER_FILE"
assert_contains "AgentStatusReducer seeds seen attentions from snapshot" 'seenAttentionIds.add(seedId)' "$REDUCER_FILE"
assert_contains "AgentStatusReducer filters agents by state" 'enum class AgentFilter' "$REDUCER_FILE"
assert_contains "findAgentForSession validates exact terminal incarnation" 'if (row.incarnation == incarnation) row else null' "$REDUCER_FILE"

echo "=== Suite 4: Terminal Controller, Input Isolation & IME Integration ==="
CONTROLLER_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt"
assert_contains "TerminalSessionController gates on isPanelActive" 'if (!isPanelActive) return' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController gates on isReplayCompleted" 'if (!isReplayCompleted) return' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController gates on shouldForwardTerminalData" 'if (!gate.shouldForwardTerminalData()) return' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController encodes bracketed paste" 'fun encodeBracketedPaste(text: String): ByteArray' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController bracketed paste escape start" '\u001b[200~' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController bracketed paste escape end" '\u001b[201~' "$CONTROLLER_FILE"
assert_contains "TerminalSessionController encodes ANSI arrows" '"UP" -> "\u001b[A"' "$CONTROLLER_FILE"

INPUT_FILE="native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/TerminalInputController.kt"
assert_contains "TerminalInputController defines onHardwareKey" 'fun onHardwareKey(' "$INPUT_FILE"
assert_contains "TerminalInputController defines onImeCommitText" 'fun onImeCommitText(text: CharSequence)' "$INPUT_FILE"
assert_contains "TerminalInputController defines onImeDeleteBackward" 'fun onImeDeleteBackward()' "$INPUT_FILE"
assert_contains "TerminalInputController wraps clipboard in bracketed paste" 'sessionController.pasteText(text)' "$INPUT_FILE"

echo "=== Suite 5: UI & Presentation Invariants (No FABs, Single Content Area) ==="
UI_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt"
assert_contains "TerminalPanelScreen provides inline accessory bar" 'AccessoryKeyButton(' "$UI_FILE"
assert_contains "TerminalPanelScreen provides in-panel session tabs" 'sessions.forEach { session ->' "$UI_FILE"
assert_contains "AgentsPanelScreen provides jump to session button" 'Jump to Session' "$UI_FILE"

SHARED_UI_DIR="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp"
if grep -rn "FloatingActionButton" "$SHARED_UI_DIR" 2>/dev/null; then
    echo "  [FAIL] FloatingActionButton found in shared UI"
    FAIL_COUNT=$((FAIL_COUNT + 1))
else
    echo "  [PASS] Zero FloatingActionButtons in shared workbench UI"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

MANIFEST_FILE="native/android-app/androidApp/src/main/AndroidManifest.xml"
assert_contains "Manifest sets adjustResize for IME" 'android:windowSoftInputMode="adjustResize"' "$MANIFEST_FILE"

SCREEN_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen wires terminalContent into PanelHost" 'terminalContent = {' "$SCREEN_FILE"
assert_contains "WorkbenchScreen wires agentsContent into PanelHost" 'agentsContent = {' "$SCREEN_FILE"

echo ""
echo "=== Phase 07 Verification Summary ==="
echo "Total assertions: $((PASS_COUNT + FAIL_COUNT))"
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "FAILED: Phase 07 static verification checks failed."
    exit 1
fi
echo "SUCCESS: All Phase 07 static verification assertions passed."
