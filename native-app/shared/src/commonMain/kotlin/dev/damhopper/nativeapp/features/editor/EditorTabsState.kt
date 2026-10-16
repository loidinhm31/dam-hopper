package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Manages open editor tabs, active session routing, clean-only auto reload on watcher events,
 * and authoritative dirty-buffer tracking for ReplaceCoordinator and safe saves.
 */
class EditorTabsState(
    val profileId: String,
    val editorRepository: EditorRepository,
    val languageServiceCoordinator: LanguageServiceCoordinator = LanguageServiceCoordinator(),
    val jsonLanguageService: JsonLanguageService = JsonLanguageService(),
    val tsLanguageService: TsJsLanguageService = TsJsLanguageService("typescript"),
    val jsLanguageService: TsJsLanguageService = TsJsLanguageService("javascript"),
) {
    private val _tabs = MutableStateFlow<List<EditorTab>>(emptyList())
    val tabs: StateFlow<List<EditorTab>> = _tabs.asStateFlow()

    private val _activeTabKey = MutableStateFlow<String?>(null)
    val activeTabKey: StateFlow<String?> = _activeTabKey.asStateFlow()

    private val sessions: MutableMap<String, EditorSession> = mutableMapOf()
    private var nextIncarnation: Long = 1L
    private val diagnosticsManager = EditorDiagnosticsManager(
        languageServiceCoordinator, jsonLanguageService, tsLanguageService, jsLanguageService
    )
    private val saveCoordinator = EditorTabSaveCoordinator(editorRepository)
    private val saveMutex = Mutex()

    val activeTab: EditorTab? get() = _tabs.value.find { it.key == _activeTabKey.value }
    fun getSession(key: String): EditorSession? = sessions[key]

    fun isDirtyFile(target: ProjectTargetRef, path: String): Boolean {
        val tab = _tabs.value.find { it.target.project == target.project && it.target.worktreePath == target.worktreePath && it.path == path }
        if (tab != null && tab.isDirty) return true
        val session = sessions.values.find { it.target.project == target.project && it.target.worktreePath == target.worktreePath && it.path == path }
        return session?.isDirty ?: false
    }

    suspend fun openTab(target: ProjectTargetRef, path: String, selection: TextRange? = null) {
        val key = buildEditorTabKey("file", profileId, target.project, target.worktreePath, path)
        val existing = _tabs.value.find { it.key == key }
        if (existing != null) {
            _activeTabKey.value = key
            if (selection != null) {
                sessions[key]?.setCursorAndSelection(selection.end, selection)
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(selection = selection, cursorPosition = selection.end) else it }
            }
            return
        }

        val name = path.substringAfterLast('/')
        val incarnation = nextIncarnation++
        val placeholder = EditorTab(
            key = key, profileId = profileId, target = target, path = path, name = name,
            mtime = 0L, size = 0L, tier = FileTier.NORMAL, isLoading = true, sessionIncarnation = incarnation
        )
        _tabs.value = _tabs.value + placeholder
        _activeTabKey.value = key

        when (val result = editorRepository.loadFile(target, path)) {
            is EditorLoadResult.Success -> {
                val session = EditorSession(
                    key = key, profileId = profileId, target = target, path = path,
                    sessionIncarnation = incarnation, initialContent = result.content,
                    initialMtime = result.mtime, isReadOnly = result.tier.isReadOnly
                )
                sessions[key] = session
                attachSessionListeners(session)

                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        content = result.content, savedContent = result.content, mtime = result.mtime ?: 0L,
                        size = result.size, tier = result.tier, mime = result.mime, isDirty = false,
                        isLoading = false, binaryBase64 = result.binaryBase64, selection = selection,
                        cursorPosition = selection?.end ?: TextPosition(1, 1), largeFileEof = result.isEof
                    ) else it
                }
                diagnosticsManager.triggerDiagnostics(profileId, session) { diags ->
                    _tabs.value = _tabs.value.map { if (it.key == key) it.copy(diagnostics = diags) else it }
                }
            }
            is EditorLoadResult.TargetUnavailable -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false, error = result.message) else it }
            is EditorLoadResult.Error -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = result.message) else it }
        }
    }

    suspend fun loadLargeFileRange(key: String, offset: Long) {
        val tab = _tabs.value.find { it.key == key } ?: return
        if (tab.tier != FileTier.LARGE) return
        val clampedOffset = maxOf(0L, offset)
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = true) else it }
        when (val res = editorRepository.loadFile(tab.target, tab.path, clampedOffset)) {
            is EditorLoadResult.Success -> {
                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(content = res.content, largeFileOffset = clampedOffset, largeFileEof = res.isEof, isLoading = false, error = null) else it
                }
            }
            is EditorLoadResult.Error -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = res.message) else it }
            is EditorLoadResult.TargetUnavailable -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false) else it }
        }
    }

    fun selectTab(key: String) { if (_tabs.value.any { it.key == key }) _activeTabKey.value = key }

    fun closeTab(key: String) {
        val remaining = _tabs.value.filter { it.key != key }
        _tabs.value = remaining
        sessions.remove(key)?.close()
        if (_activeTabKey.value == key) _activeTabKey.value = remaining.lastOrNull()?.key
    }

    fun closeAll() {
        _tabs.value = emptyList(); _activeTabKey.value = null
        sessions.values.forEach { it.close() }; sessions.clear()
    }

    suspend fun saveTab(key: String): EditorSaveResult = saveMutex.withLock {
        saveCoordinator.save(
            tabKey = key, currentTabProvider = { _tabs.value.find { it.key == key } },
            session = sessions[key], transformTab = { transform -> _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it } }
        )
    }

    suspend fun forceOverwriteTab(key: String): EditorSaveResult = saveMutex.withLock {
        saveCoordinator.forceOverwrite(
            tabKey = key, currentTabProvider = { _tabs.value.find { it.key == key } },
            session = sessions[key], transformTab = { transform -> _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it } }
        )
    }
    suspend fun reloadTab(key: String, forceDiscardLocal: Boolean = false) {
        val tab = _tabs.value.find { it.key == key } ?: return
        val session = sessions[key] ?: return
        if (session.isDisposed) return
        val initialEpoch = session.editEpoch
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = true, isConflicted = false, isStale = false) else it }

        when (val res = editorRepository.loadFile(tab.target, tab.path)) {
            is EditorLoadResult.Success -> {
                val current = sessions[key]
                if (current != null && !current.isDisposed) {
                    if (!forceDiscardLocal && (current.editEpoch != initialEpoch || current.isDirty)) {
                        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, isStale = true) else it }
                    } else {
                        current.loadServerContent(res.content, res.mtime)
                        _tabs.value = _tabs.value.map {
                            if (it.key == key) it.copy(content = res.content, savedContent = res.content, mtime = res.mtime ?: 0L, isDirty = false, isLoading = false, error = null, isConflicted = false, isStale = false) else it
                        }
                    }
                }
            }
            is EditorLoadResult.Error -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = res.message) else it }
            is EditorLoadResult.TargetUnavailable -> _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false) else it }
        }
    }

    suspend fun discardAndReloadTab(key: String) { reloadTab(key, forceDiscardLocal = true) }

    suspend fun handleRemoteFileModified(target: ProjectTargetRef, path: String) {
        val key = buildEditorTabKey("file", profileId, target.project, target.worktreePath, path)
        val tab = _tabs.value.find { it.key == key } ?: return
        if (!tab.isDirty) reloadTab(key) else _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isStale = true) else it }
    }

    fun toggleMarkdownPreview(key: String) { _tabs.value = _tabs.value.map { if (it.key == key) it.copy(markdownPreviewMode = !it.markdownPreviewMode) else it } }
    fun toggleEncryptedSession(key: String) { _tabs.value = _tabs.value.map { if (it.key == key) it.copy(encryptedSessionRequired = !it.encryptedSessionRequired) else it } }
    fun dismissError(key: String) { _tabs.value = _tabs.value.map { if (it.key == key) it.copy(error = null) else it } }

    private fun attachSessionListeners(session: EditorSession) {
        session.setOnContentChangeListener { newText, modelVersion, editEpoch ->
            _tabs.value = _tabs.value.map {
                if (it.key == session.key) it.copy(content = newText, isDirty = session.isDirty, modelVersion = modelVersion, editEpoch = editEpoch) else it
            }
            diagnosticsManager.triggerDiagnostics(profileId, session) { diags ->
                _tabs.value = _tabs.value.map { if (it.key == session.key) it.copy(diagnostics = diags) else it }
            }
        }
    }
}
