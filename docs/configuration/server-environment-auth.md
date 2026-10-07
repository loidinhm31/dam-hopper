# Server Environment and Authentication

Global defaults, environment variables, server-token handling, MFA key provisioning, recovery, and retired plugin configuration moved from the [server configuration index](./server-configuration.md).
## Global Configuration (~/.config/dam-hopper/config.toml)

Store global defaults and known workspace metadata. This file is separate from the project registry.

```toml
[defaults]
workspace = "/home/user/projects/main-workspace"

[[workspaces]]
name = "prod"
path = "/home/user/prod-workspace"

[[workspaces]]
name = "sandbox"
path = "/tmp/test-workspace"
```

### Fields

**defaults.workspace** — Legacy fallback workspace directory, used only after explicit config, explicit workspace, and the global registry path are checked.

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var                                        | Type    | Purpose                                                                   |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `DAM_HOPPER_CONFIG`                        | path    | Load an exact `dam-hopper.toml` registry file                             |
| `DAM_HOPPER_WORKSPACE`                     | path    | Legacy workspace path/discovery fallback                                  |
| `DAM_HOPPER_PORT`                          | number  | API listen port (direct/Docker default 4800; systemd sets 4801)           |
| `DAM_HOPPER_HOST`                          | string  | API bind address (default `0.0.0.0`)                                      |
| `DAM_HOPPER_CORS_ORIGINS`                  | string  | Comma-separated exact HTTP(S) origins for credentialed API/WS CORS        |
| `DAM_HOPPER_WEB_DIR`                       | path    | Explicit API combined-mode static root; Docker sets `/opt/dam-hopper/web` |
| `DAM_HOPPER_NO_AUTH`                       | boolean | Development-only API auth bypass                                          |
| `DAM_HOPPER_WEB_ROOT`                      | path    | Dedicated `dam-hopper-web` static root                                    |
| `DAM_HOPPER_WEB_HOST`                      | string  | Dedicated web bind address (default `0.0.0.0`)                            |
| `DAM_HOPPER_WEB_PORT`                      | number  | Dedicated web listen port (default `4802`)                                |
| `DAM_HOPPER_WEB_RUNTIME_CONFIG`            | path    | Optional public runtime-config JSON file                                  |
| `DAM_HOPPER_WEB_RELEASE_VERSION`           | string  | Optional web health release-version override                              |
| `VITE_DAM_HOPPER_LOG_LEVEL`                | string  | Web bootstrap log level, embedded at build time                           |
| `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` | string  | Exact extension parent origins, embedded at build time                    |
| `RUST_LOG`                                 | string  | Rust logging filter                                                       |
| `MONGODB_URI` / `MONGODB_DATABASE`        | string  | MongoDB connection URI and database name for default authenticated mode. |
| `DAM_HOPPER_LITE_MODE`                     | boolean | Set `true` (or `1`, case-insensitive) to enable authenticated SQLite lite mode (removes MongoDB dependency). Omission, empty value, `false`, or `0` selects MongoDB. |
| `DAM_HOPPER_AUTH_SQLITE_PATH`              | path    | Optional SQLite database file path for lite mode. Defaults to `auth.db` in global DamHopper config directory (`~/.config/dam-hopper/auth.db`). |
| `DAM_HOPPER_MFA_KEY_FILE`                  | path    | Dedicated 32-byte MFA encryption key for encrypting TOTP secrets at rest via AES-256-GCM. Mandatory in production authenticated mode (both MongoDB and SQLite lite mode). See [Authentication State & Cryptography](../architecture/authentication-state-and-cryptography.md). |

`VITE_*` values require a web rebuild. `VITE_DAM_HOPPER_SERVER_URL` is not
allowed for production builds; production API origin is runtime config.
Changing extension parent origins also requires redistributing its generated ZIP.
CORS values are runtime API configuration and must exactly match the browser
origin.


## Storage Backend Selection and Dotenv Precedence

### Backend Selection (`DAM_HOPPER_LITE_MODE`)

