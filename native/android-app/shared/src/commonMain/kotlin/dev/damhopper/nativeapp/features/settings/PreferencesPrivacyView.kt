package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import kotlinx.coroutines.launch
import kotlin.time.TimeSource

/** Every hardware-shortcut action of the web settings with its exact preference field and Android availability. */
enum class ShortcutAction(
    val title: String,
    val defaultBinding: String,
    /** Non-null for the user-approved unavailable destinations: the binding is preserved, never dispatched. */
    val unavailableReason: String?,
) {
    SEARCH_TEXT("Text search", ShortcutDefaults.SEARCH_TEXT, null),
    SEARCH_FILENAME("Filename search", ShortcutDefaults.SEARCH_FILENAME, null),
    TERMINAL_WORKSPACE("Terminal / IDE layout toggle", ShortcutDefaults.TERMINAL_WORKSPACE, "The guided native terminal has no IDE-layout mode."),
    TERMINAL_FONT_INCREASE("Terminal font larger", ShortcutDefaults.TERMINAL_FONT_SIZE_INCREASE, null),
    TERMINAL_FONT_DECREASE("Terminal font smaller", ShortcutDefaults.TERMINAL_FONT_SIZE_DECREASE, null),
    FILE_PANEL("Files panel", ShortcutDefaults.TERMINAL_FILE_PANEL, null),
    REVEAL_ACTIVE_FILE("Reveal active file", ShortcutDefaults.REVEAL_ACTIVE_FILE, null),
    GIT_PANEL("Git", ShortcutDefaults.GIT_PANEL, "The Git page is not part of this app's focused workspace."),
    PORTS_PANEL("Ports", ShortcutDefaults.PORTS_PANEL, "The Ports page is not part of this app's focused workspace."),
    PROJECT_PANEL("Projects", ShortcutDefaults.PROJECT_PANEL, null),
    FLEET_TERMINAL("Fleet terminal", ShortcutDefaults.FLEET_TERMINAL, "There is no Fleet destination in this app."),
    COGNITO("Cognito privacy mode", ShortcutDefaults.COGNITO_MODE, null);

    fun read(p: WorkbenchPreferences): String = when (this) {
        SEARCH_TEXT -> p.searchTextShortcut
        SEARCH_FILENAME -> p.searchFilenameShortcut
        TERMINAL_WORKSPACE -> p.terminalWorkspaceShortcut
        TERMINAL_FONT_INCREASE -> p.terminalFontSizeIncreaseShortcut
        TERMINAL_FONT_DECREASE -> p.terminalFontSizeDecreaseShortcut
        FILE_PANEL -> p.terminalFilePanelShortcut
        REVEAL_ACTIVE_FILE -> p.revealActiveFileShortcut
        GIT_PANEL -> p.gitPanelShortcut
        PORTS_PANEL -> p.portsPanelShortcut
        PROJECT_PANEL -> p.projectPanelShortcut
        FLEET_TERMINAL -> p.fleetTerminalShortcut
        COGNITO -> p.cognitoModeShortcut
    }

    fun write(p: WorkbenchPreferences, value: String): WorkbenchPreferences = when (this) {
        SEARCH_TEXT -> p.copy(searchTextShortcut = value)
        SEARCH_FILENAME -> p.copy(searchFilenameShortcut = value)
        TERMINAL_WORKSPACE -> p.copy(terminalWorkspaceShortcut = value)
        TERMINAL_FONT_INCREASE -> p.copy(terminalFontSizeIncreaseShortcut = value)
        TERMINAL_FONT_DECREASE -> p.copy(terminalFontSizeDecreaseShortcut = value)
        FILE_PANEL -> p.copy(terminalFilePanelShortcut = value)
        REVEAL_ACTIVE_FILE -> p.copy(revealActiveFileShortcut = value)
        GIT_PANEL -> p.copy(gitPanelShortcut = value)
        PORTS_PANEL -> p.copy(portsPanelShortcut = value)
        PROJECT_PANEL -> p.copy(projectPanelShortcut = value)
        FLEET_TERMINAL -> p.copy(fleetTerminalShortcut = value)
        COGNITO -> p.copy(cognitoModeShortcut = value)
    }
}

