# Scout Report: Terminal Title Ordinals

## Scope

Read-only repository inspection. No files changed and no validation commands run.

## Findings

- `packages/ui/src/hooks/use-terminal-manager.ts:267-377` owns `openTabs` and `mountedSessions`. `tabLabel()` currently emits `Terminal ${freeIndex}` for free sessions, `${project}:${profile}` for profile sessions, `${project}:${commandBase}` for ad-hoc terminal sessions, and `${project}:${type}` for other sessions. `openTerminalTab()` stores that label in `TabEntry` and keys actions by `sessionId`.
- `packages/ui/src/lib/terminal-auto-attach.ts:58-95` duplicates the same base-label derivation for hydrated/live sessions. `deriveTerminalAutoAttachState()` rebuilds tab entries on snapshots.
- `packages/ui/src/components/organisms/TabBar.tsx:83-97` renders the actual split-pane terminal tab label from `tab.label`.
- `packages/ui/src/components/organisms/TerminalTabBar.tsx:89-114` is a legacy/general tab strip that also renders `tab.label` and remains the `TabEntry` type owner.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx:153-158` independently computes the active header as `${activeSession.project}: ${activeSession.command}` rather than consuming `TabEntry.label`.
- `packages/ui/src/lib/terminal-runtime-tree.ts:184-230` propagates `TabEntry.label` into runtime navigator items; `TerminalRuntimeNavigatorItem.tsx:202-230` renders it. The navigator button title is currently cwd or raw `sessionId`.
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:56-80` already calculates `terminalOrder` as the current 1-based position in `openTabs` and passes it to `TerminalPanel` for notification context. `docs/frontend-components.md` and `docs/system-architecture.md` define this ordinal as display-only and explicitly use the `Project · Bash #N` convention.
- `packages/ui/src/components/pages/WorkspacePage.tsx:515-535` builds browser terminal targets from `openTabs`/`mountedSessions` and uses `tab.label` as the target label. It is a related presentation consumer but not the terminal tab strip.
- `packages/ui/src/api/client.ts:43-70` has `SessionInfo.id` and optional `incarnation`; backend create/list and WebSocket payloads already carry IDs. No title field is needed.
- Backend IDs are reusable across respawn/recreate; `incarnation` identifies a concrete PTY. Raw IDs are not appropriate user-facing titles.

## Existing Tests

- `packages/ui/src/lib/terminal-auto-attach.test.ts` asserts base labels for free, profile, ad-hoc, and custom sessions plus hydration/pinning behavior.
- `packages/ui/src/components/organisms/TabBar.test.ts` covers `DraggableTab` actions but not label text.
- `packages/ui/src/components/organisms/TerminalTabBar.test.tsx` covers save controls but not title text.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx` covers compact/desktop rendering and diagnostics, with no exact active-title assertion.
- `packages/ui/src/lib/terminal-runtime-tree.test.ts` covers runtime tree grouping/order but accepts arbitrary labels.
- Browser coverage exists for terminal panel interactions, pinning, notifications, and related runtime surfaces; no test currently asserts numbered terminal titles.

## Recommendation

Keep backend and PTY contracts unchanged. Reuse the existing current 1-based `openTabs` ordinal as presentation context. Prefer a single formatter or lookup applied consistently to split-pane tabs, runtime navigator, active header, legacy tab strip, and any related label consumer. Keep `sessionId` for all identity/actions and avoid exposing raw server IDs.
