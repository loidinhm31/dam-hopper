package dev.damhopper.nativeapp.platform.network

import dev.damhopper.nativeapp.core.transport.AndroidHttpEngineConfig
import dev.damhopper.nativeapp.core.transport.createDefaultHttpEngine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class AndroidWsEnginePolicyTest {

    @Test
    fun testAndroidEngineConfigurationPolicy() {
        assertEquals(15L, AndroidHttpEngineConfig.PING_INTERVAL_SECONDS)
        assertEquals(15L, AndroidHttpEngineConfig.CONNECT_TIMEOUT_SECONDS)
        assertEquals(30L, AndroidHttpEngineConfig.WRITE_TIMEOUT_SECONDS)
    }

    @Test
    fun testCreateDefaultHttpEngineReturnsConfiguredEngine() {
        val engine = createDefaultHttpEngine()
        assertNotNull(engine)
    }
}
