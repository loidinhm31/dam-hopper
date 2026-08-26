# Phase 01 — Contract and Linux Collector

## Context Links

- [Plan overview](./plan.md)
- [Scout report](../reports/scout-external-260813-0926-host-resource-battery-energy.md)
- [Architecture snapshot boundary](../../docs/system-architecture.md#snapshot-boundaries)
- [API host snapshot](../../docs/api-reference.md#get-apisystemresourcesv1snapshot)

## Overview

- **Date:** 2026-08-13
- **Priority:** P2
- **Status:** Completed 2026-08-13 10:15:26 +07:00 (approved)
- **Goal:** define the additive DTO, collect direct Linux battery attributes, and preserve explicit degradation/staleness.

## Key Insights

- The cached v1 snapshot already owns `/sys`, bounded reads, camelCase serialization, and section-level availability.
- `energy_now` is remaining energy in micro-Wh; `power_now` is instantaneous power in micro-W. They are not interchangeable.
- Optional sysfs attributes vary by device. Missing optional values are absent fields, not fabricated zeroes.
- Multi-battery partial sums mislead. Aggregate a measurement only when every classified battery has that direct, like-for-like attribute.

## Approach Decision

| Approach | Advantages | Costs/risks | Decision |
|---|---|---|---|
| Add aggregate `battery` to v1 snapshot | Same sample/cache/availability; additive; one UI source | Must define truthful aggregation | **Select: KISS, fits architecture** |
| Extend legacy `HostMetrics` | Existing fallback UI | Breaks compatibility intent; lacks section availability | Reject |
| Dedicated/per-device power endpoint | Full device detail and independent cadence | New route/query/cache, inconsistent timestamps, unused complexity | Reject/YAGNI |

## Requirements

- Add an always-serialized Rust `battery` section; keep `schemaVersion` at `1` because the change is additive.
- Fields: `count`, optional `capacityPercent`, optional normalized `status`, optional `remainingEnergyWh`, optional `instantaneousPowerW`, and `availability`.
- Recognize only entries whose bounded `type` value is exactly `Battery`; ignore mains/USB supplies.
- Normalize allowlisted statuses (`charging`, `discharging`, `full`, `notCharging`, `unknown`, `mixed`); never expose raw sysfs strings.
- Parse non-negative integers with checked sums; validate capacity `0..=100`; divide micro-Wh/micro-W by `1_000_000` only after checked aggregation.
- Single battery may use direct `capacity`. Multiple batteries expose capacity only from summed `energy_now / energy_full` when every battery provides a valid pair; never average percentages.
- Multiple batteries sum energy or power only when every battery exposes that same direct attribute. Never use `charge_now`, `current_now`, or voltage conversions.
- No power-supply tree/no classified batteries: `unsupported`. Classification permission failure: `permissionDenied`. Malformed present data/no usable values: `temporarilyUnavailable` with stable detail code. Missing optional attributes remain absent.
- Cached deadline/stale paths must mark battery availability stale while retaining the prior measured values.

## Architecture

Data flow: startup-owned `sys_root/class/power_supply` → bounded deterministic collector → `BatterySnapshot` → cached `HostResourceSnapshotV1` → existing REST query. No route, timer, dependency, or mutation boundary changes.

The first implementation step updates the architecture document's data-flow and snapshot-boundary text before product code, preserving the architecture-first gate. No diagram topology change is needed.

## Related Code Files

- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/docs/system-architecture.md` — add power-supply source and truth/aggregation invariants.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/types_v1.rs` — add battery DTO/default/unavailable serialization.
- **Create** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/linux/power_supply.rs` — bounded discovery, parsing, normalization, aggregation, temp-filesystem tests.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/linux/mod.rs` — collect battery data in the existing sample.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/monitor.rs` — propagate stale availability.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/tests.rs` — camelCase/additive JSON and unchanged legacy-shape assertions.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/system/platform.rs` — only if non-Linux/default snapshot initialization needs explicit battery availability coverage; do not expand the trait.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/server/src/api/tests.rs` — protected endpoint battery contract assertion.

## Implementation Steps

1. Amend architecture snapshot boundaries with direct-unit, optional-field, multi-battery, and no-conversion invariants.
2. Define `BatteryStatus` and `BatterySnapshot` beside other v1 sections; initialize unsupported/unavailable states in all constructors.
3. Add `power_supply` collector using sorted `read_dir` entries and `read_bounded_text`; keep parsing/aggregation pure where practical.
4. Classify batteries, normalize status, validate each direct attribute, then compute only complete like-for-like aggregates.
5. Attach the result in Linux collection; keep non-Linux unsupported and legacy sampling untouched.
6. Extend stale propagation so cached battery values cannot appear current after a missed/deadlined sample.
7. Add real temporary `/sys/class/power_supply` fixtures for: one complete battery, energy-only, power-only, two compatible batteries, mixed/incomplete batteries, no battery, malformed/out-of-range/overflow, and permission/error mapping where portable.
8. Assert exact camelCase JSON names, units, finite values, availability, additive endpoint shape, and unchanged legacy keys.

## Todo List

- [x] Update architecture contract first.
- [x] Add battery DTO/status/default states.
- [x] Implement bounded Linux collector and complete aggregation.
- [x] Propagate stale state.
- [x] Add collector, serde, and API tests.
- [x] Confirm no legacy DTO/route/dependency changes.

## Success Criteria

- A complete battery fixture serializes truthful percent/status/Wh/W.
- Partial devices omit unsupported measurements; no fallback `0`, average, or inferred conversion appears.
- Multiple batteries aggregate only complete direct measurements with checked arithmetic.
- Missing, denied, malformed, and stale inputs map to the expected existing availability state.
- `/api/system/metrics` remains byte-shape compatible; snapshot field is additive.

## Risk Assessment

- **Unit confusion:** encode semantic field names and test micro-unit conversions.
- **Partial multi-battery totals:** require all classified batteries for each aggregate.
- **Race during sysfs reads:** degrade section; never fail the whole snapshot.
- **Oversized/invalid values:** reuse bounded reads and checked parse/sum before conversion.

## Security Considerations

- Read only beneath the startup-owned injected sysfs root; requests cannot select paths.
- Do not follow user input, execute commands, persist telemetry, or log raw device contents.
- Keep errors bounded and sanitized through stable detail codes.

## Next Steps

Proceed to [Phase 02](./phase-02-ui-presentation-and-compatibility.md) after Rust DTO names and JSON assertions are stable.
