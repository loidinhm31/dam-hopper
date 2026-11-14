# Android Active Runtime & Retained Services Evidence Report

**Status:** COMPLETE  
**Workspace:** `native/android-app` | **Branch:** `feat/ai-os-redesign` | **Target Plan:** `261107-0305-android-agent-hub-redesign`

---

### 1. Exact Paths, Symbols & Line Anchors
- **Activity & Platform Adapters (`MainActivity.kt`):**
  - `MainActivity:53`: Retains `NativeWorkspaceViewModel by viewModels()` (line 54); owns Activity-bound launchers.
  - Ports binding: `attachPlatformPorts()` (`documentPort` line 258, `notificationPlatform` line 268).
  - Media host: `rememberAndroidMediaSurfaceHost:330` binds `AndroidMediaClient` pinned to profile base URL and vault token.
  - Notification intake: `handleNotificationIntent:380` decodes click, clears extras, enforces single-consumption via `consumedClicks`.
  - Document snapshot: `capturePreviewSnapshot:399` captures Main-thread surrogate-safe UTF-16 preview from `AndroidEditorDocument`.
- **Root Retained ViewModel (`NativeWorkspaceViewModel.kt`):**
  - `ProcessInstance.id:116`: Process-wide UUID preventing cross-process cold notification routing.
  - `RuntimeReadinessProvider:144`: Mutex-gated publication, mutation fence (`beginMutation:188`), display readiness.
  - `RetirementLifetime:303`: Ordered async retirement of runtimes, coordinators, bindings, workspace authorities.
  - `AgentRuntimeHost:527`: Runtimes map (`profileId -> AgentRuntime`), holds `WsRecoverySupervisor:586` per socket.
  - `NotificationRouteResolver:763`: Authoritative `checkLive:766` validating generation, socket, serverEpoch, incarnation.
  - `NativeWorkspaceViewModel:941`: Implements `RetainedRootServices`; owns stores (`vault:945`, `registry:946`, `metadataStore:947`, `preferencesStore:970`, `notificationSink:971`, `targetStore:976`, `commandHistory:978`, `privacyController:979`, `shortcutRegistry:980`).
  - `TargetServicesHolder:1238`: Cached per-`SettingsOwner` target services (`WorkspaceRepository`, `AgentIntegrationRepository`, `RemoteConfigEditor`, `IdleConsentController`).
  - `getOrCreateWorkspaceState:1321`: Manages `workspaceStates: ConcurrentHashMap<WorkspaceFileOwner, ProjectWorkspaceState>`.
  - `retainedDirtyDocuments:1443`: Scans workspace states matching URL, account, project, worktree for unsaved changes.
- **Root Composable & Flow Dispatch (`DamHopperMobileApp.kt`):**
  - `RetainedRootServices:103`: Contract between ViewModel and UI.
  - `DamHopperMobileApp:155` -> `RootContent:208`: Manages `activeProfileId`, `ApiClient`, `WsConnection`, and `activeWorkspaceState:309`.
  - Roster registration: `agentsService.registerWorkspace:414` binds `WorkspaceFileOwner` to `RetainedTerminalAgentsCoordinator`.
  - Screen switching: `PROFILE_LOGIN:782`, `PROJECT_LIST:793`, `TERMINAL:850` (hosts `ProjectWorkspaceScreen`), `SettingsScreens` overlay (`key(overlay.intent):965`), `CognitoOverlay:1024`.
  - Effective cover gate: `effectiveCover:535` combining privacy mask, Settings overlay, search mode, and departure guards.
- **Navigation Models (`AppFlowState.kt`, `AppFlowNavigation.kt`):**
  - `AppFlowStage:10`: Enum (`PROFILE_LOGIN`, `PROJECT_LIST`, `TERMINAL` / `WORKSPACE`).
  - `SettingsOverlay:44`: Stores `origin: SettingsOrigin`, `targetProfileId`, `subSection`, and monotonic `intent: Long`.
  - `AppFlowState:67`: Immutable state holding active profile, project, session, worktree, settings overlay, required terminal instance.
- **Retained Workspace State (`ProjectWorkspaceState.kt`, `ProjectTerminalState.kt`):**
  - `ProjectWorkspaceState:79`: Owns `editorTabsState:84`, `fileTreeState:85`, `fileMutationCoordinator:86`, `terminalState:87`, `gitState:92`, `gitRuntime:93`.
  - `revokeAuthority:186`: Synchronously revokes transports and aborts in-flight mutations upon retirement.
  - `ProjectTerminalState:80`: Retains `controllers:85`, `surfaces:86`, `attachQueues:87`, `destroyingSessionIds:89`.
  - `coverPredicate:115` & `setPanelVisible:131`: Drops queued and live PTY inputs when covered or backgrounded.
