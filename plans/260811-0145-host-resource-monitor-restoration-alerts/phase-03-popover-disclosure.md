# Phase 03 — Restore accessible popover disclosure

## Context links
`packages/ui/src/components/organisms/{HostResourcePopover.tsx,HostResourceDiagnosis.tsx,HostResourceDiagnosisRows.tsx}`, `packages/ui/src/lib/host-metrics-format.ts`, `packages/ui/src/api/queries.ts`, `packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.tsx`, host-resource tests.

## Overview
- **Date:** 2026-08-11
- **Priority:** P1
- **Status:** completed 2026-08-11 07:18:58 +07:00

## Key Insights
Popover already calls `useHostMetrics(open)`, but diagnosis shows only CPU/selected workspace disk. Existing accordion establishes the repository accessibility pattern. Empty temperatures mean unavailable—not 0°C/healthy.

## Requirements
Show real legacy sensor temperatures with explicit unavailable state. Keep CPU/workspace-disk summary. Storage starts collapsed each mount and exposes every server-ordered disk via click/Enter/Space. No page/actions/permissions; no new 1s polling while closed.

## Architecture
Pass existing legacy metrics through current popover/diagnosis path, including deep-snapshot fallback. Add read-only temperature rows keyed by source and a local disclosure state in diagnosis. Use heading/button, stable IDs, `aria-expanded`, `aria-controls`, `hidden`, and existing dialog Escape/focus behavior.

## Related code files
**Modify:** `HostResourcePopover.tsx`, `HostResourceDiagnosis.tsx`, `HostResourceDiagnosisRows.tsx`, optionally `host-metrics-format.ts`.  
**Tests:** `HostResourceDiagnosis.test.tsx`, `packages/ui/browser-tests/host-resource-monitoring.browser.tsx`.  
**Create/Delete:** none.

## Implementation Steps
1. Retain `useHostMetrics(open)` and pass legacy metrics normally/fallback; do not alter snapshot cadence.
2. Render a Temperatures section with `formatCelsius`; missing/empty displays “Temperature sensors unavailable”.
3. Retain CPU/workspace Disk summary, then add Host storage disclosure containing name/mount, used/total, percent/progress for all disks.
4. Follow accordion semantics/styles where appropriate; default `false` on mount and preserve dialog keyboard behavior.
5. Render additive alert evidence concisely without changing prior memory evidence.
6. Test nominal, empty, narrow viewport, keyboard disclosure, all rows, close/focus.

## Todo list
- [x] Restore temperature section and unavailable state.
- [x] Add collapsed accessible all-disk disclosure.
- [x] Preserve workspace summary and open-only polling.
- [x] Add unit/browser accessibility and fallback coverage.

## Success Criteria
Popover accurately renders available values, never invents values, starts compact, reveals all disks by pointer/keyboard, and stays usable at 320px with no horizontal scroll.

## Risk Assessment
Long mount/name strings can overflow compact UI; truncate visible text safely without removing accessible identity. Server ordering avoids client sort/drift.

## Security Considerations
Read-only text rendering only; no host actions or sensitive fields. Do not introduce `dangerouslySetInnerHTML`, new storage, or an unauthenticated fetch.

## Next steps
Phase 04 validates complete behavior and documents only affected existing guidance.
