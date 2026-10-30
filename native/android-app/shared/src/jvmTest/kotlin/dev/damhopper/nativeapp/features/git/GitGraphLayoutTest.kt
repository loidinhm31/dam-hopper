package dev.damhopper.nativeapp.features.git

import kotlin.test.*

class GitGraphLayoutTest {

    private fun sampleEntry(
        hash: String,
        parents: List<String> = emptyList(),
        message: String = "commit $hash",
    ) = GitLogEntry(
        hash = hash,
        parents = parents,
        authorName = "Dev",
        authorEmail = "dev@example.com",
        timestamp = 1700000000L,
        message = message,
    )

    @Test
    fun testEmptyList() {
        val layout = layoutGitGraph(emptyList())
        assertEquals(0, layout.rows.size)
        assertEquals(1, layout.laneCount)
    }

    @Test
    fun testRootCommit() {
        val entries = listOf(sampleEntry(hash = "root-1", parents = emptyList()))
        val layout = layoutGitGraph(entries)

        assertEquals(1, layout.rows.size)
        assertEquals(1, layout.laneCount)
        val row = layout.rows[0]
        assertEquals("root-1", row.oid)
        assertEquals(0, row.rowIndex)
        assertEquals(0, row.lane)
        assertTrue(row.segments.isEmpty())
    }

