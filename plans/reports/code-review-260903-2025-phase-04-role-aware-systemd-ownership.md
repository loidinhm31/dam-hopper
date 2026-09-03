# Code Review: Phase 04 — Role-Aware systemd Units and Ownership

## Code Review Summary

### Scope
- Files reviewed:
  - `deploy/systemd/dam-hopper-api.service.in`
  - `deploy/systemd/dam-hopper-web.service.in`
  - `deploy/sysusers.d/dam-hopper-web.conf`
  - `server/src/linux_release/unit.rs`
  - `server/src/linux_release/unit_parser.rs`
  - `server/src/linux_release/unit_policy.rs`
  - `server/src/linux_release/systemd.rs`
  - `server/src/linux_release/process.rs`
  - `server/src/linux_release/ownership.rs`
  - `server/src/linux_release/account.rs`
  - `server/src/linux_release/stage_units.rs`
  - `server/src/linux_release/host_config.rs`
  - `server/src/linux_release/stage.rs`
  - `server/src/linux_release/stage_transaction.rs`
  - `server/src/linux_release/layout.rs`
  - `server/src/linux_release/error.rs`
  - `server/src/linux_release/inventory.rs`
  - `server/src/linux_release/inventory_validation.rs`
  - `server/src/linux_release/mod.rs`
  - `server/tests/linux_release_unit_policy.rs`
  - `server/tests/linux_release_ownership.rs`
  - `server/tests/linux_release_staging.rs`
- Lines of code analyzed: ~1,500 lines across templates, runtime modules, and integration tests.
- Review focus: Security, systemd unit policy enforcement, privilege separation, process/socket inspection, atomic config persistence, and YAGNI/KISS/DRY adherence.
- Updated plans: `plans/260903-0919-linux-release-installer-architecture/phase-04-role-aware-systemd-ownership.md`

### Overall Assessment
Code quality is very high. Architecture cleanly separates concerns across modular adapters: parsing, policy validation, template rendering with injection guards, process/socket inspection, and filesystem ownership checks. The implementation enforces strict decoupling between API and web services, atomic persistence of host configuration, and robust sandboxing for the web service. Integration tests are fast (0.16s for 66 tests) and comprehensive.

### Score: 9.0/10

---

### Critical Issues
None blocking Phase 04.

*Security Architecture Note (Accepted MVP Residual Risk):*
Per the parent plan decision (`plan.md` line 63), `API_SERVICE_IDENTITY` and `dam-hopper-api.service.in` run as `User=root` and `Group=root` for MVP by owner direction. This supersedes earlier draft least-privilege references to `loidinh`. As recorded in the parent risk assessment, any API or PTY breach grants full host root compromise. The web host service, by contrast, is completely unprivileged and isolated under `dam-hopper-web`.

---

### High Priority Findings
1. **Fallback to compiled-in templates in `stage_units.rs`:**
   - In `load_template()` (`server/src/linux_release/stage_units.rs:95-125`), if a template does not exist on disk in the release directory, it falls back to `include_str!("../../../deploy/systemd/dam-hopper-api.service.in")`.
   - *Impact:* While convenient for lightweight unit tests, in production this could mask a corrupted or incomplete release bundle that failed to unpack unit templates, leading to silent fallback to the manager binary's compiled-in version.
   - *Recommendation:* Consider gating compile-time fallback to test configurations (`#[cfg(test)]`) or verifying template presence strictly in release mode.

---

### Medium Priority Improvements
1. **Unit policy validation coverage for web sandbox flags:**
   - In `deploy/systemd/dam-hopper-web.service.in`, extensive hardening flags are specified (`CapabilityBoundingSet=`, `ProtectKernelTunables=true`, `MemoryDenyWriteExecute=true`, etc.).
   - `validate_web_unit_policy` in `unit_policy.rs` asserts core flags (`Type`, `User`, `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `NoNewPrivileges`, `ReadOnlyPaths`, etc.), but does not check for `CapabilityBoundingSet` or `MemoryDenyWriteExecute`.
   - *Impact:* Accidental removal of these hardening directives from the template would pass validation.
   - *Recommendation:* Add assertions for `CapabilityBoundingSet=` and `MemoryDenyWriteExecute=true` into `validate_web_unit_policy`.

2. **`which` command invocation in `stage_units.rs`:**
   - `which_bin_exists("systemd-analyze")` spawns `Command::new("which")`.
   - *Impact:* Spawns a child process and depends on the presence of `which` binary. Minimal container environments might omit `which`.
   - *Recommendation:* Check known absolute paths (e.g., `/usr/bin/systemd-analyze`) or search `std::env::var_os("PATH")` directly in Rust without external process spawning.

3. **Web sysuser account UID verification defense-in-depth:**
   - `verify_web_sysuser_account` in `account.rs` verifies `user.uid != 0`, shell is non-login, and home is restricted.
   - *Recommendation:* Ensure the username is specifically `"dam-hopper-web"` and check that UID falls within standard system account ranges (`uid < 1000` on standard systemd systems).

---

### Low Priority Suggestions
1. **Line continuation handling in `ParsedUnit`:**
   - `ParsedUnit` currently parses line-by-line using `.split_once('=')`. Systemd supports backslash continuation lines (`\`). The current templates do not use them, but supporting continuation would make `ParsedUnit` more robust against future template edits.

---

### Positive Observations
- **Strict token allowlist and injection prevention:** `UnitRenderContext` and `render_unit()` reject control characters (`\n`, `\r`, `\0`, `\t`), require absolute paths, validate web origins strictly, and reject any unrecognized or leftover `@..._...@` tokens.
- **Symlink traversal defense:** `verify_path_permissions` uses `symlink_metadata` and explicitly fails on symlinks, preventing privilege escalation or traversal attacks.
- **Coupling prevention:** `has_coupling()` detects and rejects `Requires`, `PartOf`, `BindsTo`, `ConsistsOf`, `Wants`, `After`, `Before` references between API and web services.
- **Atomic configuration with fsync:** `save_host_public_config` writes to a PID-tagged temporary file, flushes buffer, executes `sync_all()`, and renames atomically.
- **Efficient socket inspection:** `parse_proc_net_listening` directly parses `/proc/net/tcp` and `/proc/net/tcp6` looking for port in state `0A` (LISTEN) without shell tools.

---

### Recommended Actions
1. Gate `include_str!` template fallbacks to `#[cfg(test)]` so production staging strictly rejects bundles lacking explicit templates.
2. Expand `validate_web_unit_policy` to verify `CapabilityBoundingSet=` and `MemoryDenyWriteExecute=true`.
3. Replace `which` subprocess invocation with direct PATH check in Rust.

---

### Metrics
- Test Suites: 10 suites (`linux_release_*`)
- Tests Run: 66
- Tests Passed: 66 (100%)
- Execution Time: 0.16s
- Rust Compilation: Clean (`cargo check --all-targets --features vendored` exit 0, 0 warnings)

---

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml --test 'linux_release_*'`:
  - Result: 66 passed; 0 failed; finished in 0.16s.
- `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`:
  - Result: Finished `dev` profile target(s) in 0.27s (exit 0).

---

### Unresolved Questions
None.
