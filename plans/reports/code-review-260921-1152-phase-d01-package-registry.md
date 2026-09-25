# Code Review Summary: Phase D01 — Runner-owned package registry and trust staging

## Scope
- Files reviewed:
  - `server/src/plugins/limits.rs`
  - `server/src/plugins/package.rs`
  - `server/src/plugins/package_extract.rs`
  - `server/src/plugins/package_path.rs`
  - `server/src/plugins/package_validate.rs`
  - `server/src/plugins/registry.rs`
  - `server/src/plugins/registry_install.rs`
  - `server/src/plugins/registry_journal.rs`
  - `server/src/plugins/registry_layout.rs`
  - `server/src/plugins/registry_query.rs`
  - `server/src/plugins/registry_recovery.rs`
  - `server/src/plugins/registry_stage.rs`
  - `server/src/plugins/registry_state.rs`
  - `server/src/plugins/stage.rs`
  - `server/src/plugins/trust.rs`
  - `server/src/plugins/contract.rs`
  - `server/src/plugins/error.rs`
  - `server/src/plugins/mod.rs`
  - `server/src/config/parser.rs`
  - `server/tests/plugin_package_archive.rs`
  - `server/tests/plugin_package_registry.rs`
  - `server/tests/plugin_test_helpers.rs`
- Lines of code analyzed: 2,717 LOC
- Review focus: Phase D01 runner-owned package registry, safe streaming intake, archive inspection, crash recovery, trust staging, and authorization CAS.
- Updated plans: `plans/260920-1603-plugin-platform/phase-01-package-registry.md`

## Overall Assessment
Solid architectural foundation following Rust idioms, strict serialization schemas, and defense-in-depth isolation. All 24 integration tests pass in 0.01s. The codebase cleanly isolates the runner authority from the API. However, several high/critical security and authorization vulnerabilities were identified:
1. Potential panic/DoS (OOM) via unchecked `Vec::with_capacity(entry_size)` on untrusted archive headers.
2. Inverted authorization boolean condition in `stage_chunk` and `stage_finish` allowing cross-admin stage modification and bypassing post-revocation permission checks.
3. Unsanitized permissions allowing world-writable files from untrusted archives.
4. Concurrency and recovery sequencing edge cases in `approve_stage`.

Overall Score: **7.5/10** (Strong implementation, but security and memory-safety hardening required before exposure to untrusted inputs).

## Critical Issues
None (no immediate remote code execution, secret leakage, or active crash on current test paths).

## High Priority Findings
1. **Unchecked Memory Allocation from Untrusted Tar Header (DoS/OOM)**:
   - *Location:* `server/src/plugins/package.rs:128`
   - *Problem:* `let mut content = Vec::with_capacity(entry_size as usize);` allocates based on `entry.header().size().unwrap_or(0)` for every entry in the archive. An adversary declaring `entry_size = usize::MAX` or several gigabytes triggers an immediate process abort/panic (`rust_oom`). Furthermore, non-manifest files allocate memory that is never populated.
   - *Fix:* Only allocate for `manifest.json`. Validate `entry_size <= MAX_PACKAGE_UNCOMPRESSED_BYTES` for regular entries, and enforce a strict cap (`<= 2 MiB`) specifically for `manifest.json`.

