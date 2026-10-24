package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.text.AnnotatedString

/**
 * A single rendered row in the terminal display with its persistent identity and styled text variants.
 */
data class RenderedRow(
    val id: Long,
    val baseText: AnnotatedString,
    val paddedText: AnnotatedString? = null,
    val cursorText: AnnotatedString? = null,
)

/**
 * An immutable, coherent snapshot of the terminal display surface.
 * Published atomically to Compose UI without element-by-element list mutations.
 */
data class TerminalDisplaySnapshot(
    val rows: List<RenderedRow> = emptyList(),
    val lines: List<AnnotatedString> = emptyList(),
    val lineIds: List<Long> = emptyList(),
    val revision: Long = 0L,
    val cursorIndex: Int = -1,
    val cursorRow: Int = 0,
    val cursorCol: Int = 0,
    val isCursorVisible: Boolean = true,
    val isAppCursorKeys: Boolean = false,
    val isBracketedPaste: Boolean = false,
    val isCursorBlinkingOn: Boolean = true,
    val generation: Long = 0L,
) {
    /**
     * Produces a presentation-only copy with updated cursor blink state.
     * Swaps only the cursor row in [lines] without modifying content [revision] or row [lineIds].
     */
    fun withCursorBlink(visible: Boolean): TerminalDisplaySnapshot {
        if (isCursorBlinkingOn == visible) return this
        val showCursor = isCursorVisible && visible
        val updatedLines = ArrayList(lines)
        if (cursorIndex in rows.indices) {
            val row = rows[cursorIndex]
            updatedLines[cursorIndex] = if (showCursor && row.cursorText != null) {
                row.cursorText
            } else {
                row.paddedText ?: row.baseText
            }
        }
        return copy(
            lines = updatedLines,
            isCursorBlinkingOn = visible,
        )
    }
}
