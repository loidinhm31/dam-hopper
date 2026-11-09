# Phase 02 — Top Chrome Header Component

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 1.5h
- **Owner**: UI Components (`:shared`)
- **Dependencies**: Phase 01 (`define-agent-hub-state-models`, `define-agent-hub-callbacks`)

---

## Context & Objectives
Implement the top navigation and status chrome header for the Agent Hub Landing Screen.
Requirements:
1. Pinned height: `56dp` on compact phone screens, `48dp` on expanded tablet viewports.
2. Inviolable minimum **48x48dp touch targets** on all interactive triggers (`[☰ AGENTS]`, `[📁 FILES]`, `[🔔]`, `[⚙]`, and the context pill).
3. Non-wrapping urgency counters (`! N Attention`, `● N Working`, `○ N Idle`) providing instant cross-project status assessment.
4. Left `[☰ AGENTS]` toggle displays attention indicator (`! N`) whenever any running agent requires developer approval or action.
5. Server context pill displays connectivity indicator (green dot `#3FB950`), profile name (`local-dev`), server address, and auth badge (`DEV` or `MFA ✓`), with click triggering `onSwitchProfile()`.

Modularized into two files under 200 lines:
- `AgentHubUrgencyCounters.kt`: Status indicator chips with high-contrast semantics.
- `AgentHubLandingHeader.kt`: Pinned top bar layout, action buttons, and responsive density.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubUrgencyCounters.kt` (NEW)
**Target Line Count**: ~110 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.UrgencyCountersUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_URGENCY_ATTENTION: String = "agent-hub-header:urgency-attention"
const val TAG_URGENCY_WORKING: String = "agent-hub-header:urgency-working"
const val TAG_URGENCY_IDLE: String = "agent-hub-header:urgency-idle"

@Composable
fun AgentHubUrgencyCountersBar(
    counters: UrgencyCountersUiState,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        UrgencyCounterChip(
            label = "! ${counters.attentionCount} Attn",
            description = "${counters.attentionCount} agents requiring attention",
            backgroundColor = if (counters.attentionCount > 0) Color(0xFFD29922).copy(alpha = 0.25f) else DamHopperColors.SurfaceVariant,
            textColor = if (counters.attentionCount > 0) Color(0xFFE3B341) else DamHopperColors.TextSecondary,
            borderColor = if (counters.attentionCount > 0) Color(0xFFD29922) else DamHopperColors.Border,
            testTag = TAG_URGENCY_ATTENTION,
        )
        UrgencyCounterChip(
            label = "● ${counters.workingCount} Work",
            description = "${counters.workingCount} agents working",
            backgroundColor = if (counters.workingCount > 0) Color(0xFF238636).copy(alpha = 0.25f) else DamHopperColors.SurfaceVariant,
            textColor = if (counters.workingCount > 0) Color(0xFF3FB950) else DamHopperColors.TextSecondary,
            borderColor = if (counters.workingCount > 0) Color(0xFF238636) else DamHopperColors.Border,
            testTag = TAG_URGENCY_WORKING,
        )
        UrgencyCounterChip(
            label = "○ ${counters.idleCount} Idle",
            description = "${counters.idleCount} agents idle",
            backgroundColor = DamHopperColors.SurfaceVariant,
            textColor = DamHopperColors.TextSecondary,
            borderColor = DamHopperColors.Border,
            testTag = TAG_URGENCY_IDLE,
        )
    }
}

@Composable
private fun UrgencyCounterChip(
    label: String,
    description: String,
    backgroundColor: Color,
    textColor: Color,
    borderColor: Color,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier
            .testTag(testTag)
            .sizeIn(minHeight = 28.dp)
            .clip(shape)
            .background(backgroundColor)
            .border(1.dp, borderColor, shape)
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubLandingHeader.kt` (NEW)
**Target Line Count**: ~175 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_HEADER_ROOT: String = "agent-hub-header"
const val TAG_HEADER_AGENTS_TOGGLE: String = "agent-hub-header:agents-toggle"
const val TAG_HEADER_CONTEXT_PILL: String = "agent-hub-header:context-pill"
const val TAG_HEADER_FILES_TOGGLE: String = "agent-hub-header:files-toggle"
const val TAG_HEADER_NOTIFICATIONS: String = "agent-hub-header:notifications"
const val TAG_HEADER_SETTINGS: String = "agent-hub-header:settings"

