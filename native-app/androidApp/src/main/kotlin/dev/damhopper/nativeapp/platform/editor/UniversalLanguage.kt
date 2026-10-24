package dev.damhopper.nativeapp.platform.editor

import android.os.Bundle
import dev.damhopper.nativeapp.features.editor.FileTierPolicy
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.lang.Language
import io.github.rosemoe.sora.lang.analysis.AnalyzeManager
import io.github.rosemoe.sora.lang.analysis.AsyncIncrementalAnalyzeManager
import io.github.rosemoe.sora.lang.analysis.IncrementalAnalyzeManager.LineTokenizeResult
import io.github.rosemoe.sora.lang.brackets.SimpleBracketsCollector
import io.github.rosemoe.sora.lang.completion.CompletionPublisher
import io.github.rosemoe.sora.lang.format.Formatter
import io.github.rosemoe.sora.lang.smartEnter.NewlineHandler
import io.github.rosemoe.sora.lang.styling.CodeBlock
import io.github.rosemoe.sora.lang.styling.Span
import io.github.rosemoe.sora.lang.styling.SpanFactory
import io.github.rosemoe.sora.lang.styling.TextStyle
import io.github.rosemoe.sora.text.CharPosition
import io.github.rosemoe.sora.text.Content
import io.github.rosemoe.sora.text.ContentReference
import io.github.rosemoe.sora.widget.SymbolPairMatch
import io.github.rosemoe.sora.widget.schemes.EditorColorScheme

/**
 * Lines longer than this are scanned for lexer state only (no per-token allocation) and are
 * rendered with a single [EditorColorScheme.TEXT_NORMAL] span, e.g. minified JS/JSON.
 */
internal const val LONG_LINE_CHARS = 10_000

/** Sentinel for [Token.bracket] when the token is not a structural bracket. */
internal const val NO_BRACKET = '\u0000'

/**
 * One lexed run of a line. [colorId] is an [EditorColorScheme] style id. [bracket] is set only for
 * single-character `{ } [ ] ( )` tokens found in code (never inside strings or comments), which is
 * how bracket matching ignores literal and commented brackets.
 */
internal data class Token(
    val start: Int,
    val end: Int,
    val colorId: Int,
    val bracket: Char = NO_BRACKET,
    val bold: Boolean = false,
)

internal enum class Family { C_LIKE, HASH, MARKDOWN }

internal enum class Dialect(val family: Family) {
    KOTLIN(Family.C_LIKE),
    JAVA(Family.C_LIKE),
    JAVASCRIPT(Family.C_LIKE),
    TYPESCRIPT(Family.C_LIKE),
    RUST(Family.C_LIKE),
    JSON(Family.C_LIKE),
    PYTHON(Family.HASH),
    SHELL(Family.HASH),
    TOML(Family.HASH),
    YAML(Family.HASH),
    DOCKERFILE(Family.HASH),
    MARKDOWN(Family.MARKDOWN),
}

/** Table row describing one language for the shared scanner. */
internal class LanguageSpec(
    val dialect: Dialect,
    val keywords: Set<String> = emptySet(),
    val literals: Set<String> = emptySet(),
    val literalsIgnoreCase: Boolean = false,
    val nestedComments: Boolean = false,
    val backtickStrings: Boolean = false,
    val tripleDouble: Boolean = false,
    val tripleSingle: Boolean = false,
    /** Triple-quoted strings have no backslash escapes (Kotlin raw strings). */
    val rawTriple: Boolean = false,
    /** Plain `"` / `'` strings may continue on the next line (shell, Rust). */
    val multilineQuotes: Boolean = false,
    /** `'...'` has no backslash escapes (shell, TOML literal strings). */
    val singleQuoteRaw: Boolean = false,
    /** `@name` is an annotation or decorator. */
    val annotations: Boolean = false,
    /** Identifier followed by `(` is a function name. */
    val calls: Boolean = false,
    /** Capitalised identifiers are type names. */
    val typeCase: Boolean = false,
    /** Blocks come from indentation instead of brackets (Python, YAML). */
    val indentScoped: Boolean = false,
    /** `#` starts a comment only at line start or after whitespace (shell, YAML, Dockerfile). */
    val hashNeedsSpace: Boolean = false,
)

private fun words(list: String): Set<String> = list.split(' ').filter { it.isNotEmpty() }.toSet()

private object Specs {
    private val JS_KEYWORDS = words(
        "break case catch class const continue debugger default delete do else export extends finally for " +
            "function if import in instanceof new return super switch this throw try typeof var void while with " +
            "yield let static async await of"
    )
    private val JS_LITERALS = words("true false null undefined NaN Infinity")

    val KOTLIN = LanguageSpec(
        Dialect.KOTLIN,
        keywords = words(
            "as break class continue do else for fun if in interface is object package return super this throw " +
                "try typealias val var when while by catch constructor finally import init abstract annotation " +
                "companion const crossinline enum external final infix inline inner internal lateinit noinline " +
                "open operator override private protected public reified sealed suspend tailrec vararg"
        ),
        literals = words("true false null"),
        nestedComments = true,
        tripleDouble = true,
        rawTriple = true,
        annotations = true,
        calls = true,
        typeCase = true,
    )

    val JAVA = LanguageSpec(
        Dialect.JAVA,
        keywords = words(
            "abstract assert boolean break byte case catch char class const continue default do double else enum " +
                "extends final finally float for goto if implements import instanceof int interface long native new " +
                "package private protected public return short static strictfp super switch synchronized this throw " +
                "throws transient try void volatile while var record sealed permits yield"
        ),
        literals = words("true false null"),
        tripleDouble = true,
        annotations = true,
        calls = true,
        typeCase = true,
    )

