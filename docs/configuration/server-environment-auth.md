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

| Var                                        | Type    | Purpose                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DAM_HOPPER_CONFIG`                        | path    | Load an exact `dam-hopper.toml` registry file                                                                                                                                                                                                                                                       |
| `DAM_HOPPER_WORKSPACE`                     | path    | Legacy workspace path/discovery fallback                                                                                                                                                                                                                                                            |
| `DAM_HOPPER_PORT`                          | number  | API listen port (direct/Docker default 4800; systemd sets 4801)                                                                                                                                                                                                                                     |
| `DAM_HOPPER_HOST`                          | string  | API bind address (default `0.0.0.0`)                                                                                                                                                                                                                                                                |
| `DAM_HOPPER_CORS_ORIGINS`                  | string  | Comma-separated exact HTTP(S) origins for credentialed API/WS CORS                                                                                                                                                                                                                                  |
| `DAM_HOPPER_WEB_DIR`                       | path    | Explicit API combined-mode static root; Docker sets `/opt/dam-hopper/web`                                                                                                                                                                                                                           |
| `DAM_HOPPER_NO_AUTH`                       | boolean | Development-only API auth bypass                                                                                                                                                                                                                                                                    |
| `DAM_HOPPER_WEB_ROOT`                      | path    | Dedicated `dam-hopper-web` static root                                                                                                                                                                                                                                                              |
| `DAM_HOPPER_WEB_HOST`                      | string  | Dedicated web bind address (default `0.0.0.0`)                                                                                                                                                                                                                                                      |
| `DAM_HOPPER_WEB_PORT`                      | number  | Dedicated web listen port (default `4802`)                                                                                                                                                                                                                                                          |
| `DAM_HOPPER_WEB_RUNTIME_CONFIG`            | path    | Optional public runtime-config JSON file                                                                                                                                                                                                                                                            |
| `DAM_HOPPER_WEB_RELEASE_VERSION`           | string  | Optional web health release-version override                                                                                                                                                                                                                                                        |
| `VITE_DAM_HOPPER_LOG_LEVEL`                | string  | Web bootstrap log level, embedded at build time                                                                                                                                                                                                                                                     |
| `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` | string  | Exact extension parent origins, embedded at build time                                                                                                                                                                                                                                              |
| `RUST_LOG`                                 | string  | Rust logging filter                                                                                                                                                                                                                                                                                 |
| `MONGODB_URI` / `MONGODB_DATABASE`         | string  | MongoDB connection URI and database name. When both are set and non-blank, MongoDB is selected automatically.                                                                                                                                                                                       |
| `DAM_HOPPER_LITE_MODE`                     | boolean | Optional backend selector. Set `true` (or `1`) to force SQLite even if Mongo variables are present. Set `false` (or `0`) to enforce MongoDB (missing Mongo variables abort startup). Unset/empty defaults to SQLite when Mongo variables are unset, or selects MongoDB when both variables are set. |
| `DAM_HOPPER_AUTH_SQLITE_PATH`              | path    | Optional SQLite database file path. Defaults to `auth.db` in global DamHopper config directory (`~/.config/dam-hopper/auth.db`).                                                                                                                                                                    |
| `DAM_HOPPER_MFA_KEY_FILE`                  | path    | Dedicated 32-byte MFA encryption key for encrypting TOTP secrets at rest via AES-256-GCM. Mandatory in production authenticated mode (both MongoDB and SQLite). See [Authentication State & Cryptography](../architecture/authentication-state-and-cryptography.md).                                |

`VITE_*` values require a web rebuild. `VITE_DAM_HOPPER_SERVER_URL` is not
allowed for production builds; production API origin is runtime config.
Changing extension parent origins also requires redistributing its generated ZIP.
CORS values are runtime API configuration and must exactly match the browser
origin.

## Storage Backend Selection and Precedence Matrix

DamHopper supports two production-grade authenticated storage backends within the same compiled binary:

1. **SQLite (Default for Unconfigured Startup)**: Selected automatically when both `MONGODB_URI` and `MONGODB_DATABASE` are unset, or forced explicitly via `DAM_HOPPER_LITE_MODE=true` (or `1`). Provides full security parity with zero external dependencies.
2. **MongoDB**: Selected automatically when both `MONGODB_URI` and `MONGODB_DATABASE` are configured (set and non-blank), or explicitly enforced via `DAM_HOPPER_LITE_MODE=false` (or `0`).

### Complete Precedence Matrix

| `DAM_HOPPER_LITE_MODE`         | `MONGODB_URI` & `MONGODB_DATABASE`              | Selected Backend        | Behavior / Contract                                                                      |
| ------------------------------ | ----------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `true` / `1`                   | Any (including malformed, blank, or partial)    | **SQLite (explicit)**   | Forced SQLite; ignores MongoDB environment variables.                                    |
| `false` / `0`                  | Both set and non-empty/non-whitespace           | **MongoDB (enforced)**  | Enforces MongoDB. Startup issues a bounded ping.                                         |
| `false` / `0`                  | Either unset, empty, whitespace, or malformed   | **Fatal Error**         | Operator explicitly disabled lite mode but omitted valid Mongo config. Aborts startup.   |
| Unset / empty / whitespace     | Both set and non-empty/non-whitespace           | **MongoDB (automatic)** | Auto-selects MongoDB because complete Mongo configuration is supplied.                   |
| Unset / empty / whitespace     | Both genuinely unset                            | **SQLite (default)**    | **Default**: Zero-config startup defaults to local SQLite `auth.db`.                     |
| Unset / empty / whitespace     | Any other combination (e.g. set-blank, partial) | **Fatal Error**         | Incomplete or malformed MongoDB configuration; fails startup with actionable diagnostic. |
| Invalid string (e.g. `banana`) | Any                                             | **Fatal Error**         | Invalid boolean syntax; fails startup immediately.                                       |

### Configuration Semantics: Unset vs Set-Empty

- **Genuinely Unset**: Variable is absent from process environment (`std::env::var_os(...)` is `None`). Only when **both** `MONGODB_URI` and `MONGODB_DATABASE` are genuinely unset does the server default to SQLite.
- **Set-Empty or Whitespace-Only**: If either variable is defined as an empty string or whitespace (e.g. `MONGODB_URI=""`), it is treated as a **malformed configuration error**, aborting startup with an actionable error message rather than silently defaulting to SQLite.
- **Startup MongoDB Ping**: When MongoDB is selected, startup executes a bounded ping (`admin.run_command(doc! { "ping": 1 })`). An unreachable or unauthenticated Mongo server causes startup to abort within the connection timeout and never creates an SQLite fallback.
- **Startup Observability Logs**:
  - Unconfigured SQLite: `Authentication backend: SQLite (default — MONGODB_URI not set)` with `reason = "MongoDB variables unset"`.
  - Explicit SQLite: `Authentication backend: SQLite (explicit)` with `reason = "DAM_HOPPER_LITE_MODE"`.
  - MongoDB: `Authentication backend: MongoDB`.

### Dotenv Precedence and Path Resolution

- **Dotenv Precedence**: `dotenv::dotenv()` only populates variables not already present in the process environment. Pre-existing system environment variables (such as those supplied by systemd `EnvironmentFile=/etc/dam-hopper/server.env` or exported in the host shell) take precedence over values in working directory `.env` files.
- **Path Resolution (`DAM_HOPPER_AUTH_SQLITE_PATH`)**: Applies when SQLite is selected. Relative paths resolve relative to the server process current working directory (CWD) at startup. In production or daemon deployments, always specify an absolute path on local persistent storage (e.g. `/var/lib/dam-hopper/auth.db`).
- **Default SQLite Storage**: When `DAM_HOPPER_AUTH_SQLITE_PATH` is omitted or empty, the server defaults to `auth.db` in the global DamHopper configuration directory (`~/.config/dam-hopper/auth.db` on Linux/macOS, or `%APPDATA%\dam-hopper\auth.db` on Windows).
  - **Subsystem Isolation**: `auth.db` is strictly dedicated to authentication, credentials, and session state. It is completely isolated from PTY/IDE session state (`~/.config/dam-hopper/sessions.db`) and telemetry state (`~/.config/dam-hopper/telemetry.db`).

### Production Safety Guards

- **Production Mode Enforcement**: When running in production (`RUST_ENV=production` or `ENVIRONMENT=production`), the server enforces strict backend readiness:
  - If MongoDB is selected, `MONGODB_URI` and `MONGODB_DATABASE` must be provided, reachable, and authenticated.
  - If SQLite is selected, the configured database file and parent directory must be writable and accessible. SQLite open or migration failure is always fatal and aborts startup immediately.
  - In both backends, `DAM_HOPPER_MFA_KEY_FILE` pointing to a valid dedicated 32-byte key file with strict owner-only permissions (`0600` on Unix) is mandatory.
- **Development Auth Bypass (`--no-auth`)**: The `--no-auth` CLI flag (or `DAM_HOPPER_NO_AUTH=1`) is a separate loopback development bypass that skips authentication store initialization and issues a development token. **It is never SQLite mode.** The server refuses to start with `--no-auth` if an authentication store is initialized or if running in production mode.

### Deployment Limits: Single Server Process per Auth File

**Validated deployment limit: exactly one server process per local auth file.**

SQLite operates in WAL mode (`PRAGMA journal_mode = WAL`) and supports concurrent asynchronous read queries alongside serialized write transactions within a single server process. However:

- Multiple DamHopper server processes sharing the same SQLite auth file on a single host or across hosts are **not supported**.
- Network-shared filesystems (NFS, SMB, CIFS, GlusterFS) must **not** be used for `auth.db` due to POSIX advisory lock inconsistencies and WAL flush latency.
- Clustered or load-balanced deployments with multiple API instances must use MongoDB.
- Separate DamHopper server deployments or test instances must be configured with separate, dedicated SQLite database paths.

## Offline Administrator Provisioning Runbook

### Direct Account Provisioning (No Public Registration API)

To prevent unauthorized user creation, account enumeration, and denial-of-service risks, **DamHopper does not expose a public registration endpoint over HTTP (`POST /api/auth/register` is permanently removed)**.

Administrator and user accounts must be provisioned locally/offline on the host machine using the provided `create-admin` script. The script hashes passwords using `bcrypt` and inserts enabled admin records directly into the SQLite authentication database.

### Development Profile

When running locally on loopback (`127.0.0.1:4801` with default SQLite at `~/.config/dam-hopper/auth.db`):

#### 1. Generate the MFA Encryption Key

Generate a 32-byte MFA encryption key with owner-only (`0600`) permissions and configure `DAM_HOPPER_MFA_KEY_FILE`:

```bash
mkdir -p ~/.config/dam-hopper && chmod 700 ~/.config/dam-hopper
[ ! -f ~/.config/dam-hopper/mfa-encryption.key ] && (umask 077 && openssl rand -hex 32 > ~/.config/dam-hopper/mfa-encryption.key)
export DAM_HOPPER_MFA_KEY_FILE=~/.config/dam-hopper/mfa-encryption.key
```

#### 2. Provision the Admin Account

Run the offline provisioning script:

```bash
pnpm create-admin
# Or pass arguments directly:
node scripts/create-admin.mjs admin "ReplaceWithStrongPassword!"
```

The script:

- Initializes the SQLite database and schema if not yet present with secure file permissions (`0600`).
- Validates database identity (`application_id` and schema version) and rejects foreign or insecure databases.
- Validates that the username does not already exist.
- Generates a 24-character hexadecimal ID and standard bcrypt hash.
- Inserts the user as active (`is_enabled = 1`) with role `'admin'`.

#### 3. Start DamHopper Server

```bash
DAM_HOPPER_MFA_KEY_FILE=~/.config/dam-hopper/mfa-encryption.key \
  cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4801
