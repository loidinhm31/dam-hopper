# Bug Diagnosis Report: Plugin Invoke Permission Denied (`WorkerFailed`)

**Report Path:** `plans/reports/debugger-260927-1654-plugin-invoke-permission-denied.md`  
**Date:** 2026-09-27  
**Author:** PluginInvokeDebugger  
**Status:** Root Cause Identified (Diagnosis Only - No Fix Applied)

---

## 1. Executive Summary

- **Issue:** HTTP 503 error `{error: "EACCES: permission denied, lstat '[PATH]'", code: "WorkerFailed"}` returned by `dam-hopper-server` on `POST /api/plugins/invoke` (host `100.91.26.60:4801`).
- **Impact:** Advisor plugin UI fails to load/refresh history in web/desktop frontend; plugin background operations completely unusable for all projects because full history refresh aborts on first inaccessible directory.
- **Root Cause:**
  1. `dam-hopper-plugin-runner.service` runs as dedicated system user `dam-hopper-plugin-runner` (UID 979, GID 979), while host workspace and history directories are owned by developer `loidinh` (UID 1000).
  2. While parent directory `/home/loidinh/.evcrate/advisor-history` has POSIX ACLs granting `user:dam-hopper-plugin-runner:r-x`, newly created project directory `/home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5` (`eigen-air-ui`, created today at 10:58) was created with mode `0700` (`drwx------`).
  3. Under Linux POSIX ACL semantics, setting mode `0700` explicitly sets the ACL mask to `---` (`mask::---`), reducing the effective permission of `user:dam-hopper-plugin-runner:r-x` to `---` (`#effective:---`).
  4. During `history.refresh`, worker `history-scanner.cjs` iterates through all project directories in the history root and attempts `inspectStat` (`fs.lstatSync`) on `project-metadata.json` inside the project directory. The Linux kernel rejects directory traversal with `EACCES`.
  5. `binding.cjs:inspectStat` only catches `ENOENT` and `ENOTDIR`, rethrowing `EACCES`.
  6. `error-mapping.cjs:toSafePluginError` catches unhandled `EACCES`, maps it to `PluginErrorCode.WORKER_FAILED`, and redacts the full path `/home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5/project-metadata.json` to `'[PATH]'`.

---

## 2. Technical Analysis & Evidence

### 2.1 The Exact Un-Sanitized Path
- **Sanitized string returned to caller:** `'[PATH]'`
- **Sanitization source:** `/home/loidinh/WS/evcrate/plugin/backend/error-mapping.cjs:45`:
  ```javascript
  let sanitized = text.replace(/(?:\/[a-zA-Z0-9._-]+)+/g, '[PATH]');
  ```
- **Actual path failing `lstatSync`:**  
  `/home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5/project-metadata.json`
- **Associated project:** `eigen-air-ui` (hash `e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5`).

### 2.2 Process & User Identity Breakdown
| Service / Process | PID | User | UID | Group | GID | Supplementary Groups |
|---|---|---|---|---|---|---|
| `dam-hopper-api.service` (`dam-hopper-server`) | 1768337 | `loidinh` | 1000 | `loidinh` | 1000 | `dam-hopper-plugins` (979) |
| `dam-hopper-plugin-runner.service` | 1768296 | `dam-hopper-plugin-runner` | 979 | `dam-hopper-plugins` | 979 | `dam-hopper-plugins` (979) |
| Worker process (`node .../worker.cjs`) | 1782704 | `dam-hopper-plugin-runner` | 979 | `dam-hopper-plugins` | 979 | `dam-hopper-plugins` (979) |

### 2.3 Filesystem Permissions & ACL Mask Collapse

Inspection of parent vs problematic child directory:

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

# All 22 older project directories:
# Mode: 0750, mask: r-x -> Effective permission: r-x (Accessible)

# Problematic project directory (created 2026-09-27 10:58):
$ getfacl -cp /home/loidinh/.evcrate/advisor-history/e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5
user::rwx
user:dam-hopper-plugin-runner:r-x    #effective:---
group::---
mask::---
other::---
```

**Why `#effective:---` occurs:**
- Standard POSIX ACL specification defines standard file group permission bits (`stat.st_mode & 0070`) as the ACL mask.
- When `evcrate` or a workflow script created the `eigen-air-ui` directory, it applied `chmod 0700` (`drwx------`).
- The `0` in group bits reset `mask` to `---`.
- Effective permissions for any named ACL user equal `(entry_permissions & mask)`.
- For `user:dam-hopper-plugin-runner:r-x`: `(r-x) & (---) = ---`.
- UID 979 has zero permissions on this directory. Any attempt to traverse (`--x`) or stat contents fails with `EACCES`.

