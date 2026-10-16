package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.UiConnectionReceipt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class IdleConsentController(
    val connection: ConnectionRef,
    val repository: IdleSuspendRepository,
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

    suspend fun updateTiming(
        quietPeriodSeconds: Int,
        wakeAfterSeconds: Int
    ): Result<IdleSuspendTimingPatchResponse> {
        if (isRetired) return Result.failure(IllegalStateException("Controller is retired"))
        _actionError.value = null
        val result = repository.updateTiming(quietPeriodSeconds, wakeAfterSeconds)
        result.onSuccess {
            refreshStatus()
        }.onFailure { err ->
            _actionError.value = err.message ?: "Failed to update idle suspend timing"
        }
        return result
    }

    /**
     * Dispatches non-retrying manual force suspend.
     */
    suspend fun requestForceSuspend(
        wakeAfterSeconds: Int,
        force: Boolean
    ): Result<ForceSuspendAcceptedResponse> {
        if (isRetired) return Result.failure(IllegalStateException("Controller is retired"))
        if (_isSubmittingForceSuspend.value) {
            return Result.failure(IllegalStateException("Force suspend request already in progress"))
        }
        _isSubmittingForceSuspend.value = true
        _actionError.value = null
        clearConflicts()

        val result = try {
            repository.forceSuspend(wakeAfterSeconds, force)
        } catch (t: Throwable) {
            Result.failure(t)
        }

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
                    _actionError.value = err.message ?: "Force suspend request failed"
                }
            }
            refreshStatus(preserveActionError = true)
        }

        _isSubmittingForceSuspend.value = false
        return result
    }

    /**
     * Submits consent decision with live-socket receipt fencing.
     */
    suspend fun submitConsent(
        decision: SleepConsentDecision
    ): Result<ConsentDecisionResponse> {
        if (isRetired) return Result.failure(IllegalStateException("Controller is retired"))
        val currentConsent = _pendingConsent.value
            ?: return Result.failure(IllegalStateException("No pending sleep consent request"))

        val receipt = receiptProvider()
            ?: return Result.failure(
                IllegalStateException("Cannot submit consent: live WebSocket capability receipt not available")
            )

        if (_isSubmittingDecision.value) {
            return Result.failure(IllegalStateException("Consent decision submission already in progress"))
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

        val result = try {
            repository.submitConsentDecision(request)
        } catch (t: Throwable) {
            Result.failure(t)
        }

        result.onSuccess {
            _pendingConsent.value = null
            refreshStatus()
        }.onFailure { err ->
            _actionError.value = err.message ?: "Failed to submit sleep consent decision"
            refreshStatus(preserveActionError = true)
        }

        _isSubmittingDecision.value = false
        return result
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
