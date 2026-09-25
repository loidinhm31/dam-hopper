# Release v0.5.0 Diagnostic: Missing `dam-hopper-plugin-runner` Binary

## Executive Summary

- **Incident**: Installation of release `v0.5.0` on Linux fails during candidate unit staging:
  `install failed: systemd command systemd-analyze verify failed with exit code Some(1): dam-hopper-plugin-runner.service: Command /opt/dam-hopper/releases/v0.5.0/both/bin/dam-hopper-plugin-runner is not executable: No such file or directory`
- **Root Cause**: Published tarball `dam-hopper-v0.5.0-linux-x86_64-systemd.tar.gz` packages `systemd/dam-hopper-plugin-runner.service` (which executes `/opt/dam-hopper/releases/v0.5.0/both/bin/dam-hopper-plugin-runner`), but completely omits the `bin/dam-hopper-plugin-runner` binary.
- **Escape Vector**: Systemic blind spot across 6 points:
  1. `server/src/bin/dam-hopper-plugin-runner.rs` lacked Clap `version` attribute, breaking `--version` checks.
  2. `deploy/release/build-release-archive.sh` conditionally copied `RUNNER_BIN` only `if [[ -f ]]` with no upfront failure check.
  3. `deploy/release/check-release-assets.mjs` omitted runner binary and units from `REQUIRED_INVENTORY_PATHS`.
  4. `.github/workflows/release-linux.yml` compiled runner but excluded it from verification, artifact upload, and `chmod +x`.
  5. `.github/workflows/ci.yml` excluded runner from `check-version-alignment.mjs` and artifact uploads.
  6. `tests/deploy/linux-release-package-twice.sh` excluded runner from the required executable preflight loop.
- **Remediation Priority**: Critical. Requires updating all 6 files and cutting patch release `v0.5.1`.

---

## Detailed Root Causes Analysis

### 1. `server/src/bin/dam-hopper-plugin-runner.rs`: Missing Clap Version Attribute

- **Location**: `server/src/bin/dam-hopper-plugin-runner.rs:12-15`
- **Observed Code**:
  ```rust
  #[derive(Parser, Debug)]
  #[command(name = "dam-hopper-plugin-runner")]
  #[command(about = "Owner-account plugin runner and worker supervisor for DamHopper")]
  struct Args {
  ```
- **Analysis**:
  - Missing `version` attribute in `#[command(...)]`.
  - Contrast with sibling binaries:
    - `dam-hopper-server` (`server/src/main.rs:26`): `#[command(name = "dam-hopper-server", version, ...)]`
    - `dam-hopper-web` (`server/src/bin/dam-hopper-web.rs:13`): `#[command(name = "dam-hopper-web", version, ...)]`
    - `dam-hopper-idle-suspend-helper` (`server/src/bin/dam-hopper-idle-suspend-helper.rs:24`): `#[command(name = "dam-hopper-idle-suspend-helper", version, ...)]`
    - `dam-hopper` (`server/src/linux_release/cli.rs:12`): `#[command(name = "dam-hopper", ..., version)]`
  - Without `version`, executing `dam-hopper-plugin-runner --version` fails with Clap error:
    `error: unexpected argument '--version' found` (exit code 2).
  - This blocked integration into version verification tools (`check-version-alignment.mjs --bin`) and CI workflows.

### 2. `deploy/release/build-release-archive.sh`: Asymmetric & Conditional Copy Logic

