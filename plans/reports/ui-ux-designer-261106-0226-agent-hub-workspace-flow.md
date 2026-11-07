# Approved UX & Workspace Flow: Agent Hub Terminal-First Workspace + Floating OS File Panels

- **Status:** **APPROVED DESIGN** — user explicitly selected “Approve this design,” including vertical project tabs and the floating-window reuse policy. Design approval is not implementation or planning consent; zero source code modified; runtime qualification not performed.
- **Date:** 2026-11-06 (`Asia/Saigon`)
- **Designer:** `HubFlowDesigner` (`ui-ux-designer`) incorporating technical audit findings from `FloatingFileAudit`
- **Approved Wireframe Asset:** [SVG](./assets/agent-hub-workspace-flow-proposed.svg), [PNG](./assets/agent-hub-workspace-flow-proposed.png), [JPG](./assets/agent-hub-workspace-flow-proposed.jpg). Original review filenames retained.

---

## 1. Goal & Scope

Redesign the `Agent Hub` workspace navigation and file-opening UX to correct structural flaws in the rejected wireframe (`plans/reports/assets/agent-hub-workspace-wireframe.svg`) while honoring established desktop OS and `TraditionalTerminalProjectsNavigator` conventions:

1. **External Floating File Panels Only:** Clicking any file in a project tree inside Agent Hub MUST open or focus a standalone, format-appropriate **floating OS window (`EditorApp`) OUTSIDE Agent Hub** over the OS desktop canvas. Agent Hub never embeds an editor pane, code viewer, or file tab strip.
2. **Terminal-First Main Stage:** Agent Hub's main stage remains 100% dedicated to `MultiTerminalDisplay` (per-project terminal tabs, drag/split panes, pane-level controls, full vertical height).
3. **Hide/Show Resizable Left Sidebar:** Retains the collapsible (`☰`), horizontally resizable (`220–520px`, default `224px`, keyboard-resizable) left sidebar with distinct, meaningful **Projects** and **Agents** sections.
4. **Settled Workspace Invariant:** Each open project tab represents a complete project workspace (selected worktree, persisted file tree folder expansion, and persisted per-project terminal split layout).
5. **No Scope Creep:** No generic IDE shell inside Hub, no nested window manager, no new backend APIs, and no duplicate `TerminalKeepAliveHost` or `MonacoKeepAliveHost` instances.

---

## 2. Old Behavior & Rejected Wireframe Evidence

### 2.1 Verified Legacy Navigator Behavior (`TraditionalTerminalProjects*`)
- **Resizable Left Rail (`TraditionalTerminalProjectsDisplay.tsx:115-125, 461-495`):** Width defaults to `224px` (`min: 220`, `max: 520`), persisted in `dam-hopper:traditional-projects-navigator-width`, with keyboard separator semantics and a compact `Dialog` bottom sheet on narrow viewports (`:370-451`).
- **Projects Section (`TraditionalTerminalProjectsNavigator.tsx:144-251, 340-384`):**
  - Renders heading `projects` + `+` (`New terminal in selected project`) and a vertical roving `tablist` (`aria-label="Open terminal projects"`).
  - Each `TraditionalProjectRow` wraps a `<button role="tab">` (`:187-239`) inside `<div role="presentation">` (`:178-250`). The tab button renders `TerminalProjectActivityIndicator`, project label, `ProfileBadge`, terminal count (`group.terminalTabs.length`), and optional 3-line Git summary (`TraditionalProjectGitSummary:32-127` with branch, worktree path, and commit message when `terminalCommitStatusEnabled` is active). Critically, `TraditionalTerminalWorktreeSelect` (`:240-249`) is rendered as a **sibling** beneath the `<button role="tab">`, never nested inside the tab button.
  - Selecting a project calls `useTraditionalTerminalProjectSelection.ts:89-100`, switching `MultiTerminalDisplay` (`key={selectedGroup.id}`, layout key `dam-hopper:terminal-layout:v3:${encoded}`) and restoring that project's last-selected session (`TraditionalTerminalProjectsDisplay.tsx:219-240, 336-361`). Renderer continuity is a required invariant, not proven by static inspection.
