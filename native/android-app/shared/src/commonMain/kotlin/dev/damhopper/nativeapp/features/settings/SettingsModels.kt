package dev.damhopper.nativeapp.features.settings

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Maximum size allowed for TOML configuration imports (1 MiB ceiling).
 */
const val MAX_CONFIG_IMPORT_BYTES = 1024L * 1024L

@Serializable
enum class WorkbenchTheme {
    @SerialName("dark")
    DARK,
    @SerialName("light")
    LIGHT,
    @SerialName("system")
    SYSTEM,
    @SerialName("high-contrast")
    HIGH_CONTRAST,
}

@Serializable
enum class CognitoModeStyle {
    @SerialName("heavy-blur")
    HEAVY_BLUR,
    @SerialName("black-screen")
    BLACK_SCREEN,
}

/**
 * Closed set of Explorer language filters, matching the server wire schema
 * (`packages/ui/src/api/fs-types.ts`, `server/src/config/schema.rs`).
 * The legacy native values `known`, `code`, `text` are NOT wire values and have no equivalent;
 * see [LEGACY_EXPLORER_LANGUAGE_FILTERS].
 */
@Serializable
enum class ExplorerLanguageFilter(val wire: String) {
    @SerialName("all")
    ALL("all"),
    @SerialName("rust")
    RUST("rust"),
    @SerialName("javascript-typescript")
    JAVASCRIPT_TYPESCRIPT("javascript-typescript"),
    @SerialName("java")
    JAVA("java");

