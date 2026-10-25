package dev.damhopper.nativeapp.features.settings

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

/**
 * Allowlisted UI preferences matching the server UiConfig schema as **nullable patch fields**.
 * `null` means "absent / not part of this patch"; unknown remote UI properties are never modelled here
 * and therefore never overwritten by a patch.
 *
 * - [explorerLanguageFilter] is the raw wire string (`all|rust|javascript-typescript|java`) so a future
 *   server value cannot break decoding; map it with [ExplorerLanguageFilter.fromWireOrNull].
 * - [terminalAgentNotifications] is the raw wire object (not a lossy typed decoder); decode it with
 *   [decodeRemoteAgentPolicy]. Unrelated saves leave it null.
 * - [agentSettingsPaths] is the raw `{ompAgentDir, codexDir, claudeDir}` object so other agent entries survive.
 */
@Serializable
data class UiPreferences(
    val systemFontSize: Int? = null,
    val editorFontSize: Int? = null,
    val terminalFontSize: Int? = null,
    val editorZoomWheelEnabled: Boolean? = null,
    val explorerShowHidden: Boolean? = null,
    val terminalSuggestionsEnabled: Boolean? = null,
    val terminalCommitStatusEnabled: Boolean? = null,
    val terminalAutoSwitchProjectEnabled: Boolean? = null,
    val terminalScrollButtonsEnabled: Boolean? = null,
    val terminalScrollStep: Int? = null,
    val explorerLanguageFilter: String? = null,
    val mobileCustomKeyboardEnabled: Boolean? = null,
    val mobileCustomKeyboardFontSize: Int? = null,
    val mobileCustomKeyboardPadding: Int? = null,
    val mobileCustomKeyboardRowGap: Int? = null,
    val searchTextShortcut: String? = null,
    val searchFilenameShortcut: String? = null,
    val terminalWorkspaceShortcut: String? = null,
    val terminalFilePanelShortcut: String? = null,
    val projectPanelShortcut: String? = null,
    val revealActiveFileShortcut: String? = null,
    val gitPanelShortcut: String? = null,
    val portsPanelShortcut: String? = null,
    val fleetTerminalShortcut: String? = null,
    val terminalFontSizeIncreaseShortcut: String? = null,
    val terminalFontSizeDecreaseShortcut: String? = null,
    val cognitoModeShortcut: String? = null,
    val cognitoModeStyle: String? = null, // "heavy-blur" | "black-screen"
    val terminalAgentNotifications: JsonObject? = null,
    val agentSettingsPaths: JsonObject? = null,
) {
    /** True when the patch carries no field at all (nothing to save). */
    fun isEmpty(): Boolean = toPatchObject().isEmpty()

    /**
     * Serializes ONLY non-null fields with exact web casing; never emits nulls or defaulted values.
     * Wrap with [toUiRequestBody] for `{ "ui": { ... } }`.
     */
    fun toPatchObject(): JsonObject = buildJsonObject {
        systemFontSize?.let { put("systemFontSize", it) }
        editorFontSize?.let { put("editorFontSize", it) }
        terminalFontSize?.let { put("terminalFontSize", it) }
        editorZoomWheelEnabled?.let { put("editorZoomWheelEnabled", it) }
        explorerShowHidden?.let { put("explorerShowHidden", it) }
        terminalSuggestionsEnabled?.let { put("terminalSuggestionsEnabled", it) }
        terminalCommitStatusEnabled?.let { put("terminalCommitStatusEnabled", it) }
        terminalAutoSwitchProjectEnabled?.let { put("terminalAutoSwitchProjectEnabled", it) }
        terminalScrollButtonsEnabled?.let { put("terminalScrollButtonsEnabled", it) }
        terminalScrollStep?.let { put("terminalScrollStep", it) }
        explorerLanguageFilter?.let { put("explorerLanguageFilter", it) }
        mobileCustomKeyboardEnabled?.let { put("mobileCustomKeyboardEnabled", it) }
        mobileCustomKeyboardFontSize?.let { put("mobileCustomKeyboardFontSize", it) }
        mobileCustomKeyboardPadding?.let { put("mobileCustomKeyboardPadding", it) }
        mobileCustomKeyboardRowGap?.let { put("mobileCustomKeyboardRowGap", it) }
        searchTextShortcut?.let { put("searchTextShortcut", it) }
        searchFilenameShortcut?.let { put("searchFilenameShortcut", it) }
        terminalWorkspaceShortcut?.let { put("terminalWorkspaceShortcut", it) }
        terminalFilePanelShortcut?.let { put("terminalFilePanelShortcut", it) }
        projectPanelShortcut?.let { put("projectPanelShortcut", it) }
        revealActiveFileShortcut?.let { put("revealActiveFileShortcut", it) }
        gitPanelShortcut?.let { put("gitPanelShortcut", it) }
        portsPanelShortcut?.let { put("portsPanelShortcut", it) }
        fleetTerminalShortcut?.let { put("fleetTerminalShortcut", it) }
        terminalFontSizeIncreaseShortcut?.let { put("terminalFontSizeIncreaseShortcut", it) }
        terminalFontSizeDecreaseShortcut?.let { put("terminalFontSizeDecreaseShortcut", it) }
        cognitoModeShortcut?.let { put("cognitoModeShortcut", it) }
        cognitoModeStyle?.let { put("cognitoModeStyle", it) }
        terminalAgentNotifications?.let { put("terminalAgentNotifications", it) }
        agentSettingsPaths?.let { put("agentSettingsPaths", it) }
    }

    fun toUiRequestBody(): String = buildJsonObject { put("ui", toPatchObject()) }.toString()
}

