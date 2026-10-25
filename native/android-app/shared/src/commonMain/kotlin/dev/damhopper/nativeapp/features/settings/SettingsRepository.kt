package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.core.transport.RequestAdmissionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import dev.damhopper.nativeapp.core.transport.ApiRequestError

/** Which action holds a busy token. Tokens are keyed by operationId; see [SettingsRepository.busy]. */
enum class SettingsBusyKind(val scope: SettingsScope) {
    EXPORT(SettingsScope.SETTINGS_TARGET),
    IMPORT(SettingsScope.SETTINGS_TARGET),
    CLEAR_CACHE(SettingsScope.SETTINGS_TARGET),
    RESET(SettingsScope.SETTINGS_TARGET),
    AGENT_PATHS(SettingsScope.PREFERENCE_SOURCE),
}

/** Truthful state of the preference source A synchronization; local preferences always stay usable. */
enum class PreferenceSyncStatus {
    LOCAL_ONLY, HYDRATING, SYNCED, OFFLINE, HYDRATE_FAILED,
    SAVE_PENDING, SAVE_NOT_SUBMITTED, SAVE_REJECTED, SAVE_UNKNOWN,
}

data class PreferenceSyncState(val status: PreferenceSyncStatus = PreferenceSyncStatus.LOCAL_ONLY, val message: String? = null)

enum class SettingsOutcomeKind { CONFIRMED, NOT_SUBMITTED, REJECTED, UNKNOWN }

/** Last administrative outcome per owner; an Unknown stays visible when the user returns to that owner. */
data class SettingsAdminStatus(
    val kind: SettingsBusyKind,
    val outcome: SettingsOutcomeKind,
    val message: String,
    val operationId: Long,
)

/** Wire keys of `ui.agentSettingsPaths` and the web defaults used by a reset. */
enum class AgentPathKey(val wire: String, val defaultPath: String) {
    OMP("ompAgentDir", "~/.omp/agent"),
    CODEX("codexDir", "~/.codex"),
    CLAUDE("claudeDir", "~/.claude"),
}

/**
 * What Settings-owned editors need from the repository for one exact target [SettingsOwner]: a read-publication
 * fence, a fresh single-use request guard, and the awaited runtime revocation (C3a handoff).
 */
interface SettingsTargetAuthority {
    /** True only while [owner] is still the selected Settings target and the current owner. */
    suspend fun isCurrent(owner: SettingsOwner): Boolean

    /** Fresh single-use guard bound to exactly [owner], or null when it is no longer the selected target. */
    suspend fun guardFor(owner: SettingsOwner): RequestAdmissionGuard?

    /** Awaited before every local path/config edit and install/uninstall; failure/cancellation aborts it. */
    suspend fun revokeRuntime(connection: ConnectionRef)
}

val SettingsOutcome<*>.kind: SettingsOutcomeKind
    get() = when (this) {
        is SettingsOutcome.Confirmed -> SettingsOutcomeKind.CONFIRMED
        is SettingsOutcome.NotSubmitted -> SettingsOutcomeKind.NOT_SUBMITTED
        is SettingsOutcome.Rejected -> SettingsOutcomeKind.REJECTED
        is SettingsOutcome.Unknown -> SettingsOutcomeKind.UNKNOWN
    }

val SettingsOutcome<*>.reasonOrNull: String?
    get() = when (this) {
        is SettingsOutcome.Confirmed -> null
        is SettingsOutcome.NotSubmitted -> reason
        is SettingsOutcome.Rejected -> reason
        is SettingsOutcome.Unknown -> reason
    }

private const val UNKNOWN_SUFFIX =
    " The request may have reached the server; refresh status and confirm explicitly before trying again (nothing is retried automatically)."

/**
 * Classifies a failed guarded request by its OWN guard receipt. Not admitted: nothing left the device
 * (NotSubmitted). Admitted: a definitive 4xx server answer is Rejected; anything else (cancellation,
 * owner retirement, malformed/lost 2xx, 5xx, network failure) may have been dispatched, so Unknown.
 */
fun classifyFailure(guard: RequestAdmissionGuard?, error: Throwable): SettingsOutcome<Nothing> {
    val message = error.message?.takeIf { it.isNotBlank() } ?: (error::class.simpleName ?: "Request failed")
    if (guard == null || guard.admission.value != RequestAdmissionState.ADMITTED) {
        return SettingsOutcome.NotSubmitted(message)
    }
    if (error is ApiRequestError && error.status in 400..499) {
        return SettingsOutcome.Rejected(message)
    }
    return SettingsOutcome.Unknown(message + UNKNOWN_SUFFIX)
}

fun classifyCancellation(guard: RequestAdmissionGuard?): SettingsOutcome<Nothing> =
    if (guard != null && guard.admission.value == RequestAdmissionState.ADMITTED) {
        SettingsOutcome.Unknown("Cancelled after the request was admitted." + UNKNOWN_SUFFIX)
    } else {
        SettingsOutcome.NotSubmitted("Cancelled before the request was submitted.")
    }

/**
 * Runs [block] and maps its result to a [SettingsOutcome] using [guard]'s own receipt. A
 * CancellationException is recorded through [onCancelled] (owner-qualified bookkeeping / token cleanup) and
 * then propagated; it is never swallowed into a result.
 */
