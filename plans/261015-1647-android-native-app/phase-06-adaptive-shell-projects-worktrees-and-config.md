# Phase 06 — TERMINAL Traditional shell projects and configuration

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 04](./phase-04-profiles-auth-mfa-and-credential-vault.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: C01–C02, NAV01; G02 navigation.
- Goal: Implement the TERMINAL-only Traditional Android workspace with one button row for all panels and no floating buttons, preserving explicit owner/project/worktree routing.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Selected project/worktree, Settings target and preference source are separate concepts.
- Workspace switch/reset can dispose remote PTYs; simple navigation must not.

## Requirements

- Phone/tablet/foldable sizing of the same TERMINAL + Traditional shell, back-stack/focus/IME behavior, profile/project badges and explicit unavailable state; no IDE or Runtime shell/mode selector.
- Workspace registry/discovery/init/switch, project config/commands and root/worktree selection.
- No terminal process lifetime tied to navigation, configuration refresh or orientation.
- Exactly one top panel-button row below the server/project header: icon + short text, horizontally scrollable on narrow widths, selected-button reveal, always visible with the software keyboard open. Never wrap, hide destinations behind a More menu, or add a second bar/rail/drawer.
- No floating buttons/FABs/draggable launchers/floating file-panel toggles. Session-create and panel actions are inline in the row or active panel.
- One selected content area on phones, tablets and foldables. A panel replaces terminal visuals while retaining qualified sessions/controllers; no wide-screen terminal/panel dock. Only active content accepts input.

## Architecture

Shared navigation has one TERMINAL/Traditional shell, an explicit complete PanelRegistry, one PanelNavigationRow and an owner-qualified PanelHost. Android adapts size/insets, not workspace mode; controllers remain outside visible panel composition. Files/editor and management views are panels, not an IDE shell. Remote TOML/config remains server-authoritative.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/rest-endpoints.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/workspace-settings.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/workbench-files-editor-and-git.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/stores/project-target.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/workspace-mode.ts` — reference mode meanings only; do not port its IDE default.
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/terminal-usage-mode.ts` — reference Traditional versus Runtime only.

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/WorkbenchNavigation.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelRegistry.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelNavigationRow.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelHost.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Build the sole TERMINAL/Traditional shell and complete panel registry. Place one single-line, horizontally scrollable icon + short text button row below the server/project header for every included panel; keep it visible with IME. Use one selected content area on all screen sizes, retaining hidden terminal/editor controllers. No mode switchers, floating buttons, More menu, alternate navigation or wide-screen terminal/panel docking; reveal the selected button.
2. Implement workspace/project listing/status/known registry/discovery and command/profile selection over exact current APIs.
3. Implement root/worktree discovery, nested-project projection, unavailable/prunable/bare/locked/detached states and current target selection; switching never sends cd or checks out existing PTYs.
4. Implement config/project/global defaults/UI read/edit flows; retain draft field identity and dirty/conflict state across refresh without overwriting user input.
5. Implement workspace init/switch and registry add/remove with target labels and explicit warning that switch reinitializes server workspace/disposes PTYs.
6. Keep new-worktree creation/removal mutations for Phase12; guard navigation to stale targets and preserve existing dirty tabs/orphaned session presentation.
7. Exercise same-name projects on two profiles, nested worktrees, rotation/navigation/tab return and remote workspace switch; observe resource lifetime and correct request targets.
8. Exercise every panel button on minimum-width phone, tablet/foldable, rotation and IME transitions. Verify top placement below server/project header, icon + short text labels, one horizontally scrolling row visible with IME, one selected content area, no floating/secondary navigation or wide-screen dock, and return to the same live terminal/editor controllers.

## Todo List

- [ ] Deliver the TERMINAL/Traditional-only shell and complete single-row panel navigation with no floating controls.
- [ ] Implement workspace/project/remote-config flows.
- [ ] Exercise target isolation and destructive-switch confirmation.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- User can choose profile/project/root/worktree and return to a still-live terminal/editor without duplicate local controllers.
- Settings/preference changes reach only the selected remote owner.
- Unavailable targets fail closed; navigation never silently redirects an already-bound resource to root.
- Every included panel is reachable through the sole top icon + short text row below the server/project header, including while IME is open. One selected content area is used on every screen size; hidden sessions/controllers remain alive. No IDE/Runtime selector, More menu, second navigation surface, floating button or wide-screen terminal/panel dock.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Phone navigation can accidentally recreate terminal widgets or hide ownership; controllers and route identities must remain stable.
- Config refetch can erase drafts/focus; preserve field identity and pending edits.

## Security Considerations

- Remote server validates paths/worktree membership; client labels are not authorization.
- Destructive workspace/config operations require explicit user intent, no automatic POST replay.

## Next Steps

Phase07/08 and independent feature screens integrate through this shell; Phase12 completes worktree mutations.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
