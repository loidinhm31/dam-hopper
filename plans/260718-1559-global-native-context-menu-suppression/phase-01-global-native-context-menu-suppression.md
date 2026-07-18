# Phase 01: Global Native Context Menu Suppression

## Context Links

- [Overview](./plan.md)
- [Application root](../../packages/ui/src/embed/dam-hopper-app.tsx)
- [Existing document guard pattern](../../packages/ui/src/hooks/use-browser-shortcut-guard.ts)
- [Radix menu wrapper](../../packages/ui/src/components/ui/ContextMenu.tsx)
- [JSDOM menu tests](../../packages/ui/src/components/ui/ContextMenu.test.tsx)
- [Chromium menu tests](../../packages/ui/browser-tests/consumer-context-menu.browser.tsx)
- [Architecture invariant](../../docs/system-architecture.md#context-menu-placement-invariant)

## Overview

- **Date:** 2026-07-18
- **Priority:** P2
- **Status:** Completed
- **Goal:** prevent browser-native context menus anywhere inside the DamHopper
  document without preventing existing configured Radix context menus.

## Key Insights

- `DamHopperApp` already installs a mount-scoped document-level browser guard.
  The new hook belongs beside it, rather than in each context-menu consumer.
- Radix context menus treat an already-prevented `contextmenu` event as a
  cancellation. The shared trigger must carry a marker so the document capture
  listener skips it; Radix then suppresses the default and opens normally.
- The current shared `ContextMenu` foundation owns positioning and opening;
  changing it would couple global browser policy to a reusable menu primitive.
- No iframe/embed-specific context-menu host was found in `packages/ui/src` or
  `docs`; this plan applies to the document hosting `DamHopperApp` only.

## Requirements

1. Every cancelable `contextmenu` event in the DamHopper document has its native
   default prevented, including targets not wrapped in `ContextMenu.Trigger`.
2. Existing Radix triggers still receive the event and display their menu.
3. Event propagation remains intact for all existing React/Radix and local
   handlers.
4. Unmounting the hook removes exactly its capture listener; later events are
   not default-prevented by this feature.
5. Keep the change client-only, dependency-free, and compatible with React 19,
   TypeScript strict mode, JSDOM, and Chromium.

## Architecture

```
right-click -> document capture listener -> unmarked: preventDefault -> nothing
                                       -> marked trigger: Radix prevents default
                                                          -> configured menu opens
```

Install `useBrowserContextMenuSuppression()` once from `DamHopperApp`, adjacent
to `useBrowserShortcutGuard()`. Its effect registers
`document.addEventListener("contextmenu", handler, { capture: true })` and the
cleanup uses the same target, handler, and capture option. An enabled
`ContextMenu.Trigger` adds the shared marker; the handler skips marker paths and
prevents the default for every other path, including disabled triggers. It never
stops propagation. This is deliberately
document-wide but is limited to the document that mounts the app.

## Related Code Files

| Action | File | Change |
|---|---|---|
| Create | `packages/ui/src/lib/context-menu-trigger-marker.ts` | Shared marker and composed-path check for trigger ownership. |
| Create | `packages/ui/src/hooks/use-browser-context-menu-suppression.ts` | Small effect hook using document capture, marker check, and exact cleanup. |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` | Import and invoke the hook once at application root. |
| Create | `packages/ui/src/hooks/use-browser-context-menu-suppression.test.tsx` | JSDOM lifecycle and Radix propagation coverage. |
| Create | `packages/ui/browser-tests/global-native-context-menu-suppression.browser.tsx` | Chromium checks for bare and configured targets. |
| Modify | `docs/system-architecture.md` | Add one sentence to Context-menu placement invariant; preserve existing line endings and unrelated bytes. |

## Implementation Steps

1. Add the trigger marker module, then add the hook next to
   `use-browser-shortcut-guard.ts`, importing `useEffect`. Register a
   `contextmenu` listener on `document` with `{ capture: true }`. The handler
   skips events whose composed path has the shared trigger marker; for every
   other event it calls only `event.preventDefault()` and returns a matching
   remove callback. Do not add state, a provider, options, or package-root exports.
2. In `DamHopperApp`, add the hook import and invoke it next to the browser
   shortcut guard, before app routes render. Do not alter guards, providers,
   router, or menu consumers.
3. Add a JSDOM hook harness. Dispatch a `MouseEvent("contextmenu", {
   bubbles: true, cancelable: true, button: 2 })` on an unconfigured element and
   assert `defaultPrevented`; a target handler that stops bubbling must not change
   that result. Unmount, dispatch a fresh cancelable event, and assert it is not
   prevented. Render a `ContextMenu.Root` trigger in the same harness, dispatch
   the event, assert it is prevented and its Radix menu is visible. Dispatch on
   a disabled trigger and assert it is prevented without opening. This proves
   trigger marker handling preserves Radix opening without leaking native menus.
4. Add a Chromium browser test using the existing `createRoot`/`act` harness.
   Mount the suppression hook with a plain target and a minimal shared Radix
   menu. Assert the plain target's dispatch is default-prevented and no
   `[role="menu"]` appears; dispatch on the trigger and assert
   `defaultPrevented` plus its `[role="menu"]` content appears. Use cancelable
   events; non-cancelable synthetic events cannot test the contract.
5. Amend only the Context-menu placement invariant in
   `docs/system-architecture.md`: native browser context menus are globally
   suppressed at document capture, and propagation is intentionally preserved
   for Radix/custom handlers. Preserve its existing newline convention; do not
   normalize or rewrite adjacent architecture content.
6. Run `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`,
   and `pnpm --filter @dam-hopper/ui test:browser`. Investigate any failure before
   modifying assertions or implementation.

## Todo List

- [x] Add minimal document-capture suppression hook.
- [x] Mount it in `DamHopperApp`.
- [x] Add JSDOM lifecycle and Radix propagation assertions.
- [x] Add Chromium unconfigured/configured checks.
- [x] Record the placement invariant without line-ending churn.
- [x] Pass UI unit, build, and browser quality gates.

## Completion Evidence

- Enabled triggers receive the shared marker and are skipped by the capture
  listener, preserving Radix opening. Disabled triggers remain unmarked, while
  all unconfigured targets prevent the browser-native menu without stopping
  propagation.
- `pnpm --filter @dam-hopper/ui test`: 109 files, 579 tests passed.
- `pnpm --filter @dam-hopper/ui build`: passed.
- `pnpm --filter @dam-hopper/ui test:browser`: 8 files, 28 tests passed.
- Code review: 10/10; no Critical findings or warnings. User approved.

## Success Criteria

- Unconfigured right-clicks have `defaultPrevented === true` and render no app
  menu.
- A configured Radix trigger still opens exactly its expected menu.
- The listener disappears on component unmount.
- Existing context-menu tests remain green; no API, server, schema, auth, config,
  or package dependency diff exists beyond the planned files.

## Risk Assessment

- **Radix regression:** stopping propagation would prevent trigger opening.
  **Mitigation:** handler calls only `preventDefault()`; test a real trigger in
  JSDOM and Chromium.
- **Leaked global listener:** remounts could leave suppression active after UI
  teardown. **Mitigation:** exact handler/capture cleanup and explicit unmount
  test.
- **Synthetic test false positive:** a non-cancelable event cannot become
  default-prevented. **Mitigation:** make all dispatched contextmenu events
  `cancelable: true`.
- **Documentation diff noise:** architecture file may use non-default newlines.
  **Mitigation:** patch its exact paragraph only and review the diff.

## Security Considerations

- This is UI behavior, not a security boundary; users can still use browser
  tooling and alternate documents.
- No credentials, auth decisions, user data, telemetry, network requests, or
  server input are added.
- No API/client compatibility, permissions, session, database/migration,
  data-integrity, configuration, deployment, or onboarding effect is expected.

## Side-Effect Review Checklist

- [x] Auth, sessions, permissions, roles: no effect.
- [x] API/client public contracts: no effect.
- [x] Database, migrations, data integrity: no effect.
- [x] Business logic: no effect outside right-click default browser UI.
- [x] Security, privacy, secrets, logging: no effect; not a security control.
- [x] Performance/concurrency/resources: one passive-lifetime document listener;
  negligible synchronous work per right-click.
- [x] Docs/config/onboarding/deployment: one invariant sentence; no config or
  onboarding step.
- [x] Compatibility/accessibility: preserve Radix pointer and keyboard paths;
  no iframe support found, so no cross-document listener is introduced.

## Next Steps

Completed. No follow-up implementation work planned.

## Unresolved Questions

None.
