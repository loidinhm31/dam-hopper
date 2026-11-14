# Native Android UI/UX Design: Agent Hub, Notifications & Settings

- **Status:** Planning specification only (zero code modified; runtime/device/IME/contrast checks **pending**).
- **Static Evidence:** Inspected web Agent Hub (`AgentHubApp.tsx`, `AgentHubHeader.tsx`, `TraditionalTerminalProjectsDisplay.tsx`, `TraditionalTerminalProjectsNavigator.tsx`, `TraditionalTerminalProjectWorkspaceRow.tsx`, `HubStuckLaunchNotice.tsx`, `TerminalCloseDialog.tsx`, `SettingsPage.tsx`, `NotificationCenter.tsx`), approved web design `ui-ux-designer-261106-0226-agent-hub-workspace-flow.md` + plan `261106-0334`, and Android Compose sources (`DamHopperMobileApp.kt`, `AppFlowState.kt`, `AppFlowNavigation.kt`, `ProjectWorkspaceScreen.kt`, `ProjectTerminalScreen.kt`, `TerminalAgentsSidebar*.kt`, `SettingsScreens.kt`, `SettingsHostView.kt`, `NotificationsView.kt`, `PreferencesPrivacyView.kt`, `MaintenanceView.kt`, `NotificationCenter.kt`, `NativeTheme.kt`, `Color.kt`, `Type.kt`). Ran local `ui-ux-pro-max` queries (`jetpack-compose`, `ux` touch/navigation/safe-area).

## 1. Product Boundary & Destination Map (Proposals vs. Approved Baseline)
- **Mandatory Login Gate:** `AppFlowStage.PROFILE_LOGIN` (`ProfileLoginScreen.kt:106-153`) remains the strict entry gate (HTTPS/loopback guards, MFA, OPAQUE, monotonic attempt fencing).
- **Top-Level Products (3):**
  1. **Agent Hub (Default Post-Auth Product — *PROPOSED, pending user validation*):** Replaces the mandatory standalone `PROJECT_LIST` stop (`DamHopperMobileApp.kt:805-855`) by landing directly in the workspace host with an integrated **Projects + Agents Navigator** (`[+ Open Project]` picker reuses `WorkspaceRepository.listProjects()`).
  2. **Notifications:** Retained inline bounded feed (`NotificationCenter.kt:193-260`, 50 records max) + top inline `NotificationTransients` (`:152-185`, 3 max, zero floating toasts) + OS channels (`AndroidNotificationSink`).
  3. **Settings:** Retained overlay (`SettingsOverlay` + `SettingsOrigin` in `AppFlowState.kt:32-55`, `SettingsScreens.kt:73-209`) above the live workspace; never a second nav stack.
- **Nested Project Capabilities inside Agent Hub (4):** `Terminal` (default primary stage), `Files` (`FocusedFilesExplorerScreen`), `Editor` (`EditorPanelScreen` + Sora `CodeEditor`), and `Git` (`GitPanelScreen` + DAG/branches/worktrees) hosted in `ProjectWorkspaceScreen.kt:255-448`.
- **Retained / Currently Unmounted / Proposed Deferral Inventory Map:**
  - *Retained in Settings Overlay:* Preferences/Privacy, Notifications/Permissions, Host Admin (`Idle suspend`, `Global`, `Config`, `Agents` in `SettingsHostView.kt:41-46`), SAF TOML Import/Export & Diagnostics (`MaintenanceView.kt:66-154`), Server Profiles (`ProfileListScreen`).
  - *Currently Unmounted in Active Root — Proposed Deferral (Pending User Validation):* `Workflow/Plans`, `Agent Store/Memory/Import`, `Host Resources SSE`, `Ports/Tunnels`, `SSH/Host Controls` (implemented in unmounted `WorkbenchScreen.kt:149`, preserved in `validation-answers.md:11,29`), plus web `Session Changes Review` and `Recipes`.
  - *Approved First-Release Exclusions (`docs/architecture/android-native-client.md:14-16,348`):* Desktop OS window manager (`OsShell`/`WindowFrame`), WebView/HTML/Mermaid rendering (source-only with `⚠ Mermaid / HTML rendering deferred` banner).

