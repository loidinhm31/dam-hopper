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
| `MONGODB_URI` / `MONGODB_DATABASE` / `DAM_HOPPER_MFA_KEY_FILE` | string/path | Optional API auth database; dedicated MFA key required for production authenticated startup. See [Phase 01 auth guide](../phase-01-auth-state-cryptography-and-policy.md). |
| `DAM_HOPPER_PLUGIN_ADMINS_FILE`              | path    | Optional root-seeded plugin administrator JSON override                       |

Plugin management administrators are not configured in `dam-hopper.toml`; the
runner reads this host-owned file before opening its management RPC surface.

`VITE_*` values require a web rebuild. `VITE_DAM_HOPPER_SERVER_URL` is not
allowed for production builds; production API origin is runtime config.
Changing extension parent origins also requires redistributing its generated ZIP.
CORS values are runtime API configuration and must exactly match the browser
origin.

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
`damhopper-auth` cookie where accepted. Never send the signing-secret file as
`Authorization: Bearer`; see [Authentication API](../authentication-api.md).

## MFA Encryption Key and Operator Recovery Runbook

### Key File Provisioning (`DAM_HOPPER_MFA_KEY_FILE`)

In authenticated production mode, `DAM_HOPPER_MFA_KEY_FILE` is mandatory:
- Contains exactly 32 raw bytes (or 64 hexadecimal characters / 44 Base64 characters).
- File permissions must be strictly restricted to the owner (`chmod 600` on Unix). The server rejects symlinks, non-regular files, and files with group or world permissions.
- Dedicated to encrypting confirmed and pending TOTP secrets at rest via AES-256-GCM.
- Must be backed up separately from MongoDB and deployed to all server instances.

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

## Historical: Retired Plugin Management Administrator Allowlist

The plugin-runner allowlist and its configuration precedence below describe the removed plugin platform; they are not current Dam-Hopper server configuration.
Historically, the allowlist was separate from project TOML/MongoDB roles; the runner checked JWT subjects per management RPC.

The runner chooses the first available source:

1. `dam-hopper-plugin-runner --admin-config <path>`
2. `DAM_HOPPER_PLUGIN_ADMINS_FILE`
3. `/etc/dam-hopper/plugin-admins.json`
4. no file → empty list (deny all)

The file accepts either shape:

```json
{"adminSubjects":["alice","ops@example.test"]}
```

or:

```json
["alice","ops@example.test"]
```

Subjects are trimmed, deduplicated, sorted, and hashed into the persisted
`adminConfigDigest`. On Unix, group/world-writable files (`mode & 0o022`) are
rejected. An invalid or unreadable environment/default file logs a warning and
denies all administrators; an explicit `--admin-config` error prevents runner
startup. Keep the file host-owned and outside plugin staging. Configuration
details and management endpoint behavior are in the [D05 plugin architecture](../architecture/plugin-platform-d05.md).

The management API requires `Authorization: Bearer ...` even when the general
API also accepts an HttpOnly cookie. Cookie-only requests return
`BearerRequired`; `--no-auth` returns `NoAuthForbidden`. Login and development
mode never grant plugin administrator access.

