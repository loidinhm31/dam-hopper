package dev.damhopper.nativeapp.features.editor

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray

enum class DiagnosticSeverity {
    ERROR,
    WARNING,
    INFO,
    HINT
}

@Serializable
data class TextSpan(
    val startLine: Int,
    val startColumn: Int,
    val endLine: Int,
    val endColumn: Int
) {
    init {
        require(startLine >= 1) { "startLine must be >= 1" }
        require(startColumn >= 1) { "startColumn must be >= 1" }
        require(endLine >= startLine) { "endLine ($endLine) must be >= startLine ($startLine)" }
    }
}

@Serializable
data class Diagnostic(
    val span: TextSpan,
    val message: String,
    val severity: DiagnosticSeverity = DiagnosticSeverity.ERROR,
    val source: String? = null
)

@Serializable
data class CompletionItem(
    val label: String,
    val kind: String = "property",
    val detail: String? = null,
    val insertText: String? = null
)

@Serializable
data class DocumentSymbol(
    val name: String,
    val kind: String,
    val span: TextSpan
)

data class LanguageServiceRequest(
    val requestId: Long,
    val filePath: String,
    val languageId: String,
    val content: String,
    val modelVersion: Long
)

data class LanguageServiceResponse<T>(
    val requestId: Long,
    val modelVersion: Long,
    val data: T
)

/**
 * Common contract for language intelligence services.
 * Realizes non-browser diagnostics, completions, and navigation.
 */
interface LanguageService {
    val languageId: String
    val isAvailableOffline: Boolean

    fun validateDocument(request: LanguageServiceRequest): LanguageServiceResponse<List<Diagnostic>>
    fun getCompletions(request: LanguageServiceRequest, line: Int, column: Int): LanguageServiceResponse<List<CompletionItem>>
    fun getSymbols(request: LanguageServiceRequest): LanguageServiceResponse<List<DocumentSymbol>>
}

/**
 * Concrete offline non-browser JSON language service.
 * Parses JSON via kotlinx.serialization, extracts hierarchy symbols, and produces syntax diagnostics.
 */
class JsonLanguageService(
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = false }
) : LanguageService {

    override val languageId: String = "json"
    override val isAvailableOffline: Boolean = true

    override fun validateDocument(request: LanguageServiceRequest): LanguageServiceResponse<List<Diagnostic>> {
        val diagnostics = mutableListOf<Diagnostic>()
        if (request.content.isBlank()) {
            return LanguageServiceResponse(request.requestId, request.modelVersion, emptyList())
        }

        try {
            json.parseToJsonElement(request.content)
        } catch (e: Exception) {
            val message = e.message ?: "Invalid JSON syntax"
            // Simple line parsing heuristic from error message or fallback to line 1
            val line = extractLineNumber(message)
            diagnostics.add(
                Diagnostic(
                    span = TextSpan(line, 1, line, 1),
                    message = message,
                    severity = DiagnosticSeverity.ERROR,
                    source = "json-syntax"
                )
            )
        }

        return LanguageServiceResponse(request.requestId, request.modelVersion, diagnostics)
    }

    override fun getCompletions(
        request: LanguageServiceRequest,
        line: Int,
        column: Int
    ): LanguageServiceResponse<List<CompletionItem>> {
        // Basic offline JSON keyword completions
        val items = listOf(
            CompletionItem("true", "keyword", "JSON boolean true"),
            CompletionItem("false", "keyword", "JSON boolean false"),
            CompletionItem("null", "keyword", "JSON null literal"),
            CompletionItem("{}", "snippet", "Empty JSON object", "{\n  \$0\n}"),
            CompletionItem("[]", "snippet", "Empty JSON array", "[\n  \$0\n]")
        )
        return LanguageServiceResponse(request.requestId, request.modelVersion, items)
    }

    override fun getSymbols(request: LanguageServiceRequest): LanguageServiceResponse<List<DocumentSymbol>> {
        val symbols = mutableListOf<DocumentSymbol>()
        try {
            val element = json.parseToJsonElement(request.content)
            extractSymbolsRecursive(element, "", 1, symbols)
        } catch (_: Exception) {
            // Partial/invalid JSON returns whatever symbols were collected
        }
        return LanguageServiceResponse(request.requestId, request.modelVersion, symbols)
    }

    private fun extractSymbolsRecursive(
        element: JsonElement,
        prefix: String,
        lineEstimate: Int,
        out: MutableList<DocumentSymbol>
    ) {
        when (element) {
            is JsonObject -> {
                for ((key, value) in element) {
                    val name = if (prefix.isEmpty()) key else "$prefix.$key"
                    out.add(
                        DocumentSymbol(
                            name = name,
                            kind = "property",
                            span = TextSpan(lineEstimate, 1, lineEstimate, 1)
                        )
                    )
                    extractSymbolsRecursive(value, name, lineEstimate, out)
                }
            }
            is JsonArray -> {
                for ((idx, item) in element.withIndex()) {
                    val name = "$prefix[$idx]"
                    extractSymbolsRecursive(item, name, lineEstimate, out)
                }
            }
            else -> {}
        }
    }

    private fun extractLineNumber(errorMsg: String): Int {
        val regex = Regex("""line (\d+)""")
        val match = regex.find(errorMsg)
        return match?.groupValues?.get(1)?.toIntOrNull()?.coerceAtLeast(1) ?: 1
    }
}

/**
 * Audit record of TypeScript/JavaScript language service gap under non-browser constraints.
 */
object TypeScriptLanguageServiceAudit {
    const val STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"
    const val REQUIRED_CAPABILITIES = "Semantic diagnostics, type hover, definition navigation, auto-imports"
    const val CURRENT_WEB_IMPLEMENTATION = "Monaco web-worker running embedded TypeScript compiler service (monaco-setup.ts)"
    const val BLOCKER_RATIONALE = "The remote DamHopper Rust server does not host a Language Server Protocol (LSP) daemon, and browser web-workers are excluded by user mandate. Native Android realization requires an embedded QuickJS/Hermes JavaScript engine or server-side LSP routing. Phase 09 TypeScript semantic features remain gated until an approved architecture decision."
}

/**
 * Coordinator managing asynchronous language service requests with monotonic watermark fencing.
 * Older responses arriving after a document has mutated are safely dropped.
 */
class LanguageServiceCoordinator {
    private var lastRequestId: Long = 0L
    private val fileWatermarks: MutableMap<String, Long> = mutableMapOf()

    fun nextRequestId(): Long = ++lastRequestId

    fun registerRequest(filePath: String, modelVersion: Long): Long {
        val reqId = nextRequestId()
        fileWatermarks[filePath] = modelVersion
        return reqId
    }

    fun isResponseValid(filePath: String, responseModelVersion: Long): Boolean {
        val currentVersion = fileWatermarks[filePath] ?: return false
        return responseModelVersion >= currentVersion
    }
}
