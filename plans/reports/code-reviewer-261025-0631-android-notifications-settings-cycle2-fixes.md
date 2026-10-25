# Android notifications / Settings — Cycle 2 fixes re-review

## Score
**6.5/10 — changes required.** Non-retiring invalidation and workspace-keyed input suspension are improvements. Remaining readiness-transition, exact-activation and operation-authority defects prevent acceptance.

## Scope and evidence
- Reviewed current working-tree implementations of all eight named fix areas, their immediate producers/consumers, prior review, feature plan/contracts, and selected existing tests. Inspected transport/notification security boundaries as supporting evidence. This is a targeted cross-boundary re-review, not a line-by-line audit of every file in the larger working tree.
- Main paths: `NotificationCoordinator.kt`, `NativeWorkspaceViewModel.kt`, `ProjectWorkspaceScreen.kt`, `ProjectTerminalScreen.kt`, `ProjectTerminalState.kt`, `DamHopperMobileApp.kt`, `AppFlowNavigation.kt`, `GlobalSettingsView.kt`, `AgentIntegrationView.kt`, `AgentIntegrationRepository.kt`, `RemoteConfigEditor.kt`, `SettingsRepository.kt`, `SettingsHostView.kt`, `HostControlScreens.kt`, `HardwareShortcutRegistry.kt`, `AndroidCommandHistoryStore.kt`, `AndroidNotificationSink.kt`, `AndroidNotificationAudio.kt`, `ApiClient.kt`, and supporting contracts/tests/docs.
- **No builds, tests, linters, emulator/device or live-server checks executed.** Assignment leaves validation with Main. Executor-reported 901 passing tests (725 shared JVM + 176 Android unit) accepted as reported; not independently reproduced and not proof of the disputed mounted/transition scenarios.
- Production, tests and plans unchanged; this report only. No task tracking performed.

Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.

## Critical issues
**None confirmed in inspected scope.** Not security certification or release/device approval.

## Warnings

