package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Project types accepted by the server (`ProjectType`), shown as a closed selector. */
val CONFIG_PROJECT_TYPES: List<String> = listOf("maven", "gradle", "npm", "pnpm", "cargo", "custom")

data class ConfigTag(val rowId: Long, val value: String)
data class ConfigService(val rowId: Long, val name: String, val buildCommand: String = "", val runCommand: String = "")
data class ConfigCommand(val rowId: Long, val name: String, val command: String)
data class ConfigTerminalProfile(val rowId: Long, val name: String, val command: String, val cwd: String)

/** One structured project row. [rowId] is stable across renames; edits never execute anything. */
data class ConfigProject(
    val rowId: Long,
    val name: String,
    val path: String,
    val type: String,
    val envFile: String = "",
    val tags: List<ConfigTag> = emptyList(),
    val services: List<ConfigService> = emptyList(),
    val commands: List<ConfigCommand> = emptyList(),
    val terminals: List<ConfigTerminalProfile> = emptyList(),
)

/** [workspaceRoot] is authoritative, read-only server state (shown like the web form). */
data class StructuredConfig(
    val workspaceName: String,
    val workspaceRoot: String,
    val projects: List<ConfigProject>,
)

data class ConfigValidationIssue(val rowId: Long?, val field: String, val message: String)

data class StructuredConfigState(
    val config: StructuredConfig? = null,
    val issues: List<ConfigValidationIssue> = emptyList(),
    /** Non-null when the draft is not a config object; structured saving is blocked. */
    val parseError: String? = null,
    /** Original project name per row (null for a new row); a rename needs a full save, not a project patch. */
    val originalNames: Map<Long, String?> = emptyMap(),
) {
    val canSave: Boolean get() = config != null && parseError == null && issues.isEmpty()
}

/** Global defaults (`GET /api/global-config`), independent of the known-workspace registry. */
data class GlobalDefaultsState(
    val workspace: String? = null,
    val loaded: Boolean = false,
    val error: String? = null,
    val busy: Boolean = false,
)

/**
 * Lossless, conflict-aware, **owner-qualified** editor of one Settings target's remote configuration.
 *
 * - One instance belongs to exactly one [owner]; every publication re-checks [SettingsTargetAuthority.isCurrent]
 *   and every mutation awaits runtime revocation, then takes a fresh request-local guard for exactly [owner]
 *   (`null` => NotSubmitted). Nothing is retried; Unknown (admitted but unconfirmed/malformed/cancelled) keeps
 *   the draft and is reported honestly.
 * - Unknown config keys survive: structured edits are applied over the parsed draft object.
 * - Background refreshes never clobber a dirty draft; server changes under a draft surface as a conflict
 *   with explicit resolution ([discardDraft], [keepLocalDraft], or overwrite via `saveFullConfig(true)`).
 */
