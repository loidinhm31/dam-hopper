# Hard-Fix Report: Dedicated Service User Prompt & Least-Privilege Execution

- **Date:** 2026-09-05
- **Task:** Security enhancement for CLI `dam-hopper` release flow (`.github/workflows/release-linux.yml`). Prevent first run using `root` and prompt user for dedicated non-root service account on start.
- **Advisor Mode:** Consulted `~/.evcrate/bin/evcrate-advisor` checkpoint `review:hard-fix` per `/cmd-fix__hard` advice mentoring contract.

---

## 1. Executive Summary

Previously, `dam-hopper-api.service.in` ran with `User=root` and `Group=root`, allowing the backend API daemon to operate with unrestricted host privileges. Additionally, `dam-hopper start` lacked interactive configuration for service identity, making root execution the unprompted default.

This change eliminates root service execution:
1. **Interactive Service Account Prompt:** When running `dam-hopper start` in an interactive terminal without `--service-user`, the CLI prompts: `Run dam-hopper-api as user [dam-hopper]: `. In non-interactive environments, it defaults safely to `dam-hopper` unless explicitly overridden via `--service-user <user>`.
2. **Template Parameterization:** `deploy/systemd/dam-hopper-api.service.in` now binds `@API_USER@`, `@API_GROUP@`, `@API_HOME@`, and `XDG_CONFIG_HOME=@API_HOME@/.config`.
3. **Account & Preflight Hardening:** Validates target account with `getpwnam`, enforcing non-root (`uid != 0`), valid login shell, and accessible home directory. Preflight probes now verify the active process UID/GID against the configured service account.
4. **Clean Reinstall & Stop Commands:** Added `dam-hopper stop [--clean]` and `dam-hopper install --reinstall` (`dam-hopper-install.sh --reinstall`), preventing conflicts when reinstalling existing releases.

---

## 2. Advisor Consultation

Invoked `~/.evcrate/bin/evcrate-advisor` with checkpoint `review:hard-fix`.

- **Decision:** Interactive prompt on `start` with non-interactive fallback to `dam-hopper`.
- **Systemd Unit:** Parameterize `User`, `Group`, `Environment=HOME=...`, `Environment=XDG_CONFIG_HOME=...`, and `WorkingDirectory=...` in API service.
- **Permissions:** Auto-adjust directory ownership and permissions (`0750` for `/var/lib/dam-hopper`, `0755` for `/etc/dam-hopper`).
- **Disposition:** Adopted advisor guidance without alteration.

---

## 3. Files Modified

| File | Changes |
|---|---|
| `deploy/systemd/dam-hopper-api.service.in` | Replaced hardcoded `root` with `@API_USER@`, `@API_GROUP@`, `@API_HOME@`, and `XDG_CONFIG_HOME=@API_HOME@/.config`. |
| `deploy/release/dam-hopper-install.sh` | Added `--reinstall` and `--service-user` support, stopping services and cleaning release dirs prior to re-staging. |
| `server/src/bin/dam-hopper.rs` | Added `dam-hopper stop [--clean]`, wired `--service-user` and `--non-interactive` to `start`, and added `reinstall` to `install`. |
| `server/src/linux_release/cli.rs` | Defined `StopArgs`, added `service_user` and `non_interactive` to `StartArgs`, and added `reinstall` to `InstallArgs` and `RoleSetArgs`. |
| `server/src/linux_release/activate.rs` | Added interactive prompt logic, account verification (`verify_api_service_account`), unit template rewrite (`update_unit_service_identity`), and directory permission updates. |
| `server/src/linux_release/activate_preflight.rs` | Added `resolve_api_service_uid_gid` to verify running daemon UID/GID against the chosen account. |
| `server/src/linux_release/migration.rs` | Updated `execute_staging_transaction` call signature. |
| `server/src/linux_release/mod.rs` | Exported `StopArgs`. |
| `server/src/linux_release/privilege.rs` | Required EUID 0 for `Commands::Stop`. |
| `server/src/linux_release/stage_transaction.rs` | Supported `reinstall` to stop running units and overwrite active/previous release destinations safely. |
| `server/src/linux_release/unit_policy.rs` | Updated unit policy to require `@API_HOME@/.config` for `XDG_CONFIG_HOME`. |
| `server/tests/linux_release_cli.rs` | Added CLI tests for `dam-hopper stop`, `dam-hopper stop --clean`, privilege verification, and `reinstall`. |
| `server/tests/linux_release_staging.rs` | Added tests for `reinstall` overwriting active release destinations. |
| `server/tests/linux_release_unit_policy.rs` | Updated assertions for `XDG_CONFIG_HOME` rendering in API units. |

---

## 4. Verification & Test Evidence

1. **Unit & Integration Test Suites:**
   - `cargo test --bin dam-hopper --test 'linux_release_*'`: 122 tests passed across 17 test suites (0.15s).
   - `cargo test`: 1,068 tests passed across 32 test suites (0.00s).
2. **Deployment Journey Tests:**
   - `pnpm test:deploy`: Clean install, upgrade/rollback, crash recovery, security isolation, and web contract rehearsals all passed cleanly.
   - `bash tests/deploy/linux-release-security.sh`: Unit sandboxing, role identities (`@API_USER@`), and secret exclusion verified.
3. **Release Asset Validation:**
   - `pnpm release:verify`: Version alignment, script syntax (`bash -n`), and asset checks verified.

---

## 5. Unresolved Questions

None. All constraints, advisor recommendations, and security validations have been implemented and verified.
