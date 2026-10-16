package dev.damhopper.nativeapp.features.editor

/**
 * Helper algorithms for document-level search, matching, and replacement.
 */
object EditorFindReplaceHelper {

    fun computeMatches(
        text: CharSequence,
        query: String,
        caseSensitive: Boolean,
    ): List<TextRange> {
        if (query.isEmpty()) return emptyList()
        val textStr = text.toString()
        val ignoreCase = !caseSensitive
        val matches = mutableListOf<TextRange>()
        var startIdx = 0
        while (true) {
            val idx = textStr.indexOf(query, startIdx, ignoreCase)
            if (idx < 0) break
            val startPos = EditorPositionHelper.offsetToPosition(text, idx)
            val endPos = EditorPositionHelper.offsetToPosition(text, idx + query.length)
            matches.add(TextRange(startPos, endPos))
            startIdx = idx + query.length
        }
        return matches
    }

    fun replaceAll(
        text: String,
        query: String,
        replacement: String,
        caseSensitive: Boolean,
    ): Pair<String, Int> {
        if (query.isEmpty()) return Pair(text, 0)
        val options = if (caseSensitive) emptySet() else setOf(RegexOption.IGNORE_CASE)
        val regex = Regex.escape(query).toRegex(options)
        val count = regex.findAll(text).count()
        if (count == 0) return Pair(text, 0)
        val newText = text.replace(regex, replacement)
        return Pair(newText, count)
    }
}
