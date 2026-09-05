# Debugger Report: Workspace Commit Bar & Traditional Mode Sidebar Worktree/Git Commit

**Target**: Root cause analysis for missing latest commit in Workspace bar and missing worktree/git commit in Traditional terminal mode left sidebar.
**Constraint**: Investigation and analysis only. No automated fixes implemented.
**Date**: 2026-09-05 12:47

---

## 1. Executive Summary

Two distinct but overlapping defects cause the observed behavior:
1. **Workspace Page Latest Commit in Bar Missing**:
   - Gated behind `terminalCommitStatusEnabled` in `useSettingsStore` (`packages/ui/src/stores/settings.ts:208`), defaulting to `false`. When off, no bar displays commit info.
   - In Traditional terminal mode (`packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:175`), `terminalCommitStatusEnabled={false}` is hardcoded on `<MultiTerminalDisplay>`. This prop override forces `false` in `PaneContainer.tsx:86` via `terminalCommitStatusOverride ?? configuredTerminalCommitStatusEnabled` (`false ?? true` evaluates to `false`). The tab bar chip (`TabBar.tsx:264`) is permanently disabled in Traditional mode even if enabled in Settings.
   - In Runtime mode, `ActiveTerminalRuntimeDisplay.tsx:320` omits `activeProject` and `terminalCommitStatusEnabled` when rendering `<RuntimeActiveSessionTitle>`, disabling its inner chip.
   - Free terminals or sessions without assigned `project` yield `null` project, skipping queries.

2. **Traditional Terminal Mode Left Sidebar Missing Worktree and Git Commit**:
   - In `TraditionalTerminalProjectsNavigator.tsx:204`, `<TraditionalProjectGitSummary>` is gated by `showCommitStatus` (`terminalCommitStatusEnabled`), which defaults to `false`. Sidebar renders nothing if user hasn't toggled setting on.
   - In `TraditionalProjectGitSummary` (`TraditionalTerminalProjectsNavigator.tsx:33-50`), worktree and git commit are coupled into a single strict all-or-nothing guard:
     ```ts
     if (
       isLoading || isError || isWorktreesLoading || isWorktreesError ||
       !status || !worktree?.path || worktree.isAvailable !== true || worktree.isPrunable ||
       status.pathExists === false || status.statusError || !status.branch ||
       !lastCommit?.hash || !lastCommit.message ||
       Number.isNaN(new Date(lastCommit.date).getTime())
     ) return null;
     ```
   - If worktree query errors, or project has no worktrees matching root branch, or matching worktree has `isPrunable: true` (e.g. deleted worktree directory, stale gitdir) or `isAvailable: false`, the entire summary—including valid git branch and git commit message—is completely dropped.
   - Worktree resolution logic `worktrees?.find(candidate => candidate.branch === status?.branch)` fails on detached HEAD (`"(detached)"` in worktree porcelain vs `"HEAD"` in `get_status`).
   - Terminal sessions are grouped only by `projectName` (`traditional-terminal-projects.ts:30`), ignoring `mountedSession.worktreePath`. Sidebar queries project root status rather than session worktree.

---

## 2. Issue 1 Deep Dive: Latest Commit Missing in Workspace Bar

### Call Hierarchy & Data Flow
```
WorkspacePage.tsx
  ├─ terminalUsageMode === "runtime"
  │    └─ ActiveTerminalRuntimeDisplay.tsx
  │         ├─ RuntimeActiveSessionTitle (line 320) -> misses activeProject & terminalCommitStatusEnabled props!
  │         └─ TerminalCommitStatusChip (line 327) -> gated on terminalCommitStatusEnabled && activeSession?.project
  │
  └─ terminalUsageMode === "traditional"
       └─ TraditionalTerminalProjectsDisplay.tsx
            └─ MultiTerminalDisplay (line 175) -> passes terminalCommitStatusEnabled={false} [HARDCODED BUG]
                 └─ SplitLayout.tsx
                      └─ PaneContainer.tsx (line 86)
                           └─ terminalCommitStatusOverride ?? configuredTerminalCommitStatusEnabled -> evaluates to false!
                                └─ TabBar.tsx (line 264) -> Chip NEVER renders!
```

### Root Causes
1. **Disabled Default Setting**:
   - `packages/ui/src/stores/settings.ts:208`: `terminalCommitStatusEnabled: false`.
   - `packages/ui/src/lib/ui-config.ts:33`: `terminalCommitStatusEnabled: false`.
   - Toggle in Settings -> Appearance: "Show latest commit in terminal". Until user turns this on, commit status chip is suppressed across all terminal bars.

