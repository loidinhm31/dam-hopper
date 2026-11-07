package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.AgentHubNavigatorCallbacks
import dev.damhopper.nativeapp.features.terminal.AgentHubNavigatorMode
import dev.damhopper.nativeapp.features.terminal.AgentHubNavigatorUiState
import dev.damhopper.nativeapp.features.terminal.AgentHubProjectRowState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val AGENT_HUB_NAVIGATOR_TAG: String = "agent-hub-navigator"
const val AGENT_HUB_PROJECT_ROW_TAG_PREFIX: String = "agent-hub-project-row:"
const val AGENT_HUB_CREATE_BUTTON_TAG_PREFIX: String = "agent-hub-create-button:"
const val AGENT_HUB_DISMISS_BUTTON_TAG_PREFIX: String = "agent-hub-dismiss-button:"
const val AGENT_HUB_OPEN_PROJECT_BUTTON_TAG: String = "agent-hub-open-project-button"
const val AGENT_HUB_SETTINGS_BUTTON_TAG: String = "agent-hub-settings-button"
const val AGENT_HUB_REFRESH_BUTTON_TAG: String = "agent-hub-refresh-button"
const val AGENT_HUB_CLOSE_BUTTON_TAG: String = "agent-hub-close-button"

/**
 * Native Agent Hub Navigator.
 *
 * Composes project/worktree rows with existing terminal agents sidebar components.
 * Renders as either a width-admitted 280dp rail (usableWidth - 280dp >= 360dp) or a compact modal.
 *
 * Requirements:
 * 1. Open zero-session projects/worktrees coexist with real PTY groups without implicit spawn/connect.
 * 2. Independent selectable row and sibling >=48dp create/dismiss controls.
 * 3. Dismissal enabled only with authoritative loaded inventory and zero deduplicated
 *    live/hidden/restartPending/admitted-or-unknown-create refs.
 * 4. Badges disambiguate profiles; unavailable owners retain pins and selections without pruning.
 * 5. Settings triggers Admin Target B action; agent activation preserves exact qualified target.
 */
