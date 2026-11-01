# Phase 05: P2 — Migrate application catalog and deep links

Estimate: 88h; implementation status: **pending**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status pending. Every retained placement-map feature reachable through an app/intent before legacy-shell deletion. [17-app catalog](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md#47-app-catalog-17-apps), [acceptance ledger](acceptance.md), [source baseline](source-evidence.md).

## Architecture / app contracts
Registry manifests implement approved catalog exactly. Existing component bodies remain canonical; extract navigation chrome/controller composition, not duplicate feature logic. No new server endpoints. Pure session/window state owns only restorable view state (scroll/filter/selected tab or commit); unsaved editor and resolver drafts remain in their existing memory stores/root resources. App providers must not fake owner scoping over hooks that still read ambient profile: thread owner/client through every listed manager/hook and request completion.

| App | Reuse / required behavior | Manifest instancing / minimum ctx / default |
|---|---|---|
| Terminals | Traditional navigator -> MultiTerminalDisplay/SplitLayout, runtime toggle ActiveTerminalRuntimeDisplay; filters ctx; exact existing PTY focus/rename/restart/history/diagnostics/session review; no new xterms | multi / profile, optional project / tile |
| Editor | EditorTabs/MonacoHost, MarkdownHost/LargeFileViewer/BinaryPreview/media/blame; per-window active tab, shared owner-qualified models; save/CAS/dirty-close/undo retained | multi / worktree / tile |
| Browser | BrowserDebugPanel/iframe keep-alive, dev-server target, console/picker/capture handoff to exact terminal; origin and nonce protection | multi / profile / tile |
| Files | FileTree + encrypted upload and explorer actions; owner-bound filesystem/watchers; intent to Editor | perContext / worktree / tile |
| Search | SearchPanel federated file/content/path search + replace, explicit target and dirty-buffer protection | perContext / worktree / tab with Files |
| Changes | ChangedFilesList/GitLocalChanges/DiffViewer; hunk stage/unstage/discard, commit, nested root targeting, conflict action -> Resolver | perContext / worktree / tab with Git |
| Git | GitPage+WorkspaceGitPanel composed from shared history/branch/worktree/details; search/selection persistence, inactive branch rewrite, squash/edit and leased push intact | perContext / worktree / tile |
| Conflict Resolver | ConflictResolverPanel/MergeConflictEditor; exact operation/root, retained draft/recovery/undo, guarded Apply/Continue/Abort and terminal handoff; open operation unavailable fail-closed | perContext / worktree+operation / float -> maximize |
| Session Changes | SessionChangesPanel/ReadonlyMonacoDiffViewer; replace modal presentation only; exact profile:generation:terminal:incarnation:ompSession:root key, disable/disconnect closes and purges owner cache, input cannot reach PTY | perContext / owner tuple / float |
| Workflow & Plans | WorkflowContextDeck/item/execution lists/plan folder/document/timeline/dashboard; ribbon intent targets exact project/worktree | perContext / project / tile |
| Ports & Tunnels | PortsPanel existing discovered ports/cloudflared lifetime/reminder controls; Browser intent on explicit target | perContext / profile / float |
| Project Info | ProjectOverview/ConfigEditor + FleetTerminalPanel contextual access; edits use exact project config owner | perContext / project / float |
| Agent Store | AgentStorePage complete existing subviews incl memory/harness/hooks/health; preserve existing settings/reader entry points, not retired plugins | perContext / profile / tile |
| Settings | SettingsPage sections plus DevicesPage/LoginDevicesSection, MFA/idle config/import-export/maintenance; independent target-server and preferences-source selectors | singleton / none / tile |

## Ordered implementation by task ID
### migrate-workspace-apps
1. Complete context-bound prototype adapters; separate per-window selected tab/navigator/app view state from shared resource ownership and legacy store selection. Explicitly handle overlapping all-project/project windows by focus-existing.
2. Extract Files/Search/Changes/Project Info adapters from floating file/tool presentation. Wire file.open/path+line, diff, reveal active file, ports browser handoff and terminal focus to typed intents. File trees/watchers subscribe only for visible interest, cleanup with captured owner.
3. Do not delete legacy floating wrappers yet. Both routes call same shared feature bodies; no `/workspace` navigation from OS actions.
### migrate-git-and-reviews
1. Compose Git adapter without second histories or selection persistence. Move all cross-panel callbacks/blame reveal/git commit/conflict entry points to dispatch explicit ctx/hash/root/operation. Keep ordinary push vs leased rewrite publication separate; no added automatic retries.
2. Convert SessionChangesHost body/lifecycle to shared owner guard usable in an OS window while old modal remains until Phase 08. Check full tuple, availability, feature disabled and reconnect cache purge; no persistable sensitive appState or offscreen eager diff.
3. Resolver is an ordinary web app with exact draft/operation identity, Escape precedence/recovery and no stale auto-submit. Qualify it in Phase09 like every app. V4 supersedes old native AC12 for this scope: no external-plan blocker/prerequisite; serialize actual shared-file writers only.
### migrate-management-apps
1. Add Workflow/Plans, Ports/Tunnels, Agent Store and Settings/Devices adapters; remove page-level TopNav/AppLayout only on OS app composition, retain bodies and old routes until cutover. Singleton Settings is not a global selected-server substitute.
2. Register fourteen retained app manifests/lazy imports and supported intents. UI palette/dock list all available apps; System Monitor/Hub/Recipes join later. Implement approved project-desktop template (60% Terminals, 40% Files/Search above Git/Changes; Editor to right/float on demand).
3. Add qualified `/os?open=git&profile=...&project=...` parser, explicit worktree/root/file/hash/owner tuple fields for supported intents; respect configured router basename. Unknown/missing profile or stale owner tuple -> notice/unavailable, no ambient launch. URL imports do not run commands; new-terminal action remains explicit user trigger under existing deep-link contract.
4. Old UI remains default; LegacyRedirect activates only Phase08. Intermediate releases ship URL-only `/os`/deep links without old-shell discovery links or build flag. OS-internal intents never bounce to Workspace or duplicate opens on back/forward.

## Success / commands
AC5/6 and deep-link foundation AC10. Every row above has a reachable launch and representative happy/error/target-change journey; registry tests assert catalog metadata. Test same project/path/session IDs on two profiles and worktrees; retired generation callbacks cannot save/stage/kill/open secret review. Session Changes focus and Escape sends zero input to background PTY; disable/disconnect closes and purges. File/media/encrypted transfers keep original owner and capabilities. Main runs listed checks at joined task boundaries; old shell parity tests retained until rewritten at Phase 09.

## Risks / security / rollback
Audit ambient ownership in controllers/callbacks/async work. Resolver has normal migration/Phase09 web qualification, NOT external native/upstream-plan blocker; fix actual OS failures under ordinary task ownership. Bodies unmount while resources/drafts persist; capabilities fail closed. Roll back adapters/registry to prior hidden OS state, retaining shipped P0/default old UI. Next Monitor then Hub/Recipes.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `migrate-workspace-apps` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/src/os/apps/TerminalsApp.tsx` |
| Modify | `packages/ui/src/os/apps/EditorApp.tsx` |
| Modify | `packages/ui/src/os/apps/BrowserApp.tsx` |
| Create | `packages/ui/src/os/apps/FilesApp.tsx` |
| Create | `packages/ui/src/os/apps/SearchApp.tsx` |
| Create | `packages/ui/src/os/apps/ChangesApp.tsx` |
| Create | `packages/ui/src/os/apps/ProjectInfoApp.tsx` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/intents.ts` |
| Modify | `packages/ui/src/os/resource-registry.ts` |
| Modify | `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/FileTree.tsx` |
| Modify | `packages/ui/src/components/organisms/SearchPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/ChangedFilesList.tsx` |
| Modify | `packages/ui/src/components/organisms/GitLocalChanges.tsx` |
| Modify | `packages/ui/src/components/organisms/DiffViewer.tsx` |
| Modify | `packages/ui/src/components/organisms/EditorTabs.tsx` |
| Modify | `packages/ui/src/components/organisms/MonacoHost.tsx` |
| Modify | `packages/ui/src/components/organisms/ProjectOverview.tsx` |
| Modify | `packages/ui/src/components/organisms/FleetTerminalPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugPanel.tsx` |
| Modify | `packages/ui/src/hooks/use-terminal-manager.ts` |
| Modify | `packages/ui/src/hooks/use-browser-debug.ts` |
| Modify | `packages/ui/src/stores/editor.ts` |
| Create | `packages/ui/browser-tests/os-workspace-apps.browser.tsx` |

### `migrate-git-and-reviews` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/apps/GitApp.tsx` |
| Create | `packages/ui/src/os/apps/ConflictResolverApp.tsx` |
| Create | `packages/ui/src/os/apps/SessionChangesApp.tsx` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/intents.ts` |
| Modify | `packages/ui/src/os/input-arbiter.ts` |
| Modify | `packages/ui/src/components/pages/GitPage.tsx` |
| Modify | `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/SessionChangesHost.tsx` |
| Modify | `packages/ui/src/components/organisms/SessionChangesPanel.tsx` |
| Modify | `packages/ui/src/hooks/use-conflict-resolver.ts` |
| Modify | `packages/ui/src/components/organisms/EditorTabs.tsx` |
| Modify | `packages/ui/src/components/organisms/ChangedFilesList.tsx` |
| Create | `packages/ui/browser-tests/os-review-apps.browser.tsx` |

### `migrate-management-apps` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/apps/WorkflowPlansApp.tsx` |
| Create | `packages/ui/src/os/apps/PortsTunnelsApp.tsx` |
| Create | `packages/ui/src/os/apps/AgentStoreApp.tsx` |
| Create | `packages/ui/src/os/apps/SettingsApp.tsx` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Create | `packages/ui/src/os/app-registry.test.ts` |
| Modify | `packages/ui/src/os/intents.ts` |
| Create | `packages/ui/src/os/deep-links.ts` |
| Create | `packages/ui/src/os/deep-links.test.ts` |
| Create | `packages/ui/src/os/desktop-templates.ts` |
| Modify | `packages/ui/src/os/OsShell.tsx` |
| Modify | `packages/ui/src/os/TopBar.tsx` |
| Modify | `packages/ui/src/components/pages/AgentStorePage.tsx` |
| Modify | `packages/ui/src/components/pages/SettingsPage.tsx` |
| Modify | `packages/ui/src/components/pages/DevicesPage.tsx` |
| Modify | `packages/ui/src/components/organisms/PortsPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/WorkflowContextSurface.tsx` |
| Modify | `packages/ui/src/hooks/use-ports.ts` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Create | `packages/ui/browser-tests/os-management-apps.browser.tsx` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "migrate-workspace-apps",
    "title": "Migrate workspace apps and all file terminal browser cross-actions",
    "blocked_by": [
      "integrate-os-services"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/TerminalsApp.tsx",
      "packages/ui/src/os/apps/EditorApp.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/apps/FilesApp.tsx",
      "packages/ui/src/os/apps/SearchApp.tsx",
      "packages/ui/src/os/apps/ChangesApp.tsx",
      "packages/ui/src/os/apps/ProjectInfoApp.tsx",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/resource-registry.ts",
      "packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx",
      "packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx",
      "packages/ui/src/components/organisms/FileTree.tsx",
      "packages/ui/src/components/organisms/SearchPanel.tsx",
      "packages/ui/src/components/organisms/ChangedFilesList.tsx",
      "packages/ui/src/components/organisms/GitLocalChanges.tsx",
      "packages/ui/src/components/organisms/DiffViewer.tsx",
      "packages/ui/src/components/organisms/EditorTabs.tsx",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/components/organisms/ProjectOverview.tsx",
      "packages/ui/src/components/organisms/FleetTerminalPanel.tsx",
      "packages/ui/src/components/organisms/BrowserDebugPanel.tsx",
      "packages/ui/src/hooks/use-terminal-manager.ts",
      "packages/ui/src/hooks/use-browser-debug.ts",
      "packages/ui/src/stores/editor.ts",
      "packages/ui/browser-tests/os-workspace-apps.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Files/Search/Editor/Changes/ProjectInfo/Terminals/Browser reachable with explicit owner actions and all retained feature behavior.",
      "Multiple Editor windows keep distinct active tab/view state over unique live models; overlapping terminal windows focus existing slot."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/components/organisms/EditorTabs.test.tsx src/hooks/use-terminal-manager.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-workspace-apps.browser.tsx browser-tests/project-worktree-target.browser.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  },
  {
    "id": "migrate-git-and-reviews",
    "title": "Migrate Git conflict and session review with exact identity guards",
    "blocked_by": [
      "migrate-workspace-apps"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/GitApp.tsx",
      "packages/ui/src/os/apps/ConflictResolverApp.tsx",
      "packages/ui/src/os/apps/SessionChangesApp.tsx",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/components/pages/GitPage.tsx",
      "packages/ui/src/components/organisms/WorkspaceGitPanel.tsx",
      "packages/ui/src/components/organisms/ConflictResolverPanel.tsx",
      "packages/ui/src/components/organisms/SessionChangesHost.tsx",
      "packages/ui/src/components/organisms/SessionChangesPanel.tsx",
      "packages/ui/src/hooks/use-conflict-resolver.ts",
      "packages/ui/src/components/organisms/EditorTabs.tsx",
      "packages/ui/src/components/organisms/ChangedFilesList.tsx",
      "packages/ui/browser-tests/os-review-apps.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Git safety/history/blame/selection and exact-root Resolver web behavior retained; Phase09 qualifies Resolver normally with no external native AC12 prerequisite or mutation wire change.",
      "Session Changes window preserves tuple keying, fail-closed cache purge and PTY input isolation."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/components/pages/GitPage.test.tsx src/components/organisms/EditorTabsBlame.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-review-apps.browser.tsx browser-tests/session-changes-host.browser.tsx browser-tests/git-history-search-persistence.browser.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  },
  {
    "id": "migrate-management-apps",
    "title": "Migrate management apps and qualified OS deep-link intents",
    "blocked_by": [
      "migrate-git-and-reviews"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/WorkflowPlansApp.tsx",
      "packages/ui/src/os/apps/PortsTunnelsApp.tsx",
      "packages/ui/src/os/apps/AgentStoreApp.tsx",
      "packages/ui/src/os/apps/SettingsApp.tsx",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/app-registry.test.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/os/desktop-templates.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/TopBar.tsx",
      "packages/ui/src/components/pages/AgentStorePage.tsx",
      "packages/ui/src/components/pages/SettingsPage.tsx",
      "packages/ui/src/components/pages/DevicesPage.tsx",
      "packages/ui/src/components/organisms/PortsPanel.tsx",
      "packages/ui/src/components/organisms/WorkflowContextSurface.tsx",
      "packages/ui/src/hooks/use-ports.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/browser-tests/os-management-apps.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Fourteen retained apps registered; new-project template matches approved layout and compact rules.",
      "All management features/devices/crypto/idle actions and palette/deep links use exact target without /workspace bounce.",
      "Unknown or stale deep links fail visibly; repeated navigation does not spawn duplicate windows or execute commands."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/components/pages/AgentStorePage.test.tsx src/components/pages/SettingsPage.test.tsx src/components/pages/DevicesPage.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-management-apps.browser.tsx browser-tests/login-devices.browser.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  }
]
```

- [ ] <!-- evcrate-task:migrate-workspace-apps --> Migrate workspace apps and all file terminal browser cross-actions
- [ ] <!-- evcrate-task:migrate-git-and-reviews --> Migrate Git conflict and session review with exact identity guards
- [ ] <!-- evcrate-task:migrate-management-apps --> Migrate management apps and qualified OS deep-link intents
