# Code Review: Phase D06 — Linux Release Integration and LAN Qualification

**Date:** 2026-09-23  
**Reviewer:** CodeReviewerD06  
**Plan:** `plans/260920-1603-plugin-platform/phase-06-linux-lan-qualification.md`  
**Overall Score:** 9.3 / 10  

---

## 1. Executive Summary

Phase D06 integrates the trusted owner runner, systemd service units, tmpfiles runtime directory provisioning, account security validation, manifest/state schema v2 migrations, and lifecycle rollback compatibility into the DamHopper Linux release manager. It also adds deployment smoke and upgrade/rollback test fixtures, plus a LAN performance qualification harness for Phase G4.

All test suites pass cleanly:
- 18 Rust test suites (173 tests) in `server/tests/linux_release*` passed.
- All 9 deployment integration tests passed (clean-install, upgrade-rollback, crash-recovery, security, reset-smoke, web-contract, Fedora 44 migration, plugin-runner-owner-smoke, plugin-upgrade-rollback).
- Release static asset gate `pnpm release:verify` passed with version alignment at v0.4.4.
- Performance budgets evaluate to 100% pass under the qualification test harness.

Zero critical blocking defects observed. Four warnings and three suggestions are documented below regarding runtime directory permissions, unit staging error propagation, health probe integration, and live network testing for LAN qualification.

---

## 2. Reviewed Files

### Core Release Manager & Server
- `server/src/linux_release/constants.rs` (+19, -2) — RUNNER_SERVICE_UNIT, RUNNER_TMPFILES_CONF, DEFAULT_RUNNER_SOCKET_PATH, DEFAULT_RUNNER_STATE_DIR, PLUGIN_SHARED_GROUP, and schema version bumps.
- `server/src/linux_release/account.rs` (+110, -0) — `verify_plugin_owner_account` enforcing non-root, non-API, non-web, safe/non-world-writable home directory, and valid non-root primary group.
- `server/src/linux_release/layout.rs` (+24, -0) — Added `tmpfiles_dir`, `runner_tmpfiles_conf_path`, `runner_state_dir`, and `runner_socket_path`.
- `server/src/linux_release/host_config.rs` (+19, -0) — `HostConfig` serialization with `plugin_owner_user` and `plugin_admin_subjects`.
- `server/src/linux_release/manifest.rs` (+12, -1) — Manifest schema v2/v3 support with optional runner component and `RunnerServiceContract`.
- `server/src/linux_release/manifest_validation.rs` (+27, -0) — Validation of runner component version and service unit/socket path contracts.
- `server/src/linux_release/state_record.rs` (+56, -0) — Extended `ReleaseRecord` and `PendingCandidateRecord` with runner unit/tmpfiles hashes and plugin metadata.
- `server/src/linux_release/state.rs` (+19, -5) — Strict n-1 migration from `MANAGER_STATE_SCHEMA_VERSION_LEGACY` (v1) to v2.
- `server/src/linux_release/stage.rs` (+46, -4) — `determine_host_role_with_plugins` wiring plugin owner and admin subjects into `HostConfig`.
- `server/src/linux_release/stage_transaction.rs` (+66, -4) — Staging release bundles with runner unit and tmpfiles hashes.
- `server/src/linux_release/stage_units.rs` (+65, -6) — Unit template loading, rendering runner unit and tmpfiles configuration.
- `server/src/linux_release/unit.rs` (+70, -2) — Token replacements for `@ADVISOR_OWNER_USER@`, `@ADVISOR_OWNER_GROUP@`, `@ADVISOR_OWNER_HOME@`, `@DAM_HOPPER_STATE_DIR@`, `@NODE_BIN@`, `@API_UID@`, `@PLUGIN_SHARED_GROUP@`.
- `server/src/linux_release/unit_policy.rs` (+45, -0) — Strict policy enforcement for `dam-hopper-plugin-runner.service` (hardening, containment, ExecStart).
- `server/src/linux_release/activate.rs` (+54, -2) — Activation pipeline handling runner unit installation, tmpfiles creation, and ordered startup.
- `server/src/linux_release/rollback.rs` (+16, -0) — Matched rollback preserving runner unit hashes and plugin configuration.
- `server/src/linux_release/recovery.rs` (+8, -0) — Boot recovery preserving plugin owner and runtime metadata.
- `server/src/linux_release/health.rs` (+41, -0) — `probe_runner_health` probing socket existence, type, permissions, and owner UID.
- `server/src/linux_release/status.rs` (+9, -2) — Inclusion of `RUNNER_SERVICE_UNIT` in `collect_all_services_status`.
- `server/src/linux_release/legacy_format2.rs` (+8, -0) — Backward compatibility with format-2 imports.
- `server/src/linux_release/cli.rs` (+16, -0) — CLI flags `--plugin-owner-user` and `--plugin-admin-subject`.
- `server/src/bin/dam-hopper.rs` (+33, -4) — Root preflight checks and upfront owner account verification.

