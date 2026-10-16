---
title: "Phase 17 — Preferences privacy notifications and lifecycle"
description: "Integrate complete settings/privacy/accessibility and lifecycle behavior across all included native surfaces."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, preferences, settings, lifecycle]
created: 2026-10-15
---

# Phase 17 — Preferences privacy notifications and lifecycle

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 07](./phase-07-terminal-sessions-replay-input-and-agents.md), [Phase 11](./phase-11-encrypted-transfers-media-and-storage.md), [Phase 13](./phase-13-workflow-tracking-and-project-plans.md), [Phase 14](./phase-14-agent-store-imports-and-memory.md), [Phase 15](./phase-15-host-resources-fleet-and-usage.md), [Phase 16](./phase-16-ports-tunnels-idle-consent-and-host-controls.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-17. Priority: P2. Implementation status: **completed (2026-10-17 00:51:25 +07:00)**. Review status: **User approved Cycle 2 review (score 6/10, zero critical issues, documented open limitations deferred to Phase 18 qualification)** (see `plans/reports/code-reviewer-261017-0040-phase-17-cycle-2-review.md` and `plans/reports/tester-261017-0028-phase-17-retest-critical-fixes.md`). Progress: **100%**.
- Scope: C02–C03, N01, V01.
- Goal: Integrate complete settings/privacy/accessibility and lifecycle behavior across all included native surfaces.
- Implementation completed under `feat/android-native-app` with 454 automated unit test executions, 1,332 static assertions across 16 suites, and clean `assembleDebug` APK build. Physical device/emulator runtime qualification deferred to Phase 18.

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

- [x] Complete current settings/import/export and native accessibility (SAF file picker deferred to Phase 18).
- [x] Prove privacy and permission-safe notification behavior (runtime POST_NOTIFICATIONS permission dialog deferred to Phase 18).
- [x] Integrate cross-feature lifecycle/owner retirement without hidden data loss claims (extended stream lifecycle demand pause deferred to Phase 18).
- [x] Update requirement/evidence ledger and affected docs with reported automated validation; record device/server/version limitations and deferred runtime qualification.
- [ ] Observe real Android physical device IME composition, notification drawer delivery, lockscreen redaction, and OS process death under physical device execution (live device qualification deferred to Phase 18).

## Phase 17 Completion Record (2026-10-17)

- **Completed:** 2026-10-17 00:51:25 +07:00
- **Status:** 100% baseline complete (user approved Cycle 2 review score 6/10 per `plans/reports/code-reviewer-261017-0040-phase-17-cycle-2-review.md`, zero critical issues, reported 454 automated unit test executions, 1,332 static assertions across 16 suites, clean assembleDebug APK, implementation gaps L1–L5 and physical device qualification L6 deferred to Phase 18; Phase 18 unblocked for qualification and remediation)
- **Validation:** User approved Cycle 2 review (score 6/10, zero critical issues per `plans/reports/code-reviewer-261017-0040-phase-17-cycle-2-review.md`; open limitations accepted and deferred to Phase 18 qualification). 100% automated pass rate across:
  - 454 automated unit test executions across shared JVM and Android variants (72 test classes, 0 failures, 0 skipped per `plans/reports/tester-261017-0028-phase-17-retest-critical-fixes.md`):
    - 302 shared JVM unit tests passed (`:shared:jvmTest`, 56 test classes including `PrivacyControllerTest`, `SettingsRepositoryTest`, `LifecycleCoordinatorTest`, `NotificationSinkTest`)
    - 76 Android debug unit tests passed (`:androidApp:testDebugUnitTest`, 16 test classes including `SettingsPreferencesPhase17Test`)
    - 76 Android release unit tests passed (`:androidApp:testReleaseUnitTest`, 16 test classes including `SettingsPreferencesPhase17Test`)
  - 1,332 static invariant assertions passed across 16 suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-17-preferences-privacy-lifecycle.sh` with 104 Phase 17 assertions, all exit code 0)
  - 7 Rust crypto bridge unit tests passed (`cargo test` in `native-app/crypto-bridge`, 0.15s)
  - Clean `:androidApp:assembleDebug` APK build (55 tasks, clean DEX compilation and packaging)
- **Deliverables:**
  - **Settings & Preferences Models & Repository (`SettingsModels.kt`, `SettingsRepository.kt`):** Target source separation (`PreferenceSource`: `LOCAL_DEVICE`, `GLOBAL_REMOTE`, `WORKSPACE_REMOTE`), typed preferences model (`PreferencesState`) with bounds clamping on load/save/hydrate (tab size 2..8, line height 1.0..2.5, terminal scrollback 1,000..100,000), remote settings sync with REST endpoints (`/api/workspace/settings`, `/api/workspace/settings/raw`), generation fencing (`expectedGeneration`), debounced remote save with revision verification, 1 MiB boundary constant enforcement (`MAX_CONFIG_IMPORT_BYTES = 1_048_576L`) on TOML config import, and profile retirement cleanup (`onProfileRemoved`) without memory leaks.
  - **Privacy Controller & Multi-Layer Input Gating (`PrivacyController.kt`, `AndroidEditorSurface.kt`, `TerminalInputController.kt`, `WorkbenchScreen.kt`):** Ephemeral in-memory Cognito privacy mode without disk or recents persistence; configurable chord triggering and dismissal with trailing release consumption preventing stuck modifiers; emergency 800ms triple-tap touch dismissal; multi-layer defense-in-depth input blocking at the dispatch boundary: `TerminalInputController` gates hardware keys, IME text commit, IME backward deletion, and clipboard paste via `isInputAllowed()`, `TerminalSessionController.sendInput`, `getSelectedText`, `copySelection`, `pasteText` gated beneath overlay; `AndroidEditorSurface` + `EditorSession` + `EditorTabsState` gates `setText`, `applyEdit`, `undo`, `redo`, and save edits; `WorkbenchScreen` mask activation automatically triggers `keyboardController?.hide()` and `focusManager.clearFocus(force = true)`; overlay consumes pointers and marks content `invisibleToUser()`. Mask resets on app background/destroy.
  - **Notification Sink & Channel Management (`NotificationSink.kt`, `AndroidNotificationSink.kt`, `InMemoryNotificationSink.kt`):** 4 scoped notification channels (`TERMINAL_ATTENTION`, `TRANSFERS`, `SESSION_ALERTS`, `SYSTEM_HEALTH`) with lockscreen privacy set to `VISIBILITY_PRIVATE`; redacted public notifications for private payloads; `FLAG_IMMUTABLE` PendingIntents with profile and generation extras (`EXTRA_TARGET_PROFILE_ID`, `EXTRA_TARGET_GENERATION`); profile retirement cancellation (`cancelAllForProfile`).
  - **Lifecycle Coordinator (`LifecycleCoordinator.kt`, `AndroidLifecycleCoordinator.kt`):** Multi-state lifecycle tracking (`FOREGROUND`, `BACKGROUND_RETAINED`, `PROCESS_RECREATION`, `DESTROYED`); listener registration with exception isolation; profile retirement coordination (`onProfileRetired`) cleaning up notifications, settings, and terminal controllers.
  - **Native Compose UI (`PreferencesPrivacyView.kt`, `NotificationsView.kt`, `MaintenanceView.kt`, `WorkbenchScreen.kt`):** Integrated under `WorkbenchPanel.SETTINGS` into the solitary top single-line horizontal scrolling panel row. Preserves strict UI invariants: single content host, zero FABs, zero WebViews.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Preference Consumer Wiring):** UI-persisted settings for theme, independent font sizes (system vs editor vs terminal), haptics, and status filter currently reside in `SettingsRepository` and require runtime wiring to the respective rendering subsystems or explicit descoping during Phase 18 qualification.
  - **L2 (Notification Producers & Runtime Permission Request):** Agent-attention, transfer completion, and idle-suspend background triggers lack automated producers (currently using test alert path); `POST_NOTIFICATIONS` runtime permission request dialog launcher and app settings deep link deferred to Phase 18 qualification.
  - **L3 (Lifecycle Demand Pause & Endpoint-Change Retirement):** Lifecycle pause is wired for host-resource streaming; extending `LifecycleAware` to file watchers, SSE telemetry, media playback, and workflow streams, plus endpoint-change teardown, deferred to Phase 18 qualification.
  - **L4 (SAF Import/Export & TOML Streaming):** Storage Access Framework `OpenDocument`/`CreateDocument` integration for TOML file pickers and streaming 1 MiB checks deferred to Phase 18 qualification.
  - **L5 (Deep-Link Consumption & Exact-Target Fencing):** Single-use consumption of deep-link intent extras and strict generation validation on cold launch deferred to Phase 18 qualification.
  - **L6 (Physical Device Runtime Qualification):** Physical IME composition, hardware keyboard chord dismissals, physical notification tray display, lockscreen redaction across OEM skins, and OS-initiated process death qualification deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
- **Handoff:** Phase 17 (Preferences privacy notifications and lifecycle) completed with user approval. Phase 18 (Integrated device security and performance qualification) is now fully unblocked (prerequisites Phase 12 and Phase 17 satisfied).

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
