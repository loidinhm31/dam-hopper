# Diagnostic Report: Activation Metadata Mismatch and Rollback Failure (v0.2.0 -> v0.3.1)

**File**: `plans/reports/debugger-260915-0251-activation-metadata-mismatch-rollback-failure.md`  
**Date**: 2026-09-15  
**Author**: RootCauseDebugger  
**Status**: Completed (Investigation Only)  

---

## 1. Executive Summary

During upgrade from `v0.2.0` to `v0.3.1` using `dam-hopper-install.sh`, two cascading failures occurred:
1. **Activation Failure**: `API runtime object /var/lib/dam-hopper metadata mismatch: expected type=directory uid=1000 gid=1000 mode=0o700, current type=directory uid=1000 gid=1000 mode=0o755`.
2. **Rollback Failure**: `manifest JSON deserialization failed: unknown field `identity`, expected one of `unitName`, `bindHost`, `port`, `healthPath` at line 1595 column 16`.
3. **State Machine Trap**: Both activation and rollback failed, triggering `activate.rs:258` and placing host into `RECOVERY_REQUIRED`.

Investigation confirms both bugs stem from design changes introduced in commit `29f770c` ("feat(release): reconcile API runtime identity provisioning"):
- `/var/lib/dam-hopper` mode `0o755` was created in `v0.2.0` by systemd default `StateDirectoryMode`. Commit `29f770c` instituted strict refusal provisioning requiring `0o700` without providing upgrade migration.
- Manifest schema was bumped from v1 to v2 in `29f770c`, removing `identity` from `ApiServiceContract` while retaining `#[serde(deny_unknown_fields)]`. Rollback attempted to parse active `v0.2.0` manifest using `v0.3.1` parser, causing deserialization failure.

---

## 2. Root Cause Analysis: Issue 1 (Activation Metadata Mismatch)

### 2.1 Error Trace
- **Log message**: `API runtime object /var/lib/dam-hopper metadata mismatch: expected type=directory uid=1000 gid=1000 mode=0o700, current type=directory uid=1000 gid=1000 mode=0o755`
- **Call site**: `server/src/linux_release/activate.rs:552` -> `provision_and_start_api` -> `server/src/linux_release/api_runtime.rs:958` (`provision_api_runtime`) -> `api_runtime.rs:824` (`provision_with`) -> `api_runtime.rs:514` (`ensure_dir`) -> `api_runtime.rs:503` (`validate`).

### 2.2 Provenance of Mode `0o755` on `/var/lib/dam-hopper`
In `v0.2.0`:
1. `deploy/systemd/dam-hopper-api.service.in` had:
   ```ini
   [Service]
   User=@API_USER@
   Group=@API_GROUP@
   StateDirectory=dam-hopper
   RuntimeDirectory=dam-hopper
   ```
2. Per `systemd.exec(5)`, `StateDirectory=` creates `/var/lib/<name>` using `StateDirectoryMode=`, which defaults to `0755` when unspecified.
3. In `v0.2.0` (`bd105433`), `activate.rs` also ran `ensure_user_config_ownership` calling `fs::create_dir_all("/var/lib/dam-hopper")` and `chown_single("/var/lib/dam-hopper", uid, gid)` under standard umask (`0022` -> `0755`).
4. Result: all existing `v0.2.0` installations have `/var/lib/dam-hopper` owned by `uid=1000, gid=1000, mode=0o755`.

### 2.3 Refusal-Based Provisioning Contract in Commit `29f770c`
Commit `29f770c` added `server/src/linux_release/api_runtime.rs` based on architecture plan `plans/260912-1221-idle-suspend-runtime-identity-reconciliation/phase-02-provision-api-runtime-paths.md`:
1. **Design Principle**: "Refusal-based gate that creates absent API audit/state paths and validates existing paths... rejects pre-existing metadata mismatches; it does not repair them."
2. **Permission Constant**: Defined `const API_DIR_MODE: u32 = 0o700`.
3. **Execution in `api_runtime.rs`**:
   ```rust
   fn ensure_dir(...) -> Result<DirFd, ReleaseError> {
       let expected = (ObjectType::Directory, uid, gid, mode);
       match sys.stat_at(parent, name) {
           Ok(stat) => {
               validate(path, stat, expected)?; // FAILS HERE: stat.mode (0o755) != expected.3 (0o700)
               ...
           }
           Err(error) if error.kind() == io::ErrorKind::NotFound => {
               // creates dir with 0700
           }
       }
   }
   ```