## 2. Superseding Older Android Row Rules (Proposals Subject to User Validation)
| Rule in `validation-answers.md:15-30` | Disposition | Rationale |
| :--- | :--- | :--- |
| Separate `PROJECT_LIST` stage (`AppFlowState.kt:10-14`) & 12-panel row (`WorkbenchScreen.kt:94`) | **PROPOSED CHANGE (Pending Validation)** | Folding project switching into Agent Hub's `Projects + Agents` Navigator and deferring the 8 non-core workbench panels keeps focus on `Terminal/Files/Editor/Git` without losing live PTY context. |
| "No tablet/foldable side dock" (`validation-answers.md:18`) | **PROPOSED AMENDMENT (Navigation Rail Only)** | Keep **one content stage** on all sizes (no dual content panes), but allow a collapsible `280dp` left **navigation** rail when `availableWidth >= 600.dp` AND remaining stage width `>= 360.dp` (`TerminalAgentsSidebarHost.kt:59-68`, `ProjectWorkspaceScreen.kt:80-83`). |
| Terminal-only mode, Traditional PTYs, 1 direct-button top row (always visible with IME), 0 FABs/WebViews | **PRESERVED (Binding)** | Every active destination stays directly reachable via horizontal scroll (never hidden in an overflow menu); single-controller PTY continuity remains inviolable. |

## 3. Adaptive Layout, Width Admission & IME / Terminal Viewport Contract
- **Width-Gated Single-Stage Layout (No Dual-Rail Squeeze):**
  - **Compact (`availableWidth < 600.dp` or `stageWidthAfterRail < 360.dp`, phones / split-screen):** Single content stage (`100%` width). `Projects + Agents` Navigator opens as a modal left slide-over / bottom sheet (`width = min(320.dp, availableWidth - 32.dp)`) with scrim (`Color.Black.copy(alpha = 0.5f)`).
  - **Medium (`availableWidth >= 600.dp` and `stageWidthAfterRail >= 360.dp`):** Collapsible `280.dp` pinned left `Projects + Agents` rail (`[☰]` toggles rail without remounting the stage slot) + single active capability stage (`weight(1f)`). When `EDITOR` is active, the left rail switches between `Projects + Agents` and `Project Files` (never two simultaneous `280.dp` rails, which would crush an `840.dp` tablet down to `280.dp`).
  - **Expanded (`availableWidth >= 840.dp`):** Collapsible `280–300.dp` left rail + single content stage (`>= 540.dp`).
- **Measurable IME & Terminal Viewport Contract (`WindowInsets.safeDrawing` + `WindowInsets.ime`):**
  - Every interactive control enforces `sizeIn(minWidth = 48.dp, minHeight = 48.dp)` with `>= 8.dp` gap between destructive actions.
  - **Viewport Formula:** `availableTerminalHeight = usableHeightAfterInsetsAndIme - actualTopChrome - accessoryHeight - activeBanners`; `visibleRows = floor(availableTerminalHeight / measuredLineHeight)` (`UnscaledDensity`, `ProjectTerminalScreen.kt:1351-1434`).
  - **2-Row Top Chrome (Always Direct Buttons, Never Overflow Menu):** `Row 1` (`48.dp`) = Hub Header (`[☰]` + workspace pill + `[🔔]` + `[⚙]`); `Row 2` (`48.dp`) = single horizontally scrollable bar with direct capability buttons (`[Terminal] [Files] [Editor*(N)] [Git]`) followed by inline session tabs & controls (`[● #1 OMP 📌 ×] [+Term] [A±] [Diag]`).
  - **Qualification Targets & Progressive Collapse:** At `usableHeightAfterInsetsAndIme >= 420.dp` (portrait phone with IME open) and default `13sp` (`17sp` line height), `96.dp` top chrome + `<= 2` `NativeAccessoryKeyboard` rows (`<= 96.dp`) leaves `>= 228.dp` (`>= 13` visible VT rows). When `visibleRows < 8` (e.g. landscape IME or large font up to `32sp`), progressively collapse `NativeAccessoryKeyboard` to 1 row (`48.dp`) and hide optional commit/status banners while keeping `Row 2` direct buttons visible (`validation-answers.md:19-20`).

