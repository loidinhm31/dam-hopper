package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.prepareDelete
import io.ktor.client.request.prepareGet
import io.ktor.client.request.preparePatch
import io.ktor.client.request.preparePost
import io.ktor.client.request.preparePut
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.HttpStatement
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Request-local admission lifecycle. Terminal after [REJECTED] or [ADMITTED]; a rejected or
 * consumed guard is never retried.
 */
enum class RequestAdmissionState { PENDING, REJECTED, ADMITTED }

/**
 * Single-use, request-local permission-to-attempt. [admit] runs after credentials and Ktor
 * preparation, immediately before the one prepared execute. `true` authorizes only the invoking
 * request; `false` (rejection, contention, reuse of an ADMITTED guard, null registry) means the
 * request was NotSubmitted. Admission is not proof of dispatch or delivery.
 */
interface RequestAdmissionGuard {
    val admission: StateFlow<RequestAdmissionState>
    suspend fun admit(registry: ConnectionRegistry?, connection: ConnectionRef): Boolean
}

/** The request was denied by local admission and never handed to the HTTP engine. */
class RequestNotSubmittedError(message: String) : Exception(message)

/**
 * Type-safe HTTP API client scoped to a single ConnectionRef.
 *
 * Optional trailing [RequestAdmissionGuard] on every request method gates the single execute
 * attempt for Settings mutations; unguarded callers keep a final registry-generation check.
 *
 * Ensures:
 * - Credentials and tokens are redacted in all exception and log strings.
 * - Stale request starts AND completions are rejected via ConnectionRegistry.
 * - No cross-origin redirect credential leakage (redirects disabled).
 * - Standard server error envelopes ({ "code": "...", "error": "..." }) and Retry-After headers parsed.
 */
