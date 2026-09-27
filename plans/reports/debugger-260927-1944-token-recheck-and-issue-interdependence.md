# Diagnostic Report: Token Re-check and Issue Interdependence Analysis

**Report:** `plans/reports/debugger-260927-1944-token-recheck-and-issue-interdependence.md`  
**Date:** 2026-09-27  
**Author:** DebuggerAgent  
**Status:** Complete Diagnostic Verification (No Code or System State Modified)

---

## 1. Executive Summary

Two specific technical questions investigated:

1. **Token Re-check & UI Restriction Banner Paradox**:
   - *Token & Backend:* Claims decoded from user session (`sub: "loidinhm31"`, `sid: "2e2d9370-395a-488e-9b95-00cf85217b64"`, `v: 2`, `authVersion: 0`, `credentialVersion: 1`, `iat: 1790511655`, `exp: 1793103655`). Verified against live MongoDB database `damHopper`. Account `loidinhm31` has `isEnabled: true`, `role: "admin"`, active session not revoked (`revokedAt: null`), MFA fresh. Axum backend `evaluate_claims()` evaluates to `AuthDecision::Authenticated` with `role: "admin"`. Backend fully authorizes this token.
   - *Why UI Still Displays Restriction Banner:* Four client-side transport/binding failure modes trigger `setUnauthorized(true)` in `PluginManagementSection.tsx`:
     1. **`settingsProfileId === null` default:** `SettingsPage.tsx` passes `profileId={settingsProfileId}`, which defaults to `null`. `getAuthToken(undefined)` explicitly returns `null` (no fallback to active profile).
     2. **Cookie omission in `checkAuthStatus`:** `fetch('/api/auth/status')` uses `credentials: "omit"`. With `token: null`, request arrives at server completely uncredentialed $\rightarrow$ 401 Unauthorized $\rightarrow$ `setUnauthorized(true)`.
     3. **Strict endpoint binding mismatch:** `getAuthToken()` rejects tokens if active profile `serverUrl` or `authType` differ from storage record.
     4. **Bearer header requirement:** If authenticated only via cookie (`damhopper_auth`), backend `require_bearer_auth` rejects `/api/plugins/admin*` with `403 BearerRequired`. The catch block in `adminList()` matches `"Bearer"` or `"403"` and sets `setUnauthorized(true)`.

2. **Interdependence Between Issue 2 and Issue 3**:
   - *Question:* "For issue 2, if issue 3 fix, can issue 2 can fix too?"
   - *Answer:* **YES.** If Issue 3 is fixed by configuring `--plugin-owner-user loidinh` (with `--service-user dam-hopper`), Issue 2 is **completely and permanently eliminated**.
   - *Filesystem / Kernel Proof:* Runner runs as UID 1000 (`loidinh`). Target directories and files under `/home/loidinh/.evcrate/advisor-history/` are 100% owned by UID 1000 (`loidinh`). In Linux VFS / POSIX.1e access check (`man 5 acl`, kernel `fs/namei.c:generic_permission`), owner check is evaluated first against `user::rwx`. The ACL mask (`ACL_MASK`) applies **only to named users and groups**; the file owner is **strictly exempt from ACL mask evaluation**. Setting mode `0700` (`mask::---`) has zero effect on UID 1000. `fs.lstatSync` succeeds immediately without `EACCES`.
   - *Alternative (Keeping runner UID 979):* Fragile. Every newly generated directory with mode `0700` collapses ACL mask to `---`, instantly cutting off UID 979 and re-triggering `WorkerFailed` (503). Requires ongoing ACL fixups or intrusive `evcrate` codebase patches.

---

## 2. Issue 1: Live MongoDB Verification & Token Policy Evaluation

### 2.1 Live MongoDB Inspection

Direct query against production database `damHopper`:

#### Collection: `users`
```json
{
  "_id": { "$oid": "69de861f74070f270574cb6e" },
  "username": "loidinhm31",
  "passwordHash": "[REDACTED]",
  "isEnabled": true,
  "role": "admin",
  "authVersion": 0,
  "mfa": {
    "secretCiphertext": "[REDACTED]",
    "nonce": "[REDACTED]",
    "keyId": "mfa-encryption",
    "enrolledAt": { "$date": "2026-09-27T12:20:55.628Z" },
    "lastAcceptedStep": 59683721
  }
}
```