### 2.4 End-to-End Execution Trace

```
Client (Web UI / HTTP caller)
  │
  ▼ POST http://100.91.26.60:4801/api/plugins/invoke
dam-hopper-server (PID 1768337, UID 1000)
  │ `invoke_handler` in server/src/api/plugins.rs
  │ Validates auth token, actor grants, and local context table
  ▼
dam-hopper-server runner client
  │ Sends JSON-RPC "plugin.invoke" over /run/dam-hopper/plugin-runner.sock
  ▼
dam-hopper-plugin-runner (PID 1768296, UID 979)
  │ `RunnerServer` receives framed request via Unix socket
  │ Routes to `InstallationSupervisor` -> `WorkerProcess`
  ▼ Length-prefixed framed JSON-RPC over stdio pipe
Node Worker Process (PID 1782704, UID 979)
  │ `dispatcher.cjs` admits request to `WorkerRequestTable`
  │ Calls `provider.invoke("history.refresh", ...)` in `provider.cjs`
  │ Calls `historyProvider.refresh(...)` in `history-provider.cjs`
  │ Calls `scanHistoryRecords(...)` in `history-scanner.cjs`
  │ Scans /home/loidinh/.evcrate/advisor-history:
  │   - Discovers project IDs (hashes)
  │   - Reaches 'e56187b44c15ed9c9e1e8917dca6d5367616c29a176d29b7bacf629e765d9ab5'
  │   - Calls `readSafeProjectLabel(projMetaPath, projId)` on line 177
  │   - Calls `readBoundedFile(filePath, MAX_METADATA_BYTES)`
  │   - Calls `inspectStat(filePath)` in `binding.cjs:25`
  │   - Executes: fs.lstatSync('/home/loidinh/.evcrate/advisor-history/e56187b4.../project-metadata.json')
  │
  ▼ Kernel checks path resolution:
    - /home/loidinh [UID 1000, ACL u:dam-hopper-plugin-runner:--x] -> OK
    - .evcrate [UID 1000, ACL u:dam-hopper-plugin-runner:r-x] -> OK
    - advisor-history [UID 1000, ACL u:dam-hopper-plugin-runner:r-x] -> OK
    - e56187b4... [UID 1000, ACL mask::---, effective:---] -> ACCESS DENIED!
  │
  ▼ Kernel returns -EACCES
`binding.cjs:inspectStat` catches `err`:
  │ `if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null; throw err;`
  │ Uncaught EACCES exception propagates to `dispatcher.cjs:120`
`error-mapping.cjs:toSafePluginError`:
  │ Mapped code: `PluginErrorCode.WORKER_FAILED` ("WorkerFailed")
  │ Sanitized message: `sanitizeMessage("EACCES: permission denied, lstat '...'")`
  │ Output: `"EACCES: permission denied, lstat '[PATH]'"`
Node Worker sends framed JSON-RPC response:
  │ `{"error": {"code": -32603, "message": "EACCES: permission denied, lstat '[PATH]'"}}`
`server/src/plugins/worker_process.rs:134`:
  │ Receives worker error frame -> `PluginError::worker_failed(err_msg)`
`server/src/api/plugins.rs:plugin_error_response`:
  │ Maps `WorkerFailed` to HTTP 503 Service Unavailable:
  ▼
Client receives:
  `{"error": "EACCES: permission denied, lstat '[PATH]'", "code": "WorkerFailed"}`
```

### 2.5 Controlled Reproduction Evidence

Direct execution against `/run/dam-hopper/plugin-runner.sock` confirmed the issue in isolation:

1. `context.open`:
   - Installation ID: `33e2bc19-3a4f-4733-beb7-7d5e675f1edb`
   - Scope: `history-root`
   - Result: `ctx:33e2bc19-3a4f-4733-beb7-7d5e675f1edb:a16c6dba-d727-4d23-95ad-541829e5c294` (Success)
2. `plugin.invoke`:
   - Operation: `history.refresh`
   - Result:
     ```json
     {
       "error": {
         "code": -32603,
         "message": "EACCES: permission denied, lstat '[PATH]'",
         "data": { "pluginErrorCode": "WorkerFailed" }
       }
     }
     ```

