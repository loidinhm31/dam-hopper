package dev.damhopper.nativeapp.platform.editor

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import dev.damhopper.nativeapp.features.editor.EditorDocument
import dev.damhopper.nativeapp.features.editor.FileTierPolicy
import dev.damhopper.nativeapp.features.editor.LocalEditorInputAllowed
import dev.damhopper.nativeapp.features.editor.NativeEditorSurfaceHost
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.lang.Language
import io.github.rosemoe.sora.langs.java.JavaLanguage
import io.github.rosemoe.sora.widget.CodeEditor
import io.github.rosemoe.sora.widget.schemes.SchemeDarcula

/**
 * Degradation-first language policy. Documents above [FileTierPolicy.NORMAL_MAX_BYTES] UTF-8 bytes
 * get [EmptyLanguage] regardless of file type so no background analyzer runs on them. Otherwise
 * `.java` keeps [JavaLanguage] and every other file goes through [UniversalLanguage.forFile].
 */
internal fun isEditorDegraded(document: EditorDocument): Boolean =
    document.getBudgetMetrics().utf8Length > FileTierPolicy.NORMAL_MAX_BYTES

internal fun editorLanguageFor(relativePath: String, degraded: Boolean): Language = when {
    degraded -> EmptyLanguage()
    FileTierPolicy.fileExtension(relativePath).equals("java", ignoreCase = true) -> JavaLanguage()
    else -> UniversalLanguage.forFile(relativePath)
}

/**
 * Tracks which side of the 1 MiB UTF-8 boundary the installed language was chosen for.
 * [reassess] yields a new language only when the effective degradation state flipped, so normal
 * typing never re-attaches a lexer.
 */
internal class EditorLanguageGate(private val document: EditorDocument) {
    private var installedDegraded = false
    var editor: CodeEditor? = null

    /** Language for the first attach; records the degradation state it was chosen for. */
    fun initialLanguage(): Language {
        installedDegraded = isEditorDegraded(document)
        return editorLanguageFor(document.id.relativePath, installedDegraded)
    }

    /** Replacement language when the degradation state flipped since the last call, else null. */
    fun reassess(): Language? {
        val degraded = isEditorDegraded(document)
        if (degraded == installedDegraded) return null
        installedDegraded = degraded
        return editorLanguageFor(document.id.relativePath, degraded)
    }
}

/**
 * Outcome of combining the panel-level input gate with the document's own state. [inputAllowed] is false
 * whenever either gate blocks input, independent of read-only; [effectiveReadOnly] additionally folds in
 * natural read-only state, so reopening the gate restores exactly the document's own editability.
 */
internal data class EditorInputGate(val inputAllowed: Boolean, val effectiveReadOnly: Boolean)

internal fun resolveEditorInputGate(
    panelInputAllowed: Boolean,
    documentInputAllowed: Boolean,
    surfaceReadOnly: Boolean,
    documentReadOnly: Boolean,
): EditorInputGate {
    val inputAllowed = panelInputAllowed && documentInputAllowed
    return EditorInputGate(
        inputAllowed = inputAllowed,
        effectiveReadOnly = surfaceReadOnly || documentReadOnly || !inputAllowed,
    )
}

/**
 * Android native editor surface view mounting Sora Editor [CodeEditor] via [AndroidView].
 *
 * Connects an [AndroidEditorDocument] authority to a mounted widget.
 * Preserves selection, scroll, and undo across attach/detach cycles and releases
 * widget references, IME composition, and listeners on view disposal.
 */
@Composable
fun AndroidEditorSurfaceView(
    document: EditorDocument,
    isReadOnly: Boolean = false,
    isInputAllowed: Boolean = true,
    fontSize: Int = 14,
    modifier: Modifier = Modifier,
) {
    key(document) {
        val languageGate = remember { EditorLanguageGate(document) }
        LaunchedEffect(document) {
            document.revision.collect {
                languageGate.reassess()?.let { language -> languageGate.editor?.setEditorLanguage(language) }
            }
        }
        AndroidView(
            factory = { context ->
                CodeEditor(context).apply {
                    isUndoEnabled = true
                    colorScheme = SchemeDarcula()
                    isLineNumberEnabled = true
                    setPinLineNumber(true)
                    isHighlightCurrentLine = true
                    isHighlightBracketPair = true
                    isBlockLineEnabled = true
                    isHighlightCurrentBlock = true
                    setCursorAnimationEnabled(true)
                    setTextSize(fontSize.toFloat())
                    languageGate.editor = this
                    (document as? AndroidEditorDocument)?.let { androidDoc ->
                        androidDoc.attachEditor(this, languageGate.initialLanguage())
                        androidDoc.restoreViewState(this)
                    }
                }
            },
            update = { editor ->
                val gate = resolveEditorInputGate(
                    panelInputAllowed = isInputAllowed,
                    documentInputAllowed = (document as? AndroidEditorDocument)?.isInputAllowed?.invoke() ?: true,
                    surfaceReadOnly = isReadOnly,
                    documentReadOnly = document.isReadOnly.value,
                )
                val inputAllowed = gate.inputAllowed
                val effectiveReadOnly = gate.effectiveReadOnly
                if (editor.isEditable != !effectiveReadOnly) {
                    editor.isEditable = !effectiveReadOnly
                }
                // Applied unconditionally: an already read-only document must still drop IME/focus.
                if (!inputAllowed) {
                    editor.hideSoftInput()
                    editor.clearFocus()
                }
                editor.setTextSize(fontSize.toFloat())
            },
            onRelease = { editor ->
                languageGate.editor = null
                (document as? AndroidEditorDocument)?.detachEditor(editor)
            },
            modifier = modifier.fillMaxSize()
        )
    }
}

/**
 * Default [NativeEditorSurfaceHost] injection for Android applications.
 */
val AndroidNativeEditorSurfaceHost: NativeEditorSurfaceHost = { document, isReadOnly, modifier ->
    AndroidEditorSurfaceView(
        document = document,
        isReadOnly = isReadOnly,
        isInputAllowed = LocalEditorInputAllowed.current,
        modifier = modifier
    )
}
