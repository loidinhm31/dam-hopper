package dev.damhopper.nativeapp.features.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class VtTerminalGridTest {
    private fun VtTerminalGrid.write(text: String) {
        text.forEach { writeCell(VtCell(char = it.toString())) }
    }

    private fun VtTerminalGrid.text(): List<String> =
        renderAllLines(trimTrailingEmptyRows = true).map { it.text.trimEnd() }

    private fun VtTerminalGrid.ids(): List<Long> =
        (0 until renderedRowCount(true, true)).map { renderedRowId(it, true) }

    @Test
    fun heightRoundTripRetainsBottomCursorTextAndStyledHistoryWithoutCopies() {
        val grid = VtTerminalGrid(8, 4, maxScrollback = 20)
        repeat(6) { index ->
            if (index > 0) { grid.carriageReturn(); grid.newLine() }
            grid.write("line$index")
        }
        val before = grid.text()
        val ids = grid.ids()
        val history = grid.renderAllLines()[0]
        grid.resize(8, 2)
        assertEquals(before, grid.text())
        assertEquals(ids, grid.ids())
        assertSame(history, grid.renderAllLines()[0])
        assertEquals(1, grid.cursorRow)
        grid.resize(8, 4)
        assertEquals(before, grid.text())
        assertEquals(ids, grid.ids())
        assertEquals(3, grid.cursorRow)
        assertEquals(5, grid.cursorCol)
    }

    @Test
    fun lowerTextAndSavedCursorSurviveShrinkWhenCursorIsAboveThem() {
        val grid = VtTerminalGrid(8, 4)
        repeat(4) { r -> grid.setCursor(r, 0); grid.write("row$r") }
        grid.saveCursor()
        grid.setCursor(0, 1)
        val ids = grid.ids()
        grid.resize(8, 2)
        assertEquals(listOf("row0", "row1"), grid.text())
        assertEquals(0, grid.cursorRow)
        assertEquals(1, grid.cursorCol)
        grid.resize(8, 4)
        assertEquals(listOf("row0", "row1", "row2", "row3"), grid.text())
        assertEquals(ids, grid.ids())
        grid.restoreCursor()
        assertEquals(3, grid.cursorRow)
        assertEquals(4, grid.cursorCol)
    }

    @Test
    fun restoringSavedCursorCanRevealItsResizeDisplacedRow() {
        val grid = VtTerminalGrid(8, 4)
        repeat(4) { r -> grid.setCursor(r, 0); grid.write("row$r") }
        grid.saveCursor()
        grid.setCursor(0, 0)
        grid.resize(8, 2)
        grid.restoreCursor()
        assertEquals("row3", grid.getRowText(grid.cursorRow))
        assertEquals(4, grid.cursorCol)
    }

    @Test
    fun boundedEvictionKeepsSurvivingRowIdentitiesAndStyledObjects() {
        val grid = VtTerminalGrid(8, 2, maxScrollback = 2)
        repeat(4) { r ->
            if (r > 0) { grid.carriageReturn(); grid.newLine() }
            grid.write("row$r")
        }
        val ids = grid.ids()
        val surviving = grid.renderAllLines()[1]
        grid.carriageReturn()
        grid.newLine()
        grid.write("row4")
        assertEquals(listOf("row1", "row2", "row3", "row4"), grid.text())
        assertEquals(ids.drop(1), grid.ids().take(3))
        assertSame(surviving, grid.renderAllLines()[0])
        assertEquals(grid.ids().size, grid.ids().toSet().size)
    }

    @Test
    fun retentionBudgetIncludesBelowViewportAndEvictsDeterministically() {
        val grid = VtTerminalGrid(8, 2, maxScrollback = 2)
        repeat(8) { r ->
            if (r > 0) { grid.carriageReturn(); grid.newLine() }
            grid.write("row$r")
        }
        assertEquals(listOf("row4", "row5", "row6", "row7"), grid.text())
        assertEquals(4, grid.ids().distinct().size)
        grid.resize(8, 1)
        assertEquals(listOf("row5", "row6", "row7"), grid.text())
        grid.resize(8, 2)
        assertEquals(listOf("row5", "row6", "row7"), grid.text())

        val lower = VtTerminalGrid(8, 4, maxScrollback = 2)
        repeat(4) { r -> lower.setCursor(r, 0); lower.write("row$r") }
        lower.setCursor(0, 0)
        lower.resize(8, 1)
        lower.resize(8, 4)
        assertEquals(listOf("row0", "row2", "row3"), lower.text())
        assertEquals("", lower.getRowText(3))
    }

    @Test
    fun widthReflowJoinsSoftWrapsButNotHardBreaksAndKeepsTextAfterCursor() {
        val engine = VtTerminalEngine(8, 4)
        engine.feedBytes("ABCDEFGHIJK\r\nHARD\u001B[1;2H".encodeToByteArray(), true)
        val origin = engine.activeGrid.renderedRowId(0, true)
        engine.resize(4, 4)
        assertEquals(listOf("ABCD", "EFGH", "IJK", "HARD"), engine.activeGrid.text())
        assertEquals(0, engine.activeGrid.cursorRow)
        assertEquals(1, engine.activeGrid.cursorCol)
        assertEquals(origin, engine.activeGrid.renderedRowId(0, true))
        engine.resize(8, 4)
        assertEquals(listOf("ABCDEFGH", "IJK", "HARD"), engine.activeGrid.text())
        assertEquals(0, engine.activeGrid.cursorRow)
        assertEquals(1, engine.activeGrid.cursorCol)
    }

    @Test
    fun oldWidthHistoryReflowsAndStyledSpacesSurvive() {
        val engine = VtTerminalEngine(8, 2)
        engine.feedBytes("\u001B[41mAB    CD\u001B[0mEF\r\nnext\r\nlast".encodeToByteArray(), true)
        engine.resize(4, 2)
        val narrow = engine.renderAllLines().map { it.text.trimEnd() }
        assertEquals(listOf("AB", "  CD", "EF", "next", "last"), narrow)
        assertTrue(engine.renderAllLines()[0].spanStyles.any { it.item.background == androidx.compose.ui.graphics.Color(0xFF7F1D1D) })
        engine.resize(8, 2)
        assertEquals(listOf("AB    CD", "EF", "next", "last"), engine.activeGrid.text())
    }

    @Test
    fun trailingStyledSpacesAndAnExplicitBlankHardLineSurviveReflow() {
        val engine = VtTerminalEngine(8, 4)
        engine.feedBytes("\u001B[44mA   \u001B[0m\r\n\r\nB\u001B[1;1H".encodeToByteArray(), true)
        engine.resize(2, 4)
        assertEquals("A ", engine.renderAllLines()[0].text)
        assertEquals("  ", engine.renderAllLines()[1].text)
        engine.resize(8, 4)
        val row = engine.renderAllLines()[0]
        assertEquals("A   ", row.text)
        assertTrue(row.spanStyles.all { it.item.background == androidx.compose.ui.graphics.Color(0xFF1E3A8A) })
        assertEquals("", engine.activeGrid.getRowText(1))
        assertEquals("B", engine.activeGrid.getRowText(2))
    }

    @Test
    fun pendingWrapAndSavedCursorMapAcrossWidthRoundTripAndCombinedResize() {
        val engine = VtTerminalEngine(8, 3)
        engine.feedBytes("ABCDEFGH\u001B7".encodeToByteArray(), true)
        engine.resize(4, 2)
        assertEquals(1, engine.activeGrid.cursorRow)
        assertEquals(3, engine.activeGrid.cursorCol)
        engine.resize(8, 3)
        assertEquals(0, engine.activeGrid.cursorRow)
        assertEquals(7, engine.activeGrid.cursorCol)
        engine.feedBytes("I\u001B8J".encodeToByteArray(), true)
        assertEquals("ABCDEFGH", engine.activeGrid.getRowText(0))
        assertEquals("J", engine.activeGrid.getRowText(1))
    }

    @Test
    fun savedCursorInsideSoftContinuationMapsIndependentlyOfCurrentCursor() {
        val engine = VtTerminalEngine(8, 4)
        engine.feedBytes("ABCDEFGHIJK\r\nHARD\u001B[2;3H\u001B7\u001B[3;2H".encodeToByteArray(), true)
        engine.resize(4, 4)
        assertEquals(3, engine.activeGrid.cursorRow)
        assertEquals(1, engine.activeGrid.cursorCol)
        engine.resize(8, 4)
        engine.feedBytes("\u001B8X".encodeToByteArray(), true)
        assertEquals(1, engine.activeGrid.cursorRow)
        assertEquals(3, engine.activeGrid.cursorCol)
        assertEquals("IJX", engine.activeGrid.getRowText(1))
        assertEquals("HARD", engine.activeGrid.getRowText(2))
    }

    @Test
    fun wideAndSupplementaryScalarsSurviveOneColumnFallbackAndGrow() {
        val engine = VtTerminalEngine(8, 4)
        engine.feedBytes("A中😀BC中D".encodeToByteArray(), true)
        fun scalars() = engine.renderAllLines().joinToString("") { it.text.trimEnd() }
        assertEquals("A中😀BC中D", scalars())
        engine.resize(4, 4)
        assertEquals("A中😀BC中D", scalars())
        engine.resize(1, 4)
        assertEquals("A中😀BC中D", scalars())
        engine.resize(8, 4)
        assertEquals("A中😀BC中D", scalars())
        assertEquals("A中😀BC", engine.activeGrid.getRowText(0))
        assertEquals("中D", engine.activeGrid.getRowText(1))
    }

    @Test
    fun eraseAndOverwriteAfterShrinkAreAuthoritativeIncludingDisplacedContinuation() {
        val engine = VtTerminalEngine(8, 2)
        engine.feedBytes("ABCDEFGH\u001B[1;2H".encodeToByteArray(), true)
        engine.resize(4, 1)
        engine.feedBytes("\u001B[K".encodeToByteArray(), true)
        engine.resize(8, 2)
        assertEquals(listOf("A"), engine.activeGrid.text())
        assertFalse(engine.renderAllLines().any { it.text.contains("EFGH") })
        engine.reset()
        engine.feedBytes("ABCDEFGH\u001B[1;1H".encodeToByteArray(), true)
        engine.resize(4, 2)
        engine.feedBytes("\u001B[2;1HX".encodeToByteArray(), true)
        engine.resize(8, 2)
        assertEquals("ABCDXFGH", engine.activeGrid.getRowText(0))
    }

    @Test
    fun displayEraseResetAndAlternateCannotResurrectRetainedRows() {
        val engine = VtTerminalEngine(8, 4)
        engine.feedBytes("top\r\nmiddle\r\nbottom\r\nlast\u001B[1;1H".encodeToByteArray(), true)
        engine.resize(4, 1)
        engine.feedBytes("\u001B[2J".encodeToByteArray(), true)
        engine.resize(8, 4)
        assertTrue(engine.activeGrid.text().all { it.isEmpty() })
        engine.feedBytes("MAIN\u001B[?1049hALTERNATE\r\nextra\r\nmore".encodeToByteArray(), true)
        engine.resize(4, 2)
        assertEquals(2, engine.altGrid.renderAllLines().size)
        engine.resize(8, 4)
        assertFalse(engine.altGrid.renderAllLines().any { it.text.contains("ALTERNATE") })
        engine.feedBytes("\u001B[?1049l".encodeToByteArray(), true)
        assertEquals("MAIN", engine.mainGrid.getRowText(0))
        assertFalse(engine.mainGrid.text().any { it.contains("extra") || it.contains("more") })
        engine.feedBytes("\u001Bc".encodeToByteArray(), true)
        assertEquals(listOf(""), engine.mainGrid.text())
        assertEquals(listOf("", "", "", ""), engine.altGrid.renderAllLines().map { it.text.trimEnd() })
    }
}
