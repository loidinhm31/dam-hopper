package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.builtins.ListSerializer

class TunnelRepository(
    val apiClient: ApiClient
) {
    private val _tunnels = MutableStateFlow<List<TunnelSession>>(emptyList())
    val tunnels: StateFlow<List<TunnelSession>> = _tunnels.asStateFlow()

    private val _installStatus = MutableStateFlow<InstallStatusResponse?>(null)
    val installStatus: StateFlow<InstallStatusResponse?> = _installStatus.asStateFlow()

    private val _warningDismissed = MutableStateFlow(false)
    val warningDismissed: StateFlow<Boolean> = _warningDismissed.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isInstalling = MutableStateFlow(false)
    val isInstalling: StateFlow<Boolean> = _isInstalling.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    suspend fun refreshTunnels(): List<TunnelSession> {
        _isLoading.value = true
        _errorMessage.value = null
        return try {
            val responseText = apiClient.get("/api/tunnels")
            val list = ProtocolJson.decodeFromString(
                ListSerializer(TunnelSession.serializer()),
                responseText
            )
            _tunnels.update { current ->
                val existingMap = current.associateBy { it.id }
                list.map { s ->
                    val ex = existingMap[s.id]
                    if (ex != null && ex.reminderDue && !s.reminderDue) {
                        s.copy(reminderDue = true)
                    } else s
                }
            }
            _tunnels.value
        } catch (e: Throwable) {
            _errorMessage.value = e.message ?: "Failed to list tunnels"
            _tunnels.value
        } finally {
            _isLoading.value = false
        }
    }

    suspend fun refreshInstallStatus(): InstallStatusResponse? {
        return try {
            val responseText = apiClient.get("/api/tunnels/install")
            val status = ProtocolJson.decodeFromString(InstallStatusResponse.serializer(), responseText)
            _installStatus.value = status
            _isInstalling.value = status.installing
            status
        } catch (e: Throwable) {
            _errorMessage.value = e.message ?: "Failed to fetch cloudflared install status"
            null
        }
    }

    suspend fun installCloudflared(): Result<Unit> = runCatching {
        _isInstalling.value = true
        try {
            apiClient.postJson("/api/tunnels/install", "{}")
            refreshInstallStatus()
            Unit
        } catch (e: Throwable) {
            _isInstalling.value = false
            _errorMessage.value = e.message ?: "Failed to start cloudflared installation"
            throw e
        }
    }

    suspend fun createTunnel(port: Int, label: String): Result<TunnelSession> = runCatching {
        val req = CreateTunnelRequest(port = port, label = label.trim())
        val body = ProtocolJson.encodeToString(CreateTunnelRequest.serializer(), req)
        val responseText = apiClient.postJson("/api/tunnels", body)
        val session = ProtocolJson.decodeFromString(TunnelSession.serializer(), responseText)

        _tunnels.update { current ->
            val list = current.toMutableList()
            val index = list.indexOfFirst { it.id == session.id }
            if (index >= 0) {
                list[index] = session
            } else {
                list.add(0, session)
            }
            list
        }
        session
    }

    suspend fun stopTunnel(id: String): Result<Unit> = runCatching {
        apiClient.delete("/api/tunnels/$id")
        _tunnels.update { current ->
            val list = current.toMutableList()
            val index = list.indexOfFirst { it.id == id }
            if (index >= 0) {
                list[index] = list[index].copy(status = TunnelStatus.STOPPED)
            }
            list
        }
    }

    fun dismissWarning() {
        _warningDismissed.value = true
    }

    fun handleServerMsg(msg: ServerMsg) {
        when (msg) {
            is ServerMsg.TunnelCreated -> {
                _tunnels.update { current ->
                    val list = current.toMutableList()
                    val index = list.indexOfFirst { it.id == msg.id }
                    val newStatus = when (msg.status.lowercase()) {
                        "ready" -> TunnelStatus.READY
                        "failed" -> TunnelStatus.FAILED
                        "stopped" -> TunnelStatus.STOPPED
                        else -> TunnelStatus.STARTING
                    }
                    val existing = if (index >= 0) list[index] else null
                    val session = TunnelSession(
                        id = msg.id,
                        port = msg.port,
                        label = msg.label,
                        driver = msg.driver,
                        status = if (existing?.status == TunnelStatus.READY) TunnelStatus.READY else newStatus,
                        url = existing?.url,
                        startedAt = msg.startedAt,
                        reminderDue = existing?.reminderDue ?: false
                    )
                    if (index >= 0) {
                        list[index] = session
                    } else {
                        list.add(0, session)
                    }
                    list
                }
            }

            is ServerMsg.TunnelReady -> {
                _tunnels.update { current ->
                    val list = current.toMutableList()
                    val index = list.indexOfFirst { it.id == msg.id }
                    if (index >= 0) {
                        list[index] = list[index].copy(
                            status = TunnelStatus.READY,
                            url = msg.url
                        )
                    }
                    list
                }
            }

            is ServerMsg.TunnelFailed -> {
                _tunnels.update { current ->
                    val list = current.toMutableList()
                    val index = list.indexOfFirst { it.id == msg.id }
                    if (index >= 0) {
                        list[index] = list[index].copy(
                            status = TunnelStatus.FAILED,
                            error = msg.error
                        )
                    }
                    list
                }
            }

            is ServerMsg.TunnelStopped -> {
                _tunnels.update { current ->
                    val list = current.toMutableList()
                    val index = list.indexOfFirst { it.id == msg.id }
                    if (index >= 0) {
                        list[index] = list[index].copy(
                            status = TunnelStatus.STOPPED
                        )
                    }
                    list
                }
            }

            is ServerMsg.TunnelReminder -> {
                _tunnels.update { current ->
                    val list = current.toMutableList()
                    val index = list.indexOfFirst { it.id == msg.id }
                    if (index >= 0) {
                        list[index] = list[index].copy(
                            reminderDue = true
                        )
                    }
                    list
                }
            }

            else -> Unit
        }
    }

    fun clear() {
        _tunnels.value = emptyList()
        _installStatus.value = null
        _errorMessage.value = null
    }
}