- **Terminal & Git Integration:**
  - `TerminalRepository.kt:22`: `createSession:54`, `killSession:100`, `attachTerminal:247`, message streaming flows (lines 262–297).
  - `GitWorkspaceRuntime.kt:27`: Owns `GitHistoryController`, `GitChangesController`, `WorktreeMutationController`, `GitSyncController`, `DiffReviewController`.
  - `WorkspaceGitSafety.kt:30`: Departure guards, dirty document barriers (`retainedDirtyDocsProvider`), and connection validation.

---

### 2. Active vs Dormant Reachability
- **Active Root Path:** `MainActivity` -> `DamHopperMobileApp` -> `AppFlowNavigation` (stages: `PROFILE_LOGIN` -> `PROJECT_LIST` -> `TERMINAL` with nested `ProjectWorkspaceScreen`: Editor/Tabs, FileTree, Terminal, Git, Media preview) + `SettingsScreens` overlay + `NotificationCenter` dropdown + `TerminalAgentsSidebarHost`.
- **Dormant / Unreachable Code:**
  - `WorkbenchScreen.kt:149`: 12-panel desktop-style shell (`PanelHost`, `PanelNavigationRow`, `PanelRegistry`). Never mounted by `DamHopperMobileApp` (confirmed by `README.md:34`). Panel destinations like `FLEET_TERMINAL`, `PORTS_PANEL`, and floating layout are unreachable from the active flow.
  - `WorkbenchShellPhase06Test.kt`: Tests dormant shell navigation, not active mobile flow.

---

### 3. Recommended Reuse & Deletion Boundaries
- **Retain & Reuse (Core Assets):**
  - All retained services in `NativeWorkspaceViewModel` (`ProfileRepository`, `ConnectionRegistry`, `AndroidCredentialVault`, `AndroidPreferencesStore`, `NotificationCoordinator`, `AndroidNotificationPlatform`, `AndroidNotificationAudio`, `AndroidCommandHistoryStore`, `HardwareShortcutRegistry`, `PrivacyController`).
  - Terminal agents infrastructure (`TerminalAgentsInventoryCoordinator`, `RetainedTerminalAgentsCoordinator`, `TerminalAgentsActivationCoordinator`, `DefaultTerminalAgentsProjector`, `DefaultTerminalAgentsFilterCodec`).
  - Workspace subsystems (`ProjectWorkspaceState`, `EditorTabsState`, `FileTreeState`, `GitWorkspaceState`, `GitWorkspaceRuntime`, `WorkspaceGitSafety`, `AndroidEditorDocument`, `AndroidEditorSurfaceHost`, `AndroidMediaClient`).
  - WebSocket supervisor (`WsRecoverySupervisor`, `WsRecoveryPolicy`) in `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/`.
- **Cutover & Deletion Boundaries:**
  - Deprecate/isolate dormant `WorkbenchScreen.kt`, `PanelHost.kt`, `PanelNavigationRow.kt` and `WorkbenchShellPhase06Test.kt`.
  - Replace 3-stage linear flow (`AppFlowStage.PROFILE_LOGIN` -> `PROJECT_LIST` -> `TERMINAL`) with Agent Hub as primary product screen, elevating `TerminalAgentsSidebar` concepts to top-level view while nesting workspace/editor/terminal/git under selected project/worktree context.

---

### 4. Contracts Requiring Adaptation
1. **Workspace Target & Identity Unification:**
   - `WorkspaceFileOwner.kt:16` normalizes worktrees via `normalizeWorktree()` (strips leading `/`), whereas `ProjectTargetRef.kt:30` uses `normalizeProjectTargetPath()` (preserves leading `/`, resolves relative dot segments).
   - Adapt both to include explicit workspace root and workspace configuration path matching updated server models, making cache keys, dirty guards, and target matching strictly canonical.
2. **Terminal Lifetime & PTY Guarding:**
   - Current `TerminalRepository.attachTerminal:247` takes `(id, fromOffset)` and `killSession:100` deletes by raw ID.
   - Server contract requires PTY manager epoch and exact terminal incarnation (`TerminalAgentsInstanceKey(terminalId, incarnation)`).
   - Adapt `TermAttach`, `resizeTerminal`, input dispatch, inventory tracking, and session destruction to carry and verify epoch + incarnation end-to-end.
