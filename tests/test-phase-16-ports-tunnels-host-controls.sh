#!/usr/bin/env bash
set -euo pipefail

# Ports, Tunnels, Idle Consent, and Host Controls Invariant Test for Phase 16 (P01, H02, C03)
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

echo "=== Suite 1: Port and Tunnel Models & Contracts ==="
PORT_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortModels.kt"
TUNNEL_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/TunnelModels.kt"

assert_contains "DetectedVia enum declared" "enum class DetectedVia" "$PORT_MODELS"
assert_contains "PortState enum declared" "enum class PortState" "$PORT_MODELS"
assert_contains "DetectedPort data class declared" "data class DetectedPort(" "$PORT_MODELS"
assert_contains "session_id wire mapping" '@SerialName("session_id")' "$PORT_MODELS"
assert_contains "detected_via wire mapping" '@SerialName("detected_via")' "$PORT_MODELS"
assert_contains "PortListResponse declared" "data class PortListResponse(" "$PORT_MODELS"

assert_contains "TunnelStatus enum declared" "enum class TunnelStatus" "$TUNNEL_MODELS"
assert_contains "TunnelSession data class declared" "data class TunnelSession(" "$TUNNEL_MODELS"
assert_contains "CreateTunnelRequest data class declared" "data class CreateTunnelRequest(" "$TUNNEL_MODELS"
assert_contains "InstallStatusResponse data class declared" "data class InstallStatusResponse(" "$TUNNEL_MODELS"
assert_contains "startedAt wire mapping" '@SerialName("startedAt")' "$TUNNEL_MODELS"
assert_contains "reminderDue wire mapping" '@SerialName("reminderDue")' "$TUNNEL_MODELS"

echo "=== Suite 2: Port & Tunnel Repositories & WebSocket Events ==="
PORT_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortRepository.kt"
TUNNEL_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/TunnelRepository.kt"
SERVER_MSG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt"

assert_contains "PortRepository declared" "class PortRepository(" "$PORT_REPO"
assert_contains "GET /api/ports route called" '"/api/ports"' "$PORT_REPO"
assert_contains "PortDiscovered event handled" "is ServerMsg.PortDiscovered ->" "$PORT_REPO"
assert_contains "PortLost event handled" "is ServerMsg.PortLost ->" "$PORT_REPO"
assert_contains "Incarnation fencing check" "msg.incarnation >= existing.incarnation" "$PORT_REPO"

assert_contains "TunnelRepository declared" "class TunnelRepository(" "$TUNNEL_REPO"
assert_contains "GET /api/tunnels route called" '"/api/tunnels"' "$TUNNEL_REPO"
assert_contains "POST /api/tunnels create route called" '"/api/tunnels"' "$TUNNEL_REPO"
assert_contains "DELETE /api/tunnels/{id} called" '"/api/tunnels/$id"' "$TUNNEL_REPO"
assert_contains "GET /api/tunnels/install called" '"/api/tunnels/install"' "$TUNNEL_REPO"
assert_contains "POST /api/tunnels/install called" '"/api/tunnels/install"' "$TUNNEL_REPO"
assert_contains "TunnelReady handled" "is ServerMsg.TunnelReady ->" "$TUNNEL_REPO"
assert_contains "TunnelFailed handled" "is ServerMsg.TunnelFailed ->" "$TUNNEL_REPO"
assert_contains "TunnelStopped handled" "is ServerMsg.TunnelStopped ->" "$TUNNEL_REPO"
assert_contains "TunnelReminder handled" "is ServerMsg.TunnelReminder ->" "$TUNNEL_REPO"
assert_contains "reminderDue set on reminder event" "reminderDue = true" "$TUNNEL_REPO"

assert_contains "host:idleSuspendChanged defined in ServerMsg" 'host:idleSuspendChanged' "$SERVER_MSG"
assert_contains "IdleSuspendChangedPayload defined" "data class IdleSuspendChangedPayload(" "$SERVER_MSG"

