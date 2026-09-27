# Bug Diagnosis: Admin Permissions Restriction, Plugin Invoke EACCES, and Install Failure

**Report:** `plans/reports/debugger-260927-1929-admin-permissions-and-install-failure.md`  
**Date:** 2026-09-27  
**Author:** DebuggerAgent  
**Status:** Complete Root Cause Analysis (Diagnosis Only - No Code or System State Modified)

---

## 1. Executive Summary

Three interconnected issues investigated on `dam-hopper` workstation (`100.91.26.60:4801`):

1. **Settings Page Admin Access Restriction**:
   - *Symptom:* UI displays banner: `"Plugin lifecycle and package management operations are restricted to administrator accounts. Authenticate with an administrator account to view and manage plugins."`
   - *Root Cause:* Two-tiered auth gate in frontend and backend. UI component `PluginManagementSection.tsx` sets `unauthorized = true` when unauthenticated (`checkAuthStatus` returns 401 / `authenticated: false`) OR when `adminList()` catches 401/403/Bearer error. Backend router guards `/api/plugins/admin*` with `require_plugin_admin` middleware requiring MongoDB `UserRole::Admin` (`role: "admin"`) and `is_enabled: true`. Newly registered accounts default to `role: "user"` and `is_enabled: false` via `POST /api/auth/register` with no self-service promotion. In addition, `--no-auth` mode returns `403 NoAuthForbidden`. Only operator-level direct MongoDB update provisions admin role.
2. **Plugin Invoke EACCES (`WorkerFailed`)**:
   - *Symptom:* `POST http://100.91.26.60:4801/api/plugins/invoke` returns `{error: "EACCES: permission denied, lstat '[PATH]'", code: "WorkerFailed"}` (HTTP 503).
   - *Root Cause:* Cross-UID permission mismatch + Linux POSIX ACL mask collapse. Runner service `dam-hopper-plugin-runner` runs as UID 979 (`dam-hopper-plugin-runner`). User project history resides under `/home/loidinh/.evcrate/advisor-history/` owned by UID 1000 (`loidinh`). Newly generated project directory `e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5` created with mode `0700` (`drwx------`). In Linux POSIX ACL semantics, setting `0700` resets ACL mask to `---` (`mask::---`), collapsing effective permission of `user:dam-hopper-plugin-runner:r-x` to `---` (`#effective:---`). Node worker `inspectStat` (`binding.cjs`) calls `fs.lstatSync`, catches only `ENOENT`/`ENOTDIR`, rethrows `EACCES`. `error-mapping.cjs` catches `EACCES`, maps unrecognized code to fallback `WORKER_FAILED`, and redacts path to `'[PATH]'`.
3. **Install Failure on `--plugin-owner-user $(id -un)`**:
   - *Symptom:* `./dam-hopper-install.sh --latest --role both --plugin-owner-user $(id -un)` fails with: `"install failed: configuration error: plugin owner user loidinh cannot be the API service user (loidinh)"`.
   - *Root Cause:* Contradiction between documentation and architectural security invariants. `server/src/linux_release/account.rs:verify_plugin_owner_account` strictly forbids `plugin_owner_user == api_service_user` or matching UIDs to maintain isolation between the API server and untrusted/third-party plugin worker processes. Host configuration `/etc/dam-hopper/host.toml` already records `service_user = "loidinh"`. When passing `--plugin-owner-user $(id -un)` (`loidinh`), both identities resolve to UID 1000 (`loidinh`), triggering hard validation failure. `docs/plugin-platform-linux.md` Scenario A incorrectly recommends running `./dam-hopper-install.sh ... --plugin-owner-user $(id -un)` on developer workstations without noting that `--service-user` must simultaneously be configured to a different account (e.g. `dam-hopper`).

---

## 2. Issue 1: Settings Page Administrator Restriction

### 2.1 UI Component Flow (`PluginManagementSection.tsx`)
Source: `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx`

