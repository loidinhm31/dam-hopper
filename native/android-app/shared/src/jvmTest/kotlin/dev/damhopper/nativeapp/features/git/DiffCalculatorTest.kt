package dev.damhopper.nativeapp.features.git

import kotlin.test.*

class DiffCalculatorTest {

    @Test
    fun testEmptyInputs() {
        val rows = DiffCalculator.computeDiffRows(null, null)
        assertTrue(rows.isEmpty())

        val emptyRows = DiffCalculator.computeDiffRows("", "")
        assertTrue(emptyRows.isEmpty())
    }

    @Test
    fun testIdenticalInputs() {
        val content = "line 1\nline 2\nline 3"
        val rows = DiffCalculator.computeDiffRows(content, content, DiffLayoutMode.SIDE_BY_SIDE)
        assertEquals(3, rows.size)
        assertTrue(rows.all { it.oldType == DiffLineType.UNCHANGED && it.newType == DiffLineType.UNCHANGED })
        assertEquals(1, rows[0].oldLineNumber)
        assertEquals(1, rows[0].newLineNumber)
        assertEquals("line 1", rows[0].oldContent)
        assertEquals("line 1", rows[0].newContent)
    }

    @Test
    fun testAdditionsOnly() {
        val original = ""
        val modified = "new 1\nnew 2"
        val rows = DiffCalculator.computeDiffRows(original, modified, DiffLayoutMode.SIDE_BY_SIDE)
        assertEquals(2, rows.size)
        assertTrue(rows.all { it.newType == DiffLineType.ADDED })
        assertEquals("new 1", rows[0].newContent)
        assertEquals(1, rows[0].newLineNumber)
        assertNull(rows[0].oldLineNumber)
    }

    @Test
    fun testDeletionsOnly() {
        val original = "old 1\nold 2"
        val modified = ""
        val rows = DiffCalculator.computeDiffRows(original, modified, DiffLayoutMode.SIDE_BY_SIDE)
        assertEquals(2, rows.size)
        assertTrue(rows.all { it.oldType == DiffLineType.DELETED })
        assertEquals("old 1", rows[0].oldContent)
        assertEquals(1, rows[0].oldLineNumber)
        assertNull(rows[0].newLineNumber)
    }

    @Test
    fun testModificationsSideBySide() {
        val original = "common\nold line\nend"
        val modified = "common\nnew line\nend"
        val rows = DiffCalculator.computeDiffRows(original, modified, DiffLayoutMode.SIDE_BY_SIDE)
        assertEquals(3, rows.size)
        assertEquals(DiffLineType.UNCHANGED, rows[0].oldType)
        assertEquals(DiffLineType.DELETED, rows[1].oldType)
        assertEquals(DiffLineType.ADDED, rows[1].newType)
        assertEquals("old line", rows[1].oldContent)
        assertEquals("new line", rows[1].newContent)
        assertEquals(DiffLineType.UNCHANGED, rows[2].oldType)
    }

    @Test
    fun testModificationsInline() {
        val original = "alpha\nbeta\ngamma"
        val modified = "alpha\nBETA\ngamma"
        val rows = DiffCalculator.computeDiffRows(original, modified, DiffLayoutMode.INLINE)
        assertEquals(4, rows.size)
        assertEquals(DiffLineType.UNCHANGED, rows[0].oldType)
        assertEquals(DiffLineType.DELETED, rows[1].oldType)
        assertEquals("beta", rows[1].oldContent)
        assertEquals(DiffLineType.ADDED, rows[2].newType)
        assertEquals("BETA", rows[2].newContent)
        assertEquals(DiffLineType.UNCHANGED, rows[3].oldType)
    }

    @Test
    fun testHunkGrouping() {
        val original = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj"
        val modified = "a\nB_MOD\nc\nd\ne\nf\ng\nh\nI_MOD\nj"
        val rows = DiffCalculator.computeDiffRows(original, modified, DiffLayoutMode.SIDE_BY_SIDE)

        val hunks = rows.mapNotNull { it.hunkIndex }.distinct()
        assertEquals(2, hunks.size)
        assertEquals(listOf(0, 1), hunks)
    }

    @Test
    fun testTruncatedPreviewOnHugeInputs() {
        val hugeOld = (1..11_000).joinToString("\n") { "old line $it" }
        val hugeNew = (1..11_000).joinToString("\n") { "new line $it" }
        val rows = DiffCalculator.computeDiffRows(hugeOld, hugeNew, DiffLayoutMode.SIDE_BY_SIDE)
        assertTrue(rows.isNotEmpty())
        assertEquals(DiffLineType.HEADER, rows[0].oldType)
        assertTrue(rows[0].oldContent?.contains("exceeds diff limit") == true)
    }
}