```

#### 4. Log In and Complete First-Time TOTP Setup

1. Navigate to the Web UI or call `POST http://127.0.0.1:4801/api/auth/login` with your username and password:
   ```bash
   curl -s -X POST http://127.0.0.1:4801/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username": "admin", "password": "ReplaceWithStrongPassword!"}'
   ```
2. Because no TOTP factor is enrolled yet (`mfa_enrolled_at_ms` is `NULL`), the response returns HTTP 200 with `state: "enrollmentRequired"` and a `challengeToken`.
3. Call `POST /api/auth/mfa/setup` with the challenge token to retrieve the TOTP enrollment secret and URI (or view the QR code in the Web UI / via `GET /api/auth/mfa/enrollment-qr?token=<challengeToken>`):
   ```bash
   curl -s -X POST http://127.0.0.1:4801/api/auth/mfa/setup \
     -H "Content-Type: application/json" \
     -d '{"challengeToken": "<CHALLENGE_TOKEN>"}'
   ```
4. Scan the TOTP QR code or import the Base32 secret into your authenticator app (Google Authenticator, 1Password, Authy) and submit the 6-digit verification code via `POST /api/auth/mfa/confirm`:
   ```bash
   curl -s -X POST http://127.0.0.1:4801/api/auth/mfa/confirm \
     -H "Content-Type: application/json" \
     -d '{"challengeToken": "<CHALLENGE_TOKEN>", "code": "<6-DIGIT-CODE>"}'
   ```
   The response returns HTTP 200 with `state: "authenticated"` and your session token.