```
Component Mount / Profile Switch
  │
  ├─► fetchAuth() -> checkAuthStatus(serverUrl, token) -> GET /api/auth/status
  │     │
  │     ├─► If response 401 / unauthenticated / no token / MFA required:
  │     │     setAuthStatus({ authenticated: false, ... })
  │     │     setUnauthorized(true)  ◄───────────────────────────────────┐
  │     │                                                                 │
  │     └─► If response 200:                                              │
  │           setAuthStatus({ authenticated: true, role: result.role, ..})│
  │           setUnauthorized(false)                                      │
  │                                                                       │
  ├─► isAdmin = authStatus?.role === "admin"                              │
  │     │                                                                 │
  │     ├─► If isAdmin == true:                                           │
  │     │     loadInstallations() -> resolvedClient.plugins.adminList()   │
  │     │                              │                                  │
  │     │                              ▼ GET /api/plugins/admin           │
  │     │                         If throws 401 / 403 / Bearer error:     │
  │     │                         catch block: setUnauthorized(true) ─────┘
  │     │
  │     └─► If isAdmin == false:
  │           Skips loadInstallations()
  │           Renders "Non-Administrator Account" warning banner (lines 381-392)
  │
  ▼
If unauthorized == true (lines 343-353):
  Renders <div data-testid="plugin-admin-unauthorized">:
  "Administrator Access Required"
  "Plugin lifecycle and package management operations are restricted to administrator accounts.
   Authenticate with an administrator account to view and manage plugins."
```

### 2.2 Backend Middleware & Router Enforcement (`server/src/api/auth.rs`)
Routes guarded in `server/src/api/router.rs`:
- `GET /api/plugins/admin`
- `GET /api/plugins/admin/installations/{id}`
- `POST /api/plugins/admin/stages`
- `POST /api/plugins/admin/stages/{stageId}/approve`
- `POST /api/plugins/admin/installations/{id}/rollback`
- `POST /api/plugins/admin/installations/{id}/enable`
- `POST /api/plugins/admin/installations/{id}/disable`
- `DELETE /api/plugins/admin/installations/{id}`
- `PUT /api/plugins/admin/installations/{id}/grants`
- `PUT /api/plugins/admin/installations/{id}/bindings`
- `PUT /api/plugins/admin/installations/{id}/owner-history-source`

Middleware stack (outer to inner):
1. `auth::require_auth`: Validates JWT token or dev mode. Rejects absent credentials with `401 Unauthorized` (`AUTH_REQUIRED`).
2. `auth::require_bearer_auth`: Enforces Authorization Bearer header. Rejects cookie credentials with `403 Forbidden` (`BearerRequired`).
3. `auth::require_plugin_admin`:
   - Checks `state.no_auth`: If true, returns `403 Forbidden` with:
     ```json
     {"error": "Plugin management operations are strictly denied in --no-auth mode", "code": "NoAuthForbidden"}
     ```
   - Extracts `AuthenticatedActor` from JWT claims (`actor.subject`).
   - Calls `get_user_role(state.db.as_ref(), &actor.subject)`:
     ```rust
     pub async fn get_user_role(db: Option<&mongodb::Database>, username: &str) -> Option<UserRole> {
         let db = db?;
         let collection = db.collection::<User>("users");
         let user = collection
             .find_one(doc! { "username": username })
             .await
             .ok()?
             .filter(|u| u.is_enabled)?;
         Some(user.role)
     }
     ```
   - Matches role:
     - `Some(UserRole::Admin)` -> Next handler.
     - `Some(UserRole::User)` / disabled / missing -> Returns `403 Forbidden` with:
       ```json
       {"error": "Administrator role required for plugin management operations", "code": "AdminRoleRequired"}
       ```
4. Runner Service Secondary Allowlist (`RunnerServer`):
   Even after passing API middleware, `RunnerServer` cross-checks `actor.subject` against root-seeded `/etc/dam-hopper/plugin-admins.json` (`adminSubjects`). If absent, runner returns `UNAUTHORIZED` (401).

### 2.3 MongoDB Account State & Provisioning Model
- In `server/src/api/auth.rs:register`:
  ```rust
  let new_user = User {
      username,
      password_hash,
      is_enabled: false,       // Hardcoded false
      role: UserRole::User,    // Hardcoded User
      auth_version: 0,
  };
  ```
- Characteristics:
  1. No self-service registration grants admin role.
  2. No HTTP API endpoint exists in `dam-hopper` to promote accounts or modify `role`.
  3. New registrations are disabled by default.
  4. Database query on live cluster (`mongodb+srv://.../damHopper`):
     - Collection `users`:
       ```json
       {
         "_id": "69de861f74070f270574cb6e",
         "username": "loidinhm31",
         "isEnabled": true,
         "role": "admin",
         "authVersion": 0
       }
       ```
     - Only user `loidinhm31` exists in database and is `admin`.
     - Host file `/etc/dam-hopper/plugin-admins.json` lists:
       ```json
       {"adminSubjects": ["loidinhm31", "loidinh"]}
       ```
     - User `loidinh` is in `plugin-admins.json` but **does not exist in MongoDB `users` collection**.