4. **Refusal Behavior**: If directory exists, `validate` compares `stat.mode != expected.3`. On mismatch, returns `ReleaseError::ApiRuntimeMetadataMismatch` immediately without attempting `chmod`, `chown`, or remediation.
5. **Architectural Intent**: Avoid following symlinks, prevent privilege escalation races (TOCTOU), and avoid mutating unknown host objects. Removed `StateDirectory=dam-hopper` from systemd unit files to prevent systemd from resetting permissions to `0755`.

### 2.4 The Upgrade Gap
Refusal architecture assumed clean-slate installations or that existing paths were already `0700`. The design omitted an upgrade reconciliation mechanism for existing `v0.2.0` environments created with `0755`.

---

## 3. Root Cause Analysis: Issue 2 (Manifest Rollback Deserialization)

### 3.1 Error Trace
- **Log message**: `manifest JSON deserialization failed: unknown field `identity`, expected one of `unitName`, `bindHost`, `port`, `healthPath` at line 1595 column 16`
- **Call site**: `activate.rs:241` -> `server/src/linux_release/rollback.rs:476` (`rollback_activation_failure`) -> `rollback.rs:627` (`validate_active_preflight`) -> `server/src/linux_release/activate_preflight.rs:293` (`validate_preflight`) -> `server/src/linux_release/manifest.rs:106` (`ReleaseManifest::parse_and_validate`).

### 3.2 Manifest Contract Drift Between `v0.2.0` and `v0.3.1`
In `v0.2.0` (`29f770c~1`):
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceContract {
    pub unit_name: String,
    pub identity: String,
    pub bind_host: String,
    pub port: u16,
    pub health_path: String,
}

pub struct ServicesMeta {
    pub api: ServiceContract,
    pub web: ServiceContract,
}
```
`v0.2.0` manifest (`schemaVersion: 1`) had `services.api.identity: "root"`.

In `v0.3.1` (commit `29f770c`):
- API runtime identity authority moved from manifest to unit parsing (`User=`/`Group=`).
- `schemaVersion` bumped from `1` to `2`.
- `ServiceContract` split into `ApiServiceContract` and `WebServiceContract`:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiServiceContract {
    pub unit_name: String,
    pub bind_host: String,
    pub port: u16,
    pub health_path: String,
}
```
- Notice: `identity` field dropped from `ApiServiceContract`, but `deny_unknown_fields` kept.

### 3.3 Mechanism of Failure During Rollback
1. Activation failed in `activate.rs`.
2. `activate.rs` called `rollback_activation_failure(layout, &err_msg).await`.
3. `rollback_activation_failure` retrieved currently active release `state.active` (which is `v0.2.0`).
4. At line 626-627:
   ```rust
   let cand = release_to_candidate(&active);
   validate_active_preflight(layout, &cand, &[])?;
   ```
5. `validate_active_preflight` called `validate_preflight`.
6. `validate_preflight` read `/var/lib/dam-hopper/releases/v0.2.0/server/release-manifest.json` and passed it to `ReleaseManifest::parse_and_validate(&manifest_bytes)`.
7. Because installer replaced `/usr/local/bin/dam-hopper` with `v0.3.1` manager, `ReleaseManifest::parse_and_validate` used `v0.3.1` struct definitions.
8. `serde_json::from_slice` encountered `"identity": "root"` in `services.api`.
9. `#[serde(deny_unknown_fields)]` rejected `"identity"`, failing deserialization before reaching invariant checks.
10. **Secondary Defect**: Even if deserialization permitted unknown fields, `manifest_validation.rs:11` strictly asserts `m.schema_version != RELEASE_MANIFEST_SCHEMA_VERSION` (2). It would reject `v0.2.0` (`schemaVersion: 1`) with `InvalidSchemaVersion { expected: 2, got: 1 }`.

---

## 4. Root Cause Analysis: Issue 3 (`RECOVERY_REQUIRED` Host State)

### 4.1 State Machine Flow in `server/src/linux_release/activate.rs`
1. Line 226: `execute_activation_pipeline` started candidate activation.
2. Unit files switched, daemon reloaded (`TransactionPhase::Switched`).
3. Line 552: `provision_and_start_api` failed on metadata mismatch (`0o700` vs `0o755`).
4. Line 235: Caught error `err_msg`.
5. Line 237: Recorded failure in transaction (`ACTIVATION_FAILED`).
6. Line 241: Invoked `rollback_activation_failure(layout, &err_msg).await`.
7. Line 252: `rollback_activation_failure` failed with manifest deserialization error (`rollback_err`).
8. Line 258-261:
   ```rust
   return Err(ReleaseError::Config(format!(
       "CRITICAL: activation failed ({err_msg}) AND rollback failed ({rollback_err}){record_suffix}: RECOVERY_REQUIRED"
   )));
   ```
