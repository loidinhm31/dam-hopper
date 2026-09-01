# Phase 06 — WorkspacePage and Shell Integration

## Context Links
- [Plan](./plan.md)
- [Phase 03](./phase-03-terminal-lifecycle-correlation-and-agent-adapter.md)
- [Phase 05](./phase-05-responsive-workflow-context-surface.md)
- [WorkspacePage](../../packages/ui/src/components/pages/WorkspacePage.tsx)
- [IdeShell](../../packages/ui/src/components/templates/IdeShell.tsx)
- [TerminalWorkspaceShell](../../packages/ui/src/components/templates/TerminalWorkspaceShell.tsx)
- [MobileWorkspaceShell](../../packages/ui/src/components/templates/MobileWorkspaceShell.tsx)
- Depends on: Phases 03–05. Enables Phase 07.

## Overview
- **Date:** 2026-09-01
- **Description:** Mount one workflow surface in existing workspace shell seams and wire authoritative project/target and terminal navigation without routes, duplicate state, or terminal remounts.
- **Priority:** P2
- **Implementation status:** Pending
- **Review status:** Pending

## Key Insights
- All three shells already expose `toolbarActions`; this is the supported 40px companion-row seam. No shell layout API change is required.
- `WorkspacePage` owns active project, `useProjectTarget(projectName)`, compact/mode selection, terminal manager state/actions, and shell branching.
- `handleSelectTerminal(sessionId)` already performs terminal metadata lookup, active-project behavior, tab mounting, and existing search-param semantics. Reuse it exactly.
- `TerminalKeepAliveHost`, `mountedSessions`, `terminalTabs`, and editor keying must remain untouched; workflow UI is a sibling toolbar/portal.
- Terminal lifecycle data passed into the workflow surface is observed resource context only. `WorkspacePage` callbacks never auto-start/end/abandon a manual work session or apply a suggested timestamp.

## Requirements
- Pass a compact or desktop `WorkflowContextSurface` as `toolbarActions` to `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell`.
- Inputs: active `projectName`, `projectTarget?.target/targetKey/label`, current profile ID, selected/active Plan summary (children optional), terminal observed summaries from `sessionMap`/`mountedSessions`, compact flag, and explicit callbacks.
- Open terminal callback calls `handleSelectTerminal`; compact view then selects existing `terminal` surface. Do not directly call `setSearchParams` or build terminal URLs.
- Select workflow target callback: set configured project, call `useProjectTargetStore.selectTarget(project, worktreePath)`, and let existing target-aware panels/query keys reconcile. Unavailable historical targets remain display-only.
- Plan selection changes workflow presentation only. Direct Plan notes/sessions use workflow mutations; they do not create a Phase/Task or alter workspace navigation.
- Manual session mutations receive the user's typed/**Now** timestamp from the workflow component. Terminal callbacks may provide an observed suggestion but cannot submit or copy it automatically.
- Changing IDE/terminal mode, compact surface, project, or workflow deck state must preserve terminal buffers, input focus when appropriate, mounted session IDs, editor tabs/view state, and browser-debug keep-alive.
- Workflow context must not become an activity-bar tool, mobile workspace surface, route, TopNav nav item, or second Fleet panel.
- On profile change, close deck/sheet, clear drafts/selections/suggestions, and let the current profile-scoped query fetch new data; do not leak or aggregate prior-profile labels.

## Architecture
- Construct one `workflowToolbarActions` React node near other memoized WorkspacePage content. The component portals its deck/sheet, so shell slots render only the ambient trigger.
- Keep the same props/identity across IDE/terminal branches where possible; query state survives through TanStack cache even if shell branch remounts presentation state.
- Terminal navigation flow: workflow resource link → `handleSelectTerminal(id)` → existing `selectTerminal`/tab logic → existing URL params. No second registry lookup path.
- Target navigation flow: overview target → verify current config/worktree availability → workspace store + project-target store → existing panels.
- Surface mode is presentation input only; it never controls workspace mode or compact surface unless the user explicitly opens a linked terminal.

