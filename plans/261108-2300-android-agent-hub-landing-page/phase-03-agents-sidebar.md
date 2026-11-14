# Phase 03 — Left Agents Sidebar & Cards

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 2.0h
- **Owner**: UI Components (`:shared`)
- **Dependencies**: Phase 01 (`define-agent-hub-state-models`, `define-agent-hub-callbacks`)

---

## Context & Objectives
Implement the Left Agents Sidebar and individual Agent Card presentation.
Requirements:
1. Pinned width: `240–280dp` on foldable and expanded tablet screens (`>=600dp`), or modal navigation drawer on compact phone screens (`<600dp`).
2. Header with title `"AGENTS"`, total eligible count pill, and active status indicator.
3. Horizontally scrollable status filter chips bar supporting canonical statuses (`All`, `! Attn`, `● Work`, `○ Idle`).
4. Bento agent cards displaying:
   - Agent kind badge (`Codex` amber, `OMP` blue, `Claude` purple).
   - Associated project name and session display number (`#1`, `#2`).
   - Human-readable status label and duration counter.
   - Last event telemetry quotation.
   - Prominent `[>_ Jump to Terminal]` CTA button with `>=48x48dp` touch target executing `callbacks.onJumpToAgentTerminal(...)`.
5. Footer action buttons: `[🔄 Refresh]` and `[Agent ⚙ Host]` deep-linking to host settings.

Modularized into two files under 200 lines:
- `AgentHubAgentCard.kt`: Individual agent card presentation, badge styling, and jump CTA.
- `AgentHubAgentsSidebar.kt`: Header, filter chips row, cards list, and footer action bar.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubAgentCard.kt` (NEW)
**Target Line Count**: ~140 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentGroupItemUiState
import dev.damhopper.nativeapp.ui.flow.AgentStatusKind
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_AGENT_CARD_PREFIX: String = "agent-hub-agent-card:"
const val TAG_AGENT_JUMP_PREFIX: String = "agent-hub-agent:jump-button:"

@Composable
fun AgentHubAgentCard(
    agent: AgentGroupItemUiState,
    onJumpToTerminal: (terminalId: String, incarnationExact: Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isAttention = agent.status == AgentStatusKind.ATTENTION
    val borderColor = if (isAttention) Color(0xFFD29922) else DamHopperColors.Border
    val shape = RoundedCornerShape(8.dp)

    Column(
        modifier = modifier
            .testTag(TAG_AGENT_CARD_PREFIX + agent.key)
            .fillMaxWidth()
            .clip(shape)
            .background(DamHopperColors.Surface)
            .border(1.dp, borderColor, shape)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Row 1: Agent Badge + Project Name + Session Number
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AgentKindBadge(agentName = agent.agentName)
            Text(
                text = agent.projectName,
                color = DamHopperColors.TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = agent.sessionDisplayId,
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
            )
        }

        // Row 2: Status Label + Elapsed Duration
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val statusColor = when (agent.status) {
                AgentStatusKind.ATTENTION -> Color(0xFFD29922)
                AgentStatusKind.WORKING -> Color(0xFF3FB950)
                AgentStatusKind.IDLE -> DamHopperColors.TextSecondary
            }
            Text(
                text = agent.statusLabel,
                color = statusColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.weight(1f))
            if (agent.elapsedDuration.isNotEmpty()) {
                Text(
                    text = agent.elapsedDuration,
                    color = DamHopperColors.TextSecondary,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }

        // Row 3: Last Event Summary
        if (agent.lastEventSummary.isNotEmpty()) {
            Text(
                text = "\"${agent.lastEventSummary}\"",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Row 4: Jump to Terminal CTA
        Box(
            modifier = Modifier
                .testTag(TAG_AGENT_JUMP_PREFIX + agent.key)
                .fillMaxWidth()
                .sizeIn(minHeight = 48.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(if (isAttention) Color(0xFFD29922).copy(alpha = 0.2f) else DamHopperColors.SurfaceVariant)
                .border(1.dp, if (isAttention) Color(0xFFD29922) else DamHopperColors.Border, RoundedCornerShape(4.dp))
                .clickable(role = Role.Button) {
                    onJumpToTerminal(agent.targetTerminalId, agent.incarnationExact)
                }
                .semantics { contentDescription = "Jump to terminal ${agent.projectName} ${agent.sessionDisplayId}" }
                .padding(vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = ">_ Jump to Terminal",
                color = if (isAttention) Color(0xFFE3B341) else DamHopperColors.Primary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun AgentKindBadge(agentName: String, modifier: Modifier = Modifier) {
    val (bgColor, textColor) = when (agentName.lowercase()) {
        "codex" -> Color(0xFFD29922).copy(alpha = 0.2f) to Color(0xFFE3B341)
        "omp" -> Color(0xFF58A6FF).copy(alpha = 0.2f) to Color(0xFF58A6FF)
        "claude" -> Color(0xFFA371F7).copy(alpha = 0.2f) to Color(0xFFA371F7)
        else -> DamHopperColors.SurfaceVariant to DamHopperColors.TextPrimary
    }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bgColor)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = agentName, color = textColor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubAgentsSidebar.kt` (NEW)
