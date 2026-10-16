package dev.damhopper.nativeapp.features.editor

/**
 * Bounded snapshot undo/redo history manager for editor buffers.
 */
class EditorUndoManager(private val maxDepth: Int = 50) {
    private val undoStack: ArrayDeque<String> = ArrayDeque()
    private val redoStack: ArrayDeque<String> = ArrayDeque()

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    fun recordSnapshot(currentText: String) {
        if (undoStack.size >= maxDepth) {
            undoStack.removeFirst()
        }
        undoStack.addLast(currentText)
        redoStack.clear()
    }

    fun undo(currentText: String): String? {
        if (!canUndo) return null
        val previous = undoStack.removeLast()
        redoStack.addLast(currentText)
        return previous
    }

    fun redo(currentText: String): String? {
        if (!canRedo) return null
        val next = redoStack.removeLast()
        undoStack.addLast(currentText)
        return next
    }

    fun clear() {
        undoStack.clear()
        redoStack.clear()
    }
}
