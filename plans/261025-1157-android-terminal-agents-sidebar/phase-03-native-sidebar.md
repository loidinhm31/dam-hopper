# Phase 03 — Native controlled sidebar

Priority P2 · status Complete (administrative; review caveats retained) · owner: UI implementer · execution: G2 branch B (internal serial tasks). No time estimate.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "implement-controlled-agents-sidebar",
    "title": "Render controlled Agents sidebar, filter menu and accessible group rows",
    "blocked_by": [
      "freeze-terminal-agents-contracts"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebar.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsFilterMenu.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsGroupRow.kt"
    ],
    "constraints": [
      "Stateless presentation against Phase01 immutable ports only; no root/VM/reducer/screen/Settings/storage edits.",
      "Do not import Phase02 concrete implementations; no network, local store, navigation or service resolution in UI.",
      "Width/open/input authority and guarded activation belong to Phase04, not a competing component-owned host."
    ],
    "acceptance": [
      "Pinned/sheet content exposes count, canonical multi-status filter, stable status group rows, coverage and Settings/refresh controls.",
      "No observed agents and filter-matches-none are distinct; loading, unavailable/Unsupported and explicit refresh notices are visible.",
      "Callbacks emit group keys/filter/refresh/Settings/dismiss plus actual owned popup visibility only; root retains cover authority, with no direct route/persistence/input-suspension side effect.",
      "Accessible project/profile/status/reason/count/harness/source labels and selected state are not color-only."
    ],
    "verification": [
      "After branch completion, coordinator runs node scripts/run-gradle.mjs :shared:compileKotlinJvm and :androidApp:compileDebugAndroidTestKotlin after integration.",
      "Inspect actual Compose semantics/interaction in author-sidebar-ui-tests; no code-string scans as behavioral proof."
    ]
  },
  {
    "id": "author-sidebar-ui-tests",
    "title": "Add Compose semantics and interaction tests for controlled sidebar content",
    "blocked_by": [
      "implement-controlled-agents-sidebar"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/TerminalAgentsSidebarTest.kt"
    ],
    "constraints": [
      "Create UI-focused instrumentation test only, existing Compose test dependencies; no component/root modification under this task.",
      "Controlled rendered fixture verifies UI behavior only, not MainActivity/server lifecycle qualification.",
      "No code-text/static-scan assertions, fake network passed evidence or test-induced product fallback."
    ],
    "acceptance": [
      "Compose interactions assert callback payloads, multi-select/all behavior, counts and group semantics.",
      "Empty/filtered-empty/loading/error/Unsupported/hook coverage and mixed/unanimous Done are visible in supplied data.",
      "Both mode contents are usable; popup open/close/dispose reports balanced visibility, pending activation cannot double-submit and no child directly lifts root cover."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.TerminalAgentsSidebarTest on an actual device/emulator.",
      "Record device/API, exact test count/outcome and visual/semantic failures; absent hardware is blocked, never a unit-test substitute."
    ]
  }
]
```

- [x] <!-- evcrate-task:implement-controlled-agents-sidebar --> Implement controlled sidebar components
- [x] <!-- evcrate-task:author-sidebar-ui-tests --> Author UI interaction tests

## Context / requirements / architecture
Priority P2; all tasks Complete per user direction. [Contracts](contracts.md#6-retained-service-and-controlled-compose-ports), [evidence](design-evidence.md), [overview](plan.md). G2 branch B was implemented alongside Phase02 after Phase01 freeze. Compose implementation remains subject to open device and live-host qualification gates in Phase05.

## Related files / exact ownership
CREATE three components and one UI instrumentation test listed above, existing source sets; MODIFY none; DELETE none. Component task and test task are sequential, exclusive new files. Phase01 contract files and Phase02 implementations are read-only; neither branch may edit them to make its own guessed API compile. Root/VM/AppFlow/reducer/ProjectWorkspaceScreen/ProjectTerminalScreen/Settings are strictly Phase04-owned. No dependency/build file changes authorized; Compose Android test libraries already installed.

## implement-controlled-agents-sidebar — ordered steps
1. Implement `TerminalAgentsSidebar` exact signature frozen in contracts. Render section heading and eligible terminal count; caller-supplied groups/active instance/filter/loading/notice are sole authoritative inputs. Mode selects content affordances, not window-width inference or a second host.
2. Implement filter menu with canonical seven-status multi-select/All/counts. Emit canonical selection without codec/store dependency. Ephemeral expansion reports actual filter/help modal popup visibility through onPopupVisibilityChanged; closing/disposal clears only this popup source, never another root blocker. Do not mirror authoritative selected filter in remembered state.
3. Implement `TerminalAgentsGroupRow`: project/profile context, primary status/reason, harness labels, member count, unanimous Done only, source and hook coverage accessible. Group-key callback only; integration later resolves current group and cycles exact target. Use stable keys from typed group identity, not concatenated ambiguous IDs.
4. Provide loading, no observed agents, filter-matches-none, unavailable/Unsupported notice, retry and Settings actions. Keep group controls disabled while appropriate activation is pending; refusal remains visible and sheet is not dismissed by a click. Component never treats Deferred as committed.
5. Keep UI composables narrow and maintainable in the three listed files. Use current theme and meaningful semantics/touch targets. No polling coroutine, connection, StateFlow collection or input-suspension setter in these components.

## author-sidebar-ui-tests — ordered steps
1. Build Compose test fixture from Phase01 immutable UI models and deterministic target IDs; no fake claim of integration. Use installed compose UI test APIs under AndroidJUnitRunner.
2. Render pinned and sheet contents with callbacks recording group/filter/refresh/Settings/dismiss payloads. Tap actual controls; assert semantics/count text, canonical multi-select toggles and All reset, not production source tokens.
3. Supply all statuses/reasons/sources, mixed and unanimous Done, two profiles/projects with equal terminal IDs, empty/filtered-empty/loading and explicit errors. Assert selected state, profile differentiation and hook limited-coverage help.
4. Exercise pending activation, no premature dismiss, independent Settings callback and popup visibility open/close/dispose reporting. Integration owns minimal exclusivity, actual topmost Back/Escape, root shortcut suppression and local-modal upstream cover; no component-specific overlay framework or direct input reset.
5. Return test file and exact future device command. Do not run instrumentation mid-branch; integrated coordinator executes after dependencies land.

## Acceptance / checks / parallelization
Component/UI implementation tasks are marked Complete. The user reports 1,048 passing unit/JVM tests and successful `assembleDebug` in Phase05; the connected Compose/UI runs and actual MainActivity/server acceptance remain open. UI fixtures do not replace those device journeys, and Cycle 3 review records gaps in the authored real-host journey coverage.

## Risks / security / failure / rollback
- Color-only status and compressed wide labels: semantic text + stable visible label/reason/count, readable source help; validate compact and wide later.
- Child owns focus/open/lifecycle: would compete with root. Leave host effects and one OR blocker to integration; mode/callbacks are controlled.
- Cached rows are display-only; do not change target on UI click or infer availability from status text.
- Privacy masking must cover sidebar at runtime, not merely terminal. No prompt/command telemetry, added persisted identity or raw session data logs.
- Revert only these new components/tests with their integrated callers; no global shell/navigation redesign.

## Next dependencies / unresolved questions
Phase04 required both G2 branches to be terminal and shared-file writers to release; this update does not independently verify those gates. Phase04 is administratively Complete per user direction. No product questions; device UI execution and full MainActivity/server coverage remain open in Phase05.
