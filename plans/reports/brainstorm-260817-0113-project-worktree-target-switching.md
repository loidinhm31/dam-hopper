# Project worktree target switching brainstorm

## Problem

One configured project may have a root checkout plus multiple Git worktrees at arbitrary filesystem paths. User must select one checkout for that project without changing project identity. Explorer, search, editor, Git changes/actions, project status, and newly launched terminals must use the selected checkout.

Existing repository already supports Git worktree list/add/remove:

- `server/src/api/git.rs`: worktree REST routes.
- `server/src/git/cli_fallback.rs`: `git worktree list --porcelain`, add, remove, prune.
- `packages/ui/src/components/organisms/ProjectInfoPanel.tsx`: Worktrees section.
- `packages/ui/src/api/queries.ts`: worktree queries and mutation invalidation.

Missing: first-class checkout target shared across panels and safe backend path resolution.

## Agreed requirements

- Discover only worktrees registered to the configured project's Git repository. Parent directory irrelevant; paths such as `/home/loidinh/WS/dam-hopper-ws/*` work.
- Discover additions/removals at runtime without project config edits or app restart.
- Worktree selector lives only in Project panel's existing Worktrees section.
- Top-bar project selection and project name remain unchanged.
- Selection is per project, current app session only. App restart defaults every project to configured root checkout.
- Root checkout and each worktree have independent editor tabs/diffs.
- Root checkout and each worktree have independent terminal sessions. Existing sessions keep their original cwd when selection changes.
- All workspace-scoped panels use one selected target consistently.
- Existing worktree add/remove capability remains; feature is not a new worktree manager redesign.

## Scope boundary

In scope:

- Project panel selector and live discovery state.
- Explorer, file reads/writes, tree subscriptions/watchers, file previews/downloads/media tickets.
- Project search and path search.
- Editor tabs, diffs, active tab state, save/reload/reconciliation.
- Source control, Git panel, Git actions, branches, log, status, nested VCS roots.
- Project commands and terminal launch cwd/environment.
- Terminal grouping/metadata for root versus each worktree.
- Target-aware React Query keys and invalidation.
- Safe fallback when selected worktree disappears.

Out of scope:

- Treating worktrees as configured projects.
- Changing workspace/project config paths.
- Manual non-Git directory targets.
- Persisting selected worktree across app restart.
- Moving an already-running terminal process to another cwd.
- Changing global workspace, project selector, agent-store distribution, or bulk multi-project Git semantics unless a shared helper requires compatibility updates.

## Evaluated approaches

### 1. Replace `project.path` globally

Pros: few frontend call-site changes; existing APIs continue resolving project name.

Cons: unsafe. `AppState::project_path` and `ProjectSandbox` currently assume one root per project (`server/src/state.rs`, `server/src/fs/sandbox.rs`). Replacement would retarget unrelated clients/background requests, invalidate filesystem watcher assumptions, conflict with concurrent root/worktree terminals, and blur persisted config versus runtime state.

Decision: reject.

### 2. Store active worktree per project in server global state

Pros: central backend switch; fewer request schema changes.

Cons: selection leaks across browser clients, hidden global mutation, request races during switching, and poor fit for concurrent target-scoped terminals/editors.

Decision: reject.

### 3. Expose every worktree as a synthetic project

Pros: reuses project-root model.

Cons: changes top-bar project identity, duplicates configuration/commands, pollutes project ordering, and violates user requirement.

Decision: reject.

### 4. Explicit project target per operation

Use an optional worktree path alongside stable project name:

```ts
interface ProjectTargetRef {
  project: string;
  worktreePath?: string; // absent means configured project root
}
```

Backend resolves and canonicalizes this reference, verifies the path belongs to the project's current registered worktree set, and authorizes it as a target-specific sandbox root. Frontend derives a stable `targetKey` from project plus canonical root and uses it in component keys, caches, editors, and terminals.

Pros: explicit, request-safe, multi-client-safe, concurrent targets supported, configured project identity unchanged.

Cons: cross-cutting protocol/cache migration; filesystem WebSocket messages and terminal metadata need changes.

Decision: recommend.

## Recommended design

### Runtime selection

- Add session-only `activeTargetByProject` state. Default target is configured `project.path`.
- Do not persist this map. Existing active project persistence remains unchanged.
- Extend Project panel Worktrees section: root row plus registered worktree rows, selected indicator, switch action.
- Refresh worktrees when section opens, on window focus/reconnect, and after add/remove. Poll only while section is visible if live external changes must appear without focus; avoid permanent polling.
- Configured root identity is path equality with `project.path`, not only backend `isMain` ordering.

### Backend target resolution and security

