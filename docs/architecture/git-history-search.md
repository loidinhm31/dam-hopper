# Git History Search: Transport, Query Ownership, and Selection Persistence

**Status:** Phases 01–04 implement server-side message filtering, shared client transport/query ownership, persisted history selections, and the shared view controller/presentation. Workspace/Git-page integration and end-to-end qualification remain in Phases 05–07. This guide covers the API, query, persistence, and shared UI contracts, not completed page integration.

## REST API contract

`GET /api/git/{project}/log` uses the existing authenticated Git route. Optional query parameters are:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | `100` | Page size. |
| `offset` | `0` | Number of history entries to skip; with `messageQuery`, skips matching entries. |
| `ref` | `HEAD` | History starting revision. |
| `worktreePath` | — | Registered worktree target. |
| `root` | — | VCS root ID. |
| `messageQuery` | — | Commit-message filter. |

Missing or whitespace-only `messageQuery` leaves history unfiltered. Otherwise,
the server passes the term as one fixed-string Git argument, not interpolated
into a shell command, and matches literal, ASCII-case-insensitive text against
the full commit message (subject and body) before pagination. Unicode
normalization is not implied. Embedded CR/LF and NUL in the trimmed nonempty
term return HTTP `400`; the current trim-before-validation order strips
leading/trailing CR/LF first, so a CR/LF-only value becomes an unfiltered
request. This known edge is tracked in the Phase 01 risk record.

The response remains `GitLogEntry[]` with `hash`, `parents`, `authorName`, `authorEmail`, `timestamp`, `message`, `refs`, and `isPushed`. `message` is subject-only, even when a body-only match selects the commit.

## Shared client transport

`ApiClient.git.log` and its implementation accept an optional final `messageQuery?: string | null` argument after `root`. The owner-bound client projects a qualified project target to the server target (`project` and optional `worktreePath`); browser-only `profileId` is not sent to the route.

The existing `git:log` transport channel maps to this REST endpoint in `WsTransport`; it is not a new WebSocket history event. The mapper builds query parameters with URLSearchParams, including `messageQuery` only when it is a nonempty trimmed string. Project path encoding, worktree, root, revision, and pagination continue through this same mapping. Shared browser/native clients use this API and transport path; Phase 02 adds no separate native command.

## Owner-scoped query contract

`normalizeGitMessageQuery()` trims surrounding whitespace and maps `null`, `undefined`, or an empty result to `undefined`; it does not case-fold the term. `gitLogQueryOptions(target, limit?, offset?, ref?, root?, messageQuery?)` is the single builder used by `useGitLog` and available to refresh consumers. It passes the normalized term to the bound client and includes the same value in the query key.

For a profile-qualified target, the log query key contains the resolved owner (`profileId` and connection `generation`), project/worktree target, VCS root, limit, offset, revision, and normalized term. Different terms, including case variants, remain distinct cache entries. The default root key is `.`. Use a qualified target for owner-scoped history reads; legacy unqualified callers retain their existing ambient path and must not be used as an owner fallback.

The query's existing `enabled` guard is based on the normalized project name. A caller that has not resolved its target can keep the `profileId` on a qualified empty-project target so the query stays disabled without switching owners. Once the target is ready, it passes the real target. Do not replace this with an unqualified empty-project fallback.

`gitHistoryQueryPrefixes(target, root?)` provides owner/target/root-qualified branch, status, log, and commit-detail prefixes. Its log prefix intentionally omits page, revision, and term so refresh and mutation invalidation can cover all log variants under that root without copying key construction into callers. `invalidateGitHistoryDetails()` uses the same detail prefixes.

## Persisted project, root, and history-branch selections

`useGitHistoryStore` persists schema version 1 under `dam-hopper:git-history-state`. Its persisted fields are limited to `gitPageSelection`, `rootByTarget`, `branchByScope`, and `selectionRecoveryRequired`; hydration readiness is transient.

`gitPageSelection` belongs to the Git page, not Workspace focus: `null` means not initialized, `[]` means explicitly all projects, and a nonempty sorted/deduplicated array contains qualified project keys. Missing projects and deleted-profile keys are retained as unavailable selections; discovery or profile deletion must not turn a nonempty selection into explicit all. Corrupt/unknown-version selection sets `selectionRecoveryRequired`; consumers must use this signal to prevent bulk-all behavior or automatic first-use seeding until the user recovers the selection.

`rootByTarget` uses the qualified `projectTargetKey` tuple `[profileId, project, worktreePath|null]`. Root `.` is the default and is represented by absence. `branchByScope` uses `[profileId, project, worktreePath|null, rootId]`; its absent entry means `follow-active`. A pinned value stores a canonical branch ref, not a commit SHA, so later branch-tip changes are resolved from current branch discovery.

