# Phase 02 Code Review — Cycle 3

**Score: 5/10 — changes required; Phase 02 not ready for acceptance.**

Review focus: security, correctness, resource bounds, lazy execution, architecture, YAGNI/KISS/DRY.
Inspected code only; zero product or test mutations made. Runtime interleavings and race consequences below are **[INFERENCE]**, grounded in inspected source.

---

### Scope
- **Files reviewed:**
  - Production: `server/src/session_changes/{store.rs, capture.rs, comparison.rs, control.rs, types.rs, inventory.rs, binding.rs, root.rs, text_diff.rs, mod.rs}`, `server/src/api/session_changes.rs`, `server/src/api/router.rs`, `docs/code-standards.md`.
  - Tests: `server/src/session_changes/{capture_tests.rs, comparison_tests.rs, types_tests.rs, root_tests.rs}`, `server/tests/{session_changes_protocol.rs, session_changes_controls.rs, session_changes_api.rs, session_changes_adversarial.rs, session_changes_lifecycle.rs}`, `server/tests/fixtures/session-changes-wire.json`.
- **Lines of code analyzed:** ~5,200 lines across production, test suites, and configuration fixtures.
- **Review focus:** Cycle 3 fixes for root handle pinning, descriptor-relative traversal, attempt downgrade / timeout fences, memory bounds, and dead barrier DTO removal.

---

### Overall Assessment

Cycle 3 makes substantial architectural progress:
1. Dead barrier types (`PrepareRequest`, `ActivationRequest`, etc.) and `CapturedFile` have been completely eliminated from production types and router wiring.
2. `TrackedPathEntry.bytes` uses `Arc<[u8]>` to eliminate vector cloning during comparison iteration, and `ComparisonRowMeta` stores metadata rather than duplicate byte buffers.
3. Open flags include `O_NONBLOCK` on leaf files, resolving hangs on unattached FIFOs (`test_fifo_rejection_does_not_hang` passes).
4. `docs/code-standards.md` is updated with the approved 64 MiB / 500-path / `toolObserved` contract.
5. All 44 targeted tests in unit, integration, and agent-status integration suites pass cleanly.

However, several critical and high-priority correctness, race condition, and platform issues remain unaddressed. Phase 02 cannot be signed off.

---

### Critical Issues

1. **Server publication conflated with producer acknowledgment; timeout downgrade is bypassed.**
   - *Location:* `server/src/session_changes/capture.rs:733, 494-506`, `server/src/session_changes/capture_tests.rs:458`.
   - *Impact:* In `capture_session_paths`, the worker sets `entry.acknowledged = true` as soon as bytes are probed and stored on the server—*before* the HTTP response reaches the producer. If the network drops or the producer times out at 1.5s and calls `Unproven` with that `capture_id`, line 495 (`if !entry.acknowledged`) evaluates to `false`. The timed-out attempt is never downgraded, leaving potentially post-edit bytes sealed as the original. The unit test `test_unproven_downgrades_unacknowledged_attempt_only` only passed because it artificially mutated `entry.acknowledged = false` via an explicit test backdoor.
   - *Fix:* Do not set `acknowledged = true` purely on server-side write. Either track producer-confirmed receipt / acknowledgment via turn settlement, or allow `Unproven` for the same `capture_id` to downgrade unconfirmed attempts while preserving baselines confirmed by prior distinct `capture_id` attempts.

2. **Concurrent capture still adopts post-edit bytes due to fail-open harness semantics.**
   - *Location:* `server/src/session_changes/capture.rs:597-606, 682-711`.
   - *Impact:* When a second preEdit capture arrives for a path currently in-flight, it receives `status: Unknown, reason: "pendingConcurrentCapture"`. Because the harness fails open to preserve agent responsiveness, the tool executes immediately. The first probe worker (which may have been delayed 100–200ms in the tokio threadpool) then reads the file *after* the tool edited it, verifies that `< 1500ms` elapsed, and publishes post-edit bytes as `Captured` original. Checking `reserved_at.elapsed() > 1500ms` does not protect against an edit occurring at 100ms.
   - *Fix:* If a conflicting capture request arrives while a reservation is pending, or if an attempt cannot prove pre-edit state before tool execution, the pending reservation must be cancelled/invalidated to `Unknown / Unproven` so the in-flight probe cannot adopt mutated bytes.

