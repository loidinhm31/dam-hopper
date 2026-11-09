# Phase 08 — Unit Tests & Build Verification

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 1.5h
- **Owner**: Test Engineering (`:shared`)
- **Dependencies**: Phase 01 to Phase 07
  - `define-agent-hub-state-models`
  - `integrate-agent-hub-landing-screen`

---

## Context & Objectives
Write comprehensive unit tests for the Agent Hub First Page / Landing Screen state, projection, and interaction models.
Requirements:
1. `AgentHubLandingUiStateTest`:
   - Validates default values and immutability.
   - Validates copy mutations and urgency counter computations.
   - Validates project search query filtering logic.
2. `AgentHubLandingProjectionTest`:
   - Validates mapping of `AgentHubSnapshot` and `TerminalAgentsContext` into `AgentHubLandingUiState`.
   - Validates handling of null contexts, empty projects, zero-session targets, and status counts.
   - Validates dismissible flag semantics (zero live sessions).
3. Build Verification:
   - Run `:shared:jvmTest` to ensure all tests pass.
   - Run compilation for Android and JVM targets (`:shared:compileKotlinJvm`).

---

## Exact File Actions

### 1. `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingUiStateTest.kt` (NEW)
**Target Line Count**: ~100 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.flow

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgentHubLandingUiStateTest {

    @Test
    fun testDefaultStateValues() {
        val state = AgentHubLandingUiState()
        assertEquals("Server", state.profileName)
        assertTrue(state.isOnline)
        assertFalse(state.isAgentsDrawerOpen)
        assertFalse(state.isFilesDrawerOpen)
        assertTrue(state.isRightFileTreePinned)
        assertEquals(0, state.urgencyCounters.attentionCount)
        assertEquals(0, state.urgencyCounters.workingCount)
        assertEquals(0, state.urgencyCounters.idleCount)
    }

    @Test
    fun testUrgencyCountersValues() {
        val counters = UrgencyCountersUiState(attentionCount = 2, workingCount = 3, idleCount = 1)
        assertEquals(2, counters.attentionCount)
        assertEquals(3, counters.workingCount)
        assertEquals(1, counters.idleCount)
    }

    @Test
    fun testStateCopyMutation() {
        val initial = AgentHubLandingUiState()
        val updated = initial.copy(
            isAgentsDrawerOpen = true,
            isFilesDrawerOpen = false,
            urgencyCounters = UrgencyCountersUiState(attentionCount = 1, workingCount = 0, idleCount = 0),
        )
        assertTrue(updated.isAgentsDrawerOpen)
        assertFalse(updated.isFilesDrawerOpen)
        assertEquals(1, updated.urgencyCounters.attentionCount)
    }
}
```

### 2. `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingProjectionTest.kt` (NEW)
**Target Line Count**: ~130 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.settings.ProfileData
import dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AgentHubLandingProjectionTest {

    @Test
    fun testProjectWithNullContextsProducesSafeDefaults() {
        val state = AgentHubLandingProjection.project(
            currentProfile = null,
            hubSnapshot = AgentHubSnapshot(),
            agentsContext = null,
            activeWorkspaceState = null,
            searchQuery = "",
            selectedProjectName = null,
            isAgentsDrawerOpen = false,
            isFilesDrawerOpen = false,
            isRightFileTreePinned = true,
        )

        assertEquals("Server", state.profileName)
        assertEquals(0, state.urgencyCounters.attentionCount)
        assertEquals(0, state.agentRoster.agents.size)
        assertEquals(0, state.projectList.projects.size)
    }

    @Test
    fun testProjectWithProfileData() {
        val profile = ProfileData(
            id = "test-prof",
            name = "Local Dev",
            baseUrl = "http://127.0.0.1:4803",
            isOnline = true,
            isDevMode = true,
            hasMfa = false,
        )

        val state = AgentHubLandingProjection.project(
            currentProfile = profile,
            hubSnapshot = AgentHubSnapshot(profileId = "test-prof"),
            agentsContext = null,
            activeWorkspaceState = null,
            searchQuery = "",
            selectedProjectName = null,
            isAgentsDrawerOpen = false,
            isFilesDrawerOpen = false,
            isRightFileTreePinned = true,
        )

        assertEquals("Local Dev", state.profileName)
        assertEquals("http://127.0.0.1:4803", state.serverUrl)
        assertTrue(state.isOnline)
        assertTrue(state.isDevMode)
        assertFalse(state.hasMfa)
    }
}
```

---

## Verification Plan

### Automated Unit Tests
```bash
cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:jvmTest"
```

### Compilation Check
```bash
cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:compileKotlinJvm"
```