- Summary of why user sees the restriction message:
  - If browser client is not logged in as `loidinhm31` (e.g. unauthenticated, no token in active profile, or logged in as standard user), `checkAuthStatus` returns 401 or `adminList()` returns 403 `AdminRoleRequired`.
  - If server run in `--no-auth` mode, `require_plugin_admin` rejects with 403 `NoAuthForbidden`.
  - In all these cases, `setUnauthorized(true)` is triggered, rendering the restriction message.

---

## 3. Issue 2: POST /api/plugins/invoke EACCES (`WorkerFailed`)

### 3.1 Symptoms & Observed Payload
```http
POST /api/plugins/invoke HTTP/1.1
Host: 100.91.26.60:4801
Content-Type: application/json

{"installationId": "33e2bc19-3a4f-4733-beb7-7d5e675f1edb", "operation": "history.refresh", "payload": {}}

HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "error": "EACCES: permission denied, lstat '[PATH]'",
  "code": "WorkerFailed"
}
```

### 3.2 Process Identity Breakdown
| Service / Process | User | UID | Group | GID |
|---|---|---|---|---|
| `dam-hopper-api.service` (`dam-hopper-server`) | `loidinh` | 1000 | `loidinh` (suppl: `dam-hopper-plugins` 979) | 1000 |
| `dam-hopper-plugin-runner.service` | `dam-hopper-plugin-runner` | 979 | `dam-hopper-plugins` | 979 |
| Node Worker Process (`worker.cjs`) | `dam-hopper-plugin-runner` | 979 | `dam-hopper-plugins` | 979 |
| Workspace & History Files (`/home/loidinh/.evcrate/...`) | `loidinh` | 1000 | `loidinh` | 1000 |

### 3.3 POSIX ACL Mask Collapse Mechanism
Inspection of directories under `/home/loidinh/.evcrate/advisor-history`:
```bash
# Parent directory:
$ getfacl -cp /home/loidinh/.evcrate/advisor-history
user::rwx
user:dam-hopper-plugin-runner:r-x
group::---
mask::r-x
other::---
default:user::rwx
default:user:dam-hopper-plugin-runner:r-x
default:group::---
default:mask::r-x
default:other::---

# Broken project directory:
$ getfacl -cp /home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5
user::rwx
user:dam-hopper-plugin-runner:r-x	#effective:---
group::---
mask::---
other::---
default:user::dam-hopper-plugin-runner:r-x
```

**Why ACL mask collapsed to `mask::---`:**
1. Default ACL on parent applies initial permissions on directory creation.
2. Tools adhering to owner-only security (such as `evcrate`, per `docs/code-standards.md:357` "directories are 0700, files are 0600") execute `chmod 0700` (`chmodSync(path, 0o700)`).
3. POSIX.1e draft specification maps traditional file group permission bits (`stat.st_mode & 0070`) directly to the ACL mask.
4. Setting group bits to `0` (`0700`) sets `mask` to `---`.
5. Under POSIX ACL resolution, effective permission for named user entries equals:
   $$\text{Effective Permission} = \text{Entry Permission} \land \text{Mask}$$
6. For `user:dam-hopper-plugin-runner:r-x`:
   $$\text{r-x} \land \text{---} = \text{---}$$
7. The runner process (UID 979) is stripped of directory traverse (`--x`) and read permissions.

### 3.4 Error Propagation in evcrate Backend
Source: `~/WS/evcrate/plugin/backend/binding.cjs` & `error-mapping.cjs`
1. Worker executes `history-scanner.cjs:scanHistoryRecords`.
2. Scanner loops over project directories in `/home/loidinh/.evcrate/advisor-history/`.
3. Calls `readSafeProjectLabel` -> `inspectStat(filePath)` on `e56187b4.../project-metadata.json`.
4. In `binding.cjs:25-32`:
   ```javascript
   function inspectStat(targetPath) {
     try {
       return fs.lstatSync(targetPath, { bigint: true });
     } catch (err) {
       if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
       throw err; // EACCES is rethrown!
     }
   }
   ```
