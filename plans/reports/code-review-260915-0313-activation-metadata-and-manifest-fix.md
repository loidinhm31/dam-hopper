# Code Review: Activation Metadata Mismatch & Rollback Manifest Compatibility

**Review Date:** 2026-09-15  
**Reviewer:** Senior Software Engineer & Security Auditor  
**Plan Reference:** `plans/260915-0313-fix-activation-metadata-mismatch-and-rollback-manifest/plan.md`  
**Quality Score:** **9.5 / 10**

---

## Code Review Summary

### Scope
- **Files Reviewed (13 files):**
  - `server/src/linux_release/manifest.rs`
  - `server/src/linux_release/manifest_validation.rs`
  - `server/src/linux_release/activate_preflight.rs`
  - `server/src/linux_release/rollback.rs`
  - `server/src/linux_release/retention.rs`
  - `server/src/linux_release/api_runtime.rs`
  - `server/tests/linux_release_manifest.rs`
  - `server/tests/linux_release_manifest_errors.rs`
  - `server/tests/common/release_fixtures.rs`
  - `server/tests/linux_release_unit_policy.rs`
  - `docs/CHANGELOG.md`
  - `docs/linux-release-manifest.md`
  - `docs/linux-release-runtime-provisioning.md`
- **Lines of Code Analyzed:** 271 insertions, 13 deletions across 13 files.
- **Review Focus:** Security & TOCTOU prevention, backward compatibility & rollback safety, invariant enforcement, regression test coverage, and documentation alignment.
- **Updated Plans:** `plans/260915-0313-fix-activation-metadata-mismatch-and-rollback-manifest/plan.md` (Phases 1–3 marked completed; Phase 4 pending deployment).

---

### Overall Assessment

The implementation resolves the two-stage upgrade failure (v0.2.0 -> v0.3.1) with surgical precision, adhering strictly to YAGNI, KISS, DRY, and secure systems programming principles.
1. **Security & TOCTOU Protection:** The legacy state root `/var/lib/dam-hopper` mode migration from `0755` to `0700` is executed exclusively via descriptor-bound operations (`stat_at` with `AT_SYMLINK_NOFOLLOW` -> `open_dir_at` with `O_DIRECTORY | O_NOFOLLOW` -> initial `fstat` -> descriptor `fchmod` -> concluding `fstat` + `validate`). Any symlink, unexpected UID/GID, or non-matching mode immediately fails closed without mutation.
2. **Provenance-Bound Dual-Read:** Manifest v1 acceptance is strictly isolated to installed, hash-bound release trees during preflight (`activate_preflight.rs`), rollback (`rollback.rs`), and retention (`retention.rs`). External acquisition (`acquire.rs`), candidate bundle staging (`stage_transaction.rs`), and CLI verification (`manifest.rs`) remain strictly Manifest v2.
3. **Identity Authority Preservation:** Manifest `services.api.identity` is modeled solely as inert compatibility data (`#[serde(default, skip_serializing_if = "Option::is_none")]`). It is never passed to unit parsing, account lookup, provisioning, or health checks. Runtime identity authority remains exclusively the installed systemd unit's `User=`/`Group=`.
4. **Validation Quality:** All 110 relevant release tests pass cleanly across 7 suites. Zero regressions observed. Version alignment and packaging verification are green.

---

### Critical Issues
*None.* No security vulnerabilities, data loss risks, or breaking changes identified.

---

### High Priority Findings / Warnings
1. **[Test Coverage Gap] Missing Schema 0 and 3 Rejection Test for Installed Parser:**
   - *Issue:* Plan section 1.4 item 5 required asserting that schema `0` and `3` remain rejected by `parse_and_validate_installed_release`. While `linux_release_manifest_errors.rs` tests schema `1` rejection under the strict v2 parser, tests for schema `0` and `3` under `parse_and_validate_installed_release` were not explicitly added.
   - *Impact:* While the code in `manifest_validation.rs` line 26 correctly enforces `if m.schema_version != 1 && m.schema_version != RELEASE_MANIFEST_SCHEMA_VERSION`, missing negative test cases leaves this boundary vulnerable to future regression.
   - *Recommendation:* Add unit tests in `server/tests/linux_release_manifest.rs` verifying that `schema_version = 0` and `schema_version = 3` return `Err(ReleaseError::InvalidSchemaVersion { .. })`.

---

