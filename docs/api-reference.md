# API Reference

Base URL: `http://localhost:4800`

## Authentication

All requests require Bearer token in Authorization header:
```
Authorization: Bearer {token}
```

Token stored at `~/.config/dam-hopper/server-token`.

### Dev Mode (--no-auth)

The server supports a `--no-auth` authentication bypass mode for local development (Phase 01). When enabled:
- All protected routes bypass authentication checks
- Login endpoint returns dev tokens without credential verification
- Status endpoint returns `dev_mode: true`
- See [Phase 01: Server-Side Auth Bypass](../phase-01-server-auth-bypass/) for details

**Safety**: This mode fails immediately if `MONGODB_URI` is set or `RUST_ENV=production` is detected.

### Auth Endpoints

**POST /api/auth/login**
Authenticate and receive auth token.

Body (normal mode):
```json
{ "username": "user", "password": "pass" }
```

Body (--no-auth mode):
```json
{}
```

Response:
```json
{
  "ok": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "dev_mode": false
}
```

**GET /api/auth/status**
Check authentication status.

Response (authenticated):
```json
{
  "authenticated": true,
  "user": "username",
  "dev_mode": false
}
```

Response (--no-auth mode):
```json
{
  "authenticated": true,
  "user": "dev-user",
  "dev_mode": true
}
```

**POST /api/auth/logout**
Clear authentication session.

Response: `{ "ok": true }`

## REST Endpoints

### Projects

**GET /api/projects**
List all projects in workspace.

Response: `{ projects: [ { name, path, type } ] }`

### Terminals

**POST /api/pty/spawn**
Create new PTY session (idempotent as of Phase 07).

Body: `{ project, profile, env_overrides? }`

Response: `{ sessionId: uuid }`

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

**POST /api/git/:project/push**
Push commits.

Body: `{ branch?: string, force?: bool }`

### Git Diff & Change Management (Phase 01)

**GET /api/git/:project/diff**
List changed files (staged + unstaged).

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
      "oldPath": "src/old.rs"
    }
  ]
}
```

**GET /api/git/:project/diff/file?path=REL**
File diff content with hunks (HEAD vs working directory).

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

## Client-Side Profile Management (Phase 2)

Profile management lives entirely in the browser via **localStorage** — no server endpoints required.

### Data Model

```typescript
export interface ServerProfile {
  id: string;                    // UUID v4
  name: string;                  // "Local Dev", "Production", etc.
  url: string;                   // "http://localhost:4800"
  authType: "basic" | "none";    // Authentication method
  username?: string;             // For basic auth display (password never stored)
  createdAt: number;             // Unix timestamp
}
```

### API Functions

All functions in `packages/web/src/api/server-config.ts`.

**Profile Getters:**
- `getProfiles(): ServerProfile[]` — fetch all profiles
- `getActiveProfileId(): string | null` — currently selected profile ID
- `getActiveProfile(): ServerProfile | null` — currently selected profile object

**Profile Management:**
- `createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile` — add new profile, auto-generates UUID and timestamp
- `updateProfile(id: string, data: Partial<...>): void` — modify profile fields
- `deleteProfile(id: string): void` — remove profile (clears active if deleted)
- `setActiveProfile(id: string): void` — switch active profile

**Persistence:**
- `getProfiles() / saveProfiles(profiles: ServerProfile[]): void` — localStorage key: `damhopper_server_profiles`
- Active profile ID stored in `damhopper_active_profile_id`

**Migration:**
- `migrateToProfiles(): void` — (called in `App.tsx`) converts legacy single-server config to profile system on first app load
  - if profiles already exist → no-op
  - if legacy `damhopper_server_url` exists → creates "Default Server" profile and sets active

### Storage Breakdown

| Key | Storage | Scope | Persistence |
|-----|---------|-------|-------------|
| `damhopper_server_profiles` | localStorage | Shared (all tabs) | Survives browser close |
| `damhopper_active_profile_id` | localStorage | Shared (all tabs) | Survives browser close |
| `damhopper_auth_token` | sessionStorage | Per-tab | Cleared on tab close |
| `damhopper_auth_username` | sessionStorage | Per-tab | Cleared on tab close |

**POST /api/git/:project/stage**
Stage files for commit.

Body: `{ paths: string[] }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[] }`

**POST /api/git/:project/discard**
Discard changes to file (restore from HEAD).

Body: `{ path: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

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

Body: `{ path: string, content: string }`

### IDE File Explorer

**GET /api/fs/list?project=NAME&path=REL**
List directory contents.

Response:
```json
{
  "entries": [
    {
      "name": "file.ts",
      "kind": "file",
      "size": 1024,
      "mtime": 1712577600,
      "isSymlink": false
    }
  ]
}
```

**GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]**
Read file content (text or binary detection).