```
COMPACT PHONE (<600dp, 2 Top Rows + Terminal + Accessory) MEDIUM/EXPANDED (>=600dp, Stage >=360dp)
+-------------------------------------------------------+ +--------------------+----------------------------------+
| R1: [☰ !1 ●2] [local/dam-hopper·main]      [🔔 2] [⚙] | | PROJECTS (2) [+Opn]| R1: [☰] [local/dam-hopper] [🔔][⚙]|
|-------------------------------------------------------| | ● dam-hopper [loc]2|----------------------------------|
| R2: [Terminal][Files][Editor*][Git] | [● #1 📌×][+][A±]| |   [⎇ wt:main▾ a91f]| R2: [Terminal][Files][Editor*][Git]|
|-------------------------------------------------------| | ○ docs [loc] 0 [×] |     | [● #1 OMP 📌×] [● #2 ×] [+]|
| $ cargo run --bin dam-hopper-server -- --port 4803    | |--------------------|----------------------------------|
|   Listening on http://127.0.0.1:4803                  | | AGENTS (3) [Filter]| $ pnpm test                      |
|                                                       | | ! [Codex] Approval |   PASS 905 tests                 |
|-------------------------------------------------------| | ● [OMP] Working ×2 |                                  |
| [ESC][TAB][CTRL][ALT] [↑][↓][←][→] [PgUp][PgDn][End]  | | [Refresh][Agent ⚙] |                                  |
+-------------------------------------------------------+ +--------------------+----------------------------------+
```

## 4. Unified Navigator, Nested Capabilities & Domain Safety Contracts
- **Projects + Agents Navigator (`TraditionalTerminalProjectsNavigator.tsx:118-240` adapted to Compose):**
  - **Top Section (`PROJECTS`):** Union of session-derived groups + explicitly opened `0`-terminal project refs (`openWorkspaceRefs` persisted in non-authoritative UI state, validated against loaded inventory on restore, web `V7` / `W1`). Header includes `[+ Open Project]` picker (`WorkspaceRepository.listProjects()`).
  - **Accessible Sibling Row Composition (No Nested Controls inside Tab Button):**
    1. *Row Header:* Primary selectable tab (`Role.Tab`, `minHeight = 48.dp`) showing activity dot (`●` working / `!` attention / `○` 0-terminal), `projectName`, `ProfileBadge` (`[profileName]`), and deduplicated session count (`N`), alongside sibling buttons `[+]` (new terminal) and `[×]` (dismiss workspace — enabled **only** when the profile inventory is connected/loaded and authoritative deduplicated `live ∪ restartPending ∪ inFlightCreate` sessions for `(profileId, project)` equal `0`; fails closed while disconnected/loading/unknown and never terminates PTYs).
    2. *Sibling Worktree & Commit Bar (Active Project):* `⎇ wt: <branch/path> ▾` (`ProjectTargetStore`, guarded by `departureGuard` before target mutation, fixing `DamHopperMobileApp.kt:820-826` pre-guard mutation) + short OID chip (`a91f20c` when `terminalCommitStatusEnabled`).
  - **Bottom Section (`AGENTS`):** Reuses `TerminalAgentsSidebar.kt:87-222` (`OMP`, `Claude`, `Codex` across open terminals on attached runtimes, 7-status filter in `terminal_agents_sidebar/status_filter`, `Refresh`, and `Agent Settings` opening `SettingsSubSection.HOST -> HostSettingsSection.AGENTS` for target server B). Tapping an agent group executes `VerifiedTerminalRoute` (`AppFlowNavigation.kt:329-406`), checking `departureGuard` on workspace change, switching to `WorkspacePanel.TERMINAL`, and selecting exact `(profileId, terminalId, incarnation)` with zero fallback.