2. **Hardcoded False in Traditional Mode**:
   - File: `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:175`.
   ```tsx
   <MultiTerminalDisplay
     key={selectedGroup.id}
     activeSessionId={activeSessionForGroup}
     mountedSessions={selectedGroup.mountedSessions}
     openTabs={selectedGroup.terminalTabs}
     layoutStorageKey={traditionalTerminalLayoutStorageKey(selectedGroup.id)}
     terminalCommitStatusEnabled={false}
   ```
   - File: `packages/ui/src/components/organisms/PaneContainer.tsx:59, 79-86`.
   ```tsx
   const configuredTerminalCommitStatusEnabled = useSettingsStore(
     (state) => state.terminalCommitStatusEnabled,
   );
   const terminalCommitStatusEnabled =
     terminalCommitStatusOverride ?? configuredTerminalCommitStatusEnabled;
   ```
   - Because `terminalCommitStatusOverride` is `false`, JS nullish coalescing `false ?? true` results in `false`.
   - Even when user enables the setting, Traditional mode terminal tab bar never displays the chip.

3. **Missing Prop Forwarding in Runtime Mode**:
   - File: `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx:320-330`.
   - `<RuntimeActiveSessionTitle>` defines `activeProject` and `terminalCommitStatusEnabled` props (defaulting to `false`).
   - Caller at line 320 renders `<RuntimeActiveSessionTitle>` without passing either prop.
   - Sibling chip rendered at line 327 only shows if `activeSession?.project` exists and `terminalCommitStatusEnabled` is true.

4. **Terminal Sessions Without Project**:
   - If user starts a free terminal (`onNewFreeTerminal`), `session.project` is empty/undefined.
   - `TerminalCommitStatusChip.tsx:30`: `shouldQuery = enabled && Boolean(project)`. Falsy project disables query and returns `null`.

5. **Strict Date / Message Checks in `TerminalCommitStatusChip.tsx`**:
   - File: `packages/ui/src/components/organisms/TerminalCommitStatusChip.tsx:37-52`.
   - Returns `null` if `!status.branch`, `!status.lastCommit?.hash`, `!status.lastCommit.message`, or `formatCommitDate` returns `null`.
   - If repository has no commits yet or commit summary is empty, chip is hidden.

---

## 3. Issue 2 Deep Dive: Traditional Mode Left Sidebar Missing Worktree & Git Commit

### Component Structure
```
TraditionalTerminalProjectsDisplay.tsx
  └─ TraditionalTerminalProjectsNavigator.tsx
       ├─ showCommitStatus = useSettingsStore(state => state.terminalCommitStatusEnabled)
       └─ groups.map(group =>
            group.projectName && showCommitStatus ? (
              <TraditionalProjectGitSummary projectName={group.projectName} />
            ) : null
          )
```

### Root Causes
1. **Sidebar Metadata Gated on Appearance Setting**:
   - File: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx:105-107, 204-208`.
   ```tsx
   const showCommitStatus = useSettingsStore(
     (state) => state.terminalCommitStatusEnabled,
   );
   ...
   {group.projectName && showCommitStatus ? (
     <TraditionalProjectGitSummary
       projectName={group.projectName}
     />
   ) : null}
   ```
   - User expectation: Project sidebar shows worktree and git commit as standard project metadata.
   - Reality: Gated behind `terminalCommitStatusEnabled` (default: `false`). If disabled, sidebar is completely blank below project label.

2. **All-or-Nothing Coupling in `TraditionalProjectGitSummary`**:
   - File: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx:33-50`.
   ```tsx
   const { data: status, isLoading, isError } = useProjectStatus(projectName, true);
   const { data: worktrees, isLoading: isWorktreesLoading, isError: isWorktreesError } = useWorktrees(projectName);
   const lastCommit = status?.lastCommit;
   const worktree =
     worktrees?.find((candidate) => candidate.branch === status?.branch) ??
     worktrees?.find((candidate) => candidate.commitHash === lastCommit?.hash) ??
     worktrees?.find((candidate) => candidate.isMain);

   if (
     isLoading || isError || isWorktreesLoading || isWorktreesError ||
     !status || !worktree?.path || worktree.isAvailable !== true || worktree.isPrunable ||
     status.pathExists === false || status.statusError || !status.branch ||
     !lastCommit?.hash || !lastCommit.message ||
     Number.isNaN(new Date(lastCommit.date).getTime())
   ) {
     return null;
   }
   ```
   - **Critical flaw**: Worktree existence/availability and Git commit existence are tightly coupled.
   - If `useWorktrees` fails or returns empty (`[]`), `!worktree?.path` triggers and drops git commit display.
   - If worktree is prunable (`worktree.isPrunable`, e.g. deleted worktree folder or stale git metadata), drops git commit display.
   - If worktree is unavailable (`worktree.isAvailable !== true`), drops git commit display.
   - If git commit date fails to parse, drops worktree path display.
   - Confirmed by unit test `TraditionalTerminalProjectsNavigator.test.tsx:151-167`: "hides metadata for unavailable worktrees" asserts that unavailable worktree hides branch and commit too.

