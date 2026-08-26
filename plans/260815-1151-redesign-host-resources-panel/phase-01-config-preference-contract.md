# Phase 01 — Config and Preference Contract

## Context links

- [Plan](./plan.md)
- [Architecture contract](../../../docs/system-architecture.md#host-resource-glance-panel-current-ui)
- [Glance UX research](./research/researcher-01-glanceable-resource-ux.md)
- [Telemetry semantics research](./research/researcher-02-host-telemetry-semantics.md)

## Overview

- Date: 2026-08-15
- Description: Add one bounded, optional global UI preference for the exact pinned mount point.
- Priority: P2
- Implementation status: Completed (2026-08-15 13:13 ICT)
- Review status: Completed (focused validation)

## Key Insights

- Existing global UI config already provides authenticated read/partial-update, camelCase JSON, snake_case TOML, atomic `0600` writes, cache invalidation, and frontend defaults.
- Pin is presentation state only. Server must not resolve, canonicalize, inspect, sample, or alert on the path.
- Exact mount-point matching is intentional. Missing mounts remain missing; display names and array indexes are not identities.
- KISS: one nullable string, not a device identity schema or new preference endpoint.

## Requirements

- Add API field `hostResourcePinnedMount?: string | null`; TOML key `host_resource_pinned_mount`; Rust default `None`; frontend normalized default `null`.
- `null` clears the pin. A present value preserves bytes exactly for client-side equality with `DiskMetrics.mountPoint`.
- Accept only a non-empty value up to 4096 UTF-8 bytes; reject oversized/empty update payloads with existing invalid-input handling. Do not require the mount to currently exist.
- A pin update must only write Global UiConfig and invalidate `['global-config']`; no telemetry query invalidation, sampler action, alert change, or filesystem operation.
- Maintain backward compatibility for configs without the field and accept both camelCase JSON and snake_case TOML aliases.

## Architecture

`HostResourcePopover -> useGlobalConfig -> ui.hostResourcePinnedMount`. User pin action calls existing `useUpdateUiConfig({ hostResourcePinnedMount })`; server merges, validates the bounded string, writes snake_case TOML, then frontend refetches Global UiConfig. Telemetry remains an independent read-only input.

## Related code files

| Absolute path | Action | Purpose |
|---|---|---|
| `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` | Modify | Add optional field, default, aliases, bound constant/validator. |
| `/mnt/data/ws/sharing/dam-hopper/server/src/config/global.rs` | Modify | Map camelCase JSON field to snake_case TOML on write. |
| `/mnt/data/ws/sharing/dam-hopper/server/src/api/config.rs` | Modify | Invoke pin validation in existing partial UI merge path. |
| `/mnt/data/ws/sharing/dam-hopper/server/src/config/tests.rs` | Modify | Cover default, aliases, JSON/TOML round-trip, exact value, null. |
| `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` | Modify | Cover accepted bounded update and rejected empty/oversized update. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` | Modify | Add nullable camelCase UiConfig property. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/ui-config.ts` | Modify | Normalize absent preference to `null`. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/ui-config.test.ts` | Modify | Cover absent, present, and null preference defaults. |

## Implementation Steps

1. Define a named 4096-byte preference limit beside `UiConfig`; add `Option<String>` using existing camelCase serialization and snake_case alias conventions.
2. Add `validate_host_resource_pinned_mount`: allow `None`; require `1..=limit` bytes for `Some`; preserve exact text. Call it from `merge_global_ui_config` with other UI validators.
3. Add the explicit key conversion in `normalize_ui_json_for_toml`. Confirm `null` is omitted from TOML and clears an existing field after merge/write.
4. Extend Rust defaults/round-trip tests. Assert API JSON emits only `hostResourcePinnedMount`, TOML emits only `host_resource_pinned_mount`, and old files still parse.
5. Add endpoint/merge tests for exact mount text, null clear, empty rejection, and `limit + 1` rejection.
6. Extend TypeScript `UiConfig`, `DEFAULT_UI_CONFIG`, and `withUiConfigDefaults`; test `null` fallback without changing unrelated defaults.
7. Run `pnpm test`, `pnpm --filter @dam-hopper/ui test -- ui-config.test.ts`, and `pnpm --filter @dam-hopper/ui build`.

## Todo list

- [x] Add backend field, default, aliases, and bound validation.
- [x] Add TOML key normalization and partial-update coverage.
- [x] Add frontend type/default normalization.
- [x] Prove null clear and backward-compatible reads.
- [x] Confirm no telemetry cache/sampler coupling.

## Implementation Progress

- Backend: `Option<String>` nullable pin, 4096-byte bound, empty/oversized rejection, camelCase/snake_case aliases, TOML normalization, null-clear behavior.
- Frontend: nullable `UiConfig` field and `null` default normalization.
- Scope preserved: Global UiConfig only; no telemetry/sampler/alert/filesystem coupling.

## Validation Evidence

- `cd server && cargo test ui_config --lib`: 17 passed, 0 failed.
- `cd server && cargo test merge_global_ui_config --lib`: 4 passed, 0 failed.
- `pnpm --filter @dam-hopper/ui test -- ui-config.test.ts`: 169 files, 1064 tests passed, 0 failed (Vitest project-wide run).
- Source/test evidence present in `server/src/config/{schema,global,tests}.rs`, `server/src/api/{config,tests}.rs`, `packages/ui/src/{api/client.ts,lib/ui-config.ts,lib/ui-config.test.ts}`.

## Success Criteria

- Existing config with no field loads as no pin.
- Exact mount survives API -> TOML -> API round-trip.
- Null clear persists; invalid values return controlled 4xx and do not overwrite config.
- Frontend always receives a safe `string | null` after default normalization.
- Host metrics/snapshot/alerts query keys and polling intervals are untouched.

## Risk Assessment

- Partial JSON merge can retain a pin when clear semantics are wrong. Mitigation: explicit null-clear integration test.
- TOML normalization can accidentally persist camelCase. Mitigation: assert positive snake_case and negative camelCase.
- Manual config may contain a currently missing mount. Mitigation: allow valid bounded strings; resolution belongs to UI.

## Security Considerations

- Treat path as inert display preference; never pass it to filesystem APIs, shell, telemetry collector, or alert logic.
- Bound input before persistence to limit config/memory/UI abuse. React text rendering supplies escaping; do not use raw HTML.
- Reuse authenticated Global UiConfig route and atomic restricted-permission write path; no new authorization surface.

## Next steps

Implement Phase 02 against the normalized nullable field and exact-match resolver contract.

## Unresolved Questions

1. Should “overall” retain current workspace/default disk semantics or become a true aggregate later?
2. Is neutral numeric-only temperature meter styling acceptable without a semantic percent?
3. Should disclosure state remain session-local or gain a separate persisted preference?
