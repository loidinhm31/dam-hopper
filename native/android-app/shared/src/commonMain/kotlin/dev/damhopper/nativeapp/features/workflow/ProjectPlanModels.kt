package dev.damhopper.nativeapp.features.workflow

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================================================
// Constants
// ============================================================================

object PlanConstants {
    const val MAX_DOCUMENT_BYTES = 64 * 1024 // 64 KiB
    const val MAX_DECISIVE_BYTES_PER_REQUEST = 128 * 1024 // 128 KiB

    const val DIAG_INVALID_METADATA = "INVALID_METADATA"
    const val DIAG_INVALID_DOCUMENT = "INVALID_DOCUMENT"
    const val DIAG_FIELD_TOO_LARGE = "FIELD_TOO_LARGE"
    const val DIAG_PHASE_INVENTORY_INVALID = "PHASE_INVENTORY_INVALID"
    const val DIAG_STATUS_CONFLICT = "STATUS_CONFLICT"
    const val DIAG_UNSUPPORTED_STATUS = "UNSUPPORTED_STATUS"
    const val DIAG_DOCUMENT_TOO_LARGE = "DOCUMENT_TOO_LARGE"
    const val DIAG_DOCUMENT_CHANGED = "DOCUMENT_CHANGED"
    const val DIAG_LINK_REJECTED = "LINK_REJECTED"
    const val DIAG_INVALID_DATE = "INVALID_DATE"
    const val DIAG_DATE_CONFLICT = "DATE_CONFLICT"
    const val DIAG_SCAN_LIMIT = "SCAN_LIMIT"
    const val DIAG_DIAGNOSTICS_LIMIT = "DIAGNOSTICS_LIMIT"
}

// ============================================================================
// Enums
// ============================================================================

@Serializable
enum class PlanStatus {
    @SerialName("pending")
    PENDING,
    @SerialName("in-progress")
    IN_PROGRESS,
    @SerialName("completed")
    COMPLETED,
    @SerialName("cancelled")
    CANCELLED,
    @SerialName("blocked")
    BLOCKED,
    @SerialName("unknown")
    UNKNOWN,
    @SerialName("conflict")
    CONFLICT;

    val wireName: String
        get() = when (this) {
            PENDING -> "pending"
            IN_PROGRESS -> "in-progress"
            COMPLETED -> "completed"
            CANCELLED -> "cancelled"
            BLOCKED -> "blocked"
            UNKNOWN -> "unknown"
            CONFLICT -> "conflict"
        }
}

@Serializable
enum class PlanAuthority {
    @SerialName("plan")
    PLAN;

    val wireName: String get() = "plan"
}

@Serializable
enum class PlanDocumentState {
    @SerialName("absent")
    ABSENT,
    @SerialName("readable")
    READABLE,
    @SerialName("unreadable")
    UNREADABLE,
    @SerialName("oversize")
    OVERSIZE,
    @SerialName("invalid")
    INVALID,
    @SerialName("changed")
    CHANGED;

    val wireName: String
        get() = when (this) {
            ABSENT -> "absent"
            READABLE -> "readable"
            UNREADABLE -> "unreadable"
            OVERSIZE -> "oversize"
            INVALID -> "invalid"
            CHANGED -> "changed"
        }
}

@Serializable
enum class DatePrecision {
    @SerialName("day")
    DAY,
    @SerialName("instant")
    INSTANT;

    val wireName: String
        get() = when (this) {
            DAY -> "day"
            INSTANT -> "instant"
        }
}

@Serializable
enum class PlanFolderKind {
    @SerialName("collection")
    COLLECTION,
    @SerialName("group")
    GROUP,
    @SerialName("plan")
    PLAN;

    val wireName: String
        get() = when (this) {
            COLLECTION -> "collection"
            GROUP -> "group"
            PLAN -> "plan"
        }
}

@Serializable
enum class PlanFolderState {
    @SerialName("present")
    PRESENT,
    @SerialName("missing")
    MISSING;

    val wireName: String
        get() = when (this) {
            PRESENT -> "present"
            MISSING -> "missing"
        }
}

// ============================================================================
// DTOs
// ============================================================================

@Serializable
data class SourceRef(
    val path: String,
    val lineStart: Int,
    val lineEnd: Int
)

@Serializable
data class Diagnostic(
    val code: String,
    val path: String? = null,
    val line: Int? = null,
    val message: String
)

@Serializable
data class StatusEvidence(
    val value: PlanStatus,
    val raw: String,
    val evidence: SourceRef
)

@Serializable
data class ReportedStatus(
    val value: PlanStatus,
    val authority: PlanAuthority = PlanAuthority.PLAN,
    val raw: String? = null,
    val evidence: List<SourceRef> = emptyList(),
    val captured: List<StatusEvidence> = emptyList()
)

@Serializable
data class PlanDocument(
    val path: String,
    val state: PlanDocumentState,
    val sizeBytes: Long? = null,
    val modifiedAt: String? = null
)

@Serializable
data class DateEvidence(
    val value: String,
    val precision: DatePrecision,
    val evidence: SourceRef
)

@Serializable
data class FilePlanPhase(
    val id: String,
    val number: Long? = null,
    val title: String? = null,
    val path: String? = null,
    val reportedStatus: ReportedStatus,
    val evidenceLinks: List<String> = emptyList()
)

@Serializable
data class FilePlanMetadata(
    val priority: String? = null,
    val effort: String? = null,
    val issue: String? = null,
    val branch: String? = null,
    val tags: List<String> = emptyList()
)

@Serializable
data class PlanDocuments(
    val plan: PlanDocument
)

@Serializable
data class PlanCompletion(
    val declared: Long? = null,
    val completed: Long = 0,
    val unknown: Long = 0,
    val conflicted: Long = 0,
    val fraction: Double? = null
)

@Serializable
data class PlanDates(
    val created: DateEvidence? = null,
    val plannedStart: DateEvidence? = null,
    val plannedEnd: DateEvidence? = null,
    val actualStart: DateEvidence? = null,
    val actualEnd: DateEvidence? = null,
    val published: DateEvidence? = null
)

@Serializable
data class FilePlan(
    val id: String,
    val title: String? = null,
    val description: String? = null,
    val metadata: FilePlanMetadata = FilePlanMetadata(),
    val documents: PlanDocuments,
    val reportedStatus: ReportedStatus,
    val phases: List<FilePlanPhase> = emptyList(),
    val completion: PlanCompletion = PlanCompletion(),
    val dates: PlanDates = PlanDates(),
    val lastDocumentUpdate: String? = null,
    val diagnostics: List<Diagnostic> = emptyList()
)

@Serializable
data class PlanTarget(
    val project: String,
    val worktreePath: String? = null,
    val targetKey: String
)

@Serializable
data class FolderEntry(
    val path: String,
    val name: String
)

@Serializable
data class FolderListing(
    val complete: Boolean,
    val entriesVisited: Int,
    val limitsReached: List<String> = emptyList()
)

@Serializable
data class PlanFoldersResponse(
    val target: PlanTarget,
    val path: String,
    val kind: PlanFolderKind,
    val folderState: PlanFolderState,
    val folders: List<FolderEntry> = emptyList(),
    val listing: FolderListing,
    val watchPaths: List<String> = emptyList(),
    val diagnostics: List<Diagnostic> = emptyList()
)

@Serializable
data class SelectedPlanResponse(
    val target: PlanTarget,
    val plan: FilePlan,
    val watchPaths: List<String> = emptyList(),
    val diagnostics: List<Diagnostic> = emptyList()
)
