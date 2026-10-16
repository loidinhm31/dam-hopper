package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.features.host.*
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PortsAndHostControlsPhase16Test {

    @Test
    fun testPortsAndSshHostPanelsRegisteredInAuthoritativeRegistry() {
        val portsDesc = PanelRegistry.get(WorkbenchPanel.PORTS)
        assertEquals("Ports", portsDesc.label)
        assertEquals("PORT", portsDesc.shortCode)

        val hostDesc = PanelRegistry.get(WorkbenchPanel.SSH_HOST)
        assertEquals("Host Controls", hostDesc.label)
        assertEquals("HOST", hostDesc.shortCode)
    }

    @Test
    fun testZeroFloatingActionButtonsInPortsAndHostUi() {
        val hostDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host")
        assertTrue(hostDir.exists(), "Host features directory must exist")

        val ktFiles = hostDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV01 invariant: zero FABs permitted in ports and host panels"
            )
        }
    }

    @Test
    fun testZeroWebViewOrBrowserEngineInPortsAndHostUi() {
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
    fun testSensitiveFieldsRedactedInToString() {
        val consentReq = ConsentDecisionRequest(
            requestId = "req-1",
            requestRevision = 1,
            connectionId = "conn-1",
            decisionCapability = "sensitive-signing-token-12345",
            decision = SleepConsentDecision.APPROVE
        )
        val consentStr = consentReq.toString()
        assertTrue(consentStr.contains("[REDACTED]"))
        assertFalse(consentStr.contains("sensitive-signing-token-12345"))

        val loadKeyReq = LoadKeyBody(
            keyPath = "id_ed25519",
            passphrase = "my-secret-ssh-passphrase",
            saveForLater = true
        )
        val loadKeyStr = loadKeyReq.toString()
        assertTrue(loadKeyStr.contains("[REDACTED]"))
        assertFalse(loadKeyStr.contains("my-secret-ssh-passphrase"))

        val approveIntentReq = ApproveIntentRequest(
            challengeNonce = "nonce-1",
            username = "admin",
            password = "super-secret-password"
        )
        val approveStr = approveIntentReq.toString()
        assertTrue(approveStr.contains("[REDACTED]"))
        assertFalse(approveStr.contains("super-secret-password"))

        val execReq = ExecutionRequest(
            intentId = "intent-1",
            approvalToken = "one-time-approval-token-xyz"
        )
        val execStr = execReq.toString()
        assertTrue(execStr.contains("[REDACTED]"))
        assertFalse(execStr.contains("one-time-approval-token-xyz"))
    }

    @Test
    fun testHostControlEnumsCompleteness() {
        val expectedTunnelStatus = setOf(
            TunnelStatus.STARTING,
            TunnelStatus.READY,
            TunnelStatus.FAILED,
            TunnelStatus.STOPPED
        )
        assertEquals(expectedTunnelStatus, TunnelStatus.entries.toSet())

        val expectedPortState = setOf(
            PortState.PROVISIONAL,
            PortState.LISTENING,
            PortState.LOST
        )
        assertEquals(expectedPortState, PortState.entries.toSet())

        val expectedIdleStates = setOf(
            IdleSuspendState.DISABLED,
            IdleSuspendState.WATCHING,
            IdleSuspendState.ARMED,
            IdleSuspendState.FINAL_CHECK,
            IdleSuspendState.HANDED_OFF,
            IdleSuspendState.SUPPRESSED,
            IdleSuspendState.FAILED,
            IdleSuspendState.RESUMED
        )
        assertEquals(expectedIdleStates, IdleSuspendState.entries.toSet())

        val expectedPolicies = setOf(
            AutomaticPolicy.EMPTY_FLEET,
            AutomaticPolicy.AGENT_ACTIVITY,
            AutomaticPolicy.AGENT_FREE
        )
        assertEquals(expectedPolicies, AutomaticPolicy.entries.toSet())

        val expectedConsentStates = setOf(
            SleepConsentState.PENDING,
            SleepConsentState.APPROVED,
            SleepConsentState.DENIED,
            SleepConsentState.EXPIRED,
            SleepConsentState.CANCELLED
        )
        assertEquals(expectedConsentStates, SleepConsentState.entries.toSet())
    }
}
