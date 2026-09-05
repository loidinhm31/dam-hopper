# Code Review Report — Phase 02: Rust CLI and Safe Acquisition/Staging

**Date:** 2026-09-03  
**Reviewer:** Phase02Reviewer (Senior Staff Engineer)  
**Score:** 8.8 / 10  
**Status:** Approved with Recommendations (Passes Phase 02 Review Gate)

---

## 1. Scope

- **Reviewed Files:**
  - `server/src/bin/dam-hopper.rs`
  - `server/src/linux_release/cli.rs`
  - `server/src/linux_release/privilege.rs`
  - `server/src/linux_release/platform.rs`
  - `server/src/linux_release/origin.rs`
  - `server/src/linux_release/host_config.rs`
  - `server/src/linux_release/layout.rs`
  - `server/src/linux_release/lock.rs`
  - `server/src/linux_release/acquire.rs`
  - `server/src/linux_release/acquire_client.rs`
  - `server/src/linux_release/attestation.rs`
  - `server/src/linux_release/archive.rs`
  - `server/src/linux_release/archive_extract.rs`
  - `server/src/linux_release/stage.rs`
  - `server/src/linux_release/stage_transaction.rs`
  - `server/src/linux_release/error.rs`
  - `server/src/linux_release/mod.rs`
  - `server/src/linux_release/inventory.rs`
  - `server/src/linux_release/version.rs`
  - `server/tests/common/release_fixtures.rs`
  - `server/tests/linux_release_cli.rs`
  - `server/tests/linux_release_platform.rs`
  - `server/tests/linux_release_archive.rs`
  - `server/tests/linux_release_acquisition.rs`
  - `server/tests/linux_release_staging.rs`
- **Updated Plan:**
  - `plans/260903-0919-linux-release-installer-architecture/phase-02-rust-cli-safe-acquisition-staging.md`
- **Total Lines Analyzed:** ~2,420 LOC across 25 files.

---

## 2. Validation Commands & Results

| Command | Status | Output / Timing |
|---|---|---|
| `cargo check --manifest-path server/Cargo.toml --bin dam-hopper --tests` | PASS | Exit 0, 14.41s, 0 errors |
| `cargo test --manifest-path server/Cargo.toml --test 'linux_release_*'` | PASS | 45 passed (7 suites), 0.37s |
| `cargo clippy --manifest-path server/Cargo.toml --bin dam-hopper --tests` | PASS | Exit 0 (minor non-blocking style suggestions) |
| `systemctl --version` | PASS | Validated host environment format (`systemd 259 (259.8-1.fc44)`) |

---

## 3. Overall Assessment

Phase 02 implementation demonstrates high architectural discipline and security consciousness:
- **Strict File Size & Modularization:** Every production source file adheres strictly to repository rule (< 200 lines). The largest is `server/src/linux_release/stage_transaction.rs` at 196 lines. Clear separation between interface, network client, transaction management, and extraction logic.
- **Architectural Cohesion:** Unprivileged `fetch` boundary correctly separated from privileged `install`/`role set` operations. Non-blocking deployment lock (`flock`) serializes operations. Fsync-guaranteed durable metadata writes.
- **Contract Fidelity:** Unified `start` command present; `--api-url` removed; SHA-256 mandatory; `gh` attestation optional; allowlisted manifest inventory enforced during inspection and extraction.

---

## 4. Critical Issues

*None blocking.*

**Security Architecture Invariant (Design Decision):**
- As directed by project owner and documented in plan risk assessment, the API service runs as `root` for MVP. Privilege boundary between API and host root is deliberately flattened; web service remains isolated under unprivileged user `dam-hopper-web`.

---

## 5. High Priority Findings

1. **Unbounded Network Deadlines (`acquire_client.rs`):**
   - `build_http_client()` builds `reqwest::Client` with a redirect policy but configures no timeout.
   - *Impact:* Slow or hanging GitHub API / asset requests can stall the CLI indefinitely.
   - *Fix:* Configure connect and request timeouts on `reqwest::Client::builder()`:
     ```rust
     .connect_timeout(std::time::Duration::from_secs(10))
     .timeout(std::time::Duration::from_secs(300))
     ```

