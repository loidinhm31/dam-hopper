## Code Review Summary

### Scope
- Files reviewed: `server/src/git/{blame.rs, commit_details.rs, types.rs}`, `server/src/api/{git_blame.rs, git.rs, router.rs}`, `server/src/{state.rs, error.rs, api/error.rs}`, `server/tests/git_blame_api.rs` (PR diff 215-226).
- Lines of code analyzed: ~1,850 LOC.
- Review focus: Native Git blame & commit details API, line endings, staged renames, sandbox isolation, allocation bounds, HEAD races, concurrency permits, 40/64 OID support.
- Updated plans: None (read-only audit; parent owns verdict and plans).

### Overall Assessment
Architecture is sound with strict working-copy immutability, zero-disk mutations, and bounded concurrency (2 permits). Sandbox containment safely blocks directory traversal and path escapes via lexical checks and canonical prefix validation in `vcs_roots.rs` and `workspace_target.rs`. However, audit identified an unsupported 64-character OID promise, baseline blob allocation preceding size checks, missing HEAD revalidation on early return paths, and lone CR line-collapsing in native API inputs.

### Critical Issues
None. (No path traversal escape, no memory unsafety, no authorization bypass).

### High Priority Findings (P1 / P2)
1. **[P1] Baseline Guards Bypassed on Staged Renames: Oversized & Binary Files Pass (Live Confirmed)**
   - Location: `server/src/git/blame.rs:197-254`, `blame.rs:415-442`
   - Trigger: Commit large or binary file at HEAD, stage rename via `git mv`, POST blame for renamed path.
   - Observable Harm: Live server confirmed bypass across both size and binary guards:
     - Oversized: `path: oversized.txt` (5,242,882 B blob) returns 413 `GIT_BLAME_TOO_LARGE`; staged rename `path: renamed.txt` bypasses guard and returns 200 uncommitted.
     - Binary: `binary.dat` (`abc\0def`) returns 415 `UNSUPPORTED_FILE`; staged rename `path: renamed-binary.dat` with `content: abc\n` bypasses guard and returns 200 ready committed line 1.
     Guards exist only inside `head_tree.get_path` `Ok(entry)` branch and are skipped for `find_staged_rename_origin` results. Additionally, `repo.find_blob` on direct paths allocates full ODB blob before size verification instead of checking `odb.read_header()`.
   - Minimal Fix: Execute common baseline validation after path resolution: run `odb.read_header()` size (<5 MiB) and binary check on `blame_baseline_path` for both direct HEAD paths and resolved staged rename origins.
   - Reproducer: `git mv oversized.txt renamed.txt` -> POST `renamed.txt` returns 200 instead of 413; `git mv binary.dat renamed-binary.dat` -> POST `renamed-binary.dat` returns 200 instead of 415.

2. **[P2] Git-Tree Symlink Guard Bypass When File Absent from Working Copy (Live Confirmed)**
   - Location: `server/src/git/blame.rs:125-133, 198-204`
   - Trigger: Path is a Git symlink in HEAD tree (mode `0120000`), but file is not checked out on disk (or in bare repo).
   - Observable Harm: Live server confirmed: HEAD symlink `link.txt -> lf.txt` with working copy unlinked. Blaming `link.txt` with content `lf.txt` returns 200 ready attribution, completely bypassing symlink guard. `symlink_metadata` only checks disk presence; in Git tree, symlinks are stored as blobs (`entry.kind() == ObjectType::Blob`), passing kind validation.
   - Minimal Fix: Verify `entry.filemode() != 0o120000` (or `git2::FileMode::Link`).
   - Reproducer: Commit `link.txt -> lf.txt`; `rm link.txt`; POST `link.txt` with content `lf.txt` returns 200 ready instead of 415.

3. **[P2] Unsupported 64-Character OID Promise in Commit Details (Live Confirmed)**
   - Location: `server/src/git/commit_details.rs:16-28`
   - Trigger: `GET /api/git/{project}/commit/{hash}/details` with 64-hex SHA-256 hash.
   - Observable Harm: Live server confirmed: sending 64-character hash returns 400 `GIT_BLAME_INVALID_INPUT` (`"unable to parse OID - too long"`). Validation regex permits 64-hex chars, but `git2-rs 0.19` (`git2::Oid::from_str`) unconditionally rejects it. Contract promises 64-char OID support; underlying library does not support it. Not exploitable (fails safely with 400).
   - Minimal Fix: Enforce `trimmed_hash.len() == 40` in validation and clarify SHA-1 limitation, or guard 64-char parsing behind SHA-256 feature flag.
   - Reproducer: `curl -s "http://localhost:3000/api/git/test-repo/commit/$(printf 'a%.0s' {1..64})/details"` -> 400.