- **Files, Editor & Git Continuity (Single-Stage Adaptation of Web Floating Panels):**
  - Tapping a file in `FILES` (or the Editor file-tree drawer) opens/focuses canonical `DocumentId(owner, normalizedPath, tabIncarnation)` in `EditorTabsState` and switches `activePanel` to `WorkspacePanel.EDITOR` (`ProjectWorkspaceScreen.kt:316-321`), preserving `FileTreeState` expansion, scroll offsets, and live PTY controllers.
  - **Endpoint-Identity Save Fence (Web V1/V6 Parity):** Dirty documents bind `(profileId, normalizedServerUrl, accountId)` at baseline load (`WorkspaceFileOwner` / `FileAuthority`, `docs/architecture/android-native-client.md:60-63`); generation/endpoint retirement revokes save authority without discarding dirty buffers; only explicit `Discard & Reload` / `SaveConflictDialog` rebinds.
  - **Focused Git (`WorkspacePanel.GIT`):** Retains `GitPanelScreen` (`Changes`, `History` OID DAG, `Branches/Worktrees`), secondary-root fetch/pull disablement, CAS rewrites, and explicit leased push (`/push/prepare` + `/push/publish`, `docs/architecture/android-native-client.md:327-339`).
- **Pending/Uncertain Terminal Launch & Close View vs. End Process (Domain State Machine):**
  - **Launch Lifecycle:** Captures `(profileId, generation, project, worktreePath, attemptId)` before `createSession`. In-flight creates survive navigation/backgrounding. Uncertain/timed-out creates surface an inline `StuckLaunchNotice` (`[Check & Resolve]`, `[Launch Again]`, `[Dismiss]`): `definitely-absent` requires **both** proof that the original create attempt has settled/retired (cannot still commit on the server) **and** a subsequent fresh connected inventory snapshot confirming absence before user-confirmed clearing; otherwise state remains `in-flight` or `unknown` (web `V3`). `[Launch Again]` discloses duplicate-PTY risk and never silently clears the unresolved attempt record.
  - **Close View vs. End Session (`TerminalCloseDialog` replacing single destructive `✕` in `ProjectTerminalScreen.kt:2004-2014, 2111-2130`):**
    - Pinned tabs (`pinnedByProfile`, pruned only against authoritative connected inventory per `profileId`, web `H1`) block close with inline notice: *"Cannot close pinned terminal tab; unpin it first."*
    - Unpinned tab `✕` opens a 3-action dialog (initial focus on **Cancel**):
      1. **Cancel:** Safe dismissal.
      2. **Close View (Local-Only):** Records qualified `TerminalViewKey(profileId, project, worktreePath, terminalId, incarnation)` in retained `hiddenSessions` (detaches view without server call; a new incarnation clears hidden state). The live PTY continues running, still counts toward project session totals (blocking `[×]` workspace dismissal), and can be reopened via `[Hidden (N) ▾]` in `Row 2` or the Navigator.
      3. **End Session / Cancel Restart (Destructive):** Enabled **only** when `availability in {live, restartPending}` and exact `terminationTarget(profileId, generation, terminalId, ptyManagerEpoch, incarnation)` is verified and not already in-flight (`destroyingSessionIds`); renders `Dispatching…`, `202 Acknowledged`, `Refused`, `Failed`, or `OutcomeUnknown` (waits for inventory reconciliation, zero ambient fallback or auto-retry).