### Packaging, Systemd & Deployment
- `deploy/systemd/dam-hopper-api.service.in` (+1, -0) — Added `SupplementaryGroups=@PLUGIN_SHARED_GROUP@`.
- `deploy/systemd/dam-hopper-plugin-runner.service.in` (+6, -3) — Hardened unit template with cgroup limits, ReadOnly paths, and parameter bindings.
- `deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in` (untracked, +4) — Tmpfiles rule for `/run/dam-hopper` and `/run/dam-hopper/plugin-runner`.
- `deploy/release/build-release-archive.sh` (+19, -0) — Bundling runner binary, systemd service, and tmpfiles configuration.
- `deploy/release/generate-release-manifest.mjs` (+11, -1) — Manifest emission for runner component and runner service contract.
- `deploy/release/check-release-assets.mjs` (+39, -8) — Asset gate checking runner binary, service, tmpfiles, and manifest contract.
- `deploy/release/release-manifest.schema.json` (+8, -2) — Schema enum updating version [2, 3] and runner service definition.
- `deploy/release/dam-hopper-install.sh` (+18, -0) — Installer CLI options `--plugin-owner-user` and `--plugin-admin-subject`.
- `package.json` (+5, -1) — Deployment and qualification scripts: `test:deploy:plugin-owner`, `test:deploy:plugin-rollback`, `test:deploy:plugin-lan`.

### Documentation, Tests & Qualification
- `docs/plugin-platform-linux.md` (untracked, +110) — Architecture, operator inputs, security constraints, and qualification procedures.
- `tests/deploy/linux-release-common.sh` (+32, -7) — Mock bundle generation with runner binary, unit, and tmpfiles rules.
- `tests/deploy/linux-release-plugin-runner-owner-smoke.sh` (untracked, +143) — Deployment scenario for owner account validation, hardening, and source immutability.
- `tests/deploy/linux-release-plugin-upgrade-rollback.sh` (untracked, +230) — Independent plugin lifecycle, host upgrade, and security precedence during rollback.
- `tests/deploy/plugin-platform-lan-qualification.mjs` (untracked, +215) — Qualification harness computing percentiles against target budgets.
- `server/tests/linux_release_plugin_runner.rs` (untracked, +192) — Rust unit tests for owner verification, unit policy, schema migration, and socket health probe.
- `server/tests/linux_release_state_machine.rs` (+43, -2) — Updated state machine tests with runner unit and plugin fields.
- `server/tests/linux_release_cli.rs` (+4, -0) — Privilege matrix updates for plugin options.

---

## 3. Critical Issues

*None observed.*

---

## 4. Warnings

