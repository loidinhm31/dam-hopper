# Diagnostic Report: Multi-Profile Page-to-Endpoint Routing Failures

**Date:** 2026-09-28  
**Scope:** Frontend page endpoint resolution across multi-profile environments in `dam-hopper`  
**Target File:** `plans/reports/debugger-260928-0252-multi-profile-page-endpoint-routing.md`  

---

## 1. Executive Summary

### Issue Description
When multiple server profiles configured, page navigation exhibits inconsistent endpoint routing. `GitPage` fails to switch between projects across multiple profiles, falling back to ambient local backend. `PluginHostPage` and `usePluginNavigation` tie plugin availability (specifically EVCrate Advisor) to `workspaceStore.selectedProject` instead of Settings Target Server (`settingsProfileId ?? getActiveProfileId()`).

### Business & Operational Impact
- **Git Operations Failure / Data Hazard:** Git operations (fetch, pull, push, log, status, roots, branch, commit, undo, drop) execute against ambient default transport rather than remote profile server owning repository. Risk of mutating local repository or querying wrong server silently.
- **Plugin Inaccessibility:** EVCrate Advisor disappears from navigation or renders "no-project" / "not-visible" if no workspace project selected or if selected project resides on different profile than where plugin installed in Settings.
- **Cross-Profile Project Collisions:** Identical project names across distinct profiles collide in selection states.

### Root Cause Summary
1. **GitPage:** Calls `useProjects()` with no owner options (resolves to `undefined` owner -> ambient `api.projects.list()`). Tracks selection in `Set<string>` project names, discarding `profileId`. Passes string to `useProjectTarget`, producing `ProjectTargetRef` without `profileId`. All queries (`useGitLog`, `useGitRoots`, `useProjectStatus`, etc.) evaluate `resolveTargetOwner(undefined) -> undefined` and invoke ambient `api` client. Bulk operations route unqualified targets to ambient transport without per-profile partitioning.
2. **PluginHostPage & `usePluginNavigation`:** Hardcoded dependency on `useWorkspaceStore.getState().selectedProject`. `usePluginNavigation` bails out (`items: []`) if `selectedProject` null. Queries `api.plugins.list(target)` and `api.plugins.readUiAsset` on `selectedProject.profileId`. EVCrate Advisor installed on Settings Target Server (`settingsProfileId`) is never discovered unless workspace project coincidentally belongs to that exact profile.

### Recommended Fix Priorities
- **P0 (Critical):** Fix `GitPage` to use `useAggregatedProjects()`, key selection by `projectKey(ref)`, retain `profileId` in `useProjectTarget(ref)`, and pass qualified refs to Git operations and `openDiff`.
- **P0 (Critical):** Update `usePluginNavigation` and `PluginHostPage` to resolve EVCrate Advisor and server plugins via Settings Target Server (`useWorkbenchSelectionsStore.settingsProfileId ?? getActiveProfileId()`).
- **P1 (High):** Partition bulk Git operations in `BulkGitOperations` by `profileId` rather than routing batch to single server.
- **P2 (Medium):** Migrate `DashboardPage` from `useTerminalSessions()` to `useAggregatedTerminalSessions()`.

---

## 2. Technical Analysis & Page Routing Matrix

### Overview of Endpoint Routing Models
| Category | Definition | Target Source |
| :--- | :--- | :--- |
| **Project-Bound Routing** | Operations belong to profile owning the specific project | `ProjectRef.profileId` (`selectedProject.profileId`) |
| **Settings Target Server** | Operations configure or run server-level extensions | `useWorkbenchSelectionsStore.settingsProfileId ?? getActiveProfileId()` |
| **Preferences Source** | UI preferences & client configuration persistence | `useWorkbenchSelectionsStore.preferencesProfileId` |
| **Aggregated Cross-Profile** | Merged query across all connected profiles | `useAggregatedProjects()`, `useAggregatedTerminalSessions()` |
| **Dedicated On-Page Switcher**| Page manages own profile selector state | `selectedProfileId` in page state |
| **Desktop Host IPC** | Local desktop native daemon operations | `useSshForwardHost()` (desktop IPC) |

---

### Page-by-Page Diagnostic Breakdown

