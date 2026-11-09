package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import dev.damhopper.nativeapp.core.transport.WsState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Presentation outcome for terminal connection and session status indicator.
 */
data class TerminalTabStatus(
    val color: Color,
    val label: String,
    val description: String,
)

/**
 * Presentation outcome for uncertain terminal create intent.
 * Enforces C6/C8: never offers Launch Again, offers Check status + explanation only.
 */
data class TerminalCreateStatusPresentation(
    val status: UncertainCreateStatus,
    val label: String,
    val explanation: String,
    val canCheckStatus: Boolean,
    val canLaunchAgain: Boolean = false, // Inviolable invariant: ALWAYS false
)

/**
 * Presentation outcome for terminal termination request.
 */
data class TerminalTerminationPresentation(
    val label: String,
    val description: String,
    val isPending: Boolean,
    val isRefused: Boolean,
)

/**
 * Decouples terminal status presentation into transport availability, process liveness,
 * and stream replay readiness.
 */
object TerminalConnectionPresentation {

    /**
     * Resolves the visual status of a terminal session tab.
     *
     * Invariants:
     * 1. Transport disconnection or error takes precedence and NEVER shows green.
     * 2. Exited process is shown as Error (red) even if transport is connected.
     * 3. Stream replaying shows Warning (yellow/orange).
     * 4. Green (Success) is rendered ONLY when transport is Connected, process is Alive, and stream is Ready.
     */
    fun resolveTabStatus(
        wsState: WsState?,
        isSessionAlive: Boolean,
        isStreamReady: Boolean,
        restartCount: UInt = 0u,
    ): TerminalTabStatus {
        if (wsState !is WsState.Connected) {
            return when (wsState) {
                null, is WsState.Disconnected -> TerminalTabStatus(
                    color = DamHopperColors.TextSecondary,
                    label = "OFFLINE",
                    description = "Terminal offline; disconnected from server",
                )
                is WsState.Connecting -> TerminalTabStatus(
                    color = DamHopperColors.Warning,
                    label = "CONNECTING",
                    description = "Connecting to terminal service...",
                )
                is WsState.Overflow -> TerminalTabStatus(
                    color = DamHopperColors.Warning,
                    label = "RESYNCING",
                    description = "Connection backpressure overflow; resynchronizing...",
                )
                is WsState.MfaRequired, is WsState.LoginRequired -> TerminalTabStatus(
                    color = DamHopperColors.Warning,
                    label = "AUTH REQUIRED",
                    description = "Authentication required",
                )
                is WsState.Error, is WsState.AuthUnavailable -> TerminalTabStatus(
                    color = DamHopperColors.Error,
                    label = "ERROR",
                    description = "Connection error",
                )
                is WsState.Connected -> error("unreachable")
            }
        }

        return when {
            !isSessionAlive -> TerminalTabStatus(
                color = DamHopperColors.Error,
                label = "EXITED",
                description = "Process exited on server",
            )
            !isStreamReady -> TerminalTabStatus(
                color = DamHopperColors.Warning,
                label = "REPLAYING",
                description = "Replaying stream buffer...",
            )
            else -> TerminalTabStatus(
                color = DamHopperColors.Success,
                label = "READY",
                description = "Terminal ready; process alive and stream connected" +
                    if (restartCount > 0u) " ($restartCount restarts)" else "",
            )
        }
    }

    /**
     * Resolves truthful explanation and actions for uncertain terminal create intents.
     * Under C6/C8: strictly blocks Launch Again, offers Check status only.
     */
    fun resolveCreateStatusPresentation(
        record: UncertainCreateRecord,
    ): TerminalCreateStatusPresentation {
        return when (record.status) {
            UncertainCreateStatus.PENDING -> TerminalCreateStatusPresentation(
                status = record.status,
                label = "CREATION UNCERTAIN",
                explanation = "Creation outcome for '${record.terminalId}' on profile '${record.profileId}' is unresolved. The original target may still succeed on the server. Replacement is blocked to prevent duplicate PTYs.",
                canCheckStatus = true,
                canLaunchAgain = false,
            )
            UncertainCreateStatus.CONFIRMED -> TerminalCreateStatusPresentation(
                status = record.status,
                label = "CONFIRMED",
                explanation = "Terminal '${record.terminalId}' confirmed created.",
                canCheckStatus = false,
                canLaunchAgain = false,
            )
            UncertainCreateStatus.REFUSED -> TerminalCreateStatusPresentation(
                status = record.status,
                label = "DEFINITELY REFUSED",
                explanation = "Terminal '${record.terminalId}' confirmed definitely refused or absent on server.",
                canCheckStatus = false,
                canLaunchAgain = false,
            )
        }
    }

    /**
     * Resolves presentation for guarded termination outcome.
     * 202 terminationRequested and 200 restartCancelled do NOT constitute observed process exit.
     * 409 mismatch preserves original target without retry.
     */
    fun resolveTerminationOutcomePresentation(
        outcome: TerminalTerminationOutcome,
    ): TerminalTerminationPresentation {
        return when {
            outcome.requested -> TerminalTerminationPresentation(
                label = "TERMINATION REQUESTED",
                description = "Termination acknowledged by server (202). Awaiting observed process exit.",
                isPending = true,
                isRefused = false,
            )
            outcome.restartCancelled -> TerminalTerminationPresentation(
                label = "RESTART CANCELLED",
                description = "Restart cancelled by server (200). Awaiting observed process exit.",
                isPending = true,
                isRefused = false,
            )
            outcome.statusCode == 409 -> TerminalTerminationPresentation(
                label = "TERMINATION REFUSED",
                description = "Termination refused by server (409): mismatch. Original target preserved.",
                isPending = false,
                isRefused = true,
            )
            outcome.statusCode == 0 || outcome.statusCode in 500..599 -> TerminalTerminationPresentation(
                label = "TERMINATION UNCERTAIN",
                description = "Termination dispatch uncertain (${outcome.statusCode}): ${outcome.message ?: "network or server error"}. Original target preserved; check status before retrying.",
                isPending = true,
                isRefused = false,
            )
            else -> TerminalTerminationPresentation(
                label = "TERMINATION ERROR",
                description = "Termination failed (${outcome.statusCode}): ${outcome.message ?: "unknown error"}",
                isPending = false,
                isRefused = true,
            )
        }
    }
}
