package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.ui.theme.DamHopperPalettes
import kotlin.test.*

class GitGraphSegmentsTest {

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
    fun testSegmentContinuityAcrossRows() {
        // Multi-row merge topology:
        // row 0: m0 (parents: c1, c2)
        // row 1: c1 (parents: c3)
        // row 2: c2 (parents: c3)
        // row 3: c3 (root)
        val entries = listOf(
            sampleEntry("m0", listOf("c1", "c2")),
            sampleEntry("c1", listOf("c3")),
            sampleEntry("c2", listOf("c3")),
            sampleEntry("c3", emptyList()),
        )
        val layout = layoutGitGraph(entries)

        // For downward edges crossing row boundary r -> r + 1:
        // Any segment in row r that exits at to.row == 1.0f on lane L
        // MUST have a matching segment in row r + 1 that enters at from.row == 0.0f on lane L
        for (r in 0 until layout.rows.size - 1) {
            val exits = layout.rows[r].segments.filter { it.to.row == 1.0f && !it.unresolved }
            val nextEnters = layout.rows[r + 1].segments.filter { it.from.row == 0.0f && !it.unresolved }

            val palette = DamHopperPalettes.Dark
            val laneColors = computeLaneColors(palette)
            for (exit in exits) {
                val matchingEnter = nextEnters.firstOrNull { it.from.lane == exit.to.lane && it.parentOid == exit.parentOid }
                assertNotNull(
                    matchingEnter,
                    "Expected continuous segment between row $r and row ${r + 1} for parent ${exit.parentOid} on lane ${exit.to.lane}"
                )
                val exitGeom = computeSegmentCoordinates(exit, layout.rows[r].lane, 100f, 40f, layout.laneCount, palette, laneColors)
                val enterGeom = computeSegmentCoordinates(matchingEnter, layout.rows[r + 1].lane, 100f, 40f, layout.laneCount, palette, laneColors)
                assertEquals(exitGeom.color, enterGeom.color, "Continuous segment must preserve color across rows")
            }
        }
    }

    @Test
    fun testSegmentCoordinatesBounds() {
        val entries = listOf(
            sampleEntry("octo", listOf("c1", "c2", "c3")),
            sampleEntry("c1", listOf("root")),
            sampleEntry("c2", listOf("root")),
            sampleEntry("c3", listOf("unresolved-parent")),
            sampleEntry("root", emptyList()),
        )
        val layout = layoutGitGraph(entries)
        val palette = DamHopperPalettes.Dark
        val laneColors = computeLaneColors(palette)
        val testWidth = 120f
        val testHeight = 44f

        for (row in layout.rows) {
            assertTrue(row.lane in 0 until layout.laneCount, "Commit lane must be within bounds")
            val nodeGeom = computeCommitNodeCoordinates(
                row = row,
                width = testWidth,
                height = testHeight,
                laneCount = layout.laneCount,
                laneColors = laneColors,
            )
            assertTrue(nodeGeom.centerX in 0.0f..testWidth)
            assertEquals(testHeight / 2f, nodeGeom.centerY)
            assertTrue(nodeGeom.radius > 0f)

            for (seg in row.segments) {
                // Normalized row-local bounds
                assertTrue(seg.from.row in 0.0f..1.0f)
                assertTrue(seg.to.row in 0.0f..1.0f)
                assertTrue(seg.from.lane in 0 until layout.laneCount)
                assertTrue(seg.to.lane in 0 until layout.laneCount)

                // Projected physical coordinates bounds
                val geom = computeSegmentCoordinates(
                    segment = seg,
                    rowLane = row.lane,
                    width = testWidth,
                    height = testHeight,
                    laneCount = layout.laneCount,
                    palette = palette,
                    laneColors = laneColors,
                )
                assertTrue(geom.startX in 0.0f..testWidth)
                assertTrue(geom.endX in 0.0f..testWidth)
                assertTrue(geom.startY in 0.0f..testHeight)
                assertTrue(geom.endY in 0.0f..testHeight)
                assertTrue(geom.strokeWidth > 0f)
            }
        }
    }

    @Test
    fun testUnresolvedStyling() {
        val entries = listOf(
            sampleEntry("head", listOf("shallow-ancestor")),
        )
        val layout = layoutGitGraph(entries)
        val palette = DamHopperPalettes.Dark
        val laneColors = computeLaneColors(palette)

        val row = layout.rows[0]
        assertEquals(1, row.segments.size)
        val segment = row.segments[0]
        assertTrue(segment.unresolved)
        assertEquals("shallow-ancestor", segment.parentOid)

        val geom = computeSegmentCoordinates(
            segment = segment,
            rowLane = row.lane,
            width = 60f,
            height = 40f,
            laneCount = layout.laneCount,
            palette = palette,
            laneColors = laneColors,
        )

        assertTrue(geom.isDashed, "Unresolved stub must render with dashed path effect")
        assertEquals(palette.warning, geom.color, "Unresolved stub must use warning color")
    }