    companion object {
        fun fromWireOrNull(value: String?): ExplorerLanguageFilter? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * Pre-v2 native filter values. Each decodes to a *local* [ExplorerLanguageFilter.ALL] fallback that is
 * explicitly non-equivalent, carries a migration notice, is never dirty and is never auto-saved remotely.
 */
val LEGACY_EXPLORER_LANGUAGE_FILTERS: Set<String> = setOf("known", "code", "text")

@Serializable
enum class PreferenceSourceStatus {
    @SerialName("active")
    ACTIVE,
    @SerialName("source-removed")
    SOURCE_REMOVED,
    @SerialName("unset")
    UNSET,
}

// ---- C1 terminal agent notification policy (v2) ----

/**
 * Per-agent policy. Local volume is finite 0..1 (audio port contract); the server wire stores an
 * integer 0..100 and is converted only by the remote codec in `RemoteConfigModels.kt`.
 * Defaults are the safe local defaults: nothing enabled, no OS post, no sound.
 */
@Serializable
data class TerminalAgentPolicy(
    val enabled: Boolean = false,
    val toast: Boolean = true,
    val browser: Boolean = false,
    val sound: Boolean = false,
    val volume: Double = 0.5,
    val pattern: String = "default",
) {
    fun isValid(): Boolean = volume.isFinite() && volume in 0.0..1.0 && pattern in PATTERNS

    companion object {
        val PATTERNS: Set<String> = setOf("default", "soft", "two-tone", "urgent")
    }
}

@Serializable
data class AgentPolicies(
    val omp: TerminalAgentPolicy = TerminalAgentPolicy(),
    val claude: TerminalAgentPolicy = TerminalAgentPolicy(),
    val codex: TerminalAgentPolicy = TerminalAgentPolicy(),
)

@Serializable
data class TerminalAgentNotifications(
    val version: Int = 2,
    val agents: AgentPolicies = AgentPolicies(),
) {
    fun isValid(): Boolean = version == SUPPORTED_VERSION &&
        agents.omp.isValid() && agents.claude.isValid() && agents.codex.isValid()

    companion object {
        const val SUPPORTED_VERSION = 2
    }
}

// ---- C1 hardware shortcut grammar (modifier aliases/format follow packages/ui/src/lib/shortcuts.ts) ----

const val DOUBLE_SHIFT_SHORTCUT = "DoubleShift"

/** DoubleShift window: second non-repeat Shift key-down 0..450ms (inclusive) after the first. */
const val DOUBLE_SHIFT_MAX_INTERVAL_MS = 450L

/** Exact web defaults (`packages/ui/src/lib/shortcuts.ts`); no native-familiar substitutions. */
object ShortcutDefaults {
    const val SEARCH_TEXT = "Mod+Shift+KeyF"
    const val SEARCH_FILENAME = DOUBLE_SHIFT_SHORTCUT
    const val TERMINAL_WORKSPACE = "Mod+Shift+Backquote"
    const val TERMINAL_FILE_PANEL = "Mod+Shift+KeyE"
    const val PROJECT_PANEL = "Mod+Shift+KeyZ"
    const val REVEAL_ACTIVE_FILE = "Alt+F1"
    const val GIT_PANEL = "Mod+Shift+KeyG"
    const val PORTS_PANEL = "Mod+Shift+KeyP"
    const val FLEET_TERMINAL = "Mod+Shift+KeyM"
    const val TERMINAL_FONT_SIZE_INCREASE = "Ctrl+Alt+Shift+Equal"
    const val TERMINAL_FONT_SIZE_DECREASE = "Ctrl+Alt+Minus"
    const val COGNITO_MODE = "Mod+Alt+KeyB"
}

enum class ShortcutKind { KEYBOARD, DOUBLE_SHIFT, WHEEL }

/**
 * Parsed stored shortcut. Android mapping: `Mod` = Ctrl, explicit Cmd/Meta/Command = Android Meta,
 * modifiers are exact, and `Ctrl+Mod` collapses to Ctrl ([effectiveCtrl]).
 */
data class ParsedShortcut(
    val kind: ShortcutKind,
    val mod: Boolean = false,
    val ctrl: Boolean = false,
    val meta: Boolean = false,
    val alt: Boolean = false,
    val shift: Boolean = false,
    val code: String? = null,
) {
    val effectiveCtrl: Boolean get() = mod || ctrl
    val effectiveMeta: Boolean get() = meta
}

object ShortcutGrammar {
    private val modifierCodeNames = setOf(
        "shiftleft", "shiftright", "controlleft", "controlright", "altleft", "altright",
        "metaleft", "metaright", "osleft", "osright", "shift", "control", "ctrl", "alt",
        "meta", "cmd", "command", "option", "mod",
    )
    private val namedCodes = setOf(
        "Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote",
        "Comma", "Period", "Slash", "Space", "Enter", "Escape", "Tab", "Backspace", "Delete", "Insert",
        "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "CapsLock", "ScrollLock", "NumLock", "PrintScreen", "Pause",
    )
    /** Codes that have an Android physical key event (no F13..F24, lock keys, PrintScreen, Pause). */
    private val androidDispatchableNamedCodes = namedCodes - setOf("CapsLock", "ScrollLock", "NumLock", "PrintScreen", "Pause")
    private val androidNumpadCodes = setOf(
        "Numpad0", "Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6", "Numpad7", "Numpad8", "Numpad9",
        "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter",
        "NumpadEqual", "NumpadComma",
    )

    private val keyLetter = Regex("^[a-zA-Z]$")
    private val keyDigit = Regex("^[0-9]$")
    private val keyLetterPrefixed = Regex("^key[a-z]$", RegexOption.IGNORE_CASE)
    private val keyDigitPrefixed = Regex("^digit[0-9]$", RegexOption.IGNORE_CASE)
    private val functionKey = Regex("^f\\d{1,2}$", RegexOption.IGNORE_CASE)
    private val domLetter = Regex("^Key[A-Z]$")
    private val domDigit = Regex("^Digit[0-9]$")
    private val domFunction = Regex("^F([1-9]|1[0-9]|2[0-4])$")
    private val domAndroidFunction = Regex("^F([1-9]|1[0-2])$")
    private val domNumpad = Regex("^Numpad[A-Za-z0-9]+$")

    fun parse(shortcut: String): ParsedShortcut? {
        val trimmed = shortcut.trim()
        if (trimmed.equals(DOUBLE_SHIFT_SHORTCUT, ignoreCase = true)) {
            return ParsedShortcut(ShortcutKind.DOUBLE_SHIFT)
        }
        val parts = trimmed.split("+").map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.isEmpty()) return null

        var mod = false
        var ctrl = false
        var meta = false
        var alt = false
        var shift = false
        var terminal: String? = null
        for (part in parts) {
            when (part.lowercase()) {
                "mod" -> mod = true
                "ctrl", "control" -> ctrl = true
                "cmd", "meta", "command" -> meta = true
                "alt", "option" -> alt = true
                "shift" -> shift = true
                else -> {
                    if (terminal != null) return null
                    terminal = part
                }
            }
        }
        val key = terminal ?: return null // modifier-only is invalid
        if (key.equals("wheel", ignoreCase = true)) {
            return ParsedShortcut(ShortcutKind.WHEEL, mod, ctrl, meta, alt, shift)
        }
        return ParsedShortcut(ShortcutKind.KEYBOARD, mod, ctrl, meta, alt, shift, normalizeCode(key))
    }

    /** Canonical stored form: `Mod+Ctrl+Cmd+Alt+Shift+Code`, `DoubleShift` or `...+Wheel`; unparsable input unchanged. */
    fun format(shortcut: String): String {
        val parsed = parse(shortcut) ?: return shortcut
        if (parsed.kind == ShortcutKind.DOUBLE_SHIFT) return DOUBLE_SHIFT_SHORTCUT
        val parts = mutableListOf<String>()
        if (parsed.mod) parts += "Mod"
        if (parsed.ctrl) parts += "Ctrl"
        if (parsed.meta) parts += "Cmd"
        if (parsed.alt) parts += "Alt"
        if (parsed.shift) parts += "Shift"
        parts += if (parsed.kind == ShortcutKind.WHEEL) "Wheel" else parsed.code.orEmpty()
        return parts.joinToString("+")
    }

    /**
     * Stored-binding validity for an action field. Keyboard chords need a non-modifier code;
     * DoubleShift is valid only where [allowDoubleShift] (everything except Cognito mode); Wheel is never an
     * action binding. Unknown-but-well-formed codes (F13..F24, ...) are valid and preserved even when
     * [isAndroidDispatchable] is false.
     */
    fun isValidBinding(shortcut: String, allowDoubleShift: Boolean): Boolean {
        val parsed = parse(shortcut) ?: return false
        return when (parsed.kind) {
            ShortcutKind.DOUBLE_SHIFT -> allowDoubleShift
            ShortcutKind.WHEEL -> false
            ShortcutKind.KEYBOARD -> {
                val code = parsed.code
                !code.isNullOrBlank() && code.lowercase() !in modifierCodeNames
            }
        }
    }

    /**
     * Cognito mode accepts only a keyboard chord (never DoubleShift/Wheel) whose terminal is a usable DOM
     * code ([isKnownDomCode]); generic [isValidBinding] is intentionally looser, as on the web.
     */
    fun isValidCognitoBinding(shortcut: String): Boolean {
        if (!isValidBinding(shortcut, allowDoubleShift = false)) return false
        val code = parse(shortcut)?.code ?: return false
        return isKnownDomCode(code)
    }

    /**
     * True when an Android physical key event can produce [code]: letters, digits, F1..F12, the named
     * editing/punctuation keys and the real numpad codes. F13..F24, lock keys, PrintScreen, Pause and invented
     * codes stay preserved by the grammar but are unavailable.
     */
    fun isAndroidDispatchable(code: String): Boolean =
        domLetter.matches(code) || domDigit.matches(code) || domAndroidFunction.matches(code) ||
            code in androidNumpadCodes || code in androidDispatchableNamedCodes

    /** True for any syntactically usable DOM code (web `isUsableKeyCode`), including ones Android cannot produce. */
    fun isKnownDomCode(code: String): Boolean =
        domLetter.matches(code) || domDigit.matches(code) || domFunction.matches(code) ||
            domNumpad.matches(code) || code in namedCodes

    /** Exact-modifier match on DOM [code]; Mod=Ctrl, Cmd/Meta=Android Meta. */
    fun matches(
        parsed: ParsedShortcut,
        code: String,
        ctrl: Boolean,
        meta: Boolean,
        alt: Boolean,
        shift: Boolean,
    ): Boolean = parsed.kind == ShortcutKind.KEYBOARD &&
        parsed.code == code &&
        parsed.effectiveCtrl == ctrl &&
        parsed.effectiveMeta == meta &&
        parsed.alt == alt &&
        parsed.shift == shift

    private fun normalizeCode(code: String): String = when {
        keyLetter.matches(code) -> "Key${code.uppercase()}"
        keyDigit.matches(code) -> "Digit$code"
        keyLetterPrefixed.matches(code) -> "Key${code.substring(3).uppercase()}"
        keyDigitPrefixed.matches(code) -> "Digit${code.substring(5)}"
        functionKey.matches(code) -> code.uppercase()
        code.equals("backquote", ignoreCase = true) -> "Backquote"
        code.equals("equal", ignoreCase = true) -> "Equal"
        code.equals("minus", ignoreCase = true) -> "Minus"
        else -> code
    }
}

/**
 * Pure DoubleShift state machine (monotonic event time, either Shift side).
 *
 * Two non-repeat Shift key-down edges with a release between them, no Ctrl/Alt/Meta, elapsed
 * 0..[thresholdMs] inclusive. A match clears the state; >threshold arms a new first tap. Repeats and
 * IME composition never arm or trigger. Callers invoke [reset] on any non-Shift input, added modifier,
 * focus loss, route/owner change, composition start, capture start/cancel, input-gate change or
 * background. On a match the caller dispatches once and consumes the matching release (the value
 * returned by [onShiftUp]); nothing leaks to PTY/editor.
 */
class DoubleShiftDetector(private val thresholdMs: Long = DOUBLE_SHIFT_MAX_INTERVAL_MS) {
    private var firstDownAtMs: Long? = null
    private var released = false
    private var consumeNextRelease = false

