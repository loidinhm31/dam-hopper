package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration

/**
 * ANSI SGR color and styling parser for terminal console rendering.
 *
 * Translates standard 16-color ANSI escape sequences, 256-color codes, bold, and underline
 * into Compose [AnnotatedString] with [SpanStyle], matching xterm and Terminus color schemes.
 * Strips all non-SGR control sequences (OSC window titles, cursor visibility/motion, bracketed paste).
 */
object AnsiTerminalParser {

    // Standard 16 ANSI colors (Terminus / xterm dark theme palette)
    val COLOR_BLACK = Color(0xFF64748B)          // 30: Dark Gray / Slate 500
    val COLOR_RED = Color(0xFFEF4444)            // 31: Red 500
    val COLOR_GREEN = Color(0xFF22C55E)          // 32: Green 500
    val COLOR_YELLOW = Color(0xFFEAB308)         // 33: Yellow 500
    val COLOR_BLUE = Color(0xFF3B82F6)           // 34: Blue 500
    val COLOR_MAGENTA = Color(0xFFA855F7)        // 35: Magenta / Purple 500
    val COLOR_CYAN = Color(0xFF06B6D4)           // 36: Cyan 500
    val COLOR_WHITE = Color(0xFFE2E8F0)          // 37: Light Gray / Slate 200

    val COLOR_BRIGHT_BLACK = Color(0xFF94A3B8)   // 90: Gray 400
    val COLOR_BRIGHT_RED = Color(0xFFF87171)     // 91: Bright Red 400
    val COLOR_BRIGHT_GREEN = Color(0xFF4ADE80)   // 92: Bright Green 400
    val COLOR_BRIGHT_YELLOW = Color(0xFFFACC15)  // 93: Bright Yellow 400
    val COLOR_BRIGHT_BLUE = Color(0xFF60A5FA)    // 94: Bright Blue 400
    val COLOR_BRIGHT_MAGENTA = Color(0xFFC084FC) // 95: Bright Magenta 400
    val COLOR_BRIGHT_CYAN = Color(0xFF22D3EE)    // 96: Bright Cyan 400
    val COLOR_BRIGHT_WHITE = Color(0xFFFFFFFF)   // 97: Pure White

