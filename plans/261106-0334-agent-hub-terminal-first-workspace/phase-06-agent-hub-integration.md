# Phase 06 — Agent Hub integration (single integration owner)

## Context Links
- Design (all of §3–§7, AC1–AC6): `../reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md`
- Evidence A "Agent Hub today", "Legacy navigator", B1–B4, C: `./reports/scout-261106-0334-evidence-and-decisions.md`
- Upstream contracts: `./phase-01-shared-contracts.md`, `./phase-02-float-file-open-and-stacking.md`, `./phase-03-hub-terminal-mount-and-attach-gate.md`, `./phase-04-shared-terminal-launch-lifecycle.md`, `./phase-05-sidebar-project-workspace-rows.md`

## Overview
- Priority: P1 · Status: completed · Effort: 13h
- Replace the card roster with the terminal-first workspace: Hub header + `TraditionalTerminalProjectsDisplay` (sidebar Projects/Agents + `MultiTerminalDisplay` stage) wired to Hub mounts (P01/P03), attach gate (P03), shared launch (P04), workspace rows (P05) and float file open (P02).

## Parallelization Info
- Sequential, single integration owner · Depends on: P02, P03, P04, P05 · Blocks: P07 · Concurrent peers: none.

## Key Insights
- AgentHubApp today: filters `packages/ui/src/os/apps/AgentHubApp.tsx:57-61`; groups from `useAggregatedTerminalSessions` with `sessionId = terminalKey` but `session.id = s.id` raw (`:94-138`); Jump `:184-276`; Review `:279-386`; Recipes `:389`.
- Display agent rows require qualified tab shape `tab.sessionId === terminalKey(ref)` AND `session.id === tab.sessionId` (`packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:162-191`) → Hub tabs must set `session.id = terminalKey(ref)` or AGENTS stays empty (AC5).
- Display: `renderTerminals` default false (`:95`), `MultiTerminalDisplay key={selectedGroup.id}` (`:339-361`), `<main key="terminal-surface">` (`:407,:492`), `if (!selectedGroup) return null` (`:364`), resize handle `:115-125,:472-491`, compact Dialog `:370-451`.
- Selection hook re-derives the active group from `activeSessionId` whenever group membership changes (`packages/ui/src/hooks/use-traditional-terminal-project-selection.ts:55-74`) → an explicitly selected zero-terminal workspace snaps back when any terminal appears; must re-derive only when `activeSessionId` itself changes.
- Persist projection `packages/ui/src/os/persistence.ts:124-131` (urgencyFilter/profileFilter) — becomes dead after roster removal.
- `agent-hub.ts` consumers: `findMatchingTerminalWindow` used by `OsShell.tsx` (keep); `filterAgentHubItems`/`AgentHubFilterScope` only AgentHubApp+test; `validateAgentHubJump` only test; `createTerminalPlacementIntent` only AgentHubApp (verified by grep 2026-11-06) → remove dead ones (B4). `terminal:place-existing` intent stays (SystemMonitorApp uses it).
- Hub window: `appId "agent-hub"`, `ctx.profileId ""`, `mode "tile"`, `maximized: true` (`packages/ui/src/os/desktop-templates.ts:155-163`) — fleet-scoped; never use its ctx for file/terminal owners.
- Only active-desktop windows mount (`OsShell.tsx:1661-1666`): Hub must publish mounts but NOT clear them on unmount (P03 prunes on window close).
- F3 (review): `TabBar.tsx:129-168` renders enabled pin and destructive close buttons; `MultiTerminalDisplay.tsx:194-200` substitutes no-ops when callbacks are absent → Hub must wire real actions. Existing facilities: pin helpers `packages/ui/src/lib/terminal-pin-persistence.ts` (per-profile key `dam-hopper:terminal-pins:v2:<profileId>`, logical terminal ids; only other importer `hooks/use-terminal-manager.ts`, which has no production consumer — grep 2026-11-06); close coordinator `useTerminalClose().requestTerminalClose(request, onCloseView, options)` (`packages/ui/src/os/terminal-close-context.tsx:38-55,230-265`) — targeted requests go to `terminateSessionImmediately`, which calls `onCloseView(windowId)` and reserves dispatch on the exact `TerminalTarget` (`:146-160`). Standalone frame passes `closeWindow` as `onCloseView` (`WindowFrame.tsx:320-330`) — Hub must NOT.
- F4 (review): `AgentHubApp.tsx:27-38,57,157-166` imports the exports R10 removes; UI build is full `tsc` → prune must land atomically with the AgentHubApp cutover.

