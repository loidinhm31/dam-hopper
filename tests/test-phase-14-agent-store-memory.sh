#!/usr/bin/env bash
set -euo pipefail

# Agent Store Imports and Memory Invariant Test for Phase 14 (S01, S02)
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

echo "=== Suite 1: Agent Store Models & Wire DTOs (S01, S02) ==="
STORE_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreModels.kt"
assert_contains "AgentType enum declared" "enum class AgentType(" "$STORE_MODELS"
assert_contains "AgentItemCategory enum declared" "enum class AgentItemCategory(" "$STORE_MODELS"
assert_contains "DistributionMethod enum declared" "enum class DistributionMethod(" "$STORE_MODELS"
assert_contains "AgentStoreItem declared" "data class AgentStoreItem(" "$STORE_MODELS"
assert_contains "DistributionStatus declared" "data class DistributionStatus(" "$STORE_MODELS"
assert_contains "ShipResult declared" "data class ShipResult(" "$STORE_MODELS"
assert_contains "BrokenSymlink declared" "data class BrokenSymlink(" "$STORE_MODELS"
assert_contains "OrphanedItem declared" "data class OrphanedItem(" "$STORE_MODELS"
assert_contains "HealthCheckResult declared" "data class HealthCheckResult(" "$STORE_MODELS"
assert_contains "AgentPresence declared" "data class AgentPresence(" "$STORE_MODELS"
assert_contains "ProjectAgentScanResult declared" "data class ProjectAgentScanResult(" "$STORE_MODELS"
assert_contains "ShipRequest declared" "data class ShipRequest(" "$STORE_MODELS"
assert_contains "UnshipRequest declared" "data class UnshipRequest(" "$STORE_MODELS"
assert_contains "AbsorbRequest declared" "data class AbsorbRequest(" "$STORE_MODELS"
assert_contains "BulkShipRequest declared" "data class BulkShipRequest(" "$STORE_MODELS"
assert_contains "BulkShipItem declared" "data class BulkShipItem(" "$STORE_MODELS"
assert_contains "BulkShipProject declared" "data class BulkShipProject(" "$STORE_MODELS"
assert_contains "ItemContentResponse declared" "data class ItemContentResponse(" "$STORE_MODELS"
assert_contains "MemoryTemplateInfo declared" "data class MemoryTemplateInfo(" "$STORE_MODELS"
assert_contains "ProjectMemoryAgentEntry declared" "data class ProjectMemoryAgentEntry(" "$STORE_MODELS"
assert_contains "ProjectMemoryDetailResponse declared" "data class ProjectMemoryDetailResponse(" "$STORE_MODELS"
assert_contains "UpdateMemoryRequest declared" "data class UpdateMemoryRequest(" "$STORE_MODELS"
assert_contains "ApplyTemplateRequest declared" "data class ApplyTemplateRequest(" "$STORE_MODELS"
assert_contains "ApplyTemplateResponse declared" "data class ApplyTemplateResponse(" "$STORE_MODELS"
assert_contains "RepoScanItem declared" "data class RepoScanItem(" "$STORE_MODELS"
assert_contains "ScanRepoRequest declared" "data class ScanRepoRequest(" "$STORE_MODELS"
assert_contains "ScanRepoResponse declared" "data class ScanRepoResponse(" "$STORE_MODELS"
assert_contains "ScanLocalRequest declared" "data class ScanLocalRequest(" "$STORE_MODELS"
assert_contains "ScanLocalResponse declared" "data class ScanLocalResponse(" "$STORE_MODELS"
assert_contains "ImportConfirmRequest declared" "data class ImportConfirmRequest(" "$STORE_MODELS"
assert_contains "ImportResult declared" "data class ImportResult(" "$STORE_MODELS"
assert_contains "AgentStoreHelpers object declared" "object AgentStoreHelpers" "$STORE_MODELS"
assert_contains "Exact claude agent wire spelling" "@SerialName(\"claude\")" "$STORE_MODELS"
assert_contains "Exact gemini agent wire spelling" "@SerialName(\"gemini\")" "$STORE_MODELS"
assert_contains "Exact skill category wire spelling" "@SerialName(\"skill\")" "$STORE_MODELS"
assert_contains "Exact command category wire spelling" "@SerialName(\"command\")" "$STORE_MODELS"
assert_contains "Exact hook category wire spelling" "@SerialName(\"hook\")" "$STORE_MODELS"
assert_contains "Exact mcp-server category wire spelling" "@SerialName(\"mcp-server\")" "$STORE_MODELS"
assert_contains "Exact subagent category wire spelling" "@SerialName(\"subagent\")" "$STORE_MODELS"
assert_contains "Exact memory-template category wire spelling" "@SerialName(\"memory-template\")" "$STORE_MODELS"
assert_contains "Exact symlink method wire spelling" "@SerialName(\"symlink\")" "$STORE_MODELS"
assert_contains "Exact copy method wire spelling" "@SerialName(\"copy\")" "$STORE_MODELS"