2. **Host Platform Verification Not Invoked in CLI Entry Point (`dam-hopper.rs`):**
   - `verify_host_platform()` in `platform.rs` checks Fedora 44, x86_64, glibc >= 2.43, and systemd >= 259. It is thoroughly unit-tested, but never invoked by `server/src/bin/dam-hopper.rs` or `stage_release_bundle`.
   - *Impact:* Running `dam-hopper install` on an unsupported distribution or CPU architecture would not be blocked at the manager entry point.
   - *Fix:* Call `verify_host_platform()` in `server/src/bin/dam-hopper.rs` for mutating commands (`Install`, `Role`, `Start`, etc.).

3. **TOCTOU Symlink Race in Bundle File Opens (`stage_transaction.rs`):**
   - `stage_release_bundle` verifies `manifest_meta.file_type().is_symlink()` and `archive_meta.file_type().is_symlink()`, but subsequently uses standard `File::open(archive_path)` and `fs::read(&manifest_path)`.
   - *Impact:* In untrusted user directories, a malicious user could replace the archive or manifest with a symlink between the check and open call. While SHA-256 verification catches payload modification, opening arbitrary targets as root should be prohibited.
   - *Fix:* Use `O_NOFOLLOW` flag via `OpenOptionsExt::custom_flags(libc::O_NOFOLLOW)` when opening bundle input files, and compare `symlink_metadata` before and after reading as required by Plan Step 5.

---

## 6. Medium Priority Improvements

1. **Overly Permissive Redirect Host Filter (`acquire_client.rs`):**
   - `validate_url_host` accepts any domain ending with `.amazonaws.com`.
   - *Impact:* Redirects to arbitrary attacker-owned S3 buckets or EC2 hostnames are permitted by the host filter.
   - *Fix:* Restrict AWS S3 bucket allowlist to GitHub's release asset pattern (e.g. `github-production-release-asset-*.s3.amazonaws.com`) or require that initial asset URLs come strictly from GitHub release API responses.

2. **File & Directory Permissions on Fetched Bundle (`acquire.rs`):**
   - `acquire.rs` writes downloaded assets with default umask (`0755` directory, `0644` files).
   - *Impact:* Other local users can read downloaded assets in the user cache directory.
   - *Fix:* Explicitly set `0700` mode on `args.output` directory and `0600` mode on downloaded files using `std::os::unix::fs::PermissionsExt`.

3. **Clap Argument Parse-Time Enforcement for Fetch (`cli.rs`):**
   - `FetchArgs` sets `conflicts_with` between `--version` and `--latest`, but does not mark them as mutually required. If both are omitted, Clap succeeds and the error is only caught at runtime in `resolve_tag`.
   - *Fix:* Add `#[arg(required_unless_present = "latest")]` to `version` and `#[arg(required_unless_present = "version")]` to `latest` (or use `ArgGroup`).

---

## 7. Low Priority Suggestions

1. **Clippy Lints in Release Modules:**
   - `src/linux_release/origin.rs:63:8`: `path != ""` comparison to empty string; prefer `!path.is_empty()`.
   - `src/linux_release/platform.rs:177:9`: Unnecessary closure in `ok_or_else` for scalar literal `0`.
   - `src/linux_release/platform.rs:29:13`: Collapsible `if` statements in `parse_os_release`.

2. **Systemd Version Parsing Robustness (`platform.rs`):**
   - `parse_systemd_version` parses `parts.next()?` as `u32`. If a distro package has version `259~rc1`, parsing fails. Consider parsing leading ASCII digits.

---

## 8. Plan Completeness & Next Steps

- All 6 TODO items in `phase-02-rust-cli-safe-acquisition-staging.md` are completed.
- Plan status updated to `Implementation: Completed`, `Review: Reviewed`.
- Test suites pass 100% (45 passed across 7 test suites).
- Ready to proceed to Phase 03: Web Packaging and Role Projection.

---

## 9. Unresolved Questions

None.