### Medium Priority Improvements (P3)
1. **[P3] [INFERENCE] HEAD Race in Early Return Paths Bypasses Stale Revision Guard**
   - Location: `server/src/git/blame.rs:230-252` (Case 3: file not in HEAD tree)
   - Trigger: File untracked at blame start. External commit/checkout introduces file at HEAD while tree-to-index diff runs.
   - Observable Harm: Early return at line 232 returns 200 OK (`status: Uncommitted`, `baseCommitOid: old_head`), never executing line 403 HEAD revalidation. Client receives stale uncommitted attribution instead of 409 `GIT_BLAME_STALE_REVISION`.
   - Minimal Fix: Revalidate `repo.head().ok().and_then(|h| h.target()) == Some(head_oid)` before returning in Case 3 (and Case 1).
   - Reproducer: Commit file between HEAD capture and Case 3 return; observe 200 uncommitted instead of 409.

2. **[P3] Lone CR (`\r`) Stripping Destroys Line Boundaries in Native API (Live Confirmed)**
   - Location: `server/src/git/blame.rs:91-99` (`normalize_buffer_content`)
   - Trigger: Blame payload contains lone carriage returns (`"alpha\rbeta\r"`).
   - Observable Harm: Live server confirmed: `POST content: "alpha\rbeta\r"` returns HTTP 200, `bufferLineCount: 1`, `status: uncommitted`. `content.replace('\r', "")` strips `\r` without normalizing, collapsing lines. Monaco frontend normalizes EOL internally on model creation, preventing UI exposure, but raw API callers experience corrupted line attribution.
   - Minimal Fix: Replace `\r\n` with `\n`, then lone `\r` with `\n` (`content.replace("\r\n", "\n").replace('\r', "\n")`).
   - Reproducer: `POST /api/git/test-repo/blame` with `content: "a\rb\r"` -> `bufferLineCount: 1`.

3. **[P3] Staged Rename Overwriting Existing HEAD File Uses Old Target Path**
   - Location: `server/src/git/blame.rs:197-226`
   - Trigger: `git mv -f source.txt target.txt` where `target.txt` already existed in HEAD.
   - Observable Harm: `head_tree.get_path("target.txt")` succeeds; `find_staged_rename_origin` is skipped. Blame runs against old `target.txt` instead of staged origin `source.txt`.
   - Minimal Fix: Check index status for renamed delta prior to checking `head_tree.get_path`.
### Low Priority Suggestions
1. **Redundant Post-Partition Trailing Newline Check**
   - Location: `server/src/git/blame.rs:377-401`
   - Issue: `partition_and_merge_ranges` already guarantees continuous coverage up to `total_lines` with trailing uncommitted range. Redundant defensive branch.

### Positive Observations
- Strict working-copy isolation: zero working-copy disk mutations, zero ref changes, zero index writes verified by integration tests.
- Path traversal protection: lexically rejects `..`, absolute paths, root/prefix components; `vcs_roots.rs` and `workspace_target.rs` enforce canonical prefix boundaries.
- Concurrency admission: 2-permit semaphore transferred into `spawn_blocking` closure prevents permit leaks on dropped futures and rejects over-capacity with immediate 503.
- CRLF handling: CRLF baselines and CRLF buffers attribute cleanly without false uncommitted lines (smoke confirmed by parent).
- Libgit2 zero-OID hunks cleanly map to `commit_index: None`, preventing spurious ODB lookups.

### Recommended Actions
1. Common baseline validation: execute unified `odb.read_header()` size (<5 MiB) and binary check on `blame_baseline_path` after resolving staged renames.
2. Revalidate HEAD in `blame.rs` Case 3 before returning uncommitted response.
3. Restrict `commit_details.rs` to 40-character OIDs or document SHA-1 library boundary.
4. Normalize `\r` to `\n` instead of stripping `\r` to empty string.
5. Check `entry.filemode()` to reject Git tree symlinks (0120000).

### Metrics
- Type Coverage: 100% Rust / Serde DTOs
- Test Coverage: 25 unit/integration tests passing
- Linting Issues: 0 compiler errors / warnings in reviewed PR diffs

### Unresolved Questions
1. Should `git2` crate eventually be compiled with SHA-256 experimental flags if SHA-256 repos must be supported, or is 40-char SHA-1 sufficient for current roadmap?
2. Does the API wish to support unstaged whole-file renames via working-tree similarity diffs, or is limiting rename detection to staged index changes permanent?
