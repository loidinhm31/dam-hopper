package dev.damhopper.nativeapp.features.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily

/**
 * Strips ANSI CSI sequences (colors, formatting, cursor movement), OSC sequences,
 * and character set designators for clean mobile console text rendering.
 */
fun cleanAnsiCodes(text: String): String {
    return text
        .replace(Regex("\u001B\\][^\u0007\u001B]*(\u0007|\u001B\\\\|\u001B|$)"), "")
        .replace(Regex("\u001B[P^_][^\u0007\u001B]*(\u0007|\u001B\\\\|\u001B|$)"), "")
        .replace(Regex("\u001B\\[[0-9;?><= :!\"$']*[@-~]"), "")
        .replace(Regex("\u001B[()#%*+][0-9a-zA-Z]"), "")
        .replace(Regex("\u001B[=@><78cEFHMNPn]"), "")
        .replace("\u001B", "")
        .replace(Regex("[\u0000-\u0006\u0007\u000B\u000C\u000E-\u001F\u007F-\u009F]"), "")
}

/**
 * Bounded in-memory console output surface implementing [NativeTerminalSurface].
 *
 * Scoped as a mobile console viewer for Compose rendering (not a full ANSI terminal emulator).
 * Receives reconciled byte chunks from [TerminalSessionController] via [feedOutput].
 * Maintains a thread-safe / Compose-observable bounded line buffer for scrollable display.
 * Client-side "Clear" actions clear only the local display buffer without resetting
 * the controller's server stream offsets or replay gate state.
 */
class ConsoleBufferTerminalSurface(
    initialCols: Int = 80,
    initialRows: Int = 24,
    val maxLines: Int = 2000,
) : NativeTerminalSurface {
    private var _dimensions = TerminalDimensions(initialCols, initialRows)
    override val dimensions: TerminalDimensions get() = _dimensions

    private var _isAttached: Boolean = true
    override val isAttached: Boolean get() = _isAttached

    private var _isDisposed: Boolean = false
    override val isDisposed: Boolean get() = _isDisposed

    val lines = mutableStateListOf<AnnotatedString>()
    var updateRevision by mutableStateOf(0L)
        private set

    private val currentRawLine = StringBuilder()
    private var cursorCol = 0
    private var onInputListener: ((ByteArray) -> Unit)? = null
    private var onResizeListener: ((Int, Int) -> Unit)? = null
    private val bufferLock = Any()

    override fun attachView(hostView: Any?) {
        check(!_isDisposed) { "Cannot attach disposed ConsoleBufferTerminalSurface" }
        _isAttached = true
    }

    override fun detachView() {
        _isAttached = false
    }

    override fun feedOutput(data: ByteArray, offset: Long, reset: Boolean) {
        if (_isDisposed) return
        val text = data.decodeToString()
        synchronized(bufferLock) {
            if (reset) {
                lines.clear()
                currentRawLine.clear()
                cursorCol = 0
            }
            appendDecodedText(text)
        }
    }

    private fun appendDecodedText(rawText: String) {
        var i = 0
        while (i < rawText.length) {
            val c = rawText[i]
            when (c) {
                '\r' -> {
                    if (i + 1 < rawText.length && rawText[i + 1] == '\n') {
                        commitCurrentLine()
                        i++
                    } else {
                        cursorCol = 0
                    }
                }
                '\n' -> {
                    commitCurrentLine()
                }
                '\b' -> {
                    if (cursorCol > 0) {
                        cursorCol--
                    }
                }
                '\t' -> {
                    val spacesToAdd = 4 - (cursorCol % 4)
                    writeChars(" ".repeat(spacesToAdd))
                }
                else -> {
                    writeChar(c)
                }
            }
            i++
        }
        updateActiveDisplayLine()
        while (lines.size > maxLines) {
            lines.removeAt(0)
        }
        updateRevision++
    }

    private fun writeChar(c: Char) {
        if (cursorCol < currentRawLine.length) {
            currentRawLine.setCharAt(cursorCol, c)
        } else {
            while (currentRawLine.length < cursorCol) {
                currentRawLine.append(' ')
            }
            currentRawLine.append(c)
        }
        cursorCol++
    }

    private fun writeChars(str: String) {
        for (ch in str) {
            writeChar(ch)
        }
    }

    private fun commitCurrentLine() {
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString(currentRawLine.toString())
        if (lines.isNotEmpty()) {
            lines[lines.lastIndex] = parsed
        } else {
            lines.add(parsed)
        }
        lines.add(AnnotatedString(""))
        currentRawLine.clear()
        cursorCol = 0
    }

    private fun updateActiveDisplayLine() {
        val parsed = AnsiTerminalParser.parseAnsiToAnnotatedString(currentRawLine.toString())
        if (lines.isNotEmpty()) {
            lines[lines.lastIndex] = parsed
        } else {
            lines.add(parsed)
        }
    }

    /**
     * Clears only the client-side view lines without modifying server stream offsets or replay gate.
     */
    fun clearDisplayBuffer() {
        synchronized(bufferLock) {
            lines.clear()
            currentRawLine.clear()
            cursorCol = 0
            updateRevision++
        }
    }

    override fun resize(cols: Int, rows: Int) {
        if (_isDisposed) return
        _dimensions = TerminalDimensions(cols, rows)
        onResizeListener?.invoke(cols, rows)
    }

    override fun setOnInputListener(listener: (ByteArray) -> Unit) {
        this.onInputListener = listener
    }

    override fun setOnResizeListener(listener: (cols: Int, rows: Int) -> Unit) {
        this.onResizeListener = listener
    }

    fun dispatchInput(bytes: ByteArray) {
        if (_isDisposed) return
        onInputListener?.invoke(bytes)
    }

    override fun search(query: String, matchCase: Boolean): TerminalSearchResult {
        if (_isDisposed || query.isEmpty()) return TerminalSearchResult(query, 0, -1)
        val fullText = lines.joinToString("\n")
        val source = if (matchCase) fullText else fullText.lowercase()
        val target = if (matchCase) query else query.lowercase()
        var occurrences = 0
        var idx = 0
        while (true) {
            val found = source.indexOf(target, idx)
            if (found < 0) break
            occurrences++
            idx = found + target.length
        }
        return TerminalSearchResult(query, occurrences, if (occurrences > 0) 0 else -1)
    }

    override fun clearSearch() {}

    override fun getSelectedText(): String? = null

    override fun copySelection(): String? = null

    override fun pasteText(text: String) {
        if (_isDisposed) return
        onInputListener?.invoke(text.encodeToByteArray())
    }

    override fun close() {
        _isDisposed = true
        _isAttached = false
        lines.clear()
        currentRawLine.clear()
        cursorCol = 0
        onInputListener = null
        onResizeListener = null
    }
}

