# Phase 02 — Glance and Diagnostic Disclosure UI

## Context links

- [Plan](./plan.md)
- [Architecture contract](../../../docs/system-architecture.md#host-resource-glance-panel-current-ui)
- [Glance UX research](./research/researcher-01-glanceable-resource-ux.md)
- [Telemetry semantics research](./research/researcher-02-host-telemetry-semantics.md)
- [Phase 01](./phase-01-config-preference-contract.md)

## Overview

- Date: 2026-08-15
- Description: Build the stable top glance projection and move all remaining evidence/controls under one accessible disclosure.
- Priority: P2
- Implementation status: Completed
- Review status: Completed by focused regression validation

## Key Insights

- Compatibility metrics already provide CPU, used memory, default disk, disk inventory, and temperatures at 1s while open; deep snapshot supplies availability-rich memory diagnosis and battery at 15s.
- The header's effective status is already the right always-visible incident surface. Detailed alert evidence can move below disclosure without hiding active state.
- Native `<meter>` fits CPU/memory/storage/battery scalar percentages. Temperature has no trustworthy range; matching layout must not imply one.
- One exact mount pin is enough. No pin uses `HostMetrics.disk`; missing pin shows saved label as missing and keeps compatibility disk only as parenthetical context.

## Requirements

- Render stable top order: Memory used; CPU; selected/pinned storage with `(overall N%)`; every reported temperature sensor; battery/power.
- Memory headline says used and uses finite/clamped `usedBytes / totalBytes`; fall back to deep `totalBytes - availableBytes` only when compatibility memory is absent. Never headline available memory.
- CPU/storage/battery use visible numeric text outside an accessible bounded meter. Omit meter value for unavailable data; never render invalid, stale, missing, NaN, or infinity as `0%`.
- Temperature rows show identity and finite Celsius value in meter-like spacing, but no fill percentage, `role="meter"`, `aria-valuenow`, min/max, or invented severity threshold.
- Battery uses `capacityPercent` as the existing bounded charge reading and adds status plus instantaneous watts when reported; partial/unsupported battery stays explicit.
- Use one real button disclosure, `aria-expanded`/`aria-controls`, Enter/Space operable. Keep its state in popover session memory only; never auto-expand on telemetry/alerts.
- Disclosure owns memory availability/cache/slab/swap/PSI, storage inventory and pin actions, processes/cgroups/scope, alert evidence/history, battery diagnostic extras. Existing active status stays above it.
- Pin controls use clear accessible names and pressed/current state. Save exact mount, clear to default with `null`, disable while pending, and expose save error without stealing focus.
- Preserve current dialog focus trap, initial focus, outside click, close button, Escape restoration, responsive width, read-only wording, and query intervals.

## Architecture

`HostResourcePopover` remains state/query owner. It reads snapshot, alerts, compatibility metrics, Global UiConfig, and the existing update mutation. A small pure projection/resolver in `host-resource-state.ts` normalizes finite values and resolves `pinnedMount` by exact `mountPoint`. New `HostResourceGlance` is presentational. `HostResourceDiagnosis` becomes disclosure detail. This separates scan content from diagnosis without duplicating telemetry logic.

Resolution states: `default` -> `metrics.disk`; `pinned` -> exact entry in `metrics.disks`; `missing` -> saved mount label + unavailable selected value, with `metrics.disk` still rendered only as `(overall ...)`; `unavailable` -> no metrics. Never fall through from `missing` to another disk.

## Related code files

| Absolute path | Action | Purpose |
|---|---|---|
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourcePopover.tsx` | Modify | Own config/mutation/disclosure state; render status, glance, one disclosure. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceGlance.tsx` | Create | Present stable glance rows and semantic meters. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` | Modify | Reduce to a detail orchestrator and keep touched component modules focused. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceStorageDetails.tsx` | Create | Own storage inventory, exact-pin controls, pending/error states, and missing-pin copy. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceIncidentDetails.tsx` | Create | Own current alert evidence, resource incidents, and recent history moved below disclosure. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceDiagnosisRows.tsx` | Modify | Replace task-progress semantics; reuse compact row primitives and disk rows. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/host-resource-state.ts` | Modify | Add pure finite percent, used-memory, battery, and exact pin resolution helpers. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/host-metrics-format.ts` | Modify if needed | Centralize unavailable/compact unit formatting; avoid duplicate rounding. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/queries.ts` | Verify only | Reuse existing queries/mutation and preserve 1s/15s/30s intervals. |

## Implementation Steps

1. Add pure projection helpers. Reject non-finite/non-positive denominators, clamp genuine percentages to 0–100, preserve availability state, and return discriminated storage resolution states.
2. Create one reusable glance row grammar: visible label, visible value/unit, optional detail/state, and native `<meter min={0} max={100}>` only for valid bounded percentages. Keep labels/controls outside meter descendants.
3. Populate rows in fixed order. Render every temperature entry deterministically with `label || source || "Sensor N"`; render invalid entries as unavailable, not zero. Use a neutral decorative track/line only if visual consistency needs it.
4. Resolve memory from compatibility metrics first, deep memory second. Render stale deep availability as stale with last trustworthy value only when clearly labeled; otherwise unavailable.
5. Resolve storage from Global UiConfig. Always label compatibility disk context as `(overall N%)`; never calculate a sum. For missing pin, show the exact requested mount and “missing,” not the default as selected.
6. Project battery status/percent/watts. Keep remaining energy, count, and other diagnostic facts in disclosure to prevent glance overload.
7. Move alert evidence, memory diagnosis, inventory, processes/cgroups/scope, and history into one disclosure. Remove the nested legacy “Host storage” accordion. Split the touched 400+ line diagnosis component at existing incident and storage boundaries; keep the parent as an orchestrator instead of adding more sections to it.
8. Add per-mount pin buttons in the focused storage-details component (`aria-pressed`, mount in accessible name) and a “Use default disk” clear action. Route callbacks through existing update mutation; show pending/error text without affecting monitoring.
9. Keep disclosure state in `HostResourcePopover` so close/reopen during the page session can retain it; reload resets it. Do not add a second config field unless product validation changes this decision.
10. Audit focus order after new controls, 44px targets, forced colors/reduced motion, long path wrapping/truncation with full accessible text, and current dialog keyboard behavior.

## Todo list

- [x] Add pure glance and storage-resolution helpers.
- [x] Create stable ordered glance component and true meters.
- [x] Keep temperature numeric without fake range semantics.
- [x] Consolidate all details and pin controls into one disclosure.
- [x] Wire nullable Global UiConfig mutation and error state.
- [x] Preserve dialog, status, polling, and responsive invariants.

## Success Criteria

- A user sees requested metrics in exact order before expanding anything.
- Memory headline is used; compatibility/default disk is visibly parenthetical, never described as a computed aggregate.
- Every sensor is listed; only true bounded values expose meter semantics.
- Missing pin, stale metric, unsupported battery, invalid number, and deep-snapshot failure each remain distinguishable from zero.
- Disclosure holds every diagnosis/control category and works by pointer, Enter, and Space without focus loss.
- Pin updates only Global UiConfig; alert/status/query behavior remains unchanged.

## Risk Assessment

- Native meter styling varies. Mitigation: test Chromium/forced-colors behavior; retain visible numeric text as truth.
- Deep and compatibility samples have different cadence. Mitigation: display source availability/age; do not combine denominators from different samples.
- Long/dynamic mount and sensor labels can overflow or reorder. Mitigation: preserve producer order, stable keys from source/mount plus index fallback, wrapping/full accessible names.
- Added pin controls expand focus trap. Mitigation: browser-test first/last focus and dynamic disclosure states.

## Security Considerations

- Render telemetry/path strings as text only. No HTML injection, shell, path lookup, or link construction.
- Pin buttons may submit only mount points already present in current metrics; server still enforces bounds. A missing stored pin can only be cleared or replaced.
- Preserve read-only language and omit any remediation affordance. Preference mutation cannot reach host monitoring/actions.

## Next steps

Phase 03 validation, fixture updates, and documentation alignment are recorded in [phase-03](./phase-03-validation-docs.md). Native release signing remains a non-blocking follow-up.

## Completion Notes

Implemented glance-first ordering, exact mount resolution, explicit missing/stale/unavailable states, semantic bounded meters, neutral temperature rows, and a single session-local disclosure containing diagnosis and pin controls. Focused UI validation passed with 171 files and 1073 tests; TypeScript build passed.

## Unresolved Questions

1. Should “overall” remain the current compatibility/workspace disk or require a future true aggregate?
2. Does the neutral temperature row treatment communicate scanability without falsely implying percent/health?
3. Should disclosure openness remain page-session state or persist across reloads?