### 1. RuntimeDirectory Ownership Contention on `/run/dam-hopper`
- **Location:** `deploy/systemd/dam-hopper-plugin-runner.service.in:14`, `deploy/systemd/dam-hopper-api.service.in:11`, and `deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in:3-4`
- **Observation:** Both `dam-hopper-api.service` (`User=@API_USER@`) and `dam-hopper-plugin-runner.service` (`User=@ADVISOR_OWNER_USER@`) specify `RuntimeDirectory=dam-hopper`. Furthermore, tmpfiles provisions `/run/dam-hopper/plugin-runner` (`User=@ADVISOR_OWNER_USER@`), but the runner socket is placed at `/run/dam-hopper/plugin-runner.sock` directly under `/run/dam-hopper`.
- **Impact:** Systemd sets ownership of `RuntimeDirectory=dam-hopper` to the user of whichever unit starts. If `dam-hopper-api` starts, `/run/dam-hopper` may be chowned to `@API_USER@:@API_GROUP@` with mode `0755` or `0750`. If mode is `0750`, `@ADVISOR_OWNER_USER@` (who is not in `@API_GROUP@`, only in `@PLUGIN_SHARED_GROUP@`) cannot create `/run/dam-hopper/plugin-runner.sock`. Meanwhile, the `/run/dam-hopper/plugin-runner` directory provisioned by tmpfiles remains unused.
- **Recommendation:** Place the runner socket inside the dedicated subdirectory: `/run/dam-hopper/plugin-runner/runner.sock`, and update `RuntimeDirectory=dam-hopper/plugin-runner` in `dam-hopper-plugin-runner.service.in`.

### 2. Silent Error Swallowing in `stage_candidate_units_inner` on Invalid Plugin Owner
- **Location:** `server/src/linux_release/stage_units.rs:173-188`
- **Observation:** When loading `plugin_owner_user` from `HostConfig`:
  ```rust
  if let Some(owner) = host_config.as_ref().and_then(|c| c.plugin_owner_user.as_deref()) {
      if let Ok(owner_info) = super::account::verify_plugin_owner_account(owner, Some(&service_user)) {
          ...
          server_ctx = server_ctx.with_plugin_runner_identity(...)?;
      }
  }
  ```
  If `verify_plugin_owner_account` fails (e.g. account removed or modified during upgrade), the error is silently ignored. `server_ctx` falls back to placeholder defaults (`dam-hopper-plugin-runner`, `1000`), rendering an invalid unit file that fails when started by systemd.
- **Impact:** Misconfigured or corrupted user accounts fail late at unit activation rather than failing early during unit staging.
- **Recommendation:** Propagate the error using `?` or `map_err` when `plugin_owner_user` is explicitly set in `HostConfig`.

### 3. `probe_runner_health` Not Integrated into Activation Health Gate
- **Location:** `server/src/linux_release/health.rs:289` & `server/src/linux_release/activate.rs:563-601`
- **Observation:** `probe_runner_health` is implemented and unit-tested, but `build_candidate_health_targets` in `activate_preflight.rs` only constructs HTTP probe targets for API and Web services. In `activate.rs`, runner startup failures log a warning and continue starting the API server without failing or retrying the release transaction.
- **Impact:** If the plugin runner fails to bind its socket or crashes during activation, the release transaction still commits as successful.
- **Recommendation:** If `plugin_owner_user` is configured, include a runner socket readiness check in `wait_for_health_stability` or preflight verification before finalizing the release transaction.

### 4. LAN Qualification Harness Executes Simulated Timings Only
- **Location:** `tests/deploy/plugin-platform-lan-qualification.mjs:93-115, 130`
- **Observation:** `plugin-platform-lan-qualification.mjs` executes `runSimulatedMeasurements(options)` regardless of whether `--dry-run` is passed or omitted. It does not perform live HTTP requests to `--server-origin`.
- **Impact:** Fulfills schema and percentile calculations for synthetic verification, but actual separate-machine LAN qualification requires manual execution with live network probes.
- **Recommendation:** Implement live HTTP/WebSocket fetch routines when `--dry-run` is omitted so the script can measure actual network latency and endpoint response times.

### 5. Pinned Node Runtime Packaging Deferred to G0
- **Location:** `deploy/release/build-release-archive.sh:182-186` & `deploy/systemd/dam-hopper-plugin-runner.service.in:24`
- **Observation:** Requirement 1 specifies bundling an immutable Node >=22.19 runtime inside the release archive under `/opt/dam-hopper/releases/<version>/runtime/node/bin/node`. The build script currently does not bundle Node, and units default to `--node-bin node`.
- **Impact:** System relies on system-installed `node` until G0 freezes the exact distribution, licensing, and architecture binaries.
- **Recommendation:** Track this in Unresolved Questions for Gate G0 resolution.

---

## 5. Suggestions

