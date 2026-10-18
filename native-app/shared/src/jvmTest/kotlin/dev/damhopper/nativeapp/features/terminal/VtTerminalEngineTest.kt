package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VtTerminalEngineTest {

    @Test
    fun testBasicTextWritingAndCursorAdvance() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        engine.feedBytes("Hello World".encodeToByteArray(), isLiveStream = true)

        assertEquals("Hello World", engine.activeGrid.getRowText(0))
        assertEquals(0, engine.activeGrid.cursorRow)
        assertEquals(11, engine.activeGrid.cursorCol)
    }

    @Test
    fun testCursorPositioning() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        // Move to row 5, col 10 (1-indexed: \e[5;10H)
        engine.feedBytes("\u001B[5;10HTest".encodeToByteArray(), isLiveStream = true)

        assertEquals(4, engine.activeGrid.cursorRow)
        assertEquals(13, engine.activeGrid.cursorCol)
        assertEquals("Test", engine.activeGrid.getRowText(4).trim())
    }

    @Test
    fun testCursorRelativeMovement() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        engine.feedBytes("\u001B[3;3H".encodeToByteArray(), isLiveStream = true)
        assertEquals(2, engine.activeGrid.cursorRow)
        assertEquals(2, engine.activeGrid.cursorCol)

        // Move down 2 (\e[2B), right 4 (\e[4C)
        engine.feedBytes("\u001B[2B\u001B[4C".encodeToByteArray(), isLiveStream = true)
        assertEquals(4, engine.activeGrid.cursorRow)
        assertEquals(6, engine.activeGrid.cursorCol)

        // Move up 1 (\e[1A), left 3 (\e[3D)
        engine.feedBytes("\u001B[1A\u001B[3D".encodeToByteArray(), isLiveStream = true)
        assertEquals(3, engine.activeGrid.cursorRow)
        assertEquals(3, engine.activeGrid.cursorCol)
    }

    @Test
    fun testEraseInLine() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        engine.feedBytes("ABCDEFGHIJ".encodeToByteArray(), isLiveStream = true)
        assertEquals("ABCDEFGHIJ", engine.activeGrid.getRowText(0))

        // Move cursor to col 5 (index 4) and erase to end of line (\e[K or \e[0K)
        engine.feedBytes("\u001B[1;5H\u001B[K".encodeToByteArray(), isLiveStream = true)
        assertEquals("ABCD", engine.activeGrid.getRowText(0))

        // Reset and test erase entire line (\e[2K)
        engine.feedBytes("\u001B[1;1HABCDEFGHIJ\u001B[2K".encodeToByteArray(), isLiveStream = true)
        assertEquals("", engine.activeGrid.getRowText(0))
    }

    @Test
    fun testEraseInDisplay() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 5)
        engine.feedBytes("Line1\r\nLine2\r\nLine3\r\nLine4".encodeToByteArray(), isLiveStream = true)
        assertEquals("Line1", engine.activeGrid.getRowText(0))
        assertEquals("Line2", engine.activeGrid.getRowText(1))

        // Erase entire display (\e[2J)
        engine.feedBytes("\u001B[2J".encodeToByteArray(), isLiveStream = true)
        assertEquals("", engine.activeGrid.getRowText(0))
        assertEquals("", engine.activeGrid.getRowText(1))
        assertEquals("", engine.activeGrid.getRowText(2))
    }

    @Test
    fun testAlternateScreenBufferSwitching() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 5)
        engine.feedBytes("Main Content".encodeToByteArray(), isLiveStream = true)
        assertEquals("Main Content", engine.activeGrid.getRowText(0))
        assertFalse(engine.isAltScreen)

        // Switch to alternate screen (\e[?1049h) - used by omp, vim, htop
        engine.feedBytes("\u001B[?1049h".encodeToByteArray(), isLiveStream = true)
        assertTrue(engine.isAltScreen)
        assertEquals("", engine.activeGrid.getRowText(0)) // fresh scratchpad

        engine.feedBytes("OMP Interactive TUI".encodeToByteArray(), isLiveStream = true)
        assertEquals("OMP Interactive TUI", engine.activeGrid.getRowText(0))

        // Switch back to main screen (\e[?1049l)
        engine.feedBytes("\u001B[?1049l".encodeToByteArray(), isLiveStream = true)
        assertFalse(engine.isAltScreen)
        assertEquals("Main Content", engine.activeGrid.getRowText(0)) // restored!
    }

    @Test
    fun testCursorPositionReportEmitsOnlyInLiveStream() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        var capturedReply: String? = null
        engine.onProtocolReply = { reply ->
            capturedReply = reply.decodeToString()
        }

        // Move to row 4, col 7 (1-indexed: 4, 7)
        engine.feedBytes("\u001B[4;7H".encodeToByteArray(), isLiveStream = true)

        // 1. Query CPR in replay stream (isLiveStream = false): MUST NOT emit response
        engine.feedBytes("\u001B[6n".encodeToByteArray(), isLiveStream = false)
        assertNull(capturedReply)

        // 2. Query CPR in live stream (isLiveStream = true): MUST emit \e[4;7R immediately
        engine.feedBytes("\u001B[6n".encodeToByteArray(), isLiveStream = true)
        assertEquals("\u001B[4;7R", capturedReply)
    }

    @Test
    fun testApplicationCursorKeysMode() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 10)
        assertFalse(engine.isAppCursorKeys)

        // Enable DECCKM (\e[?1h)
        engine.feedBytes("\u001B[?1h".encodeToByteArray(), isLiveStream = true)
        assertTrue(engine.isAppCursorKeys)

        // Disable DECCKM (\e[?1l)
        engine.feedBytes("\u001B[?1l".encodeToByteArray(), isLiveStream = true)
        assertFalse(engine.isAppCursorKeys)
    }

    @Test
    fun testSplitChunkUtf8Characters() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 5)
        // Chinese character '中' is 3 bytes in UTF-8: 0xE4 0xB8 0xAD
        val fullBytes = "中".encodeToByteArray()
        assertEquals(3, fullBytes.size)

        // Feed first 2 bytes in chunk 1
        val chunk1 = fullBytes.copyOfRange(0, 2)
        engine.feedBytes(chunk1, isLiveStream = true)
        // Not completed yet
        assertEquals("", engine.activeGrid.getRowText(0))

        // Feed remaining byte in chunk 2
        val chunk2 = fullBytes.copyOfRange(2, 3)
        engine.feedBytes(chunk2, isLiveStream = true)
        // Now completed and rendered!
        assertEquals("中", engine.activeGrid.getRowText(0))
    }

    @Test
    fun testSplitChunkEscapeSequences() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 5)
        engine.feedBytes("Dirty".encodeToByteArray(), isLiveStream = true)
        assertEquals("Dirty", engine.activeGrid.getRowText(0))

        // Split \e[2J across chunks
        engine.feedBytes("\u001B[".encodeToByteArray(), isLiveStream = true)
        // Still dirty
        assertEquals("Dirty", engine.activeGrid.getRowText(0))

        // Send '2J'
        engine.feedBytes("2J".encodeToByteArray(), isLiveStream = true)
        // Now display erased
        assertEquals("", engine.activeGrid.getRowText(0))
    }

    @Test
    fun testSgrColorsAndStylesInGrid() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 5)
        // Red text with green background: \e[31;42mColored\e[0m
        engine.feedBytes("\u001B[31;42mColored\u001B[0m".encodeToByteArray(), isLiveStream = true)
        assertEquals("Colored", engine.activeGrid.getRowText(0))

        val rendered = engine.renderAllLines()
        assertTrue(rendered.isNotEmpty())
        val firstLine = rendered[0]
        assertEquals("Colored", firstLine.text)
        assertTrue(firstLine.spanStyles.isNotEmpty())
        assertEquals(VtTerminalEngine.COLOR_RED, firstLine.spanStyles[0].item.color)
        assertEquals(Color(0xFF14532D), firstLine.spanStyles[0].item.background)
    }
    @Test
    fun testCursorPlacementInRenderedLine() {
        val engine = VtTerminalEngine(initialCols = 40, initialRows = 24)
        engine.feedBytes("sh-5.2$ ".encodeToByteArray(), isLiveStream = true)

        // When cursor is visible, it should appear right after 'sh-5.2$ ' on line 0
        val renderedWithCursor = engine.renderAllLines(cursorVisible = true)
        // Only 1 line should be rendered because trailing empty lines are trimmed
        assertEquals(1, renderedWithCursor.size)
        assertEquals("sh-5.2$ █", renderedWithCursor[0].text)
    }
}
