# Phase 03: Files, Editor, Search, and Git

**Status:** Implemented frontend contract (2026-09-17)

Phase 03 completes the profile-qualified IDE workbench on top of the unified
shell. Files, editor tabs, search results, replace operations, previews, and Git
mutations all retain the server profile and optional Git worktree that owns the
resource. This prevents identical project names or paths on two servers from
sharing state.

## Target identity

The browser uses a project target reference:

```ts
interface ProjectTargetRef {
  profileId: string;
  project: string;
  worktreePath?: string | null;
}
```

A missing `worktreePath` selects the configured project root. A non-empty path
selects a server-validated registered worktree. `profileId` is a browser
connection owner and is not sent in the server wire target; the owner-bound API
client projects a target to `{ project, worktreePath? }` only after checking that
its profile matches the captured connection.

Each asynchronous request captures `{ profileId, generation }`. A disconnected,
replaced, or reconnected profile makes the captured generation stale. Stale
responses are ignored, mutations do not fall back to another profile, and an
unavailable worktree remains unavailable until discovery proves it usable again.

The target store keeps root and worktree selection separately for every
profile/project scope. Project names, worktree paths, query keys, editor keys,
folder expansion, and invalidation keys must not be built from an unqualified
project name.

## Files and live tree

The selected target is passed to every file operation:

| Surface | Contract |
| --- | --- |
| List/stat/read | REST or owner-bound transport with `project`, optional `worktreePath`, and project-relative path. Range reads accept `offset` and `len`. |
| Write | `fs:write_begin` → chunk frames → `fs:write_commit`; the server checks the expected mtime and returns a conflict instead of overwriting newer content. |
| CRUD | `fs:op` supports `create_file`, `create_dir`, `rename`, `delete`, and `move`; `new_path` is used for rename/move. |
| Watch | `fs:subscribe_tree` returns a subscription ID; `fs:event` applies safe deltas or triggers a target-scoped refetch; cleanup sends `fs:unsubscribe_tree`. |
| Upload | `fs:upload_begin` → acknowledged binary chunks → `fs:upload_commit`, with bounded in-flight chunks and progress reporting. |
| Download | Target-qualified download/ticket requests; an unavailable owner or target produces an explicit error rather than a root/profile fallback. |

The tree cache and persisted folder expansion include profile and target keys.
File events update only the matching target. A create, rename, or move that
cannot be applied safely causes a scoped refetch; it never mutates another
profile's tree.

### Transport-safe watcher lifecycle (Phase 01 follow-up, 2026-09-20)

The live-tree watcher resolves ownership before it resolves transport. For a
qualified target, `useFsSubscription` captures the target profile's current
`ConnectionRef` and obtains that profile's transport; it never falls through
to the ambient transport when the owner is unavailable. Only legacy,
unqualified targets may use the ambient compatibility transport. The hook
observes `useTransportGeneration(profileId)`, so a replacement of the target
profile retires the old watch before binding a new generation.

The transport captured when `fs:subscribe_tree` succeeds remains authoritative
for the whole watch lifecycle. Event binding, lazy `fs:list` child loading,
listener cleanup, and `fs:unsubscribe_tree` all use that same transport. A
transport may expose the typed `onFsEvent` helper or the generic
`onEvent("fs:<sub_id>", ...)` seam; neither path changes the owner. Cleanup
removes the exact cached `{ sub_id, nodes }` payload after unsubscribe, so a
remount cannot bind an already-retired subscription ID and must request a new
watch. Abort after a subscription response also unsubscribes that returned ID
before rejecting.

The defensive `IdleTransport` implements the filesystem capability surface so
setup/offline screens remain callable: event registration and unsubscribe are
safe no-ops, while tree subscription and filesystem mutation reject with
`Error("Server profile required")`. This is a fail-closed compatibility seam,
not a successful empty-tree response or a route to another profile.

`WorkspacePage` contains each desktop IDE, compact IDE, and terminal floating
Explorer in its own target-keyed `ErrorBoundary`, with the existing `Suspense`
fallback inside the boundary. A FileTree render/effect failure therefore
replaces only that Explorer region; the workspace shell, editor, and mounted
terminals remain available. See [Frontend Components](./frontend-components.md)
for the component-level boundary contract.

