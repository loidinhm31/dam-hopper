# REST Endpoint Reference

Global configuration, projects, terminals, Git operations, and SSH route contracts moved from the [API reference index](../api-reference.md).

## REST Endpoints

### Global Configuration & Preferences

**GET /api/global-config**
Retrieve global server defaults and allowlisted UI preferences.

Response:

```json
{
  "defaults": null,
  "workspaces": null,
  "ui": {
    "systemFontSize": 14,
    "editorFontSize": 14,
    "terminalFontSize": 17,
    "cognitoModeShortcut": "Mod+Alt+KeyB",
    "cognitoModeStyle": "heavy-blur"
  }
}
```

**POST /api/global-config/ui** (transport channel: `globalConfig:updateUi`)
Update allowlisted UI preferences. Sparse UI objects merge into the existing
configuration, preserving unspecified fields. The server writes TOML using
`snake_case` keys. The default path is
`~/.config/dam-hopper/config.toml`; `XDG_CONFIG_HOME` can override the config
directory.

Body:

```json
{
  "ui": {
    "cognitoModeShortcut": "Mod+Alt+KeyK",
    "cognitoModeStyle": "black-screen"
  }
}
```

Fields:

- `cognitoModeShortcut` (string): Configurable keyboard shortcut chord. Canonical default is `"Mod+Alt+KeyB"` (`Ctrl+Alt+B` on Linux/Windows, `Cmd+Option+B` on macOS).
- `cognitoModeStyle` (string enum): Privacy screen mask style: `"heavy-blur"` (default `blur(16px) saturate(180%)` over `rgba(148, 163, 184, 0.12)` where supported, with opaque-black fallback) or `"black-screen"` (opaque `#000000`). Unknown or invalid style variants return `400 Bad Request`.
- Ephemeral mode activation (`active`) is not a `UiConfig` field; it remains
  client-side and is not persisted or reset by this preference API.

Cognito Mode is a visual UI mask, not an authentication, content-redaction, or
OS screenshot-protection boundary. Heavy Blur is not guaranteed to conceal
underlying content.

### Projects

**GET /api/projects**
List all projects in workspace.

Response: `{ projects: [ { name, path, type } ] }`

### Terminals

**POST /api/terminal** (transport channel: `terminal:create`)
Create a new PTY session (idempotent).

Body: `{ id, project?, cwd?, worktreePath?, command, cols, rows, env? }`

When `worktreePath` is present, the server resolves it as a registered,
available worktree for `project`, resolves relative `cwd` values beneath that
target, rejects cwd values outside it, and persists the canonical target in
session metadata. `worktreePath` requires `project`; omitting it preserves
configured-root or legacy project behavior.

Platform behavior for free terminals differs only where the request omits `cwd`: Windows uses an existing user home directory, then the server's existing current directory; Unix retains the `HOME`-then-`/tmp` fallback. On Windows, an empty command or the exact `bash` selector starts the native interactive `cmd.exe` with no arguments. Other command strings run as `cmd.exe /C <command>`.

**Windows cmd.exe semantics & test implications:**

