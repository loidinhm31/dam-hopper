# Research Report: Radix Context Menu touch/long-press

**Timestamp:** 2026-08-12 02:10 +07 (Asia/Saigon)
**Scope:** `@radix-ui/react-context-menu` 2.2.x/2.3.x, React 19, app `asChild` wrapper, synthetic `contextmenu`, trigger marker, adapter decision.
**Mode:** read-only source review; no product/source implementation.

## Executive summary

Radix already implements touch/pen long-press. No long-press adapter is justified for a target already inside this repository's `ContextMenu.Trigger`. The 2.2.0 and 2.2.6 package sources start a 700 ms timer on non-mouse `pointerdown`; `pointermove`, `pointercancel`, and `pointerup` cancel it. The 2.3.3 and 2.3.7 sources retain that behavior. A browser-emitted `contextmenu` also opens the menu and clears the timer, preventing the normal native-event/timer duplicate.

The app marker is not a Radix feature; it is required by the app's document-capture suppression policy. `ContextMenu.tsx` forces Radix `asChild` and adds `data-dam-hopper-context-menu-trigger` to the actual child. The capture listener skips marked paths, allowing Radix's `onContextMenu` handler to run. An unmarked native or synthetic `contextmenu` is `preventDefault()`ed before Radix receives it. Thus a custom timer on an existing Radix trigger would duplicate Radix behavior and create focus/anchor/double-open risks.

For a surface that cannot be made a Radix trigger, the smallest safe solution is first to wrap the real DOM target in `Root` + `Trigger asChild`. Only if that is impossible should a focused bridge dispatch one bubbling, cancelable synthetic `contextmenu` to a marked Radix trigger, with 700 ms touch/pen timing, cancellation, and native-event deduplication. Do not add global touch listeners, `touch-action: none`, or `preventDefault()` on pointer-down.

## Sources and method

- Inspected local package/wrapper, lockfile, consumers, tests, architecture notes, and git status.
- Packed and inspected exact npm artifacts 2.2.0, 2.2.6, 2.3.3, and 2.3.7; package source maps include `src/context-menu.tsx` as `sourcesContent`.
- Consulted official Radix Context Menu and Composition documentation, upstream source, npm registry metadata, and MDN `contextmenu` reference.

## Findings

### 1. Radix long-press behavior — no adapter needed

Exact package source behavior (all inspected versions):

```text
pointerdown, pointerType !== "mouse"  -> clear prior timer; set 700 ms timer
pointermove / pointercancel / pointerup -> clear timer
contextmenu                          -> clear timer; open at event.clientX/Y; preventDefault
700 ms timeout                        -> open at pointer-down clientX/Y directly
```

The source uses `whenTouchOrPen`, so pen is included intentionally. It does not synthesize a `contextmenu` event when its timer expires; it calls its internal `handleOpen` directly. Some platforms emit `contextmenu` for long-press, so Radix handles that path too and clears the timer. `WebkitTouchCallout: none` is applied to the trigger to suppress the iOS callout.

Important nuance: Radix's timer can open without the marker, but the marker is still required for reliability when a browser emits `contextmenu` before pointer-up. The app capture listener would otherwise prevent that event before Radix's composed handler runs.

### 2. `asChild`, React 19, and the local trigger

Local evidence:

- `packages/ui/package.json:23` declares `@radix-ui/react-context-menu: ^2.2.6`.
- `pnpm-lock.yaml:169-171` resolves it to `2.3.3` with React 19.2.4; `pnpm-lock.yaml:1036-1045` records peer support for React/React DOM `^19.0`.
- `packages/ui/package.json:47-48,59-60` uses React 19.
- `packages/ui/src/components/ui/ContextMenu.tsx:67-110` wraps Radix Trigger with `React.forwardRef`, always sets `asChild`, and merges the keyboard opener.

Radix Composition docs state that `asChild` clones the child and passes behavior/props; a custom child must spread props and forward its ref. This is especially important here because the app marker, `onContextMenu`, pointer handlers, state attributes, and Radix ref all must reach the real DOM element. `EditorTab.tsx:31-62` and `FileTree.tsx:148-207` satisfy this pattern (forward ref + DOM prop spread).

React 19 is not a blocker: both 2.2.x and 2.3.x package peer ranges explicitly include React 19. The app's current lockfile is 2.3.3, not merely the declared 2.2.6 floor. No touch-specific upgrade is indicated by the inspected source. 2.3.x adds controlled-open/interaction tracking and improved virtual-anchor re-creation/re-anchoring; its long-press algorithm remains the same.

