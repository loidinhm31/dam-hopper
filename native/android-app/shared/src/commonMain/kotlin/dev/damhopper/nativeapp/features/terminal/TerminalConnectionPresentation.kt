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
}