@Composable
fun AgentHubNavigator(
    state: AgentHubNavigatorUiState,
    mode: AgentHubNavigatorMode,
    callbacks: AgentHubNavigatorCallbacks,
    modifier: Modifier = Modifier,
) {
    val agentsState = state.agentsUiState
    val projection = agentsState.projection
    val counts = projection.counts
    val showProfileBadges = state.showProfileBadges || remember(state.projects) {
        state.projects.map { it.profileLabel }.distinct().size > 1
    }

    val widthModifier = when (mode) {
        AgentHubNavigatorMode.RAIL -> Modifier.width(AGENT_HUB_RAIL_WIDTH).fillMaxHeight()
        AgentHubNavigatorMode.MODAL -> Modifier.sizeIn(maxWidth = AGENT_HUB_MODAL_MAX_WIDTH).fillMaxHeight()
    }

    Column(
        modifier = modifier
            .then(widthModifier)
            .background(DamHopperColors.Surface)
            .testTag("$AGENT_HUB_NAVIGATOR_TAG:${mode.name}")
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // --- Header ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Agent Hub",
                color = DamHopperColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.weight(1f))
            if (mode == AgentHubNavigatorMode.MODAL) {
                TerminalAgentsActionButton(
                    label = "Close",
                    description = "Close navigator",
                    onClick = callbacks.onDismissNavigator,
                    modifier = Modifier.testTag(AGENT_HUB_CLOSE_BUTTON_TAG),
                )
            }
        }

        // --- Action controls ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TerminalAgentsActionButton(
                label = "Open Project",
                description = "Open project picker without creating sessions",
                onClick = callbacks.onOpenProjectPicker,
                modifier = Modifier
                    .weight(1f)
                    .testTag(AGENT_HUB_OPEN_PROJECT_BUTTON_TAG),
            )
            TerminalAgentsActionButton(
                label = "Refresh",
                description = "Refresh projects and agents",
                onClick = callbacks.onRefresh,
                modifier = Modifier.testTag(AGENT_HUB_REFRESH_BUTTON_TAG),
            )
            TerminalAgentsActionButton(
                label = "Settings",
                description = "Agent and Admin Target B settings",
                onClick = callbacks.onOpenSettings,
                modifier = Modifier.testTag(AGENT_HUB_SETTINGS_BUTTON_TAG),
            )
        }

        // --- Notice Banner ---
        state.notice?.let { notice ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = notice,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                TerminalAgentsActionButton(
                    label = "Retry",
                    description = "Retry Hub refresh",
                    onClick = callbacks.onRefresh,
                )
            }
        }

        // --- Loading Indicator ---
        if (state.loading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            ) {
                CircularProgressIndicator(
                    color = DamHopperColors.Primary,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(text = "Refreshing Hub\u2026", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
            }
        }

        // --- Scrollable Main Content ---
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ================= Projects Section =================
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Projects",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "${state.projects.size}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }

            if (state.projects.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.5f))
                        .padding(12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "No open projects",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = "Open a project to begin working.",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 11.sp,
                        )
                    }
                }
            } else {
                state.projects.forEach { project ->
                    key(project.target) {
                        AgentHubProjectRow(
                            project = project,
                            callbacks = callbacks,
                            showProfile = showProfileBadges,
                        )
                    }
                }
            }

            Spacer(Modifier.height(6.dp))

            // ================= Agents Section =================
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Agents",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "${counts.all}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                    modifier = Modifier
                        .testTag(TERMINAL_AGENTS_COUNT_TAG)
                        .semantics {
                            contentDescription =
                                if (counts.all == 1) "1 eligible terminal" else "${counts.all} eligible terminals"
                        },
                )
            }

            if (agentsState.selection != TerminalAgentsFilterSelection.All) {
                Text(
                    text = "Showing ${projection.filteredCount} of ${counts.all}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }

            TerminalAgentsFilterMenu(
                selection = agentsState.selection,
                counts = counts,
                onFilterChange = callbacks.onFilterChange,
                onPopupVisibilityChanged = callbacks.onPopupVisibilityChanged,
                modifier = Modifier.fillMaxWidth(),
            )

            when {
                counts.all == 0 && agentsState.loading -> Unit
                counts.all == 0 -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.5f))
                            .padding(12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "No observed agents",
                                color = DamHopperColors.TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "Agents appear when an OMP, Codex or Claude session is active in a terminal.",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }
                projection.filteredCount == 0 -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.5f))
                            .padding(12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "No matching filter",
                                color = DamHopperColors.TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "${counts.all} observed agents are hidden by current status filter.",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 11.sp,
                            )
                            Spacer(Modifier.height(6.dp))
                            TerminalAgentsActionButton(
                                label = "Show all",
                                description = "Reset filter to Show All",
                                onClick = { callbacks.onFilterChange(TerminalAgentsFilterSelection.All) },
                            )
                        }
                    }
                }
                else -> projection.groups.forEach { group ->
                    key(group.key) {
                        TerminalAgentsGroupRow(
                            group = group,
                            active = agentsState.active,
                            enabled = !agentsState.activationPending,
                            showProfile = showProfileBadges,
                            onClick = { callbacks.onAgentGroupClick(group.key) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Independent project/worktree row in the Agent Hub navigator.
 *
 * Structure:
 * - Independent selectable row (touch target minHeight = 48.dp) with role = Tab/Button.
 * - Sibling Create Session button (touch target >=48dp) with role = Button.
 * - Sibling Dismiss Project button (touch target >=48dp) with role = Button.
 * Dismiss button is enabled ONLY when [project.canDismiss] is true (authoritative inventory + 0 active refs).
 */
@Composable
fun AgentHubProjectRow(
    project: AgentHubProjectRowState,
    callbacks: AgentHubNavigatorCallbacks,
    showProfile: Boolean,
    modifier: Modifier = Modifier,
) {
    val isSelected = project.isSelected
    val shape = RoundedCornerShape(6.dp)
    val projectKey = project.target.project + (project.target.worktreePath?.let { ":$it" } ?: "")
    val profilePrefix = project.target.profileId ?: "default"
    val rowTag = "$AGENT_HUB_PROJECT_ROW_TAG_PREFIX$profilePrefix:$projectKey"

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (isSelected) DamHopperColors.SurfaceVariant else DamHopperColors.Surface)
            .border(
                width = if (isSelected) 2.dp else 1.dp,
                color = if (isSelected) DamHopperColors.Primary else DamHopperColors.Border,
                shape = shape,
            )
            .padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Independent selectable project content (>=48dp touch target)
        Row(
            modifier = Modifier
                .weight(1f)
                .sizeIn(minHeight = 48.dp)
                .clip(shape)
                .clickable(
                    role = Role.Tab,
                    onClick = {
                        callbacks.onSelectProject(project.target)
                        callbacks.onSelectOwner?.let { ownerFn -> project.owner?.let { ownerFn(it) } }
                    },
                )
                .testTag(rowTag)
                .semantics {
                    selected = isSelected
                    contentDescription = buildProjectContentDescription(project, showProfile)
                }
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = project.projectLabel,
                        color = DamHopperColors.TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (project.worktreeLabel != null) {
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "(${project.worktreeLabel})",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (project.isPinned) {
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "\uD83D\uDCCC",
                            fontSize = 10.sp,
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (showProfile && project.profileLabel.isNotBlank()) {
                        Text(
                            text = project.profileLabel,
                            color = DamHopperColors.Primary,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(3.dp))
                                .background(DamHopperColors.PrimaryVariant.copy(alpha = 0.5f))
                                .padding(horizontal = 4.dp, vertical = 1.dp),
                        )
                    }
                    val statusText = project.statusLabel ?: "${project.sessionCount} sessions"
                    Text(
                        text = statusText,
                        color = when {
                            !project.isAvailable -> DamHopperColors.Error
                            project.isUnsupported -> DamHopperColors.Warning
                            project.sessionCount == 0 -> DamHopperColors.TextSecondary
                            else -> DamHopperColors.TextSecondary
                        },
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // Sibling control 1: Create session in project (>=48dp touch target)
        IconButton(
            onClick = {
                callbacks.onCreateSession(project.target)
                callbacks.onCreateSessionForOwner?.let { ownerFn -> project.owner?.let { ownerFn(it) } }
            },
            enabled = project.isAvailable && !project.isUnsupported,
            modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .testTag("$AGENT_HUB_CREATE_BUTTON_TAG_PREFIX$profilePrefix:$projectKey")
                .semantics {
                    role = Role.Button
                    contentDescription = if (project.isUnsupported) {
                        "New terminal in ${project.projectLabel} disabled: unsupported"
                    } else {
                        "New terminal in ${project.projectLabel}"
                    }
                },
        ) {
            Text(
                text = "+",
                color = if (project.isAvailable) DamHopperColors.Primary else DamHopperColors.TextSecondary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        // Sibling control 2: Dismiss project (>=48dp touch target, enabled only if canDismiss)
        IconButton(
            onClick = {
                callbacks.onDismissProject(project.target)
                callbacks.onDismissOwner?.let { ownerFn -> project.owner?.let { ownerFn(it) } }
            },
            enabled = project.canDismiss,
            modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .testTag("$AGENT_HUB_DISMISS_BUTTON_TAG_PREFIX$profilePrefix:$projectKey")
                .semantics {
                    role = Role.Button
                    contentDescription = if (project.canDismiss) {
                        "Dismiss ${project.projectLabel}"
                    } else {
                        "Dismiss ${project.projectLabel} disabled: active sessions exist"
                    }
                },
        ) {
            Text(
                text = "\u00D7",
                color = if (project.canDismiss) DamHopperColors.TextPrimary else DamHopperColors.Border,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/**
 * Modal cover presentation for compact screens.
 * Integrates scrim, Escape key handling, focus request, keyboard hiding, and effective input cover.
 */
@Composable
fun AgentHubNavigatorModal(
    state: AgentHubNavigatorUiState,
    callbacks: AgentHubNavigatorCallbacks,
    host: TerminalAgentsHostState? = null,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        keyboard?.hide()
        try {
            focusRequester.requestFocus()
        } catch (_: Throwable) {
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable {
                focusManager.clearFocus()
                host?.setPopupVisible(false)
                callbacks.onDismissNavigator()
            }
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.key == Key.Escape) {
                    host?.setPopupVisible(false)
                    callbacks.onDismissNavigator()
                    true
                } else false
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .sizeIn(maxWidth = AGENT_HUB_MODAL_MAX_WIDTH)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .focusRequester(focusRequester)
                .focusable(),
        ) {
            AgentHubNavigator(
                state = state,
                mode = AgentHubNavigatorMode.MODAL,
                callbacks = callbacks,
            )
        }
    }
}

/**
 * Pinned navigation rail presentation for width-admitted large screens (>=640dp usable width).
 */
@Composable
fun AgentHubNavigatorRail(
    state: AgentHubNavigatorUiState,
    callbacks: AgentHubNavigatorCallbacks,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .width(AGENT_HUB_RAIL_WIDTH)
            .fillMaxHeight(),
    ) {
        AgentHubNavigator(
            state = state,
            mode = AgentHubNavigatorMode.RAIL,
            callbacks = callbacks,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

private fun buildProjectContentDescription(project: AgentHubProjectRowState, showProfile: Boolean): String {
    val profilePart = if (showProfile && project.profileLabel.isNotBlank()) "${project.profileLabel} profile, " else ""
    val worktreePart = if (project.worktreeLabel != null) "worktree ${project.worktreeLabel}, " else ""
    val statusPart = project.statusLabel ?: "${project.sessionCount} sessions"
    val pinnedPart = if (project.isPinned) ", pinned" else ""
    val selectedPart = if (project.isSelected) ", selected" else ""
    return "$profilePart${project.projectLabel}, $worktreePart$statusPart$pinnedPart$selectedPart"
}
