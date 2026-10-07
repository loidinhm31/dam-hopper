# Backend Research: Native Blame & Buffer Attribution

## 1. Executive Summary & Verification Verdict
- Native git2 0.19.0 directly supports in-memory buffer blame via `Blame::blame_buffer` over `Repository::blame_file`.
- Existing `get_commit_message` (`server/src/git/commit_message_rewrite.rs:288`) is strictly branch/HEAD-constrained and **cannot** be reused for arbitrary historical commit inspection. A dedicated unconstrained reader is required.
- Global request body limit is 10 MiB (`router.rs:631`), but a 5 MiB editor buffer with worst-case JSON string escaping can expand toward ~30 MiB. A route-local 32 MiB override is essential.
- Native blame in `spawn_blocking` cannot be cancelled by dropping Tokio futures; unbounded concurrency risks thread pool exhaustion without an explicit semaphore admission gate.

## 2. Native Git2 Blame Contract & Buffer Semantics
- **Symbols**: `git2::Repository::blame_file` (`Path`, `Option<&mut BlameOptions>`), `git2::Blame::blame_buffer(&[u8])`, `git2::BlameHunk::final_commit_id()`, `git2::BlameHunk::final_signature()`.
- **Buffer attribution** (`~/.cargo/registry/.../git2-0.19.0/src/blame.rs:38,377`): Differing buffer lines receive a zero OID (`oid.is_zero() == true`).
- **Proposed endpoint**: `POST /api/git/{project}/blame`
  - *Request*: `{ path: String, worktreePath?: Option<String>, root?: Option<String>, content: String, modelVersion?: Option<i64> }`
  - *Response*: `{ hunks: Vec<BlameHunkDto>, commits: HashMap<String, BlameCommitMeta>, headOid: String, rootId: String, resolvedPath: String }`
  - *Compact representation*: Hunks reference deduplicated commits by hash; zero OID hunks omit commit hash (`uncommitted: true`).

## 3. Path Security & Root Resolution Reuse
- **Target resolution**: Reuse `resolve_target_path(&state, &project, worktree_path).await?` (`server/src/api/git_diff.rs:31`). Validates project existence and worktree registration.
- **Root resolution**: Reuse `resolve_git_path_root(&proj_path, root.as_deref(), &[rel])?` (`server/src/git/vcs_roots.rs:225`). Resolves nested repositories (`deepest_matching_root`) and strips root prefix.
- **Traversal checks**: Reuse `safe_join` (`server/src/git/diff.rs:38`) and `has_traversal` (`vcs_roots.rs:525`) rejecting `..`, absolute paths, and project escaping.

## 4. Body, Text, & Escaping Limits
- **Fact**: `server/src/api/router.rs:631` layers `DefaultBodyLimit::max(10 * 1024 * 1024)`.
- **Fact**: UI normal/degraded Monaco tiers accept files strictly below 5 MiB (`packages/ui/src/lib/file-tier.ts:15-36`). `fs/ops.rs:755` is a separate 10 MiB search-file limit, not the editor-tier limit.
- **Fact / Risk**: UTF-8 JSON serialization of a 5 MiB buffer with high control/escape density (e.g. `\u00xx`, `\"`, `\n`) can expand up to ~30 MiB. Sending this to `/api/git/{project}/blame` will trip the global 10 MiB limit with HTTP 413.
- **Contract mitigation**: Apply route-local `RequestBodyLimitLayer::new(32 * 1024 * 1024)` or `DefaultBodyLimit::disable()` + route limit on `/blame` in `router.rs` without raising the global 10 MiB default for unrelated routes.
- **Content guards**: Validate UTF-8; check `is_binary_content` (`diff.rs:132`, null byte check `bytes.contains(&0)`). Return `is_binary: true` rather than executing blame on binary blobs.

## 5. Bounded Blocking-Work Admission
- **Fact**: Git operations run via `tokio::task::spawn_blocking` (`git_diff.rs:32,111`).
- **Fact**: `libgit2` blame runs synchronous C graph traversal. Dropping the outer Axum/Tokio request future does **not** abort CPU work in the blocking pool.
- **Recommendation**: Shared server-wide semaphore using `try_acquire_owned`, no waiting queue; parent contract selects two permits and existing HTTP 503 mapping. Bulk per-request concurrency is not a server-wide admission bound.

## 6. Edge Cases: Unborn HEAD, Untracked, Missing, Renames
- **Unborn HEAD / Empty Repo**: `repo.head()` fails (`GIT_EUNBORNBRANCH` / `NotFound`). Handle gracefully by returning a single synthetic uncommitted hunk covering all buffer lines, rather than 500 error.
- **Untracked / New file**: File absent in HEAD tree (`repo.head().peel_to_tree()?.get_path(path)` not found). Blame cannot run against HEAD; return 100% uncommitted hunks.
- **Deleted at workdir but blamed from buffer**: Blame against HEAD + `blame_buffer` still succeeds using the submitted buffer text.
- **Staged & Committed Renames**:
  - Committed renames: Require native fixture proof. Do not claim `track_copies_same_commit_moves` enables rename support: [libgit2 v1.8.1 flag docs](https://libgit2.org/docs/reference/v1.8.1/blame/git_blame_flag_t.html) explicitly reserve copy/move flags as unimplemented. Plain whole-file rename following is a separate semantic check.
  - Staged renames: HEAD tree has `old_path`, index has `new_path`. `blame_file(new_path)` against HEAD returns `GIT_ENOTFOUND`. Check staged index delta (`git::get_diff_files` or index status). If staged rename detected, blame HEAD using `old_path` before applying buffer attribution for `new_path`.

## 7. Analysis of `get_commit_message` & Arbitrary Commit Inspection
- **Fact**: `server/src/git/commit_message_rewrite.rs:288-360` (`get_commit_message`):
  - Line 328-333: When `target_branch` is None, requires `head.is_branch()` under `refs/heads/`. Returns error if HEAD is detached (`"commit messages require a checked-out local branch"`).
  - Line 351-360: Asserts `repo.graph_descendant_of(old_tip, target_oid)`. If false, returns error (`"target commit {hash} is not reachable from branch tip ..."`).
- **Fact**: Existing route `GET /api/git/{project}/commit/{hash}/message` (`api/git.rs:830`) wraps `get_commit_message` directly.
- **Conclusion**: `get_commit_message` is **strictly coupled** to branch-rewrite CAS validation. It fails on detached HEAD worktrees, historical commits from other branches, or unmerged parents. It **cannot** be reused for general blame commit details.
- **Recommendation**: Create a dedicated read-only commit lookup (`get_commit_details` / `repo.find_commit(oid)`). Extract `summary()`, `body()`, `message()`, `author()`, `time()`, and `parent_ids()` directly from the commit object without branch or reachability preconditions.

## 8. Open Native Semantic Checks (Facts vs. Inferences)
- **[SOURCE EVIDENCE ONLY]** git2's documented API and upstream test source describe zero OIDs on mismatched buffer lines; no local native compilation/execution was performed in this research.
- **[FACT]** `server/src/api/router.rs` owns route registration, not `mod.rs`.
- **[INFERENCE]** `repo.blame_file` performance on large historical files (>10k lines, >50k commits): May require line-range slicing (`min_line`/`max_line`) if debounced queries exceed 500ms; full-file blame benchmark against realistic repos needed during testing.
- **[INFERENCE]** Staged rename resolution: Falling back to `old_path` on index-staged renames needs verification with real git2 fixtures during planning/implementation.

## 9. Unresolved Questions
- None for backend scoping. Ready for parent synthesis.
