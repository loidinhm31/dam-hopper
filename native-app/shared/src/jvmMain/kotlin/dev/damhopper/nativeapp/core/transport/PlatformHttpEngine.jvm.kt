package dev.damhopper.nativeapp.core.transport

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.java.Java

actual fun createDefaultHttpEngine(): HttpClientEngine = Java.create()