    val JAVASCRIPT = LanguageSpec(
        Dialect.JAVASCRIPT,
        keywords = JS_KEYWORDS,
        literals = JS_LITERALS,
        backtickStrings = true,
        annotations = true,
        calls = true,
        typeCase = true,
    )

    val TYPESCRIPT = LanguageSpec(
        Dialect.TYPESCRIPT,
        keywords = JS_KEYWORDS + words(
            "interface type enum implements declare namespace abstract readonly private protected public as is " +
                "keyof infer satisfies any unknown never number string boolean object symbol override"
        ),
        literals = JS_LITERALS,
        backtickStrings = true,
        annotations = true,
        calls = true,
        typeCase = true,
    )

    val RUST = LanguageSpec(
        Dialect.RUST,
        keywords = words(
            "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod " +
                "move mut pub ref return self Self static struct super trait type unsafe use where while " +
                "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str"
        ),
        literals = words("true false"),
        nestedComments = true,
        multilineQuotes = true,
        calls = true,
        typeCase = true,
    )

    val JSON = LanguageSpec(
        Dialect.JSON,
        literals = words("true false null"),
    )

    val PYTHON = LanguageSpec(
        Dialect.PYTHON,
        keywords = words(
            "and as assert async await break class continue def del elif else except finally for from global if " +
                "import in is lambda nonlocal not or pass raise return try while with yield"
        ),
        literals = words("True False None self cls"),
        tripleDouble = true,
        tripleSingle = true,
        annotations = true,
        calls = true,
        typeCase = true,
        indentScoped = true,
    )

    val SHELL = LanguageSpec(
        Dialect.SHELL,
        keywords = words(
            "if then else elif fi for while until do done case esac in function select time return exit break " +
                "continue export local readonly declare unset source alias echo cd set shift eval exec trap test " +
                "printf read"
        ),
        multilineQuotes = true,
        singleQuoteRaw = true,
        hashNeedsSpace = true,
    )

    val TOML = LanguageSpec(
        Dialect.TOML,
        literals = words("true false inf nan"),
        tripleDouble = true,
        tripleSingle = true,
        singleQuoteRaw = true,
    )

    val YAML = LanguageSpec(
        Dialect.YAML,
        literals = words("true false null yes no on off"),
        literalsIgnoreCase = true,
        indentScoped = true,
        hashNeedsSpace = true,
    )

    val DOCKERFILE = LanguageSpec(
        Dialect.DOCKERFILE,
        keywords = words(
            "FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD " +
                "STOPSIGNAL HEALTHCHECK SHELL"
        ),
        hashNeedsSpace = true,
    )

    val MARKDOWN = LanguageSpec(Dialect.MARKDOWN)

    private val byExtension: Map<String, LanguageSpec> = buildMap {
        put("kt", KOTLIN); put("kts", KOTLIN)
        put("java", JAVA)
        put("js", JAVASCRIPT); put("jsx", JAVASCRIPT); put("mjs", JAVASCRIPT); put("cjs", JAVASCRIPT)
        put("ts", TYPESCRIPT); put("tsx", TYPESCRIPT)
        put("rs", RUST)
        put("json", JSON); put("jsonc", JSON)
        put("py", PYTHON); put("pyi", PYTHON)
        put("sh", SHELL); put("bash", SHELL); put("zsh", SHELL)
        put("toml", TOML)
        put("yaml", YAML); put("yml", YAML)
        put("dockerfile", DOCKERFILE)
        put("md", MARKDOWN); put("markdown", MARKDOWN)
    }

    fun forFilename(filename: String): LanguageSpec? {
        val name = filename.substringAfterLast('/').substringAfterLast('\\')
        if (name.equals("Dockerfile", ignoreCase = true) || name.startsWith("Dockerfile.", ignoreCase = true)) {
            return DOCKERFILE
        }
        return byExtension[FileTierPolicy.fileExtension(name)]
    }
}

/** Packed lexer state: low 4 bits mode, next 8 bits depth, next 4 bits aux (string flavour). */
internal object LexState {
    const val NORMAL = 0
    const val BLOCK_COMMENT = 1
    const val STRING = 2
    const val FENCE = 3
    const val CONTINUATION = 4

    const val A_DQ = 1
    const val A_SQ = 2
    const val A_BACKTICK = 3
    const val A_TRIPLE_DQ = 4
    const val A_TRIPLE_SQ = 5
    const val A_RAW = 6

    fun pack(mode: Int, depth: Int, aux: Int): Int =
        if (mode == NORMAL) 0 else (mode and 0xF) or ((depth and 0xFF) shl 4) or ((aux and 0xF) shl 12)

    fun mode(state: Int): Int = state and 0xF
    fun depth(state: Int): Int = (state shr 4) and 0xFF
    fun aux(state: Int): Int = (state shr 12) and 0xF
}

private const val MAX_KEYWORD_LEN = 16
private const val C_BRACKETS = "{}[]()"
private const val OPERATOR_CHARS = "+-*/%=<>!&|^~?:;,."

/**
 * Table-driven single-line scanner shared by every dialect. One instance belongs to one analyzer
 * thread; it keeps per-scan scratch fields and is not thread-safe.
 *
 * Passing a null token sink runs the identical state machine without allocating tokens, which is
 * the state-only path used for lines above [LONG_LINE_CHARS].
 */
