---
title: "Native Android Agent Hub Landing Screen (First Page)"
description: "Implement responsive 3-zone Agent Hub Landing Screen for Android mobile, foldable, and tablet devices replacing placeholder AgentHubEmptyRoot."
status: pending
priority: P1
effort: 14h
branch: feat/ai-os-redesign
tags: [android, compose-multiplatform, agent-hub, landing-screen, responsive, ui-ux, touch-ergonomics]
created: 2026-11-08
---

# Master Plan: Native Android Agent Hub Landing Screen (First Page)

## Executive Overview
Following the approved UI/UX design specification in `plans/reports/evc-ui-ux-designer-261108-2207-android-agent-hub-first-page.md` and wireframe assets in `plans/reports/assets/`, this plan implements the high-density, multi-zone **Agent Hub First Page / Landing Screen** for the DamHopper native Android client (`@native/android-app/`).

The landing screen replaces the legacy `AgentHubEmptyRoot` placeholder composable in `DamHopperMobileApp.kt` (lines 1118-1383), introducing an adaptive 3-zone layout that dynamically scales across phone, foldable, and tablet form factors.

<!-- evcrate-progress:start -->
Tasks: 0/15 completed; remaining: 15.
<!-- evcrate-progress:end -->

---

## Architectural & System Invariants

### 1. Adaptive 3-Zone Architecture & Responsive Breakpoints
The screen layout adapts dynamically based on measured viewport constraints (`BoxWithConstraints`):
- **Compact Phone (<600dp)**: Single active stage (Center Projects Stage) with:
  - Animated modal left navigation drawer for Agents (`ModalNavigationDrawer` / slide-in from left with 50% dark scrim).
  - Animated modal right drawer / bottom sheet for Workspace File Tree & Git Changes.
- **Foldable / Landscape (600–839dp)**: Dual-column layout with pinned left navigation rail (`240–280dp`) + center project stage (flex 1, `>=360dp`).
- **Expanded Tablet / DeX (>=840dp)**: Full 3-column bento layout:
  - Column 1: Left Agents Sidebar (`240dp`, fixed).
  - Column 2: Center Projects Stage (flex 1, `~380–480dp`).
  - Column 3: Right Workspace File Tree & File Changes (`280–320dp`, collapsible/pinnable).

### 2. Inviolable Touch Ergonomics & Accessibility
- **Minimum 48x48dp Touch Targets**: Every button, tab, chip, icon button, and dismiss trigger must enforce `Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)` or `Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)`.
- **Safety Spacing**: Safe separation of `>=8dp` between primary clicks and destructive/dismiss actions (e.g., project card tap vs. zero-session project dismiss `[✕]` button).
- **WCAG 2.1 AA Contrast**: Deep-black OLED canvas (`#0D1117`), dark slate card surfaces (`#161B22`), border elevation (`#30363D`), and text `#F0F6FC` on `#0D1117` achieving `15.8:1` contrast ratio.
- **IME & Keyboard Invariant**: Fixed top chrome height (`56dp` compact, `48dp` expanded) with non-wrapping urgency counters, preserving `>=12` visible terminal lines when software keyboard appears.

### 3. Modularization Rules (<200 Lines Per File)
To guarantee strict maintainability, readability, and LLM tooling efficiency, no Kotlin file shall exceed 200 lines. Concerns are strictly decomposed into focused components:
- State & Callbacks: `AgentHubLandingUiState.kt` and `AgentHubLandingCallbacks.kt`
- Header: `AgentHubLandingHeader.kt` and `AgentHubUrgencyCounters.kt`
- Left Agents: `AgentHubAgentsSidebar.kt` and `AgentHubAgentCard.kt`
- Center Stage: `ProjectListCenterStage.kt` and `ProjectCardItem.kt`
- Right File Tree: `WorkspaceFileTreeSidebar.kt` and `WorkspaceFileChangesSection.kt`
- Container: `AgentHubLandingScreen.kt` and `AgentHubDrawers.kt`
- Integration: `DamHopperMobileApp.kt` and `AgentHubLandingProjection.kt`
- Tests: `AgentHubLandingUiStateTest.kt` and `AgentHubLandingProjectionTest.kt`

---

## Phases & File Ownership