class RemoteConfigEditor(
    val repository: RemoteConfigRepository,
    val owner: SettingsOwner,
    private val authority: SettingsTargetAuthority,
) {
    private val _state = MutableStateFlow(RemoteConfigEditorState())
    val state: StateFlow<RemoteConfigEditorState> = _state.asStateFlow()

    private val _structured = MutableStateFlow(StructuredConfigState())
    val structured: StateFlow<StructuredConfigState> = _structured.asStateFlow()

    private val _outcome = MutableStateFlow<SettingsOutcome<Unit>?>(null)

    /** Outcome of the last mutation of THIS owner (cleared by the next explicit action). */
    val lastOutcome: StateFlow<SettingsOutcome<Unit>?> = _outcome.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _defaults = MutableStateFlow(GlobalDefaultsState())
    val defaults: StateFlow<GlobalDefaultsState> = _defaults.asStateFlow()

    private var nextRowId = 1L
    private var originals: Map<Long, JsonObject> = emptyMap()

    fun newRowId(): Long = nextRowId++

    // ---- loading / refresh ----

    /** Loads the authoritative config. Returns false (never throws except cancellation) on failure/stale owner. */
    suspend fun load(): Boolean {
        _isLoading.value = true
        _state.update { it.copy(lastError = null) }
        return try {
            val fullConfig = repository.getFullConfig()
            if (!authority.isCurrent(owner)) return false // stale owner: discard, never publish
            _state.update {
                it.copy(
                    baseConfigJson = fullConfig,
                    draftConfigJson = fullConfig,
                    isDirty = false,
                    hasConflict = false,
                    conflictingServerJson = null,
                )
            }
            reparse(fullConfig)
            true
        } catch (ce: CancellationException) {
            throw ce
        } catch (e: Exception) {
            _state.update { it.copy(lastError = e.message ?: "Failed to load config") }
            false
        } finally {
            _isLoading.value = false
        }
    }

    /** Re-reads the server config; a dirty draft is never clobbered (conflict instead). */
    suspend fun refresh(): Boolean = try {
        val latest = repository.getFullConfig()
        if (!authority.isCurrent(owner)) {
            false
        } else {
            handleServerRefresh(latest)
            true
        }
    } catch (ce: CancellationException) {
        throw ce
    } catch (e: Exception) {
        _state.update { it.copy(lastError = e.message ?: "Failed to refresh config") }
        false
    }

    suspend fun loadGlobalDefaults(): Boolean = try {
        val global = repository.getGlobalConfig()
        if (!authority.isCurrent(owner)) {
            false
        } else {
            val workspace = ((global["defaults"] as? JsonObject)?.get("workspace") as? JsonPrimitive)
                ?.takeIf { it.isString }?.content
            _defaults.update { it.copy(workspace = workspace, loaded = true, error = null) }
            true
        }
    } catch (ce: CancellationException) {
        throw ce
    } catch (e: Exception) {
        _defaults.update { it.copy(error = e.message ?: "Failed to load global defaults") }
        false
    }

    // ---- draft editing ----

    /** Raw JSON edit (supplemental). Re-derives the structured view; row identities restart. */
    fun updateConfigDraft(newDraftJson: String) {
        _state.update { current ->
            current.copy(draftConfigJson = newDraftJson, isDirty = isDirtyJson(current.baseConfigJson, newDraftJson))
        }
        reparse(newDraftJson)
    }

    /** Structured edit applied over the parsed draft so unknown keys are preserved. */
    fun updateStructured(transform: (StructuredConfig) -> StructuredConfig) {
        val current = _structured.value
        val config = current.config ?: return
        val updated = transform(config)
        val root = parseRoot(_state.value.draftConfigJson) ?: return
        val json = applyStructured(root, updated, originals).toString()
        _state.update { it.copy(draftConfigJson = json, isDirty = isDirtyJson(it.baseConfigJson, json)) }
        _structured.value = StructuredConfigState(
            config = updated,
            issues = validateStructuredConfig(updated),
            parseError = null,
            originalNames = current.originalNames,
        )
    }

    /** Called when an external refresh brings new server configuration. Never clobbers a dirty draft. */
    fun handleServerRefresh(newServerJson: String) {
        var accepted = false
        _state.update { current ->
            if (!current.isDirty) {
                accepted = true
                current.copy(
                    baseConfigJson = newServerJson,
                    draftConfigJson = newServerJson,
                    isDirty = false,
                    hasConflict = false,
                    conflictingServerJson = null,
                )
            } else if (current.baseConfigJson == newServerJson || !isDirtyJson(current.baseConfigJson, newServerJson)) {
                current.copy(hasConflict = false, conflictingServerJson = null)
            } else {
                current.copy(hasConflict = true, conflictingServerJson = newServerJson)
            }
        }
        if (accepted) reparse(newServerJson)
    }

    /** Discards the draft and takes the latest authoritative server config (conflict resolution A). */
    fun discardDraft() {
        val target = _state.value.conflictingServerJson ?: _state.value.baseConfigJson
        _state.update {
            it.copy(
                baseConfigJson = target,
                draftConfigJson = target,
                isDirty = false,
                hasConflict = false,
                conflictingServerJson = null,
                lastError = null,
            )
        }
        reparse(target)
    }

    /** Keeps the local draft against the newer server base without writing (conflict resolution B). */
    fun keepLocalDraft() {
        _state.update { current ->
            val newBase = current.conflictingServerJson ?: current.baseConfigJson
            current.copy(
                baseConfigJson = newBase,
                isDirty = isDirtyJson(newBase, current.draftConfigJson),
                hasConflict = false,
                conflictingServerJson = null,
            )
        }
    }

    // ---- guarded mutations ----

    private suspend fun guardedMutation(
        preflight: () -> SettingsOutcome<Nothing>?,
        publish: (SettingsOutcome<Unit>) -> Unit,
        request: suspend (RequestAdmissionGuard) -> Boolean,
    ): SettingsOutcome<Unit> {
        if (_state.value.isSaving) return SettingsOutcome.NotSubmitted("A save is already running.")
        preflight()?.let { _outcome.value = it; return it }
        _outcome.value = null
        _state.update { it.copy(isSaving = true, lastError = null) }
        var finished: SettingsOutcome<Unit>? = null
        try {
            val guard = authority.guardFor(owner)
            if (guard == null) {
                val stale = SettingsOutcome.NotSubmitted("The Settings server changed; nothing was submitted.")
                finished = stale
                return stale
            }
            try {
                authority.revokeRuntime(owner.connection) // awaited BEFORE the request; failure aborts it
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Exception) {
                val aborted = SettingsOutcome.NotSubmitted(
                    "Runtime readiness could not be revoked (${t.message}); nothing was submitted.",
                )
                finished = aborted
                return aborted
            }
            if (!authority.isCurrent(owner)) {
                val stale = SettingsOutcome.NotSubmitted("The Settings server changed; nothing was submitted.")
                finished = stale
                return stale
            }
            val outcome = guardedConfirmation(guard, onCancelled = { finished = it }) { request(guard) }
            finished = outcome
            if (authority.isCurrent(owner)) publish(outcome)
            return outcome
        } finally {
            // Cleanup also covers cancellation; the outcome is owner-qualified by this editor instance.
            finished?.let { _outcome.value = it }
            _state.update {
                it.copy(
                    isSaving = false,
                    lastError = finished?.takeIf { f -> f !is SettingsOutcome.Confirmed }?.reasonOrNull,
                )
            }
        }
    }

    /**
     * Replaces the whole config (PUT) with the validated draft. A conflict must be resolved first unless
     * [overwriteConflict] is an explicit user choice.
     */
    suspend fun saveFullConfig(overwriteConflict: Boolean = false): SettingsOutcome<Unit> {
        val draft = _state.value.draftConfigJson
        return guardedMutation(
            preflight = {
                val s = _state.value
                when {
                    draft == null -> SettingsOutcome.NotSubmitted("There is no config draft to save.")
                    s.hasConflict && !overwriteConflict ->
                        SettingsOutcome.NotSubmitted("Resolve the server conflict before saving.")
                    _structured.value.parseError != null ->
                        SettingsOutcome.NotSubmitted(_structured.value.parseError!!)
                    _structured.value.issues.isNotEmpty() ->
                        SettingsOutcome.NotSubmitted("Fix the highlighted fields before saving.")
                    else -> null
                }
            },
            publish = { outcome ->
                if (outcome is SettingsOutcome.Confirmed) {
                    _state.update {
                        it.copy(baseConfigJson = draft, isDirty = false, hasConflict = false, conflictingServerJson = null)
                    }
                }
            },
        ) { guard -> repository.updateFullConfig(draft!!, guard) }
    }

    /**
     * PATCHes one existing, unrenamed project with only its changed fields (`null` clears optional fields).
     * A new or renamed project needs [saveFullConfig].
     */
    suspend fun saveProject(rowId: Long): SettingsOutcome<Unit> {
        val state = _structured.value
        val project = state.config?.projects?.firstOrNull { it.rowId == rowId }
        val original = originals[rowId]
        val originalName = state.originalNames[rowId]
        val draftRoot = parseRoot(_state.value.draftConfigJson)
        val draftProject = draftRoot?.let { projectsOf(it).firstOrNull { p -> p.string("name") == project?.name } }
        val patch = if (project != null && original != null && draftProject != null) {
            JsonObject(draftProject.filter { (key, value) -> original[key] != value } +
                (original.keys.filter { it !in draftProject.keys }.associateWith { JsonNull as JsonElement }))
        } else {
            null
        }
        return guardedMutation(
            preflight = {
                when {
                    project == null || original == null || originalName == null || draftProject == null ->
                        SettingsOutcome.NotSubmitted("Only existing projects can be saved on their own.")
                    project.name != originalName ->
                        SettingsOutcome.NotSubmitted("A renamed project needs a full config save.")
                    _state.value.hasConflict -> SettingsOutcome.NotSubmitted("Resolve the server conflict before saving.")
                    state.issues.any { it.rowId == rowId } -> SettingsOutcome.NotSubmitted("Fix the highlighted fields first.")
                    patch == null || patch.isEmpty() -> SettingsOutcome.NotSubmitted("This project has no changes.")
                    else -> null
                }
            },
            publish = { outcome ->
                if (outcome is SettingsOutcome.Confirmed && project != null && draftProject != null) {
                    val base = parseRoot(_state.value.baseConfigJson)
                    if (base != null) {
                        val replaced = JsonArray(
                            projectsOf(base).map { if (it.string("name") == originalName) draftProject else it },
                        )
                        val newBase = JsonObject(base + ("projects" to replaced)).toString()
                        originals = originals + (rowId to draftProject)
                        _structured.update { it.copy(originalNames = it.originalNames + (rowId to project.name)) }
                        _state.update {
                            it.copy(baseConfigJson = newBase, isDirty = isDirtyJson(newBase, it.draftConfigJson))
                        }
                    }
                }
            },
        ) { guard -> repository.patchProject(originalName!!, patch.toString(), guard) }
    }

    /** Sets `{"defaults":{"workspace":path}}` on the target (replaces defaults, not the known registry). */
    suspend fun setGlobalDefaultWorkspace(path: String): SettingsOutcome<Unit> {
        val trimmed = path.trim()
        if (trimmed.isEmpty()) return SettingsOutcome.NotSubmitted("The path is blank.")
        return mutateDefaults(trimmed)
    }
    /** Clears defaults with exactly `{"defaults":{}}`. */
    suspend fun clearGlobalDefaultWorkspace(): SettingsOutcome<Unit> = mutateDefaults(null)

    private suspend fun mutateDefaults(path: String?): SettingsOutcome<Unit> {
        _defaults.update { it.copy(busy = true) }
        try {
            return guardedMutation(
                preflight = { null },
                publish = { outcome ->
                    if (outcome is SettingsOutcome.Confirmed) {
                        _defaults.update { it.copy(workspace = path, loaded = true, error = null) }
                    }
                },
            ) { guard -> repository.updateGlobalDefaults(path, guard) }
        } finally {
            _defaults.update { it.copy(busy = false) }
        }
    }

    // ---- structured derivation ----

    private fun reparse(json: String?) {
        val root = parseRoot(json)
        if (root == null) {
            _structured.value = StructuredConfigState(parseError = "The config draft is not a valid JSON object.")
            return
        }
        if (root["projects"] != null && root["projects"] !is JsonArray) {
            _structured.value = StructuredConfigState(parseError = "The config 'projects' value is not a list.")
            return
        }
        val savedOriginals = HashMap<Long, JsonObject>()
        val names = HashMap<Long, String?>()
        val projects = projectsOf(root).map { obj ->
            val rowId = newRowId()
            savedOriginals[rowId] = obj
            names[rowId] = obj.string("name")
            ConfigProject(
                rowId = rowId,
                name = obj.string("name") ?: "",
                path = obj.string("path") ?: "",
                type = obj.string("type") ?: "custom",
                envFile = obj.string("envFile") ?: obj.string("env_file") ?: "",
                tags = (obj["tags"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                    .map { ConfigTag(newRowId(), it) },
                services = (obj["services"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { s ->
                    ConfigService(
                        newRowId(),
                        s.string("name") ?: "",
                        s.string("buildCommand") ?: s.string("build_command") ?: "",
                        s.string("runCommand") ?: s.string("run_command") ?: "",
                    )
                },
                commands = (obj["commands"] as? JsonObject).orEmpty().entries
                    .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { ConfigCommand(newRowId(), k, it) } },
                terminals = (obj["terminals"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { t ->
                    ConfigTerminalProfile(
                        newRowId(), t.string("name") ?: "", t.string("command") ?: "", t.string("cwd") ?: "",
                    )
                },
            )
        }
        val workspace = root["workspace"] as? JsonObject
        val config = StructuredConfig(
            workspaceName = workspace?.string("name") ?: "",
            workspaceRoot = workspace?.string("root") ?: "",
            projects = projects,
        )
        originals = savedOriginals
        _structured.value = StructuredConfigState(config, validateStructuredConfig(config), null, names)
    }
}

// ---- pure helpers (internal for tests) ----

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun projectsOf(root: JsonObject): List<JsonObject> =
    (root["projects"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

private fun parseRoot(json: String?): JsonObject? = json?.let {
    try {
        ProtocolJson.parseToJsonElement(it) as? JsonObject
    } catch (_: Exception) {
        null
    }
}

/** Semantic comparison so re-serialization of equal content is not reported as an edit. */
private fun isDirtyJson(base: String?, draft: String?): Boolean {
    if (base == null || draft == null) return base != draft
    if (base == draft) return false
    val left = parseRoot(base)
    val right = parseRoot(draft)
    return if (left != null && right != null) left != right else true
}

internal fun validateStructuredConfig(config: StructuredConfig): List<ConfigValidationIssue> {
    val issues = ArrayList<ConfigValidationIssue>()
    if (config.workspaceName.isBlank()) issues += ConfigValidationIssue(null, "workspace.name", "Workspace name is required.")
    val seenProjects = HashSet<String>()
    config.projects.forEach { p ->
        if (p.name.isBlank()) {
            issues += ConfigValidationIssue(p.rowId, "name", "Project name is required.")
        } else if (!seenProjects.add(p.name)) {
            issues += ConfigValidationIssue(p.rowId, "name", "Project name '${p.name}' is already used.")
        }
        if (p.path.isBlank()) issues += ConfigValidationIssue(p.rowId, "path", "Project path is required.")
        if (p.type !in CONFIG_PROJECT_TYPES) {
            issues += ConfigValidationIssue(p.rowId, "type", "Project type must be one of ${CONFIG_PROJECT_TYPES.joinToString()}.")
        }
        val tags = HashSet<String>()
        p.tags.forEach { t ->
            if (t.value.isBlank()) issues += ConfigValidationIssue(t.rowId, "tag", "Tag is blank.")
            else if (!tags.add(t.value)) issues += ConfigValidationIssue(t.rowId, "tag", "Tag '${t.value}' is duplicated.")
        }
        val services = HashSet<String>()
        p.services.forEach { s ->
            if (s.name.isBlank()) issues += ConfigValidationIssue(s.rowId, "service.name", "Service name is required.")
            else if (!services.add(s.name)) issues += ConfigValidationIssue(s.rowId, "service.name", "Service '${s.name}' is duplicated.")
        }
        val commands = HashSet<String>()
        p.commands.forEach { c ->
            if (c.name.isBlank()) issues += ConfigValidationIssue(c.rowId, "command.name", "Command name is required.")
            else if (!commands.add(c.name)) issues += ConfigValidationIssue(c.rowId, "command.name", "Command '${c.name}' is duplicated.")
            if (c.command.isBlank()) issues += ConfigValidationIssue(c.rowId, "command.value", "Command value is required.")
        }
        val terminals = HashSet<String>()
        p.terminals.forEach { t ->
            if (t.name.isBlank()) issues += ConfigValidationIssue(t.rowId, "terminal.name", "Profile name is required.")
            else if (!terminals.add(t.name)) issues += ConfigValidationIssue(t.rowId, "terminal.name", "Profile '${t.name}' is duplicated.")
            if (t.command.isBlank()) issues += ConfigValidationIssue(t.rowId, "terminal.command", "Profile command is required.")
            if (t.cwd.isBlank()) issues += ConfigValidationIssue(t.rowId, "terminal.cwd", "Profile working directory is required.")
        }
    }
    return issues
}

/** Applies [config] over [root], preserving every unknown workspace/project/root key. */
internal fun applyStructured(root: JsonObject, config: StructuredConfig, originals: Map<Long, JsonObject>): JsonObject {
    val workspace = (root["workspace"] as? JsonObject) ?: JsonObject(emptyMap())
    val newWorkspace = JsonObject(workspace + ("name" to JsonPrimitive(config.workspaceName)))
    val projects = JsonArray(config.projects.map { projectToJson(it, originals[it.rowId]) })
    return JsonObject(root + mapOf("workspace" to newWorkspace, "projects" to projects))
}

private fun projectToJson(p: ConfigProject, original: JsonObject?): JsonObject {
    val fields = LinkedHashMap<String, JsonElement>(original ?: emptyMap())
    fields.remove("env_file")
    fields["name"] = JsonPrimitive(p.name)
    fields["path"] = JsonPrimitive(p.path)
    fields["type"] = JsonPrimitive(p.type)
    if (p.envFile.isBlank()) fields.remove("envFile") else fields["envFile"] = JsonPrimitive(p.envFile)
    if (p.tags.isEmpty()) fields.remove("tags") else fields["tags"] = JsonArray(p.tags.map { JsonPrimitive(it.value) })
    if (p.services.isEmpty()) {
        fields.remove("services")
    } else {
        fields["services"] = JsonArray(
            p.services.map { s ->
                val entry = LinkedHashMap<String, JsonElement>()
                entry["name"] = JsonPrimitive(s.name)
                if (s.buildCommand.isNotBlank()) entry["buildCommand"] = JsonPrimitive(s.buildCommand)
                if (s.runCommand.isNotBlank()) entry["runCommand"] = JsonPrimitive(s.runCommand)
                JsonObject(entry)
            },
        )
    }
    if (p.commands.isEmpty()) {
        fields.remove("commands")
    } else {
        fields["commands"] = JsonObject(p.commands.associate { it.name to JsonPrimitive(it.command) })
    }
    fields["terminals"] = JsonArray(
        p.terminals.map { t ->
            JsonObject(
                mapOf("name" to JsonPrimitive(t.name), "command" to JsonPrimitive(t.command), "cwd" to JsonPrimitive(t.cwd)),
            )
        },
    )
    return JsonObject(fields)
}
