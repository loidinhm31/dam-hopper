# Git history search and persistence — implementation contract

Status: proposed; implementation has not started. All paths relative to repository root `/home/loidinh/WS/dam-hopper`. This contract wins over worker guesses; preserve repository conventions over generic skill examples.

## 1. User-visible behavior

- Both Workspace Git panel and Git page expose `Search commit messages`, a clear action, history branch selection in view-only mode, matching-result pagination, refresh, and loading/error/no-results states.
- Search current history branch within the selected qualified project target and VCS root. Not all branches/projects; not author, hash, file content, or diff search.
- Trim outer query whitespace. Empty/whitespace-only input means ordinary history. Interior spaces and punctuation literal. Case-insensitive matching uses Git's existing locale-dependent semantics; guarantee ASCII case-insensitivity, not a new Unicode case-folding algorithm.
- Match full commit message, including body. Existing `GitLogEntry.message` remains subject text. A body-only match may have no matching text in its row; label search scope as `Subject and body`; selected details use existing full-message read flow where available. Do not expand the row DTO or add mandatory previews/highlighting.
- One single-line search term; reject CR, LF, and NUL at the request boundary with the repository's normal bad-request error. Treat leading hyphens and regex metacharacters as literal search text. URL-encode REST values.
- Apply filtering before offset/limit. UI page size stays 200. Previous/Next offsets count matching commits, not raw history positions. Keep array response and existing `rows.length === 200` next-page heuristic: a full final page can lead to an empty next page; Previous/Clear remain available. Do not claim total match counts.
- Search input debounced 300 ms; clear/Escape applies empty filter immediately. No request for each keystroke. IME composition defers application until composition ends. Changing applied query resets page and selected commit; pending old-query rows must not be actionable or presented as current results.
- Search text/page/selected commit reset on effective target/root/branch changes and remount/reload. Only requested selection state persists.
- Filtered results render existing commit rows without ancestry edges. Ordinary history keeps existing graph; never rewrite `parents`, synthesize omitted nodes, or let missing ancestors grow lanes through the filtered result set.
- Branch selection/restoration never checks out, creates, deletes, resets, or publishes anything. Safe cherry-pick/revert still target checked-out branch; rewrite callbacks unavailable when viewing another branch. Restore existing pushed-history, HEAD, signature, CAS and leased-publish guards unchanged.

## 2. Wire and query contract

REST: existing GET `/api/git/{project}/log`, optional `messageQuery` alongside existing `worktreePath`, `root`, `ref`, `limit`, `offset`.

Typed transport: existing `git:log` payload adds optional `messageQuery`; omit empty normalized query. Server response stays `GitLogEntry[]`.

Minimal source API extension: append `messageQuery?: string` to existing positional `api.git.log` and `useGitLog` parameters. This preserves current callers without shims or a broad options-object refactor. Migrate relevant callers and every direct Rust `get_log` call to its new optional argument.

Backend: extend existing `get_log` command construction, not a new search engine. For a nonempty normalized query append Git arguments `--fixed-strings`, `--regexp-ignore-case`, and one `--grep=<query>` argument. Keep ref validation and existing bounded formatter/parsing/pushed metadata. Git handles traversal/filter/skip/count; no client-side page filtering, fetching all commits, shell command string, secondary revwalk, database index, or exact-count scan.

Shared query construction in `api/queries.ts`:

- Introduce `gitLogQueryOptions(target, limit?, offset?, ref?, root?, messageQuery?)`; use existing normalization, `resolveTargetOwner`, `getBoundApiClient`, `gitQueryKey`, and `profileQueryKey`.
- Key suffix: `[root ?? '.', limit, offset, ref ?? null, normalizedQuery || null]`; existing owner/project/worktree prefix remains authoritative. Normalize once for request/key agreement.
- `useGitLog` delegates to the shared options builder. Preserve existing default values; owner unavailable must fail closed, not choose another transport.
- Shared history controller refreshes its active query with the same builder / bound query refetch, invalidates matching owner/target/root prefixes for branches/status/history/details as needed, and fences selection publication against changed owner generation and effective scope.
- Remove Workspace's independently hand-built legacy Git log key and ambient `api.git.log` refresh path when cut over. Exporting helpers must use LSP references if configured; this planning session has no language servers.
- Existing mutation invalidation should invalidate all search variants under the relevant owner/target/root prefix. Never invalidate another profile's same-name project.

