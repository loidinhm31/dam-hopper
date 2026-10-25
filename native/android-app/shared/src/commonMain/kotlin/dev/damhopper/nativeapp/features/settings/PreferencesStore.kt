package dev.damhopper.nativeapp.features.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * Local persistence port. Implementations MUST commit only after a successful decode: corrupt or
 * unknown-envelope bytes stay untouched and are surfaced through [loadRecoverableError] instead of being
 * reset or overwritten with defaults.
 */
interface PreferencesStore {
    fun loadPreferences(): WorkbenchPreferences

    /** Saves shared+local preferences; legacy-filter metadata is preserved across unrelated saves. */
    fun savePreferences(preferences: WorkbenchPreferences)
    fun loadSourceTargetState(): SettingsSourceTargetState
    fun saveSourceTargetState(state: SettingsSourceTargetState)

    /**
     * Pre-v2 explorer filter value (`known|code|text`) behind the local ALL fallback, or null. Stored outside
     * the shared preferences; while non-null the fallback must not be treated as an explicit/dirty value.
     */
    fun loadLegacyExplorerLanguageFilter(): String?

    /** An explicit valid filter choice clears the visible notice; recovery bytes are NOT discarded. */
    fun clearLegacyExplorerLanguageFilter()

    /** Non-null while stored bytes could not be decoded and were kept as-is for recovery. */
    fun loadRecoverableError(): String?
}

class InMemoryPreferencesStore(
    initialPreferences: WorkbenchPreferences = WorkbenchPreferences(),
    initialSourceTargetState: SettingsSourceTargetState = SettingsSourceTargetState(),
    initialLegacyExplorerLanguageFilter: String? = null,
    private val recoverableError: String? = null,
) : PreferencesStore {
    private var preferences = initialPreferences.clamped()
    private var sourceTargetState = initialSourceTargetState
    private var legacyExplorerLanguageFilter = initialLegacyExplorerLanguageFilter

    private val _preferencesFlow = MutableStateFlow(preferences)
    val preferencesFlow: StateFlow<WorkbenchPreferences> = _preferencesFlow.asStateFlow()

    private val _sourceTargetStateFlow = MutableStateFlow(sourceTargetState)
    val sourceTargetStateFlow: StateFlow<SettingsSourceTargetState> = _sourceTargetStateFlow.asStateFlow()

    override fun loadPreferences(): WorkbenchPreferences = preferences

    override fun savePreferences(preferences: WorkbenchPreferences) {
        val clamped = preferences.clamped()
        this.preferences = clamped
        _preferencesFlow.value = clamped
    }

    override fun loadSourceTargetState(): SettingsSourceTargetState = sourceTargetState

    override fun saveSourceTargetState(state: SettingsSourceTargetState) {
        this.sourceTargetState = state
        _sourceTargetStateFlow.value = state
    }

    override fun loadLegacyExplorerLanguageFilter(): String? = legacyExplorerLanguageFilter

    override fun clearLegacyExplorerLanguageFilter() {
        legacyExplorerLanguageFilter = null
    }

    override fun loadRecoverableError(): String? = recoverableError
}

// ---- shared persistence codecs (no Android types; AndroidPreferencesStore delegates here) ----

internal val NativePreferencesJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

fun encodeNativePreferences(envelope: NativePreferencesEnvelope): String =
    NativePreferencesJson.encodeToString(NativePreferencesEnvelope.serializer(), envelope)

fun encodeSourceTargetState(state: SettingsSourceTargetState): String =
    NativePreferencesJson.encodeToString(SettingsSourceTargetState.serializer(), state)

/**
 * Decodes stored preferences: the v2 envelope, or the pre-v2 unversioned object (migrated: flat policy to
 * v2, `known/code/text` filter to local ALL with [NativePreferencesEnvelope.legacyExplorerLanguageFilter]).
 * Failure (corrupt JSON, unknown `nativeVersion`, unknown enum value, invalid policy) means the caller
 * MUST keep the original bytes and expose a recoverable error; this function never resets to defaults.
 */
