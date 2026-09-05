# Hard Fix Report: Interactive Service User Prompt on Start

**Date:** 2026-09-05 04:04 Asia/Saigon
**Issue:** `dam-hopper` Linux release execution security enhancement to prompt for and apply a dedicated non-root service user on first `start` rather than running `dam-hopper-api` as `root`.
**Route:** `/cmd-fix__hard <detailed-description> --advice`

---

## 1. Root Cause & Threat Model

- In previous MVP releases, `dam-hopper-api.service.in` declared `User=root`, `Group=root`, `WorkingDirectory=/root`, and `HOME=/root`.
- Running the API server as root exposed unnecessary privilege to web services, SQLite databases, and workspace operations.
- Initial runs of `dam-hopper start` directly activated candidate units with hardcoded root identity without user confirmation.

---

## 2. Advisor Counsel & Decisions

- **Decision Checkpoint:** `decision:service-user-prompt`
- **Advisor Recommendation:** Default service identity on first `sudo dam-hopper start` to `$SUDO_USER` when valid non-root account; prompt interactively if unset; reject UID 0 and nonexistent users; persist selection in root-owned `/etc/dam-hopper/host.toml`; generate unit `User=`, `Group=`, `WorkingDirectory=`, `Environment=HOME=` dynamically; support automated deployments with `--service-user <user>` and `--non-interactive`.
- **Review Checkpoint:** `review:hard-fix` -> `ADVICE_READY`: "Ready to commit. The implementation matches the prior counsel, enforces non-root execution at both account validation and unit-policy layers, supports interactive and automated starts, and passes the full reported test and release-build matrix."

---

## 3. Changes Implemented

1. **CLI Grammar (`server/src/linux_release/cli.rs`):**
   - Added `--service-user <user>` and `--non-interactive` to `StartArgs`.
   - Added `--service-user <user>` to `InstallArgs` and `RoleSetArgs`.
2. **Account Validation & Resolution (`server/src/linux_release/account.rs`):**
   - Implemented `verify_api_service_account` rejecting empty and UID 0 (`root`) accounts.
   - Implemented `get_group_by_gid` via libc `getgrgid`.
   - Implemented `resolve_service_user` with interactive TTY prompt defaulting to `$SUDO_USER` / `dam-hopper` and non-interactive `--service-user` requirement.
3. **Host Configuration (`server/src/linux_release/host_config.rs` & `stage.rs`):**
   - Added optional `service_user: Option<String>` to `HostConfig` stored in `/etc/dam-hopper/host.toml`.
   - Preserved `service_user` across role updates in `determine_host_role`.
4. **Unit Templates & Policy (`deploy/systemd/dam-hopper-api.service.in`, `unit.rs`, `unit_policy.rs`):**
   - Updated template to use `@API_USER@`, `@API_GROUP@`, `@API_HOME@`.
   - Added `@API_USER@`, `@API_GROUP@`, `@API_HOME@` to `ALLOWED_TOKENS`.
   - Updated `UnitRenderContext` to hold and substitute API identity tokens.
   - Updated `validate_api_unit_policy` to strictly enforce `User != "root"` and require matching user, group, working directory, and `HOME` environment.
5. **Activation Pipeline (`server/src/linux_release/activate.rs` & `server/src/bin/dam-hopper.rs`):**
   - `dam-hopper start` resolves service user before preflight validation, persists it to `host.toml`, updates `dam-hopper-api.service` in pending units, and recomputes `api_unit_sha256`.
   - Exposed `execute_activation_with_args` and `execute_activation_locked_with_args`.
6. **Installer Script (`deploy/release/dam-hopper-install.sh`):**
   - Added `--service-user <user>` flag and forwarded it to `dam-hopper install`.
7. **Module Exports & Compiles (`server/src/lib.rs`, `mod.rs`, `systemd.rs`):**
   - Restored `pub mod linux_release;` and `pub mod web_host;` in `server/src/lib.rs`.
   - Added access-denied check in `systemctl_disable` for unprivileged test environments.

---

## 4. Verification Evidence

- `cargo check --bins --tests`: Clean compilation.
- `cargo test --bin dam-hopper --test 'linux_release_*'`: 119 unit and integration tests passed.
- `pnpm test:deploy`: All 6 test journeys passed (clean install, upgrade rollback, crash recovery, security, web contract, format2 migration).
- `cargo build --release --features vendored --target x86_64-unknown-linux-gnu --bins`: Release binaries compiled cleanly.
- `cargo run --release --bin dam-hopper -- --version`: Ran cleanly, reported `dam-hopper 0.2.0`.
- `pnpm test`: Full backend unit test suite (858 tests) passed.

---

## 5. Unresolved Questions

- None.
