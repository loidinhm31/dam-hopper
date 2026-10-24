package dev.damhopper.nativeapp.features.agents

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Supported agent types in DamHopper.
 */
@Serializable
enum class AgentType(val wireName: String) {
    @SerialName("claude")
    CLAUDE("claude"),

    @SerialName("gemini")
    GEMINI("gemini");

    companion object {
        fun fromString(s: String): AgentType? =
            entries.firstOrNull { it.wireName.equals(s, ignoreCase = true) }
    }
}

/**
 * Category of agent items distributed via the Agent Store.
 * Wire names match server kebab-case serialization.
 */
@Serializable
enum class AgentItemCategory(
    val wireName: String,
    val storeDir: String,
    val displayName: String
) {
    @SerialName("skill")
    SKILL("skill", "skills", "Skill"),

    @SerialName("command")
    COMMAND("command", "commands", "Command"),

    @SerialName("hook")
    HOOK("hook", "hooks", "Hook"),

    @SerialName("mcp-server")
    MCP_SERVER("mcp-server", "mcp-servers", "MCP Server"),

    @SerialName("subagent")
    SUBAGENT("subagent", "subagents", "Subagent"),

    @SerialName("memory-template")
    MEMORY_TEMPLATE("memory-template", "memory-templates", "Memory Template");

    companion object {
        fun fromString(s: String): AgentItemCategory? =
            entries.firstOrNull { it.wireName.equals(s, ignoreCase = true) }
    }
}

/**
 * Method of distribution for agent items to target projects.
 */
@Serializable
enum class DistributionMethod(val wireName: String) {
    @SerialName("symlink")
    SYMLINK("symlink"),

    @SerialName("copy")
    COPY("copy");

    companion object {
        fun fromString(s: String): DistributionMethod? =
            entries.firstOrNull { it.wireName.equals(s, ignoreCase = true) }
    }
}

/**
 * Single item declared in the central Agent Store.
 */
@Serializable
data class AgentStoreItem(
    val name: String,
    val category: AgentItemCategory,
    @SerialName("relativePath")
    val relativePath: String = "",
    val description: String? = null,
    @SerialName("compatibleAgents")
    val compatibleAgents: List<AgentType> = emptyList(),
    @SerialName("sizeBytes")
    val sizeBytes: Long? = null
)

/**
 * Distribution state of an item in a specific project for an agent.
 */
@Serializable
data class DistributionStatus(
    val shipped: Boolean = false,
    val method: DistributionMethod? = null
)

/**
 * Result of shipping, unshipping, or absorbing an agent item.
 */
@Serializable
data class ShipResult(
    val item: String,
    val category: AgentItemCategory,
    val project: String,
    val agent: AgentType,
    val method: DistributionMethod = DistributionMethod.SYMLINK,
    val success: Boolean,
    val error: String? = null,
    @SerialName("targetPath")
    val targetPath: String? = null
)

@Serializable
data class BrokenSymlink(
    val project: String,
    val path: String,
    val target: String
)

@Serializable
data class OrphanedItem(
    val project: String,
    val path: String,
    val reason: String
)

@Serializable
data class HealthCheckResult(
    @SerialName("brokenSymlinks")
    val brokenSymlinks: List<BrokenSymlink> = emptyList(),
    @SerialName("orphanedItems")
    val orphanedItems: List<OrphanedItem> = emptyList()
)

@Serializable
data class AgentPresence(
    @SerialName("hasConfig")
    val hasConfig: Boolean = false,
    val skills: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
    val hooks: List<String> = emptyList(),
    @SerialName("hasMemoryFile")
    val hasMemoryFile: Boolean = false,
    @SerialName("hasMcpConfig")
    val hasMcpConfig: Boolean = false
)

@Serializable
data class ProjectAgentScanResult(
    @SerialName("projectName")
    val projectName: String,
    @SerialName("projectPath")
    val projectPath: String,
    val agents: Map<String, AgentPresence> = emptyMap()
)

