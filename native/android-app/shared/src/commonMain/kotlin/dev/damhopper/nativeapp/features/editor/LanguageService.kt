package dev.damhopper.nativeapp.features.editor

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray

enum class DiagnosticSeverity { ERROR, WARNING, INFO, HINT }

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
data class DocumentSymbol(val name: String, val kind: String, val span: TextSpan)

data class LanguageServiceRequest(
    val requestId: Long,
    val filePath: String,
    val languageId: String,
    val content: String,
    val modelVersion: Long,
    val documentKey: String = filePath,
    val sessionIncarnation: Long = 1L,
    val ownerProfileId: String = "",
    val editEpoch: Long = 1L,
)

data class LanguageServiceResponse<T>(
    val requestId: Long,
    val modelVersion: Long,
    val data: T,
    val sessionIncarnation: Long = 1L,
    val ownerProfileId: String = "",
    val editEpoch: Long = 1L,
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
            return LanguageServiceResponse(request.requestId, request.modelVersion, emptyList(), request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
        }
        try {
            json.parseToJsonElement(request.content)
        } catch (e: Exception) {
            val msg = e.message ?: "Invalid JSON syntax"
            val line = Regex("""line (\d+)""").find(msg)?.groupValues?.get(1)?.toIntOrNull()?.coerceAtLeast(1) ?: 1
            diagnostics.add(Diagnostic(TextSpan(line, 1, line, 1), msg, DiagnosticSeverity.ERROR, "json-syntax"))
        }
        return LanguageServiceResponse(request.requestId, request.modelVersion, diagnostics, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }

    override fun getCompletions(request: LanguageServiceRequest, line: Int, column: Int): LanguageServiceResponse<List<CompletionItem>> {
        val items = listOf(
            CompletionItem("true", "keyword", "JSON boolean true"),
            CompletionItem("false", "keyword", "JSON boolean false"),
            CompletionItem("null", "keyword", "JSON null literal"),
            CompletionItem("{}", "snippet", "Empty JSON object", "{\n  \$0\n}"),
            CompletionItem("[]", "snippet", "Empty JSON array", "[\n  \$0\n]")
        )
        return LanguageServiceResponse(request.requestId, request.modelVersion, items, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }

    override fun getSymbols(request: LanguageServiceRequest): LanguageServiceResponse<List<DocumentSymbol>> {
        val symbols = mutableListOf<DocumentSymbol>()
        try { extractSymbols(json.parseToJsonElement(request.content), "", symbols) } catch (_: Exception) {}
        return LanguageServiceResponse(request.requestId, request.modelVersion, symbols, request.sessionIncarnation, request.ownerProfileId, request.editEpoch)
    }

    private fun extractSymbols(element: JsonElement, prefix: String, out: MutableList<DocumentSymbol>) {
        when (element) {
            is JsonObject -> for ((k, v) in element) {
                val name = if (prefix.isEmpty()) k else "$prefix.$k"
                out.add(DocumentSymbol(name, "property", TextSpan(1, 1, 1, 1)))
                extractSymbols(v, name, out)
            }
            is JsonArray -> for ((idx, item) in element.withIndex()) {
                val name = "$prefix[$idx]"
                extractSymbols(item, name, out)
            }
            else -> {}
        }
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

data class QualifiedFencingWatermark(val modelVersion: Long, val editEpoch: Long)

/**
 * Coordinator managing asynchronous language service requests with multi-dimensional fencing.
 * Older responses arriving after a document has mutated, closed/reopened, or switched owner/worktree
 * are safely discarded.
 */
class LanguageServiceCoordinator {
    private var lastRequestId: Long = 0L
    private val fileWatermarks: MutableMap<String, Long> = mutableMapOf()
    private val qualifiedWatermarks: MutableMap<Triple<String, Long, String>, QualifiedFencingWatermark> = mutableMapOf()

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

    fun registerQualifiedRequest(
        documentKey: String,
        sessionIncarnation: Long,
        ownerProfileId: String,
        modelVersion: Long,
        editEpoch: Long
    ): Long {
        val reqId = nextRequestId()
        fileWatermarks[documentKey] = modelVersion
        qualifiedWatermarks[Triple(documentKey, sessionIncarnation, ownerProfileId)] = QualifiedFencingWatermark(modelVersion, editEpoch)
        return reqId
    }

    fun isQualifiedResponseValid(
        documentKey: String,
        sessionIncarnation: Long,
        ownerProfileId: String,
        responseModelVersion: Long,
        responseEditEpoch: Long
    ): Boolean {
        val expected = qualifiedWatermarks[Triple(documentKey, sessionIncarnation, ownerProfileId)] ?: return false
        return responseModelVersion == expected.modelVersion && responseEditEpoch == expected.editEpoch
    }
}