    /** Returns true exactly when this key-down completes DoubleShift. */
    fun onShiftDown(timeMs: Long, repeat: Boolean, composing: Boolean, ctrl: Boolean, alt: Boolean, meta: Boolean): Boolean {
        if (repeat || composing) return false
        if (ctrl || alt || meta) {
            reset()
            return false
        }
        val first = firstDownAtMs
        val elapsed = if (first == null) -1L else timeMs - first
        if (first != null && released && elapsed in 0..thresholdMs) {
            firstDownAtMs = null
            released = false
            consumeNextRelease = true
            return true
        }
        // First tap, expired window, or a second down without a release between: (re)arm.
        firstDownAtMs = timeMs
        released = false
        consumeNextRelease = false
        return false
    }

    /** Records a Shift key-up; returns true when this release belongs to a matched DoubleShift and must be consumed. */
    fun onShiftUp(): Boolean {
        if (consumeNextRelease) {
            consumeNextRelease = false
            return true
        }
        if (firstDownAtMs != null) released = true
        return false
    }

    fun reset() {
        firstDownAtMs = null
        released = false
        consumeNextRelease = false
    }
}

// ---- C1 preferences ----

/**
 * Persisted local and synchronized workbench preferences.
 *
 * Local-only (never part of UiPreferences or any source snapshot): [theme], [soundEnabled],
 * [hapticFeedbackEnabled], [statusFilter], [commandHistoryEnabled] (default false for privacy).
 */
@Serializable
data class WorkbenchPreferences(
    val theme: WorkbenchTheme = WorkbenchTheme.DARK,
    val systemFontSize: Int = 14,
    val editorFontSize: Int = 14,
    val terminalFontSize: Int = 13,
    val editorZoomWheelEnabled: Boolean = true,
    val terminalSuggestionsEnabled: Boolean = true,
    val terminalScrollButtonsEnabled: Boolean = true,
    val terminalCommitStatusEnabled: Boolean = true,
    val terminalAutoSwitchProjectEnabled: Boolean = true,
    val terminalScrollStep: Int = 5,
    val explorerShowHidden: Boolean = false,
    val explorerLanguageFilter: ExplorerLanguageFilter = ExplorerLanguageFilter.ALL,
    val mobileCustomKeyboardEnabled: Boolean = true,
    val mobileCustomKeyboardFontSize: Int = 11,
    val mobileCustomKeyboardPadding: Int = 6,
    val mobileCustomKeyboardRowGap: Int = 4,
    val soundEnabled: Boolean = true,
    val hapticFeedbackEnabled: Boolean = true,
    val statusFilter: String = "",
    val commandHistoryEnabled: Boolean = false,
    val searchTextShortcut: String = ShortcutDefaults.SEARCH_TEXT,
    val searchFilenameShortcut: String = ShortcutDefaults.SEARCH_FILENAME,
    val terminalWorkspaceShortcut: String = ShortcutDefaults.TERMINAL_WORKSPACE,
    val terminalFilePanelShortcut: String = ShortcutDefaults.TERMINAL_FILE_PANEL,
    val projectPanelShortcut: String = ShortcutDefaults.PROJECT_PANEL,
    val revealActiveFileShortcut: String = ShortcutDefaults.REVEAL_ACTIVE_FILE,
    val gitPanelShortcut: String = ShortcutDefaults.GIT_PANEL,
    val portsPanelShortcut: String = ShortcutDefaults.PORTS_PANEL,
    val fleetTerminalShortcut: String = ShortcutDefaults.FLEET_TERMINAL,
    val terminalFontSizeIncreaseShortcut: String = ShortcutDefaults.TERMINAL_FONT_SIZE_INCREASE,
    val terminalFontSizeDecreaseShortcut: String = ShortcutDefaults.TERMINAL_FONT_SIZE_DECREASE,
    val cognitoModeShortcut: String = ShortcutDefaults.COGNITO_MODE,
    val cognitoModeStyle: CognitoModeStyle = CognitoModeStyle.HEAVY_BLUR,
    val terminalAgentNotifications: TerminalAgentNotifications = TerminalAgentNotifications(),
) {
    companion object {
        const val FONT_MIN = 10
        const val FONT_MAX = 32
        const val SCROLL_STEP_MIN = 1
        const val SCROLL_STEP_MAX = 50
        const val KEYBOARD_FONT_MIN = 9
        const val KEYBOARD_FONT_MAX = 18
        const val KEYBOARD_PADDING_MIN = 2
        const val KEYBOARD_PADDING_MAX = 14
        const val KEYBOARD_ROW_GAP_MIN = 2
        const val KEYBOARD_ROW_GAP_MAX = 12

        fun clampFont(size: Int): Int = size.coerceIn(FONT_MIN, FONT_MAX)
        fun clampScrollStep(step: Int): Int = step.coerceIn(SCROLL_STEP_MIN, SCROLL_STEP_MAX)
        fun clampKeyboardFont(size: Int): Int = size.coerceIn(KEYBOARD_FONT_MIN, KEYBOARD_FONT_MAX)
        fun clampKeyboardPadding(dp: Int): Int = dp.coerceIn(KEYBOARD_PADDING_MIN, KEYBOARD_PADDING_MAX)
        fun clampKeyboardRowGap(dp: Int): Int = dp.coerceIn(KEYBOARD_ROW_GAP_MIN, KEYBOARD_ROW_GAP_MAX)

        /**
         * Invalid stored/imported bindings fall back to the exact web default; valid ones are preserved verbatim.
         * [cognito] applies the stricter Cognito rule (keyboard chord with a usable DOM code, no DoubleShift).
         */
        fun normalizeShortcut(value: String, default: String, cognito: Boolean = false): String {
            val valid = if (cognito) {
                ShortcutGrammar.isValidCognitoBinding(value)
            } else {
                ShortcutGrammar.isValidBinding(value, allowDoubleShift = true)
            }
            return if (valid) value else default
        }
    }

    fun clamped(): WorkbenchPreferences = copy(
        systemFontSize = clampFont(systemFontSize),
        editorFontSize = clampFont(editorFontSize),
        terminalFontSize = clampFont(terminalFontSize),
        terminalScrollStep = clampScrollStep(terminalScrollStep),
        mobileCustomKeyboardFontSize = clampKeyboardFont(mobileCustomKeyboardFontSize),
        mobileCustomKeyboardPadding = clampKeyboardPadding(mobileCustomKeyboardPadding),
        mobileCustomKeyboardRowGap = clampKeyboardRowGap(mobileCustomKeyboardRowGap),
        searchTextShortcut = normalizeShortcut(searchTextShortcut, ShortcutDefaults.SEARCH_TEXT),
        searchFilenameShortcut = normalizeShortcut(searchFilenameShortcut, ShortcutDefaults.SEARCH_FILENAME),
        terminalWorkspaceShortcut = normalizeShortcut(terminalWorkspaceShortcut, ShortcutDefaults.TERMINAL_WORKSPACE),
        terminalFilePanelShortcut = normalizeShortcut(terminalFilePanelShortcut, ShortcutDefaults.TERMINAL_FILE_PANEL),
        projectPanelShortcut = normalizeShortcut(projectPanelShortcut, ShortcutDefaults.PROJECT_PANEL),
        revealActiveFileShortcut = normalizeShortcut(revealActiveFileShortcut, ShortcutDefaults.REVEAL_ACTIVE_FILE),
        gitPanelShortcut = normalizeShortcut(gitPanelShortcut, ShortcutDefaults.GIT_PANEL),
        portsPanelShortcut = normalizeShortcut(portsPanelShortcut, ShortcutDefaults.PORTS_PANEL),
        fleetTerminalShortcut = normalizeShortcut(fleetTerminalShortcut, ShortcutDefaults.FLEET_TERMINAL),
        terminalFontSizeIncreaseShortcut = normalizeShortcut(
            terminalFontSizeIncreaseShortcut, ShortcutDefaults.TERMINAL_FONT_SIZE_INCREASE,
        ),
        terminalFontSizeDecreaseShortcut = normalizeShortcut(
            terminalFontSizeDecreaseShortcut, ShortcutDefaults.TERMINAL_FONT_SIZE_DECREASE,
        ),
        cognitoModeShortcut = normalizeShortcut(cognitoModeShortcut, ShortcutDefaults.COGNITO_MODE, cognito = true),
    )

    /** The synchronized projection: local-only preferences (incl. command-history consent) reset to defaults. */
    fun sharedProjection(): WorkbenchPreferences {
        val local = WorkbenchPreferences()
        return copy(
            theme = local.theme,
            soundEnabled = local.soundEnabled,
            hapticFeedbackEnabled = local.hapticFeedbackEnabled,
            statusFilter = local.statusFilter,
            commandHistoryEnabled = local.commandHistoryEnabled,
        )
    }
}

/**
 * State tracking independent selections:
 * - preferencesProfileId: server profile used as source for shared appearance / preferences
 * - settingsProfileId: server profile whose workspace config / maintenance / import-export is managed
 *
 * [lastSnapshot] is the shared projection only; local consent is stored separately. The raw remote policy
 * ([lastSnapshotPolicy], possibly an unsupported version) and its [lastSnapshotSourceProfileId] are kept
 * untouched next to it. [lastSnapshotLegacyLanguageFilter] records a pre-v2 `known/code/text` value so the
 * local ALL fallback is never mistaken for an explicit remote value.
 */
@Serializable
data class SettingsSourceTargetState(
    val preferencesProfileId: String? = null,
    val preferencesStatus: PreferenceSourceStatus = PreferenceSourceStatus.UNSET,
    val lastSnapshot: WorkbenchPreferences? = null,
    val settingsProfileId: String? = null,
    val lastSnapshotPolicy: JsonObject? = null,
    val lastSnapshotSourceProfileId: String? = null,
    val lastSnapshotLegacyLanguageFilter: String? = null,
)

/**
 * Native persisted envelope `{nativeVersion:2, preferences:<WorkbenchPreferences>}`.
 * [legacyExplorerLanguageFilter] lives outside the shared preferences and survives unrelated saves.
 */
@Serializable
data class NativePreferencesEnvelope(
    val nativeVersion: Int = NATIVE_PREFERENCES_VERSION,
    val preferences: WorkbenchPreferences,
    val legacyExplorerLanguageFilter: String? = null,
)

const val NATIVE_PREFERENCES_VERSION = 2

// ---- C2b import response ----

/**
 * Authoritative workspace import response (`SettingsImportResponse` in `packages/ui/src/api/client.ts`).
 * Only produced for `imported == true` with well-formed required fields; there is no `ok`/`error` discriminator.
 */
@Serializable
data class SettingsImportResult(
    val imported: Boolean,
    val fileName: String,
    val backupFileName: String,
    val workspaceName: String? = null,
)

/** Decoded import response. Anything other than [Imported] never confirms success. */
sealed interface SettingsImportDecode {
    data class Imported(val result: SettingsImportResult) : SettingsImportDecode
    /** Well-formed `imported:false`: the server reports nothing was imported. */
    data object NotImported : SettingsImportDecode
    /** Missing/malformed discriminator or required fields: after admission the effect is Unknown. */
    data class Malformed(val reason: String) : SettingsImportDecode
}

fun decodeSettingsImportResponse(body: String): SettingsImportDecode {
    val root = try {
        NativePreferencesJson.parseToJsonElement(body) as? JsonObject
    } catch (_: Exception) {
        null
    } ?: return SettingsImportDecode.Malformed("Import response is not a JSON object")

    val discriminator = root["imported"] as? JsonPrimitive
    val imported = discriminator?.takeIf { !it.isString }?.booleanOrNull
        ?: return SettingsImportDecode.Malformed("Import response has no boolean 'imported'")
    if (!imported) return SettingsImportDecode.NotImported

    fun requiredString(key: String): String? {
        val primitive = root[key] as? JsonPrimitive ?: return null
        return if (primitive.isString) primitive.contentOrNull?.takeIf { it.isNotBlank() } else null
    }
    val fileName = requiredString("fileName")
        ?: return SettingsImportDecode.Malformed("Import response is missing 'fileName'")
    val backupFileName = requiredString("backupFileName")
        ?: return SettingsImportDecode.Malformed("Import response is missing 'backupFileName'")
    val workspaceElement = root["workspaceName"]
    val workspaceName = when {
        workspaceElement == null || workspaceElement is kotlinx.serialization.json.JsonNull -> null
        workspaceElement is JsonPrimitive && workspaceElement.isString -> workspaceElement.content
        else -> return SettingsImportDecode.Malformed("Import response has a malformed 'workspaceName'")
    }
    return SettingsImportDecode.Imported(SettingsImportResult(true, fileName, backupFileName, workspaceName))
}

data class SettingsImportExportState(
    val isExporting: Boolean = false,
    val isImporting: Boolean = false,
    val lastExportedToml: String? = null,
    val lastImportResult: SettingsImportResult? = null,
    val lastError: String? = null,
)

// ---- UiPreferences projection (lossless supported-field mapping) ----

/**
 * Projects every supported synchronized field. The terminal agent policy is included only when
 * [includePolicy] is set by an explicit supported-policy edit; unrelated projections omit it.
 * Local-only preferences are never projected. Prefer [dirtyUiPatch] for saves.
 */
fun WorkbenchPreferences.toUiPreferences(includePolicy: Boolean = false): UiPreferences = UiPreferences(
    systemFontSize = systemFontSize,
    editorFontSize = editorFontSize,
    terminalFontSize = terminalFontSize,
    editorZoomWheelEnabled = editorZoomWheelEnabled,
    explorerShowHidden = explorerShowHidden,
    terminalSuggestionsEnabled = terminalSuggestionsEnabled,
    terminalCommitStatusEnabled = terminalCommitStatusEnabled,
    terminalAutoSwitchProjectEnabled = terminalAutoSwitchProjectEnabled,
    terminalScrollButtonsEnabled = terminalScrollButtonsEnabled,
    terminalScrollStep = terminalScrollStep,
    explorerLanguageFilter = explorerLanguageFilter.wire,
    mobileCustomKeyboardEnabled = mobileCustomKeyboardEnabled,
    mobileCustomKeyboardFontSize = mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding = mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap = mobileCustomKeyboardRowGap,
    searchTextShortcut = searchTextShortcut,
    searchFilenameShortcut = searchFilenameShortcut,
    terminalWorkspaceShortcut = terminalWorkspaceShortcut,
    terminalFilePanelShortcut = terminalFilePanelShortcut,
    projectPanelShortcut = projectPanelShortcut,
    revealActiveFileShortcut = revealActiveFileShortcut,
    gitPanelShortcut = gitPanelShortcut,
    portsPanelShortcut = portsPanelShortcut,
    fleetTerminalShortcut = fleetTerminalShortcut,
    terminalFontSizeIncreaseShortcut = terminalFontSizeIncreaseShortcut,
    terminalFontSizeDecreaseShortcut = terminalFontSizeDecreaseShortcut,
    cognitoModeShortcut = cognitoModeShortcut,
    cognitoModeStyle = when (cognitoModeStyle) {
        CognitoModeStyle.HEAVY_BLUR -> "heavy-blur"
        CognitoModeStyle.BLACK_SCREEN -> "black-screen"
    },
    terminalAgentNotifications = if (includePolicy) terminalAgentNotifications.toWireJson() else null,
)

/**
 * Hydrates [base] from a remote UI object. Absent fields keep [base]; out-of-range numbers clamp;
 * invalid shortcut strings keep [base]; an unknown remote language string falls back to local ALL
 * (never dirty, see [dirtyUiPatch]). The agent policy hydrates only from a supported v2 object; an
 * absent or unsupported remote policy yields safe disabled defaults (the raw object is preserved by the
 * caller, delivery is suppressed for unsupported versions).
 */
fun UiPreferences.applyTo(base: WorkbenchPreferences): WorkbenchPreferences {
    fun shortcut(value: String?, current: String, cognito: Boolean = false): String {
        if (value == null) return current
        val valid = if (cognito) {
            ShortcutGrammar.isValidCognitoBinding(value)
        } else {
            ShortcutGrammar.isValidBinding(value, allowDoubleShift = true)
        }
        return if (valid) value else current
    }

    val language = when {
        explorerLanguageFilter == null -> base.explorerLanguageFilter
        else -> ExplorerLanguageFilter.fromWireOrNull(explorerLanguageFilter) ?: ExplorerLanguageFilter.ALL
    }
    val policy = when (val decoded = decodeRemoteAgentPolicy(terminalAgentNotifications)) {
        is RemoteAgentPolicy.Supported -> decoded.policy
        RemoteAgentPolicy.Absent, is RemoteAgentPolicy.Unsupported -> TerminalAgentNotifications()
    }
    return base.copy(
        systemFontSize = systemFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.systemFontSize,
        editorFontSize = editorFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.editorFontSize,
        terminalFontSize = terminalFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.terminalFontSize,
        editorZoomWheelEnabled = editorZoomWheelEnabled ?: base.editorZoomWheelEnabled,
        explorerShowHidden = explorerShowHidden ?: base.explorerShowHidden,
        terminalSuggestionsEnabled = terminalSuggestionsEnabled ?: base.terminalSuggestionsEnabled,
        terminalCommitStatusEnabled = terminalCommitStatusEnabled ?: base.terminalCommitStatusEnabled,
        terminalAutoSwitchProjectEnabled = terminalAutoSwitchProjectEnabled ?: base.terminalAutoSwitchProjectEnabled,
        terminalScrollButtonsEnabled = terminalScrollButtonsEnabled ?: base.terminalScrollButtonsEnabled,
        terminalScrollStep = terminalScrollStep?.let { WorkbenchPreferences.clampScrollStep(it) } ?: base.terminalScrollStep,
        explorerLanguageFilter = language,
        mobileCustomKeyboardEnabled = mobileCustomKeyboardEnabled ?: base.mobileCustomKeyboardEnabled,
        mobileCustomKeyboardFontSize = mobileCustomKeyboardFontSize?.let { WorkbenchPreferences.clampKeyboardFont(it) }
            ?: base.mobileCustomKeyboardFontSize,
        mobileCustomKeyboardPadding = mobileCustomKeyboardPadding?.let { WorkbenchPreferences.clampKeyboardPadding(it) }
            ?: base.mobileCustomKeyboardPadding,
        mobileCustomKeyboardRowGap = mobileCustomKeyboardRowGap?.let { WorkbenchPreferences.clampKeyboardRowGap(it) }
            ?: base.mobileCustomKeyboardRowGap,
        searchTextShortcut = shortcut(searchTextShortcut, base.searchTextShortcut),
        searchFilenameShortcut = shortcut(searchFilenameShortcut, base.searchFilenameShortcut),
        terminalWorkspaceShortcut = shortcut(terminalWorkspaceShortcut, base.terminalWorkspaceShortcut),
        terminalFilePanelShortcut = shortcut(terminalFilePanelShortcut, base.terminalFilePanelShortcut),
        projectPanelShortcut = shortcut(projectPanelShortcut, base.projectPanelShortcut),
        revealActiveFileShortcut = shortcut(revealActiveFileShortcut, base.revealActiveFileShortcut),
        gitPanelShortcut = shortcut(gitPanelShortcut, base.gitPanelShortcut),
        portsPanelShortcut = shortcut(portsPanelShortcut, base.portsPanelShortcut),
        fleetTerminalShortcut = shortcut(fleetTerminalShortcut, base.fleetTerminalShortcut),
        terminalFontSizeIncreaseShortcut = shortcut(terminalFontSizeIncreaseShortcut, base.terminalFontSizeIncreaseShortcut),
        terminalFontSizeDecreaseShortcut = shortcut(terminalFontSizeDecreaseShortcut, base.terminalFontSizeDecreaseShortcut),
        cognitoModeShortcut = shortcut(cognitoModeShortcut, base.cognitoModeShortcut, cognito = true),
        cognitoModeStyle = when (cognitoModeStyle) {
            "black-screen" -> CognitoModeStyle.BLACK_SCREEN
            "heavy-blur" -> CognitoModeStyle.HEAVY_BLUR
            else -> base.cognitoModeStyle
        },
        terminalAgentNotifications = policy,
    ).clamped()
}

/** How [dirtyUiPatch] treats the Explorer language filter. */
enum class LanguageFilterWrite {
    /** Legacy `known/code/text` fallback active, or an unrelated save: never write the filter. */
    OMIT,

