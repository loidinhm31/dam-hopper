# Android notifications / Settings — Cycle 3 final re-review

## Score
**6.5/10 — changes required.** Several local fixes are present, but mutation-lifetime fencing, integration operation authority and exact retained-workspace activation remain incomplete.

## Scope and evidence
- Read-only cross-boundary re-review of the eight named fixes and their runtime, navigation, transport, notification, Settings, storage and input producers/consumers. Read feature overview/contracts, preceding Cycle 2 report, project requirements and Kotlin standards. This is not a line-by-line audit of every file in the larger working tree.
- Principal reviewed files: `NativeWorkspaceViewModel.kt`, `DamHopperMobileApp.kt`, `ProjectTerminalScreen.kt`, `ProjectTerminalState.kt`, `ProjectWorkspaceState.kt`, `AppFlowNavigation.kt`, `AgentIntegrationView.kt`, `AgentIntegrationRepository.kt`, `RemoteConfigEditor.kt`, `GlobalSettingsView.kt`, `SettingsHostView.kt`, `HostControlScreens.kt`, `IdleConsentController.kt`, `SettingsRepository.kt`, `HardwareShortcutRegistry.kt`, `NotificationCoordinator.kt`, `AndroidNotificationSink.kt`, `AndroidNotificationAudio.kt`, `MainActivity.kt`, `ApiClient.kt`, `AndroidPreferencesStore.kt`, `AndroidCommandHistoryStore.kt`, `SettingsDiagnostics.kt`, `WorkspaceSearchView.kt`, and selected regression tests.
- **Main reports 901 passing tests: 725 shared JVM + 176 Android unit; not independently verified in this review.** No builds, tests, linters, device or live-server checks run. Existing reported results are not disputed or rerun.
- Production, tests and plans unchanged. This report only; no task tracking.

Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.

## Critical issues
**None confirmed in inspected scope.** Not security certification, end-to-end acceptance or release approval.

## Warnings

### W1 — High: pending-mutation fence covers cleanup, not the mutation
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:176-187,194-215,1072-1078`. The callback begins the fence, awaits only `coordinator.invalidateRuntime`, and clears it in `finally`. Actual requests happen after that callback returns: `S/features/settings/SettingsRepository.kt:943-959`, `RemoteConfigEditor.kt:257-279`, `AgentIntegrationRepository.kt:151-175`. Runtime refresh on reconnect and publication remain at `VM:576-586,615-635`.

**Failure [INFERENCE; direct source trace]:** hold a config/path/install request before server application. The fence is already cleared; reconnect/revalidation can read old server state at the advanced revision and publish VERIFIED, admitting fresh notification effects during the unresolved mutation. Cleanup failure/cancellation also clears the fence. The profile-keyed `HashSet` additionally cannot represent overlapping operations: either completion removes the other's marker.

**Correction:** carry exact-owner, operation-qualified transition authority through the actual request and settlement/reconciliation. Serialize it with the existing readiness gate; do not add a second runtime or retry loop. Prevent reads started during the transition from becoming post-transition proof; fresh verification must start after settlement. Cleanup failure and unresolved Unknown/cancellation must not silently reopen admission. Config editor also needs deterministic settled verification: unlike paths/integration, it has no observed settlement-to-refresh hook, a separate liveness gap.

**Required regressions:** held HTTP mutation + reconnect/revalidate; overlapping operations; cleanup failure/cancellation/Unknown; full-config settlement; new same-generation attention after successful fresh verification. Inspected readiness tests cover invalidation and retirement, not this complete mutation lifetime; repository-wide search finds no test use of `beginMutation`/`endMutation`.

**Confidence:** high; interleavings not executed.

### W2 — High: claimed worktree-qualified activation is absent from current lookup
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:1250-1261` passes worktree to navigation, but `workspaceStates.values.firstOrNull` still compares only profile/project at `1257-1259`. Root workspace selection includes worktree and full `WorkspaceFileOwner` at `S/ui/screens/DamHopperMobileApp.kt:295-325`.

