#!/usr/bin/env bash
set -euo pipefail

# Host Resources Fleet and Usage Invariant Test for Phase 15 (H01, U01)
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

echo "=== Suite 1: Host Resource Models & DTOs (H01) ==="
MODELS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceModels.kt"
METRICS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostMetricsModels.kt"
ALERT_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceAlertModels.kt"

assert_contains "AvailabilityState enum declared" "enum class AvailabilityState" "$MODELS_FILE"
assert_contains "Availability data class declared" "data class Availability(" "$MODELS_FILE"
assert_contains "HostIdentity data class declared" "data class HostIdentity(" "$MODELS_FILE"
assert_contains "MemorySnapshot data class declared" "data class MemorySnapshot(" "$MODELS_FILE"
assert_contains "PressureInfo data class declared" "data class PressureInfo(" "$MODELS_FILE"
assert_contains "MemoryPressure data class declared" "data class MemoryPressure(" "$MODELS_FILE"
assert_contains "CgroupMemory data class declared" "data class CgroupMemory(" "$MODELS_FILE"
assert_contains "ProcessMemory data class declared" "data class ProcessMemory(" "$MODELS_FILE"
assert_contains "ProcessInventory data class declared" "data class ProcessInventory(" "$MODELS_FILE"
assert_contains "MountContext data class declared" "data class MountContext(" "$MODELS_FILE"
assert_contains "BatterySnapshot data class declared" "data class BatterySnapshot(" "$MODELS_FILE"
assert_contains "HostResourceSnapshotV1 data class declared" "data class HostResourceSnapshotV1(" "$MODELS_FILE"
assert_contains "HostMetrics data class declared" "data class HostMetrics(" "$METRICS_FILE"
assert_contains "CpuMetrics data class declared" "data class CpuMetrics(" "$METRICS_FILE"
assert_contains "MemoryMetrics data class declared" "data class MemoryMetrics(" "$METRICS_FILE"
assert_contains "DiskMetrics data class declared" "data class DiskMetrics(" "$METRICS_FILE"
assert_contains "AlertState enum declared" "enum class AlertState" "$ALERT_FILE"
assert_contains "AlertSeverity enum declared" "enum class AlertSeverity" "$ALERT_FILE"
assert_contains "AlertSummary data class declared" "data class AlertSummary(" "$ALERT_FILE"
assert_contains "AlertIncident data class declared" "data class AlertIncident(" "$ALERT_FILE"

echo "=== Suite 2: Usage Models & DTOs (U01) ==="
USAGE_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt"
USAGE_SETTINGS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsModels.kt"

assert_contains "UsageRange declared" "data class UsageRange(" "$USAGE_MODELS"
assert_contains "TokenAggregate declared" "data class TokenAggregate(" "$USAGE_MODELS"
assert_contains "UsageTimeBucket declared" "data class UsageTimeBucket(" "$USAGE_MODELS"
assert_contains "CollectorHealthSnapshot declared" "data class CollectorHealthSnapshot(" "$USAGE_MODELS"
assert_contains "UsageHealth declared" "data class UsageHealth(" "$USAGE_MODELS"
assert_contains "UsageSummaryResponse declared" "data class UsageSummaryResponse(" "$USAGE_MODELS"
assert_contains "SessionRange declared" "data class SessionRange(" "$USAGE_MODELS"
assert_contains "SessionTokens declared" "data class SessionTokens(" "$USAGE_MODELS"
assert_contains "SessionSummaryDto declared" "data class SessionSummaryDto(" "$USAGE_MODELS"
assert_contains "SessionListResponse declared" "data class SessionListResponse(" "$USAGE_MODELS"
assert_contains "SessionDetailResponse declared" "data class SessionDetailResponse(" "$USAGE_MODELS"
assert_contains "DeleteUsageRequest declared" "data class DeleteUsageRequest(" "$USAGE_MODELS"
assert_contains "Delete confirmation default" "delete-usage-data" "$USAGE_MODELS"
assert_contains "CodexExporterStatus declared" "enum class CodexExporterStatus" "$USAGE_SETTINGS"
assert_contains "UsageSettingsResponse declared" "data class UsageSettingsResponse(" "$USAGE_SETTINGS"
assert_contains "SettingsPatchRequest declared" "data class SettingsPatchRequest(" "$USAGE_SETTINGS"
assert_contains "UsageSetupStatusResponse declared" "data class UsageSetupStatusResponse(" "$USAGE_SETTINGS"

echo "=== Suite 3: Streaming, Pairing & Coordination (H01) ==="
STREAM_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamModels.kt"
STREAM_COORD="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinator.kt"
STREAM_TIMERS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamTimers.kt"
FRAME_COMMIT="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceFrameCommitter.kt"
FAILURE_HANDLER="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceFailureHandler.kt"
SSE_CLIENT="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/HostResourceSseClient.kt"