### 3. Synthetic `contextmenu` and marker event flow

Current keyboard path: `ContextMenu.tsx:81-99` handles `ContextMenu` / `Shift+F10`, prevents the keyboard default, and dispatches a native DOM `MouseEvent("contextmenu")` from the child, with `bubbles: true` and the trigger's center coordinates.

Flow:

```text
keyboard or adapter dispatches contextmenu
  -> event bubbles through actual asChild DOM child
  -> document capture suppression checks composedPath()
       marked child: return (do not preventDefault)
       unmarked child: preventDefault()
  -> Radix Trigger's composed onContextMenu handler
       if not already prevented: clear timer, set anchor, open, preventDefault
```

The marker is app policy, not a Radix contract:

- `packages/ui/src/lib/context-menu-trigger-marker.ts:1-8` checks every composed-path element for `data-dam-hopper-context-menu-trigger`.
- `packages/ui/src/hooks/use-browser-context-menu-suppression.ts:8-23` installs the document capture handler and suppresses unmarked paths.
- `packages/ui/src/components/ui/ContextMenu.tsx:77-79,102-107` marks enabled triggers; disabled triggers are intentionally unmarked.

The keyboard event is a real DOM event, not a React `SyntheticEvent`; React 19's delegated event system still receives it. It works because it bubbles and the marker is on the composed path. The current synthetic event omits `cancelable: true` and `button: 2`. This does not prevent Radix from opening, but a future bridge should include both so `preventDefault()` and context-menu semantics are observable to downstream listeners.

A custom synthetic event dispatched on an unmarked target will be suppressed at document capture and will not reach Radix's open handler (`composeEventHandlers` honors `defaultPrevented`). A custom event dispatched on a marked Radix trigger is viable, but unnecessary when Radix's own timer is present.

### 4. Version matrix

| Version | Release evidence | Long-press implementation | Relevant difference |
|---|---|---|---|
| 2.2.0 | npm registry: 2024-06-19 | 700 ms non-mouse timer; move/cancel/up cancellation; contextmenu fallback | React 19 peer range already present |
| 2.2.6 | npm registry: 2025-02-05; project declared floor | Same | Uses ref-backed virtual point; source has callback-ref dependency |
| 2.3.0–2.3.3 | npm registry: 2026-06-06 through 2026-07-06; project resolves 2.3.3 | Same 700 ms behavior | Controlled `open`, `hasInteractedRef`, state-backed virtual anchor; 2.3.3 closes an already-open menu on new touch down |
| 2.3.7 | npm registry latest at research time | Same in inspected source | Dependency updates only in the relevant trigger block |

The official docs page currently displays 2.3.4, while this worktree locks 2.3.3. Cite the exact npm artifact for version-specific claims rather than assuming the docs page version.

### 5. Accessibility, focus, and dismissal

Radix owns the WAI-ARIA menu pattern, roving tabindex, first-item/menu focus, keyboard navigation, Escape, outside interaction, layering, and focus restoration. The local architecture explicitly delegates those responsibilities (`docs/system-architecture.md:2032-2042`). Keep the native Root/Trigger/Portal/Content path intact.

Risks from an adapter or faulty `asChild` child:

- Child does not spread Radix props: no `onContextMenu`/pointer handlers or marker; browser event is globally suppressed.
- Child does not forward ref: Radix anchor/measurement and focus behavior can break.
- Non-focusable `div` used where keyboard invocation is required: `ContextMenu` / `Shift+F10` cannot originate there. Preserve the existing row/tab semantics.
- Calling `preventDefault()` on `pointerdown`, setting global `touch-action: none`, or stopping propagation can break scrolling, Arborist drag, text selection, caret placement, click activation, and OS accessibility callouts.
- Opening a second controlled Root or dispatching both a custom timer and Radix's timer can lose the originating trigger, re-anchor incorrectly, or produce duplicate opens/actions. Radix 2.3.x's re-anchor behavior does not make duplicate openers safe.
- Radix cancels on any touch/pen `pointermove`; there is no movement threshold. Small finger jitter may cancel a long press. Verify on real touch hardware before changing this policy.

## Smallest safe adapter decision

