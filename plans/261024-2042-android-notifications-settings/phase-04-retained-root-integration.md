# Phase 04 — Single-owner retained root and reactive consumers

Priority P2; status in-progress. **One integration owner** runs both tasks sequentially, only after every Phase02/03 task terminal. [Contracts](contracts.md) and [parity matrix](parity-matrix.md) govern behavior. W1 mutation-lifetime and W2 cancellation-safe settlement findings leave retained-root acceptance open; reactive preference consumers are closed.

## Conflicts and explicit transfers

- Before touching root/consumer files obtain release/current-source reconciliation from `plans/261023-1429-native-editor-file-explorer/phase-07-retained-active-workspace.md` and `plans/261024-1627-native-editor-ide-enhancements/phase-04-editor-left-sidebar-file-tree.md`. These overlap MainActivity, flow, retained state, workspace and tests; labels alone do not prove current writer/completion. Do not modify those plans or undo editor/sidebar improvements.
- Phase02 → `integrate-retained-settings-notifications`: SettingsScreens.kt, NotificationsView.kt, SettingsPreferencesPhase17Test.kt; Phase03 terminal before any host port use. Frozen policy models stay read-only; exported API callers migrated cleanly.
- `integrate-retained-settings-notifications` → `integrate-reactive-preference-consumers`: ProjectWorkspaceScreen.kt, ProjectWorkspaceState.kt, NativeWorkspaceViewModel.kt, DamHopperMobileApp.kt, ProfileLoginScreen.kt and ProjectListScreen.kt. Explicit sequential transfer; no concurrent writes. Source files below are complete authority, not directory permissions. WorkbenchScreen migration is integration-owned despite being unmounted.

## integrate-retained-settings-notifications

1. Retain services in NativeWorkspaceViewModel/viewModelScope. Consume **proposed G0-frozen C2a1 seam**, no registry/profile edits: await `addRetirementBarrier { oldRef -> coordinator.retire(oldRef) }` and retain returned Long token **before watchers/effects/readiness/runtime publication become eligible**. Registration cancellation/failure leaves bindings unavailable/producers ineligible; no synchronous-listener/detached-launch fallback. Retire/drain before runtime/client/account/endpoint/auth replacement; immutable StateFlow binding publication inside `admitCurrentOwner(ref) { ... }` non-suspending commit checks pending/failed transition, not numeric generation alone. No same-generation identity replacement, no canceled-caller replacement publication. Respect profile→registry→operation tryLock; direct ordered UNDISPATCHED Settings callbacks.
2. One collector/provider per existing runtime; frame-capture IntegrationOwner before reducer suspension. Shared readiness/effect Mutex serializes exact-key VERIFIED synchronous effects and awaited invalidate(prune/cancel/audio); RuntimeC only. Availability reads registry.connectionsState.value directly, not eventually collected cache; no suspending profile/registry queries under provider gate. Wire S2 invalidator before path/config/install. Barrier awaits coordinator.retire→provider.invalidate, attempts all cleanup, aggregate failure to unavailable latch. Strict transitive no profile/registry reentry/awaited lock-dependent work; profile Mutex may remain held. Close disables producers, NonCancellable drains every owned ref **including retained pending/failed refs, not merely current state**, then removes token/releases resources; failed drain preserves fenced capability until explicit bounded recoverRetirement, no missed/unregister-first window. Capture survives removal, oldN cannot cancel/stop N+1. No new runtime/socket/keepalive.
3. Add Settings retained overlay/origin to AppFlowState/AppFlowNavigation; inline Settings and bell entries in existing login/project/workspace headers, no second navigation system/12-panel shell. Capture return panel/document/session. Hide widget input without closing retained dirty documents/undo/PTY or resetting sidebar. Back returns origin; auth/departure actions still guard exact current owner.
4. MainActivity registers explicit RequestPermission, OpenDocument and CreateDocument launchers plus OS notification/channel settings intents; attach callbacks without retaining Activity in VM. Separate existing transfer picker. Streaming bounded UTF-8 read and completion-time operation validation per C2; close streams on all paths. Bind permission/channel refresh on resume and destroy-detach behavior; cancel only owned in-flight tokens, not other launches.
5. Wire SettingsScreens real services/ports, host subdestinations and LOCAL diagnostics provider; cache revalidation invokes retained target consumers. Dirty guard before reset; only still-current confirmed reset navigates to workspace selection. Uncertain or cancelled dispatched action stays honest, no automatic retry/navigation.
6. Mount feed/transients inline; read/all/clear/dismiss click routes use same authoritative target validator. Decode/consume cold and live intents once, reject malformed/safe-integer overflow and mismatched process nonce; authoritative terminal project/worktree/account/epoch/incarnation lookup, not labels. After auth/server fetch/departure guard revalidate before route commit. Stale/disconnected/cold click presents safe explicit profile/project/status UX with no stale autoactivation; newer attentionRevision alone does not reject valid terminal navigation.
7. Migrate dormant Workbench Settings/reducer/key/permission APIs **and all required workspace/usage/idle/agent mutation guards C2b**; use existing services/orchestrator, remove made-dead duplicate synthetic producers, keep shell unmounted. Runtime-only idle consumers use explicit owner-qualified guard, never Settings-target fallback. Delete obsolete static implementation/source-wording assertions from transferred Phase17 test; replace only behavior tests, never re-pin strings. Update route/lifecycle tests with real readiness/provider/identity publication.
8. I1 owns literal VM regression files `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt` and `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RuntimeIntegrationReadinessTest.kt`. Pause an already-admitted effect and retire via **real ProfileRepository** update/logout: retirement and replacement publication wait until provider prune/cancel/audio drain; current/create/admit N+1 cannot bypass. Inject barrier failure/caller cancellation, then ordinary later calls remain fenced; concurrent same-generation retirees share outcome, every barrier attempted, no transitive lock reentry/deadlock, N cleanup cannot cancel N+1. Register-before-watchers, close-drain-before-unregister, capture-survives-unregister and registration-failure failclosed. Registry/profile implementation/unit tests stay G0-only.