#### 1. GitPage (`packages/ui/src/components/pages/GitPage.tsx`)
- **Intended Routing:** Project-bound multi-profile routing. Project list must aggregate projects from all connected profiles. User can select any project; Git queries & mutations must route to selected project's owning profile.
- **Actual Implementation:** Ambient client only (`api`).
  - Calls `useProjects()` without arguments (line 323). `resolveWorkflowOwner(undefined)` returns `undefined`, invoking `api.projects.list()`. Remote profiles ignored.
  - `selected` state is `Set<string>` (line 324). Stores raw project names, losing `profileId`.
  - `selectedProjectName` is string (`string | null`). Passed to `useProjectTarget(selectedProjectName)` (lines 336-337).
  - In `createProjectTargetSnapshot` (`project-target.ts:90-103`), string argument yields `target` with `profileId: undefined`.
  - `useGitLog(targetRef)` calls `normalizeProjectTarget(targetRef)` -> `normalized.profileId` is `undefined` -> `resolveTargetOwner(undefined)` is `undefined` -> `getBoundApiClient(undefined)` returns ambient `api`.
  - `BulkGitOperations` maps targets to plain project names; `useGitFetch`/`useGitPull` inspects only `targets[0].profileId`. With no `profileId`, routes to ambient transport.
  - `openDiff(selectedProjectName, ...)` passes bare string to `useEditorStore`, stripping profile context.
- **Verdict:** **BROKEN (Ambient lock-in, profile context lost).**

#### 2. PluginHostPage (`packages/ui/src/components/PluginHostPage.tsx`) & `usePluginNavigation` (`packages/ui/src/plugins/use-plugin-navigation.ts`)
- **Intended Routing:** EVCrate Advisor (`evcrate.advisor`) is an administrative and diagnostic plugin installed and managed on the **Settings Target Server** (`settingsProfileId ?? getActiveProfileId()`). Navigation enumeration and plugin hosting must query that target server.
- **Actual Implementation:** Hard-coupled to `workspaceStore.selectedProject`.
  - `TopNavRouteMenu.tsx:23-24` passes `useWorkspaceStore(s => s.selectedProject)` into `usePluginNavigation(project)`.
  - `usePluginNavigation` (`use-plugin-navigation.ts:109-136`):
    - `profileId = project?.profileId ?? ""`
    - If `!project || !project.profileId`, exits immediately with `items: []`.
    - Queries `getApi(connection.owner).plugins.list(target)` on `project.profileId`.
  - `PluginHostPage.tsx:53-55, 79-94`:
    - `project = useWorkspaceStore(s => s.selectedProject)`
    - `connection = useConnectionSnapshot(project?.profileId ?? "")`
    - If `!project || !project.profileId || !projectTarget`, renders `model: { kind: "unavailable", reason: "no-project" }`.
    - Queries `api.plugins.list(target)` and `api.plugins.readUiAsset(...)` on `connection.owner`.
  - If user selects project on Profile B, queries Profile B. Since EVCrate Advisor was installed on Profile A (Settings Target Server), Profile B returns 0 plugins or 404.
  - If user has no active project selected, EVCrate Advisor completely hidden from menu and inaccessible at `/plugins/evcrate.advisor`.
- **Verdict:** **BROKEN (Wrong profile binding; assumes plugin is tied to active project).**

#### 3. WorkspacePage (`packages/ui/src/components/pages/WorkspacePage.tsx`)
- **Intended Routing:** Project-centric multi-profile routing. Active profile follows selected project.
- **Actual Implementation:**
  - Line 396: `const { allProjects } = useAggregatedProjects();`
  - Line 398: `const activeProfileId = selectedProject?.profileId ?? activeProfile?.id ?? null;`
  - Scopes project queries (`useProjects({ profileId: activeProfileId ?? undefined })`), terminals, file tree, workflow context surface (`WorkflowContextSurface key={activeProfileId}`), and browser debug to `activeProfileId`.
  - Uses `projectKey(selectedProject)` for unambiguous tuple identity across profiles.
- **Verdict:** **CORRECT.**