- **Agents Section (`TraditionalTerminalProjectsNavigator.tsx:385-431`):**
  - Separate `<section>` below `projects` with `Agent Settings` link (`buildAgentSettingsHref`).
  - Persists multi-select status filter (`TraditionalTerminalAgentFilter`) in `dam-hopper:traditional-terminal-agents-status-filter` across all 7 canonical statuses (`Needs attention`, `Working`, `Idle`, `Unknown`, `Unavailable`, `Platform unqualified`, `Unsupported`).
  - Collapses observed agents across open terminals (OMP, Codex, Claude — never plain unobserved shells) via `groupTraditionalTerminalAgentRows` (`traditional-terminal-agent-groups.ts:45-93`) by `(groupId, statusLabel, reasonLabel)`. Clicking a `TraditionalTerminalAgentGroupRow` calls `nextAgentSessionId` (`:99-105`), switching to that project's workspace and focusing the exact split pane/tab (`TraditionalTerminalProjectsDisplay.tsx:310-316`).

### 2.2 Why the Previous Wireframe (`agent-hub-workspace-wireframe.svg`) Was Rejected
1. **Embedded Editor Pane Inside Hub:** Split the right stage horizontally to embed a code editor + file tab bar (`y=85..325`), cutting terminal viewport height in half and duplicating `EditorApp`.
2. **Triplicated Project Selection:** Placed projects in a top horizontal tab bar (`local / dam-hopper ×`), again in `PROJECTS & AGENTS` (`▾ dam-hopper`), and a third time in `FILES · dam-hopper`.
3. **Corrupted Agents Mental Model:** Nested agents (`OMP`, `Codex`) alongside raw `bash` shells inside a single project row, losing the cross-project observed agent roster and persistent multi-select status filter.

---

## 3. Candidate Flows & Recommendation

### Flow A (Recommended): Unified Left Sidebar "Open Project Workspaces" Accordion + Bottom Cross-Project "Agents" Section
- **Structure:**
  - **No top horizontal project tab bar.** The top section of the left sidebar (`PROJECTS`) is the single canonical vertical tablist of **Open Project Workspaces**.
  - **Open Project Workspaces vs. Full Inventory:** `PROJECTS` displays only open project workspaces (projects with $\ge 1$ open terminal $\cup$ projects explicitly opened for file browsing with `0` terminals). A compact `[+ Open ▾]` picker in the `PROJECTS` header queries the full server/profile inventory (`useAggregatedProjects`) so users can open any configured project into the sidebar without spawning a terminal.
  - **Per-Project Workspace Container (Accessible Sibling Composition):**
    Each project workspace item is a `<div role="presentation">` containing three sibling layers (never nesting interactive controls inside `role="tab"`):
    1. *Header Bar:* Sibling tree disclosure button (`<button aria-expanded aria-controls>` `▸`/`▾`) + focusable project selection tab (`<button role="tab" aria-selected>` with `TerminalProjectActivityIndicator` or muted `○` for `0` terminals, `projectName`, `ProfileBadge`, terminal count badge) + sibling quick action buttons `[+]` (new terminal in project) and `[×]` (close project workspace).
    2. *Sibling Compact Worktree & Git Bar:* Rendered on active/expanded projects directly below the header (`⎇ wt: main (root) ▾` via `TraditionalTerminalWorktreeSelect` + compact commit hash chip `a91f20c`), replacing the verbose 3-line block while preserving `useProjectTargetStore` worktree semantics.
    3. *Sibling Expandable File Tree Region:* Toggling `▾` reveals a labelled `<div role="region" aria-label="${projectName} files">` mounting `FileTree` beneath the worktree bar. Folder expansion persists via `explorerTreeScopeKey(target)` (`fsTargetKey(target)` for `FsTargetRef` in `packages/ui/src/stores/explorer-tree.ts:10-19`, stored in `dam-hopper:explorer-tree-state`). Clicking any file dispatches `file:open` with `mode: "float"` and `generation: owner.generation` to open/focus an external floating `EditorApp` OS window.
  - **Bottom Section (`AGENTS` — Cross-Project Observed Agents in Open Terminals):** Retains the exact legacy cross-project `AGENTS` section (`TraditionalTerminalAgentFilter` + `TraditionalTerminalAgentGroupRow` list across open terminal groups) separated by a horizontal divider.
