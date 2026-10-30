package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Manages open editor tabs, active session routing, clean-only auto reload on watcher events,
 * and authoritative dirty-buffer tracking.
 * Implements [EditorTabLifecyclePort], [EditorDirtyGuardPort], [EditorDocumentAccessPort],
 * [EditorCommandPort], and [EditorSaveOutcomePort].
 */
class EditorTabsState(
    val profileId: String,
    editorRepository: EditorRepository,
    val documentFactory: EditorDocumentFactory? = null,
    val languageServiceCoordinator: LanguageServiceCoordinator = LanguageServiceCoordinator(),
    val jsonLanguageService: JsonLanguageService = JsonLanguageService(),
    val tsLanguageService: TsJsLanguageService = TsJsLanguageService("typescript"),
    val jsLanguageService: TsJsLanguageService = TsJsLanguageService("javascript"),
) : EditorTabLifecyclePort, EditorDirtyGuardPort, EditorDocumentAccessPort, EditorCommandPort, EditorSaveOutcomePort {

    var editorRepository: EditorRepository = editorRepository
        private set

    private var transportEpoch: Long = 0L
    private val _tabs = MutableStateFlow<List<EditorTab>>(emptyList())
    val tabs: StateFlow<List<EditorTab>> = _tabs.asStateFlow()

    private val _openTabs = MutableStateFlow<List<EditorTabMetadata>>(emptyList())
    override val openTabs: StateFlow<List<EditorTabMetadata>> = _openTabs.asStateFlow()

    private val _activeTabKey = MutableStateFlow<String?>(null)
    val activeTabKey: StateFlow<String?> = _activeTabKey.asStateFlow()

    private val _activeTabId = MutableStateFlow<DocumentId?>(null)
    override val activeTabId: StateFlow<DocumentId?> = _activeTabId.asStateFlow()

    private val _saveOutcomes = MutableStateFlow<Map<DocumentId, FileOperationOutcome<Long>>>(emptyMap())
    override val saveOutcomes: StateFlow<Map<DocumentId, FileOperationOutcome<Long>>> = _saveOutcomes.asStateFlow()

    private val sessions: MutableMap<String, EditorSession> = mutableMapOf()
    private val tabDocumentIds: MutableMap<String, DocumentId> = mutableMapOf()
    private var nextIncarnation: Long = 1L

    private val diagnosticsManager = EditorDiagnosticsManager(
        languageServiceCoordinator, jsonLanguageService, tsLanguageService, jsLanguageService
    )
    private var saveCoordinator = EditorTabSaveCoordinator(editorRepository)
    private val saveMutex = Mutex()

    init {
        installRepositoryGates(editorRepository)
    }

    private fun installRepositoryGates(repo: EditorRepository) {
        repo.documentProvider = { getDocument(it) }
        repo.saveGate = gate@{ id ->
            val key = tabDocumentIds.entries.find { it.value == id }?.key ?: return@gate "Tab is closed"
            val tab = _tabs.value.find { it.key == key } ?: return@gate "Tab is closed"
            when {
                tab.tier.isReadOnly -> "Tier ${tab.tier} is read-only"
                tab.encryptedSessionRequired -> "Encrypted session required; plaintext port save denied"
                !tab.targetAvailable -> tab.error ?: "Target unavailable"
                tab.isSaving -> "Save already in flight"
                sessions[key] == null -> "No retained session"
                sessions[key]?.isFrozen == true -> "Document editing is frozen"
                !isInputAllowed() -> "Input blocked"
                else -> null
            }
        }
    }

    fun rebindRepository(repository: EditorRepository): Boolean {
        if (repository.fileRepository.owner != this.editorRepository.fileRepository.owner) {
            return false
        }
        this.editorRepository = repository
        this.saveCoordinator = EditorTabSaveCoordinator(repository)
        installRepositoryGates(repository)
        transportEpoch++
        return true
    }

    private fun installSession(
        key: String,
        docId: DocumentId,
        target: ProjectTargetRef,
        path: String,
        incarnation: Long,
        content: String,
        mtime: Long?,
        tier: FileTier,
    ) {
        val factory = documentFactory ?: return
        sessions.remove(key)?.close()
        val doc = factory.createDocument(
            id = docId,
            initialText = content,
            initialMtime = mtime ?: 0L,
            readOnly = tier.isReadOnly,
            maxUndoStackSize = if (tier == FileTier.DEGRADED) 50 else 200,
        )
        val session = EditorSession(
            document = doc,
            key = key,
            profileId = profileId,
            target = target,
            path = path,
            sessionIncarnation = incarnation,
            initialMtime = mtime,
            isReadOnly = tier.isReadOnly,
        )
        session.isInputAllowed = { isInputAllowed() }
        sessions[key] = session
        attachSessionListeners(session)
    }

    var isInputAllowed: () -> Boolean = { true }
        set(value) {
            field = value
            sessions.values.forEach { it.isInputAllowed = value }
        }

    val activeTab: EditorTab? get() = _tabs.value.find { it.key == _activeTabKey.value }
    fun getSession(key: String): EditorSession? = sessions[key]

    private fun updateMetadataFlow() {
        _openTabs.value = _tabs.value.map { tab ->
            val docId = tabDocumentIds[tab.key] ?: createDocumentId(tab.target, tab.path, tab.sessionIncarnation)
            val session = sessions[tab.key]
            EditorTabMetadata(
                id = docId,
                target = tab.target,
                relativePath = tab.path,
                title = tab.name,
                isDirty = session?.isDirty ?: tab.isDirty,
                isReadOnly = tab.tier.isReadOnly,
                tier = tab.tier,
                currentRevision = session?.revision ?: tab.modelVersion,
                savedRevision = session?.revision ?: tab.modelVersion,
                serverMtime = tab.mtime,
                isSaving = tab.isSaving,
                isLoading = tab.isLoading,
                error = tab.error,
                rangeWindow = tab.rangeWindow,
            )
        }
        val currentKey = _activeTabKey.value
        _activeTabId.value = if (currentKey != null) tabDocumentIds[currentKey] else null
    }

    private fun createDocumentId(target: ProjectTargetRef, path: String, incarnation: Long): DocumentId {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = editorRepository.fileRepository.owner.baseUrl,
            accountUser = editorRepository.fileRepository.owner.accountUser,
            project = target.project,
            worktreePath = target.worktreePath
        )
        return DocumentId(owner = owner, relativePath = path, tabIncarnation = incarnation)
    }

    // --- EditorDirtyGuardPort Implementation ---

    override fun isFileDirty(target: ProjectTargetRef, path: String): Boolean {
        val tab = _tabs.value.find { it.target.project == target.project && it.target.worktreePath == target.worktreePath && it.path == path }
        if (tab != null && tab.isDirty) return true
        val session = sessions.values.find { it.target.project == target.project && it.target.worktreePath == target.worktreePath && it.path == path }
        return session?.isDirty ?: false
    }

    fun isDirtyFile(target: ProjectTargetRef, path: String): Boolean = isFileDirty(target, path)

    override fun hasDirtyDescendants(target: ProjectTargetRef, dirPath: String): Boolean {
        val prefix = if (dirPath.isEmpty() || dirPath == ".") "" else if (dirPath.endsWith("/")) dirPath else "$dirPath/"
        return _tabs.value.any { tab ->
            tab.target.project == target.project &&
            tab.target.worktreePath == target.worktreePath &&
            tab.isDirty &&
            (prefix.isEmpty() || tab.path.startsWith(prefix) || tab.path == dirPath)
        } || sessions.values.any { session ->
            session.target.project == target.project &&
            session.target.worktreePath == target.worktreePath &&
            session.isDirty &&
            (prefix.isEmpty() || session.path.startsWith(prefix) || session.path == dirPath)
        }
    }

    override fun getDirtyDocumentIds(target: ProjectTargetRef, path: String): List<DocumentId> {
        val prefix = if (path.isEmpty() || path == ".") "" else if (path.endsWith("/")) path else "$path/"
        val list = mutableListOf<DocumentId>()
        for ((key, session) in sessions) {
            if (session.target.project == target.project && session.target.worktreePath == target.worktreePath && session.isDirty) {
                if (prefix.isEmpty() || session.path == path || session.path.startsWith(prefix)) {
                    val docId = tabDocumentIds[key]
                    if (docId != null) list.add(docId)
                }
            }
        }
        return list
    }

    fun isDirtyTarget(target: ProjectTargetRef): Boolean {
        val hasDirtyTab = _tabs.value.any {
            it.target.project == target.project &&
            it.target.worktreePath == target.worktreePath &&
            it.isDirty
        }
        if (hasDirtyTab) return true
        return sessions.values.any {
            it.target.project == target.project &&
            it.target.worktreePath == target.worktreePath &&
            it.isDirty
        }
    }

    // --- EditorDocumentAccessPort Implementation ---

    override fun getDocument(id: DocumentId): EditorDocument? {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return null
        return sessions[entry.key]?.document
    }

    // --- EditorCommandPort Implementation ---

    override fun undo(id: DocumentId) {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return
        sessions[entry.key]?.undo()
    }

    override fun redo(id: DocumentId) {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return
        sessions[entry.key]?.redo()
    }

    override fun find(id: DocumentId, query: String, ignoreCase: Boolean): Boolean {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return false
        val session = sessions[entry.key] ?: return false
        session.openFindReplace(query, caseSensitive = !ignoreCase)
        return session.findReplaceState.totalMatches > 0
    }

    override fun nextMatch(id: DocumentId): Boolean {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return false
        return sessions[entry.key]?.findNext() != null
    }

    override fun previousMatch(id: DocumentId): Boolean {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return false
        return sessions[entry.key]?.findPrevious() != null
    }

    override fun setSelection(id: DocumentId, startLine: Int, startCol: Int, endLine: Int, endCol: Int) {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return
        sessions[entry.key]?.setCursorAndSelection(
            cursor = TextPosition(endLine, endCol),
            sel = TextRange(TextPosition(startLine, startCol), TextPosition(endLine, endCol))
        )
    }

    // --- Tab Lifecycle and Operations ---

    suspend fun openTab(target: ProjectTargetRef, path: String, selection: TextRange? = null) {
        val key = buildEditorTabKey("file", profileId, target.project, target.worktreePath, path)
        val existing = _tabs.value.find { it.key == key }
        if (existing != null) {
            _activeTabKey.value = key
            _activeTabId.value = tabDocumentIds[key]
            if (selection != null) {
                sessions[key]?.setCursorAndSelection(selection.end, selection)
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(selection = selection, cursorPosition = selection.end) else it }
            }
            updateMetadataFlow()
            return
        }

        val name = path.substringAfterLast('/')
        val incarnation = nextIncarnation++
        val docId = createDocumentId(target, path, incarnation)
        tabDocumentIds[key] = docId

        val placeholder = EditorTab(
            key = key, profileId = profileId, target = target, path = path, name = name,
            mtime = 0L, size = 0L, tier = FileTier.NORMAL, isLoading = true, sessionIncarnation = incarnation
        )
        _tabs.value = _tabs.value + placeholder
        _activeTabKey.value = key
        _activeTabId.value = docId
        updateMetadataFlow()

        val loadEpoch = transportEpoch
        when (val result = editorRepository.loadFile(target, path)) {
            is EditorLoadResult.Success -> {
                if (transportEpoch != loadEpoch) return
                // Ensure tab wasn't closed or replaced during load
                val currentTab = _tabs.value.find { it.key == key }
                if (currentTab == null || currentTab.sessionIncarnation != incarnation) {
                    return
                }

                installSession(key, docId, target, path, incarnation, result.content, result.mtime, result.tier)

                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        content = result.content,
                        savedContent = result.content,
                        mtime = result.mtime ?: 0L,
                        size = result.size,
                        tier = result.tier,
                        mime = result.mime,
                        isDirty = false,
                        isLoading = false,
                        binaryBase64 = result.binaryBase64,
                        selection = selection,
                        cursorPosition = selection?.end ?: TextPosition(1, 1),
                        largeFileEof = result.isEof,
                        rangeWindow = result.rangeWindow
                    ) else it
                }
                updateMetadataFlow()

                val s = sessions[key]
                if (s != null) {
                    diagnosticsManager.triggerDiagnostics(profileId, s) { diags ->
                        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(diagnostics = diags) else it }
                        updateMetadataFlow()
                    }
                }
            }
            is EditorLoadResult.TargetUnavailable -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false, error = result.message) else it }
                updateMetadataFlow()
            }
            is EditorLoadResult.Error -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = result.message) else it }
                updateMetadataFlow()
            }
        }
    }

    suspend fun loadLargeFileRange(key: String, offset: Long) {
        val tab = _tabs.value.find { it.key == key } ?: return
        if (tab.tier != FileTier.LARGE) return
        val clampedOffset = maxOf(0L, offset)
        val incarnation = tab.sessionIncarnation
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = true) else it }
        updateMetadataFlow()

        val loadEpoch = transportEpoch
        when (val res = editorRepository.loadFile(tab.target, tab.path, clampedOffset)) {
            is EditorLoadResult.Success -> {
                if (transportEpoch != loadEpoch) return
                val current = _tabs.value.find { it.key == key }
                if (current == null || current.sessionIncarnation != incarnation) return
                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        content = res.content,
                        largeFileOffset = clampedOffset,
                        largeFileEof = res.isEof,
                        isLoading = false,
                        error = null,
                        rangeWindow = res.rangeWindow
                    ) else it
                }
                updateMetadataFlow()
            }
            is EditorLoadResult.Error -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = res.message) else it }
                updateMetadataFlow()
            }
            is EditorLoadResult.TargetUnavailable -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false) else it }
                updateMetadataFlow()
            }
        }
    }

    fun selectTab(key: String) {
        if (_tabs.value.any { it.key == key }) {
            _activeTabKey.value = key
            _activeTabId.value = tabDocumentIds[key]
            updateMetadataFlow()
        }
    }

    fun closeTab(key: String) {
        val remaining = _tabs.value.filter { it.key != key }
        _tabs.value = remaining
        sessions.remove(key)?.close()
        tabDocumentIds.remove(key)
        if (_activeTabKey.value == key) {
            val nextKey = remaining.lastOrNull()?.key
            _activeTabKey.value = nextKey
            _activeTabId.value = if (nextKey != null) tabDocumentIds[nextKey] else null
        }
        updateMetadataFlow()
    }

    fun closeAll() {
        _tabs.value = emptyList()
        _activeTabKey.value = null
        _activeTabId.value = null
        tabDocumentIds.clear()
        sessions.values.forEach { it.close() }
        sessions.clear()
        updateMetadataFlow()
    }

    // --- EditorTabLifecyclePort Close & Conflict ---

    override fun requestCloseTab(id: DocumentId): CloseIntent? {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return null
        val tab = _tabs.value.find { it.key == entry.key } ?: return null
        val session = sessions[entry.key]

        val isDirty = session?.isDirty ?: tab.isDirty
        if (isDirty) {
            return CloseIntent(
                id = id,
                dirtyRevision = session?.revision ?: tab.modelVersion,
                decision = CloseDecision.SAVE
            )
        }
        closeTab(entry.key)
        return null
    }

    override fun confirmClose(intent: CloseIntent) {
        val entry = tabDocumentIds.entries.find { it.value == intent.id } ?: return
        val session = sessions[entry.key]
        when (intent.decision) {
            CloseDecision.DISCARD -> {
                if (session != null && session.revision > intent.dirtyRevision) {
                    return // Newer edits occurred after consent; protect local buffer
                }
                closeTab(entry.key)
            }
            CloseDecision.CANCEL -> { /* user cancelled; tab stays open */ }
            CloseDecision.SAVE -> {
                // Must be triggered asynchronously by coordinator or UI caller via saveTab
            }
        }
    }

    override fun resolveConflict(id: DocumentId, choice: ConflictResolutionChoice) {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return
        when (choice) {
            ConflictResolutionChoice.CANCEL -> {
                _tabs.value = _tabs.value.map { if (it.key == entry.key) it.copy(isConflicted = false) else it }
                updateMetadataFlow()
            }
            ConflictResolutionChoice.RELOAD -> {
                // Discards local edits and reloads server state
                _tabs.value = _tabs.value.map { if (it.key == entry.key) it.copy(isConflicted = false, isStale = false) else it }
                updateMetadataFlow()
            }
            ConflictResolutionChoice.EXPLICIT_OVERWRITE -> {
                // Initiated via forceOverwriteTab
            }
        }
    }

    suspend fun saveTab(
        key: String,
        reservationToken: dev.damhopper.nativeapp.features.files.ReservationToken? = null,
    ): EditorSaveResult = saveMutex.withLock {
        val docId = tabDocumentIds[key]
        val tab = _tabs.value.find { it.key == key }
        val effectiveOwner = if (tab != null) {
            dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(editorRepository.fileRepository.owner, tab.target)
        } else editorRepository.fileRepository.owner
        val acquiredToken = if (reservationToken == null && tab != null) {
            editorRepository.fileRepository.arbiter.tryReserveSave(effectiveOwner, tab.path)
                ?: return@withLock EditorSaveResult.Error("Path '${tab.path}' is currently reserved by another file operation")
        } else null

        val tokenToUse = reservationToken ?: acquiredToken
        try {
            val saveEpoch = transportEpoch
            val res = saveCoordinator.save(
                tabKey = key,
                currentTabProvider = { _tabs.value.find { it.key == key } },
                session = sessions[key],
                transformTab = { transform ->
                    _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it }
                    updateMetadataFlow()
                },
                reservationToken = tokenToUse,
            )
            if (transportEpoch != saveEpoch) {
                return@withLock EditorSaveResult.Error("Transport epoch changed during save")
            }
            if (docId != null) {
                val outcome = when (res) {
                    is EditorSaveResult.Success -> FileOperationOutcome.Confirmed(res.newMtime)
                    is EditorSaveResult.Conflict -> FileOperationOutcome.Rejected("CAS_CONFLICT", res.message, null)
                    is EditorSaveResult.TargetUnavailable -> FileOperationOutcome.NotSubmitted(res.message, null)
                    is EditorSaveResult.UnknownOutcome -> FileOperationOutcome.Unknown(dev.damhopper.nativeapp.features.files.OperationStage.COMMIT_DISPATCHED, "save-$key", res.message, null)
                    is EditorSaveResult.Error -> FileOperationOutcome.Rejected(res.code ?: "ERROR", res.message, null)
                }
                _saveOutcomes.value = _saveOutcomes.value + (docId to outcome)
            }
            res
        } finally {
            if (acquiredToken != null && acquiredToken.state == dev.damhopper.nativeapp.features.files.ReservationState.ACTIVE) {
                try {
                    editorRepository.fileRepository.arbiter.releaseToken(acquiredToken)
                } catch (_: Throwable) {}
            }
        }
    }

    suspend fun saveDocumentWithToken(
        docId: DocumentId,
        token: dev.damhopper.nativeapp.features.files.ReservationToken,
    ): FileOperationOutcome<Long> {
        val entry = tabDocumentIds.entries.find { it.value == docId }
            ?: return FileOperationOutcome.NotSubmitted("Tab not found for document $docId")
        val res = saveTab(entry.key, reservationToken = token)
        return when (res) {
            is EditorSaveResult.Success -> FileOperationOutcome.Confirmed(res.newMtime)
            is EditorSaveResult.Conflict -> FileOperationOutcome.Rejected("CAS_CONFLICT", res.message, null)
            is EditorSaveResult.TargetUnavailable -> FileOperationOutcome.NotSubmitted(res.message, null)
            is EditorSaveResult.UnknownOutcome -> FileOperationOutcome.Unknown(
                dev.damhopper.nativeapp.features.files.OperationStage.COMMIT_DISPATCHED,
                "save-${entry.key}",
                res.message,
                null,
            )
            is EditorSaveResult.Error -> FileOperationOutcome.Rejected(res.code ?: "ERROR", res.message, null)
        }
    }

    fun freezeDocuments(docIds: Set<DocumentId>) {
        for ((key, docId) in tabDocumentIds) {
            if (docId in docIds) {
                sessions[key]?.isFrozen = true
            }
        }
    }

    fun unfreezeDocuments(docIds: Set<DocumentId>) {
        for ((key, docId) in tabDocumentIds) {
            if (docId in docIds) {
                sessions[key]?.isFrozen = false
            }
        }
    }

    fun rekeyPath(target: ProjectTargetRef, oldPath: String, newPath: String) {
        val cleanOld = dev.damhopper.nativeapp.features.files.FileOperationArbiter.normalizeRelativePath(oldPath)
        val cleanNew = dev.damhopper.nativeapp.features.files.FileOperationArbiter.normalizeRelativePath(newPath)
        val oldPrefix = if (cleanOld.isEmpty()) "" else "$cleanOld/"

        val affectedKeys = _tabs.value.filter { tab ->
            tab.target.project == target.project &&
            tab.target.worktreePath == target.worktreePath &&
            (tab.path == cleanOld || tab.path.startsWith(oldPrefix))
        }.map { it.key }

        val tabReplacements = mutableMapOf<String, EditorTab>()
        for (oldKey in affectedKeys) {
            val tab = _tabs.value.find { it.key == oldKey } ?: continue
            val session = sessions[oldKey]
            val oldDocId = tabDocumentIds[oldKey] ?: continue

            val rekeyedRelativePath = if (tab.path == cleanOld) {
                cleanNew
            } else {
                cleanNew + "/" + tab.path.removePrefix(oldPrefix)
            }

            val newKey = buildEditorTabKey("file", profileId, target.project, target.worktreePath, rekeyedRelativePath)
            val newDocId = oldDocId.rekeyed(rekeyedRelativePath)

            if (session != null) {
                session.rekey(newKey, rekeyedRelativePath)
                session.isFrozen = false
                sessions.remove(oldKey)
                sessions[newKey] = session
            }

            tabDocumentIds.remove(oldKey)
            tabDocumentIds[newKey] = newDocId

            val oldOutcome = _saveOutcomes.value[oldDocId]
            if (oldOutcome != null) {
                _saveOutcomes.value = (_saveOutcomes.value - oldDocId) + (newDocId to oldOutcome)
            }

            tabReplacements[oldKey] = tab.copy(
                key = newKey,
                path = rekeyedRelativePath,
                name = rekeyedRelativePath.substringAfterLast('/'),
            )

            if (_activeTabKey.value == oldKey) {
                _activeTabKey.value = newKey
                _activeTabId.value = newDocId
            }
        }
        if (tabReplacements.isNotEmpty()) {
            _tabs.value = _tabs.value.map { tabReplacements[it.key] ?: it }
        }
        updateMetadataFlow()
    }

    fun markPathDeleted(target: ProjectTargetRef, deletedPath: String) {
        val cleanDeleted = dev.damhopper.nativeapp.features.files.FileOperationArbiter.normalizeRelativePath(deletedPath)
        val prefix = if (cleanDeleted.isEmpty()) "" else "$cleanDeleted/"

        val affectedKeys = _tabs.value.filter { tab ->
            tab.target.project == target.project &&
            tab.target.worktreePath == target.worktreePath &&
            (tab.path == cleanDeleted || tab.path.startsWith(prefix))
        }.map { it.key }

        _tabs.value = _tabs.value.map { tab ->
            if (tab.key in affectedKeys) {
                tab.copy(
                    targetAvailable = false,
                    error = "File has been deleted remotely. Changes cannot be saved.",
                )
            } else tab
        }
        updateMetadataFlow()
    }

    suspend fun forceOverwriteTab(
        key: String,
        reservationToken: dev.damhopper.nativeapp.features.files.ReservationToken? = null,
    ): EditorSaveResult = saveMutex.withLock {
        val docId = tabDocumentIds[key]
        val tab = _tabs.value.find { it.key == key }
        val effectiveOwner = if (tab != null) {
            dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(editorRepository.fileRepository.owner, tab.target)
        } else editorRepository.fileRepository.owner
        val acquiredToken = if (reservationToken == null && tab != null) {
            editorRepository.fileRepository.arbiter.tryReserveSave(effectiveOwner, tab.path)
                ?: return@withLock EditorSaveResult.Error("Path '${tab.path}' is currently reserved by another file operation")
        } else null

        val tokenToUse = reservationToken ?: acquiredToken
        try {
            val res = saveCoordinator.forceOverwrite(
                tabKey = key,
                currentTabProvider = { _tabs.value.find { it.key == key } },
                session = sessions[key],
                transformTab = { transform ->
                    _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it }
                    updateMetadataFlow()
                },
                reservationToken = tokenToUse,
            )
            if (docId != null) {
                val outcome = when (res) {
                    is EditorSaveResult.Success -> FileOperationOutcome.Confirmed(res.newMtime)
                    is EditorSaveResult.Conflict -> FileOperationOutcome.Rejected("CAS_CONFLICT", res.message, null)
                    is EditorSaveResult.TargetUnavailable -> FileOperationOutcome.NotSubmitted(res.message, null)
                    is EditorSaveResult.UnknownOutcome -> FileOperationOutcome.Unknown(dev.damhopper.nativeapp.features.files.OperationStage.COMMIT_DISPATCHED, "overwrite-$key", res.message, null)
                    is EditorSaveResult.Error -> FileOperationOutcome.Rejected(res.code ?: "ERROR", res.message, null)
                }
                _saveOutcomes.value = _saveOutcomes.value + (docId to outcome)
            }
            res
        } finally {
            if (acquiredToken != null && acquiredToken.state == dev.damhopper.nativeapp.features.files.ReservationState.ACTIVE) {
                try {
                    editorRepository.fileRepository.arbiter.releaseToken(acquiredToken)
                } catch (_: Throwable) {}
            }
        }
    }

    suspend fun reconcileUnknownSave(key: String): dev.damhopper.nativeapp.features.files.SaveReconciliationResult {
        val tab = _tabs.value.find { it.key == key }
            ?: return dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved("Tab not found: $key")
        val session = sessions[key]
            ?: return dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved("No session for tab: $key")
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(editorRepository.fileRepository.owner, tab.target)
        val quarantined = editorRepository.fileRepository.arbiter.getQuarantinedOperations(effectiveOwner)
            .find { it.path == tab.path }
            ?: return dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved("No quarantined save operation for path ${tab.path}")
        if (quarantined.tabIncarnation != null && tab.sessionIncarnation != quarantined.tabIncarnation) {
            return dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved(
                "Tab incarnation (${tab.sessionIncarnation}) does not match quarantined save incarnation (${quarantined.tabIncarnation})"
            )
        }
        if (quarantined.operationKind != null && quarantined.operationKind != "write") {
            return dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved(
                "Quarantined operation kind '${quarantined.operationKind}' is not a file save"
            )
        }
        val result = editorRepository.fileRepository.reconcileUnknownSave(tab.target, tab.path, quarantined)
        when (result) {
            is dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Reconciled -> {
                val snapshot = session.submittedSnapshot
                val submittedRev = snapshot?.revision ?: quarantined.submittedRevision
                if (submittedRev != null) {
                    val s = snapshot ?: DocumentSaveSnapshot(
                        id = session.id,
                        revision = submittedRev,
                        utf8Bytes = quarantined.submittedBytes ?: session.getText().encodeToByteArray(),
                        mtime = quarantined.baselineMtime ?: 0L,
                    )
                    session.completeSave(result.newMtime, s)
                } else {
                    session.loadServerContent(quarantined.submittedBytes?.decodeToString() ?: session.getText(), result.newMtime)
                }
                val token = editorRepository.fileRepository.arbiter.findActiveReservation(effectiveOwner, tab.path)
                if (token != null) {
                    try {
                        editorRepository.fileRepository.arbiter.abandonQuarantine(token, "Reconciled with server bytes")
                    } catch (_: Throwable) {}
                }
                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        isSaving = false,
                        isDirty = session.isDirty,
                        isStale = false,
                        isConflicted = false,
                        mtime = result.newMtime,
                        error = null,
                    ) else it
                }
                updateMetadataFlow()
            }
            is dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Conflicted -> {
                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        isSaving = false,
                        isConflicted = true,
                        error = "Conflict: ${result.message}",
                    ) else it
                }
                updateMetadataFlow()
            }
            is dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Unresolved -> {
                _tabs.value = _tabs.value.map {
                    if (it.key == key) it.copy(
                        isSaving = false,
                        error = "Unresolved: ${result.message}",
                    ) else it
                }
                updateMetadataFlow()
            }
        }
        return result
    }

    suspend fun reloadTab(key: String, forceDiscardLocal: Boolean = false) {
        val tab = _tabs.value.find { it.key == key } ?: return
        val session = sessions[key] ?: return
        if (session.isDisposed) return
        val initialEpoch = session.editEpoch
        val initialRevision = session.revision
        val incarnation = tab.sessionIncarnation
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = true, isConflicted = false, isStale = false) else it }
        updateMetadataFlow()
        val loadEpoch = transportEpoch
        when (val res = editorRepository.loadFile(tab.target, tab.path)) {
            is EditorLoadResult.Success -> {
                if (transportEpoch != loadEpoch) return
                val currentTab = _tabs.value.find { it.key == key }
                if (currentTab == null || currentTab.sessionIncarnation != incarnation) return

                val currentSession = sessions[key]
                if (currentSession != null && !currentSession.isDisposed) {
                    val editedDuringRequest = currentSession.revision != initialRevision || currentSession.editEpoch != initialEpoch
                    if (editedDuringRequest || (!forceDiscardLocal && currentSession.isDirty)) {
                        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, isStale = true) else it }
                    } else if (res.tier != currentTab.tier) {
                        // Tier changed (growth/shrink): never push a different-capability payload into the
                        // existing authority; replace it with a document that matches the new tier.
                        // Rotate the tab incarnation so every outstanding CloseIntent / save outcome / async
                        // completion captured against the replaced authority is rejected (revisions restart).
                        val newIncarnation = nextIncarnation++
                        val newDocId = createDocumentId(currentTab.target, currentTab.path, newIncarnation)
                        tabDocumentIds[key] = newDocId
                        installSession(key, newDocId, currentTab.target, currentTab.path, newIncarnation, res.content, res.mtime, res.tier)
                        _tabs.value = _tabs.value.map {
                            if (it.key == key) it.copy(
                                content = res.content,
                                savedContent = res.content,
                                mtime = res.mtime ?: 0L,
                                size = res.size,
                                tier = res.tier,
                                mime = res.mime,
                                isDirty = false,
                                isLoading = false,
                                error = null,
                                isConflicted = false,
                                isStale = false,
                                largeFileOffset = 0L,
                                sessionIncarnation = newIncarnation,
                                largeFileEof = res.isEof,
                                rangeWindow = res.rangeWindow,
                            ) else it
                        }
                    } else {
                        currentSession.loadServerContent(res.content, res.mtime)
                        _tabs.value = _tabs.value.map {
                            if (it.key == key) it.copy(
                                content = res.content,
                                savedContent = res.content,
                                mtime = res.mtime ?: 0L,
                                isDirty = false,
                                isLoading = false,
                                error = null,
                                isConflicted = false,
                                isStale = false
                            ) else it
                        }
                    }
                    updateMetadataFlow()
                }
            }
            is EditorLoadResult.Error -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, error = res.message) else it }
                updateMetadataFlow()
            }
            is EditorLoadResult.TargetUnavailable -> {
                _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isLoading = false, targetAvailable = false) else it }
                updateMetadataFlow()
            }
        }
    }

    suspend fun discardAndReloadTab(key: String) {
        reloadTab(key, forceDiscardLocal = true)
    }

    suspend fun handleRemoteFileModified(target: ProjectTargetRef, path: String) {
        val key = buildEditorTabKey("file", profileId, target.project, target.worktreePath, path)
        val tab = _tabs.value.find { it.key == key } ?: return
        val session = sessions[key]
        val isDirty = session?.isDirty ?: tab.isDirty
        if (!isDirty) {
            reloadTab(key)
        } else {
            _tabs.value = _tabs.value.map { if (it.key == key) it.copy(isStale = true) else it }
            updateMetadataFlow()
        }
    }

    /**
     * Flips preview/source mode for [key]. Touches only the mode flag: content, dirty state,
     * revision, undo stack and CAS baseline stay untouched.
     */
    fun toggleMarkdownPreview(key: String) {
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(markdownPreviewMode = !it.markdownPreviewMode) else it }
        updateMetadataFlow()
    }

    fun togglePreview(key: String) = toggleMarkdownPreview(key)

    /**
     * Immutable bounded snapshot of tab [key] for preview renderers, tagged with its document id and revision
     * so consumers can drop results for superseded revisions via [DocumentPreviewSnapshot.isCurrentFor].
     */
    fun previewSnapshot(key: String, maxChars: Int = PREVIEW_SNAPSHOT_MAX_CHARS): DocumentPreviewSnapshot? {
        val tab = _tabs.value.find { it.key == key } ?: return null
        val docId = tabDocumentIds[key] ?: return null
        return buildPreviewSnapshot(docId, tab.modelVersion, tab.content, maxChars)
    }

    fun toggleEncryptedSession(key: String) {
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(encryptedSessionRequired = !it.encryptedSessionRequired) else it }
        updateMetadataFlow()
    }

    fun dismissError(key: String) {
        _tabs.value = _tabs.value.map { if (it.key == key) it.copy(error = null) else it }
        updateMetadataFlow()
    }

    private fun attachSessionListeners(session: EditorSession) {
        session.setOnContentChangeListener { newText, modelVersion, editEpoch ->
            _tabs.value = _tabs.value.map {
                if (it.key == session.key) it.copy(
                    content = newText,
                    isDirty = session.isDirty,
                    modelVersion = modelVersion,
                    editEpoch = editEpoch
                ) else it
            }
            updateMetadataFlow()
            diagnosticsManager.triggerDiagnostics(profileId, session) { diags ->
                _tabs.value = _tabs.value.map { if (it.key == session.key) it.copy(diagnostics = diags) else it }
                updateMetadataFlow()
            }
        }
    }
}