## 3. Persisted state ownership

Keep `useWorkspaceStore.selectedProject` canonical for focused `{ profileId, project }`; existing `dam-hopper:workspace-state` already persists it. Do not introduce another last-project scalar or restore unowned legacy keys.

Create small `stores/git-history.ts` with Zustand `persist`, version 1, storage key `dam-hopper:git-history-state`:

```ts
type HistoryBranchPreference =
  | { mode: 'follow-active' }
  | { mode: 'pinned'; ref: string }; // refs/heads/... or refs/remotes/...

type PersistedGitHistory = {
  gitPageSelection: string[] | null; // projectKey() values; null=never initialized; []=explicit all
  rootByTarget: Record<string, string>; // projectTargetKey(), root ID, default '.'
  branchByScope: Record<string, HistoryBranchPreference>; // JSON tuple [profileId, project, worktreePath|null, rootId]
  selectionRecoveryRequired: boolean; // corrupt saved selection cannot become all on later reload
};
```

Use existing `projectKey`, `parseProjectKey`, `projectTargetKey`, and normalized worktree paths. Require nonempty explicit profile/project for persisted identities even though compatibility `ProjectRef` permits omitted profileId. Never persist generations, commit SHA snapshots, response data, auth, or arbitrary object fields.

Actions: set Git-page selection, set history root, set branch preference, clear invalid pinned branch to follow-active, and clear a removed profile's root/branch preferences. Retain its bulk-selection keys as unavailable so removal cannot widen a request to all projects. Use functional immutable updates and equality no-ops; `partialize` only the fields above. Hydration uses schema-checked `merge` / existing safe-storage conventions; expose hydration readiness so mount effects cannot overwrite saved selections. Ignore malformed/unknown-version entries; do not guess a profile. Storage denial keeps interaction functional in memory, with durable restoration unavailable.

Hydration readiness is transient. If a present selection record is corrupt/unknown-version or invalid selected keys would be dropped, set persisted `selectionRecoveryRequired=true` and block Git bulk operations and automatic first-use seeding until an explicit valid selection/Clear resets it; never turn corrupted nonempty selection into implicit all, including after another preference write/reload. Valid root/branch map entries can hydrate independently.

### Branch identity and follow-active semantics

- Convert a local `Branch` to `refs/heads/${name}`; remote to `refs/remotes/${name}`. Store exact canonical ref, not a commit hash or ambiguous display string.
- View-mode `GitBranchControl` must identify selected options by canonical ref; keep checkout mode's branch-name contract unchanged. Add view-only controlled ref/callback props and migrate Workspace/Git callers; do not leave redundant view props or unused compatibility helpers after migration.
- Resolve pinned canonical ref against successful branch discovery and use its current `lastCommit` for history, preserving current remote-branch history behavior. This updates when fetch advances the ref; stored preferences do not freeze old commits.
- User-confirmed: default/follow-active uses checked-out branch or HEAD when detached/no active branch. Every explicit branch selection pins that canonical ref, including the currently checked-out branch. Checkout changes elsewhere must not change the selected history view. Only explicit `Follow checked-out branch` returns to tracking; restoring either mode never invokes checkout.
- Compare canonical local ref with active local branch, not just display string, before enabling rewrite callbacks.
- No initial unfiltered HEAD request while a saved pinned branch is awaiting discovery; history remains loading/unavailable until scope resolution completes.

### Project selection semantics

- Workspace uses existing selectedProject persistence and existing ProjectSwitcher. No second project selector inside WorkspaceGitPanel.
- Git page selected checkboxes persist as a JSON array of qualified project keys, not a `Set`. `null` seeds once from canonical Workspace project; `[]` remains explicit all and must not be re-seeded on remount.
- Exactly one checkbox selected: set canonical Workspace focus to that qualified project. Multi-select/Clear: leave Workspace focus untouched. Bulk operation selector remains independent.
- Saved nonempty selection with some unavailable projects must never turn into `selectedRefs=undefined` (all projects). Retain selected identities, display unavailable status, disable their unsafe operations. If none are available, show unavailable history/bulk state, not ordinary empty selection.
- Available exactly-one project drives history through `useProjectTarget(selectedRef)`; never `parseProjectKey` fallback to a usable target after authoritative disappearance. Offline errors do not remove preferences or route traffic to ambient/other profile.
- Returning from Workspace to Git preserves an initialized Git checkbox set. Shared Workspace focus supplies only first-use seed; branch/root preferences synchronize across both pages for the same effective target. This avoids bulk selection unexpectedly following navigation.

