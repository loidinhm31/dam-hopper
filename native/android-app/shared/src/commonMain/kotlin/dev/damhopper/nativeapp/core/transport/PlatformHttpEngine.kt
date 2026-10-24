package dev.damhopper.nativeapp.core.transport

import io.ktor.client.engine.HttpClientEngine

/**
 * Platform-specific factory for the default HttpClientEngine.
 * - JVM: Java 11+ HttpClient engine
 * - Android: OkHttp engine
 */
expect fun createDefaultHttpEngine(): HttpClientEngine
