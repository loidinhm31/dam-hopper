package dev.damhopper.nativeapp.features.editor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FileTierPolicyTest {

    @Test
    fun testExactSizeBoundaries() {
        // Normal: < 1 MiB (1,048,576 bytes)
        assertEquals(FileTier.NORMAL, FileTierPolicy.determineTier("test.ts", 0L, false))
        assertEquals(FileTier.NORMAL, FileTierPolicy.determineTier("test.ts", 1048575L, false))

        // Degraded: >= 1 MiB and < 5 MiB (5,242,880 bytes)
        assertEquals(FileTier.DEGRADED, FileTierPolicy.determineTier("test.ts", 1048576L, false))
        assertEquals(FileTier.DEGRADED, FileTierPolicy.determineTier("test.ts", 5242879L, false))

        // Large: >= 5 MiB
        assertEquals(FileTier.LARGE, FileTierPolicy.determineTier("test.ts", 5242880L, false))
        assertEquals(FileTier.LARGE, FileTierPolicy.determineTier("test.ts", 10000000L, false))
    }

    @Test
    fun testBinaryAndMediaPrecedence() {
        // Binary flag
        assertEquals(FileTier.BINARY, FileTierPolicy.determineTier("data.bin", 500L, true))

        // Media files take precedence over binary and large file thresholds
        assertEquals(FileTier.IMAGE, FileTierPolicy.determineTier("photo.png", 6000000L, true))
        assertEquals(FileTier.IMAGE, FileTierPolicy.determineTier("vector.svg", 500L, false))
        assertEquals(FileTier.VIDEO, FileTierPolicy.determineTier("clip.mp4", 10000000L, true))
        assertEquals(FileTier.VIDEO, FileTierPolicy.determineTier("recording.webm", 2000L, false))

        assertTrue(FileTierPolicy.isPreviewOnlyFile(FileTier.IMAGE, "photo.png"))
        assertTrue(FileTierPolicy.isPreviewOnlyFile(FileTier.VIDEO, "clip.mp4"))
        assertFalse(FileTierPolicy.isPreviewOnlyFile(FileTier.NORMAL, "code.ts"))
        assertFalse(FileTierPolicy.isPreviewOnlyFile(FileTier.LARGE, "huge.log"))
    }

    @Test
    fun testSpecialLanguageClassifications() {
        assertTrue(FileTierPolicy.isMarkdownFile("README.md"))
        assertTrue(FileTierPolicy.isMarkdownFile("notes.markdown"))
        assertFalse(FileTierPolicy.isMarkdownFile("main.rs"))

        assertTrue(FileTierPolicy.isHtmlFile("index.html"))
        assertTrue(FileTierPolicy.isHtmlFile("page.htm"))
        assertFalse(FileTierPolicy.isHtmlFile("style.css"))

        assertTrue(FileTierPolicy.isMermaidFile("chart.mmd"))
        assertTrue(FileTierPolicy.isMermaidFile("diagram.mermaid"))
        assertFalse(FileTierPolicy.isMermaidFile("chart.js"))
    }

    @Test
    fun testUtf8SafeDecodingAtChunkBoundaries() {
        // "Hello, 世界" - "世" is E4 B8 96 (3 bytes), "界" is E7 95 8C (3 bytes)
        val text = "Hello, 世界!"
        val bytes = text.encodeToByteArray()

        // Full decode
        val (fullDecoded, fullLen) = FileTierPolicy.decodeUtf8Safe(bytes, bytes.size)
        assertEquals(text, fullDecoded)
        assertEquals(bytes.size, fullLen)

        // Split inside 3-byte character: slice right after first byte of '世'
        val splitOffset = "Hello, ".encodeToByteArray().size + 1
        val (safeDecoded, safeLen) = FileTierPolicy.decodeUtf8Safe(bytes, splitOffset)
        assertEquals("Hello, ", safeDecoded)
        assertEquals("Hello, ".encodeToByteArray().size, safeLen)
    }
}
