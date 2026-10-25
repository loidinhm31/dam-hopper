## Code Review Summary

### Scope
- Score: **6/10 — changes required**. Provisional implementation assessment, not release/device approval.
- Focus: Android Notifications/Settings Phases 01–04; staged, unstaged and untracked implementation, including retained workspace/editor overlap. Static cross-boundary tracing; associated tests sampled, not every test line audited.
- Reviewed production paths (relative to `native/android-app/`):
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/{transport/ApiClient.kt,ownership/ConnectionRegistry.kt,notifications/NotificationSink.kt,notifications/NotificationCoordinator.kt}`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/`: SettingsModels, RemoteConfigModels, PreferencesStore, SettingsPorts, SettingsRepository, RemoteConfigRepository, RemoteConfigEditor, RemoteConfigScreen, GlobalSettingsView, AgentIntegrationRepository/View, SettingsHostView, SettingsScreens, PreferencesPrivacyView, NotificationsView, MaintenanceView, SettingsConfirmDialogs, SettingsDiagnostics, HardwareShortcutRegistry.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/`: UsageRepository, UsageController, UsageSettingsSection, IdleSuspendRepository, IdleConsentController, HostControlScreens.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/`: AgentAttentionAdmission, AgentStatusReducer, TerminalRepository integration boundaries; supporting TerminalSessionController lifecycle.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/{files/FileRepository.kt,files/FileModels.kt,files/FileTreeState.kt,editor/NativeTextEditorView.kt,workspace/ProjectWorkspaceState.kt}`.
  - `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/`: AppFlowState/Navigation, DamHopperMobileApp, NotificationCenter, ProjectTerminalState/Screen, ProjectWorkspaceScreen, WorkspaceSearchView, NativeAccessoryKeyboard, theme NativeTheme/Type/Color.
  - `androidApp/src/main/kotlin/dev/damhopper/nativeapp/`: MainActivity, platform/workspace/NativeWorkspaceViewModel, platform/lifecycle/AndroidLifecycleCoordinator, platform/editor/AndroidEditorSurface, platform/storage/AndroidPreferencesStore and AndroidCommandHistoryStore, platform/notifications/AndroidNotificationSink/Audio/Platform.
- Tests inspected: registry retirement, settings/remote-editor/agent-integration boundaries, terminal repository integration, preference consumers, notification coordinator, runtime readiness/lifetime, Phase17 preferences, notification delivery instrumentation source; existing test logs inspected.
- Supporting evidence: README, project PDR, code standards, Android architecture, feature plan/contracts; `server/src/api/agent_status.rs` installation/readiness semantics.
- Approximate implementation/supporting source examined: 10,000+ lines; no whole-repository audit.
- Updated plans: **none**. Main-owned plan/task state intentionally untouched. Only this review report created; no production/test changes.

### Overall Assessment
Shared boundaries are substantially stronger: request-local admission receipts, explicit ambiguity, awaited retirement, silent semantic baselines, bounded feeds, privacy-preserving notifications, dirty preference patches and real reactive consumers. Most problems are at integration seams rather than isolated domain units. Existing passing unit tasks do not exercise several broken mounted flows below.

### Critical Issues
- **No confirmed critical exploitable security vulnerability identified in inspected changes.** This is not a security certification. High-priority owner-publication, invalidation and user-data-loss issues remain.

### Warnings — High Priority

Path shorthand below: `S/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `A/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`.