@Composable
fun AgentHubLandingHeader(
    state: AgentHubLandingUiState,
    callbacks: AgentHubLandingCallbacks,
    isCompact: Boolean,
    modifier: Modifier = Modifier,
) {
    val headerHeight = if (isCompact) 56.dp else 48.dp
    Row(
        modifier = modifier
            .testTag(TAG_HEADER_ROOT)
            .fillMaxWidth()
            .height(headerHeight)
            .background(DamHopperColors.Surface)
            .border(width = 1.dp, color = DamHopperColors.Border)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Left Sidebar Trigger (Agents)
        AgentsHeaderToggleButton(
            attentionCount = state.urgencyCounters.attentionCount,
            onClick = callbacks::onToggleAgentsSidebar,
        )

        // 2. Server Context Pill
        ServerContextPill(
            profileName = state.profileName,
            serverUrl = state.serverUrl,
            isOnline = state.isOnline,
            isDevMode = state.isDevMode,
            hasMfa = state.hasMfa,
            onClick = callbacks::onSwitchProfile,
            modifier = Modifier.weight(1f, fill = false),
        )

        // 3. Quick Urgency Counters (Scrollable when constrained)
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AgentHubUrgencyCountersBar(counters = state.urgencyCounters)
        }

        Spacer(Modifier.weight(1f))

        // 4. Right Sidebar Trigger (Files)
        HeaderTouchIconButton(
            label = "📁 FILES",
            description = "Toggle Workspace File Tree",
            testTag = TAG_HEADER_FILES_TOGGLE,
            onClick = callbacks::onToggleFilesSidebar,
        )

        // 5. Notifications Trigger
        HeaderTouchIconButton(
            label = "🔔",
            description = "Open Notifications Feed",
            testTag = TAG_HEADER_NOTIFICATIONS,
            onClick = callbacks::onOpenNotifications,
        )

        // 6. Settings Trigger
        HeaderTouchIconButton(
            label = "⚙",
            description = "Open Hub Settings",
            testTag = TAG_HEADER_SETTINGS,
            onClick = callbacks::onOpenSettings,
        )
    }
}

@Composable
private fun AgentsHeaderToggleButton(
    attentionCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier = modifier
            .testTag(TAG_HEADER_AGENTS_TOGGLE)
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(shape)
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("☰ AGENTS", color = DamHopperColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (attentionCount > 0) {
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color(0xFFD29922))
                        .padding(horizontal = 5.dp, vertical = 1.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("!$attentionCount", color = Color(0xFF0D1117), fontSize = 10.sp, fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}

@Composable
private fun ServerContextPill(
    profileName: String,
    serverUrl: String?,
    isOnline: Boolean,
    isDevMode: Boolean,
    hasMfa: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = modifier
            .testTag(TAG_HEADER_CONTEXT_PILL)
            .sizeIn(minHeight = 36.dp)
            .clip(shape)
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (isOnline) Color(0xFF3FB950) else Color(0xFFF85149)),
        )
        Text(
            text = profileName,
            color = DamHopperColors.TextPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (serverUrl != null) {
            Text(
                text = "· $serverUrl",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (isDevMode) {
            Text("DEV", color = Color(0xFF58A6FF), fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun HeaderTouchIconButton(
    label: String,
    description: String,
    testTag: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier = modifier
            .testTag(testTag)
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = DamHopperColors.TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.semantics { contentDescription = description },
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
    "id": "implement-agent-hub-urgency-counters",
    "title": "Implement AgentHubUrgencyCountersBar component",
    "blocked_by": [
      "define-agent-hub-state-models"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubUrgencyCounters.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "High contrast colors: Attention #D29922, Working #3FB950, Idle #8B949E.",
      "Include explicit test tags for all three counters."
    ],
    "acceptance": [
      "AgentHubUrgencyCountersBar renders attention, working, and idle counters.",
      "UrgencyCounterChip sets contentDescription for screen readers."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "implement-agent-hub-header",
    "title": "Implement AgentHubLandingHeader top chrome component",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks",
      "implement-agent-hub-urgency-counters"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubLandingHeader.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Enforce >=48x48dp touch targets on all interactive triggers.",
      "Support compact (56dp) vs expanded (48dp) height without text clipping."
    ],
    "acceptance": [
      "AgentHubLandingHeader renders Agents toggle with attention badge, context pill, counters, Files toggle, Notifications, and Settings.",
      "Tapping triggers invokes corresponding AgentHubLandingCallbacks."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-agent-hub-urgency-counters --> Implement AgentHubUrgencyCountersBar component
- [ ] <!-- evcrate-task:implement-agent-hub-header --> Implement AgentHubLandingHeader top chrome component