- **Why Recommended:** Zero project-selection duplication; preserves 100% of `TraditionalTerminalProjectsNavigator` vertical scanning, sibling ARIA semantics, and cross-project agent triage; gives `MultiTerminalDisplay` 100% of Agent Hub's vertical height.

### Flow B (Alternative 1): Top Horizontal Project Workspace Tabs + Single Active-Project Sidebar Explorer + Bottom Agents
- **Structure:** Moves open project tabs to a horizontal strip across the top of Agent Hub (`[local/dam-hopper (2) ×] [prod/backend-api (!1) ×] [+ Open ▾]`). The left sidebar top section shows only the *currently selected* project's worktree selector and `FileTree` (`EXPLORER · dam-hopper`), with cross-project `AGENTS` in the bottom section.
- **Tradeoffs vs. Flow A:**
  - *Pros:* Gives the active project's `FileTree` slightly more vertical height in the sidebar because inactive project headers sit in the top bar.
  - *Cons:* Stacks 4 horizontal bars (OS TopBar → Hub Window Frame → Hub Project Tabs → Terminal Pane Tabs); breaks legacy vertical scanning of project activity/worktrees in the left rail; wastes vertical space above terminals even when the left sidebar is hidden.

### Flow C (Alternative 2): Left Sidebar Segmented Mode Switcher (`[Projects & Files]` | `[Agents (!1)]`)
- **Structure:** Replaces the top/bottom vertical split in the left sidebar with a 2-tab segmented control at the top of the sidebar (`Projects (3)` vs `Agents (!1)`), giving the active mode 100% of sidebar height.
- **Tradeoffs vs. Flow A:**
  - *Pros:* Maximum vertical scroll space for deep file trees or large agent lists on short viewports (`640–767px`).
  - *Cons:* Destroys simultaneous ambient visibility of cross-project `Agents` while browsing files or switching projects — hiding `Needs attention` / `Idle (Done)` transitions behind an inactive tab.

---

## 4. Approved Wireframe

Asset path: `plans/reports/assets/agent-hub-workspace-flow-proposed.svg` (`viewBox="0 0 980 620"`, `14px` `JetBrains Mono` / monospace base, `currentColor` attributes with `@supports` CSS variable overrides `--fg`, `--muted`, `--border`, `--surface`, `--accent`, `--success`, `--warning`, `--error`, no background canvas).

![Approved Agent Hub Workspace Flow Wireframe](./assets/agent-hub-workspace-flow-proposed.svg)

### Wireframe Spatial Hierarchy
1. **OS Desktop Shell (`DH//OS`, `x=8..972, y=28..612`):** TopBar (`[1:Hub !1]`, `[2:Review]`, `Fleet: 2/2`, Command Palette) and Left Dock (`HUB`, `>_`, `DIR`, `EDT` with active running indicator dot, `GIT`).
2. **Agent Hub Window (`x=64..860, y=68..602`):**
   - **Hub Titlebar (`y=68..100`):** Sidebar toggle `[☰]`, title `Agent Hub`, active workspace context pill `[local/dam-hopper · main]`, urgency counters (`!1 Attn`, `●2 Work`), `[Recipes]`, and standard OS `WindowFrame` controls (`[Float][_][□][✕]`).
   - **Resizable Left Sidebar (`x=64..344`):**
     - **Top (`PROJECTS (3)`):** Shows `[+ Open ▾]` (inventory picker) and `[+ >_]`. Lists 3 open project workspaces:
       - `dam-hopper [local]` (active, `2` terminals matching the 2 terminal tabs on the right stage, expanded `▾`, sibling `⎇ wt: main (root) ▾ · a91f20c` bar, sibling `FileTree` region with `AgentHubApp.tsx` clicked).
       - `backend-api [prod]` (collapsed `▸`, `!1` attention indicator, `wt:auth`).
       - `docs-portal [local]` (collapsed `▸`, `0` terminals — file-browsing workspace with no PTY spawned).
     - **Bottom (`AGENTS`):** Cross-project observed agents across open terminals + `Agent Settings ↗`, persistent multi-select `Filter: Attn, Working (3) ▾`, and grouped agent rows (`[Codex] ! Approval ×1` in `backend-api`; `[OMP][Claude] ● Working ×2` in `dam-hopper`).
   - **Right Stage (`MultiTerminalDisplay`, `x=344..860`):** Terminal-only workspace with tab bar (`● [OMP] #1 [pin] ×`, `● [Claude] #2 ×`, `[+ New] [◫ Split]`) and full-height split terminal panes (`Pane 1 · #1 (OMP)`, `Pane 2 · [Claude] dam-hopper #2`). Zero embedded editor UI.
