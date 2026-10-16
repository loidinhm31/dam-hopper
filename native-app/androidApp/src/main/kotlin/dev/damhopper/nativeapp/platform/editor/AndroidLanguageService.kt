package dev.damhopper.nativeapp.platform.editor

import dev.damhopper.nativeapp.features.editor.JsonLanguageService
import dev.damhopper.nativeapp.features.editor.LanguageService
import dev.damhopper.nativeapp.features.editor.LanguageServiceCoordinator
import dev.damhopper.nativeapp.features.editor.TsJsLanguageService

/**
 * Android platform-facing coordinator for file intelligence services.
 * Dispatches to offline JSON and TS/JS language services according to file extension.
 */
class AndroidLanguageService(
    val coordinator: LanguageServiceCoordinator = LanguageServiceCoordinator(),
    private val jsonService: JsonLanguageService = JsonLanguageService(),
    private val tsService: TsJsLanguageService = TsJsLanguageService("typescript"),
    private val jsService: TsJsLanguageService = TsJsLanguageService("javascript"),
) {
    fun findServiceForFile(filePath: String): LanguageService? {
        val lower = filePath.lowercase()
        return when {
            lower.endsWith(".json") -> jsonService
            lower.endsWith(".ts") || lower.endsWith(".tsx") -> tsService
            lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs") -> jsService
            else -> null
        }
    }
}