fun decodeNativePreferences(raw: String): Result<NativePreferencesEnvelope> = runCatching {
    val root = NativePreferencesJson.parseToJsonElement(raw) as? JsonObject
        ?: throw IllegalArgumentException("Stored preferences are not a JSON object")
    if (root.containsKey("nativeVersion")) {
        val version = (root["nativeVersion"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
            ?: throw IllegalArgumentException("Malformed nativeVersion")
        require(version == NATIVE_PREFERENCES_VERSION) { "Unsupported nativeVersion $version" }
        val preferencesObject = root["preferences"] as? JsonObject
            ?: throw IllegalArgumentException("Envelope has no preferences object")
        val migrated = migratePreferencesObject(preferencesObject)
        val storedLegacy = (root["legacyExplorerLanguageFilter"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        NativePreferencesEnvelope(version, migrated.preferences, storedLegacy ?: migrated.legacyFilter)
    } else {
        val migrated = migratePreferencesObject(root)
        NativePreferencesEnvelope(NATIVE_PREFERENCES_VERSION, migrated.preferences, migrated.legacyFilter)
    }
}

/**
 * Decodes (and once-migrates) the stored source/target state. `lastSnapshot` is reduced to the shared
 * projection (local-only preferences, including command-history consent, never ride along); a legacy filter in
 * the snapshot moves to [SettingsSourceTargetState.lastSnapshotLegacyLanguageFilter]. Failure leaves the
 * original storage untouched.
 */
fun migrateSourceSnapshot(raw: String): Result<SettingsSourceTargetState> = runCatching {
    val root = NativePreferencesJson.parseToJsonElement(raw) as? JsonObject
        ?: throw IllegalArgumentException("Stored source state is not a JSON object")
    val fields = root.toMutableMap()
    var legacy = (root["lastSnapshotLegacyLanguageFilter"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    when (val snapshot = root["lastSnapshot"]) {
        null, JsonNull -> Unit
        is JsonObject -> {
            val migrated = migratePreferencesObject(snapshot)
            fields["lastSnapshot"] = NativePreferencesJson.encodeToJsonElement(
                WorkbenchPreferences.serializer(),
                migrated.preferences.sharedProjection(),
            )
            legacy = migrated.legacyFilter ?: legacy
        }
        else -> throw IllegalArgumentException("lastSnapshot must be an object")
    }
    if (legacy != null) fields["lastSnapshotLegacyLanguageFilter"] = JsonPrimitive(legacy)
    NativePreferencesJson.decodeFromJsonElement(SettingsSourceTargetState.serializer(), JsonObject(fields))
}

private class MigratedPreferences(val preferences: WorkbenchPreferences, val legacyFilter: String?)

private fun migratePreferencesObject(source: JsonObject): MigratedPreferences {
    val fields = source.toMutableMap()
    var legacyFilter: String? = null

    when (val filter = source["explorerLanguageFilter"]) {
        null, JsonNull -> fields.remove("explorerLanguageFilter")
        is JsonPrimitive -> {
            require(filter.isString) { "explorerLanguageFilter must be a string" }
            val value = filter.content
            when {
                ExplorerLanguageFilter.fromWireOrNull(value) != null -> Unit
                value in LEGACY_EXPLORER_LANGUAGE_FILTERS -> {
                    legacyFilter = value
                    fields["explorerLanguageFilter"] = JsonPrimitive(ExplorerLanguageFilter.ALL.wire)
                }
                else -> throw IllegalArgumentException("Unknown explorerLanguageFilter '$value'")
            }
        }
        else -> throw IllegalArgumentException("explorerLanguageFilter must be a string")
    }

    when (val policy = source["terminalAgentNotifications"]) {
        null -> Unit
        is JsonObject -> if (!policy.containsKey("version")) {
            fields["terminalAgentNotifications"] = migrateLegacyPolicy(policy)
        }
        else -> throw IllegalArgumentException("terminalAgentNotifications must be an object")
    }

    val decoded = NativePreferencesJson.decodeFromJsonElement(WorkbenchPreferences.serializer(), JsonObject(fields))
    require(decoded.terminalAgentNotifications.isValid()) { "Invalid terminal agent notification policy" }
    return MigratedPreferences(decoded.clamped(), legacyFilter)
}

/**
 * Legacy flat `{masterEnabled, omp, claude, codex}` to v2: each agent becomes
 * `masterEnabled && agent.enabled`, preserving toast/browser/sound; volume/pattern take 0.5/default.
 * A false master never produces an enabled agent, and nothing here requests permission or enables delivery.
 */
private fun migrateLegacyPolicy(legacy: JsonObject): JsonObject {
    val master = if (legacy["masterEnabled"] == null) {
        false
    } else {
        legacy.strictBoolean("masterEnabled") ?: throw IllegalArgumentException("masterEnabled must be a boolean")
    }
    val defaults = TerminalAgentPolicy()

    fun agent(name: String): JsonObject {
        val entry = when (val element = legacy[name]) {
            null -> null
            is JsonObject -> element
            else -> throw IllegalArgumentException("$name must be an object")
        }
        fun flag(key: String, default: Boolean): Boolean =
            if (entry == null || entry[key] == null) default else {
                entry.strictBoolean(key) ?: throw IllegalArgumentException("$name.$key must be a boolean")
            }
        val enabledFlag = flag("enabled", false) // always decoded/validated, even when master is false
        return buildJsonObject {
            put("enabled", master && enabledFlag)
            put("toast", flag("toast", defaults.toast))
            put("browser", flag("browser", defaults.browser))
            put("sound", flag("sound", defaults.sound))
            put("volume", defaults.volume)
            put("pattern", defaults.pattern)
        }
    }

    return buildJsonObject {
        put("version", TerminalAgentNotifications.SUPPORTED_VERSION)
        put(
            "agents",
            buildJsonObject {
                put("omp", agent("omp"))
                put("claude", agent("claude"))
                put("codex", agent("codex"))
            },
        )
    }
}