9. Dual failure left active release un-restored and new release un-activated. System entered unrecoverable state `RECOVERY_REQUIRED` to halt automated execution and require manual administrator recovery.

---

## 5. Timeline of Events

```
1. Host running v0.2.0
   ├── /var/lib/dam-hopper has mode 0755 (created via systemd StateDirectory=dam-hopper)
   └── Active manifest is schemaVersion 1 with services.api.identity = "root"

2. Operator runs dam-hopper-install.sh (v0.3.1)
   ├── Extracted v0.3.1 dam-hopper-manager to /usr/local/bin/dam-hopper
   ├── Staged candidate v0.3.1 release bundle
   └── Executed activation: dam-hopper start

3. execute_activation_pipeline (activate.rs)
   ├── Switched units to v0.3.1
   └── Called provision_and_start_api()

4. api_runtime.rs::provision_with()
   ├── ensure_dir("/var/lib/dam-hopper", expected_mode=0700)
   ├── Discovered existing directory with mode 0755
   └── validate() returned ApiRuntimeMetadataMismatch (Refusal contract)

5. Activation failure handling (activate.rs:241)
   └── Called rollback_activation_failure() to restore v0.2.0

6. rollback_activation_failure() (rollback.rs:627)
   ├── Read v0.2.0 release-manifest.json
   └── ReleaseManifest::parse_and_validate() failed on unknown field `identity`

7. activate.rs:258 reached
   └── Returned CRITICAL: activation failed AND rollback failed: RECOVERY_REQUIRED
```

---

## 6. Impact Assessment

- **Blast Radius**: 100% of hosts upgrading in-place from `v0.2.0` to `v0.3.1` using `dam-hopper-install.sh`.
- **Downtime**: Host enters `RECOVERY_REQUIRED`, stopping server units and failing both startup and rollback.
- **Rollback Safety**: Release manager is currently incapable of rolling back to any release packaged with `schemaVersion: 1` manifest.

---

## 7. Recommended Resolution Strategy (For User Consideration)

*Note: Per instructions, no production code has been modified. The following options are presented for engineering evaluation.*

### 7.1 Fix Option A: Comprehensive Dual-Fix in Release Manager (Recommended)

1. **Fix Manifest Backward Compatibility (`manifest.rs` & `manifest_validation.rs`)**:
   - In `manifest.rs`:
     - Allow optional `identity` on `ApiServiceContract`:
       ```rust
       pub struct ApiServiceContract {
           pub unit_name: String,
           #[serde(default, skip_serializing_if = "Option::is_none")]
           pub identity: Option<String>,
           pub bind_host: String,
           pub port: u16,
           pub health_path: String,
       }
       ```
       or allow unknown fields during deserialization of rollback manifests.
   - In `manifest_validation.rs`:
     - Accept `schema_version == 1 || schema_version == 2` when validating candidate manifests during rollback, or normalize v1 manifests to v2.

2. **Fix Runtime Directory Permission Reconciliation (`api_runtime.rs` or `activate.rs`)**:
   - In `api_runtime.rs`:
     - If `/var/lib/dam-hopper` pre-exists as a genuine directory owned by the expected UID:GID, allow safe permission tightening (`0o755` -> `0o700` via `fchmod`) instead of immediate refusal. Tightening permissions is safe and cannot escalate privileges.
   - OR in `activate.rs` / `migration`:
     - Add explicit preflight migration: check if `/var/lib/dam-hopper` is `0755` owned by `identity.uid:identity.gid`, and safely `chmod 0700` before `provision_and_start_api`.

### 7.2 Fix Option B: Installer-Side Workaround (`dam-hopper-install.sh`)

- Before calling `dam-hopper start`, `dam-hopper-install.sh` can run:
  ```bash
  chmod 0700 /var/lib/dam-hopper 2>/dev/null || sudo chmod 0700 /var/lib/dam-hopper
  ```
- *Caveat*: Option B resolves Issue 1 (activation succeeds), but does NOT resolve Issue 2 if activation fails for any other reason and rollback is attempted. Option A is required for true resilience.

---

## 8. Unresolved Questions

1. Was `schemaVersion: 2` intended to be backwards-compatible with `v0.2.0` (`schemaVersion: 1`) during rollback, or was multi-version rollback considered out of scope?
2. Does the security threat model permit `fchmod` permission tightening on directories already owned by the target user, or does refusal strictly prohibit all mutation of pre-existing objects?
