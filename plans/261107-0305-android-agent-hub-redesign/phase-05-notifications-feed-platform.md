# P05 — Retain bounded attention feed and private Android delivery

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/android-evidence.md](reports/android-evidence.md) | [reports/android-ui-ux-design.md](reports/android-ui-ux-design.md) | [reports/design-dispositions.md](reports/design-dispositions.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 16h.
- Owner: Feature05-Notifications. Parallelization group: `G-A`.
- Prerequisite task IDs: `cutover-settings-patches`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
Existing accepted-live reducer/high-water suppresses snapshot and reconnect catch-up; coordinator bounds are 50 history and 3 transients. MainActivity already consumes explicit click extras once per process and the retained route resolver validates exact socket/agent identity. Routing ownership remains P07, not a new notification router.

## Requirements
Functional: globally reachable inline feed and transients; distinguish attention from status/exit/success; preserve read state and owner-scoped cancellation. Activation consumes click exactly once and revalidates pre/post every suspension/dirty confirmation through existing route port. Retain 3 existing channels, explicit user-only API33+ permission, API29 NOT_REQUIRED, denied/blocked keeps feed. Generic lockscreen public version and Cognito coverage.
Nonfunctional: bounded history/transients, no FCM/service/always-on/background keepalive promise, no snapshot replay or second reducer/runtime. No new channel or permission dependency. Cold/stale target refuses in place, not fallback or login-then-auto-run.

## Architecture and ports
NotificationCoordinator remains feed/attention coordinator; existing AgentStatusReducer supplies accepted-live events and numeric agent epoch. Do not substitute PTY UUID for that epoch. Feed actions submit exact NotificationTarget through the settled port, with read-mark and route outcome separate. MainActivity intent intake/process-instance consumption and ViewModel resolver remain untouched until P07; this slice only prepares bounded coordinator/platform contracts and UI. AndroidNotificationPlatform owns actual channel/permission/post/cancel behavior; retained port attachment remains Activity lifecycle responsibility.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- None.

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSink.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NotificationCenter.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/NotificationsView.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSinkTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducerTest.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationPlatform.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationAudio.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationAudioTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidNotificationDeliveryTest.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### present-bounded-attention-feed
1. Reuse 50 history/3 transient admission and silent snapshot/high-water; add feed visibility/activation state without creating attention from inventory/status transitions. Retired owner cancellation cannot erase another owner.
2. Keep stale/unsupported/disconnected/cold route notices visible without navigating; read-mark is independent of route success. Callback transports full exact owner/account/socket/agent/terminal identity, never raw-ID replacement.
3. Keep feed/transients in privacy cover hierarchy and expose notification preferences/permission status in NotificationsView through existing Settings APIs; no shared preference schema edits.
4. Author repeated snapshot/high-water replay, burst bounds, epoch replacement, owner cancellation, duplicate/cold activation and denied-but-feed-works regressions; no reducer shortcuts that infer task success.

### preserve-private-platform-delivery
1. Retain channel_terminal_attention, channel_transfers and channel_idle_suspend; API33+ prompt only from explicit Enable system notifications CTA, API29 no runtime request. Report denied/app/channel blocked distinctly.
2. Preserve immutable explicit intents and generic public lockscreen fallback with VISIBILITY_PRIVATE; no terminal text, project path, command or credential in public version/logging.
3. Cancel only notifications owned by the retiring runtime; background follows existing lifecycle policy, no foreground service/FCM/keepalive addition. Activity intake/route resolver wiring stays for P07.
4. Author permission/channel/private public-version and owner-cancel platform cases; extend existing device delivery test for actual OS settings transitions and duplicated/stale clicks.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "present-bounded-attention-feed",
    "title": "Render bounded notification feed without catch-up replay",
    "blocked_by": [
      "cutover-settings-patches"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSink.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NotificationCenter.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/NotificationsView.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSinkTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducerTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "No notification on initial/reconnect snapshot; accepted-live attention bounded to 50 history/3 transients.",
      "Component exact-route callback rejects stale/cold/duplicate activation without retargeting; read mark and owner cancellation remain isolated. Full MainActivity once-only intake is P07/P08, not this task completion."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Drive actual feed/coordinator production component with accepted-live input and reconnect snapshot; observe silent baseline, bounded history/transients, read-mark separate from exact route callback, and stale/duplicate refusal. This is component event/UI smoke, not final OS click-routing acceptance.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/present-bounded-attention-feed-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "preserve-private-platform-delivery",
    "title": "Maintain private channels and explicit Android permission flow",
    "blocked_by": [
      "present-hub-navigator",
      "present-settings-scopes",
      "present-bounded-attention-feed",
      "present-codebase-browser"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationPlatform.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationAudio.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationAudioTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidNotificationDeliveryTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Only explicit user action requests API33+ permission; denied delivery leaves inbox available.",
      "Three existing channels/privacy boundaries preserved; cold/retired owner cannot auto-route."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "On a ready Android device use current platform/component entry to Enable/deny and post/cancel an owned private notification; observe actual OS channel/public fallback and owner-scoped cancellation. Missing device blocks task smoke; full API29/API33+ and MainActivity matrix remains P08.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/preserve-private-platform-delivery-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:present-bounded-attention-feed --> Render bounded notification feed without catch-up replay
- [ ] <!-- evcrate-task:preserve-private-platform-delivery --> Maintain private channels and explicit Android permission flow

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: unit delivery doubles cannot establish OS lockscreen or background behavior; P08 requires real platform evidence. Privacy: generic public version and covered in-app feed; do not persist terminal content in notification history. Failure: denied/channel-blocked/disconnected state is honest; no background delivery guarantee. Rollback: withdraw P07 callbacks then revert views/platform changes without clearing remote sessions or another owner's notifications.

## Downstream barrier
present-bounded-attention-feed joins W05 and preserve-private-platform-delivery waits for all W05 completions then joins W06. Coordinator checks/reviews the stopped wave and evidence-completes its tasks before dependent admission; device required for actual platform smoke remains a truthful blocker. P07 receives completed component contracts and alone wires MainActivity once-only intake/post-consent routing. No SettingsRepository/SettingsModels/reducer-production/root/AppFlow/Activity/ViewModel/theme writes.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
