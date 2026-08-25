# Phase 01: Live Runtime and API

## Context Links

- [Parent plan](./plan.md)
- [Telemetry architecture](../../docs/system-architecture.md#terminal-usage-analytics)
- [Current startup wiring](../../server/src/main.rs)
- [Usage API](../../server/src/api/usage.rs)

## Overview

- Priority: P1
- Status: completed (2026-07-26 15:21 +07, Asia/Ho_Chi_Minh)
- Goal: turn startup-only telemetry and collector wiring into an authenticated live runtime lifecycle.

## Key Insights

- `PtySessionManager` currently receives a fixed sink/classifier/control at startup; enabling config later cannot capture anything.
- A disabled runtime has no store/worker, so summary correctly returns 503 today.
- Existing reader threads must not be retrofitted mid-run; live activation applies to newly created PTYs.

## Requirements

- `enable` opens DB/key, starts bounded worker, publishes active handle, applies retention, then starts enabled collector.
- `disable` stops collector first, disables admission, drains/stops worker, retains DB, and publishes unavailable/disabled status.
- Reconfigure collector host/port live with stop-before-bind, rollback on bind/config failure, loopback validation, and no orphan task.
- All setup mutations serialize with delete, retention, and settings updates; public config is persisted only after runtime transition succeeds or safely rolled back.
- Usage API exposes a setup-safe status and one protected action endpoint; no secret in DTO/log/error.

## Architecture

```text
Settings action -> usage setup API -> TelemetryRuntime lock
  -> store/key + worker -> proxy sink for new PTYs -> optional loopback collector
  -> persisted DamHopper telemetry config -> aggregate health/status
```

Use a stable runtime proxy/sink and classifier source owned by `TelemetryRuntime`; `PtySessionManager` receives it once. New terminals resolve the current runtime state. Keep the current bounded worker and `try_send` boundary unchanged.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/main.rs` — construct runtime once; remove duplicated startup-only lifecycle.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/state.rs` — own/share runtime lifecycle and serialized transition state.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/runtime.rs` — active/disabled worker, proxy sink/classifier, rollback, stop/drain.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/{mod.rs,sink.rs,worker.rs}` — export runtime interfaces and preserve admission semantics.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs` — obtain telemetry capture state only at new PTY run boundary.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/{usage.rs,router.rs}` — setup/status DTO/action and live collector reconfiguration.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` and telemetry tests.

## Implementation Steps

1. Extract store/key/worker construction from `main.rs` into a fallible runtime activation method.
2. Add a single transition mutex; snapshot old state before mutating config/runtime.
3. Give PTY creation a stable proxy that drops while disabled and forwards only to the active bounded worker.
4. Keep start-of-run capture immutable: Settings explains that a newly opened terminal is required after enabling.
5. Add protected `GET` setup/status and `POST/PATCH` setup action contracts. Reuse existing usage query invalidation.
6. Stop collector before disabling/replacing worker; await collector task outside locks; worker shutdown flushes pending records before handle replacement.
7. Persist config atomically only after activation; on persist failure restore prior live state.

## Todo List

- [x] Live activate/deactivate implementation
- [x] Live collector restart/rollback
- [x] API/status contract
- [x] Concurrent delete/retention coverage

## Completion Record

Phase 01 completed 2026-07-26 15:21 +07 (Asia/Ho_Chi_Minh). Runtime lifecycle, collector rollback, protected setup/status API, and serialized delete/retention coverage are implemented and validated in the repository test suite.

## Success Criteria

- Server stays responsive on setup/disable/reconfigure.
- New DamHopper terminal records after activation; it stops recording after disable.
- Failed DB/bind leaves normal PTY operation intact and reports actionable status.

## Risk Assessment

- Worker replacement race: serialize transitions and drain old worker.
- PTY runtime race: resolve only once at new run creation, never partially mutate a live reader.
- Collector port conflict: leave terminal telemetry active, report collector-specific failure.

## Security Considerations

- Continue loopback-only validation and existing API auth.
- No setup response includes key material, raw config, or OTLP request data.

## Next Steps

Implement Codex config ownership after live collector setup exists.
