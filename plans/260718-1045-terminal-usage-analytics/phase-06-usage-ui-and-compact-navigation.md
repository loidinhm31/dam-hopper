# Phase 06: Usage UI and Compact Navigation

## Context links

- [Parent plan](./plan.md)
- [Aggregate API](./phase-04-aggregate-api-and-controls.md)
- [Codex adapter](./phase-05-codex-loopback-otel-adapter.md)
- [Repository scout](./scout/scout-01-repository-touchpoints.md)
- [UI code standards](../../docs/code-standards.md#typescript-frontend-appsweb-appsnative-packagesui)

## Overview

- Date: 2026-07-18
- Description: Add a shared browser/native `/usage` page, compact top navigation, dashboard teaser, and explicit privacy controls.
- Priority: P2
- Implementation status: Pending
- Review status: Pending
- Effort: 40h

## Key Insights

- `packages/ui` is shared by `apps/web` and `apps/native`; no host-specific backend sidecar.
- `TopNavRouteMenu` already handles collapsed/compact modes and is the correct responsive seam.
- No chart library is present. SVG/CSS with table equivalents follows YAGNI and accessibility requirements.
- Terminal and Codex metrics use different units and must not share a misleading combined score.

## Requirements

- Lazy `/usage` route and protected query loading through existing transport.
- Filters: 24h/7d/30d/custom, project, shell, quality, category, provider, model.
- Coverage first: rich/partial/unavailable and exact/approximate/unattributed.
- Terminal cards/trends: runs, commands, active execution, outcomes, p50/p95 detail-window duration, categories/projects, repeats, health.
- Codex cards/trends: turns/status, input/cached/output/reasoning tokens, cache ratio, availability/confidence.
- Loading/empty/error/partial states and no-data explanations.
- Pause/exclusion/delete controls with confirmation; no raw event drilldown.
- Compact labels/icons/gaps; responsive `More` overflow; accessible names and touch targets.
- Small teaser card on existing dashboard; operational dashboard remains focused.

## Architecture

```text
UsagePage -> useUsageSummary -> WsTransport.invoke("usage:summary")
     |             |
     |             +-> aggregate API (auth, UTC, caps)
     +-> charts + tables + coverage/health
```

API DTOs remain duplicated in TypeScript by project convention. Query keys include all filters. No client-side persistence of telemetry or raw commands. Optional low-rate `usage:changed` invalidation may be added only if polling/refresh UX cannot meet freshness needs.

Navigation keeps `BASE_NAV` as the single source. Add `/usage` with a compact label/icon; update `TopNavRouteMenu` and `TopNavRouteLink` for overflow/tooltip semantics without remounting workspace terminals.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/embed/dam-hopper-app.tsx` — lazy import and `/usage` route.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/navigation.ts` — usage nav entry.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TopNavRouteMenu.tsx` — compact/overflow behavior.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/molecules/TopNavRouteLink.tsx` — accessible compact label/tooltip if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/DashboardPage.tsx` — teaser card only.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` — usage DTOs/settings types.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/queries.ts` — summary/settings hooks.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts` — usage channel mapping/invalidation.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/UsagePage.tsx` — route-level page.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/UsageFilters.tsx` — filter controls.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/UsageMetricCard.tsx` — KPI cards.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/UsageTrendChart.tsx` — accessible SVG/CSS chart.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/UsageCoveragePanel.tsx` — quality/health.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/usage-formatters.ts` — pure units/status formatting.
- Create co-located tests under `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/`.

## Implementation Steps

1. Add typed response models with explicit nullable/unavailable enums and safe server timestamps.
2. Add query hooks with bounded URL state; use one summary request first.
3. Build filters with keyboard labels, reset action, range validation, and project list from existing query.
4. Render coverage/health before trend cards so data quality is not hidden.
5. Add terminal metrics with table equivalents and tooltip values; no productivity wording.
6. Add separate Codex section. Hide token values when unavailable; show setup/disabled/confidence status.
7. Add pause/exclusion/delete controls through protected mutation endpoints; confirmation and post-action invalidation.
8. Add dashboard teaser linking to `/usage` without loading a second large query if not needed.
9. Add nav compactness: test desktop, narrow browser, compact workspace/mobile grid, and native webview widths.
10. Add Vitest and browser coverage for query states, labels, filter URL, keyboard focus, color-independent text, and route reload.

## Todo list

- [ ] Shared route works in browser and native hosts.
- [ ] Summary query is bounded and cache-key complete.
- [ ] Coverage/unavailable states are explicit.
- [ ] Charts have table/ARIA equivalents.
- [ ] Nav remains usable at narrow widths and no terminal remount occurs.
- [ ] Destructive controls require confirmation.
- [ ] No raw data in client logs/localStorage.

## Success Criteria

- `/usage` renders correct fixture aggregates for all required filters.
- Empty/partial/error/loading states are understandable and accessible.
- Token cards never show false zero or cost estimates.
- Compact nav fits existing routes with keyboard and touch access.
- Existing TerminalPanel replay/IME/notification/suggestion behavior is unchanged.

## Risk Assessment

- Chart dependency creep: keep SVG/CSS until measured need.
- Nav clutter: overflow low-priority labels rather than shrink touch targets.
- Query waterfall: combined summary and TanStack caching.
- Misleading dashboard: coverage-first layout and descriptive labels.

## Security Considerations

- Browser sees aggregates/settings only; never HMAC, bearer, command, or agent event IDs.
- Use existing authenticated transport and logger redaction.
- Do not persist filters/telemetry in localStorage unless explicitly non-sensitive UI preference.
- Delete/pause controls must not be GET links.

## Next steps

- Phase 07 runs shared-host, accessibility, fault, privacy, and performance gates.

## Unresolved questions

- Confirm browser-local timezone display versus UTC-only labels before visual copy is finalized.