The connection registry also compares the disconnecting entry's transport
identity with the actual ambient singleton before replacing ambient state.
Disconnecting a non-ambient or failed profile leaves the healthy ambient
transport and generation unchanged; disconnecting the true ambient owner
demotes the compatibility slot to `IdleTransport`. The WebSocket wire
messages and backend subscription protocol remain unchanged.

## Editor and previews

`editor.ts` qualifies file and diff tab keys with profile, project, worktree
scope, path, and diff metadata. Monaco receives an in-memory URI containing the
qualified tab key, so `src/app.ts` on Server A and the same path on Server B are
different models. Persisted tab metadata excludes dirty file bytes.

Editor behavior is intentionally conservative:

- A target-bound read or write captures the owner generation and verifies it
  before committing state.
- Save uses the observed mtime. A conflict remains visible and offers reload or
  force overwrite; it is not silently retried against a different target.
- Watch/Git invalidation reloads clean tabs. A dirty tab keeps local edits and
  becomes `stale`, so remote bytes never overwrite unsaved work.
- A profile endpoint change detaches clean tabs from the old resource. Dirty
  tabs remain visible for recovery but cannot save through the stale owner.
- Large files (at least 5 MiB) use `LargeFileViewer`, which reads 64 KiB ranges
  on demand and is read-only. Normal and degraded text tiers use Monaco; binary,
  image, video, and HTML files use their dedicated preview policy.
- Image and video previews use owner-scoped, short-lived media capabilities;
  they do not place a bearer token in a media URL or materialize the whole file
  as a Blob.

Git mutations invalidate only the affected profile/target caches and reconcile
only tabs belonging to that target. Project root and worktree tabs remain
independent even when their relative paths match.

## Federated search

Search has two explicit scopes in `SearchPanel`:

- **Project target** searches the selected project/worktree through its owning
  connection.
- **All connected profiles** queries eligible connected profiles independently,
  then aggregates content or filename matches. Up to four profile searches run
  concurrently; each profile retains a connected/connecting/offline/login-
  required/unsupported/error status instead of hiding a partial failure.

Every result carries its originating profile and project (and target reference
when available). Result keys and grouping include `profileId`, so equal
`project/path/line/column` matches from two servers do not collide. Aggregation
is deterministic by profile display order, project, path, and position.

The UI enforces a 500-match aggregate cap. A server-side truncation signal or
client cap sets `truncated`, and the panel displays a warning that results may
be incomplete. Filename and content searches share this ownership and cap
behavior. Search requests are debounced and are not enabled for queries shorter
than two characters.

## Search replace

`Replace Next` and `Replace All` resolve the target from the selected match,
including the match's originating profile. Project-scope replacement preserves
the selected worktree when the match belongs to that target; workspace-scope
replacement uses the match's profile/project target.

Before writing, replacement re-reads the target, checks the expected mtime and
exact match position, and refreshes stale results rather than applying an
ambiguous edit. Dirty-tab isolation is target-qualified:

- A dirty tab for the same profile/project/worktree/path blocks replacement for
  that file and preserves local content.
- A dirty tab for another profile or target never blocks or receives the edit.
- `Replace All` snapshots matches, processes files independently, skips dirty
  files, reports replaced/skipped/failed counts, and reloads only clean open
  tabs.

## Git and SSH retry

Fetch and pull accept lists of root/worktree targets and return per-target
results. Normal Push remains fast-forward-only; there is no `force` flag or
unconditional force-push route.

Commit-message editing is local and does not depend on cached `isPushed`. The UI
captures the selected message, branch, and HEAD tip together, then submits that
branch/tip snapshot for a compare-and-swap check. A successful edit rewrites the
local history only; it never publishes automatically. Existing drop, undo,
reset, and revert protections remain independent. Removing affected signatures
requires explicit consent.

Publishing rewritten history is a separate, user-confirmed action shared by
the Workspace Git panel, Git page, and Project Info Git section. A fresh
preview resolves the configured upstream and displays the destination and
expected remote/local OIDs. Missing or ambiguous destinations are blocked.
Confirmation publishes the captured branch to that one destination only if
the expected remote OID still matches. Stale state requires a new preview; an
unknown outcome is not retried blindly.

### Server-side history search

