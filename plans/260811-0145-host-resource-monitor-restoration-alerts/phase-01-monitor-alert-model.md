# Phase 01 — Monitor signal and keyed alert model

## Context links
`server/src/system.rs`, `types.rs`, `alerts.rs`, `monitor.rs`, `config.rs`, `system/tests.rs`.

## Overview
- **Date:** 2026-08-11
- **Priority:** P1
- **Status:** completed 2026-08-11 03:00:34 +07:00

## Key Insights
`HostMetrics` already carries temperatures/disks; V1 deep snapshot does not. Existing monitor samples about every five seconds and supplies monotonic elapsed time. Independent sensors/disks require keyed state, not one global alert.

## Requirements
Evaluate each finite sensor >60°C for 300000ms; <=60°C, missing, invalid, or unavailable resets it. Alert each real/persistent disk at >=95%; virtual/pseudo filesystems never alert. Bound history/state, dedupe transitions, retain existing memory behavior, and add no collector/task/poll.

## Architecture
Add pure conservative disk classification before alert evaluation. Key targets as `temperature:{source}` and `disk:{mountPoint}`; labels are display evidence only. Advance a bounded keyed lifecycle from the monitor's paired cached legacy sample and `elapsed_ms(started_at)`. Merge transitions into the existing capped incident deque; emit only open/update/resolve.

## Related code files
**Modify:** `server/src/system.rs`, `server/src/system/types.rs`, `server/src/system/alerts.rs`, `server/src/system/monitor.rs`; `server/src/system/config.rs` only if policy needs server-owned defaults.  
**Tests:** `server/src/system/tests.rs`, inline `alerts.rs`/`monitor.rs` tests.  
**Create/Delete:** none.

## Implementation Steps
1. Add fixture-tested classifier: reject proc, sysfs, tmpfs, devtmpfs, cgroup, overlay, squashfs, ramfs, fuse-control style, and invalid/zero-capacity mounts; fail closed if unclassifiable.
2. Add thermal/disk evidence and reusable keyed lifecycle state without rewriting current memory engine.
3. Implement exact threshold/reset/recovery/cooldown semantics with stable IDs.
4. Feed only successful legacy sample + monotonic timestamp in monitor update; cap active/history state.
5. Add tests before handing DTO changes to Phase 02.

## Todo list
- [x] Classify real/persistent disks conservatively.
- [x] Add keyed thermal/disk transition state and evidence.
- [x] Wire paired monitor update and bounded incident merge.
- [x] Cover thresholds, resets, recovery, dedupe, cap, pseudo exclusion.

## Validation
- User-approved focused Rust validation: 58 tests passed.
- `cargo check` passed for all targets.
- Scoped `rustfmt` and diff check passed.

## Success Criteria
299999ms hot does not open, 300000ms does; every independent valid target has one recoverable incident; unavailable values never count as healthy; no added cadence/concurrency path.

## Risk Assessment
`sysinfo` metadata varies by Linux host. Conservative deny/fail-closed logic can omit an uncertain disk but prevents a false host alert; fixtures must cover observed filesystem forms.

**Resolved in Phase 02:** normalized host samples retain only the deterministic, bounded target prefix before `BTreeMap` growth.

## Security Considerations
Evidence includes only bounded source/label/mount and numeric readings; no commands, environment, credentials, arbitrary paths, or raw collection errors. Do not hold cache locks over filesystem work.

## Next steps
Phase 02 extends the existing API/SSE contract from this additive state model.