assert_contains "ResourceSourceMode declared" "enum class ResourceSourceMode" "$STREAM_MODELS"
assert_contains "ResourceConsumerKind declared" "enum class ResourceConsumerKind" "$STREAM_MODELS"
assert_contains "ProjectionFreshness declared" "data class ProjectionFreshness(" "$STREAM_MODELS"
assert_contains "ResourceSourceState declared" "data class ResourceSourceState(" "$STREAM_MODELS"
assert_contains "Initial data deadline 10s" "10_000L" "$STREAM_TIMERS"
assert_contains "Byte idle timeout 45s" "45_000L" "$STREAM_TIMERS"
assert_contains "Max retry count 5" "MAX_RETRY_COUNT = 5" "$STREAM_TIMERS"
assert_contains "Stable live window 60s" "STABLE_WINDOW_MS = 60_000L" "$STREAM_TIMERS"
assert_contains "canUseResourceRest declared" "fun canUseResourceRest(): Boolean" "$STREAM_COORD"
assert_contains "registerInterest declared" "fun registerInterest(" "$STREAM_COORD"
assert_contains "commitRestPair declared" "suspend fun commitRestPair(" "$STREAM_COORD"
assert_contains "Revision duplicate check" "newRev <= currentRev" "$FRAME_COMMIT"
assert_contains "Epoch switch check" "currentEpoch == data.serverEpoch" "$FRAME_COMMIT"
assert_contains "AUTH_UNAVAILABLE latches AuthBlocked" "AUTH_UNAVAILABLE" "$FAILURE_HANDLER"
assert_contains "FRAME_TOO_LARGE latches RestOnly" "FRAME_TOO_LARGE" "$FAILURE_HANDLER"
assert_contains "Bounded error channel read" "errorBytes < 4096" "$SSE_CLIENT"
assert_contains "Data event overflow limit check" "MAX_DATA_EVENT_BYTES" "$SSE_CLIENT"
assert_contains "Byte progress notification" "onByteProgress" "$SSE_CLIENT"

echo "=== Suite 4: Repositories & Controllers (H01, U01) ==="
HOST_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceRepository.kt"
USAGE_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt"
HOST_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceController.kt"
USAGE_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageController.kt"

assert_contains "HostResourceRepository declared" "class HostResourceRepository(" "$HOST_REPO"
assert_contains "getSnapshot route" "/api/system/resources/v1/snapshot" "$HOST_REPO"
assert_contains "getMetrics route" "/api/system/metrics" "$HOST_REPO"
assert_contains "getAlertHistory route" "/api/system/resources/v1/alerts" "$HOST_REPO"
assert_contains "UsageRepository declared" "class UsageRepository(" "$USAGE_REPO"
assert_contains "getSummary route" "/api/usage/summary" "$USAGE_REPO"
assert_contains "getHealth route" "/api/usage/health" "$USAGE_REPO"
assert_contains "getSettings route" "/api/usage/settings" "$USAGE_REPO"
assert_contains "getSetup route" "/api/usage/setup" "$USAGE_REPO"
assert_contains "listSessions route" "/api/usage/sessions" "$USAGE_REPO"
assert_contains "deleteUsage route" "/api/usage" "$USAGE_REPO"
assert_contains "HostResourceController declared" "class HostResourceController(" "$HOST_CTRL"
assert_contains "UsageController declared" "class UsageController(" "$USAGE_CTRL"
assert_contains "deleteUsage enforces confirmation" "delete-usage-data" "$USAGE_CTRL"
assert_contains "summaryGeneration tracking" "summaryGeneration++" "$USAGE_CTRL"
assert_contains "sessionsGeneration tracking" "sessionsGeneration++" "$USAGE_CTRL"

echo "=== Suite 5: UI & Workbench Integration (H01, U01) ==="
FLEET_SCREENS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/FleetScreens.kt"
USAGE_SCREENS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt"
UNIFIED_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourcesUnifiedPanelScreen.kt"
WORKBENCH="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"

assert_contains "FleetScreens composable" "fun FleetScreens(" "$FLEET_SCREENS"
assert_contains "UsageScreens composable" "fun UsageScreens(" "$USAGE_SCREENS"
assert_contains "ResourcesUnifiedPanelScreen composable" "fun ResourcesUnifiedPanelScreen(" "$UNIFIED_SCREEN"
assert_contains "ResourcesSubProduct enum" "enum class ResourcesSubProduct" "$UNIFIED_SCREEN"
assert_contains "Resources panel host slot" "resourcesContent = {" "$WORKBENCH"
assert_contains "Resources subproduct back handler" "WorkbenchPanel.RESOURCES" "$WORKBENCH"
assert_not_contains "Zero FloatingActionButton in host" "FloatingActionButton" "$FLEET_SCREENS"
assert_not_contains "Zero FloatingActionButton in usage" "FloatingActionButton" "$USAGE_SCREENS"
assert_not_contains "Zero WebView in host" "WebView" "$FLEET_SCREENS"
assert_not_contains "Zero WebView in usage" "WebView" "$USAGE_SCREENS"

echo ""
echo "=== Phase 15 Invariant Checks: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
