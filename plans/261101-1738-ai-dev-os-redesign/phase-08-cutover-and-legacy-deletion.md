# Phase 08: P5 — Cut over root and delete legacy web shells

Estimate: 40h; implementation status: **DONE** (2026-11-03 per user approval; Cycle 3 review 6/10 with carryovers tracked to Phase 09). [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status DONE per user approval (2026-11-03) with technical carryovers tracked into Phase 09. Prototype and OS apps progress concurrently with independent P0. Only this ROOT CUTOVER waits for P0 release receipt in addition to lifecycle/full17/Hub/recipe parity, ensuring P0 ships early without delaying prototype/chrome. Resolver remains ordinary Phase09 web qualification, no native AC12 blocker. [Ownership](ownership.md), [acceptance](acceptance.md).

## Architecture / requirements
Root `/` renders OsShell. `/os` remains valid same-shell entry (or basename-safe canonical redirect preserving its intent params), not a fork. Legacy `/workspace`, `/git`, `/settings`, `/agent-store`, `/devices`, `/terminals`, `/ide` translate through existing LegacyRedirect/LegacyDeepLinkNotice mechanics into qualified OS intents. Devices -> Settings Devices section; terminals/ide/workspace -> Terminals or supported explicit open/action; Git -> Git. Preserve qualified profile/project/worktree/file/line/hash/terminal identity where supported. Missing legacy qualification uses existing guidance rather than ambient fallback. Removed `/usage` and `/ssh-forwarding` show clear removed-feature notice without network/mutation.

Every retained feature action originates in app registry/intents; no old shell/template or workspace-mode preference switches. Mobile-specific web code/policy/keyboard/queries deleted; server UI-config mobile fields intentionally untouched for Android/legacy config compatibility. Compact desktop remains OS-specific, not useCompactWorkspace with a new name. Existing generic input suppression is still needed for Cognito/disconnect and must survive without native-only naming/branches.

## Ordered implementation by task ID
### cutover-root-shell
1. Require full catalog/AI parity AND independent `release-p0-removals` receipt before root switch; prototype/chrome did not wait for it. Translate legacy paths/remove duplicate services. No Resolver-plan blocker. Before this task `/os` URL-only; after it root OS default.
2. Delete WorkspacePage, IdeShell/TerminalWorkspaceShell/MobileWorkspaceShell and tests tied only to deleted presentation, old DashboardPage/HostResourcePopover, obsolete TopNav/workspace-mode/floating wrappers and layout-specific helpers listed below. Features/tests move to corresponding OS app, never deleted as a shortcut to passing tests.
3. Retain useful generic floating geometry/terminal inner layout helpers only if real OS/terminal callers use them. Replace ConflictResolverPanel's imported terminal-workspace-panel z constant with OS frame/z authority, then delete obsolete terminal-workspace-panel controller. TopNavAppZoomControls is retained/reused by OS chrome; delete listed old TopNav brand/route/toolbar fragments only after their useful actions have OS equivalents. Source references are enumerated in task ownership; additions escalate before editing.
4. Prepare new root/deep-link smoke fixtures and update UI build-time shell API tests. `/` and `/os` must resolve same persisted session/store, not create duplicate hosts on route changes.
### remove-web-mobile-paths
1. Delete mobile components/policy/hooks/key-layout and dedicated policy-only tests. Remove every AndroidChrome/useCoarsePointer/useCompactWorkspace import and platform branch in retained components and tests; use OS container-aware compact desktop hook for retained navigator/runtime/Workflow density.
2. Remove mobile keyboard controls from Settings appearance and web-only preference use, keep unknown legacy server-config fields roundtrippable. Never edit Rust/Android UI-config mobile fields.
3. Rename generic terminal stdin suppression module to terminal-input-policy and migrate all callers/tests; preserve Cognito, disconnected-owner and frame-focus gating. No always-false Android/native compatibility hook remains.
4. Rewrite behavior-preserving shared tests rather than deleting generic privacy/crypto/editor coverage. Existing server-settings-mfa-mobile browser suite is migrated to desktop Settings/auth behavior during Phase09, not treated as native OS support.

## Success / checks
AC4/5/10: root OS at supported viewports, every app reachable, legacy redirects qualified/basename-safe/no loops, no mobile shell path remains. AC11 and P1 lifecycle rerun on root, including existing initial app navigation/auth/profiles. Main runs commands only after both cutover tasks join; E2E rewrites/human review are Phase09 release gates, not optional postrelease work.

## Risks / security / rollback
Audit stale imports/keys; preserve terminal/profile/editor data, dirty-close and origin fencing. Roll back to previous coherent intermediate release (P0 shipped, old UI default, hidden OS), preserving OS JSON/unresolved recipe evidence. No Usage exporter/migration code exists or is restored by OS-only rollback. Next ordinary Phase09 app qualification including Resolver.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `cutover-root-shell` file actions

| Action | Literal writable path |
|---|---|
| Delete | `packages/ui/src/components/pages/WorkspacePage.tsx` |
| Delete | `packages/ui/src/components/pages/WorkspacePage.test.tsx` |
| Delete | `packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx` |
| Delete | `packages/ui/src/components/pages/DashboardPage.tsx` |
| Delete | `packages/ui/src/components/templates/IdeShell.tsx` |
| Delete | `packages/ui/src/components/templates/IdeShell.test.tsx` |
| Delete | `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` |
| Delete | `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx` |
| Delete | `packages/ui/src/components/templates/MobileWorkspaceShell.tsx` |
| Delete | `packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx` |
| Delete | `packages/ui/src/components/templates/AppLayout.tsx` |
| Delete | `packages/ui/src/components/organisms/HostResourcePopover.tsx` |
| Delete | `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` |
| Delete | `packages/ui/src/components/organisms/TopNav.tsx` |
| Delete | `packages/ui/src/components/organisms/TopNavUtilityStrip.tsx` |
| Delete | `packages/ui/src/components/organisms/TopNavRouteMenu.tsx` |
| Delete | `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx` |
| Delete | `packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx` |
| Delete | `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` |
| Delete | `packages/ui/src/components/organisms/TerminalFloatingToolPanel.test.tsx` |
| Delete | `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx` |
| Delete | `packages/ui/src/components/molecules/TopNavWorkspaceModeSwitch.tsx` |
| Delete | `packages/ui/src/lib/workspace-mode.ts` |
| Delete | `packages/ui/src/lib/workspace-mode.test.ts` |
| Delete | `packages/ui/src/lib/terminal-floating-file-panel-state.ts` |
| Delete | `packages/ui/src/lib/terminal-floating-file-panel-state.test.ts` |
| Delete | `packages/ui/src/lib/ide-shell-layout.ts` |
| Delete | `packages/ui/src/lib/ide-shell-layout.test.ts` |
| Modify | `packages/ui/src/os/OsShell.tsx` |
| Modify | `packages/ui/src/os/deep-links.ts` |
| Modify | `packages/ui/src/os/deep-links.test.ts` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/embed/dam-hopper-app.test.tsx` |
| Modify | `packages/ui/src/api/phase-02-unified-shell.test.tsx` |
| Modify | `packages/ui/src/api/phase-03-files-editor-search-git.test.ts` |
| Delete | `packages/ui/src/lib/terminal-workspace-panel.ts` |
| Delete | `packages/ui/src/lib/terminal-workspace-panel.test.ts` |
| Modify | `packages/ui/src/components/pages/GitPage.tsx` |
| Modify | `packages/ui/src/components/pages/SettingsPage.tsx` |
| Modify | `packages/ui/src/components/pages/AgentStorePage.tsx` |
| Modify | `packages/ui/src/components/pages/DevicesPage.tsx` |
| Delete | `packages/ui/src/components/organisms/TopNav.test.tsx` |
| Delete | `packages/ui/src/components/organisms/TopNavProjectToolbar.tsx` |
| Delete | `packages/ui/src/components/molecules/TopNavBrand.tsx` |
| Delete | `packages/ui/src/components/molecules/TopNavConnectionButton.tsx` |
| Delete | `packages/ui/src/components/molecules/TopNavRouteLink.tsx` |
| Delete | `packages/ui/src/components/atoms/TopNavMenuButton.tsx` |
| Delete | `packages/ui/src/lib/terminal-floating-file-panel-tabs.ts` |
| Modify | `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` |

### `remove-web-mobile-paths` file actions

| Action | Literal writable path |
|---|---|
| Delete | `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` |
| Delete | `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` |
| Delete | `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx` |
| Delete | `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx` |
| Delete | `packages/ui/src/components/organisms/MobileTerminalSpecialKeys.tsx` |
| Delete | `packages/ui/src/components/organisms/AndroidChromeKeyboardNotice.tsx` |
| Delete | `packages/ui/src/contexts/AndroidChromeInputPolicyContext.tsx` |
| Delete | `packages/ui/src/lib/android-chrome-input-policy.ts` |
| Delete | `packages/ui/src/lib/android-chrome-input-policy.test.ts` |
| Delete | `packages/ui/src/lib/mobile-terminal-keyboard-layout.ts` |
| Delete | `packages/ui/src/lib/mobile-terminal-keyboard-layout.test.ts` |
| Delete | `packages/ui/src/lib/mobile-terminal-keys.ts` |
| Delete | `packages/ui/src/lib/mobile-terminal-keys.test.ts` |
| Delete | `packages/ui/src/lib/mobile-panel-trigger-position.ts` |
| Delete | `packages/ui/src/hooks/use-coarse-pointer.ts` |
| Delete | `packages/ui/src/hooks/use-compact-workspace.ts` |
| Delete | `packages/ui/src/hooks/use-mobile-panel-trigger-drag.ts` |
| Delete | `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` |
| Delete | `packages/ui/browser-tests/mobile-workspace-shell.browser.tsx` |
| Delete | `packages/ui/browser-tests/android-chrome-input-policy.browser.ts` |
| Modify | `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` |
| Modify | `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx` |
| Modify | `packages/ui/src/components/organisms/ChangedFilesList.tsx` |
| Modify | `packages/ui/src/components/organisms/ChangedFilesListRender.test.tsx` |
| Modify | `packages/ui/src/components/organisms/ConfigEditor.tsx` |
| Modify | `packages/ui/src/components/organisms/ConfigEditor.test.ts` |
| Modify | `packages/ui/src/components/organisms/DiffViewer.tsx` |
| Modify | `packages/ui/src/components/organisms/DiffViewer.test.tsx` |
| Modify | `packages/ui/src/components/organisms/GitLocalChanges.tsx` |
| Modify | `packages/ui/src/components/organisms/GitLocalChangesRender.test.tsx` |
| Modify | `packages/ui/src/components/organisms/GlobalConfigEditor.tsx` |
| Modify | `packages/ui/src/components/organisms/GlobalConfigEditor.test.tsx` |
| Modify | `packages/ui/src/components/organisms/MergeConflictEditor.tsx` |
| Modify | `packages/ui/src/components/organisms/MergeConflictEditor.test.tsx` |
| Modify | `packages/ui/src/components/organisms/ConflictResolverIntegration.test.tsx` |
| Modify | `packages/ui/src/components/organisms/MonacoHost.tsx` |
| Modify | `packages/ui/src/components/organisms/MonacoHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` |
| Modify | `packages/ui/src/components/organisms/NewItemDialog.tsx` |
| Modify | `packages/ui/src/components/organisms/PaneContainer.tsx` |
| Modify | `packages/ui/src/components/organisms/PaneContainer.test.tsx` |
| Modify | `packages/ui/src/components/organisms/PassphraseDialog.tsx` |
| Modify | `packages/ui/src/components/organisms/RenameItemDialog.tsx` |
| Modify | `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` |
| Modify | `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` |
| Modify | `packages/ui/src/components/organisms/SplitLayout.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalPanel.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalTabBar.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalTreeView.tsx` |
| Modify | `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` |
| Modify | `packages/ui/src/components/organisms/WorkflowContextSurface.tsx` |
| Modify | `packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx` |
| Modify | `packages/ui/src/components/molecules/PassphrasePrompt.tsx` |
| Modify | `packages/ui/src/components/molecules/PassphrasePrompt.test.tsx` |
| Modify | `packages/ui/src/stores/settings.ts` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/lib/reveal-active-file.ts` |
| Delete | `packages/ui/src/lib/terminal-native-input-policy.ts` |
| Delete | `packages/ui/src/lib/terminal-native-input-policy.test.ts` |
| Create | `packages/ui/src/lib/terminal-input-policy.ts` |
| Create | `packages/ui/src/lib/terminal-input-policy.test.ts` |
| Modify | `packages/ui/src/os/use-os-viewport.ts` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "cutover-root-shell",
    "title": "Switch root and legacy routes to OS and delete obsolete shell composition",
    "blocked_by": [
      "implement-launch-recipes",
      "release-p0-removals"
    ],
    "allowed_files": [
      "packages/ui/src/components/pages/WorkspacePage.tsx",
      "packages/ui/src/components/pages/WorkspacePage.test.tsx",
      "packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx",
      "packages/ui/src/components/pages/DashboardPage.tsx",
      "packages/ui/src/components/templates/IdeShell.tsx",
      "packages/ui/src/components/templates/IdeShell.test.tsx",
      "packages/ui/src/components/templates/TerminalWorkspaceShell.tsx",
      "packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx",
      "packages/ui/src/components/templates/MobileWorkspaceShell.tsx",
      "packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx",
      "packages/ui/src/components/templates/AppLayout.tsx",
      "packages/ui/src/components/organisms/HostResourcePopover.tsx",
      "packages/ui/src/components/organisms/HostResourcePopover.test.tsx",
      "packages/ui/src/components/organisms/TopNav.tsx",
      "packages/ui/src/components/organisms/TopNavUtilityStrip.tsx",
      "packages/ui/src/components/organisms/TopNavRouteMenu.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingToolPanel.test.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx",
      "packages/ui/src/components/molecules/TopNavWorkspaceModeSwitch.tsx",
      "packages/ui/src/lib/workspace-mode.ts",
      "packages/ui/src/lib/workspace-mode.test.ts",
      "packages/ui/src/lib/terminal-floating-file-panel-state.ts",
      "packages/ui/src/lib/terminal-floating-file-panel-state.test.ts",
      "packages/ui/src/lib/ide-shell-layout.ts",
      "packages/ui/src/lib/ide-shell-layout.test.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx",
      "packages/ui/src/api/phase-02-unified-shell.test.tsx",
      "packages/ui/src/api/phase-03-files-editor-search-git.test.ts",
      "packages/ui/src/lib/terminal-workspace-panel.ts",
      "packages/ui/src/lib/terminal-workspace-panel.test.ts",
      "packages/ui/src/components/pages/GitPage.tsx",
      "packages/ui/src/components/pages/SettingsPage.tsx",
      "packages/ui/src/components/pages/AgentStorePage.tsx",
      "packages/ui/src/components/pages/DevicesPage.tsx",
      "packages/ui/src/components/organisms/TopNav.test.tsx",
      "packages/ui/src/components/organisms/TopNavProjectToolbar.tsx",
      "packages/ui/src/components/molecules/TopNavBrand.tsx",
      "packages/ui/src/components/molecules/TopNavConnectionButton.tsx",
      "packages/ui/src/components/molecules/TopNavRouteLink.tsx",
      "packages/ui/src/components/atoms/TopNavMenuButton.tsx",
      "packages/ui/src/lib/terminal-floating-file-panel-tabs.ts",
      "packages/ui/src/components/organisms/ConflictResolverPanel.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Root and /os share one OS session/resource tree; every listed legacy route maps to correct qualified app or clear notice.",
      "Legacy shells/Dashboard/popover/workspace-mode/obsolete wrappers absent; retained features migrated, not dropped."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/embed/dam-hopper-app.test.tsx src/api/phase-02-unified-shell.test.tsx src/api/phase-03-files-editor-search-git.test.ts",
      "pnpm --filter @dam-hopper/ui build",
      "Main smoke-tests /, /os, all legacy paths and router basename with qualified and missing targets; zero duplicate host attachments."
    ]
  },
  {
    "id": "remove-web-mobile-paths",
    "title": "Delete web mobile policy and keyboard paths while preserving generic isolation",
    "blocked_by": [
      "cutover-root-shell"
    ],
    "allowed_files": [
      "packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx",
      "packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx",
      "packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx",
      "packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx",
      "packages/ui/src/components/organisms/MobileTerminalSpecialKeys.tsx",
      "packages/ui/src/components/organisms/AndroidChromeKeyboardNotice.tsx",
      "packages/ui/src/contexts/AndroidChromeInputPolicyContext.tsx",
      "packages/ui/src/lib/android-chrome-input-policy.ts",
      "packages/ui/src/lib/android-chrome-input-policy.test.ts",
      "packages/ui/src/lib/mobile-terminal-keyboard-layout.ts",
      "packages/ui/src/lib/mobile-terminal-keyboard-layout.test.ts",
      "packages/ui/src/lib/mobile-terminal-keys.ts",
      "packages/ui/src/lib/mobile-terminal-keys.test.ts",
      "packages/ui/src/lib/mobile-panel-trigger-position.ts",
      "packages/ui/src/hooks/use-coarse-pointer.ts",
      "packages/ui/src/hooks/use-compact-workspace.ts",
      "packages/ui/src/hooks/use-mobile-panel-trigger-drag.ts",
      "packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx",
      "packages/ui/browser-tests/mobile-workspace-shell.browser.tsx",
      "packages/ui/browser-tests/android-chrome-input-policy.browser.ts",
      "packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx",
      "packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx",
      "packages/ui/src/components/organisms/ChangedFilesList.tsx",
      "packages/ui/src/components/organisms/ChangedFilesListRender.test.tsx",
      "packages/ui/src/components/organisms/ConfigEditor.tsx",
      "packages/ui/src/components/organisms/ConfigEditor.test.ts",
      "packages/ui/src/components/organisms/DiffViewer.tsx",
      "packages/ui/src/components/organisms/DiffViewer.test.tsx",
      "packages/ui/src/components/organisms/GitLocalChanges.tsx",
      "packages/ui/src/components/organisms/GitLocalChangesRender.test.tsx",
      "packages/ui/src/components/organisms/GlobalConfigEditor.tsx",
      "packages/ui/src/components/organisms/GlobalConfigEditor.test.tsx",
      "packages/ui/src/components/organisms/MergeConflictEditor.tsx",
      "packages/ui/src/components/organisms/MergeConflictEditor.test.tsx",
      "packages/ui/src/components/organisms/ConflictResolverIntegration.test.tsx",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/components/organisms/MonacoHost.test.tsx",
      "packages/ui/src/components/organisms/MultiTerminalDisplay.tsx",
      "packages/ui/src/components/organisms/NewItemDialog.tsx",
      "packages/ui/src/components/organisms/PaneContainer.tsx",
      "packages/ui/src/components/organisms/PaneContainer.test.tsx",
      "packages/ui/src/components/organisms/PassphraseDialog.tsx",
      "packages/ui/src/components/organisms/RenameItemDialog.tsx",
      "packages/ui/src/components/organisms/ServerSettingsDialog.tsx",
      "packages/ui/src/components/organisms/SettingsAppearanceSection.tsx",
      "packages/ui/src/components/organisms/SplitLayout.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.test.tsx",
      "packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx",
      "packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx",
      "packages/ui/src/components/organisms/TerminalTabBar.tsx",
      "packages/ui/src/components/organisms/TerminalTreeView.tsx",
      "packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx",
      "packages/ui/src/components/organisms/WorkflowContextSurface.tsx",
      "packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx",
      "packages/ui/src/components/molecules/PassphrasePrompt.tsx",
      "packages/ui/src/components/molecules/PassphrasePrompt.test.tsx",
      "packages/ui/src/stores/settings.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/lib/reveal-active-file.ts",
      "packages/ui/src/lib/terminal-native-input-policy.ts",
      "packages/ui/src/lib/terminal-native-input-policy.test.ts",
      "packages/ui/src/lib/terminal-input-policy.ts",
      "packages/ui/src/lib/terminal-input-policy.test.ts",
      "packages/ui/src/os/use-os-viewport.ts"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "No MobileWorkspaceShell/MobileTerminal/AndroidChrome/useCoarsePointer/useCompactWorkspace/workspace-mode production path or compatibility hook remains.",
      "OS compact desktop, generic terminal suppression, privacy/crypto/editor behavior retained; server/mobile config fields unchanged."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test",
      "pnpm --filter @dam-hopper/ui build",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle"
    ]
  }
]
```

- [x] <!-- evcrate-task:cutover-root-shell --> Switch root and legacy routes to OS and delete obsolete shell composition
- [x] <!-- evcrate-task:remove-web-mobile-paths --> Delete web mobile policy and keyboard paths while preserving generic isolation

## Phase 08 Closure & Carried Technical Findings (2026-11-03)

Phase 08 is marked DONE per recorded user approval with technical acceptance carryovers tracked into Phase 09 qualification. Technical review Cycle 3 ([plans/reports/code-review-261103-0206-phase-08-cutover-and-legacy-deletion-cycle-3.md](../reports/code-review-261103-0206-phase-08-cutover-and-legacy-deletion-cycle-3.md)) scored 6/10 (request changes; findings C2/C3 and warnings W1–W5 noted).

Delivered implementation:
- Task 1 (`cutover-root-shell`): Root `/` and `/os` route cut over to `OsShell` via `DamHopperAppInner` in `dam-hopper-app.tsx` with basename-safe routing and legacy path translation (`/workspace`, `/git`, `/settings`, `/agent-store`, `/devices`, `/terminals`, `/ide` via `deep-links.ts` and legacy feature notices); deleted legacy shells and obsolete composition (`WorkspacePage`, `DashboardPage`, `IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`, `AppLayout`, `HostResourcePopover`, `TopNav`, and 45+ deleted shell/mobile files); updated `ConflictResolverPanel` to use OS frame z-index authority.
- Task 2 (`remove-web-mobile-paths`): Retired web mobile policy, mobile terminal accessory bar, virtual keyboards, coarse-pointer/compact-workspace hooks; preserved generic terminal stdin suppression via `terminal-input-policy.ts` (Cognito, disconnect, frame-focus gating).
- QA / Verification baseline: Scoped UI unit tests passed (324 files, 2,997 tests passed); UI and web builds passed with ConfigEditor chunk warning; browser component suite passed for `os-input-isolation.browser.tsx` and `os-shell.browser.tsx`.

### Carried Implementation Defects & Qualification Gates to Phase 09:
1. **C2 (High) — Router-Reactive Retirement Boundary:**
   `DamHopperAppInner` isolates network hooks on cold load, but outer `DamHopperApp` reads `window.location.pathname` once per render without a router location subscription. Retirement notice (`/usage`, `/ssh-forwarding`) needs location-reactive subscription above boundary across SPA/Back/Forward navigation.
2. **C3 (High) — Intent Handler Stale Window Session Closure:**
   `OsShell.tsx` `file:open` handler closure captured initial session windows; requires reading `useWindowStore.getState().session.windows` dynamically to avoid missing hydrated/new windows. Navigation-triggered intent delivery deduplication and invalid-result surfacing carried forward.
3. **Warnings W1–W5 Carryover:**
   - **W1:** Query-only URL delivery reactivity and deduplication in `OsShell.tsx`.
   - **W2:** Remaining web mobile keyboard ownership/serialization in `stores/settings.ts` and dead coarse-pointer props in `TerminalTreeView.tsx`.
   - **W3:** Container-aware compact density in `WorkflowContextSurface.tsx`, `ActiveTerminalRuntimeDisplay.tsx`, and Traditional navigator.
   - **W4:** Retained browser test suite migration (updating deleted legacy shell imports in `app-zoom`, `project-worktree-target`, `search-panel-focus`, `host-resource-monitoring`, `host-resource-sse-cutover`).
   - **W5:** Source-pinned independent P0 publication receipt and end-to-end container qualification.