| Phase | Title | Scope & File Ownership | Effort | Status |
|---|---|---|---|---|
| [Phase 01](./phase-01-state-models-and-callbacks.md) | State Models & Callback Contract | `AgentHubLandingUiState.kt`, `AgentHubLandingCallbacks.kt` | 1.5h | pending |
| [Phase 02](./phase-02-header-component.md) | Top Chrome Header Component | `AgentHubUrgencyCounters.kt`, `AgentHubLandingHeader.kt` | 1.5h | pending |
| [Phase 03](./phase-03-agents-sidebar.md) | Left Agents Sidebar & Cards | `AgentHubAgentCard.kt`, `AgentHubAgentsSidebar.kt` | 2.0h | pending |
| [Phase 04](./phase-04-center-stage.md) | Center Stage & Project Cards | `ProjectCardItem.kt`, `ProjectListCenterStage.kt` | 2.0h | pending |
| [Phase 05](./phase-05-workspace-file-tree.md) | Right File Tree & Changes | `WorkspaceFileChangesSection.kt`, `WorkspaceFileTreeSidebar.kt` | 2.0h | pending |
| [Phase 06](./phase-06-container-screen.md) | Responsive Container & Drawers | `AgentHubDrawers.kt`, `AgentHubLandingScreen.kt` | 2.0h | pending |
| [Phase 07](./phase-07-app-integration.md) | Integration & Root Replacement | `AgentHubLandingProjection.kt`, `DamHopperMobileApp.kt` | 1.5h | pending |
| [Phase 08](./phase-08-unit-tests-and-verification.md) | Unit Tests & Build Verification | `AgentHubLandingUiStateTest.kt`, `AgentHubLandingProjectionTest.kt` | 1.5h | pending |

---

## File Ownership Matrix

```
native/android-app/
├── shared/
│   ├── src/commonMain/kotlin/dev/damhopper/nativeapp/
│   │   ├── ui/
│   │   │   ├── flow/
│   │   │   │   ├── AgentHubLandingUiState.kt          --> Phase 01
│   │   │   │   ├── AgentHubLandingCallbacks.kt        --> Phase 01
│   │   │   │   └── AgentHubLandingProjection.kt       --> Phase 07
│   │   │   ├── components/
│   │   │   │   ├── AgentHubUrgencyCounters.kt         --> Phase 02
│   │   │   │   ├── AgentHubLandingHeader.kt           --> Phase 02
│   │   │   │   ├── AgentHubAgentCard.kt               --> Phase 03
│   │   │   │   ├── AgentHubAgentsSidebar.kt           --> Phase 03
│   │   │   │   ├── ProjectCardItem.kt                 --> Phase 04
│   │   │   │   ├── ProjectListCenterStage.kt          --> Phase 04
│   │   │   │   ├── WorkspaceFileChangesSection.kt     --> Phase 05
│   │   │   │   └── WorkspaceFileTreeSidebar.kt        --> Phase 05
│   │   │   └── screens/
│   │   │       ├── AgentHubDrawers.kt                 --> Phase 06
│   │   │       ├── AgentHubLandingScreen.kt           --> Phase 06
│   │   │       └── DamHopperMobileApp.kt              --> Phase 07
│   └── src/jvmTest/kotlin/dev/damhopper/nativeapp/
│       └── ui/flow/
│           ├── AgentHubLandingUiStateTest.kt          --> Phase 08
│           └── AgentHubLandingProjectionTest.kt       --> Phase 08
```

---

## Verification Strategy

1. **Unit Test Verification (`:shared:jvmTest`)**:
   - `AgentHubLandingUiStateTest`: Validates default state values, immutability, copy mutations, and urgency counter calculations.
   - `AgentHubLandingProjectionTest`: Validates projection of `AgentHubSnapshot` and `TerminalAgentsContext` into `AgentHubLandingUiState`, handling null registrations, empty projects, and zero-session target dismissal flags.
   - Command:
     ```bash
     cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:jvmTest"
     ```

2. **Kotlin Multiplatform & Android Compilation**:
   - Compiles both Android debug variants and JVM targets without syntax or typing errors.
   - Command:
     ```bash
     cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :androidApp:compileDebugKotlin :shared:compileKotlinJvm"
     ```

3. **Touch Target & Accessibility Verification**:
   - Semantic content descriptions and test tags verified on all interactive buttons.
   - Contrast checks confirm adherence to OLED Dark Theme `#0D1117` and text `#F0F6FC`.