    @Test
    fun testLinearHistory() {
        val entries = listOf(
            sampleEntry("c0", listOf("c1")),
            sampleEntry("c1", listOf("c2")),
            sampleEntry("c2", listOf("c3")),
            sampleEntry("c3", emptyList()),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(4, layout.rows.size)
        assertEquals(1, layout.laneCount)

        // All commits must share lane 0 (first-parent continuity)
        for (i in 0 until 4) {
            assertEquals(0, layout.rows[i].lane, "Commit $i should be on lane 0")
            assertEquals(i, layout.rows[i].rowIndex)
        }

        // Row 0: outgoing to c1
        val r0 = layout.rows[0]
        assertEquals(1, r0.segments.size)
        val s0 = r0.segments[0]
        assertEquals(0.5f, s0.from.row)
        assertEquals(0, s0.from.lane)
        assertEquals(1.0f, s0.to.row)
        assertEquals(0, s0.to.lane)
        assertEquals("c1", s0.parentOid)
        assertEquals(0, s0.parentIndex)
        assertFalse(s0.unresolved)

        // Row 1: incoming from c0, outgoing to c2
        val r1 = layout.rows[1]
        assertEquals(2, r1.segments.size)
        val incoming1 = r1.segments.first { it.to.row == 0.5f }
        assertEquals(0.0f, incoming1.from.row)
        assertEquals("c1", incoming1.parentOid)
        val outgoing1 = r1.segments.first { it.from.row == 0.5f }
        assertEquals(1.0f, outgoing1.to.row)
        assertEquals("c2", outgoing1.parentOid)

        // Row 3 (root): incoming from c2, no outgoing
        val r3 = layout.rows[3]
        assertEquals(1, r3.segments.size)
        assertEquals(0.0f, r3.segments[0].from.row)
        assertEquals(0.5f, r3.segments[0].to.row)
        assertEquals("c3", r3.segments[0].parentOid)
    }

    @Test
    fun testTwoParentMerge() {
        // Topology:
        // m0 (parents: c1, c2)
        // c1 (parent: c3)
        // c2 (parent: c3)
        // c3 (root)
        val entries = listOf(
            sampleEntry("m0", listOf("c1", "c2")),
            sampleEntry("c1", listOf("c3")),
            sampleEntry("c2", listOf("c3")),
            sampleEntry("c3", emptyList()),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(4, layout.rows.size)
        assertEquals(2, layout.laneCount)

        // First parent continuity: m0, c1, c3 on lane 0
        assertEquals(0, layout.rows[0].lane)
        assertEquals(0, layout.rows[1].lane)
        // Branch parent c2 on lane 1
        assertEquals(1, layout.rows[2].lane)
        assertEquals(0, layout.rows[3].lane)

        // Row 0 has 2 outgoing segments: parentIndex 0 (to c1) and parentIndex 1 (to c2)
        val r0Segments = layout.rows[0].segments
        assertEquals(2, r0Segments.size)
        val edgeToC1 = r0Segments.first { it.parentOid == "c1" }
        assertEquals(0, edgeToC1.parentIndex)
        val edgeToC2 = r0Segments.first { it.parentOid == "c2" }
        assertEquals(1, edgeToC2.parentIndex)

        // Row 1 passes through lane 1 for the edge to c2
        val r1Segments = layout.rows[1].segments
        assertTrue(r1Segments.any { it.from.lane == 1 && it.to.lane == 1 && it.from.row == 0.0f && it.to.row == 1.0f })

        // Row 3 (common ancestor) receives both branches (from lane 0 and from lane 1)
        val r3Segments = layout.rows[3].segments
        assertEquals(2, r3Segments.size)
        assertTrue(r3Segments.all { it.to.row == 0.5f && it.to.lane == 0 })
        assertTrue(r3Segments.any { it.from.lane == 0 })
        assertTrue(r3Segments.any { it.from.lane == 1 })
    }

    @Test
    fun testMergeWithFirstParentBelowSecondParent() {
        // Merge commit at row 0 has first parent at row 2, and second parent at row 1:
        // m0 (parents: [c2, c1])
        // c1 (parents: [root])
        // c2 (parents: [root])
        // root
        val entries = listOf(
            sampleEntry("m0", listOf("c2", "c1")),
            sampleEntry("c1", listOf("root")),
            sampleEntry("c2", listOf("root")),
            sampleEntry("root", emptyList()),
        )
        val layout = layoutGitGraph(entries)
        assertEquals(4, layout.rows.size)
        // c2 inherits lane 0 (first parent of m0)
        assertEquals(0, layout.rows[0].lane)
        assertEquals(0, layout.rows[2].lane)
        // c1 must NOT collide with the m0 -> c2 pass-through line on lane 0!
        assertNotEquals(0, layout.rows[1].lane)
    }

    @Test
    fun testOctopusMerge() {
        // Octopus merge commit with 3 parents
        val entries = listOf(
            sampleEntry("octo", listOf("p0", "p1", "p2")),
            sampleEntry("p0", emptyList()),
            sampleEntry("p1", emptyList()),
            sampleEntry("p2", emptyList()),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(4, layout.rows.size)
        assertTrue(layout.laneCount >= 3, "Octopus merge must allocate distinct lanes for distinct active branches")

        val octoRow = layout.rows[0]
        assertEquals(3, octoRow.segments.size)
        val parentIndices = octoRow.segments.map { it.parentIndex }.toSet()
        assertEquals(setOf(0, 1, 2), parentIndices)

        // Parents p0, p1, p2 are assigned distinct lanes
        val lanes = listOf(layout.rows[1].lane, layout.rows[2].lane, layout.rows[3].lane)
        assertEquals(3, lanes.toSet().size, "All 3 octopus parent nodes must have distinct lanes")
    }

    @Test
    fun testEarlierParentOutOfOrderDate() {
        // Out-of-order date / non-topological:
        // Row 0 is parent "p1"
        // Row 1 is child "c1", whose parent is "p1" (earlier row!)
        val entries = listOf(
            sampleEntry("p1", emptyList()),
            sampleEntry("c1", listOf("p1")),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(2, layout.rows.size)
        val r0 = layout.rows[0] // p1
        val r1 = layout.rows[1] // c1

        // In row 1 (child), edge goes UPWARD to row 0.0f
        assertEquals(1, r1.segments.size)
        val upEdge = r1.segments[0]
        assertEquals(0.5f, upEdge.from.row)
        assertEquals(0.0f, upEdge.to.row)
        assertEquals("p1", upEdge.parentOid)
        assertFalse(upEdge.unresolved)

        // In row 0 (parent), edge enters from bottom 1.0f into parent node 0.5f
        assertEquals(1, r0.segments.size)
        val inEdge = r0.segments[0]
        assertEquals(1.0f, inEdge.from.row)
        assertEquals(0.5f, inEdge.to.row)
        assertEquals("p1", inEdge.parentOid)
    }

    @Test
    fun testUnresolvedParents() {
        // Commit with absent parents (shallow clone or off-page)
        val entries = listOf(
            sampleEntry("c0", listOf("shallow-parent-1", "shallow-parent-2")),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(1, layout.rows.size, "NEVER fabricate phantom nodes for missing parents!")
        val row = layout.rows[0]
        assertEquals(2, row.segments.size)

        val s0 = row.segments.first { it.parentIndex == 0 }
        assertTrue(s0.unresolved)
        assertEquals("shallow-parent-1", s0.parentOid)
        assertEquals(0.5f, s0.from.row)
        assertEquals(1.0f, s0.to.row)

        val s1 = row.segments.first { it.parentIndex == 1 }
        assertTrue(s1.unresolved)
        assertEquals("shallow-parent-2", s1.parentOid)
        assertEquals(0.5f, s1.from.row)
        assertEquals(1.0f, s1.to.row)
    }

    @Test
    fun testDuplicateOidsDedup() {
        val entries = listOf(
            sampleEntry("c0", listOf("c1"), message = "first occurrence"),
            sampleEntry("c1", emptyList()),
            sampleEntry("c0", listOf("ghost"), message = "duplicate c0"),
            sampleEntry("c2", listOf("c1")),
        )
        val layout = layoutGitGraph(entries)

        assertEquals(3, layout.rows.size, "Duplicate c0 must be deduplicated, accepting first occurrence only")
        assertEquals("c0", layout.rows[0].oid)
        assertEquals("c1", layout.rows[1].oid)
        assertEquals("c2", layout.rows[2].oid)

        // Verify ghost commit was never referenced or created
        for (row in layout.rows) {
            for (seg in row.segments) {
                assertNotEquals("ghost", seg.parentOid)
            }
        }
    }

    @Test
    fun testStableRepeat() {
        val entries = listOf(
            sampleEntry("m0", listOf("c1", "c2")),
            sampleEntry("c1", listOf("c3")),
            sampleEntry("c2", listOf("c3")),
            sampleEntry("c3", listOf("unresolved-root")),
        )
        val layout1 = layoutGitGraph(entries)
        val layout2 = layoutGitGraph(entries)

        assertEquals(layout1.laneCount, layout2.laneCount)
        assertEquals(layout1.rows.size, layout2.rows.size)
        for (i in layout1.rows.indices) {
            val r1 = layout1.rows[i]
            val r2 = layout2.rows[i]
            assertEquals(r1.oid, r2.oid)
            assertEquals(r1.rowIndex, r2.rowIndex)
            assertEquals(r1.lane, r2.lane)
            assertEquals(r1.segments.size, r2.segments.size)
            for (j in r1.segments.indices) {
                assertEquals(r1.segments[j], r2.segments[j])
            }
        }
    }

    @Test
    fun graphConsumerSmoke() {
        // Smoke test verifying layoutGitGraph over realistic multi-topology dataset
        val dataset = listOf(
            // Octopus merge
            sampleEntry("octo-head", listOf("feat-a", "feat-b", "feat-c")),
            // Branch A
            sampleEntry("feat-a", listOf("base-1")),
            // Branch B
            sampleEntry("feat-b", listOf("base-1")),
            // Branch C with an upward edge to earlier commit feat-a
            sampleEntry("feat-c", listOf("feat-a", "base-1")),
            // Base commit
            sampleEntry("base-1", listOf("off-page-root")),
        )

        val layout = layoutGitGraph(dataset)

        assertEquals(5, layout.rows.size)
        assertTrue(layout.laneCount >= 3)

        // Check continuity across rows for every segment
        for (row in layout.rows) {
            assertTrue(row.lane in 0 until layout.laneCount)
            for (seg in row.segments) {
                assertTrue(seg.from.lane in 0 until layout.laneCount)
                assertTrue(seg.to.lane in 0 until layout.laneCount)
                assertTrue(seg.from.row in 0.0f..1.0f)
                assertTrue(seg.to.row in 0.0f..1.0f)
                assertTrue(seg.parentOid.isNotBlank())
            }
        }

        // Verify off-page root is marked unresolved without creating phantom node
        val baseRow = layout.rows.first { it.oid == "base-1" }
        val unresolvedSeg = baseRow.segments.first { it.parentOid == "off-page-root" }
        assertTrue(unresolvedSeg.unresolved)
        assertEquals(0.5f, unresolvedSeg.from.row)
        assertEquals(1.0f, unresolvedSeg.to.row)
    }
}
