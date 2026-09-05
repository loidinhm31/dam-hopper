# Debugger Investigation Report: Activation Digest Mismatch on dam-hopper-recovery.service

## 1. Executive Summary
- **Issue**: Running `sudo dam-hopper start` fails during activation preflight with:
  ```text
  error: activation failed: archive entry /var/lib/dam-hopper-manager/pending-units-b64f25b2-0595-46bc-a39b-dd134ac50a5b/dam-hopper-recovery.service digest mismatch: expected sha256 352b2cd1247778ea5a041bf3bf0280da357da2314cc7677f5397a9050c7305ba, got 64e9034058a6aadf5ce5001a09ea6b7632e163af53becec5b61017928af5e38f
  ```
- **Root Cause**: `activate_preflight.rs:222-236` checks the hash of the **rendered** recovery unit file on disk against the **unrendered template** hash stored in `manifest.inventory`.
  - In `deploy/systemd/dam-hopper-recovery.service.in` (packaged into the release archive as `systemd/dam-hopper-recovery.service`), the unit is a template containing `@RELEASE_ROOT@/bin/dam-hopper-manager recover --boot`. Its unrendered SHA-256 is `352b2cd1...`.
  - During candidate staging (`stage_units.rs:136-138`), the manager replaces `@RELEASE_ROOT@` with the actual installed path (`/var/lib/dam-hopper/releases/v0.2.0/server`), producing rendered unit content whose SHA-256 is `64e90340...`.
  - During activation, `activate_preflight.rs` queries `manifest.inventory` for `systemd/dam-hopper-recovery.service` and expects the unrendered template hash (`352b2cd1...`), resulting in a false-positive digest mismatch.

---

## 2. Technical Analysis & Trace

### 2.1 File Generation & Archive Packaging
In `deploy/release/build-release-archive.sh:178-179`:
```bash
cp -p "${RECOVERY_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-recovery.service"
chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-recovery.service"
```
- `${RECOVERY_SERVICE_IN}` is `deploy/systemd/dam-hopper-recovery.service.in`.
- Line 13 contains: `ExecStart=@RELEASE_ROOT@/bin/dam-hopper-manager recover --boot`.
- `sha256sum deploy/systemd/dam-hopper-recovery.service.in`:
  `352b2cd1247778ea5a041bf3bf0280da357da2314cc7677f5397a9050c7305ba`.
- When `generate-release-manifest.mjs` generates `release-manifest.json`, it hashes the raw file in the archive and writes:
  ```json
  { "path": "systemd/dam-hopper-recovery.service", "sha256": "352b2cd1247778ea5a041bf3bf0280da357da2314cc7677f5397a9050c7305ba", ... }
  ```

### 2.2 Staging Phase (Rendering)
In `server/src/linux_release/stage_units.rs:130-139`:
```rust
let recovery_template = load_release_template(
    target_dir,
    "systemd/dam-hopper-recovery.service.in",
    "systemd/dam-hopper-recovery.service",
    allow_checked_in_fallback,
)?;
let rendered_recovery = render_recovery_unit(&recovery_template, &ctx)?;
let recovery_unit_path = pending_units_dir.join("dam-hopper-recovery.service");
write_file_with_mode(&recovery_unit_path, rendered_recovery.as_bytes(), 0o644)?;
```
In `server/src/linux_release/unit.rs:141-166`:
```rust
pub fn render_recovery_unit(template: &str, ctx: &UnitRenderContext) -> Result<String, ReleaseError> {
    let rendered = render_unit(template, ctx)?;
    ...
}
```
`render_unit` replaces token `@RELEASE_ROOT@` with `ctx.release_root` (`/var/lib/dam-hopper/releases/v0.2.0/server`).
The rendered content on disk becomes:
`ExecStart=/var/lib/dam-hopper/releases/v0.2.0/server/bin/dam-hopper-manager recover --boot`.
SHA-256 of this rendered file is `64e9034058a6aadf5ce5001a09ea6b7632e163af53becec5b61017928af5e38f`.

### 2.3 Activation Phase (Preflight Check Failure)
In `server/src/linux_release/activate_preflight.rs:222-236`:
```rust
let recovery_digest = manifest
    .inventory
    .iter()
    .find(|entry| entry.path == "systemd/dam-hopper-recovery.service")
    .and_then(|entry| entry.sha256.as_ref())
    .ok_or_else(|| ReleaseError::Config("release manifest has no recovery service digest".to_string()))?;

verify_candidate_file(
    &units_path.join(RECOVERY_SERVICE_UNIT),
    0o644,
    Some(recovery_digest),
)?;
```
- `units_path.join(RECOVERY_SERVICE_UNIT)` reads the rendered file on disk: hash = `64e90340...`.
- `recovery_digest` is `352b2cd1...` from `manifest.inventory`.
- `verify_candidate_file` fails at line 342:
  ```rust
  if got != *expected_hash {
      return Err(ReleaseError::ArchiveDigestMismatch { path, expected: expected_hash.clone(), got });
  }
  ```

### 2.4 Contrast With Other Service Units
- **`API_SERVICE_UNIT` & `WEB_SERVICE_UNIT`**:
  `stage_transaction.rs:206-211` hashes the rendered units on disk *after* template substitution and stores them in `candidate.api_unit_sha256` and `candidate.web_unit_sha256`. In `activate_preflight.rs:237-249`, they are verified against `candidate.api_unit_sha256` and `candidate.web_unit_sha256`, NOT `manifest.inventory`.
- **`dam-hopper-web.conf`**:
  `activate_preflight.rs:251` calls `verify_candidate_file(&units_path.join("dam-hopper-web.conf"), 0o644, None)` with `None` (checking file existence and mode `0o644`, without digest mismatch).
- **`dam-hopper-recovery.service`**:
  Mistakenly compared rendered output against the unrendered archive entry hash.

---

## 3. Potential Fix Options (Not Automatically Applied)

### Option 1 (Recommended, Minimal & Robust):
In `server/src/linux_release/activate_preflight.rs:222-236`:
Do not compare rendered unit against the unrendered manifest template hash. Verify file permissions and validate that `ExecStart` adheres to recovery unit policy:
```rust
verify_candidate_file(
    &units_path.join(RECOVERY_SERVICE_UNIT),
    0o644,
    None,
)?;

let recovery_bytes = fs::read(units_path.join(RECOVERY_SERVICE_UNIT))
    .map_err(|e| ReleaseError::Io { action: "read candidate recovery unit", details: e.to_string() })?;
let recovery_str = String::from_utf8_lossy(&recovery_bytes);
let parsed = ParsedUnit::parse(&recovery_str)?;
let expected_exec = format!("{}/bin/dam-hopper-manager recover --boot", candidate.release_path);
if parsed.get_value("Service", "ExecStart") != Some(expected_exec.as_str()) {
    return Err(ReleaseError::UnitPolicyViolation {
        unit: RECOVERY_SERVICE_UNIT.into(),
        reason: format!("ExecStart does not match candidate release path: '{expected_exec}'"),
    });
}
```
*Benefits*: Fixes activation immediately without changing `manager.json` state schema, and without modifying archive packaging.

### Option 2 (State-Tracking Approach):
In `server/src/linux_release/stage_transaction.rs`:
Record `recovery_unit_sha256: Option<String>` in `PendingCandidateRecord` during staging (like `api_unit_sha256`), and in `activate_preflight.rs` verify against `candidate.recovery_unit_sha256`.

---

## 4. Unresolved Questions
- None. The cause and fix mechanisms are fully isolated and grounded in code.