internal class LineScanner(private val spec: LanguageSpec) {
    private var line: CharSequence = ""
    private var n = 0
    private var sink: ArrayList<Token>? = null
    private var lastEnd = 0
    private var mode = LexState.NORMAL
    private var depth = 0
    private var aux = 0

    /** Scans [text] from incoming [state]; appends tokens to [tokens] when non-null; returns outgoing state. */
    fun scan(text: CharSequence, state: Int, tokens: ArrayList<Token>?): Int {
        line = text
        n = text.length
        sink = tokens
        lastEnd = 0
        mode = LexState.mode(state)
        depth = LexState.depth(state)
        aux = LexState.aux(state)
        when (spec.dialect.family) {
            Family.C_LIKE -> scanCLike()
            Family.HASH -> scanHash()
            Family.MARKDOWN -> scanMarkdown()
        }
        tokens?.let { if (lastEnd < n) addPlain(it, lastEnd, n) }
        val packed = LexState.pack(mode, depth, aux)
        line = ""
        sink = null
        return packed
    }

    // ---- token output -------------------------------------------------------------------------

    private fun emit(from: Int, to: Int, color: Int, bracket: Char = NO_BRACKET, bold: Boolean = false) {
        val out = sink ?: return
        if (to <= from) return
        if (from > lastEnd) addPlain(out, lastEnd, from)
        if (color == EditorColorScheme.TEXT_NORMAL && bracket == NO_BRACKET && !bold) {
            addPlain(out, from, to)
        } else {
            out.add(Token(from, to, color, bracket, bold))
        }
        lastEnd = to
    }

    private fun addPlain(out: ArrayList<Token>, from: Int, to: Int) {
        val last = out.lastOrNull()
        if (last != null && last.colorId == EditorColorScheme.TEXT_NORMAL && last.bracket == NO_BRACKET &&
            !last.bold && last.end == from
        ) {
            out[out.lastIndex] = last.copy(end = to)
        } else {
            out.add(Token(from, to, EditorColorScheme.TEXT_NORMAL))
        }
    }

    // ---- shared helpers -----------------------------------------------------------------------

    private fun isIdentStart(c: Char) = c.isLetter() || c == '_' || c == '$'
    private fun isIdentPart(c: Char) = c.isLetterOrDigit() || c == '_' || c == '$'

    private fun nextNonBlank(from: Int): Char {
        var j = from
        while (j < n && (line[j] == ' ' || line[j] == '\t')) j++
        return if (j < n) line[j] else NO_BRACKET
    }

    private fun prevNonBlank(from: Int): Char {
        var j = from - 1
        while (j >= 0 && line[j].isWhitespace()) j--
        return if (j >= 0) line[j] else NO_BRACKET
    }

    private fun scanNumber(from: Int): Int {
        var j = from + 1
        while (j < n) {
            val ch = line[j]
            if (ch.isLetterOrDigit() || ch == '_') {
                j++
            } else if (ch == '.' && j + 1 < n && line[j + 1].isDigit()) {
                j++
            } else {
                break
            }
        }
        emit(from, j, EditorColorScheme.IDENTIFIER_VAR)
        return j
    }

    private fun scanOperatorRun(from: Int): Int {
        var j = from + 1
        while (j < n && OPERATOR_CHARS.indexOf(line[j]) >= 0) {
            if (line[j] == '/' && j + 1 < n && (line[j + 1] == '/' || line[j + 1] == '*')) break
            j++
        }
        emit(from, j, EditorColorScheme.OPERATOR)
        return j
    }

    /** Style id for the word `[from, to)` (keyword, constant, call, type, or plain). */
    private fun classifyWord(from: Int, to: Int): Int {
        if (to - from <= MAX_KEYWORD_LEN) {
            var word = line.subSequence(from, to).toString()
            if (word in spec.keywords) return EditorColorScheme.KEYWORD
            if (spec.literalsIgnoreCase) word = word.lowercase()
            if (word in spec.literals) return EditorColorScheme.IDENTIFIER_VAR
        }
        if (spec.calls && nextNonBlank(to) == '(') return EditorColorScheme.FUNCTION_NAME
        if (spec.typeCase && line[from].isUpperCase()) return EditorColorScheme.IDENTIFIER_NAME
        return EditorColorScheme.TEXT_NORMAL
    }

    // ---- strings and comments -----------------------------------------------------------------

    private fun stringEscapes(): Boolean = when (aux) {
        LexState.A_TRIPLE_DQ, LexState.A_TRIPLE_SQ -> !spec.rawTriple
        LexState.A_RAW -> false
        LexState.A_SQ -> !spec.singleQuoteRaw
        else -> true
    }

    private fun closesStringAt(j: Int, ch: Char): Boolean = when (aux) {
        LexState.A_DQ -> ch == '"'
        LexState.A_SQ -> ch == '\''
        LexState.A_BACKTICK -> ch == '`'
        LexState.A_TRIPLE_DQ -> ch == '"' && j + 2 < n && line[j + 1] == '"' && line[j + 2] == '"'
        LexState.A_TRIPLE_SQ -> ch == '\'' && j + 2 < n && line[j + 1] == '\'' && line[j + 2] == '\''
        LexState.A_RAW -> ch == '"' && hashesFollow(j + 1, depth)
        else -> false
    }

    private fun closerLength(): Int = when (aux) {
        LexState.A_TRIPLE_DQ, LexState.A_TRIPLE_SQ -> 3
        LexState.A_RAW -> 1 + depth
        else -> 1
    }

