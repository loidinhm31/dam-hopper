# Host battery / energy scout

## Findings

- The authoritative host-resource API is `GET /api/system/resources/v1/snapshot`; the legacy API is `GET /api/system/metrics`.
- Rust collection is centered in `server/src/system/platform.rs`, `server/src/system/linux/mod.rs`, and `server/src/system/types_v1.rs`. Linux deep collection currently reads bounded `/proc` and injected `/sys` roots; non-Linux returns an unsupported snapshot.
- Legacy `HostMetrics` in `server/src/system/types.rs` is sampled by `HostMetricsSampler` in `server/src/system.rs` using `sysinfo = 0.39`; it already contains CPU, memory, disks, and temperatures, but no power fields.
- The monitor caches/publishes snapshots in `server/src/system/monitor.rs`; API handlers are in `server/src/api/system.rs`, routes in `server/src/api/router.rs`.
- Shared DTOs and transport methods are in `packages/ui/src/api/client.ts` and `packages/ui/src/api/ws-transport.ts`; query hooks are in `packages/ui/src/api/queries.ts`.
- The visible monitor is `packages/ui/src/components/organisms/HostResourcePopover.tsx` -> `HostResourceDiagnosis.tsx`; legacy fallback rows are in `HostResourceDiagnosisRows.tsx`.
- Existing test seams: injected `HostResourceSource` and filesystem fixtures in `server/src/system/platform.rs` / `server/src/system/linux/`; API contract tests in `server/src/api/tests.rs`; UI tests in `HostResourceDiagnosis.test.tsx`, `HostResourcePopover.test.tsx`, and browser coverage in `packages/ui/browser-tests/host-resource-monitoring.browser.tsx`.

## Call/data flow

`HostResourceMonitor::run` -> `collect_host_resource_snapshot_with_options` -> Linux collector -> `HostResourceSnapshotV1` -> `/api/system/resources/v1/snapshot` -> client `HostResourceSnapshotV1` -> `useHostResourceSnapshot` -> `HostResourceDiagnosis`.

Legacy path: `HostResourceMonitor::legacy_metrics` -> `HostMetricsSampler::sample` -> `/api/system/metrics` -> `useHostMetrics` -> `HostResourceLegacyMetrics`.

## Candidate approaches

1. **Recommended: additive snapshot capability.** Add an optional `power`/`battery` section to `HostResourceSnapshotV1`, with an `Availability` plus battery percentage and/or current power/energy fields. On Linux read `/sys/class/power_supply/*` through the existing injected `sys_root`; map `capacity`, `status`, `energy_now`/`charge_now`, `power_now`/`current_now` and corresponding `_full`/`_design` files. Unsupported/missing/permission errors remain explicit availability states. Extend shared DTO and diagnosis UI. This preserves existing API clients and makes semantics explicit.
2. **Legacy metrics extension.** Add optional battery fields to `HostMetrics` and collect through `sysinfo` or platform code. Easier fallback integration, but couples a new capability to the compatibility DTO and does not fit the deep snapshot's existing availability model.
3. **Dedicated endpoint.** Expose `/api/system/power` separately. Avoid unless independent polling/caching is required; it adds transport/query/UI complexity and can produce inconsistent sample timestamps.

Recommendation: approach 1, with a single sampled section and optional fields. “Current Wh” is ambiguous: `energy_now` is remaining energy (Wh), while `power_now` is instantaneous draw (W). Label them separately; do not call watts “Wh”. If only charge/current units exist, derive Wh only when voltage is reliably available, otherwise report charge/current without fabrication.

## Affected files

- Backend: `server/src/system/types_v1.rs`, `server/src/system/linux/mod.rs` (or focused new Linux collector module), `server/src/system/platform.rs` trait roots, `server/src/system/tests.rs`, `server/src/system/platform.rs` fixture tests, `server/src/api/tests.rs`.
- Potential compatibility path: `server/src/system/types.rs`, `server/src/system.rs` if legacy metrics must show power; otherwise leave unchanged.
- Client contract/transport: `packages/ui/src/api/client.ts`; endpoint mapping likely unchanged for additive snapshot; query types already flow through existing hook.
- UI: `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx`, possibly `HostResourceDiagnosisRows.tsx`, plus focused component/browser tests.
- Docs: no existing battery contract found; update relevant API/system docs only if project convention requires documenting DTO additions.

## Testing strategy

- Rust unit tests with temporary injected `/sys` fixtures for: battery present with energy and power, multiple batteries, missing battery directory, malformed/out-of-range values, permission/read failure, and charge/current-only devices.
- Assert JSON camelCase names and explicit `Availability` for unsupported/unavailable/stale cases in API tests.
- TypeScript component tests cover available battery, energy-only, power-only, and unavailable display; browser test verifies accessible labels and no fabricated units.
- Run targeted Rust tests, UI tests, then `pnpm check`/repository standard validation.

## Unresolved questions

- Should the feature be exposed only in the deep snapshot or also in legacy `/api/system/metrics`?
- Product wording: show remaining energy (`Wh`), instantaneous power (`W`), battery percentage/status, or all available values?
- For multiple batteries, should values be summed, displayed individually, or select the system battery?
- Is macOS/Windows support required now? Current deep collector is Linux-only and has no cross-platform power abstraction.