### 1. Populate Pending Candidate Plugin Metadata in Staging
- **Location:** `server/src/linux_release/stage_transaction.rs:297-300`
- **Observation:** `plugin_owner_uid`, `plugin_admin_config_sha256`, and `plugin_runtime_node_version` are hardcoded to `None` in `PendingCandidateRecord`.
- **Recommendation:** Populate `plugin_owner_uid` from `owner_info.uid` during staging so the manager state record contains the exact resolved UID.

### 2. Add Runner Health and Socket Inspection to `dam-hopper status --json`
- **Location:** `server/src/linux_release/status.rs:42`
- **Observation:** `status.rs` reports systemd unit status for `RUNNER_SERVICE_UNIT`, but does not inspect whether the socket exists and is accepting connections.
- **Recommendation:** Add a socket health probe to the diagnostic output so operators can distinguish between systemd unit status and IPC socket availability.

---

## 6. Positive Observations

1. **Strict Defense-in-Depth Account Verification:** `verify_plugin_owner_account` thoroughly checks libc accounts, rejecting root (UID 0), API service identity, web identity, unsafe system home directories (`/`, `/root`, `/tmp`, `/dev/null`), symlinked homes, and world-writable directories (`mode & 0o002 != 0`).
2. **Hardened Systemd Unit Configuration:** `dam-hopper-plugin-runner.service.in` includes `ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges=true`, `PrivateTmp=true`, restricted address families (`AF_UNIX AF_INET AF_INET6`), `KillMode=mixed`, and strict cgroup caps (`MemoryMax=1G`, `TasksMax=64`).
3. **Security-Preserving Rollback Semantics:** Verified in `linux-release-plugin-upgrade-rollback.sh`: rolling back host software restores matched binaries and units without touching `/var/lib/dam-hopper-plugin-runner` and strictly honors current operator security intent (disabled/revoked plugins remain disabled).
4. **Source & Repository Immutability:** Deployment smoke tests prove advisor sources and target project files maintain identical SHA-256 hashes, mtimes, and permissions before and after staging, activation, rollback, and cleanup.
5. **Clean State Migration:** `ManagerState` implements strict n-1 migration from schema v1 to v2, validating against unknown schema versions and correctly handling optional plugin fields.

---

## 7. Validation Commands and Results

| Command | Target / Scope | Result | Details |
|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml --test linux_release_plugin_runner` | Plugin runner unit tests, account validation, unit policy | **PASS** | 8 passed, 0 failed (0.25s) |
| `cargo test --manifest-path server/Cargo.toml --test linux_release_state_machine` | State machine envelope, migrations, rollback | **PASS** | 13 passed, 0 failed (0.31s) |
| `bash tests/deploy/linux-release-plugin-runner-owner-smoke.sh` | Deployment smoke test: owner account, hardening, source immutability | **PASS** | 6/6 assertions passed (8.38s) |
| `bash tests/deploy/linux-release-plugin-upgrade-rollback.sh` | Independent lifecycle, host upgrade, security intent on rollback | **PASS** | 6/6 assertions passed (0.11s) |
| `node tests/deploy/plugin-platform-lan-qualification.mjs --evidence-dir /tmp/test-lan --dry-run` | LAN qualification harness and performance budget check | **PASS** | 5/5 budgets passed (0.07s) |
| `cargo test --manifest-path server/Cargo.toml --test "linux_release*"` | Full Linux release test suite | **PASS** | 173 passed, 0 failed across 18 suites |
| `pnpm test:deploy` | Full deploy test suite | **PASS** | 9/9 deploy scripts passed (9.71s) |
| `pnpm release:verify` | Release assets & version alignment gate | **PASS** | v0.4.4 aligned across cargo, package, and git tag |

---

## 8. Unresolved Questions

1. **G0 Pinned Node Selection:** Exact Node >=22.19 distribution, licensing, source archive, architecture-specific binaries, and SHA-256 digests for release bundling remain to be selected and signed off at Gate G0.
2. **Physical LAN Multi-Machine Hardware Setup:** Final G4 qualification requires execution against physical hardware on a separate client machine across an authenticated, encrypted LAN (<=10ms RTT) with real browser interactions on a 10,000-history dataset.
