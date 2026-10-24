package dev.damhopper.nativeapp.features.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class VtTerminalSurfaceTest {
    private fun VtTerminalSurface.feed(text: String, reset: Boolean = false) =
        feedOutput(text.encodeToByteArray(), 0, reset)

    @Test
    fun blinkAndCursorVisibilityKeepBlankLowerRowGeometryAndRevision() {
        val surface = VtTerminalSurface(8, 5)
        surface.feed("A\u001B[3;4H")
        val ids = surface.lineIds.toList()
        val revision = surface.updateRevision
        assertEquals(3, surface.lines.size)
        assertEquals("   █", surface.lines[2].text)
        repeat(3) {
            surface.updateCursorBlink(false)
            assertEquals("    ", surface.lines[2].text)
            assertEquals(ids, surface.lineIds)
            assertEquals(revision, surface.updateRevision)
            surface.updateCursorBlink(true)
            assertEquals("   █", surface.lines[2].text)
            assertEquals(3, surface.lines.size)
        }
        surface.feed("\u001B[?25l")
        assertEquals("    ", surface.lines[2].text)
        assertEquals(ids, surface.lineIds)
        assertEquals(revision, surface.updateRevision)
        surface.feed("\u001B[?25h")
        assertEquals("   █", surface.lines[2].text)
        assertEquals(ids, surface.lineIds)
        assertEquals(revision, surface.updateRevision)
    }

    @Test
    fun styledHistoryObjectsSurviveBlinkSingleRowMutationAndCursorMotion() {
        val surface = VtTerminalSurface(8, 3)
        surface.feed("\u001B[31mred\r\none\r\ntwo\r\nthree\u001B[0m")
        val history = surface.lines[0]
        val historyId = surface.lineIds[0]
        val historySpans = history.spanStyles
        val rowOne = surface.lines[1]
        repeat(5) {
            surface.updateCursorBlink(false)
            surface.updateCursorBlink(true)
            assertSame(history, surface.lines[0])
            assertSame(rowOne, surface.lines[1])
        }
        surface.feed("\u001B[2;1HX\u001B[1;1H")
        assertSame(history, surface.lines[0])
        assertEquals(historySpans, surface.lines[0].spanStyles)
        assertEquals(historyId, surface.lineIds[0])
        assertEquals("Xwo", surface.engine.activeGrid.getRowText(1))
        assertEquals(surface.lines.size, surface.lineIds.size)
        assertEquals(surface.lineIds.size, surface.lineIds.toSet().size)
        surface.feed("\u001B[2K")
        assertEquals("", surface.engine.activeGrid.getRowText(0))
        assertSame(history, surface.lines[0])
    }

    @Test
    fun rowIdentityFollowsScrollButNeverAliasesResetAlternateOrAnotherSurface() {
        val surface = VtTerminalSurface(8, 2)
        surface.feed("same\r\nsame")
        val original = surface.lineIds.toList()
        assertNotEquals(original[0], original[1])
        surface.feed("\r\nthird")
        assertEquals(original, surface.lineIds.take(2))
        val main = surface.lineIds.toList()
        surface.feed("\u001B[?1049hALT")
        val alt = surface.lineIds.toList()
        assertTrue(alt.none { it in main })
        surface.feed("\u001B[?1049l")
        assertEquals(main, surface.lineIds)
        surface.feed("reset", reset = true)
        assertTrue(surface.lineIds.none { it in main || it in alt })
        val other = VtTerminalSurface(8, 2)
        other.feed("other")
        assertTrue(other.lineIds.none { it in surface.lineIds })
        surface.close()
        assertTrue(surface.lines.isEmpty())
        assertTrue(surface.lineIds.isEmpty())
    }

    @Test
    fun dimensionsClampConsistentlyAndSameSizeResizeDoesNotPublish() {
        val surface = VtTerminalSurface(0, -3)
        assertEquals(1, surface.dimensions.cols)
        assertEquals(1, surface.engine.activeGrid.rows)
        surface.feed("A")
        val revision = surface.updateRevision
        val ids = surface.lineIds.toList()
        surface.resize(-2, 0)
        assertEquals(revision, surface.updateRevision)
        assertEquals(ids, surface.lineIds)
        surface.resize(4, 2)
        assertEquals(4, surface.dimensions.cols)
        assertEquals(2, surface.engine.activeGrid.rows)
        assertTrue(surface.updateRevision > revision)
        val resizedIds = surface.lineIds.toList()
        surface.resize(4, 2)
        assertEquals(resizedIds, surface.lineIds)
        surface.clearDisplayBuffer()
        assertFalse(surface.lines.any { it.text.contains("A") })
        assertEquals(surface.lines.size, surface.lineIds.size)
    }

    @Test
    fun shiftedRowsKeepTheirCachesAndMutationsDoNotLeaveStaleStyledText() {
        val surface = VtTerminalSurface(8, 4)
        surface.feed("\u001B[32mone\r\ntwo\r\nthree\u001B[0m\u001B[4;1H")
        surface.updateCursorBlink(false)
        val one = surface.lines[0]
        val two = surface.lines[1]
        val ids = surface.lineIds.toList()
        surface.feed("\u001B[2;1H\u001B[L")
        assertSame(one, surface.lines[0])
        assertSame(two, surface.lines[2])
        assertEquals(ids[1], surface.lineIds[2])
        surface.feed("\u001B[M")
        assertSame(two, surface.lines[1])
        surface.feed("\u001B[2;2H\u001B[P")
        assertEquals("to", surface.engine.activeGrid.getRowText(1))
        assertTrue(surface.lines[1].spanStyles.any { it.item.color == VtTerminalEngine.COLOR_GREEN })
        surface.feed("\u001B[2J")
        assertFalse(surface.lines.any { it.text.contains("one") || it.text.contains("to") })
    }
}
