# Phase 03 — Automated/Browser Validation and Docs Alignment

## Context links

- [Plan](./plan.md)
- [Architecture contract](../../../docs/system-architecture.md#host-resource-glance-panel-current-ui)
- [Phase 01](./phase-01-config-preference-contract.md)
- [Phase 02](./phase-02-glance-disclosure-ui.md)
- [Glance UX research](./research/researcher-01-glanceable-resource-ux.md)
- [Telemetry semantics research](./research/researcher-02-host-telemetry-semantics.md)

## Overview

- Date: 2026-08-15
- Description: Lock semantics, persistence, accessibility, responsive behavior, and architecture/doc consistency with existing test harnesses.
- Priority: P2
- Implementation status: Completed
- Review status: Completed by focused regression validation

## Key Insights

- Existing Vitest component and Chromium suites already cover the popover dialog, focus trap, Escape, 44px controls, contrast, long values, deep failure, temperature absence, and narrow viewport.
- Extend current harness; no new test library. Tests should query by role/name and observable text rather than Tailwind class structure.
- Server config tests are the source of truth for camelCase API/snake_case TOML and validation; UI tests cover pure exact-match behavior and rendered states.
- Architecture contract is already written. Post-implementation work is comparison/alignment, not speculative redesign.

## Requirements

- Unit-test finite normalization, used-memory calculation, exact mount resolution, default, missing pin, duplicate/long labels, invalid totals, stale/unavailable states, battery partials, and temperature formatting.
- Component-test order and boundaries: active status outside; glance before disclosure; details hidden initially; one disclosure; no nested storage disclosure; all details visible after expand.
- Assert meter role/name/value for memory, CPU, selected storage, battery. Assert temperature has visible Celsius but no meter/progress value semantics.
- Browser-test pin persistence after successful mutation/refetch, null clear, and missing pin across close/reopen; no silent fallback.
- Browser-test Enter/Space disclosure, focus containment with pin controls, Escape close/trigger restoration, every sensor, stale/unavailable without fake zero, and pointer interactions.
- Validate 320x700 and 1280x800: no horizontal/page overflow, readable values, full scroll access, 44px interactive targets, visible focus, contrast/non-color status cues.
- Verify `useHostMetrics(open)` stays 1s, snapshot 15s, alerts 30s; no new telemetry endpoint/query key.
- Update docs for the preference and UI ownership. If implementation matches architecture, do not churn its design contract; amend only intentional reviewed drift.

## Architecture

Validation layers: Rust config tests prove persistence/input boundary; pure TypeScript tests prove projection/resolution; component tests prove structure/semantics; Chromium proves layout/keyboard/focus; final code-to-architecture review proves no collector/query/alert coupling.

## Related code files

| Absolute path | Action | Purpose |
|---|---|---|
| `/mnt/data/ws/sharing/dam-hopper/server/src/config/tests.rs` | Modify | Persistence/default/alias/bound contract tests. |
| `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` | Modify | Partial update, clear, and validation response tests. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/ui-config.test.ts` | Modify | Frontend nullable preference defaults. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/host-resource-state.test.ts` | Modify | Pure projection and exact pin resolution matrix. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceGlance.test.tsx` | Create | Glance order, values, roles, temperatures, missing/stale states. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceStorageDetails.test.tsx` | Create | Exact pin/current/missing states, accessible controls, pending/error behavior. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourceDiagnosis.test.tsx` | Modify | Disclosure detail/inventory/pin behavior and partial telemetry. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Modify | Always-visible status and query/config wiring contract. |
| `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/host-resource-monitoring.browser.tsx` | Modify | End-to-end DOM, persistence, keyboard, focus, and responsive gates. |
| `/mnt/data/ws/sharing/dam-hopper/docs/configuration-guide.md` | Modify | Document optional snake_case pin and missing/default behavior. |
| `/mnt/data/ws/sharing/dam-hopper/docs/codebase-summary.md` | Modify | Record glance/detail component and Global UiConfig ownership. |
| `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md` | Modify if UiConfig fields are enumerated | Document camelCase update field and null clear. |
| `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` | Verify; modify only for approved drift | Post-implementation architecture gate. |

## Implementation Steps

1. Build table-driven pure tests for percentages and resolver states. Include exact `/data` vs `/data2`, absent `disks`, duplicate names, zero total, NaN/infinity runtime input, and saved missing mount.
2. Add glance rendering tests using role/name selectors: `meter` names for Memory used/CPU/Storage/Battery, regions/lists for temperatures, and disclosure button name. Assert DOM text order.
3. Update diagnosis/popover mocks for `useGlobalConfig` and `useUpdateUiConfig`. Assert status remains rendered while diagnosis is hidden and pin errors do not hide telemetry.
4. Extend Chromium fixtures with at least two labeled temperatures, stale deep memory/battery, invalid compatibility values, existing pin, missing pin, and a mutable config mock that simulates successful refetch.
5. Test pin selected/current state, successful persistence after close/reopen, `null` default reset, and saved missing mount retaining its name plus unavailable state.
6. Test disclosure with click, Enter, and Space; tab through close/disclosure/pin controls; verify wrap-around, Escape close, and trigger focus restoration.
7. Run the same layout/overflow/contrast checks at 320x700 and 1280x800 with disclosure both closed and expanded. Assert all temperature labels/values remain reachable.
8. Run targeted commands, then full gates:
   - `pnpm test`
   - `pnpm --filter @dam-hopper/ui test -- HostResourceGlance.test.tsx HostResourceStorageDetails.test.tsx HostResourceDiagnosis.test.tsx HostResourcePopover.test.tsx host-resource-state.test.ts ui-config.test.ts`
   - `pnpm --filter @dam-hopper/ui test`
   - `pnpm --filter @dam-hopper/ui test:browser -- host-resource-monitoring.browser.tsx`
   - `pnpm --filter @dam-hopper/ui build`
   - `pnpm lint`
   - `pnpm check`
9. Update configuration/API/codebase docs. Diff implementation against the architecture invariants; document approved semantic changes or fix unintended drift.

## Todo list

- [x] Add backend and frontend preference contract tests.
- [x] Add pure projection/resolver test matrix.
- [x] Add semantic component tests for order/meters/disclosure.
- [x] Extend Chromium persistence, accessibility, and viewport gates.
- [x] Run targeted unit, browser, and TypeScript validation; full repository commands remain follow-up.
- [x] Reconcile implementation against the existing architecture contract; update the architecture and frontend component docs.

## Success Criteria

- All specified commands pass with no new testing dependency.
- Tests fail on regression to “Memory available,” fake zero, fake temperature percent, silent pin fallback, nested disclosures, or reordered glance rows.
- Role/name selectors find every real meter and disclosure/pin control; temperature never appears as a percentage meter.
- Chromium proves persistence/missing behavior, keyboard/focus/Escape, all sensors, and no overflow at both target widths.
- Docs and final implementation match architecture; query intervals/endpoints, sampling, alerts, and read-only boundary remain unchanged.

## Risk Assessment

- Static server rendering cannot prove interaction. Mitigation: keep unit assertions semantic; use Chromium for mutation/focus/layout.
- Native meter computed styles differ by engine. Mitigation: gate semantic role/value and visible text; use Chromium contrast checks where CSS exposes track/fill.
- Full `pnpm check` may surface unrelated baseline failures. Mitigation: record baseline separately, but do not waive task-specific targeted failures.

## Security Considerations

- Add a regression asserting hostile-looking mount/sensor text is escaped and never becomes markup or a URL/action target.
- Confirm browser mutation sends only the bounded preference, and no test/product code forwards mount text into telemetry or host action endpoints.
- Ensure error output does not expose config file paths or host-only identifiers beyond already displayed mount labels.

## Next steps

Run the dedicated Chromium file and full `pnpm lint` / `pnpm check` gates when a clean validation pass is available. Then request product validation on terminology, temperature visual treatment, and disclosure persistence.

## Completion Notes

Focused command passed: `pnpm --filter @dam-hopper/ui test -- HostResourceGlance.test.tsx HostResourceStorageDetails.test.tsx HostResourceDiagnosis.test.tsx HostResourcePopover.test.tsx host-resource-state.test.ts ui-config.test.ts` (Vitest resolved 171 files / 1,073 tests). The dedicated browser command passed: `pnpm exec vitest run --config vitest.browser.config.ts browser-tests/host-resource-monitoring.browser.tsx` (13/13 tests). `pnpm test`, UI TypeScript build, lint, and `git diff --check` passed. `pnpm check` reached native packaging but stopped because `TAURI_SIGNING_PRIVATE_KEY` is unavailable. Architecture and frontend component documentation were updated; configuration/API reference documentation remains a follow-up.

## Non-blocking Follow-ups

- Re-run `pnpm check` with the native signing key configured.
- Update configuration/API reference documentation under authorized scope.

## Unresolved Questions

1. Should the shipped “overall” label describe current workspace/default disk or wait for a true aggregate contract?
2. Does user validation approve numeric Celsius with neutral meter-like styling and no fake percentage?
3. Should disclosure state stay session-local or persist through Global UiConfig/local storage?