suspend fun <T> guardedOutcome(
    guard: RequestAdmissionGuard?,
    onCancelled: (SettingsOutcome<Nothing>) -> Unit = {},
    block: suspend () -> T,
): SettingsOutcome<T> = try {
    SettingsOutcome.Confirmed(block())
} catch (ce: CancellationException) {
    onCancelled(classifyCancellation(guard))
    throw ce
} catch (t: Exception) {
    classifyFailure(guard, t)
}

/** [guardedOutcome] for a server `ok/updated` flag: `false` after admission is Unknown, not a retryable failure. */
suspend fun guardedConfirmation(
    guard: RequestAdmissionGuard?,
    onCancelled: (SettingsOutcome<Nothing>) -> Unit = {},
    block: suspend () -> Boolean,
): SettingsOutcome<Unit> = when (val result = guardedOutcome(guard, onCancelled, block)) {
    is SettingsOutcome.Confirmed ->
        if (result.value) {
            SettingsOutcome.Confirmed(Unit)
        } else if (guard != null && guard.admission.value == RequestAdmissionState.ADMITTED) {
            SettingsOutcome.Unknown("The server did not confirm the change." + UNKNOWN_SUFFIX)
        } else {
            SettingsOutcome.NotSubmitted("Request was not submitted.")
        }
    is SettingsOutcome.NotSubmitted -> result
    is SettingsOutcome.Rejected -> result
    is SettingsOutcome.Unknown -> result
}

/**
 * Coordinates local native preferences, preference source (A) synchronization, the independent Settings
 * target (B) and the administrative operations (TOML export/import, cache, reset, agent paths).
 *
 * Ownership (C2/C2a): resolve/credentials/preparation happen outside every lock; every P/T mutation goes
 * through a request-local [requestGuard] whose commit runs under the registry mutex with the operation mutex
 * taken by `tryLock` only. All selection/edit/operation invalidations and busy-token commits use the SAME
 * fair [operationMutex], submitted in call order via `launch(start = UNDISPATCHED)`; commits never suspend and
 * persistence/debounce run outside the lock. Contention at the guard is a terminal NotSubmitted, never a retry.
 */
