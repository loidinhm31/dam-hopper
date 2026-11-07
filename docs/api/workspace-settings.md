# Workspace, Agent Store, and Settings APIs

Workspace management, Agent Store, settings, and health route contracts moved from the [API reference index](../api-reference.md).
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

**GET /api/workspace/status**
Current workspace status. Returns `path` (canonical workspace browse root directory), `configPath` (authoritative configuration file location), and `workspaceEpoch`.

Response:

```json
{
  "ready": true,
  "path": "/home/user/workspace",
  "configPath": "/home/user/.config/dam-hopper/config.toml",
  "name": "my-workspace",
  "projectCount": 5,
  "workspaceEpoch": 1
}
```

**GET /api/workspace**
Detailed workspace info. Returns `root` (canonical workspace browse root directory), `configPath` (authoritative configuration file location), and `workspaceEpoch`.

Response:

```json
{
  "name": "my-workspace",
  "root": "/home/user/workspace",
  "configPath": "/home/user/.config/dam-hopper/config.toml",
  "projectCount": 5,
  "workspaceEpoch": 1
}
```

**POST /api/workspace/switch**
Change active workspace browse root. Accepts either a directory path via `path` or `{ "root": "...", "name"?: "..." }`.

Request body:

```json
{ "path": "/home/user/projects/new-workspace" }
```

Validation & execution contract:

- **Pre-validation**: Target directory is checked for existence, directory type, and exclusion from sensitive daemon configuration roots (`~/.config/dam-hopper`, `/etc/dam-hopper`, `/var/lib/dam-hopper`). Invalid paths reject with HTTP 400/403/404 without mutating configuration.
- **Persistence**: The validated directory is saved to `[workspace].root` in the active `config.toml` file.
- **Lifecycle reload**: Only after validation succeeds, filesystem sandboxes reinitialize with the new root, `workspaceEpoch` is incremented, and `workspace:changed` is broadcast to clients. Active remote PTY sessions are disposed to prevent process leakage across workspace roots; clients rebind their active workspace targets.
- **Stale-Root Fence**: Dirty editor tabs and pending writes are fenced against saving stale relative paths into the newly active root, failing closed to prevent accidental data overwrites.

Response: `{ "ok": true }`

**POST /api/workspace/init**
Initialize a workspace in a directory. Discovers projects or creates an empty config.

Request body:

```json
{ "path": "/path/to/new-workspace" }
```

Response: `{ "ok": true }`

### Settings & Health
<a id="settings-health"></a>

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


