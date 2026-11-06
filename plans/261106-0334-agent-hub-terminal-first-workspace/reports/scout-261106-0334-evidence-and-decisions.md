# Evidence & Decisions — Agent Hub terminal-first workspace

Source design (authority): `plans/reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md` (APPROVED) + `plans/reports/assets/agent-hub-workspace-flow-proposed.svg`.
Journal: `docs/journals/decision-summary-261106-0226-agent-hub-workspace-flow.md`.
Full interface scout: `agent://FileOpenNavigatorScout` (summarized below). Read-only; 2026-11-06.

## A. Verified current state (file:line)

### Agent Hub today
- `packages/ui/src/os/apps/AgentHubApp.tsx` (753 ln) = card roster. State: scope/urgency/profile/harness/search filters (`:57-61`), builds groups from `useAggregatedTerminalSessions` (`:94-138`, sessionId = `terminalKey({profileId,id})`), `buildAgentHubItems`/`computeAgentHubSummary`/`filterAgentHubItems` (`:141-166`, from `os/agent-hub.ts` 769 ln). `handleJump` (`:184-276`) → `terminal:place-existing`. `handleReview` (`:279-386`) → generation/incarnation-fenced `SessionChangesClient.getStatus` → `session-changes:open` ReviewTarget. `recipes:open` (`:389`). NO embedded terminals.
- Manifest `os/app-registry.ts:139` single-instance, minimumCtx none. Template `os/desktop-templates.ts:157-162` creates Hub window `mode:"tile"` (docs: maximized Desktop 1 "Hub"). Persist projection `os/persistence.ts:124-131` (urgencyFilter, profileFilter only).
- Tests: `packages/ui/browser-tests/os-agent-hub.browser.tsx` (624 ln, roster-specific), `packages/ui/src/os/agent-hub.test.ts`.

### Legacy navigator (reuse target; unused in production)
- `components/organisms/TraditionalTerminalProjectsDisplay.tsx` (504 ln): `useResizeHandle({min:220,max:520,defaultWidth:224,keyboardResizeEnabled,storageKey:"dam-hopper:traditional-projects-navigator-width"})` `:115-125`; compact Dialog `:370-451`; agent rows + committed selection guard `:192-316`; `MultiTerminalDisplay key={selectedGroup.id}` `:339-360`, `renderTerminals` default **false** `:95`; `<main key="terminal-surface">` `:407, :492`; `if (!selectedGroup) return null` `:364` (no zero-group empty state).
- `TraditionalTerminalProjectsNavigator.tsx` (434 ln) props `:254-266` (`groups, activeGroupId, onSelectGroup, onNewTerminal?, width?, className?, touchOptimized?, agentRows?, activeSessionId?, onSelectAgent?, agentSettingsHref?`); agent filter key `dam-hopper:traditional-terminal-agents-status-filter` `:283-303`. Row: `<div role="presentation">` + `<button role="tab">` + sibling `TraditionalTerminalWorktreeSelect` `:178-250`.
- Only consumer of Display: `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`.
- `lib/traditional-terminal-projects.ts` (93 ln): `TraditionalTerminalProjectGroup` `:8-19`; `buildTraditionalTerminalProjectGroups(mounted, tabs)` `:21-24` only from tabs (no 0-terminal groups).
- `hooks/use-traditional-terminal-project-selection.ts:11-116`.