3. **External Floating OS File Window (`EditorApp`, `x=520..966, y=166..544`):**
   - Visibly floats **outside** Agent Hub over the OS canvas (overlapping Hub's right border `x=860` out to `x=966`).
   - Own `WindowFrame` titlebar (`AgentHubApp.tsx`, owner badge `[local / dam-hopper]`, `[Float][_][□][✕]`), path/worktree breadcrumb (`packages/ui/src/os/apps/AgentHubApp.tsx · wt:main`), format-appropriate viewer (`MonacoHost` / `MarkdownHost` / `ImagePreview` / `VideoPreview` / `LargeFileViewer`), and exclusive resource claim status.

---

## 5. Key Interaction & Lifecycle Behaviors

| Interaction / Surface | Approved Deterministic Behavior |
| :--- | :--- |
| **Click Project Tab (`role="tab"`)** | Selects project workspace (`activeGroupId`), switches right-hand `MultiTerminalDisplay` to that project's persisted `v3` split layout and remembered session (`useTraditionalTerminalProjectSelection`), and updates Hub's active project context badge. |
| **Click Tree Chevron (`▸`/`▾`)** | Separate sibling `<button aria-expanded>`; toggles `isTreeExpanded` for that project's inline `FileTree` independently without switching `activeGroupId` or stealing `xterm` focus. Folder open/close state inside the tree persists via `useExplorerTreeStore` (`dam-hopper:explorer-tree-state`), while tree node highlight/selection remains transient in component state. |
| **Click Agent Row (`AGENTS`)** | Validates live `(profileId, generation, terminalId, incarnation)` membership (`TraditionalTerminalProjectsDisplay.tsx:310-316`), switches `activeGroupId` to the agent's project workspace, and activates/cycles the exact target session (`nextAgentSessionId`) inside its split pane without altering split layout or file tree expansion. |
| **Click File in Inline Tree** | Opens/focuses an external floating file window using the clicked tree's captured profile, connection generation, project, worktree, and file path. Never takes ownership from the fleet-scoped Hub's root context; never opens a pane inside Agent Hub. |
| **Floating File Window Lifecycle** | Validate the clicked tree's connection owner, resolve the full filesystem target, and reuse the canonical document/window if one exists. Otherwise create a standalone floating editor/viewer above Hub. Existing windows are restored from minimized/maximized state, converted from tile to float when necessary, brought to Hub's current desktop, and focused without recreating document state. |
| **Project Switch w/ File Open** | Floating `EditorApp` windows are independent OS windows in `useWindowStore`. Switching projects or collapsing the sidebar in Agent Hub leaves open floating file windows untouched. Each floating window's header badge (`[profile / project]`) identifies its owner context. |
| **Agents Filter Scope** | Covers all **observed agents across open terminal groups** (`buildTraditionalTerminalAgentRows`) so cross-project attention states (`Approval`, `Question`, `Error`) remain visible regardless of which project is selected. Multi-status selection persists in `dam-hopper:traditional-terminal-agents-status-filter`. |
| **Left Sidebar Hidden (`☰`)** | Collapses left rail while keeping `MultiTerminalDisplay` at the same React tree key (`key="terminal-surface"`) so `xterm` instances refit without remounting. Hub header retains `[☰]`, quick project switcher pill `[local/dam-hopper · main]`, and live urgency counts. |
| **No-Terminal Projects (`0`)** | Opening a project via `[+ Open ▾]` registers an open project workspace entry without spawning a PTY (`terminalTabs: []`, count badge `0`). Its inline `FileTree` and `TraditionalTerminalWorktreeSelect` work immediately; when selected, the right terminal stage displays an empty state with `[+ New Terminal]` and `[Recipes]` CTAs. |
| **Close Project Workspace (`[×]`)** | Only zero-terminal workspaces can be dismissed. Projects with live terminals remain listed and expose no batch-close action. Dismissal preserves tree expansion for reopening and never closes external file windows or terminates sessions. |
| **Keyboard & Focus** | Roving `tabIndex` on project `<button role="tab">` controls (`ArrowUp`/`ArrowDown`/`Home`/`End`); `Tab` reaches sibling disclosure chevron (`▸`/`▾`), `TraditionalTerminalWorktreeSelect`, and the labelled `FileTree` region (`react-arborist` arrow navigation). Activating a file node focuses the floating `EditorApp` OS window; closing `EditorApp` via its window close control (`✕`) returns OS focus to the next top window in `zOrder` (Agent Hub, preserving the originating tree node focus when still mounted). |

---

## 6. Technical Audit Findings & Likely Touchpoints

1. **Mandatory Float & Generation Fencing on `file:open` (`packages/ui/src/os/intents.ts:69-77`, `packages/ui/src/os/OsShell.tsx:458-563`):**
   - *Verified current behavior:* `OsShell.tsx:459-474` only enforces retired-generation rejection when both `intent.payload.profileId` and `intent.payload.generation !== undefined` are passed (`FilesApp.tsx:115-153` currently omits `generation`). Furthermore, `OsShell.tsx:546` sets `const placement = useSettingsStore.getState().defaultWindowPlacement ?? "float"`, and `intents.ts:69-77` lacks a `mode` field.
   - *Proposed touchpoint:* Extend `file:open` payload with an optional explicit placement request; capture the clicked tree's owning connection generation (not Hub's fleet/root owner), pass `mode: "float"`, and honor explicit placement before the global preference.
