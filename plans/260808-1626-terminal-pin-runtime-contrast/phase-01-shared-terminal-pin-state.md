# Phase 01 — Shared Terminal Pin State

## Context Links

- Parent: [plan.md](./plan.md)
- Architecture guidance: [/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md](/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md)
- Manager: [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-manager.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-manager.ts)
- Auto-attach: [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.ts)

## Overview

| Field | Value |
|---|---|
| Date | 2026-08-08 |
| Priority | P2 |
| Implementation status | Completed |
| Review status | Completed |
| Description | Add one session-memory pin bit, safe close guard, and accessible controls to both live terminal modes. |

## Key Insights

- `useTerminalManager.openTabs` is already the shared client source across mode switches.
- `TabEntry` lives in `TerminalTabBar.tsx`, but current production Traditional tabs render through `PaneContainer → TabBar → DraggableTab`.
- `deriveTerminalAutoAttachState` refreshes tab metadata with object spread; explicitly preserve and compare the new transient bit to prevent later refactors from dropping it.
- Runtime needs `TabEntry.isPinned → RuntimeSessionItem.isPinned` propagation before navigator leaves can render state.
- Existing close kills the PTY before removing tab/mounted state. Pinned guard must return before every side effect.

## Requirements

### Functional

- Add `isPinned?: boolean` to `TabEntry`; absent means unpinned and newly discovered/opened tabs default unpinned.
- Add manager action `handleToggleTabPin(sessionId)` using immutable `setOpenTabs` mapping.
- `handleCloseTab` no-ops for a pinned tab before suppression refs, `api.terminal.kill`, query invalidation, active-tab changes, or UI removal.
- Both live surfaces consume the same tab state. No local component pin state.
- Auto-attach metadata refresh, live-session projection, layout movement, and IDE/Runtime switches retain `isPinned`.
- Unpinned close keeps current PTY termination/removal behavior exactly.

### Accessible control contract

| State/control | `aria-label` | Tooltip (`title`) | Other semantics |
|---|---|---|---|
| Unpinned pin | `Pin terminal` | `Pin terminal (prevents closing)` | `aria-pressed="false"` |
| Pinned pin | `Unpin terminal` | `Unpin terminal (allows closing)` | `aria-pressed="true"`, primary selected styling |
| Unpinned close | `Close terminal` | `Close terminal (terminates process)` | Existing callback |
| Pinned close | Not rendered | Not present | Cannot receive pointer/keyboard focus |

Use real `<button type="button">` controls, stop row/tab selection propagation, and add visible `focus-visible` rings using existing primary/ring tokens. Pin remains visible in both states; use Lucide `Pin`/`PinOff` or one `Pin` icon with pressed styling, whichever reads most clearly at existing sizes.

### Non-functional

- No persistence, transport calls, config fields, dependencies, or PTY lifecycle changes.
- Keep compact/touch hit targets at least as large as current Runtime close target.
- Preserve drag, select, diagnostics context menu, status dot, save-profile, split-pane, and tunnel behavior.

## Architecture

### Approach comparison

| Option | Pros | Cons |
|---|---|---|
| Shared `TabEntry.isPinned` | Lowest complexity; naturally crosses modes; removed with tab/manager | Prop must pass through existing component chain |
| Manager-owned `Set<string>` | Separates metadata from UI state | Duplicate identity lifecycle; easy auto-attach drift; more selectors |
| Persisted pin field | Survives reload/reconnect | Requires schema/storage semantics and stale-ID cleanup; violates scope |

Recommend shared optional field. KISS: no reducer/store migration. YAGNI: no persistence. DRY: one toggle and one close guard in manager.

### Data flow

`pin click → WorkspacePage callback → handleToggleTabPin → openTabs update → tabsWithLiveSession → (Traditional TabBar | buildRuntimeTree → Runtime navigator)`.

`close click → handleCloseTab → pinned? return : existing suppress + PTY kill + tab/mount removal`.

## Related Code Files