5. Kernel returns `-EACCES`. `inspectStat` rethrows because `err.code !== 'ENOENT' && err.code !== 'ENOTDIR'`.
6. Exception escapes unhandled to `dispatcher.cjs` and is passed to `toSafePluginError(err)` in `error-mapping.cjs:93-114`.
7. In `error-mapping.cjs`:
   - `CODE_MAPPING['EACCES']` is `undefined`.
   - `PluginErrorCode['EACCES']` is `undefined`.
   - Mapped code defaults to fallback `PluginErrorCode.WORKER_FAILED` (`WorkerFailed`).
   - `sanitizeMessage` redacts `/home/loidinh/...` to `'[PATH]'`.
8. Framed JSON-RPC error returned to `dam-hopper-server`. Server maps `WorkerFailed` to HTTP 503.

---

## 4. Issue 3: Installer Failure on `--plugin-owner-user $(id -un)`

### 4.1 Invocation & Exact Failure
Command executed:
```bash
./dam-hopper-install.sh --latest --role both --plugin-owner-user $(id -un)
```
Output:
```text
install failed: configuration error: plugin owner user loidinh cannot be the API service user (loidinh)
```

### 4.2 Code Trace in Release Manager (`server/src/linux_release/`)
1. **Invocation**:
   `$(id -un)` evaluates to `loidinh`. Script executes:
   `dam-hopper install --bundle /tmp/... --role both --plugin-owner-user loidinh`
2. **Configuration Loading** (`server/src/linux_release/stage.rs:determine_host_role_with_plugins`):
   - Reads existing `/etc/dam-hopper/host.toml`.
   - Current content:
     ```toml
     role = "both"
     allowed_web_origins = ["http://localhost:4802"]
     service_user = "loidinh"
     ```
   - Sets `existing_service_user = Some("loidinh")`.
   - Sets `plugin_owner_user = Some("loidinh")`.
3. **Unit Rendering Context** (`server/src/linux_release/stage_units.rs:render_release_units`):
   - Resolves `service_user`: `super::account::resolve_service_user(explicit_user, true)` returns `"loidinh"`.
   - Resolves `selected_owner`: `host_config.plugin_owner_user` is `"loidinh"`.
   - Calls `super::account::ensure_plugin_runner_account(Some("loidinh"), &service_user)`:
     ```rust
     pub fn ensure_plugin_runner_account(
         owner: Option<&str>,
         api_user: &str,
     ) -> Result<UserInfo, ReleaseError> {
         if let Some(owner) = owner {
             return verify_plugin_owner_account(owner, Some(api_user));
         }
         ...
     }
     ```
4. **Validation Rejection** (`server/src/linux_release/account.rs:406-465`):
   ```rust
   pub fn verify_plugin_owner_account(
       owner_username: &str,
       api_username: Option<&str>,
   ) -> Result<UserInfo, ReleaseError> {
       ...
       if let Some(api_user) = api_username {
           if trimmed == api_user.trim() {
               return Err(ReleaseError::Config(format!(
                   "plugin owner user '{trimmed}' cannot be the API service user ('{api_user}')"
               )));
           }
       }
       ...
       if let Some(api_user) = api_username {
           if let Some(api_info) = get_user_by_name(api_user.trim()) {
               if user.uid == api_info.uid {
                   return Err(ReleaseError::Config(format!(
                       "plugin owner user '{trimmed}' cannot share UID {} with API service user '{api_user}'",
                       user.uid
                   )));
               }
           }
       }
       ...
   }
   ```
5. Result: Returns `ReleaseError::Config("plugin owner user 'loidinh' cannot be the API service user ('loidinh')")`.

### 4.3 Documentation Contradiction vs Security Design
- **Documentation Error** in `docs/plugin-platform-linux.md:68-76`:
  ```markdown
  ### Scenario A: Single-User Developer Workstation (Recommended)

  If the server is your personal development machine, run the runner under your own account:

  ./dam-hopper-install.sh --latest --role both --plugin-owner-user $(id -un)

  Because the runner shares your UID, it can access all your workspaces and ~/.evcrate files naturally without opening permissions.
  ```
