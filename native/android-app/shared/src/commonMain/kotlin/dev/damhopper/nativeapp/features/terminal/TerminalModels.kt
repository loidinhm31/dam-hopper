package dev.damhopper.nativeapp.features.terminal

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Server-authoritative PTY session metadata returned by GET /api/terminal.
 */
@Serializable
data class TerminalSessionMeta(
    val id: String,
    val incarnation: ULong = 0uL,
    val project: String? = null,
    val command: String,
    val cwd: String,
    @SerialName("worktreePath")
    val worktreePath: String? = null,
    val name: String? = null,
    @SerialName("type")
    val sessionType: String = "traditional",
    val alive: Boolean = true,
    @SerialName("exit_code")
    val exitCode: Int? = null,
    @SerialName("started_at")
    val startedAt: ULong = 0uL,
    @SerialName("restart_count")
    val restartCount: UInt = 0u,
    @SerialName("last_exit_at")
    val lastExitAt: ULong? = null,
    @SerialName("restart_policy")
    val restartPolicy: String = "never",
    @SerialName("targetUnavailable")
    val targetUnavailable: Boolean = false,
    @SerialName("incarnationExact")
    val incarnationExact: String? = null,
    @SerialName("terminationState")
    val terminationState: String? = null,
    val serverPtyEpoch: String? = null,
) {
    val displayName: String
        get() = name?.takeIf { it.isNotBlank() } ?: id
}

/**
 * Detailed session metadata including buffered byte count returned by GET /api/terminal/detailed.
 */
@Serializable
data class TerminalSessionDetailed(
    val id: String,
    val incarnation: ULong = 0uL,
    val project: String? = null,
    val command: String,
    val cwd: String,
    @SerialName("worktreePath")
    val worktreePath: String? = null,
    val name: String? = null,
    @SerialName("type")
    val sessionType: String = "traditional",
    val alive: Boolean = true,
    @SerialName("exit_code")
    val exitCode: Int? = null,
    @SerialName("started_at")
    val startedAt: ULong = 0uL,
    @SerialName("restart_count")
    val restartCount: UInt = 0u,
    @SerialName("last_exit_at")
    val lastExitAt: ULong? = null,
    @SerialName("restart_policy")
    val restartPolicy: String = "never",
    @SerialName("targetUnavailable")
    val targetUnavailable: Boolean = false,
    @SerialName("buffer_bytes")
    val bufferBytes: Long = 0L,
    @SerialName("incarnationExact")
    val incarnationExact: String? = null,
    @SerialName("terminationState")
    val terminationState: String? = null,
    val serverPtyEpoch: String? = null,
) {
    val displayName: String
        get() = name?.takeIf { it.isNotBlank() } ?: id

    fun toMeta(): TerminalSessionMeta = TerminalSessionMeta(
        id = id,
        incarnation = incarnation,
        project = project,
        command = command,
        cwd = cwd,
        worktreePath = worktreePath,
        name = name,
        sessionType = sessionType,
        alive = alive,
        exitCode = exitCode,
        startedAt = startedAt,
        restartCount = restartCount,
        lastExitAt = lastExitAt,
        restartPolicy = restartPolicy,
        targetUnavailable = targetUnavailable,
        incarnationExact = incarnationExact,
        terminationState = terminationState,
        serverPtyEpoch = serverPtyEpoch,
    )
}

/**
 * Request payload for POST /api/terminal.
 */
@Serializable
data class CreateSessionRequest(
    val id: String,
    val command: String,
    val cwd: String? = null,
    val env: Map<String, String> = emptyMap(),
    val cols: Int = 80,
    val rows: Int = 24,
    val project: String? = null,
    @SerialName("worktree_path")
    val worktreePath: String? = null,
    val name: String? = null,
)

/**
 * Request payload for PATCH /api/terminal/:id/rename.
 */
@Serializable
data class RenameSessionRequest(
    val name: String?,
)

