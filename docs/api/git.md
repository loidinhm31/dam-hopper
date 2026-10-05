# Git API

Git route and history-safety contracts moved from the [API reference index](../api-reference.md).
## Git API

Git routes are scoped to the configured project name and run inside the resolved
project path.

When a project is not a Git repository, Git routes that require repository
state return HTTP `409` with the standard error body
`{"error":"Git is not initialized for this project","code":"GIT_NOT_INITIALIZED"}`.
The client preserves this as `ApiRequestError(status, code)` and uses the code
to render an actionable unavailable state; callers should not treat it as an
empty branch list.

### Project worktree targets (Phases 1–7)

Root-sensitive operations use a project target reference:

```json
{ "project": "demo", "worktreePath": "/worktrees/demo-feature" }
```

`worktreePath` may be omitted or `null`; both select the configured project
root for backward-compatible behavior. An explicit path must be absolute and
must resolve to a worktree currently registered by Git for that project. The
server canonicalizes and validates membership against a fresh Git snapshot;
an arbitrary path, a path from another repository, or a removed/recreated
directory is not authorized. The configured root is also validated when sent
explicitly.

For a project nested below the repository root, each worktree target projects
the same relative subdirectory into that worktree. Discovery and resolution
use these fields (serialized in camelCase):

| Field                                                      | Meaning                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `path`                                                     | Selectable project-directory target.                                                            |
| `repositoryPath`                                           | Git worktree root used for worktree mutations.                                                  |
| `branch`, `commitHash`                                     | Worktree revision metadata.                                                                     |
| `isMain`, `isLocked`, `isDetached`, `isBare`, `isPrunable` | Git worktree state.                                                                             |
| `isAvailable`                                              | Whether the projected target directory is a usable directory beneath a live, non-bare worktree. |

Resolved targets additionally expose `configuredRoot`, `targetPath`,
`targetKey`, `isRoot`, and `available`; a root target has `isRoot: true` and
no `worktree` metadata. Discovery results are returned by the worktree list
route as the projected worktree objects above.

Target validation errors use stable codes and statuses:

| Code                            | HTTP | Meaning                                                    |
| ------------------------------- | ---: | ---------------------------------------------------------- |
| `WORKSPACE_PROJECT_NOT_FOUND`   |  404 | Project is not registered.                                 |
| `WORKSPACE_TARGET_UNREGISTERED` |  400 | Explicit path is not a registered Git worktree.            |
| `WORKSPACE_TARGET_INVALID_PATH` |  400 | Path is empty, contains a NUL, or is not absolute.         |
| `WORKSPACE_TARGET_UNAVAILABLE`  |  409 | Registered worktree or projected directory is unavailable. |

**POST /api/git/fetch** and **POST /api/git/pull** accept a project list or
explicit target list. Each explicit target is resolved independently so one
missing or unavailable worktree does not discard results for the other targets.
The response is an array of operation results; target-scoped entries include
`worktreePath`, and a failed entry can include `targetUnavailable: true` when
the server confirmed that target disappeared. Generic request-level failures
are not attributed to every requested target.

### Profile-owned file and search requests (Phase 03)

The browser selects a profile-owned `ProjectTargetRef` before calling a
target-bound route. `profileId` identifies the owner connection and is checked
client-side; it is intentionally omitted from server wire bodies. The server
receives the project and optional `worktreePath` and validates the target against
its current project/worktree registry.

The same target qualification applies to IDE filesystem APIs. In addition to
the REST list/read/stat/language-file routes, the WebSocket transport uses
`fs:subscribe_tree`, `fs:unsubscribe_tree`, `fs:read`, `fs:write_begin`,
`fs:write_chunk_binary`, `fs:write_commit`, `fs:op`, and the
`fs:upload_begin`/`fs:upload_chunk`/`fs:upload_commit` sequence. Server
`fs:event` notifications are scoped to the subscription that created them.
The browser captures the profile connection generation and discards stale
responses; it never retries a failed target through another profile or root.

Content search is `GET /api/fs/search?q=...` and filename search is
`GET /api/fs/search-paths?q=...`. Both accept optional `project`,
`worktreePath`, `case`, `max`, and `scope=workspace`. The client adds the
originating profile/project/target metadata before combining results. The
workspace UI limits the aggregate to 500 matches and surfaces either server
truncation or the aggregate cap as a warning.