**Target Line Count**: ~160 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.ui.flow.AgentRosterUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_AGENTS_SIDEBAR_ROOT: String = "agent-hub-agents-sidebar"
const val TAG_AGENTS_REFRESH: String = "agent-hub-agents:refresh-button"
const val TAG_AGENTS_SETTINGS: String = "agent-hub-agents:settings-button"

@Composable
fun AgentHubAgentsSidebar(
    roster: AgentRosterUiState,
    onFilterChange: (TerminalAgentsFilterSelection) -> Unit,
    onJumpToTerminal: (terminalId: String, incarnationExact: Long) -> Unit,
    onRefreshAgents: () -> Unit,
    onOpenAgentSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_AGENTS_SIDEBAR_ROOT)
            .fillMaxHeight()
            .background(DamHopperColors.Surface)
            .border(width = 1.dp, color = DamHopperColors.Border)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Sidebar Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "AGENTS",
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "${roster.totalEligible}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        // 2. Filter Chips Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilterChipItem(
                label = "All (${roster.totalEligible})",
                isSelected = roster.activeFilter is TerminalAgentsFilterSelection.All,
                onClick = { onFilterChange(TerminalAgentsFilterSelection.All) },
            )
        }

        // 3. Observed Agents Cards List
        if (roster.agents.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (roster.isLoading) "Scanning agents..." else "No active agents",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                items(roster.agents, key = { it.key }) { agent ->
                    AgentHubAgentCard(
                        agent = agent,
                        onJumpToTerminal = onJumpToTerminal,
                    )
                }
            }
        }

        // 4. Footer Actions Bar
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .testTag(TAG_AGENTS_REFRESH)
                    .weight(1f)
                    .sizeIn(minHeight = 48.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                    .clickable(role = Role.Button, onClick = onRefreshAgents),
                contentAlignment = Alignment.Center,
            ) {
                Text("🔄 Refresh", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
            Box(
                modifier = Modifier
                    .testTag(TAG_AGENTS_SETTINGS)
                    .weight(1f)
                    .sizeIn(minHeight = 48.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                    .clickable(role = Role.Button, onClick = onOpenAgentSettings),
                contentAlignment = Alignment.Center,
            ) {
                Text("Agent ⚙ Host", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun FilterChipItem(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier
            .sizeIn(minHeight = 32.dp)
            .clip(shape)
            .background(if (isSelected) DamHopperColors.Primary.copy(alpha = 0.2f) else DamHopperColors.SurfaceVariant)
            .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (isSelected) DamHopperColors.Primary else DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
        )
    }
}
```

---

## Verification Commands
```bash
cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:compileKotlinJvm"
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "implement-agent-hub-agent-card",
    "title": "Implement AgentHubAgentCard component with touch-sized jump action",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubAgentCard.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Enforce >=48x48dp touch target for >_ Jump to Terminal button.",
      "Highlight cards with #D29922 border when agent.status is ATTENTION."
    ],
    "acceptance": [
      "AgentHubAgentCard displays agent badge, project name, session ID, status, timer, telemetry quotation, and jump button.",
      "Clicking jump button triggers onJumpToTerminal callback with terminal ID and incarnation."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "implement-agent-hub-agents-sidebar",
    "title": "Implement AgentHubAgentsSidebar with filter chips, agent roster, and host footer",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks",
      "implement-agent-hub-agent-card"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubAgentsSidebar.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Enforce >=48x48dp touch targets on refresh and settings footer buttons."
    ],
    "acceptance": [
      "AgentHubAgentsSidebar renders header count, filter chips, scrollable cards, and footer actions.",
      "Empty state renders cleanly when no active agents are running."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-agent-hub-agent-card --> Implement AgentHubAgentCard component with touch-sized jump action
- [ ] <!-- evcrate-task:implement-agent-hub-agents-sidebar --> Implement AgentHubAgentsSidebar with filter chips, agent roster, and host footer
