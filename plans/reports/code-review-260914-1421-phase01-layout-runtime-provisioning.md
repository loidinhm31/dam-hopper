# Code Review Summary: Phase 01 Layout and Runtime Provisioning

**Date:** 2026-09-14 14:21  
**Scope:** Phase 01 — Layout and descriptor-relative runtime provisioning  
**Plan:** `plans/260914-0854-system-daemon-state-config/plan.md`  
**Score:** 9.5 / 10  
**Status:** PASS (Ready to advance to Phase 02)

---

### Scope
- Files reviewed:
  - `server/src/linux_release/layout.rs` (modified)
  - `server/src/linux_release/api_runtime.rs` (modified)
  - `server/src/linux_release/error.rs` (modified)
  - `server/tests/idle_suspend_diagnostics_linux_smoke.rs` (modified)
  - `server/src/state.rs` (review only)
  - `server/src/idle_suspend/server_audit.rs` (review only)
  - `server/src/utils/fs.rs` (review only)
  - `server/src/config/parser.rs` (review only)
  - `plans/260914-0854-system-daemon-state-config/plan.md` (updated)
  - `plans/260914-0854-system-daemon-state-config/phase-01-layout-and-descriptor-relative-runtime-provisioning.md` (updated)
- Lines of code analyzed: ~1,200 lines modified / added across 4 files
- Review focus: Security, refusal/cleanup boundaries, performance, descriptor operations, migration correctness, YAGNI/KISS/DRY

---

### Overall Assessment
Excellent design and implementation adhering strictly to Phase 01 requirements and Unix security best practices:
- **Descriptor-relative traversal**: Root opened with `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`; child walks use `openat`/`fstatat` with `AT_SYMLINK_NOFOLLOW`.
- **Refusal-first model**: Pre-existing filesystem objects are never modified, chowned, or replaced. Any metadata or content mismatch halts execution with a typed error without starter invocation.
- **Copy-once legacy migration**: Requires root-owned `0644` file $\le 64\text{ KiB}$, valid UTF-8/TOML, and rejects relative or traversing project roots to prevent silent path corruption when moving from `/etc` to `/var/lib`.
- **Staged exclusive publication**: Creates `.dam-hopper.toml.provisioning` with `O_CREAT | O_EXCL` mode `0600`, complete write loop, file sync, metadata validation, Linux `renameat2(RENAME_NOREPLACE)`, and parent directory sync.
- **Strict identity cleanup boundary**: Only call-created objects recorded with `(dev, ino)` identity; unlinking verifies identity and emptiness. Canonical published file is never unlinked after rename.
- **Relocated audit**: Moved to `/var/lib/dam-hopper/idle-suspend-audit.jsonl`, in full alignment with `state.rs`, `collector.rs`, and `Layout`.

---

### Critical Issues (MUST FIX)
None.

---

### Warnings (SHOULD FIX)
1. **`write_all` loop safety on zero bytes written**:
   - Location: `server/src/linux_release/api_runtime.rs:333-353`
   - Description: If `libc::write` returns 0 for a non-empty slice, `written = 0` advances `bytes` by 0, resulting in an infinite busy-loop. While Linux regular files rarely return 0 without error, standard POSIX defensive practice is to check `if rc == 0` and return `io::Error::new(io::ErrorKind::WriteZero, "failed to write whole buffer")`.

---

### Suggestions (NICE TO HAVE)
1. **Post-open descriptor validation (`fstat`) in `canonical_stat` and `inspect_legacy`**:
   - Location: `server/src/linux_release/api_runtime.rs:701-706, 878-884`
   - Description: While `open_readable_file_at` sets `O_NOFOLLOW` and reads are bounded to 64 KiB, checking `fstat` on `file_guard.0` before reading provides defense-in-depth against post-stat inode replacement (matching `ensure_file` pattern).
2. **Nonblocking flag for readable config open**:
   - Location: `server/src/linux_release/api_runtime.rs:293`
   - Description: Adding `libc::O_NONBLOCK` to `open_readable_file_at` prevents blocking if a FIFO or pipe is placed at the target path.
3. **Lossless CString conversion in `open_root`**:
   - Location: `server/src/linux_release/api_runtime.rs:199`
   - Description: Using `std::os::unix::ffi::OsStrExt::as_bytes(root.as_os_str())` avoids lossy UTF-8 conversion if a synthetic test root path contains non-UTF-8 bytes.

---

### Positive Observations
- **Zero content leakage in error variants**: `ReleaseError::ApiRuntimeConfigInvalid` uses `&'static str` path and reason, discarding `toml::de::Error` details that could leak sensitive configuration lines.
- **Short-write and EINTR handling**: Both `read_bounded` and `write_all` handle partial transfers and `EINTR` retries cleanly with zero unnecessary buffer allocations.
- **Exhaustive race & refusal test matrix**: 24 tests in `api_runtime::tests` systematically exercise type mismatches, UID/GID/mode mismatches, symlink rejection, race winner preservation on rename, sync failures, and cleanup identity verification.

---

### Validation Commands and Results
- `cargo test -p dam-hopper-server linux_release::api_runtime::tests`: **PASS** (24 passed, 0 failed, 0.00s)
- `cargo test -p dam-hopper-server linux_release::layout::tests`: **PASS** (2 passed, 0 failed, 0.00s)
- `cargo test -p dam-hopper-server --test idle_suspend_diagnostics_linux_smoke -- --ignored`: **PASS** (1 passed, 0 failed, 0.34s)
- `cargo test -p dam-hopper-server`: **PASS** (1,383 passed, 0 failed, 5 ignored, 40.49s)

---

### Unresolved Questions
None.