/**
 * Response for GET /api/terminal/:id/buffer.
 */
@Serializable
data class TerminalBufferResponse(
    val buffer: String,
)

/**
 * Header names defined for terminal termination protocol.
 */
const val TERMINATION_HEADER_VERSION = "X-DamHopper-Termination-Version"
const val TERMINATION_HEADER_PTY_EPOCH = "X-DamHopper-PTY-Epoch"

/**
 * Request payload for POST /api/terminal/:id/terminate.
 * Must be <= 512 bytes on wire.
 */
@Serializable
data class TerminateSessionRequest(
    val version: Int = 1,
    val expectedServerEpoch: String, // lowercase UUID
    val expectedIncarnation: String, // positive decimal u64 string
) {
    companion object {
        private val UUID_REGEX = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        private val POSITIVE_U64_REGEX = Regex("^[1-9][0-9]*$")

        fun isValidEpoch(epoch: String?): Boolean =
            epoch != null && UUID_REGEX.matches(epoch)

        fun isValidIncarnation(incarnation: String?): Boolean =
            incarnation != null && POSITIVE_U64_REGEX.matches(incarnation) && incarnation.toULongOrNull() != null
    }

    init {
        require(version == 1) { "version must be 1" }
        require(isValidEpoch(expectedServerEpoch)) { "expectedServerEpoch must be a valid lowercase UUID: $expectedServerEpoch" }
        require(isValidIncarnation(expectedIncarnation)) { "expectedIncarnation must be a positive decimal u64 string: $expectedIncarnation" }
    }
}

/**
 * Outcome of a guarded termination request.
 */
@Serializable
data class TerminalTerminationOutcome(
    val id: String,
    val requested: Boolean, // 202 terminationRequested
    val restartCancelled: Boolean = false, // 200 restartCancelled
    val statusCode: Int,
    val message: String? = null,
)

/**
 * Final guarded outcome of terminal creation.
 */
@Serializable
data class TerminalCreateOutcome(
    val id: String,
    val incarnation: ULong,
    val ptyEpoch: String, // from X-DamHopper-PTY-Epoch header
    val alive: Boolean = true,
)

/**
 * Persistence status for uncertain terminal create intents across process death.
 */
@Serializable
enum class UncertainCreateStatus {
    @SerialName("pending")
    PENDING,
    @SerialName("confirmed")
    CONFIRMED,
    @SerialName("refused")
    REFUSED,
}

/**
 * Minimal nonsecret persistence record for uncertain terminal creation.
 * Never contains command, password, token, or terminal output.
 */
@Serializable
data class UncertainCreateRecord(
    val intentId: String, // UUID per explicit intent
    val profileId: String,
    val terminalId: String,
    val project: String? = null,
    val worktreePath: String? = null,
    val createdAtEpochMs: Long,
    val status: UncertainCreateStatus = UncertainCreateStatus.PENDING,
)

// ---------------------------------------------------------------------------
// Agent Status Enums & Models
// ---------------------------------------------------------------------------

@Serializable
enum class AgentKind {
    @SerialName("omp")
    OMP,
    @SerialName("codex")
    CODEX,
    @SerialName("claude")
    CLAUDE,
}

@Serializable
enum class AgentObservationSource {
    @SerialName("lifecycle")
    LIFECYCLE,
    @SerialName("hook")
    HOOK,
}

@Serializable
enum class AgentState {
    @SerialName("unknown")
    UNKNOWN,
    @SerialName("idle")
    IDLE,
    @SerialName("working")
    WORKING,
    @SerialName("blocked")
    BLOCKED,
}

@Serializable
enum class BlockedReason {
    @SerialName("approval")
    APPROVAL,
    @SerialName("question")
    QUESTION,
    @SerialName("error")
    ERROR,
}

@Serializable
enum class TurnOutcome {
    @SerialName("ended")
    ENDED,
    @SerialName("interrupted")
    INTERRUPTED,
    @SerialName("error")
    ERROR,
    @SerialName("unknown")
    UNKNOWN,
}