/** Why a captured/typed [binding] may not be stored for [action] (null when acceptable). */
fun shortcutBindingProblem(action: ShortcutAction, binding: String, prefs: WorkbenchPreferences): String? {
    val canonical = ShortcutGrammar.format(binding)
    val parsed = ShortcutGrammar.parse(canonical) ?: return "That is not a valid shortcut."
    val valid = if (action == ShortcutAction.COGNITO) {
        ShortcutGrammar.isValidCognitoBinding(canonical)
    } else {
        ShortcutGrammar.isValidBinding(canonical, allowDoubleShift = true)
    }
    if (!valid) {
        return if (action == ShortcutAction.COGNITO) "Cognito mode needs a keyboard chord (no DoubleShift)." else "That is not a valid shortcut."
    }
    if (parsed.kind == ShortcutKind.KEYBOARD) {
        val modifiers = parsed.effectiveCtrl || parsed.effectiveMeta || parsed.alt || parsed.shift
        val functionKey = parsed.code?.let { Regex("^F([1-9]|1[0-2])$").matches(it) } == true
        if (!modifiers && !functionKey) return "Add Ctrl, Alt, Shift or Meta so ordinary typing is never captured."
    }
    ShortcutAction.entries.firstOrNull { other ->
        other != action && shortcutsCollide(parsed, ShortcutGrammar.parse(other.read(prefs)))
    }?.let { return "Already used by \"${it.title}\"." }
    return null
}

/** Effective collision: same exact modifiers and physical code (Ctrl+Mod == Ctrl), or both DoubleShift. */
fun shortcutsCollide(a: ParsedShortcut, b: ParsedShortcut?): Boolean {
    if (b == null) return false
    if (a.kind == ShortcutKind.DOUBLE_SHIFT && b.kind == ShortcutKind.DOUBLE_SHIFT) return true
    if (a.kind != ShortcutKind.KEYBOARD || b.kind != ShortcutKind.KEYBOARD) return false
    return a.code == b.code && a.effectiveCtrl == b.effectiveCtrl && a.effectiveMeta == b.effectiveMeta &&
        a.alt == b.alt && a.shift == b.shift
}

/**
 * Physical DOM `code` of a key event (letters/digits/F-keys/punctuation/navigation/numpad), independent of the
 * locale or IME text. Null for keys with no DOM code in the C1 grammar.
 */
fun domCodeFor(key: Key): String? = when (key) {
    Key.A -> "KeyA"; Key.B -> "KeyB"; Key.C -> "KeyC"; Key.D -> "KeyD"; Key.E -> "KeyE"; Key.F -> "KeyF"
    Key.G -> "KeyG"; Key.H -> "KeyH"; Key.I -> "KeyI"; Key.J -> "KeyJ"; Key.K -> "KeyK"; Key.L -> "KeyL"
    Key.M -> "KeyM"; Key.N -> "KeyN"; Key.O -> "KeyO"; Key.P -> "KeyP"; Key.Q -> "KeyQ"; Key.R -> "KeyR"
    Key.S -> "KeyS"; Key.T -> "KeyT"; Key.U -> "KeyU"; Key.V -> "KeyV"; Key.W -> "KeyW"; Key.X -> "KeyX"
    Key.Y -> "KeyY"; Key.Z -> "KeyZ"
    Key.Zero -> "Digit0"; Key.One -> "Digit1"; Key.Two -> "Digit2"; Key.Three -> "Digit3"; Key.Four -> "Digit4"
    Key.Five -> "Digit5"; Key.Six -> "Digit6"; Key.Seven -> "Digit7"; Key.Eight -> "Digit8"; Key.Nine -> "Digit9"
    Key.F1 -> "F1"; Key.F2 -> "F2"; Key.F3 -> "F3"; Key.F4 -> "F4"; Key.F5 -> "F5"; Key.F6 -> "F6"
    Key.F7 -> "F7"; Key.F8 -> "F8"; Key.F9 -> "F9"; Key.F10 -> "F10"; Key.F11 -> "F11"; Key.F12 -> "F12"
    Key.Grave -> "Backquote"; Key.Equals -> "Equal"; Key.Minus -> "Minus"
    Key.LeftBracket -> "BracketLeft"; Key.RightBracket -> "BracketRight"; Key.Backslash -> "Backslash"
    Key.Semicolon -> "Semicolon"; Key.Apostrophe -> "Quote"; Key.Comma -> "Comma"; Key.Period -> "Period"
    Key.Slash -> "Slash"
    Key.Spacebar -> "Space"; Key.Enter -> "Enter"; Key.Escape -> "Escape"; Key.Tab -> "Tab"
    Key.Backspace -> "Backspace"; Key.Delete -> "Delete"; Key.Insert -> "Insert"
    Key.MoveHome -> "Home"; Key.MoveEnd -> "End"; Key.PageUp -> "PageUp"; Key.PageDown -> "PageDown"
    Key.DirectionUp -> "ArrowUp"; Key.DirectionDown -> "ArrowDown"; Key.DirectionLeft -> "ArrowLeft"; Key.DirectionRight -> "ArrowRight"
    Key.NumPad0 -> "Numpad0"; Key.NumPad1 -> "Numpad1"; Key.NumPad2 -> "Numpad2"; Key.NumPad3 -> "Numpad3"
    Key.NumPad4 -> "Numpad4"; Key.NumPad5 -> "Numpad5"; Key.NumPad6 -> "Numpad6"; Key.NumPad7 -> "Numpad7"
    Key.NumPad8 -> "Numpad8"; Key.NumPad9 -> "Numpad9"; Key.NumPadAdd -> "NumpadAdd"
    Key.NumPadSubtract -> "NumpadSubtract"; Key.NumPadMultiply -> "NumpadMultiply"; Key.NumPadDivide -> "NumpadDivide"
    Key.NumPadDot -> "NumpadDecimal"; Key.NumPadEnter -> "NumpadEnter"; Key.NumPadEquals -> "NumpadEqual"
    Key.NumPadComma -> "NumpadComma"
    else -> null
}

