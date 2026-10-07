# Implementation Report: SHA-256 Commit Inspection & Metadata Hardening

- Plan: plans/261006-1052-pr48-review-and-hardening/plan.md (Phases 01-03 SHA256 & metadata slice)
- Date: 2026-10-06 11:12 Asia/Saigon
- Status: Completed (ready for parent integration barrier)

## Actual Changed Paths
1. `packages/ui/src/api/client.ts`: Shared TS interfaces `GitBlameCommit` (`authorEmail`) and `GitCommitDetails` (`authorEmail`, `committerName`, `committerEmail`, `committerTimestamp`, `committerTimezoneOffsetMinutes`).
2. `server/src/git/types.rs`: Rust DTOs `GitBlameCommit` and `GitCommitDetails` matching Serde camelCase schema.
3. `server/src/git/commit_details.rs`: Exact 40/64 hex OID inspection; SHA-1 libgit2 fast path with header-before-payload size/type validation; SHA-256 Git CLI path with strict 5 MiB bound, bounded stdout streaming, clean child termination, and robust raw commit parser (UTF-8 lossy, multiline continuation headers, signed timezone offsets).
4. `server/src/git/diff.rs`: `get_commit_files` and `get_commit_file_diff` supporting 64-hex SHA-256 hashes via read-only CLI fallback (`--no-replace-objects`, `--literal-pathspecs`, `-c diff.external=`, `--no-ext-diff`, `--no-textconv`) + in-memory `git2::Patch::from_buffers` diffing.
5. `server/src/git/repository.rs`: Supporting read-only `get_status` and `get_log` CLI fallbacks for SHA-256 repos (`extensions.objectformat = sha256`).
6. `server/tests/git_sha256_inspection.rs`: Dedicated behavioral integration test suite on real `git init --object-format=sha256` repository.

## Metadata Schema
- `GitBlameCommit`:
  - `hash: String` / `string`
  - `author_name: String` / `authorName: string`
  - `author_email: String` / `authorEmail: string` (REQUIRED)
  - `author_timestamp: i64` / `authorTimestamp: number`
  - `author_timezone_offset_minutes: i32` / `authorTimezoneOffsetMinutes: number`
  - `subject: String` / `subject: string`
- `GitCommitDetails`:
  - `hash: String` / `string`
  - `author_name: String` / `authorName: string`
  - `author_email: String` / `authorEmail: string` (REQUIRED)
  - `author_timestamp: i64` / `authorTimestamp: number`
  - `author_timezone_offset_minutes: i32` / `authorTimezoneOffsetMinutes: number`
  - `committer_name: String` / `committerName: string` (REQUIRED)
  - `committer_email: String` / `committerEmail: string` (REQUIRED)
  - `committer_timestamp: i64` / `committerTimestamp: number` (REQUIRED)
  - `committer_timezone_offset_minutes: i32` / `committerTimezoneOffsetMinutes: number` (REQUIRED)
  - `subject: String` / `subject: string`
  - `full_message: String` / `fullMessage: string`

## Migrated Callers
- Rust `GitBlameCommit` & `GitCommitDetails` construction sites updated in `commit_details.rs`.
- Parent populates `author_email` in `blame.rs` (pre-existing field reference satisfied).
- Peer `BlameUiHardening` coordinated via IRC for UI components (`CommitDetailsPanel`, `EditorGitBlameRow`, gutter, context menu).
- `get_commit_files` & `get_commit_file_diff` transparently handle both 40-char SHA-1 and 64-char SHA-256 hashes.

## Deterministic Scenarios
- `test_sha256_root_and_detached_commit_details`: Verifies root and detached HEAD commit details with distinct author/committer and timezone offsets (+0700 vs +0200).
- `test_sha256_commit_details_errors`: 404 for missing 64-hex OID; 404 for tree object in ODB; 400 for non-hex / bad-length hashes.
- `test_sha256_commit_files_and_renames`: Root additions; second commit modifications, renames (`file2.txt` -> `file2_renamed.txt`), and newly added files with correct line stats.
- `test_sha256_commit_file_diff_unified`: Unified diff hunks and line changes for new, modified, and binary files.
- `test_sha256_read_only_log_and_status`: Clean working copy status and commit log entries on SHA-256 repos.
- `test_sha256_immutability`: Confirms HEAD OID, status, reflog, and working tree files remain completely untouched before and after inspection calls.

## Checks for Main Agent
1. `cargo test --test git_sha256_inspection`
2. `cargo test git::commit_details::tests`
3. Parent HTTP live smoke on `/api/git/{project}/commit/{hash}/details`, `/files`, `/diff` with 64-hex SHA-256 commits.

## Unresolved Questions
None.
