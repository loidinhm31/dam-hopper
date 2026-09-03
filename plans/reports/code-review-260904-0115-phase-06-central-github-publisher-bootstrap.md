# Code Review: Phase 06 — Central GitHub Publisher and Bootstrap (Cycle 2)

**Date:** 2026-09-04  
**Branch:** autoresearch/session-20260903  
**Scope:** Phase 06 — Central GitHub Publisher and Bootstrap (Review Cycle 2)  
**Status:** APPROVED (Score: 9.5 / 10)  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `deploy/release/build-release-archive.sh`
  - `deploy/release/generate-release-manifest.mjs`
  - `.github/workflows/release-linux.yml`
  - `deploy/release/dam-hopper-install.sh`
  - `deploy/release/check-version-alignment.mjs`
  - `deploy/release/check-release-assets.mjs`
  - `.github/workflows/release.yml`
  - `.github/workflows/ci.yml`
  - `server/tests/linux_release_publisher_contract.rs`
  - `plans/260903-0919-linux-release-installer-architecture/phase-06-central-github-publisher-bootstrap.md`
- **Lines of code analyzed:** ~1,650 lines
- **Review focus:** Verification of resolution of Cycle 1 critical issues/warnings, reproducible tar packaging, schema-compliant manifest/SBOM generation, workflow triggers/action SHA pinning, dual attestation checks, and end-to-end regression validation.
- **Updated plans:**
  - `plans/260903-0919-linux-release-installer-architecture/phase-06-central-github-publisher-bootstrap.md`

### Overall Assessment
All 4 critical defects and key warnings from Cycle 1 successfully resolved:
1. `build-release-archive.sh`: Switched tar format to `--format=posix` (resolving GNU tar pax-option collision), added `--no-recursion`, and filtered `FILE_LIST` with `\( -type f -o -path "./web*" -type d \)` to exclude bare intermediate directories (`bin`, `systemd`, `sysusers.d`).
2. `generate-release-manifest.mjs`: Added skip for intermediate directories (`bin`, `systemd`, `sysusers.d`), forced `LC_ALL=C` on tar inspection, deduplicated entries via `seenPaths`, made SBOM creation timestamp deterministic using `SOURCE_DATE_EPOCH`, and parameterized repository download URL.
3. `.github/workflows/release-linux.yml`: Updated tag trigger to valid fnmatch glob `v*`, pinned actions to immutable commit SHAs (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, `pnpm/action-setup`, `actions/attest-build-provenance`).
4. `dam-hopper-install.sh`: Verified dual attestation covering both `release-manifest.json` and archive, and parameterized repository path (`GITHUB_REPOSITORY` fallback).
5. All 24/24 Rust tests passed (including end-to-end publisher regression test exercising real archive creation, manifest generation, and Rust manager validation). Release alignment, shell syntax, and Node syntax checks all pass cleanly.

---

## Score: 9.5 / 10

---

## Critical Issues
None. All 4 blocking issues from Cycle 1 resolved and verified.

---

## High Priority Findings
None.

---

## Medium Priority Improvements
1. **Toolchain Actions Pinning in CI/Release Workflows:**
   In `.github/workflows/release-linux.yml:66-70`, `dtolnay/rust-toolchain@stable` and `Swatinem/rust-cache@v2` use mutable tags rather than commit SHAs. Pin to commit SHAs for maximum supply chain immutability.
2. **Dynamic Glibc Floor Audit:**
   Workflow currently builds on `ubuntu-latest` without Fedora 44 container isolation. Phase 08 addresses live systemd and target host validation.

---

## Low Priority Suggestions
1. **Remove Unused Variables / Minor Optimization:**
   All shell and Node scripts pass static syntax validation.
2. **Attestation Fallback Guidance:**
   In `dam-hopper-install.sh`, if `--verify-attestation` specified without `gh` CLI installed, clear guidance already directs user to install `gh`.

---

## Positive Observations
- **End-to-End Regression Test:** `test_publisher_end_to_end_scripts_and_manager_validation` in `server/tests/linux_release_publisher_contract.rs` executes the actual bash archive packager and Node manifest generator, verifying the output directly via Rust `validate_manifest_and_archive`.
- **Determinism Safeguards:** `SOURCE_DATE_EPOCH`, fixed tar flags (`--sort=name`, `--format=posix`, `--mtime`, `--pax-option`, `--numeric-owner`), and double-archive comparison in CI prevent drift.
- **Strict Role Projections:** Manifest role assignment ensures single source of truth for runtime ownership without arbitrary directory inclusion.

---

## Recommended Actions
1. Mark Phase 06 complete in parent tracking plan.
2. Proceed to Phase 07: Format 2 Migration and Runner Retirement.

---

## Metrics
- **Test Suite Results:** 24 / 24 passed (100%)
  - `linux_release_publisher_contract`: 7 passed, 0 failed
  - `linux_release_manifest`: 2 passed, 0 failed
  - `linux_release_archive`: 3 passed, 0 failed
  - `linux_release_staging`: 5 passed, 0 failed
  - `linux_release_cli`: 7 passed, 0 failed
- **Validation Commands:** 5 / 5 passed (exit 0)
- **Compiler Warnings:** 0 warnings (`cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`)
- **Lint / Syntax Errors:** 0 errors (`pnpm release:verify`, `bash -n`, `node -c`)

---

## Validation Commands and Results
- `cd server && cargo test --test linux_release_publisher_contract`: **PASS** (7/7 tests passed in 0.16s)
- `cd server && cargo test --test linux_release_manifest --test linux_release_archive --test linux_release_staging --test linux_release_cli`: **PASS** (17/17 tests passed in 0.18s)
- `pnpm release:verify`: **PASS** (exit code 0)
- `node deploy/release/check-version-alignment.mjs`: **PASS** (v0.1.0 aligned)
- `bash -n deploy/release/build-release-archive.sh deploy/release/dam-hopper-install.sh`: **PASS** (syntax valid)
- `node -c deploy/release/generate-release-manifest.mjs deploy/release/check-release-assets.mjs`: **PASS** (syntax valid)
- `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`: **PASS** (finished dev profile, 0 warnings)

---

## Unresolved Questions
None.
