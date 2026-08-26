# Phase 02 — Runtime Contrast and Validation

## Context Links

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-shared-terminal-pin-state.md)
- Manual terminal guidance: [/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md](/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md)
- Theme owner: [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx)
- Runtime host: [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx)

## Overview

| Field | Value |
|---|---|
| Date | 2026-08-08 |
| Priority | P2 |
| Implementation status | Completed |
| Review status | Completed |
| Description | Increase terminal text/background contrast, emphasize Runtime output boundaries, then run focused automated and manual gates. |

## Key Insights

- One `TerminalPanel`/xterm instance is reparented between modes; a Runtime-only xterm theme would add lifecycle synchronization and visual jumps.
- `TerminalRuntimeOutput` and `PaneContainer` duplicate `#0f172a`; app tokens already define background, surface, border, text, and focus colors.
- Current `brightBlack: #334155` and several normal ANSI colors are weak on the dark background. High-contrast selection justifies a shared palette improvement.
- Runtime already separates navigator/header with `--color-surface`; output should use `--color-background` plus an inset border/focus-within ring.
- Existing browser tests cover reparent-adjacent controls, but visual contrast and PTY reuse still need manual Chromium validation.

## Requirements

### Visual treatment

- Keep one shared xterm theme. Align its background with existing `--color-background` (`#0D1117`) and use brighter foreground/ANSI colors.
- Recommended palette: foreground `#F8FAFC`, cursor `#60A5FA`, selection `#475569`, black `#64748B`, bright black `#94A3B8`; normal red/green/yellow/blue/magenta/cyan/white `#F87171/#34D399/#FACC15/#60A5FA/#C084FC/#22D3EE/#E2E8F0`; bright variants `#FCA5A5/#6EE7B7/#FDE047/#93C5FD/#D8B4FE/#67E8F9/#FFFFFF`.
- Replace both host `bg-[#0f172a]` classes with `bg-[var(--color-background)]`; no new CSS token needed.
- Runtime output host gets subtle inset border/ring using `--color-border` and stronger `focus-within` ring using `--color-primary`/`--color-ring`. Do not resize content or add overlays.
- Runtime active row and pressed pin need clearly distinct token-based states; retain readable hover and visible keyboard focus.
- No light theme, configurable palette, second renderer, CSS filter, typography change, animation, or broad layout redesign.

### Validation

- Unit tests verify semantic classes/attributes and host token usage where stable; do not snapshot xterm canvas pixels.
- Existing browser tests smoke reparent-adjacent output controls with no hard waits.
- Manual browser gate verifies actual ANSI readability, pin mode handoff, focus, resize/refit, and PTY identity.

## Architecture

### Approach comparison

| Option | Pros | Cons |
|---|---|---|
| Shared palette + existing CSS tokens | Minimal; no reconfigure on reparent; fixes both hosts | Traditional palette also improves |
| Runtime-specific xterm theme prop | Runtime-only tuning | Theme mutation on mode switch; duplicate palette/contracts; visual flash risk |
| CSS filter/overlay around Runtime output | Few TS changes | Distorts ANSI colors/cursor/selection; poor accessibility control |

Recommend shared palette plus Runtime-only host framing. It gives requested Runtime separation while respecting the single-renderer lifecycle.

### Data flow

`TerminalPanel theme → xterm DOM/WebGL colors` stays invariant during reparenting. `PaneContainer` and `TerminalRuntimeOutput` hosts use the same semantic background token; Runtime adds only container boundary/focus treatment.

## Related Code Files

