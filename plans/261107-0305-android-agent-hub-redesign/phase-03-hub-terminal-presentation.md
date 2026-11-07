# P03 — Build native Hub navigator and terminal presentation

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/android-ui-ux-design.md](reports/android-ui-ux-design.md) | [reports/design-dispositions.md](reports/design-dispositions.md) | [reports/android-evidence.md](reports/android-evidence.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 22h.
- Owner: Feature03-Hub. Parallelization group: `G-A`.
- Prerequisite task IDs: `cutover-settings-patches`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
The current Agents sidebar already observes attached runtimes without connecting saved profiles; preserve that admission. Project selection with zero PTYs is a meaningful UI state. Agent availability is not terminal/process success. Designer Launch Again and fixed viewport row claims are rejected by C6/C8.

## Requirements
Functional: presentation accepts settled Hub snapshots/actions, renders project/worktree owner-qualified groups and OMP/Claude/Codex inventory; Open Project supports zero-session refs without creating PTYs. Show loaded/loading/disconnected/unavailable/unsupported honestly. Hide/reopen exact views, pins retained while owner unavailable, strict workspace-dismiss predicate includes hidden live, restartPending and admitted/unknown creates. All four capabilities directly reachable; global Settings/feed actions remain visible.
Nonfunctional: single content host, no registry connection/keepalive. One rail or modal; >=48dp sibling controls with readable semantics/contrast. Existing retained controller/replay/input gating, font/pinch and <=2-row accessory controls survive presentation changes.

## Architecture and ports
AgentHubNavigator composes existing TerminalAgentsSidebar components with project/worktree groups; it is a view, not another inventory coordinator. ProjectListScreen becomes reusable Open Project picker without owning flow. Two-row chrome is rendered by settled Hub host presentation; current screen may expose slots/callbacks for P07 without mounting another root. Width admission = usable width after insets/hinge minus 280dp >=360dp; compact navigation uses modal cover. Only one navigation rail at a time; P07 supplies Files rail exclusivity.
ProjectTerminalState owns qualified hidden/pinned/logical selections and create settlement under retained owner. View key includes logical owner and exact PTY identity; selection never falls back to first raw ID. End result shows dispatch/ack/refusal/unknown until inventory observes final state. Unknown launch offers Check status + explanation only. Input eligibility combines presentation cover, foreground, current generation/socket, replay complete, matching instance and non-destroying state; terminal wire remains raw ID.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubNavigator.kt`

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebar.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsFilterMenu.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsGroupRow.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPresentation.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGrouping.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/DefaultTerminalAgentsProjector.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsSidebarModels.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGroupingTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjectionTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsFilterTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/TerminalAgentsSidebarTest.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NativeAccessoryKeyboard.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentation.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicy.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreenBindingTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueueBindingTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicyTest.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### present-hub-navigator
1. Compose project/worktree rows from observed session groups plus explicit zero-session open refs; badges disambiguate profiles. Open Project does not mutate workspace root or create sessions.
2. Render independent selectable row and sibling >=48dp create/dismiss controls; dismissal enabled only with authoritative loaded inventory and zero deduplicated live/hidden/restartPending/admitted-or-unknown-create refs.
3. Reuse agent grouping/filter storage/status semantics, Settings target B action and exact activation callback. Preserve pinned/selected rows while owner unavailable; prune only from authoritative owner inventory.
4. Apply one width-admitted 280dp rail or compact modal, accessibility roles and status labels; author semantic cases for zero-session/unsupported/disconnected/multi-profile data without changing root files.

### present-terminal-lifetime
1. Replace ambiguous close affordance with Cancel, Close View (local only), End Session/Cancel Restart dialog; initial focus Cancel, pinned close refused until explicit unpin.
2. Hide qualified view without deleting remote metadata, expose explicit hidden inventory reopen, preserve remote counts and selected controllers. Show missing termination protocol as disabled destructive action, not disabled local close.
3. Display original-target create/end states and Check status explanation; no Launch Again, force clear, TTL, blind same-ID replay or auto replacement on rotation/background.
4. Implement two-row direct capability chrome plus scrollable session controls and measured viewport: Hterminal=HusableAfterInsetsIme-HactualChrome-Haccessory-Hbanners; rows=floor(Hterminal/measuredLineHeight). Collapse optional banners/accessories at constrained heights, never force smaller font or promise fixed VT rows.
5. Reuse replay/controller attach gate, cover predicate and hardware/accessory dispatch; queued/live input stops immediately for hidden/nonterminal/covered/background surfaces. Author local-close-zero-request, hidden-reopen, refused-end, covered-key and viewport policy regressions.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "present-hub-navigator",
    "title": "Render owner-qualified project and agent navigator",
    "blocked_by": [
      "cutover-settings-patches"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/AgentHubNavigator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebar.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsFilterMenu.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsGroupRow.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPresentation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGrouping.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/DefaultTerminalAgentsProjector.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsSidebarModels.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGroupingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjectionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsFilterTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/TerminalAgentsSidebarTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Open zero-session projects/worktrees coexist with real PTY groups without implicit spawn/connect.",
      "Unavailable owners keep pins/selections; dismiss fails closed and every agent action has an exact owner-qualified target."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Mount the actual production navigator in the already-owned Android component host, drive zero-session/open/unavailable/dismiss actions and inspect visible labels, modal/rail and exact qualified callback targets. Separately record interactive component smoke; a test assertion run alone does not count. No future MainActivity Hub mount required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/present-hub-navigator-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "present-terminal-lifetime",
    "title": "Present local hide, guarded End and uncertain launch",
    "blocked_by": [
      "present-hub-navigator",
      "present-settings-scopes",
      "present-bounded-attention-feed",
      "present-codebase-browser"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NativeAccessoryKeyboard.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicy.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreenBindingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueueBindingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalConnectionPresentationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicyTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Local close never mutates remote PTY; explicit reopen reuses exact live inventory identity.",
      "Pending/unknown create and termination acknowledgements are truthful; replacement never follows uncertainty.",
      "Direct navigation remains reachable with IME; input blocked on every covered/hidden surface."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use the actual terminal component/current host with owned live PTY: hide/reopen, covered hardware/accessory input, guarded End refusal and IME-constrained viewport; observe stream/request bytes and reachable controls. No future Hub root required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/present-terminal-lifetime-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:present-hub-navigator --> Render owner-qualified project and agent navigator
- [ ] <!-- evcrate-task:present-terminal-lifetime --> Present local hide, guarded End and uncertain launch

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: component success cannot certify final root/device integration: task-local navigator/terminal smoke is required now; P07 mounts the root and P08 separately qualifies the full MainActivity/device matrix. Security: hidden terminal receives no queued/hardware/accessory bytes; no command preview persisted with unknown intent. Failure: unsupported/disconnected rows remain visible but non-authoritative. Rollback: withdraw P07 wiring before reverting this slice, retaining unknown intent and remote sessions.

## Downstream barrier
present-hub-navigator joins stopped W05; present-terminal-lifetime is blocked by every W05 task and joins stopped W06. Coordinator checks/reviews/evidence-completes the whole stopped wave before any next-wave admission. Both Hub tasks completed before P07. Feature03 cannot write peer files/shared models/ports/root/ViewModel/Activity/theme; P07 receives settled callbacks and cover inputs, not another runtime.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