### Modify

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalTabBar.tsx` — extend shared `TabEntry`; do not add dead-path UI solely for parity.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-terminal-manager.ts` — toggle action, comparator update, defensive close guard, derived propagation.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.ts` — make preservation intent explicit if current spread is insufficient.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-auto-attach.test.ts` — refresh/pending/discovery pin preservation coverage.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx` — pass one toggle callback to both modes.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TabBar.tsx` — Traditional pin/close controls.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TabBar.test.ts` — Traditional labels, pressed state, toggle routing, close absence/routing.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` — forward toggle callback.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/SplitLayout.tsx` — forward toggle callback through recursive panes.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx` — provide callback to `TabBar`.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-runtime-tree.ts` — copy pin bit into each `RuntimeSessionItem`, including grouped sessions.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-runtime-tree.test.ts` — pin propagation coverage.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` — forward toggle callback in desktop and compact navigator paths.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigator.tsx` — forward callback.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorGroup.tsx` — forward callback.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` — Runtime pin/close controls for standalone and grouped leaves.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx` — Runtime labels, pressed state, toggle routing, close absence/routing.

### Create

- None.

### Delete

- None.

## Implementation Steps

1. Extend `TabEntry` with documented client-only `isPinned?: boolean`; extend `RuntimeSessionItem` with required boolean or optional field normalized with `Boolean(tab?.isPinned)`.
2. Add `handleToggleTabPin` to `TerminalManagerActions` and returned actions. Unknown session IDs return unchanged state.
3. At the first line of `handleCloseTab`, read current manager tabs and return for pinned targets. Keep the entire existing unpinned body/order intact.
4. Include `isPinned` in `sameOpenTabs`; preserve it through `tabsWithLiveSession` and auto-attach refresh. Never write it from `SessionInfo`.
5. Wire `handleToggleTabPin` through `WorkspacePage` and the existing Traditional/Runtime prop chains. Do not introduce context/store for one callback.
6. In `DraggableTab`, render pin before close. Conditionally omit close when pinned. Convert the existing role/span close affordance to a native button while preserving event propagation and keyboard behavior.
7. In `RuntimeSessionLeaf`, render the same semantic controls and omit close when pinned. Ensure service-group children use each leaf’s own state.
8. Add focused tests: unpinned pin + close present; pin click routes session ID; pinned unpin is pressed and close lookup returns null; unpinned close still routes; grouped Runtime leaf behaves identically.
9. Add auto-attach test where a pinned existing tab receives refreshed `SessionInfo` and remains pinned; add runtime-tree test for standalone and grouped propagation.

## Implementation and validation status

- Completed shared `isPinned` state, first-line close guard, auto-attach/runtime propagation, both production control paths, and focused tests.
- Validation evidence is present in the feature changes and focused tests; no fresh commands run during this tracking-only update.

## Todo

- [x] Add shared pin field and manager action.
- [x] Guard close before PTY/UI side effects.
- [x] Preserve pin during auto-attach and live metadata projection.
- [x] Wire both production render paths.
- [x] Add accessible controls and selected/focus styling.
- [x] Add focused unit tests.

## Success Criteria

- Pinning in Traditional immediately removes only that tab’s close control.
- Switching to Runtime shows the same tab pinned; compact Runtime sheet matches desktop.
- Unpinning in either mode updates both and restores close.
- No pointer/keyboard path from a pinned mode control calls close; direct manager close request also cannot kill it.
- Auto-attach refresh does not reset pin; newly discovered tabs remain unpinned.
- Unpinned close still invokes PTY kill once and removes the tab/mounted session.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Pin dropped during server metadata refresh | Close unexpectedly returns | Preserve spread field + comparator/test |
| One mode uses local state | Mode switch disagrees | Manager-only state, shared props |
| Close guard runs after kill/suppression | Pinned PTY terminates or disappears | Guard first; test control absence and review order |
| Prop omitted in compact/grouped Runtime | Inconsistent affordance | Test desktop data propagation + grouped leaf; manual compact check |
| Extra controls crowd narrow tabs | Label clipping | Keep existing truncation; compact icons; no new text |

## Security Considerations

- No auth, authorization, permission, API, or trust-boundary changes.
- Pin is UI safety, not a security boundary or server-side lock.
- No terminal output, command, path, or session metadata is newly logged/stored.
- Do not imply pin prevents process self-exit, admin kill, profile deletion, or transport disconnect.

## Next steps

Proceed to Phase 02 after state and surface unit tests pass. Keep architecture/docs untouched unless implementation reveals a public contract change.

## Unresolved Questions

- Fresh automated validation was not rerun during this tracking-only update.
- Manual compact Runtime and PTY lifecycle checks remain follow-ups.