@Serializable
data class ShipRequest(
    @SerialName("itemName")
    val itemName: String,
    val category: AgentItemCategory,
    @SerialName("projectName")
    val projectName: String,
    val agent: AgentType,
    val method: DistributionMethod? = null
)

@Serializable
data class UnshipRequest(
    @SerialName("itemName")
    val itemName: String,
    val category: AgentItemCategory,
    @SerialName("projectName")
    val projectName: String,
    val agent: AgentType,
    val force: Boolean? = null
)

@Serializable
data class AbsorbRequest(
    @SerialName("itemName")
    val itemName: String,
    val category: AgentItemCategory,
    @SerialName("projectName")
    val projectName: String,
    val agent: AgentType
)

@Serializable
data class BulkShipItem(
    val name: String,
    val category: AgentItemCategory
)

@Serializable
data class BulkShipProject(
    @SerialName("projectName")
    val projectName: String,
    val agent: AgentType
)

@Serializable
data class BulkShipRequest(
    val items: List<BulkShipItem>,
    val projects: List<BulkShipProject>,
    val method: DistributionMethod? = null
)

@Serializable
data class ItemContentResponse(
    val content: String = ""
)

// -----------------------------------------------------------------------------
// Memory Models
// -----------------------------------------------------------------------------

@Serializable
data class MemoryTemplateInfo(
    val name: String,
    val content: String
)

@Serializable
data class ProjectMemoryAgentEntry(
    val agent: String,
    val content: String? = null
)

@Serializable
data class ProjectMemoryDetailResponse(
    @SerialName("projectName")
    val projectName: String,
    val agent: String,
    val content: String? = null
)

@Serializable
data class UpdateMemoryRequest(
    val content: String
)

@Serializable
data class ApplyTemplateRequest(
    @SerialName("projectName")
    val projectName: String,
    val agent: String,
    @SerialName("templateName")
    val templateName: String,
    val write: Boolean? = false
)

@Serializable
data class ApplyTemplateResponse(
    val content: String
)

// -----------------------------------------------------------------------------
// Import Models
// -----------------------------------------------------------------------------

@Serializable
data class RepoScanItem(
    val name: String,
    val category: AgentItemCategory,
    val description: String? = null,
    @SerialName("relativePath")
    val relativePath: String
)

@Serializable
data class ScanRepoRequest(
    @SerialName("repoUrl")
    val repoUrl: String
)

@Serializable
data class ScanRepoResponse(
    @SerialName("repoUrl")
    val repoUrl: String,
    @SerialName("tmpDir")
    val tmpDir: String,
    val items: List<RepoScanItem> = emptyList()
)

@Serializable
data class ScanLocalRequest(
    @SerialName("dirPath")
    val dirPath: String
)

@Serializable
data class ScanLocalResponse(
    @SerialName("dirPath")
    val dirPath: String,
    val items: List<RepoScanItem> = emptyList()
)

@Serializable
data class ImportConfirmRequest(
    @SerialName("sourceDir")
    val sourceDir: String,
    val items: List<RepoScanItem>,
    val cleanup: Boolean? = false
)

@Serializable
data class ImportResult(
    val name: String,
    val success: Boolean,
    val error: String? = null
)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

object AgentStoreHelpers {
    fun itemKey(category: AgentItemCategory, name: String): String =
        "${category.wireName}:$name"

    fun projectAgentKey(projectName: String, agent: AgentType): String =
        "$projectName:${agent.wireName}"

    fun formatBytes(bytes: Long?): String {
        if (bytes == null || bytes <= 0) return "0 B"
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        return when {
            mb >= 1.0 -> "${(mb * 10).toLong() / 10.0} MB"
            kb >= 1.0 -> "${(kb * 10).toLong() / 10.0} KB"
            else -> "$bytes B"
        }
    }
}