    private fun hashesFollow(from: Int, count: Int): Boolean {
        if (from + count > n) return false
        for (k in 0 until count) if (line[from + k] != '#') return false
        return true
    }

    /** Continues the string in the current [aux] flavour; the literal token starts at [tokenStart]. */
    private fun scanStringBody(tokenStart: Int, from: Int): Int {
        val escapes = stringEscapes()
        var j = from
        while (j < n) {
            val ch = line[j]
            if (ch == '\\' && escapes) {
                j += 2
                continue
            }
            if (closesStringAt(j, ch)) {
                j += closerLength()
                val isJsonKey = spec.dialect == Dialect.JSON && aux == LexState.A_DQ && nextNonBlank(j) == ':'
                mode = LexState.NORMAL
                depth = 0
                aux = 0
                emit(tokenStart, j, if (isJsonKey) EditorColorScheme.KEYWORD else EditorColorScheme.LITERAL)
                return j
            }
            j++
        }
        emit(tokenStart, n, EditorColorScheme.LITERAL)
        if ((aux == LexState.A_DQ || aux == LexState.A_SQ) && !spec.multilineQuotes) {
            mode = LexState.NORMAL
            depth = 0
            aux = 0
        }
        return n
    }

    private fun startQuoted(i: Int, quote: Char): Int {
        mode = LexState.STRING
        depth = 0
        val triple = if (quote == '"') spec.tripleDouble else spec.tripleSingle
        if (triple && i + 2 < n && line[i + 1] == quote && line[i + 2] == quote) {
            aux = if (quote == '"') LexState.A_TRIPLE_DQ else LexState.A_TRIPLE_SQ
            return scanStringBody(i, i + 3)
        }
        aux = if (quote == '"') LexState.A_DQ else LexState.A_SQ
        return scanStringBody(i, i + 1)
    }

    private fun scanBlockComment(tokenStart: Int, from: Int): Int {
        var j = from
        while (j < n) {
            val ch = line[j]
            if (ch == '*' && j + 1 < n && line[j + 1] == '/') {
                j += 2
                depth--
                if (depth <= 0) {
                    mode = LexState.NORMAL
                    depth = 0
                    emit(tokenStart, j, EditorColorScheme.COMMENT)
                    return j
                }
            } else if (spec.nestedComments && ch == '/' && j + 1 < n && line[j + 1] == '*') {
                if (depth < 255) depth++
                j += 2
            } else {
                j++
            }
        }
        emit(tokenStart, n, EditorColorScheme.COMMENT)
        return n
    }

    // ---- C-family and JSON --------------------------------------------------------------------

    private fun scanCLike() {
        var i = 0
        when (mode) {
            LexState.BLOCK_COMMENT -> i = scanBlockComment(0, 0)
            LexState.STRING -> i = scanStringBody(0, 0)
        }
        val rust = spec.dialect == Dialect.RUST
        while (i < n) {
            val c = line[i]
            val next = if (i + 1 < n) line[i + 1] else NO_BRACKET
            when {
                c.isWhitespace() -> i++
                c == '/' && next == '/' -> {
                    emit(i, n, EditorColorScheme.COMMENT)
                    i = n
                }
                c == '/' && next == '*' -> {
                    mode = LexState.BLOCK_COMMENT
                    depth = 1
                    i = scanBlockComment(i, i + 2)
                }
                c == '"' -> i = startQuoted(i, '"')
                c == '\'' -> i = if (rust) scanRustQuote(i) else startQuoted(i, '\'')
                c == '`' && spec.backtickStrings -> {
                    mode = LexState.STRING
                    aux = LexState.A_BACKTICK
                    depth = 0
                    i = scanStringBody(i, i + 1)
                }
                c.isDigit() || (c == '.' && next.isDigit() && !isNumberContext(i - 1)) -> i = scanNumber(i)
                isIdentStart(c) -> i = scanCIdentifier(i, rust)
                c == '@' && spec.annotations && isIdentStart(next) -> {
                    var j = i + 1
                    while (j < n && (isIdentPart(line[j]) || line[j] == '.')) j++
                    emit(i, j, EditorColorScheme.ANNOTATION)
                    i = j
                }
                c == '#' && rust && (next == '[' || (next == '!' && i + 2 < n && line[i + 2] == '[')) -> {
                    val len = if (next == '!') 2 else 1
                    emit(i, i + len, EditorColorScheme.ANNOTATION)
                    i += len
                }
                C_BRACKETS.indexOf(c) >= 0 -> {
                    emit(i, i + 1, EditorColorScheme.TEXT_NORMAL, bracket = c)
                    i++
                }
                OPERATOR_CHARS.indexOf(c) >= 0 -> i = scanOperatorRun(i)
                else -> i++
            }
        }
    }

    private fun isNumberContext(index: Int): Boolean {
        if (index < 0) return false
        val p = line[index]
        return p.isLetterOrDigit() || p == '_' || p == ')' || p == ']'
    }

    private fun scanCIdentifier(from: Int, rust: Boolean): Int {
        var j = from + 1
        while (j < n && isIdentPart(line[j])) j++
        if (rust && j - from <= 2 && j < n && (line[j] == '"' || line[j] == '#')) {
            val prefix = line.subSequence(from, j).toString()
            if (prefix == "r" || prefix == "br" || prefix == "cr") {
                var k = j
                while (k < n && line[k] == '#') k++
                if (k < n && line[k] == '"') {
                    mode = LexState.STRING
                    aux = LexState.A_RAW
                    depth = (k - j).coerceAtMost(255)
                    return scanStringBody(from, k + 1)
                }
            }
        }
        if (sink != null) {
            var color = classifyWord(from, j)
            if (rust && color != EditorColorScheme.KEYWORD && j < n && line[j] == '!' &&
                (j + 1 >= n || line[j + 1] != '=')
            ) {
                color = EditorColorScheme.FUNCTION_NAME
            }
            emit(from, j, color)
        }
        return j
    }

