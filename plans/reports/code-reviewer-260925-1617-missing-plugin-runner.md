# Code Review: Linux Release Missing Plugin Runner Fix

**Review Score: 10/10**

## Code Review Summary

### Scope
- Files reviewed:
  1. `server/src/bin/dam-hopper-plugin-runner.rs`
  2. `deploy/release/build-release-archive.sh`
  3. `deploy/release/check-release-assets.mjs`
  4. `tests/deploy/linux-release-package-twice.sh`
  5. `.github/workflows/release-linux.yml`
  6. `.github/workflows/ci.yml`
- Lines of code analyzed: ~2,927 lines total (~53 modified lines across 6 files)
- Review focus: Packaging invariants, fail-closed preflight gates, asset inventory validation, version alignment, CI/CD artifact handling, Windows release isolation
- Updated plans: `plans/260925-1617-fix-missing-plugin-runner-release/plan.md`

### Overall Assessment
High quality, surgical bugfix. Restores fail-closed packaging contract for Linux releases where `dam-hopper-plugin-runner` was previously optional and omitted from release archives. Adheres strictly to YAGNI/KISS/DRY principles by reusing existing inventory validation roles, manifest schemas, and CI/CD steps. Zero breaking changes, zero regressions to Windows release path, zero unneeded abstractions.

### Critical Issues
None.

### Warnings
None.

### Suggestions
1. **Advisory / Release Tag**: Published v0.5.0 Linux archive remains incomplete in registry; tag v0.5.1 and publish release notes warning operators of v0.5.0 omission.
2. **Future Consideration**: Running lightweight packaging smoke on pull requests (currently only executed on release tagging) to prevent future regression if packaging dependencies change.

### Positive Observations
- **Fail-closed guarantees**: `build-release-archive.sh` validates `dam-hopper-plugin-runner`, `dam-hopper-plugin-runner.service.in`, and `dam-hopper-plugin-runner.conf.in` upfront; aborts before staging or creating archives if any asset is missing.
- **Strict asset gate integration**: Adding paths to `REQUIRED_INVENTORY_PATHS` in `check-release-assets.mjs` activates existing role (`server`) and mode (`0755` executable / `0644` config) checks without schema drift.
- **Consistent CLI ergonomics**: Clap derive `version` attribute in `dam-hopper-plugin-runner.rs` matches sibling binaries (`dam-hopper-server`, `dam-hopper-web`, `dam-hopper-idle-suspend-helper`), outputting version without running side effects.
- **Full CI/CD synchronization**: Both `.github/workflows/release-linux.yml` and `.github/workflows/ci.yml` verify binary version output, enforce `if-no-files-found: error`, and set execution permissions before packaging.
- **Zero Windows regression**: Linux asset requirement changes scoped entirely to Linux manifest profile; Windows 4-member zip validation untouched.

### Recommended Actions
1. Merge the changes to `main`.
2. Cut release tag `v0.5.1` with full Linux release pipeline.

### Metrics
- Type Safety: 100% (Rust strong typing + Clap derive; Node ESM syntax verified)
- Test Suite: 100% (19/19 passed, including 9/9 deploy suite scripts and 5/5 negative fail-closed boundary tests)
- Linting / Syntax Issues: 0 (`bash -n` and `node -c` clean)

---

## Validation Commands & Results

1. **Syntax Validation**
   - Command: `bash -n deploy/release/build-release-archive.sh tests/deploy/linux-release-package-twice.sh && node -c deploy/release/check-release-assets.mjs deploy/release/check-version-alignment.mjs`
   - Result: Exit 0, no syntax errors.

2. **Binary Version Verification**
   - Command: `cargo run --manifest-path server/Cargo.toml --release --bin dam-hopper-plugin-runner -- --version`
   - Output: `dam-hopper-plugin-runner 0.5.0`
   - Result: Exit 0, reports version matching Cargo.toml without executing runner services.

3. **Release Version Alignment**
   - Command: `pnpm release:check-version && pnpm release:verify`
   - Output: `✓ Release version alignment verified: v0.5.0 (0.5.0)`
   - Result: Exit 0.

4. **Negative Preflight Checks (Missing Runner Binary)**
   - Package-twice preflight: Missing runner yields `Error: required executable is missing or not executable: .../dam-hopper-plugin-runner` (Exit 1).
   - Build-release-archive preflight: Missing runner yields `Error: 'dam-hopper-plugin-runner' binary not found in '...'` (Exit 1).
   - Result: Both abort before staging or creating archives.

5. **Negative Asset Gate Checks (check-release-assets.mjs)**
   - Missing `bin/dam-hopper-plugin-runner`: Rejection `Error: Migration gate: release manifest.inventory is missing required paths: bin/dam-hopper-plugin-runner`.
   - Missing `systemd/dam-hopper-plugin-runner.service`: Rejection `Error: Migration gate: release manifest.inventory is missing required paths: systemd/dam-hopper-plugin-runner.service`.
   - Missing `tmpfiles.d/dam-hopper-plugin-runner.conf`: Rejection `Error: Migration gate: release manifest.inventory is missing required paths: tmpfiles.d/dam-hopper-plugin-runner.conf`.
   - Non-executable binary (mode 0644): Rejection `Error: Migration gate: release manifest.inventory[3] has an invalid role or mode`.
   - Invalid role (`web` instead of `server`): Rejection `Error: Migration gate: release manifest.inventory[3] has an invalid role or mode`.
   - Result: All negative boundary conditions fail closed.

6. **Target Unit Compilation**
   - Command: `cargo test --manifest-path server/Cargo.toml --features vendored --bin dam-hopper-plugin-runner`
   - Result: Exit 0, compiled and tested without errors.

7. **Full Deployment Suite**
   - Command: `pnpm test:deploy`
   - Output: 9/9 scripts passed in ~10.4s:
     - `linux-release-clean-install.sh`
     - `linux-release-upgrade-rollback.sh`
     - `linux-release-crash-recovery.sh`
     - `linux-release-security.sh`
     - `linux-release-reset-smoke.sh`
     - `linux-release-web-contract.sh`
     - `fedora44-format2-migration.sh`
     - `linux-release-plugin-runner-owner-smoke.sh`
     - `linux-release-plugin-upgrade-rollback.sh`

---

## Unresolved Questions

None.
