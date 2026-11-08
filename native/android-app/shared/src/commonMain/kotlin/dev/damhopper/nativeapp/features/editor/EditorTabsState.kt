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
interface CanonicalReplacementListener {
    fun onCanonicalDocumentReplaced(canonicalKey: String, successor: EditorDocument)
}

/**
 * Retained registry managing canonical documents, explicit alias/view leases,
 * document-level save admission, atomic tier replacements, and disposal lifecycle.
 */
class CanonicalDocumentRegistry(
    val defaultDocumentFactory: EditorDocumentFactory? = null,
) {
    private val documents = mutableMapOf<String, EditorDocument>()
    private val saveLocks = mutableMapOf<String, Boolean>()
    private val activeAliases = mutableMapOf<String, MutableSet<String>>()
    private val replacementListeners = mutableListOf<CanonicalReplacementListener>()

    fun registerReplacementListener(listener: CanonicalReplacementListener) {
        replacementListeners.add(listener)
    }

    fun unregisterReplacementListener(listener: CanonicalReplacementListener) {
        replacementListeners.remove(listener)
    }

    fun registerAlias(canonicalKey: String, aliasId: String) {
        activeAliases.getOrPut(canonicalKey) { mutableSetOf() }.add(aliasId)
    }

    fun unregisterAlias(canonicalKey: String, aliasId: String) {
        activeAliases[canonicalKey]?.remove(aliasId)
        if (activeAliases[canonicalKey]?.isEmpty() == true) {
            activeAliases.remove(canonicalKey)
        }
    }

    fun rekeyAlias(oldCanonicalKey: String, oldAliasId: String, newCanonicalKey: String, newAliasId: String) {
        unregisterAlias(oldCanonicalKey, oldAliasId)
        registerAlias(newCanonicalKey, newAliasId)
    }

    fun hasSurvivingAliases(canonicalKey: String, excludingAliasId: String): Boolean {
        val set = activeAliases[canonicalKey] ?: return false
        return set.any { it != excludingAliasId }
    }

    fun getDocument(canonicalKey: String): EditorDocument? = documents[canonicalKey]

    fun getAllDocuments(): Map<String, EditorDocument> = documents.toMap()

    fun getOrCreateDocument(
        canonicalKey: String,
        fallbackDocId: DocumentId,
        content: String,
        mtime: Long?,
        tier: FileTier,
        factory: EditorDocumentFactory? = defaultDocumentFactory,
    ): Pair<EditorDocument, Boolean> {
        val existing = documents[canonicalKey]
        if (existing != null) {
            if (existing.isClosed) {
                documents.remove(canonicalKey)
            } else if (tier.isReadOnly == existing.isReadOnly.value || existing.isDirty.value || isSaveInProgress(canonicalKey)) {
                return Pair(existing, false)
            } else {
                val effFactory = factory ?: defaultDocumentFactory
                    ?: throw IllegalStateException("No EditorDocumentFactory available to create canonical document for $canonicalKey")
                val created = effFactory.createDocument(
                    id = fallbackDocId,
                    initialText = content,
                    initialMtime = mtime ?: 0L,
                    readOnly = tier.isReadOnly,
                    maxUndoStackSize = if (tier == FileTier.DEGRADED) 50 else 200,
                )
                replaceDocumentAtomic(canonicalKey, created)
                return Pair(created, true)
            }
        }
        val effFactory = factory ?: defaultDocumentFactory
            ?: throw IllegalStateException("No EditorDocumentFactory available to create canonical document for $canonicalKey")
        val created = effFactory.createDocument(
            id = fallbackDocId,
            initialText = content,
            initialMtime = mtime ?: 0L,
            readOnly = tier.isReadOnly,
            maxUndoStackSize = if (tier == FileTier.DEGRADED) 50 else 200,
        )
        documents[canonicalKey] = created
        return Pair(created, true)
    }

    fun registerDocument(canonicalKey: String, doc: EditorDocument) {
        documents[canonicalKey] = doc
    }

    fun acquireAliasLease(canonicalKey: String, aliasId: String): AliasLeaseToken? {
        val doc = documents[canonicalKey] ?: return null
        registerAlias(canonicalKey, aliasId)
        return doc.acquireAliasLease(aliasId)
    }

    fun releaseAliasLease(canonicalKey: String, token: AliasLeaseToken, doc: EditorDocument? = null) {
        val targetDoc = doc ?: documents[canonicalKey]
        targetDoc?.releaseAliasLease(token)
        unregisterAlias(canonicalKey, token.aliasId)
        checkAndPruneDocument(canonicalKey, targetDoc)
    }

    fun acquireViewLease(canonicalKey: String, surfaceId: String): ViewLeaseToken? {
        val doc = documents[canonicalKey] ?: return null
        return doc.acquireViewLease(surfaceId)
    }

    fun releaseViewLease(canonicalKey: String, token: ViewLeaseToken, doc: EditorDocument? = null) {
        val targetDoc = doc ?: documents[canonicalKey]
        targetDoc?.releaseViewLease(token)
        checkAndPruneDocument(canonicalKey, targetDoc)
    }

    fun isSaveInProgress(canonicalKey: String): Boolean =
        saveLocks[canonicalKey] == true

    fun tryBeginSave(canonicalKey: String): Boolean {
        if (saveLocks[canonicalKey] == true) return false
        saveLocks[canonicalKey] = true
        return true
    }

    fun completeSave(canonicalKey: String) {
        saveLocks.remove(canonicalKey)
        checkAndPruneDocument(canonicalKey, documents[canonicalKey])
    }

    fun abortSave(canonicalKey: String) {
        saveLocks.remove(canonicalKey)
        checkAndPruneDocument(canonicalKey, documents[canonicalKey])
    }

    fun replaceDocumentAtomic(
        canonicalKey: String,
        successor: EditorDocument,
    ): EditorDocument? {
        val old = documents.put(canonicalKey, successor)
        for (listener in replacementListeners.toList()) {
            listener.onCanonicalDocumentReplaced(canonicalKey, successor)
        }
        if (old != null && old.canDispose) {
            old.close()
        }
        return old
    }

    fun checkAndPruneDocument(canonicalKey: String, doc: EditorDocument?) {
        if (doc == null) return
        if (documents[canonicalKey] === doc) {
            if (isSaveInProgress(canonicalKey)) return
            if (doc.canDispose) {
                documents.remove(canonicalKey)
                doc.close()
            }
        } else {
            // Retired / replaced document awaiting lease/save settlement
            if (doc.canDispose) {
                doc.close()
            }
        }
    }

    fun pruneDocument(canonicalKey: String, forceDiscard: Boolean = false) {
        val doc = documents[canonicalKey] ?: return
        if (isSaveInProgress(canonicalKey)) return
        if (forceDiscard) {
            if (doc.activeAliasLeases.value.isEmpty()) {
                documents.remove(canonicalKey)
                if (doc.canDispose) {
                    doc.close()
                }
            }
        } else if (doc.canDispose) {
            documents.remove(canonicalKey)
            doc.close()
        }
    }

    fun pruneClosed(forceDiscard: Boolean = false) {
        val toRemove = documents.filter { (key, doc) ->
            if (forceDiscard) {
                doc.activeAliasLeases.value.isEmpty() && doc.activeViewLeases.value.isEmpty() && !isSaveInProgress(key)
            } else {
                doc.canDispose && !isSaveInProgress(key)
            }
        }.keys.toList()
        for (k in toRemove) {
            documents.remove(k)?.close()
        }
    }
}

