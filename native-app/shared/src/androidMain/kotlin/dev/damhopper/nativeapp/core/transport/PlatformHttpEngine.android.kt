package dev.damhopper.nativeapp.core.transport

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp

actual fun createDefaultHttpEngine(): HttpClientEngine = OkHttp.create {
    config {
        followRedirects(false)
        followSslRedirects(false)
        retryOnConnectionFailure(true)
    }
}
