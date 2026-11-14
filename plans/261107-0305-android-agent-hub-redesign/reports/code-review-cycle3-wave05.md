# Wave 5 (P03–P06) Code Review — Cycle 3 & User Acceptance Checkpoint

## Review Summary
- **Technical Reviewer Assessment**: **INCORRECT** (Score: **5/10**, Confidence: **0.98**). Static code review only across P03–P06 assigned files; no builds or tests executed by the reviewer. Prior cycle fixes were reported present by static review rather than independently verified.
- **User Authorization & Disposition**: **APPROVED WITH KNOWN UNRESOLVED FINDINGS BY EXPLICIT USER APPROVAL**. Following Cycle 3 review, the user was prompted and explicitly authorized: *"Approve with noted issues"*, admitting the Wave 5 checkpoint strictly under this caveat. User approval accepts the checkpoint for wave progression but does NOT overturn technical findings, does NOT declare features technically qualified or release-ready, and does NOT claim all safety invariants are verified.
- **Findings Count**: 3 Critical Issues (MUST FIX), 7 Warnings (SHOULD FIX), 0 Suggestions.

---

## Executive Summary

Wave 5 delivers the first feature tasks across four parallel streams of the Native Android Agent Hub redesign:
- **P03**: Hub navigator and terminal presentation
- **P04**: Settings scopes, preferences, hardware shortcuts, and config
- **P05**: Attention feed, notifications coordinator, and Android delivery
- **P06**: Codebase browser, filesystem tree state, mutation coordinator, and editor integration

Following three iterative review cycles, selected JVM and Android unit-test classes passed cleanly under Main's execution runner. The static code review in Cycle 3 assessed the implementation as incorrect with a score of 5/10 (3 critical issues, 7 warnings). Under project governance protocols, the user was prompted and explicitly authorized: **"Approve with noted issues"**, admitting Wave 5 completion strictly as **approved with known unresolved findings**. All 10 findings are cataloged in the residual risk ledger for remediation across Wave 6 (W06: second feature tasks), Wave 7 (W07: focused Git), Phase 7 (W08–W09: Root & Lifetime Integration), and Phase 8 (W10–W13: Qualification).

---

## Demonstrated Verification Evidence & Provenance

Execution record reported by Main/Coordinator prior to user sign-off:
- **Shared JVM Compilation**: `:shared:compileKotlinJvm` — PASSED (exit 0)
- **Android Debug Compilation**: `:androidApp:compileDebugKotlin` — PASSED (exit 0)
- **Selected Shared JVM Regressions**: Passing execution across assigned JVM test classes under `:shared:jvmTest` (172 tests passed across assigned classes)
- **Selected Android Unit Regressions**: Passing execution across assigned Android unit test classes under `:androidApp:testDebugUnitTest` (26 tests passed across assigned classes)
- **Scope Boundary**: Passing status is demonstrated for selected JVM and Android unit-test classes and compilation targets only. This does **NOT** claim full test suite execution, instrumentation (`androidTest`) compilation/execution, or end-to-end device qualification.

---

## Review Evolution Across Cycles

| Cycle | Score | Critical | Warnings | Summary of State |
|---|:---:|:---:|:---:|---|
| **Cycle 1** | 4/10 | 3 | 5 | Baseline review on raw workspace target handling, empty `ProjectTargetRef` construction crash, mutation target propagation, and server target schemas. |
| **Cycle 2** | 4/10 | 3 | 8 | Target preservation partially resolved; document opening and mutation dispatch bled to original project; server `type` discriminator mismatch identified; navigator mounting absent in production. |
| **Cycle 3** | 5/10 | 3 | 7 | Static review confirmed prior fixes reported present: project-target preservation, raw-workspace document refusal, server JSON serialization (`type` discriminator), retained `defaultProjectTarget`, production navigator mounting, and feed-click wiring. Remaining gaps isolated to workspace mutation rendering crash, transfer gating, and test/wiring details. |

## Cycle 3 Detailed Findings

### Critical Issues (3) — MUST FIX in Downstream Waves

