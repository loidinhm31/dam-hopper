---
title: "Phase 16 — Ports tunnels idle consent and host controls"
description: "Expose current remote host/port/tunnel/maintenance capabilities without pretending Android is the execution host."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, ports, tunnels, cloudflared, host]
created: 2026-10-15
---

# Phase 16 — Ports tunnels idle consent and host controls

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **User approved Cycle 2 review (score 7/10, zero critical issues, documented open limitations deferred to Phase 18 qualification)** (see `plans/reports/code-reviewer-261016-2345-phase-16-cycle-2.md` and `plans/reports/tester-261016-2245-phase-16-ports-tunnels-host-controls.md`). Progress: **100%**.
- Scope: P01, H02, C03 remote host actions.
- Goal: Expose current remote host/port/tunnel/maintenance capabilities without pretending Android is the execution host.
- Implementation completed under `feat/android-native-app` with 417 automated unit test executions, 1228 static assertions, and clean `assembleDebug` APK build. Physical device/emulator runtime qualification deferred to Phase 18.

## Key Insights

- Explicit Cloudflared tunnels outlive PTY/origin loss and remain public until stopped; 3h reminder is not expiry.
- Idle consent is bound to a live WS capability; general host-action executor is currently unavailable by server design.

## Requirements

- Remote ports and Cloudflared install/status/create/list/stop/reminder catch-up.
- Idle status/timing/force/consent with capabilities/request revisions and current role/session freshness.
- Remote SSH credential status/load/forget, diagnostics/cache/reset and current host-action capability/audit presentation; no invented updater/restart APIs.

## Architecture

HostControlRepository and TunnelRepository use explicit server owner; exact-socket receipt is requested only for current consent decision. UI distinguishes command admission, current status and observed execution result.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/system-services.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/idle-suspend.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/agent-store-ports-and-browser.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/system-architecture.md`

Implemented files:
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/TunnelModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostActionModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/DiagnosticsModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/TunnelRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/DiagnosticsRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortsDialogs.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/PortsPanelScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendDialogs.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/tests/test-phase-16-ports-tunnels-host-controls.sh`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentControllerTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/PortsAndTunnelsRepositoryTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/SshAndDiagnosticsRepositoryTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/PortsAndHostControlsPhase16Test.kt`
No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement owner-qualified detected port/tunnel list and explicit Cloudflared install/create/stop flows; mark public exposure, failed/ready/stopped state and current server installation capability.
2. Re-list tunnels after reconnect and reconcile authoritative reminderDue; preserve tunnel identity across port/PTy owner loss, no automatic stop or server-restart restore.
3. Implement idle-suspend status, server capability/reason and mutable complete timing pair; keep startup-owned policy/agent matchers read-only where contract requires.
4. Render pending consent with expiry/revision and explicit approve/deny; obtain exact live-socket connectionId/decisionCapability at action time and discard it on termination.
5. Implement force-suspend request/denial/outcome presentation with explicit host label; uncertain acknowledgement does not auto-retry or claim host already slept.
6. Implement remote SSH key/agent/status/load/forget without local SSH-forwarding engine; maintain server-only credential custody and passphrase interaction rules from actual API.
7. Implement diagnostics export/cache/reset and routed host-action capability/audit/intent flow only where server advertises actual support; preserve unavailable reasons and never add client privilege bypass/updater/restart functionality.
8. Exercise real tunnel origin/PTy loss and explicit Stop/reminder catch-up, stale-socket consent/revocation races, unsupported host actions and isolated maintenance/reset effects. Real host suspend remains an operator-controlled acceptance environment.

## Todo List

- [x] Deliver remote ports/tunnels and exposure/reminder semantics.
- [x] Deliver exact-capability idle controls and truthful host state.
- [x] Deliver existing SSH/maintenance/capability UI without invented execution paths.
- [x] Update requirement/evidence ledger and affected docs (completed in scope-and-acceptance.md, plan.md, docs/project-roadmap.md).
- [x] Cycle 2 remediations verified: pending consent cleared when non-pending, lag hint handling with hit counter, per-key credential SSH status/load/forget by basename, sleep consent banner countdown and receipt gating, atomic updates, and redactions.
- [x] User approved Cycle 2 review (score 7/10, zero critical issues, 417 automated test executions, 1228 static assertions across 15 suites, clean assembleDebug APK build; open limitations deferred to Phase 18).
- [ ] Observe real server host suspend and Cloudflared execution under physical device execution (live device qualification deferred to Phase 18).

## Phase 16 Completion Record (2026-10-16)

- **Completed:** 2026-10-16
- **Status:** 100% complete (user approved Cycle 2 review score 7/10, open limitations deferred to Phase 18)
- **Validation:** User approved Cycle 2 review (score 7/10, zero critical issues per `plans/reports/code-reviewer-261016-2345-phase-16-cycle-2.md`; open limitations accepted and deferred to Phase 18 qualification). 100% automated pass rate across:
  - 417 automated unit test executions across shared JVM and Android variants:
    - 281 shared JVM unit tests passed (`:shared:jvmTest`, 52 test classes including `IdleConsentControllerTest`, `PortsAndTunnelsRepositoryTest`, `SshAndDiagnosticsRepositoryTest`)
    - 68 Android debug unit tests passed (`:androidApp:testDebugUnitTest`, 15 test classes including `PortsAndHostControlsPhase16Test`)
    - 68 Android release unit tests passed (`:androidApp:testReleaseUnitTest`, 15 test classes including `PortsAndHostControlsPhase16Test`)
  - 1228 static invariant assertions passed across 15 suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-16-ports-tunnels-host-controls.sh` with 194 Phase 16 assertions)
  - Clean `:androidApp:assembleDebug` APK build (65 tasks, 37.7 MB)
