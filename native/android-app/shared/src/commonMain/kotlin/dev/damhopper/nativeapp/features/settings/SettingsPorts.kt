package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

// Shared boundary types for Settings ownership, operations and platform ports (C2). No Android imports.

/** The two independent Settings selections: preference source (A) and administrative target (B). */
enum class SettingsScope { PREFERENCE_SOURCE, SETTINGS_TARGET }

/**
 * Exact authority a Settings action was captured against. Numeric generation equality alone is never
 * sufficient: endpoint and account identity must match too.
 */
data class SettingsOwner(val connection: ConnectionRef, val endpoint: String, val accountId: String)

/** Immutable resolver result: the owner and the client created for exactly that owner. */
data class SettingsBinding(val owner: SettingsOwner, val client: ApiClient)

/**
 * Token captured when a Settings action starts. Source and target selection counters are independent
 * (A to B to A invalidates the first A); [editRevision] and [operationId] distinguish edits and busy tokens.
 *
 * Ordered operation-gate contract: every selection/edit/operation invalidation and busy-token commit uses
 * the SAME fair operation mutex, submitted in call order (retained-scope `launch(start = UNDISPATCHED)`;
 * state commits never suspend, persistence/debounce run outside). The request guard acquires that gate with
 * `tryLock` only while the registry lock is held (lock graph: profile -> registry -> operation tryLock; never
 * operation -> registry/profile); contention is a terminal NotSubmitted, never a wait or retry.
 */
data class SettingsOperation(
    val scope: SettingsScope,
    val owner: SettingsOwner,
    val selectionRevision: Long,
    val editRevision: Long,
    val operationId: Long,
)

interface SettingsOwnerResolver {
    /** Resolves a fresh binding outside any registry/operation lock; null when unavailable or in transition. */
    suspend fun current(profileId: String): SettingsBinding?

    /**
     * Non-suspending read of an immutable published StateFlow value. It never takes an application mutex,
     * calls back, resolves, or touches the profile repository, so it is safe inside the admission commit.
     */
    fun currentSnapshot(profileId: String): SettingsBinding?
}

/**
 * Honest outcome of a Settings action. [NotSubmitted]: nothing left the device (local admission denied,
 * stale owner, contention). [Rejected]: the server answered with a definitive refusal. [Unknown]: the request
 * may have been dispatched (post-admission cancellation, lost or malformed 2xx response, owner retirement)
 * and must be reported as ambiguous, never as a retryable failure or success.
 */
sealed interface SettingsOutcome<out T> {
    data class Confirmed<T>(val value: T) : SettingsOutcome<T>
    data class NotSubmitted(val reason: String) : SettingsOutcome<Nothing>
    data class Rejected(val reason: String) : SettingsOutcome<Nothing>
    data class Unknown(val reason: String) : SettingsOutcome<Nothing>
}

/**
 * System document picker boundary. No Activity or Android URI type crosses it. Results carry the exact
 * captured [SettingsOperation]; the retained owner handles each result once and discards stale callbacks.
 */
interface SettingsDocumentPort {
    fun openToml(operation: SettingsOperation)
    fun createDocument(operation: SettingsOperation, name: String, mime: String, bytes: ByteArray)
    val results: SharedFlow<SettingsDocumentResult>
}

enum class SettingsDocumentKind { OPEN_TOML, CREATE_TOML, CREATE_DIAGNOSTICS }

/**
 * Open success carries bounded bytes (ceiling [MAX_CONFIG_IMPORT_BYTES], strict UTF-8 validated by the
 * consumer); create success has `saved == true`. Cancellation or error never masquerades as saved.
 */
class SettingsDocumentResult(
    val operation: SettingsOperation,
    val kind: SettingsDocumentKind,
    val bytes: ByteArray?,
    val saved: Boolean,
    val cancelled: Boolean,
    val error: String?,
) {
    override fun equals(other: Any?): Boolean = other is SettingsDocumentResult &&
        operation == other.operation && kind == other.kind && bytes.contentEquals(other.bytes) &&
        saved == other.saved && cancelled == other.cancelled && error == other.error

    override fun hashCode(): Int {
        var result = operation.hashCode()
        result = 31 * result + kind.hashCode()
        result = 31 * result + (bytes?.contentHashCode() ?: 0)
        result = 31 * result + saved.hashCode()
        result = 31 * result + cancelled.hashCode()
        result = 31 * result + (error?.hashCode() ?: 0)
        return result
    }

    override fun toString(): String =
        "SettingsDocumentResult(operation=$operation, kind=$kind, bytes=${bytes?.size}, saved=$saved, cancelled=$cancelled, error=$error)"
}

/**
 * Opt-in terminal command history (consent is local-only, default off). Entries are scoped by owner and
 * project; `suggestions` is a synchronous in-memory read.
 */
interface CommandHistoryStore {
    val enabled: StateFlow<Boolean>
    fun setEnabled(enabled: Boolean)
    fun record(owner: SettingsOwner, project: String, command: String)
    fun suggestions(owner: SettingsOwner, project: String, prefix: String): List<String>
    fun clear()
}