1. **[P1] Prevent workspace browsing from throwing during rendering**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt:142-144`
   - **Finding**: Every visible explorer row calls `isPathUnresolved()`, which accesses `owner` and its throwing getter when target is Workspace. Switching to Whole Workspace crashes Compose UI during node rendering, even when there are no unresolved mutations.
   - **Remediation**: Guard read-only queries (`isPathUnresolved`) to handle workspace mode safely without invoking the throwing project owner getter.
   - **Target Phase**: Wave 6 (W06 Codebase Refinements) / Phase 7 (W08 Root Integration).

2. **[P1] Gate transfers by the displayed browsing target**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt:447`
   - **Finding**: `canMutateNode` is calculated for the target but left unused; workspace context menus still expose upload and download callbacks. Their `MainActivity` consumers use the original `fileTreeState.target`, meaning a workspace-relative upload can write into the previously selected project instead of the intended location.
   - **Remediation**: Explicitly disable unsupported transfers in workspace context menus or thread the exact browsing target through the dispatch callbacks.
   - **Target Phase**: Wave 6 (W06 Codebase Refinements) / Phase 7 (W08 Root Integration).

3. **[P1] Replace invalid `ProfileId` constructor calls in instrumentation test**
   - **Location**: `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/TerminalAgentsSidebarTest.kt:749-750, 884-885`
   - **Finding**: `ProfileId` is a type alias for `String`. Calling `ProfileId("p1")` is not a valid constructor invocation and fails compilation when Android instrumentation tests (`androidTest`) are executed.
   - **Remediation**: Replace `ProfileId("p1")` invocations with plain string literals `"p1"`.
   - **Target Phase**: Phase 8 (W10–W13 Qualification).

---

### Warnings (7) — SHOULD FIX in Downstream Waves

1. **[P2] Wire Whole Workspace to the rendered explorer state**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt:1012-1015`
   - **Finding**: The filesystem target picker updates `gitWorkspace.fileTreeState`, but `filesContent` renders the separate local `fileTreeState`. Selecting Whole Workspace leaves the visible Files panel browsing its previous project.
   - **Remediation**: Unify `fileTreeState` references or synchronize the rendered explorer state with the active `gitWorkspace.fileTreeState`.
   - **Target Phase**: Phase 7 (W08 Root Integration).

2. **[P2] Identify project folders by qualified registered paths**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt:442-446`
   - **Finding**: The registry matches project names rather than folder identities. Registering `packages/core` as `core-pkg` fails to identify that folder; conversely, a project named `demo` containing a subfolder `demo` incorrectly offers to unregister the current project. Name-as-path assumption also prevents opening nested registered projects from workspace browsing.
   - **Remediation**: Identify registered project folders using canonical, qualified registered path comparisons rather than simple folder basenames.
   - **Target Phase**: Wave 6 (W06 Codebase Refinements).

3. **[P2] Preserve unknown outcomes for transport failures**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt:549-551, 590-592`
   - **Finding**: `ApiClient` uses `ApiRequestError(status = 0)` for network transport failures during execution. Classifying every such exception as `Rejected` enables retry even when registration actually committed on the daemon but the response was dropped.
   - **Remediation**: Classify `status == 0` transport errors as `Unknown` rather than `Rejected` for both mark and unmark handling.
   - **Target Phase**: Wave 6 (W06 Codebase Refinements).

4. **[P2] Fence failed directory completions as well as successful ones**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt:385`
   - **Finding**: Generation checks guard successful publication only. A delayed workspace-listing failure occurring after the user switches back to a project enters the unfenced `catch` block, overwriting the current target's error and loading state.
   - **Remediation**: Apply generation fencing inside the failure/catch branches of both directory-loading flows.
   - **Target Phase**: Wave 6 (W06 Codebase Refinements).

5. **[P2] Forward navigator notices and loading state**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt:325-327`
   - **Finding**: The sidebar host adapter supplies only `agentsUiState`, while `AgentHubNavigator` reads top-level `notice` and `loading`. Production activation refusals, refresh failures, and progress indicators are dropped from view.
   - **Remediation**: Forward top-level `notice` and `loading` states from the coordinator/view model into `AgentHubNavigator`.
   - **Target Phase**: Phase 7 (W08 Root Integration).

6. **[P2] Connect the production Open Project action**
   - **Location**: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt:328-332`
   - **Finding**: The mounted navigator receives empty project callbacks and an empty project roster. The visible Open Project button does nothing, and an active workspace is presented as having no open projects.
   - **Remediation**: Connect the project roster and `onOpenProjectPicker` callback to active workspace navigation handlers.
   - **Target Phase**: Phase 7 (W08 Root Integration).