---

## 3. Architectural Context & Design Evaluation

### 3.1 Scenario A vs Scenario B in Project Specifications
In `docs/plugin-platform-linux.md`:
- **Scenario A (Single-User Developer Workstation - Recommended by project docs):**
  > "If the server is your personal development machine, run the runner under your own account:  
  > `./dam-hopper-install.sh --latest --role both --plugin-owner-user $(id -un)`  
  > Because the runner shares your UID, it can access all your workspaces and `~/.evcrate` files naturally without opening permissions."
- **Scenario B (Multi-User / Sandboxed Deployment):**
  > "If using the default dedicated runner account (`dam-hopper-plugin-runner`), developer home directories with mode `0700` (`rwx------`) block access at the filesystem layer. Grant traversal and read permissions explicitly using POSIX ACLs..."

### 3.2 Design Flaw in Scenario B with Tooling Invariants
1. `evcrate`'s security policy requires owner-only state: `directories are 0700, files are 0600` (`docs/code-standards.md:357`).
2. Tools enforcing `0700` execute `chmodSync(path, 0o700)`.
3. In Linux POSIX ACLs, `chmod 0700` inevitably clears the ACL mask to `---`, completely breaking Scenario B whenever new directories or files are created by `evcrate` or other CLI tools.
4. Hence, default ACLs (`default:user:dam-hopper-plugin-runner:rX`) are continuously neutralized by any tool executing `chmod 0700`.

### 3.3 Worker Error Handling Fragility
1. In `evcrate/plugin/backend/binding.cjs`: `inspectStat` only suppresses `ENOENT` and `ENOTDIR`. If any file/directory in the entire scan returns `EACCES`, it crashes the entire scan.
2. In `evcrate/plugin/backend/history-scanner.cjs`: `scanHistoryRecords` has a diagnostics collector (`scan.diagnostics`, `recordDiag`), but because `inspectStat` throws synchronously, execution never reaches the diagnostic recording logic.

---

## 4. Proposed Fixes & Remediation Options

*(Note: Per assignment rules, no fix has been applied. Options are presented for operational decision.)*

### Option 1: Align Deployment with Documentation Scenario A (Recommended)
Configure `dam-hopper-plugin-runner.service` to run under user `loidinh` (UID 1000):
- **Why:** Matches `docs/plugin-platform-linux.md:68-76`. Eliminates cross-user UID permission mismatches across all workspaces (`~/WS/*`) and `~/.evcrate/`.
- **Implementation:**
  - Re-run installer / manager with `--plugin-owner-user loidinh`, or adjust `User=loidinh`, `Group=loidinh` in `dam-hopper-plugin-runner.service` and adjust ownership of `/var/lib/dam-hopper-plugin-runner`.

### Option 2: Repair and Automate ACL Mask Maintenance (Workaround for Scenario B)
If keeping dedicated user `dam-hopper-plugin-runner`:
- Repair current mask:
  ```bash
  setfacl -R -m u:dam-hopper-plugin-runner:rX,m::rX /home/loidinh/.evcrate
  setfacl -R -d -m u:dam-hopper-plugin-runner:rX,m::rX /home/loidinh/.evcrate
  ```
- Note: This workaround will break again as soon as `evcrate` creates another project directory with `chmod 0700`.

### Option 3: Resilient Error Handling in `evcrate.advisor` Worker (Code Hardening)
In `/home/loidinh/WS/evcrate/plugin/backend/`:
- In `binding.cjs:inspectStat`:
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
  Or in `history-scanner.cjs`: Wrap `readSafeProjectLabel` and directory inspection in `try/catch` and record diagnostic (`recordDiag(scan, 'PERMISSION_DENIED', ...)`) so that one unreadable project directory does not fail history refresh for all other projects.

---

## 5. Unresolved Questions

1. Was `dam-hopper-plugin-runner.service` deliberately installed with the dedicated user `dam-hopper-plugin-runner` instead of `--plugin-owner-user loidinh` (Scenario A) to test sandboxing, or was it simply left at the default during installer execution?
2. Should `evcrate` CLI tools modify their creation logic from `chmod 0700` to respect existing ACL masks, or should the plugin runner worker be made resilient to skip inaccessible projects during inventory scan?