**Failure [INFERENCE]:** retain two worktrees of one project. Notification navigation selects the destination worktree, but the callback can select Terminal/session on the other retained state. The destination may remain on Files/Editor; unrelated retained state is changed. Endpoint/account variants are also excluded from the predicate.

**Correction:** activate the full qualified destination workspace under current authority, not the first profile/project match. Preserve destination activation if its state is created only after the route commit.

**Required regressions:** two retained worktrees; destination initially on Editor/Files; unrelated retained workspace unchanged; destination not previously created; routing from Settings and repeated valid terminal selections.

**Confidence:** high; missing predicate directly observed, mounted failure not executed.

### W3 — High: integration confirmations still retarget and recapture authority
**Evidence:** `S/features/settings/AgentIntegrationView.kt:71,100-118,214-231` captures action/path only, then reads the current `integration` repository at confirmation. `SettingsHostView.kt:140-145` does not key that composition by owner. Separately, `AgentIntegrationRepository.kt:151-168` still obtains `authority.guardFor(owner)` after awaited invalidation; `SettingsRepository.kt:722-724` captures a fresh operation there.

**Failures [INFERENCE]:**
1. Open confirmation on A, select B, confirm: the surviving dialog may invoke B's repository using A's captured path. Its new guard legitimately authorizes B, so transport fencing cannot recover the original intent.
2. Start action on A, hold revocation, select B then A, resume: the repository captures replacement A authority and can submit the obsolete action.

**Correction:** retain opening repository/owner, operation revision, action, label and immutable path. Capture the operation before revocation and carry that same authority through request admission; do not recapture at confirmation or after cleanup. Reuse existing operation/guard machinery.

**Required regressions:** dialog A→B and A→B→A; held revocation A→B→A; zero mutation requests for stale intents; unchanged opening authority allows one attempt. Existing `AgentIntegrationRepositoryTest.suspendedCredentialsThenTargetAbaSendsNothing` pauses later, after guard capture; it does not cover held revocation or the dialog.

**Confidence:** high; direct capture/lookup ordering.

### W4 — Medium: IME composition remains hardcoded false
**Evidence:** `S/ui/screens/DamHopperMobileApp.kt:488` still passes `composing = false`. Command focus now has a real producer at `ProjectTerminalScreen.kt:1678` and consumer at root `495`, an improvement. However registry chord suppression depends on `input.composing` at `HardwareShortcutRegistry.kt:134`; editable focus suppresses DoubleShift only (`118-127`). Direct terminal input already holds `TextFieldValue` at `ProjectTerminalScreen.kt:232,1432-1460`, but its composition is not supplied to the registry.

**Failure [INFERENCE]:** an app-delivered shortcut chord during IME composition can still dispatch a global action. No claim that Android delivers OS/IME-reserved keys. Pending DoubleShift also lacks a direct composition-transition reset.

**Correction:** wire actual composition from existing focused input hosts into the one registry and reset pending taps on composition transitions, including transitions between key events. Preserve the command-focus improvement.

**Required regressions:** actual command/search/editor composition; composition starts between Shift taps; delivered shortcut during composition; ordinary non-editable DoubleShift remains functional.

**Confidence:** high for missing integration, device delivery unverified.

### W5 — Medium: force-dialog conflict handling can replace the captured ticket
**Evidence:** normal opening captures a ticket at `S/features/host/HostControlScreens.kt:419-425`, and confirmation uses it at `442-455`. But the conflict effect at `118-123` assigns a newly captured ticket without another opening action. `IdleConsentController.kt:166-177` publishes conflicts after the awaited request; the dialog remains open for nonconfirmed outcomes (`HostControlScreens.kt:457-459`).

**Failure [INFERENCE]:** an admitted request can return a fleet conflict after a target A→B→A transition. The conflict effect recaptures replacement A authority into the surviving dialog, defeating its original stale-selection token. Another confirmation can now submit where the original ticket would reject. This is not an automatic HTTP retry, and mismatched A-ticket/B-controller dispatch remains guarded.

**Correction:** keep the original operation for a continuing dialog; stale/conflicting authority must refuse or close it. Acquiring replacement authority must be a clearly new user-initiated opening. Capture corresponding controller and displayed target context as well.

