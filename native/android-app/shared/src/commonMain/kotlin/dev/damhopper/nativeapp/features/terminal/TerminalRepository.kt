package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import io.ktor.http.encodeURLPathPart
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import kotlinx.datetime.Clock

/**
 * Repository coordinating REST and WebSocket operations for terminal sessions and agent status.
 *
 * Scoped to an authenticated [ApiClient] and live [WsConnection].
 */
class TerminalRepository(
    val apiClient: ApiClient,
    val wsConnection: WsConnection? = null,
    val preferencesStore: PreferencesStore? = null,
    val accountUser: String? = null,
) {
    companion object {
        private val createAdmissionMutex = Mutex()
    }

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
        val response = apiClient.getWithHeaders("/api/terminal")
        val version = response.header(TERMINATION_HEADER_VERSION)
        val epoch = response.header(TERMINATION_HEADER_PTY_EPOCH)
        val list: List<TerminalSessionMeta> = json.decodeFromString(response.body)
        return if (version == "1" && epoch != null) list.map { it.copy(serverPtyEpoch = epoch) } else list
    }

    /**
     * Lists detailed sessions with buffer byte counts from GET /api/terminal/detailed.
     */
    suspend fun listDetailed(): List<TerminalSessionDetailed> {
        val response = apiClient.getWithHeaders("/api/terminal/detailed")
        val version = response.header(TERMINATION_HEADER_VERSION)
        val epoch = response.header(TERMINATION_HEADER_PTY_EPOCH)
        val list: List<TerminalSessionDetailed> = json.decodeFromString(response.body)
        return if (version == "1" && epoch != null) list.map { it.copy(serverPtyEpoch = epoch) } else list
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
            executeGuardedCreate(request).meta
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
     * Spawns a new PTY session via POST /api/terminal and returns the guarded creation outcome.
     */
    suspend fun createSessionGuarded(request: CreateSessionRequest): TerminalCreateOutcome {
        val decoded = executeGuardedCreate(request)
        return TerminalCreateOutcome(
            id = decoded.meta.id,
            incarnation = decoded.meta.incarnation,
            ptyEpoch = decoded.ptyEpoch,
            alive = decoded.meta.alive,
        )
    }

    private data class DecodedCreateResponse(
        val meta: TerminalSessionMeta,
        val ptyEpoch: String,
    )

    private suspend fun executeGuardedCreate(request: CreateSessionRequest): DecodedCreateResponse {
        val intentId = dev.damhopper.nativeapp.features.workflow.WorkflowRepository.generateUuid()
        createAdmissionMutex.withLock {
            val pending = preferencesStore?.loadUncertainCreateRecords()?.filter {
                it.status == UncertainCreateStatus.PENDING &&
                    it.profileId == apiClient.connection.profileId &&
                    (it.endpoint == null || it.endpoint == apiClient.normalizedBaseUrl) &&
                    (it.accountUser == null || accountUser == null || it.accountUser == accountUser) &&
                    (it.terminalId == request.id ||
                     (request.project != null && it.project == request.project && it.worktreePath == request.worktreePath) ||
                     (request.project == null && it.project == null))
            }
            if (!pending.isNullOrEmpty()) {
                throw IllegalStateException("Unsettled pending terminal create intent '${pending.first().intentId}' exists for project '${request.project ?: request.id}'; replacement blocked")
            }
            preferencesStore?.saveUncertainCreateRecord(
                UncertainCreateRecord(
                    intentId = intentId,
                    profileId = apiClient.connection.profileId,
                    terminalId = request.id,
                    project = request.project,
                    worktreePath = request.worktreePath,
                    createdAtEpochMs = Clock.System.now().toEpochMilliseconds(),
                    status = UncertainCreateStatus.PENDING,
                    endpoint = apiClient.normalizedBaseUrl,
                    accountUser = accountUser,
                )
            )
        }
        return try {
            val body = json.encodeToString(CreateSessionRequest.serializer(), request)
            val response = apiClient.postJsonWithHeaders("/api/terminal", body)
            val meta = json.decodeFromString<TerminalSessionMeta>(response.body)
            val ptyEpoch = response.header(TERMINATION_HEADER_PTY_EPOCH).orEmpty()
            val inc = meta.incarnation
            val uuidRegex = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
            val isValidUuid = uuidRegex.matches(ptyEpoch.trim())
            if (meta.id != request.id || !meta.alive || inc <= 0uL || !isValidUuid) {
                throw IllegalStateException("Server returned incomplete or unverified terminal metadata (id: ${meta.id}, alive: ${meta.alive}, incarnation: $inc, ptyEpoch: '$ptyEpoch') for requested ${request.id}")
            }
            preferencesStore?.removeUncertainCreateRecord(intentId)
            val metaWithEpoch = if (ptyEpoch.isNotBlank()) meta.copy(serverPtyEpoch = ptyEpoch) else meta
            DecodedCreateResponse(metaWithEpoch, ptyEpoch)
        } catch (e: dev.damhopper.nativeapp.core.transport.ApiRequestError) {
            if (e.status in listOf(400, 401, 403, 404, 422)) {
                preferencesStore?.removeUncertainCreateRecord(intentId)
            }
            throw e
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
     * Terminates a running session or cancels restart via guarded POST /api/terminal/:id/terminate.
     * Request payload must be <= 512 bytes on the wire.
     * Returns TerminalTerminationOutcome with exact status (202 for terminationRequested, 200 for restartCancelled).
     */
    suspend fun terminateSession(
        id: String,
        expectedServerEpoch: String,
        expectedIncarnation: String,
    ): TerminalTerminationOutcome {
        val request = TerminateSessionRequest(
            version = 1,
            expectedServerEpoch = expectedServerEpoch.lowercase(),
            expectedIncarnation = expectedIncarnation,
        )
        val body = buildJsonObject {
            put("version", 1)
            put("expectedServerEpoch", request.expectedServerEpoch)
            put("expectedIncarnation", request.expectedIncarnation)
        }.toString()
        require(body.encodeToByteArray().size <= 512) { "Terminate payload exceeds 512 bytes" }
        return try {
            val response = apiClient.postJsonWithHeaders(
                "/api/terminal/${id.encodeURLPathPart()}/terminate",
                body,
            )
            TerminalTerminationOutcome(
                id = id,
                requested = response.status == 202,
                restartCancelled = response.status == 200,
                statusCode = response.status,
            )
        } catch (e: dev.damhopper.nativeapp.core.transport.ApiRequestError) {
            TerminalTerminationOutcome(
                id = id,
                requested = false,
                restartCancelled = false,
                statusCode = e.status,
                message = e.message,
            )
        }
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
     * Verifies OMP, Codex, and Claude directories from GET /api/agent-status/paths. Reads may pass an
     * optional [guard]; publication is always fenced by the caller.
     */
    suspend fun getAgentPathsVerification(
        agentDir: String? = null,
        codexDir: String? = null,
        claudeDir: String? = null,
        guard: RequestAdmissionGuard? = null,
    ): AgentPathsVerification {
        val query = mutableMapOf<String, String>()
        agentDir?.let { query["agentDir"] = it }
        codexDir?.let { query["codexDir"] = it }
        claudeDir?.let { query["claudeDir"] = it }
        val response = apiClient.get("/api/agent-status/paths", query, guard)
        return json.decodeFromString(response)
    }

    /**
     * Inspects status of managed OMP extension from GET /api/agent-status/omp/extension.
     */
    suspend fun getOmpExtensionStatus(
        agentDir: String? = null,
        guard: RequestAdmissionGuard? = null,
    ): ExtensionStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val response = apiClient.get("/api/agent-status/omp/extension", query, guard)
        return json.decodeFromString(response)
    }

    /**
     * Installs or upgrades managed OMP extension via POST /api/agent-status/omp/extension/install.
     * [guard] is the required request-local admission; the body is built with a structured serializer so
     * quotes, backslashes and Unicode in [agentDir] round-trip exactly.
     */
    suspend fun installOmpExtension(
        agentDir: String? = null,
        guard: RequestAdmissionGuard,
    ): ExtensionStatusReport {
        val response = apiClient.postJson("/api/agent-status/omp/extension/install", agentDirBody(agentDir), guard)
        return json.decodeFromString(response)
    }

    /**
     * Uninstalls managed OMP extension via DELETE /api/agent-status/omp/extension ([guard] required).
     */
    suspend fun uninstallOmpExtension(
        agentDir: String? = null,
        guard: RequestAdmissionGuard,
    ): ExtensionStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val response = apiClient.delete("/api/agent-status/omp/extension", query, guard)
        return json.decodeFromString(response)
    }

    /**
     * Inspects native integration status (Codex, Claude) from GET /api/agent-status/integrations/:agent.
     */
    suspend fun getNativeIntegrationStatus(
        agent: AgentKind,
        agentDir: String? = null,
        guard: RequestAdmissionGuard? = null,
    ): NativeIntegrationStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.get(path, query, guard)
        return json.decodeFromString(response)
    }

    /**
     * Installs native integration (Codex, Claude) via POST /api/agent-status/integrations/:agent
     * ([guard] required, structured JSON body).
     */
    suspend fun installNativeIntegration(
        agent: AgentKind,
        agentDir: String? = null,
        guard: RequestAdmissionGuard,
    ): NativeIntegrationStatusReport {
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.postJson(path, agentDirBody(agentDir), guard)
        return json.decodeFromString(response)
    }

    /**
     * Uninstalls native integration via DELETE /api/agent-status/integrations/:agent ([guard] required).
     */
    suspend fun uninstallNativeIntegration(
        agent: AgentKind,
        agentDir: String? = null,
        guard: RequestAdmissionGuard,
    ): NativeIntegrationStatusReport {
        val query = agentDir?.let { mapOf("agentDir" to it) } ?: emptyMap()
        val path = "/api/agent-status/integrations/${agent.name.lowercase()}"
        val response = apiClient.delete(path, query, guard)
        return json.decodeFromString(response)
    }

    private fun agentDirBody(agentDir: String?): String = buildJsonObject {
        agentDir?.let { put("agentDir", it) }
    }.toString()

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
