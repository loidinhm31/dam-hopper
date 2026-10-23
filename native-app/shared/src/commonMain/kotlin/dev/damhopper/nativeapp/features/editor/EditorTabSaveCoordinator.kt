package dev.damhopper.nativeapp.features.editor

/**
 * Handles save and force-overwrite orchestration for editor tabs using atomic transforms
 * on the latest current tab state to prevent clobbering edits made while requests are in-flight.
 * Guarantees that newer edits made after save dispatch remain dirty.
 */
class EditorTabSaveCoordinator(
    private val editorRepository: EditorRepository,
) {
    suspend fun save(
        tabKey: String,
        currentTabProvider: () -> EditorTab?,
        session: EditorSession?,
        transformTab: ((EditorTab) -> EditorTab) -> Unit,
    ): EditorSaveResult {
        val tab = currentTabProvider() ?: return EditorSaveResult.Error("Tab not found")
        if (session == null || session.isDisposed || tab.isSaving || !session.isDirty || tab.tier.isReadOnly || !tab.targetAvailable) {
            return EditorSaveResult.Error("Tab cannot be saved")
        }

        val snapshot = session.snapshotSave() ?: return EditorSaveResult.Error("Nothing to save")
        val submittedText = snapshot.utf8Bytes.decodeToString()
        transformTab { it.copy(isSaving = true, submittedContent = submittedText, error = null) }

        val result = editorRepository.saveFile(
            target = tab.target,
            path = tab.path,
            submittedContent = submittedText,
            expectedMtime = tab.mtime,
            encryptedRequested = tab.encryptedSessionRequired
        )
        if (session.isDisposed) {
            transformTab { it.copy(isSaving = false, submittedContent = null) }
            return result
        }

        when (result) {
            is EditorSaveResult.Success -> {
                session.completeSave(result.newMtime, snapshot)
                transformTab { current ->
                    current.copy(
                        isSaving = false,
                        isDirty = session.isDirty,
                        isStale = false,
                        isConflicted = false,
                        savedContent = submittedText,
                        mtime = result.newMtime,
                        submittedContent = null
                    )
                }
            }
            is EditorSaveResult.Conflict -> {
                session.abortSave()
                transformTab { it.copy(isSaving = false, isConflicted = true, submittedContent = null) }
            }
            is EditorSaveResult.UnknownOutcome, is EditorSaveResult.TargetUnavailable, is EditorSaveResult.Error -> {
                session.abortSave()
                val err = if (result is EditorSaveResult.UnknownOutcome) result.message
                else if (result is EditorSaveResult.Error) result.message
                else "Save failed"
                transformTab { it.copy(isSaving = false, error = err, submittedContent = null) }
            }
        }
        return result
    }

    suspend fun forceOverwrite(
        tabKey: String,
        currentTabProvider: () -> EditorTab?,
        session: EditorSession?,
        transformTab: ((EditorTab) -> EditorTab) -> Unit,
    ): EditorSaveResult {
        val tab = currentTabProvider() ?: return EditorSaveResult.Error("Tab not found")
        if (session == null || session.isDisposed || tab.isSaving || tab.tier.isReadOnly || !tab.targetAvailable || !session.isInputAllowed()) {
            return EditorSaveResult.Error("Cannot overwrite")
        }

        val snapshot = session.document.snapshotForSave()
        val submittedText = snapshot.utf8Bytes.decodeToString()
        transformTab { it.copy(isSaving = true, submittedContent = submittedText) }

        val result = editorRepository.forceOverwrite(
            target = tab.target,
            path = tab.path,
            submittedContent = submittedText,
            encryptedRequested = tab.encryptedSessionRequired
        )
        if (session.isDisposed) {
            transformTab { it.copy(isSaving = false, submittedContent = null) }
            return result
        }

        if (result is EditorSaveResult.Success) {
            session.completeSave(result.newMtime, snapshot)
            transformTab { current ->
                current.copy(
                    isSaving = false,
                    isDirty = session.isDirty,
                    isStale = false,
                    isConflicted = false,
                    savedContent = submittedText,
                    mtime = result.newMtime,
                    submittedContent = null,
                    error = null
                )
            }
        } else {
            val err = if (result is EditorSaveResult.Error) result.message else "Overwrite failed"
            transformTab {
                it.copy(
                    isSaving = false,
                    isConflicted = (result is EditorSaveResult.Conflict),
                    error = err,
                    submittedContent = null
                )
            }
        }
        return result
    }
}