DamHopper provides two production-grade authenticated storage backends within the same compiled binary:

1. **MongoDB (Default)**: Selected when `DAM_HOPPER_LITE_MODE` is unset, empty, `false`, or `0` (case-insensitive after trimming). Connects to `MONGODB_URI` (database `MONGODB_DATABASE`, default `damHopper`).
2. **SQLite Lite Mode**: Selected when `DAM_HOPPER_LITE_MODE` is set to `true` or `1` (case-insensitive after trimming). Removes the MongoDB service requirement while preserving full security parity (password hashing, mandatory AES-256-GCM encrypted MFA, session management, and role-based access control).

Any other nonempty `DAM_HOPPER_LITE_MODE` value (e.g. `DAM_HOPPER_LITE_MODE=invalid`) fails startup immediately. There is no automatic backend detection or fallback between MongoDB and SQLite.

### Dotenv Precedence and Path Resolution

- **Dotenv Precedence**: `dotenv::dotenv()` only populates variables not already present in the process environment. Pre-existing system environment variables (such as those supplied by systemd `EnvironmentFile=/etc/dam-hopper/server.env` or exported in the host shell) take precedence over values in working directory `.env` files.
- **Path Resolution (`DAM_HOPPER_AUTH_SQLITE_PATH`)**: Applies only when SQLite lite mode is selected. Relative paths resolve relative to the server process current working directory (CWD) at startup. In production or daemon deployments, always specify an absolute path on local persistent storage (e.g. `/var/lib/dam-hopper/auth.db`).
- **Default SQLite Storage**: When `DAM_HOPPER_AUTH_SQLITE_PATH` is omitted or empty, the server defaults to `auth.db` in the global DamHopper configuration directory (`~/.config/dam-hopper/auth.db` on Linux/macOS, or `%APPDATA%\dam-hopper\auth.db` on Windows).
  - **Subsystem Isolation**: `auth.db` is strictly dedicated to authentication, credentials, and session state. It is completely isolated from PTY/IDE session state (`~/.config/dam-hopper/sessions.db`) and telemetry state (`~/.config/dam-hopper/telemetry.db`).

### Production Safety Guards

- **Production Mode Enforcement**: When running in production (`RUST_ENV=production` or `ENVIRONMENT=production`), the server enforces strict backend readiness:
  - If MongoDB is selected, `MONGODB_URI` and `MONGODB_DATABASE` must be provided, reachable, and authenticated.
  - If SQLite lite mode is selected, the configured database file and parent directory must be writable and accessible. SQLite open or migration failure is always fatal and aborts startup immediately.
  - In both backends, `DAM_HOPPER_MFA_KEY_FILE` pointing to a valid dedicated 32-byte key file with strict owner-only permissions (`0600` on Unix) is mandatory.
- **Development Auth Bypass (`--no-auth`)**: The `--no-auth` CLI flag (or `DAM_HOPPER_NO_AUTH=1`) is a separate loopback development bypass that skips authentication store initialization and issues a development token. **It is never SQLite lite mode.** The server refuses to start with `--no-auth` if an authentication store is initialized or if running in production mode.
### Deployment Limits: Single Server Process per Auth File

**Validated deployment limit: exactly one server process per local auth file.**

SQLite operates in WAL mode (`PRAGMA journal_mode = WAL`) and supports concurrent asynchronous read queries alongside serialized write transactions within a single server process. However:
- Multiple DamHopper server processes sharing the same SQLite auth file on a single host or across hosts are **not supported**.
- Network-shared filesystems (NFS, SMB, CIFS, GlusterFS) must **not** be used for `auth.db` due to POSIX advisory lock inconsistencies and WAL flush latency.
- Separate DamHopper server deployments or test instances must be configured with separate, dedicated SQLite database paths.

## Operator Account Approval and Role Promotion Runbook

### Default-Disabled Registration Policy

