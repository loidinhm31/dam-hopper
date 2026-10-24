package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class PortRepository(
    val apiClient: ApiClient
) {
    private val _ports = MutableStateFlow<List<DetectedPort>>(emptyList())
    val ports: StateFlow<List<DetectedPort>> = _ports.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    suspend fun refreshPorts(): List<DetectedPort> {
        _isLoading.value = true
        _errorMessage.value = null
        return try {
            val responseText = apiClient.get("/api/ports")
            val response = ProtocolJson.decodeFromString(PortListResponse.serializer(), responseText)
            _ports.update { current ->
                response.ports.map { p ->
                    val existing = current.find { it.port == p.port }
                    if (existing != null && existing.incarnation > p.incarnation) existing else p
                }
            }
            _ports.value
        } catch (e: Throwable) {
            _errorMessage.value = e.message ?: "Failed to list detected ports"
            _ports.value
        } finally {
            _isLoading.value = false
        }
    }

    /**
     * Reconciles inbound WebSocket messages with port incarnation fencing.
     */
    fun handleServerMsg(msg: ServerMsg) {
        when (msg) {
            is ServerMsg.PortDiscovered -> {
                _ports.update { current ->
                    val list = current.toMutableList()
                    val existingIndex = list.indexOfFirst { it.port == msg.port }
                    val newPort = DetectedPort(
                        port = msg.port,
                        sessionId = msg.sessionId,
                        incarnation = msg.incarnation,
                        project = msg.project,
                        detectedVia = if (msg.detectedVia == "stdout_regex") DetectedVia.STDOUT_REGEX else DetectedVia.PROC_NET,
                        state = if (msg.state == "provisional") PortState.PROVISIONAL else PortState.LISTENING
                    )
                    if (existingIndex >= 0) {
                        val existing = list[existingIndex]
                        if (msg.incarnation >= existing.incarnation) {
                            list[existingIndex] = newPort
                        }
                    } else {
                        list.add(newPort)
                    }
                    list
                }
            }

            is ServerMsg.PortLost -> {
                _ports.update { current ->
                    val list = current.toMutableList()
                    val existingIndex = list.indexOfFirst { it.port == msg.port }
                    if (existingIndex >= 0) {
                        val existing = list[existingIndex]
                        if (msg.incarnation >= existing.incarnation) {
                            list[existingIndex] = existing.copy(state = PortState.LOST)
                        }
                    }
                    list
                }
            }

            else -> Unit
        }
    }

    fun clear() {
        _ports.value = emptyList()
        _errorMessage.value = null
    }
}