2. **Existing File Window Deduplication (`packages/ui/src/os/OsShell.tsx:506-542`, `packages/ui/src/os/window-ops.ts:365-406`):**
   - *Verified current behavior:* When `existing` matches by `documentKey` or `editorFileTabKey(targetRef, filePath)`, `OsShell.tsx:533-534` runs `if (existing.minimized) restoreWindow(existing.id); focusWindow(existing.id);`. In `window-ops.ts:365-406`, `focusWindow` neither converts a `"tile"` window to `"float"` nor changes `session.activeDesktopId`.
   - *Approved policy:* Hub file requests must also restore existing windows, promote them to float, and bring them to Hub's active desktop. Preserve canonical document identity, dirty buffers, and undo history throughout.
3. **Union of Session Groups & Open Project Workspaces (`packages/ui/src/lib/traditional-terminal-projects.ts:35-65`):**
   - *Verified current behavior:* `buildTraditionalTerminalProjectGroups` iterates strictly over `terminalTabs`; projects with `0` open terminals never appear in `groups`.
   - *Proposed touchpoint:* Union session-derived groups with explicitly opened project workspace refs (`projectKey(ref)` = `JSON.stringify([profileId, project])` in `ownership.ts:108`) hydrated from `useAggregatedProjects`, allowing `terminalTabs: []` groups.
4. **Scoped Per-Project File Tree & Worktree State (`packages/ui/src/stores/explorer-tree.ts:10-19`, `packages/ui/src/components/organisms/FileTree.tsx`):**
   - *Verified current behavior:* `explorerTreeScopeKey(target)` returns `fsTargetKey(target)` when given a normalized `FsTargetRef` (`"kind" in target`), persisting folder expansion under `dam-hopper:explorer-tree-state`. Worktree target selection is stored per project scope in `useProjectTargetStore` (`projectScopeKey` in `stores/project-target.ts`).
5. **Single Keep-Alive Hosts (`packages/ui/src/os/OsResourceHost.tsx:202-263`, `packages/ui/src/os/MonacoKeepAliveHost.tsx:285-318`):**
   - *Verified current behavior:* `OsResourceHost` hosts the singleton `MonacoKeepAliveHost` (claimed via `useResourceClaim({ resourceKind: "editor", resourceId: documentKey }, window.id)` in `EditorApp.tsx:286-362`) and `TerminalKeepAliveHost`. Agent Hub must reuse the singleton keep-alive hosts without nesting duplicates.

---

## 7. Acceptance Checks (For Future Implementation Phase)

