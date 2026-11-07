---
title: "OS workspace File Tree and marked projects"
status: approved
approved: 2026-11-03
scope: web-os-and-required-server-contracts
related_plan: ../261101-1738-ai-dev-os-redesign/plan.md
implementation: not-started-by-this-brainstorm
planning_consent: deferred-by-user
---

# Decision

Workspace-wide filesystem access is independent of project registration. Users explicitly mark folders as projects. Files has Workspace and Projects navigation modes. Git tools require a marked project and a valid repository/worktree within its authorized project context.

User approved the revised OS-only design in this conversation. Android compatibility does not constrain the redesign; Android changes are excluded. User separately selected Defer planning; no implementation plan was requested.

## Problem and final artifact

Today Files blocks on a configured project; filesystem requests resolve through project targets. This makes the OS filesystem depend on development metadata. Workspace search currently federates configured projects rather than searching the workspace directory.

This report is the approved decision artifact, not an implementation plan or runtime qualification. The eventual product artifact is a complete workspace-first Files/Editor/Search/folder-terminal flow, explicit project marking and filtering, and project-gated Git, backed by authoritative server targets.

## Scope and constraints

In scope:
- Web OS Files/FileTree, Editor, Search, folder terminals, project management, and their required server REST/WS contracts.
- Workspace/root identity, file identity, sandboxing, watchers, upload/media target propagation, OS intents and persisted view state.
- Existing project-scoped Git/Changes/Resolver behavior and worktree authorization.
- Documentation and meaningful behavioral qualification for changed OS paths.
- Document actual Android contract impacts without adapting Android.

Out of scope:
- Android implementation, compatibility adapters solely for Android, or Android qualification.
- Automatic project registration/discovery, Git access for unmarked projects, automatic git init or command execution.
- Unrestricted host filesystem browsing, multi-workspace server hosting, new authorization roles, or desktop synchronization.
- Changing default-workspace selection or promising non-destructive active-workspace switching. Current server workspace switching disposes PTYs; this redesign does not change that lifecycle.

Retain explicit profile ownership, fresh connection/runtime authority, Cognito input isolation, root resource lifetime, and unknown terminal-creation protections. No implementation deadline or performance budget was supplied. Preserve bounded/lazy behavior rather than introducing a whole-workspace index.

Amendment to the original OS plan: its no-new-API/WS constraint cannot apply to this new scope. Its existing server+project recipe subset rule remains unchanged; this design does not add workspace-wide recipes.

## Options and rationale

| Approach | Benefit | Cost / disposition |
|---|---|---|
| Keep project-required Files | Smallest change | Rejected: fails whole-workspace navigation. |
| Workspace Files + explicit project marks + project-gated Git | Matches user intent; reuses existing project metadata and Git scope | Approved: requires a real filesystem-target contract, not only a UI filter. |
| Automatic project discovery and unregistered-repository Git | Less registration | Rejected by selected direction: ambiguous monorepo boundaries, scanning and repository-target expansion. |

No fake workspace project and no duplicate marked-folder registry. Detection may inform display but does not register a project or authorize execution.

## Domain model

- Workspace: explicit authorized filesystem browse root on the owning server, not a virtual desktop and not automatically the configuration directory.
- Folder: filesystem location usable without project metadata.
- Marked project: existing saved project entry, associating a folder with a name and optional commands, agent settings, and other existing metadata.
- Repository/worktree: exact Git target within an authorized marked-project context; not synonymous with workspace or folder.
- Desktop: arrangement of windows and defaults for newly opened windows; changing defaults does not retarget existing resources.
- Tree view: window-local navigation projection, never a permission boundary or file identity.

## User behavior

### Workspace mode (default)

- Files opens at the authorized workspace root even with zero projects.
- Users traverse all accessible directories under that root and perform ordinary file operations, editing, scoped search, and Open Terminal Here.
- Marked folders have project badges.
- Hidden/ignored-file visibility is an independent control, not part of project filtering.
- External projects are not fabricated as physical workspace children. Symlinks cannot implicitly grant access outside the root.

### Projects mode

- Show marked projects as tree roots, with All marked projects or a selected-project filter.
- Traverse inside those roots; unrelated workspace folders are absent.
- Empty state: No marked projects, with Return to Workspace action.
- Existing authorized external projects appear as separately labelled external roots.
- Nested marked projects may appear as separate navigation shortcuts; underlying file resources are not duplicated.
- Persist view mode, selected-project filter, and expansion state per Files window. Do not retain a stale project selection by falling back to a different project.
- Switching modes changes only that Files window. Preserve open editors/dirty buffers, terminals, and Git targets. Do not issue cd, restart PTYs, or rewrite desktop defaults.

### Mark / settings / unmark

