package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.classifyCancellation
import dev.damhopper.nativeapp.features.settings.reasonOrNull
import kotlinx.coroutines.CancellationException
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.UiConnectionReceipt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class IdleConsentController(
    val connection: ConnectionRef,
    val repository: IdleSuspendRepository,
    /**
     * Non-null while the owner cannot accept Settings idle mutations (e.g. no-auth/dev-mode or unknown auth).
     * Evaluated again at every timing/force-suspend submission. Runtime consent is not gated by it.
     */
    val mutationBlockedReason: () -> String? = { null },
    val receiptProvider: () -> UiConnectionReceipt?
) {
    private val _status = MutableStateFlow<IdleSuspendStatusV1?>(null)
    val status: StateFlow<IdleSuspendStatusV1?> = _status.asStateFlow()

    private val _lastRevision = MutableStateFlow(0L)
    val lastRevision: StateFlow<Long> = _lastRevision.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    private val _pendingConsent = MutableStateFlow<SleepConsentStatus?>(null)
    val pendingConsent: StateFlow<SleepConsentStatus?> = _pendingConsent.asStateFlow()

    private val _isSubmittingDecision = MutableStateFlow(false)
    val isSubmittingDecision: StateFlow<Boolean> = _isSubmittingDecision.asStateFlow()

    private val _isSubmittingForceSuspend = MutableStateFlow(false)
    val isSubmittingForceSuspend: StateFlow<Boolean> = _isSubmittingForceSuspend.asStateFlow()

    private val _activeFleetConflict = MutableStateFlow<IdleSuspendConflictResponse?>(null)
    val activeFleetConflict: StateFlow<IdleSuspendConflictResponse?> = _activeFleetConflict.asStateFlow()

    private val _fleetChangedConflict = MutableStateFlow<IdleSuspendConflictResponse?>(null)
    val fleetChangedConflict: StateFlow<IdleSuspendConflictResponse?> = _fleetChangedConflict.asStateFlow()

    private val _lastForceSuspendAdmission = MutableStateFlow<ForceSuspendAcceptedResponse?>(null)
    val lastForceSuspendAdmission: StateFlow<ForceSuspendAcceptedResponse?> = _lastForceSuspendAdmission.asStateFlow()

    private var isRetired = false

    suspend fun refreshStatus(preserveActionError: Boolean = false): Result<IdleSuspendStatusV1> {
        if (isRetired) return Result.failure(IllegalStateException("Controller is retired"))
        _isLoading.value = true
        if (!preserveActionError) {
            _actionError.value = null
        }
        val result = repository.getStatus()
        result.onSuccess { s ->
            if (!isRetired) {
                _status.value = s
                _lastRevision.value = maxOf(_lastRevision.value, s.statusRevision)
                // Reconcile pending consent: clear whenever not in PENDING state
                val consent = s.consent
                if (consent != null && consent.state == SleepConsentState.PENDING) {
                    _pendingConsent.value = consent
                } else {
                    _pendingConsent.value = null
                }
            }
        }.onFailure { err ->
            if (!isRetired) {
                _actionError.value = err.message ?: "Failed to fetch idle suspend status"
            }
        }
        _isLoading.value = false
        return result
    }

    /**
     * Reconciles out-of-band revision hint.
     * Note: revision 0 is a broadcast lag re-sync hint from server; must trigger reconciliation.
     */
    suspend fun handleServerMsg(msg: ServerMsg) {
        if (isRetired) return
        when (msg) {
            is ServerMsg.IdleSuspendChanged -> {
                if (msg.payload.version == 1) {
                    val rev = msg.payload.revision
                    if (rev == 0L || rev != _lastRevision.value) {
                        refreshStatus()
                    }
                }
            }
            else -> Unit
        }
    }

    /**
     * Updates the atomic quiet/wake pair. The controller mirrors the repository: both validate against the
     * LATEST status min/max (no hard-coded bounds), unknown/locked/handoff/capability states never submit, and
     * the repository re-fetches the current-owner status before the guarded PATCH. Never retried; an ambiguous
     * result is Unknown and the status is only re-read.
     */
    suspend fun updateTiming(
        quietPeriodSeconds: Int,
        wakeAfterSeconds: Int,
        guard: RequestAdmissionGuard,
    ): SettingsOutcome<IdleSuspendTimingPatchResponse> {
        if (isRetired) return SettingsOutcome.NotSubmitted("Controller is retired")
        // Rechecked at submission time (not only when the control was drawn): auth/capability may have changed.
        mutationBlockedReason()?.let { reason ->
            _actionError.value = reason
            return SettingsOutcome.NotSubmitted(reason)
        }
        _actionError.value = null
        validateIdleTiming(_status.value, quietPeriodSeconds, wakeAfterSeconds)?.let { reason ->
            _actionError.value = reason
            return SettingsOutcome.NotSubmitted(reason)
        }
        val outcome = try {
            idleOutcome(repository.updateTiming(quietPeriodSeconds, wakeAfterSeconds, guard), guard)
        } catch (ce: CancellationException) {
            _actionError.value = classifyCancellation(guard).reasonOrNull
            throw ce
        }
        if (outcome is SettingsOutcome.Confirmed) {
            refreshStatus()
        } else {
            _actionError.value = outcome.reasonOrNull
            if (outcome !is SettingsOutcome.NotSubmitted) refreshStatus(preserveActionError = true)
        }
        return outcome
    }

    /**
     * Dispatches non-retrying manual force suspend through the request-local [guard].
     */
    suspend fun requestForceSuspend(
        wakeAfterSeconds: Int,
        force: Boolean,
        guard: RequestAdmissionGuard,
    ): SettingsOutcome<ForceSuspendAcceptedResponse> {
        if (isRetired) return SettingsOutcome.NotSubmitted("Controller is retired")
        mutationBlockedReason()?.let { reason ->
            _actionError.value = reason
            return SettingsOutcome.NotSubmitted(reason)
        }
        if (_isSubmittingForceSuspend.value) {
            return SettingsOutcome.NotSubmitted("Force suspend request already in progress")
        }
        validateForceSuspendWake(_status.value, wakeAfterSeconds)?.let { reason ->
            _actionError.value = reason
            return SettingsOutcome.NotSubmitted(reason)
        }
        _isSubmittingForceSuspend.value = true
        _actionError.value = null
        clearConflicts()

        try {
            val result = repository.forceSuspend(wakeAfterSeconds, force, guard)
            val outcome = idleOutcome(result, guard)
            result.onSuccess { response ->
                _lastForceSuspendAdmission.value = response
                refreshStatus()
            }.onFailure { err ->
                when (err) {
                    is IdleSuspendActiveFleetConflictException -> {
                        _activeFleetConflict.value = err.conflict
                    }
                    is IdleSuspendFleetChangedConflictException -> {
                        _fleetChangedConflict.value = err.conflict
                    }
                    is IdleSuspendHandoffConflictException -> {
                        _actionError.value = err.message
                    }
                    else -> {
                        _actionError.value = outcome.reasonOrNull ?: "Force suspend request failed"
                    }
                }
                if (outcome !is SettingsOutcome.NotSubmitted) refreshStatus(preserveActionError = true)
            }
            return outcome
        } catch (ce: CancellationException) {
            _actionError.value = classifyCancellation(guard).reasonOrNull
            throw ce
        } finally {
            _isSubmittingForceSuspend.value = false
        }
    }

    /**
     * Submits consent decision with live-socket receipt fencing. [guard] is the explicit runtime-owner guard
     * (never a Settings-target fallback).
     */
    suspend fun submitConsent(
        decision: SleepConsentDecision,
        guard: RequestAdmissionGuard,
    ): SettingsOutcome<ConsentDecisionResponse> {
        if (isRetired) return SettingsOutcome.NotSubmitted("Controller is retired")
        val currentConsent = _pendingConsent.value
            ?: return SettingsOutcome.NotSubmitted("No pending sleep consent request")

        val receipt = receiptProvider()
            ?: return SettingsOutcome.NotSubmitted(
                "Cannot submit consent: live WebSocket capability receipt not available",
            )

        if (_isSubmittingDecision.value) {
            return SettingsOutcome.NotSubmitted("Consent decision submission already in progress")
        }
        _isSubmittingDecision.value = true
        _actionError.value = null

        val request = ConsentDecisionRequest(
            requestId = currentConsent.requestId,
            requestRevision = currentConsent.requestRevision,
            connectionId = receipt.connectionId,
            decisionCapability = receipt.decisionCapability,
            decision = decision
        )

        try {
            val result = repository.submitConsentDecision(request, guard)
            val outcome = idleOutcome(result, guard)
            result.onSuccess {
                _pendingConsent.value = null
                refreshStatus()
            }.onFailure { err ->
                _actionError.value = outcome.reasonOrNull ?: err.message ?: "Failed to submit sleep consent decision"
                if (outcome !is SettingsOutcome.NotSubmitted) refreshStatus(preserveActionError = true)
            }
            return outcome
        } catch (ce: CancellationException) {
            _actionError.value = classifyCancellation(guard).reasonOrNull
            throw ce
        } finally {
            _isSubmittingDecision.value = false
        }
    }

    fun clearConflicts() {
        _activeFleetConflict.value = null
        _fleetChangedConflict.value = null
    }

    fun clearActionError() {
        _actionError.value = null
    }

    fun retire() {
        isRetired = true
        _pendingConsent.value = null
        _activeFleetConflict.value = null
        _fleetChangedConflict.value = null
        _lastForceSuspendAdmission.value = null
    }
}