3. **Path validation trims whitespace and keys storage by raw strings, creating aliasing vulnerabilities.**
   - *Location:* `server/src/session_changes/capture.rs:38-72, 480-493, 570-583`.
   - *Impact:* `normalize_and_validate_path` calls `rel_path.trim()`, silently stripping leading and trailing whitespace from legitimate filenames (e.g. `" file.txt "`). Furthermore, while components are normalized by `Path::components()`, the record dictionary `rec.tracked_paths` inserts and looks up by `raw_path`. Aliases such as `dir//file.txt` and `dir/file.txt` register as two distinct keys in `BTreeMap`, allocating separate baseline slots and duplicating comparison rows. Wildcards (`*`, `?`) and empty path components are also not explicitly rejected.
   - *Fix:* Reject noncanonical input upfront (including redundant separators and illegal characters), do not silently trim filename whitespace, and key `tracked_paths` strictly by the canonical relative path constructed from validated components.

4. **Root pinning fails open and does not prevent post-registration symlink substitution.**
   - *Location:* `server/src/session_changes/capture.rs:391-395, 83-92`.
   - *Impact:* `register_session` attempts to pin the root directory using `File::open(&validated_root.canonical_root).ok()`. If `File::open` fails, it silently falls back to `root_dir_file = None`. In `probe_file_safely_unix`, when `root_fd` is `None`, it silently opens `canonical_root` by pathname via `File::open` on every probe, completely defeating directory pinning. Moreover, `File::open` follows symlinks instead of using `O_DIRECTORY | O_NOFOLLOW`.
   - *Fix:* Open the root descriptor using `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`. Fail registration with `ErrorCode::TargetUnavailable` if root pinning fails. Never fall back to pathname-based opening once registered.

5. **Non-Unix compilation failure due to unqualified `RawFd`.**
   - *Location:* `server/src/session_changes/capture.rs:4, 286`.
   - *Impact:* `RawFd` is imported under `#[cfg(unix)]`, yet the public function signature `pub fn probe_file_safely(root_fd: Option<RawFd>, ...)` uses `RawFd` unconditionally. On Windows / non-Unix targets, compilation will fail with `cannot find type RawFd in this scope`. Furthermore, ancestor `symlink_metadata` checks followed by `File::open(&current)` on Windows are subject to TOCTOU symlink/junction substitution races.
   - *Fix:* Guard `root_fd` in `probe_file_safely` with `#[cfg(unix)]` or introduce an OS-agnostic handle type / wrapper.

---

### Warnings (High & Medium Priority)

1. **High — Declared 5-second comparison deadline (`MAX_COMPARISON_DURATION_SECS`) is unenforced.**
   - *Location:* `server/src/session_changes/comparison.rs:46-51, 382-384`.
   - *Impact:* `spawn_blocking` runs without cooperative deadline checking or an outer async timeout. While individual text diffs check `MAX_PER_FILE_DIFF_MS` (50ms), evaluating 500 files can run up to 25s under CPU contention before returning. A `tokio::time::timeout` wrapper bounds client wait, but cooperative checks inside the loop are needed to prevent orphaned worker permit exhaustion.
   - *Fix:* Check elapsed time cooperatively inside the tracked entries loop, and abort with `ErrorCode::Deadline` if total scan time exceeds `MAX_COMPARISON_DURATION_SECS`.

2. **Medium — `FileChangeKind::ModeOnly` marks binary files as renderable, breaking Monaco diff view.**
   - *Location:* `server/src/session_changes/comparison.rs:698`.
   - *Impact:* `get_file_detail` returns `renderable = true` unconditionally for `ModeOnly`. If a binary file undergoes a permission change (e.g. `chmod +x run.bin`), `original.content` and `current.content` are `None`. Because `renderable` is `true`, the browser UI attempts to mount a Monaco diff editor from `null` content rather than displaying the binary unsupported placeholder.
   - *Fix:* Set `renderable = (row.original_kind == FileContentKind::Text && original_side.content.is_some() && current_side.content.is_some() && orig_renderable && curr_renderable)`.

3. **Medium — Clippy warnings present in test suite.**
   - *Location:* `server/src/session_changes/comparison_tests.rs:214:40, 257:40`.
   - *Impact:* Running `cargo clippy --tests` emits `needless_borrows_for_generic_args` on `fs::write(root.join("binary.bin"), &[0u8, 1, 2, 3])`.
   - *Fix:* Remove redundant borrow `&` from array literals passed to `fs::write`.