- **Location**: `deploy/release/build-release-archive.sh:109-135, 182-186, 203-214`
- **Observed Code**:
  - Upfront checks (lines 109-135) strictly enforce:
    ```bash
    # dam-hopper / dam-hopper-manager, dam-hopper-server, dam-hopper-idle-suspend-helper, dam-hopper-web
    if [[ ! -f "${SERVER_BIN}" ]]; then echo "..."; exit 1; fi
    if [[ ! -f "${HELPER_BIN}" ]]; then echo "..."; exit 1; fi
    if [[ ! -f "${WEB_BIN}" ]]; then echo "..."; exit 1; fi
    ```
    `RUNNER_BIN` is completely omitted from upfront validation.
  - Packaging binary (lines 182-186):
    ```bash
    RUNNER_BIN="${TARGET_DIR}/dam-hopper-plugin-runner"
    if [[ -f "${RUNNER_BIN}" ]]; then
        cp -p "${RUNNER_BIN}" "${TMP_STAGE}/bin/dam-hopper-plugin-runner"
        chmod 0755 "${TMP_STAGE}/bin/dam-hopper-plugin-runner"
    fi
    ```
    If `RUNNER_BIN` is missing from `TARGET_DIR`, the script silently ignores it and continues.
  - Packaging units (lines 203-214):
    ```bash
    RUNNER_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-plugin-runner.service.in"
    if [[ -f "${RUNNER_SERVICE_IN}" ]]; then
        cp -p "${RUNNER_SERVICE_IN}" "${TMP_STAGE}/systemd/dam-hopper-plugin-runner.service"
        chmod 0644 "${TMP_STAGE}/systemd/dam-hopper-plugin-runner.service"
    fi
    ```
    Because `dam-hopper-plugin-runner.service.in` exists in git, it was unconditionally copied.
  - **Consequence**: Archive packaged a systemd service containing `ExecStart=@RELEASE_ROOT@/bin/dam-hopper-plugin-runner` without packaging `bin/dam-hopper-plugin-runner`.

### 3. `deploy/release/check-release-assets.mjs`: Missing Inventory Invariant

- **Location**: `deploy/release/check-release-assets.mjs:56-67, 206, 260-276`
- **Observed Code**:
  ```javascript
  const REQUIRED_INVENTORY_PATHS = Object.freeze([
    "bin/dam-hopper-manager",
    "bin/dam-hopper-server",
    "bin/dam-hopper-idle-suspend-helper",
    "bin/dam-hopper-web",
    "web",
    "systemd/dam-hopper-api.service",
    "systemd/dam-hopper-idle-suspend-helper.service",
    "systemd/dam-hopper-web.service",
    "systemd/dam-hopper-recovery.service",
    "sysusers.d/dam-hopper-web.conf",
  ]);
  ```
- **Analysis**:
  - `REQUIRED_INVENTORY_PATHS` defines paths that MUST exist in archive and manifest.
  - `bin/dam-hopper-plugin-runner`, `systemd/dam-hopper-plugin-runner.service`, and `tmpfiles.d/dam-hopper-plugin-runner.conf` are omitted from `REQUIRED_INVENTORY_PATHS`.
  - While lines 262 & 272 added `case "bin/dam-hopper-plugin-runner"` to validate attributes (file type, mode 0755, role `server`) *if present*, validator never flags missing paths.
  - Manifest validator (lines 423-428) enforces `manifest.services.runner`:
    ```javascript
    if (
      manifest.services.runner.unitName !== "dam-hopper-plugin-runner.service" ||
      manifest.services.runner.socketPath !== "/run/dam-hopper/plugin-runner.sock"
    ) { failMigration(...); }
    ```
  - Gate validated that `services.runner` contract exists in manifest while allowing archive inventory to lack the actual binary.

### 4. `.github/workflows/release-linux.yml`: Binary Pipeline Drop

- **Location**: `.github/workflows/release-linux.yml:74-96, 185-200`
- **Job `build-rust`**:
  - Line 77 compiles all bins: `cargo build --release --features vendored --target x86_64-unknown-linux-gnu --bins` (produces `dam-hopper-plugin-runner`).
  - Lines 81-84 verify version on 4 binaries:
    ```yaml
    server/target/x86_64-unknown-linux-gnu/release/dam-hopper --version
    server/target/x86_64-unknown-linux-gnu/release/dam-hopper-server --version
    server/target/x86_64-unknown-linux-gnu/release/dam-hopper-web --version
    server/target/x86_64-unknown-linux-gnu/release/dam-hopper-idle-suspend-helper --version
    ```
    `dam-hopper-plugin-runner --version` omitted.
  - Lines 90-95 upload artifact `rust-binaries`:
    Lists only the same 4 binaries. `dam-hopper-plugin-runner` omitted.
- **Job `package-release`**:
  - Downloads `rust-binaries` to `artifacts/bin`. Runner binary is absent.
  - Line 199: `chmod +x` lists only 4 binaries; runner omitted.
  - Calls `linux-release-package-twice.sh` with `--target-dir "artifacts/bin"`.

