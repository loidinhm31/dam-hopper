package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/**
 * Phase-aware local outcome of a file mutation or save operation.
 * Distinguishes provably unsubmitted, definite rejection, confirmed success,
 * and ambiguous dispatch states without modifying server wire DTOs.
 */
sealed interface FileOperationOutcome<out T> {

    /**
     * Operation was provably not submitted to the wire (e.g. pre-dispatch validation failed,
     * authority retired, path traversal detected, or begin failed before any mutating commit attempt).
     */
    data class NotSubmitted(
        val reason: String,
        val cause: Throwable? = null,
    ) : FileOperationOutcome<Nothing>

    /**
     * Operation was authoritatively rejected by the server (e.g. CAS conflict, permission denied,
     * .git write prohibited, or path not found).
     */
    data class Rejected(
        val code: String,
        val message: String,
        val details: String? = null,
    ) : FileOperationOutcome<Nothing>

    /**
     * Operation completed and was confirmed authoritative by matching server ACK/result.
     */
    data class Confirmed<T>(
        val result: T,
    ) : FileOperationOutcome<T>

    /**
     * Mutating dispatch was attempted and may have reached the server, but completion could not
     * be authoritatively verified (e.g. network timeout, socket disconnect during commit, cancellation
     * after dispatch, or stream drop).
     *
     * Invariants:
     * - Preserves submitted buffers, baseline revision, and reservation.
     * - Must be recorded in durable/retained state BEFORE dispatching commit/fs:op.
     * - Cancellation during/after dispatch retains Unknown status and quarantined reservation.
     */
    data class Unknown(
        val stage: OperationStage,
        val opId: String? = null,
        val message: String,
        val cause: Throwable? = null,
    ) : FileOperationOutcome<Nothing>
}

/**
 * Execution stage of a mutating file operation.
 */
enum class OperationStage {
    VALIDATING,
    RESERVING,
    BEGIN_PENDING,
    CHUNK_STREAMING,
    COMMIT_DISPATCHED,
    FS_OP_DISPATCHED,
    AWAITING_RESULT,
}

/**
 * Retained record of an operation with ambiguous/unresolved outcome.
 * Held in quarantine until reconciled against server state or explicitly abandoned by user.
 */
data class QuarantinedOperation(
    val owner: WorkspaceFileOwner,
    val path: String,
    val stage: OperationStage,
    val opId: String? = null,
    val submittedRevision: Long? = null,
    val baselineRevision: Long? = null,
    val submittedBytes: ByteArray? = null,
    val timestampMillis: Long,
    val error: Throwable? = null,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is QuarantinedOperation) return false
        return owner == other.owner &&
            path == other.path &&
            stage == other.stage &&
            opId == other.opId &&
            submittedRevision == other.submittedRevision &&
            baselineRevision == other.baselineRevision &&
            timestampMillis == other.timestampMillis
    }

    override fun hashCode(): Int {
        var result = owner.hashCode()
        result = 31 * result + path.hashCode()
        result = 31 * result + stage.hashCode()
        result = 31 * result + (opId?.hashCode() ?: 0)
        result = 31 * result + (submittedRevision?.hashCode() ?: 0)
        result = 31 * result + (baselineRevision?.hashCode() ?: 0)
        result = 31 * result + timestampMillis.hashCode()
        return result
    }
}