**Required regression:** hold conflict response across A→B→A; continuing confirmation sends nothing under replacement authority; deliberate new opening can proceed.

**Confidence:** high for ticket replacement; interleaving not executed.

## Named fix disposition
| Area | Current source |
|---|---|
| Pending mutation tracking | Added, but lifetime ends before actual mutation; W1. |
| Settings-close Terminal overwrite | New guard skips origin restoration for TERMINAL + non-null session. Narrow improvement; this predicate is not an explicit navigation cause or proof of exact-origin restoration. |
| Worktree-qualified retained lookup | Not present in current predicate; W2. |
| Config guard before revocation | Present at `RemoteConfigEditor.kt:257-264`; specific ordering defect addressed. |
| Global removal non-null opening ticket | Present; no fallback recapture at confirmation (`GlobalSettingsView.kt:56,75-88,183-188`). |
| Force ticket at opening | Normal path present; conflict effect can replace it, W5. |
| Integration captured action/inputs | Present, but opening repository/operation absent; W3. |
| Terminal command-focus shortcut gate | Present via retained terminal state; composition remains incomplete, W4. |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY
1. Prioritize the authority/lifetime fixes above. Reuse existing SettingsOperation, readiness mutex and full workspace identity; avoid more owner caches, generic frameworks or automatic retries.
2. Remove redundant focus authority: `ProjectWorkspaceState.kt:104-105` adds an unused focus flow while `ProjectTerminalState.kt:102` owns the value actually written by the field. Keep one producer/authority and a simple root gate.
3. Identify Settings closure cause explicitly rather than inferring it from an already-selected terminal session (`DamHopperMobileApp.kt:379-381`). Ordinary Back and explicit destination routing are different contracts. Verify ordinary Back/rotation from Files/Editor separately from notification routing.
4. `WorkspaceSearchView.kt:71-103,140-146` retains clickable old hits during query debounce and the subsequent request. Clear/invalidate them on query change, or bind hits to their producing query and disable opening mismatched results. The comment at `48-50` overstates the current guarantee.
5. Reconcile docs before feature closeout: `docs/code-standards.md:73` still says scroll 1..20; frozen contract is 1..50. `docs/architecture/android-native-client.md:487-494` still presents this increment as not implemented/proposed. Distinguish implemented source from unqualified behavior; preserve honest device/live-server caveats. Docs owner/Main retains this work.
6. After correctness, consider splitting VM by actual lifetime boundaries (runtime/readiness, target services, route activation). Its roughly 1,300-line coordination surface obscures these seams. No unrelated restyling or abstraction needed.

## Positive observations
- Transport admission remains request-local and single-use after credentials/preparation; inspected execute path adds no mutation retry/auth replay and default client disables redirects (`ApiClient.kt:67-74,321-364`).
- Notification presentation is private with a generic public version; PendingIntents are immutable and uniquely data-qualified. Live click validation checks process, owner, endpoint/account, epoch/incarnation and server terminal metadata.
- In-app feed/OS tracking are bounded. Command history is opt-in, owner/project-qualified, backup-excluded and size-prechecked before reading. Diagnostic export uses a typed allowlist rather than exporting secret-bearing free text.
- Preference migration retains corrupt/unknown bytes and recoverable legacy metadata. Local command-history consent remains separate from synchronized preference snapshots.
- Non-retiring readiness invalidation preserves the possibility of same-generation recovery instead of permanently suppressing the runtime.

## Validation and unresolved evidence
- No compile/build/lint/device checks exercised here; type/test coverage percentages and lint counts unavailable. Reported 901 passes are not coverage proof for these transition scenarios.
- Main should validate the named held-mutation, held-revocation, dialog, worktree and mounted input/Settings regressions after corrections, without rerunning merely to reconfirm already-reported results.
- Real MainActivity/server journeys, API29/API33+ permission/channel/audio behavior, physical keyboard/IME, physical-device performance and human visual qualification remain separate evidence gates.
- No unresolved product decision blocks the listed corrections. Runtime manifestations are source-traced inferences, not reproduced failures.