#### 4. DashboardPage (`packages/ui/src/components/pages/DashboardPage.tsx`)
- **Intended Routing:** Unified cross-profile aggregate dashboard.
- **Actual Implementation:** Mixed.
  - Projects: Line 143 uses `useAggregatedProjects()`. Calculates total, clean, and dirty repos across all connected profiles correctly.
  - Terminals: Line 144 calls `useTerminalSessions()` without arguments. Queries only ambient `api.terminal.list()`. Remote terminals omitted from count and Active Terminals card. Should use `useAggregatedTerminalSessions()`.
  - Killing terminal sessions: `handleKillSession(sessionId, profileId)` accepts `profileId`, but ambient sessions lack `profileId` property.
  - Activity feed: `useIpcEvent("*")` formats entries with profile tags `[profileName]`.
- **Verdict:** **PARTIALLY BROKEN (Terminal sessions not aggregated across profiles).**

#### 5. SettingsPage (`packages/ui/src/components/pages/SettingsPage.tsx`)
- **Intended Routing:** Dual-target routing.
  - Server configuration & administrative operations target **Settings Target Server** (`settingsProfileId`).
  - Preferences persistence targets **Preferences Source** (`preferencesProfileId`).
- **Actual Implementation:**
  - Reads `settingsProfileId` from `useWorkbenchSelectionsStore()`.
  - Passes `targetOwner` (`getConnectionSnapshot(settingsProfileId)?.owner`) to `useConfig`, `useUpdateConfig`, `useClearCache`, `useResetWorkspace`, `useExportSettings`, `useImportSettings`.
  - Line 411: `<PluginManagementSection profileId={settingsProfileId} />` installs, reviews, and manages plugins explicitly against `settingsProfileId`.
- **Verdict:** **CORRECT.**

#### 6. AgentStorePage (`packages/ui/src/components/pages/AgentStorePage.tsx`)
- **Intended Routing:** Dedicated on-page target server switcher.
- **Actual Implementation:**
  - Maintains `selectedProfileId` in local state, initialized from `getActiveProfileId() || getProfiles()[0]?.id || ""`.
  - Provides Profile Switcher dropdown in tab header.
  - Derives `effectiveProfileId` and `owner: ConnectionRef = snap?.owner ?? { profileId, generation: 0 }`.
  - Explicitly passes `{ owner }` to `useAgentStoreItems`, `useAgentStoreMatrix`, `useProjects`, and agent mutations.
- **Verdict:** **CORRECT.**

#### 7. UsagePage (`packages/ui/src/components/pages/UsagePage.tsx`)
- **Intended Routing:** Target server routing with URL parameter override, defaulting to Settings Target Server.
- **Actual Implementation:**
  - Lines 98-102:
    ```ts
    const selectedProfileId =
      profileIdParam ||
      useWorkbenchSelectionsStore.getState().settingsProfileId ||
      profiles[0]?.id ||
      null;
    ```
  - Derives `usageOwner` from `getConnectionSnapshot(selectedProfileId)`.
  - Explicitly passes `usageOwner` to `useUsageSummary`, `useUsageSettings`, `useUsageSessions`, `useUsageSession`, `useUpdateUsageSettings`, `useDeleteUsageData`.
- **Verdict:** **CORRECT (Though should use reactive Zustand selector `useWorkbenchSelectionsStore(s => s.settingsProfileId)`).**

#### 8. SshForwardingPage (`packages/ui/src/components/pages/SshForwardingPage.tsx`)
- **Intended Routing:** Desktop native IPC routing (`environment.kind === "nativeDesktop"`).
- **Actual Implementation:**
  - Binds to local desktop IPC via `useSshForwardHost()` and `useSshForward()`.
  - Can import server profile connection details as presets (`connectionFormSource: ServerProfile`), but port-forwarding engine executes locally.
- **Verdict:** **CORRECT.**

---

## 3. Deep Dive: Root Cause of GitPage Multi-Profile Routing Failure

### Execution Trace & Evidence

