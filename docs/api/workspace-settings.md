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
Current workspace status. Returns `configPath` (authoritative registry file location) and `path` (legacy config directory).

Response:

```json
{
  "ready": true,
  "path": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "name": "my-workspace",
  "projectCount": 5
}
```

**GET /api/workspace**
Detailed workspace info. Returns both `root` (legacy display field) and `configPath` (authoritative registry location).

Response:

```json
{
  "name": "my-workspace",
  "root": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "projectCount": 5
}
```

**POST /api/workspace/switch**
Change active workspace. Accepts either a directory path or a direct path to a `dam-hopper.toml` file.

Request body:

```json
{ "path": "/path/to/workspace-dir-or-config.toml" }
```

On switch:

- Configuration is reloaded from the specified path
- File API sandbox is reinitialized from project roots in the new config
- All PTY sessions are disposed
- Event: `workspace:changed` is broadcast to all clients

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

### Semantic Navigation Settings
<a id="semantic-navigation-settings"></a>

Dedicated HTTP endpoints managing server-global TypeScript and JavaScript semantic definition and implementation settings.

**GET /api/semantic/settings**

Inspects configured intent, effective runtime admission, toolchain readiness, resource capabilities, active tree/overlay metrics, and caller mutation authority.

- **Authorization:** Open to all authenticated sessions and development users. The `canMutate` boolean indicates whether the caller holds valid current administrator credentials.
- **Response body:**

```json
{
  "configuredEnabled": false,
  "runtimeEnabled": false,
  "runtimeState": "disabled",
  "integrityStatus": "Valid",
  "toolchainReady": true,
  "tupleIdentifier": "node-24.16.0-ts-5.9.3-tsls-6.0.2",
  "policyCapability": "cgroup-v2",
  "resourceWarning": null,
  "activeTrees": 0,
  "openDocuments": 0,
  "totalOverlayBytes": 0,
  "generation": 1,
  "transitionError": null,
  "canMutate": true
}
```

**Fields:**

| Field | Type | Description |
| --- | --- | --- |
| `configuredEnabled` | boolean | Persisted intent in the server's global configuration (`GlobalConfig.semantic.enabled`). |
| `runtimeEnabled` | boolean | Effective admission state in `SemanticSupervisor`. |
| `runtimeState` | string | Current lifecycle state: `"disabled"`, `"enabled"`, `"safe-disabled"`, or `"shutting-down"`. |
| `integrityStatus` | string or null | Descriptive toolchain verification outcome: `"Valid"`, `"Missing component: <name>"`, `"Invalid file type: <reason>"`, `"Permission denied: <reason>"`, or `"Digest mismatch"`. |
| `toolchainReady` | boolean | True if passive cryptographic digests and file permission checks succeeded. |
| `tupleIdentifier` | string or null | Immutable release-bundled engine tuple identifier. |
| `policyCapability` | string | Detected host containment capability: `"cgroup-v2"` or `"portable-only"`. |
| `resourceWarning` | string or null | Advisory warning when Linux cgroup v2 controllers are missing and running with portable limits. |
| `activeTrees` | number | Number of active semantic language server process trees. |
| `openDocuments` | number | Number of open document overlays tracked across active sessions. |
| `totalOverlayBytes` | number | Total memory in bytes consumed by in-memory document overlays. |
| `generation` | number | Monotonic runtime epoch incremented on state transitions. |
| `transitionError` | string or null | Error description from the most recent failed transition. |
| `canMutate` | boolean | True if the calling session holds fresh current-admin authority. |

**PATCH /api/semantic/settings**

Hot-toggles server-global semantic navigation on or off without restarting the daemon.

- **Authorization:** Strictly requires a signed session with fresh verification of the `Admin` role (`evaluate_current_admin`). Two sequential checks (initial pre-lock and pre-commit) ensure role verification linearizes at the fresh store lookup immediately preceding durable commit. External operator demotions occurring after commit remain subject to subsequent request rechecks.
- **Rejection:** Requests from `--no-auth`, `CredentialMechanism::NoAuthDev`, ordinary `user` roles, or demoted accounts are rejected immediately with HTTP 403 Forbidden.
- **Request body:** Accepts typed `{ "enabled": boolean }` only; unknown fields or malformed payloads return HTTP 400 Bad Request or HTTP 422 Unprocessable Entity.

```json
{
  "enabled": true
}
```

- **Transition Behaviors:**
  - **Transitioning ON (`enabled: true`):**
    1. Re-evaluates current administrator authority against active auth store.
    2. Validates bundled toolchain integrity passively (`verify_integrity`, zero child processes spawned); fails with HTTP 400 (`INVALID_INPUT`) if toolchain files, digests, or permissions are invalid.
    3. Re-evaluates administrator role immediately prior to disk commit.
    4. Atomically commits `enabled: true` to global configuration on disk and in memory.
    5. Commits enabled status to the supervisor (0 child processes spawned; language servers spawn lazily on first session request).
  - **Transitioning OFF (`enabled: false`):**
    1. Re-evaluates current administrator authority.
    2. Revokes session admission and drains active sessions.
    3. Reaps all child process trees within teardown budgets (`TOTAL_TEARDOWN_BUDGET = 5.0s`).
    4. Re-checks administrator role immediately prior to disk commit.
    5. Atomically commits `enabled: false` to global configuration on disk and in memory.
    6. If teardown fails: failed handles are retained, safe-disabled status is recorded with transition error, durable false intent is withheld, and HTTP 500 is returned.
- **Response body:** Returns the updated `SemanticSettingsResponse`.
- **Errors:**
  - `400 Bad Request`: Payload validation failed, unknown fields present, or passive toolchain integrity verification failed (`INVALID_INPUT`).
  - `401 Unauthorized`: Missing or expired authentication credentials.
  - `403 Forbidden`: Non-admin role, development session, or `--no-auth` mode (`AdminRequired`).
  - `422 Unprocessable Entity`: Malformed JSON or rejected unknown fields.
  - `500 Internal Server Error`: Active session teardown failure or atomic disk write error.
  - `503 Service Unavailable`: Auth store lookup timed out during role evaluation.

