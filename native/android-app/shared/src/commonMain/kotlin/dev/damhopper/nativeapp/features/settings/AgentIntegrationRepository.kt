package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentPathsVerification
import dev.damhopper.nativeapp.features.terminal.ExtensionStatusReport
import dev.damhopper.nativeapp.features.terminal.NativeIntegrationStatusReport
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Agent directories as the user entered them (remote paths; never probed on Android). Null = server default. */
data class AgentPathInputs(val omp: String? = null, val codex: String? = null, val claude: String? = null)

/**
 * Immutable, owner+path-revision-qualified result of the authoritative verification calls. It is evidence
 * about [owner] (preference source A / target B), never a runtime certification for another owner C (C3a):
 * a runtime consumer must re-verify against its own owner/socket/revision.
 */
data class AgentIntegrationSnapshot(
    val owner: SettingsOwner,
    val pathRevision: Long,
    val inputs: AgentPathInputs,
    val paths: AgentPathsVerification,
    val omp: ExtensionStatusReport,
    val claude: NativeIntegrationStatusReport,
    val codex: NativeIntegrationStatusReport,
)

enum class AgentIntegrationAction { REFRESH, OMP_INSTALL, OMP_UNINSTALL, CLAUDE_INSTALL, CLAUDE_UNINSTALL, CODEX_INSTALL, CODEX_UNINSTALL }

data class AgentIntegrationState(
    val snapshot: AgentIntegrationSnapshot? = null,
    val busy: AgentIntegrationAction? = null,
    /** Honest text of the last action (including Unknown); cleared by the next explicit action. */
    val message: String? = null,
    /** True after a mutation that may have changed remote state: the snapshot above is no longer evidence. */
    val needsRefresh: Boolean = false,
)

/**
 * Orchestrates Remote Agent Integration for ONE exact [owner]. It reuses [TerminalRepository] (sole endpoint
 * owner, structured JSON bodies, encoded query/path) and never duplicates URLs.
 *
 * - Every install/uninstall awaits [invalidateRuntime] (runtime readiness revocation) BEFORE the request;
 *   failure aborts with NotSubmitted, cancellation propagates, nothing is retried.
 * - Mutations use a fresh request-local guard for exactly [owner] ([SettingsTargetAuthority.guardFor]).
 * - Verification results publish only while [owner] is current AND the path revision is unchanged since the
 *   request began, so stale results cannot reinstate readiness. After a mutation the old snapshot is dropped.
 * - The callback chain must not re-enter profile/registry code or await work needing their locks.
 */