/** Stored chord for a captured key: Android Ctrl is the platform `Mod`; Meta is the explicit `Cmd`. */
fun capturedChord(code: String, ctrl: Boolean, alt: Boolean, shift: Boolean, meta: Boolean): String {
    val parts = mutableListOf<String>()
    if (ctrl) parts += "Mod"
    if (meta) parts += "Cmd"
    if (alt) parts += "Alt"
    if (shift) parts += "Shift"
    parts += code
    return ShortcutGrammar.format(parts.joinToString("+"))
}

@Composable
private fun SectionCard(title: String, subtitle: String? = null, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

@Composable
private fun SwitchRow(title: String, description: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            Text(description, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun StepperRow(label: String, value: Int, min: Int, max: Int, unit: String, onChange: (Int) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            Text("$min..$max $unit", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(
                onClick = { onChange((value - 1).coerceAtLeast(min)) },
                enabled = value > min,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
            ) { Text("-") }
            Text("$value $unit", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            OutlinedButton(
                onClick = { onChange((value + 1).coerceAtMost(max)) },
                enabled = value < max,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
            ) { Text("+") }
        }
    }
}

/**
 * Preferences & Privacy (S02-S21, S23, K01-K12): independent preference-source selector with truthful status,
 * theme, fonts, explorer, terminal, local command-history consent, accessory keyboard, Cognito and a full
 * hardware-shortcut editor (capture/cancel/reset/collision, DoubleShift). Every control writes through
 * [SettingsRepository]; only synchronized fields are dirty-patched to the source.
 */
@Composable
fun PreferencesPrivacyView(
    settingsRepository: SettingsRepository,
    privacyController: PrivacyController,
    availableProfiles: List<ServerProfile>,
    commandHistory: CommandHistoryStore? = null,
    modifier: Modifier = Modifier,
) {
    val preferences by settingsRepository.preferences.collectAsState()
    val sourceTargetState by settingsRepository.sourceTargetState.collectAsState()
    val syncState by settingsRepository.syncState.collectAsState()
    val migrationNotice by settingsRepository.languageFilterMigrationNotice.collectAsState()
    val unsupportedPolicy by settingsRepository.unsupportedPolicy.collectAsState()
    val historyEnabled = commandHistory?.enabled?.collectAsState()?.value ?: preferences.commandHistoryEnabled
    val scope = rememberCoroutineScope()
    var confirmClearHistory by remember { mutableStateOf(false) }
    var historyMessage by remember { mutableStateOf<String?>(null) }

    if (confirmClearHistory) {
        AlertDialog(
            onDismissRequest = { confirmClearHistory = false },
            title = { Text("Clear local command history?") },
            text = { Text("Deletes every command remembered on this device for all servers and projects. Nothing on any server changes.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClearHistory = false
                    commandHistory?.clear()
                    historyMessage = "Local command history cleared."
                }) { Text("Clear history") }
            },
            dismissButton = { TextButton(onClick = { confirmClearHistory = false }) { Text("Cancel") } },
        )
    }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        settingsRepository.storageError?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        }

        SectionCard(
            "Preferences source server",
            "Synchronized preferences are read from and saved to this server. It is independent of the server whose settings you administer.",
        ) {
            val statusText = when (sourceTargetState.preferencesStatus) {
                PreferenceSourceStatus.ACTIVE -> "Active"
                PreferenceSourceStatus.SOURCE_REMOVED -> "Source server was removed - local snapshot kept"
                PreferenceSourceStatus.UNSET -> "Local only"
            }
            Text("Status: $statusText", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            Text(
                "Sync: ${syncState.status.name.lowercase().replace('_', ' ')}" + (syncState.message?.let { " - $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = sourceTargetState.preferencesProfileId == null,
                    onClick = { scope.launch { settingsRepository.switchPreferenceSource(null) } },
                    label = { Text("Local only") },
                )
                availableProfiles.forEach { profile ->
                    FilterChip(
                        selected = sourceTargetState.preferencesProfileId == profile.id,
                        onClick = { scope.launch { settingsRepository.switchPreferenceSource(profile.id) } },
                        label = { Text(profile.name) },
                    )
                }
            }
            if (sourceTargetState.preferencesProfileId != null) {
                OutlinedButton(onClick = { scope.launch { settingsRepository.retrySourceHydration() } }) { Text("Sync now") }
            }
            if (unsupportedPolicy != null) {
                Text(
                    "This server stores a notification policy version this app does not understand. It is preserved untouched and the policy editor is read-only.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        SectionCard("Appearance (this device)") {
            Text("Theme", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WorkbenchTheme.entries.forEach { theme ->
                    FilterChip(
                        selected = preferences.theme == theme,
                        onClick = { settingsRepository.updatePreferences { it.copy(theme = theme) } },
                        label = { Text(theme.name.lowercase().replace('_', ' ')) },
                    )
                }
            }
        }

        SectionCard("Fonts", "Changes apply live; no route is recreated.") {
            StepperRow("System UI font", preferences.systemFontSize, WorkbenchPreferences.FONT_MIN, WorkbenchPreferences.FONT_MAX, "sp") { v ->
                settingsRepository.updatePreferences { it.copy(systemFontSize = v) }
            }
            StepperRow("Editor font", preferences.editorFontSize, WorkbenchPreferences.FONT_MIN, WorkbenchPreferences.FONT_MAX, "sp") { v ->
                settingsRepository.updatePreferences { it.copy(editorFontSize = v) }
            }
            StepperRow("Terminal font", preferences.terminalFontSize, WorkbenchPreferences.FONT_MIN, WorkbenchPreferences.FONT_MAX, "sp") { v ->
                settingsRepository.updatePreferences { it.copy(terminalFontSize = v) }
            }
            Text("Preview", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
            Text("System UI sample", fontSize = preferences.systemFontSize.sp, color = MaterialTheme.colorScheme.onSurface)
            Text("fun sample(): Int = 42", fontSize = preferences.editorFontSize.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.secondary)
            Text("$ git status --short", fontSize = preferences.terminalFontSize.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurface)
            SwitchRow("Editor zoom gesture", "Pinch or Ctrl+wheel zooms the editor font", preferences.editorZoomWheelEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(editorZoomWheelEnabled = v) }
            }
        }

        SectionCard("Files") {
            Text("Language filter", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ExplorerLanguageFilter.entries.forEach { filter ->
                    FilterChip(
                        selected = preferences.explorerLanguageFilter == filter && migrationNotice == null,
                        onClick = { settingsRepository.setExplorerLanguageFilter(filter) },
                        label = { Text(filter.wire) },
                    )
                }
            }
            migrationNotice?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            SwitchRow("Show hidden files", "Dotfiles and hidden folders in the file tree and editor sidebar", preferences.explorerShowHidden) { v ->
                settingsRepository.updatePreferences { it.copy(explorerShowHidden = v) }
            }
        }

        SectionCard("Terminal") {
            SwitchRow("Inline suggestions", "Suggest from your consented local command history; inserts a draft only", preferences.terminalSuggestionsEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(terminalSuggestionsEnabled = v) }
            }
            SwitchRow("Latest commit header", "Show the project's branch and latest commit above the terminal", preferences.terminalCommitStatusEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(terminalCommitStatusEnabled = v) }
            }
            SwitchRow("Auto-switch project", "Switch project when a terminal assigned to another project is selected", preferences.terminalAutoSwitchProjectEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(terminalAutoSwitchProjectEnabled = v) }
            }
            SwitchRow("Scroll buttons", "Inline step and jump controls instead of floating buttons", preferences.terminalScrollButtonsEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(terminalScrollButtonsEnabled = v) }
            }
            StepperRow("Scroll step", preferences.terminalScrollStep, WorkbenchPreferences.SCROLL_STEP_MIN, WorkbenchPreferences.SCROLL_STEP_MAX, "lines") { v ->
                settingsRepository.updatePreferences { it.copy(terminalScrollStep = v) }
            }
        }

        SectionCard("Local command history", "Stays on this device only; never sent to a server or included in synced preferences.") {
            SwitchRow("Remember commands on this device", "Off by default. Only commands you submit in the app are remembered.", historyEnabled) { v ->
                commandHistory?.setEnabled(v)
                settingsRepository.updatePreferences { it.copy(commandHistoryEnabled = v) }
            }
            if (commandHistory == null) {
                Text("Command history storage is not attached in this view; the consent choice is saved.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedButton(enabled = commandHistory != null, onClick = { confirmClearHistory = true }) { Text("Clear local history...") }
            historyMessage?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }

        SectionCard("Accessory keyboard") {
            SwitchRow("Custom keyboard row", "Ctrl, Alt, Esc, Tab and arrow keys above the system keyboard", preferences.mobileCustomKeyboardEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(mobileCustomKeyboardEnabled = v) }
            }
            StepperRow("Key font", preferences.mobileCustomKeyboardFontSize, WorkbenchPreferences.KEYBOARD_FONT_MIN, WorkbenchPreferences.KEYBOARD_FONT_MAX, "sp") { v ->
                settingsRepository.updatePreferences { it.copy(mobileCustomKeyboardFontSize = v) }
            }
            StepperRow("Key padding", preferences.mobileCustomKeyboardPadding, WorkbenchPreferences.KEYBOARD_PADDING_MIN, WorkbenchPreferences.KEYBOARD_PADDING_MAX, "dp") { v ->
                settingsRepository.updatePreferences { it.copy(mobileCustomKeyboardPadding = v) }
            }
            StepperRow("Row gap", preferences.mobileCustomKeyboardRowGap, WorkbenchPreferences.KEYBOARD_ROW_GAP_MIN, WorkbenchPreferences.KEYBOARD_ROW_GAP_MAX, "dp") { v ->
                settingsRepository.updatePreferences { it.copy(mobileCustomKeyboardRowGap = v) }
            }
            SwitchRow("Haptic feedback", "Vibrate on accessory key presses", preferences.hapticFeedbackEnabled) { v ->
                settingsRepository.updatePreferences { it.copy(hapticFeedbackEnabled = v) }
            }
        }

        SectionCard(
            "Cognito privacy mode",
            "Full-screen privacy mask that freezes terminal and editor input. It is in-memory only and never persisted.",
        ) {
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CognitoModeStyle.entries.forEach { style ->
                    FilterChip(
                        selected = preferences.cognitoModeStyle == style,
                        onClick = { settingsRepository.updatePreferences { it.copy(cognitoModeStyle = style) } },
                        label = { Text(if (style == CognitoModeStyle.HEAVY_BLUR) "Heavy blur" else "Black screen") },
                    )
                }
            }
            Button(
                onClick = { privacyController.activate(chord = preferences.cognitoModeShortcut, style = preferences.cognitoModeStyle) },
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
            ) { Text("Test privacy mask") }
        }

        ShortcutEditor(settingsRepository, preferences)
    }
}

