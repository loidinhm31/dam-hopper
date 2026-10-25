# Android notifications / Settings — Cycle 1 re-review

## Score and assessment
**6/10 — changes required.** Several narrow fixes are present, but notification liveness and exact mounted activation remain broken. Temporary mutation invalidation was replaced with permanent generation retirement. The claim that all ten original findings are resolved is not supported by current source.

**Critical issues:** no confirmed critical exploitable vulnerability in reviewed scope. Not security certification or release/device approval.

## Scope and evidence
- Read-only re-review of the ten findings in `plans/reports/code-reviewer-261025-0347-android-notifications-settings.md`, with cross-boundary inspection of current implementation and associated tests. Inventory: 73 tracked modified files, plus untracked implementation/tests/plans. No whole-repository audit; not every changed test line reviewed.
- Primary production paths, relative to `native/android-app/`:
  - `androidApp/src/main/kotlin/dev/damhopper/nativeapp/`: `MainActivity.kt`; `platform/workspace/NativeWorkspaceViewModel.kt`; `platform/notifications/AndroidNotificationSink.kt`, `AndroidNotificationAudio.kt`; `platform/storage/AndroidPreferencesStore.kt`, `AndroidCommandHistoryStore.kt`; `platform/editor/AndroidEditorSurface.kt`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`: `core/ownership/ConnectionRegistry.kt`, `core/transport/ApiClient.kt`, `core/notifications/NotificationCoordinator.kt`; `features/profiles/ProfileRepository.kt`; `features/settings/SettingsRepository.kt`, `SettingsPorts.kt`, `SettingsDiagnostics.kt`, `AgentIntegrationRepository.kt`, `AgentIntegrationView.kt`, `GlobalSettingsView.kt`, `RemoteConfigEditor.kt`, `RemoteConfigScreen.kt`, `SettingsHostView.kt`, `HardwareShortcutRegistry.kt`; `features/terminal/AgentStatusReducer.kt`, `AgentAttentionAdmission.kt`; `features/workspace/ProjectWorkspaceState.kt`; `features/files/FileTreeState.kt`, `SearchRepository.kt`; `features/editor/NativeTextEditorView.kt`; `features/host/HostControlScreens.kt`; `ui/flow/AppFlowNavigation.kt`; `ui/screens/DamHopperMobileApp.kt`, `ProjectWorkspaceScreen.kt`, `ProjectTerminalScreen.kt`, `ProjectTerminalState.kt`, `WorkspaceSearchView.kt`.
- Other changed consumer/host/theme code inspected through change inventory/diff; findings below rely on current source reads, not prior reviewer conclusions.
- Supporting evidence: README, PDR, code standards, feature plan, prior review and triage. Approximate current source inspected: 5,000+ lines, plus supporting diffs/docs/tests.
- Tests sampled: retained retirement/readiness helpers, coordinator, settings/config editor tests. Targeted search found no matches for direct `PublishedSettingsBindings`, `NotificationRouteResolver`, `TargetServicesHolder`, or `initialSessionId` regression coverage in Android unit/shared JVM tests. This search is not proof that all behavioral coverage is absent.
- Production/tests/plans unchanged; only this report created. Main retains plan/task and verification ownership.

Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.

## Warnings — High

### R1. Ordinary mutations now permanently disable notifications for the current generation
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:880-884,1013-1018` injects `coordinator.retire(ref)` into Settings and integration mutations. `S/features/settings/RemoteConfigEditor.kt:257-268` reaches the same callback through target authority. `S/core/notifications/NotificationCoordinator.kt:179-184` permanently advances `retiredGeneration`; `198-199` rejects every subsequent event of that generation or older. No fresh readiness publication clears this watermark.
- Failure: deliver an alert; save an agent path, save config, or install/uninstall integration; cleanup completes and readiness can return VERIFIED, but every new attention event stays silent until a new connection generation is created. Even a subsequently rejected/not-submitted mutation can leave notifications retired.
- Impact: core notification liveness regression, not a complete repair of original W1. The previous report explicitly warned against using permanent retirement for ordinary edits.
- Correction: provide one awaited **non-retiring** invalidation+cleanup operation for mutations. Reserve `retire` and its watermark for actual owner retirement. Preserve serialized cleanup, all-step attempts and failure propagation; do not erase retirement watermarks as a recovery shortcut.
- Regression: alert → edit/install → old effects removed → fresh verification → a genuinely new attention event delivers on the **same generation**.
- Confidence: high; direct predicate/callback trace, not runtime reproduced.