- **Multi-Layer Input Eligibility & Corrected Hierarchical Back Contract:**
  - **Presentation Cover vs. Full Input Eligibility:** `isPresentationCovered = settingsOpen || privacyMasked || notificationsOpen || compactNavigatorSheetOpen || editorFileDrawerOpen || activeModalOpen || activePanel != surfacePanel` defines the **presentation-cover portion** of `isInputEligible`, which also requires current `(profileId, generation)` authority, connected socket, foreground `LifecycleState`, `isReplayCompleted`, non-destroying state, and matching `requiredTerminalInstance` (`ProjectTerminalScreen.kt:143-156`, `docs/architecture/android-native-client.md:84`). `DamHopperMobileApp.kt:683-748` routes the Cognito dismissal chord through its dedicated handler first, then blocks other hardware shortcuts whenever `isPresentationCovered` is true.
  - **Back Precedence (`AppFlowNavigation.handleBackPress()` update required in `AppFlowNavigation.kt:452-480`):**
    1. *Software IME open:* System closes IME first.
    2. *`CognitoOverlay` active:* **Consumes/blocks Back without unwinding routes.** Cognito is never dismissed by Back; requires exact activation chord or dedicated on-screen emergency dismiss (`docs/architecture/android-native-client.md:456-462`).
    3. *Topmost modal dialog open:* Dismisses dialog (`AlertDialog` / `ConfirmDialog`).
    4. *`SettingsOverlay` open:* `closeSettings()` returns to exact `SettingsOrigin(stage, panel, document, sessionId)`.
    5. *`NotificationCenter` open:* `closeNotifications()`.
    6. *Registered UI `backInterceptors` (LIFO):* `WorkspaceSearchView` -> Compact `Projects + Agents` sheet -> Compact `Editor` file drawer -> `GIT` nested detail/diff (`workspaceState.gitState.back()`).
    7. *Non-terminal panel (`FILES` / `EDITOR` / `GIT` root):* Switches to `WorkspacePanel.TERMINAL` in the same workspace.
    8. *`TERMINAL` root:* Opens `Projects + Agents` sheet (or runs `departureGuard` before leaving workspace/profile; never kills PTYs).

## 5. Settings & Notifications UX Contracts
- **Settings 3-Scope Separation (`SettingsScreens.kt`, `PreferencesPrivacyView.kt`, `SettingsHostView.kt`, `MaintenanceView.kt`):**
  - Persistent scope header chips in Settings clearly distinguish: **(1) This Device (Local)** (command history opt-in/clear, SAF diagnostics, OS permission/channel status, ephemeral Cognito state), **(2) Preference Source Server A** (`Local only` or `preferencesProfileId` with `Active` / `Source removed` status & `Sync now`), and **(3) Administered Target Server B** (`settingsProfileId` gated by `targetServicesReady` in `AppFlowState.kt:89-100`; shows explicit read-only banner when disconnected, unauthenticated, or `--no-auth` dev mode without falling back to Source A or active workspace).
- **Notifications (`NotificationsView.kt`, `NotificationCenter.kt`, `AndroidNotificationSink`):**
  - *Permissions & Channels:* API 29 (`NOT_REQUIRED`); API 33+ (`NOT_REQUESTED` never auto-prompts; prompts only on `Enable system notifications` tap; `DENIED`/`appBlocked` keeps in-app feed working and links to `Channel settings` for `channel_terminal_attention`, `channel_transfers`, `channel_idle_suspend`).
  - *Privacy & Stale Deep Links:* OS posts use `VISIBILITY_PRIVATE` + generic public fallback (`"DamHopper — Attention required"`). In-app feed/transients sit inside `CognitoOverlay`. Tapping any OS/feed alert marks read independently and validates `(profileId, generation, serverEpoch, terminalId, incarnation)` before and after `departureGuard`; stale/retired targets stay in place and show `routeNotice` (`NotificationCenter.kt:216-225`).

