# Phase 01: Backend Diff & Change Management APIs

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Existing `server/src/git/repository.rs`

## Overview
- **Priority:** P1
- **Status:** DONE
- **Effort:** 1.5d

Add REST endpoints for file diff retrieval, staging, unstaging, discarding changes, and merge conflict content.

## Key Insights

- `git2` provides `diff_index_to_workdir()` and `diff_tree_to_index()` for unstaged/staged diffs
- `Patch::from_diff()` extracts per-file hunks; `patch.to_buf()` gives unified diff text
- File content for diff viewer needs both original (HEAD blob) and modified (workdir read)
- Hunk-level discard via content manipulation (replace lines) is simpler than reverse-patching
- Conflict detection via `index.has_conflicts()` + `index.conflicts()` iterator

## Requirements

1. List changed files with diff status (staged vs unstaged, change type)
2. Return file-level diff content (original + modified text)
3. Stage / unstage individual files
4. Discard all changes to a file
5. Discard a specific hunk within a file
6. List merge conflict files with ancestor/ours/theirs content
7. Accept resolved content for a conflicted file

## Architecture

New functions in `server/src/git/repository.rs`:
```rust
pub fn get_diff_files(project_path: &Path) -> Result<DiffFileList, AppError>
pub fn get_file_diff(project_path: &Path, file_path: &str) -> Result<FileDiffContent, AppError>
pub fn stage_files(project_path: &Path, paths: &[&str]) -> Result<(), AppError>
pub fn unstage_files(project_path: &Path, paths: &[&str]) -> Result<(), AppError>
pub fn discard_file(project_path: &Path, file_path: &str) -> Result<(), AppError>
pub fn discard_hunk(project_path: &Path, file_path: &str, hunk_index: usize) -> Result<(), AppError>
pub fn get_conflicts(project_path: &Path) -> Result<Vec<ConflictFile>, AppError>
pub fn resolve_conflict(project_path: &Path, file_path: &str, content: &str) -> Result<(), AppError>
```

New routes in `server/src/api/git.rs`:
```
GET    /api/git/:project/diff              → list changed files
GET    /api/git/:project/diff/*path        → file diff content
POST   /api/git/:project/stage             → { paths: string[] }
POST   /api/git/:project/unstage           → { paths: string[] }
POST   /api/git/:project/discard           → { path: string }
POST   /api/git/:project/discard-hunk      → { path: string, hunkIndex: number }
GET    /api/git/:project/conflicts         → list conflicts with content
POST   /api/git/:project/resolve           → { path: string, content: string }
```

## Related Code Files

| File | Action |
|------|--------|
| `server/src/git/repository.rs` | Add diff/stage/discard/conflict functions |
| `server/src/git/mod.rs` | Export new types |
| `server/src/api/git.rs` | Add route handlers |
| `server/src/api/router.rs` | Register new routes |
| `packages/web/src/api/ws-transport.ts` | Add channel mappings |
| `packages/web/src/api/queries.ts` | Add React Query hooks |

## Types

```rust
#[derive(Serialize)]
pub struct DiffFileEntry {
    pub path: String,
    pub status: String,       // "modified"|"added"|"deleted"|"renamed"|"conflicted"
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
    pub old_path: Option<String>,  // for renames
}

#[derive(Serialize)]
pub struct FileDiffContent {
    pub path: String,
    pub original: Option<String>,  // None if new file
    pub modified: Option<String>,  // None if deleted
    pub language: String,
    pub hunks: Vec<HunkInfo>,
}

#[derive(Serialize)]
pub struct HunkInfo {
    pub index: usize,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
}

#[derive(Serialize)]
pub struct ConflictFile {
    pub path: String,
    pub ancestor: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
}
```

## Implementation Steps

1. Add types to `server/src/git/types.rs` (or `mod.rs`)
2. Implement `get_diff_files()` — combine staged + unstaged diffs into unified list
3. Implement `get_file_diff()` — read HEAD blob + workdir file, compute hunks
4. Implement `stage_files()` / `unstage_files()` — index add/reset
5. Implement `discard_file()` — checkout HEAD for path
6. Implement `discard_hunk()` — read original + modified, replace hunk lines, write back
7. Implement `get_conflicts()` — iterate index conflicts, read blob content
8. Implement `resolve_conflict()` — write file + stage
9. Add route handlers in `api/git.rs`
10. Register routes in `router.rs`
11. Add WsTransport channel mappings + React Query hooks
12. Write integration tests

## Todo

- [x] Types definition
- [x] get_diff_files
- [x] get_file_diff
- [x] stage_files / unstage_files
- [x] discard_file
- [x] discard_hunk
- [x] get_conflicts / resolve_conflict
- [x] Route handlers
- [x] WsTransport + query hooks
- [x] Integration tests

## Success Criteria

- `GET /diff` returns correct staged/unstaged file list matching `git status`
- `GET /diff/:path` returns original + modified content for Monaco DiffEditor
- Stage/unstage/discard operations match git CLI behavior
- Conflict endpoints return correct 3-way content
- All operations scoped to project sandbox

## Risk Assessment

| Risk | L | I | Mitigation |
|------|---|---|------------|
| Large binary files in diff | M | M | Skip binary files, return `isBinary: true` flag |
| Hunk discard off-by-one | M | H | Thorough test with multi-hunk files |
| Concurrent writes during discard | L | M | Use existing `atomic_write_with_check` pattern |

## Security Considerations

- All paths validated through `WorkspaceSandbox` — no path traversal
- Discard/stage are destructive — no additional auth beyond existing bearer token