- **Deliverables:**
  - **Port & Tunnel Models & Repositories (`PortModels.kt`, `TunnelModels.kt`, `PortRepository.kt`, `TunnelRepository.kt`):** Port and tunnel state enums (`DetectedVia`, `PortState`, `TunnelStatus`), typed REST contracts (`PortListResponse`, `DetectedPort`, `TunnelSession`, `CreateTunnelRequest`, `InstallStatusResponse`), REST endpoints (`/api/ports`, `/api/tunnels`, `/api/tunnels/install`), WebSocket wire events (`ServerMsg.PortDiscovered`, `ServerMsg.PortLost` with incarnation fencing, `ServerMsg.TunnelReady`, `ServerMsg.TunnelFailed`, `ServerMsg.TunnelStopped`, `ServerMsg.TunnelReminder` marking `reminderDue = true`), tunnel creation/stop flows, and public exposure URL copy.
  - **Idle Suspend Models, Repository & Consent Controller (`IdleSuspendModels.kt`, `IdleSuspendRepository.kt`, `IdleConsentController.kt`, `ServerMsg.IdleSuspendChanged`):** Typed contracts (`IdleSuspendStatusV1`, `IdleSuspendTimingPatchRequest`, `ForceSuspendRequest`, `ForceSuspendAcceptedResponse`, `ConsentDecisionRequest`, `ConsentDecisionResponse`, `IdleSuspendConflictResponse`), wire normalization fallback for unsupported server responses, fail-closed live WebSocket capability receipt gating (`val receiptProvider: () -> UiConnectionReceipt?`), lag reconciliation (`rev == 0L || rev > _lastRevision.value`), non-retrying force suspend with conflict handling (`IdleSuspendActiveFleetConflictException`, `IdleSuspendFleetChangedConflictException`, `IdleSuspendHandoffConflictException`), and `decisionCapability=[REDACTED]` security string masking.
  - **SSH, Host Control & Diagnostics Repositories (`SshModels.kt`, `HostActionModels.kt`, `DiagnosticsModels.kt`, `SshRepository.kt`, `HostControlRepository.kt`, `DiagnosticsRepository.kt`):** SSH agent status (`SshAgentStatus`), per-key credential lifecycle (`GET /api/ssh/keys`, `GET /api/ssh/agent`, `POST /api/ssh/keys/load`, `/api/ssh/credentials`), passphrase redaction (`passphrase=[REDACTED]`); routed host action capabilities and intents (`GET /api/system/actions/v1/capabilities`, `POST /api/system/actions/v1/intents`, approve intent with masked password, executions with redacted approval token, audit events); diagnostics export (`POST /api/diagnostics/export`) with `includeTerminalOutput` flag and honest in-memory server daemon acknowledgement.
  - **Native UI Surfaces, Dialogs & Workbench Wiring (`PortsPanelScreen.kt`, `PortsDialogs.kt`, `IdleSuspendDialogs.kt`, `HostControlScreens.kt`, `WorkbenchScreen.kt`):** Compose workbench integration under `PanelType.PORTS` (`PortsPanelScreen`) and `PanelType.SSH_HOST` (`HostControlScreens`); top `WorkbenchSleepConsentBanner` with ticking countdown and live receipt gating; install Cloudflared dialog, create tunnel dialog, QR code dialog, force suspend dialog, SSH key load and per-key forget dialogs; strict zero FABs and zero WebViews invariants preserved.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Action Error Clearing & Banner Surfacing):** `_actionError` cleared at start of `refreshStatus()` and banner/force dialog unrendered error surfacing (High-1); split mutation vs refresh errors and render failure banner deferred to Phase 18 qualification.
  - **L2 (Reconnect Reconciliation):** Lack of auto-refresh on new WebSocket receipt / reconnect without server initial push (High-2); coalesced receipt-triggered refresh deferred to Phase 18 qualification.
  - **L3 (Default Key Forget Verification):** Default credential forget UI handling HTTP 200 `success:false` keyring errors and `checkAgent`/`getCapabilities` silent failures (High-3) deferred to Phase 18 qualification.
  - **L4 (WebSocket Conflation & Single-Flight Refresh):** Unconflated WS message launching and single-flight revision fencing in `refreshStatus` (W-A), mixed-owner window on profile init failure (W-B), and port/tunnel create/stop error visibility (W-C) deferred to Phase 18 qualification.
  - **L5 (Physical Device & Live Server Host Qualification):** Real Android device lifecycle, physical suspend/resume triggers, real Cloudflared daemon installation, and live daemon credential caching deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
- **Handoff:** Phase 16 (Ports tunnels idle consent and host controls) completed with user approval. Phase 17 (Preferences privacy notifications and lifecycle) is now fully unblocked (prerequisites 07, 11, 13, 14, 15, and 16 all satisfied). Physical hardware and live server qualification deferred to Phase 18.

## Success Criteria

- Origin loss does not close a live tunnel; Stop affects correct owner ID and stale events cannot mutate replacements.
- HTTP-only/stale receipt or wrong revision cannot approve suspend; admission response is not labelled actual suspension.
- Server-unavailable host actions are explicit; no Android-local executor, generic restart/updater or hidden SSH forwarding.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Testing suspend/reset on a real development host is disruptive; use operator-selected isolated host and disposable projects.
- Public exposure survives origin replacement; warnings and retained tunnel list must remain accurate.

## Security Considerations

- Decision capabilities/passphrases/diagnostic content redacted and never persisted.
- Explicit destructive confirmation and current role/session checks; no automatic force/retry on denied or ambiguous actions.

## Next Steps

Phase17 integrates settings/privacy and lifecycle for these controls; Phase18 qualifies supported host/OS combinations only.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
