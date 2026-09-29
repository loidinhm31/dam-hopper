# Bug Diagnosis Report: Advisor History EACCES (`WorkerFailed`)

**Report Path:** `plans/reports/debugger-260929-0046-advisor-history-eacces.md`  
**Date:** 2026-09-29  
**Investigator:** AdvisorHistoryDebugger  
**Status:** Root Cause Identified (Diagnosis Only — No Fix Applied)

---

## 1. Executive Summary

- **Issue:** HTTP 503 `Service Unavailable` with payload `{"error":"EACCES: permission denied, lstat '[PATH]'","code":"WorkerFailed"}` returned by API server `http://100.91.26.60:4801/api/plugins/invoke` during operation `history.refresh`.
- **User Question:** *"I run evcrate publish --apply, does it change file mode restriction from ~/.evcrate for advisor-history as my expect?"*
- **Direct Answer:** **NO.** `evcrate publish --apply` manages and distributes adapter binaries and harness bindings into `~/.evcrate/bin/` and target config directories (`.omp`, `.claude`, `.codex`, etc.). It **never** touches, scans, or modifies runtime data directories or file permission modes under `~/.evcrate/advisor-history/`.
- **Root Cause:**
  1. `dam-hopper-plugin-runner.service` and its Node worker process run as dedicated system account `dam-hopper-plugin-runner` (UID 979, GID 979). User workspace and history roots reside under developer home `/home/loidinh/` (UID 1000).
  2. Prior to `evcrate` v2.4.0 release (backed up at 00:42 in `~/.evcrate/publication/release-4acf6d949714470fa18e07956ebedb44/backups/0/lib/advisor/history-store.cjs`), the history store binary explicitly invoked `fs.mkdirSync(child, { mode: 0o700 })`.
  3. When project `eigen-air` history was generated on Sep 28 between 16:45 and 21:04, directory `/home/loidinh/.evcrate/advisor-history/fe061a39288290d3566b0536feccae4c994cab98f860f982002bbb1f907439ef` was created with mode `0700` (`drwx------+`).
  4. Under Linux POSIX.1e ACL semantics, `0700` sets the ACL mask to `---` (`mask::---`). Named user ACL `user:dam-hopper-plugin-runner:r-x` was masked to `#effective:---`.
  5. Running `evcrate publish --apply` at 00:42 deployed v2.4.0 binary `.evcrate/bin/lib/advisor/history-store.cjs` (which removed `{ mode: 0o700 }`), but publication does not touch existing history directories. Existing `fe061a39...` remained `drwx------+` with `mask::---`.
  6. On `history.refresh`, worker `history-scanner.cjs` iterates through all project directories in the history root and executes `inspectStat` (`fs.lstatSync`) on `project-metadata.json` inside `fe061a39...`. The Linux kernel denies traversal with `EACCES`.
  7. `binding.cjs:inspectStat` only suppresses `ENOENT` and `ENOTDIR`, rethrowing `EACCES`. `error-mapping.cjs` catches `EACCES`, maps it to `WorkerFailed`, redacts the absolute path to `'[PATH]'`, and crashes the entire history scan.

---

## 2. Technical Analysis & Evidence

### 2.1 The Exact Un-Sanitized Path
- **Sanitized string returned to API client:** `'[PATH]'`
- **Sanitization implementation:** `/home/loidinh/WS/evcrate/plugin/backend/error-mapping.cjs:45`:
  ```javascript
  let sanitized = text.replace(/(?:\/[a-zA-Z0-9._-]+)+/g, '[PATH]');
  ```
- **Exact un-sanitized path triggering `lstatSync` EACCES:**  
  `/home/loidinh/.evcrate/advisor-history/fe061a39288290d3566b0536feccae4c994cab98f860f982002bbb1f907439ef/project-metadata.json`
- **Target Project:** `eigen-air` (SHA256 digest `fe061a39288290d3566b0536feccae4c994cab98f860f982002bbb1f907439ef`).

### 2.2 Permissions and ACL Mask Inspection

#### Parent Directory (`/home/loidinh/.evcrate/advisor-history`):
- Mode: `0755` (`drwxr-xr-x+`)
- POSIX ACL:
  ```
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
  ```
- Result: UID 979 can read and traverse the parent directory.

#### Problem Project Directory (`fe061a39288290d3566b0536feccae4c994cab98f860f982002bbb1f907439ef`):
- Mode: `0700` (`drwx------+`), updated Sep 28 21:04
- POSIX ACL:
  ```
  user::rwx
  user:dam-hopper-plugin-runner:r-x    #effective:---
  group::---
  mask::---
  other::---
  default:user::rwx
  default:user:dam-hopper-plugin-runner:r-x
  default:group::---
  default:mask::r-x
  default:other::---
  ```
