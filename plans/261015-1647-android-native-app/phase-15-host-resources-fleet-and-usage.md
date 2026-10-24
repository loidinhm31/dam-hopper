---
title: "Phase 15 — Host resources fleet and usage"
description: "Implement native fleet resources/metrics/alerts and aggregate usage/session analytics with current streaming/fallback semantics."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, resources, metrics, usage, sse]
created: 2026-10-15
---

# Phase 15 — Host resources fleet and usage

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **User approved Cycle 3 review (score 7/10, zero critical issues, documented open limitations deferred to Phase 18 qualification)** (see `plans/reports/code-reviewer-261016-2049-phase-15-cycle-3.md` and `plans/reports/qa-261016-2048-phase-15-cycle-3-verification.md`). Progress: **100%**.
- Scope: H01, U01.
- Goal: Implement native fleet resources/metrics/alerts and aggregate usage/session analytics with current streaming/fallback semantics.
- Implementation completed under `feat/android-native-app` with 398 automated test executions, 1034 static assertions, and clean `assembleDebug` APK build. Physical device/emulator runtime qualification deferred to Phase 18.

## Key Insights

- Full SSE frames can skip revisions; snapshot/metrics pairing uses epoch and exact decimal-string revisions.
- Server telemetry is aggregate-only and does not authorize raw prompt/command views.

## Requirements

- Fleet/server/detail metrics, alerts, explicit freshness/unsupported/degraded state and authenticated SSE lifecycle.
- Documented REST fallback cadence/visibility and one coordinator per owner, preserving 32global/4subject admission limits.
- Usage summaries/session pagination/health/setup/settings/retention and confirmed deletion with exact range/cursor scoping.

## Architecture

Owner-scoped ResourceStreamCoordinator pairs snapshot/metrics and controls visible demand; HostResourceRepository and UsageRepository expose typed bounded state/caches. No observer-per-component duplicate stream or independent client telemetry collector.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/host-resource-sse.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/preferences-settings-and-host-resources.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/agent-usage-and-sessions.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/resource_events.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/host-resource-stream-coordinator.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`

Implemented files:
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/HostResourceSseClient.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostMetricsModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceAlertModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamTimers.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceFrameCommitter.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceFailureHandler.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinator.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageUiState.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/FleetDetailComponents.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/FleetScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourcesUnifiedPanelScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/tests/test-phase-15-host-resources-usage.sh`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/HostResourceModelsTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinatorTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageRepositoryAndControllerTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageControllerLoadingTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/HostResourcesPhase15Test.kt`
No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement snapshot/metrics/alert DTOs and native fleet/detail presentation with null/unsupported versus zero, stale versus fresh and epoch-aware reset.
2. Implement authenticated SSE using current source request/auth contract, exact decimal-string revision comparisons and atomic pairing of snapshot/metrics; accept allowed skipped full-frame revisions.
3. Centralize per-owner subscriber/demand counts and stream teardown; enforce client stream budget consistent with server admission and stop unnecessary visible-detail work on background/navigation.
4. Implement documented REST fallback, polling visibility cadence and recovery without duplicate stream/reconnect loops; auth/MFA/owner replacement invalidates stream state.
5. Implement usage summary/time/model/session filters, opaque scoped cursor pagination/detail and current health/setup/enable/pause/retention/exporter settings.
6. Implement explicit all/date-range deletion confirmation and post-success invalidation; retain server capture-barrier/admission semantics and do not replay ambiguous delete requests.
7. Exercise SSE disconnect/admission denial/proxy buffering/auth expiry/epoch restart/out-of-order and cross-owner frames; then real usage setup/session pagination/range deletion with redacted fixtures.

## Todo List

- [x] Deliver correctly paired resource streams/fallback/fleet UI.
- [x] Deliver all current aggregate usage/session/settings/delete flows.
- [x] Prove visible-demand teardown, freshness and deletion safety.
- [x] Update requirement/evidence ledger and affected docs (completed in scope-and-acceptance.md, plan.md, docs/project-roadmap.md).
- [x] Cycle 2 critical remediations verified: session pagination cursor range scoping on page 2, UTC-day aligned bounds calculation (`UsageBoundsHelper`), and delete failure safety with re-entrancy gating.
- [x] User approved Cycle 3 review (score 7/10, zero critical issues, 398 automated test executions, 1034 static assertions, clean assembleDebug APK build; open limitations deferred to Phase 18).
- [ ] Observe real server filesystem and network outcomes under physical device/proxy execution (live device qualification deferred to Phase 18).

## Phase 15 Completion Record (2026-10-16)

- **Completed:** 2026-10-16
- **Status:** 100% complete (user-approved implementation baseline with documented open limitations and runtime qualification deferred to Phase 18)
- **Validation:** User approved Cycle 3 review (score 7/10, zero critical issues per `plans/reports/code-reviewer-261016-2049-phase-15-cycle-3.md`; open limitations accepted and deferred to Phase 18 qualification). 100% automated pass rate across:
  - 398 automated unit test executions across shared JVM and Android variants:
    - 272 shared JVM unit tests passed (`:shared:jvmTest`, 49 test classes including 4 host feature test classes: `HostResourceModelsTest`, `ResourceStreamCoordinatorTest`, `UsageRepositoryAndControllerTest`, `UsageControllerLoadingTest`)
    - 63 Android debug unit tests passed (`:androidApp:testDebugUnitTest`, 14 test classes including `HostResourcesPhase15Test`)
    - 63 Android release unit tests passed (`:androidApp:testReleaseUnitTest`, 14 test classes including `HostResourcesPhase15Test`)
  - 1034 static invariant assertions across 14 regression suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-15-host-resources-usage.sh` with 81 Phase 15 assertions)
  - Clean `:androidApp:assembleDebug` APK build (55 tasks)
