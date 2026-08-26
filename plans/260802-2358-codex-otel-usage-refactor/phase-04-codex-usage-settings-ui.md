# Phase 04: Usage and Settings redesign

## Context links

- Parent: [plan.md](./plan.md)
- Research: [frontend/UX report](./research/researcher-02-frontend-ux-report.md)
- Architecture: [Codex OTel usage](../../docs/system-architecture.md#codex-otel-usage-analytics)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** Complete · **Completed:** 2026-08-04 23:08 Asia/Ho_Chi_Minh · **Review:** Complete

Replace the mixed Usage page and terminal-first Settings row with one Codex-native information
architecture. No rendered Usage/Settings copy may mention terminal analytics.

## Key Insights

Existing components already have useful token/session building blocks, but `UsageOverview`, filters,
coverage, trends, breakdowns, session DTOs, and Settings descriptions are terminal-shaped.

## Requirements

- Overview: availability banner, total/component tokens, response/session counts, duration/cache,
  token/response trends, model breakdown, explicit unavailable states.
- Sessions: bounded flat Codex summaries with model set, response count, duration, and token totals;
  no terminal columns/filters, correlation, lineage, or command details.
- Filters: date/window/bucket/model only (project only if a safe Codex contract proves it).
- Settings: one Codex usage telemetry section with enabled/paused, managed/conflict/restart and
  receiver health, privacy note, retention, reset, and Usage link. Cost stays omitted.

## Architecture

`UsagePage -> Codex query hooks -> usage transport -> Codex API`. Settings uses the same setup and
settings endpoints. Poll only visible bounded summaries; use `aria-live` for receiver transitions.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/UsagePage.tsx`,
  `UsagePage.test.tsx`, `components/usage/{UsageOverview,UsageCoveragePanel,UsageFilters,
  UsageBreakdown,UsageTrendChart,UsageSessionAudit,UsageSessionList,UsageSessionTree,
  UsageSessionTokens,UsageComponents}.tsx`, `api/client.ts`, `api/queries.ts`.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/
  SettingsUsageInsightsSection.tsx`, `SettingsUsageInsightsCodexRow.tsx`, `SettingsPage.tsx`,
  related unit/browser fixtures under `packages/ui/browser-tests/`.
- **Delete/retire:** terminal-only Usage components/tests after confirming no non-Usage consumer.

## Implementation Steps

1. Replace page state/URL parsing and labels with Codex date/model/session state.
2. Rebuild KPI/trend/breakdown cards around response/token/model contracts and honest nulls.
3. Simplify session list/detail to flat OTel summaries and responsive accessible tables/dialogs.
4. Make Settings Codex-first; preserve exporter conflict/restart guidance and destructive focus flow.
5. Rewrite unit/browser tests for 360px layout, keyboard/screen-reader states, empty/paused/down/
   partial data, URL back/forward, and absence of terminal copy.

## Todo list

- [x] No terminal words/fields remain in rendered Usage/Settings.
- [x] Unavailable values are not shown as zero.
- [x] Destructive dialogs name exact Codex scope/range and return focus.
- [x] No terminal polling/subscriptions or dashboard invalidations are added.

## Success Criteria

Browser and unit tests pass; Usage communicates Codex OTel health and tokens at narrow and wide
viewports; Settings has one clear Codex setup workflow.

## Risk Assessment

Stale fixtures may conceal contract drift. Replace fixtures end-to-end and add a rendered-text
negative assertion for terminal terms.

## Security Considerations

Do not persist credentials in browser storage; never display the OTLP bearer token or raw payload.
Keep delete confirmation, auth errors, and content redaction behavior explicit.

## Next steps

Phase 5 records cross-layer release validation and the documented manual reset procedure.

## Handoff evidence (2026-08-04)

UI unit suite passes 756/756; browser suite passes 69/69. UI/web builds and lint pass. Automated
reset/reopen/privacy/terminal-dependency coverage and focused Settings tests pass. No claim made for
manual PTY benchmark or pinned Codex compatibility checks; both remain environment-gated.