- Text: returns body with Content-Type: text/*
- Binary: returns `{ binary: true, mime: "..." }`
- Max 10MB per read

**GET /api/fs/stat?project=NAME&path=REL**
File metadata.

Response:
```json
{
  "kind": "file",
  "size": 1024,
  "mtime": 1712577600,
  "mime": "text/typescript",
  "isBinary": false
}
```

**Error Responses:**
- 400: Invalid path (outside sandbox)
- 404: Project/path not found

### Agent Store

**GET /api/agent-store/distribution**
Shows which projects have which skills/commands.

**POST /api/agent-store/import**
Import `.claude/` items from remote repo.

Body: `{ repoUrl: string }`

**POST /api/agent-store/ship**
Create symlinks to distribute items.

Body: `{ items: string[], projects: string[] }`

### Workspace Management

**POST /api/workspace/switch**
Change active workspace.

Body: `{ path: string }`

**GET /api/workspace/config**
Current workspace configuration.

### Settings & Health

**GET /api/health** (public, no auth required)
Server health + feature flags.

Response:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "features": {}
}
```

## WebSocket Endpoint

**WebSocket /ws**

Auth: append `?token={bearer_token}` to URL.

Protocol: JSON frames. Client sends commands via `{kind:}` envelope, server broadcasts events.

**Message Format (all client→server or server→client):**
```json
{ "kind": "terminal:write", "id": "uuid", "data": "..." }
```

**Terminal Messages:**
- `{ kind: "terminal:spawn", project, profile, env_overrides? }` → server responds with `{ kind: "terminal:spawned", id, ... }`
- `{ kind: "terminal:write", id, data }` — send input
- `{ kind: "terminal:attach", id, from_offset? }` — request buffer replay (Phase 02+); server responds with `{ kind: "terminal:buffer", id, data, offset }`
  - `from_offset` (optional) — client's last received byte offset for delta sync
  - Server sends full buffer if `from_offset` omitted or too old (evicted)
  - Server sends empty `data` if `from_offset` equals current offset (no new content)
  - Error case: session not found → no response; client should timeout and create new session
- `{ kind: "terminal:kill", id }` — terminate session
- `{ kind: "terminal:output", id, chunk }` — server pushes PTY output
- `{ kind: "terminal:buffer", id, data, offset }` — server response to `terminal:attach` with buffer content + current offset (Phase 02+)
- `{ kind: "terminal:exited", id, code }` — session ended

**File Tree Subscription (Phase 03):**
- `{ kind: "fs:subscribe_tree", req_id, project, path }` — start watching directory tree; server responds with `{ kind: "fs:tree_snapshot", sub_id, nodes: [...] }`
- `{ kind: "fs:unsubscribe_tree", sub_id }` — stop watching
- `{ kind: "fs:event", sub_id, event: { kind, path, from? } }` — server pushes FS changes (created|modified|deleted|renamed)

**File Read (Phase 04):**
- `{ kind: "fs:read", req_id, project, path, offset?, len? }` — read file content with optional range
  - Supports large files via offset+len (range reads)
  - Server responds: `{ kind: "fs:read_result", req_id, ok, binary, mime?, mtime?, size?, data?, code? }`
  - `data` is base64-encoded content (text or binary), max 100MB
  - If `ok=false` and `code="TOO_LARGE"`: file exceeds cap; use range reads (LargeFileViewer)

**File Write (Phase 04):**
- `{ kind: "fs:write_begin", req_id, project, path, expected_mtime, size }` — initiate write
  - Server responds: `{ kind: "fs:write_ack", req_id, write_id }`
  - `expected_mtime` (Unix seconds) guards against concurrent modification; server rejects if stale
- `{ kind: "fs:write_chunk", write_id, seq, eof, data }` — send base64 chunk
  - Server acks each: `{ kind: "fs:write_chunk_ack", write_id, seq }`
- `{ kind: "fs:write_commit", write_id }` — finalize write
  - Server responds: `{ kind: "fs:write_result", write_id, ok, new_mtime?, conflict, error? }`
  - `conflict=true` if server detected mtime mismatch; client shows ConflictDialog (overwrite or reload)
  - `new_mtime` sent on success for next save guard

**Git Events:**
- Server broadcasts `{ kind: "git:progress", project, step, percent }` during clone/push/pull

All responses include context fields matching the request (e.g., `req_id` echoed back for fs:subscribe_tree).