    /** Rust `'` is a char literal (`'x'`, `'\n'`) or a lifetime (`'a`, `'static`). */
    private fun scanRustQuote(i: Int): Int {
        if (i + 1 >= n) return i + 1
        val next = line[i + 1]
        if (next == '\\') return startQuoted(i, '\'')
        val close = i + 1 + if (Character.isHighSurrogate(next) && i + 2 < n) 2 else 1
        if (close < n && line[close] == '\'') {
            emit(i, close + 1, EditorColorScheme.LITERAL)
            return close + 1
        }
        if (isIdentStart(next)) {
            var j = i + 1
            while (j < n && isIdentPart(line[j])) j++
            emit(i, j, EditorColorScheme.ANNOTATION)
            return j
        }
        return i + 1
    }

    // ---- hash-comment family ------------------------------------------------------------------

    private fun isHashWordStart(c: Char) = c.isLetter() || c == '_'

    private fun isHashWordChar(c: Char): Boolean = when (spec.dialect) {
        Dialect.PYTHON, Dialect.DOCKERFILE -> c.isLetterOrDigit() || c == '_'
        Dialect.SHELL -> c.isLetterOrDigit() || c == '_' || c == '-'
        else -> c.isLetterOrDigit() || c == '_' || c == '-' || c == '.'
    }

    private fun yamlQuoteAllowed(i: Int): Boolean {
        val p = prevNonBlank(i)
        return p == NO_BRACKET || ":-,[{?".indexOf(p) >= 0
    }

    /** End (exclusive, trailing blanks trimmed) of a YAML/TOML key starting at [from], or -1. */
    private fun scanKey(from: Int): Int {
        var k = from
        val yaml = spec.dialect == Dialect.YAML
        while (k < n) {
            val ch = line[k]
            if (yaml) {
                if (ch == ':' && (k + 1 >= n || line[k + 1].isWhitespace())) return trimmedEnd(from, k)
                if (ch == '#' && k > from && line[k - 1].isWhitespace()) return -1
                if ("\"'{}[],".indexOf(ch) >= 0) return -1
            } else {
                if (ch == '=') return trimmedEnd(from, k)
                if (!(ch.isLetterOrDigit() || ch == '_' || ch == '-' || ch == '.' || ch == ' ' || ch == '\t')) return -1
            }
            k++
        }
        return -1
    }

    private fun trimmedEnd(from: Int, to: Int): Int {
        var e = to
        while (e > from && line[e - 1].isWhitespace()) e--
        return if (e > from) e else -1
    }

    private fun scanShellVariable(i: Int): Int {
        var j = i + 1
        if (j >= n) {
            emit(i, j, EditorColorScheme.OPERATOR)
            return j
        }
        val ch = line[j]
        when {
            ch == '{' -> {
                val close = line.indexOf('}', j)
                j = if (close < 0) n else close + 1
            }
            isHashWordStart(ch) -> {
                j++
                while (j < n && (line[j].isLetterOrDigit() || line[j] == '_')) j++
            }
            ch.isDigit() || "?#@*!$-".indexOf(ch) >= 0 -> j++
            else -> {
                emit(i, i + 1, EditorColorScheme.OPERATOR)
                return i + 1
            }
        }
        emit(i, j, EditorColorScheme.IDENTIFIER_VAR)
        return j
    }

    /** End (exclusive) of a TOML `[table]` / `[[array]]` header starting at [from], or -1. */
    private fun tableHeaderEnd(from: Int): Int {
        var j = from
        while (j < n && line[j] == '[') j++
        val close = line.indexOf(']', j)
        if (close < 0) return -1
        var end = close
        while (end < n && line[end] == ']') end++
        return end
    }

