package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Type-safe HTTP API client scoped to a single ConnectionRef.
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

    suspend fun get(path: String, queryParams: Map<String, String> = emptyMap()): String {
        assertActiveOwner("GET $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = try {
            httpClient.get(fullUrl) {
                if (!token.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                queryParams.forEach { (k, v) -> parameter(k, v) }
            }
        } catch (e: Throwable) {
            throw wrapNetworkError(e, "GET", fullUrl)
        }

        return handleResponse(response, "GET", fullUrl)
    }

    suspend fun postJson(path: String, body: String): String {
        assertActiveOwner("POST $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = try {
            httpClient.post(fullUrl) {
                contentType(ContentType.Application.Json)
                if (!token.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        } catch (e: Throwable) {
            throw wrapNetworkError(e, "POST", fullUrl)
        }

        return handleResponse(response, "POST", fullUrl)
    }

    suspend fun putJson(path: String, body: String): String {
        assertActiveOwner("PUT $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = try {
            httpClient.put(fullUrl) {
                contentType(ContentType.Application.Json)
                if (!token.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                setBody(body)
            }
        } catch (e: Throwable) {
            throw wrapNetworkError(e, "PUT", fullUrl)
        }

        return handleResponse(response, "PUT", fullUrl)
    }

    suspend fun delete(path: String, queryParams: Map<String, String> = emptyMap()): String {
        assertActiveOwner("DELETE $path")
        val fullUrl = buildFullUrl(path)
        val token = authTokenProvider()

        val response = try {
            httpClient.delete(fullUrl) {
                if (!token.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                queryParams.forEach { (k, v) -> parameter(k, v) }
            }
        } catch (e: Throwable) {
            throw wrapNetworkError(e, "DELETE", fullUrl)
        }

        return handleResponse(response, "DELETE", fullUrl)
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