/**
 * Terminal panel presenting interactive remote shell sessions.
 *
 * Invariants:
 * 1. Strictly Traditional terminal mode only. No Runtime mode or IDE switches.
 * 2. In-panel session tabs docked below workbench navigation row.
 * 3. Inline keyboard accessory bar (Ctrl, Alt, Esc, Tab, Arrows, Search) above IME.
 *    ZERO floating action buttons or floating launchers!
 * 4. Disconnect, kill, remove, and rename operations explicitly confirmed.
 */
@Composable
fun TerminalPanelScreen(
    sessions: List<TerminalSessionDetailed>,
    activeSessionId: String?,
    controller: TerminalSessionController?,
    onSelectSession: (String) -> Unit,
    onCreateSession: (command: String, name: String?) -> Unit,
    onRenameSession: (id: String, newName: String) -> Unit,
    onKillSession: (id: String) -> Unit,
    onRemoveSession: (id: String) -> Unit,
    fontSize: Int = 13,
    outputBuffer: String? = null,
    modifier: Modifier = Modifier,
) {
    var showCreateDialog by remember { mutableStateOf(false) }
    var renameTargetId by remember { mutableStateOf<String?>(null) }
    var killTargetId by remember { mutableStateOf<String?>(null) }
    var removeTargetId by remember { mutableStateOf<String?>(null) }
    var isSearchOpen by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var searchMatchCase by remember { mutableStateOf(false) }

    val activeSession = sessions.find { it.id == activeSessionId }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // 1. Session Tab Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.SurfaceVariant)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            sessions.forEach { session ->
                val isSelected = session.id == activeSessionId
                val statusColor = when {
                    !session.alive -> DamHopperColors.Error
                    session.restartCount > 0u -> DamHopperColors.Warning
                    else -> DamHopperColors.Success
                }

                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isSelected) DamHopperColors.PrimaryVariant else DamHopperColors.Surface)
                        .clickable { onSelectSession(session.id) }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .width(8.dp)
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(statusColor)
                    )
                    Text(
                        text = session.displayName,
                        color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                    )

                    if (isSelected) {
                        Text(
                            text = "✎",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 11.sp,
                            modifier = Modifier.clickable { renameTargetId = session.id }
                        )
                        Text(
                            text = "✕",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 11.sp,
                            modifier = Modifier.clickable { killTargetId = session.id }
                        )
                    }
                }
            }

            // New session (+) button
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.Surface)
                    .clickable { showCreateDialog = true }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Text(
                    text = "+ New",
                    color = DamHopperColors.Primary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // 2. Search Bar Overlay (when active)
        if (isSearchOpen && controller != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = {
                        searchQuery = it
                        if (it.isNotEmpty()) {
                            controller.search(it, searchMatchCase)
                        } else {
                            controller.clearSearch()
                        }
                    },
                    placeholder = { Text("Find in terminal...", fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.weight(1f).height(48.dp)
                )

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (searchMatchCase) DamHopperColors.Accent else DamHopperColors.SurfaceVariant)
                        .clickable {
                            searchMatchCase = !searchMatchCase
                            if (searchQuery.isNotEmpty()) {
                                controller.search(searchQuery, searchMatchCase)
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Text("Aa", color = DamHopperColors.TextPrimary, fontSize = 11.sp)
                }

                Text(
                    text = "Close",
                    color = DamHopperColors.Primary,
                    fontSize = 12.sp,
                    modifier = Modifier.clickable {
                        isSearchOpen = false
                        searchQuery = ""
                        controller.clearSearch()
                    }
                )
            }
        }

        // 3. Status Banner (Exit code or Lagged notification)
        if (controller?.isExited == true) {
            val exitCode = controller.exitCode
            val willRestart = controller.willRestart
            val bannerColor = if (exitCode == 0) DamHopperColors.SurfaceVariant else DamHopperColors.Error
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bannerColor)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Process exited with code ${exitCode ?: "unknown"}${if (willRestart) " (restarting...)" else ""}",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 12.sp
                )
                Text(
                    text = "Remove Session",
                    color = DamHopperColors.Primary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable {
                        activeSessionId?.let { removeTargetId = it }
                    }
                )
            }
        }

        controller?.lastLaggedDropped?.let { dropped ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Warning)
                    .padding(horizontal = 12.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Stream lagged: $dropped bytes dropped. Re-attaching...",
                    color = DamHopperColors.Background,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
        if (controller?.isTruncated == true) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Earlier scrollback truncated by server buffer limits",
                    color = DamHopperColors.Warning,
                    fontSize = 11.sp
                )
            }
        }

        // 4. Main Terminal Screen Area
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(DamHopperColors.Background)
                .padding(4.dp)
        ) {
            if (activeSession == null) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("No active terminal session", color = DamHopperColors.TextSecondary, fontSize = 14.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = { showCreateDialog = true },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                    ) {
                        Text("Create Session")
                    }
                }
            } else {
                val surfaceLines = (controller?.surface as? VtTerminalSurface)?.lines ?: (controller?.surface as? ConsoleBufferTerminalSurface)?.lines
                val displayLines: List<AnnotatedString> = surfaceLines ?: remember(outputBuffer) {
                    outputBuffer?.let { AnsiTerminalParser.parseAnsiToAnnotatedString(it).text.lines().map { l -> AnnotatedString(l) } } ?: emptyList()
                }
                val listState = rememberLazyListState()

                LaunchedEffect(displayLines.size) {
                    if (displayLines.isNotEmpty()) {
                        listState.scrollToItem(displayLines.size - 1)
                    }
                }

                Column(modifier = Modifier.fillMaxSize()) {
                    // Header metadata bar
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(DamHopperColors.SurfaceVariant)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "[${activeSession.displayName} | ${activeSession.id} | Inc:${controller?.incarnation ?: 0u}]",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 10.sp,
                            fontFamily = JetBrainsMonoFontFamily
                        )
                        Text(
                            text = if (controller?.isReplayCompleted == true) "READY" else "REPLAYING",
                            color = if (controller?.isReplayCompleted == true) DamHopperColors.Success else DamHopperColors.Warning,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = JetBrainsMonoFontFamily
                        )
                    }

                    if (displayLines.isEmpty()) {
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .padding(8.dp)
                        ) {
                            Text(
                                text = "$ ${activeSession.command}",
                                color = DamHopperColors.Success,
                                fontSize = fontSize.sp,
                                fontFamily = JetBrainsMonoFontFamily
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = if (controller?.isReplayCompleted == true) {
                                    "Terminal connected. Interactive session ready."
                                } else {
                                    "Replaying stream buffer..."
                                },
                                color = DamHopperColors.TextSecondary,
                                fontSize = 12.sp,
                                fontFamily = JetBrainsMonoFontFamily
                            )
                        }
                    } else {
                        LazyColumn(
                            state = listState,
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            itemsIndexed(displayLines) { _, line ->
                                Text(
                                    text = if (line.isEmpty()) AnnotatedString(" ") else line,
                                    color = DamHopperColors.TextPrimary,
                                    fontSize = fontSize.sp,
                                    fontFamily = JetBrainsMonoFontFamily,
                                    lineHeight = (fontSize + 3).sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // 5. Inline Accessory Control Bar (Ctrl, Alt, Esc, Tab, Arrows, Search)
        // Strictly inline at bottom of terminal panel, NO floating buttons!
        if (controller != null && activeSession != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                AccessoryKeyButton(
                    label = "CTRL",
                    isActive = controller.isModifierActive(TerminalModifier.CTRL),
                    onClick = { controller.toggleModifier(TerminalModifier.CTRL) }
                )
                AccessoryKeyButton(
                    label = "ALT",
                    isActive = controller.isModifierActive(TerminalModifier.ALT),
                    onClick = { controller.toggleModifier(TerminalModifier.ALT) }
                )
                AccessoryKeyButton(
                    label = "ESC",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("ESC")) }
                )
                AccessoryKeyButton(
                    label = "TAB",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("TAB")) }
                )
                AccessoryKeyButton(
                    label = "▲",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("UP")) }
                )
                AccessoryKeyButton(
                    label = "▼",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("DOWN")) }
                )
                AccessoryKeyButton(
                    label = "◀",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("LEFT")) }
                )
                AccessoryKeyButton(
                    label = "▶",
                    isActive = false,
                    onClick = { controller.sendInput(controller.encodeSpecialKey("RIGHT")) }
                )
                AccessoryKeyButton(
                    label = "FIND",
                    isActive = isSearchOpen,
                    onClick = { isSearchOpen = !isSearchOpen }
                )
                AccessoryKeyButton(
                    label = "CLEAR",
                    isActive = false,
                    onClick = {
                        (controller.surface as? VtTerminalSurface)?.clearDisplayBuffer()
                            ?: (controller.surface as? ConsoleBufferTerminalSurface)?.clearDisplayBuffer()
                    }
                )
            }

            // 6. Inline Command Input Bar (strictly docked above bottom, zero FABs)
            var panelCommandInput by remember(activeSessionId) { mutableStateOf("") }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                OutlinedTextField(
                    value = panelCommandInput,
                    onValueChange = { panelCommandInput = it },
                    placeholder = { Text("Enter command...", fontSize = 12.sp, color = DamHopperColors.TextSecondary) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val toSend = panelCommandInput
                        controller.sendInput("$toSend\r".encodeToByteArray())
                        panelCommandInput = ""
                    }),
                    textStyle = TextStyle(
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 12.sp,
                        color = DamHopperColors.TextPrimary
                    ),
                    modifier = Modifier.weight(1f).height(44.dp)
                )
                Button(
                    onClick = {
                        val toSend = panelCommandInput
                        controller.sendInput("$toSend\r".encodeToByteArray())
                        panelCommandInput = ""
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    shape = RoundedCornerShape(4.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                    modifier = Modifier.height(40.dp)
                ) {
                    Text("Send", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // Dialogs: Create, Rename, Kill, Remove
    if (showCreateDialog) {
        var commandText by remember { mutableStateOf("bash") }
        var nameText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("New Terminal Session") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = commandText,
                        onValueChange = { commandText = it },
                        label = { Text("Command") },
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = nameText,
                        onValueChange = { nameText = it },
                        label = { Text("Session Name (optional)") },
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCreateDialog = false
                        onCreateSession(commandText, nameText.ifBlank { null })
                    }
                ) {
                    Text("Spawn")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    renameTargetId?.let { targetId ->
        var newName by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { renameTargetId = null },
            title = { Text("Rename Terminal Session") },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("New Name") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        renameTargetId = null
                        if (newName.isNotBlank()) {
                            onRenameSession(targetId, newName.trim())
                        }
                    }
                ) {
                    Text("Rename")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTargetId = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    killTargetId?.let { targetId ->
        AlertDialog(
            onDismissRequest = { killTargetId = null },
            title = { Text("Kill Terminal Session") },
            text = { Text("Are you sure you want to terminate process for session $targetId? Tombstone will be kept.") },
            confirmButton = {
                Button(
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                    onClick = {
                        killTargetId = null
                        onKillSession(targetId)
                    }
                ) {
                    Text("Kill")
                }
            },
            dismissButton = {
                TextButton(onClick = { killTargetId = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    removeTargetId?.let { targetId ->
        AlertDialog(
            onDismissRequest = { removeTargetId = null },
            title = { Text("Remove Terminal Session") },
            text = { Text("Are you sure you want to permanently delete session $targetId and evict all metadata?") },
            confirmButton = {
                Button(
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                    onClick = {
                        removeTargetId = null
                        onRemoveSession(targetId)
                    }
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { removeTargetId = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun AccessoryKeyButton(
    label: String,
    isActive: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(if (isActive) DamHopperColors.Accent else DamHopperColors.SurfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp)
    ) {
        Text(
            text = label,
            color = if (isActive) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * Agents panel presenting server-authoritative multi-agent status and integrations.
 */
@Composable
fun AgentsPanelScreen(
    reducer: AgentStatusReducer,
    onJumpToTerminalSession: (terminalId: String, incarnation: ULong) -> Unit,
    onRefresh: () -> Unit,
    onInstallOmp: () -> Unit,
    onUninstallOmp: () -> Unit,
    onInstallNative: (AgentKind) -> Unit,
    onUninstallNative: (AgentKind) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by reducer.state.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(8.dp)
    ) {
        // 1. Header with availability & refresh
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("Agent Observation Engine", color = DamHopperColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(
                    text = "Subsystem: ${state.availability.name.lowercase()} | Epoch: ${state.serverEpoch} | Rev: ${state.revision}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
            Button(
                onClick = onRefresh,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text("Refresh", fontSize = 12.sp)
            }
        }

        // 2. Filter Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            AgentFilter.entries.forEach { filter ->
                val isSelected = state.activeFilter == filter
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isSelected) DamHopperColors.Accent else DamHopperColors.Surface)
                        .clickable { reducer.setFilter(filter) }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = filter.name.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() },
                        color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // 3. Agent Roster List
        val filtered = state.filteredAgents
        if (filtered.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No active agents matching filter",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 13.sp
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(filtered, key = { it.id }) { agent ->
                    AgentRowCard(
                        row = agent,
                        hasAttention = state.unreadAttentions.any { it.terminalId == agent.id && it.incarnation == agent.incarnation },
                        onJump = { onJumpToTerminalSession(agent.id, agent.incarnation) }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // 4. Integrations Quick Bar
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(DamHopperColors.Surface)
                .padding(8.dp)
        ) {
            Text("Agent Integrations", color = DamHopperColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onInstallOmp,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier.weight(1f)
                ) {
                    Text("OMP Hook", fontSize = 11.sp)
                }
                Button(
                    onClick = { onInstallNative(AgentKind.CODEX) },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Codex Hook", fontSize = 11.sp)
                }
                Button(
                    onClick = { onInstallNative(AgentKind.CLAUDE) },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Claude Hook", fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun AgentRowCard(
    row: TerminalAgentStatusRow,
    hasAttention: Boolean,
    onJump: () -> Unit,
) {
    val stateColor = when (row.state) {
        AgentState.WORKING -> DamHopperColors.Warning
        AgentState.BLOCKED -> DamHopperColors.Error
        AgentState.IDLE -> DamHopperColors.Success
        AgentState.UNKNOWN -> DamHopperColors.TextSecondary
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.Surface)
            .border(
                width = if (hasAttention) 1.dp else 0.dp,
                color = if (hasAttention) DamHopperColors.Error else DamHopperColors.Border,
                shape = RoundedCornerShape(6.dp)
            )
            .padding(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.PrimaryVariant)
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(row.agentKind.name, color = DamHopperColors.TextPrimary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                Text("Session: ${row.id}", color = DamHopperColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(stateColor.copy(alpha = 0.2f))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    text = row.state.name + (row.reason?.let { " ($it)" } ?: ""),
                    color = stateColor,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Epoch: ${row.reporterEpoch} | Incarnation: ${row.incarnation} | Source: ${row.source.name.lowercase()}",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp
        )

        row.lastOutcome?.let { outcome ->
            Text(
                text = "Last turn: ${outcome.name.lowercase()}",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )
        }

        Spacer(modifier = Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(
                onClick = onJump,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
            ) {
                Text("Jump to Session", fontSize = 11.sp)
            }
        }
    }
}