1. **Existing Radix trigger:** add nothing. Keep the target as the direct `ContextMenu.Trigger` child, preserve ref/prop forwarding, and test real touch/pen behavior.
2. **Target not currently wrapped:** compose the existing target under `ContextMenu.Root` and the local `ContextMenu.Trigger` (which forces `asChild`). Reuse existing menu actions; do not write a parallel timer.
3. **Cannot wrap target:** use a narrow bridge only at that surface. Listen to touch/pen pointer-down, start one 700 ms timer, cancel on move/up/cancel/lost capture/unmount, and dispatch one `MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX, clientY })` to a marked Radix trigger. Clear the bridge timer on native `contextmenu`; guard against a second open. Do not globally suppress/disable touch behavior. If no marked Radix trigger can receive the event, use a controlled Radix Root/virtual anchor instead of relying on the global marker policy.

For the current editor situation, `EditorTabs.tsx:210-239` already wraps tabs; the active Monaco surface is a different product scope and has no existing text-action menu. Do not add a Monaco long-press adapter until actions and target semantics are decided.

## Review findings (severity)

- **Medium — unverified device behavior:** `docs/project-roadmap.md:343-346` records that touch long-press was not run in headless Linux. Official support and source coverage are strong, but Chromium mobile emulation/real iOS/Android smoke coverage is still needed.
- **Medium — `asChild` integration contract:** `packages/ui/src/components/ui/ContextMenu.tsx:67-110`; every future custom trigger must forward refs and spread props. Failure also removes the marker and causes the global suppression hook to mask native/synthetic `contextmenu`.
- **Low — synthetic event completeness:** `packages/ui/src/components/ui/ContextMenu.tsx:90-97` omits `cancelable: true` and `button: 2`. Current Radix opening still works; add those fields only if hardening the keyboard/bridge event contract, not as a long-press fix.
- **High if introduced — duplicate adapter:** adding a timer beside an existing Radix Trigger would race the built-in 700 ms timer and browser `contextmenu` fallback. Recommendation: explicitly reject this implementation.

## Authoritative references

1. [Radix Context Menu documentation](https://www.radix-ui.com/primitives/docs/components/context-menu) — explicitly describes right-click/long-press, Trigger, accessibility, focus, keyboard, and dismissal; current docs page shows 2.3.4.
2. [Radix Composition / `asChild` guide](https://www.radix-ui.com/primitives/docs/guides/composition) — child must spread props and forward refs.
3. [Radix upstream Context Menu source](https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/context-menu/src/context-menu.tsx) — current trigger timer/contextmenu implementation.
4. [Exact 2.2.0 package source map](https://unpkg.com/@radix-ui/react-context-menu@2.2.0/dist/index.js.map), [2.2.6 source map](https://unpkg.com/@radix-ui/react-context-menu@2.2.6/dist/index.js.map), [2.3.3 source map](https://unpkg.com/@radix-ui/react-context-menu@2.3.3/dist/index.js.map), [2.3.7 source map](https://unpkg.com/@radix-ui/react-context-menu@2.3.7/dist/index.js.map) — exact published source artifacts inspected for version comparisons.
5. [npm package metadata](https://registry.npmjs.org/@radix-ui/react-context-menu) — versions, release timestamps, peer ranges, and current dist tag.
6. [MDN `contextmenu` event](https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event) — browser event/default-prevention behavior.
7. Local [shared wrapper](../../packages/ui/src/components/ui/ContextMenu.tsx), [suppression hook](../../packages/ui/src/hooks/use-browser-context-menu-suppression.ts), [marker](../../packages/ui/src/lib/context-menu-trigger-marker.ts), [architecture invariant](../../docs/system-architecture.md#context-menu-placement-invariant).

## Unresolved questions

1. Is the requested touch target only Explorer rows/editor tabs (already Radix-wrapped), or also Monaco text/content (no existing app action model)?
2. If Monaco is in scope, which actions and selection/target semantics should long press invoke?
3. What real-device/browser matrix and acceptance delay/movement tolerance should product require? Radix hardcodes 700 ms and cancels on any move.
4. Should an unselected Explorer row be selected before its long-press menu opens, and how should multi-selection be preserved?

## Conclusion

Do not implement a generic long-press adapter in the shared wrapper. Radix 2.2.x and 2.3.x already provide the behavior, and the local marker is the correct companion to the app's native-menu suppression. Validate the existing trigger path on touch hardware; only bridge an explicitly unwrapped surface, and route that bridge through one marked Radix trigger with strict cancellation/deduplication.