`POST /api/auth/register` accepts JSON `{ "username", "password" }`, returns `{ "ok": true }`, and creates a `user` account disabled (`is_enabled = 0` in SQLite; `isEnabled: false` in MongoDB) with `auth_version = 0` (`authVersion: 0`). Until an operator explicitly approves the account:
- Any `POST /api/auth/login` attempt returns `HTTP 401 Unauthorized` with error payload:
  ```json
  {
    "code": "ACCOUNT_DISABLED",
    "error": "Account is disabled. Contact an administrator."
  }
  ```
- Registration **never grants automatic first-user administrator rights**, and there is **no public admin promotion API**.
- An operator must locally approve the account in the database and, when intended, promote it to `admin`.
- After operator approval, a password login for an account with no enrolled factor returns `state: "enrollmentRequired"`; completion uses `POST /api/auth/mfa/setup` and `POST /api/auth/mfa/confirm` in [Authentication API](../api/authentication.md). Never use the server's `server-token` JWT signing secret as a client credential.

### Development profile

Use this flow when running a local authenticated SQLite server on `http://127.0.0.1:4801` (for example with `DAM_HOPPER_LITE_MODE=true` and default `~/.config/dam-hopper/auth.db` or `%APPDATA%\dam-hopper\auth.db` on Windows, or an explicit local `DAM_HOPPER_AUTH_SQLITE_PATH`). `--no-auth` is a separate loopback bypass and never exercises SQLite lite mode.

#### 1. Register the Account Against Local `http://127.0.0.1:4801`
Replace `ReplaceWithStrongPassword!` with a real strong secret before executing:
```bash
curl -sS -X POST http://127.0.0.1:4801/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ReplaceWithStrongPassword!"}'
```
The response is `{"ok":true}`. The account is created as a disabled standard user (`role = 'user'`, `is_enabled = 0`, `auth_version = 0`) without automatic first-user admin rights. Calling `POST /api/auth/login` before approval returns `401 ACCOUNT_DISABLED`.

#### 2. Inspect, Approve, and Promote in SQLite (`sqlite3`)
Open the local SQLite auth database (substitute your explicit `DAM_HOPPER_AUTH_SQLITE_PATH` or `%APPDATA%\dam-hopper\auth.db` on Windows) with a busy timeout:
```bash
sqlite3 ~/.config/dam-hopper/auth.db -cmd ".timeout 5000"
```
Inspect the pending row in `auth_users`:
```sql
SELECT id, username, is_enabled, role, auth_version, mfa_enrolled_at_ms
FROM auth_users
WHERE username = 'admin';
```
Record the immutable 24-character hexadecimal `id` and observed `auth_version` (`0` on initial registration). Run a `BEGIN IMMEDIATE` conditional update matching both `id` and `auth_version` (use `role = 'admin'` to promote to administrator, or `role = 'user'` to approve as a standard user), and check `SELECT changes();` before committing:
```sql
BEGIN IMMEDIATE;
UPDATE auth_users
SET is_enabled = 1, role = 'admin'
WHERE id = '<verified-24-hex-id>' AND auth_version = <observed-auth_version>;
SELECT changes();
```
Verify the interactive output of `SELECT changes();` before closing the transaction:
- Only after observing **`1`**, issue:
  ```sql
  COMMIT;
  ```
- If `SELECT changes();` returns **`0`**, do **not** commit; issue `ROLLBACK;` and re-run the `SELECT` query above to inspect the current row before retrying:
  ```sql
  ROLLBACK;
  ```

#### 3. Complete First Login and TOTP Enrollment
Call `POST http://127.0.0.1:4801/api/auth/login` with the registered username and password. Because no MFA factor is enrolled yet (`mfa_enrolled_at_ms` is `NULL`), login returns `enrollmentRequired`; finish enrollment with `POST /api/auth/mfa/setup` and `POST /api/auth/mfa/confirm` per [Authentication API](../api/authentication.md).

### Deployment profile

On a production deployment (such as `dam-hopper-api.service` listening on port `4801` with `DAM_HOPPER_LITE_MODE=true`, `DAM_HOPPER_AUTH_SQLITE_PATH=/var/lib/dam-hopper/auth.db`, and a valid 32-byte owner-only `DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key`), execute the registration and SQLite approval commands directly from the API host against its local loopback endpoint (`http://127.0.0.1:4801`).

