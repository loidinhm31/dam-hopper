# Phase 02 — Merge and Reconcile Terminal Contracts

## Context links

- [Parent plan](./plan.md)
- [Boundary phase](./phase-01-preserve-worktree-and-forecast.md)
- [Frontend components](../../docs/frontend-components.md)
- [Terminal architecture](../../docs/system-architecture.md#browser-local-terminal-output-activity)

## Overview

- Date: 2026-08-30
- Priority: P1
- Implementation status: Pending
- Review status: Pending
- Description: Merge all local develop commits, then combine title metadata/rendering with activity and Traditional-project behavior symbol by symbol.

## Key insights

- `applyTerminalTitleOrdinals` counts input-order tabs independently by exact non-empty `project`; projectless/free tabs share one sentinel group. It returns fresh `{baseLabel, ordinal, fullText}` values.
- `TerminalActivityIndicator` resolves `stopped > unavailable > receiving > quiet`; `TerminalProjectActivityIndicator` is a separate “any receiving” aggregate.
- `TerminalPanel` owns output registration plus replay/reconnect/restart gates. Synthetic banners and historical replay never count as receiving.
- `TerminalKeepAliveHost` computes notification `terminalOrder` from global `openTabs` index + 1. This is not the visible per-project ordinal.

## Requirements

### Functional

- Named Bash tabs render `project:bash #1`, `project:bash #2`; another project starts at `#1`.
- Free tabs remain `Terminal N` / `Terminal (starting…)`, with no incidental project metadata.
- Reorder, close, hydration, and project changes recompute display ordinals without mutating stored labels/order.
- Per-terminal activity remains next to titles; Traditional project groups keep aggregate activity.
- Preserve project filtering, selected-project launch, per-project layout, compact sheet, drag/split, pin/save/local-stop, browser handoff, replay, reconnect, and restart behavior.
- Preserve full develop ancestry, including unrelated mobile/browser-debug and Windows PTY commits.

### Non-functional

- `sessionId` remains the key for routing, keys, PTY attach, notification navigation, diagnostics, and artifacts.
- No server/API/persistence change for titles or activity. No output content stored/logged.
- One ordinal projection; no label parsing or duplicate status dots.

## Architecture

```text
openTabs: TabEntry[] + SessionInfo/project/local-stop metadata
  -> buildTerminalDisplayTabs -> applyTerminalTitleOrdinals -> DisplayTabEntry[]
       ├─ TerminalTitleText: truncatable base + shrink-0 suffix + one sr-only fullText
       └─ TerminalActivityIndicator: sessionId + alive + browser-local stream activity

DisplayTabEntry[] + mounted sessions
  -> Traditional project grouping by explicit metadata
  -> TerminalProjectActivityIndicator(any tab receiving)

global openTabs index + 1 -> TerminalKeepAliveHost -> TerminalPanel -> notification context
```

## Related code files

### Add from develop

- `packages/ui/src/components/atoms/TerminalTitleText.tsx`
- `packages/ui/src/lib/terminal-title.ts`
- `packages/ui/src/lib/terminal-title.test.ts`
- `packages/ui/browser-tests/terminal-title-ordinals.browser.tsx`

### Reconcile/modify

- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`
- `packages/ui/src/components/organisms/BrowserDebugTerminalTargetList.tsx`
- `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/SplitLayout.tsx`
- `packages/ui/src/components/organisms/TabBar.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx`
- `packages/ui/src/components/organisms/TerminalTabBar.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/hooks/use-terminal-manager.ts`
- `packages/ui/src/lib/browser-terminal-handoff.ts`
- `packages/ui/src/lib/terminal-auto-attach.ts`
- `packages/ui/src/lib/terminal-runtime-tree.ts`
- Matching tests listed in Phase 3.

### Preserve without replacement

- `packages/ui/src/components/atoms/TerminalActivityIndicator.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx`
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`
- `packages/ui/src/lib/terminal-output-activity.ts`
- `packages/ui/src/lib/terminal-stream-replay-gate.ts`
- `packages/ui/src/lib/traditional-terminal-projects.ts`
- `packages/ui/src/hooks/use-traditional-terminal-project-selection.ts`

## Implementation steps

1. Inside the sibling worktree, run `git merge --no-ff develop`. Do not fetch, rebase, cherry-pick develop, use `-s ours`, or accept an entire conflicted file from one side.
2. Resolve data contracts first:
   - Keep raw `TabEntry` state with `project?: string`; define `DisplayTabEntry = WithOpenTerminalTitle<TabEntry>`.
   - Keep `openTabs` unsuffixed. In `buildTerminalDisplayTabs`, overlay current authoritative session/project/free/local-stop/pin state, then call `applyTerminalTitleOrdinals` once.
   - Ensure equality/hydration observes `project`; clear project for free tabs.
3. Reconcile `terminal-auto-attach.ts`: retain develop `freeTerminalBaseLabel` and `sessionProject`; retain feature ignored/pending/pinned/stopped semantics. Hydration may refresh metadata but not identity, pin, or local-stop suppression.
4. Migrate the complete prop chain from `WorkspacePage` through Active/Traditional displays, Multi/Split/Pane, tab bars, runtime tree, and browser handoff. Use `DisplayTabEntry[]` only where structured titles are guaranteed; keep `TabEntry[]` for manager mutation/state.
5. Reconcile rendering:
   - `TabBar` and `TerminalTabBar`: `TerminalActivityIndicator` first sibling, then `TerminalTitleText`; no liveness-only duplicate dot.
   - `TerminalRuntimeNavigatorItem`: same activity/title order; readable label fallback when `openTitle` absent.
   - `ActiveTerminalRuntimeDisplay`, `SplitLayout`, and `BrowserDebugTerminalTargetList`: structured title when open; unsuffixed mounted-only fallback.
   - Preserve `min-w-0`/`flex-1` on title containers and `shrink-0` ordinal suffix.
6. Preserve Traditional mode: `TraditionalTerminalProjectsNavigator` keeps project label/count and `TerminalProjectActivityIndicator`; do not render a terminal ordinal as a project-group label. Group by explicit project/session metadata, never title text.
7. Preserve activity lifecycle in `TerminalPanel`: registration ownership, replay gating, disconnect/exit cleanup, `reopenLiveStreamAfterRestart`, `probeRestartReadiness`, and fresh post-restart activation. Keep hidden mounted terminals participating.
8. Preserve global notification numbering unchanged: `TerminalKeepAliveHost` uses current global open-tab index; `BrowserNotificationService` adds context only for integer order >= 1. Never feed it `title.ordinal`.
9. Combine tests/assertions from both sides. Stage resolved paths individually. Use `git diff --check` and `git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- .` before completing the merge commit.

## Todo list

- [ ] Real local-develop merge started
- [ ] All conflicts resolved symbol by symbol
- [ ] Display title metadata projected once
- [ ] Title/activity coexist on every terminal row
- [ ] Traditional project aggregate preserved
- [ ] Replay/restart lifecycle preserved
- [ ] Global notification order remains distinct
- [ ] No conflict markers or dropped develop files

## Success criteria

- Both merge parents retained.
- Visible per-project ordinals and global Bash notification order have separate sources and tests.
- Traditional panels, activity transitions, restart recovery, and stable session identity remain intact.

## Risk assessment

- **Whole-file resolution:** silently loses a branch. Mitigation: resolve per symbol/test contract.
- **Stored derived titles:** stale after reorder/close. Mitigation: ephemeral projection.
- **Ordinal reused for notifications:** changes existing global meaning. Mitigation: preserve `terminalOrder` chain.
- **Activity simplified to alive:** loses replay/stream semantics. Mitigation: retain shared output-status APIs and `TerminalPanel` gates.

## Security considerations

- Titles are display-only; never expose opaque IDs as fallback labels.
- Activity remains browser-memory-only and content-free.
- Do not weaken unrelated browser-debug permissions or Windows shell validation while resolving UI conflicts.

## Next steps

Run Phase 3 gates from the sibling worktree before review or adoption.