- Environment variable expansion in `cmd.exe` uses `%VAR%` syntax rather than Unix `$VAR`.
- `cmd.exe` output uses CRLF (`\r\n`); normalize captured terminal output in test assertions. Input is submitted to the PTY as raw bytes, so callers choose the line terminator.
- Windows does not provide Unix shell lifecycle integration (e.g. zsh/fish precmd/preexec hooks, prompt tracking, or sysfs/procfs monitoring); terminal sessions on Windows operate in unmonitored raw mode without Unix-specific shell lifecycle events.
- Unix shell selection, bash fallback, and POSIX process management remain completely unchanged on Linux/macOS.
  For the isolated Windows loopback startup and cleanup procedure, see the [Server Configuration](../configuration/server-configuration.md#windows-server-loopback-smoke-checklist).

Response: the created `SessionInfo`, including `worktreePath` when the session
is target-scoped.

If an automatic restart can no longer validate a target, the server also emits
the generic push event `terminal:target-unavailable` with
`{ project, worktreePath, sessionId, targetUnavailable: true, willRestart: false }`.
The same event may follow a create failure when fresh validation proves the
target disappeared. Ordinary PTY or cwd failures remain ordinary errors. The
browser records that exact target as unavailable, keeps the session metadata
and scrollback as a non-running orphan, and routes later new operations to the
configured root.

**Idempotency Guarantees:**

- Calling create with the same `sessionId` during restart backoff will immediately spawn a fresh session
- Any pending supervisor respawn for that ID is automatically cancelled (killed set flag)
- Dead session tombstones are cleaned up automatically
- No need for client-side alive status filtering—safe to retry without state checks
- Lock released before slow I/O (openpty, spawn), reacquired with TOCTOU guard to detect concurrent creates

**GET /api/pty/:sessionId**
Stream PTY output (Server-Sent Events).

**POST /api/pty/:sessionId/send**
Send input to running PTY.

Body: `{ input: string }`

**GET /api/pty/:sessionId/resize**
Resize terminal.

Body: `{ cols: number, rows: number }`

**POST /api/pty/:sessionId/kill**
Gracefully terminate session (SIGTERM, then SIGKILL if needed).

Response: `{ ok: true }`

**POST /api/pty/:sessionId/remove**
Immediately evict session without restart (cancels pending auto-restart).

Response: `{ ok: true }`

### Git Operations

**GET /api/git/:project/status**
Repository status.

Response: `{ branch, ahead, behind, modified: [], untracked: [] }`

**POST /api/git/:project/clone**
Clone a repository.

Body: `{ url: string, recursive?: bool }`

**POST /api/git/push**
Ordinary fast-forward push for the checked-out branch.

Route: `/api/git/push`

Body: `{ project: string, worktreePath?: string, root?: string }`

Client behavior:

- Requests may select a worktree and VCS root with `worktreePath` and `root`.
- The endpoint pushes only the checked-out branch to its configured upstream. It rejects non-fast-forward updates; the legacy `force` field is rejected with `422 Unprocessable Entity`. If `branch.<name>.remote` or `branch.<name>.merge` is missing, it returns a clear push error. Use leased publication below for destructive publication.

**POST /api/git/{project}/push/prepare**
Prepare an exact-OID leased publication preview without mutating any state. Inspects the specified local branch (or checked-out branch when omitted), upstream remote, and remote reference.

Route: `/api/git/{project}/push/prepare`

Body: `{ worktreePath?: string, root?: string, branch?: string }`

- `branch` (optional string): Full local branch reference under `refs/heads/` (e.g. `"refs/heads/feature"`). When provided, prepares a preview for the specified branch (active or inactive, even if `HEAD` is detached). When omitted, defaults to the currently checked-out branch at `HEAD` (and returns blocked `detached-head` if `HEAD` is detached).
- `worktreePath` (optional string): Target registered worktree path.
- `root` (optional string): Target VCS root.
  Response: `PublishPreview`:

```json
{
  "status": "ready",
  "snapshot": {
    "branch": "refs/heads/main",
    "sourceOid": "1111111111111111111111111111111111111111",
    "remoteName": "origin",
    "destinationRef": "refs/heads/main",
    "expectedRemoteOid": "2222222222222222222222222222222222222222",
    "remoteIdentity": "sha256-of-push-url",
    "repositoryIdentity": "sha256-of-repo-roots"
  },
  "alreadyCurrent": false
}
```

Or blocked when detached HEAD, missing upstream, ambiguous destination, or missing remote:

```json
{
  "status": "blocked",
  "reason": "detached-head",
  "message": "HEAD is detached; leased publication requires a checked-out local branch under refs/heads/"
}
```

**POST /api/git/{project}/push/publish**
Publish a previously prepared and user-confirmed leased push snapshot with an exact remote-OID lease. Validates `snapshot.branch` and its destination directly; checkout state changes or detached HEAD between prepare and publish do not invalidate the frozen lease.

Route: `/api/git/{project}/push/publish`

Body:

```json
{
  "snapshot": {
    "branch": "refs/heads/main",
    "sourceOid": "1111111111111111111111111111111111111111",
    "remoteName": "origin",
    "destinationRef": "refs/heads/main",
    "expectedRemoteOid": "2222222222222222222222222222222222222222",
    "remoteIdentity": "sha256-of-push-url",
    "repositoryIdentity": "sha256-of-repo-roots"
  },
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

Response: `PublishResult`:

```json
{
  "status": "published",
  "branch": "refs/heads/main",
  "remoteName": "origin",
  "destinationRef": "refs/heads/main",
  "sourceOid": "1111111111111111111111111111111111111111",
  "expectedRemoteOid": "2222222222222222222222222222222222222222",
  "actualRemoteOid": "1111111111111111111111111111111111111111",
  "message": "Successfully published refs/heads/main to origin/refs/heads/main"
}
```

Statuses:

- `published`: Push succeeded; remote destination ref moved to `sourceOid`.
- `already-current`: Remote is already up to date with `sourceOid`; no push needed.
- `stale-remote`: Remote moved from `expectedRemoteOid` to a different commit before or during negotiation; push aborted, no remote mutation.
- `stale-local`: Local branch tip moved from `sourceOid` after preview; push aborted.
- `stale-config`: Target branch reference, upstream configuration, or push URL changed; push aborted.
- `rejected`: Remote receive-pack hook declined the update; local edit is preserved.
- `auth-required`: SSH or credential authentication failed before transfer.
- `unknown`: Transport dropped after negotiation/send; status uncertain pending refresh.

### SSH Credential APIs

**POST /api/ssh/keys/load**
Load an SSH private key into the current DamHopper server session.

Body: `{ keyPath?: string, passphrase?: string, saveForLater?: bool }`

Response: `{ success: bool, saved: bool, keyPath?: string, error?: string }`

Notes:

- `saveForLater=true` attempts to persist the passphrase in the host OS credential store.
- `saved=true` means a saved credential is available for that workspace/key after the call completes. It can mean the current request persisted it, or that one already existed when the key was loaded session-only.
- Validation happens before persistence, so a wrong passphrase does not create or update a saved credential.
- When persistence is unavailable, the key still loads for the current server session and `error` explains why the save step was skipped.
- Responses never include the passphrase.
- The loaded credential feeds the shared libgit2 fetch/pull/push callback path; it is not passed to a CLI askpass helper.

**GET /api/ssh/credentials**
Return saved-credential metadata for one SSH key.

Query: `keyPath=basename`

Response: `{ saved: bool, keyPath?: string, error?: string }`

**DELETE /api/ssh/credentials**
Forget the saved credential for one SSH key and clear the in-memory session credential when it matches.

Query: `keyPath=basename`

Response: `{ success: bool, forgotten: bool, error?: string }`

**GET /api/git/:project/branches**
List local and remote branches.

**POST /api/git/:project/branches**
Create a branch.

Body: `{ name: string, startPoint?: string, checkout?: bool }`

**POST /api/git/:project/branches/checkout**
Checkout a branch.

Body: `{ branch: string, startPoint?: string, create?: bool, strategy?: "normal"|"stash"|"force" }`

**POST /api/git/:project/branches/update**
Update a branch from its remote tracking branch.

Body: `{ branch?: string }`

**POST /api/git/:project/cherry-pick**
Cherry-pick a commit.

Body: `{ hash: string }`

**POST /api/git/:project/reset**
Reset the current branch to a commit.

Body: `{ hash: string, mode: "soft"|"mixed"|"hard"|"keep" }`

### Git Diff & Change Management

**GET /api/git/:project/diff**
List changed files (staged + unstaged).

Optional query: `root=ID` to scope results to one VCS root. When no root is
supplied, the backend resolves the deepest matching root for the requested
paths and rejects mixed-root operations.

Use `root=*` for the read-only aggregate local-changes view. Aggregate entries
include `rootId` and `rootPath`; mutation endpoints reject aggregate roots and
must be called with one concrete root.

Response:

```json
{
  "entries": [
    {
      "path": "src/main.rs",
      "status": "modified|added|deleted|renamed|copied|conflicted",
      "staged": false,
      "additions": 5,
      "deletions": 2,
      "oldPath": "src/old.rs",
      "rootId": ".",
      "rootPath": ".",
      "submodule": {
        "path": "modules/child",
        "objectId": "abc123...",
        "moduleName": "child",
        "url": "../child.git"
      }
    }
  ]
}
```

The typed client result is either a normal response with `gitAvailable: true`
or an unavailable result:

```json
{
  "gitAvailable": false,
  "code": "GIT_NOT_INITIALIZED",
  "entries": [],
  "untrackedTruncated": false,
  "untrackedTotal": 0
}
```

This preserves a successful, typed empty state for the local-changes panel
while branch/root requests continue to surface the 409 error for shared
unavailable-state handling.

`rootId`, `rootPath`, and `submodule` are omitted when the entry is not tied to
an explicit VCS root or submodule gitlink.

**GET /api/git/:project/diff/file?path=REL**
File diff content with hunks (HEAD vs working directory).

Optional query: `root=ID` for root-scoped file diff resolution.

Response:

```json
{
  "path": "src/main.rs",
  "original": "...",
  "modified": "...",
  "language": "rust",
  "hunks": [
    {
      "index": 0,
      "oldStart": 10,
      "oldLines": 5,
      "newStart": 10,
      "newLines": 7,
      "header": "@@ -10,5 +10,7 @@"
    }
  ],
  "isBinary": false
}
```

**POST /api/git/:project/stage**
Stage files in the index with conflict preflight and process-local mutation coordination.

Body: `{ paths: string[], root?: string }`

Preconditions and safety guards:

- **Process-local mutation coordination (`GitMutationCoordinator`):** Acquires an exclusive in-memory lock keyed on the canonical repository common Git directory (`commondir` for linked worktrees, or canonical `.git` directory). If another server-coordinated Git mutation is in progress on the repository, returns HTTP 503 (`UNAVAILABLE`) with `"Another Git mutation is in progress for this repository"`.
- **Generic stage preflight (CUT1):** Before staging any path, inspects `index.has_conflicts()`. If any path in `paths` is an unmerged conflict entry, the request is rejected immediately with HTTP 400 (`INVALID_INPUT`: `"Cannot stage unmerged conflicted file '{path}'. Resolve conflict first."`) before any clean files in the batch are staged. Clean-only batches pass this conflict preflight (subsequent standard staging validations still apply).
  **POST /api/git/:project/unstage**
  Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file.

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

<a id="git-conflict-discovery--snapshots"></a>

### Git Conflict Discovery & Snapshots

**GET /api/git/{project}/conflicts**
Bounded deterministic summary of unmerged index entries without eager stage blob or worktree file loading.

Query parameters:

- `worktreePath` (optional string): Absolute path to a registered Git worktree. When omitted or `null`, defaults to the configured project root.
- `root` (optional string): Explicit VCS root identifier for multi-root projects.
- `cursor` (optional string): Opaque v2 pagination cursor bound to the full unmerged conflict-set fingerprint and last raw-path anchor. A changed conflict set or missing anchor is rejected with HTTP 400 (`GIT_CONFLICT_CURSOR_STALE`); clients may restart pagination once from the first page.
- `limit` (optional integer): Maximum conflict entries per page (clamped between 1 and 500, default 100).

Response (`ConflictSummaryResponse`):

```json
{
  "targetRevision": "0123456789abcdef0123456789abcdef01234567",
  "entries": [
    {
      "conflictId": "cid_7372632f636f6e666c6963742e7273",
      "path": "src/conflict.rs",
      "status": "bothModified",
      "isBinary": false
    }
  ],
  "truncated": false
}
```

Fields and behaviors:

- `conflictId`: Opaque URL-safe server identifier representing the raw unmerged path bytes. Clients must pass this identifier unchanged to detail queries.
- `status`: Unmerged conflict state enum: `bothModified`, `modifyDelete`, `deleteModify`, `bothAdded`, or `unsupported`.
- `isBinary`: Binary file detection combining gitattributes `diff` configuration, known binary file extensions, and bounded ODB sniffing ($\le$ 8,000 bytes) without loading all stage blobs or reading worktree files.
- `unsupportedReason`: Present when path cannot be safely edited in the browser (e.g. non-UTF-8 path bytes, submodules/gitlinks, or symbolic links); omitted when `None`.
- `truncated`: `true` when more conflict entries exist beyond the returned page limit.
- `nextCursor`: Opaque cursor for fetching subsequent pages; omitted when `None`.

**GET /api/git/{project}/conflicts/file**
Coherent on-demand detail snapshot for a single conflict, including stage blobs, worktree metadata, effective gitattributes, and before/after coherence verification.

Query parameters:

- `conflictId` (required string): Opaque conflict identifier issued by `GET /api/git/{project}/conflicts` (max 4096 bytes).
- `worktreePath` (optional string): Absolute path to a registered Git worktree. When omitted or `null`, defaults to the configured project root.
- `root` (optional string): Explicit VCS root identifier.

Response (`ConflictSnapshot`):

```json
{
  "conflictId": "cid_7372632f636f6e666c6963742e7273",
  "path": "src/conflict.rs",
  "repositoryRoot": "/path/to/repo",
  "worktreeRoot": "/path/to/repo",
  "snapshotVersion": "6f2d8e41a3...",
  "fullIndexFingerprint": "9c1b7a2e5d...",
  "status": "bothModified",
  "stages": {
    "base": {
      "stage": 1,
      "path": "src/conflict.rs",
      "oid": "1111111111222222222233333333334444444444",
      "mode": 33188,
      "byteSize": 24,
      "kind": "text",
      "textTokens": ["base line 1\n", "base line 2\n"]
    },
    "ours": {
      "stage": 2,
      "path": "src/conflict.rs",
      "oid": "5555555555666666666677777777778888888888",
      "mode": 33188,
      "byteSize": 22,
      "kind": "text",
      "textTokens": ["our line 1\n", "our line 2\n"]
    },
    "theirs": {
      "stage": 3,
      "path": "src/conflict.rs",
      "oid": "9999999999aaaaaaaaaabbbbbbbbbbcccccccccc",
      "mode": 33188,
      "byteSize": 24,
      "kind": "text",
      "textTokens": ["their line 1\n", "their line 2\n"]
    }
  },
  "worktree": {
    "exists": true,
    "kind": "regular",
    "mode": 33188,
    "byteLength": 60,
    "textTokens": [
      "<<<<<<< HEAD\n",
      "our line 1\n",
      "=======\n",
      "their line 1\n",
      ">>>>>>> branch\n"
    ],
    "hasConflictMarkers": true,
    "isDirtyVsStages": true
  },
  "effectiveAttributes": {
    "eol": "lf",
    "ident": false,
    "filterQualified": true
  }
}
```

Pre-allocation bounds, classification, and failure semantics:

- **Pre-allocation stage limits:** Before allocating blob memory, object headers are inspected in the Git ODB via `read_header`. A stage blob exceeding `MAX_STAGE_BYTES` (5 MiB) or cumulative stage bytes exceeding `MAX_TOTAL_STAGE_BYTES` (15 MiB combined across stages 1, 2, 3) marks the stage `kind: "unsupported"` and its `textTokens` is withheld (omitted from serialized JSON).
- **Worktree file limits:** Worktree file reading is capped at `MAX_WORKTREE_BYTES` (5 MiB). Files exceeding this bound retain `kind: "regular"`, set `isDirtyVsStages: true`, and withhold `textTokens` (omitted from serialized JSON).
- **Bounded line tokenization:** UTF-8 text is tokenized into line tokens preserving raw terminators (`\n`, `\r\n`, or lone `\r`) such that `textTokens.join("") == content`. Tokenization enforces limits of `MAX_LINES` (50,000 lines) and `MAX_LINE_LENGTH` (100,000 bytes); exceeding either during tokenization marks the stage `kind: "unsupported"` and withholds `textTokens`.
- **Stage classifications (`kind`):** `text`, `binary` (detected via NUL byte sniff in initial 8,000 bytes), `missing` (stage absent from index; `path` and `oid` are omitted), `invalidEncoding` (non-UTF-8 text bytes), `unsupported` (gitlink, symlink, limits exceeded, or custom filter), or `readError`. When ancestor stage 1 is absent (e.g. `bothAdded`), `stages.base` is omitted from the serialized object.
- **Worktree classifications (`kind`):** `regular`, `symlink`, `directory`, `gitlink`, `unreadable`, or `missing`. `hasConflictMarkers` detects standard `<<<<<<<` and `>>>>>>>` markers.
- **Filter qualification:** When custom Git filters are configured, `effectiveAttributes.filterQualified` is `false`. To prevent data loss from unapplied filters, text tokens are withheld from all stages and the worktree, and stage kinds are marked `unsupported`.
- **Coherence verification (HTTP 409 `REFRESH_REQUIRED`):** Before and after reading stages and worktree, the server captures a fingerprint encompassing HEAD target OID, full index entries, and worktree file attributes. If detected repository or worktree state drifts during reading, the request fails with HTTP 409 and error code `REFRESH_REQUIRED`.
- **Unknown conflict ID (HTTP 404):** Returns HTTP 404 if the requested `conflictId` is absent from the unmerged index.
**POST /api/git/{project}/resolve**
Safe conflict resolution and staging endpoint with strict precondition verification, process-local mutation coordination, atomic file publication, and post-staging oracle verification.

_Implementation status:_ Backend mutation contract, Phase 05 frontend client DTO cutover, and Phase 08 workspace cutover implemented (`client.ts`, `ws-transport.ts`, `queries.ts`, `ChangedFilesList.tsx`, `WorkspacePage.tsx`, `use-conflict-resolver.ts`). Requests missing `conflictId` or `snapshotVersion` strings, or containing legacy `content`, are rejected fail-closed with HTTP 400 (`LEGACY_PAYLOAD_REJECTED`). Unrecognized fields or malformed action payloads are rejected (`deny_unknown_fields`) with HTTP 400 (`INVALID_INPUT`). Client mutations are preconditioned on `fullIndexFingerprint` and `snapshotVersion`; blind retries on timeouts, disconnects, or `outcomeUnknown` / `worktreeChangedStageFailed` are strictly prohibited. Staging bypasses are closed across UI and backend preflight (`stage_files`), and legacy `conflict-parser.ts` is retired.

**Request body (`ResolveRequest`):**

```json
{
  "conflictId": "cid_7372632f636f6e666c6963742e7273",
  "snapshotVersion": "6f2d8e41a3b4c5d6...",
  "fullIndexFingerprint": "9a8b7c6d5e4f3a2b...",
  "action": {
    "type": "reviewedText",
    "tokens": ["fn main() {\n", "    println!(\"resolved\");\n", "}\n"],
    "eol": "preserve",
    "executable": false
  },
  "worktreePath": "/path/to/worktree",
  "root": "vcs-root"
}
```

Request fields:

- `conflictId` (required string): Opaque URL-safe server identifier representing the raw unmerged path bytes.
- `snapshotVersion` (required string): Exact snapshot version token from `GET /api/git/{project}/conflicts/file`.
- `fullIndexFingerprint` (required string): Fingerprint of the full index state captured during snapshot generation.
- `action` (required object): Discriminated action union tagged on `"type"`:
  - `reviewedText`: Write explicitly reviewed text tokens to worktree and stage. Fields:
    - `tokens` (required array of strings): Complete reviewed worktree lines including terminators.
    - `eol` (optional enum): Line ending normalization: `"lf"`, `"crlf"`, or `"preserve"` (default: `"preserve"`).
    - `executable` (optional boolean): When present, forces worktree/stage mode to executable (`0o755`) or non-executable (`0o644`).
  - `indexSide`: Select an existing unmerged stage and stage its exact OID/mode. Fields:
    - `side` (required enum): `"ours"` (stage 2) or `"theirs"` (stage 3).
    - `stage` (required integer): Must match `2` for `"ours"` or `3` for `"theirs"`.
  - `delete`: Delete unmerged path from worktree and index. Object: `{ "type": "delete" }`.
- `worktreePath` (optional string): Registered Git worktree absolute path.
- `root` (optional string): Target VCS root identifier.

**Response (`ResolveOutcome`):**
The endpoint returns HTTP 200 with a tagged domain outcome JSON object (`outcome` discriminator). Callers must evaluate `outcome`:

| Outcome Discriminator        | Fields                                                         | Meaning & Client Action                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`                    | `newOid?: string`, `stage0Mode?: number`, `deleted?: boolean`  | Mutation succeeded. For `reviewedText` and `indexSide`, worktree file written, unmerged stages 1–3 removed, and stage 0 entry verified (`deleted` omitted when `false`). For `delete`, worktree file removed and all index stages 0–3 verified absent (`deleted: true`, `newOid` and `stage0Mode` omitted). |
| `stale`                      | `reason: string`, `requiredRefresh: boolean`                   | Precondition mismatch: index drifted (`fullIndexFingerprint`), snapshot drifted (`snapshotVersion`), or conflict resolved externally. Client must refresh state; zero writes occurred.                                                                                                                      |
| `unsupported`                | `reason: string`                                               | Path or configuration unsupported (e.g. symlink/directory/gitlink worktree kinds, non-UTF-8 path, custom encoding, or `ident=true`). Zero writes occurred.                                                                                                                                                  |
| `busy`                       | `reason: string`                                               | Mutation lock held: either in-memory `GitMutationCoordinator` active on repository or Git `index.lock` present on disk. Zero writes occurred.                                                                                                                                                               |
| `failedBeforeWrite`          | `error: string`                                                | Validation failure prior to disk mutation (e.g. path traversal or ancestor check failure). Zero writes occurred.                                                                                                                                                                                            |
| `worktreeChangedStageFailed` | `error: string`, `worktreeWritten: boolean`, `staged: boolean` | Partial mutation: file was published to worktree disk, but staging the index entry failed. UI must retain submitted reviewed text and prompt user to review/refresh.                                                                                                                                        |
| `outcomeUnknown`             | `error: string`, `requiredRefresh: boolean`                    | Mutation state uncertain (e.g. repository reopen failed or unmerged stages lingered after staging). Client must refresh and re-inspect state before taking further action. Automatic replay is prohibited.                                                                                                  |

**Mutation checks and limitations:**

- **Precondition re-validation:** Verifies `fullIndexFingerprint`, `snapshotVersion`, target path boundaries (`verify_safe_worktree_path`), and on-disk file type (refusing to overwrite symlinks or directories) before touching disk.
- **Process-local coordination:** Acquires in-memory `GitMutationCoordinator` keyed on the canonical repository common Git directory (`commondir` for linked worktrees, or canonical `.git` directory), then checks for existing disk `index.lock`. External uninstrumented Git CLI processes or external file edits are not synchronized.
- **Publication mechanism:** For `reviewedText` and `indexSide`, writes to a unique temporary sibling file (`.tmp_resolve_<hex>`) before renaming onto the target path (`safe_atomic_write`). This pathname-based publication does not provide a cross-system filesystem/index transaction or race-resistant ancestor containment against concurrent external writers.
- **Post-staging oracle verification:** Reopens repository and index to assert outcome facts for the resolved path: for `reviewedText` and `indexSide` (`verify_applied_oracle`), verifies unmerged stages 1–3 are removed, stage 0 matches expected OID/mode, and disk bytes match expected content; for `delete` (`verify_deleted_oracle`), verifies all stages 0–3 are absent from the index and the file no longer exists in the worktree.
- **Retry and replay policy:** Callers must not perform automatic or blind retries after timeouts, connection drops, or received `outcomeUnknown` / `worktreeChangedStageFailed`. Because partial mutations may have updated the worktree on disk prior to index stage failure, clients must refresh repository state and prompt the operator to review prior to any subsequent submission.

<a id="git-operation-lifecycle"></a>

### Git Operation Lifecycle

Authoritative detection, fingerprint-preconditioned continue/abort mutations, and truthful outcomes for active Git operations (`merge`, `rebase`, `cherry-pick`, `revert`). Detailed sequencer state machine and runner invariants are documented in the [Git Operation Lifecycle API](./git-operation-lifecycle.md).

**GET /api/git/{project}/operation**
Inspect authoritative active Git operation status, sequencer state, blockers, and fingerprints.

Query parameters:

- `worktreePath` (optional string): Absolute path to registered worktree. Defaults to project root.
- `root` (optional string): Target VCS root identifier.

Response (`OperationStatusResponse`):

```json
{
  "operation": "merge",
  "canContinue": false,
  "canAbort": true,
  "stoppedReason": "conflicts",
  "operationFingerprint": "4a7f29e1...",
  "fullIndexFingerprint": "8b9c1d2e...",
  "stageRoleLabels": {
    "base": "Base (merge base)",
    "ours": "Current branch (HEAD)",
    "theirs": "Incoming change (MERGE_HEAD)"
  },
  "terminalHandoffRequired": null,
  "blockers": ["Unresolved merge conflicts remain in index"]
}
```

Fields: `operation` (`"none"`, `"merge"`, `"rebase"`, `"cherry-pick"`, `"revert"`, `"unsupported"`, `"unknown"`), `canContinue` (server-computed eligibility: `true` when supported operation is active and index has no unresolved conflicts), `canAbort`, optional `stoppedReason` (`"conflicts"`, `"messageEditRequired"`, `"hookBlocked"`, `"unknown"`), `operationFingerprint` (SHA-256 of metadata/sequencer state), `fullIndexFingerprint`, `stageRoleLabels`, optional `terminalHandoffRequired` (`{ reason: "commitMessageEditor", worktreeRoot }`), `blockers`.

**POST /api/git/{project}/operation**
Execute preconditioned operation continue or abort mutation under `GitMutationCoordinator`.

Body (`OperationActionRequest`, strict `deny_unknown_fields`):

```json
{
  "operationPrecondition": "4a7f29e1...",
  "fullIndexFingerprint": "8b9c1d2e...",
  "action": "continue",
  "abortConfirmed": false,
  "worktreePath": "/path/to/worktree",
  "root": "optional-root"
}
```

Validation & execution rules:

- Missing `operationPrecondition`, `fullIndexFingerprint`, or `action` string fails closed with HTTP 400 (`LEGACY_PAYLOAD_REJECTED`). Unrecognized fields return HTTP 400 (`INVALID_INPUT`).
- Exclusive process-local `GitMutationCoordinator` lock acquired across common gitdir and worktree. Preconditions re-validated under lock; mismatches return `stale`.
- Subprocess executed via `run_bounded_git_command` with 15-second deadline, `kill_on_drop(true)`, `GIT_TERMINAL_PROMPT=0`, process-group termination, and non-interactive `GIT_EDITOR` sentinel (exit 42) to catch interactive editor prompts non-interactively.
- Response returns tagged `OperationOutcome` (`outcome`): `continued` (`{ newStatus }`), `aborted` (`{ worktreeCleaned }`), `blocked` (`{ reason, terminalHandoffRequired?: boolean }`; note `terminalHandoffRequired` is a boolean flag in this outcome), `stale` (`{ reason, requiredRefresh: true }`), `failed` (`{ error }`), or `outcomeUnknown` (`{ error, requiredRefresh: true }`; automated replay prohibited).
  **POST /api/git/:project/commit**
  Create a commit from staged files.

Body: `{ message: string, amend?: bool, root?: string }`

### Git History Rewriting & Squash

**GET /api/git/:project/commit/:hash/message**
Read the complete UTF-8 message, canonical branch ref, and tip OID for a commit reachable from the target branch.

Query parameters:

- `branch` (optional string): Full local branch reference under `refs/heads/` (e.g. `refs/heads/feature`). Enables reading commit messages from inactive branches or while `HEAD` is detached. When omitted, defaults to the currently checked-out branch at `HEAD`. Non-branch refs or invalid ref syntax return HTTP `400 Bad Request`.
- `worktreePath` (optional string): Target registered worktree path.
- `root` (optional string): Target VCS root.

Response:

```json
{
  "message": "Subject\n\nDetailed body\n",
  "branch": "refs/heads/main",
  "headOid": "1111111111111111111111111111111111111111"
}
```

**POST /api/git/:project/commit/:hash/message**
Rewrite a commit message on the target local branch using raw commit objects without modifying working tree files or index entries.

Body:

```json
{
  "message": "Updated commit message\n",
  "expectedBranch": "refs/heads/main",
  "expectedHeadOid": "1111111111111111111111111111111111111111",
  "allowSignatureRemoval": false,
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

Notes:

- Supports rewriting both active and inactive local branches. Inactive branch rewrites leave the active checkout, index, and dirty working tree files completely untouched.
- Enforces CAS: returns `ok: false` with `blockedReason: "stale-ref"` if the branch tip moved or if the branch changed active/inactive status during snapshot acquisition or publication.
- Blocked with `checked-out-branch` if the target branch is checked out in another linked worktree, or `active-operation` if a rebase, merge, or cherry-pick is in progress.
- UI usage: Consumed by `WorkspaceGitPanel` and `GitPage` history actions when `isViewingLocalBranch` is true. `expectedBranch` is captured from `historyView.branchRef` and `expectedHeadOid` is derived from `GET /api/git/:project/commit/:hash/message`.
- Response follows `GitActionResult`.

**POST /api/git/:project/squash**
Collapse two or more parent-contiguous commits on an active or inactive local branch into one commit.

Body:

```json
{
  "hashes": ["oldest-commit-oid", "newest-commit-oid"],
  "message": "Squashed commit message\n",
  "expectedBranch": "refs/heads/main",
  "expectedHeadOid": "1111111111111111111111111111111111111111",
  "allowSignatureRemoval": false,
  "worktreePath": "/worktrees/demo",
  "root": "modules/child"
}
```

Notes:

- Commits must be unique full 40-hex OIDs in exact oldest-first order with unbroken parent links and no merge commits in the range or rewritten descendants.
- Supports active and inactive local branches. Inactive branch squashes preserve active checkout and working tree state.
- Guarded against checkout in other linked worktrees (`checked-out-branch`), concurrent branch switches (`stale-ref`), and active operations (`active-operation`).
- Publication requires a separate user-confirmed leased push (`/push/prepare` and `/push/publish`).
- UI usage: Consumed by `WorkspaceGitPanel` and `GitPage` squash workflows when `isViewingLocalBranch` is true. Verified pre-flight messages validate identical `headOid` and `branch`. On success, generates a receipt (`receipt.branch`, `receipt.sourceOid`) driving the leased push confirmation flow.
- Response follows `GitActionResult`.

## Client-Side Profile Management

<a id="client-side-profile-management"></a>

Profile metadata and endpoint-bound credentials live in the browser. The profile runtime is client-side; the server participates through its normal authentication and WebSocket endpoints.

Detailed TypeScript data models (`ServerProfile`, `ProfileAuthV2`), storage keys (`damhopper_server_profiles`), connection lifecycle contracts (`ConnectionStatus`), and profile management functions are documented in the dedicated [Client-Side Profile Management Reference](./client-side-profiles.md) and [Multi-Server Profiles User Guide](../user-guide-multi-server-profiles.md).