### R2. Exact notification activation still depends on initialization/remount, not an activation event
- Evidence: `S/ui/screens/ProjectTerminalScreen.kt:565-571` now favors `initialSessionId`, but only inside `refreshSessions()`. Its initial stream/setup effect remains keyed solely by repository/connection at `589-637`; changing the requested session does not rerun it. `S/ui/screens/ProjectWorkspaceScreen.kt:133-137` selects Terminal only when `initialSessionId` changes. `S/ui/screens/DamHopperMobileApp.kt:592-600` supplies the persistent flow selection as that initialization parameter.
- Failure A: with Terminal mounted and T1 selected, click an alert for existing T2 in the same workspace. Navigation updates, but no session-ID-keyed activation selects T2; T1 remains the live retained selection until another refresh.
- Failure B: with T1 selected, switch to Files, then click an alert for T1. The ID has not changed, so the panel effect does not rerun; Files stays visible.
- Regression introduced by the panel workaround: recreating/remounting a workspace with a non-null remembered session ID forces Terminal, overriding the retained Files/Editor panel even without a notification click.
- Correction: separate persistent selection from a consume-once, validated activation request with its own identity. Apply exact session selection and panel activation to the retained workspace; do not continually prefer an initialization hint or require unrelated network refresh.
- Regressions: mounted T1→T2; Files/Editor→already-selected T1; repeated clicks for the same terminal; rotation with Files/Editor retained.
- Confidence: high; mounted producer/consumer trace, not device reproduced.