echo "=== Suite 3: Idle Suspend Models, DTOs & Fallback Normalization ==="
IDLE_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendModels.kt"

assert_contains "IdleSuspendState enum declared" "enum class IdleSuspendState" "$IDLE_MODELS"
assert_contains "AutomaticPolicy enum declared" "enum class AutomaticPolicy" "$IDLE_MODELS"
assert_contains "MeasurementState enum declared" "enum class MeasurementState" "$IDLE_MODELS"
assert_contains "SleepConsentState enum declared" "enum class SleepConsentState" "$IDLE_MODELS"
assert_contains "SleepConsentDecision enum declared" "enum class SleepConsentDecision" "$IDLE_MODELS"
assert_contains "IdleSuspendStatusV1 data class declared" "data class IdleSuspendStatusV1(" "$IDLE_MODELS"
assert_contains "IdleSuspendTimingPatchRequest declared" "data class IdleSuspendTimingPatchRequest(" "$IDLE_MODELS"
assert_contains "ForceSuspendRequest declared" "data class ForceSuspendRequest(" "$IDLE_MODELS"
assert_contains "ForceSuspendAcceptedResponse declared" "data class ForceSuspendAcceptedResponse(" "$IDLE_MODELS"
assert_contains "ConsentDecisionRequest declared" "data class ConsentDecisionRequest(" "$IDLE_MODELS"
assert_contains "ConsentDecisionResponse declared" "data class ConsentDecisionResponse(" "$IDLE_MODELS"
assert_contains "IdleSuspendConflictResponse declared" "data class IdleSuspendConflictResponse(" "$IDLE_MODELS"
assert_contains "decodeIdleSuspendStatusV1 fallback normalization" "fun decodeIdleSuspendStatusV1(" "$IDLE_MODELS"
assert_contains "decisionCapability redacted in toString" "decisionCapability=[REDACTED]" "$IDLE_MODELS"

echo "=== Suite 4: Idle Suspend Repository & Consent Controller ==="
IDLE_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendRepository.kt"
IDLE_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt"

assert_contains "IdleSuspendRepository declared" "class IdleSuspendRepository(" "$IDLE_REPO"
assert_contains "GET status route called" '"/api/system/idle-suspend/v1/status"' "$IDLE_REPO"
assert_contains "PATCH timing route called" '"/api/system/idle-suspend/v1/timing"' "$IDLE_REPO"
assert_contains "POST force-suspend route called" '"/api/system/idle-suspend/v1/force-suspend"' "$IDLE_REPO"
assert_contains "POST consent decision route called" '"/api/system/idle-suspend/v1/consent/decision"' "$IDLE_REPO"
assert_contains "Active fleet conflict exception declared" "class IdleSuspendActiveFleetConflictException(" "$IDLE_REPO"
assert_contains "Fleet changed conflict exception declared" "class IdleSuspendFleetChangedConflictException(" "$IDLE_REPO"
assert_contains "Handoff conflict exception declared" "class IdleSuspendHandoffConflictException(" "$IDLE_REPO"

assert_contains "IdleConsentController declared" "class IdleConsentController(" "$IDLE_CTRL"
assert_contains "Live receipt provider injected" "val receiptProvider: () -> UiConnectionReceipt?" "$IDLE_CTRL"
assert_contains "Fail closed when live receipt is missing" "live WebSocket capability receipt not available" "$IDLE_CTRL"
assert_contains "Revision zero treated as broadcast lag reconciliation" "rev == 0L || rev != _lastRevision.value" "$IDLE_CTRL"
assert_contains "submitConsent method declared" "suspend fun submitConsent(" "$IDLE_CTRL"
assert_contains "requestForceSuspend non-retrying method" "suspend fun requestForceSuspend(" "$IDLE_CTRL"