## integrate-reactive-preference-consumers

1. Replace snapshot load/direct preferencesStore writes in active terminal/workspace with one collected SettingsRepository.preferences StateFlow. Local keyboard shortcuts and font step update that repository, not an independent saved copy. VM holds history consent/data adapter and workspace preference propagation, not composition-only snapshots.
2. Typography: NativeTheme/Type accept reactive system font scaling; migrate hard-coded text styles on login/project/workspace paths to the same scale (Settings owner already uses these theme tokens in Phase02). Implement real dark/light/system/high-contrast palettes; system follows Android theme configuration. Editor host receives current editor font via NativeTextEditorView port; AndroidEditorSurface applies on update without recreating document/undo. Native pinch and hardware Ctrl+wheel zoom only when enabled; existing read-only/hidden/privacy gates still win.
3. Files/sidebar reactively consume **all/rust/javascript-typescript/java**. Add `FileRepository.languageFiles(target: ProjectTargetRef): LanguageFilesResponse` using existing GET `/api/fs/language-files`, same project/worktree query and owner validation as listDirectory; DTO files(path,size,mtime,language), truncated,limit in FileModels. Retained ancestor tree uses authoritative family metadata (all uses ordinary tree); hidden toggle/scan truncation/error/stale-target handling preserves document/selection ownership. Legacy local-all fallback notice is not dirty/remote-saved; no guessed code/text/known equivalence. Reveal and text/filename search use real current-owner paths/APIs.
4. Terminal: reactive font, inline scroll up/down/jump controls using 1..50 lines, optional latest commit/project branch via existing target-qualified read APIs (no Git page), selection auto-switch only for authoritative assigned project and guarded transition; free terminal preserves current project. Inline suggestions are actual explicit app-local history suggestions inserted into draft only, never automatically sent; label native history scope, not shell lifecycle prediction. Disabled preference removes suggestions. No raw PTY/prompt scraping or OSC feature expansion.
5. Implement AndroidCommandHistoryStore: explicit local consent default off; bounded 1,000 exact app-submitted command records scoped endpoint/account/profile/project, never raw keystrokes/output/failed or uncertain submissions. At most 4 KiB command per entry and 4 MiB serialized history, dropping oldest entries before cap; app-private storage, backup disabled, no source sync/diagnostic export. On persistence failure stop recording and show failure. Disable stops future saving; clear removes storage and live suggestions. Selection inserts draft only, normal input gate/explicit submit required. No retry of uncertain commands.
6. Build real native accessory row enable/font/padding/gap; include Ctrl/Alt/Esc/Tab/arrows/Home/End controls through existing input path, haptics consent, 48dp touch targets despite visual padding. Hide/inert when Settings/history/privacy covers terminal. No Android-Chrome forced keyboard policy.
7. Implement frozen C1 DOM grammar in HardwareShortcutRegistry/Android root preview: Mod=Ctrl, explicit Meta separate, exact modifiers, locale-independent codes; capture/cancel/reset/collision including DoubleShift filename default. Monotonic450ms/release/repeat/composition/focus/route/capture/owner gates, no hidden-input/trailing-release leak. Supported Search/font/Files/reveal/Projects/Cognito only, normal dirty guards; only IDE-layout/Git/Ports/Fleet visibly unavailable. No claim of intercepting OS-reserved keys.
8. Local theme/sound/haptic/status filter consumers remain. Tests exercise actual family scan/tree, default DoubleShift dispatch, behavior/precedence/errors; delete old source assertions, never re-pin strings. No duplicate preference truth or shims.

