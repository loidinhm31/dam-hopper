# Phase 02 — UI Presentation and Compatibility

## Context Links

- [Plan overview](./plan.md)
- [Phase 01 contract](./phase-01-contract-and-linux-collector.md)
- [Frontend host-resource docs](../../docs/frontend-components.md#host-resource-alert-presentation)
- [Current diagnosis component](../../packages/ui/src/components/organisms/HostResourceDiagnosis.tsx)

## Overview

- **Date:** 2026-08-13
- **Priority:** P2
- **Status:** Completed 2026-08-13 11:08:43 +07:00 (approved)
- **Goal:** consume the additive DTO and show precise, accessible rows only for reported values.

## Key Insights

- New clients may connect to old servers, so the TypeScript `battery` property must be optional even though current Rust servers serialize it.
- The diagnosis component already distinguishes values from `Availability`; reuse existing row/metric primitives.
- UI labels must say remaining energy (Wh) and instantaneous power (W), never “current Wh.”

## Requirements

- Mirror the Rust battery/status shape in `HostResourceSnapshotV1` with optional nullable measurement fields.
- Add small finite-number formatters for Wh/W; reject non-finite/negative client values rather than displaying them.
- Render no battery section for absent old-server data, unsupported/no-battery state, or a section with no usable field.
- When present, show battery count/status and capacity; show separate remaining-energy and instantaneous-power rows only when each value exists.
- Preserve stale/degraded availability text beside retained values; never convert absence to `0 Wh`, `0 W`, `0%`, or `Unknown`.
- Do not add polling, local state, charts, alerts, icons, configuration, or a legacy fallback field.

## Architecture

Existing query result → optional `snapshot.battery` → pure validated formatting → existing diagnosis rows. The popover/query/transport paths remain unchanged; REST stays authoritative.

## Related Code Files

- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/src/api/client.ts` — optional additive battery interface.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/src/lib/host-resource-state.ts` — finite Wh/W format helpers if reuse keeps the component simple.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` — conditional battery metrics/rows.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/src/components/organisms/HostResourceDiagnosis.test.tsx` — available, partial, unavailable, stale, and invalid-value render cases.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/src/components/organisms/HostResourcePopover.test.tsx` — only if its typed fixture or full-popover contract needs coverage.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/packages/ui/browser-tests/host-resource-monitoring.browser.tsx` — accessible visible/absent battery regression.

## Implementation Steps

1. Add the optional client DTO using the exact Phase 01 camelCase names and normalized status union.
2. Implement compact finite, non-negative Wh/W formatting at stable precision; keep unit suffixes explicit.
3. Derive usable battery fields without mutating query data. Hide the whole block when nothing trustworthy is displayable.
4. Render battery count/status/capacity plus independent energy and power rows. Reuse `HostResourceMetric`/`HostResourceInfoRow` and availability labels.
5. Add component cases for full data, status/energy-only, power-only, multiple/mixed status, old-server field absence, unsupported, stale, and invalid client values.
6. Add one Chromium test opening the popover and asserting accessible labels, correct Wh/W text, and omission of missing measurements.

## Todo List

- [x] Add old-server-compatible TypeScript DTO.
- [x] Add safe energy/power formatters.
- [x] Render conditional battery rows.
- [x] Add component and browser regressions.
- [x] Verify no query/transport/legacy changes.

## Success Criteria

- Full data shows battery/status, remaining energy in Wh, and instantaneous power in W.
- Energy-only/power-only fixtures show only their truthful row.
- Old/unsupported/malformed payloads do not create misleading battery values or crash rendering.
- Stale values are labeled stale; non-finite/negative values are not rendered.
- Keyboard/open/close behavior and existing host metrics remain unchanged.

## Risk Assessment

- **Terminology regression:** assert exact semantic labels in tests.
- **Old-server compatibility:** optional top-level field and absence test.
- **Crowded popover:** use existing compact rows; no per-device expansion.
- **Malformed payload:** local finite/range guards despite static types.

## Security Considerations

- Render normalized enum/value fields as React text only.
- Do not expose sysfs paths or raw status/device strings.
- No user input, persistence, permission, or mutation surface is introduced.

## Next Steps

Proceed to [Phase 03](./phase-03-documentation-and-release-gates.md) after focused UI tests pass.