#### W1. Settings mutation invalidation omits notification/audio cleanup
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:874-879,999-1004` injects `readiness.invalidate(ref) {}` into Settings and integration actions. `S/features/settings/SettingsRepository.kt:949-952` and `RemoteConfigEditor.kt:257-258` await that callback. Actual feed/OS/audio cleanup exists only in `S/core/notifications/NotificationCoordinator.kt:179-185,275-314`, reached by retirement, not these edits.
- Failure: post an attention notification, then edit an agent path/config or uninstall its integration. The awaited callback clears readiness only; old history/transients, shade entries and currently playing audio survive completion of the revocation.
- Impact: breaks frozen C3a contract (`contracts.md:185-187`), leaves stale user-visible effects after the operation claims runtime revocation.
- Correction: expose one awaited, exact-owner **non-retiring** invalidation+cleanup path and wire every mutation to it. Do not call permanent `retire` for an ordinary edit: its retired-generation watermark would suppress the still-current generation forever. Attempt all cleanup and propagate failures.
- Confidence: high; direct callback/effect trace. Not device-reproduced.

#### W2. Readiness can re-verify old state while a path mutation is still in flight
- Evidence: `S/features/settings/SettingsRepository.kt:948-975` increments `agentPathsRevision` before invalidation and again after dispatch; `A/platform/workspace/NativeWorkspaceViewModel.kt:947-950` refreshes on **both** emissions. Refresh captures the provider's current revision at `590-609`. Provider `publish` checks revision/current registry owner only (`174-180`), with no mutation-in-progress exclusion. Structured config mutation revokes at `S/features/settings/RemoteConfigEditor.kt:258`, but has no corresponding settled refresh hook in the VM.
- Failure sequence: pause an admitted path PATCH before the server applies it; let the first revision-triggered refresh begin after invalidation. It reads the old server config/status and can publish VERIFIED using the new provider revision. Attention may alert during the supposedly revoked transition. Conversely, a full config save can clear readiness without arranging a settled re-verification, leaving alerts suppressed until another trigger.
- Impact: revocation is a momentary cache clear, not a transition fence; behavior depends on scheduling/network timing.
- Correction: keep publication/effect admission closed for the exact mutation transition until it settles; then perform a fresh revision-qualified verification. An initial revision emission must invalidate, not authorize a refresh that can reopen admission mid-mutation. Cover Confirmed/Unknown/failure/cancellation explicitly without retrying mutations.
- Confidence: high for missing exclusion/refresh wiring; race outcome is static inference pending a held-request regression.

#### W3. Published Settings binding can mix old auth identity with a successor client
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:401-419` reads profile/auth status before suspending in `profiles.getOrCreateApiClient`. It subsequently constructs `SettingsOwner(client.connection, client.normalizedBaseUrl, status.session.user)` from that earlier status. Admission at `421-429` checks the new client generation, not whether the captured account/auth snapshot belongs to it. Profile identity/auth transitions hold their mutex through retirement and publication (`S/features/profiles/ProfileRepository.kt:79-105,161-182`).
- Failure sequence: first binding publication captures authenticated account A; client acquisition waits behind an endpoint/account/auth transition. After that transition, acquisition returns the successor client; binding publication labels it with the old account. The registry accepts the successor generation, so numeric fencing does not reject the mixed identity.
- Impact: violates the exact endpoint/account/generation authority contract used by Settings admission. A LoginRequired successor can also be published using a pre-transition authenticated snapshot.
- Correction: obtain/revalidate profile, auth session and client as one generation-qualified snapshot; recheck after the suspension and immediately before publication. Never relabel a pre-wait account as belonging to the successor. Add a held-profile-lock race test with no existing binding.
- Confidence: high; causal lock/publication trace, not runtime-reproduced.