    /** Normal field: write only when it differs from the synced base. */
    IF_CHANGED,

    /** Explicit user selection: write the chosen wire value even when it equals a (fallback) base. */
    ALWAYS,
}

/**
 * Dirty projection against the last synced [base]: only changed supported fields are non-null, so a save
 * serializes `{ "ui": { dirty fields } }` and never a full locally defaulted UI object.
 *
 * - [languageFilter] is [LanguageFilterWrite.OMIT] while the legacy `known/code/text` local fallback is
 *   active (it never becomes dirty and is never saved remotely) and [LanguageFilterWrite.ALWAYS] for an explicit
 *   user selection, so choosing "All" against a fallback-derived ALL base is still written.
 * - The policy is included only when [includePolicy] (explicit supported-policy edit); unrelated saves omit it.
 * - Local-only preferences and unknown remote UI properties are never part of the patch.
 */
fun WorkbenchPreferences.dirtyUiPatch(
    base: WorkbenchPreferences,
    languageFilter: LanguageFilterWrite = LanguageFilterWrite.IF_CHANGED,
    includePolicy: Boolean = false,
): UiPreferences {
    val current = clamped().toUiPreferences()
    val previous = base.clamped().toUiPreferences()
    fun <T> changed(now: T, before: T): T? = if (now != before) now else null
    return UiPreferences(
        systemFontSize = changed(current.systemFontSize, previous.systemFontSize),
        editorFontSize = changed(current.editorFontSize, previous.editorFontSize),
        terminalFontSize = changed(current.terminalFontSize, previous.terminalFontSize),
        editorZoomWheelEnabled = changed(current.editorZoomWheelEnabled, previous.editorZoomWheelEnabled),
        explorerShowHidden = changed(current.explorerShowHidden, previous.explorerShowHidden),
        terminalSuggestionsEnabled = changed(current.terminalSuggestionsEnabled, previous.terminalSuggestionsEnabled),
        terminalCommitStatusEnabled = changed(current.terminalCommitStatusEnabled, previous.terminalCommitStatusEnabled),
        terminalAutoSwitchProjectEnabled = changed(
            current.terminalAutoSwitchProjectEnabled, previous.terminalAutoSwitchProjectEnabled,
        ),
        terminalScrollButtonsEnabled = changed(current.terminalScrollButtonsEnabled, previous.terminalScrollButtonsEnabled),
        terminalScrollStep = changed(current.terminalScrollStep, previous.terminalScrollStep),
        explorerLanguageFilter = when (languageFilter) {
            LanguageFilterWrite.OMIT -> null
            LanguageFilterWrite.IF_CHANGED -> changed(current.explorerLanguageFilter, previous.explorerLanguageFilter)
            LanguageFilterWrite.ALWAYS -> current.explorerLanguageFilter
        },
        mobileCustomKeyboardEnabled = changed(current.mobileCustomKeyboardEnabled, previous.mobileCustomKeyboardEnabled),
        mobileCustomKeyboardFontSize = changed(current.mobileCustomKeyboardFontSize, previous.mobileCustomKeyboardFontSize),
        mobileCustomKeyboardPadding = changed(current.mobileCustomKeyboardPadding, previous.mobileCustomKeyboardPadding),
        mobileCustomKeyboardRowGap = changed(current.mobileCustomKeyboardRowGap, previous.mobileCustomKeyboardRowGap),
        searchTextShortcut = changed(current.searchTextShortcut, previous.searchTextShortcut),
        searchFilenameShortcut = changed(current.searchFilenameShortcut, previous.searchFilenameShortcut),
        terminalWorkspaceShortcut = changed(current.terminalWorkspaceShortcut, previous.terminalWorkspaceShortcut),
        terminalFilePanelShortcut = changed(current.terminalFilePanelShortcut, previous.terminalFilePanelShortcut),
        projectPanelShortcut = changed(current.projectPanelShortcut, previous.projectPanelShortcut),
        revealActiveFileShortcut = changed(current.revealActiveFileShortcut, previous.revealActiveFileShortcut),
        gitPanelShortcut = changed(current.gitPanelShortcut, previous.gitPanelShortcut),
        portsPanelShortcut = changed(current.portsPanelShortcut, previous.portsPanelShortcut),
        fleetTerminalShortcut = changed(current.fleetTerminalShortcut, previous.fleetTerminalShortcut),
        terminalFontSizeIncreaseShortcut = changed(
            current.terminalFontSizeIncreaseShortcut, previous.terminalFontSizeIncreaseShortcut,
        ),
        terminalFontSizeDecreaseShortcut = changed(
            current.terminalFontSizeDecreaseShortcut, previous.terminalFontSizeDecreaseShortcut,
        ),
        cognitoModeShortcut = changed(current.cognitoModeShortcut, previous.cognitoModeShortcut),
        cognitoModeStyle = changed(current.cognitoModeStyle, previous.cognitoModeStyle),
        terminalAgentNotifications = if (includePolicy) terminalAgentNotifications.toWireJson() else null,
    )
}

/** Reads a JSON boolean without accepting the string "true"/"false". */
internal fun JsonObject.strictBoolean(key: String): Boolean? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) null else primitive.booleanOrNull
}