class SettingsRepository(
    private val preferencesStore: PreferencesStore,
    private val ownerResolver: SettingsOwnerResolver,
    private val coroutineScope: CoroutineScope,
    private val debounceMillis: Long = 500L,
    private val invalidateRuntime: suspend (ConnectionRef) -> Unit,
) {
    private val _preferences = MutableStateFlow(preferencesStore.loadPreferences().clamped())
    val preferences: StateFlow<WorkbenchPreferences> = _preferences.asStateFlow()

    private val _sourceTargetState = MutableStateFlow(preferencesStore.loadSourceTargetState())
    val sourceTargetState: StateFlow<SettingsSourceTargetState> = _sourceTargetState.asStateFlow()

    private val _importExportState = MutableStateFlow(SettingsImportExportState())
    val importExportState: StateFlow<SettingsImportExportState> = _importExportState.asStateFlow()

    private val _syncState = MutableStateFlow(PreferenceSyncState())
    val syncState: StateFlow<PreferenceSyncState> = _syncState.asStateFlow()

    private val _unsupportedPolicy = MutableStateFlow<JsonObject?>(null)

    /** Exact raw remote policy object when its version/shape is unsupported (editor read-only, delivery off). */
    val unsupportedPolicy: StateFlow<JsonObject?> = _unsupportedPolicy.asStateFlow()

    private val _languageFilterMigrationNotice = MutableStateFlow<String?>(null)
    val languageFilterMigrationNotice: StateFlow<String?> = _languageFilterMigrationNotice.asStateFlow()

    private val _agentSettingsPaths = MutableStateFlow<JsonObject?>(null)

    /** Raw `ui.agentSettingsPaths` of the preference source (other agent entries preserved). */
    val agentSettingsPaths: StateFlow<JsonObject?> = _agentSettingsPaths.asStateFlow()

    private val _agentPathsRevision = MutableStateFlow(0L)

    /** Advances before and after every path edit/source hydration; stale readiness must never survive it. */
    val agentPathsRevision: StateFlow<Long> = _agentPathsRevision.asStateFlow()

    private val _busy = MutableStateFlow<Map<SettingsBusyKind, Long>>(emptyMap())

    /** kind -> operationId of the holder; a stale holder's cleanup never clears a newer token. */
    val busy: StateFlow<Map<SettingsBusyKind, Long>> = _busy.asStateFlow()

    private val _ownerStatus = MutableStateFlow<Map<SettingsOwner, SettingsAdminStatus>>(emptyMap())
    val ownerStatus: StateFlow<Map<SettingsOwner, SettingsAdminStatus>> = _ownerStatus.asStateFlow()

    /** Non-null when stored bytes could not be decoded; they were left untouched (not reset). */
    val storageError: String? = preferencesStore.loadRecoverableError()

    // ---- gate-protected state (mutated only under operationMutex) ----
    private val operationMutex = Mutex()
    private val persistMutex = Mutex()
    private val saveMutex = Mutex()
    private var sourceRevision = 0L
    private var targetRevision = 0L
    val targetSelectionRevision: Long get() = targetRevision
    private var editRevision = 0L
    private var targetEditRevision = 0L
    private var operationCounter = 0L
    private var syncedBase: WorkbenchPreferences? = null
    private var languageExplicit = false
    private var policyDirty = false
    private var debounceJob: Job? = null
    private val busyScopes = HashMap<SettingsBusyKind, Long>()

    init {
        val state = _sourceTargetState.value
        if (state.preferencesStatus == PreferenceSourceStatus.ACTIVE && state.preferencesProfileId != null) {
            syncedBase = state.lastSnapshot
            if (state.lastSnapshotSourceProfileId == state.preferencesProfileId) {
                (decodeRemoteAgentPolicy(state.lastSnapshotPolicy) as? RemoteAgentPolicy.Unsupported)?.let {
                    _unsupportedPolicy.value = it.raw
                }
            }
        }
        refreshMigrationNotice()
    }

    // ------------------------------------------------------------------------------------------
    // Ordered submissions (state commits never suspend; persistence runs outside the lock)
    // ------------------------------------------------------------------------------------------

    private fun submit(commit: () -> Unit) {
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            operationMutex.withLock { commit() }
            persistLatest()
        }
    }

    private suspend fun persistLatest() {
        persistMutex.withLock {
            preferencesStore.savePreferences(_preferences.value)
            preferencesStore.saveSourceTargetState(_sourceTargetState.value)
        }
    }

    /** Updates local preferences immediately and schedules a debounced dirty-field save to source A. */
    fun updatePreferences(transform: (WorkbenchPreferences) -> WorkbenchPreferences) {
        submit { commitPreferenceEdit(transform, explicitLanguage = false, policyEdit = false) }
    }

    /** Explicit user language selection: always writes the real wire value, even when it equals the fallback. */
    fun setExplorerLanguageFilter(filter: ExplorerLanguageFilter) {
        submit {
            commitPreferenceEdit({ it.copy(explorerLanguageFilter = filter) }, explicitLanguage = true, policyEdit = false)
        }
    }

    /** Explicit supported-policy edit. Ignored while the remote policy is unsupported (read-only, preserved). */
    fun updatePolicy(transform: (TerminalAgentNotifications) -> TerminalAgentNotifications) {
        submit {
            if (_unsupportedPolicy.value == null) {
                commitPreferenceEdit(
                    { it.copy(terminalAgentNotifications = transform(it.terminalAgentNotifications)) },
                    explicitLanguage = false,
                    policyEdit = true,
                )
            }
        }
    }

    private fun commitPreferenceEdit(
        transform: (WorkbenchPreferences) -> WorkbenchPreferences,
        explicitLanguage: Boolean,
        policyEdit: Boolean,
    ) {
        val old = _preferences.value
        var updated = transform(old).clamped()
        if (!policyEdit || _unsupportedPolicy.value != null) {
            // Only an explicit supported-policy edit may change the policy.
            updated = updated.copy(terminalAgentNotifications = old.terminalAgentNotifications)
        }
        val languageChosen = explicitLanguage || updated.explorerLanguageFilter != old.explorerLanguageFilter
        if (updated == old && !languageChosen) return
        if (syncedBase == null) syncedBase = old
        editRevision++
        _preferences.value = updated
        if (languageChosen) {
            languageExplicit = true
            _sourceTargetState.update { it.copy(lastSnapshotLegacyLanguageFilter = null) }
            preferencesStore.clearLegacyExplorerLanguageFilter()
            _languageFilterMigrationNotice.value = null
        }
        if (policyEdit && updated.terminalAgentNotifications != old.terminalAgentNotifications) policyDirty = true
        val sharedChanged = languageChosen || updated.sharedProjection() != old.sharedProjection()
        if (sharedChanged) scheduleSaveLocked()
    }

    private fun scheduleSaveLocked() {
        val state = _sourceTargetState.value
        if (state.preferencesStatus != PreferenceSourceStatus.ACTIVE || state.preferencesProfileId == null) return
        debounceJob?.cancel()
        _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SAVE_PENDING)
        debounceJob = coroutineScope.launch {
            delay(debounceMillis)
            // The request itself runs outside this (cancellable) debounce job so a newer edit cancels only the wait.
            coroutineScope.launch { saveMutex.withLock { saveToSource() } }
        }
    }

    private class SaveSnapshot(
        val preferences: WorkbenchPreferences,
        val base: WorkbenchPreferences?,
        val languageWrite: LanguageFilterWrite,
        val includePolicy: Boolean,
    )

    private class Captured(val operation: SettingsOperation, val binding: SettingsBinding, val snapshot: SaveSnapshot)

    private fun snapshotLocked(): SaveSnapshot {
        val legacyActive = _languageFilterMigrationNotice.value != null
        return SaveSnapshot(
            preferences = _preferences.value,
            base = syncedBase,
            languageWrite = when {
                languageExplicit -> LanguageFilterWrite.ALWAYS
                legacyActive -> LanguageFilterWrite.OMIT
                else -> LanguageFilterWrite.IF_CHANGED
            },
            includePolicy = policyDirty && _unsupportedPolicy.value == null,
        )
    }

    private suspend fun saveToSource() {
        val captured = captureBinding(SettingsScope.PREFERENCE_SOURCE)
        if (captured == null) {
            operationMutex.withLock {
                val state = _sourceTargetState.value
                if (state.preferencesStatus == PreferenceSourceStatus.ACTIVE) {
                    _syncState.value = PreferenceSyncState(
                        PreferenceSyncStatus.OFFLINE,
                        "Preference source is not connected; changes are kept locally and are not retried automatically.",
                    )
                }
            }
            return
        }
        val op = captured.operation
        val snapshot = captured.snapshot
        val base = snapshot.base ?: return
        val patch = snapshot.preferences.dirtyUiPatch(base, snapshot.languageWrite, snapshot.includePolicy)
        if (patch.isEmpty()) {
            operationMutex.withLock {
                if (sourceRevision == op.selectionRevision && editRevision == op.editRevision) {
                    _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SYNCED)
                }
            }
            return
        }
        val guard = requestGuard(op)
        val outcome = guardedConfirmation(guard, onCancelled = { recordPreferenceSave(it) }) {
            RemoteConfigRepository(captured.binding.client).updateGlobalUi(patch, guard)
        }
        publishSave(op, patch, snapshot.preferences, outcome)
    }

    private fun recordPreferenceSave(outcome: SettingsOutcome<*>) {
        if (outcome is SettingsOutcome.Unknown) {
            _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SAVE_UNKNOWN, outcome.reason)
        }
    }

    private suspend fun publishSave(
        op: SettingsOperation,
        patch: UiPreferences,
        payload: WorkbenchPreferences,
        outcome: SettingsOutcome<Unit>,
    ) {
        operationMutex.withLock {
            val stillSource = sourceRevision == op.selectionRevision
            val upToDate = stillSource && editRevision == op.editRevision
            when (outcome) {
                is SettingsOutcome.Confirmed -> if (stillSource) {
                    val base = syncedBase ?: payload
                    val merged = patch.applyTo(base).copy(
                        terminalAgentNotifications = if (patch.terminalAgentNotifications != null) {
                            payload.terminalAgentNotifications
                        } else {
                            base.terminalAgentNotifications
                        },
                    )
                    syncedBase = merged
                    if (patch.explorerLanguageFilter != null) languageExplicit = false
                    if (patch.terminalAgentNotifications != null &&
                        _preferences.value.terminalAgentNotifications == payload.terminalAgentNotifications
                    ) {
                        policyDirty = false
                    }
                    _sourceTargetState.update {
                        it.copy(
                            lastSnapshot = merged.sharedProjection(),
                            lastSnapshotSourceProfileId = op.owner.connection.profileId,
                            lastSnapshotPolicy = if (patch.terminalAgentNotifications != null) {
                                payload.terminalAgentNotifications.toWireJson()
                            } else {
                                it.lastSnapshotPolicy
                            },
                        )
                    }
                    _syncState.value = if (upToDate) {
                        PreferenceSyncState(PreferenceSyncStatus.SYNCED)
                    } else {
                        PreferenceSyncState(PreferenceSyncStatus.SAVE_PENDING)
                    }
                }
                is SettingsOutcome.NotSubmitted -> if (upToDate) {
                    _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SAVE_NOT_SUBMITTED, outcome.reason)
                }
                is SettingsOutcome.Rejected -> if (stillSource) {
                    _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SAVE_REJECTED, outcome.reason)
                }
                is SettingsOutcome.Unknown -> if (stillSource) {
                    _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SAVE_UNKNOWN, outcome.reason)
                }
            }
        }
        persistLatest()
    }

    // ------------------------------------------------------------------------------------------
    // Selection (A and B are independent; A -> B -> A invalidates the first A)
    // ------------------------------------------------------------------------------------------

    /**
     * Switches preference source server. The invalidation is queued on the operation gate before any remote
     * suspension; pending saves are cancelled. Hydrates synchronized fields from the new source when it is
     * connected; a failure keeps the usable local snapshot with a truthful [syncState] (never another server's).
     */
    suspend fun switchPreferenceSource(profileId: String?): Boolean {
        var selection = 0L
        var editAtStart = 0L
        operationMutex.withLock {
            sourceRevision++
            selection = sourceRevision
            editAtStart = editRevision
            debounceJob?.cancel()
            debounceJob = null
            syncedBase = null
            languageExplicit = false
            policyDirty = false
            _unsupportedPolicy.value = null
            _agentSettingsPaths.value = null
            clearBusyLocked(SettingsScope.PREFERENCE_SOURCE)
            _sourceTargetState.update {
                it.copy(
                    preferencesProfileId = profileId,
                    preferencesStatus = if (profileId == null) PreferenceSourceStatus.UNSET else PreferenceSourceStatus.ACTIVE,
                )
            }
            _syncState.value = if (profileId == null) {
                PreferenceSyncState()
            } else {
                PreferenceSyncState(PreferenceSyncStatus.HYDRATING)
            }
        }
        _agentPathsRevision.update { it + 1 }
        persistLatest()
        if (profileId == null) return true
        return hydrate(profileId, selection, editAtStart)
    }

    /** User-initiated re-sync of the currently selected source (e.g. after it reconnects). */
    suspend fun retrySourceHydration(): Boolean {
        var profileId: String? = null
        var selection = 0L
        var editAtStart = 0L
        operationMutex.withLock {
            profileId = selectedProfile(SettingsScope.PREFERENCE_SOURCE)
            selection = sourceRevision
            editAtStart = editRevision
            if (profileId != null) _syncState.value = PreferenceSyncState(PreferenceSyncStatus.HYDRATING)
        }
        return profileId?.let { hydrate(it, selection, editAtStart) } ?: false
    }

    private suspend fun hydrate(profileId: String, selection: Long, editAtStart: Long): Boolean {
        val binding = resolve(profileId)
        if (binding == null) {
            operationMutex.withLock {
                if (sourceRevision == selection) {
                    _syncState.value = PreferenceSyncState(
                        PreferenceSyncStatus.OFFLINE,
                        "Preference source is not connected; using the local snapshot.",
                    )
                }
            }
            return false
        }
        val ui = try {
            RemoteConfigRepository(binding.client).getUiPreferences()
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Exception) {
            operationMutex.withLock {
                if (sourceRevision == selection) {
                    _syncState.value = PreferenceSyncState(
                        PreferenceSyncStatus.HYDRATE_FAILED,
                        "Could not read preferences from the source server (${t.message}); using the local snapshot.",
                    )
                }
            }
            return false
        }
        val published = operationMutex.withLock {
            if (sourceRevision != selection ||
                ownerResolver.currentSnapshot(profileId)?.owner != binding.owner
            ) {
                return@withLock false
            }
            if (editRevision != editAtStart) {
                _syncState.value = PreferenceSyncState(
                    PreferenceSyncStatus.HYDRATE_FAILED,
                    "Local edits were made while syncing; remote values were not applied.",
                )
                return@withLock false
            }
            val remoteLanguage = ui.explorerLanguageFilter
            val unknownLanguage = remoteLanguage != null && ExplorerLanguageFilter.fromWireOrNull(remoteLanguage) == null
            val applied = ui.applyTo(_preferences.value).clamped()
            _preferences.value = applied
            syncedBase = applied
            languageExplicit = false
            policyDirty = false
            _unsupportedPolicy.value =
                (decodeRemoteAgentPolicy(ui.terminalAgentNotifications) as? RemoteAgentPolicy.Unsupported)?.raw
            _agentSettingsPaths.value = ui.agentSettingsPaths
            _sourceTargetState.update {
                it.copy(
                    lastSnapshot = applied.sharedProjection(),
                    lastSnapshotPolicy = ui.terminalAgentNotifications,
                    lastSnapshotSourceProfileId = profileId,
                    lastSnapshotLegacyLanguageFilter = if (unknownLanguage) remoteLanguage else null,
                )
            }
            if (remoteLanguage != null && !unknownLanguage) preferencesStore.clearLegacyExplorerLanguageFilter()
            refreshMigrationNotice()
            _syncState.value = PreferenceSyncState(PreferenceSyncStatus.SYNCED)
            true
        }
        if (published) {
            _agentPathsRevision.update { it + 1 }
            persistLatest()
        }
        return published
    }

    /** Sets target server B (independent of A). Invalidates pending target operations immediately. */
    fun setSettingsTarget(profileId: String?) {
        submit {
            targetRevision++
            clearBusyLocked(SettingsScope.SETTINGS_TARGET)
            _importExportState.value = SettingsImportExportState()
            _sourceTargetState.update { it.copy(settingsProfileId = profileId) }
        }
    }

    /** Handles profile deletion: keeps the safe local snapshot, clears source/target selection. */
    fun onProfileRemoved(profileId: String) {
        submit {
            val state = _sourceTargetState.value
            if (state.preferencesProfileId == profileId) {
                sourceRevision++
                debounceJob?.cancel()
                debounceJob = null
                syncedBase = null
                languageExplicit = false
                policyDirty = false
                _unsupportedPolicy.value = null
                _agentSettingsPaths.value = null
                clearBusyLocked(SettingsScope.PREFERENCE_SOURCE)
                _sourceTargetState.update {
                    it.copy(preferencesProfileId = null, preferencesStatus = PreferenceSourceStatus.SOURCE_REMOVED)
                }
                _syncState.value = PreferenceSyncState()
            }
            if (state.settingsProfileId == profileId) {
                targetRevision++
                clearBusyLocked(SettingsScope.SETTINGS_TARGET)
                _importExportState.value = SettingsImportExportState()
                _sourceTargetState.update { it.copy(settingsProfileId = null) }
            }
        }
    }

    private fun refreshMigrationNotice() {
        val legacy = preferencesStore.loadLegacyExplorerLanguageFilter()
            ?: _sourceTargetState.value.lastSnapshotLegacyLanguageFilter
        _languageFilterMigrationNotice.value = legacy?.let {
            "The saved Explorer language filter '$it' has no equivalent among the server filters " +
                "(all, rust, javascript-typescript, java). All is shown locally; nothing was written to any " +
                "server. Choose a filter to replace it."
        }
    }

    // ------------------------------------------------------------------------------------------
    // Operations: capture, currency and request-local guards
    // ------------------------------------------------------------------------------------------

    private fun selectedProfile(scope: SettingsScope): String? {
        val state = _sourceTargetState.value
        return when (scope) {
            SettingsScope.PREFERENCE_SOURCE ->
                state.preferencesProfileId?.takeIf { state.preferencesStatus == PreferenceSourceStatus.ACTIVE }
            SettingsScope.SETTINGS_TARGET -> state.settingsProfileId
        }
    }

    private fun revisionOf(scope: SettingsScope): Long =
        if (scope == SettingsScope.PREFERENCE_SOURCE) sourceRevision else targetRevision

    private fun editRevisionOf(scope: SettingsScope): Long =
        if (scope == SettingsScope.PREFERENCE_SOURCE) editRevision else targetEditRevision

    /** Non-suspending currency predicate; callers hold [operationMutex]. */
    private fun isCurrentLocked(op: SettingsOperation): Boolean {
        val profileId = op.owner.connection.profileId
        return selectedProfile(op.scope) == profileId &&
            revisionOf(op.scope) == op.selectionRevision &&
            editRevisionOf(op.scope) == op.editRevision &&
            op.operationId in 1..operationCounter &&
            ownerResolver.currentSnapshot(profileId)?.owner == op.owner
    }

    private suspend fun resolve(profileId: String): SettingsBinding? = try {
        ownerResolver.current(profileId)
    } catch (ce: CancellationException) {
        throw ce
    } catch (_: Exception) {
        null
    }

    private suspend fun captureBinding(scope: SettingsScope): Captured? {
        var selection = 0L
        val profileId = operationMutex.withLock {
            selection = revisionOf(scope)
            selectedProfile(scope)
        } ?: return null
        val binding = resolve(profileId) ?: return null // outside every lock
        return operationMutex.withLock {
            if (selectedProfile(scope) != profileId || revisionOf(scope) != selection) return@withLock null
            if (ownerResolver.currentSnapshot(profileId)?.owner != binding.owner) return@withLock null
            val operation = SettingsOperation(scope, binding.owner, selection, editRevisionOf(scope), ++operationCounter)
            Captured(operation, binding, snapshotLocked())
        }
    }

    /** Captures the selected [scope]'s exact owner, or null when unselected, disconnected or retiring. */
    suspend fun captureOperation(scope: SettingsScope): SettingsOperation? = captureBinding(scope)?.operation

    /** True while [operation] is still the exact selected owner/revision (not admission; see [requestGuard]). */
    suspend fun isCurrent(operation: SettingsOperation): Boolean = operationMutex.withLock { isCurrentLocked(operation) }

    /**
     * Fresh single-use guard for one request of [operation]. Admission happens at the transport after
     * credentials/preparation: registry mutex, then operation mutex by `tryLock` only; contention or any
     * mismatch is a terminal rejection, never a wait or retry. Reuse/concurrent use never alters the receipt.
     */
    fun requestGuard(operation: SettingsOperation): RequestAdmissionGuard = OperationGuard(operation)

    private inner class OperationGuard(private val operation: SettingsOperation) : RequestAdmissionGuard {
        private val state = MutableStateFlow(RequestAdmissionState.PENDING)
        private val claimed = MutableStateFlow(false)
        override val admission: StateFlow<RequestAdmissionState> = state.asStateFlow()

        override suspend fun admit(registry: ConnectionRegistry?, connection: ConnectionRef): Boolean {
            if (!claimed.compareAndSet(false, true)) return false // reused/concurrent: prior receipt untouched
            var admitted = false
            try {
                if (registry != null) {
                    admitted = registry.admitCurrentOwner(connection) { commit(connection) }
                }
            } finally {
                if (!admitted) state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.REJECTED)
            }
            return admitted
        }

        /** Runs under the registry mutex; non-suspending; operation gate by tryLock only. */
        private fun commit(connection: ConnectionRef): Boolean {
            if (!operationMutex.tryLock()) return false
            try {
                if (operation.owner.connection != connection || !isCurrentLocked(operation)) return false
                val snapshot = ownerResolver.currentSnapshot(connection.profileId)
                if (snapshot == null || snapshot.client.connection != connection) return false
                return state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.ADMITTED)
            } finally {
                operationMutex.unlock()
            }
        }
    }

    /** Authority handed to the structured config editor / agent integration for one exact target owner. */
    fun targetAuthority(): SettingsTargetAuthority = object : SettingsTargetAuthority {
        private val capturedRevision: Long = targetRevision
        override suspend fun isCurrent(owner: SettingsOwner): Boolean = operationMutex.withLock {
            selectedProfile(SettingsScope.SETTINGS_TARGET) == owner.connection.profileId &&
                targetRevision == capturedRevision &&
                ownerResolver.currentSnapshot(owner.connection.profileId)?.owner == owner
        }

        override suspend fun guardFor(owner: SettingsOwner): RequestAdmissionGuard? {
            val op = captureOperation(SettingsScope.SETTINGS_TARGET) ?: return null
            return if (op.owner == owner && op.selectionRevision == capturedRevision) requestGuard(op) else null
        }

        override suspend fun revokeRuntime(connection: ConnectionRef) = invalidateRuntime(connection)
    }

    // ------------------------------------------------------------------------------------------
    // Busy tokens (same fair operation mutex)
    // ------------------------------------------------------------------------------------------

    private fun publishBusyLocked() {
        _busy.value = HashMap(busyScopes)
        _importExportState.update {
            it.copy(
                isExporting = busyScopes.containsKey(SettingsBusyKind.EXPORT),
                isImporting = busyScopes.containsKey(SettingsBusyKind.IMPORT),
            )
        }
    }

    private fun clearBusyLocked(scope: SettingsScope) {
        val removed = busyScopes.keys.filter { it.scope == scope }
        if (removed.isEmpty()) return
        removed.forEach { busyScopes.remove(it) }
        publishBusyLocked()
    }

    private suspend fun beginBusy(kind: SettingsBusyKind, op: SettingsOperation): String? =
        operationMutex.withLock {
            when {
                !isCurrentLocked(op) -> "The Settings selection changed; nothing was submitted."
                busyScopes.containsKey(kind) -> "Another ${kind.name.lowercase().replace('_', ' ')} is already running."
                else -> {
                    busyScopes[kind] = op.operationId
                    if (op.scope == SettingsScope.SETTINGS_TARGET) {
                        _importExportState.update { it.copy(lastError = null) }
                    }
                    publishBusyLocked()
                    null
                }
            }
        }

    private suspend fun endBusy(kind: SettingsBusyKind, op: SettingsOperation) {
        withContext(NonCancellable) {
            operationMutex.withLock {
                if (busyScopes[kind] == op.operationId) {
                    busyScopes.remove(kind)
                    publishBusyLocked()
                }
            }
        }
    }

    private fun recordOwnerStatus(
        owner: SettingsOwner,
        kind: SettingsBusyKind,
        outcome: SettingsOutcome<*>,
        operationId: Long,
        label: String,
    ) {
        val message = outcome.reasonOrNull ?: "$label confirmed."
        _ownerStatus.update { it + (owner to SettingsAdminStatus(kind, outcome.kind, message, operationId)) }
    }

    /**
     * Shared administrative skeleton: busy token, fresh binding outside locks, one guard, classification by that
     * guard's receipt, owner-qualified status, token cleanup (also on cancellation), no retry.
     * [mutation] false (reads) maps post-admission failures to Rejected, not Unknown.
     */
    private suspend fun <T> runAdmin(
        operation: SettingsOperation,
        kind: SettingsBusyKind,
        mutation: Boolean,
        block: suspend (ApiClient, RequestAdmissionGuard) -> SettingsOutcome<T>,
    ): SettingsOutcome<T> {
        beginBusy(kind, operation)?.let { reason -> return SettingsOutcome.NotSubmitted(reason) }
        val guard = requestGuard(operation)
        var recorded = false
        try {
            val binding = resolve(operation.owner.connection.profileId)
            val result: SettingsOutcome<T> = if (binding == null || binding.owner != operation.owner) {
                SettingsOutcome.NotSubmitted("The Settings server is not connected or its identity changed.")
            } else if (!isCurrent(operation)) {
                SettingsOutcome.NotSubmitted("The Settings selection changed; nothing was submitted.")
            } else {
                try {
                    block(binding.client, guard)
                } catch (ce: CancellationException) {
                    throw ce
                } catch (t: Exception) {
                    val failure = classifyFailure(guard, t)
                    if (!mutation && failure is SettingsOutcome.Unknown) {
                        SettingsOutcome.Rejected(t.message ?: "Request failed")
                    } else {
                        failure
                    }
                }
            }
            recordOwnerStatus(operation.owner, kind, result, operation.operationId, kind.name)
            publishAdminOutcome(operation, kind, result)
            recorded = true
            return result
        } catch (ce: CancellationException) {
            if (!recorded) {
                val cancelled = classifyCancellation(guard)
                recordOwnerStatus(operation.owner, kind, cancelled, operation.operationId, kind.name)
                publishAdminOutcome(operation, kind, cancelled)
            }
            throw ce
        } finally {
            endBusy(kind, operation)
        }
    }

    private fun publishAdminOutcome(operation: SettingsOperation, kind: SettingsBusyKind, outcome: SettingsOutcome<*>) {
        if (kind.scope != SettingsScope.SETTINGS_TARGET || outcome is SettingsOutcome.Confirmed) return
        // Visible only while this exact target is still selected; the owner-scoped status above stays regardless.
        if (_sourceTargetState.value.settingsProfileId == operation.owner.connection.profileId &&
            targetRevisionSnapshot() == operation.selectionRevision
        ) {
            _importExportState.update { it.copy(lastError = outcome.reasonOrNull) }
        }
    }

    /** Racy read is acceptable here: it only decides which status banner is visible, never an authority. */
    private fun targetRevisionSnapshot(): Long = targetRevision

    // ------------------------------------------------------------------------------------------
    // Administrative operations (target B)
    // ------------------------------------------------------------------------------------------

    /** Exports workspace TOML, bounded to [MAX_CONFIG_IMPORT_BYTES] by the existing bounded transport. */
    suspend fun exportWorkspaceToml(operation: SettingsOperation): SettingsOutcome<ByteArray> =
        runAdmin(operation, SettingsBusyKind.EXPORT, mutation = false) { client, guard ->
            SettingsOutcome.Confirmed(
                client.getBytesBounded(
                    "/api/settings/export/workspace.toml",
                    maxBytes = MAX_CONFIG_IMPORT_BYTES,
                    guard = guard,
                ),
            )
        }

    /**
     * Imports workspace TOML. Size (<= 1 MiB) and strict UTF-8 are validated before any request. Only a
     * well-formed `imported=true` response with fileName/backupFileName confirms; `imported=false` is Rejected
     * and anything malformed after admission is Unknown. Never retried; no rollback claim.
     */
    suspend fun importWorkspaceToml(
        operation: SettingsOperation,
        tomlContent: ByteArray,
    ): SettingsOutcome<SettingsImportResult> {
        if (tomlContent.size > MAX_CONFIG_IMPORT_BYTES) {
            return SettingsOutcome.NotSubmitted("File size exceeds the 1 MiB import limit.")
        }
        val text = try {
            tomlContent.decodeToString(throwOnInvalidSequence = true)
        } catch (_: Exception) {
            return SettingsOutcome.NotSubmitted("The file is not valid UTF-8.")
        }
        val outcome = runAdmin(operation, SettingsBusyKind.IMPORT, mutation = true) { client, guard ->
            val response = client.postToml("/api/settings/import/workspace.toml", text, guard)
            when (val decoded = decodeSettingsImportResponse(response)) {
                is SettingsImportDecode.Imported -> SettingsOutcome.Confirmed(decoded.result)
                SettingsImportDecode.NotImported ->
                    SettingsOutcome.Rejected("The server reported that nothing was imported.")
                is SettingsImportDecode.Malformed ->
                    SettingsOutcome.Unknown("${decoded.reason}." + UNKNOWN_SUFFIX)
            }
        }
        if (outcome is SettingsOutcome.Confirmed) {
            operationMutex.withLock {
                if (targetRevision == operation.selectionRevision) {
                    targetEditRevision++
                    _importExportState.update { it.copy(lastImportResult = outcome.value, lastError = null) }
                }
            }
        }
        return outcome
    }

    /** Clears the server's config cache (existing endpoint). A response without `ok:true` is Unknown. */
    suspend fun clearCache(operation: SettingsOperation): SettingsOutcome<Boolean> =
        postFlag(operation, SettingsBusyKind.CLEAR_CACHE, "/api/settings/cache-clear")

    /** Nuclear reset: destroys live PTYs/runtime workspace state on the server, NOT saved preferences. */
    suspend fun nuclearReset(operation: SettingsOperation): SettingsOutcome<Boolean> =
        postFlag(operation, SettingsBusyKind.RESET, "/api/settings/reset")

    private suspend fun postFlag(
        operation: SettingsOperation,
        kind: SettingsBusyKind,
        path: String,
    ): SettingsOutcome<Boolean> = runAdmin(operation, kind, mutation = true) { client, guard ->
        val text = client.postJson(path, "{}", guard)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        val ok = (obj["ok"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
        if (ok) {
            SettingsOutcome.Confirmed(true)
        } else {
            SettingsOutcome.Unknown("The server did not confirm the request." + UNKNOWN_SUFFIX)
        }
    }

    /**
     * Edits one `ui.agentSettingsPaths` entry on preference source A (other entries preserved). Runtime
     * readiness is revoked (awaited) BEFORE the edit and the path revision advances before and after; a
     * revocation failure or cancellation aborts the edit with nothing sent. No retry.
     */
    suspend fun updateAgentSettingsPath(
        operation: SettingsOperation,
        key: AgentPathKey,
        value: String,
    ): SettingsOutcome<Unit> {
        if (operation.scope != SettingsScope.PREFERENCE_SOURCE) {
            return SettingsOutcome.NotSubmitted("Agent paths belong to the preference source.")
        }
        if (value.isBlank()) return SettingsOutcome.NotSubmitted("The path is blank.")
        return runAdmin(operation, SettingsBusyKind.AGENT_PATHS, mutation = true) { client, guard ->
            _agentPathsRevision.update { it + 1 }
            try {
                invalidateRuntime(operation.owner.connection)
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Exception) {
                return@runAdmin SettingsOutcome.NotSubmitted(
                    "Runtime readiness could not be revoked (${t.message}); the path was not changed.",
                )
            }
            if (!isCurrent(operation)) {
                return@runAdmin SettingsOutcome.NotSubmitted("The preference source changed; nothing was submitted.")
            }
            val merged = JsonObject((_agentSettingsPaths.value ?: JsonObject(emptyMap())) + (key.wire to JsonPrimitive(value)))
            try {
                val ok = RemoteConfigRepository(client).updateGlobalUi(UiPreferences(agentSettingsPaths = merged), guard)
                if (ok) {
                    operationMutex.withLock {
                        if (sourceRevision == operation.selectionRevision) _agentSettingsPaths.value = merged
                    }
                    SettingsOutcome.Confirmed(Unit)
                } else {
                    SettingsOutcome.Unknown("The server did not confirm the path change." + UNKNOWN_SUFFIX)
                }
            } finally {
                _agentPathsRevision.update { it + 1 }
            }
        }
    }
}

/** One-line, honest user text for an outcome; Unknown always says the request may have been applied. */
fun SettingsOutcome<*>.describe(action: String): String = when (this) {
    is SettingsOutcome.Confirmed -> "$action confirmed by the server."
    is SettingsOutcome.NotSubmitted -> "$action was not sent: $reason"
    is SettingsOutcome.Rejected -> "$action was rejected by the server: $reason"
    is SettingsOutcome.Unknown -> "$action result is unknown: $reason"
}

/**
 * One captured Settings-target operation for a host mutation (usage/idle/known workspaces). The operation is
 * captured when the user starts the action (e.g. opens a confirmation); [newGuard] yields a fresh single-use
 * guard per request, so a target change during the confirmation makes admission fail (NotSubmitted).
 */
class HostMutationTicket internal constructor(
    private val repository: SettingsRepository,
    val operation: SettingsOperation,
) {
    fun newGuard(): RequestAdmissionGuard = repository.requestGuard(operation)
}

/** Captures a ticket only when [owner] is exactly the currently selected Settings target (no active-profile fallback). */
fun interface HostMutationAuthority {
    suspend fun capture(owner: ConnectionRef): HostMutationTicket?
}

fun SettingsRepository.hostMutationAuthority(): HostMutationAuthority = HostMutationAuthority { owner ->
    captureOperation(SettingsScope.SETTINGS_TARGET)
        ?.takeIf { it.owner.connection == owner }
        ?.let { HostMutationTicket(this, it) }
}