7. **[P2] Publish coordinator-level notification refusals**
   - **Location**: `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1545-1554`
   - **Finding**: Notice updates only execute inside the routing callback. Missing-record, concurrent-activation, and caught-exception refusals return outside that callback, and `openRecord()` discards their result, leaving the user without feedback.
   - **Remediation**: Publish the final activation refusal result to the user-visible notice flow.
   - **Target Phase**: Phase 7 (W08 Root Integration).

---

## Residual Risk Register & Handoff to Phases 7 & 8

| ID | Category | Description | Target Resolution Phase |
| **RR-W05-01** | Critical / UI Crash | `FileMutationCoordinator.isPathUnresolved()` throws on Workspace target during Compose render | Wave 6 (W06) / Phase 7 (W08) |
| **RR-W05-02** | Critical / Data Integrity | Workspace context-menu transfers lack target gating and bleed into previous project | Wave 6 (W06) / Phase 7 (W08) |
| **RR-W05-03** | Critical / Test Build | `TerminalAgentsSidebarTest` invalid `ProfileId("p1")` String constructor calls in `androidTest` | Phase 8 (W10–W13 Qualification) |
| **RR-W05-04** | Warning / UI State | `WorkbenchScreen` renders local `fileTreeState` while picker updates `gitWorkspace` state | Phase 7 (W08 Root Integration) |
| **RR-W05-05** | Warning / Data Accuracy | Folder-to-project matching uses basename instead of qualified registered path | Wave 6 (W06 Codebase Refinements) |
| **RR-W05-06** | Warning / Network Fault | `ApiRequestError(status = 0)` classified as `Rejected` instead of `Unknown` | Wave 6 (W06 Codebase Refinements) |
| **RR-W05-07** | Warning / Concurrency | Directory listing failure handler lacks generation fencing | Wave 6 (W06 Codebase Refinements) |
| **RR-W05-08** | Warning / UI Feedback | Hub navigator dropped top-level `notice` and `loading` states in sidebar host | Phase 7 (W08 Root Integration) |
| **RR-W05-09** | Warning / UX Flow | Hub navigator `Open Project` action wired to no-op in sidebar host | Phase 7 (W08 Root Integration) |
| **RR-W05-10** | Warning / UX Feedback | Coordinator-level notification refusal outcomes not published to user notice | Phase 7 (W08 Root Integration) |

---

## Open Outstanding Requirements & Downstream Waves

The following requirements remain strictly open and unverified:
1. **Instrumentation (`androidTest`) Compilation**: Android instrumentation compilation is currently blocked by invalid `ProfileId("p1")` calls in `TerminalAgentsSidebarTest.kt` (lines 749-750, 884-885) and must be repaired before running device tests.
2. **Full-Suite Automated Testing**: Comprehensive test execution across all modules and full regression suites, beyond the selected unit-test classes executed in Wave 5.
3. **Downstream Waves W06–W13**: Subsequent feature refinements, focused Git implementation, root integration, and qualification tasks remain pending.
4. **Root Lifecycle Integration (Phase 7 / P07)**: Unifying explorer states, connecting production project roster/pickers, forwarding navigator loading/notice flows, and handling retained activity/lifecycle coordination.
5. **Release Qualification Gates (Phase 8 / P08)**: End-to-end device qualification across API levels, physical hardware, TalkBack/IME, and WebSocket retirement.
---

## Preserved Future Qualification Gates

1. **Device Qualification Suite**: Android API 29 and API 33+ compatibility across phone and tablet form factors.
2. **Accessibility & Input**: TalkBack accessibility tree navigation and IME virtual keyboard integration.
3. **Physical Hardware Verification**: Live physical device validation with authentic network transitions.
4. **WebSocket Retirement**: Verification of complete retirement of legacy WebSocket channels in favor of HTTP/SSE.
5. **Durable Process-Death Recovery**: Verification of uncertain-create reservation barrier persistence across OS process death.
6. **Live Daemon Windows Termination**: Resolution of live daemon HTTP 500 signal-dispatch termination on Windows hosts.

---

## Unresolved Questions
None. User explicitly authorized proceeding with noted issues documented.