See [Phase 03: Files, Editor, Search, and Git](../phase-03-files-editor-search-git.md)
for the browser ownership, editor, replace, preview, and invalidation
contract.

### Worktrees

**GET /api/git/{project}/worktrees**
Refresh and return projected worktree metadata. For nested projects,
`path` points at the matching subdirectory while `repositoryPath` remains the
worktree root. A plain non-Git project returns `409` with
`GIT_NOT_INITIALIZED`.

**POST /api/git/{project}/worktrees**
Add a worktree from the configured project repository. Body fields are
`branch` (required), optional `path`, optional `createBranch`, and optional
`baseBranch`:

```json
{
  "branch": "feature/demo",
  "path": "../demo-feature",
  "createBranch": true,
  "baseBranch": "main"
}
```

The response is the projected worktree metadata, including both `path` and
`repositoryPath`; discovery is refreshed after the mutation.

**DELETE /api/git/{project}/worktrees**
Remove one registered non-main worktree. Body: `{ "path": "<target path>" }`.
The path is resolved through the target contract, but Git removal operates on
the corresponding `repositoryPath`. The configured/main worktree cannot be
removed. Successful response: `{ "ok": true }`.

The browser re-fetches discovery immediately before this request. It refuses
to start removal when the exact target owns dirty editor tabs or live terminal
sessions, and explains the blockers in the Project panel. Git still enforces
its own dirty/untracked protection; the user must refresh and retry after
closing or saving those resources. A successful removal invalidates discovery
and falls back new operations to the configured root when the removed target
was selected.

If Git reports a registered path as missing or prunable, the row remains
visible as unavailable. New operations fail closed rather than redirecting to
the root, while the UI selects the root for subsequent operations and keeps
existing editor tabs. Live terminal rows whose `project`/`cwd` still identify
the unavailable target are labelled `orphaned` until the session is closed.
The immutable `worktreePath` marker is authoritative for target-scoped
sessions; `project`/`cwd` containment is used only for legacy sessions without
that marker.

**POST /api/git/{project}/worktrees/prune**
Prune stale Git worktree administrative metadata and invalidate the project’s
cached discovery. Body: `{}`. Successful response: `{ "ok": true }`.

### Branches

**GET /api/git/{project}/branches**
Returns local and remote branches.

Optional query: `root=ID` to scope branch data to one VCS root.

If Git is unavailable, this endpoint returns the `GIT_NOT_INITIALIZED` 409
error described above.

```json
[
  {
    "name": "main",
    "isCurrent": true,
    "isRemote": false,
    "trackingBranch": "origin/main",
    "ahead": 0,
    "behind": 0,
    "lastCommit": "abc123..."
  }
]
```

**GET /api/git/{project}/roots**
Discover VCS roots inside the project. Returns the primary repo root, nested repositories, and submodule gitlinks.

An unavailable project returns the same `GIT_NOT_INITIALIZED` 409 response;
usable nested roots are returned as concrete `rootId` values and can be passed
to branch and diff requests.

Response shape:

```json
[
  {
    "rootId": ".",
    "path": ".",
    "absolutePath": "/abs/path/to/project",
    "kind": "primary",
    "status": { "...": "GitStatus" },
    "warnings": []
  },
  {
    "rootId": "modules/child",
    "path": "modules/child",
    "absolutePath": "/abs/path/to/project/modules/child",
    "kind": "submodule",
    "mappingState": "mapped",
    "gitlink": {
      "path": "modules/child",
      "objectId": "abc123...",
      "moduleName": "child",
      "url": "../child.git"
    },
    "status": { "...": "GitStatus" },
    "warnings": []
  }
]
```

Fields:

- `kind` is `primary`, `submodule`, or `nestedRepo`.
- `mappingState` is only present for submodules and can be `mapped`, `unmapped`, `missing`, or `uninitialized`.
- `gitlink` is only present for submodules.
- `warnings` may include invalid `.gitmodules` or missing/uninitialized gitlink notes.
- `status` reflects the root's own Git status snapshot.

### Commit history

