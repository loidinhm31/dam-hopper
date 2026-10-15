package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout


/**
 * Live WebSocket client bound to a single ConnectionRef and socket instance lifecycle.
 */
class WsConnection(
    val connection: ConnectionRef,
    val baseUrl: String,
    val authTokenProvider: suspend () -> String? = { null },
    val registry: ConnectionRegistry? = null,
    private val httpClient: HttpClient = HttpClient(createDefaultHttpEngine()) {
        install(WebSockets)
    },
) {
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private val lifecycleMutex = Mutex()
    private var socketSequence = 0L

    private val _state = MutableStateFlow<WsState>(WsState.Disconnected)
    val state: StateFlow<WsState> = _state.asStateFlow()

    private val _currentReceipt = MutableStateFlow<UiConnectionReceipt?>(null)
    /**
     * Active host:uiConnection receipt on the current socket.
     * Revoked immediately upon socket disconnect, reconnect, or retirement.
     */
    val currentReceipt: StateFlow<UiConnectionReceipt?> = _currentReceipt.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<ServerMsg>(extraBufferCapacity = 64)
    val incomingMessages: SharedFlow<ServerMsg> = _incomingMessages.asSharedFlow()

    private val correlator = WsRequestCorrelator()
    private var activeSocketRef: SocketInstanceRef? = null
    private var activeSession: DefaultClientWebSocketSession? = null
    private var activeWriter: SerializedWsWriter? = null
    private var readerJob: Job? = null

    private var reqIdCounter: ULong = 1000uL
    private val reqIdLock = Any()

    fun nextReqId(): ULong = synchronized(reqIdLock) {
        ++reqIdCounter
    }
    /**
     * Connects to /ws with origin-less handshake and token admission.
     */
    suspend fun connect() = lifecycleMutex.withLock {
        registry?.assertCurrentOwner(connection, "WsConnection.connect")

        if (_state.value is WsState.Connected || _state.value is WsState.Connecting) {
            return@withLock
        }

        _state.value = WsState.Connecting
        val socketId = "sock-${++socketSequence}"
        val socketRef = SocketInstanceRef(connection, socketId)
        correlator.bindSocket(socketRef)

        val token = authTokenProvider()
        val wsUrl = buildWsHandshakeUrl(baseUrl, token)

        val session = try {
            httpClient.webSocketSession(wsUrl)
        } catch (t: Throwable) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
                _state.value = WsState.Disconnected
                correlator.cancelAll("WebSocket connect failed or cancelled: ${t.message}")
            }
            if (t is kotlinx.coroutines.CancellationException) throw t
            _state.value = WsState.Error(t)
            return@withLock
        }
        try {
            registry?.assertCurrentOwner(connection, "WsConnection.connect post-handshake")
        } catch (t: Throwable) {
            try {
                session.close(CloseReason(CloseReason.Codes.NORMAL, "Connection retired during handshake"))
            } catch (_: Throwable) {}
            _state.value = WsState.Disconnected
            throw t
        }

        activeSocketRef = socketRef
        activeSession = session
        val writer = SerializedWsWriter(session)
        activeWriter = writer
        _state.value = WsState.Connected(socketRef)
        readerJob = scope.launch {
            readLoop(session, socketRef)
        }
    }

    /**
     * Transmits a single text ClientMsg.
     */
    suspend fun send(msg: ClientMsg) {
        val writer = activeWriter
            ?: throw ConnectionOwnerError("WebSocket is not connected", ConnectionErrorReason.UNAVAILABLE)
        registry?.assertCurrentOwner(connection, "WsConnection.send")
        writer.sendText(msg)
    }

    /**
     * Atomically transmits a JSON header and a binary frame.
     */
    suspend fun sendAtomicPair(header: ClientMsg, binary: ByteArray) {
        val writer = activeWriter
            ?: throw ConnectionOwnerError("WebSocket is not connected", ConnectionErrorReason.UNAVAILABLE)
        registry?.assertCurrentOwner(connection, "WsConnection.sendAtomicPair")
        writer.sendAtomicPair(header, binary)
    }

    /**
     * Sends a correlated request and awaits the matching response.
     */
    suspend fun request(
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long = 30_000,
    ): ServerMsg {
        val writer = activeWriter
            ?: throw ConnectionOwnerError("WebSocket is not connected", ConnectionErrorReason.UNAVAILABLE)
        registry?.assertCurrentOwner(connection, "WsConnection.request")

        val deferred = CompletableDeferred<ServerMsg>()
        correlator.register(reqId, deferred)

        try {
            writer.sendText(msg)
            return withTimeout(timeoutMillis) {
                deferred.await()
            }
        } catch (t: Throwable) {
            correlator.unregister(reqId)
            deferred.completeExceptionally(t)
            throw t
        }
    }

    /**
     * Subscribes to incoming ServerMsg matching the predicate.
     */
    fun subscribe(predicate: (ServerMsg) -> Boolean = { true }): Flow<ServerMsg> =
        incomingMessages.filter(predicate)

    /**
     * Closes the active session and revokes receipts.
     */
    suspend fun disconnect() = lifecycleMutex.withLock {
        closeInternal("Explicit disconnect", WsState.Disconnected)
    }

    private suspend fun readLoop(session: DefaultClientWebSocketSession, socketRef: SocketInstanceRef) {
        try {
            for (frame in session.incoming) {
                if (!session.isActive) break
                when (frame) {
                    is Frame.Text -> {
                        val text = frame.readText()
                        val msg = try {
                            ProtocolJson.decodeFromString(ServerMsgSerializer, text)
                        } catch (_: Throwable) {
                            null
                        }

                        if (msg != null) {
                            handleServerMsg(msg, socketRef)
                        }
                    }
                    else -> Unit
                }
            }
        } catch (t: Throwable) {
            if (t is kotlinx.coroutines.CancellationException) {
                return
            }
            handleSocketFailure(t, socketRef)
            return
        }

        // Normal close loop exit: check close reason
        val reason = session.closeReason.await()
        handleCloseReason(reason, socketRef)
    }
    private suspend fun handleServerMsg(msg: ServerMsg, socketRef: SocketInstanceRef) {
        val isSocketActive = lifecycleMutex.withLock {
            activeSocketRef == socketRef
        }
        if (!isSocketActive) return

        if (registry?.isCurrentOwner(connection) == false) return

        if (msg is ServerMsg.UiConnection) {
            lifecycleMutex.withLock {
                if (activeSocketRef == socketRef && registry?.isCurrentOwner(connection) != false) {
                    _currentReceipt.value = UiConnectionReceipt(
                        socketRef = socketRef,
                        version = msg.version,
                        connectionId = msg.connectionId,
                        decisionCapability = msg.decisionCapability,
                    )
                }
            }
        }

        correlator.dispatch(msg)
        _incomingMessages.emit(msg)
    }

    private suspend fun handleCloseReason(reason: CloseReason?, socketRef: SocketInstanceRef) {
        val code = reason?.code
        val nextState = when (code) {
            WsCloseCodes.CLOSE_MFA_REQUIRED -> WsState.MfaRequired(code)
            WsCloseCodes.CLOSE_FULL_LOGIN_REQUIRED -> WsState.LoginRequired(code)
            WsCloseCodes.CLOSE_AUTH_UNAVAILABLE -> WsState.AuthUnavailable(code)
            WsCloseCodes.CLOSE_OVERFLOW -> WsState.Overflow(code)
            else -> WsState.Disconnected
        }

        lifecycleMutex.withLock {
            if (activeSocketRef != socketRef) return@withLock
            closeInternal("Socket closed (code: $code)", nextState)
        }
    }

    private suspend fun handleSocketFailure(t: Throwable, socketRef: SocketInstanceRef) {
        lifecycleMutex.withLock {
            if (activeSocketRef != socketRef) return@withLock
            closeInternal("Socket failure: ${t.message}", WsState.Error(t))
        }
    }

    private suspend fun closeInternal(reason: String, nextState: WsState) {
        activeSocketRef = null
        _currentReceipt.value = null
        correlator.cancelAll(reason)
        readerJob?.cancel()
        readerJob = null

        try {
            activeSession?.close(CloseReason(CloseReason.Codes.NORMAL, reason))
        } catch (_: Throwable) {
        }
        activeSession = null
        activeWriter = null

        _state.value = nextState
    }
}