## Requirements
- R1 Composition: `AgentHubApp` = `AgentHubHeader` + `TraditionalTerminalProjectsDisplay` (+ feedback notice). No roster, search/scope/urgency/profile/harness filters, Jump, Open Beside (B4).
- R2 Workspaces (`use-agent-hub-workspaces.ts`): build live mounted/tabs from aggregated sessions (qualified ids), union with persisted open refs via P01 `unionOpenWorkspaceGroups`; `openWorkspace(ref)` (select if already open), `closeWorkspace(groupId)` only when `canDismissWorkspace`, disclosure toggle, `sidebarHidden` toggle; build runtime index (P01 `buildTerminalRuntimeIndex`) and publish `HubTerminalMount[]` for live canonical sessions to `useHubTerminalMountsStore.publish(window.id, …)` (no clear on unmount).
- R2a Selected workspace restore (V7): the hook records the committed selection (from Display `onSelectedGroupChange`) as `selectedWorkspace = projectKey({profileId, project})` and exposes `restoreSelectionRequest` via pure `resolveRestoredWorkspaceSelection(persistedKey, groups, inventoryLoaded)`: while project inventory is loading → wait (no drop); key matches a union group (live session group or open ref still present in `useAggregatedProjects` inventory) → one `selectGroupRequest` for it (R4); otherwise → drop the key and leave the selection hook's default (active session's project, R5). Restore runs once per Hub mount; later user selections overwrite the key; closing/dismissing that workspace clears it.
- R3 Persistence: agent-hub appState projection = `openWorkspaces: {profileId, project}[]` (≤64, string-validated), `sidebarHidden: boolean`, `disclosedWorkspaces: string[]` (projectKey strings, ≤64), `selectedWorkspace?: string` (one projectKey string, length-validated, logical key only; V7). Never persist generation/serverEpoch/incarnation/targets/terminal ids (C1). Legacy keys dropped.
- R4 Display: optional new props `openWorkspaceRefs`, `projectInventory`, `inventoryLoading`, `sidebarHidden`, `disclosedGroupIds`, `onToggleDisclosure`, `onOpenWorkspace`, `onCloseWorkspace`, `onNewTerminalInGroup`, `onOpenFile`, `onOpenRecipes`, `onSelectedGroupChange?(group: TraditionalTerminalProjectGroup | null)` (fired in an effect after the selection commits; single source of truth for the header pill and launch target), `selectGroupRequest?: { groupId: string; nonce: number }` (Hub asks Display to select a group, e.g. after picker open or launch), `hubAttach?: { hubWindowId; resolveTarget }`. Calls `useHubTerminalAttachGate(hubAttach ? {…, sessionIds: selected group's tab ids} : null)` and passes `attachGate` to `MultiTerminalDisplay` with `renderTerminals={false}`. Sidebar hidden ⇒ Navigator + separator not rendered while `<main key="terminal-surface">` keeps identity; `layoutRevision` bump on toggle for refit. Zero-terminal selected group ⇒ empty state in `<main>` with `[+ New Terminal]` (calls `onNewTerminalInGroup(selected.id)`) and `[Recipes]`; no groups ⇒ sidebar with picker + empty stage (no `return null`). Legacy callers (browser fixture) without new props behave as before except Navigator row visuals (P05).
- R5 Selection hook: re-derive active group from `activeSessionId` only when `activeSessionId` changes or the selected group disappears; explicit zero-terminal selection survives inventory changes.
- R6 Header (`AgentHubHeader.tsx`): `[☰]` (`aria-expanded`, `aria-controls` sidebar), title, context pill `profile/project · worktree` of selected group (or "No project"), counters `!N Attn` / `●N Work` from `computeAgentHubSummary(...).needsAttention/.working`, `[Recipes]` → `recipes:open`.
- R7 Review relocation (`agent-hub-review.ts`): `requestAgentHubReview(item, sourceWindowId)` with the exact fences of `AgentHubApp.tsx:279-386` (connected, generation pre/post, `sessionChangesEnabled`, status incarnation equality, initializing, baseline, serverEpoch) returning a notice or dispatching `session-changes:open`; wired to `onOpenSessionChanges(sessionId)` (B4).
- R8 Launch (`use-hub-terminal-launch.ts`): `[+]`/`[+ New Terminal]` for group → identity from group's `projectRef` + selected worktree (`useProjectTargetStore`) + `cwd: null`, Hub window's desktopId, live owner generation → P04 `reserveAndExecuteTerminalLaunch`; blocked/failed reason shown inline; Hub closed while pending ⇒ settles normally, session appears as background; no state update after unmount. Never opens a Terminals window.
- R8b Stuck launch (V3 manual; F8/F9 outcomes): a `blocked` result with `existingAttemptId` renders `HubStuckLaunchNotice` (reason + "Clear stuck launch"). Clicking calls P04 `resolveStuckLaunch({attemptId, confirmNotCreated:false})` (the resolver takes its own fresh per-profile observation; the Hub passes no inventory/`isSuccess`). Outcome → UI: `found` → select `terminalKey({profileId, id})` (no new PTY); `definitely-absent` → `ConfirmDialog` ("No terminal with id … exists on <profile>. Mark the stuck launch as not created?"); confirm → call again with `confirmNotCreated:true` (resolver re-observes) → only `cleared` shows "Launch again" (user-initiated, no automatic relaunch); cancel → block stays; `in-flight` → "Launch still in progress in this window — wait"; `present-unresolvable` → "Terminal exists but cannot be verified — open it from Terminals or retry later"; `unknown` → "Cannot confirm on <profile> — reconnect and retry"; `unavailable` → "Could not save the resolution" + reason; `conflict` → "Launch was resolved elsewhere" + refresh; `already-resolved` → dismiss notice and allow normal launch. Every non-`found`/`cleared` outcome keeps the notice, never offers "Launch again" as recovery success, and keeps "Clear stuck launch" retryable. No auto-reconcile anywhere.
- R8a Pending selection (F6): on `created` keep `{ owner: {profileId, generation} captured before reserve, terminalId, target? }`. When `target` is canonical: consume only when the inventory runtime index (P01) yields a target EXACTLY equal (`terminalTargetKey`) and the live owner generation still equals the captured one → select `terminalKey({profileId, id: terminalId})`. Cancel the marker on owner generation change/disconnect, on observing the same terminalId with a different target (replacement), or on Hub unmount. When the outcome has NO canonical target: never auto-select (fail closed); show a notice ("Terminal started; select it from the project tabs"). Journal settlement is P04's and completes independently of the marker.
- R9 File open: `onOpenFile(payload)` → `dispatchIntent(createIntent("file:open", payload, window.id))`; payload untouched (P05 builds owner); an `unhandled` result (e.g. P02 R2a retired-connection document) is shown as the Hub feedback notice.
- R10 Read model (atomic with R1 cutover, F4): in the SAME task as the AgentHubApp rewrite remove `filterAgentHubItems`, `AgentHubFilterScope`, `AgentHubFilterOptions`, `validateAgentHubJump`, `LiveTerminalSnapshotMap`, `FencedJumpValidationResult`, `createTerminalPlacementIntent` and their tests; keep `buildAgentHubItems`, `computeAgentHubSummary`, `classifyAgentUrgency`, `getUrgencyRank`, `findMatchingTerminalWindow` and summary/evidence-join tests (C). No compatibility shim; full typecheck only after this coherent cutover.
- R11 Tab actions (`use-hub-terminal-tab-actions.ts`, F3): three distinct operations — (a) terminal tab close (`onCloseTab(sessionId, fallback)` from Display): resolve the CURRENT exact target via the runtime index at click time and require it to equal the target the tab was rendered with (else notice, no dispatch); call `requestTerminalClose({ windowId: hubWindowId, entry: "pane-tab", target, availability: mapTerminalRowAvailability(row.terminationState) }, onCloseView, { prompt: <same policy as standalone pane-tab close> })` where `onCloseView` is Hub-local and idempotent: select `preferredFallbackSessionId` (Display's `firstRemainingTraditionalTerminalId`) or clear selection — it NEVER calls `closeWindow`; (b) workspace dismiss (`onCloseWorkspace`, zero-terminal only, R2) — never terminates sessions; (c) Hub window close — OS window close only; sessions survive as background, mounts pruned by P03. Pin: `onToggleTabPin(sessionId)` toggles the logical terminal id in the per-profile pin set via `setPinnedTerminalId`/`savePinnedTerminalIds(ids, undefined, profileId)`, loaded with `loadPinnedTerminalIds(undefined, profileId)` and pruned with `retainPinnedTerminalIds` against live ids; tabs carry `isPinned`. No runtime authority persisted. `terminal-close-context.tsx` is expected unchanged; if a change is proven necessary, only P06 edits it (no Group A phase writes it).

## Architecture
```
AgentHubApp(window)
 ├─ useAgentHubWorkspaces(window) → groups, openRefs, runtimeIndex, items, summary; publishes Hub mounts
 ├─ useHubTerminalLaunch(window)  → launch(groupId), pending/notice
 ├─ AgentHubHeader(☰, pill, Attn/Work, Recipes)
 └─ TraditionalTerminalProjectsDisplay(hubAttach, workspace props, onOpenSessionChanges=requestAgentHubReview, onOpenFile)
      ├─ TraditionalTerminalProjectsNavigator (P05 rows, picker, Agents)
      └─ <main key="terminal-surface"> MultiTerminalDisplay(renderTerminals=false, attachGate) | empty state
```

## Related Code Files
- Modify: `packages/ui/src/os/apps/AgentHubApp.tsx`, `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`, `packages/ui/src/hooks/use-traditional-terminal-project-selection.ts`, `packages/ui/src/os/persistence.ts` (agent-hub projection only), `packages/ui/src/os/persistence.test.ts`, `packages/ui/src/os/agent-hub.ts`, `packages/ui/src/os/agent-hub.test.ts`, `packages/ui/browser-tests/os-agent-hub.browser.tsx` (rewrite), `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`, `packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx`; conditional (only if proven necessary): `packages/ui/src/os/terminal-close-context.tsx`, `packages/ui/src/os/terminal-close-context.test.tsx`
- Create: `packages/ui/src/os/agent-hub/use-agent-hub-workspaces.ts`, `packages/ui/src/os/agent-hub/use-agent-hub-workspaces.test.ts`, `packages/ui/src/os/agent-hub/agent-hub-review.ts`, `packages/ui/src/os/agent-hub/agent-hub-review.test.ts`, `packages/ui/src/os/agent-hub/AgentHubHeader.tsx`, `packages/ui/src/os/agent-hub/AgentHubHeader.test.tsx`, `packages/ui/src/os/agent-hub/use-hub-terminal-launch.ts`, `packages/ui/src/os/agent-hub/use-hub-terminal-launch.test.ts`, `packages/ui/src/os/agent-hub/HubStuckLaunchNotice.tsx`, `packages/ui/src/os/agent-hub/HubStuckLaunchNotice.test.tsx`, `packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.ts`, `packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.test.ts`, `packages/ui/src/hooks/use-traditional-terminal-project-selection.test.ts`
- Delete: roster/filter/jump code paths inside `AgentHubApp.tsx` and dead exports in `agent-hub.ts` (same task, F4).

## Ownership & Conflict Prevention
- Single owner; runs after Group A. Amendments: `use-traditional-terminal-project-selection.ts` (+ new test), `terminal-traditional-projects.browser-fixture.tsx`, `persistence.test.ts`, conditional `terminal-close-context.tsx(+test)` assigned to P06. `os/persistence.ts` ownership transfers from P04 (`p04-stuck-launch-resolution`, read-only getter) to P06 sequentially; P06 roots wait on that task. Does not edit P02–P05 files or `lib/terminal-pin-persistence.ts` (imported only); interface gaps are escalated, not patched.

## Implementation Steps
1. `p06-review-relocation`: move `handleReview` body verbatim into `agent-hub-review.ts` as a pure async function with injected deps; tests for every fence/notice and success dispatch.
2. `p06-selection-hook`: fix R5; new hook test (zero-terminal selection survives new session in another group; active session change still re-derives; removed group falls back to first).
3. `p06-hub-workspaces-state`: hook (R2, R2a) + persistence projection (R3) + tests: qualified tab ids feed agent rows; union order; dismissal only for zero-terminal; mounts published only for canonical live targets; no clear on unmount; projection caps/validates and drops legacy keys; no runtime authority persisted; `selectedWorkspace` round-trips, rejects non-string/oversized values; restore resolution: key of a live group → request; key of an open zero-terminal ref present in inventory → request; key absent from inventory/union → dropped, default fallback; inventory loading → pending (not dropped); closing the selected workspace clears the key.
4. `p06-hub-terminal-launch`: hook (R8, R8a, R8b) + `HubStuckLaunchNotice` + tests with mocked P04 module: identity from selected worktree; blocked reason surfaced; canonical success selected only after exact-target inventory match; generation change after success but before observation cancels selection; same-ID replacement observed before the created target cancels selection; noncanonical outcome never auto-selects and shows notice; unmount mid-flight no setState and journal still settled; stuck launch: blocked → Clear → `definitely-absent` → confirm → `cleared` → "Launch again" succeeds; `found` → selects existing terminal and no create call; confirm returning `in-flight`/`unknown`/`present-unresolvable` (stale negative at confirmation) → no "Launch again", notice text per outcome; `unavailable` and `conflict` after confirm → no "Launch again", retry stays available; cancel confirm keeps the block; `in-flight`, `present-unresolvable`, `unknown` on first click show their notices without a ConfirmDialog.
5. `p06-hub-tab-actions`: hook (R11) + tests (mock `useTerminalClose`): close dispatches with the exact rendered target and `entry:"pane-tab"`; same-ID replacement between render and click → no dispatch + notice; only the clicked target is terminated (other sessions untouched); `onCloseView` never closes the Hub window and selects the provided fallback; repeated `onCloseView` idempotent; pin toggle persists per profile and renders enabled; pins pruned to live ids.
6. `p06-hub-header`: component (R6) + tests (counts from summary, ☰ aria, pill text, Recipes intent).
7. `p06-display-integration`: Display props/behaviors (R4) + update fixture and `terminal-traditional-projects.browser.tsx` (new row visuals, hide/show keeps xterm instance and focus, resize 220–520 persisted, zero-terminal empty state, agents filter persistence, agent row focuses exact pane/tab).
8. `p06-agent-hub-compose`: thin `AgentHubApp` (R1, R9, R11 wiring) + atomic read-model prune (R10) + rewrite `os-agent-hub.browser.tsx`: no roster/filters/Jump; header counters; open zero-terminal project via picker, expand tree, change worktree, click file → float editor visible over maximized Hub with clicked tree's owner (AC1, AC4); project switch with live PTY keeps the same xterm instance (no TerminalPanel remount) and layout per project (AC3); sidebar hide/show (AC6); agent row → exact pane (AC5); Review tab action dispatches `session-changes:open` with fences (B4); conflicting standalone window → placeholder + Go to window (B1); Hub [+ New Terminal] creates via shared lifecycle without opening a Terminals window (B3); tab pin/close controls enabled, closing one terminal tab terminates only that target and Hub window survives; closing Hub leaves sessions alive.

```evcrate-tasks
[
  {
    "id": "p06-review-relocation",
    "title": "Relocate fenced session-changes review into agent-hub-review module",
    "blocked_by": ["p02-float-browser-qualification", "p03-hub-mounts-browser", "p04-adopt-lifecycle", "p04-stuck-launch-resolution", "p05-workspace-row-navigator"],
    "allowed_files": ["packages/ui/src/os/agent-hub/agent-hub-review.ts", "packages/ui/src/os/agent-hub/agent-hub-review.test.ts"],
    "constraints": ["Preserve every fence and notice of AgentHubApp.tsx:279-386 verbatim (generation pre/post await, incarnation equality, baseline, serverEpoch).", "No React; dependencies injectable for tests; AgentHubApp.tsx untouched in this task."],
    "acceptance": ["Each fence failure yields its original notice and no dispatch; success dispatches session-changes:open with the frozen ReviewTarget tuple (B4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/agent-hub-review.test.ts"]
  },
  {
    "id": "p06-selection-hook",
    "title": "Keep explicit zero-terminal workspace selection stable",
    "blocked_by": ["p02-float-browser-qualification", "p03-hub-mounts-browser", "p04-adopt-lifecycle", "p04-stuck-launch-resolution", "p05-workspace-row-navigator"],
    "allowed_files": ["packages/ui/src/hooks/use-traditional-terminal-project-selection.ts", "packages/ui/src/hooks/use-traditional-terminal-project-selection.test.ts"],
    "constraints": ["Active-session-driven selection and per-group remembered session behavior otherwise unchanged."],
    "acceptance": ["Selecting a zero-terminal workspace survives inventory/membership changes; a changed activeSessionId still selects its group; a removed selected group falls back deterministically (AC4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-traditional-terminal-project-selection.test.ts"]
  },
  {
    "id": "p06-hub-workspaces-state",
    "title": "Hub workspace state, mount publishing and appState projection",
    "blocked_by": ["p02-float-browser-qualification", "p03-hub-mounts-browser", "p04-adopt-lifecycle", "p04-stuck-launch-resolution", "p05-workspace-row-navigator"],
    "allowed_files": ["packages/ui/src/os/agent-hub/use-agent-hub-workspaces.ts", "packages/ui/src/os/agent-hub/use-agent-hub-workspaces.test.ts", "packages/ui/src/os/persistence.ts", "packages/ui/src/os/persistence.test.ts"],
    "constraints": ["persistence.ts: edit only the agent-hub branch of the appState projection; never persist generation/serverEpoch/incarnation/targets/terminal ids (Invariant C1); selectedWorkspace is a logical projectKey only (V7).", "Publish Hub mounts via P01 store; do not clear on component unmount (P03 prunes on window close).", "Restored selection is validated against loaded inventory/open workspaces before use; unresolved keys are dropped and the selection hook default (active session's project) applies (V7)."],
    "acceptance": ["Groups = live session groups (qualified tab/session ids) union persisted open refs; zero-terminal workspaces open without spawning a PTY and only they can be dismissed (AC4).", "Projection keeps openWorkspaces/sidebarHidden/disclosedWorkspaces/selectedWorkspace (validated, capped at 64) and drops legacy filter keys; mounts published only for canonical live targets (AC3, Invariant C1).", "A persisted selectedWorkspace present in the union after inventory loads yields exactly one selection request; one absent from inventory/union is dropped and the active session's project is selected; no decision is made while inventory is loading (V7)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/use-agent-hub-workspaces.test.ts src/os/persistence.test.ts"]
  },
  {
    "id": "p06-hub-terminal-launch",
    "title": "Hub in-stage terminal launch through shared lifecycle",
    "blocked_by": ["p06-hub-workspaces-state"],
    "allowed_files": ["packages/ui/src/os/agent-hub/use-hub-terminal-launch.ts", "packages/ui/src/os/agent-hub/use-hub-terminal-launch.test.ts", "packages/ui/src/os/agent-hub/HubStuckLaunchNotice.tsx", "packages/ui/src/os/agent-hub/HubStuckLaunchNotice.test.tsx"],
    "constraints": ["Use only P04 buildTerminalLaunchIdentity, reserveAndExecuteTerminalLaunch and resolveStuckLaunch; never open a Terminals window.", "Owner from live snapshot of the group's profile, never Hub ctx; no setState after unmount.", "Stuck-launch clearing is manual only: not-created settlement requires the ConfirmDialog confirmation; relaunch is user-initiated (V3).", "The Hub never supplies cached inventory, aggregated isSuccess or other-profile data as absence evidence; Launch again appears only after a cleared result (F8, F9)."],
    "acceptance": ["[+]/[+ New Terminal] reserves with the group's project/selected worktree and Hub desktop, shows blocked/failed reasons, and selects the new session only after the exact created target is observed under the captured owner generation (B3, AC4, F6).", "Generation change or same-ID replacement after success but before observation cancels selection; noncanonical outcomes never auto-select (fail closed, notice) (F6).", "Unmount while pending still settles the journal and the session appears as background (Hub-closed-while-pending, Invariant C).", "A blocked launch offers Clear stuck launch: found selects the existing terminal without a new PTY; definitely-absent requires confirmation and only a cleared result offers Launch again, which then succeeds; cancelling keeps the block (V3).", "in-flight, present-unresolvable and unknown never open the confirmation or clear the block; unavailable and conflict after confirmation show their notice, keep retry, and never offer Launch again as recovery success (F8, F9)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/use-hub-terminal-launch.test.ts src/os/agent-hub/HubStuckLaunchNotice.test.tsx"]
  },
  {
    "id": "p06-hub-tab-actions",
    "title": "Hub terminal tab pin and target-fenced per-terminal close",
    "blocked_by": ["p06-hub-workspaces-state"],
    "allowed_files": ["packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.ts", "packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.test.ts", "packages/ui/src/os/terminal-close-context.tsx", "packages/ui/src/os/terminal-close-context.test.tsx"],
    "constraints": ["Close only through useTerminalClose().requestTerminalClose with the exact current TerminalTarget; onCloseView is Hub-local and never closes the Hub window.", "terminal-close-context.tsx edited only if proven necessary, preserving standalone frame/window-list behavior; pins reuse lib/terminal-pin-persistence.ts per-profile helpers with logical ids only."],
    "acceptance": ["Pin and close controls in Hub tabs are enabled and functional; pins persist per profile and prune to live sessions (F3).", "Closing a tab terminates only its exact target; same-ID replacement between render and click dispatches nothing; the Hub window survives and selection falls back via firstRemainingTraditionalTerminalId; workspace dismiss and Hub close never terminate sessions (F3)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/use-hub-terminal-tab-actions.test.ts src/os/terminal-close-context.test.tsx"]
  },
  {
    "id": "p06-hub-header",
    "title": "Agent Hub header with sidebar toggle, context pill, counters and Recipes",
    "blocked_by": ["p02-float-browser-qualification", "p03-hub-mounts-browser", "p04-adopt-lifecycle", "p04-stuck-launch-resolution", "p05-workspace-row-navigator"],
    "allowed_files": ["packages/ui/src/os/agent-hub/AgentHubHeader.tsx", "packages/ui/src/os/agent-hub/AgentHubHeader.test.tsx"],
    "constraints": ["Presentational; counts passed from computeAgentHubSummary; no query hooks."],
    "acceptance": ["[☰] exposes aria-expanded/aria-controls, pill shows profile/project · worktree of the selected workspace, Attn/Work counters match summary.needsAttention/working, Recipes dispatches recipes:open (AC6, B4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/AgentHubHeader.test.tsx"]
  },
  {
    "id": "p06-display-integration",
    "title": "Display hide/show, empty states, workspace props and attach gate wiring",
    "blocked_by": ["p06-selection-hook"],
    "allowed_files": ["packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx", "packages/ui/browser-tests/terminal-traditional-projects.browser.tsx", "packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx"],
    "constraints": ["<main key=\"terminal-surface\"> keeps identity across sidebar hide/show and compact switches; renderTerminals stays false (no nested TerminalKeepAliveHost).", "Resize 220-520px default 224 with storage key dam-hopper:traditional-projects-navigator-width unchanged."],
    "acceptance": ["Sidebar hide/show and resize keep the same xterm instances and active terminal focus; widths persist (AC6).", "Zero-terminal selection shows [+ New Terminal]/[Recipes] empty state; per-project v3 layouts and agent filter persistence survive project switches; agent row focuses the exact pane/tab (AC3, AC4, AC5).", "onSelectedGroupChange reports the committed selection and selectGroupRequest selects a group, so header pill and launch target always match the displayed workspace."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-traditional-projects.browser.tsx", "pnpm --filter @dam-hopper/ui build"]
  },
  {
    "id": "p06-agent-hub-compose",
    "title": "Thin AgentHubApp composition and rewritten Agent Hub browser suite",
    "blocked_by": ["p06-review-relocation", "p06-hub-terminal-launch", "p06-hub-tab-actions", "p06-hub-header", "p06-display-integration"],
    "allowed_files": ["packages/ui/src/os/apps/AgentHubApp.tsx", "packages/ui/src/os/agent-hub.ts", "packages/ui/src/os/agent-hub.test.ts", "packages/ui/browser-tests/os-agent-hub.browser.tsx"],
    "constraints": ["No roster, filters, Jump or Open Beside (B4); Hub ctx never used as file/terminal owner.", "Read-model prune (R10) lands in this same task as the AgentHubApp rewrite (F4); keep buildAgentHubItems, computeAgentHubSummary, classifyAgentUrgency, getUrgencyRank, findMatchingTerminalWindow; no compatibility shim.", "File open forwards P05 payload unchanged to dispatchIntent and surfaces unhandled reasons; Review wired to onOpenSessionChanges; tab pin/close wired to p06-hub-tab-actions.", "Selected-workspace persistence wired only through use-agent-hub-workspaces (onSelectedGroupChange in, restoreSelectionRequest out as selectGroupRequest) (V7)."],
    "acceptance": ["From a maximized Hub, opening a zero-terminal project, expanding its tree, changing worktree and clicking a file shows a float editor above Hub owned by that tree's profile/project/worktree with zero editor UI inside Hub (AC1, AC4).", "Live PTY survives project switch/sidebar hide without TerminalPanel remount; agent row focuses exact pane; conflicting standalone shows Go to window; Hub [+ New Terminal] uses shared lifecycle; closing one terminal tab ends only that target and the Hub survives; closing Hub keeps sessions alive (AC3, AC5, AC6, B1, B3, F3).", "Dead read-model exports and their tests are removed with summary/evidence-join tests still passing, and the full UI typecheck passes after the cutover (B4, F4).", "After reload the Hub reselects the persisted workspace (including a zero-terminal open workspace); if that project is no longer in inventory it falls back to the active session's project (V7)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub.test.ts", "pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-agent-hub.browser.tsx", "pnpm --filter @dam-hopper/ui test", "pnpm --filter @dam-hopper/ui build"]
  }
]
```

- [x] <!-- evcrate-task:p06-review-relocation --> Relocate fenced session-changes review into agent-hub-review module
- [x] <!-- evcrate-task:p06-selection-hook --> Keep explicit zero-terminal workspace selection stable
- [x] <!-- evcrate-task:p06-hub-workspaces-state --> Hub workspace state, mount publishing and appState projection
- [x] <!-- evcrate-task:p06-hub-terminal-launch --> Hub in-stage terminal launch through shared lifecycle
- [x] <!-- evcrate-task:p06-hub-tab-actions --> Hub terminal tab pin and target-fenced per-terminal close
- [x] <!-- evcrate-task:p06-hub-header --> Agent Hub header with sidebar toggle, context pill, counters and Recipes
- [x] <!-- evcrate-task:p06-display-integration --> Display hide/show, empty states, workspace props and attach gate wiring
- [x] <!-- evcrate-task:p06-agent-hub-compose --> Thin AgentHubApp composition and rewritten Agent Hub browser suite

## Success Criteria
- AC1–AC6 exercised in `os-agent-hub.browser.tsx` + `terminal-traditional-projects.browser.tsx`; B1–B4 visible in Hub; full UI unit suite green.
- **H1 Remediation Verified (Per-Profile Terminal Inventory Authority):** `use-hub-terminal-tab-actions.ts` tracks individual profile inventory readiness via `loadedProfileIds` Set and connection status `getConnectionSnapshot(profileId).status !== "connected"`. Stored pins are retained without premature deletion when one profile is ready but another is pending, disconnected, or errored. Unit test `use-hub-terminal-tab-actions.test.ts` asserts pin retention under delayed/error states across profiles.
- **Critical Remediation Verified (Safe Fail-Closed Termination):** Eliminated ambient fallback `api.terminal.remove/kill` when a terminal lacks an exact target or coordinator. Unresolvable sessions fail closed with user action notice `"Cannot close terminal: Session target is unavailable or disconnected."`.
- **W1 Remediation Verified (Workspace Selection Restore Gate):** Selection persistence in `use-agent-hub-workspaces.ts` gates saving until initial workspace restoration completes, preventing default null overwrites during cold startup.
## Risk Assessment
- Hub publishes one renderer per live canonical session (P03 risk) — observe in P07.
- Agent rows silently empty if tab ids not qualified → explicit test in `p06-hub-workspaces-state`.
- Rewriting a 624-line browser suite may drop coverage of read-model evidence joins → those stay in `agent-hub.test.ts`.

## Security Considerations
- Owner for files/terminals always from the clicked tree/group profile + live generation; Hub fleet ctx never used. Review keeps generation/incarnation fences. Persisted appState excludes runtime authority.

## Rollback
- Revert P06 commit restores roster Hub and read-model exports together (single task holds both, F4). P01–P05 remain inert/compatible, but P02 global stacking and float file-open stay active — full rollback follows the integrated order in `plan.md`. Persisted new appState keys are ignored by the old projection; sessions and pin sets survive.

## Next Steps
- P07 qualification, E2E evidence and docs.

## Unresolved questions
- None (V7 decided: selected workspace persisted as a logical projectKey and validated on restore).