#### 1. Register From the API Host Against `http://127.0.0.1:4801`
Replace `<target-username>` (e.g. `admin`) and replace `ReplaceWithStrongPassword!` with a real strong secret before executing:
```bash
curl -sS -X POST http://127.0.0.1:4801/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"<target-username>","password":"ReplaceWithStrongPassword!"}'
```
The response is `{"ok":true}`. The account starts disabled (`is_enabled = 0`, `role = 'user'`, `auth_version = 0`) and never receives automatic first-user `admin` rights; login attempts return `401 ACCOUNT_DISABLED` until approved below.

#### 2. Inspect, Approve, and Promote on the API Host (`sqlite3`)
Connect to the configured local SQLite database on the API host as the service user so file ownership remains intact:
```bash
sudo -u <API_USER> sqlite3 /var/lib/dam-hopper/auth.db -cmd ".timeout 5000"
```
Inspect the pending account:
```sql
SELECT id, username, is_enabled, role, auth_version, mfa_enrolled_at_ms
FROM auth_users
WHERE username = '<target-username>';
```
Record the verified 24-character hexadecimal `id` and observed `auth_version`. Execute a `BEGIN IMMEDIATE` conditional update matching both `id` and `auth_version` (setting `role = 'admin'` for an administrator or `role = 'user'` for a standard account), and only `COMMIT` after `SELECT changes();` returns `1`:
```sql
BEGIN IMMEDIATE;
UPDATE auth_users
SET is_enabled = 1, role = 'admin' -- or role = 'user' for a standard user
WHERE id = '<verified-24-hex-id>' AND auth_version = <observed-auth_version>;
SELECT changes();
```
Verify the interactive output of `SELECT changes();` before closing the transaction:
- Only after observing **`1`**, issue:
  ```sql
  COMMIT;
  ```
- If `SELECT changes();` returns **`0`**, do **not** commit; issue `ROLLBACK;` and re-read `auth_users` before retrying:
  ```sql
  ROLLBACK;
  ```

#### 3. Complete First Login and TOTP Enrollment
After approval, the user's next `POST /api/auth/login` returns `enrollmentRequired`; complete TOTP setup and confirmation via the MFA endpoints documented in [Authentication API](../api/authentication.md).
### MongoDB Operator Procedure (`mongosh`)

Connect via `mongosh` to the configured MongoDB database:

#### 1. Inspect Pending Accounts
```javascript
db.users.findOne(
  { username: "<target-username>" },
  { _id: 1, username: 1, isEnabled: 1, role: 1, authVersion: 1 }
);
```

#### 2. Approve and Promote
```javascript
const userId = ObjectId("<verified-24-hex-id>");
const expectedVersion = NumberLong("<observed-authVersion>");

// Promote to admin
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  { $set: { isEnabled: true, role: "admin" } }
);

// Or approve as standard user
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  { $set: { isEnabled: true, role: "user" } }
);
```
Require `matchedCount === 1` and `modifiedCount === 1`.

After approval, the user's next login returns `enrollmentRequired` and prompts for TOTP MFA setup.
## JWT Signing Secret and Session Tokens

`~/.config/dam-hopper/server-token` stores a 32-character hexadecimal UUIDv4
used only as the server's JWT signing secret. On Unix it is created with mode
`0600`; it is not a client bearer token.

`--new-token` rotates this signing secret and invalidates existing signed
sessions:

```bash
cd server && cargo run -- --config /path/to/dam-hopper.toml --new-token
```

Normal login returns an MFA challenge, not a bearer token. Use the `token`
returned by `/api/auth/mfa/confirm` or `/api/auth/mfa/verify`, or the
`damhopper-auth` cookie where accepted. Never send the signing-secret file as `Authorization: Bearer`; see [Authentication API](../api/authentication.md).

## MFA Encryption Key and Operator Recovery Runbook

### Key File Provisioning (`DAM_HOPPER_MFA_KEY_FILE`)

