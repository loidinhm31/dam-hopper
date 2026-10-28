package dev.damhopper.nativeapp.core.transport

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import java.util.concurrent.TimeUnit

/**
 * Shared Android HTTP and WebSocket engine policy.
 *
 * Explicitly configures OkHttp for:
 * - 15s RFC 6455 Ping keepalive (Ktor 3.1.0 OkHttp sessions rely on engine pingInterval).
 * - 15s TCP connect timeout and 30s socket write timeout.
 * - Disabled redirects to prevent cross-origin auth credential leakage.
 * - HTTP read timeout is NOT a WebSocket idle watchdog (WebSocketReader clears read timeout on idle).
 */
object AndroidHttpEngineConfig {
    const val PING_INTERVAL_SECONDS = 15L
    const val CONNECT_TIMEOUT_SECONDS = 15L
    const val WRITE_TIMEOUT_SECONDS = 30L
}

actual fun createDefaultHttpEngine(): HttpClientEngine = OkHttp.create {
    config {
        connectTimeout(AndroidHttpEngineConfig.CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        writeTimeout(AndroidHttpEngineConfig.WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        followRedirects(false)
        followSslRedirects(false)
        retryOnConnectionFailure(true)
        pingInterval(AndroidHttpEngineConfig.PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
    }
}
