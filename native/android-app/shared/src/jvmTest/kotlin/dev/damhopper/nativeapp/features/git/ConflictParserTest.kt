package dev.damhopper.nativeapp.features.git

import kotlin.test.*

class ConflictParserTest {

    @Test
    fun testParseStandard2WayConflict() {
        val content = """
            prefix line
            <<<<<<< HEAD
            ours line 1
            ours line 2
            =======
            theirs line 1
            >>>>>>> feature-branch
            suffix line
        """.trimIndent()

        val regions = ConflictParser.parseConflictRegions(content)
        assertEquals(1, regions.size)
        val r = regions[0]
        assertEquals(0, r.index)
        assertEquals(2, r.startLine)
        assertEquals(5, r.separatorLine)
        assertEquals(7, r.endLine)
        assertEquals("ours line 1\nours line 2", r.oursContent)
        assertEquals("theirs line 1", r.theirsContent)
        assertEquals("HEAD", r.ourLabel)
        assertEquals("feature-branch", r.theirLabel)
        assertNull(r.ancestorContent)
    }

    @Test
    fun testParse3WayDiff3Conflict() {
        val content = """
            <<<<<<< HEAD
            our changes
            ||||||| base-commit
            original base
            =======
            incoming changes
            >>>>>>> incoming-branch
        """.trimIndent()

        val regions = ConflictParser.parseConflictRegions(content)
        assertEquals(1, regions.size)
        val r = regions[0]
        assertEquals(1, r.startLine)
        assertEquals(3, r.ancestorLine)
        assertEquals(5, r.separatorLine)
        assertEquals(7, r.endLine)
        assertEquals("our changes", r.oursContent)
        assertEquals("original base", r.ancestorContent)
        assertEquals("incoming changes", r.theirsContent)
        assertEquals("base-commit", r.ancestorLabel)
    }

    @Test
    fun testAcceptOursAndTheirs() {
        val content = """
            header
            <<<<<<< HEAD
            my code
            =======
            their code
            >>>>>>> main
            footer
        """.trimIndent()

        val regions = ConflictParser.parseConflictRegions(content)
        assertEquals(1, regions.size)

        val acceptedOurs = ConflictParser.acceptConflict(content, regions[0], ConflictSide.OURS)
        assertEquals("header\nmy code\nfooter", acceptedOurs)
        assertFalse(ConflictParser.hasRemainingConflicts(acceptedOurs))

        val acceptedTheirs = ConflictParser.acceptConflict(content, regions[0], ConflictSide.THEIRS)
        assertEquals("header\ntheir code\nfooter", acceptedTheirs)
        assertFalse(ConflictParser.hasRemainingConflicts(acceptedTheirs))
    }

    @Test
    fun testAcceptBothSides() {
        val content = """
            <<<<<<< HEAD
            first
            =======
            second
            >>>>>>> main
        """.trimIndent()

        val regions = ConflictParser.parseConflictRegions(content)
        val bothOursFirst = ConflictParser.acceptConflict(content, regions[0], ConflictSide.BOTH_OURS_FIRST)
        assertEquals("first\nsecond", bothOursFirst)

        val bothTheirsFirst = ConflictParser.acceptConflict(content, regions[0], ConflictSide.BOTH_THEIRS_FIRST)
        assertEquals("second\nfirst", bothTheirsFirst)
    }

    @Test
    fun testAcceptAllMultipleConflicts() {
        val content = """
            before 1
            <<<<<<< HEAD
            ours 1
            =======
            theirs 1
            >>>>>>> main
            middle
            <<<<<<< HEAD
            ours 2
            =======
            theirs 2
            >>>>>>> main
            after 2
        """.trimIndent()

        val allOurs = ConflictParser.acceptAll(content, ConflictSide.OURS)
        assertEquals("before 1\nours 1\nmiddle\nours 2\nafter 2", allOurs)
        assertFalse(ConflictParser.hasRemainingConflicts(allOurs))

        val allTheirs = ConflictParser.acceptAll(content, ConflictSide.THEIRS)
        assertEquals("before 1\ntheirs 1\nmiddle\ntheirs 2\nafter 2", allTheirs)
        assertFalse(ConflictParser.hasRemainingConflicts(allTheirs))
    }

    @Test
    fun testMalformedConflictDetection() {
        val valid = """
            <<<<<<< HEAD
            ours
            =======
            theirs
            >>>>>>> main
        """.trimIndent()
        assertFalse(ConflictParser.hasMalformedConflicts(valid))

        val missingSep = """
            <<<<<<< HEAD
            ours
            >>>>>>> main
        """.trimIndent()
        assertTrue(ConflictParser.hasMalformedConflicts(missingSep))

        val missingClose = """
            <<<<<<< HEAD
            ours
            =======
            theirs
        """.trimIndent()
        assertTrue(ConflictParser.hasMalformedConflicts(missingClose))

        val unmatched = """
            <<<<<<< HEAD
            ours
            <<<<<<< HEAD
            nested
            =======
            theirs
            >>>>>>> main
        """.trimIndent()
        assertTrue(ConflictParser.hasMalformedConflicts(unmatched))
    }

    @Test
    fun testPreservesCrlfLineEndings() {
        val crlfContent = "line1\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> b\r\nline2"
        val regions = ConflictParser.parseConflictRegions(crlfContent)
        assertEquals(1, regions.size)

        val resolved = ConflictParser.acceptConflict(crlfContent, regions[0], ConflictSide.OURS)
        assertTrue(resolved.contains("\r\n"))
        assertEquals("line1\r\nours\r\nline2", resolved)
    }
}