## 4. Lifecycle matrix

| Event | Persisted state | Transient/history behavior |
|---|---|---|
| Workspace/Git navigation or panel close/reopen | Project, Git set, root and branch retained | Query/page/selection/dialogs reset; restore branch before read |
| Browser reload | Same restoration after hydration | Existing worktree store is memory-only; do not change its persistence in this task. Restores branch for the actual resolved target; reselecting a worktree restores that target's saved branch |
| Switch project/profile/worktree/root | Save preference in old scope; load new scope | Cancel/ignore old debounce and refresh; page 0; close selection and scope-bound dialogs |
| Follow-active + checkout changes | Preference remains follow-active | Resolve new active branch, reset page/search/selection |
| Pinned branch + checkout changes | Preference unchanged if branch exists | Continue viewing pinned branch; update warning/action eligibility |
| Branch discovery loading/failure/offline | No preference write | Loading/error/unavailable; do not treat default `[]` as deletion |
| Fresh successful discovery omits pinned ref | Change that scope to follow-active | Visible notice; resolve current HEAD; reset transient state |
| Selected VCS root gone after successful discovery | Reset root to '.' only if usable primary discovered | Visible fallback notice; resolve primary's separate preference; never send vanished root operations |
| Worktree missing/prunable | Keep existing target-loss rules; preserve branch preference | Fail closed; no stale request retargeting. Explicit root selection is new scope |
| Selected project not available | Retain qualified key and canonical focus | Show unavailable; no conversion to all or another project |
| Profile removed | Clear only that profile's root/branch preferences using existing `deleted` lifecycle notification; retain selected project keys as unavailable | No request to removed profile; no conversion of a nonempty saved selection to all |
| Stable profile ID's endpoint edited | Keep logical profile's selection/branch intent dormant, consistent with existing Workspace identity; do not treat generic `dataChanged` as deletion | Fence old generation; validate against fresh connected target/root/branch discovery before new reads |
| Mutation succeeds / fetch updates refs | Retain branch/root/query intent | Re-resolve current branch tip; refetch active filtered page; clear details if commit removed/no longer matches |
| Storage corrupt/blocked | Discard malformed entries; keep memory usable | Controlled defaults, no render crash or unowned request |

Query success alone with retained cached data is not proof of branch deletion after reconnect. Reconciliation must require a completed current-owner discovery, not default arrays, previous-owner data, or a failed background refetch.

## 5. Shared frontend boundary

Create `hooks/use-git-history-view.ts` for persistence/discovery resolution, 200-row paging, transient debounced input, query options, effective scope identity, selection reconciliation, and guarded refresh. Both pages consume it. Keep mutation hook/dialog ownership in current components; controller exposes effective target/root/branch and action eligibility, not a second mutation subsystem.

Create a small `components/molecules/GitHistoryToolbar.tsx` for accessible search/clear/pagination/refresh/follow-active controls. Reuse existing Button/Input styling and branch control; no feature-directory framework or new UI library. `GitLogTree` accepts filtered-list presentation and distinct no-match state; skip graph computation when filtered. Controllers and presentation remain separable, but do not create a generic persisted-resource abstraction.

## 6. Out of scope

No implementation during this planning task. No automatic checkout, author/hash/diff filters, all-branches or federated Git search, regex mode, exact counts, cursor pagination, indexing, persisted search/page/commit/dialog state, new authentication/telemetry/retry layer, general worktree persistence, or changes to Git rewrite/publication algorithms.

## 7. Evidence and validation status

- Existing `repository.rs:get_log` already shells directly to Git via argument vector and formats `%s`; changing to git2 is unnecessary.
- Read-only Git capability smoke during planning: `git log --fixed-strings --regexp-ignore-case --grep=git --skip=0 --max-count=3 --format=%h:%s` returned three matching Git-feature subjects. This proves installed flag support only, not the new API or UI.
- No builds, application tests, or feature browser scenarios executed during planning. Phase 07 defines required implementation evidence.
- Generic frontend skill mentions MUI/TanStack Router/Suspense conventions absent here; follow repository React/Tailwind/TanStack Query/useQuery patterns instead.

## Unresolved questions

None blocking. Defaults above are explicit design decisions; optional user validation can revise them before implementation.