2. **Authorization Logic Flaw in `stage_chunk` and `stage_finish`**:
   - *Location:* `server/src/plugins/registry_stage.rs:61-63, 73-75`
   - *Problem:* `if session.actor_subject != actor && !self.admin_subjects.is_admin(actor)` evaluates to false when `actor` is any admin (permitting Admin B to inject chunks into Admin A's upload), and evaluates to false when `session.actor_subject == actor` even if that actor was revoked from `admin_subjects`.
   - *Fix:* Require both checks: `if !self.admin_subjects.is_admin(actor) || session.actor_subject != actor { return Err(PluginError::unauthorized(...)); }`.

## Medium Priority Improvements
1. **Unsanitized File Permissions During Extraction**:
   - *Location:* `server/src/plugins/package_extract.rs:94`
   - *Problem:* `mode = entry.header().mode().unwrap_or(0o644) & 0o777` masks with `0o777`, allowing world-writable files (`0o666`/`0o777`) from untrusted packages into runner storage.
   - *Fix:* Mask out world-writable bits: `mode & !0o022` or reject entries with `mode & 0o002 != 0`.

2. **Extraction Prior to State Lock and Incomplete State Rollback**:
   - *Location:* `server/src/plugins/registry_install.rs:71-82`
   - *Problem:* `publish_extracted_package` renames extracted files into `packages/<plugin_id>/<version>/<sha256>` before acquiring `state_lock`. If concurrent `security_revision` changes occur, `approve_stage` returns `Forbidden`, leaving an unreferenced directory in `packages/` and an `Extracted` journal entry that recovery marks `Failed`.
   - *Fix:* Perform extraction and publishing under `state_lock` or clean up target directory on CAS mismatch.

3. **Crash Recovery Ignorant of `registry-v1.json`**:
   - *Location:* `server/src/plugins/registry_recovery.rs:52-62`
   - *Problem:* `run_crash_recovery` marks `Extracted` transactions as `Failed` without checking if `registry-v1.json` successfully registered the package before a post-registration crash.
   - *Fix:* Check `RegistryV1Record` in `registry-v1.json` before classifying `Extracted` transactions as `Failed`.

4. **Overwriting Transaction `created_at` on State Transitions**:
   - *Location:* `server/src/plugins/registry_stage.rs:96`, `server/src/plugins/registry_install.rs:61`
   - *Problem:* `TransactionRecord` resets `created_at` to `Utc::now()` on phase transitions, destroying original transaction creation history.
   - *Fix:* Retain original `created_at` from the initial `Receiving` phase.

5. **Unbounded Active Stages / Resource Exhaustion**:
   - *Location:* `server/src/plugins/registry_stage.rs:44`
   - *Problem:* No upper bound on concurrent staging sessions in `active_stages`, allowing file descriptor and disk exhaustion if multiple stages are initiated without completion.
   - *Fix:* Bound concurrent active stages (e.g., max 16) and evict expired sessions on `stage_begin`.

## Low Priority Suggestions
1. **Synthesized `inventory.json` vs Archive Entry**:
   - *Location:* `server/src/plugins/package_extract.rs:142`
   - *Suggestion:* `inventory.json` is synthesized by the runner. Packages containing an entry named `inventory.json` should be rejected or reserved to avoid silent overwrites.

2. **Installation Grants/Bindings Overwrite on Upgrade**:
   - *Location:* `server/src/plugins/registry_install.rs:114-115`
   - *Suggestion:* `initial_bindings` and `initial_grants` replace existing values for existing installations. Note for Phase D05 lifecycle implementation to migrate/preserve existing grants.

## Positive Observations
- Strict adherence to zero-copy streaming limits (512 KiB chunks, 32 MiB compressed cap, 64 MiB decompressed cap).
- Strong path traversal protection in `package_path.rs` rejecting absolute paths, URL encoding (`%2f`), backslashes, and case-fold collisions.
- Descriptor-relative file operations and atomic directory publishing using rename and `durable_fs::sync_dir`.
- Comprehensive test coverage for archive traversal, collisions, undeclared entries, inventory mismatch, CAS updates, and crash recovery.
- Zero compile warnings in all `plugins/` modules.

## Recommended Actions
1. Fix `package.rs:128` to bound buffer allocations and avoid preallocating memory for non-manifest entries.
2. Fix boolean logic in `registry_stage.rs:61` and `73` to `!is_admin || actor != session.actor_subject`.
3. Apply `mode & !0o022` in `package_extract.rs:94` to prevent world-writable file creation.
4. Update `TransactionRecord` phase updates to preserve `created_at`.
5. Enhance `run_crash_recovery` to cross-reference `registry-v1.json`.

## Metrics
- Type Coverage: 100% Rust strong static typing
- Test Coverage: 24/24 targeted unit and integration tests passing (100% pass rate)
- Clippy/Compiler Warnings in `plugins`: 0 warnings, 0 errors

## Unresolved Questions
1. Should `inventory.json` be forbidden in archive inputs, or should runner extraction preserve inventoried metadata if already present?
2. Should `stage_begin` impose a per-actor or global concurrency ceiling on pending uploads before D05 management lifecycle lands?