### Terminal renderer mounting (CRUX)
- Singleton `TerminalKeepAliveHost` is rendered by `os/OsResourceHost.tsx:254-263`. Its sessions are derived ONLY from `appId==="terminals"` windows (`:202-238`, `mountKey: \`${w.id}:${profileId}:${sessionId}\``), merged with optional `mountedSessions` prop (`:240-253`, dedupe key = `terminalTargetKey(target)` or `profile::sessionId::mountKey`). `OsShell.tsx:1601` passes NO `mountedSessions`. ⇒ Hub sessions would have no renderers.
- `TerminalKeepAliveHost.tsx:55-102`: React key = `session.mountKey ?? terminalKey({profileId,id})`; passes `terminalRef`, `terminalTarget`, `attachPolicy` to `TerminalPanel`.
- `MultiTerminalDisplay.tsx:170` renders its own `TerminalKeepAliveHost` when `renderTerminals` true (must stay false in Hub — no duplicate host).
- `PaneContainer.tsx:97-137` reparents via `attachTerminalsToHost({host, sessionIds, activeSessionId})` and `getTerminal(sessionId)` string lookup + registry subscription. No claims. Could steal DOM from a standalone window.
- `lib/terminal-registry.ts:95-103` `getTerminal(target|ref|string)`: `toTerminalKey(target)` then raw string. Targeted sessions register under `terminalTargetKey` = `JSON.stringify([profileId,generation,serverEpoch,terminalId,incarnation])` (`api/terminal-session-contract.ts:123-131`); `terminalKey` = `JSON.stringify([profileId,id])` (`api/ownership.ts:315`). Logical tab id ≠ runtime key → must resolve explicitly (`attachTerminalsToHost` already accepts `resolveTerminal`, see `TerminalsApp.tsx:343-348`).
- `SessionInfo` has `incarnationExact?`, `serverEpoch?` (`api/client.ts:209-211`).
- Claims: `os/resource-registry.ts` `formatClaimKey` (kind/profile/…/`inc:`/`ep:`/`auth:`), `useResourceClaim(key, windowId)` → `{success, existingHolderWindowId}`. TerminalsApp key `:56-77` (target branch: profileId, generation, resourceId=terminalId, incarnation, authority=serverEpoch). Denied UI `:379-397` calls only `focusWindow(holder)` (does not switch desktop/restore).
- Closing a standalone Terminals window kills the process group (commits 90137fd8, f216798b) — window owns session lifetime.

### Terminal launch lifecycle (window-coupled)
- Reservation: `os/persistence.ts:1088` `reserveTerminalLaunch(LaunchIdentityParams :919-929, {generation, desktopId, explicitRequestedTerminalId})`; settle `:1218` (`confirmed-success|confirmed-not-created|uncertain`). Callers: `os/action-executor.ts:226-316` (`app.terminals.new-window`: identity params + window with attemptId), `TerminalsApp.tsx:303` (retry).
- Create: `TerminalsApp.tsx:91-259` `handleLaunchSession` (generation pre/post checks, `client.terminal.create`, canonical `serverEpoch`/`incarnationExact` → `TerminalTarget`, settle, window appState update). Retry `:281-328`.

### file:open & window placement
- Payload `os/intents.ts:69-77` `{profileId, projectId?, worktreeId?, target?, filePath, line?, generation?}` (no mode).
- Dispatchers: `os/deep-links.ts:240-246, 524-531`, `os/apps/FilesApp.tsx:116-124, 136-151` (no generation), `os/apps/SearchApp.tsx:75-88`.
- Handler `os/OsShell.tsx:458-563`: fence only if generation given `:459-474`; dedupe `:501-531` (`editorFileTabKey(targetRef, filePath)` vs editor store tabs, or ctx match); reuse `:532-542` only `restoreWindow` if minimized + `focusWindow`; create `:544-561` `mode = defaultWindowPlacement ?? "float"`, `openWindow(..., session.activeDesktopId)`.
- `os/window-ops.ts`: `focusWindow :365-406` (no desktop switch/float), `switchDesktop :408-415`, `moveWindowToDesktop :417-483`, `setWindowMode :485-538` (float: clears maximized, bounds, removes from tree), `toggleMaximizeWindow :620-631`, `restoreWindow :665-732` (minimized→restorePlacement; maximized→unmaximize). Tests `os/window-ops.test.ts`.
- **DesktopCanvas z-order** `os/DesktopCanvas.tsx:244-288`: float layer `zIndex 20`, maximized layer `zIndex 40` (focused maximized slot 50). ⇒ float editor opened from a maximized Hub is hidden. Not covered by design report.
- No direct test of OsShell `file:open` handler (only via `deep-links.test.ts:84`, `FilesApp.test.tsx:287`).