    private fun scanHash() {
        val dialect = spec.dialect
        val continuation = mode == LexState.CONTINUATION
        var i = 0
        if (mode == LexState.STRING) {
            i = scanStringBody(0, 0)
        } else {
            mode = LexState.NORMAL
        }
        var first = i == 0 && !continuation && mode == LexState.NORMAL
        var keyOk = first && (dialect == Dialect.YAML || dialect == Dialect.TOML)
        var dockerFrom = false
        var endsInComment = false

        while (i < n) {
            val c = line[i]
            if (c.isWhitespace()) {
                i++
                continue
            }
            val wasFirst = first
            first = false
            val atKey = keyOk
            keyOk = false

            if (atKey && sink != null && (c.isLetterOrDigit() || c == '_')) {
                val end = scanKey(i)
                if (end > 0) {
                    emit(i, end, EditorColorScheme.KEYWORD)
                    i = end
                    continue
                }
            }

            val next = if (i + 1 < n) line[i + 1] else NO_BRACKET
            when {
                c == '#' && (!spec.hashNeedsSpace || i == 0 || line[i - 1].isWhitespace()) -> {
                    emit(i, n, EditorColorScheme.COMMENT)
                    endsInComment = true
                    i = n
                }
                c == '"' || c == '\'' ->
                    i = if (dialect != Dialect.YAML || yamlQuoteAllowed(i)) startQuoted(i, c) else i + 1
                c == '\\' -> i = minOf(i + 2, n)
                c == '$' && (dialect == Dialect.SHELL || dialect == Dialect.DOCKERFILE) -> i = scanShellVariable(i)
                c == '@' && dialect == Dialect.PYTHON && isHashWordStart(next) -> {
                    var j = i + 1
                    while (j < n && (line[j].isLetterOrDigit() || line[j] == '_' || line[j] == '.')) j++
                    emit(i, j, EditorColorScheme.ANNOTATION)
                    i = j
                }
                (c == '&' || c == '*') && dialect == Dialect.YAML && isHashWordStart(next) -> {
                    var j = i + 1
                    while (j < n && isHashWordChar(line[j])) j++
                    emit(i, j, EditorColorScheme.IDENTIFIER_VAR)
                    i = j
                }
                c == '!' && dialect == Dialect.YAML && (next == '!' || isHashWordStart(next)) -> {
                    var j = i + 1
                    while (j < n && !line[j].isWhitespace()) j++
                    emit(i, j, EditorColorScheme.ANNOTATION)
                    i = j
                }
                c == '[' && dialect == Dialect.TOML && wasFirst && tableHeaderEnd(i) > 0 -> {
                    val end = tableHeaderEnd(i)
                    emit(i, end, EditorColorScheme.ANNOTATION)
                    i = end
                }
                C_BRACKETS.indexOf(c) >= 0 -> {
                    emit(i, i + 1, EditorColorScheme.TEXT_NORMAL, bracket = c)
                    i++
                }
                c == '-' && dialect == Dialect.YAML && (next == NO_BRACKET || next.isWhitespace()) -> {
                    emit(i, i + 1, EditorColorScheme.OPERATOR)
                    keyOk = atKey
                    i++
                }
                c.isDigit() -> i = scanNumber(i)
                isHashWordStart(c) -> {
                    var j = i + 1
                    while (j < n && isHashWordChar(line[j])) j++
                    if (sink != null) {
                        val color = when {
                            dialect == Dialect.DOCKERFILE && wasFirst -> {
                                val instruction = line.subSequence(i, j).toString().uppercase()
                                dockerFrom = instruction == "FROM"
                                if (instruction in spec.keywords) EditorColorScheme.KEYWORD else EditorColorScheme.TEXT_NORMAL
                            }
                            dialect == Dialect.DOCKERFILE ->
                                if (dockerFrom && line.subSequence(i, j).toString().equals("AS", ignoreCase = true)) {
                                    EditorColorScheme.KEYWORD
                                } else {
                                    EditorColorScheme.TEXT_NORMAL
                                }
                            dialect == Dialect.SHELL && wasFirst && j < n && line[j] == '=' ->
                                EditorColorScheme.IDENTIFIER_VAR
                            else -> classifyWord(i, j)
                        }
                        emit(i, j, color)
                    }
                    i = j
                }
                OPERATOR_CHARS.indexOf(c) >= 0 -> i = scanOperatorRun(i)
                else -> i++
            }
        }

        if (dialect == Dialect.DOCKERFILE && mode == LexState.NORMAL && !endsInComment && endsWithBackslash()) {
            mode = LexState.CONTINUATION
        }
    }

    private fun endsWithBackslash(): Boolean {
        var j = n - 1
        while (j >= 0 && line[j].isWhitespace()) j--
        return j >= 0 && line[j] == '\\'
    }

    // ---- Markdown -----------------------------------------------------------------------------

    private fun scanMarkdown() {
        var p = 0
        while (p < n && p < 4 && line[p] == ' ') p++
        if (mode == LexState.FENCE) {
            val fenceChar = if (aux == 1) '`' else '~'
            if (p <= 3 && p < n && line[p] == fenceChar) {
                var k = p
                while (k < n && line[k] == fenceChar) k++
                var rest = k
                while (rest < n && line[rest].isWhitespace()) rest++
                if (k - p >= depth && rest >= n) {
                    mode = LexState.NORMAL
                    depth = 0
                    aux = 0
                }
            }
            emit(0, n, EditorColorScheme.LITERAL)
            return
        }
        mode = LexState.NORMAL
        if (p >= n) return
        val c = line[p]

        if ((c == '`' || c == '~') && p <= 3) {
            var k = p
            while (k < n && line[k] == c) k++
            if (k - p >= 3) {
                mode = LexState.FENCE
                aux = if (c == '`') 1 else 2
                depth = (k - p).coerceAtMost(255)
                emit(0, n, EditorColorScheme.LITERAL)
                return
            }
        }
        if (c == '#') {
            var k = p
            while (k < n && line[k] == '#') k++
            if (k - p <= 6 && (k >= n || line[k] == ' ' || line[k] == '\t')) {
                emit(0, n, EditorColorScheme.KEYWORD, bold = true)
                return
            }
        }
        if (c == '>') {
            emit(0, n, EditorColorScheme.COMMENT)
            return
        }
        if (isThematicBreak(p, c)) {
            emit(0, n, EditorColorScheme.OPERATOR)
            return
        }
        if (sink == null) return
        val marker = listMarkerEnd(p)
        if (marker > 0) {
            emit(p, marker, EditorColorScheme.ANNOTATION)
            scanMarkdownInline(marker)
        } else {
            scanMarkdownInline(p)
        }
    }

    private fun isThematicBreak(from: Int, c: Char): Boolean {
        if ("-*_=".indexOf(c) < 0) return false
        var count = 0
        for (k in from until n) {
            val ch = line[k]
            if (ch == c) count++ else if (!ch.isWhitespace()) return false
        }
        return count >= 3
    }