## 6. Component & File Mapping + User-Journey Acceptance Matrix
| Concern | Android Files (`native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`) | Journey Acceptance Target (Qualification Gate) |
| :--- | :--- | :--- |
| Root Flow & Back Precedence | `ui/screens/DamHopperMobileApp.kt`, `ui/flow/AppFlowState.kt`, `ui/flow/AppFlowNavigation.kt` | **J1:** Login advances to Hub; Back unwinds Modal -> Settings -> Feed -> Sheet -> Git detail -> Panel -> Terminal without killing PTYs; Cognito blocks Back; dirty `departureGuard` precedes `targetStore` mutation. |
| Hub Header & Navigator | `ui/screens/ProjectWorkspaceScreen.kt`, `ui/components/TerminalAgentsSidebar*.kt`, `ui/screens/ProjectListScreen.kt` | **J2:** Compact `<600dp` uses modal sheet (`effectiveCover=true`); `>=600dp` with `>=360dp` stage pins `280dp` rail; `[+ Open Project]` opens `0`-terminal workspace; `[×]` dismisses only `0`-terminal workspaces. |
| Terminal Launch, Close & IME | `ui/screens/ProjectTerminalScreen.kt`, `features/terminal/TerminalSessionController.kt`, `ui/screens/NativeAccessoryKeyboard.kt` | **J3:** Uncertain create shows `StuckLaunchNotice`; tab `✕` opens 3-choice `TerminalCloseDialog` (`Cancel`, local `Close View` with reopen, target-fenced `End Session`); IME open preserves `>=12` portrait / `>=6` landscape VT rows at `13sp`. |
| Files, Editor & Git | `features/files/FocusedFilesExplorerScreen.kt`, `features/editor/EditorPanelScreen.kt`, `features/git/GitPanelScreen.kt` | **J4:** File tap opens `DocumentId` in `EDITOR`; endpoint-fenced saves block stale owners while keeping dirty buffer; Git worktree switch checks `departureGuard` and active PTY/dirty prechecks. |
| Settings & Notifications | `features/settings/SettingsScreens.kt`, `SettingsHostView.kt`, `NotificationsView.kt`, `ui/screens/NotificationCenter.kt` | **J5:** Source A vs Target B isolation holds across reconnects; API 33+ permission prompts only on explicit CTA; stale notification deep link refuses navigation with `routeNotice`. |
| Semantic Theme & A11y | `ui/theme/NativeTheme.kt`, `ui/theme/Color.kt`, `ui/theme/Type.kt` | **J6:** Dark/Light/High-Contrast/System tokens (`>=4.5:1` text, `>=3:1` UI contrast), `>=48dp` targets, TalkBack `Role.Tab`/sibling headings, `systemFontSize` (`10..32sp`) + `UnscaledDensity` terminal/editor independence. |

## 7. Design Alternatives Considered
1. **Desktop Floating Windows / Multi-Pane Tiling on Android:** Rejected; violates mobile viewport ergonomics and explicit no-OS-window-manager scope.
2. **Mounting All 12 `WorkbenchScreen` Destinations in the Active Hub Row:** Proposed deferral (pending validation in Q3); keeping 4 core codebase capabilities (`Terminal`, `Files`, `Editor`, `Git`) in `Row 2` avoids 12-chip scroll fatigue while preserving unmounted screens in source.
3. **Dual `280dp` Left + Right Pinned Rails at `840dp`:** Rejected; leaves only `280dp` for the main terminal/editor stage.
4. **Top Horizontal Project Tabs + Separate Bottom Agent Sheet:** Rejected in web `261106-0226` (Flow B/C); duplicates project selection and hides ambient cross-project agent attention.

## 8. Unresolved Questions (For User Validation)
1. **Direct-to-Agent-Hub Post-Login & Pinned Navigator Rail:** Approve superseding the standalone `PROJECT_LIST` stop and permitting a collapsible `280dp` left navigation rail when `availableWidth >= 600.dp` and remaining stage width `>= 360.dp` (while keeping a single content stage)?
2. **Multi-Profile Navigator Breadth:** Should the Android Agent Hub navigator list open workspaces and observed agents across **all connected profiles** in `ConnectionRegistry` (matching web Fleet/Hub) or only the **currently active authenticated profile**?
3. **Deferred Feature Inventory & Recipes:** Approve keeping `Workflow/Plans`, `Agent Store/Memory/Import`, `Host Resources`, `Ports/Tunnels`, `SSH/Host Controls` (from `validation-answers.md:11,29`), `Session Changes Review`, and `Recipes` deferred/unmounted outside the active Android Agent Hub root for this plan?
