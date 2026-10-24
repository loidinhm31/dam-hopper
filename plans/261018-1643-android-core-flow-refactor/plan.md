---
title: "Android Core Flow Refactor"
description: "Deliver the Android mobile flow across six phases; device qualification remains separate."
status: completed
priority: P2
effort: "Six phases; time estimate not recorded"
branch: feat/android-native-app
tags: [android, mobile, refactor]
created: 2026-10-18
---

# Android Core Flow Refactor Plan
Date: 261018
Slug: android-core-flow-refactor

## Objective
Step back from the monolithic desktop-oriented workbench on Android and refactor to run one clean, rock-solid, focused mobile flow:
**Profile Login -> List of projects -> Select a project -> Terminal display**

## Phase Implementation & Acceptance Review

| Phase | Status | Acceptance result |
|---|---|---|
| 1. Foundation & network | Complete | StateFlow navigation; debug LAN cleartext; release remains TLS-only. Debug base policy permits cleartext to all hosts. |
| 2. Profile login | Complete | Profiles, password/MFA and capability-gated dev login, connection test, and vault use. Password/MFA login is blocked over HTTP; REST Bearer attaches only on HTTPS or recognized loopback; WS token query is secure/loopback only. |
| 3. Project list | Complete | Workspace-backed loading, error/retry, empty and populated states; project selection and profile switching. |
| 4. Terminal | Implemented; runtime evidence pending | PTY session listing/replay/live output, command/accessory input, and local detach without killing remote PTY are implemented. Bounded ANSI-stripping console, not full terminal emulation; live output not exercised on device/server. |
| 5. Root wiring | Implemented | Three stages, back unwinding, profile synchronization, and generation-keyed repository reconstruction. Android launch/rotation evidence remains pending. |
| 6. Verification | Complete | Phase report records green `:shared:jvmTest` and `:androidApp:testDebugUnitTest`; not rerun for this status update. |


## Architecture & Dependency Graph
```
Phase 1: Foundation & Network Security Configuration (Base)
  ├── Phase 2: Profile & Login Screen (Parallel)
  ├── Phase 3: Project List Screen (Parallel)
  └── Phase 4: Terminal Display & Input Surface (Parallel)
       │
       ▼
Phase 5: Root Flow Integration & Wiring (Sequential after 2, 3, 4)
       │
       ▼
Phase 6: Automated Verification & Unit Tests (Sequential)
```

## File Ownership Matrix
| Phase | Owned Files | Description |
|---|---|---|
| Phase 1 | `native-app/androidApp/src/debug/res/xml/network_security_config.xml`<br>`native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`<br>`native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt` | Debug network cleartext configuration + Flow state models and state machine |
| Phase 2 | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt` | Mobile Profile & Login UI with server URL input, presets, credentials, and dev-mode login |
| Phase 3 | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt` | Mobile Project List UI querying WorkspaceRepository with loading, empty, and selection states |
| Phase 4 | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`<br>`native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt` | Real terminal output buffer display, PTY WebSocket connection, text command input field, and accessory keys |
| Phase 5 | `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`<br>`native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` | Root application entry hosting the guided flow and system back-button hierarchical unwinding |
| Phase 6 | `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt`<br>`native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt` | Complete automated unit tests for navigation flow, project selection, and terminal lifecycle |

## Side-Effect Review Checklist
- [x] Reported: Phase 06 records green `:shared:jvmTest` and `:androidApp:testDebugUnitTest`; not rerun for this PM review.
- [x] Source reviewed: Release network security remains TLS-only (`cleartextTrafficPermitted="false"`).
- [x] Source/phase evidence: Reuses existing `ProfileRepository`, `CredentialVault`, `WorkspaceRepository`, `TerminalRepository`, and `TerminalSessionController`.
- [x] Phase/code evidence: Retains `WorkbenchScreen` and `PanelRegistry` for power-user / desktop compatibility.
- [x] Test source: Zero-WebView and adjustResize manifest invariants are asserted.
- [x] Code-review/source evidence: Inactive-panel and background terminal input are fenced.
- [x] Source reviewed: Back state unwinds; terminal disposal closes local controllers/surfaces without remote PTY removal. Live runtime detach not exercised.

## Code Review & Quality Assessment Status
Date: 2026-10-18
Status: Six-phase implementation reported complete against documented acceptance criteria; device/runtime qualification, auth-lifecycle review, and transport request-path coverage remain open
Historical Review Report: `plans/261018-1643-android-core-flow-refactor/code-review-report.md`
Current PM Adjudication: `plans/reports/project-manager-261018-1643-android-core-flow-refactor.md` (2026-10-18; reflects current post-remediation source)

### Current assessment
- Current `DamHopperMobileApp.kt` source includes corrections for prior high findings: one-shot startup auto-advance, active-profile synchronization, clearing old repositories before reconstruction, generation-keyed reconstruction, and `CancellationException` propagation. Source-reviewed; no dedicated Compose regression test for these interactions was identified.
- Core-flow transport gates are source-present for REST Bearer headers, WebSocket query tokens, and SSE Bearer headers: only HTTPS/WSS or recognized loopback targets receive tokens. Main reports `ApiClientTest.testCleartextNonLoopbackBlocksBearerToken` green; the current test observes a loopback HTTP REST request and checks remote HTTP through the policy helper, while WebSocket coverage inspects URL construction. `HostResourceSseTest` observes a loopback request but its remote-host assertion evaluates the policy expression directly, not the request path. No request-level non-loopback HTTP assertion or HTTPS retention assertion for SSE was identified.
- `HostResourceSseClient` is wired by the retained `WorkbenchScreen` resource-stream setup, though it is outside the new guided mobile flow. `--no-auth` remains loopback-only per README. Debug network security permits cleartext to every host; authenticated Wi-Fi use requires HTTPS; release remains TLS-only.
- Other review follow-ups: `ProfileLoginScreen.onDispose` synchronously increments `operationGeneration`, and the observed login path checks it before `applyAuthenticatedSession`; atomicity/commit-race behavior is unverified. It launches `attemptTracker.invalidate()` in the composition scope, which may already be cancelled; no focused lifecycle regression test was identified. `MainActivity` retains navigation with `remember`; `cleanAnsiCodes()` constructs three regexes per call.
- The terminal is a bounded ANSI-stripping console, not full terminal-emulator parity. No Android device/runtime journey or Activity-recreation evidence is claimed.

These are follow-ups/qualification boundaries, not passing test claims. The implementation-plan closeout is complete; device qualification and the listed lifecycle and transport evidence remain open.
