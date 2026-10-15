package dev.damhopper.nativeapp.platform.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.websocket.WebSockets
import java.util.concurrent.TimeUnit

/**
 * Android platform HTTP engine and client factory.
 *
 * Configures the OkHttp engine to:
 * - Enforce Android's platform NetworkSecurityConfig (TLS-only in release; cleartext debug loopback isolated)
 * - Disable automatic cross-origin redirect following to prevent auth credential leakage
 * - Configure bounded timeouts and ping intervals for long-lived WebSocket sessions
 */
object AndroidHttpClientFactory {

    /**
     * Creates an OkHttp HttpClientEngine instance with pinned connection settings.
     */
    fun createEngine() = OkHttp.create {
        config {
            connectTimeout(15, TimeUnit.SECONDS)
            readTimeout(30, TimeUnit.SECONDS)
            writeTimeout(30, TimeUnit.SECONDS)
            followRedirects(false)
            followSslRedirects(false)
            retryOnConnectionFailure(true)
            pingInterval(15, TimeUnit.SECONDS)
        }
    }

    /**
     * Creates a fully configured Ktor HttpClient for Android runtime usage.
     */
    fun createClient(withWebSockets: Boolean = true): HttpClient = HttpClient(createEngine()) {
        if (withWebSockets) {
            install(WebSockets) {
                pingIntervalMillis = 15_000
            }
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
        followRedirects = false
    }
}
