package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.features.host.DeleteUsageRequest
import dev.damhopper.nativeapp.features.host.ResourceConsumerKind
import dev.damhopper.nativeapp.features.host.ResourceSourceMode
import dev.damhopper.nativeapp.features.host.ResourcesSubProduct
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostResourcesPhase15Test {

    @Test
    fun testResourcesPanelRegisteredInAuthoritativeRegistry() {
        val descriptor = PanelRegistry.get(WorkbenchPanel.RESOURCES)
        assertEquals("Resources", descriptor.label)
        assertEquals("RES", descriptor.shortCode)
    }

    @Test
    fun testZeroFloatingActionButtonsInHostFeaturesUi() {
        val hostDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host")
        assertTrue(hostDir.exists(), "Host features directory must exist")

        val ktFiles = hostDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV01 invariant: zero FABs permitted in host resources panel"
            )
        }
    }

    @Test
    fun testZeroWebViewOrBrowserEngineInHostFeaturesUi() {
        val hostDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host")
        val ktFiles = hostDir.walk().filter { it.extension == "kt" }.toList()

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("android.webkit.WebView") || text.contains("WebKit"),
                "File ${file.name} violates B01/B02 invariant: zero WebView or browser engine permitted"
            )
        }
    }

    @Test
    fun testResourceSourceModesCompleteness() {
        val expected = setOf(
            ResourceSourceMode.STOPPED,
            ResourceSourceMode.STARTING,
            ResourceSourceMode.LIVE,
            ResourceSourceMode.RETRY_WAIT,
            ResourceSourceMode.REST_ONLY,
            ResourceSourceMode.AUTH_BLOCKED,
            ResourceSourceMode.PAUSED,
        )
        assertEquals(expected, ResourceSourceMode.entries.toSet())
    }

    @Test
    fun testResourceConsumerKindsCompleteness() {
        val expected = setOf(
            ResourceConsumerKind.FLEET,
            ResourceConsumerKind.DETAIL_SNAPSHOT,
            ResourceConsumerKind.DETAIL_METRICS,
        )
        assertEquals(expected, ResourceConsumerKind.entries.toSet())
    }

    @Test
    fun testResourcesSubProducts() {
        val entries = ResourcesSubProduct.entries
        assertEquals(1, entries.size)
        assertEquals("Host Resources", ResourcesSubProduct.FLEET.label)
    }

    @Test
    fun testDeleteUsageConfirmationDefault() {
        val req = DeleteUsageRequest()
        assertEquals("delete-usage-data", req.confirmation)
    }
}