// ---- C1 remote policy codec (wire volume is an integer 0..100, local volume is 0..1) ----

/** Result of decoding the raw remote `terminalAgentNotifications` object. */
sealed interface RemoteAgentPolicy {
    /** No remote policy: safe disabled defaults. */
    data object Absent : RemoteAgentPolicy

    /** Version 2 with exactly the known, valid fields. */
    data class Supported(val policy: TerminalAgentNotifications) : RemoteAgentPolicy

    /**
     * Unsupported version, unknown keys or an invalid known field. The exact [raw] object is retained
     * untouched, the policy editor is read-only and notification delivery is suppressed.
     */
    data class Unsupported(val raw: JsonObject) : RemoteAgentPolicy
}

private val policyKeys = setOf("enabled", "toast", "browser", "sound", "volume", "pattern")
private val agentKeys = setOf("omp", "claude", "codex")

/**
 * Decodes the raw wire object first: `version == 2` with valid known fields only => typed policy;
 * `null` => [RemoteAgentPolicy.Absent]; anything else => [RemoteAgentPolicy.Unsupported] (exact object kept).
 * Absent individual fields use the safe local [TerminalAgentPolicy] defaults, never the server's
 * permissive serde defaults.
 */
fun decodeRemoteAgentPolicy(raw: JsonObject?): RemoteAgentPolicy {
    if (raw == null) return RemoteAgentPolicy.Absent
    val unsupported = RemoteAgentPolicy.Unsupported(raw)
    val version = raw["version"] as? JsonPrimitive ?: return unsupported
    if (version.isString || version.doubleOrNull != TerminalAgentNotifications.SUPPORTED_VERSION.toDouble()) return unsupported
    if (!raw.keys.all { it == "version" || it == "agents" }) return unsupported
    val agents = when (val element = raw["agents"]) {
        null -> JsonObject(emptyMap())
        is JsonObject -> element
        else -> return unsupported
    }
    if (!agents.keys.all { it in agentKeys }) return unsupported

    fun policyFor(name: String): TerminalAgentPolicy? {
        val element = agents[name] ?: return TerminalAgentPolicy()
        val obj = element as? JsonObject ?: return null
        if (!obj.keys.all { it in policyKeys }) return null
        val defaults = TerminalAgentPolicy()
        fun boolean(key: String, default: Boolean): Boolean? =
            if (obj[key] == null) default else obj.strictBoolean(key)
        val volume = when (val v = obj["volume"]) {
            null -> defaults.volume
            is JsonPrimitive -> {
                val number = if (v.isString) null else v.doubleOrNull
                if (number == null || !number.isFinite() || number != number.roundToInt().toDouble() || number !in 0.0..100.0) {
                    return null
                }
                number / 100.0
            }
            else -> return null
        }
        val pattern = when (val p = obj["pattern"]) {
            null -> defaults.pattern
            is JsonPrimitive -> if (p.isString && p.content in TerminalAgentPolicy.PATTERNS) p.content else return null
            else -> return null
        }
        return TerminalAgentPolicy(
            enabled = boolean("enabled", defaults.enabled) ?: return null,
            toast = boolean("toast", defaults.toast) ?: return null,
            browser = boolean("browser", defaults.browser) ?: return null,
            sound = boolean("sound", defaults.sound) ?: return null,
            volume = volume,
            pattern = pattern,
        )
    }

    val omp = policyFor("omp") ?: return unsupported
    val claude = policyFor("claude") ?: return unsupported
    val codex = policyFor("codex") ?: return unsupported
    return RemoteAgentPolicy.Supported(
        TerminalAgentNotifications(TerminalAgentNotifications.SUPPORTED_VERSION, AgentPolicies(omp, claude, codex)),
    )
}

/** Wire v2 object with all six fields per agent; local volume 0..1 becomes an integer 0..100. */
fun TerminalAgentNotifications.toWireJson(): JsonObject {
    fun wire(policy: TerminalAgentPolicy): JsonObject = buildJsonObject {
        put("enabled", policy.enabled)
        put("toast", policy.toast)
        put("browser", policy.browser)
        put("sound", policy.sound)
        put("volume", (policy.volume.coerceIn(0.0, 1.0) * 100.0).roundToInt())
        put("pattern", policy.pattern)
    }
    return buildJsonObject {
        put("version", version)
        put(
            "agents",
            buildJsonObject {
                put("omp", wire(agents.omp))
                put("claude", wire(agents.claude))
                put("codex", wire(agents.codex))
            },
        )
    }
}

/**
 * State of remote configuration editor tracking base, draft, dirty status, and external conflicts.
 */
data class RemoteConfigEditorState(
    val baseConfigJson: String? = null,
    val draftConfigJson: String? = null,
    val isDirty: Boolean = false,
    val hasConflict: Boolean = false,
    val conflictingServerJson: String? = null,
    val uiPreferencesDraft: UiPreferences = UiPreferences(),
    val uiPreferencesBase: UiPreferences = UiPreferences(),
    val isUiPreferencesDirty: Boolean = false,
    val isSaving: Boolean = false,
    val lastError: String? = null,
)