- Add one shared `resolve_project_target(ProjectTargetRef)` boundary.
- Root target resolves from config. Worktree target must be canonical, existing, and present in `git worktree list --porcelain` for that project repository.
- Keep a short-lived registered-target cache if needed; never run Git CLI for every file chunk/read. Invalidate on worktree add/remove/prune and refresh on explicit worktree listing/selection.
- Make filesystem sandbox/watcher subscriptions target-aware so root and multiple worktrees may coexist. Never overwrite the configured project's sole sandbox root globally.
- Keep nested VCS `root` distinct from `worktreePath`; do not overload existing Git `root` arguments.

### Frontend identity and caches

- Introduce `targetKey`/target context shared by Workspace page descendants.
- Include target key in React Query keys for status, branches, roots, diff, conflicts, log, files, search, and tree state.
- Include target key in component keys where remount is required.
- Route all filesystem transport calls, including raw WebSocket tree/read/write/upload operations, with target reference.
- Top-bar branch control reads selected target, while ProjectSwitcher remains unchanged.

### Editors

- Change tab identity from `${project}::${path}` to `${targetKey}::${path}`.
- Partition active keys, diffs, view state, dirty state, reconciliation, and file-change handling by target.
- Switching target hides current target's tabs and restores selected target's tabs.
- Existing persisted editor data needs a versioned migration. Legacy project-only tabs map to root target.

### Terminals

- New terminals default cwd to selected target root.
- Resolve relative terminal profile cwd and configured `env_file` against selected target root.
- Add target identity/path to terminal create request and `SessionMeta`/respawn metadata.
- Include a compact target discriminator in deterministic build/run/custom/profile session IDs so root and worktree sessions cannot collide.
- Terminal tree groups project root and each worktree independently. Switching active target does not kill, move, or retarget running processes.

### Removal and disappearance

- App-initiated removal blocked while target has live terminals or dirty editor tabs; UI offers close/resolve first.
- Git's existing dirty-worktree protection remains authoritative for disk changes.
- If worktree disappears externally: mark target unavailable, immediately fall active selection back to root, disable new target operations, keep existing terminal process metadata visible as orphaned until user closes it, and preserve dirty editor state with an explicit unavailable warning.
- Never silently discard dirty UI state or kill external processes.

## Risks and mitigations

- Partial routing causes mixed panels: central target context plus target-keyed tests across each panel.
- Path injection/escape: server validates canonical path against live registered Git worktrees; frontend path never trusted.
- Stale worktree list: visible refresh/focus/reconnect and mutation invalidation; explicit unavailable error triggers refresh/fallback.
- Cache collision: target key mandatory in query/editor/session identities.
- Existing protocol breadth: inventory REST and raw WebSocket filesystem operations before implementation phases.
- Oversized modules: extract target identity/resolution and state helpers; avoid adding more responsibility to `WorkspacePage.tsx` and `use-terminal-manager.ts`.

## Acceptance criteria

1. Worktree created with `git worktree add` anywhere on disk appears in the project's selector at runtime.
2. Selecting it keeps the same top-bar project but Explorer, Search, Editor, Changes, Git panel/status/actions, and new terminals operate on its path.
3. Selecting root restores root-scoped panels and independent root editor/terminal state.
4. Switching repeatedly never mixes file content, Git results, query cache, or watcher events between targets.
5. Root and multiple worktree terminals run concurrently with distinct session identities and cwd values.
6. App restart selects root for every project.
7. In-app add/remove refreshes selector immediately; external removal causes safe root fallback.
8. Unregistered or cross-project paths are rejected by backend.
9. In-app removal cannot silently lose live terminal or dirty editor state.
10. Existing project selection, workspace switching, nested VCS root selection, and root-only behavior remain compatible.

## Validation surface

- Rust unit tests: porcelain parsing including locked/prunable/missing entries; target resolver; canonical/security checks; target-aware sandbox.
- Rust API/integration tests: worktree list/select routing for FS, Git, terminal; unregistered paths; removal behavior.
- Vitest: session-only target store, target keys, query keys/invalidation, editor migration/partitioning, terminal ID/grouping.
- Browser tests: Project panel selection switches Explorer/Git/editor/terminal together; root/worktree state restoration; runtime add/remove/fallback.
- Broad gates: `pnpm lint`, UI unit/browser tests, backend tests, then `pnpm check` for broad change.

## Plan readiness

Ready for detailed planning. Recommended phased plan: shared contracts/resolver, target-aware filesystem transport/sandbox, frontend target state/selector, Git routing/cache keys, editor partition/migration, terminal partition/metadata, deletion/fallback hardening, integration/browser validation.

## Unresolved questions

None blocking. Exact visible-refresh interval and UI wording are implementation-level decisions.