- Result: Group bits `0` collapsed ACL mask to `mask::---`. Effective permissions for `dam-hopper-plugin-runner` evaluate to `(r-x) & (---) = ---`. No traversal (`--x`) or file access permitted.
- Subdirectories inside `fe061a39...`:
  - `46225043-5a5a-42bd-bad2-ccdc0c896f6f`: mode `0700` (`drwx------+`)
  - `6d2bfca1-5180-4bec-98bc-da9cedd1e954`: mode `0700` (`drwx------+`)
  - `73862727-5502-4d28-9d6b-4703becc2387`: mode `0700` (`drwx------+`)
  - `8018ccda-dc25-4278-92d5-17156dc1ae5f`: mode `0700` (`drwx------+`)
  - `project-metadata.json`: mode `0600` (`-rw-------+`)

#### Other Project Directories in `advisor-history`:
- All 22 other directories (e.g. `0036d05b...`, `13a81af7...`, `e56187b4...`) have mode `0755` (`drwxr-xr-x+`), mask `r-x`, and effective `r-x`. Only `fe061a39...` has `mask::---`.

### 2.3 Verification of Backup Files and Pre-Release Binary

Diff between backup binary created during `evcrate publish --apply` at 00:42 (`~/.evcrate/publication/release-4acf6d949714470fa18e07956ebedb44/backups/0/lib/advisor/history-store.cjs`) and new binary (`~/.evcrate/bin/lib/advisor/history-store.cjs`):

```diff
--- backups/0/lib/advisor/history-store.cjs (Pre-v2.4.0, run until 00:42)
+++ ~/.evcrate/bin/lib/advisor/history-store.cjs (v2.4.0, published at 00:42)
@@ -66,7 +132,7 @@
       let stat = inspect(child);
       if (!stat && create) {
         stable(entries);
-        try { fs.mkdirSync(child, { mode: 0o700 }); }
+        try { fs.mkdirSync(child); }
         catch (error) { if (error.code !== 'EEXIST') throw error; }
         fs.fsyncSync(fd);
         stat = inspect(child);
@@ -190,7 +311,7 @@
       let stat = inspect(child);
       if (!stat && create) {
         stable(entries);
-        try { fs.mkdirSync(child, { mode: 0o700 }); }
+        try { fs.mkdirSync(child); }
         catch (error) { if (error.code !== 'EEXIST') throw error; }
         fs.fsyncSync(fd);
         stat = inspect(child);
```
- **Finding:** The pre-v2.4.0 binary in use when `eigen-air` history was generated explicitly passed `{ mode: 0o700 }` to `fs.mkdirSync`.
- This hardcoded `0700` caused the ACL mask to collapse to `mask::---` when `fe061a39...` was created.

### 2.4 Analysis of `evcrate publish --apply` Source Code

Investigation of `/home/loidinh/WS/evcrate/src/distribution/publication.ts`, `publication-plan.ts`, and `protocol/publication-payloads.ts`:

1. **Target Scope:**
   `PUBLICATION_BINDING_ORDER` is strictly defined as:
   ```typescript
   export const PUBLICATION_BINDING_ORDER = Object.freeze([
     '.evcrate/bin', '.gemini', '.agents', '.codex', '.pi', '.gemini/config', '.omp', '.claude', '.copilot'
   ] as const);
   ```
2. **Managed Paths in Release Marker:**
   `release-marker.json` at 00:42 tracks only:
   `['antigravity', 'claude', 'codex', 'copilot', 'gemini', 'omp', 'pi']` and `.evcrate/bin`.
3. **Absence of History Management:**
   - `~/.evcrate/advisor-history/` is not a publication binding or harness artifact.
   - `publication.ts` handles exclusively build asset promotion, atomic file projection into tool harnesses, release markers, and rollback journals.
   - `evcrate publish --apply` contains zero code to traverse, repair, or mutate permissions on `~/.evcrate/advisor-history/`.

### 2.5 Analysis of Plugin Backend Failure Mechanics

1. **`binding.cjs:inspectStat` (lines 25-32):**
   ```javascript
   function inspectStat(targetPath) {
     try {
       return fs.lstatSync(targetPath, { bigint: true });
     } catch (err) {
       if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
       throw err; // <--- EACCES is rethrown
     }
   }
   ```