```
GitPage Render
   │
   ├──> useProjects() [Line 323]
   │       └──> resolveWorkflowOwner(undefined) -> undefined
   │       └──> api.projects.list() [Ambient Client ONLY]
   │
   ├──> setSelected(Set<string>) [Line 324]
   │       └──> Stores ["dam-hopper"], strips profileId
   │       └──> Collides if "dam-hopper" exists on Profile A & Profile B
   │
   ├──> selectedProjectName: "dam-hopper" [Line 336]
   │       │
   │       └──> useProjectTarget("dam-hopper") [Line 337]
   │               └──> createProjectTargetSnapshot("dam-hopper", ...)
   │                       └──> target: { project: "dam-hopper" } (NO profileId!)
   │
   ├──> targetRef: { project: "dam-hopper" } [Line 338]
   │       │
   │       ├──> useGitLog(targetRef) [Line 340]
   │       │       └──> normalizeProjectTarget(targetRef) -> profileId: undefined
   │       │       └──> resolveTargetOwner(undefined) -> undefined
   │       │       └──> getBoundApiClient(undefined) -> returns ambient `api`
   │       │       └──> Executes: api.git.log() [WRONG ENDPOINT!]
   │       │
   │       ├──> useProjectStatus(targetRef) [Line 347] -> ambient `api`
   │       ├──> useGitRoots(targetRef) [Line 119] -> ambient `api`
   │       └──> useGitHistoryActions(targetRef) [Line 346] -> ambient `api`
   │
   ├──> BulkGitOperations [Line 136-138]
   │       └──> operationTargets: ["dam-hopper", "backend"] (unqualified strings)
   │       └──> useGitFetch() -> checks targets[0].profileId -> undefined
   │       └──> Executes: api.git.fetch(operationTargets) [Ambient Client ONLY]
   │
   └──> handleFileDoubleClick [Line 364]
           └──> openDiff(selectedProjectName, file.path, ...)
           └──> passes bare string "dam-hopper" to editor store tab (no profile scope)
```

### Key Breakpoints in Code
1. **Missing Multi-Profile Aggregation (`GitPage.tsx:11, 323`):**
   ```ts
   // Current:
   const { data: projects = [] } = useProjects();
   // Should be:
   const { groups, allProjects, isLoading } = useAggregatedProjects();
   ```
2. **Loss of Profile Identity in Selection (`GitPage.tsx:324, 334-336`):**
   ```ts
   // Current:
   const [selected, setSelected] = useState<Set<string>>(new Set());
   // Should be tuple key:
   const [selected, setSelected] = useState<Set<string>>(new Set()); // stores projectKey(item.ref)
   ```
3. **Target Resolution Strips Profile (`GitPage.tsx:336-338`):**
   ```ts
   // Current:
   const selectedProjectName = selected.size === 1 ? [...selected][0] : null;
   const selectedTarget = useProjectTarget(selectedProjectName);
   // Should resolve from selected ProjectRef:
   const selectedRef = selected.size === 1 ? parseProjectKey([...selected][0]) : null;
   const selectedTarget = useProjectTarget(selectedRef);
   ```
4. **Bulk Operations Lacks Per-Profile Batching (`queries.ts:1352-1361`):**
   `useGitFetch` and `useGitPull` only inspect `normalizeProjectTarget(targets[0]).profileId`. If targets belong to multiple profiles, single mutation cannot dispatch across multiple servers.

---

## 4. Deep Dive: Root Cause of PluginHostPage / `usePluginNavigation` Routing Failure

### Execution Trace & Evidence

```
TopNavRouteMenu Render
   │
   ├──> useWorkspaceStore.selectedProject -> e.g. { profileId: "remote-2", project: "my-app" }
   │    (or NULL if user is on Settings, Dashboard, Git, or no project selected)
   │
   └──> usePluginNavigation(selectedProject)
           │
           ├──> If project == null:
           │       └──> profileId = ""
           │       └──> early exit -> items: [] (EVCrate Advisor completely hidden!)
           │
           └──> If project belongs to "remote-2":
                   └──> connection = getConnectionSnapshot("remote-2")
                   └──> api = getApi(connection.owner) [Points to remote-2]
                   └──> api.plugins.list(target) on remote-2
                   └──> remote-2 does NOT have evcrate.advisor installed!
                   └──> returns { plugins: [] } -> EVCrate Advisor NOT shown!

PluginHostPage Render (/plugins/evcrate.advisor)
   │
   ├──> project = useWorkspaceStore.selectedProject
   │
   ├──> If project == null:
   │       └──> setModel({ kind: "unavailable", reason: "no-project" })
   │       └──> Shows "No project selected" screen!
   │
   └──> If project belongs to "remote-2":
           └──> api = getApi("remote-2")
           └──> api.plugins.list(target) on remote-2
           └──> metadata not found -> setModel({ kind: "unavailable", reason: "not-visible" })
           └──> Cannot read UI asset from remote-1!
```