---

### Deployment / Production Profile

On a production deployment (e.g. `dam-hopper-api.service` with SQLite at `/var/lib/dam-hopper/auth.db`):

#### 1. Provision the Admin Account Offline as the API User

Run `create-admin.mjs` pointing to the production database:

```bash
sudo -u <API_USER> DAM_HOPPER_AUTH_SQLITE_PATH=/var/lib/dam-hopper/auth.db \
  node scripts/create-admin.mjs <target-username> "ReplaceWithStrongPassword!"
```

This writes the admin account directly to `/var/lib/dam-hopper/auth.db` preserving correct service-user ownership.

#### 2. Ensure Production MFA Key is Configured

Production authenticated mode requires a dedicated 32-byte MFA encryption key:

```bash
openssl rand -hex 32 | sudo tee /etc/dam-hopper/mfa-encryption.key > /dev/null
sudo chown <API_USER>:<API_GROUP> /etc/dam-hopper/mfa-encryption.key
sudo chmod 600 /etc/dam-hopper/mfa-encryption.key
```

Ensure `DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key` is present in `/etc/dam-hopper/server.env`.

#### 3. First Login & TOTP Enrollment

Log in from the host or through the secured reverse proxy; complete TOTP confirmation on first login.

### MongoDB Operator Procedure (`mongosh`)

