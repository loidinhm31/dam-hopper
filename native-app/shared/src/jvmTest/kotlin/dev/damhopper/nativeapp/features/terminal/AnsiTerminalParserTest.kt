package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AnsiTerminalParserTest {

    @Test
    fun testPlainTextDefaultsToDefaultForeground() {
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString("hello world")
        assertEquals("hello world", parsed.text)
        assertEquals(11, parsed.spanStyles.size)
        for (span in parsed.spanStyles) {
            assertEquals(AnsiTerminalParser.DEFAULT_FOREGROUND, span.item.color)
        }
    }

    @Test
    fun testSgr16ForegroundColors() {
        // Red 31
        val redParsed = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[31mError\u001B[0m")
        assertEquals("Error", redParsed.text)
        assertEquals(5, redParsed.spanStyles.size)
        for (span in redParsed.spanStyles) {
            assertEquals(AnsiTerminalParser.COLOR_RED, span.item.color)
        }

        // Green 32
        val greenParsed = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[32mSuccess\u001B[0m")
        assertEquals("Success", greenParsed.text)
        for (span in greenParsed.spanStyles) {
            assertEquals(AnsiTerminalParser.COLOR_GREEN, span.item.color)
        }

        // Bright Yellow 93
        val yellowParsed = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[93mWarning\u001B[0m")
        assertEquals("Warning", yellowParsed.text)
        for (span in yellowParsed.spanStyles) {
            assertEquals(AnsiTerminalParser.COLOR_BRIGHT_YELLOW, span.item.color)
        }
    }

    @Test
    fun testSgrBackgroundAndStyles() {
        val styled = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[1;4;41mImportant\u001B[0m")
        assertEquals("Important", styled.text)
        for (span in styled.spanStyles) {
            assertEquals(FontWeight.Bold, span.item.fontWeight)
            assertEquals(TextDecoration.Underline, span.item.textDecoration)
            assertEquals(Color(0xFF7F1D1D), span.item.background)
        }
    }

    @Test
    fun testSgrResetRestoresDefaultForeground() {
        val mixed = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[31mRed\u001B[0mNormal")
        assertEquals("RedNormal", mixed.text)
        assertEquals(9, mixed.spanStyles.size)

        // First 3 chars ('Red') should be Red
        for (i in 0 until 3) {
            assertEquals(AnsiTerminalParser.COLOR_RED, mixed.spanStyles[i].item.color)
        }
        // Last 6 chars ('Normal') should be restored to DEFAULT_FOREGROUND
        for (i in 3 until 9) {
            assertEquals(AnsiTerminalParser.DEFAULT_FOREGROUND, mixed.spanStyles[i].item.color)
            assertEquals(Color.Transparent, mixed.spanStyles[i].item.background)
            assertEquals(FontWeight.Normal, mixed.spanStyles[i].item.fontWeight)
            assertNull(mixed.spanStyles[i].item.textDecoration)
        }
    }

    @Test
    fun testSgrDefaultColorCodes39And49() {
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[31mRed\u001B[39mDefault")
        assertEquals("RedDefault", parsed.text)
        for (i in 3 until 10) {
            assertEquals(AnsiTerminalParser.DEFAULT_FOREGROUND, parsed.spanStyles[i].item.color)
        }
    }

    @Test
    fun test256ColorCodes() {
        // 38;5;1 -> Red in 0..7 range
        val parsed256 = AnsiTerminalParser.parseAnsiToAnnotatedString("\u001B[38;5;1mRed256\u001B[0m")
        assertEquals("Red256", parsed256.text)
        for (span in parsed256.spanStyles) {
            assertEquals(AnsiTerminalParser.COLOR_RED, span.item.color)
        }
    }

    @Test
    fun testStripsOscAndNonSgrEscapeSequences() {
        // OSC sequence setting window title \e]0;Terminal Title\a
        val input = "\u001B]0;Terminal Title\u0007sh-5.2$ \u001B[?25h\u001B[?2004hls -la"
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString(input)
        assertEquals("sh-5.2$ ls -la", parsed.text)
    }

    @Test
    fun testStripsUnprintableControlCharacters() {
        val input = "foo\u0000bar\u0007baz\u007F"
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString(input)
        assertEquals("foobarbaz", parsed.text)
    }

    @Test
    fun testIncompleteOrMalformedSequencesFailsGracefully() {
        // Lone escape at end
        val incomplete1 = AnsiTerminalParser.parseAnsiToAnnotatedString("text\u001B")
        assertEquals("text", incomplete1.text)

        // Incomplete CSI
        val incomplete2 = AnsiTerminalParser.parseAnsiToAnnotatedString("text\u001B[")
        assertEquals("text", incomplete2.text)

        // Incomplete OSC
        val incomplete3 = AnsiTerminalParser.parseAnsiToAnnotatedString("text\u001B]0;title")
        assertEquals("text", incomplete3.text)
    }
}
