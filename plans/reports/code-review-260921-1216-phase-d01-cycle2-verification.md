# Code Review Summary: Phase D01 — Runner-Owned Package Registry (Cycle 2 Verification)

### Scope
- Files reviewed:
  - `server/src/plugins/package.rs`
  - `server/src/plugins/registry_stage.rs`
  - `server/src/plugins/registry_install.rs`
  - Supporting context: `server/src/plugins/limits.rs`, `server/src/plugins/package_extract.rs`, `server/src/plugins/stage.rs`, `server/src/plugins/registry_recovery.rs`, `server/src/plugins/trust.rs`, `server/tests/plugin_package_registry.rs`, `server/tests/plugin_package_archive.rs`
- Lines of code analyzed: ~650 LOC across targeted files (~1,900 LOC supporting)
- Review focus: Cycle 2 verification of fixes for memory exhaustion in `package.rs`, boolean authorization in `registry_stage.rs`, and state locking in `registry_install.rs`.
- Updated plans: `plans/260920-1603-plugin-platform/plan.md`

### Overall Assessment
- Overall Score: **9.0/10** (Strong hardening, all Cycle 1 blockers resolved).
- Verification confirmed all three core Cycle 1 remediation targets:
  1. Memory exhaustion panic in `package.rs` mitigated: buffer preallocation capped at `min(entry_size, 64 KiB)`.
  2. Authorization check in `registry_stage.rs` corrected to `session.actor_subject != actor || !self.admin_subjects.is_admin(actor)`, preventing cross-admin upload injection and enforcing admin status.
  3. Locking sequence in `registry_install.rs` corrected: lock acquired prior to security revision re-validation and package directory publishing; uncommitted extraction cleanly deleted on revision mismatch.
- Architecture cleanly aligns with YAGNI/KISS/DRY principles without unnecessary asynchronous locking or abstraction overhead.
- All 24 integration tests pass in 0.00s.

### Critical Issues
None.

### Warnings
1. **Redundant buffer allocation for non-manifest archive entries**:
   - *Location:* `server/src/plugins/package.rs:116`
   - *Detail:* `let mut content = Vec::with_capacity(std::cmp::min(entry_size as usize, 64 * 1024));` allocates up to 64 KiB for every regular entry in the archive (up to 2,048 entries), even though `content` is only populated when `normalized == "manifest.json"`. For all other files, this capacity is allocated and dropped immediately without use.
   - *Fix:* Conditionally allocate `content` only when `normalized == "manifest.json"`.

2. **Permissive file permissions during extraction**:
   - *Location:* `server/src/plugins/package_extract.rs:89`
   - *Detail:* `let mode = entry.header().mode().unwrap_or(0o644) & 0o777;` retains world-writable bits from untrusted archives.
   - *Fix:* Mask out world-writable bits (`mode & !0o022`).

### Suggestions
1. **Enforce dedicated `manifest.json` size limit**:
   - *Location:* `server/src/plugins/package.rs:129`
   - *Detail:* Check `entry_size <= 2 * 1024 * 1024` for `manifest.json` before reading into memory to prevent high memory spikes during serde JSON deserialization.
2. **Preserve `created_at` timestamp across transaction phases**:
   - *Location:* `server/src/plugins/registry_install.rs:51`, `server/src/plugins/registry_stage.rs:108`
   - *Detail:* `TransactionRecord` resets `created_at` to `Utc::now()` instead of preserving original timestamp from `stage_begin`.
3. **Cap concurrent active staging uploads**:
   - *Location:* `server/src/plugins/registry_stage.rs:46`
   - *Detail:* Bound `self.active_stages` map size (e.g. max 16) to prevent resource exhaustion from abandoned upload sessions.
4. **Integration test for cross-admin stage rejection**:
   - *Location:* `server/tests/plugin_package_registry.rs`
   - *Detail:* Add targeted test asserting Admin B cannot write chunks to or finish Admin A's stage session.

### Positive Observations
- Strict locking discipline in `approve_stage`: expensive decompression/extraction performed in private staging without holding `state_lock`, while directory publishing and `registry-v1.json` serialization execute under atomic lock with CAS rollback.
- De Morgan's law applied cleanly to authorization conditions (`session.actor_subject != actor || !self.admin_subjects.is_admin(actor)`).
- Idempotent directory publishing handled cleanly in `publish_extracted_package`.
- High execution performance: 24 tests execute in 0.00s test run time.
- Clean compilation: 0 errors in `src/plugins/`.

### Recommended Actions
1. Apply conditional allocation for `content` in `package.rs`.
2. Mask extraction permissions with `& !0o022` in `package_extract.rs`.
3. Add cross-admin upload isolation test in `plugin_package_registry.rs`.

### Metrics
- Type Coverage: 100% Rust static typing
- Test Results: 24/24 passed (100% pass rate)
- Compiler/Clippy Errors in `src/plugins/`: 0 errors
- Targeted Test Duration: 0.70s wall time (0.00s test execution)

### Validation Commands and Results
- `cargo test --test plugin_package_archive && cargo test --test plugin_package_registry && cargo test --test plugin_contract_fixtures` (in `server/`):
  - `plugin_package_archive`: 5 passed, 0 failed
  - `plugin_package_registry`: 5 passed, 0 failed
  - `plugin_contract_fixtures`: 14 passed, 0 failed
  - Total: 24 passed, 0 failed (0.70s)
- `cargo clippy --tests --message-format=short`: 0 errors in `src/plugins/`

### Unresolved Questions
- None.