3. **Flawed Worktree Candidate Resolution**:
   - `worktrees?.find(candidate => candidate.branch === status?.branch)`:
     - On detached HEAD, server `GitStatus.branch` is `"HEAD"` (`server/src/git/repository.rs:327`), but `Worktree.branch` is `"(detached)"` (`server/src/git/cli_fallback.rs:350`). First candidate match fails.
     - Fallback `worktrees?.find(candidate => candidate.commitHash === lastCommit?.hash)`:
       If matched worktree is prunable, `??` does NOT continue to `isMain`. It picks the prunable worktree, then line 41 (`worktree.isPrunable`) discards the whole component.

4. **Terminal Session Worktree Disconnect**:
   - `buildTraditionalTerminalProjectGroups` (`packages/ui/src/lib/traditional-terminal-projects.ts:30`): Groups terminals solely by `projectName`.
   - `TraditionalTerminalProjectsNavigator` passes only `projectName` to `TraditionalProjectGitSummary`.
   - `TraditionalProjectGitSummary` calls `useProjectStatus(projectName, true)` without `worktreePath`.
   - Sessions operating inside linked worktrees do not display their own worktree status; they query the root project.

---

## 4. Remediation Recommendations (Do Not Implement Automatically)

1. **Fix Tab Bar Hardcoded Suppression in Traditional Mode**:
   - In `TraditionalTerminalProjectsDisplay.tsx:175`, remove `terminalCommitStatusEnabled={false}` or pass `terminalCommitStatusEnabled={undefined}` so `PaneContainer.tsx` falls back to `configuredTerminalCommitStatusEnabled`.
   - Alternatively, pass the store setting through explicitly if setting is desired in Traditional tab bar.

2. **Decouple Worktree and Git Commit Display in Sidebar**:
   - In `TraditionalProjectGitSummary` (`TraditionalTerminalProjectsNavigator.tsx`), decouple the rendering:
     - Render branch & commit if `status` and `lastCommit` are valid.
     - Render worktree path if `worktree` is valid and available.
     - Do not hide commit info just because worktree is unavailable/prunable/missing, and vice versa.

3. **Graceful Worktree Fallback Selection**:
   - Filter out prunable or unavailable worktrees during candidate search:
     ```ts
     const availableWorktrees = worktrees?.filter(w => w.isAvailable && !w.isPrunable) ?? [];
     const worktree =
       availableWorktrees.find(w => w.branch === status?.branch) ??
       availableWorktrees.find(w => w.commitHash === lastCommit?.hash) ??
       availableWorktrees.find(w => w.isMain);
     ```

4. **Review Default Setting for Commit Status**:
   - If product requirements intend latest commit / worktree info to be visible out of the box, consider enabling `terminalCommitStatusEnabled: true` by default in `settings.ts` / `ui-config.ts`, or separating sidebar project metadata from the terminal tab bar chip setting.

5. **Pass Missing Props to `RuntimeActiveSessionTitle`**:
   - In `ActiveTerminalRuntimeDisplay.tsx:320`, supply `activeProject={activeSession?.project}` and `terminalCommitStatusEnabled={terminalCommitStatusEnabled}` to avoid dead component props.

---

## 5. Unresolved Questions

1. Should the left sidebar in Traditional terminal mode be controlled by the same toggle ("Show latest commit in terminal") as the terminal pane tab bar chip, or should the sidebar always show project Git/worktree info regardless of that setting?
2. When multiple terminal sessions exist under one project across different worktrees, should the sidebar display the worktree of the active terminal session, or list worktree groups individually, or stick to the main repository worktree?
3. Should `terminalCommitStatusEnabled` remain `false` by default, or be toggled to `true` by default so new users see commit information out of the box?