class EditorTabsState(
    val profileId: String,
    editorRepository: EditorRepository,
    val documentFactory: EditorDocumentFactory? = null,
    val languageServiceCoordinator: LanguageServiceCoordinator = LanguageServiceCoordinator(),
    val jsonLanguageService: JsonLanguageService = JsonLanguageService(),
    val tsLanguageService: TsJsLanguageService = TsJsLanguageService("typescript"),
    val jsLanguageService: TsJsLanguageService = TsJsLanguageService("javascript"),
    val registry: CanonicalDocumentRegistry = CanonicalDocumentRegistry(documentFactory),
) : EditorTabLifecyclePort, EditorDirtyGuardPort, EditorDocumentAccessPort, EditorCommandPort, EditorSaveOutcomePort, EditorCanonicalDocumentPort, CanonicalReplacementListener {

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
    val canonicalDocuments: Map<String, EditorDocument> get() = registry.getAllDocuments()
    private val diagnosticsManager = EditorDiagnosticsManager(
        languageServiceCoordinator, jsonLanguageService, tsLanguageService, jsLanguageService
    )
    private var saveCoordinator = EditorTabSaveCoordinator(editorRepository)
    private val saveMutex = Mutex()

    init {
        registry.registerReplacementListener(this)
        installRepositoryGates(editorRepository)
    }

    override fun onCanonicalDocumentReplaced(canonicalKey: String, successor: EditorDocument) {
        val matchingKeys = _tabs.value.filter { resolveCanonicalKey(it) == canonicalKey }.map { it.key }
        if (matchingKeys.isEmpty()) return
        val updatedAliases = mutableListOf<EditorTab>()
        for (aKey in matchingKeys) {
            val aTab = _tabs.value.find { it.key == aKey } ?: continue
            val aIncarnation = nextIncarnation++
            val aDocId = createDocumentId(aTab.target, aTab.path, aIncarnation)
            tabDocumentIds[aKey] = aDocId
            if (_activeTabKey.value == aKey) {
                _activeTabId.value = aDocId
            }
            sessions.remove(aKey)?.close()
            val lease = successor.acquireAliasLease(aKey)
            val aSession = EditorSession(
                document = successor,
                key = aKey,
                profileId = profileId,
                target = aTab.target,
                path = aTab.path,
                sessionIncarnation = aIncarnation,
                initialMtime = aTab.mtime,
                isReadOnly = successor.isReadOnly.value,
            )
            aSession.aliasLease = lease
            aSession.isInputAllowed = { isInputAllowed() }
            sessions[aKey] = aSession
            attachSessionListeners(aSession)

            updatedAliases.add(aTab.copy(
                content = aSession.getText(),
                savedContent = aSession.getText(),
                tier = if (successor.isReadOnly.value) FileTier.LARGE else FileTier.NORMAL,
                isDirty = false,
                isLoading = false,
                error = null,
                isConflicted = false,
                isStale = false,
                sessionIncarnation = aIncarnation,
            ))
        }
        val updatedMap = updatedAliases.associateBy { it.key }
        _tabs.value = _tabs.value.map { updatedMap[it.key] ?: it }
        updateMetadataFlow()
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
        fileIdentity: dev.damhopper.nativeapp.features.files.FileIdentityDto? = null,
        canonicalPath: String? = null,
    ) {
        val factory = documentFactory ?: return
        sessions.remove(key)?.close()
        val cKey = resolveCanonicalKey(fileIdentity, profileId, target, path)

        val (doc, _) = registry.getOrCreateDocument(
            canonicalKey = cKey,
            fallbackDocId = docId,
            content = content,
            mtime = mtime,
            tier = tier,
            factory = factory,
        )
        if (fileIdentity != null && doc.fileIdentity == null) {
            doc.fileIdentity = fileIdentity
            doc.canonicalPath = canonicalPath
        }

        val lease = registry.acquireAliasLease(cKey, key) ?: doc.acquireAliasLease(key)
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
        session.aliasLease = lease
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
    fun resolveCanonicalKey(tab: EditorTab): String =
        resolveCanonicalKey(tab.fileIdentity, tab.profileId, tab.target, tab.path)

    fun resolveCanonicalKey(
        fileIdentity: dev.damhopper.nativeapp.features.files.FileIdentityDto?,
        tabProfileId: String,
        target: ProjectTargetRef,
        path: String,
    ): String {
        val owner = editorRepository.fileRepository.owner
        val wsId = fileIdentity?.workspaceId?.trim()
        val cPath = fileIdentity?.canonicalPath?.trim()
        val wsEpoch = fileIdentity?.workspaceEpoch ?: owner.workspaceEpoch ?: 0L

        if (!wsId.isNullOrEmpty() && !cPath.isNullOrEmpty() && wsEpoch >= 0L) {
            return dev.damhopper.nativeapp.features.files.CanonicalDocumentKey(
                profileId = tabProfileId,
                normalizedEndpoint = owner.normalizedBaseUrl,
                authenticatedAccount = owner.accountUser,
                workspaceId = wsId,
                workspaceEpoch = wsEpoch,
                canonicalPath = fileIdentity.canonicalPath, // verbatim, no lowercasing, no slash stripping!
            ).key
        }

        // Conservative fallback identity scoped to exact target with owner epoch isolation
        fun enc(s: String): String = "${s.length}:$s"
        return listOf(
            enc(tabProfileId),
            enc(owner.normalizedBaseUrl),
            enc(owner.accountUser),
            enc(target.project),
            enc(target.worktreePath.orEmpty()),
            "$wsEpoch",
            enc(path),
        ).joinToString("/")
    }

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
                fileIdentity = tab.fileIdentity,
                canonicalKey = resolveCanonicalKey(tab),
            )
        }
        val currentKey = _activeTabKey.value
        _activeTabId.value = if (currentKey != null) tabDocumentIds[currentKey] else null
    }

    private fun createDocumentId(target: ProjectTargetRef, path: String, incarnation: Long): DocumentId {
        val repoOwner = editorRepository.fileRepository.owner
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = repoOwner.baseUrl,
            accountUser = repoOwner.accountUser,
            project = target.project,
            worktreePath = target.worktreePath,
            workspaceRoot = repoOwner.workspaceRoot,
            workspaceEpoch = repoOwner.workspaceEpoch ?: editorRepository.fileRepository.currentWorkspaceEpoch,
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

                installSession(
                    key, docId, target, path, incarnation, result.content, result.mtime, result.tier,
                    result.fileIdentity, result.canonicalPath
                )

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
                        rangeWindow = result.rangeWindow,
                        fileIdentity = result.fileIdentity,
                        canonicalPath = result.canonicalPath,
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

    fun closeTab(key: String, forceDiscard: Boolean = false) {
        val tab = _tabs.value.find { it.key == key }
        val cKey = tab?.let { resolveCanonicalKey(it) }
        if ((tab?.isSaving == true || (cKey != null && registry.isSaveInProgress(cKey))) && !forceDiscard) {
            // Busy during in-flight save!
            return
        }
        val remaining = _tabs.value.filter { it.key != key }
        _tabs.value = remaining
        val session = sessions.remove(key)
        val doc = session?.document
        session?.close()
        tabDocumentIds.remove(key)
        if (cKey != null) {
            registry.unregisterAlias(cKey, key)
            registry.pruneDocument(cKey, forceDiscard)
        }
        if (_activeTabKey.value == key) {
            val nextKey = remaining.lastOrNull()?.key
            _activeTabKey.value = nextKey
            _activeTabId.value = if (nextKey != null) tabDocumentIds[nextKey] else null
        }
        updateMetadataFlow()
    }

    fun closeAll(forceDiscard: Boolean = false) {
        _tabs.value.forEach { tab ->
            val cKey = resolveCanonicalKey(tab)
            registry.unregisterAlias(cKey, tab.key)
        }
        _tabs.value = emptyList()
        _activeTabKey.value = null
        _activeTabId.value = null
        tabDocumentIds.clear()
        sessions.values.forEach { it.close() }
        sessions.clear()
        registry.unregisterReplacementListener(this)
        registry.pruneClosed(forceDiscard)
        updateMetadataFlow()
    }

    override fun getCanonicalDocument(canonicalKey: String): EditorDocument? = registry.getDocument(canonicalKey)

    override fun acquireCanonicalLease(canonicalKey: String, aliasId: String): AliasLeaseToken? =
        registry.acquireAliasLease(canonicalKey, aliasId)

    override fun releaseCanonicalLease(canonicalKey: String, token: AliasLeaseToken) {
        registry.releaseAliasLease(canonicalKey, token)
    }

    // --- EditorTabLifecyclePort Close & Conflict ---

    override fun requestCloseTab(id: DocumentId): CloseIntent? {
        val entry = tabDocumentIds.entries.find { it.value == id } ?: return null
        val tab = _tabs.value.find { it.key == entry.key } ?: return null
        val session = sessions[entry.key]

        if (tab.isSaving) {
            return CloseIntent(
                id = id,
                dirtyRevision = session?.revision ?: tab.modelVersion,
                decision = CloseDecision.SAVE
            )
        }

        val isDirty = session?.isDirty ?: tab.isDirty
        if (isDirty) {
            val cKey = resolveCanonicalKey(tab)
            val otherAliases = _tabs.value.any { it.key != tab.key && resolveCanonicalKey(it) == cKey } ||
                    registry.hasSurvivingAliases(cKey, excludingAliasId = tab.key)
            if (otherAliases) {
                // Surviving alias exists! Close this tab lease only; surviving alias retains dirty edits
                closeTab(entry.key)
                return null
            }
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
        val tab = _tabs.value.find { it.key == entry.key } ?: return
        val session = sessions[entry.key]
        if (tab.isSaving) return // Busy during save
        when (intent.decision) {
            CloseDecision.DISCARD -> {
                if (session != null && session.revision > intent.dirtyRevision) {
                    return // Newer edits occurred after consent; protect local buffer
                }
                closeTab(entry.key, forceDiscard = true)
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
        val tab = _tabs.value.find { it.key == key }
            ?: return@withLock EditorSaveResult.Error("Tab not found: $key")
        val cKey = resolveCanonicalKey(tab)
        if (!registry.tryBeginSave(cKey)) {
            return@withLock EditorSaveResult.Error("Save already in flight for canonical document")
        }
        val docId = tabDocumentIds[key]
        val session = sessions[key]
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(editorRepository.fileRepository.owner, tab.target)
        val acquiredToken = if (reservationToken == null) {
            editorRepository.fileRepository.arbiter.tryReserveSave(effectiveOwner, tab.path)
        } else null

        if (acquiredToken == null && reservationToken == null) {
            registry.abortSave(cKey)
            return@withLock EditorSaveResult.Error("Path '${tab.path}' is currently reserved by another file operation")
        }

        val tokenToUse = reservationToken ?: acquiredToken
        try {
            val saveEpoch = transportEpoch
            val res = saveCoordinator.save(
                tabKey = key,
                currentTabProvider = { _tabs.value.find { it.key == key } },
                session = session,
                transformTab = { transform ->
                    _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it }
                    updateMetadataFlow()
                },
                reservationToken = tokenToUse,
            )
            if (transportEpoch != saveEpoch) {
                registry.abortSave(cKey)
                return@withLock EditorSaveResult.Error("Transport epoch changed during save")
            }
            if (res is EditorSaveResult.Success) {
                registry.completeSave(cKey)
                _tabs.value = _tabs.value.map {
                    if (resolveCanonicalKey(it) == cKey) {
                        it.copy(
                            mtime = res.newMtime,
                            isDirty = session?.isDirty ?: false,
                            isConflicted = false,
                            isStale = false,
                            savedContent = it.content,
                            error = null,
                        )
                    } else it
                }
                updateMetadataFlow()
            } else {
                registry.abortSave(cKey)
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
            registry.completeSave(cKey)
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
            val oldCKey = resolveCanonicalKey(tab)
            val newCKey = resolveCanonicalKey(tab.fileIdentity, profileId, target, rekeyedRelativePath)
            registry.rekeyAlias(oldCKey, oldKey, newCKey, newKey)

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
        val tab = _tabs.value.find { it.key == key }
            ?: return@withLock EditorSaveResult.Error("Tab not found: $key")
        val cKey = resolveCanonicalKey(tab)
        if (!registry.tryBeginSave(cKey)) {
            return@withLock EditorSaveResult.Error("Save already in flight for canonical document")
        }
        val docId = tabDocumentIds[key]
        val session = sessions[key]
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(editorRepository.fileRepository.owner, tab.target)
        val acquiredToken = if (reservationToken == null) {
            editorRepository.fileRepository.arbiter.tryReserveSave(effectiveOwner, tab.path)
        } else null

        if (acquiredToken == null && reservationToken == null) {
            registry.abortSave(cKey)
            return@withLock EditorSaveResult.Error("Path '${tab.path}' is currently reserved by another file operation")
        }

        val tokenToUse = reservationToken ?: acquiredToken
        try {
            val res = saveCoordinator.forceOverwrite(
                tabKey = key,
                currentTabProvider = { _tabs.value.find { it.key == key } },
                session = session,
                transformTab = { transform ->
                    _tabs.value = _tabs.value.map { if (it.key == key) transform(it) else it }
                    updateMetadataFlow()
                },
                reservationToken = tokenToUse,
            )
            if (res is EditorSaveResult.Success) {
                registry.completeSave(cKey)
                _tabs.value = _tabs.value.map {
                    if (resolveCanonicalKey(it) == cKey) {
                        it.copy(
                            mtime = res.newMtime,
                            isDirty = session?.isDirty ?: false,
                            isConflicted = false,
                            isStale = false,
                            savedContent = it.content,
                            error = null,
                        )
                    } else it
                }
                updateMetadataFlow()
            } else {
                registry.abortSave(cKey)
            }
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
            registry.completeSave(cKey)
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
        val cKey = resolveCanonicalKey(tab)
        if (tab.isSaving || registry.isSaveInProgress(cKey)) {
            return
        }
        val initialEpoch = session.editEpoch
        val initialRevision = session.revision
        val incarnation = tab.sessionIncarnation

        val aliasKeys = _tabs.value.filter { resolveCanonicalKey(it) == cKey }.map { it.key }
        if (aliasKeys.any { aKey -> _tabs.value.find { it.key == aKey }?.isSaving == true }) {
            return
        }

        _tabs.value = _tabs.value.map {
            if (it.key in aliasKeys) it.copy(isLoading = true, isConflicted = false, isStale = false) else it
        }
        updateMetadataFlow()

        val loadEpoch = transportEpoch
        when (val res = editorRepository.loadFile(tab.target, tab.path)) {
            is EditorLoadResult.Success -> {
                if (transportEpoch != loadEpoch) return
                if (registry.isSaveInProgress(cKey) || aliasKeys.any { aKey -> _tabs.value.find { it.key == aKey }?.isSaving == true }) {
                    _tabs.value = _tabs.value.map { if (it.key in aliasKeys) it.copy(isLoading = false) else it }
                    updateMetadataFlow()
                    return
                }
                val resCKey = resolveCanonicalKey(res.fileIdentity, profileId, tab.target, tab.path)
                if (resCKey != cKey) {
                    _tabs.value = _tabs.value.map { if (it.key in aliasKeys) it.copy(isLoading = false, error = "File identity changed during reload") else it }
                    updateMetadataFlow()
                    return
                }
                val currentTab = _tabs.value.find { it.key == key }
                if (currentTab == null || currentTab.sessionIncarnation != incarnation) return

                val currentSession = sessions[key]
                if (currentSession != null && !currentSession.isDisposed) {
                    val editedDuringRequest = currentSession.revision != initialRevision || currentSession.editEpoch != initialEpoch
                    if (editedDuringRequest || (!forceDiscardLocal && currentSession.isDirty)) {
                        _tabs.value = _tabs.value.map {
                            if (it.key in aliasKeys) it.copy(isLoading = false, isStale = true) else it
                        }
                    } else if (res.tier != currentTab.tier) {
                        val factory = documentFactory ?: return
                        val newIncarnation = nextIncarnation++
                        val successorDoc = factory.createDocument(
                            id = createDocumentId(currentTab.target, currentTab.path, newIncarnation),
                            initialText = res.content,
                            initialMtime = res.mtime ?: 0L,
                            readOnly = res.tier.isReadOnly,
                            maxUndoStackSize = if (res.tier == FileTier.DEGRADED) 50 else 200,
                        )
                        successorDoc.fileIdentity = res.fileIdentity
                        successorDoc.canonicalPath = res.canonicalPath
                        registry.replaceDocumentAtomic(cKey, successorDoc)

                        val updatedAliases = mutableListOf<EditorTab>()
                        for (aKey in aliasKeys) {
                            val aTab = _tabs.value.find { it.key == aKey } ?: continue
                            val aIncarnation = nextIncarnation++
                            val aDocId = createDocumentId(aTab.target, aTab.path, aIncarnation)
                            tabDocumentIds[aKey] = aDocId
                            if (_activeTabKey.value == aKey) {
                                _activeTabId.value = aDocId
                            }
                            sessions.remove(aKey)?.close()
                            val lease = successorDoc.acquireAliasLease(aKey)
                            val aSession = EditorSession(
                                document = successorDoc,
                                key = aKey,
                                profileId = profileId,
                                target = aTab.target,
                                path = aTab.path,
                                sessionIncarnation = aIncarnation,
                                initialMtime = res.mtime,
                                isReadOnly = res.tier.isReadOnly,
                            )
                            aSession.aliasLease = lease
                            aSession.isInputAllowed = { isInputAllowed() }
                            sessions[aKey] = aSession
                            attachSessionListeners(aSession)

                            updatedAliases.add(aTab.copy(
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
                                sessionIncarnation = aIncarnation,
                                largeFileEof = res.isEof,
                                rangeWindow = res.rangeWindow,
                            ))
                        }
                        val updatedMap = updatedAliases.associateBy { it.key }
                        _tabs.value = _tabs.value.map { updatedMap[it.key] ?: it }
                    } else {
                        currentSession.loadServerContent(res.content, res.mtime)
                        currentSession.document.fileIdentity = res.fileIdentity
                        currentSession.document.canonicalPath = res.canonicalPath
                        _tabs.value = _tabs.value.map {
                            if (it.key in aliasKeys) it.copy(
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
                if (transportEpoch != loadEpoch) return
                val currentTab = _tabs.value.find { it.key == key }
                if (currentTab == null || currentTab.sessionIncarnation != incarnation) return
                _tabs.value = _tabs.value.map {
                    if (it.key in aliasKeys) it.copy(isLoading = false, error = res.message) else it
                }
                updateMetadataFlow()
            }
            is EditorLoadResult.TargetUnavailable -> {
                if (transportEpoch != loadEpoch) return
                val currentTab = _tabs.value.find { it.key == key }
                if (currentTab == null || currentTab.sessionIncarnation != incarnation) return
                _tabs.value = _tabs.value.map {
                    if (it.key in aliasKeys) it.copy(isLoading = false, targetAvailable = false) else it
                }
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