class ApiClient(
    val connection: ConnectionRef,
    baseUrl: String,
    val authTokenProvider: suspend () -> String? = { null },
    val registry: ConnectionRegistry? = null,
    private val httpClient: HttpClient = HttpClient(createDefaultHttpEngine()) {
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
        followRedirects = false
    },
) {
    val normalizedBaseUrl: String = baseUrl.trim().trimEnd('/')

    init {
        require(normalizedBaseUrl.isNotBlank()) { "baseUrl cannot be blank" }
    }

    suspend fun get(
        path: String,
        queryParams: Map<String, String> = emptyMap(),
        guard: RequestAdmissionGuard? = null,
    ): String {
        assertActiveOwner("GET $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("GET", "GET $path", fullUrl, guard) {
            httpClient.prepareGet(fullUrl) {
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                queryParams.forEach { (k, v) -> parameter(k, v) }
            }
        }

        return handleResponse(response, "GET", fullUrl)
    }

    suspend fun getBytesBounded(
        path: String,
        queryParams: Map<String, String> = emptyMap(),
        maxBytes: Long = 5_242_880L,
        guard: RequestAdmissionGuard? = null,
    ): ByteArray {
        assertActiveOwner("GET_BOUNDED $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        try {
            val statement = httpClient.prepareGet(fullUrl) {
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                queryParams.forEach { (k, v) -> parameter(k, v) }
            }
            admitRequest(guard, "GET_BOUNDED $path")
            return statement.execute { response ->
                assertActiveOwner("GET_BOUNDED $path execution")
                val status = response.status.value
                val channel = response.bodyAsChannel()
                if (!response.status.isSuccess()) {
                    val errorBuf = ByteArray(8192)
                    var errorRead = 0
                    while (!channel.isClosedForRead && errorRead < errorBuf.size) {
                        val read = channel.readAvailable(errorBuf, errorRead, errorBuf.size - errorRead)
                        if (read <= 0) break
                        errorRead += read
                    }
                    val responseText = errorBuf.decodeToString(0, errorRead)
                    assertActiveOwner("GET_BOUNDED $path error completion")
                    val retryAfterSeconds = response.headers[HttpHeaders.RetryAfter]?.toLongOrNull()
                    val parsedError = parseServerError(responseText)
                    val safeUrl = redactUrl(fullUrl)
                    val message = parsedError.message ?: "HTTP $status error for GET_BOUNDED $safeUrl"
                    throw ApiRequestError(
                        message = message,
                        status = status,
                        code = parsedError.code,
                        retryAfterSeconds = retryAfterSeconds,
                        details = parsedError.details,
                        rawBody = responseText,
                    )
                }

                val chunks = mutableListOf<ByteArray>()
                var totalBytes = 0L
                val buffer = ByteArray(8192)
                while (!channel.isClosedForRead) {
                    val read = channel.readAvailable(buffer, 0, buffer.size)
                    if (read <= 0) break
                    totalBytes += read
                    if (totalBytes > maxBytes) {
                        throw IllegalStateException("Response body exceeded bounded limit of $maxBytes bytes")
                    }
                    chunks.add(buffer.copyOf(read))
                }
                assertActiveOwner("GET_BOUNDED $path post-body completion")
                val result = ByteArray(totalBytes.toInt())
                var offset = 0
                for (c in chunks) {
                    c.copyInto(result, offset)
                    offset += c.size
                }
                result
            }
        } catch (e: Throwable) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            if (e is ConnectionOwnerError || e is ApiRequestError || e is IllegalStateException ||
                e is RequestNotSubmittedError
            ) {
                throw e
            }
            throw wrapNetworkError(e, "GET_BOUNDED", fullUrl)
        }
    }

    suspend fun postJson(path: String, body: String, guard: RequestAdmissionGuard? = null): String {
        assertActiveOwner("POST $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("POST", "POST $path", fullUrl, guard) {
            httpClient.preparePost(fullUrl) {
                contentType(ContentType.Application.Json)
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        }

        return handleResponse(response, "POST", fullUrl)
    }

    suspend fun postToml(path: String, body: String, guard: RequestAdmissionGuard? = null): String {
        assertActiveOwner("POST $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("POST", "POST $path", fullUrl, guard) {
            httpClient.preparePost(fullUrl) {
                contentType(ContentType.parse("application/toml; charset=utf-8"))
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        }

        return handleResponse(response, "POST", fullUrl)
    }

    suspend fun putJson(path: String, body: String, guard: RequestAdmissionGuard? = null): String {
        assertActiveOwner("PUT $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("PUT", "PUT $path", fullUrl, guard) {
            httpClient.preparePut(fullUrl) {
                contentType(ContentType.Application.Json)
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        }

        return handleResponse(response, "PUT", fullUrl)
    }

    suspend fun delete(
        path: String,
        queryParams: Map<String, String> = emptyMap(),
        guard: RequestAdmissionGuard? = null,
    ): String {
        assertActiveOwner("DELETE $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("DELETE", "DELETE $path", fullUrl, guard) {
            httpClient.prepareDelete(fullUrl) {
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                queryParams.forEach { (k, v) -> parameter(k, v) }
            }
        }

        return handleResponse(response, "DELETE", fullUrl)
    }

    suspend fun patchJson(path: String, body: String, guard: RequestAdmissionGuard? = null): String {
        assertActiveOwner("PATCH $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("PATCH", "PATCH $path", fullUrl, guard) {
            httpClient.preparePatch(fullUrl) {
                contentType(ContentType.Application.Json)
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        }

        return handleResponse(response, "PATCH", fullUrl)
    }

    suspend fun deleteJson(path: String, body: String, guard: RequestAdmissionGuard? = null): String {
        assertActiveOwner("DELETE $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = dispatch("DELETE", "DELETE $path", fullUrl, guard) {
            httpClient.prepareDelete(fullUrl) {
                contentType(ContentType.Application.Json)
                if (shouldAttachBearerToken(token, fullUrl)) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        }

        return handleResponse(response, "DELETE", fullUrl)
    }

    internal fun shouldAttachBearerToken(token: String?, fullUrl: String): Boolean {
        if (token.isNullOrBlank()) return false
        if (fullUrl.startsWith("https://", ignoreCase = true)) return true
        val host = try {
            io.ktor.http.Url(fullUrl).host
        } catch (_: Exception) {
            ""
        }
        return dev.damhopper.nativeapp.features.profiles.ServerProfile.isLoopbackHost(host)
    }

    companion object {
        fun encodePathSegment(segment: String): String = segment.encodeURLPathPart()
    }

    suspend fun health(): HealthResponse {
        val text = get("/api/health")
        return ProtocolJson.decodeFromString(HealthResponse.serializer(), text)
    }

    suspend fun authStatus(): AuthStatusResponse {
        val text = get("/api/auth/status")
        return ProtocolJson.decodeFromString(AuthStatusResponse.serializer(), text)
    }

    private suspend fun assertActiveOwner(op: String) {
        registry?.assertCurrentOwner(connection, op)
    }

    /**
     * Final local admission for one invocation, performed after credentials and suspending Ktor
     * preparation and immediately before the prepared request is executed.
     *
     * - Guarded (Settings mutations): only an invocation whose own `guard.admit(...)` returned `true`
     *   may execute; `false` (including reuse of an already ADMITTED guard) is a local NotSubmitted.
     * - Unguarded: final registry generation check, no receipt.
     *
     * Admission is permission-to-attempt, not proof of dispatch. After it returns, exactly one
     * `execute` happens with no retry, auth-refresh replay or redirect.
     */
    private suspend fun admitRequest(guard: RequestAdmissionGuard?, op: String) {
        if (guard == null) {
            assertActiveOwner("$op admission")
            return
        }
        val authorized = guard.admit(registry, connection)
        if (!authorized) {
            throw RequestNotSubmittedError("Request not submitted: local admission denied for $op")
        }
    }

    /**
     * Prepare (suspending, may consult Ktor), admit locally, then execute exactly once.
     * CancellationException propagates unchanged; it is never wrapped as a network error.
     */
    private suspend fun dispatch(
        method: String,
        op: String,
        fullUrl: String,
        guard: RequestAdmissionGuard?,
        prepare: suspend () -> HttpStatement,
    ): HttpResponse {
        val statement = try {
            prepare()
        } catch (e: Throwable) {
            throw wrapNetworkError(e, method, fullUrl)
        }
        admitRequest(guard, op)
        return try {
            statement.execute()
        } catch (e: Throwable) {
            throw wrapNetworkError(e, method, fullUrl)
        }
    }

    private suspend fun handleResponse(response: HttpResponse, method: String, url: String): String {
        assertActiveOwner("$method $url completion")

        val status = response.status.value
        val responseText = response.bodyAsText()
        assertActiveOwner("$method $url post-body completion")

        if (response.status.isSuccess()) {
            return responseText
        }

        val retryAfterSeconds = response.headers[HttpHeaders.RetryAfter]?.toLongOrNull()
        val parsedError = parseServerError(responseText)

        val safeUrl = redactUrl(url)
        val message = parsedError.message ?: "HTTP $status error for $method $safeUrl"

        throw ApiRequestError(
            message = message,
            status = status,
            code = parsedError.code,
            retryAfterSeconds = retryAfterSeconds,
            details = parsedError.details,
            rawBody = responseText,
        )
    }

    private fun parseServerError(body: String): ParsedError {
        if (body.isBlank()) return ParsedError(null, null, null)
        return try {
            val element = ProtocolJson.parseToJsonElement(body)
            if (element is JsonObject) {
                val code = element["code"]?.jsonPrimitive?.content
                val error = element["error"]?.jsonPrimitive?.content
                val msg = element["message"]?.jsonPrimitive?.content
                ParsedError(code = code, message = error ?: msg, details = null)
            } else {
                ParsedError(null, body.take(200), null)
            }
        } catch (_: Throwable) {
            ParsedError(null, body.take(200), null)
        }
    }

    private fun wrapNetworkError(e: Throwable, method: String, url: String): Throwable {
        if (e is kotlinx.coroutines.CancellationException) throw e
        val safeUrl = redactUrl(url)
        return when (e) {
            is ConnectionOwnerError -> e
            else -> ApiRequestError(
                message = "Network error during $method $safeUrl: ${e.message}",
                status = 0,
                cause = e,
            )
        }
    }

    private fun buildFullUrl(path: String): String {
        val cleanPath = if (path.startsWith("/")) path else "/$path"
        return "$normalizedBaseUrl$cleanPath"
    }

    private data class ParsedError(val code: String?, val message: String?, val details: String?)
}
