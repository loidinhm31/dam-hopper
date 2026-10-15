# Phase 15 — Host resources fleet and usage

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 06](./phase-06-adaptive-shell-projects-worktrees-and-config.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: H01, U01.
- Goal: Implement native fleet resources/metrics/alerts and aggregate usage/session analytics with current streaming/fallback semantics.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

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

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinator.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/FleetScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt`

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

- [ ] Deliver correctly paired resource streams/fallback/fleet UI.
- [ ] Deliver all current aggregate usage/session/settings/delete flows.
- [ ] Prove visible-demand teardown, freshness and deletion safety.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

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