    @Test
    fun testNonColorDistinctionAndSemantics() {
        val entries = listOf(
            sampleEntry("merge-head", listOf("parent-0", "parent-1")),
            sampleEntry("parent-0", emptyList()),
            sampleEntry("parent-1", listOf("shallow-root")),
        )
        val layout = layoutGitGraph(entries)
        val palette = DamHopperPalettes.Light
        val laneColors = computeLaneColors(palette)

        val row0 = layout.rows[0]
        val desc0 = gitGraphSemanticDescription(row0, layout.laneCount)
        assertTrue(desc0.contains("Commit merge-h"), "Semantics must include short OID")
        assertTrue(desc0.contains("row 0"), "Semantics must include row index")
        assertTrue(desc0.contains("merge route"), "Semantics must identify merge routes")

        val r0Segments = row0.segments
        val s0 = computeSegmentCoordinates(r0Segments.first { it.parentIndex == 0 }, row0.lane, 80f, 40f, layout.laneCount, palette, laneColors, baseStrokeWidth = 4f)
        val s1 = computeSegmentCoordinates(r0Segments.first { it.parentIndex == 1 }, row0.lane, 80f, 40f, layout.laneCount, palette, laneColors, baseStrokeWidth = 4f)

        assertFalse(s0.isDashed)
        assertFalse(s1.isDashed)
        assertTrue(s1.strokeWidth < s0.strokeWidth, "Merge branch route should use distinct non-color stroke geometry")

        val row2 = layout.rows[2]
        val desc2 = gitGraphSemanticDescription(row2, layout.laneCount)
        assertTrue(desc2.contains("unresolved stub"), "Semantics must identify unresolved stubs")
    }

    @Test
    fun testThemedLanePalettes() {
        for (palette in listOf(DamHopperPalettes.Dark, DamHopperPalettes.Light, DamHopperPalettes.HighContrast)) {
            val colors = computeLaneColors(palette)
            assertTrue(colors.size >= 6, "Lane palette must provide at least 6 distinct colors for multi-branch history")
            val distinctCount = colors.distinct().size
            assertTrue(distinctCount >= 5, "Lane colors must be predominantly distinct")
        }
    }

    @Test
    fun rowConsumerSmoke() {
        // Complete consumer smoke test verifying pure geometry rendering pipeline
        val entries = listOf(
            sampleEntry("0123456789abcdef", listOf("parent-a", "parent-b")),
            sampleEntry("parent-a", listOf("root-1")),
            sampleEntry("parent-b", listOf("root-1")),
            sampleEntry("root-1", listOf("missing-upstream")),
        )

        val layout = layoutGitGraph(entries)
        assertEquals(4, layout.rows.size)
        assertTrue(layout.laneCount >= 2)

        val palette = DamHopperPalettes.Dark
        val laneColors = computeLaneColors(palette)
        val rowWidth = 96f
        val rowHeight = 48f

        for (row in layout.rows) {
            // Exercise node coordinates computation
            val node = computeCommitNodeCoordinates(
                row = row,
                width = rowWidth,
                height = rowHeight,
                laneCount = layout.laneCount,
                laneColors = laneColors,
                nodeRadius = 5f,
            )
            assertFalse(node.centerX.isNaN())
            assertFalse(node.centerY.isNaN())
            assertTrue(node.centerX in 0.0f..rowWidth)
            assertEquals(24f, node.centerY)

            // Exercise segment coordinates computation for every segment
            for (seg in row.segments) {
                val geom = computeSegmentCoordinates(
                    segment = seg,
                    rowLane = row.lane,
                    width = rowWidth,
                    height = rowHeight,
                    laneCount = layout.laneCount,
                    palette = palette,
                    laneColors = laneColors,
                    baseStrokeWidth = 3f,
                )
                assertFalse(geom.startX.isNaN())
                assertFalse(geom.startY.isNaN())
                assertFalse(geom.endX.isNaN())
                assertFalse(geom.endY.isNaN())
                assertTrue(geom.strokeWidth > 0f)

                if (seg.unresolved) {
                    assertTrue(geom.isDashed)
                    assertEquals(palette.warning, geom.color)
                }
            }

            // Exercise semantics computation
            val semantics = gitGraphSemanticDescription(row, layout.laneCount)
            assertTrue(semantics.isNotBlank())
            assertTrue(semantics.startsWith("Commit "))
        }
    }
}
