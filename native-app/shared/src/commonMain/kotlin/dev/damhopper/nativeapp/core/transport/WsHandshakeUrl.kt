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
    val isSecure = when (builder.protocol) {
        URLProtocol.HTTPS, URLProtocol.WSS -> true
        else -> false
    }
    builder.protocol = if (isSecure) URLProtocol.WSS else URLProtocol.WS
    builder.encodedPath = "/ws"
    val host = builder.host
    val allowToken = isSecure || dev.damhopper.nativeapp.features.profiles.ServerProfile.isLoopbackHost(host)
    if (allowToken && !token.isNullOrBlank()) {
        builder.parameters["token"] = token
    } else {
        builder.parameters.remove("token")
    }
    return builder.buildString()
}