### R3. Busy-flow filtering is not a mutation-transition readiness fence
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:955-961` filters only the agent-path revision collector by Settings busy state. Reconnect (`555-559`) and explicit target revalidation (`1169-1170`) still schedule readiness reads. Provider publication/effect checks (`175-193`) contain no pending/failed mutation predicate. Full-config mutation invalidates at `S/features/settings/RemoteConfigEditor.kt:258` and settles at `278-286`, with no corresponding settled-refresh hook; the `onTargetRevalidated` callback is wired to maintenance cache-clear, not these saves.
- Concrete interleaving: path mutation advances provider revision through invalidation; hold its PATCH before server application; reconnect/revalidate starts a refresh capturing that new revision; it reads old config/status; provider accepts VERIFIED because revision and registry owner still match. The path busy collector does not participate in that publication.
- Current consequence: stale VERIFIED readiness/display during a revoked transition. **R1 currently masks notification delivery from this state**; this report does not claim alerts presently resume mid-edit. Replacing permanent retirement alone would expose the effect-admission race. Separately, config saves lack deterministic fresh verification after settling.
- Correction: gate exact-owner readiness publication/effects across the mutation transition, including cancellation/Unknown/cleanup failure; arrange fresh verification only after settlement. Make all refresh entry points obey the same authority, not another collector-local filter.
- Regressions: held mutation plus reconnect/revalidation; full config save settling; cleanup failure; cancellation; no mutation retries.
- Confidence: high for missing gate/hook and source-derived interleaving; not runtime reproduced.

## Warnings — Medium

### R4. Original confirmation-authority finding remains only partially addressed
- Integration: `S/features/settings/AgentIntegrationView.kt:71,100-118` still retains only an action enum, reads repository/paths at confirmation, then `AgentIntegrationRepository.kt:162` captures fresh authority. Same composition can survive target replacement because `SettingsHostView.kt:140-145` is not keyed by target owner.
- Force suspend: `S/features/host/HostControlScreens.kt:100,416,430-448` retains only a Boolean dialog flag and captures its ticket on confirmation. `SettingsHostView.kt:121-127` can replace the controller without owner-keyed dialog disposal.
- Global removal: capture-at-open was added (`GlobalSettingsView.kt:183-186`), but the captured ticket is nullable and `75-82` falls back to a fresh capture when it is null. A failed opening capture must not become permission to reauthorize later.
- Failure/impact: a surviving dialog can execute against a replacement Settings owner/path, or an A→B→A selection can be freshly authorized instead of rejected. For force suspend, the wrong intent can affect a remote host. Global's non-null captured-ticket path is an improvement, not a complete fail-closed fix.
- Correction: before presenting each dialog capture a **non-null** operation/ticket, exact owner, action and path payload; use those same values at confirmation. Reject/dismiss stale or failed captures without recapture.
- Confidence: high for missing capture/disposal and nullable fallback; runtime race not reproduced.

### R5. Actual root shortcut dispatch does not supply the input gates its registry requires
- Evidence: `S/ui/screens/DamHopperMobileApp.kt:483-493` hardcodes `composing = false`; `editableFocused` means only `searchMode != null`, not actual command/editor/text-field focus. `HardwareShortcutRegistry.kt:118-134` correctly depends on these inputs to suppress DoubleShift in editable input and chords during IME composition.
- Impact: pure registry tests cannot establish the mounted contract. Delivered key events can arm filename search while another editable field is focused or dispatch during composition because the root labels the event eligible.
- Correction: wire actual editable-focus/composition state from the input hosts into the existing registry; retain normal chord handling where permitted. Do not add a second shortcut dispatcher.
- Regression: physical Shift down/up twice in command draft/editor and delivered chord during active composition; ordinary workspace DoubleShift still works.
- Confidence: high for false/missing gate inputs; platform event-delivery behavior unverified.

### R6. Cover input suspension is not reapplied when the active workspace changes
- Evidence: `S/ui/screens/DamHopperMobileApp.kt:361-367` modifies `activeWorkspaceState` from an effect keyed only by `settingsOpen, masked`. A newly selected workspace while these values stay unchanged is not suspended. New workspace input suspension defaults false (`S/features/workspace/ProjectWorkspaceState.kt:334-345`), and terminal dispatch relies on that retained flag (`S/ui/screens/ProjectTerminalState.kt:167-173`; `ProjectWorkspaceScreen.kt:257-259`).
- Scenario: while Cognito remains active, an OS notification routes to a different project/worktree and creates/activates another workspace. The root mask stays active, so its effect does not rerun; the new workspace controller gate can remain open under the mask.
- Impact: loses required controller/platform defense in depth. The outer overlay may still consume user input; no actual keystroke leak or privacy exploit is claimed here.
- Correction: include workspace identity in cover synchronization and make final dispatch predicates observe current cover authority; do not rely exclusively on a later effect for the hard input boundary.
- Regression: masked notification route to another workspace; workspace replacement while Settings is open; dismissal restores only the currently eligible surface.
- Confidence: high for dependency/default mismatch; end-to-end input delivery unverified.

## Original findings disposition
| Original | Source-level disposition |
|---|---|
| W1 cleanup | Cleanup now reached, but replaced by permanent retirement regression R1; not closed. |
| W2 transition/readiness | Partial busy filtering only; R3 remains. |
| W3 auth/client publication | Narrow race addressed: fresh post-suspension auth plus admission-commit check at VM `420-425`. Held-lock regression still needed. |
| W4 exact terminal activation | Not closed; R2. |
| W5 worktree routing | Narrow mismatch addressed: authoritative server session worktree accepted when target omitted it, explicit target mismatch still rejected (`693-700`). |
| W6 first install | Install buttons no longer require can-enable (`AgentIntegrationView.kt:215,232`). Source-level fix present. |
| W7 reset completion | Self-invalidating revision bump removed (`SettingsRepository.kt:911-924`); currency check retained by UI. Source-level fix present. |
| W8 dirty Config remount | Initial load only when empty, otherwise conflict-aware refresh (`RemoteConfigScreen.kt:64-69`). Source-level fix present. |
| W9 dialog authority | Partial Global fix only; R4 remains. |
| W10 collector retention | Job stored and canceled on owner retirement (`VM:990-1026`). Source-level fix present. |

Source-level correction is not a passing mounted/runtime regression.

## Positive observations
- Request-local admission, redirect prohibition, single dispatch and post-body owner checks are explicit; no retry/shim added for mutations.
- Registry retirement revokes before drain, awaits barriers, latches failure and preserves explicit recovery. Identity publication now checks fresh authenticated account inside admission.
- Notification payload/public presentation uses generic text, private visibility, immutable PendingIntents and profile-qualified identity; coordinator feed/post tracking is bounded.
- Diagnostics use a typed allowlist rather than exporting user paths/commands/tokens; command history is opt-in and backup-excluded.
- Config refresh preserves dirty drafts/conflict state; remote path/worktree resolution avoids ambient-root fallback.
- Reactive consumers reuse existing repositories and preserve document identity/undo instead of rebuilding editors for preference changes.

## Suggestions — architecture, performance, YAGNI/KISS/DRY
1. Correct existing lifecycle/authority seams first. Reuse one temporary revocation boundary and one retained activation API; no new runtime, scheduler, retry framework or compatibility path.
2. Add boundary regressions listed above before relying on helper unit tests. Actual MainActivity, notification click, rotation, permission/channel/audio, two-profile and live-server checks remain separate.
3. Remove dead `canInstall` at `AgentIntegrationView.kt:222`; its old readiness-dependent value is unused after the button fix.
4. `AndroidCommandHistoryStore.kt:183-192` reads the entire file before validating it; bound the input before allocation to match the documented 4 MiB store cap, including corrupt files. Keep this local fix simple.
5. `WorkspaceSearchView.kt:62-103,140-146` retains clickable prior-query hits through debounce/new requests. Hide/disable or explicitly label results whose query differs, rather than claiming all displayed hits are query-fenced. No speculative cancellation-insensitive transport bug asserted.
6. VM remains 1,264 lines and combines readiness, runtime hosting, route validation, document workflow and target services. After correctness, extract along these real lifetime boundaries only; avoid a generic service framework or unrelated formatting churn.

## Verification and remaining evidence
- **No builds, tests, lint, emulator/device or live-server checks run by this reviewer.** Main owns verification; prior-cycle receipts were not reused as proof for these fixes.
- Main should run repository-supported shared JVM and Android unit tasks after corrections, plus the named mounted/boundary regressions. Relevant existing tasks: `pnpm native-app:test`, `pnpm native-app:test:android`.
- Test coverage percentage unavailable; lint count unknown; Kotlin compile/build status not established in this re-review. TypeScript coverage metric not applicable to this Kotlin-focused scope.
- Findings are static causal traces unless expressly described otherwise. Phase05 OS/server/physical-device/visual qualification remains open; review does not grant release readiness.

## Unresolved questions
No missing product decision blocks these corrections. Missing evidence: current validation receipts and actual mounted/runtime regressions for the corrected flows.