echo "=== Suite 5: SSH, Host Control, and Diagnostics Repositories ==="
SSH_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshModels.kt"
SSH_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshRepository.kt"
HOST_ACTION_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostActionModels.kt"
HOST_ACTION_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlRepository.kt"
DIAG_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/DiagnosticsModels.kt"
DIAG_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/DiagnosticsRepository.kt"

assert_contains "SshAgentStatus snake_case has_keys wire mapping" '@SerialName("has_keys")' "$SSH_MODELS"
assert_contains "SshAgentStatus snake_case key_count wire mapping" '@SerialName("key_count")' "$SSH_MODELS"
assert_contains "LoadKeyBody passphrase redacted" "passphrase=" "$SSH_MODELS"
assert_contains "LoadKeyBody [REDACTED]" "[REDACTED]" "$SSH_MODELS"
assert_contains "SshRepository GET /api/ssh/keys called" '"/api/ssh/keys"' "$SSH_REPO"
assert_contains "SshRepository GET /api/ssh/agent called" '"/api/ssh/agent"' "$SSH_REPO"
assert_contains "SshRepository POST /api/ssh/keys/load called" '"/api/ssh/keys/load"' "$SSH_REPO"
assert_contains "SshRepository /api/ssh/credentials called" '"/api/ssh/credentials"' "$SSH_REPO"

assert_contains "ActionCapabilitiesResponse declared" "data class ActionCapabilitiesResponse(" "$HOST_ACTION_MODELS"
assert_contains "ApproveIntentRequest password redacted" "password=[REDACTED]" "$HOST_ACTION_MODELS"
assert_contains "ExecutionRequest approvalToken redacted" "approvalToken=[REDACTED]" "$HOST_ACTION_MODELS"
assert_contains "GET capabilities route called" '"/api/system/actions/v1/capabilities"' "$HOST_ACTION_REPO"
assert_contains "POST intents route called" '"/api/system/actions/v1/intents"' "$HOST_ACTION_REPO"
assert_contains "POST approve route called" '"/api/system/actions/v1/intents/$intentId/approve"' "$HOST_ACTION_REPO"
assert_contains "POST executions route called" '"/api/system/actions/v1/executions"' "$HOST_ACTION_REPO"
assert_contains "GET audit route called" '"/api/system/actions/v1/audit"' "$HOST_ACTION_REPO"

assert_contains "DiagnosticExportRequest default false for terminal output" "val includeTerminalOutput: Boolean = false" "$DIAG_MODELS"
assert_contains "POST /api/diagnostics/export called" '"/api/diagnostics/export"' "$DIAG_REPO"

echo "=== Suite 6: UI Presentation & Workbench Wiring Invariants ==="
WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
HOST_DIR="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host"

assert_contains "PORTS wired in WorkbenchScreen" "PortsPanelScreen(" "$WORKBENCH_SCREEN"
assert_contains "SSH_HOST wired in WorkbenchScreen" "HostControlScreens(" "$WORKBENCH_SCREEN"
assert_contains "WorkbenchSleepConsentBanner wired in WorkbenchScreen" "WorkbenchSleepConsentBanner(" "$WORKBENCH_SCREEN"
assert_contains "Live receipt checked for consent banner" "hasLiveReceipt = liveReceipt != null" "$WORKBENCH_SCREEN"

# Check Zero FABs and Zero WebViews in Host features directory
for f in $(find "$HOST_DIR" -name "*.kt"); do
    assert_not_contains "Zero FloatingActionButton in $(basename "$f")" "FloatingActionButton" "$f"
    assert_not_contains "Zero ExtendedFloatingActionButton in $(basename "$f")" "ExtendedFloatingActionButton" "$f"
    assert_not_contains "Zero WebView in $(basename "$f")" "android.webkit.WebView" "$f"
done

echo ""
echo "=== Phase 16 Invariant Test Results ==="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "TEST SUITE FAILED"
    exit 1
fi
echo "ALL PHASE 16 INVARIANT CHECKS PASSED"