#### Collection: `authSessions`
```json
{
  "_id": "2e2d9370-395a-488e-9b95-00cf85217b64",
  "username": "loidinhm31",
  "authVersion": 0,
  "credentialVersion": 1,
  "issuedAt": { "$date": "2026-09-27T12:20:55.628Z" },
  "expiresAt": { "$date": "2026-10-27T12:20:55.628Z" },
  "mfaVerifiedAt": { "$date": "2026-09-27T12:20:55.628Z" },
  "revokedAt": null
}
```

### 2.2 Token Claims Trace

User token claims:
```json
{
  "v": 2,
  "sub": "loidinhm31",
  "sid": "2e2d9370-395a-488e-9b95-00cf85217b64",
  "authVersion": 0,
  "credentialVersion": 1,
  "iat": 1790511655,
  "exp": 1793103655
}
```

Evaluation against `server/src/auth/policy.rs:98-177` (`evaluate_session_policy`):

| Policy Step | Code Reference | Condition | Live Database / Claims Value | Result |
|---|---|---|---|---|
| 1. Account Enabled | `policy.rs:105` | `user.is_enabled` | `isEnabled: true` | **PASS** |
| 2. Protocol Version | `policy.rs:112` | `claims.v == AUTH_PROTOCOL_VERSION` | `claims.v == 2`, `AUTH_PROTOCOL_VERSION == 2` | **PASS** |
| 3. Subject & SID Match | `policy.rs:119` | `claims.sub == user.username && claims.sub == session.username && claims.sid == session.id` | `"loidinhm31" == "loidinhm31"`, `"2e2d9370..." == "2e2d9370..."` | **PASS** |
| 4. Auth Version Match | `policy.rs:126` | `session.auth_version == user.auth_version && claims.auth_version == user.auth_version` | `session: 0`, `user: 0`, `claims: 0` | **PASS** |
| 5. Credential Version | `policy.rs:133` | `claims.credential_version == session.credential_version` | `claims: 1`, `session: 1` | **PASS** |
| 6. Revocation Check | `policy.rs:140` | `session.revoked_at.is_none()` | `revokedAt: null` | **PASS** |
| 7. Expiry Agreement | `policy.rs:150` | `claims.exp == expires_at.timestamp()` | `1793103655 == 1793103655` (2026-10-27T12:20:55Z) | **PASS** |
| 8. Absolute Lifetime | `policy.rs:157` | `now < expires_at` | Current time `1790513367 < 1793103655` | **PASS** |
| 9. MFA Freshness | `policy.rs:165` | `now < mfa_due_at` | Issued 2026-09-27, MFA verified 2026-09-27, due in 10 days | **PASS** |

**Conclusion:** Backend evaluation yields `AuthDecision::Authenticated { session, user }` with `user.role == UserRole::Admin`. Axum backend middleware (`require_auth`, `require_bearer_auth`, `require_plugin_admin`) 100% validates and admits this token.

---

## 3. UI Transport & Binding Failure Mode Analysis

Why does the Settings page show:  
`"Plugin lifecycle and package management operations are restricted to administrator accounts. Authenticate with an administrator account to view and manage plugins."`?

### 3.1 Exact UI Trigger Site

In `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx:343-352`:
```tsx
if (unauthorized) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-6 text-sm text-muted-foreground" data-testid="plugin-admin-unauthorized">
      <div className="font-medium text-foreground mb-1">Administrator Access Required</div>
      <p>
        Plugin lifecycle and package management operations are restricted to administrator accounts.
        Authenticate with an administrator account to view and manage plugins.
      </p>
    </div>
  );
}
```
Banner renders if and only if state variable `unauthorized === true`.

`setUnauthorized(true)` is invoked at only two points in the component lifecycle:

```
[Point A: Line 104]
fetchAuth() -> checkAuthStatus(serverUrl, token)
  -> if result.authenticated === false -> setUnauthorized(true)

[Point B: Line 151]
loadInstallations() -> resolvedClient.plugins.adminList()
  -> catch (err) if err contains "401", "403", "authorized", or "Bearer" -> setUnauthorized(true)
```