- **Deliverables:**
  - **Transport & SSE Streaming (`HostResourceSseClient.kt`):** Authenticated Server-Sent Events client supporting Bearer token authorization, monotonic revision pairing, reconnect backoff, HTTP 401/403/404/503 status code propagation, lifecycle evaluation, and demand tracking.
  - **Resource & Metrics DTOs (`HostResourceModels.kt`, `HostMetricsModels.kt`, `HostResourceAlertModels.kt`, `ResourceStreamModels.kt`):** Full typed contracts matching server telemetry schemas (`AvailabilityState`, `Availability`, `HostIdentity`, `MemorySnapshot`, `PressureInfo`, `MemoryPressure`, `CgroupMemory`, `ProcessMemory`, `ProcessInventory`, `MountContext`, `BatterySnapshot`, `HostResourceSnapshotV1`, `HostMetrics`, `CpuMetrics`, `MemoryMetrics`, `DiskMetrics`, `ResourceAlertDto`, `ResourceAlertSeverity`).
  - **Resource Stream Coordination Layer (`ResourceStreamCoordinator.kt`, `ResourceFrameCommitter.kt`, `ResourceFailureHandler.kt`, `ResourceStreamTimers.kt`, `HostResourceRepository.kt`):** Per-owner stream coordinator enforcing 32 global / 4 subject stream budgets, visible demand tracking, fallback polling with documented visibility cadence, atomic frame commits, and lifecycle-aware teardown.
  - **Usage Telemetry Models & Repository (`UsageModels.kt`, `UsageSettingsModels.kt`, `UsageRepository.kt`, `UsageUiState.kt`):** Typed models matching `/api/telemetry/usage/*` routes (`TelemetrySummaryDto`, `UsageSessionDto`, `UsageSessionListDto`, `UsageDeleteRangeRequest`, `UsageDeleteAllRequest`, `UsageSettingsDto`, `UsageHealthDto`, `UsageSetupDto`), opaque cursor pagination, range boundaries (`UsageBoundsHelper`), Pause/Resume toggle, and confirmed deletion with UTC-day aligned boundaries (`calculateUtcDayRange`).
  - **Reactive Controllers (`HostResourceController.kt`, `UsageController.kt`):** Generation-fenced controllers with owner binding (`ConnectionRef`), loading states, error handling, session pagination range omission on page 2 (`cursor != null`), delete failure safety, and re-entrancy gating.
  - **Native UI Surfaces & Dialogs (`FleetScreens.kt`, `FleetDetailComponents.kt`, `UsageScreens.kt`, `UsageSettingsSection.kt`, `UsageDialogs.kt`, `ResourcesUnifiedPanelScreen.kt`):** Full Compose UI with segmented tabs ("Fleet Resources" and "Usage & Telemetry") unified under `RESOURCES` panel, honest `--` indicators for null/unconfigured states, UTC-aligned delete range dialog with destructive confirmation, and zero FABs / zero WebViews.
  - **Workbench Navigation Integration (`WorkbenchScreen.kt`):** Wired `ResourcesUnifiedPanelScreen` into `PanelType.RESOURCES` single content area adhering to traditional shell workbench invariants.
  - **Automated Regression Suites:** `HostResourceModelsTest.kt`, `ResourceStreamCoordinatorTest.kt`, `UsageRepositoryAndControllerTest.kt`, `UsageControllerLoadingTest.kt`, `HostResourcesPhase15Test.kt`, and `tests/test-phase-15-host-resources-usage.sh`.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Physical Device & Proxy Runtime Qualification):** Live device SSE streaming verification, HTTP proxy buffering resilience, 32/4 admission denial behavior, real server reconnect loops, and battery/network consumption under backgrounding deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
  - **L2 (Settings Scope & Model Filter Derivation):** Settings controls for enable/exporter/retention/retry (W4) currently read-only (Pause/Resume wired); model filter chips (`UsageScreens.kt`) hardcoded rather than dynamically derived from session/summary models (W5); deferred to Phase 18 qualification.
  - **L3 (Range Delete Boundary Semantics & Date Formatting):** Range deletion `[from, to)` uses `to = todayUtc` (excluding partial today) with epoch millisecond dialog representation (W1, W2); human-readable date formatting and end-of-day boundary options deferred to Phase 18 qualification.
  - **L4 (Stream Lifecycle & Dispatcher Optimization):** SSE/REST payload decoding on background dispatcher, explicit Activity foreground lifecycle bindings, and fine-grained HTTP 401-403 error distinction (W8) deferred to Phase 18 qualification.
- **Handoff:** Phase 15 (Host resources fleet and usage) completed with user approval. Phase 17 (Preferences privacy notifications and lifecycle) has prerequisite Phase 15 satisfied (prerequisites 07, 11, 13, 14, 15 satisfied; remaining prerequisite: Phase 16 pending). Physical hardware and live server qualification deferred to Phase 18.

## Success Criteria

- No mixed epoch/revision UI or rounded numeric revisions; denied/stale resource streams are never presented as fresh zero metrics.
- Stream counts remain bounded across navigation/rotation/profile replacement; REST fallback preserves correct owner.
- Usage shows only allowed aggregate/session projections and rejects stale scoped cursors/deletion ambiguity safely.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Android media/network stacks can buffer or keep SSE active offscreen; actual streaming/proxy proof needed.
- Charts/dashboards can retain unbounded historical samples; define budgets before soak.

## Security Considerations

- No new prompt/response/command/raw event telemetry collection.
- Do not copy internal storage IDs/capability secrets into UI diagnostics or analytics.

## Next Steps

Resource/usage functions join Phase17 integration; independent of terminal/editor feature delivery after shell/transport/auth.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