- **Why Release Manager Rejects Same User:**
  1. **Process Isolation / Sandboxing:** API server runs web endpoints, parses client inputs, loads database credentials, and stores secrets. Plugin runner executes external Node.js worker processes running untrusted or third-party code.
  2. **Memory / Signal Protection:** If both services share UID 1000, plugin worker processes can inspect `/proc/<api_pid>/`, attach via `ptrace`, send arbitrary signals (`SIGSTOP`/`SIGKILL`), and access API private files (`sessions.db`, `server.env`, MFA keys).
  3. **Socket Peer Credential Authentication:** Transport between API server and runner (`/run/dam-hopper/plugin-runner.sock`) uses `SO_PEERCRED`. The runner enforces `expected_api_uid` to distinguish authorized API calls from unauthorized callers. Same-UID eliminates identity boundaries.
- **The Conflict:**
  Scenario A documentation promises single-user UID parity, but ignores that `dam-hopper-api` was deployed under `service_user = "loidinh"`. The release manager enforces strict identity separation, making Scenario A impossible as written unless `--service-user` is changed to a separate account.

---

## 5. Interaction Between Issues

```
                    ┌──────────────────────────────────────────────┐
                    │ Operator sets service_user = "loidinh" (API) │
                    │ /etc/dam-hopper/host.toml                    │
                    └──────────────────────┬───────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │                                     │
                        ▼                                     ▼
        Runner installed as default              Operator tries Scenario A fix:
        dam-hopper-plugin-runner (UID 979)       --plugin-owner-user loidinh
                        │                                     │
                        ▼                                     ▼
        Workspace & history owned by            verify_plugin_owner_account fails:
        loidinh (UID 1000)                      "cannot be the API service user"
                        │                                     │
                        ▼                                     ▼
        chmod 0700 collapses ACL mask           [Issue 3: Install Failure]
        mask::--- (#effective:---)
                        │
                        ▼
        inspectStat fails with EACCES;
        bubbles up as WorkerFailed
                        │
                        ▼
        [Issue 2: Plugin Invoke EACCES]
                        ▲
                        │
       Operator attempts Settings UI to fix/manage:
                        │
                        ▼
        API guards /api/plugins/admin* with
        require_plugin_admin (UserRole::Admin);
        MongoDB register defaults role: "user";
        UI catches 401/403 -> unauthorized: true
                        │
                        ▼
        [Issue 1: Settings Admin Restriction]
```

---

## 6. Actionable Remediation Paths (Non-Destructive)

### Remediation for Issue 1 (Settings Admin Access)

#### Path 1A: Promote User to Admin in MongoDB (Recommended)
To grant an existing account (`loidinhm31` or any newly registered username) administrative privileges:
```bash
# Connect to MongoDB and update user record
mongosh "$MONGODB_URI$MONGODB_DATABASE" --eval '
  db.users.updateOne(
    { username: "loidinhm31" },
    { $set: { is_enabled: true, role: "admin" } }
  );
'
```
*Verification:*
- `db.users.findOne({ username: "loidinhm31" })` returns `"role": "admin"` and `"isEnabled": true`.
- User logs in via web UI (`/login`); `checkAuthStatus` returns `{ authenticated: true, role: "admin" }`.
- `isAdmin` becomes true in `PluginManagementSection.tsx`; `loadInstallations()` executes and displays installed plugins table.

#### Path 1B: Ensure Subject in `/etc/dam-hopper/plugin-admins.json`
Confirm the username is present in `/etc/dam-hopper/plugin-admins.json`:
```json
{
  "adminSubjects": [
    "loidinhm31",
    "loidinh"
  ]
}
```
If adding a new administrator, add to `adminSubjects` array and restart `dam-hopper-plugin-runner.service`.

---

### Remediation for Issue 2 (Plugin Invoke EACCES)

#### Path 2A: Repair and Reapply POSIX ACLs on Advisor History (Immediate Operational Fix)
Restore effective traversal and read access for `dam-hopper-plugin-runner` across all history records:
```bash
# Repair mask and user ACL on existing files and directories
sudo setfacl -R -m u:dam-hopper-plugin-runner:rX,m::rX /home/loidinh/.evcrate/advisor-history

# Ensure default ACLs inherit mask and user access for future directories
sudo setfacl -R -d -m u:dam-hopper-plugin-runner:rX,m::rX /home/loidinh/.evcrate/advisor-history
```
*Note on recurring issue:* Any external CLI command executing `chmod 0700` directly on a subdirectory will clear `mask` back to `---`. For permanent resilience, combine with Path 2B.