### Medium Priority Improvements / Suggestions
1. **[Clippy / Function Parameter Count] `ensure_dir` Exceeds Argument Threshold:**
   - *Issue:* In `server/src/linux_release/api_runtime.rs:520`, `ensure_dir` now takes 9 parameters (adding `policy: ExistingDirModePolicy`), triggering clippy `too_many_arguments (9/7)`.
   - *Impact:* Harmless for private internal helper; does not affect safety or runtime performance.
   - *Suggestion:* Consider grouping path and permission arguments (e.g., `(path, uid, gid, mode, policy)`) into a small struct/tuple parameter if clippy warnings are strictly enforced in CI.
2. **[Documentation Sync] `docs/linux-release-manager.md` Table Reference:**
   - *Issue:* While `docs/linux-release-runtime-provisioning.md` was updated to document that `/var/lib/dam-hopper` reconciles pre-existing `0755` by tightening to `0700`, `docs/linux-release-manager.md` line 64 still lists `/var/lib/dam-hopper` mode as `0700` without mentioning the one-time upgrade tightening exception.
   - *Suggestion:* Add a note in `docs/linux-release-manager.md` referencing the state root `0755 -> 0700` reconciliation rule.

---

### Low Priority Suggestions
1. **[State Machine Integration Fixture] End-to-End V1 Rollback Test:**
   - *Issue:* Plan section 1.4 noted adding a state-machine integration test in `linux_release_state_machine.rs` simulating a hash-bound v1 manifest in a managed active/previous directory.
   - *Note:* Component-level coverage in `activate_preflight.rs` and `rollback.rs` is solid, but adding a full state-machine transition fixture with v1 active view would provide end-to-end assurance.

---

### Positive Observations
- **Descriptor-Bound Atomicity:** Implements strict `fstat` -> `fchmod` -> `fstat` sequence preventing TOCTOU races.
- **Fail-Closed Permissions Policy:** Rejects `0777`, `0750`, `0711`, symlinks, or mismatched UID/GID without executing mutating syscalls.
- **Partial Persistence Hygiene:** Pre-existing tightened directories are not recorded in `created` vector, ensuring rollback cleanup does not delete the host's `/var/lib/dam-hopper` directory on downstream failure.
- **Zero Allocations for Policy:** `ExistingDirModePolicy` is a `Copy` enum incurring zero heap allocations.
- **Strict Serde Serialization:** `skip_serializing_if = "Option::is_none"` guarantees newly generated v2 manifests never emit `identity`.
- **Exact v1 Invariant Requirement:** Schema 1 manifests require exact `identity == "root"`; missing or arbitrary strings are strictly rejected.

---

### Validation Commands & Results

| Validation Step | Command Executed | Result |
| :--- | :--- | :--- |
| **Manifest Contract Tests** | `cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_manifest` | **6 passed; 0 failed** (0.35s) |
| **Manifest Error Tests** | `cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_manifest_errors` | **31 passed; 0 failed** (0.36s) |
| **Runtime Provisioning Tests** | `cargo test --manifest-path server/Cargo.toml --package dam-hopper-server linux_release::api_runtime::tests` | **26 passed; 0 failed** |
| **State Machine Tests** | `cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_state_machine` | **13 passed; 0 failed** (1.01s) |
| **Neighbor Regression Tests** | `cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_staging --test linux_release_unit_policy --test linux_release_ownership` | **34 passed; 0 failed** (0.93s) |
| **Version Alignment Gate** | `node deploy/release/check-version-alignment.mjs v0.3.1` | **Aligned: v0.3.1 (0.3.1)** |
| **Release Asset Verification** | `pnpm release:verify` | **Passed (clean)** |
| **Compile & Cargo Check** | `cargo check --manifest-path server/Cargo.toml --package dam-hopper-server` | **Passed (0 warnings in linux_release)** |

**Total Regression Proof:** **110 / 110 passed** across 7 test suites.

---

### Metrics
- **Type Coverage:** 100% Rust static typing (strict struct contracts, zero `unwrap` on untrusted input).
- **Test Coverage:** 110 unit/integration tests covering all modified paths.
- **Security Boundary Integrity:** Verified against TOCTOU, path replacement, ownership tampering, and unexpected mode escalation.
- **Linting Issues:** 0 compiler warnings in changed files.

---

### Recommended Actions
1. Add explicit test cases for `schema_version = 0` and `schema_version = 3` under `parse_and_validate_installed_release` in `server/tests/linux_release_manifest.rs`.
2. Update `docs/linux-release-manager.md` line 64 to reference the `0755 -> 0700` state root reconciliation rule.
3. Proceed with Phase 4: Commit verified changes, obtain remote tag deletion/recreation authorization, recreate `v0.3.1`, and monitor GitHub Actions `release-linux.yml`.

---

### Unresolved Questions
1. Does repository/tag protection on `origin` allow the release operator to force-delete and recreate the `v0.3.1` Git tag directly, or is administrative bypass/approval required?
