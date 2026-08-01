# Phase 06 — Shared Usage Session-Audit UI

## Context links

- [Parent plan](./plan.md)
- [Protected API](./phase-05-protected-session-audit-api.md)
- [Usage UI plan](../260718-1045-terminal-usage-analytics/phase-06-usage-ui-and-compact-navigation.md)
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/UsagePage.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/{client,queries,ws-transport}.ts`

## Overview

- Date: 2026-08-01
- Description: Add accessible session list/tree audit views to the shared browser/native Usage page.
- Priority: P2
- Implementation status: Completed (2026-08-01, Asia/Saigon)
- Review status: Approved 9.5/10 after cycle 1 (2026-08-01, Asia/Saigon)

## Key Insights

- `packages/ui` is shared by browser and native hosts; no native sidecar is allowed.
- Current Usage already has filters, coverage panel, deletion controls, and browser tests.
- Dynamic model values must replace the current `gpt-5.6-sol` hardcode.
- Coverage must be visible next to every audit result; no color-only judgment.

## Requirements

- Add Sessions tab/list with terminal, time, root model, tokens, child count, delegation observed/not observed, and coverage.
- Add expandable tree showing root/main/subagent role, model, status, nullable token components, and parent relation.
- Show `Lineage unavailable`, `Token data unavailable`, and `No subagent observed` explicitly.
- Keep cached input separate and primary token total non-double-counted.
- Use cursor pagination, loading/empty/error states, keyboard-accessible expansion, and stable route deep links.
- Keep raw IDs/commands/content out of browser state; delete/pause controls continue existing semantics.

## Architecture

Add typed client DTOs and TanStack Query hooks. `UsagePage` owns selected session/cursor state in URL/query state; focused components render list/tree and token formatting. Use existing design primitives and table-equivalent text. Do not add a chart or tree dependency.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` — session/node DTOs and opaque model types.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/queries.ts` — list/detail hooks/query keys.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts` — sessions endpoints.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/UsagePage.tsx` — tab/list/detail integration.
- Create focused components under `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/` — session list/tree/coverage.
- Add unit tests and extend `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/usage-page.browser.tsx`.

## Implementation Steps

1. Mirror Rust DTOs with nullable fields and coverage unions.
2. Add list/detail hooks with bounded query keys and cursor reset on filter changes.
3. Build semantic session table and expandable tree with accessible labels.
4. Add token components/main share/delegation copy without rank or violation wording.
5. Add empty/degraded/error states and deep-link behavior.
6. Test browser keyboard navigation, narrow layouts, URL state, deletion, and no raw fields.

## Todo list

- [x] Client DTOs/hooks/transport
- [x] Session list
- [x] Tree detail
- [x] Coverage/token formatting
- [x] Empty/error/accessibility states
- [x] Unit/browser regressions

## Success Criteria

- Browser and native shared UI compile with strict TypeScript.
- Fixture tree renders exact and degraded states correctly.
- Alias/session audit never exposes command or provider content.
- Existing aggregate Usage tests and navigation remain green.

## Risk Assessment

- UI implies a policy violation: use facts/coverage only.
- Large permanent history: pagination and capped detail.
- Shared host drift: test browser and native package build/type-check paths.

## Security Considerations

- Treat server DTOs as untrusted; render text only.
- Do not persist telemetry/session data in localStorage.
- Preserve authenticated transport and logger redaction.

## Next steps

Phase 07 runs full privacy, fault, performance, accessibility, and release checks. Phase 06 acceptance evidence: UI 752/752; browser 70/70; focused session audit 6/6; UI, web, and native builds pass. Review approved 9.5/10 after cycle 1.

## Unresolved questions

None; parent plan decisions supersede the earlier display-identity and refresh-mode questions.