    private fun listMarkerEnd(p: Int): Int {
        val c = line[p]
        if ((c == '-' || c == '+' || c == '*') && (p + 1 >= n || line[p + 1] == ' ' || line[p + 1] == '\t')) return p + 1
        var k = p
        while (k < n && line[k].isDigit()) k++
        if (k > p && k - p <= 9 && k < n && (line[k] == '.' || line[k] == ')') &&
            (k + 1 >= n || line[k + 1] == ' ' || line[k + 1] == '\t')
        ) {
            return k + 1
        }
        return 0
    }

    private fun scanMarkdownInline(from: Int) {
        var i = from
        while (i < n) {
            val c = line[i]
            when {
                c == '\\' -> i += 2
                c == '`' -> {
                    var run = i
                    while (run < n && line[run] == '`') run++
                    val len = run - i
                    val close = findBacktickRun(run, len)
                    if (close >= 0) {
                        emit(i, close + len, EditorColorScheme.LITERAL)
                        i = close + len
                    } else {
                        i = run
                    }
                }
                (c == '*' || c == '_') && i + 1 < n && line[i + 1] == c &&
                    (c == '*' || i == 0 || !line[i - 1].isLetterOrDigit()) -> {
                    var close = -1
                    var k = i + 2
                    while (k + 1 < n) {
                        if (line[k] == c && line[k + 1] == c) {
                            close = k
                            break
                        }
                        k++
                    }
                    if (close > i + 2) {
                        emit(i, close + 2, EditorColorScheme.TEXT_NORMAL, bold = true)
                        i = close + 2
                    } else {
                        i += 2
                    }
                }
                c == '[' -> {
                    val closeText = line.indexOf(']', i + 1)
                    if (closeText > 0 && closeText + 1 < n && line[closeText + 1] == '(') {
                        val closeUrl = line.indexOf(')', closeText + 2)
                        if (closeUrl > 0) {
                            emit(i, closeUrl + 1, EditorColorScheme.IDENTIFIER_VAR)
                            i = closeUrl + 1
                            continue
                        }
                    }
                    i++
                }
                else -> i++
            }
        }
    }

    private fun findBacktickRun(from: Int, length: Int): Int {
        var k = from
        while (k < n) {
            if (line[k] == '`') {
                var run = k
                while (run < n && line[run] == '`') run++
                if (run - k == length) return k
                k = run
            } else {
                k++
            }
        }
        return -1
    }
}

/** Per-line input to [computeStructure]; lets bracket/indent analysis run on any token source. */
internal interface StructureSource {
    val lineCount: Int
    fun tokens(line: Int): List<Token>?
    /** Lexer state after [line], or null when unknown. */
    fun stateAfter(line: Int): Int?
    fun lineLength(line: Int): Int
    fun lineBreakLength(line: Int): Int
    /** Column of the first non-whitespace char, or -1 for blank lines. */
    fun firstContentColumn(line: Int): Int
}

private class OpenBracket(val char: Char, val line: Int, val column: Int, val offset: Int)
private class IndentHeader(val indent: Int, val line: Int, val length: Int)

private fun closerFor(open: Char): Char = when (open) {
    '{' -> '}'
    '[' -> ']'
    else -> ')'
}

private fun newBlock(startLine: Int, startColumn: Int, endLine: Int, endColumn: Int): CodeBlock =
    CodeBlock().apply {
        this.startLine = startLine
        this.startColumn = startColumn
        this.endLine = endLine
        this.endColumn = endColumn
    }

/**
 * Walks stored per-line tokens (never re-lexing) to pair brackets and build code blocks.
 *
 * Only tokens flagged as brackets are considered, so brackets inside strings and comments never
 * match. Bracket languages emit a block per multi-line pair; indentation languages (Python, YAML)
 * derive blocks from leading whitespace. [onPair] receives absolute char offsets of each matched
 * pair. Returns null when [isActive] reports cancellation.
 */
internal fun computeStructure(
    spec: LanguageSpec,
    source: StructureSource,
    isActive: () -> Boolean,
    onPair: (open: Int, close: Int) -> Unit,
): List<CodeBlock>? {
    val blocks = ArrayList<CodeBlock>()
    val stack = ArrayList<OpenBracket>()
    val headers = ArrayList<IndentHeader>()
    val indentBlocks = spec.indentScoped
    val bracketDepthGuard = spec.dialect == Dialect.PYTHON
    var offset = 0
    var prevIndent = -1
    var prevLine = -1
    var prevLength = 0

    for (line in 0 until source.lineCount) {
        if (!isActive()) return null
        val tokens = source.tokens(line)
        val length = source.lineLength(line)
        val depthAtStart = stack.size

        if (tokens != null) {
            for (token in tokens) {
                val ch = token.bracket
                if (ch == NO_BRACKET) continue
                if (ch == '{' || ch == '[' || ch == '(') {
                    stack.add(OpenBracket(ch, line, token.start, offset + token.start))
                    continue
                }
                var match = stack.lastIndex
                while (match >= 0 && closerFor(stack[match].char) != ch) match--
                if (match < 0) continue
                val open = stack[match]
                while (stack.size > match) stack.removeAt(stack.lastIndex)
                onPair(open.offset, offset + token.start)
                if (!indentBlocks && open.line != line) {
                    blocks.add(newBlock(open.line, open.column, line, token.start))
                }
            }
        }

        if (indentBlocks) {
            val column = source.firstContentColumn(line)
            val startsInCode = line == 0 ||
                (source.stateAfter(line - 1)?.let { LexState.mode(it) == LexState.NORMAL } ?: true)
            val insideBrackets = bracketDepthGuard && depthAtStart > 0
            val commentOnly = column >= 0 && tokens?.firstOrNull { it.end > column }?.colorId == EditorColorScheme.COMMENT
            if (column >= 0 && startsInCode && !insideBrackets && !commentOnly) {
                while (headers.isNotEmpty() && headers.last().indent >= column) {
                    val header = headers.removeAt(headers.lastIndex)
                    blocks.add(newBlock(header.line, header.length, prevLine, prevLength))
                }
                if (prevLine >= 0 && column > prevIndent) {
                    headers.add(IndentHeader(prevIndent, prevLine, prevLength))
                }
                prevIndent = column
                prevLine = line
                prevLength = length
            }
        }
        offset += length + source.lineBreakLength(line)
    }

    while (headers.isNotEmpty()) {
        val header = headers.removeAt(headers.lastIndex)
        blocks.add(newBlock(header.line, header.length, prevLine, prevLength))
    }
    return blocks
}

