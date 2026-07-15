# Phase 03 — Validation, Review, and Docs

## Context Links

- [Overview](./plan.md)
- [Phase 01](./phase-01-shared-session-export-controls.md)
- [Phase 02](./phase-02-wire-terminal-title-context-menus.md)
- [Code standards](../../docs/code-standards.md)

## Overview

- **Date:** 2026-07-15
- **Priority:** P1
- **Status:** Pending
- **Goal:** prove exact-session scope, preserve behavior, review UI quality, and align architecture documentation.

## Key Insights

- Highest-risk regression is exporting the active/default terminal instead of the right-clicked terminal.
- Existing export tests already protect JSON assembly and download format; extend rather than replace them.
- No `docs/design-guidelines.md` exists. UI review must follow current CSS variables and established context-menu components.
- Backend tests are unnecessary unless an accidental server diff appears.

## Requirements

- Cover active and inactive traditional tabs, runtime top-level/nested leaves, timeframe changes, menu dismissal, pending state, and export failure.
- Assert exact `terminalIds`, `windowMinutes`, `includeTerminalOutput`, tail bytes, and `frontend.exportScope`.
- Verify no API/client schema or backend source changes.
- Perform frontend-design/UI-UX review for viewport clamping, overflow, focus visibility, compact layout, and existing token consistency.
- Update architecture prose to describe workspace terminal-title export rather than only Settings entry points.

## Architecture

Validation layers:

1. Pure request/download tests protect format and scope fields.
2. Component tests protect right-click target propagation and menu lifecycle.
3. Workspace tests protect shared state and mutation options.
4. Manual browser checks protect DnD, overflow, and real file download.

## Related Code Files

### Modify/Create Tests

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/diagnostics-export.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/diagnostics-export-download.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TabBar.test.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.test.tsx` — create if menu behavior is not fully covered through workspace tests.

### Modify Docs

- `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — correct diagnostics export UI flow; note exact clicked-session terminal scope and unchanged endpoint.

### Delete

- None.

## Implementation Steps

1. Extend request/download tests to pin one-session ID and unchanged download name/shape.
2. Add traditional title context-menu test for inactive tab target and event suppression.
3. Add runtime leaf tests for direct and nested session IDs; cover compact active title callback.
4. Add workspace test: change time selector, right-click a non-active session, select export, inspect mutation request.
5. Test outside click, Escape, duplicate-click prevention, success close, and visible failure.
6. Run `pnpm --filter @dam-hopper/ui test` and `pnpm --filter @dam-hopper/ui build`.
7. Run focused lint on touched files, then `pnpm build`; record unrelated baseline failures rather than masking them.
8. Manually verify traditional/runtime desktop and compact layout: positioning, DnD, active/inactive targeting, downloaded JSON.
9. Run code review for security, performance, architecture, and YAGNI/KISS/DRY; fix critical findings and rerun checks.
10. Update `docs/system-architecture.md`; compare implementation against this plan and document intentional drift.

## Todo List

- [ ] Focused tests pass.
- [ ] UI package build and lint pass.
- [ ] Web production build passes.
- [ ] Manual exports contain only clicked terminal sessions/tails.
- [ ] Frontend global error semantics remain unchanged.
- [ ] Frontend-design/UI-UX review completed.
- [ ] Code review findings resolved.
- [ ] Architecture docs updated.

## Success Criteria

- All observable acceptance criteria from `plan.md` pass in both modes.
- Existing diagnostics export tests remain green with unchanged response/download expectations.
- No server, API type, auth, database, config, or deployment changes.
- Manual JSON inspection confirms one terminal session/tail and selected time window.

## Risk Assessment

- **Brittle tests:** avoid internal-state assertions; trigger user events and inspect public callbacks/request payloads.
- **Environment noise:** run focused tests first; clearly separate pre-existing full-check failures.
- **UI regression:** test narrow viewport and split-pane overflow, not only static markup.

## Security Considerations

- Review that errors do not echo bundle contents or terminal tails.
- Confirm exact-session selection reduces unintended terminal-output exposure.
- Keep auth, server redaction, local-only storage, and sensitive-output warning unchanged.

## Next Steps

- Hand results to project/docs management only after user approval; no commit or push without explicit request.

## Unresolved Questions

- None.
