package dev.damhopper.nativeapp.platform.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AndroidTerminalSurfaceTest {

    @Test
    fun testCandidateAdapterMetadata() {
        val candidate = CandidateTerminalAdapter()
        assertEquals("ConnectBot termlib", candidate.name)
        assertEquals("0.3.13", candidate.version)
        assertEquals("libvterm.so", candidate.jniLibrary)
        assertTrue(candidate.license.contains("Apache-2.0"))
        assertTrue(candidate.license.contains("MIT"))
        assertTrue(candidate.abiSupport.contains("arm64-v8a"))
        assertTrue(candidate.abiSupport.contains("x86_64"))
        assertTrue(candidate.is16KiBPageAlignedTarget)
    }

    @Test
    fun testBufferOutputAndResize() {
        val surface = AndroidTerminalSurface(80, 24)
        var resizedCols = 0
        var resizedRows = 0
        surface.setOnResizeListener { cols, rows ->
            resizedCols = cols
            resizedRows = rows
        }

        surface.feedOutput("Hello DamHopper\n".toByteArray(StandardCharsets.UTF_8), 0L)
        assertEquals("Hello DamHopper\n", surface.getBufferedOutputString())

        surface.resize(120, 40)
        assertEquals(120, surface.dimensions.cols)
        assertEquals(40, surface.dimensions.rows)
        assertEquals(120, resizedCols)
        assertEquals(40, resizedRows)

        // Reset buffer
        surface.feedOutput("New Screen".toByteArray(StandardCharsets.UTF_8), 0L, reset = true)
        assertEquals("New Screen", surface.getBufferedOutputString())

        surface.close()
        assertTrue(surface.isDisposed)
    }

    @Test
    fun testSearchAndSelection() {
        val surface = AndroidTerminalSurface()
        surface.feedOutput("dam-hopper android client terminal dam-hopper".toByteArray(StandardCharsets.UTF_8), 0L)

        val result = surface.search("dam-hopper", matchCase = false)
        assertEquals("dam-hopper", result.query)
        assertEquals(2, result.totalMatches)

        surface.setSelectedTextForTest("selected command")
        assertEquals("selected command", surface.getSelectedText())
        assertEquals("selected command", surface.copySelection())

        surface.clearSearch()
        surface.close()
    }

    @Test
    fun testTerminalSessionControllerInputIsolation() {
        val connRef = ConnectionRef("srv-1", 1L)
        val surface = AndroidTerminalSurface()
        val controller = TerminalSessionController("sess-1", 1L, connRef, surface)

        var dispatchedInput: String? = null
        controller.setRawInputSink { bytes ->
            dispatchedInput = String(bytes, StandardCharsets.UTF_8)
        }

        // 1. Initial state: panel is inactive, replay not completed -> input is DROPPED
        surface.dispatchInput("ls -la\n".toByteArray(StandardCharsets.UTF_8))
        assertNull(dispatchedInput, "Input must not be forwarded when panel is inactive")

        // 2. Panel active, but replay still pending -> input is DROPPED
        controller.isPanelActive = true
        surface.dispatchInput("ls -la\n".toByteArray(StandardCharsets.UTF_8))
        assertNull(dispatchedInput, "Input must not be forwarded while replay is pending")

        // 3. Panel active AND replay completed -> input is FORWARDED
        controller.markReplayCompleted()
        surface.dispatchInput("ls -la\n".toByteArray(StandardCharsets.UTF_8))
        assertEquals("ls -la\n", dispatchedInput)

        // 4. Panel goes hidden (user switches to another tab) -> input is DROPPED again
        controller.isPanelActive = false
        dispatchedInput = null
        surface.dispatchInput("pwd\n".toByteArray(StandardCharsets.UTF_8))
        assertNull(dispatchedInput, "Input must be dropped when panel becomes inactive")

        controller.close()
        assertTrue(surface.isDisposed)
    }

    @Test
    fun testModifierKeyEncoding() {
        val connRef = ConnectionRef("srv-1", 1L)
        val controller = TerminalSessionController("sess-1", 1L, connRef)

        // Standard character
        val normalA = controller.encodeKey('a')
        assertEquals("a", String(normalA, StandardCharsets.UTF_8))

        // Ctrl+C (ASCII 0x03)
        controller.toggleModifier(TerminalModifier.CTRL)
        val ctrlC = controller.encodeKey('c')
        assertEquals(1, ctrlC.size)
        assertEquals(0x03.toByte(), ctrlC[0])
        assertFalse(controller.isModifierActive(TerminalModifier.CTRL), "Modifier must be consumed")

        // Alt+X (ESC + 'x')
        controller.toggleModifier(TerminalModifier.ALT)
        val altX = controller.encodeKey('x')
        assertEquals(2, altX.size)
        assertEquals(0x1B.toByte(), altX[0])
        assertEquals('x'.code.toByte(), altX[1])

        // Special keys
        val arrowUp = controller.encodeSpecialKey("UP")
        assertEquals("\u001b[A", String(arrowUp, StandardCharsets.UTF_8))

        val enter = controller.encodeSpecialKey("ENTER")
        assertEquals("\r", String(enter, StandardCharsets.UTF_8))

        controller.close()
    }

    @Test
    fun testOffsetTracking() {
        val connRef = ConnectionRef("srv-1", 1L)
        val controller = TerminalSessionController("sess-1", 1L, connRef)

        controller.handleOutputChunk("Chunk 1".toByteArray(StandardCharsets.UTF_8), 0L)
        assertEquals(7uL, controller.lastSeenOffset)

        controller.handleOutputChunk("Chunk 2".toByteArray(StandardCharsets.UTF_8), 7L)
        assertEquals(14uL, controller.lastSeenOffset)

        controller.close()
    }
}
