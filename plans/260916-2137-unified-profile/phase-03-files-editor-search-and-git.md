# Phase 03 — Files, editor, federated search and Git

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Files and Git.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

All file/Git/search/replace actions target captured qualified resources and expose partial failures.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and ownership

Consumes Phase 01 contracts and Phase 02 qualified selections. Files/Git owner owns feature modules below; foundation owner alone edits `api/client.ts`, `api/queries.ts`, `hooks/use-sse.ts`. Supply exact callsite changes to that owner. Shell owner integrates `WorkspacePage.tsx` props once.

#### Evidence and files

- `stores/editor.ts`: `compositeTabKey`, per-tab request generations, global transport lookup, `persistedTab`, versioned metadata-only persistence; `stores/project-target.ts`, `stores/explorer-tree.ts`, `stores/search-ui.ts` retain bare project/target state.
- `hooks/use-file-search.ts`: 350ms debounce, minimum two characters, 200-character input cap, project/workspace scopes and previous-data placeholder. `hooks/use-search-panel-replace.ts` reads/writes through a newly looked-up transport after awaits. `hooks/use-fs-upload.ts` snapshots target but not connection.
- `lib/explorer-language-scan.ts`: QueryClient-wide epoch and project/target caches. `hooks/use-git-with-ssh-retry.ts` saves a callback for authentication retry; bulk replay must be narrowed to failed targets.
- Components: `FileTree.tsx`, `EditorTabs.tsx`, `MonacoHost.tsx`, `LargeFileViewer.tsx`, `BinaryPreview.tsx`, `MarkdownHost.tsx`, `MarkdownPreview.tsx`, `HtmlHost.tsx`, `HtmlPreview.tsx`, `SearchPanel.tsx`, `SearchPanelResults.tsx`, `UploadDropzone.tsx`; existing Git/worktree components and their query consumers.
- Backend `server/src/api/fs.rs:309–404` supports project-target search or server-local workspace root search; workspace scope rejects worktreePath. `server/src/fs/ops.rs` caps workspace results at 500 and project search at 1000. Reuse these endpoints; no federation server or database migration.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 03A | Qualified target/editor/model/tree keys and binding checks | G0 refs; Phase 01 API/query contract | Equal paths create separate models; dirty content survives retirement |
| 03B | Owner-bound file CRUD/watchers/upload/preview | 03A; Phase 07 media/encrypted-write interface | Focus cannot retarget async file work |
| 03C | Federated search and exact displayed-result replacement | 03A; per-profile API clients | Four concurrent servers, 500 rendered matches, honest partial results |
| 03D | Git/worktree/submodule operations and selective SSH retry | 03A; captured mutation variables | Successful/unknown targets never replayed |

Search and Git work can proceed after 03A without waiting for media implementation; preview integration waits for Phase 07 behavior. Keep server search bounds (500 workspace / 1000 project) and existing query debounce/input limits. Capture search-run revision as well as generation so two searches in one generation cannot mix.


#### Numbered implementation

