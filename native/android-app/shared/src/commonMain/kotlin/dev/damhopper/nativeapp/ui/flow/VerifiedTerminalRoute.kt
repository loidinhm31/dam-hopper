package dev.damhopper.nativeapp.ui.flow

/**
 * A terminal route whose target was verified by the retained Agents activation coordinator (manual activation).
 * [notificationRouteActive] is false for manual routes; the notification path keeps its own public API and never
 * invents an [incarnation].
 */
data class VerifiedTerminalRoute(
    val profileId: String,
    val project: String,
    val worktreePath: String?,
    val sessionId: String,
    val incarnation: ULong,
    val notificationRouteActive: Boolean,
)

/** Outcome of [AppFlowNavigation.requestVerifiedTerminalRoute]: continue now, or wait for the departure guard. */
enum class TerminalRouteGate {
    PROCEED,
    DEFERRED,
}

/**
 * One departure request handed to [AppFlowNavigation.departureGuard]. The guard either returns false (proceed
 * immediately) or intercepts: it then keeps both callbacks and MUST invoke exactly one of them later -
 * [onProceed] after the user confirms, [onCancelled] when the prompt is cancelled, dismissed, rejected, superseded
 * or its authority retires. Ordinary navigation supplies a no-op [onCancelled].
 */
data class DepartureRequest(
    val targetStage: AppFlowStage,
    val onProceed: () -> Unit,
    val onCancelled: () -> Unit,
)