### 3.2 Four Root Failure Modes Causing `unauthorized === true`

#### Failure Mode 1: Default `settingsProfileId === null` in `SettingsPage.tsx`
1. `SettingsPage.tsx:411` mounts `<PluginManagementSection profileId={settingsProfileId} />`.
2. `settingsProfileId` is read from `useWorkbenchSelectionsStore` (initialized via `readInitialSettingsTarget()`, returning `null` when no explicit profile target has been chosen in the UI).
3. The server target dropdown at `SettingsPage.tsx:251` defaults to `""` (`(Current / Default Server)`), setting `settingsProfileId = null`.
4. `PluginManagementSection.tsx:86` executes:
   ```typescript
   const token = getAuthToken(profileId ?? undefined);
   ```
   Because `profileId` is `null`, `getAuthToken(undefined)` is called.
5. In `packages/ui/src/api/server-config.ts:265-268`:
   ```typescript
   export function getAuthToken(profileId?: string): string | null {
     if (!profileId) {
       return null;
     }
     ...
   ```
   `getAuthToken` **strictly requires** `profileId`. It has **no fallback** to `getActiveProfileId()`.
6. `getAuthToken` returns `null`.
7. `checkAuthStatus(serverUrl, null)` is called.
8. In `packages/ui/src/api/auth-client.ts:433-438`:
   ```typescript
   res = await fetch(url, {
     method: "GET",
     headers,
     credentials: "omit", // Cookies are stripped!
     signal,
   });
   ```
   Because `token` is `null`, no `Authorization` header is added. Because `credentials: "omit"` is hardcoded, browser session cookies (`damhopper_auth`) are omitted.
9. Backend `server/src/api/auth.rs:status` receives zero credentials and responds with `401 Unauthorized` (`AUTH_REQUIRED`).
10. `checkAuthStatus` returns `{ authenticated: false, error: "Authentication required" }`.
11. `PluginManagementSection.tsx:104` executes `setUnauthorized(true)`. Banner renders.

#### Failure Mode 2: Strict Profile Endpoint Binding Mismatch
In `packages/ui/src/api/server-config.ts:287-295`:
```typescript
if (
  currentProfile &&
  parsed.serverUrl &&
  (normalizeServerUrl(currentProfile.url) !==
    normalizeServerUrl(parsed.serverUrl) ||
    currentProfile.authType !== parsed.authType)
) {
  return null;
}
```
If the token was stored for `http://localhost:4801` but user accesses via Tailscale/LAN IP `http://100.91.26.60:4801` (or vice-versa), URL normalization mismatch causes `getAuthToken` to return `null`, dropping into Failure Mode 1.

#### Failure Mode 3: Cookie Authentication Incompatibility with Plugin Admin Routes
If the user logged in using browser cookie authentication rather than profile-stored Bearer token:
1. `checkAuthStatus` uses `credentials: "omit"`, dropping the cookie and failing immediately (Failure Mode 1).
2. Even if `checkAuthStatus` were modified to send cookies, Axum middleware `require_bearer_auth` (`server/src/api/auth.rs:242-264`) guards all `/api/plugins/admin*` routes:
   ```rust
   let mechanism = request.extensions().get::<CredentialMechanism>().copied();
   if mechanism != Some(CredentialMechanism::Bearer) {
       return (StatusCode::FORBIDDEN, Json(json!({
           "error": "Bearer token required for plugin management operations; cookie credentials are not permitted",
           "code": "BearerRequired",
       }))).into_response();
   }
   ```
3. When `resolvedClient.plugins.adminList()` executes, backend responds with `403 Forbidden` (`BearerRequired`).
4. `PluginManagementSection.tsx:150-151` catches the error:
   ```typescript
   if (msg.includes("401") || msg.includes("403") || msg.includes("authorized") || msg.includes("Bearer")) {
     setUnauthorized(true);
   }
   ```
   `msg.includes("Bearer")` evaluates to `true` $\rightarrow$ `setUnauthorized(true)` is called $\rightarrow$ restriction banner renders.