**GET /api/git/{project}/log**

Returns `GitLogEntry[]` commit history for the specified project. Supports optional full-message commit filtering and pagination before offset:

Query parameters:

- `limit` (optional integer, default `100`): Maximum commits to return per page.
- `offset` (optional integer, default `0`): Commits to skip; with `messageQuery`, skips matching commits.
- `ref` (optional string, default `HEAD`): Branch name or canonical ref to traverse.
- `worktreePath` (optional string): Target registered worktree path.
- `root` (optional string): VCS root path for submodule or nested repository.
- `messageQuery` (optional string): Case-insensitive literal string to match against full commit messages (subject and body). Applies before offset and limit pagination. Embedded CR, LF, and NUL in a trimmed term reject with HTTP `400 Bad Request`.

Response format:

```json
[
  {
    "hash": "06e52d719f2bdf7fb96891b8c09d7f7a4a816cba",
    "parents": ["78be05fd4e2291fb9eb0b5f9e1cf560bc8e14f7d"],
    "authorName": "Author Name",
    "authorEmail": "author@example.com",
    "timestamp": 1790000000,
    "message": "Commit subject line",
    "refs": ["HEAD -> main"],
    "isPushed": true
  }
]
```

Note: `message` remains subject-only text even when a commit was matched on body content. Full details and query ownership rules are in the [Git history search architecture guide](../architecture/git-history-search.md).
**POST /api/git/{project}/branches**

Create a branch. Set `checkout` to switch to it after creation.