1. Folder context menu: Mark as Project.
2. Confirm name and folder; advanced settings optional. Project type must not require unnecessary manual setup; retain supported existing schema semantics.
3. Save a project entry on the owning server, revalidating the target and preventing concurrent config updates from being lost.
4. Refresh badges, project selectors, and Projects mode.

Marking does not create/move files, initialize Git, execute commands, or create a desktop. Existing configured projects are already marked; do not duplicate them. Workspace Config remains available for workspace settings and project management, but is no longer a file-access onboarding gate. Project Settings is reachable from the folder as well.

Unmark Project removes registration, with confirmation explaining associated configuration removal. It deletes no files and kills no terminals. In-root files remain accessible; project-only windows become unavailable instead of selecting another project. For external projects, removal also withdraws that explicit access root: preserve dirty buffers but deny saves until authorization is restored. Existing root protections must not be bypassed by workspace-mode operations, including mutation of an ancestor containing a protected marked root.

### Git

- Require a marked project and an actual repository/worktree.
- For an unmarked repository, show Mark as project to use Git; deny unregistered Git targets server-side as well.
- A marked non-Git folder is valid; Git shows No repository. No automatic git init.
- Retain existing project-scoped nested repository and linked-worktree validation.
- Open Git explicitly opens/focuses the appropriate exact target. Merely selecting a folder or toggling tree mode never retargets an existing Git/Changes/Resolver window.

### Editor, Search, terminal

- Files opened through workspace and project routes resolve to one shared editor model/dirty state for that file on that owner.
- Preserve navigation breadcrumbs separately from canonical file identity.
- Search explicitly targets Workspace, Project, or Folder. Workspace means the workspace directory, not an implicit union of all project roots; external roots require their own explicit target.
- Folder terminals use a validated selected-directory CWD. No project registration is required for workspace folder terminals; no fallback to another server or arbitrary home directory for this explicit action.
- Existing live terminal CWD is never changed by tree navigation, defaults, or marking.

## Interfaces and security invariants

1. Introduce an explicit discriminated filesystem target: workspace or project/worktree. Missing project data must never silently expand access to the workspace. Exact wire naming belongs to planning.
2. Resolve the authorized workspace browse root explicitly. Current workspace_dir may be the config-file parent and is not security authority. Existing installations need an explicit, reviewable root resolution before new access is enabled; do not expose ~/.config/dam-hopper accidentally.
3. Workspace root and external project/worktree roots are distinct authorized targets. Keep canonical containment, traversal rejection, secure delayed writes, root protections, and .git mutation controls.
4. Scope file operations, caches, watches, media capabilities, uploads, and async completion to exact owner and workspace/root authority. Reject stale requests and commits after workspace/root replacement; client SSE invalidation alone is insufficient.
5. Normalize file identity server-side across workspace/project routes. Use owner/workspace-qualified canonical file-location identity for shared editor resources. Keep version/physical-file checks separate: atomic save replacement must not create a second logical document identity. Do not introduce a persistent inode-only identity scheme.
6. Mark/unmark updates metadata/access targets, not bytes. Revalidate authorization at action/commit time; do not let old handles bypass withdrawn external-root access.
7. Lazy-load directory children, watch relevant expanded directories, and retain bounded search/cancellation/truncation. No eager recursive scan for project discovery or initial render.
8. Cleanly migrate affected OS callers. No legacy adapters solely for Android; document any resulting Android incompatibility.

## Touchpoints and dependency order

Likely implementation surfaces, not a finalized file ownership plan:

| Layer | Existing touchpoints | Responsibility |
|---|---|---|
| Root/config | server/src/config/parser.rs, schema.rs, resolve.rs; server/src/api/config.rs and workspace.rs; server/src/state.rs | Explicit browse-root resolution, project metadata lifecycle, workspace invalidation. |
| FS targets | server/src/workspace_target.rs; server/src/fs/sandbox.rs and mod.rs; server/src/api/fs.rs, ws.rs, ws_protocol.rs | Workspace/project discrimination, canonical resources, watch/write/upload/media propagation and fences. |
| Client contracts | packages/ui/src/api/ownership.ts, client.ts, ws-transport.ts; file query/hooks | Typed target propagation and owner/workspace keys. |
| OS surfaces | packages/ui/src/os/apps/FilesApp.tsx, EditorApp.tsx, SearchApp.tsx, TerminalsApp.tsx; os/types.ts, app-registry.ts, intents.ts, persistence.ts | Tree modes, exact context, shared editor identity, persisted view state. |
| Existing UI | FileTree.tsx, ConfigEditor.tsx, editor store and file-target helpers | Mark/settings actions, removal of project gate, no duplicate config authority. |
| Documentation/qualification | Configuration/API/OS architecture docs; server FS tests; UI browser and full-app journeys | Demonstrate behavior, security, compatibility impacts and actual visual acceptance. |

