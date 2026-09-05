# Debugger Investigation Report: PUT /api/config Permission Denied

**Report ID:** `debugger-260905-1416-config-permission-denied`  
**Date:** 2026-09-05 14:16  
**Target:** `server/` config persistence & systemd service runtime permissions  

---

## 1. Issue Summary

HTTP request:
```bash
curl --url http://100.91.26.60:4801/api/config -X PUT ...
```
Fails with 500 error:
```json
{
  "error": "Config error: Cannot open /etc/dam-hopper/.dam-hopper-tmp-2473c327def44fe787a9d89f4e3a94b9.tmp: Permission denied (os error 13)"
}
```

---

## 2. Backward Call Stack Trace

1. **HTTP Endpoint Handler:**
   - File: `server/src/api/config.rs:34` (`pub async fn update_config`)
   - Reads `current.config_path` (resolved to `/etc/dam-hopper/dam-hopper.toml` from `--config` CLI arg).
   - Line 44: `write_json_as_toml(&config_path, &body)?;`

2. **TOML Serialization & Atomic Write Dispatch:**
   - File: `server/src/api/config.rs:389` (`fn write_json_as_toml`)
   - Line 395: `atomic_write(path, &toml_str).map_err(ApiError::from_app)`

3. **Atomic File Write Routine:**
   - File: `server/src/utils/fs.rs:7` (`pub fn atomic_write`)
   - Line 8: `let dir = target.parent().unwrap_or(Path::new("/"));` -> `/etc/dam-hopper`
   - Line 12–15: generates temp file path:
     `let tmp = dir.join(format!(".dam-hopper-tmp-{}.tmp", uuid::Uuid::new_v4().simple()));`
     Path: `/etc/dam-hopper/.dam-hopper-tmp-*.tmp`
   - Line 17: `write_with_mode(&tmp, content)?;`

4. **OS File Creation Failure:**
   - File: `server/src/utils/fs.rs:36–42` (`fn write_with_mode`)
   - Opens temp file with `.write(true).create(true).truncate(true).mode(0o600).open(path)`.
   - Returns: `AppError::Config(format!("Cannot open {}: {}", path.display(), e))`
   - OS returns `EACCES` (`Permission denied (os error 13)`).

---

## 3. Runtime & Permission Evidence

1. **Running Process Inspection:**
   ```
   PID: 2985459
   User: loidinh (UID=1000, GID=1000)
   Command: /opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /etc/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801
   Cgroup: /system.slice/dam-hopper-api.service
   ```

2. **Systemd Service Definition (`/etc/systemd/system/dam-hopper-api.service`):**
   ```ini
   [Service]
   Type=exec
   User=loidinh
   Group=loidinh
   ExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /etc/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801
   ```

3. **Filesystem DAC Permissions (`/etc/dam-hopper`):**
   ```
   drwxr-xr-x+  5 root root  143 Sep  5 12:32 /etc/dam-hopper
   -rw-r--r--+  1 root root  521 Sep  5 03:49 /etc/dam-hopper/dam-hopper.toml
   ```
   - Owner: `root` (UID 0)
   - Group: `root` (GID 0)
   - Mode: `0755` on dir, `0644` on file.
   - Non-root user `loidinh` (UID 1000) has only read (`r-x`) access to directory.
   - Creating `.dam-hopper-tmp-*.tmp` inside `/etc/dam-hopper/` denied by Linux DAC.

---

## 4. Root Cause

Recent commit/fix changed `dam-hopper-api.service` execution identity from `root:root` to unprivileged service user `@API_USER@` (`loidinh:loidinh`) for security hardening.

However:
1. `ExecStart` in `deploy/systemd/dam-hopper-api.service.in` and `server/src/linux_release/unit_policy.rs` still hardcodes `--config /etc/dam-hopper/dam-hopper.toml`.
2. Installer and activator (`server/src/linux_release/activate.rs:731-750`) enforce `0755 root:root` permissions on `/etc/dam-hopper` and `0644 root:root` on `/etc/dam-hopper/dam-hopper.toml`.
3. Server's `atomic_write` requires write/create/rename permissions in target's parent directory (`/etc/dam-hopper`).
4. Because process user `loidinh` is unprivileged and `/etc/dam-hopper` is owned by `root:root 0755`, any write/update operation to config via `PUT /api/config` fails with `Permission denied (os error 13)`.

---

## 5. Potential Fix Approaches (Do Not Implement Automatically)

### Option A: Move Active Workspace Config to User/Service Directory (Recommended / FHS Compliant)
- **Concept:** Linux FHS discourages unprivileged daemon runtime writes to `/etc/`. The server already supports `$XDG_CONFIG_HOME/dam-hopper/dam-hopper.toml` or `@API_HOME@/.config/dam-hopper/dam-hopper.toml`.
- **Implementation scope:**
  - Update `dam-hopper-api.service.in` to point `--config` to `@API_HOME@/.config/dam-hopper/dam-hopper.toml` (or omit `--config` to use default resolution).
  - Update `server/src/linux_release/unit_policy.rs` validation.
  - Ensure installer/activator copies/seeds `/etc/dam-hopper/dam-hopper.toml` to `@API_HOME@/.config/dam-hopper/dam-hopper.toml` if not present.
- **Trade-offs:** Clean separation between system-wide immutable defaults and user-mutable runtime configuration. Full FHS compliance.

### Option B: Grant Service User Write Access to `/etc/dam-hopper`
- **Concept:** Keep config path at `/etc/dam-hopper/dam-hopper.toml`, grant write access to `@API_USER@`.
- **Implementation options:**
  - `chown` `/etc/dam-hopper` and `dam-hopper.toml` to `@API_USER@:@API_GROUP@` in `activate.rs`.
  - Or use POSIX ACL: `setfacl -m u:@API_USER@:rwx /etc/dam-hopper` and `setfacl -d -m u:@API_USER@:rwX /etc/dam-hopper`.
- **Trade-offs:** Minimal code changes, but leaves unprivileged service user writing into `/etc`, which violates standard Linux packaging conventions.

---

## 6. Unresolved Questions

1. Should `/etc/dam-hopper/dam-hopper.toml` remain system-wide administrative seed config while runtime mutable config lives under `@API_HOME@/.config/dam-hopper/dam-hopper.toml`?
2. Or is `/etc/dam-hopper/dam-hopper.toml` intended as the single authoritative config across all users on host, requiring ACL / group ownership (`dam-hopper` group or `@API_USER@`) on `/etc/dam-hopper`?