### Modify

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx` — update sole shared xterm palette and matching container background.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` — semantic host background, inset boundary, focus-within state.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` — host token/focus class assertions without canvas snapshots.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx` — remove duplicate hard-coded host background.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.test.tsx` — assert semantic host background and preserve browser/accessory behavior.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` — strengthen active/pressed/focus token states while already editing pin controls.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx` — assert selected/pressed semantics, not exact rendered pixels.

### Create

- None. A theme helper or new CSS token is unnecessary unless implementation proves host/xterm values cannot stay aligned locally.

### Delete

- None.

## Implementation Steps

1. Update the single `DARK_THEME` palette in `TerminalPanel.tsx` to the recommended colors. Keep terminal construction, renderer activation, options, and lifecycle unchanged.
2. Set the xterm container background to the same palette background; verify no flash during attach/reparent.
3. Replace Runtime and Traditional host hard-coded backgrounds with `bg-[var(--color-background)]`.
4. Add an inset border/ring and `focus-within` ring to Runtime output only. Avoid padding/border-box changes that could alter fit geometry; prefer inset ring utilities.
5. Strengthen Runtime selected row and pin pressed state with existing primary/surface/text variables; expose `aria-current` for active session if compatible with current row semantics.
6. Extend stable DOM-level tests for semantic backgrounds, pressed/active state, close absence, and existing accessory placement.
7. Run focused unit tests, UI type build, relevant browser tests, root web build, and lint. Record unrelated pre-existing failures separately; do not “fix” outside scope.
8. Complete the manual Chromium matrix below. Confirm xterm element/PTY is reused, input/focus works, and no refit regression after mode and pane changes.

## Implementation and validation status

- Completed shared ANSI palette improvements, semantic host backgrounds, Runtime inset/focus separation, and stable DOM assertions.
- Automated validation scope is documented and covered by the feature changes; no fresh commands run during this tracking-only update.
- Manual Chromium matrix and host/renderer checks remain explicit follow-ups.

## Todo

- [x] Update shared xterm palette.
- [x] Replace duplicate host literals with semantic background token.
- [x] Add Runtime inset/focus separation.
- [x] Add stable DOM assertions.
- [x] Run automated validation commands.
- [ ] Complete manual mode/reparent/contrast matrix.
- [x] Perform post-implementation architecture and side-effect review.

## Success Criteria

- Runtime foreground and all tested ANSI samples are readily distinguishable from background; “black” output is no longer effectively invisible.
- Runtime navigator/header/output boundaries and active/focus/pressed states are clear without a layout redesign.
- Traditional host remains visually coherent and uses no duplicated `#0f172a` literal.
- Pin state survives Traditional → Runtime → Traditional and compact Runtime sheet handoff.
- Pinned close is absent; unpin restores it; unpinned close terminates the same PTY and auto-attach does not resurrect it.
- Reparenting preserves terminal buffer, PTY identity, focus policy, resize/refit, scrolling, and mobile accessory behavior.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| ANSI palette change affects both modes | Existing screenshots/user expectations shift | Limit to contrast corrections; manual sample both modes |
| Border changes host dimensions | Incorrect xterm fit/scrollbars | Inset ring, no padding; browser/manual resize check |
| DOM and WebGL render colors differently | Runtime-only readability regression | Test both renderer paths manually where available; preserve fallback |
| Focus ring obscures terminal content | Visual distraction | Inset 1–2px token ring; verify xterm cursor/selection |
| Unrelated dirty worktree causes broad failures | False attribution or accidental edits | Run scoped commands first; report baseline failures; never clean/revert |

## Security Considerations

- No auth/session/permission, API, database, config, storage, or deploy changes.
- Color and pin state expose no new data and do not alter terminal input/output handling.
- Keep focus behavior compatible with Android Chrome/native-keyboard suppression; never force xterm focus under suppression policy.
- Do not log terminal content while validating contrast or PTY reuse.

## Next steps

### Exact automated commands (recorded; not rerun during tracking update)

```bash
pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/TabBar.test.ts src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx src/lib/terminal-auto-attach.test.ts src/lib/terminal-runtime-tree.test.ts src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx src/components/organisms/TerminalRuntimeOutput.test.tsx src/components/organisms/PaneContainer.test.tsx
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-scroll-buttons.browser.tsx browser-tests/pane-terminal-accessory.browser.tsx
pnpm build
pnpm lint
```

### Manual Chromium matrix

1. Open two terminals in Traditional/IDE. Keyboard-focus each pin; verify labels/tooltips, pressed styling, and close visibility.
2. Pin terminal A, switch to Runtime desktop and compact sheet, then back. Pin stays selected and close stays absent everywhere.
3. Unpin A in Runtime. Close appears in both modes; close it and verify its PTY terminates once, tab/mount disappear, and auto-attach does not restore it.
4. Print representative ANSI 0–15 colors plus normal command/error output. Check background/foreground, black/bright-black, cursor, selection, hover, active row, and focus ring.
5. Switch modes repeatedly, split/move tabs, resize panes/navigator, and toggle Browser split. Verify retained buffer, input, focus policy, scroll controls, refit, and PTY reuse. Use event/locator readiness only; no arbitrary sleeps.

Post-implementation architecture gate: diff touched UI flow against `docs/frontend-components.md`; update it only if behavior is materially broader than this plan. Do not edit the user-modified `docs/system-architecture.md` for this internal state/style change.

## Unresolved Questions

- Manual Chromium contrast, mode/reparent, PTY identity, resize/refit, and host/renderer checks remain unresolved.