#### Failure Mode 4: Overly Broad Catch Block in `adminList()`
In `PluginManagementSection.tsx:148-155`:
Any failure during `adminList()` containing `"401"`, `"403"`, `"authorized"`, or `"Bearer"` forces `setUnauthorized(true)`. Even if `authStatus` was previously set to `role: "admin"`, a network transport glitch or sub-service error instantly overrides the view and displays the restriction banner.

---

## 4. Interdependence: Does Fixing Issue 3 Fix Issue 2?

### 4.1 The Proposition
- **Issue 3:** `./dam-hopper-install.sh --latest --role both --plugin-owner-user $(id -un)` fails with:  
  `"plugin owner user loidinh cannot be the API service user (loidinh)"`  
  *Fix for Issue 3:* Configure a separate dedicated service user (`--service-user dam-hopper`) while setting `--plugin-owner-user loidinh`.
- **Issue 2:** `POST /api/plugins/invoke` fails with:  
  `"EACCES: permission denied, lstat '[PATH]'"` (`WorkerFailed`, HTTP 503).
- **Core Question:** "For issue 2, if issue 3 fix, can issue 2 can fix too?"

### 4.2 Rigorous Linux VFS & POSIX ACL Proof

#### Step 1: Process Identity Transformation
- Current state (broken): Runner runs as UID 979 (`dam-hopper-plugin-runner`).
- Post-fix state: `dam-hopper-plugin-runner.service` rendered by installer template (`deploy/systemd/dam-hopper-plugin-runner.service.in:10`):
  ```ini
  User=loidinh
  Group=loidinh
  SupplementaryGroups=dam-hopper-plugins
  ```
  Runner process and worker subprocesses execute with effective UID = 1000 (`loidinh`), effective GID = 1000 (`loidinh`).

#### Step 2: Target File and Directory Ownership
All directories under `/home/loidinh/.evcrate/advisor-history/` inspected on host:
```bash
$ find /home/loidinh/.evcrate/ ! -user loidinh
# (Empty output: 100% of files and directories are owned by UID 1000)
```
Target directory `e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5`:
- Owner: `loidinh` (UID 1000)
- Group: `loidinh` (GID 1000)
- Mode: `0700` (`drwx------`)

#### Step 3: Linux Kernel Permission Resolution Algorithm
Under POSIX.1e and Linux VFS kernel implementation (`man 5 acl`, Linux kernel `fs/namei.c:generic_permission` and `fs/posix_acl.c:posix_acl_permission`):

$$\text{Kernel Access Check Sequence:}$$

1. **Owner Match Evaluation:**
   ```c
   if (likely(uid_eq(current_fsuid(), inode->i_uid))) {
       mask &= inode->i_mode >> 6; // Owner bits: user::rwx
       if ((mask & WANT_MASK) == WANT_MASK)
           return 0; // GRANTED
       return -EACCES;
   }
   ```
   If process UID matches inode UID (`1000 == 1000`):
   - Access is evaluated **solely** against owner permission bits (`inode->i_mode >> 6`, i.e., `user::rwx`).
   - The kernel **does not evaluate POSIX ACL entries, ACL masks, group bits, or other bits**.
2. **Named User / Group Evaluation (Only reached if process UID $\neq$ inode UID):**
   - Evaluates `ACL_USER` entries matching process UID.
   - Evaluates `ACL_MASK` entry:
     $$\text{Effective Permission} = \text{Entry Permission} \land \text{ACL Mask}$$
   - Evaluates group entries.
   - Evaluates other bits.

#### Step 4: The Bypass Mechanism
- On mode `0700` directories, group bits are `---` (`0`).
- POSIX specifies that traditional file group bits define the `ACL_MASK`.
- Therefore, mode `0700` sets `mask::---`.
- For UID 979:
  $$\text{Effective} = \text{Entry}(r-x) \land \text{Mask}(---) = --- \quad \Longrightarrow \quad \mathbf{EACCES}$$
- For UID 1000:
  Kernel evaluates Step 1 (Owner Match). Step 2 is **never reached**.
  Owner bits are `rwx` (`0700`).
  $$\text{Effective} = rwx \quad \Longrightarrow \quad \mathbf{GRANTED}$$