### 5. `.github/workflows/ci.yml`: CI Verification & Artifact Drop

- **Location**: `.github/workflows/ci.yml:59-77`
- **Job `build-linux`**:
  - Line 60 builds `--bins`.
  - Line 66:
    ```bash
    node deploy/release/check-version-alignment.mjs \
      --bin server/target/release/dam-hopper \
      --bin server/target/release/dam-hopper-server \
      --bin server/target/release/dam-hopper-web \
      --bin server/target/release/dam-hopper-idle-suspend-helper
    ```
    `--bin server/target/release/dam-hopper-plugin-runner` omitted.
  - Lines 71-75 upload artifact `dam-hopper-linux-x86_64-binaries`: runner omitted.
  - `pnpm test:deploy` passed in CI because test suites invoke `create_mock_release_bundle` (`tests/deploy/linux-release-common.sh:113`), which artificially synthesizes a mock shell runner binary (`echo runner $ver > runner_bin`). Real packaging workflow (`release:package-twice`) was never invoked in CI.

### 6. `tests/deploy/linux-release-package-twice.sh`: Verification Loop Omission

- **Location**: `tests/deploy/linux-release-package-twice.sh:54-59`
- **Observed Code**:
  ```bash
  for binary in dam-hopper dam-hopper-server dam-hopper-web dam-hopper-idle-suspend-helper; do
      if [[ ! -f "$TARGET_DIR/$binary" || ! -x "$TARGET_DIR/$binary" ]]; then
          printf 'Error: required executable is missing or not executable: %s/%s\n' "$TARGET_DIR" "$binary" >&2
          exit 1
      fi
  done
  ```
- **Analysis**:
  - Loop checks existence and executable bits for 4 binaries.
  - `dam-hopper-plugin-runner` omitted.
  - Allowed `package-release` in `release-linux.yml` to succeed despite `artifacts/bin/dam-hopper-plugin-runner` not existing.

---

## Failure Mechanism During Installation

1. Operator runs `dam-hopper-install.sh --version v0.5.0 --role both` (or `server`).
2. Tarball extracted to `/opt/dam-hopper/releases/v0.5.0/both/`.
3. Manager executes `stage_candidate_units_inner` (`server/src/linux_release/stage_units.rs`).
4. Role `both` / `server` activates `role.includes_server()`.
5. Loads `systemd/dam-hopper-plugin-runner.service` from release root, renders unit:
   `ExecStart=/opt/dam-hopper/releases/v0.5.0/both/bin/dam-hopper-plugin-runner --socket-path /run/dam-hopper/plugin-runner.sock ...`
6. Staged unit written to transaction directory and added to `staged_unit_paths`.
7. Pre-flight verification runs: `systemd_analyze_verify(&staged_unit_paths, None)`.
8. `systemd-analyze` inspects `dam-hopper-plugin-runner.service`, checks `ExecStart` target `/opt/dam-hopper/releases/v0.5.0/both/bin/dam-hopper-plugin-runner`.
9. Target file does not exist on disk.
10. `systemd-analyze verify` exits code 1 with:
    `dam-hopper-plugin-runner.service: Command /opt/dam-hopper/releases/v0.5.0/both/bin/dam-hopper-plugin-runner is not executable: No such file or directory`
11. Transaction aborts; release staging fails closed.

---

## Impact & Blast Radius

- **Linux Server Deployments**: 100% failure rate for all clean installs and upgrades of v0.5.0 targeting roles `server` or `both`.
- **Linux Web Role**: Role `web` installs cleanly because runner unit is gated under `role.includes_server()`.
- **Windows**: Unaffected (Windows targets `dam-hopper-server.exe` only; plugin runner is Unix-gated).
- **Public Assets**: GitHub release `v0.5.0` assets `dam-hopper-v0.5.0-linux-x86_64-systemd.tar.gz` and `release-manifest.json` are permanently broken.
- **Rollback Behavior**: Upgrade attempts from v0.4.x fail closed and roll back cleanly to the existing active release without corrupting host state.

---

## Proposed Exact Remediations

### 1. `server/src/bin/dam-hopper-plugin-runner.rs`
Add `version` attribute to command declaration:
```rust
#[derive(Parser, Debug)]
#[command(
    name = "dam-hopper-plugin-runner",
    version,
    about = "Owner-account plugin runner and worker supervisor for DamHopper"
)]
struct Args {
```