`GET /api/git/{project}/log` accepts optional `messageQuery`. It matches
ASCII-case-insensitive literal text against the full commit subject/body before
pagination, while the existing response and subject-only `message` field stay
unchanged. Whitespace-only input disables filtering. Embedded CR/LF and NUL are
rejected; leading/trailing CR/LF is trimmed first, so a CR/LF-only query
currently disables filtering. The [Phase 01 risk note](../plans/261001-2003-git-history-search-persistence/phase-01-server-message-search.md#risk-assessment) tracks this contract gap.

The server and Phase 02 client contracts are documented in the [Git history
search architecture guide](./architecture/git-history-search.md). Phase 03 adds
the persisted selection store described below. Phase 04 adds the shared
`useGitHistoryView` controller and `GitHistoryToolbar`, canonical-ref,
no-checkout `GitBranchControl` view mode, and graph/list `GitLogTree`.
Workspace/Git-page integration remains in Phases 05–06; qualification is Phase 07.

### Persisted Git history selection (Phase 03; 2026-10-01)

`useGitHistoryStore` keeps Git-page checkbox state separate from Workspace
focus: `null` is uninitialized, `[]` is explicit all, and nonempty qualified
project keys remain selected even while unavailable. Recovery state prevents
corrupt/unknown-version preferences from silently becoming bulk-all.

Root choice is scoped by profile/project/worktree. Branch preference is scoped
by that target and VCS root: absent means follow the currently checked-out
branch, while every explicit choice pins a canonical `refs/heads/...` or
`refs/remotes/...` identity independent of checkout. Local and remote branches
with the same display name remain distinct; a missing pin does not fall back.
The store does not checkout branches or persist commit tips.

See [Git history search and selection persistence](./architecture/git-history-search.md)
for validation, hydration, denied-storage, and profile-deletion details.

Git operations stay bound to the selected profile, project/worktree, and VCS
root. Changing the target or root clears a pending lease preview; unavailable
targets do not fall through to another profile or the project root. For fetch,
pull, and normal Push, the shared SSH passphrase flow retains successful target
results and retries only targets that failed authentication after owner
validation. Leased publication retries only a known pre-write authentication
failure and reuses the approved snapshot.


## Source map and verification

| Contract | Primary implementation |
| --- | --- |
| Target identity and wire projection | `packages/ui/src/api/ownership.ts`, `api/client.ts` |
| Connection owner/generation | `packages/ui/src/api/connections.ts` |
| Target selection and unavailable state | `packages/ui/src/stores/project-target.ts` |
| Scoped editor state | `packages/ui/src/stores/editor.ts` |
| Scoped explorer state and watcher | `packages/ui/src/stores/explorer-tree.ts`, `hooks/use-fs-subscription.ts` |
| CRUD/upload | `hooks/use-fs-ops.ts`, `hooks/use-fs-upload.ts`, `api/ws-transport.ts` |
| Search and replace | `hooks/use-file-search.ts`, `hooks/use-search-panel-replace.ts`, `lib/search-replace-next.ts` |
| Git history search and selection persistence | `server/src/api/git.rs`, `server/src/git/repository.rs`, `packages/ui/src/api/client.ts`, `api/ws-transport.ts`, `api/queries.ts`, `packages/ui/src/stores/git-history.ts`, `packages/ui/src/lib/git-branch-ref.ts` | Full-message filtering and owner/generation-qualified query identity share the existing REST route. Versioned UI preferences keep Git-page selection, target roots, and root-scoped branch intent isolated by profile; canonical refs distinguish local from remote names. |
| Shared history view (Phase 04) | `packages/ui/src/hooks/use-git-history-view.ts`, `packages/ui/src/components/molecules/GitHistoryToolbar.tsx`, `packages/ui/src/components/organisms/GitBranchControl.tsx`, `packages/ui/src/components/organisms/GitLogTree.tsx` | Shared history scope/search/paging/refresh, canonical-ref view mode, and graph/list presentation. |
| Git edit and leased publication | `hooks/use-git-with-ssh-retry.ts`, `hooks/use-leased-git-push.ts`, `api/queries.ts`, `server/src/git/commit_message_rewrite.rs`, `server/src/git/leased_push.rs`, `server/src/api/git.rs` |
| Focused regressions | `packages/ui/src/stores/git-history.test.ts`, `server/src/git/tests.rs`, `server/src/api/tests.rs`, `packages/ui/src/api/ws-transport.test.ts`, `api/queries.test.ts`, `hooks/use-leased-git-push.test.tsx`, Git panel/dialog tests |

Related contracts: [API Reference](./api-reference.md), [System Architecture](./system-architecture.md), [Code Standards](./code-standards.md), and [Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md).