---

### Suggestions (Low Priority)

1. **Low — Response serialization size bounds:** `MAX_PAGE_SERIALIZED_BYTES` (512 KiB) is defined in `types.rs`, but `list_changed_files` does not estimate or bound JSON payload size when pages contain many long paths.
2. **Low — Owned descriptor RAII:** Replace manual `Vec<RawFd>` push/close loops in `probe_file_safely_unix` with an RAII guard struct to prevent accidental descriptor leaks on early returns.

---

### Reviewed Files

- `server/src/session_changes/store.rs`
- `server/src/session_changes/capture.rs`
- `server/src/session_changes/comparison.rs`
- `server/src/session_changes/control.rs`
- `server/src/session_changes/types.rs`
- `server/src/session_changes/inventory.rs`
- `server/src/session_changes/binding.rs`
- `server/src/session_changes/root.rs`
- `server/src/session_changes/text_diff.rs`
- `server/src/session_changes/mod.rs`
- `server/src/api/session_changes.rs`
- `server/src/api/router.rs`
- `docs/code-standards.md`
- `server/src/session_changes/capture_tests.rs`
- `server/src/session_changes/comparison_tests.rs`
- `server/src/session_changes/types_tests.rs`
- `server/src/session_changes/root_tests.rs`
- `server/tests/fixtures/session-changes-wire.json`
- `server/tests/session_changes_adversarial.rs`
- `server/tests/session_changes_api.rs`
- `server/tests/session_changes_controls.rs`
- `server/tests/session_changes_lifecycle.rs`
- `server/tests/session_changes_protocol.rs`

---

### Validation Commands & Results

1. `cargo check --manifest-path server/Cargo.toml`: **PASS** (0 errors, 0 warnings).
2. `cargo check --tests --manifest-path server/Cargo.toml`: **PASS** (0 errors, 0 warnings).
3. `cargo test --lib --manifest-path server/Cargo.toml session_changes`: **PASS** (28 passed, 0 failed, 1472 filtered).
4. `cargo test --manifest-path server/Cargo.toml --test session_changes_protocol --test session_changes_controls --test session_changes_api --test session_changes_adversarial --test session_changes_lifecycle`: **PASS** (13 passed across 5 suites, 0 failed).
5. `cargo test --manifest-path server/Cargo.toml --test agent_status_integration session_changes`: **PASS** (3 passed, 0 failed).
6. `cargo clippy --manifest-path server/Cargo.toml --lib -- -A clippy::all -W clippy::correctness`: **PASS** (0 correctness warnings).
7. `cargo clippy --manifest-path server/Cargo.toml --tests`: **FAIL** with 2 warnings in `comparison_tests.rs` (`needless_borrows_for_generic_args`).

---

### Recommended Actions

1. **Fix Acknowledgment Model:** Decouple server write from client acknowledgment. Allow same-attempt `Unproven` calls to downgrade pending/unacknowledged captures, and remove the test backdoor in `test_unproven_downgrades_unacknowledged_attempt_only`.
2. **Prevent Concurrent Fail-Open Race:** When a second attempt touches a pending slot and fails open, invalidate the pending capture so the delayed worker cannot adopt post-edit bytes.
3. **Canonicalize Path Keys:** Key `tracked_paths` by canonical normalized relative paths; reject leading/trailing whitespace and illegal characters rather than trimming.
4. **Strict Root Pinning:** Open root with `O_DIRECTORY | O_NOFOLLOW`; return error if pinning fails rather than falling back to pathname opens.
5. **Fix Non-Unix Signature:** Conditionalize `root_fd: Option<RawFd>` in `probe_file_safely` for non-Unix compilation.
6. **Fix ModeOnly Renderability:** Verify `row.original_kind == FileContentKind::Text` before setting `renderable = true`.

---

### Unresolved Questions

1. Should non-Unix (Windows) support handle-relative traversal via Win32 `ReOpenFile` / `CreateFile` with `FILE_FLAG_BACKUP_SEMANTICS`, or is pathname probing with junction rejection explicitly accepted as a platform limitation?
2. Does the producer protocol intend to send a separate acknowledgment message after receiving `Captured`, or should the server infer acknowledgment upon receiving the next `Settled` turn?