    // Default foreground matching DamHopperColors.TextPrimary (Slate / Off-white)
    val DEFAULT_FOREGROUND = Color(0xFFF0F6FC)
    /**
     * Parses terminal text containing ANSI escape sequences into an [AnnotatedString]
     * with colored and styled spans.
     */
    fun parseAnsiToAnnotatedString(rawText: String): AnnotatedString {
        val builder = AnnotatedString.Builder()
        var currentFg: Color? = null
        var currentBg: Color? = null
        var isBold = false
        var isUnderline = false
        var isDim = false

        var i = 0
        while (i < rawText.length) {
            val c = rawText[i]

            // 1. Escape Sequence Handler
            if (c == '\u001B') {
                if (i + 1 < rawText.length) {
                    when (rawText[i + 1]) {
                        '[' -> {
                            // CSI sequence: \e[ ... [@-~]
                            var j = i + 2
                            while (j < rawText.length && rawText[j] !in '@'..'~') {
                                j++
                            }
                            if (j < rawText.length) {
                                val command = rawText[j]
                                val params = rawText.substring(i + 2, j)
                                if (command == 'm') {
                                    // SGR formatting & colors
                                    val codes = if (params.isBlank()) listOf(0) else params.split(';').mapNotNull { it.toIntOrNull() }
                                    var idx = 0
                                    while (idx < codes.size) {
                                        when (val code = codes[idx]) {
                                            0 -> {
                                                currentFg = null
                                                currentBg = null
                                                isBold = false
                                                isUnderline = false
                                                isDim = false
                                            }
                                            1 -> isBold = true
                                            2 -> isDim = true
                                            4 -> isUnderline = true
                                            22 -> { isBold = false; isDim = false }
                                            24 -> isUnderline = false
                                            30 -> currentFg = COLOR_BLACK
                                            31 -> currentFg = COLOR_RED
                                            32 -> currentFg = COLOR_GREEN
                                            33 -> currentFg = COLOR_YELLOW
                                            34 -> currentFg = COLOR_BLUE
                                            35 -> currentFg = COLOR_MAGENTA
                                            36 -> currentFg = COLOR_CYAN
                                            37 -> currentFg = COLOR_WHITE
                                            39 -> currentFg = null
                                            40 -> currentBg = Color(0xFF1E293B)
                                            41 -> currentBg = Color(0xFF7F1D1D)
                                            42 -> currentBg = Color(0xFF14532D)
                                            43 -> currentBg = Color(0xFF713F12)
                                            44 -> currentBg = Color(0xFF1E3A8A)
                                            45 -> currentBg = Color(0xFF581C87)
                                            46 -> currentBg = Color(0xFF164E63)
                                            47 -> currentBg = Color(0xFF334155)
                                            49 -> currentBg = null
                                            90 -> currentFg = COLOR_BRIGHT_BLACK
                                            91 -> currentFg = COLOR_BRIGHT_RED
                                            92 -> currentFg = COLOR_BRIGHT_GREEN
                                            93 -> currentFg = COLOR_BRIGHT_YELLOW
                                            94 -> currentFg = COLOR_BRIGHT_BLUE
                                            95 -> currentFg = COLOR_BRIGHT_MAGENTA
                                            96 -> currentFg = COLOR_BRIGHT_CYAN
                                            97 -> currentFg = COLOR_BRIGHT_WHITE
                                            100 -> currentBg = Color(0xFF334155)
                                            38 -> {
                                                // 256 colors: 38;5;n
                                                if (idx + 2 < codes.size && codes[idx + 1] == 5) {
                                                    val colorIndex = codes[idx + 2]
                                                    currentFg = parse256Color(colorIndex)
                                                    idx += 2
                                                }
                                            }
                                            48 -> {
                                                // 256 bg colors: 48;5;n
                                                if (idx + 2 < codes.size && codes[idx + 1] == 5) {
                                                    val colorIndex = codes[idx + 2]
                                                    currentBg = parse256Color(colorIndex)
                                                    idx += 2
                                                }
                                            }
                                        }
                                        idx++
                                    }
                                }
                                // Skip past CSI sequence
                                i = j + 1
                                continue
                            } else {
                                // Incomplete CSI at end of text: discard
                                i = rawText.length
                                continue
                            }
                        }
                        ']' -> {
                            // OSC sequence: \e] ... (\a or \e\)
                            var j = i + 2
                            while (j < rawText.length) {
                                if (rawText[j] == '\u0007') {
                                    j++
                                    break
                                }
                                if (rawText[j] == '\u001B' && j + 1 < rawText.length && rawText[j + 1] == '\\') {
                                    j += 2
                                    break
                                }
                                j++
                            }
                            i = j
                            continue
                        }
                        'P', '^', '_' -> {
                            // DCS, PM, APC
                            var j = i + 2
                            while (j < rawText.length) {
                                if (rawText[j] == '\u0007') { j++; break }
                                if (rawText[j] == '\u001B' && j + 1 < rawText.length && rawText[j + 1] == '\\') { j += 2; break }
                                j++
                            }
                            i = j
                            continue
                        }
                        in "()#%*+" -> {
                            // Character set selection
                            i += 3
                            continue
                        }
                        in "=@><78cEFHMNPn" -> {
                            i += 2
                            continue
                        }
                    }
                }
                // Stray unhandled escape
                i++
                continue
            }

            // 2. Filter unprintable C0/C1 control codes (except \r, \n, \t, \b)
            if (c in '\u0000'..'\u0006' || c == '\u0007' || c in '\u000B'..'\u000C' || c in '\u000E'..'\u001F' || c in '\u007F'..'\u009F') {
                i++
                continue
            }

            // 3. Normal character: apply current active SpanStyle
            val hasCustomStyle = currentFg != null || currentBg != null || isBold || isUnderline || isDim
            val style = SpanStyle(
                color = currentFg ?: DEFAULT_FOREGROUND,
                background = currentBg ?: Color.Transparent,
                fontWeight = if (isBold) FontWeight.Bold else if (isDim) FontWeight.Light else FontWeight.Normal,
                textDecoration = if (isUnderline) TextDecoration.Underline else null,
            )
            builder.pushStyle(style)
            builder.append(c.toString())
            builder.pop()
            i++
        }

        return builder.toAnnotatedString()
    }

    private fun parse256Color(index: Int): Color {
        return when (index) {
            in 0..7 -> when (index) {
                0 -> COLOR_BLACK
                1 -> COLOR_RED
                2 -> COLOR_GREEN
                3 -> COLOR_YELLOW
                4 -> COLOR_BLUE
                5 -> COLOR_MAGENTA
                6 -> COLOR_CYAN
                else -> COLOR_WHITE
            }
            in 8..15 -> when (index) {
                8 -> COLOR_BRIGHT_BLACK
                9 -> COLOR_BRIGHT_RED
                10 -> COLOR_BRIGHT_GREEN
                11 -> COLOR_BRIGHT_YELLOW
                12 -> COLOR_BRIGHT_BLUE
                13 -> COLOR_BRIGHT_MAGENTA
                14 -> COLOR_BRIGHT_CYAN
                else -> COLOR_BRIGHT_WHITE
            }
            in 16..231 -> {
                // 6x6x6 color cube
                val i = index - 16
                val r = (i / 36) * 51
                val g = ((i % 36) / 6) * 51
                val b = (i % 6) * 51
                Color(r, g, b)
            }
            in 232..255 -> {
                // Grayscale ramp
                val gray = (index - 232) * 10 + 8
                Color(gray, gray, gray)
            }
            else -> Color.Unspecified
        }
    }
}
