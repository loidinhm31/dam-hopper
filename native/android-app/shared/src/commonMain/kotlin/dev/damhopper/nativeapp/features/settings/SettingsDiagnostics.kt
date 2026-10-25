package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.notifications.NotificationPlatformStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Everything the LOCAL diagnostics document may contain. This is an allowlist of typed fields: there is no
 * free-form text, server name/URL/account, path, token, command, history or terminal output input at all, so
 * nothing needs to be redacted after the fact.
 */
data class SettingsDiagnosticsInput(
    val generatedAtMs: Long,
    val preferences: WorkbenchPreferences,
    val sourceStatus: PreferenceSourceStatus,
    val syncStatus: PreferenceSyncStatus,
    val sourceSelected: Boolean,
    val targetSelected: Boolean,
    val unsupportedRemotePolicy: Boolean,
    val legacyLanguageFilterNotice: Boolean,
    val storageRecoverableError: Boolean,
    val configuredServerCount: Int,
    val notificationPlatform: NotificationPlatformStatus?,
)

object SettingsDiagnostics {
    const val FORMAT = "damhopper-local-diagnostics"
    const val VERSION = 1
    const val MIME_TYPE = "application/json"

    /** Exact top-level keys; tests assert the document never grows beyond them. */
    val TOP_LEVEL_KEYS: Set<String> = setOf(
        "format", "version", "scope", "generatedAtMs", "preferences", "shortcuts", "notificationPolicy",
        "sync", "platform", "configuredServerCount",
    )

    private val json = Json { prettyPrint = true }

    fun suggestedFileName(generatedAtMs: Long): String = "damhopper-diagnostics-$generatedAtMs.json"

    const val INVALID_VALUE = "<invalid>"

    /** A shortcut is exported only when it is DoubleShift or a keyboard chord with a well-known DOM code. */
    internal fun safeShortcut(value: String): String {
        val parsed = ShortcutGrammar.parse(value) ?: return INVALID_VALUE
        val ok = when (parsed.kind) {
            ShortcutKind.DOUBLE_SHIFT -> true
            ShortcutKind.KEYBOARD -> parsed.code?.let { ShortcutGrammar.isKnownDomCode(it) } == true
            ShortcutKind.WHEEL -> false
        }
        return if (ok) ShortcutGrammar.format(value) else INVALID_VALUE
    }

    /** A pattern is exported only when it is one of the closed pattern names. */
    internal fun safePattern(value: String): String = if (value in TerminalAgentPolicy.PATTERNS) value else INVALID_VALUE

    fun build(input: SettingsDiagnosticsInput): ByteArray = json.encodeToString(JsonElement.serializer(), buildObject(input)).encodeToByteArray()

    internal fun buildObject(input: SettingsDiagnosticsInput): JsonObject {
        val p = input.preferences
        return buildJsonObject {
            put("format", FORMAT)
            put("version", VERSION)
            put("scope", "LOCAL")
            put("generatedAtMs", input.generatedAtMs)
            put(
                "preferences",
                buildJsonObject {
                    put("theme", p.theme.name)
                    put("systemFontSize", p.systemFontSize)
                    put("editorFontSize", p.editorFontSize)
                    put("terminalFontSize", p.terminalFontSize)
                    put("editorZoomWheelEnabled", p.editorZoomWheelEnabled)
                    put("terminalSuggestionsEnabled", p.terminalSuggestionsEnabled)
                    put("terminalScrollButtonsEnabled", p.terminalScrollButtonsEnabled)
                    put("terminalCommitStatusEnabled", p.terminalCommitStatusEnabled)
                    put("terminalAutoSwitchProjectEnabled", p.terminalAutoSwitchProjectEnabled)
                    put("terminalScrollStep", p.terminalScrollStep)
                    put("explorerShowHidden", p.explorerShowHidden)
                    put("explorerLanguageFilter", p.explorerLanguageFilter.wire)
                    put("mobileCustomKeyboardEnabled", p.mobileCustomKeyboardEnabled)
                    put("mobileCustomKeyboardFontSize", p.mobileCustomKeyboardFontSize)
                    put("mobileCustomKeyboardPadding", p.mobileCustomKeyboardPadding)
                    put("mobileCustomKeyboardRowGap", p.mobileCustomKeyboardRowGap)
                    put("soundEnabled", p.soundEnabled)
                    put("hapticFeedbackEnabled", p.hapticFeedbackEnabled)
                    put("commandHistoryEnabled", p.commandHistoryEnabled) // consent flag only, never any history
                    put("cognitoModeStyle", p.cognitoModeStyle.name)
                    // statusFilter is free user text and is intentionally NOT included.
                },
            )
            put(
                "shortcuts",
                buildJsonObject {
                    ShortcutAction.entries.forEach { put(it.name, safeShortcut(it.read(p))) }
                },
            )
            put(
                "notificationPolicy",
                buildJsonObject {
                    put("version", p.terminalAgentNotifications.version)
                    fun agent(name: String, a: TerminalAgentPolicy) = put(
                        name,
                        buildJsonObject {
                            put("enabled", a.enabled)
                            put("toast", a.toast)
                            put("browser", a.browser)
                            put("sound", a.sound)
                            put("volume", if (a.volume.isFinite()) a.volume else 0.0)
                            put("pattern", safePattern(a.pattern))
                        },
                    )
                    agent("omp", p.terminalAgentNotifications.agents.omp)
                    agent("claude", p.terminalAgentNotifications.agents.claude)
                    agent("codex", p.terminalAgentNotifications.agents.codex)
                },
            )
            put(
                "sync",
                buildJsonObject {
                    put("sourceStatus", input.sourceStatus.name)
                    put("syncStatus", input.syncStatus.name)
                    put("sourceSelected", input.sourceSelected)
                    put("targetSelected", input.targetSelected)
                    put("unsupportedRemotePolicy", input.unsupportedRemotePolicy)
                    put("legacyLanguageFilterNotice", input.legacyLanguageFilterNotice)
                    put("storageRecoverableError", input.storageRecoverableError)
                },
            )
            put(
                "platform",
                input.notificationPlatform?.let { platform ->
                    buildJsonObject {
                        put("permission", platform.permission.name)
                        put("appBlocked", platform.appBlocked)
                        put(
                            "channels",
                            buildJsonObject {
                                platform.channels.forEach { (channel, status) ->
                                    put(
                                        channel.name,
                                        buildJsonObject {
                                            put("blocked", status.blocked)
                                            put("soundConfigured", status.soundConfigured)
                                        },
                                    )
                                }
                            },
                        )
                    }
                } ?: kotlinx.serialization.json.JsonNull,
            )
            put("configuredServerCount", input.configuredServerCount)
        }
    }
}