`toBranchCanonicalRef()` derives identity from both `Branch.name` and `isRemote`: local `origin/main` becomes `refs/heads/origin/main`, while remote `origin/main` becomes `refs/remotes/origin/main`. Canonical local/remote prefixes are preserved. Every explicit branch choice is pinned even when it matches the checked-out branch; only follow-active tracks the current branch. `resolveHistoryBranch()` matches pinned refs exactly and reports a missing pin without silently falling back.

Hydration validates persisted shapes, qualified tuple keys, selection keys, preference discriminants, and canonical refs. Malformed root/branch records are dropped individually; invalid or unknown-version selection remains in recovery rather than becoming all-projects. Corrupt JSON also requires recovery. If browser storage is unavailable or denies reads/writes, the store remains usable in memory and hydration readiness settles. A `deleted` profile notification clears only that profile's root/branch records while preserving Git-page selection tombstones. Workspace focus and worktree availability remain owned by their existing stores.

## Shared history controller and presentation (Phase 04)

`useGitHistoryView(target, options?)` accepts a `ProjectTargetRef` and optional
availability gate. It combines persisted root/branch preferences with root and
branch discovery, owner-scoped log queries, search, 200-entry paging,
selection, availability, and guarded refresh. Its effective scope includes
profile, project/worktree, VCS root, branch preference, and connection
generation; scope changes reset transient search, page, and selection state.
History queries wait for preference hydration, and missing persisted roots or
pins are reconciled only after successful completed discovery.

The controller keeps search draft separate from the normalized applied query.
Typing applies after 300 ms; IME composition defers the debounce, while clear
and Escape clear immediately. Query changes reset the page and selected
commit. Refresh invalidates the owner/root-qualified branch, status, log, and
detail queries, resolves the refreshed branch before fetching the current page,
and ignores stale-scope results for selection and notice updates.

`GitHistoryToolbar` is a controlled presentation component for search,
clear/Escape, paging and displayed-range counts, refresh, follow-active, and
dismissible notices; it does not own store or API access. `GitBranchControl`
defaults to `mode="checkout"`. In `mode="view"`, `selectedBranchRef` and
`onSelectedBranchRefChange` use canonical `refs/heads/...` and
`refs/remotes/...` values, keeping local/remote name collisions distinct;
selecting a history ref does not check out a branch.

`GitLogTree` defaults to `presentation="graph"`. Its `presentation="list"`
mode skips ancestry lane construction and graph SVGs while preserving the
same commit rows, selection, keyboard interaction, and context-menu actions.
`emptyMessage` allows a surface to supply its empty-state text.

The shared UI components live in the
[frontend component architecture](../frontend-components.md); page-level
adoption and qualification remain later plan phases.
The persisted-store contract is recorded in [Phase 03](../../plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md); shared-controller and view contracts are in [Phase 04](../../plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md).

## Source map

- `packages/ui/src/api/client.ts` — optional message-query argument, bound transport invocation, and wire-target projection.
- `packages/ui/src/api/ws-transport.ts` — `git:log` to REST/URLSearchParams mapping.
- `packages/ui/src/api/queries.ts` — query normalization, shared options, owner/root prefixes, and `useGitLog` delegation.
- `packages/ui/src/stores/git-history.ts` — versioned, validated persisted selection/root/branch preferences and hydration lifecycle.
- `packages/ui/src/lib/git-branch-ref.ts` — branch ref identity, validation, and pinned/follow-active resolution.
- `packages/ui/src/hooks/use-git-history-view.ts` — shared history scope, discovery, query, paging, selection, and refresh controller.
- `packages/ui/src/components/molecules/GitHistoryToolbar.tsx` — controlled history search, paging, refresh, and follow-active toolbar.
- `packages/ui/src/components/organisms/GitBranchControl.tsx` — checkout versus canonical-ref view mode.
- `packages/ui/src/components/organisms/GitLogTree.tsx` — graph/list commit presentation.
- Focused UI regressions: `packages/ui/src/stores/git-history.test.ts`, `packages/ui/src/api/ws-transport.test.ts`, `packages/ui/src/api/queries.test.ts`, and `packages/ui/src/api/ownership.test.ts`.
- Server route/filter: `server/src/api/git.rs` and the Git repository log implementation.

See the [API Reference: Commit history](../api-reference.md#commit-history), [Git history search standards](../code-standards.md#git-history-search-queries), and the Phase 03 plan at `plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md`.
