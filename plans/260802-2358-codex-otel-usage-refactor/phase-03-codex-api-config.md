# Phase 03: Codex-only API and configuration contracts

## Context links

- Parent: [plan.md](./plan.md)
- Architecture: [Codex OTel usage](../../docs/system-architecture.md#codex-otel-usage-analytics)
- Research: [backend report](./research/researcher-01-backend-data-report.md)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** Complete · **Completed:** 2026-08-04 23:08 Asia/Ho_Chi_Minh · **Review:** Complete

Keep route names stable while removing terminal-shaped DTOs, filters, settings, and query joins.
Expose only Codex totals, model/time/session summaries, health, setup, retention, and deletion.

## Key Insights

Current API has `terminal`, shell/capture/category/project/agent filters, terminal correlation
settings/health, and terminal-session joins. These force frontend and backend to maintain a mixed
contract even when only Codex OTel data is wanted.

## Requirements

- `/api/usage/summary`, `/sessions`, `/session`, `/health`, `/settings`, `/setup`, and delete remain
  authenticated and bounded.
- Remove `terminal_correlation_enabled`, `excluded_projects`, terminal IDs/labels, capture quality,
  shell/category/agent filters, and lineage/correlation fields.
- Keep model/date/window/bucket filters and flat Codex session summaries.
- Preserve foreign Codex exporter conflict behavior and restart-required status.

## Architecture

API handlers query only Codex store projections. Config retains `[server.telemetry]`, `enabled`,
`paused`, `db_path`, retention, and loopback collector; serialization and validation no longer
mention terminal correlation or project exclusion.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs`, `usage_sessions/*`,
  `api/router.rs`, `api/tests.rs`, `server/src/config/schema.rs`, `config/parser.rs`,
  `docs/api-reference.md`, `docs/configuration-guide.md`.
- **Modify transport/client:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts`,
  `ws-transport.ts`, `queries.ts` and their tests.

## Implementation Steps

1. Define Codex-only response DTOs and reject removed query keys rather than ignoring them.
2. Map store quality/availability honestly; return null/unavailable for missing token components.
3. Remove terminal filters/dimensions and session terminal enrichment; cap cursors/pages/detail.
4. Update TOML/API camelCase mappings and compatibility handling for removed settings.
5. Update API/transport tests for auth, empty/paused/unavailable/partial, reset and conflicts.

## Todo list

- [x] DTOs contain no terminal/correlation/lineage fields.
- [x] Settings/config roundtrip has no removed keys.
- [x] API cannot reveal raw event payloads or secrets.
- [x] URL filters remain bounded and cursor-bound.

## Success Criteria

Backend and client contracts compile together; existing route names work with Codex-only payloads;
removed terminal terms produce no API or transport fields.

## Risk Assessment

Removing fields is a breaking response change for stale clients. Version/document the contract and
make the UI/client update atomic; retain route names to reduce deployment friction.

## Security Considerations

Retain authentication, range limits, derived IDs, cursor binding, exact delete confirmation, and
secret redaction. Never log rejected OTLP content.

## Next steps

Phase 4 consumes these DTOs through the Codex-only Usage and Settings surfaces.

## Handoff evidence (2026-08-04)

API/config contracts validated through the passing Rust suite (601 passed, 0 failed, 2 ignored),
focused rollback/IPv6 tests, and UI Settings coverage. No unresolved API/config defects reported.