echo "=== Suite 2: Agent Store Repository & REST Contracts (S01) ==="
STORE_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreRepository.kt"
assert_contains "AgentStoreRepository class declared" "class AgentStoreRepository(" "$STORE_REPO"
assert_contains "listItems method declared" "suspend fun listItems(" "$STORE_REPO"
assert_contains "getItem method declared" "suspend fun getItem(" "$STORE_REPO"
assert_contains "getItemContent method declared" "suspend fun getItemContent(" "$STORE_REPO"
assert_contains "removeItem method declared" "suspend fun removeItem(" "$STORE_REPO"
assert_contains "shipItem method declared" "suspend fun shipItem(" "$STORE_REPO"
assert_contains "unshipItem method declared" "suspend fun unshipItem(" "$STORE_REPO"
assert_contains "absorbItem method declared" "suspend fun absorbItem(" "$STORE_REPO"
assert_contains "bulkShip method declared" "suspend fun bulkShip(" "$STORE_REPO"
assert_contains "getMatrix method declared" "suspend fun getMatrix(" "$STORE_REPO"
assert_contains "scanProjects method declared" "suspend fun scanProjects(" "$STORE_REPO"
assert_contains "healthCheck method declared" "suspend fun healthCheck(" "$STORE_REPO"
assert_contains "Catalog 404 detection for unavailable feature" "if (e.status == 404) {" "$STORE_REPO"
assert_contains "Item 404 returns null" "if (e.status == 404) {" "$STORE_REPO"
assert_contains "URL encoding for category" "ApiClient.encodePathSegment(category.wireName)" "$STORE_REPO"
assert_contains "URL encoding for item name" "ApiClient.encodePathSegment(name)" "$STORE_REPO"

echo "=== Suite 3: Agent Memory Repository & Template Contracts (S02) ==="
MEM_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryRepository.kt"
assert_contains "AgentMemoryRepository class declared" "class AgentMemoryRepository(" "$MEM_REPO"
assert_contains "listTemplates method declared" "suspend fun listTemplates(" "$MEM_REPO"
assert_contains "listProjectMemory method declared" "suspend fun listProjectMemory(" "$MEM_REPO"
assert_contains "getProjectMemory method declared" "suspend fun getProjectMemory(" "$MEM_REPO"
assert_contains "updateProjectMemory method declared" "suspend fun updateProjectMemory(" "$MEM_REPO"
assert_contains "applyTemplate method declared" "suspend fun applyTemplate(" "$MEM_REPO"
assert_contains "Memory item 404 returns null" "if (e.status == 404) {" "$MEM_REPO"
assert_contains "URL encoding for project name" "ApiClient.encodePathSegment(projectName)" "$MEM_REPO"
assert_contains "URL encoding for agent name" "ApiClient.encodePathSegment(agent.wireName)" "$MEM_REPO"

echo "=== Suite 4: Agent Import Repository & Scan Contracts (S02) ==="
IMPORT_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportRepository.kt"
assert_contains "AgentImportRepository class declared" "class AgentImportRepository(" "$IMPORT_REPO"
assert_contains "scanRepo endpoint call" "\"/api/agent-import/scan\"" "$IMPORT_REPO"
assert_contains "scanLocal endpoint call" "\"/api/agent-import/scan-local\"" "$IMPORT_REPO"
assert_contains "confirmImport endpoint call" "\"/api/agent-import/confirm\"" "$IMPORT_REPO"

