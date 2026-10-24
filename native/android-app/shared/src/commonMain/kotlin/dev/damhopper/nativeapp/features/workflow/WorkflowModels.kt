package dev.damhopper.nativeapp.features.workflow

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ============================================================================
// Closed Domain Enums
// ============================================================================

@Serializable
enum class ItemKind {
    @SerialName("plan")
    PLAN,
    @SerialName("phase")
    PHASE,
    @SerialName("task")
    TASK;

    val wireName: String
        get() = when (this) {
            PLAN -> "plan"
            PHASE -> "phase"
            TASK -> "task"
        }
}

@Serializable
enum class ItemStatus {
    @SerialName("backlog")
    BACKLOG,
    @SerialName("next")
    NEXT,
    @SerialName("in_progress")
    IN_PROGRESS,
    @SerialName("blocked")
    BLOCKED,
    @SerialName("done")
    DONE,
    @SerialName("canceled")
    CANCELED;

    val wireName: String
        get() = when (this) {
            BACKLOG -> "backlog"
            NEXT -> "next"
            IN_PROGRESS -> "in_progress"
            BLOCKED -> "blocked"
            DONE -> "done"
            CANCELED -> "canceled"
        }
}

@Serializable
enum class SessionStatus {
    @SerialName("running")
    RUNNING,
    @SerialName("ended")
    ENDED,
    @SerialName("abandoned")
    ABANDONED;

    val wireName: String
        get() = when (this) {
            RUNNING -> "running"
            ENDED -> "ended"
            ABANDONED -> "abandoned"
        }
}

@Serializable
enum class ResourceLinkType {
    @SerialName("terminal")
    TERMINAL,
    @SerialName("agent")
    AGENT;

    val wireName: String
        get() = when (this) {
            TERMINAL -> "terminal"
            AGENT -> "agent"
        }
}

@Serializable
enum class ResourceObservedState {
    @SerialName("attached")
    ATTACHED,
    @SerialName("stale")
    STALE,
    @SerialName("exited")
    EXITED,
    @SerialName("crashed")
    CRASHED,
    @SerialName("detached")
    DETACHED,
    @SerialName("unknown")
    UNKNOWN;

    val wireName: String
        get() = when (this) {
            ATTACHED -> "attached"
            STALE -> "stale"
            EXITED -> "exited"
            CRASHED -> "crashed"
            DETACHED -> "detached"
            UNKNOWN -> "unknown"
        }
}

@Serializable
enum class WorkflowSource {
    @SerialName("manual")
    MANUAL,
    @SerialName("terminal")
    TERMINAL,
    @SerialName("git")
    GIT,
    @SerialName("agent")
    AGENT,
    @SerialName("system")
    SYSTEM;

    val wireName: String
        get() = when (this) {
            MANUAL -> "manual"
            TERMINAL -> "terminal"
            GIT -> "git"
            AGENT -> "agent"
            SYSTEM -> "system"
        }
}

// ============================================================================
// Core Entities and DTOs
// ============================================================================

@Serializable
data class WorkflowTargetDto(
    val project: String,
    val worktreePath: String? = null
)

@Serializable
data class WorkspaceSummaryDto(
    val id: String,
    val name: String
)

@Serializable
data class ItemDto(
    val id: String,
    val target: WorkflowTargetDto,
    val parentId: String? = null,
    val kind: ItemKind,
    val title: String,
    val summary: String? = null,
    val status: ItemStatus,
    val sortOrder: Int = 0,
    val source: WorkflowSource = WorkflowSource.MANUAL,
    val createdAt: String,
    val updatedAt: String,
    val completedAt: String? = null
)

