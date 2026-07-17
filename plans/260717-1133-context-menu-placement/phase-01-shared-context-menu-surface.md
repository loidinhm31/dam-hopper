# Phase 01 — Radix context-menu foundation

## Context links

- Parent: [plan.md](./plan.md)
- Architecture: [system-architecture.md](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md)
- Brainstorm: [report](/mnt/data/ws/sharing/dam-hopper/plans/reports/brainstorm-260717-1133-context-menu-placement.md)
- Official API: [Radix Context Menu](https://www.radix-ui.com/primitives/docs/components/context-menu)

## Overview

- Priority: P1
- Status: Done — 2026-07-17 17:00 +0700
- Effort: 3.5h
- Description: add Radix Context Menu and establish one shared wrapper/contract for all seven consumers.
- Review status: Approved — 8/10 review baseline; follow-up warnings resolved before approval

## Key insights

- Radix provides the required body portal, collision handling, focus management, keyboard navigation, and layering.
- `backdrop-filter` and `overflow-hidden` make inline fixed descendants unsafe; every content surface must use `ContextMenu.Portal`.
- Radix must be proven against react-arborist rows, tablist tabs, checkbox rows, Radix Select, and lifted diagnostics before broad migration.

## Requirements

- Add a direct `@radix-ui/react-context-menu` dependency at a version compatible with the existing Radix generation; update `pnpm-lock.yaml` normally.
- Create `packages/ui/src/components/ui/ContextMenu.tsx` as a thin wrapper/re-export for Root, Trigger, Portal, Content, Item, CheckboxItem, Label, and Separator.
- Configure Content with `avoidCollisions`, `collisionPadding={8}`, shared z-index, and max dimensions using Radix available-space CSS variables. The selected Radix Context Menu API does not expose `sideOffset`; rely on its native pointer anchor and do not add custom geometry to emulate it.
- Require `Trigger asChild` so existing DOM semantics remain intact; use controlled roots where state is currently lifted.
- Keep action content in consumers; wrapper owns portal, collision defaults, dismissal, and consistent classes.
- Close on capture-level scroll through the wrapper/root coordinator; preserve Radix Escape, outside-pointer, and focus-return behavior.
- Guarantee only one custom context menu is open at a time without a global app store.

## Architecture

`trigger DOM node → ContextMenu.Root → ContextMenu.Trigger asChild → ContextMenu.Portal(document.body) → ContextMenu.Content → Radix collision/focus/dismissal`

Consumers own domain state and item callbacks. The shared wrapper owns styling and defaults. No consumer may use viewport clamp constants, local coordinate subtraction, inline fixed positioning, or a second portal implementation.

## Related code files

Create:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenu.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenu.test.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenuCompatibility.test.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/context-menu-coordinator.ts`

Modify:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/package.json`
- `/mnt/data/ws/sharing/dam-hopper/pnpm-lock.yaml`
- UI barrel/export file only if package conventions require it

Delete: custom `context-menu-placement.ts`/`ViewportContextMenu.tsx` drafts if created; they are not part of the Radix path.

## Implementation steps

1. Run a compatibility spike with one react-arborist row, editor tab, Changed Files checkbox row, Radix Select branch action, and lifted diagnostics trigger.
2. If the spike passes, add the direct Radix dependency and lockfile entry; if it fails, record the blocker and activate the documented dependency-free fallback.
3. Build the thin wrapper with shared Content styling, collision padding, z-index, available-space max dimensions, and controlled/uncontrolled root support.
4. Add one-open-menu coordination and capture-scroll close without replacing Radix dismissal/focus behavior.
5. Run wrapper tests and type-check before consumer migration.

## Todo list

- [x] Compatibility spike passes for all trigger categories.
- [x] Add Radix dependency and lockfile update.
- [x] Add shared wrapper/re-exports and styles.
- [x] Add scroll/one-open-menu coordination.
- [x] Add wrapper interaction tests.

## Success criteria

Wrapper renders Content under `document.body`, uses Radix collision/focus behavior, exposes a stable API for all seven consumers, and introduces no custom geometry helper.

## Risk assessment

- Radix Select and Context Menu dismissable layers may race: spike and browser-test this before branch migration.
- `asChild` can fail when a trigger child does not forward refs: use a small DOM adapter only where required.
- Radix scroll behavior may differ from close-on-scroll: add the wrapper listener and test cleanup.

## Security considerations

No server or privileged operations. Preserve action authorization and render labels as React text, not injected HTML.

## Next steps

Only after the spike and wrapper tests pass, migrate the three directly affected floating-panel menus first.

## Unresolved questions

- Selected dependency range is `^2.2.6`, resolved to `2.3.3` in `pnpm-lock.yaml`; the compatibility spike passed.
- Radix Context Menu's public Content API does not expose `sideOffset`; native pointer anchoring is used without custom geometry.
