package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.lifecycle.LifecycleAware
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.security.CryptoEnvelope
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.HostResourceSseClient
import dev.damhopper.nativeapp.core.transport.HostResourceSseFrame
import dev.damhopper.nativeapp.features.host.HostResourceController
import dev.damhopper.nativeapp.features.host.ResourceSourceMode
import dev.damhopper.nativeapp.features.host.ResourceStreamCoordinator
import dev.damhopper.nativeapp.features.host.UsageBoundsHelper
import dev.damhopper.nativeapp.features.terminal.ReconcileOutputResult
import dev.damhopper.nativeapp.features.terminal.TerminalReplayGate
import dev.damhopper.nativeapp.features.terminal.reconcileTerminalOutput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase 18 Core Integrated Qualification Test Suite:
 * Proves invariant enforcement for ownership fencing, stream replay ordering,
 * UTF-8 chunk reconciliation, crypto fail-closed tamper rejection, and lifecycle coordination.
 */
class OwnershipAndReplayTests {

    @Test
    fun testMultiServerProfileIsolationAndWatermarkRejection() = runTest {
        val registry = ConnectionRegistry()

        val connA1 = registry.getOrCreateConnection("profile-alpha")
        val connB1 = registry.getOrCreateConnection("profile-beta")

        assertEquals("profile-alpha", connA1.profileId)
        assertEquals(1L, connA1.generation)
        assertEquals("profile-beta", connB1.profileId)
        assertEquals(1L, connB1.generation)

        assertTrue(registry.isCurrentOwner(connA1))
        assertTrue(registry.isCurrentOwner(connB1))

        // Retiring profile Alpha increments generation to 2; Beta remains 1
        val connA2 = registry.retireConnection(connA1)
        assertEquals(2L, connA2.generation)

        assertFalse(registry.isCurrentOwner(connA1), "Stale generation 1 of profile Alpha must be rejected")
        assertTrue(registry.isCurrentOwner(connA2), "Active generation 2 of profile Alpha must be valid")
        assertTrue(registry.isCurrentOwner(connB1), "Profile Beta must remain unaffected at generation 1")

        // Asserting stale owner must fail with ConnectionErrorReason.STALE
        val err = assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(connA1, "test-stale-alpha-write")
        }
        assertEquals(ConnectionErrorReason.STALE, err.reason)