### File tree & worktree
- `FileTree.tsx:374-385` props: `target?: FsTargetRef|ProjectTargetRef`, `onFileOpen?(node: FsArborNode)` (NOT onOpenFile), `mode`, `path`, `revealRequest`. Scope `explorerTreeScopeKey` `:457-460`. Only consumer `os/apps/FilesApp.tsx:319`.
- `stores/explorer-tree.ts:10-19, 31-131` (`dam-hopper:explorer-tree-state`). `stores/project-target.ts` `useProjectTargetStore :407-543`, `projectScopeKey :299-309`; `hooks/use-project-target.ts:11-27` → `normalizeFsTarget` (`api/ownership.ts:142-206`).
- `hooks/use-aggregated-projects.ts:42-46` → `{groups, allProjects: AggregatedProjectItem{profileId, profileName, serverUrl, project, ref}, isLoading}`.
- Generation: `getConnectionSnapshot(profileId)?.owner.generation` (`api/connections.ts:339`), `useConnectionSnapshot` `:818`.

### STALE design citations
- `os/ownership.ts` → actual `api/ownership.ts` (`projectKey :108`).
- `MonacoKeepAliveHost` starts `:271`, not `:285`.

## B. User decisions (2026-11-06 ask, all recommended options)
1. **Terminal conflict:** first claim wins; loser pane shows placeholder with "Go to window" (switch desktop + restore + focus holder). Never closes a window or kills a session.
2. **Float vs maximized:** global OS stacking fix — when the desktop's focused window is a float window, the float layer stacks above the maximized plane; focusing a maximized window restores it on top.
3. **Hub new terminal:** launched in Hub stage through a lifecycle extracted from TerminalsApp (reservation/settlement/generation fences/canonical target/uncertain outcome) shared by TerminalsApp and Hub.
4. **Roster:** remove card roster, search/scope/harness/profile filters, Jump/Open Beside. Relocate Review to terminal tab action (`MultiTerminalDisplay.onOpenSessionChanges`) preserving `handleReview` fences. Header keeps Attn/Work counters + Recipes. Agents status filter + agent rows replace roster triage.

## C. Advisor-flagged invariants (accepted)
- Separate logical tab identity (`terminalKey`) from exact runtime target (`terminalTargetKey`); explicit resolver; never persist runtime authority (generation/serverEpoch/incarnation) in Hub appState.
- Renderer continuity: mount key must be stable across presentation-owner changes (Hub↔standalone); project switch / sidebar hide / Hub close must not kill sessions or needlessly remount `TerminalPanel`.
- Attach gate covers all attach paths (initial, registry callback, hidden tabs, unmount); same exact claim identity as TerminalsApp; release only own claim.
- Hub launch reuses full lifecycle; define Hub-closed-while-pending behavior.
- Z-order change is global: test multiple maximized windows, focus return, pointer/input arbitration.
- Keep agent-hub read-model tests that still cover summary/evidence joins.
- File reuse integration: minimized/maximized/tiled on another desktop; dirty buffer + undo unchanged; legacy `file:open` callers (no mode) unchanged.

## D. Related plans
- `plans/261103-1608-workspace-file-tree-project-marks` (pending): Phase 03/04 change canonical editor identity, intents, Monaco parking, FileTree dual modes → writable overlap risk on `os/intents.ts`, `os/OsShell.tsx`, editor identity. Serialize; not concurrent.
- `plans/261103-2016-user-concerns-resolution` (in_progress): Files editor; informational, check before touching EditorApp/FilesApp (this plan does not write them).
- `plans/261101-1738-ai-dev-os-redesign` (in-progress, Phase 10 docs pending): informational; Phase 09 carried H1 (live PTY attach/replay) relevant to qualification.