@Serializable
data class SessionDto(
    val id: String,
    val target: WorkflowTargetDto,
    val itemId: String? = null,
    val status: SessionStatus,
    val startedAt: String,
    val endedAt: String? = null,
    val source: WorkflowSource = WorkflowSource.MANUAL,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class LinkDto(
    val id: String,
    val sessionId: String,
    val resourceType: ResourceLinkType,
    val externalId: String,
    val incarnation: Long? = null,
    val harnessLabel: String? = null,
    val runId: String? = null,
    val observedState: ResourceObservedState = ResourceObservedState.ATTACHED,
    val suggestedEndTime: String? = null,
    val firstSeenAt: String? = null,
    val lastSeenAt: String? = null,
    val linkSource: WorkflowSource = WorkflowSource.MANUAL,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class NoteDto(
    val id: String,
    val itemId: String? = null,
    val sessionId: String? = null,
    val body: String,
    val source: WorkflowSource = WorkflowSource.MANUAL,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String? = null
)

@Serializable
data class EventDto(
    val id: String,
    val eventType: String,
    val source: WorkflowSource = WorkflowSource.MANUAL,
    val target: WorkflowTargetDto? = null,
    val itemId: String? = null,
    val sessionId: String? = null,
    val occurredAt: String,
    val recordedAt: String
)

@Serializable
data class ProjectSummaryDto(
    val project: String,
    val target: WorkflowTargetDto,
    val planCount: Int = 0,
    val taskCount: Int = 0,
    val runningSessionCount: Int = 0,
    val lastActivityAt: String? = null
)

@Serializable
data class ItemProgressDto(
    val totalTrackedTasks: Int,
    val completedTrackedTasks: Int
)

@Serializable
data class ItemOverviewNodeDto(
    val item: ItemDto,
    val progress: ItemProgressDto? = null,
    val notes: List<NoteDto> = emptyList(),
    val activeSessions: List<SessionDto> = emptyList(),
    val children: List<ItemOverviewNodeDto> = emptyList()
)

@Serializable
data class WorkflowOverviewDto(
    val workspace: WorkspaceSummaryDto,
    val serverTime: String,
    val projects: List<ProjectSummaryDto> = emptyList(),
    val plans: List<ItemOverviewNodeDto> = emptyList(),
    val standaloneTasks: List<ItemOverviewNodeDto> = emptyList(),
    val runningSessions: List<SessionDto> = emptyList(),
    val recentEvents: List<EventDto> = emptyList(),
    val truncated: Boolean = false
)

@Serializable
data class WorkflowEventsDto(
    val events: List<EventDto> = emptyList(),
    val nextCursor: String? = null
)

@Serializable
data class PurgeDto(
    val eventsDeleted: Int,
    val notesDeleted: Int
)

// ============================================================================
// Mutation Envelopes & Tombstones
// ============================================================================

@Serializable
data class MutationDto<T>(
    val resource: T,
    val replayed: Boolean = false,
    val eventId: String
)

@Serializable
data class TombstoneDto(
    val resource: TombstoneResource,
    val replayed: Boolean = false,
    val eventId: String
)

@Serializable
data class TombstoneResource(
    val resourceType: String,
    val id: String? = null,
    val sessionId: String? = null,
    val resourceLinkType: ResourceLinkType? = null,
    val externalId: String? = null,
    val deletedAt: String? = null,
    val parentId: String? = null
)

// ============================================================================
// Request DTOs
// ============================================================================

@Serializable
data class CreateItemRequest(
    val requestId: String,
    val target: WorkflowTargetDto,
    val parentId: String? = null,
    val kind: ItemKind,
    val title: String,
    val summary: String? = null,
    val status: ItemStatus? = null,
    val sortOrder: Int? = null
)

/**
 * PatchItemRequest supports distinction between omitted summary,
 * explicit null summary (clear summary), and concrete string.
 */
@Serializable(with = PatchItemRequestSerializer::class)
data class PatchItemRequest(
    val requestId: String,
    val updatedAt: String,
    val title: String? = null,
    val summarySpecified: Boolean = false,
    val summary: String? = null,
    val status: ItemStatus? = null,
    val sortOrder: Int? = null,
    val target: WorkflowTargetDto? = null
)

object PatchItemRequestSerializer : KSerializer<PatchItemRequest> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("PatchItemRequest") {
        element<String>("requestId")
        element<String>("updatedAt")
        element<String?>("title", isOptional = true)
        element<String?>("summary", isOptional = true)
        element<ItemStatus?>("status", isOptional = true)
        element<Int?>("sortOrder", isOptional = true)
        element<WorkflowTargetDto?>("target", isOptional = true)
    }

    override fun serialize(encoder: Encoder, value: PatchItemRequest) {
        val jsonEncoder = encoder as? JsonEncoder ?: throw IllegalStateException("JsonEncoder required")
        val map = mutableMapOf<String, JsonElement>(
            "requestId" to JsonPrimitive(value.requestId),
            "updatedAt" to JsonPrimitive(value.updatedAt)
        )
        if (value.title != null) {
            map["title"] = JsonPrimitive(value.title)
        }
        if (value.summarySpecified) {
            map["summary"] = if (value.summary != null) JsonPrimitive(value.summary) else JsonNull
        }
        if (value.status != null) {
            map["status"] = JsonPrimitive(value.status.wireName)
        }
        if (value.sortOrder != null) {
            map["sortOrder"] = JsonPrimitive(value.sortOrder)
        }
        if (value.target != null) {
            val targetMap = mutableMapOf<String, JsonElement>("project" to JsonPrimitive(value.target.project))
            if (value.target.worktreePath != null) {
                targetMap["worktreePath"] = JsonPrimitive(value.target.worktreePath)
            }
            map["target"] = JsonObject(targetMap)
        }
        jsonEncoder.encodeJsonElement(JsonObject(map))
    }

    override fun deserialize(decoder: Decoder): PatchItemRequest {
        val jsonDecoder = decoder as? JsonDecoder ?: throw IllegalStateException("JsonDecoder required")
        val obj = jsonDecoder.decodeJsonElement().jsonObject
        val requestId = obj["requestId"]?.jsonPrimitive?.content ?: ""
        val updatedAt = obj["updatedAt"]?.jsonPrimitive?.content ?: ""
        val title = obj["title"]?.jsonPrimitive?.content
        val summarySpecified = obj.containsKey("summary")
        val summary = if (summarySpecified && obj["summary"] !is JsonNull) obj["summary"]?.jsonPrimitive?.content else null
        val statusStr = obj["status"]?.jsonPrimitive?.content
        val status = statusStr?.let { s -> ItemStatus.entries.find { it.wireName == s } }
        val sortOrder = obj["sortOrder"]?.jsonPrimitive?.intOrNull
        val targetObj = obj["target"]?.jsonObject
        val target = targetObj?.let {
            WorkflowTargetDto(
                project = it["project"]?.jsonPrimitive?.content ?: "",
                worktreePath = it["worktreePath"]?.jsonPrimitive?.content
            )
        }
        return PatchItemRequest(
            requestId = requestId,
            updatedAt = updatedAt,
            title = title,
            summarySpecified = summarySpecified,
            summary = summary,
            status = status,
            sortOrder = sortOrder,
            target = target
        )
    }
}

@Serializable
data class DeleteItemRequest(
    val requestId: String,
    val updatedAt: String
)

@Serializable
data class CreateSessionRequest(
    val requestId: String,
    val target: WorkflowTargetDto,
    val itemId: String? = null,
    val startedAt: String
)

@Serializable
data class EndSessionRequest(
    val requestId: String,
    val endedAt: String
)

@Serializable
data class AbandonSessionRequest(
    val requestId: String
)

@Serializable
data class LinkResourceRequest(
    val requestId: String,
    val resourceType: ResourceLinkType,
    val externalId: String,
    val incarnation: Long? = null,
    val harnessLabel: String? = null,
    val runId: String? = null
)

@Serializable
data class UnlinkResourceRequest(
    val requestId: String,
    val updatedAt: String,
    val resourceType: ResourceLinkType,
    val externalId: String
)

@Serializable
data class CreateNoteRequest(
    val requestId: String,
    val itemId: String? = null,
    val sessionId: String? = null,
    val body: String
)

@Serializable
data class DeleteNoteRequest(
    val requestId: String,
    val updatedAt: String
)

@Serializable
data class PurgeHistoryRequest(
    val before: String
)

// ============================================================================
// Workflow Domain & Transition Helpers
// ============================================================================

object WorkflowDomainHelpers {

    fun allowedChildKinds(parentKind: ItemKind?): List<ItemKind> = when (parentKind) {
        null -> listOf(ItemKind.PLAN, ItemKind.TASK)
        ItemKind.PLAN -> listOf(ItemKind.PHASE, ItemKind.TASK)
        ItemKind.PHASE -> listOf(ItemKind.TASK)
        ItemKind.TASK -> emptyList()
    }

    fun isValidParentKind(parentKind: ItemKind?, childKind: ItemKind): Boolean {
        return allowedChildKinds(parentKind).contains(childKind)
    }

    fun isOpenItemStatus(status: ItemStatus): Boolean = when (status) {
        ItemStatus.BACKLOG, ItemStatus.NEXT, ItemStatus.IN_PROGRESS, ItemStatus.BLOCKED -> true
        ItemStatus.DONE, ItemStatus.CANCELED -> false
    }

    fun isCompletedItemStatus(status: ItemStatus): Boolean = when (status) {
        ItemStatus.DONE, ItemStatus.CANCELED -> true
        else -> false
    }

    fun isValidStatusTransition(from: ItemStatus, to: ItemStatus): Boolean {
        if (from == to) return true
        return when (from) {
            ItemStatus.BACKLOG -> to == ItemStatus.NEXT || to == ItemStatus.IN_PROGRESS || to == ItemStatus.CANCELED
            ItemStatus.NEXT -> to == ItemStatus.BACKLOG || to == ItemStatus.IN_PROGRESS || to == ItemStatus.CANCELED
            ItemStatus.IN_PROGRESS -> to == ItemStatus.BLOCKED || to == ItemStatus.DONE || to == ItemStatus.CANCELED || to == ItemStatus.BACKLOG || to == ItemStatus.NEXT
            ItemStatus.BLOCKED -> to == ItemStatus.IN_PROGRESS || to == ItemStatus.CANCELED
            ItemStatus.DONE -> to == ItemStatus.IN_PROGRESS
            ItemStatus.CANCELED -> to == ItemStatus.IN_PROGRESS
        }
    }

    fun formatTrackedTasksProgress(progress: ItemProgressDto?): String? {
        if (progress == null || progress.totalTrackedTasks <= 0) return null
        return "${progress.completedTrackedTasks}/${progress.totalTrackedTasks} tracked tasks done"
    }

    fun isResourceAttentionRequired(state: ResourceObservedState): Boolean = when (state) {
        ResourceObservedState.STALE, ResourceObservedState.EXITED, ResourceObservedState.CRASHED, ResourceObservedState.DETACHED -> true
        ResourceObservedState.ATTACHED, ResourceObservedState.UNKNOWN -> false
    }

    fun formatIsoNow(): String = kotlinx.datetime.Clock.System.now().toString()
}
