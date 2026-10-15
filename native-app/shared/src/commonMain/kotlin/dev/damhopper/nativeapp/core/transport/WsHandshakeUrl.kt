package dev.damhopper.nativeapp.core.transport

import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.encodedPath

/**
 * Builds the origin-less WebSocket URL with optional bearer query token.
 * ws.rs admits origin-less clients only when token parameter is present.
 */
fun buildWsHandshakeUrl(baseUrl: String, token: String?): String {
    val builder = URLBuilder(baseUrl.trim().trimEnd('/'))
    builder.protocol = when (builder.protocol) {
        URLProtocol.HTTPS -> URLProtocol.WSS
        URLProtocol.HTTP -> URLProtocol.WS
        URLProtocol.WSS -> URLProtocol.WSS
        URLProtocol.WS -> URLProtocol.WS
        else -> URLProtocol.WSS
    }
    builder.encodedPath = "/ws"
    if (!token.isNullOrBlank()) {
        builder.parameters["token"] = token
    }
    return builder.buildString()
}
