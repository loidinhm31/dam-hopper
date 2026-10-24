package dev.damhopper.nativeapp.platform.editor

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import dev.damhopper.nativeapp.features.editor.EditorDocument
import dev.damhopper.nativeapp.features.editor.NativeEditorSurfaceHost
import io.github.rosemoe.sora.widget.CodeEditor

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
    fontSize: Int = 14,
    useJavaSyntax: Boolean = false,
    modifier: Modifier = Modifier,
) {
    key(document) {
        AndroidView(
            factory = { context ->
                CodeEditor(context).apply {
                    isUndoEnabled = true
                    isLineNumberEnabled = true
                    setTextSize(fontSize.toFloat())
                    (document as? AndroidEditorDocument)?.let { androidDoc ->
                        androidDoc.attachEditor(this, useJavaSyntax = useJavaSyntax)
                        androidDoc.restoreViewState(this)
                    }
                }
            },
            update = { editor ->
                val inputAllowed = (document as? AndroidEditorDocument)?.isInputAllowed?.invoke() ?: true
                val effectiveReadOnly = isReadOnly || document.isReadOnly.value || !inputAllowed
                if (editor.isEditable != !effectiveReadOnly) {
                    editor.isEditable = !effectiveReadOnly
                    if (!inputAllowed) {
                        editor.hideSoftInput()
                        editor.clearFocus()
                    }
                }
                editor.setTextSize(fontSize.toFloat())
            },
            onRelease = { editor ->
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
    val useJava = document.id.relativePath.endsWith(".java", ignoreCase = true)
    AndroidEditorSurfaceView(
        document = document,
        isReadOnly = isReadOnly,
        useJavaSyntax = useJava,
        modifier = modifier
    )
}