2. **`history-scanner.cjs:readSafeProjectLabel` (lines 42-57, 160-181):**
   - In `scanHistoryRecords`, directory `fe061a39...` is detected.
   - `inspectStat(projDir)` succeeds because parent directory `advisor-history` allows traversal and read by UID 979.
   - Line 176 constructs `projMetaPath = path.join(projDir, 'project-metadata.json')`.
   - Line 177 calls `readSafeProjectLabel(projMetaPath, projId)`, calling `readBoundedFile(metadataPath)`.
   - Line 57 calls `inspectStat(filePath)` on `.../fe061a39.../project-metadata.json`.
   - Kernel attempts path resolution: encounters `fe061a39...` where effective permission is `---`. Kernel returns `-EACCES`.
   - `inspectStat` rethrows `EACCES`.
   - No `try/catch` exists in `readBoundedFile`, `readSafeProjectLabel`, or around line 177 in `scanHistoryRecords`.
   - The entire cooperative scan terminates with an uncaught `EACCES` exception.
3. **`history-provider.cjs:refresh` (lines 88-118):**
   - Catches only `CANCELLED` and `DEADLINE_EXCEEDED`. Rethrows `EACCES`.
4. **`dispatcher.cjs:153-166` and `error-mapping.cjs:93-114`:**
   - Unhandled exception passed to `toSafePluginError(err)`.
   - Code `EACCES` has no mapping in `CODE_MAPPING`, falling back to `PluginErrorCode.WORKER_FAILED`.
   - `sanitizeMessage` redacts path to `'[PATH]'`.
   - Worker returns JSON-RPC error: `{"code": -32603, "message": "EACCES: permission denied, lstat '[PATH]'"}`, `data: {"pluginErrorCode": "WorkerFailed"}`.
5. **`dam-hopper-server` (`api/plugins.rs:plugin_error_response`):**
   - Maps `WorkerFailed` to HTTP 503 `Service Unavailable`.

### 2.6 Controlled Reproduction Evidence

Direct invocation reproduced the issue on the live system:

```javascript
// 1. Acquired valid epoch from ws://127.0.0.1:4801/ws via { kind: 'plugin:get_epoch', req_id: 1 }
// Epoch: 1131732330473466

// 2. Open context: POST /api/plugins/contexts/open
// Status: 200 OK
// Response:
{
  contextId: 'ctx:fc4b0dd6-6fda-4cf3-a370-cd9a2fb60498:4f6533db-f98d-47ad-a363-99aa1224cee5',
  scopeKind: 'history-root',
  bindingRevision: 1,
  grantRevision: 1,
  activationGeneration: 1,
  expiresAt: 1790619581
}

// 3. Invoke: POST http://100.91.26.60:4801/api/plugins/invoke
// Payload: {"epoch": 1131732330473466, "contextId": "ctx:fc4b0dd6...", "requestId": "req-invoke-1", "operation": "history.refresh", "payload": {}}
// Status: 503 Service Unavailable
// Response:
{
  "error": "EACCES: permission denied, lstat '[PATH]'",
  "code": "WorkerFailed"
}
```

---

## 3. Remediation Strategy

*(Investigation only — no fix applied per constraints)*

1. **Immediate Permission Repair on History Store:**
   Restore traversal and read access for `dam-hopper-plugin-runner` and reset ACL mask on `fe061a39...`:
   ```bash
   chmod 0755 ~/.evcrate/advisor-history/fe061a39288290d3566b0536feccae4c994cab98f860f982002bbb1f907439ef
   setfacl -R -m u:dam-hopper-plugin-runner:rX,m::rX ~/.evcrate/advisor-history
   setfacl -R -d -m u:dam-hopper-plugin-runner:rX,m::rX ~/.evcrate/advisor-history
   ```
2. **Defensive Error Handling in `evcrate.advisor` Plugin Worker:**
   - In `binding.cjs:inspectStat`: Catch `EACCES` and return `null` instead of rethrowing:
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
   - In `history-scanner.cjs`: Wrap project directory inspection and `readSafeProjectLabel` in a `try/catch` block and record a non-fatal diagnostic (`recordDiag(scan, 'PERMISSION_DENIED', ...)`) so that a single inaccessible directory does not abort history refresh across all other valid projects.

---

## 4. Unresolved Questions

1. Should `evcrate` publish/migration lifecycle include an explicit state repair command (e.g. `evcrate history repair-permissions`) to ensure legacy `0700` directories created prior to v2.4.0 are brought into conformance with POSIX ACL expectations?
2. Should `dam-hopper-plugin-runner.service` be reconfigured in single-user workstations to run as `User=loidinh` (Scenario A in `docs/plugin-platform-linux.md`) to avoid cross-UID file permission discrepancies entirely?
