package dev.damhopper.nativeapp.platform.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AndroidNetworkMonitorTest {

    @Test
    fun testMonitorIdempotentClose() {
        // Mock application context with null connectivity manager for headless unit test
        val mockContext = object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): Context = this
            override fun getSystemService(name: String): Any? = null
        }

        var availableCount = 0
        var lostCount = 0
        val monitor = AndroidNetworkMonitor(
            context = mockContext,
            onNetworkAvailable = { availableCount++ },
            onNetworkLost = { lostCount++ },
        )

        // Close should be safe and idempotent even without system service
        monitor.close()
        monitor.close()

        assertEquals(0, availableCount)
        assertEquals(0, lostCount)
    }
}
