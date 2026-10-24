package dev.damhopper.nativeapp.features.editor

/**
 * Offline syntax intelligence service for TypeScript and JavaScript files.
 * Provides offline keyword completion, bracket balance diagnostics, and symbol extraction.
 *
 * Full semantic compiler analysis and type inference remain gated per [TypeScriptLanguageServiceAudit].
 */
class TsJsLanguageService(
    override val languageId: String = "typescript"
) : LanguageService {

    override val isAvailableOffline: Boolean = true

    private val keywords = listOf(
        "const", "let", "var", "function", "return", "if", "else", "for", "while",
        "switch", "case", "break", "continue", "default", "try", "catch", "finally",
        "throw", "class", "interface", "type", "enum", "extends", "implements",
        "import", "export", "from", "as", "default", "async", "await", "yield",
        "new", "this", "super", "typeof", "instanceof", "void", "null", "undefined",
        "true", "false"
    )

    override fun validateDocument(request: LanguageServiceRequest): LanguageServiceResponse<List<Diagnostic>> {
        val diagnostics = mutableListOf<Diagnostic>()
        if (request.content.isBlank()) {
            return LanguageServiceResponse(request.requestId, request.modelVersion, emptyList(), request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
        }

        val stack = ArrayDeque<Pair<Char, Int>>()
        var currentLine = 1
        var inSingleQuote = false
        var inDoubleQuote = false
        var inBacktick = false
        var inLineComment = false
        var inBlockComment = false
        var escaped = false

        val chars = request.content.toCharArray()
        var i = 0
        while (i < chars.size) {
            val c = chars[i]
            if (c == '\n') {
                currentLine++
                inLineComment = false
                inSingleQuote = false
                inDoubleQuote = false
                escaped = false
            } else if (inLineComment) {
                // Ignore everything inside line comment until newline
            } else if (inBlockComment) {
                if (c == '*' && i + 1 < chars.size && chars[i + 1] == '/') {
                    inBlockComment = false
                    i++
                }
            } else if (inSingleQuote) {
                if (!escaped && c == '\'') inSingleQuote = false
                escaped = !escaped && c == '\\'
            } else if (inDoubleQuote) {
                if (!escaped && c == '"') inDoubleQuote = false
                escaped = !escaped && c == '\\'
            } else if (inBacktick) {
                if (!escaped && c == '`') inBacktick = false
                escaped = !escaped && c == '\\'
            } else {
                if (c == '/' && i + 1 < chars.size && chars[i + 1] == '/') {
                    inLineComment = true
                    i++
                } else if (c == '/' && i + 1 < chars.size && chars[i + 1] == '*') {
                    inBlockComment = true
                    i++
                } else if (c == '\'') {
                    inSingleQuote = true
                    escaped = false
                } else if (c == '"') {
                    inDoubleQuote = true
                    escaped = false
                } else if (c == '`') {
                    inBacktick = true
                    escaped = false
                } else {
                    when (c) {
                        '{', '(', '[' -> stack.addLast(Pair(c, currentLine))
                        '}' -> if (stack.isEmpty() || stack.removeLast().first != '{') {
                            diagnostics.add(Diagnostic(TextSpan(currentLine, 1, currentLine, 1), "[Syntax Heuristic] Unmatched closing brace '}'", DiagnosticSeverity.WARNING, "$languageId-syntax-heuristic"))
                        }
                        ')' -> if (stack.isEmpty() || stack.removeLast().first != '(') {
                            diagnostics.add(Diagnostic(TextSpan(currentLine, 1, currentLine, 1), "[Syntax Heuristic] Unmatched closing parenthesis ')'", DiagnosticSeverity.WARNING, "$languageId-syntax-heuristic"))
                        }
                        ']' -> if (stack.isEmpty() || stack.removeLast().first != '[') {
                            diagnostics.add(Diagnostic(TextSpan(currentLine, 1, currentLine, 1), "[Syntax Heuristic] Unmatched closing bracket ']'", DiagnosticSeverity.WARNING, "$languageId-syntax-heuristic"))
                        }
                    }
                }
            }
            i++
        }

        while (stack.isNotEmpty()) {
            val (unclosed, line) = stack.removeLast()
            diagnostics.add(Diagnostic(TextSpan(line, 1, line, 1), "[Syntax Heuristic] Unclosed opening delimiter '$unclosed'", DiagnosticSeverity.WARNING, "$languageId-syntax-heuristic"))
        }

        return LanguageServiceResponse(request.requestId, request.modelVersion, diagnostics, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }

    override fun getCompletions(
        request: LanguageServiceRequest,
        line: Int,
        column: Int
    ): LanguageServiceResponse<List<CompletionItem>> {
        val items = keywords.map { kw ->
            CompletionItem(label = kw, kind = "keyword", detail = "$languageId keyword (heuristic)")
        }
        return LanguageServiceResponse(request.requestId, request.modelVersion, items, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }

    override fun getSymbols(request: LanguageServiceRequest): LanguageServiceResponse<List<DocumentSymbol>> {
        val symbols = mutableListOf<DocumentSymbol>()
        val lines = request.content.lines()
        val declRegex = Regex("""(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z0-9_$]+)""")

        for ((idx, lineText) in lines.withIndex()) {
            val match = declRegex.find(lineText.trim())
            if (match != null) {
                val kind = match.groupValues[1]
                val name = match.groupValues[2]
                val lineNum = idx + 1
                symbols.add(
                    DocumentSymbol(
                        name = name,
                        kind = kind,
                        span = TextSpan(lineNum, 1, lineNum, 1)
                    )
                )
            }
        }
        return LanguageServiceResponse(request.requestId, request.modelVersion, symbols, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }
}