@Composable
private fun ShortcutEditor(settingsRepository: SettingsRepository, preferences: WorkbenchPreferences) {
    var capturing by remember { mutableStateOf<ShortcutAction?>(null) }
    var captureMessage by remember { mutableStateOf<String?>(null) }
    val detector = remember { DoubleShiftDetector() }
    val clock = remember { TimeSource.Monotonic.markNow() }
    var shiftDown by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(capturing) {
        detector.reset()
        shiftDown = false
        if (capturing != null) focus.requestFocus()
    }

    fun commit(action: ShortcutAction, binding: String) {
        val canonical = ShortcutGrammar.format(binding)
        val problem = shortcutBindingProblem(action, canonical, preferences)
        if (problem != null) {
            captureMessage = problem
            return
        }
        settingsRepository.updatePreferences { action.write(it, canonical) }
        captureMessage = "${action.title}: $canonical"
        capturing = null
    }

    fun onKey(event: KeyEvent): Boolean {
        val action = capturing ?: return false
        val key = event.key
        val down = event.type == KeyEventType.KeyDown
        val up = event.type == KeyEventType.KeyUp
        if (key == Key.ShiftLeft || key == Key.ShiftRight) {
            if (up) {
                shiftDown = false
                detector.onShiftUp()
            } else if (down) {
                val repeat = shiftDown
                shiftDown = true
                val matched = detector.onShiftDown(
                    timeMs = clock.elapsedNow().inWholeMilliseconds,
                    repeat = repeat,
                    composing = false,
                    ctrl = event.isCtrlPressed,
                    alt = event.isAltPressed,
                    meta = event.isMetaPressed,
                )
                if (matched) commit(action, DOUBLE_SHIFT_SHORTCUT)
            }
            return true // capture consumes down/up; nothing dispatches
        }
        if (key == Key.CtrlLeft || key == Key.CtrlRight || key == Key.AltLeft || key == Key.AltRight ||
            key == Key.MetaLeft || key == Key.MetaRight
        ) {
            detector.reset()
            return true
        }
        if (!down) return true
        detector.reset()
        val noModifiers = !event.isCtrlPressed && !event.isAltPressed && !event.isShiftPressed && !event.isMetaPressed
        if (key == Key.Escape && noModifiers) {
            capturing = null
            captureMessage = "Capture cancelled; nothing was saved."
            return true
        }
        val code = domCodeFor(key)
        if (code == null) {
            captureMessage = "That key has no Android physical key code; nothing was saved."
            return true
        }
        commit(action, capturedChord(code, event.isCtrlPressed, event.isAltPressed, event.isShiftPressed, event.isMetaPressed))
        return true
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Hardware keyboard shortcuts", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Text(
                "Ctrl is the platform modifier (Mod); Meta is separate. Double-tap Shift within 450 ms is the default filename search. Imported bindings are preserved even when this device cannot produce them.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (capturing != null) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus).focusable().onPreviewKeyEvent { onKey(it) },
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Press the new shortcut for \"${capturing?.title}\"", style = MaterialTheme.typography.bodyMedium)
                        Text("Esc cancels. Press Shift twice for DoubleShift.", style = MaterialTheme.typography.labelSmall)
                        OutlinedButton(onClick = { capturing = null; captureMessage = "Capture cancelled; nothing was saved." }) { Text("Cancel") }
                    }
                }
            }
            captureMessage?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            ShortcutAction.entries.forEach { action ->
                val binding = action.read(preferences)
                val parsed = ShortcutGrammar.parse(binding)
                val androidProblem = if (parsed?.kind == ShortcutKind.KEYBOARD && parsed.code != null &&
                    !ShortcutGrammar.isAndroidDispatchable(parsed.code)
                ) {
                    "No Android physical key produces ${parsed.code}; the binding is preserved but cannot trigger here."
                } else {
                    null
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(action.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                            Text(binding, style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.primary)
                        }
                        if (action.unavailableReason == null) {
                            OutlinedButton(
                                enabled = capturing == null,
                                onClick = { captureMessage = null; capturing = action },
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                            ) { Text("Set") }
                            TextButton(
                                enabled = capturing == null && binding != action.defaultBinding,
                                onClick = {
                                    val problem = shortcutBindingProblem(action, action.defaultBinding, preferences)
                                    if (problem != null) {
                                        captureMessage = "Cannot reset ${action.title}: $problem"
                                    } else {
                                        settingsRepository.updatePreferences { action.write(it, action.defaultBinding) }
                                        captureMessage = "${action.title} reset to ${action.defaultBinding}"
                                    }
                                },
                            ) { Text("Reset") }
                        }
                    }
                    action.unavailableReason?.let {
                        Text("Unavailable: $it The binding is preserved.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    androidProblem?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}