Produced contracts come first: authorized root + filesystem target + normalized resource identity + workspace invalidation. File surfaces and project navigation consume them. Integrate Git gating and persistence, then qualify complete user journeys. This is ordering guidance, not authorization to create or execute an implementation plan.

## Android impact note

Android source changes and compatibility are excluded by explicit user direction. The current Android client uses project-based file targets. Do not claim the redesigned server will remain compatible.

Confirmed coupling: current file repository REST/WS requests use project and optional worktreePath. Potential impacts to document against actual finalized contracts: list/read/stat/write/watch, search scopes, media/upload targets, terminal CWD targeting, and workspace identity/epoch handling. Project-gated Git stays the chosen conceptual model; wire compatibility still must be assessed when contracts are finalized. Later Android redesign should consume the new authoritative contracts, not infer workspace access from missing project fields.

## Acceptance and validation

1. Workspace with zero projects: browse nested directories, create/read/edit/rename/delete ordinary files, search, and launch a folder terminal at the displayed CWD.
2. Mark a folder from Files; badge and Projects roots update; registration survives reload and is visible to another authorized client.
3. Existing configured projects appear marked without duplicate records. Marking performs no Git initialization or command execution.
4. Projects mode supports all marked roots and one selected project; excludes unrelated directories; empty mode has a return action. Reload restores each Files window's own view state.
5. Workspace/project aliases of the same file share one model, dirty state and save-version boundary, including nested projects and atomic saves.
6. Unmarked repository Git requests fail; marked repository Git works; marked non-repository shows No repository.
7. Browsing, marking, filtering and desktop-default changes do not retarget live Git/Changes/Resolver windows, change terminal CWD, or lose dirty edits.
8. Unmarking removes no filesystem content and kills no processes; disables project-only targets; external-root revocation denies later saves while preserving dirty buffers.
9. Reject traversal, escaping symlinks, workspace-root mutation, marked-root mutation through workspace aliases/ancestors, and stale workspace/root actions including delayed writes/uploads.
10. Explicit external projects and registered worktrees remain isolated authorized roots. Same-name cross-profile/workspace targets never bleed.
11. Large directory navigation expands lazily, releases relevant watch resources, and reports bounded/truncated search honestly. No initial whole-workspace crawl.
12. Exercise actual full-app flows and fresh visual review, not only mocked adapters; record exercised checks and remaining gaps. Document actual Android breaking contracts without running or claiming Android qualification.

## Feasibility, trade-offs, and risks

Feasible from inspected code: workspace root metadata and a WorkspaceSandbox implementation exist; project configuration, project Git resolution, and OS app adapters are established. However WorkspaceSandbox is not the runtime FS authority today. This is substantial backend/client work, not a toggle-only change.

Users gain OS-style browsing while keeping deliberate project organization. Operators must understand the broader root access they authorize. Developers retain project-based Git rather than creating a second arbitrary-repository API.

Primary risks: wrong default root exposing configuration/secrets; cross-workspace stale requests; workspace/project split editor buffers; root-protection bypass through an ancestor; external-root revocation races; watcher/search growth; and Android incompatibility. The contracts and acceptance checks above address these risks; they are not proof of implementation.

## Evidence and limitations

Read-only source inspection and two completed scout reports informed this design. No product files changed; no build/tests/runtime or visual qualification performed by this brainstorm. Existing user changes in the worktree were not altered. Earlier chat claims of already-complete workflow/template integration are not qualification evidence.

Anchors observed during research:
- server/src/state.rs:37-42: workspace_dir explicitly not a filesystem boundary.
- server/src/config/schema.rs:161-223: project metadata and workspace name/root.
- server/src/config/parser.rs:35-55, 195-201: config-parent-relative project paths and absolute external projects.
- server/src/fs/sandbox.rs:23-163: project authority plus existing workspace sandbox helper; external worktree containment.
- server/src/api/fs.rs:68-151: mandatory project path/read params and project resolution.
- server/src/api/config.rs:734-755 and workspace.rs:181-209: config publication, watcher/target invalidation, active workspace switch and PTY disposal.
- server/src/fs/mutate.rs:15-37: root and .git mutation protections.
- packages/ui/src/os/apps/FilesApp.tsx:24-46, 106-153: project-gated Files UX.
- packages/ui/src/os/persistence.ts:38-70: allowlisted file/editor view-state projections.
- plans/261101-1738-ai-dev-os-redesign/plan.md:15, 45, 67: original API constraint and recipe subset scope.
- Completed read-only scouts: FsAuthorityScout and WorkspaceUxScout; reports delivered in this session, not persisted as repository artifacts.

## Open decisions

- No unresolved user-facing design choices after approval.
- Exact root-upgrade handling, wire schema/versioning, config mutation API, and canonical resource-key encoding require planning against affected callsites; do not assume support already exists.
- User explicitly deferred implementation planning. No plan router invoked and no implementation plan created. Next step: user may later request central planning from this approved report.
