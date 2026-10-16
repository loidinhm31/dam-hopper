package dev.damhopper.nativeapp.features.editor

/**
 * Text position and line offset calculations for document buffers.
 */
object EditorPositionHelper {

    fun offsetToPosition(text: CharSequence, offset: Int): TextPosition {
        val clamped = offset.coerceIn(0, text.length)
        var line = 1
        var lineStart = 0
        for (i in 0 until clamped) {
            if (text[i] == '\n') {
                line++
                lineStart = i + 1
            }
        }
        val col = clamped - lineStart + 1
        return TextPosition(line, col)
    }

    fun positionToOffset(text: CharSequence, pos: TextPosition): Int {
        var currentLine = 1
        var offset = 0
        while (offset < text.length && currentLine < pos.line) {
            if (text[offset] == '\n') {
                currentLine++
            }
            offset++
        }
        val targetOffset = offset + (pos.column - 1)
        return targetOffset.coerceIn(0, text.length)
    }
}