- [ ] **AC1 (External Floating File Panel & Generation Fence):** Clicking a file in any expanded project tree visibly opens/focuses its format-appropriate standalone floating OS window, even when the global placement preference is tile. The file belongs to the clicked tree's profile/project/worktree, not whichever project is active in the terminal stage. A connection-generation change during opening cannot load or save through a different owner. Zero editor panes or file tabs appear inside Agent Hub.
- [ ] **AC2 (Cross-Profile / Cross-Worktree Deduplication & Dirty Guard):** Identical relative `filePath` values across different profiles, projects, or worktrees resolve distinct `editorFileTabKey(targetRef, filePath)` keys and open separate floating `EditorApp` windows, whereas clicking the same `(profileId, projectId, worktreeId, filePath)` focuses the existing `EditorApp` window without duplicate `useResourceClaim` conflicts. Closing a dirty floating editor triggers `ConfirmDialog` (`WindowFrame.tsx:639-653`).
- [ ] **AC3 (Complete Project Workspace Persistence & Sibling ARIA):** Each open project workspace preserves its selected worktree (`useProjectTargetStore`), expanded file tree folders (`explorerTreeScopeKey` in `dam-hopper:explorer-tree-state`), and terminal split/tab layout (`dam-hopper:terminal-layout:v3:*`) across project switches and sidebar hide/show toggles. Project `<button role="tab">` elements contain no nested interactive controls.
- [ ] **AC4 (Zero-Terminal Project Browsing):** Opening a project from `[+ Open ▾]` with `0` terminals allows expanding its file tree, changing worktrees, and opening floating file windows without spawning an implicit PTY.
- [ ] **AC5 (Cross-Project Observed Agents Roster):** The `AGENTS` section displays observed agents (OMP, Codex, Claude) across open terminal groups with persisted multi-select status filtering (`dam-hopper:traditional-terminal-agents-status-filter`); clicking an agent row switches to its project workspace and focuses the exact target terminal pane/tab.
- [ ] **AC6 (Sidebar Resize & Hide/Show):** Left sidebar resizes smoothly between `220px` and `520px` (persisted) and toggles hidden/visible via `[☰]` without remounting `xterm` instances or losing active terminal focus.

---

## 8. Constraints & Risks

- **Sidebar Vertical Space Contention:** Expanding deep project file trees in `PROJECTS` can compete with other project headers and the bottom `AGENTS` section. *Mitigation:* Bound the `PROJECTS` and `AGENTS` scroll containers independently (55%/45% split or draggable horizontal divider) and let users collapse any project's file tree via its sibling `▸`/`▾` chevron without losing folder expansion state in `dam-hopper:explorer-tree-state`.
- **PTY Mount Exclusivity (`OsResourceHost.tsx:202-253`):** If a terminal session is simultaneously referenced by a standalone `TerminalsApp` window and `AgentHubApp`, `TerminalKeepAliveHost` slot ownership must remain exclusive per visible target.

### Approved policies

- Project workspaces are vertical tabs in the Projects section, matching the previous navigator; there is no duplicate horizontal project tab strip.
- Expand/collapse each project's tree independently. Disclosing an inactive project's tree does not switch the terminal workspace. Its file clicks retain that tree's owner.
- Opening a file already presented elsewhere reuses the existing window and document, converts it to float if tiled, restores it if minimized/maximized, and brings it to Hub's current desktop. No duplicate document/window is created.
- Keep standalone Terminals, Files, and Editor apps. Consolidation is outside this redesign unless separately chosen.
- Projects with live terminals remain in the project list. Do not introduce batch termination through project close; only zero-terminal workspaces can be dismissed. Closing a project view never closes its external file windows.
- Final brainstorm artifact: this APPROVED design report and its wireframe; not an implementation plan. User separately selected **Defer planning**; no central router invoked and no new plan created.
- Validation remains static code inspection and rendered-wireframe inspection only. Future acceptance additionally requires a live streaming PTY during project/sidebar/split transitions, hidden/background terminal input isolation, unchanged editor dirty buffer/undo on window reuse, and multi-profile/worktree file-opening checks.

---

## 9. Unresolved Questions

- No unresolved product-design decisions. Recommended policies above were included in the explicit design approval.
- Planning explicitly deferred; no implementation authorized. [Decision-summary journal](../../docs/journals/decision-summary-261106-0226-agent-hub-workspace-flow.md) saved directly. Native `/evc-cmd-journal` invocation and writer terminal-response gate unavailable through this session's tool surface; not claimed complete.
