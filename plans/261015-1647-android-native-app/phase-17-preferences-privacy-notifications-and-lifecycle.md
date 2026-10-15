# Phase 17 — Preferences privacy notifications and lifecycle

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 07](./phase-07-terminal-sessions-replay-input-and-agents.md), [Phase 11](./phase-11-encrypted-transfers-media-and-storage.md), [Phase 13](./phase-13-workflow-tracking-and-project-plans.md), [Phase 14](./phase-14-agent-store-imports-and-memory.md), [Phase 15](./phase-15-host-resources-fleet-and-usage.md), [Phase 16](./phase-16-ports-tunnels-idle-consent-and-host-controls.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: C02–C03, N01, V01.
- Goal: Integrate complete settings/privacy/accessibility and lifecycle behavior across all included native surfaces.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Cognito is an ephemeral visual/input mask, not OS-wide secrecy or authentication.
- Foreground Android network/process survival is not guaranteed; restore metadata and authoritative state, not secret/dirty-byte guesses.

## Requirements

- Separate local/native preferences, remote preference source and Settings target; current import/export/config presentation.
- Fonts/theme/shortcuts/accessibility/notification permissions and native privacy/input isolation.
- Background/foreground/navigation/rotation/process recreation without cross-owner leaks or remote session destruction.
- Settings/imported preferences cannot re-enable IDE/Runtime modes, floating buttons, or secondary panel navigation; adapt only the supported TERMINAL/Traditional shell.
- Validated presentation is fixed: top row below server/project header, icon + short text buttons, horizontal single-line scrolling, always visible with IME, one selected content area on every screen size and no wide-screen terminal/panel dock. Preferences/import cannot change these release constraints.

## Architecture

SettingsRepository/PrivacyController coordinate shared preference state with Android lifecycle and system adapters. Input must be blocked at terminal/editor dispatch boundary as well as overlay; all feature coordinators implement ownership-aware teardown/rebaseline.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/code-standards.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/preferences-settings-and-host-resources.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/frontend-components/notifications-and-privacy.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/EditorTabs.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/workspace-settings.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/PrivacyController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/SettingsImportExport.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement current local/shared and remote preference fields with correct source selectors/persistence; expose system font separately from terminal/editor fonts and keep unsupported remote values visible.
2. Implement TOML import/export via SAF,1MiB boundary and server validation/backup/reload semantics; label exact owner and preserve startup-only settings restrictions.
3. Integrate theme/font/zoom/shortcuts/sound/vibration/status filters and accessible sizing of the same TERMINAL/Traditional shell. Preserve the top icon + short text panel row below server/project header, horizontal single-line scrolling and IME visibility. Keep one selected content area on every screen size; no alternate-mode setting, More menu, floating quick-access, second navigation or wide-screen terminal/panel dock.
4. Implement notification permission/channel/foreground/background settings and exact-target deep links; stale/removed resources cannot activate another profile, and lock-screen messages contain no sensitive terminal/file content.
5. Implement Cognito opaque/blur-capable presentation with fail-safe opaque option; block terminal/editor/menu/clipboard/hardware/IME/accessibility interactions before/while covered, restore focus safely and keep activation ephemeral.
6. Implement lifecycle demand pause/rebaseline for SSE/usage/watches/media; preserve remote PTY ownership across app background and rebuild on process recreation without replaying input or restoring secret capabilities.
7. Complete profile logout/endpoint change cleanup across transfers/media/notifications/workflow/import/cache and recover dirty visible buffers safely; no promise of persistent unsaved-byte recovery beyond approved policy.
8. Exercise mask with focused terminal/editor/IME/dialogs and hardware keys; rotate/fold/back/background/kill/relaunch during active transfers/consent/dirty edits and verify visible supported recovery states.

## Todo List

- [ ] Complete current settings/import/export and native accessibility.
- [ ] Prove privacy and permission-safe notification behavior.
- [ ] Integrate cross-feature lifecycle/owner retirement without hidden data loss claims.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- While masked no terminal/editor input or destructive accessibility action reaches underlying resources; deactivation restores expected focus.
- System font changes do not alter independent terminal/editor font settings; preferences reach correct remote source.
- Process recreation/reconnect preserves server execution and eligible navigation only; stale capabilities/notifications cannot control a replacement owner.
- IME, rotation, imported preferences and accessibility preserve the top icon + short text row below the server/project header, always visible with IME, and one selected content area on every screen size. All panels remain reachable by horizontal row scrolling; no floating/secondary navigation, More menu or wide-screen terminal/panel dock appears.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Compose overlays alone may miss AndroidView/native IME/accessibility events; validate actual focused surfaces.
- Resume can multiply streams/watchers or issue duplicate writes; original-owner lifetime/rebaseline mandatory.

## Security Considerations

- No new OS screenshot guarantee; screenshots/recents/notifications require accurately documented policy, not implied protection.
- No secrets in backups/imports/exported settings/deep links; notification payloads owner-qualified and redacted.

## Next Steps

All included behavior is integrated; Phase18 begins comprehensive release qualification, not more untracked feature deferrals.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
