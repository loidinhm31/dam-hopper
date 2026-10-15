package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.coroutines.coroutineContext

/**
 * Client for authenticated Host Resource SSE events (/api/system/resources/v1/events).
 *
 * Implements:
 * - Bounded incremental SSE parsing (256 KiB data cap, 4 KiB status/error cap).
 * - Exact-revision status-data pairing requirement (data event accepted only when
 *   immediately preceded by matching status event).
 * - Finite error handling before headers (e.g. 503 FRAME_TOO_LARGE / AUTH_UNAVAILABLE).
 * - ConnectionRef generation fencing to prevent stale readers from emitting.
 */
class HostResourceSseClient(
    val connection: ConnectionRef,
    baseUrl: String,
    val authTokenProvider: () -> String? = { null },
    val registry: ConnectionRegistry? = null,
    private val httpClient: HttpClient = HttpClient(createDefaultHttpEngine()) {
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 60_000
        }
        followRedirects = false
    },
) {
    val normalizedBaseUrl: String = baseUrl.trim().trimEnd('/')

    companion object {
        const val MAX_DATA_EVENT_BYTES = 262_144 // 256 KiB
        const val MAX_CONTROL_EVENT_BYTES = 4_096 // 4 KiB
    }

    /**
     * Opens an authenticated SSE stream and emits paired frames.
     */
    fun openEventStream(): Flow<HostResourceSseFrame> = flow {
        registry?.assertCurrentOwner(connection, "HostResourceSseClient.openEventStream")
        val fullUrl = "$normalizedBaseUrl/api/system/resources/v1/events"
        val token = authTokenProvider()

        val statement = httpClient.prepareGet(fullUrl) {
            header(HttpHeaders.Accept, "text/event-stream")
            header(HttpHeaders.CacheControl, "private, no-store, no-transform")
            if (!token.isNullOrBlank()) {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }

        statement.execute { response ->
            registry?.assertCurrentOwner(connection, "HostResourceSseClient response headers")

            if (!response.status.isSuccess()) {
                val errorBody = response.bodyAsText().take(4096)
                val code = parseErrorCode(errorBody)
                val retryAfter = response.headers[HttpHeaders.RetryAfter]?.toLongOrNull()
                throw ApiRequestError(
                    message = "SSE stream request failed with HTTP ${response.status.value}",
                    status = response.status.value,
                    code = code,
                    retryAfterSeconds = retryAfter,
                    details = errorBody,
                )
            }

            val channel: ByteReadChannel = response.body()
            var currentEventName: String? = null
            val currentDataLines = mutableListOf<String>()
            var lastStatus: HostResourceStatusEvent? = null

            while (coroutineContext.isActive && !channel.isClosedForRead) {
                registry?.assertCurrentOwner(connection, "HostResourceSseClient read line")
                val line = channel.readUTF8Line(MAX_DATA_EVENT_BYTES) ?: break

                if (line.isEmpty()) {
                    // Dispatch current buffered event on blank line
                    if (currentEventName != null && currentDataLines.isNotEmpty()) {
                        val eventData = currentDataLines.joinToString("\n")
                        val frame = processEvent(currentEventName, eventData, lastStatus)
                        if (frame != null) {
                            if (frame is HostResourceSseFrame.Status) {
                                lastStatus = frame.status
                            } else if (frame is HostResourceSseFrame.PairedData) {
                                lastStatus = null // Consumed paired status
                            } else {
                                lastStatus = null
                            }
                            emit(frame)
                        } else {
                            // Non-matching or invalid event breaks adjacency
                            lastStatus = null
                        }
                    }
                    currentEventName = null
                    currentDataLines.clear()
                    continue
                }

                if (line.startsWith(":")) {
                    // SSE comment: breaks status/data adjacency per architecture spec
                    lastStatus = null
                    continue
                }

                if (line.startsWith("event:")) {
                    currentEventName = line.substring(6).trim()
                } else if (line.startsWith("data:")) {
                    val dataPart = line.substring(5).trimStart()
                    currentDataLines.add(dataPart)
                }
            }
        }
    }

    private fun processEvent(
        eventName: String,
        data: String,
        lastStatus: HostResourceStatusEvent?,
    ): HostResourceSseFrame? {
        return try {
            when (eventName) {
                "host-resources-status" -> {
                    if (data.length > MAX_CONTROL_EVENT_BYTES) return null
                    val status = ProtocolJson.decodeFromString(HostResourceStatusEvent.serializer(), data)
                    HostResourceSseFrame.Status(status)
                }
                "host-resources" -> {
                    if (data.length > MAX_DATA_EVENT_BYTES) return null
                    val dataEvent = ProtocolJson.decodeFromString(HostResourceDataEvent.serializer(), data)
                    // Must match immediately preceding status frame
                    if (lastStatus != null &&
                        lastStatus.serverEpoch == dataEvent.serverEpoch &&
                        lastStatus.revision == dataEvent.revision
                    ) {
                        HostResourceSseFrame.PairedData(status = lastStatus, data = dataEvent)
                    } else {
                        null
                    }
                }
                "host-resources-error" -> {
                    if (data.length > MAX_CONTROL_EVENT_BYTES) return null
                    val errorEvent = ProtocolJson.decodeFromString(HostResourceErrorEvent.serializer(), data)
                    HostResourceSseFrame.ErrorControl(errorEvent)
                }
                else -> null
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun parseErrorCode(body: String): String? {
        return try {
            val element = ProtocolJson.parseToJsonElement(body)
            if (element is JsonObject) {
                element["code"]?.jsonPrimitive?.content
            } else null
        } catch (_: Throwable) {
            null
        }
    }
}