```json
{
  "name": "feature/git-flow",
  "startPoint": "main",
  "checkout": true,
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/checkout**
Checkout an existing branch, or create one when `create` is true. `strategy` is
`normal`, `stash`, or `force`.

```json
{
  "branch": "feature/git-flow",
  "startPoint": "origin/main",
  "create": false,
  "strategy": "normal",
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/update**
Update a branch from its tracking branch.

```json
{ "branch": "main", "root": "modules/child" }
```

### History Actions

**POST /api/git/{project}/cherry-pick**
Apply a commit to the current branch.

```json
{ "hash": "abc123def456" }
```

**POST /api/git/{project}/reset**
Reset to a commit. `mode` is `soft`, `mixed`, `hard`, or `keep`.

```json
{ "hash": "abc123def456", "mode": "mixed" }
```

**POST /api/git/{project}/commit/{hash}/drop**
Drop a local, unpushed commit from the current branch history. `HEAD` drops use
`git reset --hard <parent>` after preflight checks. Non-HEAD drops use
`git rebase --onto <parent> <hash> <branch>`. Pushed/shared commits are blocked
by default and should use revert. The server refuses to start a rewrite while
a merge, rebase, or cherry-pick is already in progress and returns `recovery`
metadata for the active operation.

**GET /api/git/{project}/commit/{hash}/message**
Read the complete UTF-8 message for a commit reachable from the target branch.
Optional query fields:
- `branch` (optional string): Target local branch reference (e.g. `refs/heads/feature`). When specified, enables reading commit messages from inactive branches or while `HEAD` is detached. The reference must be a valid local branch under `refs/heads/`; invalid ref syntax or non-branch targets return HTTP `400 Bad Request`. When omitted, defaults to the currently checked-out branch at `HEAD` (and requires an attached local branch).
- `worktreePath` (optional string): Registered worktree path to resolve.
- `root` (optional string): Target VCS root for nested repository or submodule.

The target commit must be reachable from the target branch tip. The response returns the full symbolic branch and exact tip OID; keep both values together as the snapshot for a subsequent edit or squash:

```json
{
  "message": "Subject\n\nDetailed body\n",
  "branch": "refs/heads/main",
  "headOid": "full-branch-tip-oid"
}
```

Message reads use a lock-free branch/tip snapshot and recheck refs before returning; concurrent full-message reads do not contend for Git write locks. Targets with invalid UTF-8 message bytes or a non-UTF-8 `encoding` header are rejected rather than returned with lossy replacement characters.

**POST /api/git/{project}/commit/{hash}/message**
Rewrite the target's message on the specified local branch. `hash` is the
original target commit OID. The body requires `message`, `expectedBranch`, and
`expectedHeadOid` copied from the same GET snapshot; optional `root` and
`worktreePath` select the target. `allowSignatureRemoval` defaults to `false`.

```json
{
  "message": "New subject\n\nNew body",
  "expectedBranch": "refs/heads/main",
  "expectedHeadOid": "full-branch-tip-oid",
  "allowSignatureRemoval": false,
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

The message must not be whitespace-only. The server appends one LF only when
the submitted UTF-8 message lacks a terminal LF. A changed branch or tip
snapshot returns `ok: false` with `blockedReason: "stale-ref"` before target
lookup. The target must be reachable from the captured tip, but may be `HEAD`,
a root, an older commit, a merge-side ancestor, or a commit already present on
a remote.

The endpoint supports rewriting both active and inactive local branches:
- **Inactive branch**: When `expectedBranch` is not currently checked out, `HEAD` may point to a different branch or be detached. The active checkout, index, and working tree files (staged, unstaged, untracked) remain completely untouched and preserved. The operation locks only the target branch ref under a transaction, verifying that `HEAD` does not transition to point to the target branch.
- **Active branch**: When `expectedBranch` is the active branch, `HEAD` must point to it. The operation locks `HEAD` followed by the branch ref.
- **Worktree guard**: If `expectedBranch` is checked out in *another* linked worktree, the rewrite is blocked with `blockedReason: "checked-out-branch"`.
- **Active operations**: Active Git operations (rebase, merge, cherry-pick, revert, bisect) block the rewrite with `blockedReason: "active-operation"`.

The rewrite uses raw commit objects: it preserves trees, ordered parent
topology, author/committer metadata, unrelated headers, and unchanged descendant
messages while rebuilding the target and affected descendants. Before publication,
the server verifies that the rewritten tip commit tree exactly matches the
captured tip tree. It changes no worktree files or index entries and does not
push or update a remote ref. A later push is a separate operation.

If rewriting would invalidate commit signatures or a merge tag, the request is
blocked with `signature-consent-required` unless
`allowSignatureRemoval: true` explicitly consents to removing the invalidated
headers. Unsupported history or malformed commit metadata fails closed. Exact
message no-ops create no replacement objects and do not update the branch.

On success, the `GitActionResult` includes `hash` (the new target OID),
`branch` (the full ref), `oldTargetOid`, `newTargetOid`, `oldHeadOid`,
`newHeadOid`, `rewrittenCount`, `noOp`, and `signaturesRemoved`. For a no-op,
the old/new OID pairs match, `rewrittenCount` is zero, and `signaturesRemoved`
is false.
These fields are also used by squash results below and are omitted from unrelated
Git actions. Successful object-only rewrites do not set `dirty`, `conflict`, or
rebase-recovery fields.
**POST /api/git/{project}/squash**
Collapse at least two parent-contiguous commits on an active or inactive local branch
into one commit. Send unique, full 40-hex OIDs in exact **oldest-first** order;
abbreviated IDs, gaps, reversed ranges, and duplicates are not accepted.

```json
{
  "hashes": ["full-oldest-selected-oid", "full-newest-selected-oid"],
  "message": "Combined subject\n\nEdited complete message bodies\n",
  "expectedBranch": "refs/heads/main",
  "expectedHeadOid": "full-branch-tip-oid",
  "allowSignatureRemoval": false,
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

The branch and tip must come from agreeing fresh full-message GET snapshots.
Message normalization, active/inactive branch handling, worktree occupancy guards,
and compare-and-swap ref locking follow the same rules as commit-message editing:
- Squashing an inactive branch leaves the active branch checkout, index, staged/unstaged changes, and untracked files completely unaffected.
- If `expectedBranch` is checked out in another linked worktree, the request blocks with `checked-out-branch`.
- A stale snapshot or concurrent branch switch blocks before writing objects.
- Every selected commit must be reachable from the captured tip. Selected commits and rewritten descendants must have at most one parent; a merge in either blocks the operation. The oldest selected commit may be a root.

The synthesized commit takes the newest selected tree, oldest selected predecessor
and author, and current configured repository committer. Linear descendants retain
their trees, messages, and metadata while their parent IDs are remapped. The final
tip tree must match the captured branch tip tree. Staged/unstaged/untracked files
and remote refs remain unchanged. Already-pushed commits are allowed: squash is local
only. Publishing requires a separate user-confirmed `/push/prepare` and `/push/publish`
exact-OID lease.

Invalidated signatures in absorbed commits and rewritten descendants require
explicit `allowSignatureRemoval: true`. Successful results reuse `GitActionResult`:
`oldTargetOid` is the newest selected OID, `newTargetOid` and `hash` are the
synthesized squash OID, `oldHeadOid`/`newHeadOid` are branch tips, and
`rewrittenCount` counts **one squash object plus rewritten descendants**, not
removed commits. `noOp` is false; `signaturesRemoved` reports consented removal.
Known blocks return `ok: false` with `blockedReason` and recommendations.
`publication-uncertain` means local ref publication is unresolved: candidate OIDs
are not a success receipt. Refresh and reconcile before any further mutation;
neither a blind squash retry nor automatic push is safe.
**POST /api/git/{project}/commit/{hash}/drop-files**
Drop selected file changes from an unpushed commit while preserving other files
from that commit. This is a local-history rewrite and is blocked for pushed
commits by default.

```json
{ "paths": ["src/main.rs"] }
```

**POST /api/git/{project}/commit/{hash}/revert**
Create a new inverse commit with `git revert <hash>`. This is the default safe
operation for pushed or shared history because it preserves existing commits.

**POST /api/git/{project}/commit/{hash}/revert-files**
Apply the inverse patch for selected files to the working tree without rewriting
history. The resulting file changes are left in the worktree for review and
commit.

```json
{ "paths": ["src/main.rs"] }
```

Branch create, branch checkout, cherry-pick, reset, drop, revert, and
commit-message edit return `GitActionResult`:

```json
{
  "ok": true,
  "message": "Checked out feature/git-flow",
  "branch": "feature/git-flow",
  "hash": "abc123def456",
  "stashed": false,
  "conflict": false,
  "dirty": false,
  "destructive": false,
  "recovery": null,
  "blockedReason": null,
  "recommendation": null
}
```

Result flags:

| Field               | Meaning                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                | `true` when the Git action completed; `false` for a blocked or recoverable outcome.                                                                                                                                    |
| `message`           | Human-readable operation summary or recovery hint.                                                                                                                                                                     |
| `branch`            | Branch affected by branch create/checkout; full local ref on message-edit and squash results.                                                                                                                          |
| `hash`              | Commit affected by cherry-pick/reset; rewritten target or synthesized squash OID on successful object-only rewrites.                                                                                                   |
| `stashed`           | Checkout used `strategy: "stash"` and created a stash before switching branches.                                                                                                                                       |
| `conflict`          | Cherry-pick or reset reached a Git conflict state.                                                                                                                                                                     |
| `dirty`             | The operation was blocked by local working tree changes.                                                                                                                                                               |
| `destructive`       | The selected mode can discard local state, such as force checkout or hard reset.                                                                                                                                       |
| `recovery`          | Active operation metadata when recovery commands are available.                                                                                                                                                        |
| `blockedReason`     | Machine-readable reason; includes operation-specific guards and message-edit reasons such as `stale-ref`, `unsupported-history`, `invalid-commit-metadata`, `signature-consent-required`, and `publication-uncertain`. |
| `recommendation`    | User-facing next action for blocked or recoverable operations.                                                                                                                                                         |
| `oldTargetOid`      | Original target OID for message editing; newest selected OID for squash.                                                                                                                                               |
| `newTargetOid`      | Rewritten target or synthesized squash OID; also returned as `hash` on success.                                                                                                                                        |
| `oldHeadOid`        | Captured branch-tip OID before an object-only rewrite.                                                                                                                                                                 |
| `newHeadOid`        | Branch-tip OID after a successful object-only rewrite; unchanged for a message-edit no-op.                                                                                                                             |
| `rewrittenCount`    | Replacement objects written: target plus descendants for an edit; one squash plus descendants for squash; zero for a no-op.                                                                                            |
| `noOp`              | Whether the normalized message matched the raw target message and no object/ref update was made.                                                                                                                       |
| `signaturesRemoved` | Whether invalidated signature or merge-tag headers were removed after explicit consent.                                                                                                                                |

Recoverable dirty checkout example:

```json
{
  "ok": false,
  "message": "Working tree has local changes",
  "branch": "feature/git-flow",
  "stashed": false,
  "conflict": false,
  "dirty": true,
  "destructive": false
}
```

Blocked pushed-history drop example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

Recoverable rebase conflict example:

```json
{
  "ok": false,
  "message": "CONFLICT (content): Merge conflict in README.md",
  "hash": "abc123def456",
  "conflict": true,
  "dirty": true,
  "destructive": true,
  "recovery": {
    "operation": "rebase",
    "canAbort": true,
    "canContinue": true
  },
  "recommendation": "resolve rebase conflicts, then continue or abort"
}
```

Branch update returns `BranchUpdateResult`:

```json
{
  "branch": "feature/git-flow",
  "success": true,
  "reason": null
}
```

Checked-out branch update guard example:

```json
{
  "branch": "main",
  "success": false,
  "reason": "checked-out — use pull instead"
}
```

Invalid branch names, relative paths, and malformed commit hashes are rejected
before Git execution. Rewrite policy is operation-specific: destructive
history-removal actions keep their dirty-worktree, reachability, and
pushed/shared-history guards; commit-message edits and squash use the snapshot,
reachability, active-operation, and operation-specific history checks above.
Blocked Git actions return `GitActionResult`; request validation failures use
the standard API error shape with a 400 status:

```json
{ "error": "Invalid input: invalid branch name" }
```

### Git History Safety Contract

Git actions apply operation-specific history rules. `drop`, `drop-files`, and
`undo-last-commit` retain their existing pushed/shared-history protections.
Commit-message edits and squash can include commits already pushed elsewhere,
but update only the selected local branch; neither publishes automatically.
A later push is separate and may be rejected by remote policy.

| Operation          | History effect        | Shared-history behavior                                  |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `revert`           | Adds inverse commit   | Allowed and recommended                                  |
| `revert-files`     | Worktree inverse      | Allowed; selected changes stay uncommitted for review    |
| `drop`             | Rewrites branch       | Blocked for pushed/shared commits; use revert instead    |
| `drop-files`       | Rewrites branch       | Blocked for pushed/shared commits; use revert instead    |
| `message`          | Rewrites target local branch | Allowed for reachable commits; active or inactive branch; remote unchanged |
| `squash`           | Rewrites target local branch | Allowed for a linear contiguous range; active or inactive branch; remote unchanged |

| `undo-last-commit` | Rewrites local HEAD   | Blocked for pushed/shared commits; use revert instead    |
| `reset --hard`     | Rewrites local state  | Allowed only after explicit request and preflight checks |

Manual verification checklist for browser integrations:

- Modify an open file and discard it from the Git panel; the browser must not
  reload, and the affected editor tab should reconcile with disk.
- Drop a selected file change from an old local commit; branch history and the
  affected file diff should refresh without a full app reset.
- Drop a local non-HEAD commit with descendants; descendants should replay or
  produce a recoverable rebase state.
- Revert a pushed commit in a clone/remote test repo; the UI should route users
  to revert instead of enabling drop.
- Start a conflicting rebase or cherry-pick, then attempt a rewrite; the API
  should return `blockedReason: "active-operation"` and recovery metadata.
- Verify the recovery banner copy in the UI by triggering an active-operation
  block; the banner should mention the active operation and tell the user to
  resolve, continue, or abort.

### Commit

**POST /api/git/{project}/commit**
Create a commit from the index. Set `amend` to replace the current `HEAD`
commit.

```json
{ "message": "Update git controls", "amend": false }
```

Response:

```json
{ "ok": true, "hash": "abc123def456" }
```

### Undo Last Commit

**POST /api/git/{project}/undo-last-commit**
Undo the most recent local commit with `git reset --mixed HEAD~1`. The backend
blocks pushed/shared commits and returns a revert recommendation instead of
rewriting public history. Changes from the undone commit remain as unstaged
local changes.

Response shape follows `GitActionResult`:

```json
{
  "ok": true,
  "message": "Undid last commit abc123d",
  "hash": "abc123def456",
  "conflict": false,
  "dirty": true,
  "destructive": true,
  "recommendation": "changes from the undone commit are now unstaged"
}
```

Blocked pushed-history example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

### Leased Push Publication

**POST /api/git/{project}/push/prepare**
Prepare an exact-OID leased publication preview without mutating any state. Inspects the specified local branch (or currently checked-out branch when omitted), resolves its configured upstream remote, and queries the remote reference OID.

Body:

```json
{
  "branch": "refs/heads/feature",
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

Fields:
- `branch` (optional string): Full local branch reference under `refs/heads/`. When provided, prepares a preview for the specified branch (active or inactive, even if `HEAD` is detached). When omitted, defaults to the currently checked-out branch at `HEAD` (and returns blocked `detached-head` if `HEAD` is detached).
- `worktreePath` (optional string): Target registered worktree path.
- `root` (optional string): Target VCS root.

Response: `PublishPreview`:
- `status: "ready"`: Returns frozen `PublishSnapshot` with `branch`, `sourceOid`, `remoteName`, `destinationRef`, `expectedRemoteOid`, `remoteIdentity`, and `repositoryIdentity`.
- `status: "blocked"`: Blocked when missing upstream (`missing-upstream`), ambiguous destination (`ambiguous-destination`), missing branch ref (`missing-destination`), or detached HEAD when `branch` is omitted (`detached-head`).

**POST /api/git/{project}/push/publish**
Publish a previously prepared and user-confirmed leased push snapshot using an exact remote-OID CAS lease.

Body:

```json
{
  "snapshot": {
    "branch": "refs/heads/feature",
    "sourceOid": "1111111111111111111111111111111111111111",
    "remoteName": "origin",
    "destinationRef": "refs/heads/feature",
    "expectedRemoteOid": "2222222222222222222222222222222222222222",
    "remoteIdentity": "sha256-of-push-url",
    "repositoryIdentity": "sha256-of-repo-roots"
  },
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

The server validates `snapshot.branch` directly:
- The target branch must exist and its local tip must match `snapshot.sourceOid`.
- The operation is independent of current checkout: switching branches or detaching `HEAD` between prepare and publish does not invalidate the lease.
- Repository identity and remote URL identity must match the snapshot.
- Push negotiation uses an exact-OID lease (`expectedRemoteOid`): if another writer updated the remote destination ref, the push is safely aborted with `stale-remote`.
- Response returns `PublishResult` with status: `published`, `already-current`, `stale-remote`, `stale-local`, `stale-config`, `rejected`, `auth-required`, or `unknown`.


### Frontend Transport, Hooks, Action Controllers, and UI Surfaces (Phase 02 & Phase 03)

The UI layer (`packages/ui`) routes Git operations through profile-owned clients, branch-qualified queries, and scoped action controllers. Rewriting inactive local branches and preparing leased publication avoid ambient `HEAD` fallbacks across transport and state boundaries:

#### 1. Client & Transport Contracts (`client.ts`, `ws-transport.ts`)

- `client.git.commitMessage(target, hash, root?, branch?)`:
  Maps to `GET /api/git/{project}/commit/{hash}/message`. The optional `branch` is encoded alongside `worktreePath` and `root` via `URLSearchParams` without manual URI concatenation or ref truncation.
- `client.git.prepareLeasedPush(target, root?, branch?)`:
  Maps to `POST /api/git/{project}/push/prepare`. Optional `branch` is passed in the JSON request body and omitted when `undefined`.
- `client.git.publishLeasedPush(target, snapshot, root?)`:
  Publishes the frozen `PublishSnapshot`, which explicitly encapsulates `snapshot.branch`, `sourceOid`, `remoteName`, and `expectedRemoteOid`. No additional branch parameters are needed or accepted on the publish route.

#### 2. Query Keys & Cache Isolation (`queries.ts`)

- `gitCommitMessageQueryKey(target, hash, root?, branch?)`:
  Appends a stable branch discriminator (`branch:${branch}` vs. `branch:default`) to the query key. This prevents cache collisions when identical commit hashes exist across different branches under the same target and root.
- Invalidation preserves owner-scoped prefixes (`gitQueryKey("git-commit-message", normalized, rootKey)`), ensuring that Git rewrites refresh all commit message queries in the owning target scope.
- `useGitCommitMessage` sets `staleTime: 0` and binds query execution to the profile owner and connection generation.
- `useGitPrepareLeasedPush(target, root?, branch?)` forwards the explicit branch to the bound client.

#### 3. History View Eligibility (`use-git-history-view.ts`)

- `isViewingLocalBranch`: Evaluated as `Boolean(resolved.branch && !resolved.branch.isRemote && branchRef?.startsWith("refs/heads/"))`.
- Replaces active-only rewrite checks: viewing an inactive discovered local branch permits commit message edits and squash actions. Remote branches and detached `HEAD` views remain ineligible (`"Squash requires a local branch."`).
- `isViewingActiveBranch` and `activeBranchRef` are preserved for checkout-sensitive operations (such as branch checkout warnings and worktree actions).

#### 4. Squash Controller Target Capture (`use-git-squash.ts`)

- Loads full messages for selected commits via `client.git.commitMessage(capturedTarget, hash, capturedRoot, branch)` using the captured `branchRef`.
- Validates that every message snapshot returns matching `snapshot.branch === branch` and identical `headOid`. Mismatches abort loading with `"History changed while loading messages. Refresh and select again."`.
- Submits `expectedBranch: current.snapshot.branch` and `expectedHeadOid: current.snapshot.headOid` under CAS ref protection.
- On success, emits a `receipt` containing `{ branch, sourceOid: result.newHeadOid, count, targetOid, capturedTarget, root, ownerGeneration }`. Uncertain outcomes or errors never emit a success receipt.

#### 5. Receipt-Bound Leased Push (`use-leased-git-push.ts`)

- Receives `expectedSource?: { branch: string; sourceOid: string }` from the squash receipt.
- Passes `expectedSource.branch` directly into `useGitPrepareLeasedPush(normalized, root, expectedSource.branch)`.
- Fences preparation: if `res.snapshot.branch !== expectedSource.branch` or `res.snapshot.sourceOid !== expectedSource.sourceOid`, the flow transitions to `blocked` and rejects confirmation.
- Retains frozen lease snapshot and credential retry state; target, root, or owner-generation changes immediately revoke pending preparation and retries.

#### 6. Edit Controller Scope & Baseline Safety (`GitHistoryActions.tsx`)

- Uses an isolated `editScope` tuple `[project, projectTargetCacheKey(targetRef), root, editBranch, connectionGeneration]` separate from general action scope.
- Captures commit entry and `editScope` on opening; queries `commitMessage` with the captured local branch.
- Freezes `frozenSnapshot` once loaded. Subsequent background query refetches do not overwrite established user drafts or CAS baselines.
- Validates `frozenSnapshot.branch === editBranch` before submit; mismatched branch disables save and prompts history refresh.

#### 7. UI Surface Parity & Accessibility (Phase 03)

- **Surface Parity (`WorkspaceGitPanel.tsx`, `GitPage.tsx`)**:
  Both the compact Workspace Git Panel and standalone Git Page expose commit-message editing and squash mutations whenever viewing any local branch (`historyView.isViewingLocalBranch`), active or inactive. Destructive working-tree actions (`reset`, `drop`, `undoLastCommit`) remain guarded by `historyView.isViewingActiveBranch`.
- **Branch Banner Synchronization**:
  When viewing a non-active branch, the banner displays: `Viewing {branchLabel}. Cherry-pick and revert apply to checked-out branch {activeBranch}.` Obsolete warnings restricting rewrite actions to the active branch are removed.
- **Accessible Disabled Context Menu (`GitLogTree.tsx`)**:
  When viewing a remote branch or detached `HEAD` without edit permissions, the "Edit Commit Message" Radix context menu item associates its disabled state with a unique `useId()` description ID via `aria-describedby`, paired with mouse `title` tooltip fallback and non-interactive `<p>` explanation text (`"Edit Commit Message is only available for local branches"`).
- **Post-Squash Leased Publication**:
  Following a squash on an inactive local branch, the receipt-bound leased push flow prepares and publishes strictly against `receipt.branch` and the frozen target snapshot, protecting against ambient `HEAD` drift or checkout transitions.