@Serializable
enum class AttentionKind {
    @SerialName("turn-ended")
    TURN_ENDED,
    @SerialName("needs-attention")
    NEEDS_ATTENTION,
}

@Serializable
enum class AgentStatusAvailability {
    @SerialName("ready")
    READY,
    @SerialName("unavailable")
    UNAVAILABLE,
    @SerialName("platform-unqualified")
    PLATFORM_UNQUALIFIED,
}

/**
 * Server-authoritative status row for a single agent session associated with a PTY.
 */
@Serializable
data class TerminalAgentStatusRow(
    val id: String,
    val incarnation: ULong,
    val agentKind: AgentKind,
    val agentSessionId: String,
    val reporterEpoch: ULong,
    val state: AgentState,
    val source: AgentObservationSource,
    val observedAtMs: ULong? = null,
    val expiresAtMs: ULong? = null,
    val reason: BlockedReason? = null,
    val turnId: String? = null,
    val attentionRevision: ULong = 0uL,
    val lastOutcome: TurnOutcome? = null,
)

/**
 * Attention event emitted by server when an agent needs user action or turn has concluded.
 */
@Serializable
data class AgentAttentionEvent(
    val id: String,
    val kind: AttentionKind,
    val terminalId: String,
    val incarnation: ULong,
    val agentKind: AgentKind,
    val agentSessionId: String,
    val turnId: String? = null,
    val reason: BlockedReason? = null,
    val outcome: TurnOutcome? = null,
    val attentionRevision: ULong = 0uL,
    val timestampMs: ULong = 0uL,
)

/**
 * Snapshot returned by GET /api/agent-status/v1/snapshot.
 */
@Serializable
data class AgentStatusSnapshotV1(
    val version: UInt = 1u,
    val serverEpoch: ULong,
    val revision: ULong,
    val availability: AgentStatusAvailability,
    val terminals: List<TerminalAgentStatusRow> = emptyList(),
)

/**
 * Extension status report for OMP.
 */
@Serializable
data class ExtensionStatusReport(
    val status: String,
    @SerialName("target_path")
    val targetPath: String,
    val version: String? = null,
    @SerialName("bundled_version")
    val bundledVersion: String,
    @SerialName("content_hash")
    val contentHash: String? = null,
    @SerialName("bundled_hash")
    val bundledHash: String,
    val details: String? = null,
)

/**
 * Native integration status report for Codex and Claude hooks.
 */
@Serializable
data class NativeIntegrationStatusReport(
    val agentKind: AgentKind,
    val status: String,
    val readiness: String,
    @SerialName("target_path")
    val targetPath: String,
    @SerialName("launcher_path")
    val launcherPath: String,
    @SerialName("manifest_path")
    val manifestPath: String,
    @SerialName("config_path")
    val configPath: String? = null,
    val version: String? = null,
    @SerialName("bundled_version")
    val bundledVersion: String,
    @SerialName("content_hash")
    val contentHash: String? = null,
    @SerialName("bundled_hash")
    val bundledHash: String,
    val details: String? = null,
)

/**
 * Verification result for OMP, Codex, and Claude paths.
 */
@Serializable
data class AgentPathsVerification(
    val effectiveHome: String,
    val ompInstallDir: String,
    val ompNotificationDir: String,
    val ompStatus: String,
    val ompCanEnable: Boolean,
    val ompReason: String? = null,
    val codexConfigDir: String,
    val codexNotificationDir: String,
    val codexConfigExists: Boolean,
    val codexCanEnable: Boolean,
    val codexReason: String? = null,
    val claudeConfigDir: String? = null,
    val claudeNotificationDir: String? = null,
    val claudeConfigExists: Boolean? = null,
    val claudeCanEnable: Boolean? = null,
    val claudeReason: String? = null,
)
