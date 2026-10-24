package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import io.ktor.http.encodeURLPathPart
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.serialization.json.Json

/**
 * Repository coordinating REST and WebSocket operations for terminal sessions and agent status.
 *
 * Scoped to an authenticated [ApiClient] and live [WsConnection].
 */
class TerminalRepository(
    val apiClient: ApiClient,
    val wsConnection: WsConnection? = null,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    // ---------------------------------------------------------------------------
    // REST Terminal Session Operations
    // ---------------------------------------------------------------------------

    /**
     * Lists active and dead session summaries from GET /api/terminal.
     */
    suspend fun listSessions(): List<TerminalSessionMeta> {
        val response = apiClient.get("/api/terminal")
        return json.decodeFromString(response)
    }

    /**
     * Lists detailed sessions with buffer byte counts from GET /api/terminal/detailed.
     */
    suspend fun listDetailed(): List<TerminalSessionDetailed> {
        val response = apiClient.get("/api/terminal/detailed")
        return json.decodeFromString(response)
    }

    /**
     * Spawns a new PTY session via POST /api/terminal.
     */
    suspend fun createSession(request: CreateSessionRequest): TerminalSessionMeta {
        AppLogger.recordDiagnostic(
            type = "terminal",
            scope = "terminal-repository",
            message = "terminal.create",
            profileId = apiClient.connection.profileId,
            generation = apiClient.connection.generation,
            metadata = mapOf("project" to (request.project ?: "default"))
        )
        return try {
            val body = json.encodeToString(CreateSessionRequest.serializer(), request)
            val response = apiClient.postJson("/api/terminal", body)
            json.decodeFromString(response)
        } catch (t: Throwable) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-repository",
                message = "terminal.create_failed",
                profileId = apiClient.connection.profileId,
                generation = apiClient.connection.generation,
                metadata = mapOf("error" to (t.message ?: "unknown"))
            )
            throw t
        }
    }
    /**
     * Renames an existing session via PATCH /api/terminal/:id.
     */
    suspend fun renameSession(id: String, name: String?): TerminalSessionMeta {
        val body = json.encodeToString(RenameSessionRequest.serializer(), RenameSessionRequest(name))
        val response = apiClient.patchJson("/api/terminal/${id.encodeURLPathPart()}", body)
        return json.decodeFromString(response)
    }

    /**
     * Fetches current scrollback buffer from GET /api/terminal/:id/buffer.
     */
    suspend fun getBuffer(id: String): String {
        val response = apiClient.get("/api/terminal/${id.encodeURLPathPart()}/buffer")
        val parsed = json.decodeFromString<TerminalBufferResponse>(response)
        return parsed.buffer
    }

    /**
     * Kills running process while keeping tombstone via DELETE /api/terminal/:id.
     */
    suspend fun killSession(id: String) {
        apiClient.delete("/api/terminal/${id.encodeURLPathPart()}")
    }

    /**
     * Kills and completely evicts session metadata via DELETE /api/terminal/:id/remove.
     */
    suspend fun removeSession(id: String) {
        apiClient.delete("/api/terminal/${id.encodeURLPathPart()}/remove")
    }

    // ---------------------------------------------------------------------------
    // REST Agent Status & Integrations Operations
    // ---------------------------------------------------------------------------

    /**
     * Fetches complete agent status snapshot from GET /api/agent-status/v1/snapshot.
     */
    suspend fun getAgentStatusSnapshot(): AgentStatusSnapshotV1 {
        val response = apiClient.get("/api/agent-status/v1/snapshot")
        return json.decodeFromString(response)
    }

    /**
     * Verifies OMP, Codex, and Claude directories from GET /api/agent-status/paths.
     */
    suspend fun getAgentPathsVerification(
        agentDir: String? = null,
        codexDir: String? = null,
        claudeDir: String? = null,
    ): AgentPathsVerification {
        val query = mutableMapOf<String, String>()
        agentDir?.let { query["agentDir"] = it }
        codexDir?.let { query["codexDir"] = it }
        claudeDir?.let { query["claudeDir"] = it }
        val response = apiClient.get("/api/agent-status/paths", query)
        return json.decodeFromString(response)
    }

    /**
     * Inspects status of managed OMP extension from GET /api/agent-status/omp/extension.
     */
    suspend fun getOmpExtensionStatus(agentDir: String? = null): ExtensionStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val response = apiClient.get("/api/agent-status/omp/extension", query)
        return json.decodeFromString(response)
    }

    /**
     * Installs or upgrades managed OMP extension via POST /api/agent-status/omp/extension/install.
     */
    suspend fun installOmpExtension(agentDir: String? = null): ExtensionStatusReport {
        val body = agentDir?.let { """{"agentDir":"$it"}""" } ?: "{}"
        val response = apiClient.postJson("/api/agent-status/omp/extension/install", body)
        return json.decodeFromString(response)
    }

    /**
     * Uninstalls managed OMP extension via DELETE /api/agent-status/omp/extension.
     */
    suspend fun uninstallOmpExtension(agentDir: String? = null): ExtensionStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val response = apiClient.delete("/api/agent-status/omp/extension", query)
        return json.decodeFromString(response)
    }

    /**
     * Inspects native integration status (Codex, Claude) from GET /api/agent-status/integrations/:agent.
     */
    suspend fun getNativeIntegrationStatus(
        agent: AgentKind,
        agentDir: String? = null,
    ): NativeIntegrationStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.get(path, query)
        return json.decodeFromString(response)
    }

    /**
     * Installs native integration (Codex, Claude) via POST /api/agent-status/integrations/:agent.
     */
    suspend fun installNativeIntegration(
        agent: AgentKind,
        agentDir: String? = null,
    ): NativeIntegrationStatusReport {
        val body = agentDir?.let { """{"agentDir":"$it"}""" } ?: "{}"
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.postJson(path, body)
        return json.decodeFromString(response)
    }

    /**
     * Uninstalls native integration via DELETE /api/agent-status/integrations/:agent.
     */
    suspend fun uninstallNativeIntegration(
        agent: AgentKind,
        agentDir: String? = null,
    ): NativeIntegrationStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.delete(path, query)
        return json.decodeFromString(response)
    }

    // ---------------------------------------------------------------------------
    // WebSocket Terminal Operations & Streams
    // ---------------------------------------------------------------------------

    /**
     * Sends terminal keystrokes/data to remote PTY.
     */
    suspend fun writeTerminal(id: String, data: String) {
        val ws = wsConnection ?: return
        ws.send(ClientMsg.TermWrite(id = id, data = data))
    }

    /**
     * Sends terminal resize geometry to remote PTY.
     */
    suspend fun resizeTerminal(id: String, cols: Int, rows: Int) {
        val ws = wsConnection ?: return
        ws.send(ClientMsg.TermResize(id = id, cols = cols, rows = rows))
    }

    /**
     * Attaches to remote PTY session requesting replay from optional offset.
     */
    suspend fun attachTerminal(id: String, fromOffset: ULong? = null) {
        val ws = wsConnection ?: return
        AppLogger.recordDiagnostic(
            type = "transport",
            scope = "terminal-panel",
            message = "terminal.attach",
            profileId = apiClient.connection.profileId,
            generation = apiClient.connection.generation,
            sessionId = id,
            metadata = mapOf("fromOffset" to (fromOffset?.toString() ?: "null"))
        )
        ws.send(ClientMsg.TermAttach(id = id, fromOffset = fromOffset))
    }

    val terminalOutput: Flow<ServerMsg.TermOutput>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val terminalBuffer: Flow<ServerMsg.TermBuffer>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val terminalLifecycle: Flow<ServerMsg.TerminalLifecycle>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val terminalExit: Flow<ServerMsg.TermExit>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val terminalLagged: Flow<ServerMsg.TermLagged>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val processRestarted: Flow<ServerMsg.ProcessRestarted>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val agentStatusChanged: Flow<ServerMsg.AgentStatusChanged>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val agentStatusRemoved: Flow<ServerMsg.AgentStatusRemoved>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()

    val agentStatusInvalidated: Flow<ServerMsg.AgentStatusInvalidated>
        get() = wsConnection?.incomingMessages?.filterIsInstance() ?: emptyFlow()
}