## Related Code Files
### Modify
- `packages/ui/src/components/pages/WorkspacePage.tsx` — compose workflow props, callbacks, and pass `toolbarActions` in all shell branches.
- `packages/ui/src/components/pages/WorkspacePage.test.tsx` — assert all branch seams and unchanged terminal/search-param wiring.
- `packages/ui/src/components/templates/IdeShell.test.tsx` — assert toolbar child is a sibling, not editor/bottom-panel replacement.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx` — assert toolbar child leaves terminal/overlays mounted.
- `packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx` — assert compact action row and safe-area behavior.
### Create
- `packages/ui/src/lib/workflow-workspace-integration.ts` — pure target/session reveal decisions, keeping branch logic out of WorkspacePage.
- `packages/ui/src/lib/workflow-workspace-integration.test.ts` — target unavailable and compact terminal reveal decisions.
### Delete
- None.

## Implementation Steps
1. Import the workflow surface, profile/target store actions, and minimal DTO types into `WorkspacePage`.
2. Derive terminal link candidates from authoritative `sessionMap`/`mountedSessions`: stable ID, incarnation if available, project, worktree path, alive/restarting/target-unavailable. Exclude command/cwd/output and keep observations separate from manual work times.
3. Pass current target plus active/selected Plan summary without assuming Phase/Task children. Keep Plan-only selection local to the workflow surface.
4. Implement `onOpenTerminal`: reject missing/current-profile stale ID, call `handleSelectTerminal(id)`, and on compact set `requestedCompactSurface='terminal'`. Do not force workspace mode.
5. Implement `onSelectTarget`: confirm overview workspace matches current overview, set active project, select root/worktree via existing store; unavailable target returns scoped UI error.
6. Memoize one `workflowToolbarActions` node with current profile/project/target/Plan/terminal inputs and callbacks. Avoid dependencies on optional child rows, terminal output, or registry snapshot.
7. Pass it to `toolbarActions` on all three shell branches. Do not change `editor`, `terminalContent`, `TerminalKeepAliveHost`, browser keep-alive, shell key, or existing activation requests.
8. On profile ID change, key only workflow presentation to reset drafts/open state; never key terminal/editor content.
9. Extend WorkspacePage tests for Plan-only context, optional breakdown absence, IDE/terminal/compact branches, profile switch, linked terminal navigation, observed suggestion non-application, unavailable target, and exact pass-through.
10. Extend shell tests to prove toolbar actions coexist with editor/terminal/overlay content and preserve existing safe-area class decisions.

## Todo List
- [ ] Terminal observations and suggestions remain read-only until explicit workflow mutation.
- [ ] Current-profile reset clears workflow drafts/suggestions without touching terminal/editor state.
- [ ] Plan-only context reaches every shell without requiring or synthesizing Phase/Task children.
- [ ] One workflow node reaches every current shell branch.
- [ ] Terminal links use existing `handleSelectTerminal` semantics.
- [ ] Target selection reuses project-target store and validation.
- [ ] Profile switch resets only workflow presentation.
- [ ] Tests guard terminal/editor/browser-debug continuity boundaries.

## Success Criteria
- No route/NavLink or new search parameter is added; current terminal deep links remain byte-for-byte governed by `useTerminalManager`.
- Opening/closing deck, switching shell mode, and changing workflow status do not change mounted terminal IDs or clear xterm/editor state.
- Observed terminal exit/restart/removal never changes a manual timestamp or status until the user explicitly submits a workflow mutation.
- Selecting/resuming a Plan without children affects only workflow presentation and direct workflow mutations; workspace/terminal navigation stays explicit.
- Root/worktree identity remains `ProjectTargetRef`; no second active project/worktree store exists.
- All IDE, terminal, compact/mobile, browser-debug, terminal usage, and mobile native-input modes still receive their existing content and controls.

## Risk Assessment
- **WorkspacePage complexity:** extract only pure integration decisions; do not create a second controller/store.
- **Mode-switch remount:** server query state is cached; terminal content identity and manager state are untouched; browser test proves buffers/input.
- **Stale terminal link:** verify against current session map and show stale state; never invent/recreate a terminal.
- **Profile race:** active profile participates in key and callback guards; stale callback fails closed.

## Security Considerations
- Link candidates are current-profile data only; profile change invalidates presentation before interaction.
- Target callback accepts structured project/worktree values from authenticated overview and still uses existing resolver on server writes.
- Do not expose commands/cwd in workflow props or accessible labels.
- Workflow errors remain scoped; no raw target path or server response logging.

## Next Steps
- Phase 07 runs focused backend/frontend/browser gates, migration rehearsal, docs, rollout, and observability checks.

## Unresolved Questions
None.