#### Path 2B: Harden Worker Error Handling in `evcrate` (Code Fix)
In `/home/loidinh/WS/evcrate/plugin/backend/binding.cjs`:
Allow `inspectStat` to treat `EACCES` as non-fatal during metadata probes:
```javascript
function inspectStat(targetPath) {
  try {
    return fs.lstatSync(targetPath, { bigint: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EACCES') return null;
    throw err;
  }
}
```
And in `history-scanner.cjs`: Wrap individual project discovery in `try/catch` and record diagnostic event (`PERMISSION_DENIED`) instead of aborting entire history refresh.

---

### Remediation for Issue 3 (Installer Same-User Conflict)

#### Path 3A: Deploy Distinct API Service User (Preserve Scenario A Runner Ownership)
If the goal is to have `dam-hopper-plugin-runner` run directly as developer user `loidinh` (so it accesses `~/.evcrate` and `~/WS/*` without ACLs):
1. Allocate or use dedicated system user for API server (e.g. `dam-hopper`):
   ```bash
   sudo useradd -r -M -s /sbin/nologin -d /var/lib/dam-hopper dam-hopper || true
   sudo usermod -a -G dam-hopper-plugins dam-hopper
   ```
2. Run installation specifying distinct identities:
   ```bash
   ./dam-hopper-install.sh --latest --role both \
     --service-user dam-hopper \
     --plugin-owner-user loidinh \
     --reinstall
   ```
3. API service runs as `dam-hopper`, plugin runner runs as `loidinh`. No cross-UID collision; validation passes.

#### Path 3B: Retain Dedicated Runner User (Standard Sandboxed Deployment)
If `dam-hopper-api` must run as `loidinh`:
1. Do not pass `--plugin-owner-user loidinh`. Allow runner to default to `dam-hopper-plugin-runner`:
   ```bash
   ./dam-hopper-install.sh --latest --role both \
     --service-user loidinh \
     --reinstall
   ```
2. Maintain filesystem access using POSIX ACLs as described in Path 2A.

#### Path 3C: Documentation Correction in `docs/plugin-platform-linux.md`
Update `docs/plugin-platform-linux.md:68-76` Scenario A to accurately reflect the security invariant:
```markdown
### Scenario A: Single-User Developer Workstation

If running the plugin runner under your developer account (`--plugin-owner-user $(id -un)`),
the API service must be assigned to a separate dedicated account (e.g. `--service-user dam-hopper`):

./dam-hopper-install.sh --latest --role both \
  --service-user dam-hopper \
  --plugin-owner-user $(id -un)

The release manager strictly forbids --plugin-owner-user matching --service-user.
```

---

## 7. Supporting Evidence Log Excerpts

### 7.1 POSIX ACL Mask Collapse Proof
```text
$ getfacl -cp /home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5
user::rwx
user:dam-hopper-plugin-runner:r-x	#effective:---
group::---
mask::---
other::---
default:user:dam-hopper-plugin-runner:r-x
```

### 7.2 MongoDB State Verification
```json
// Database: damHopper, Collection: users
{
  "_id": "69de861f74070f270574cb6e",
  "username": "loidinhm31",
  "isEnabled": true,
  "role": "admin",
  "authVersion": 0
}
```

### 7.3 Release Manager Validation Rule (`server/src/linux_release/account.rs:430-436`)
```rust
if let Some(api_user) = api_username {
    if trimmed == api_user.trim() {
        return Err(ReleaseError::Config(format!(
            "plugin owner user '{trimmed}' cannot be the API service user ('{api_user}')"
        )));
    }
}
```

---

## 8. Unresolved Questions

1. Should `dam-hopper` introduce an operator bootstrap CLI command (e.g. `dam-hopper admin create <user>` or `dam-hopper admin promote <user>`) to configure admin roles without requiring direct manual MongoDB query access?
2. In single-user developer workstation setups, should the default installation template assign `--service-user dam-hopper` rather than prompting and defaulting to the interactive host user, thereby avoiding conflict when `--plugin-owner-user $(id -un)` is supplied?
3. Should `evcrate`'s filesystem writer utilities avoid calling `chmod 0700` when existing directory POSIX default ACLs are detected, or should `chmod` explicitly calculate and preserve the ACL mask (`mask::rX`)?