1. Qualify editor tab identity with profile, project, normalized worktree, path, kind, Git root/commit/diff identity. Use this stable key as Monaco model path/key and view-state key; do not include connection generation in durable editor identity. Tab retains ResourceBinding and each read/save captures current ConnectionRef. On reconnect reload clean content only after target binding verification; never overwrite dirty content. Stale read/save responses cannot clear dirty state or update another tab's mtime.
2. Qualify target availability, selected worktree, explorer open/selected paths, language scans, rename/move/delete reconciliation and file watchers. Watcher teardown disposes the originating transport subscription only. Project/root changes detach affected resources, preserving dirty drafts; deletion on A cannot mark B's equal path unavailable. Scope scan epochs by owner/generation/target, not the whole QueryClient.
3. Bind create/rename/move/delete/read/save/streaming text/chunked large-file operations and ordinary/encrypted upload to captured destination. Drop handlers snapshot the drop target before asynchronous file enumeration, confirmation or passphrase entry; progress, cancellation and invalidation stay on that owner. Preserve existing sandbox/worktree/mtime checks, upload acknowledgements and bounds. No cross-server drag-and-drop filesystem move is introduced; reject mixed-owner move rather than copying implicitly.
4. Preview ownership follows the tab, not selected project. Markdown/HTML remain content-only renderers with existing sanitization/sandbox; do not inject server tokens, authenticated base URLs or bridge routing into their documents. Large-file/binary reads stay bound. Image/video/download helpers consume Phase 07 media leases; preserve browser-managed streaming/range downloads, not whole-file buffering. Revoke object URLs/tickets through their original owner where current semantics permit; download tickets retain their intended lifetime.
5. Replace ambiguous search scope with explicit `Project target` and `All connected profiles`. Project search includes selected worktree; federated search calls each eligible connected profile's existing `scope=workspace` root search, never forwards one selected worktree to other profiles. Snapshot eligible owners at dispatch, maximum four concurrent server searches, retain existing debounce/query limits. Aggregate results carry ProjectTargetRef with root target plus captured generation and path/line. Stable ordering: profile display order, project, path, line; render at most 500 combined matches and show a truncation warning if local cap or any server truncates. Request each server's existing bounded result set; don't assert completeness after truncation.
6. Federated search exposes per-profile loading/error/unsupported/disconnected status and usable successes, not a whole-search failure. New query/scope/profile generation cancels obsolete work and discards late responses; requests dispatched before disconnect may finish server-side but cannot commit. A newly connected profile is incorporated through a new search snapshot, never mixed into an old generation's results. Keyboard navigation and open-result actions use result owner. Remove cross-owner placeholderData.
7. Replace Next/All operates only on the displayed, explicitly selected result snapshot; confirmation lists profile/project/file counts and warns when results are truncated or profiles failed. Capture all target bindings before confirmation. Partition operations by profile, preserve existing dirty-tab conflict checks and mtime/concurrent-write behavior, stop changed/unavailable targets, return per-file success/failure/cancelled/unknown results. Cancellation stops undispatched writes; do not claim rollback for committed writes or replay unknown outcomes. Refetch only original owners. Never silently expand truncated search to undisplayed files.
8. Qualify all Git operations: status/diff/untracked, stage/unstage/discard and hunks, conflicts, commit/amend/history rewrite/revert/cherry-pick/reset, branches, worktrees, nested roots/submodules, fetch/pull/push and bulk operations. Keep project target plus Git root separately; no flattening submodule/root identity into profile. Partition explicit bulk selections by owner and call existing server APIs per partition. Undefined “all projects” must mean the explicitly chosen profile, never current focus after an await. Refresh/reconcile only matching owned editor tabs and query prefixes.
9. Git SSH prompts carry ConnectionRef, operation and exact failed targets/key path. Success on A is not replayed when B needs credentials. After prompt, validate owner generation; list/add/forget keys and retry only explicitly retryable authentication failures on the original client. A reconnect/URL/token change cancels the prompt; no retry against replacement connection. Keep server SSH credentials distinct from native desktop forwarding credentials.
10. Drop legacy editor/target/tree/search resource records under the Phase 02 reset contract; initialize qualified empty schemas, no conversion/quarantine/restore. Existing metadata-only persistence remains for newly created tabs. Preserve new-version live dirty drafts during ordinary lifecycle changes, not old resource records across the forced reset. Presentation-only widths may remain device-global.

### Todo list

- [ ] A/B `web/src/marker.txt` opens as distinct models; editing/saving A while B is selected changes A only.
- [ ] Same worktree/submodule names and paths do not share target availability, Git state or watcher invalidation across owners.
- [ ] Search succeeds partially with B offline, labels ownership/truncation, cancels stale queries, and result navigation opens the originating project.
- [ ] Replace shows exact affected owners and does not touch B's dirty tab or undisplayed/truncated results; partial success is honest.
- [ ] Upload/download/preview completion after focus change stays on origin; URL/root change detaches rather than retargets.
- [ ] Authentication retry never repeats successful bulk targets or dispatches to a new generation.

### Success Criteria

Also cover two searches within one connection generation returning out of order; cancellation after one replacement committed; root changes during upload; a dirty tab with the same path on another owner; worktree and nested Git root disambiguation.

Phase 03 checklist and S03/S04/S07/S11.

### Risk Assessment

Delayed save/upload/credential retry can retarget unless owner is captured before every asynchronous boundary.

### Security Considerations

Keep filesystem sandbox/worktree/mtime checks and original-owner SSH credentials; no cross-server move.

### Next steps

#### Verification and risks

Use existing editor, project-target, file-search, search-panel-replace, fs-upload, Git retry and preview tests; add regression only for collision, stale-save, partial search, partial bulk retry and cancellation boundaries. Live scenarios S03/S04/S07 exercise real files/Git/worktrees on both servers. Backend sandbox/search/worktree tests remain unchanged unless a contract change requires adjustment. Main risk is partial ownership migration in indirect helpers; foundation owner inventories every old `ProjectTargetInput`, ambient API/transport use and broad invalidation before enabling concurrency. No backend search protocol expansion required.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