In authenticated production mode, `DAM_HOPPER_MFA_KEY_FILE` is mandatory for both MongoDB and SQLite lite mode:
- Contains exactly 32 raw bytes (or 64 hexadecimal characters / 44 Base64 characters).
- File permissions must be strictly restricted to the owner (`chmod 600` on Unix). The server rejects symlinks, non-regular files, and files with group or world permissions.
- Dedicated to encrypting confirmed and pending TOTP secrets at rest via AES-256-GCM.
- Must be backed up separately from database files and deployed with identical contents across any server instance migrations.
### Operator Recovery Runbook (Lost TOTP Authenticator)

This privileged reset is not self-service. Verify identity out of band; use
immutable MongoDB `_id` plus current `authVersion`, never username alone.
In authenticated `mongosh`, replace placeholders; for legacy rows lacking
`authVersion`, filter by `_id` plus `authVersion: { $exists: false }` instead.

```javascript
const userId = ObjectId("<verified-24-hex-id>");
const expectedVersion = NumberLong("<observed-authVersion>");
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  {
    $inc: { authVersion: NumberLong(1) },
    $unset: { mfa: "", mfaAttemptWindowStartedAt: "", mfaAttemptCount: "", mfaBlockedUntil: "" }
  }
);
```

**Verification & Invariants:**
1. Require `matchedCount === 1` and `modifiedCount === 1`; otherwise stop and re-read. Never retry blindly.
2. The version bump invalidates sessions/challenges; `authSessions`/`authChallenges` TTL indexes clean later, so no direct deletion is needed for authorization.
3. WebSockets/live streams poll state every 5s with a 2s DB cap (≤7s; smoke timeout 8s); restart/disconnect instances for immediate containment.
4. Next password login requires fresh TOTP enrollment. Do not change `passwordHash`, `isEnabled`, `role`, signing keys/settings, or install an unencrypted factor/bypass.


### SQLite Operator Recovery Runbook (Lost TOTP Authenticator)

When a user loses their authenticator app or secret in SQLite lite mode, an operator can reset their MFA factor using `sqlite3`.

1. Verify user identity out of band.
2. Connect using `sqlite3` (with a busy timeout to gracefully handle concurrent traffic) and inspect the user's immutable `id` and current `auth_version`:
   ```bash
   sqlite3 /var/lib/dam-hopper/auth.db -cmd ".timeout 5000"
   ```
   ```sql
   SELECT id, username, is_enabled, role, auth_version, mfa_enrolled_at_ms
   FROM auth_users
   WHERE id = '<verified-24-hex-id>';
   ```
3. Start the interactive MFA reset transaction and check the affected row count before committing:
   ```sql
   BEGIN IMMEDIATE;
   UPDATE auth_users
   SET auth_version = auth_version + 1,
       mfa_secret_ciphertext = NULL,
       mfa_nonce = NULL,
       mfa_key_id = NULL,
       mfa_enrolled_at_ms = NULL,
       mfa_last_accepted_step = NULL,
       mfa_attempt_count = 0,
       mfa_attempt_window_started_at_ms = NULL,
       mfa_blocked_until_ms = NULL
   WHERE id = '<verified-24-hex-id>' AND auth_version = <observed-auth_version>;
   SELECT changes();
   ```
4. Inspect the interactive output of `SELECT changes();`:
   - Only after observing **`1`**, commit the transaction:
     ```sql
     COMMIT;
     ```
   - If `SELECT changes();` returns **`0`**, abort the transaction immediately and re-read `auth_users` before retrying:
     ```sql
     ROLLBACK;
     ```

