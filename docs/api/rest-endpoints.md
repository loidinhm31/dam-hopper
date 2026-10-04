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
Create a new PTY session (idempotent as of Phase 07).

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

**Idempotency Guarantees (Phase 07):**

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
Prepare an exact-OID leased publication preview. Inspects the checked-out branch, upstream remote, and remote reference without mutating any state.

Route: `/api/git/{project}/push/prepare`

Body: `{ worktreePath?: string, root?: string }`

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
Publish a previously prepared and user-confirmed leased push snapshot with an exact remote-OID lease.

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
- `stale-config`: Checked-out branch, upstream configuration, or push URL changed; push aborted.
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

### Git Diff & Change Management (Phase 01)

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
Stage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file.

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID` for root-scoped conflict discovery.

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`

**POST /api/git/:project/commit**
Create a commit from staged files.

Body: `{ message: string, amend?: bool, root?: string }`

## Client-Side Profile Management (Phase 02)

Profile metadata and endpoint-bound credentials live in the browser. The
profile runtime is client-side; the server participates through its normal
authentication and WebSocket endpoints. The shared shell does not require a
profile connection to mount.

### Data model

```typescript
export interface ServerProfile {
  id: string; // UUID v4
  name: string;
  url: string; // normalized HTTP(S) URL
  authType: "basic" | "none";
  username?: string; // display value; password is never stored
  createdAt: number; // Unix timestamp
  autoConnect: boolean;
}

export interface ProfileAuthV2 {
  version: 2;
  serverUrl: string;
  authType: "basic" | "none";
  token: string;
}
```

`ProfileAuthV2` is stored under
`damhopper_profile_auth_v2_<profileId>`. Reads require a profile ID and verify
the saved URL and auth type against the current profile. A legacy
`damhopper_auth_token_<profileId>` record is migrated only when its profile
still exists; an unbound legacy single-server token is not copied to an
unrelated endpoint.

### Profile configuration functions

All functions are in `packages/ui/src/api/server-config.ts`:

- `readServerProfiles(): KnownServerProfiles` distinguishes available storage
  from an unavailable storage backend.
- `getProfiles(): ServerProfile[]` reads available profiles.
- `createProfile(data): ServerProfile` defaults `autoConnect` to `true`.
- `updateProfile(id, data): boolean` updates metadata, including `autoConnect`.
- `deleteProfile(id): boolean` clears credentials and removes local profile
  state; it does not delete remote server data.
- `migrateToProfiles(): void` converts the legacy URL/token configuration and
  preserves explicit profile choices.
- `getAuthToken(profileId?): string | null`,
  `setAuthToken(token, profileId?): boolean`, and
  `clearAuthToken(profileId?): boolean` are profile-explicit at runtime;
  missing IDs do not fall back to a global token.
- `isSameOriginProfile(profile): boolean` applies the native platform origin
  restriction before auto-login or connection traffic.

The `damhopper_active_profile_id` record remains a compatibility/default
endpoint input for legacy helpers. It is not the owner of connection state.
`connections.ts` exposes `connectProfile(profileId)`,
`disconnectProfile(profileId)`, and `removeProfileConnection(profileId)` for
independent profile runtimes.

`getMediaClientId(owner)` returns an in-memory UUIDv4 for the exact
`{ profileId, generation }`. `getMediaClientIdForProfile(profileId)` uses the
current snapshot when connected and creates a stable generation-1 fallback when
the profile is disconnected, so profile removal/logout cleanup still addresses
the original namespace. `removeProfileConnection` deletes all serialized owner
tuple keys for that profile; malformed keys are ignored.

### Connection contract

```typescript
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "login-required"
  | "offline"
  | "unsupported";

export interface ConnectionSnapshot {
  owner: { profileId: string; generation: number };
  status: ConnectionStatus;
  intent: boolean;
  serverUrl: string;
  error?: string;
}
```

`connectProfile` first checks URL validity, native origin support, and
`GET /api/auth/status`. The response must include `workbenchProtocol: 2`.
Generation and owner checks prevent a previous profile runtime from publishing
results after edit, removal, logout, or replacement.

### Persistence breakdown

| Key                                 | Storage             | Scope                                       |
| ----------------------------------- | ------------------- | ------------------------------------------- |
| `damhopper_server_profiles`         | `localStorage`      | All profile metadata; shared by tabs        |
| `damhopper_profile_auth_v2_<id>`    | `localStorage`      | Endpoint-bound auth per profile             |
| `damhopper_active_profile_id`       | `localStorage`      | Compatibility/default endpoint input        |
| `dam-hopper:workspace-state`        | Zustand persistence | Qualified `selectedProject`                 |
| `dam-hopper:preferences-source:v1`  | Zustand persistence | Independent preference/settings/browser IDs |
| TanStack Query and connection state | Memory only         | Owner/generation-qualified                  |

No client query cache is persisted to localStorage. The fresh-state reset
removes allowlisted legacy browser-resource records, never calls
`localStorage.clear()`, preserves profiles/auth/server data, and rejects
unqualified `project`/`session` links that lack `profileId`.

**POST /api/git/:project/stage**
Stage files for commit.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file (restore from HEAD).

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID`.

Response:

```json
{
  "conflicts": [
    {
      "path": "src/conflict.rs",
      "ancestor": "...",
      "ours": "...",
      "theirs": "..."
    }
  ]
}
```

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`