3. **Preferences & Keyboard Shortcuts:**
   - `WorkbenchPreferences`: Needs adaptation for nullable shortcuts, agent hub layout options, and new web-parity settings without breaking existing persistent storage (`AndroidPreferencesStore`).

---

### 5. Source & Test File Ownership Matrix (Disjoint Future Phases)
- **Phase A — Root Navigation & Hub Shell Architecture:**
  - *Source:* `AppFlowState.kt`, `AppFlowNavigation.kt`, `DamHopperMobileApp.kt`, `MainActivity.kt`.
  - *Tests:* `AppFlowNavigationTest.kt`, `SimpleFlowJourneysTest.kt`, `RetainedWorkspaceLifecycleTest.kt`.
- **Phase B — Agent Hub Primary Surface & Guarded Terminal:**
  - *Source:* `TerminalAgentsSidebar.kt`, `TerminalAgentsSidebarHost.kt`, `RetainedTerminalAgentsCoordinator.kt`, `TerminalAgentsActivationCoordinator.kt`, `ProjectTerminalScreen.kt`, `ProjectTerminalState.kt`, `TerminalRepository.kt`.
  - *Tests:* `TerminalAgentsSidebarTest.kt`, `RetainedTerminalAgentsIntegrationTest.kt`, `TerminalAgentsActivationCoordinatorTest.kt`, `TerminalAgentsInventoryCoordinatorTest.kt`.
- **Phase C — Nested Codebase Work (Editor, Files, Git):**
  - *Source:* `ProjectWorkspaceScreen.kt`, `ProjectWorkspaceState.kt`, `WorkspaceFileOwner.kt`, `ProjectTargetRef.kt`, `EditorTabsState.kt`, `WorkspaceGitSafety.kt`, `GitWorkspaceRuntime.kt`, `GitPanelScreen.kt`.
  - *Tests:* `FileRepositoryTest.kt`, `WorkspaceRepositoryTest.kt`, `GitWorkspaceSafetyTest.kt`, `GitWorkspaceRuntimeBindingTest.kt`.
- **Phase D — Settings, Notifications & Recovery Integration:**
  - *Source:* `SettingsRepository.kt`, `SettingsScreens.kt`, `NotificationCoordinator.kt`, `NotificationCenter.kt`, `AndroidNotificationPlatform.kt`, `WsRecoverySupervisor.kt`.
  - *Tests:* `SettingsRepositoryTest.kt`, `SettingsPreferencesPhase17Test.kt`, `NotificationCoordinatorTest.kt`, `WsRecoverySupervisorTest.kt`.

---

### 6. Risky Lifecycle Flows, Safety Guards & Device Gates
- **Notification Intent Consumption (`MainActivity.kt:380`, `NotificationRouteResolver.kt:763`):**
  - `ProcessInstance.id` rejects cross-process cold clicks; single-use `consumedClicks` map blocks rotation replays.
  - `checkLive` enforces strict identity match: connection generation, live socket ref, server epoch, terminal incarnation, and agent session ID. Stale or mismatched intents show user-facing refusal, never auto-activating.
- **PTY Survival vs Input Gating:**
  - Invariant 4 (`DamHopperMobileApp.kt:145`): Navigating back from Terminal or switching panels MUST NOT kill remote PTYs.
  - `ProjectTerminalState.coverPredicate` and `effectiveCover` (`DamHopperMobileApp.kt:535`) immediately disable input when Settings, Cognito, search, or compact sheets are visible to prevent typing leaks into remote PTY.
- **Connection Scope vs Process Life:**
  - Clear distinction: Remote PTY survival (server-side) != in-process retained state (`NativeWorkspaceViewModel`) != Android process survival (OS background eviction).
  - Hub navigation must explicitly manage which profiles connect; it must NOT ambiently open sockets to all stored profiles.
- **Retirement Barrier & Authority Revocation:**
  - `RetirementLifetime:303` synchronously triggers `it.revokeAuthority()` on `ProjectWorkspaceState` before teardown completes, guaranteeing no dirty document auto-save or git mutation executes on a stale or replaced server generation.

---

### 7. Material Unknowns & Unresolved Questions
1. **Multi-Profile Breadth in Agent Hub:** Does the new Agent Hub display agent instances across all saved profiles simultaneously, or does it scope strictly to the active profile's connected runtime? (Source evidence shows `RootContent` currently binds only one active profile socket).
2. **Dormant Shell Retirement:** Should `WorkbenchScreen.kt` and its 12-panel navigation tests be permanently deleted in Phase A, or retained behind an internal debug flag during migration?