**Verification & Invariants:**
1. **Single Row Guarantee**: Only run `COMMIT;` after verifying `SELECT changes();` returned `1`. If it returned `0`, run `ROLLBACK;`, re-read `auth_users`, and do not retry blindly.
2. **Immediate Invalidation via Version Bump**: The `auth_version` increment instantly invalidates all active sessions in `auth_sessions` and outstanding challenges in `auth_challenges`. Background sweeps clean up expired sessions; no manual row deletion is required.
3. **Schema Constraint Compliance**: The `auth_users` table enforces a STRICT CHECK constraint requiring all 5 confirmed factor fields (`mfa_secret_ciphertext`, `mfa_nonce`, `mfa_key_id`, `mfa_enrolled_at_ms`, `mfa_last_accepted_step`) to be NULL simultaneously when MFA is cleared. Attempt rate-limiting fields are reset to clean defaults.
4. **Credential Preservation**: Password hash (`password_hash`), account enablement (`is_enabled`), and assigned role (`role`) remain intact.
5. **No Recovery Codes / Public Reset**: There are no recovery codes and no unauthenticated or authenticated self-service reset endpoints. On next password login, the user will be presented with `enrollmentRequired` and guided through fresh TOTP enrollment.

## Consistent Backup and Disaster Recovery

### SQLite WAL Consistent Backup Procedure

In SQLite lite mode, DamHopper configures Write-Ahead Logging (`PRAGMA journal_mode = WAL`). While the server process is actively running:
- The main database file (`auth.db`), write-ahead log (`auth.db-wal`), and shared-memory index (`auth.db-shm`) form a single atomic storage unit.
- **Never** perform naive file copies (`cp auth.db backup/`) while the server is active, as this risks copying a file with uncheckpointed transactions and inconsistent page headers.

To take a consistent, non-blocking online backup, ensure the backup directory has restricted permissions (`chmod 700`) and use the SQLite Online Backup API via the CLI:

```bash
# Prepare secure backup destination directory
sudo mkdir -p /var/backups/dam-hopper
sudo chown <API_USER>:<API_GROUP> /var/backups/dam-hopper
sudo chmod 700 /var/backups/dam-hopper

# Recommended: Online consistent backup via sqlite3 CLI
sqlite3 /var/lib/dam-hopper/auth.db ".backup /var/backups/dam-hopper/auth-backup-$(date +%Y%m%d%H%M%S).db"

# Alternative: Atomic VACUUM INTO
sqlite3 /var/lib/dam-hopper/auth.db "VACUUM INTO '/var/backups/dam-hopper/auth-vacuum-$(date +%Y%m%d%H%M%S).db'"
```

Both methods lock pages consistently without interrupting active HTTP or WebSocket read requests.

### Key Separation & Backup Security

- **Independent Secret Backup**: The MFA encryption key (`DAM_HOPPER_MFA_KEY_FILE`) and the JWT signing token (`~/.config/dam-hopper/server-token`) must be backed up securely and stored separately from database file snapshots.
- **Permissions**: Restored key files must maintain `chmod 600` permissions. If the key file is lost or destroyed, existing encrypted MFA secrets cannot be decrypted, requiring operator MFA resets for all enrolled users.
### Independent Backend State and Switching / Rollback

- **No Data Migration**: Switching between MongoDB and SQLite lite mode does **not** transfer or synchronize user accounts, passwords, or session tokens.
- **Independent Stores**: Each backend maintains its own independent datastore.
- **Safe Rollback**: If an operator switches to SQLite and subsequently chooses to switch back to MongoDB (by removing `DAM_HOPPER_LITE_MODE=true`), the server seamlessly reconnects to the original MongoDB database, restoring access to all preexisting accounts and credentials intact.
## Historical Archive: Retired Plugin Platform

The trusted plugin platform and external runner daemon (`dam-hopper-plugin-runner`) were decommissioned on 2026-10-02 and superseded by the in-process [Native Evcrate Advisor](../architecture/native-advisor.md).

Former configuration parameters (such as `DAM_HOPPER_PLUGIN_ADMINS_FILE`, `/etc/dam-hopper/plugin-admins.json`, and runner management RPC allowlists) are no longer active. See [Retired Plugin Platform Archive Record](../archive/retired-plugin-platform.md) for architectural provenance and [Linux systemd Operations](../linux-systemd.md) for the host artifact removal runbook (`deploy/remove-plugin-platform.sh`).