class AgentIntegrationRepository(
    private val terminal: TerminalRepository,
    val owner: SettingsOwner,
    private val authority: SettingsTargetAuthority,
    private val invalidateRuntime: suspend (ConnectionRef) -> Unit,
    private val pathRevision: () -> Long,
) {
    private val _state = MutableStateFlow(AgentIntegrationState())
    val state: StateFlow<AgentIntegrationState> = _state.asStateFlow()

    /**
     * Refreshes path verification and the three integration statuses for [inputs]. Returns true only when the
     * snapshot was published (owner still current, path revision unchanged, every call succeeded).
     */
    suspend fun refresh(inputs: AgentPathInputs): Boolean {
        if (!claim(AgentIntegrationAction.REFRESH)) return false
        val revision = pathRevision()
        try {
            val paths = terminal.getAgentPathsVerification(inputs.omp, inputs.codex, inputs.claude)
            val omp = terminal.getOmpExtensionStatus(inputs.omp)
            val claude = terminal.getNativeIntegrationStatus(AgentKind.CLAUDE, inputs.claude)
            val codex = terminal.getNativeIntegrationStatus(AgentKind.CODEX, inputs.codex)
            if (!authority.isCurrent(owner) || pathRevision() != revision) {
                _state.update { it.copy(message = "Verification result discarded: the server or its paths changed.") }
                return false
            }
            _state.update {
                it.copy(
                    snapshot = AgentIntegrationSnapshot(owner, revision, inputs, paths, omp, claude, codex),
                    needsRefresh = false,
                    message = null,
                )
            }
            return true
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Exception) {
            _state.update { it.copy(message = "Could not verify agent integration: ${t.message ?: "request failed"}") }
            return false
        } finally {
            release(AgentIntegrationAction.REFRESH)
        }
    }

    suspend fun installOmp(agentDir: String?): SettingsOutcome<ExtensionStatusReport> =
        mutate(AgentIntegrationAction.OMP_INSTALL, "OMP extension install") { guard ->
            terminal.installOmpExtension(agentDir, guard)
        }

    suspend fun uninstallOmp(agentDir: String?): SettingsOutcome<ExtensionStatusReport> =
        mutate(AgentIntegrationAction.OMP_UNINSTALL, "OMP extension uninstall") { guard ->
            terminal.uninstallOmpExtension(agentDir, guard)
        }

    suspend fun installIntegration(agent: AgentKind, agentDir: String?): SettingsOutcome<NativeIntegrationStatusReport> {
        require(agent != AgentKind.OMP) { "OMP uses the extension endpoints" }
        val action = if (agent == AgentKind.CLAUDE) AgentIntegrationAction.CLAUDE_INSTALL else AgentIntegrationAction.CODEX_INSTALL
        return mutate(action, "${agent.name.lowercase()} hook install") { guard ->
            terminal.installNativeIntegration(agent, agentDir, guard)
        }
    }

    suspend fun uninstallIntegration(agent: AgentKind, agentDir: String?): SettingsOutcome<NativeIntegrationStatusReport> {
        require(agent != AgentKind.OMP) { "OMP uses the extension endpoints" }
        val action = if (agent == AgentKind.CLAUDE) AgentIntegrationAction.CLAUDE_UNINSTALL else AgentIntegrationAction.CODEX_UNINSTALL
        return mutate(action, "${agent.name.lowercase()} hook uninstall") { guard ->
            terminal.uninstallNativeIntegration(agent, agentDir, guard)
        }
    }

    private fun claim(action: AgentIntegrationAction): Boolean {
        var claimed = false
        _state.update {
            if (it.busy == null) {
                claimed = true
                it.copy(busy = action, message = null)
            } else {
                claimed = false
                it
            }
        }
        return claimed
    }

    private fun release(action: AgentIntegrationAction) {
        _state.update { if (it.busy == action) it.copy(busy = null) else it }
    }

    private suspend fun <T> mutate(
        action: AgentIntegrationAction,
        label: String,
        request: suspend (dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard) -> T,
    ): SettingsOutcome<T> {
        if (!claim(action)) return SettingsOutcome.NotSubmitted("Another agent integration action is already running.")
        var outcome: SettingsOutcome<T>? = null
        try {
            val guard = authority.guardFor(owner)
            if (guard == null) {
                val stale = SettingsOutcome.NotSubmitted("The selected Settings server changed; nothing was sent.")
                outcome = stale
                return stale
            }
            try {
                invalidateRuntime(owner.connection) // awaited BEFORE the request; no eventual flow
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Exception) {
                val aborted = SettingsOutcome.NotSubmitted(
                    "Runtime readiness could not be revoked (${t.message ?: "failure"}); nothing was sent.",
                )
                outcome = aborted
                return aborted
            }
            if (!authority.isCurrent(owner)) {
                val stale = SettingsOutcome.NotSubmitted("The selected Settings server changed; nothing was sent.")
                outcome = stale
                return stale
            }
            val result = guardedOutcome(guard, onCancelled = { cancelled ->
                markMayHaveChanged(cancelled)
            }) { request(guard) }
            outcome = result
            markMayHaveChanged(result)
            return result
        } finally {
            outcome?.let { o -> _state.update { it.copy(message = o.describe(label)) } }
            release(action)
        }
    }

    /** Anything that may have reached the server invalidates earlier verification evidence. */
    private fun markMayHaveChanged(outcome: SettingsOutcome<*>) {
        if (outcome !is SettingsOutcome.NotSubmitted) {
            _state.update { it.copy(snapshot = null, needsRefresh = true) }
        }
    }
}