#### Step 5: Systemd Sandboxing Verification
In `deploy/systemd/dam-hopper-plugin-runner.service.in:46`:
```ini
ProtectHome=read-only
```
Under `systemd.exec(5)`, `ProtectHome=read-only` mounts `/home` read-only for the service. Read and execute (directory traversal and `fs.lstatSync`) across `/home/loidinh` are fully permitted.

**Result:** UID 1000 completely bypasses the ACL mask collapse. `fs.lstatSync` succeeds. **Resolving Issue 3 by setting `--plugin-owner-user loidinh` directly and completely fixes Issue 2.**

---

## 5. Architectural Comparison: UID 1000 vs Retaining UID 979

| Dimension | Fix Option A: Runner as UID 1000 (Resolves Issue 3 & 2) | Fix Option B: Runner Remains UID 979 (Decoupled Fix) |
|---|---|---|
| **Issue 2 Resolution** | **Permanent and immediate.** Immune to mode `0700` ACL mask collapse. Zero code changes required in `evcrate`. | **Fragile.** Requires recurring ACL maintenance or patching `evcrate` filesystem writer and error handler. |
| **ACL Mask Behavior** | Bypassed. Linux kernel evaluates owner bits `user::rwx` directly. | Vulnerable. Every directory created with `chmod 0700` collapses mask to `---`, instantly breaking worker. |
| **Code Changes Needed** | None in `evcrate` or runner binary. System configuration and installer only. | Intrusive: Must modify `evcrate` to avoid `0700` (`chmod 0750`), preserve ACL masks in writers, or catch `EACCES` in `binding.cjs`. |
| **API User Requirement** | Requires `--service-user dam-hopper` (UID 980 or similar) to satisfy isolation invariant `service_user != plugin_owner_user`. | API server can remain running as UID 1000 (`loidinh`). |
| **Security Isolation** | API server $\neq$ Plugin runner (enforced). Plugins execute with user read privileges (confined by systemd `ProtectHome=read-only`). | Dedicated system service UID (979). Strict principle of least privilege, but fails POSIX ACL interaction with standard user files. |
| **Operational Overhead** | Low. Standard single-user workstation model aligned with documentation Scenario A. | High. Requires background filesystem monitoring (`inotify`) or `setfacl` cron jobs to counter `0700` resets. |

---

## 6. Actionable Summary

1. **For Issue 1 (UI Restriction Banner):**
   - The token and account `loidinhm31` in MongoDB are valid and have admin role.
   - The UI fails because `SettingsPage.tsx` passes `settingsProfileId: null`, leading `getAuthToken(undefined)` to return `null`, causing `checkAuthStatus` to send an uncredentialed request (`credentials: "omit"`), which returns 401 and sets `unauthorized = true`.
   - Remediating UI requires:
     - `getAuthToken(profileId)` should fallback to `getActiveProfileId()` when `profileId` is undefined or null.
     - `SettingsPage.tsx` should pass the active profile ID when `settingsProfileId` is not explicitly set.
     - `PluginManagementSection.tsx` should ensure Bearer headers are attached and distinguish network/service errors from lack of admin privileges.

2. **For Issue 2 & Issue 3 Interdependence:**
   - **Fixing Issue 3 via `--service-user dam-hopper --plugin-owner-user loidinh` definitively fixes Issue 2.**
   - Running the runner as UID 1000 bypasses POSIX ACL mask collapse because the Linux kernel evaluates file owner permissions (`user::rwx`) prior to and independently of the ACL mask.

---

## 7. Unresolved Questions

1. Should `packages/ui/src/api/server-config.ts:getAuthToken(profileId)` officially fall back to `getActiveProfileId()` when `profileId` is omitted or null, or should caller components (`SettingsPage.tsx`) be strictly responsible for resolving the active profile ID before invoking children?
2. Does `evcrate` have other plugin operations that require **write** access to `/home/loidinh/.evcrate/` (which would conflict with `ProtectHome=read-only` in `dam-hopper-plugin-runner.service`), or is plugin operation strictly read-only for advisor history?