### Architectural Contradiction
- In `SettingsPage.tsx:411`:
  `<PluginManagementSection profileId={settingsProfileId} />`
  Plugins are managed on the **Settings Target Server** (`settingsProfileId`).
- EVCrate Advisor is an administrative audit tool installed on the Settings Target Server.
- Yet `usePluginNavigation` and `PluginHostPage` mandate that the user have an active workspace project on the same profile where the plugin is installed.
- Result: Selecting any project on a different profile (or deselecting workspace projects) instantly breaks access to EVCrate Advisor.

---

## 5. Actionable Recommendations

### Immediate Remediation (GitPage)
1. **Adopt `useAggregatedProjects`:**
   Replace `useProjects()` with `useAggregatedProjects()`. Render project selector chips grouped by profile badge (`ProfileBadge` or profile header).
2. **Tuple-Keyed Selection:**
   Store selection as `Set<string>` containing `projectKey(item.ref)`.
   Provide `selectedRef: ProjectRef | null` when `selected.size === 1`.
3. **Preserve Profile in Target:**
   Pass `selectedRef` (object with `profileId` and `project`) to `useProjectTarget(selectedRef)`. This ensures `selectedTarget.target` contains `profileId`.
4. **Route Diff Double-Click with Profile:**
   Call `openDiff(selectedRef, file.path, ...)` so `useEditorStore` tab retains `profileId`.
5. **Batch Bulk Operations by Profile:**
   In `BulkGitOperations`, partition `selectedList` by `profileId`. Execute parallel mutations per profile group.

### Immediate Remediation (PluginHostPage & `usePluginNavigation`)
1. **Decouple Plugin Host from `workspaceStore.selectedProject`:**
   For EVCrate Advisor (and server plugins):
   Resolve target server profile ID:
   ```ts
   const targetProfileId =
     useWorkbenchSelectionsStore((s) => s.settingsProfileId) ??
     getActiveProfileId();
   ```
2. **Update `usePluginNavigation`:**
   Accept an optional `profileIdOverride` or query both:
   - Server-level plugins from `settingsProfileId ?? getActiveProfileId()`.
   - Project-scoped plugins from `selectedProject?.profileId`.
   Alternatively, allow `usePluginNavigation` to query the Settings Target Server when `project` is null or when querying server-level capabilities.
3. **Update `PluginHostPage`:**
   When `installationId === "evcrate.advisor"` (or plugin marked as server-level):
   - Resolve connection via `getConnectionSnapshot(targetProfileId)`.
   - Use `{ project: "*" }` or default project target on that profile.
   - Do NOT reject with `no-project` if a valid connection to `targetProfileId` exists.

### Long-Term Resilience Improvements
1. **Contract Enforcement for Project Inputs:** Disallow raw `string` in `useProjectTarget` and Git queries. Enforce `ProjectRef` or `ProjectTargetRef` everywhere.
2. **Unified Aggregated Terminal Sessions on Dashboard:** Replace `useTerminalSessions()` with `useAggregatedTerminalSessions()` in `DashboardPage.tsx`.
3. **Reactive Settings Profile Subscription:** In `UsagePage.tsx`, replace `useWorkbenchSelectionsStore.getState().settingsProfileId` with reactive hook `useWorkbenchSelectionsStore(s => s.settingsProfileId)`.

---

## 6. Unresolved Questions
1. For general (non-EVCrate) plugins, should all plugins be scoped to Settings Target Server, or should project-specific plugins continue to query `selectedProject.profileId` with EVCrate Advisor treated as a server-level plugin exception?
2. When performing bulk Git operations across multiple profiles simultaneously (e.g. "Fetch All"), should failures in one profile abort or surface as partial results alongside successful profile operations?
3. In `GitPage`, if two profiles have repositories with the same name, should the UI enforce unique display labels (e.g. `[ProfileName] repo-name`) in all dropdowns, logs, and commit panels?