#### W4. Live notification click does not activate the exact retained terminal
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:1205-1221` commits navigation fields only. `S/ui/screens/DamHopperMobileApp.kt:592-600` passes the requested session as `initialSessionId`. `S/ui/screens/ProjectTerminalScreen.kt:565-569` uses that ID only if the already-selected session is null/missing; its stream/setup effect is keyed by repository/connection (`587-588`), not requested session. `S/ui/screens/ProjectWorkspaceScreen.kt:243-260` continues rendering the retained active panel.
- Failure: while terminal T1 remains selected, click a valid notification for T2 in the same workspace. Flow state changes, but retained terminal selection remains T1. From Files/Editor, the route also does not select the Terminal panel; opening it later still preserves an existing sibling selection.
- Impact: core exact-terminal click criterion fails; user can land on or type into a different terminal than the clicked alert suggests.
- Correction: apply a validated, consume-once activation intent to the retained workspace: select Terminal panel and exact existing T2 after final revalidation, without destroying dirty editor/sidebar state. Do not use an initialization hint as the activation API.
- Confidence: high; end-to-end producer/consumer trace. Mounted regression required.

#### W5. Worktree terminal notifications are refused because their target never records the worktree
- Evidence: `S/core/notifications/NotificationCoordinator.kt:106-118` constructs every semantic target without project/worktree fields (defaults null). `A/platform/workspace/NativeWorkspaceViewModel.kt:687-690` rejects when `target.worktreePath != session.worktreePath`, unconditionally for worktree.
- Failure: an otherwise valid newly generated alert for a session with non-null worktree reaches the resolver with null target worktree and receives “moved to another project or worktree.”
- Impact: exact worktree notification routing is unavailable through the coordinator's production target path.
- Correction: bind authoritative exact-owner project/worktree evidence into the target/activation contract before relying on equality. Preserve owner/worktree validation; do not fix by ambient project/root fallback or simply removing identity checks.
- Confidence: high; direct construction/comparison mismatch.

#### W6. First installation and upgrades are gated on already having a ready installation
- Evidence: `S/features/settings/AgentIntegrationView.kt:215` enables OMP Install only with `paths.ompCanEnable`; Claude uses `claudeCanEnable` at `222,232`. `server/src/api/agent_status.rs:236-246` returns OMP can-enable=false unless extension status is Current; `335-345` returns Claude can-enable=false unless hooks are already Ready.
- Failure: verify a clean server or stale OMP extension. Status is absent/outdated and Install is disabled. Missing/unready Claude hooks similarly cannot be installed through the view.
- Impact: the app can enable alerts only for installations provisioned elsewhere, despite exposing installation/upgrade as delivered functionality.
- Correction: distinguish **install eligibility** (valid remote path/capability/current owner, explicit confirmation) from **alert readiness** (current installed extension/hooks). Keep can-enable gates on notification enabling, not the repair/install action itself.
- Confidence: high; client predicate checked against authoritative server predicate.

#### W7. Confirmed nuclear reset invalidates the token needed for its own navigation
- Evidence: `S/features/settings/SettingsRepository.kt:911-915` increments `targetEditRevision` after a Confirmed reset. `isCurrentLocked` requires the captured edit revision to equal the current revision (`638-644`). `S/features/settings/MaintenanceView.kt:321-325` calls `isCurrent(op)` only after `nuclearReset(op)` returns before invoking `onResetConfirmed`.
- Failure: normal successful reset, with unchanged target/owner: the repository increments the revision, then the UI tests the older operation and rejects its own completion.
- Impact: the server has destroyed PTYs/runtime state, but the app never performs the intended return to workspace selection (`DamHopperMobileApp.kt:680-683`).
- Correction: return/use a confirmed owner+selection-qualified completion decision or a new completion token; preserve protection against an actual target/generation change. Do not remove stale-owner checking wholesale.
- Confidence: high; sequential predicate contradiction.

#### W8. Remounting Config discards unsaved retained configuration edits
- Evidence: `S/features/settings/RemoteConfigScreen.kt:64` always calls `editor.load()` in `LaunchedEffect(editor)`. `RemoteConfigEditor.kt:111-122` overwrites base/draft and clears dirty/conflict. Host content is switched with a `when` (`SettingsHostView.kt:109-145`), while its editor instance is cached by the VM (`979-980,1012-1014`).
- Failure: edit Config, switch to another Host subsection, return; or close/reopen Settings and return to Config. The retained editor remounts and load replaces the unsaved draft with server content.
- Impact: user-authored configuration changes disappear without save/discard confirmation; contradicts the editor's lossless/conflict-aware behavior.
- Correction: initial-load only when no base/draft exists. On subsequent mounts use the existing conflict-aware refresh path, never unconditional load over a dirty draft. Add remount and recreation regressions.
- Confidence: high; direct composition/loader trace. No mounted UI reproduction executed.

### Warnings — Medium Priority

#### W9. Confirmation dialogs capture authority at confirmation, not when opened
- Evidence: `S/features/settings/AgentIntegrationView.kt:71,100-118,215-216` retains only an action enum; confirmation reads current integration/paths and `AgentIntegrationRepository.kt:162` captures a fresh guard then. `GlobalSettingsView.kt:56,75-85,93-104` similarly retains only a workspace row; removal captures the current target ticket at confirmation. Manual force-suspend uses a Boolean dialog and captures at confirm (`S/features/host/HostControlScreens.kt:416,430-448`).
- Risk: a generation/selection/service replacement while a confirmation remains mounted can reauthorize the old intent against a new owner or new path. Unlike Maintenance's captured SettingsOperation, A→B→A is not remembered.
- Correction: store the exact SettingsOperation/HostMutationTicket plus action/path payload when opening; use that same captured authority at confirmation. Reject/dismiss when stale. Do not recapture permission on confirm.
- Confidence: high for missing capture; user-visible race depends on the dialog surviving a service/selection transition. No exploit/device reproduction claimed.

#### W10. Retired Settings services leave permanent integration collectors running
- Evidence: `A/platform/workspace/NativeWorkspaceViewModel.kt:1007-1011` launches each integration state's never-ending collector in the global runtime scope and drops its Job. `983-991` removes services and disposes usage/idle only, without canceling this collector.
- Impact: each rebuilt target generation retains another integration repository/owner/authority closure until final VM teardown. Repeated retirement/re-authentication grows retained work and can trigger obsolete-owner refresh callbacks.
- Correction: give each cached target service a small owned Job/scope, cancel it on exact-owner retirement, and propagate cancellation to its read producers. No new framework needed.
- Confidence: high; ownership/cleanup trace.

### Positive Observations
- ApiClient's prepare→request-local admit→single execute sequence, redirect prohibition and post-body fencing are explicit. Cancellation remains cancellation.
- Registry retirement has atomic revocation, shared outcomes, awaited barriers, latched failure and explicit recovery rather than detached cleanup.
- Reducer separates silent baselines, gaps/reconciliation, safe counters, high-water and semantic alert eligibility; Codex remains status-only.
- Notification text is fixed/generic, public lockscreen version sanitized, PendingIntents immutable, identities collision-safe; feed/transient/post trackers bounded.
- Preferences preserve unsupported remote policy, omit unrelated/unknown fields from patches, and keep history consent local. Legacy filter migration retains recovery bytes.
- SAF import is bounded/strict UTF-8, administrative ambiguity explicit, diagnostics use an allowlist, history defaults off in backup-excluded private storage.
- Reactive preference access replaces isolated snapshot copies; editor font updates do not recreate documents/undo.

### Suggestions / Recommended Actions
1. Resolve W1–W3 authority/invalidation defects, then W4–W8 mounted behavior/data-loss defects before acceptance. W9–W10 should be resolved in the same integration pass.
2. Add permanent regressions at the actual boundaries, not source-fragment assertions: held path mutation + concurrent verification, mixed-generation binding publication, T1→T2 click from each workspace panel, worktree click, absent/outdated installation, successful reset navigation, dirty Config remount, stale dialog confirmation, target-service collector teardown.
3. Keep tests proving core guards, but add actual MainActivity/retained-root journeys. Existing provider/lifetime tests instantiate helpers directly; instrumentation's “rotation and relaunch” test copies/decodes an Intent rather than recreating an Activity (`AndroidNotificationDeliveryTest.kt:151-160`). Do not label it a rotation journey.
4. Keep changes boring: wire existing coordinator/editor/operation authorities correctly rather than add ambient fallbacks, retries, new runtimes, compatibility shims or broad architecture redesign. The 1,249-line VM is hard to review, but extraction should follow concrete lifetime boundaries only after behavior is corrected.

### Verification and Metrics
- Reviewer ran **no** compile/test/lint/device commands; Main/TestRunner own verification. No tests modified.
- Existing TestRunner-4 receipt: `pnpm run native-app:test --rerun-tasks` → shared JVM task, **725 passed / 0 failed / 0 skipped** reported. Inspected `artifact://71` ending: BUILD SUCCESSFUL, 8 executed tasks.
- Existing TestRunner-4 receipt: `pnpm native-app:test:android` and forced verbose rerun → Android unit task, **174 passed / 0 failed / 0 skipped** reported. Inspected `artifact://77` ending: BUILD SUCCESSFUL, 36 executed tasks. Counts are runner-reported, not independently recounted here.
- These receipts establish successful unit-task executions, not current release APK/device/server qualification or proof that the findings are exercised.
- Lint: not run; issue count unknown. Test coverage percentage: unavailable. Type coverage: not applicable as a TypeScript metric; Kotlin compile success is present in runner receipts.
- Observed build-output warnings: Gradle 9 deprecations; Node DEP0190 in wrapper. Not assigned as Android feature regressions without causal evidence.
- Runtime findings above are source-derived, **not reproduced** by reviewer. Live-server, API29/API33+ permission/channel behavior, SAF/rotation/audio, physical keyboard and physical-device visual acceptance remain unverified here. Phase05 is outside this implementation-review acceptance claim.

### Unresolved Questions
- No product decision blocks the corrections. Remaining evidence gap: actual mounted/runtime regressions and Phase05 qualification receipts. No production/readiness approval granted.