### W1 — High: temporary invalidation still has no mutation-transition fence
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:176-208` checks provider revision and registry availability, but records no pending/failed mutation state. Reconnect schedules verification at `556-566`; refresh captures the already-advanced revision and publishes at `595-615`; explicit target revalidation also refreshes at `1170-1172`. The path collector filter at `954-962` governs only that collector. `S/features/settings/RemoteConfigEditor.kt:258-286` revokes before the request but provides no settled verification callback.

**Failure [INFERENCE, direct source trace]:** hold a path/config/install mutation after revocation and before server application; reconnect or revalidate starts a fresh read under the new revision, sees old server config/status, and republishes VERIFIED. Now that `invalidateRuntime` correctly does not permanently retire the generation, a new attention event can pass effect admission during the unresolved transition. Cleanup failure has no persistent latch either; integration's busy-to-idle collector can schedule another refresh (`VM:1022-1025`). Conversely, a normal full-config save can leave readiness absent indefinitely because it has no deterministic settled refresh.

**Correction:** one exact-owner mutation-transition authority covering all readiness publication/effect paths, not another collector-local busy check. Keep it revoked through pending, cleanup failure and unresolved cancellation/Unknown; settle/reconcile explicitly and then verify fresh authoritative state. Ensure settlement covers early exits. Do not reintroduce permanent retirement or automatic mutation retries.

**Regressions:** held PATCH/install + reconnect/revalidate must remain silent; cleanup failure/cancellation remain fenced; full-config settlement verifies fresh state; successful edit followed by a genuinely new alert delivers on the same generation.

**Confidence:** high for missing gate/hook; interleaving not runtime reproduced.

### W2 — High: exact notification activation remains incomplete across Settings and retained worktrees
**Evidence A:** `S/ui/flow/AppFlowNavigation.kt:204-217` clears Settings then invokes the route commit callback. VM `1227-1232` now selects Terminal/session. But `S/ui/screens/DamHopperMobileApp.kt:371-381` subsequently treats every Settings closure as ordinary return and restores the saved panel whenever the stage matches.

**Failure [INFERENCE]:** open Settings from Files/Editor, then click an OS notification. The explicit Terminal selection can be overwritten by the later origin-restoration effect. Different projects still share the TERMINAL stage, so an unrelated origin panel can also be applied to the destination project.

**Evidence B:** VM `1228-1230` selects `workspaceStates.values.firstOrNull` using only profile/project. The retained map is keyed by full `WorkspaceFileOwner` (`VM:846,1067-1106`), including endpoint/account/worktree. Root selection also includes worktree (`DamHopperMobileApp.kt:296-325`).

**Failure [INFERENCE]:** retain two worktrees of the same project, with the destination on Files/Editor. Notification commit may select the other retained state; the actual destination remains on its old panel/session. Iteration order is not authority.

**Correction:** distinguish ordinary Settings dismissal from explicit destination routing; only ordinary dismissal restores the exact origin. Apply notification activation using the full qualified destination workspace/current authority, never first profile/project match. Preserve the fix removing remount panel forcing.

**Regressions:** notification from Settings opened on Files/Editor, same/different project; two retained worktrees with equal project names; repeated same-terminal click; unrelated retained state unchanged; ordinary Back and rotation preserve the intended panel.

**Confidence:** high for conflicting assignments and incomplete lookup; mounted behavior not device reproduced.

### W3 — High: config/integration actions can acquire replacement authority after revocation suspends
**Evidence:** `S/features/settings/RemoteConfigEditor.kt:257-274` and `AgentIntegrationRepository.kt:151-168` await runtime invalidation before obtaining their request guard. `SettingsRepository.kt:722-724` implements `guardFor(owner)` by capturing a **new** Settings operation. Owner-only currency checks at `717-719` do not retain the original selection revision.

**Failure [INFERENCE]:** start a config save/install on A, pause awaited cleanup, select B then A, resume. Fresh guard capture now uses the replacement A selection revision, permitting the old intent instead of rejecting it. Exact numeric owner equality does not satisfy the A→B→A operation contract.

**Correction:** capture operation-bound authority and immutable payload at action initiation, before revocation or other suspension. Carry the same token through final admission and completion; reject stale revisions rather than recapturing. Reuse existing SettingsOperation/request guard, no second admission framework.

**Regression:** held revocation + A→B→A yields zero outbound mutation requests; unchanged authority still allows exactly one attempt.

**Confidence:** high; direct call ordering and guard implementation inspected.

### W4 — Medium: confirmation authority is still captured at confirmation, or recaptured after a null opening capture
- **Global removal:** `S/features/settings/GlobalSettingsView.kt:56,185-186` still stores a nullable ticket; `75-82` recaptures when the supplied ticket is null. Current source does **not** implement the claimed requirement for a non-null opening ticket. A failed capture can later authorize the old workspace path through a newly available/current repository.
- **Integration:** `AgentIntegrationView.kt:71,100-118` remembers only an action; repository and paths are read at confirmation. `AgentIntegrationRepository.kt:162` then captures fresh authority.
- **Force suspend:** `S/features/host/HostControlScreens.kt:100,416,430-448` remembers only a Boolean; the ticket is captured on confirmation. `SettingsHostView.kt:121-145` supplies changing services without owner-keyed dialog disposal.

**Impact [INFERENCE]:** a surviving confirmation can operate against a replacement target/path or reauthorize after A→B→A. Force suspend affects a remote host, not just local presentation.

**Correction:** require successful non-null capture before opening; retain exact operation, repository/owner, action and path payload until confirmation. Stale/failed capture must dismiss/refuse, never recapture. Key/dispose owner-specific dialogs as an additional UI guard, not a replacement for revision-bound admission.

**Regression:** dialog opened on A, switch to B or A→B→A, confirm: zero request; null opening capture cannot become permission later.

**Confidence:** high for capture/fallback and mounting behavior; race not runtime reproduced.

### W5 — Medium: root shortcut integration still omits command focus and IME composition
**Evidence:** `S/ui/screens/DamHopperMobileApp.kt:485` still hardcodes `composing = false`; `492` considers search and the Editor panel only. The actual command draft field at `ProjectTerminalScreen.kt:1650-1677` provides no root focus/composition state. Registry suppression depends on those inputs (`HardwareShortcutRegistry.kt:118-134`).

**Impact [INFERENCE]:** delivered DoubleShift while typing a terminal command can open filename search; delivered chords during composition are treated as non-composing. The Editor-panel addition addresses one case, not the general input contract. No claim that Android delivers every OS/IME-reserved key.

**Correction:** wire actual editable-focus/composition state from existing input hosts into the one registry. Reset pending DoubleShift on composition/focus transitions. Preserve intentional chord handling where allowed.

**Regressions:** real command/search/editor focus; composition start between Shift taps; delivered chord during composition; ordinary non-editable workspace DoubleShift still works.

**Confidence:** high for missing inputs; physical keyboard/IME delivery unverified.

## Named fix disposition
| Fix area | Current source disposition |
|---|---|
| Non-retiring coordinator invalidation | Present at `NotificationCoordinator.kt:187-194`; does not advance `retiredGeneration`. Same-generation liveness regression test still needed. |
| VM invalidation callback | Both Settings and integration call `coordinator.invalidateRuntime` (`VM:885,1018`); actual retirement remains distinct. |
| Notification Terminal/session activation | Direct selection added (`VM:1227-1232`), but W2 remains. Remount panel-forcing effect absent from inspected workspace screen. |
| Agent-path busy filter | Present (`VM:956-962`); not a global transition fence, W1. |
| Global non-null opening ticket | Not present as claimed; nullable capture/fallback remains, W4. |
| Cover effect keyed by workspace / Editor shortcut gate | Present (`DamHopperMobileApp.kt:361-367,492`); W5 remains for other input hosts/composition. |
| Dead `canInstall` | Removed from inspected integration view. |
| History read-size precheck | Present before `readBytes()` (`AndroidCommandHistoryStore.kt:183-187`); oversized static corrupt file rejected before whole-file allocation. |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY
1. Fix the existing transition/operation/activation seams first. Reuse current provider mutex, SettingsOperation, retained workspace identity and one shortcut registry. Avoid new runtimes, retries, schedulers or generic service frameworks.
2. Add the boundary regressions above. Existing inspected coordinator/readiness/lifetime tests establish useful helper semantics; they do not demonstrate the complete mounted Settings-close/notification route, mutation-refresh or real-input paths.
3. Search results remain clickable for the prior query through debounce/in-flight refresh (`S/ui/screens/WorkspaceSearchView.kt:62-103,140-146`). Clear/disable or explicitly label stale-query results; the documentation currently overstates query-fenced display. Low priority compared with authority/routing defects.
4. Complete planned documentation reconciliation before feature closeout: `docs/code-standards.md:73` and `docs/architecture/android-native-client.md:424` still state scroll bound 1..20; frozen feature contract is 1..50. Architecture `487-489` still labels this increment not implemented. Preserve honest outstanding qualification caveats, but distinguish implemented source from unqualified runtime behavior. Main/docs owner retains these edits.
5. After correctness, extract VM concerns only along actual lifetimes (readiness/runtime, target services, route activation). Its 1,270-line coordination surface makes cross-boundary mistakes hard to see; avoid unrelated restyling or abstraction for its own sake.

## Positive observations
- Non-retiring invalidation is a clean correction, not a watermark-reset compatibility shortcut. Cleanup remains provider-gated and attempts all exact-owner cancellations/audio steps.
- Notification public presentation is generic/private, PendingIntents immutable and owner-qualified; click routing validates process, owner, endpoint/account and terminal incarnation.
- Request-local transport admission remains single-use, after credential/preparation suspension, with redirects disabled and no mutation replay added.
- Feed/OS tracking and history storage have explicit bounds; command history remains opt-in and backup-excluded. No new critical security defect established in inspected boundaries.
- Input suspension now follows workspace replacement instead of only cover Boolean changes; retained Files/Editor panels are no longer unconditionally forced to Terminal on remount.

## Validation / unresolved evidence
- Main should run supported shared JVM/Android unit tasks after corrections, plus the named held-mutation and mounted route/input regressions. Do not rerun merely to reconfirm already reported results.
- Test-coverage percentage unavailable; lint count unknown; no independently exercised compile/build/device result in this review.
- No missing product decision blocks corrections. Missing evidence: actual mutation-transition, confirmation-retargeting, full-workspace notification activation, physical keyboard/IME, API29/API33+ notification/channel/audio and live-server qualification. Review is not release approval.
