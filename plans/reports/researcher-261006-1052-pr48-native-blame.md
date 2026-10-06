# Native Blame & Read-Only Commit Details Research (PR #48)

Date: 2026-10-06 | Target: `server/src/git/blame.rs`, `server/src/git/commit_details.rs`, `server/src/api/git_blame.rs`

## Primary Sources
1. **libgit2 C API & Source (v1.8.1 / v1.8.4)**: `https://libgit2.org/docs/reference/v1.8.4/blame/index.html` & `https://github.com/libgit2/libgit2/blob/v1.8.1/src/libgit2/blame.c` (`git_blame_buffer`, `git_diff_blob_to_buffer`).
2. **git2-rs Crate API Docs (v0.19.0)**: `https://docs.rs/git2/0.19.0/git2/struct.Oid.html` & `https://docs.rs/git2/0.19.0/git2/struct.Blame.html` (`Oid::from_str`, `Blame::blame_buffer`).

## Key Findings & Validations

### 1. `blame_buffer` Line Ending Semantics & Empty Buffer
- **Empty Buffer Guard [OBSERVED]**: In `libgit2/src/libgit2/blame.c:531`, `git_blame_buffer` executes `GIT_ASSERT_ARG(buffer && buffer_len)`. Calling native `blame_buffer` with `buffer_len == 0` aborts with `GIT_EINVALID`. `server/src/git/blame.rs:173` correctly intercepts `content.is_empty()` and returns `GitBlameStatus::Empty` with 0 hunks and 1 display row.
- **CRLF Mismatch [OBSERVED]**: `git_diff_blob_to_buffer` splits text lines by `\n`. If incoming editor buffer contains `\r\n` while Git ODB blob contains LF, diff marks all lines as additions/deletions, turning all hunks into zero OID (uncommitted). Normalizing buffer content by stripping `\r` (`normalize_buffer_content`) ensures clean diff against ODB blobs.
- **Monaco Display Rows [OBSERVED]**: Monaco evaluates `content.split('\n').length`. Trailing newline produces terminal empty row omitted by native hunk output. PR #48 correctly emits explicit uncommitted trailing row for line `buffer_line_count`.

### 2. Staged Rename Baseline
- **Index Resolution [OBSERVED]**: When target file renamed in index but uncommitted, `head_tree.get_path` fails. `find_staged_rename_origin` executes `repo.diff_tree_to_index(Some(&head_tree), Some(&index))` with `DiffFindOptions::renames(true)`. Matching `delta.new_file().path()` retrieves `delta.old_file().path()`. Native blame executes `blame_file(old_path)` at HEAD, then diffs `blame_buffer(normalized_bytes)`.
- **Challenge [OBSERVED]**: Direct HEAD path checks blob type, size (`<= 5 MiB`), and binary content (`server/src/git/blame.rs:198-218`). Staged rename fallback bypasses these checks on `old_path`'s HEAD blob before invoking `blame_file`.
- **Safe Minimal Solution**: Extract blob validation (`is_blob`, `<= 5 MiB`, non-binary) into helper and apply to `blame_baseline_path` regardless of direct or renamed origin.

### 3. Resource Bounds & Global Admission
- **Buffer & Metadata Limits [OBSERVED]**: Buffer content bounded `< 5 MiB` (`MAX_BUFFER_CONTENT_BYTES`). Path/worktree metadata `<= 4096` bytes; `snapshot_id <= 64` bytes. Path traversal (`..`, root, prefix) rejected.
- **Pre-allocation ODB Header Check [OBSERVED]**: `odb.read_header(oid)` validates commit object size `<= 5 MiB` (`MAX_COMMIT_OBJECT_BYTES`) before calling `repo.find_commit(oid)`, preventing memory exhaustion from malicious commits.
- **Axum Route Body Limit [OBSERVED]**: `DefaultBodyLimit::max(32 MiB)` layered on `/api/git/{project}/blame` successfully overrides router-level `10 MiB` limit via `req.extensions_mut().insert(Limit(32 MiB))` (`axum-core::extract::default_body_limit.rs:225`).
- **Concurrent Workers & Cancellation Safety [OBSERVED]**: 2-permit `tokio::sync::Semaphore` (`git_blame_semaphore`) acquired via `try_acquire_owned()` (503 `GIT_BLAME_BUSY` on contention). Permit moved into `tokio::task::spawn_blocking` closure; thread continues and holds permit to completion even if caller drops HTTP future.

### 4. HEAD Race Handling
- **Double-check Pattern [OBSERVED]**: Initial HEAD target OID captured before blame (`head_oid`). Final publication revalidates `repo.head().ok().and_then(|h| h.target()) == Some(head_oid)`. Concurrently committed or switched branch returns `GitBlameError::StaleRevision` (409).
- **Inference [INFERENCE]**: VCS root mapping (`resolve_git_path_root`) not re-verified at exit; risk minimal as root boundary changes require filesystem relocation, while branch movements are fully caught by HEAD OID check.

### 5. Exact OID SHA1 vs SHA256 Caveat
- **Lexical vs Libgit2 Support [OBSERVED]**: `commit_details.rs:16` accepts both 40 and 64 character hex strings. However, in `git2 = "0.19.0"` (`libgit2-sys 0.17.0+1.8.1`), `Oid` wraps `raw::git_oid` fixed at `GIT_OID_RAWSZ = 20` bytes (SHA-1 only).
- **Failure Mode [OBSERVED]**: `git2::Oid::from_str` calls `git_oid_fromstrn` with `GIT_OID_SHA1`. Any 64-character hash triggers `oid_error_invalid("too long")`, returning `GitBlameError::InvalidInput("failed to parse commit hash")`.
- **Safe Minimal Solution**: Keep 64-char regex check for future ABI compatibility, but document in API docs and error responses that SHA-256 repositories are unsupported under current `git2 0.19` bindings.

## Version Caveats
- `git2 = "0.19"` / `libgit2 1.8.1`: SHA-256 object IDs are experimental in C and unsupported in Rust `git2` safe types. Repositories initialized with `--object-format=sha256` will fail OID parsing.
- Monaco display line calculation treats trailing newline as empty row. Native libgit2 blame excludes trailing row from hunk list. Padding terminal range is required.

## Unresolved Questions
1. Should `find_staged_rename_origin` also check for unstaged working directory renames, or does contract intentionally treat unstaged renames as untracked/uncommitted (current behavior)?
2. Should `commit_details.rs` return a dedicated `GIT_BLAME_UNSUPPORTED_HASH_ALGORITHM` rather than generic `InvalidInput` when a 64-character hex OID fails parsing due to git2 SHA-1 limits?
