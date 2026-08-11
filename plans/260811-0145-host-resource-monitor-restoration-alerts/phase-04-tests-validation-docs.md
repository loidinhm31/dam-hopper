# Phase 04 — Tests, validation, and handoff

## Context links
`server/src/system/{alerts.rs,monitor.rs,tests.rs}`, `server/src/api/tests.rs`, `packages/ui/src/components/organisms/HostResourceDiagnosis.test.tsx`, `packages/ui/src/hooks/use-sse.test.ts`, `packages/ui/browser-tests/host-resource-monitoring.browser.tsx`, existing docs.

## Overview
- **Date:** 2026-08-11
- **Priority:** P1
- **Status:** completed — 2026-08-11 09:15:59 +07:00

## Key Insights
Rust pure tests establish policy and API tests establish serialization/auth; browser fixtures cannot prove real Linux thermal availability. Validation must preserve unrelated worktree changes and avoid broad suite cost unless proportional.

## Requirements
Cover nominal/empty/threshold/sustained/recovery/invalid/disclosure. Run formatting, Rust check/targeted tests, focused UI unit/browser, UI typecheck/build, then proportional lint/broader tests. Document only existing relevant monitor/API/frontend/config text.

## Architecture
Layer verification: pure lifecycle/classifier → monitor/API auth/cache/schema → strict UI DTO/event handling → Chromium keyboard/layout behavior. Record exact blockers rather than changing config, skipping tests, or masking baseline failures.

## Related code files
**Update tests:** `server/src/system/{alerts.rs,monitor.rs,tests.rs}`, `server/src/api/tests.rs`, `packages/ui/src/{hooks/use-sse.test.ts,components/organisms/HostResourceDiagnosis.test.tsx}`, browser host-resource test.  
**Potential docs:** `docs/{system-architecture.md,api-reference.md,frontend-components.md,configuration-guide.md}` only if present/relevant.  
**Create/Delete:** none unless implementation needs a co-located test fixture.

## Implementation Steps
1. Add table-driven Rust boundaries: >60/<=60, 299999/300000ms, unavailable/invalid reset, disk >=95/recovery, pseudo rejection, target cap/dedupe.
2. Add monitor/API tests for paired cache, concurrent incidents, deadline non-advance, arrays, auth, bounded REST output.
3. Add Vitest old/new/invalid SSE and diagnosis/presentation cases.
4. Add browser disclosure pointer/keyboard, all-disk/temp/unavailable, focus/Escape/mobile checks.
5. Run and record: `cargo fmt --check`, `cargo check`, targeted cargo tests, focused UI tests/browser test, UI/web builds; run lint/broader cargo tests when proportionate.
6. Inspect docs/diff/status/staged names; do not touch unrelated changes.

## Todo list
- [x] Complete Rust unit/monitor/API coverage.
- [x] Complete UI unit/SSE/presentation coverage.
- [x] Complete browser disclosure/accessibility coverage.
- [x] Run proportional validation and record results.
- [x] Update applicable existing docs only.
- [x] Review scope, secrets, staged files, unrelated changes.

## Success Criteria
Focused gates pass and reviewer can trace every incident to validated evidence; compatibility, auth, recovery, accessibility, caps, and no polling scope expansion are proven.

## Risk Assessment
Linux mount classification is platform-dependent; retain conservative fixtures/fail closed. Manual Linux hardware verification may still be needed for actual sensor availability. Broad checks may expose unrelated baseline/environment limits; report exact result.

## Security Considerations
Confirm resource routes remain authenticated, no evidence/logs leak secrets, nested SSE payloads fail closed, no CORS/permission expansion, and no new persistence/dependency/deploy work.

## Next steps
Completed: Phase 04 approved; plan handoff closed. Preserve residual Linux hardware verification as a follow-up, not a release blocker.