### 2. `deploy/release/build-release-archive.sh`
Enforce upfront existence check and copy unconditionally:
```bash
# Line ~135: Add upfront validation
RUNNER_BIN="${TARGET_DIR}/dam-hopper-plugin-runner"
if [[ ! -f "${RUNNER_BIN}" ]]; then
    echo "Error: 'dam-hopper-plugin-runner' binary not found in '${TARGET_DIR}'" >&2
    exit 1
fi

# Line ~150: Add required templates to req_file validation loop
RUNNER_SERVICE_IN="${REPO_ROOT}/deploy/systemd/dam-hopper-plugin-runner.service.in"
RUNNER_TMPFILES_IN="${REPO_ROOT}/deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in"
# Add ${RUNNER_SERVICE_IN} and ${RUNNER_TMPFILES_IN} to req_file loop

# Line ~182: Unconditional copy
cp -p "${RUNNER_BIN}" "${TMP_STAGE}/bin/dam-hopper-plugin-runner"
chmod 0755 "${TMP_STAGE}/bin/dam-hopper-plugin-runner"
```

### 3. `deploy/release/check-release-assets.mjs`
Add runner paths to `REQUIRED_INVENTORY_PATHS`:
```javascript
const REQUIRED_INVENTORY_PATHS = Object.freeze([
  "bin/dam-hopper-manager",
  "bin/dam-hopper-server",
  "bin/dam-hopper-idle-suspend-helper",
  "bin/dam-hopper-plugin-runner",
  "bin/dam-hopper-web",
  "web",
  "systemd/dam-hopper-api.service",
  "systemd/dam-hopper-idle-suspend-helper.service",
  "systemd/dam-hopper-plugin-runner.service",
  "systemd/dam-hopper-web.service",
  "systemd/dam-hopper-recovery.service",
  "sysusers.d/dam-hopper-web.conf",
  "tmpfiles.d/dam-hopper-plugin-runner.conf",
]);
```

### 4. `.github/workflows/release-linux.yml`
- In `build-rust`:
  - Add version check:
    `server/target/x86_64-unknown-linux-gnu/release/dam-hopper-plugin-runner --version`
  - Add path to `Upload compiled Rust binaries`:
    `server/target/x86_64-unknown-linux-gnu/release/dam-hopper-plugin-runner`
- In `package-release`:
  - Add to `Make binaries executable`:
    `chmod +x ... artifacts/bin/dam-hopper-plugin-runner`

### 5. `.github/workflows/ci.yml`
- In `build-linux`:
  - Add `--bin server/target/release/dam-hopper-plugin-runner` to `node deploy/release/check-version-alignment.mjs`.
  - Add `server/target/release/dam-hopper-plugin-runner` to artifact upload `dam-hopper-linux-x86_64-binaries`.
  - Add real package validation check step: `pnpm release:package-twice --version "v0.0.0" ...` or run package-twice on dummy tag to ensure real release assembly is tested on every PR.

### 6. `tests/deploy/linux-release-package-twice.sh`
Update required binaries loop:
```bash
for binary in dam-hopper dam-hopper-server dam-hopper-web dam-hopper-idle-suspend-helper dam-hopper-plugin-runner; do
    if [[ ! -f "$TARGET_DIR/$binary" || ! -x "$TARGET_DIR/$binary" ]]; then
        printf 'Error: required executable is missing or not executable: %s/%s\n' "$TARGET_DIR" "$binary" >&2
        exit 1
    fi
done
```

### 7. Release Operations
- Tag and publish release `v0.5.1` with the above fixes.
- Add warning note to GitHub release v0.5.0 deprecating it for Linux server roles.

---

## Unresolved Questions

1. Should `pnpm release:package-twice` be added to default PR `ci.yml` checks (using dummy version like `v0.0.0`) so that packaging regressions are caught before tag creation rather than during release publication?
2. Should `tests/deploy/linux-release-common.sh:create_mock_release_bundle` be deprecated in favor of running `deploy/release/build-release-archive.sh` directly in deploy integration tests to prevent drift between mock bundles and actual release bundles?