## Success and future checks

Every applicable persisted preference has an observable active-root consumer; toggling reacts without route recreation/PTY restart, current editor state survives. Test real MainActivity rotation with dirty buffer/undo/session/sidebar, local history enable/clear and accessory controls, both target/source independent profiles, late import/reset results, cold/live click after guard/reconnect, and hidden input. Future commands in Phase05 only: `pnpm native-app:test`, `pnpm native-app:test:android`, `pnpm native-app:assembleDebug`, instrumentation commands there. Do not run partial/full suites while integration edits.

## Risks/security/failure/rollback

Cross-plan source changes are user's; reconcile instead of overwriting. Activity recreation must reattach ports without old callbacks navigating new owner. Input gates must be reactive and independently enforced by retained state/platform widgets. Local command history can contain secrets: explicit native consent, app-private bounded storage, clear/disabling semantics, no diagnostics/sync. Search/commit reads use existing remote authorization, no local shell/Git. Stale events/clicks fail closed with safe visible reason, not crash or substitute current profile. Rollback scoped changes; preserve dirty state/local migration backup and do not pretend dispatched remote operations rolled back. If additional file needed, coordinator revises literal ownership first.

```evcrate-tasks
[
  {
    "id": "integrate-retained-settings-notifications",
    "title": "Wire retained Settings, semantic collectors, platform launchers and guarded notification routes",
    "blocked_by": ["settings-native-controls", "notifications-platform-delivery"],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/NotificationsView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NotificationCenter.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RuntimeIntegrationReadinessTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt"
    ],
    "constraints": ["Both branches terminal/writer release; G0 exact C2a1 registry/profile APIs and tests read-only, no reopened G0 writes.", "Register suspend barrier before eligibility, retire/drain before unregister; transitive no profile/registry reentry including awaited work, full cleanup survives cancellation/failure.", "Single provider/runtime owner, transition-aware publication not generation-only; no new runtime/keepalive/shims or mid-flight suites."],
    "acceptance": ["Active Settings/feed preserve origin/dirty state; one collector/provider per existing socket; registration failure leaves producers ineligible.", "Real ProfileRepository retire waits on admitted-effect drain/prune/cancel/audio; pending/failed/canceled transition fences replacement publication and current/create/admit N+1.", "Concurrent retirement shared result/all barriers attempted; old cleanup cannot cancel N+1; teardown has no missed callback window, sourceA/targetB/eventC isolation and clicks/permission/SAF remain exact-owner safe."],
    "verification": ["Phase05 runs literal NativeWorkspaceViewModelTest/RuntimeIntegrationReadinessTest plus MainActivity/navigation/lifecycle tests for real ProfileRepository admitted-effect drain, transition fencing, failure/cancellation/concurrent/all-barrier/old-cleanup/lifetime/no-deadlock races and awaited S2 revocation."]
  },
  {
    "id": "integrate-reactive-preference-consumers",
    "title": "Connect every native preference to reactive terminal, editor, file, history, keyboard and shortcut consumers",
    "blocked_by": ["integrate-retained-settings-notifications"],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidCommandHistoryStore.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Color.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/NativeAccessoryKeyboard.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkspaceSearchView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistry.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/PrivacyController.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/PreferenceConsumersTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/CommandHistoryStoreTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt"
    ],
    "constraints": ["One reactive preferences flow; legacy language fallback local/non-dirty/non-equivalent, no automatic remote overwrite; history never synced.", "C1 Mod/Meta/DOM/DoubleShift450 exact semantics; only approved Git/Ports/Fleet/IDE-layout exclusions.", "Reuse existing language scan API with owner/project/worktree fencing; no backend/dependency/scheduler or mid-flight checks."],
    "acceptance": ["All four real language filters change actual Files/sidebar family tree; hidden/scan error/truncated/stale-result handling preserves ownership.", "Fonts/theme/terminal/history/accessory controls update live without losing state; bounded local history opt-in.", "Default DoubleShift filename search and chord capture/reset/collision/dispatch honor timing/physical codes/focus/IME/privacy precedence; unavailable destinations explicit.", "Every exported caller including dormant Workbench migrated cleanly, no shims/dead synthetic producer."],
    "verification": ["Phase05 runs HardwareShortcutRegistryTest/PreferenceConsumersTest/FileRepositoryTest plus live family filters and 449/450/451ms DoubleShift/repeat/composition/focus/route/capture tests, history/fonts/keyboard/Cognito screenshots.", "Build all source sets after convergence; behavior regressions replace obsolete source-string assertions."]
  }
]
```

- [x] <!-- evcrate-task:integrate-retained-settings-notifications --> Integrate retained active-root services and routes
- [x] <!-- evcrate-task:integrate-reactive-preference-consumers --> Connect all reactive native consumers
