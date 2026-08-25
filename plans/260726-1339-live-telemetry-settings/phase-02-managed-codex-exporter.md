# Phase 02: Managed Codex Exporter

## Context Links

- [Parent plan](./plan.md)
- [OTLP receiver](../../server/src/telemetry/codex_otlp/receiver.rs)
- [Current Codex config mutation](../../server/src/api/config.rs)
- [Codex OTel research](../../plans/260718-1045-terminal-usage-analytics/research/researcher-02-codex-ui-report.md)

## Overview

- Priority: P1
- Status: completed (2026-07-26 15:50 +07)
- Goal: automatically configure the local Codex exporter without exposing the bearer secret or overwriting another exporter.

## Requirements

- Generate/load the collector token only server-side after collector activation.
- Parse and atomically update `~/.codex/config.toml` with a precise `otel.exporter.otlp-http` configuration, `protocol = "binary"`, local endpoint, and `log_user_prompt = false`.
- Use `toml_edit` directly to preserve unrelated formatting/comments where practical.
- Only manage when `otel.exporter` is absent, `none`, or exactly matches the existing DamHopper-owned endpoint/header shape.
- A non-owned exporter is a conflict: do not overwrite, reveal a non-secret explanation, and allow terminal telemetry to remain enabled.
- Disable restores `exporter = "none"` only when exact ownership still matches; otherwise leave config untouched and report conflict.
- Status reports managed/not-configured/conflict/Codex-restart-needed. It never returns the token/header/raw file.

## Architecture

```text
Settings enable Codex tokens
  -> live collector ensures token
  -> server parses ~/.codex/config.toml
  -> safe ownership check
  -> atomic managed exporter write
  -> status: restart/new Codex process required
```

## Related Code Files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/config_manager.rs` — parse, ownership detection, atomic apply/remove/status.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/{mod.rs,secret.rs,tests.rs}` — narrow public manager API and path-explicit tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/Cargo.toml` — direct `toml_edit` dependency if lockfile-only transitive use is insufficient.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs` — invoke manager only through protected setup transition.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/config.rs` — reuse or replace the existing narrow Codex TOML mutation helper without coupling it to UI-notification settings.

## Implementation Steps

1. Define an opaque status enum and a path-explicit manager for filesystem tests.
2. Reject malformed TOML, table/type collisions, symlinks, non-regular unsafe token files, and non-owned exporter values without writing.
3. Create missing `.codex/config.toml` and only necessary `[otel]` fields with owner-only file permissions.
4. Compare current endpoint/header semantically; never log or serialize the header/token.
5. Implement exact-match disable and idempotent re-enable.
6. Add fixtures for blank config, unrelated OTel fields, absent exporter, `none`, managed exporter, foreign exporter, malformed TOML, and externally changed managed config.

## Todo List

- [x] Ownership-safe config manager
- [x] Opaque setup status
- [x] Atomic conflict/rollback tests

## Completion Record

- 2026-07-26 15:50 +07: Implemented path-explicit manager with atomic TOML writes, exact ownership/conflict detection, safe disable/rollback, opaque status, and filesystem/security fixtures. Focused Rust tests: 5 passed.
- Parent plan remains `in-progress`; Phase 3 Settings UX remains `pending`.

## Success Criteria

- A normal local config is configured in one Settings action with no token copy.
- Existing third-party exporter is untouched.
- Codex config must still be reloaded by starting a new Codex process; this is visible in UI.

## Risk Assessment

- User has a custom exporter: conflict, never takeover.
- Config write interrupted: atomic temp/rename, original remains valid.
- Token leakage: keep every string server-local; test JSON/log privacy scans.

## Security Considerations

- Retain 0600 token/config write protections.
- `log_user_prompt` remains false and is never auto-enabled.

## Next Steps

Next: expose status/action in Settings with accessible setup states (Phase 3, pending). Codex still requires a new process after configuration.
