package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString

/**
 * Full VT100 / ANSI terminal state machine and emulation engine.
 *
 * Implements a persistent byte-stream parser across chunk boundaries, dual screen buffers
 * (Main with scrollback, Alternate for full-screen TUIs like omp/vim/htop), ANSI 2D cursor motion,
 * line/screen erase, and live-stream-only CPR/DA protocol query responses.
 */
class VtTerminalEngine(
    initialCols: Int = 80,
    initialRows: Int = 24,
) {
    var cols: Int = initialCols.coerceAtLeast(1)
        private set
    var rows: Int = initialRows.coerceAtLeast(1)
        private set

    val mainGrid = VtTerminalGrid(cols, rows, hasScrollback = true)
    val altGrid = VtTerminalGrid(cols, rows, hasScrollback = false)

    var isAltScreen: Boolean = false
        private set

    val activeGrid: VtTerminalGrid
        get() = if (isAltScreen) altGrid else mainGrid

    var isAppCursorKeys: Boolean = false
        private set
    var isCursorVisible: Boolean = true
        private set
    var isBracketedPaste: Boolean = false
        private set

    /**
     * Callback for terminal-generated protocol responses (e.g. CPR \e[<r>;<c>R, DA \e[?1;2c).
     * Invoked ONLY during live stream feeds, never during historical buffer replay.
     */
    var onProtocolReply: ((ByteArray) -> Unit)? = null

    // SGR Active State
    private var currentFg: Color = VT_DEFAULT_FOREGROUND
    private var currentBg: Color = Color.Transparent
    private var isBold: Boolean = false
    private var isUnderline: Boolean = false
    private var isDim: Boolean = false
    private var isInverse: Boolean = false

    // Parser State Machine
    private var state = STATE_GROUND
    private val csiParams = StringBuilder()
    private val oscBuffer = StringBuilder()
    private var utf8Residual = ByteArray(0)

    companion object {
        private const val STATE_GROUND = 0
        private const val STATE_ESCAPE = 1
        private const val STATE_CSI = 2
        private const val STATE_OSC = 3
        private const val STATE_DCS = 4
        private const val STATE_CHARSET = 5

        // ANSI 16 Colors matching xterm / DamHopper theme
        val COLOR_BLACK = Color(0xFF64748B)          // 30
        val COLOR_RED = Color(0xFFEF4444)            // 31
        val COLOR_GREEN = Color(0xFF22C55E)          // 32
        val COLOR_YELLOW = Color(0xFFEAB308)         // 33
        val COLOR_BLUE = Color(0xFF3B82F6)           // 34
        val COLOR_MAGENTA = Color(0xFFA855F7)        // 35
        val COLOR_CYAN = Color(0xFF06B6D4)           // 36
        val COLOR_WHITE = Color(0xFFE2E8F0)          // 37

        val COLOR_BRIGHT_BLACK = Color(0xFF94A3B8)   // 90
        val COLOR_BRIGHT_RED = Color(0xFFF87171)     // 91
        val COLOR_BRIGHT_GREEN = Color(0xFF4ADE80)   // 92
        val COLOR_BRIGHT_YELLOW = Color(0xFFFACC15)  // 93
        val COLOR_BRIGHT_BLUE = Color(0xFF60A5FA)    // 94
        val COLOR_BRIGHT_MAGENTA = Color(0xFFC084FC) // 95
        val COLOR_BRIGHT_CYAN = Color(0xFF22D3EE)    // 96
        val COLOR_BRIGHT_WHITE = Color(0xFFFFFFFF)   // 97
    }

    fun reset() {
        mainGrid.clearAll()
        altGrid.clearAll()
        isAltScreen = false
        isAppCursorKeys = false
        isCursorVisible = true
        isBracketedPaste = false
        resetSgr()
        state = STATE_GROUND
        csiParams.clear()
        oscBuffer.clear()
        utf8Residual = ByteArray(0)
    }

    fun resetSgr() {
        currentFg = VT_DEFAULT_FOREGROUND
        currentBg = Color.Transparent
        isBold = false
        isUnderline = false
        isDim = false
        isInverse = false
    }

    fun resize(newCols: Int, newRows: Int) {
        val width = newCols.coerceAtLeast(1)
        val height = newRows.coerceAtLeast(1)
        if (width == cols && height == rows) return
        cols = width
        rows = height
        mainGrid.resize(width, height)
        altGrid.resize(width, height)
    }

    /**
     * Feeds raw byte stream chunk from remote PTY into the state machine.
     *
     * @param data Raw payload bytes from PTY stream.
     * @param isLiveStream True if chunk is live stdout; false if replaying historical buffer.
     */
    fun feedBytes(data: ByteArray, isLiveStream: Boolean) {
        val totalBytes = if (utf8Residual.isNotEmpty()) utf8Residual + data else data
        utf8Residual = ByteArray(0)

        var idx = 0
        while (idx < totalBytes.size) {
            val b = totalBytes[idx].toInt() and 0xFF
            // Determine UTF-8 sequence length
            val seqLen = when {
                b < 0x80 -> 1
                b in 0xC2..0xDF -> 2
                b in 0xE0..0xEF -> 3
                b in 0xF0..0xF4 -> 4
                else -> 1 // Malformed / invalid byte, treat as 1
            }

            if (idx + seqLen > totalBytes.size) {
                // Incomplete UTF-8 sequence at end of chunk: buffer for next feed
                utf8Residual = totalBytes.copyOfRange(idx, totalBytes.size)
                break
            }

            val codepoint: Int
            if (seqLen == 1) {
                codepoint = b
            } else {
                val sub = totalBytes.copyOfRange(idx, idx + seqLen)
                val str = sub.decodeToString()
                codepoint = if (str.isNotEmpty()) str.codePointAt(0) else 0xFFFD
            }
            idx += seqLen

            processCodepoint(codepoint, isLiveStream)
        }
    }

    private fun processCodepoint(cp: Int, isLiveStream: Boolean) {
        when (state) {
            STATE_GROUND -> {
                when (cp) {
                    0x1B -> state = STATE_ESCAPE
                    0x0D -> activeGrid.carriageReturn()
                    0x0A, 0x0B, 0x0C -> activeGrid.newLine()
                    0x08 -> activeGrid.backspace()
                    0x09 -> {
                        // Tab to 8-col stop
                        val targetCol = (activeGrid.cursorCol / 8 + 1) * 8
                        val spaces = targetCol - activeGrid.cursorCol
                        repeat(spaces) {
                            writeCell(" ")
                        }
                    }
                    0x07 -> { /* Bell: drop */ }
                    in 0x00..0x1F, 0x7F -> { /* Control code: drop */ }
                    else -> {
                        val chars = String(Character.toChars(cp))
                        val w = getCharacterWidth(cp)
                        writeCell(chars, w)
                    }
                }
            }
            STATE_ESCAPE -> {
                when (cp) {
                    '['.code -> {
                        csiParams.clear()
                        state = STATE_CSI
                    }
                    ']'.code -> {
                        oscBuffer.clear()
                        state = STATE_OSC
                    }
                    'P'.code, '^'.code, '_'.code -> {
                        state = STATE_DCS
                    }
                    '('.code, ')'.code, '*'.code, '+'.code -> {
                        state = STATE_CHARSET
                    }
                    '7'.code -> {
                        activeGrid.saveCursor()
                        state = STATE_GROUND
                    }
                    '8'.code -> {
                        activeGrid.restoreCursor()
                        state = STATE_GROUND
                    }
                    'M'.code -> {
                        // Reverse Index (line up)
                        if (activeGrid.cursorRow == activeGrid.scrollTop) {
                            activeGrid.scrollDown(1)
                        } else if (activeGrid.cursorRow > 0) {
                            activeGrid.moveCursor(-1, 0)
                        }
                        state = STATE_GROUND
                    }
                    'D'.code -> {
                        activeGrid.newLine()
                        state = STATE_GROUND
                    }
                    'E'.code -> {
                        activeGrid.carriageReturn()
                        activeGrid.newLine()
                        state = STATE_GROUND
                    }
                    'c'.code -> {
                        // Full reset (RIS)
                        reset()
                        state = STATE_GROUND
                    }
                    else -> {
                        // Unknown escape, return to ground
                        state = STATE_GROUND
                    }
                }
            }
            STATE_CSI -> {
                if (cp in 0x30..0x3F) {
                    // Parameters (digits, semicolon, question mark, etc.)
                    csiParams.append(cp.toChar())
                } else if (cp in 0x40..0x7E) {
                    // Terminating command character
                    handleCsiCommand(cp.toChar(), csiParams.toString(), isLiveStream)
                    state = STATE_GROUND
                } else if (cp == 0x1B) {
                    // Interrupted CSI
                    state = STATE_ESCAPE
                }
            }
            STATE_OSC -> {
                if (cp == 0x07 || (cp == '\\'.code && oscBuffer.endsWith("\u001B"))) {
                    // End of OSC string
                    state = STATE_GROUND
                } else {
                    oscBuffer.append(cp.toChar())
                    if (oscBuffer.length > 2048) {
                        // Prevent unbounded memory growth on malformed OSC
                        state = STATE_GROUND
                    }
                }
            }
            STATE_DCS -> {
                if (cp == 0x07 || (cp == '\\'.code && oscBuffer.endsWith("\u001B"))) {
                    state = STATE_GROUND
                }
            }
            STATE_CHARSET -> {
                state = STATE_GROUND
            }
        }
    }

    private fun handleCsiCommand(cmd: Char, params: String, isLiveStream: Boolean) {
        val isPrivate = params.startsWith("?")
        val cleanParams = if (isPrivate) params.removePrefix("?") else params
        val args = if (cleanParams.isBlank()) emptyList() else cleanParams.split(";").map { it.toIntOrNull() ?: 0 }

        when (cmd) {
            'm' -> handleSgr(args)
            'H', 'f' -> {
                // Cursor Position: \e[<r>;<c>H (1-indexed)
                val row = (args.getOrNull(0) ?: 1) - 1
                val col = (args.getOrNull(1) ?: 1) - 1
                activeGrid.setCursor(row, col)
            }
            'A' -> {
                // Cursor Up
                val count = args.getOrNull(0) ?: 1
                activeGrid.moveCursor(-count, 0)
            }
            'B' -> {
                // Cursor Down
                val count = args.getOrNull(0) ?: 1
                activeGrid.moveCursor(count, 0)
            }
            'C' -> {
                // Cursor Forward / Right
                val count = args.getOrNull(0) ?: 1
                activeGrid.moveCursor(0, count)
            }
            'D' -> {
                // Cursor Backward / Left
                val count = args.getOrNull(0) ?: 1
                activeGrid.moveCursor(0, -count)
            }
            'E' -> {
                // Cursor Next Line
                val count = args.getOrNull(0) ?: 1
                activeGrid.carriageReturn()
                repeat(count) { activeGrid.newLine() }
            }
            'F' -> {
                // Cursor Previous Line
                val count = args.getOrNull(0) ?: 1
                activeGrid.carriageReturn()
                activeGrid.moveCursor(-count, 0)
            }
            'G' -> {
                // Cursor Horizontal Absolute (col)
                val col = (args.getOrNull(0) ?: 1) - 1
                activeGrid.setCursor(activeGrid.cursorRow, col)
            }
            'd' -> {
                // Cursor Vertical Absolute (row)
                val row = (args.getOrNull(0) ?: 1) - 1
                activeGrid.setCursor(row, activeGrid.cursorCol)
            }
            'J' -> {
                // Erase in Display
                val mode = args.getOrNull(0) ?: 0
                activeGrid.eraseInDisplay(mode)
            }
            'K' -> {
                // Erase in Line
                val mode = args.getOrNull(0) ?: 0
                activeGrid.eraseInLine(mode)
            }
            'L' -> {
                // Insert Lines
                val count = args.getOrNull(0) ?: 1
                activeGrid.insertLines(count)
            }
            'M' -> {
                // Delete Lines
                val count = args.getOrNull(0) ?: 1
                activeGrid.deleteLines(count)
            }
            'P' -> activeGrid.deleteCharacters((args.getOrNull(0) ?: 1).coerceAtLeast(1))
            'S' -> {
                // Scroll Up
                val count = args.getOrNull(0) ?: 1
                activeGrid.scrollUp(count)
            }
            'T' -> {
                // Scroll Down
                val count = args.getOrNull(0) ?: 1
                activeGrid.scrollDown(count)
            }
            'r' -> {
                // Set Scroll Margins (DECSTBM)
                val top = (args.getOrNull(0) ?: 1) - 1
                val bottom = (args.getOrNull(1) ?: rows) - 1
                activeGrid.setScrollMargins(top, bottom)
            }
            's' -> activeGrid.saveCursor()
            'u' -> activeGrid.restoreCursor()
            'h' -> {
                // Set Mode
                if (isPrivate) {
                    for (arg in args) {
                        when (arg) {
                            1 -> isAppCursorKeys = true
                            7 -> {
                                mainGrid.isAutoWrap = true
                                altGrid.isAutoWrap = true
                            }
                            25 -> isCursorVisible = true
                            47, 1049 -> {
                                if (!isAltScreen) {
                                    isAltScreen = true
                                    altGrid.clearAll()
                                    altGrid.isAutoWrap = mainGrid.isAutoWrap
                                }
                            }
                            2004 -> isBracketedPaste = true
                        }
                    }
                }
            }
            'l' -> {
                // Reset Mode
                if (isPrivate) {
                    for (arg in args) {
                        when (arg) {
                            1 -> isAppCursorKeys = false
                            7 -> {
                                mainGrid.isAutoWrap = false
                                altGrid.isAutoWrap = false
                            }
                            25 -> isCursorVisible = false
                            47, 1049 -> {
                                if (isAltScreen) {
                                    isAltScreen = false
                                }
                            }
                            2004 -> isBracketedPaste = false
                        }
                    }
                }
            }
            'n' -> {
                // Device Status Report (DSR)
                val mode = args.getOrNull(0) ?: 0
                if (mode == 6 && isLiveStream) {
                    // Cursor Position Report (CPR): \e[<r>;<c>R (1-indexed)
                    val r = activeGrid.cursorRow + 1
                    val c = activeGrid.cursorCol + 1
                    val reply = "\u001B[${r};${c}R".encodeToByteArray()
                    onProtocolReply?.invoke(reply)
                }
            }
            'c' -> {
                // Device Attributes (DA)
                if (isLiveStream) {
                    val reply = "\u001B[?1;2c".encodeToByteArray()
                    onProtocolReply?.invoke(reply)
                }
            }
        }
    }

    private fun handleSgr(args: List<Int>) {
        if (args.isEmpty()) {
            resetSgr()
            return
        }

        var i = 0
        while (i < args.size) {
            when (val code = args[i]) {
                0 -> resetSgr()
                1 -> isBold = true
                2 -> isDim = true
                4 -> isUnderline = true
                7 -> isInverse = true
                22 -> { isBold = false; isDim = false }
                24 -> isUnderline = false
                27 -> isInverse = false
                30 -> currentFg = COLOR_BLACK
                31 -> currentFg = COLOR_RED
                32 -> currentFg = COLOR_GREEN
                33 -> currentFg = COLOR_YELLOW
                34 -> currentFg = COLOR_BLUE
                35 -> currentFg = COLOR_MAGENTA
                36 -> currentFg = COLOR_CYAN
                37 -> currentFg = COLOR_WHITE
                39 -> currentFg = VT_DEFAULT_FOREGROUND
                40 -> currentBg = Color(0xFF1E293B)
                41 -> currentBg = Color(0xFF7F1D1D)
                42 -> currentBg = Color(0xFF14532D)
                43 -> currentBg = Color(0xFF713F12)
                44 -> currentBg = Color(0xFF1E3A8A)
                45 -> currentBg = Color(0xFF581C87)
                46 -> currentBg = Color(0xFF164E63)
                47 -> currentBg = Color(0xFF334155)
                49 -> currentBg = Color.Transparent
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
                    // 256 colors foreground: 38;5;n
                    if (i + 2 < args.size && args[i + 1] == 5) {
                        currentFg = parse256Color(args[i + 2])
                        i += 2
                    }
                }
                48 -> {
                    // 256 colors background: 48;5;n
                    if (i + 2 < args.size && args[i + 1] == 5) {
                        currentBg = parse256Color(args[i + 2])
                        i += 2
                    }
                }
            }
            i++
        }
    }

    private fun parse256Color(idx: Int): Color {
        return when (idx) {
            in 0..7 -> when (idx) {
                0 -> COLOR_BLACK; 1 -> COLOR_RED; 2 -> COLOR_GREEN; 3 -> COLOR_YELLOW
                4 -> COLOR_BLUE; 5 -> COLOR_MAGENTA; 6 -> COLOR_CYAN; else -> COLOR_WHITE
            }
            in 8..15 -> when (idx) {
                8 -> COLOR_BRIGHT_BLACK; 9 -> COLOR_BRIGHT_RED; 10 -> COLOR_BRIGHT_GREEN; 11 -> COLOR_BRIGHT_YELLOW
                12 -> COLOR_BRIGHT_BLUE; 13 -> COLOR_BRIGHT_MAGENTA; 14 -> COLOR_BRIGHT_CYAN; else -> COLOR_BRIGHT_WHITE
            }
            in 16..231 -> {
                val n = idx - 16
                val b = (n % 6) * 51
                val g = ((n / 6) % 6) * 51
                val r = (n / 36) * 51
                Color(r, g, b)
            }
            in 232..255 -> {
                val gray = (idx - 232) * 10 + 8
                Color(gray, gray, gray)
            }
            else -> VT_DEFAULT_FOREGROUND
        }
    }

    private fun writeCell(chars: String, width: Int = 1) {
        val cell = VtCell(
            char = chars,
            fg = currentFg,
            bg = currentBg,
            isBold = isBold,
            isUnderline = isUnderline,
            isDim = isDim,
            isInverse = isInverse,
            width = width,
        )
        activeGrid.writeCell(cell)
    }

    private fun getCharacterWidth(cp: Int): Int {
        // CJK / Wide / Emoji character width check
        return if (cp in 0x1100..0x115F ||
            cp in 0x2E80..0xA4CF ||
            cp in 0xAC00..0xD7A3 ||
            cp in 0xF900..0xFAFF ||
            cp in 0xFE10..0xFE19 ||
            cp in 0xFE30..0xFE6F ||
            cp in 0xFF00..0xFF60 ||
            cp in 0xFFE0..0xFFE6 ||
            cp in 0x1F300..0x1F64F ||
            cp in 0x1F900..0x1F9FF
        ) {
            2
        } else {
            1
        }
    }

    fun renderAllLines(cursorVisible: Boolean = false): List<AnnotatedString> {
        val targetGrid = activeGrid
        val showCursor = isCursorVisible && cursorVisible
        return targetGrid.renderAllLines(
            includeScrollback = !isAltScreen,
            cursorRow = if (showCursor) targetGrid.cursorRow else null,
            cursorCol = if (showCursor) targetGrid.cursorCol else null,
            trimTrailingEmptyRows = !isAltScreen,
        )
    }
}
