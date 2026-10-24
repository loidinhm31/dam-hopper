package dev.damhopper.nativeapp.features.terminal

/**
 * Terminal grid dimensions (columns and rows).
 */
data class TerminalDimensions(
    val cols: Int = 80,
    val rows: Int = 24,
) {
    init {
        require(cols > 0) { "cols must be positive: $cols" }
        require(rows > 0) { "rows must be positive: $rows" }
    }
}

/**
 * Result of a search query in the terminal buffer/screen.
 */
data class TerminalSearchResult(
    val query: String,
    val totalMatches: Int,
    val currentMatchIndex: Int,
)

/**
 * Modifier keys for software keyboard accessory bar and hardware shortcuts.
 */
enum class TerminalModifier {
    CTRL,
    ALT,
    SHIFT,
}

/**
 * Platform-agnostic contract for native terminal surfaces.
 *
 * Implemented by Android View / Compose host adapters (e.g. ConnectBot termlib wrapper).
 */
interface NativeTerminalSurface : AutoCloseable {
    val dimensions: TerminalDimensions
    val isAttached: Boolean
    val isDisposed: Boolean

    fun attachView(hostView: Any?)
    fun detachView()
    fun feedOutput(data: ByteArray, offset: Long, reset: Boolean)
    fun resize(cols: Int, rows: Int)
    fun setOnInputListener(listener: (ByteArray) -> Unit)
    fun setOnResizeListener(listener: (cols: Int, rows: Int) -> Unit)
    fun search(query: String, matchCase: Boolean): TerminalSearchResult
    fun clearSearch()
    fun getSelectedText(): String?
    fun copySelection(): String?
    fun pasteText(text: String)
    override fun close()
}