echo "=== Suite 5: Controllers with Fencing and Owner Isolation (S01, S02) ==="
STORE_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreController.kt"
assert_contains "AgentStoreController declared" "class AgentStoreController(" "$STORE_CTRL"
assert_contains "Immutable profileId and generation binding" "val profileId: String" "$STORE_CTRL"
assert_contains "Retire method declared" "fun retire()" "$STORE_CTRL"
assert_contains "Request sequence fencing in loadStore" "if (isRetired || seq != requestSequence) return@launch" "$STORE_CTRL"
assert_contains "Content request sequence fencing" "if (isRetired || seq != contentRequestSequence) return@launch" "$STORE_CTRL"
assert_contains "Bulk ship surfaces partial results" "bulkResults = results" "$STORE_CTRL"

MEM_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryController.kt"
assert_contains "AgentMemoryController declared" "class AgentMemoryController(" "$MEM_CTRL"
assert_contains "Target switch protection" "fun requestTargetSwitch(" "$MEM_CTRL"
assert_contains "Monotonic save op revision" "val opRev = ++saveOpRevision" "$MEM_CTRL"
assert_contains "Edits during save stay dirty" "val stillMatches = current.content == capturedContent" "$MEM_CTRL"
assert_contains "Template preview does not overwrite without confirmation" "write = false" "$MEM_CTRL"

IMPORT_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportController.kt"
assert_contains "AgentImportController declared" "class AgentImportController(" "$IMPORT_CTRL"
assert_contains "Source change bumps scan revision" "val nextRev = ++scanRevision" "$IMPORT_CTRL"
assert_contains "Cleanup flag derived from source" "val cleanup = (captured.source == ImportSource.REPO)" "$IMPORT_CTRL"

echo "=== Suite 6: UI Surfaces and Workbench Invariants (NAV01, B01, B02) ==="
STORE_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreScreens.kt"
assert_not_contains "Zero FABs in AgentStoreScreens" "FloatingActionButton" "$STORE_SCREENS"
assert_not_contains "Zero WebView in AgentStoreScreens" "WebView" "$STORE_SCREENS"
assert_contains "MarkdownPreviewView used for item markdown preview" "MarkdownPreviewView(" "$STORE_SCREENS"

MEM_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryScreens.kt"
assert_not_contains "Zero FABs in AgentMemoryScreens" "FloatingActionButton" "$MEM_SCREENS"
assert_not_contains "Zero WebView in AgentMemoryScreens" "WebView" "$MEM_SCREENS"
assert_contains "MarkdownPreviewView used for template preview" "MarkdownPreviewView(" "$MEM_SCREENS"

IMPORT_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportScreens.kt"
assert_not_contains "Zero FABs in AgentImportScreens" "FloatingActionButton" "$IMPORT_SCREENS"
assert_not_contains "Zero WebView in AgentImportScreens" "WebView" "$IMPORT_SCREENS"

UNIFIED_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentsUnifiedPanelScreen.kt"
assert_contains "AgentsSubProduct enum declared" "enum class AgentsSubProduct" "$UNIFIED_SCREEN"
assert_contains "AgentsUnifiedPanelScreen declared" "fun AgentsUnifiedPanelScreen(" "$UNIFIED_SCREEN"
assert_not_contains "Zero FABs in AgentsUnifiedPanelScreen" "FloatingActionButton" "$UNIFIED_SCREEN"

WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "AgentsUnifiedPanelScreen wired in PanelHost" "agentsContent = {" "$WORKBENCH_SCREEN"
assert_contains "AgentsUnifiedPanelScreen invocation" "AgentsUnifiedPanelScreen(" "$WORKBENCH_SCREEN"
assert_contains "Agents sub-product back handler" "navState.activePanel == WorkbenchPanel.AGENTS" "$WORKBENCH_SCREEN"

echo ""
echo "=== Static Assertion Summary ==="
echo "  Total Passed: $PASS_COUNT"
echo "  Total Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "FAILED: Static invariant checks did not satisfy Phase 14 requirements."
    exit 1
fi

echo "ALL STATIC INVARIANTS PASSED SUCCESSFULLY!"