        // Valid owner assertions pass cleanly
        registry.assertCurrentOwner(connA2, "test-active-alpha-write")
        registry.assertCurrentOwner(connB1, "test-active-beta-write")
    }

    @Test
    fun testTerminalReplayGateUtf8SplittingAcrossChunkBoundaries() {
        // Multi-byte UTF-8 test string: "Terminal 🦀 UTF-8"
        // '🦀' codepoint U+1F980 is encoded as 4 bytes: 0xF0, 0x9F, 0xA6, 0x80
        val fullString = "Terminal 🦀 UTF-8"
        val fullBytes = fullString.encodeToByteArray()

        // Locate index of crab emoji
        val prefix = "Terminal ".encodeToByteArray()
        val splitIndex = prefix.size + 2 // Split right in the middle of the 4-byte sequence

        val chunk1 = fullBytes.copyOfRange(0, splitIndex)
        val chunk2 = fullBytes.copyOfRange(splitIndex, fullBytes.size)

        // 1. First chunk [0 .. splitIndex)
        val res1 = reconcileTerminalOutput(chunk1, splitIndex.toULong(), 0uL)
        assertTrue(res1 is ReconcileOutputResult.Render)
        assertEquals(splitIndex.toULong(), res1.nextOffset)

        // 2. Second chunk [splitIndex .. fullBytes.size)
        val res2 = reconcileTerminalOutput(chunk2, fullBytes.size.toULong(), splitIndex.toULong())
        assertTrue(res2 is ReconcileOutputResult.Render)
        assertEquals(fullBytes.size.toULong(), res2.nextOffset)

        // Joining the two rendered byte slices must produce the exact original string
        val joined = res1.data + res2.data
        assertEquals(fullString, joined.decodeToString())
    }

    @Test
    fun testTerminalReplayGateOrderingDuplicateAndOverlapSlicing() {
        val testData = "0123456789ABCDEF".encodeToByteArray() // 16 bytes

        // Chunk 1: bytes 0..8 (start 0, end 8)
        val chunk1 = testData.copyOfRange(0, 8)
        val res1 = reconcileTerminalOutput(chunk1, 8uL, 0uL)
        assertTrue(res1 is ReconcileOutputResult.Render)
        assertEquals(8uL, res1.nextOffset)
        assertEquals("01234567", res1.data.decodeToString())

        // Duplicate delivery of chunk 1: endOffset 8 <= currentOffset 8 -> Discard
        val resDup = reconcileTerminalOutput(chunk1, 8uL, 8uL)
        assertTrue(resDup is ReconcileOutputResult.Discard)
        assertEquals(8uL, resDup.nextOffset)

        // Overlapping chunk 2: bytes 4..16 (end 16, start 4, currentOffset 8)
        // Must slice first 4 overlapping bytes and render "89ABCDEF"
        val chunk2 = testData.copyOfRange(4, 16)
        val res2 = reconcileTerminalOutput(chunk2, 16uL, 8uL)
        assertTrue(res2 is ReconcileOutputResult.Render)
        assertEquals(16uL, res2.nextOffset)
        assertEquals("89ABCDEF", res2.data.decodeToString())

        // Out-of-order gap detection: receiving chunk at offset 24 when currentOffset is 16
        val gapChunk = "XYZ".encodeToByteArray()
        val resGap = reconcileTerminalOutput(gapChunk, 27uL, 16uL)
        assertTrue(resGap is ReconcileOutputResult.Gap)
        assertEquals(16uL, resGap.expectedOffset)
        assertEquals(24uL, resGap.receivedStartOffset)
    }

    @Test
    fun testResourceStreamCoordinatorCleanEofHandling() = runTest {
        val conn = ConnectionRef(profileId = "test-prof", generation = 1L)
        val mockSseClient = object : HostResourceSseClient(conn, "http://127.0.0.1:4801") {
            override fun openEventStream(
                onByteProgress: (bytesReceived: Long) -> Unit,
            ): Flow<HostResourceSseFrame> = emptyFlow() // Simulates immediate clean EOF
        }

        val coordinator = ResourceStreamCoordinator(
            owner = conn,
            sseClient = mockSseClient,
            coroutineScope = this
        )

        // Register interest to trigger streaming lifecycle
        val unreg = coordinator.registerInterest(dev.damhopper.nativeapp.features.host.ResourceConsumerKind.FLEET)
        testScheduler.advanceUntilIdle()

        // Clean EOF must trigger retry wait or error mode, NEVER hang indefinitely in LIVE
        val mode = coordinator.state.value.mode
        assertTrue(
            mode == ResourceSourceMode.RETRY_WAIT || mode == ResourceSourceMode.REST_ONLY || mode == ResourceSourceMode.STOPPED,
            "Clean EOF must transition away from LIVE/STARTING, actual mode: $mode"
        )
        unreg()
        coordinator.dispose()
    }

    @Test
    fun testHostResourceRestFallbackIntervalAlignedToFiveSeconds() {
        assertEquals(
            5_000L,
            HostResourceController.REST_FALLBACK_INTERVAL_MS,
            "REST fallback interval must be 5,000ms per architecture and acceptance ledger"
        )
    }

    @Test
    fun testUsageBoundsHelperUtcIntervalCalculationsAndFormatting() {
        val nowMs = 1776435600000L // 2026-04-17T14:20:00Z
        val (fromUtc, todayUtc) = UsageBoundsHelper.calculateUtcDayRange(nowMs, 7L)

        // todayUtc must be floored to midnight UTC
        assertEquals(0L, todayUtc % UsageBoundsHelper.DAY_MS)
        assertEquals(7L * UsageBoundsHelper.DAY_MS, todayUtc - fromUtc)

        val formattedFrom = UsageBoundsHelper.formatUtcDate(fromUtc)
        val formattedTo = UsageBoundsHelper.formatUtcDate(todayUtc)

        assertTrue(formattedFrom.endsWith(" UTC"))
        assertTrue(formattedTo.endsWith(" UTC"))
        assertTrue(formattedFrom.length >= 14) // "YYYY-MM-DD UTC"
    }

    @Test
    fun testCryptoEnvelopeTamperRejectionFailsClosed() {
        val key = ByteArray(32) { (it + 5).toByte() }
        val metadata = """{"type":"test","safe":true}"""
        val payload = "Confidential telemetry and workspace state".encodeToByteArray()

        val validEnvelope = CryptoEnvelope.encrypt(key, metadata, payload)
        assertTrue(validEnvelope.size > 28)

        // 1. Roundtrip with authentic envelope passes
        val (decMeta, decPayload) = CryptoEnvelope.decrypt(key, validEnvelope)
        assertEquals(metadata, decMeta)
        assertEquals("Confidential telemetry and workspace state", decPayload.decodeToString())

        // 2. Tampered IV fails closed
        val tamperedIv = validEnvelope.copyOf()
        tamperedIv[0] = (tamperedIv[0] + 1).toByte()
        assertFailsWith<Exception>("Tampered IV must fail decryption") {
            CryptoEnvelope.decrypt(key, tamperedIv)
        }

        // 3. Tampered Ciphertext fails closed
        val tamperedCiphertext = validEnvelope.copyOf()
        val mid = validEnvelope.size / 2
        tamperedCiphertext[mid] = (tamperedCiphertext[mid] + 1).toByte()
        assertFailsWith<Exception>("Tampered ciphertext must fail decryption") {
            CryptoEnvelope.decrypt(key, tamperedCiphertext)
        }

        // 4. Tampered Auth Tag fails closed
        val tamperedTag = validEnvelope.copyOf()
        tamperedTag[tamperedTag.size - 1] = (tamperedTag[tamperedTag.size - 1] + 1).toByte()
        assertFailsWith<Exception>("Tampered auth tag must fail decryption") {
            CryptoEnvelope.decrypt(key, tamperedTag)
        }

        // 5. Truncated envelope fails closed
        val truncated = validEnvelope.copyOfRange(0, 15) // Shorter than IV + TAG
        assertFailsWith<dev.damhopper.nativeapp.core.security.CryptoEnvelopeException>("Truncated envelope must fail bounds check") {
            CryptoEnvelope.decrypt(key, truncated)
        }
    }

    @Test
    fun testLifecycleCoordinatorStateTransitionsAndRetirement() {
        val coordinator = LifecycleCoordinator()

        var fgCount = 0
        var bgCount = 0
        var retiredProfile: String? = null
        var destroyed = false

        val listener = object : LifecycleAware {
            override fun onForeground() { fgCount++ }
            override fun onBackground() { bgCount++ }
            override fun onOwnerRetired(profileId: String) { retiredProfile = profileId }
            override fun onDestroy() { destroyed = true }
        }

        coordinator.register(listener)

        // Transitions
        coordinator.onAppForeground()
        assertEquals(1, fgCount)

        coordinator.onAppBackground()
        assertEquals(1, bgCount)

        coordinator.onAppForeground()
        assertEquals(2, fgCount)

        // Owner retirement isolation
        coordinator.onProfileRetired("prod-target-1")
        assertEquals("prod-target-1", retiredProfile)

        coordinator.onDestroy()
        assertTrue(destroyed)

        coordinator.unregister(listener)
    }
}
