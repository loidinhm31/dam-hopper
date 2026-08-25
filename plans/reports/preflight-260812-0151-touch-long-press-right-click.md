# Preflight Contract: Touch Long-Press Context Menus

## Output
- Isolated implementation on `.worktree`, branch `feat/touch-long-press-right-click`.
- Explorer rows and editor tabs invoke their existing app context menus on touch long-press.
- Regression coverage and architecture/roadmap notes; no Monaco text-menu invention.

## Acceptance Criteria
- Existing Radix `ContextMenu.Trigger` remains the single long-press owner; no duplicate timer/global gesture dependency.
- Explorer row long-press opens the correct existing file/folder menu once and preserves action targeting.
- Editor tab long-press opens the existing Close/Close Other Tabs/Close All menu once and targets the correct tab.
- Pointer movement/scroll/drag cancellation does not open a menu; pointer-up/cancel/unmount cleanup is safe.
- Desktop mouse right-click, keyboard ContextMenu/Shift+F10, Escape/outside/scroll dismissal, Radix focus, and portal placement remain intact.
- Monaco text/preview surfaces remain explicitly out of scope.
- UI typecheck and focused unit/browser tests pass; browser coverage documents the limits of synthetic/mobile emulation.

## Scope Boundary
**In scope:** shared context-menu contract audit; Explorer live rows; editor tabs; Radix marker/suppression compatibility; touch long-press regression tests; docs/roadmap update.

**Out of scope:** Monaco text/preview context-menu actions; new menu commands; server/Rust/API/database/auth/config/native bridge changes; global `touch-action` or gesture dependency; redesign of selection semantics.

## Risk / Public Contract Areas
- No network/API/data/auth/permission contract changes expected.
- Preserve `ContextMenu.Trigger asChild` ref/prop forwarding, `data-dam-hopper-context-menu-trigger`, react-arborist drag refs, scrolling, click activation, text selection, Radix focus, and one-open coordination.
- Browser-generated `contextmenu` ordering differs by platform; Radix's built-in 700 ms non-mouse timer and native-event cleanup must not be duplicated.

## Affected Files / Systems
- `packages/ui/src/components/ui/ContextMenu.tsx` and suppression/marker hooks: verify only; modify only if a test proves a contract defect.
- `packages/ui/src/components/organisms/FileTree.tsx`, `TreeContextMenu.tsx`, `EditorTabs.tsx`, `EditorTab.tsx`, `EditorTabContextMenu.tsx`: existing consumers; preserve composition.
- `packages/ui/browser-tests/consumer-context-menu.browser.tsx`: add touch hold/cancellation coverage for Explorer and editor tabs.
- `packages/ui/src/components/ui/ContextMenu.test.tsx` or consumer tests: add deterministic lifecycle coverage only if browser coverage cannot cover it.
- `docs/system-architecture.md`, `docs/project-roadmap.md`: document the contract and validation status.

## Testing Strategy
- `pnpm --filter @dam-hopper/ui build` (TypeScript).
- Focused Vitest unit/component tests for trigger/consumer regressions.
- `pnpm --filter @dam-hopper/ui test:browser` or focused browser file for Chromium portal, touch-hold, cancellation, and existing mouse/keyboard paths.
- Manual/physical Android Chrome and iOS Safari follow-up noted as residual risk; Playwright/WebKit emulation is not device certification.

## Open Questions
- None blocking. Product scope confirmed: existing app menu; Editor means tabs only. Radix's existing 700 ms/cancel-on-move policy is the implementation assumption. Physical-device matrix and Explorer selection-before-menu semantics remain follow-up decisions, not blockers.