/** Incremental analyzer: state is a packed [Int], tokens are [Token]s kept per line for block analysis. */
internal class UniversalAnalyzeManager(private val spec: LanguageSpec) :
    AsyncIncrementalAnalyzeManager<Int, Token>() {

    private val scanner = LineScanner(spec)

    override fun getInitialState(): Int = 0

    override fun stateEquals(state: Int, another: Int): Boolean = state == another

    override fun tokenizeLine(line: CharSequence, state: Int, lineIndex: Int): LineTokenizeResult<Int, Token> {
        if (line.length > LONG_LINE_CHARS) {
            val outgoing = scanner.scan(line, state, null)
            return LineTokenizeResult(
                outgoing,
                listOf(Token(0, line.length, EditorColorScheme.TEXT_NORMAL)),
            )
        }
        val tokens = ArrayList<Token>()
        val outgoing = scanner.scan(line, state, tokens)
        return LineTokenizeResult(outgoing, tokens)
    }

    override fun generateSpansForLine(tokens: LineTokenizeResult<Int, Token>): List<Span> {
        val list = tokens.tokens
        if (list.isNullOrEmpty()) {
            return listOf(SpanFactory.obtain(0, TextStyle.makeStyle(EditorColorScheme.TEXT_NORMAL)))
        }
        val spans = ArrayList<Span>(list.size)
        var previousStyle = 0L
        for ((index, token) in list.withIndex()) {
            val style = if (token.bold) {
                TextStyle.makeStyle(token.colorId, 0, true, false, false)
            } else {
                TextStyle.makeStyle(token.colorId)
            }
            if (index > 0 && style == previousStyle) continue
            spans.add(SpanFactory.obtain(token.start, style))
            previousStyle = style
        }
        return spans
    }

    override fun computeBlocks(text: Content, delegate: CodeBlockAnalyzeDelegate): List<CodeBlock> {
        if (spec.dialect == Dialect.MARKDOWN) return emptyList()
        val collector = SimpleBracketsCollector()
        val blocks = computeStructure(
            spec = spec,
            source = ContentSource(text),
            isActive = { delegate.isNotCancelled() },
            onPair = { open, close -> collector.add(open, close) },
        ) ?: return emptyList()
        withReceiver { receiver -> receiver.updateBracketProvider(this@UniversalAnalyzeManager, collector) }
        return blocks
    }

    private inner class ContentSource(private val text: Content) : StructureSource {
        override val lineCount: Int get() = text.lineCount
        override fun tokens(line: Int): List<Token>? = getState(line)?.tokens
        override fun stateAfter(line: Int): Int? = getState(line)?.state
        override fun lineLength(line: Int): Int = text.getLine(line).length
        override fun lineBreakLength(line: Int): Int = text.getLine(line).lineSeparator.length
        override fun firstContentColumn(line: Int): Int {
            val content = text.getLine(line)
            for (column in 0 until content.length) if (!content[column].isWhitespace()) return column
            return -1
        }
    }
}

/**
 * Dependency-free syntax highlighting [Language] for Kotlin, Java, JS/TS, Rust, Python, shell,
 * TOML, YAML, Dockerfile, JSON and Markdown. Use [forFile]; one instance per editor attach because
 * Sora destroys the analyzer when the language is replaced.
 */
internal class UniversalLanguage private constructor(internal val spec: LanguageSpec) : Language {

    private val manager = UniversalAnalyzeManager(spec)

    internal val dialect: Dialect get() = spec.dialect

    override fun getAnalyzeManager(): AnalyzeManager = manager

    override fun getInterruptionLevel(): Int = Language.INTERRUPTION_LEVEL_STRONG

    override fun requireAutoComplete(
        content: ContentReference,
        position: CharPosition,
        publisher: CompletionPublisher,
        extraArguments: Bundle,
    ) = Unit

    override fun getIndentAdvance(content: ContentReference, line: Int, column: Int): Int = 0

    override fun useTab(): Boolean = false

    override fun getFormatter(): Formatter = EmptyLanguage.EmptyFormatter.INSTANCE

    override fun getSymbolPairs(): SymbolPairMatch = EmptyLanguage.EMPTY_SYMBOL_PAIRS

    override fun getNewlineHandlers(): Array<NewlineHandler> = emptyArray()

    override fun destroy() = Unit

    companion object {
        /** Language for [filename] (path or bare name), or [EmptyLanguage] when the type is unknown. */
        fun forFile(filename: String): Language {
            val spec = Specs.forFilename(filename) ?: return EmptyLanguage()
            return UniversalLanguage(spec)
        }
    }
}