Connect via `mongosh` to the configured MongoDB database:

#### 1. Inspect Pending Accounts

```javascript
db.users.findOne(
  { username: "<target-username>" },
  { _id: 1, username: 1, isEnabled: 1, role: 1, authVersion: 1 },
);
```

#### 2. Approve and Promote

```javascript
const userId = ObjectId("<verified-24-hex-id>");
const expectedVersion = NumberLong("<observed-authVersion>");

// Promote to admin
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  { $set: { isEnabled: true, role: "admin" } },
);

// Or approve as standard user
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  { $set: { isEnabled: true, role: "user" } },
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
    $unset: {
      mfa: "",
      mfaAttemptWindowStartedAt: "",
      mfaAttemptCount: "",
      mfaBlockedUntil: "",
    },
  },
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

The trusted plugin platform and external runner daemon (`dam-hopper-plugin-runner`) were decommissioned on 2026-10-02.

Former configuration parameters (such as `DAM_HOPPER_PLUGIN_ADMINS_FILE`, `/etc/dam-hopper/plugin-admins.json`, and runner management RPC allowlists) are no longer active. See [Retired Plugin Platform Archive Record](../archive/retired-plugin-platform.md) for architectural provenance and [Linux systemd Operations](../linux-systemd.md) for the host artifact removal runbook (`deploy/remove-plugin-platform.sh`).
