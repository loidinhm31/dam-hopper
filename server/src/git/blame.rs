use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path};

use crate::error::GitBlameError;
use crate::git::commit_details::MAX_COMMIT_OBJECT_BYTES;
use crate::git::types::{
    GitBlameCommit, GitBlameInput, GitBlameRange, GitBlameResponse, GitBlameStatus,
};
use crate::git::vcs_roots::resolve_git_path_root;

/// Maximum editor buffer content bytes (5 MiB).
pub const MAX_BUFFER_CONTENT_BYTES: usize = 5 * 1024 * 1024;
/// Maximum length for path metadata strings (4096 bytes).
pub const MAX_PATH_METADATA_BYTES: usize = 4096;
/// Maximum length for snapshot ID string (64 bytes).
pub const MAX_SNAPSHOT_ID_BYTES: usize = 64;

/// Validates raw input fields lexically and bounds-checks payloads before any Git/disk operations.
pub fn validate_blame_input(input: &GitBlameInput) -> Result<(), GitBlameError> {
    if input.content.len() >= MAX_BUFFER_CONTENT_BYTES {
        return Err(GitBlameError::TooLarge(format!(
            "buffer content size ({} bytes) exceeds limit of {} bytes",
            input.content.len(),
            MAX_BUFFER_CONTENT_BYTES
        )));
    }

    if input.content.contains('\0') {
        return Err(GitBlameError::UnsupportedFile(
            "buffer content contains binary/NUL characters".to_string(),
        ));
    }

    if input.path.is_empty() {
        return Err(GitBlameError::InvalidInput(
            "path must not be empty".to_string(),
        ));
    }

    if input.path.len() > MAX_PATH_METADATA_BYTES {
        return Err(GitBlameError::InvalidInput(format!(
            "path length exceeds {} bytes limit",
            MAX_PATH_METADATA_BYTES
        )));
    }

    if let Some(worktree) = &input.worktree_path {
        if worktree.len() > MAX_PATH_METADATA_BYTES {
            return Err(GitBlameError::InvalidInput(format!(
                "worktreePath length exceeds {} bytes limit",
                MAX_PATH_METADATA_BYTES
            )));
        }
    }

    if input.snapshot_id.len() > MAX_SNAPSHOT_ID_BYTES {
        return Err(GitBlameError::InvalidInput(format!(
            "snapshotId length exceeds {} bytes limit",
            MAX_SNAPSHOT_ID_BYTES
        )));
    }

    let path = Path::new(&input.path);
    if path.is_absolute() {
        return Err(GitBlameError::InvalidInput(
            "path must be relative to project root".to_string(),
        ));
    }

    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(GitBlameError::InvalidInput(
                    "path must not contain parent directory traversal ('..')".to_string(),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(GitBlameError::InvalidInput(
                    "path must not contain root or prefix components".to_string(),
                ));
            }
            _ => {}
        }
    }

    Ok(())
}

/// Normalizes Monaco's LF, CRLF, and lone-CR line endings in one allocation.
/// Empty content has one display row; a terminal line ending adds an empty row.
pub fn normalize_buffer_content(content: &str) -> (String, usize) {
    let mut normalized = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    let mut line_count = 1;
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                normalized.push('\n');
                line_count += 1;
            }
            '\n' => {
                normalized.push('\n');
                line_count += 1;
            }
            _ => normalized.push(ch),
        }
    }
    (normalized, line_count)
}

/// Executes native git blame against an in-memory buffer snapshot without mutating
/// the filesystem, index, or HEAD.
pub fn execute_native_blame(
    project_path: &Path,
    input: &GitBlameInput,
) -> Result<GitBlameResponse, GitBlameError> {
    validate_blame_input(input)?;

    let (normalized_content, buffer_line_count) = normalize_buffer_content(&input.content);

    // Resolve owning VCS root and repository-relative path.
    let (resolved_root, selected_paths) =
        resolve_git_path_root(project_path, None, std::slice::from_ref(&input.path)).map_err(
            |err| {
                GitBlameError::InvalidInput(format!("failed to resolve VCS root for path: {err}"))
            },
        )?;

    let repo_relative_path = selected_paths
        .first()
        .ok_or_else(|| GitBlameError::InvalidInput("resolved path list was empty".to_string()))?
        .clone();

    // Check disk file symlink status if present on disk.
    let full_file_path = resolved_root.root_path.join(&repo_relative_path);
    if let Ok(meta) = std::fs::symlink_metadata(&full_file_path) {
        if meta.file_type().is_symlink() {
            return Err(GitBlameError::UnsupportedFile(
                "symlinks are not supported for git blame".to_string(),
            ));
        }
    }

    let repo = git2::Repository::open(&resolved_root.root_path).map_err(|e| {
        GitBlameError::Git(format!("failed to open git repository: {}", e.message()))
    })?;

    // Capture initial HEAD state.
    let initial_head_oid = read_head_oid(&repo)?;

    // Case 1: Unborn HEAD / empty repository.
    let head_oid = match initial_head_oid {
        Some(oid) => oid,
        None => {
            ensure_head_unchanged(&repo, initial_head_oid)?;
            return Ok(GitBlameResponse {
                snapshot_id: input.snapshot_id.clone(),
                model_version: input.model_version,
                root_id: resolved_root.root_id,
                root_relative_path: repo_relative_path,
                base_commit_oid: None,
                buffer_line_count,
                status: GitBlameStatus::Uncommitted,
                ranges: vec![GitBlameRange {
                    start_line: 1,
                    line_count: buffer_line_count,
                    commit_index: None,
                }],
                commits: Vec::new(),
            });
        }
    };

    let head_commit = repo
        .find_commit(head_oid)
        .map_err(|e| GitBlameError::Git(format!("failed to find HEAD commit: {}", e.message())))?;
    let head_tree = head_commit
        .tree()
        .map_err(|e| GitBlameError::Git(format!("failed to find HEAD tree: {}", e.message())))?;

    // Resolve the HEAD baseline first; direct paths and staged rename origins
    // must pass exactly the same mode, object-header, and payload checks.
    let baseline_path = match head_tree.get_path(Path::new(&repo_relative_path)) {
        Ok(_) => Some(Cow::Borrowed(repo_relative_path.as_str())),
        Err(e) if e.code() == git2::ErrorCode::NotFound => {
            find_staged_rename_origin(&repo, &head_tree, &repo_relative_path)?.map(Cow::Owned)
        }
        Err(e) => return Err(GitBlameError::Git(e.message().to_string())),
    };
    if let Some(path) = baseline_path.as_deref() {
        let entry = head_tree.get_path(Path::new(path)).map_err(|e| {
            GitBlameError::Git(format!("failed to resolve HEAD baseline: {}", e.message()))
        })?;
        validate_baseline_entry(&repo, &entry)?;
    }
    if input.content.is_empty() {
        ensure_head_unchanged(&repo, initial_head_oid)?;
        return Ok(GitBlameResponse {
            snapshot_id: input.snapshot_id.clone(),
            model_version: input.model_version,
            root_id: resolved_root.root_id,
            root_relative_path: repo_relative_path,
            base_commit_oid: Some(head_oid.to_string()),
            buffer_line_count: 1,
            status: GitBlameStatus::Empty,
            ranges: Vec::new(),
            commits: Vec::new(),
        });
    }

    // Case 3: File does not exist at HEAD and is not a staged rename (untracked or brand new file).
    let blame_baseline_path = match baseline_path {
        Some(path) => path,
        None => {
            ensure_head_unchanged(&repo, initial_head_oid)?;
            return Ok(GitBlameResponse {
                snapshot_id: input.snapshot_id.clone(),
                model_version: input.model_version,
                root_id: resolved_root.root_id,
                root_relative_path: repo_relative_path,
                base_commit_oid: Some(head_oid.to_string()),
                buffer_line_count,
                status: GitBlameStatus::Uncommitted,
                ranges: vec![GitBlameRange {
                    start_line: 1,
                    line_count: buffer_line_count,
                    commit_index: None,
                }],
                commits: Vec::new(),
            });
        }
    };

    // Run native blame_file against HEAD, then blame_buffer with in-memory normalized content.
    let mut blame_opts = git2::BlameOptions::new();
    blame_opts.newest_commit(head_oid);
    let blame = repo
        .blame_file(
            Path::new(blame_baseline_path.as_ref()),
            Some(&mut blame_opts),
        )
        .map_err(|e| GitBlameError::Git(format!("failed to blame file: {}", e.message())))?;

    let blame_with_buffer = blame
        .blame_buffer(normalized_content.as_bytes())
        .map_err(|e| GitBlameError::Git(format!("failed to blame buffer: {}", e.message())))?;

    let mut commits: Vec<GitBlameCommit> = Vec::new();
    let mut commit_map: HashMap<git2::Oid, usize> = HashMap::new();
    let mut raw_ranges: Vec<GitBlameRange> = Vec::new();

    let odb = repo
        .odb()
        .map_err(|e| GitBlameError::Git(format!("failed to open ODB: {}", e.message())))?;

    for hunk in blame_with_buffer.iter() {
        let lines_in_hunk = hunk.lines_in_hunk();
        if lines_in_hunk == 0 {
            continue;
        }

        let start_line = hunk.final_start_line();
        let final_commit_id = hunk.final_commit_id();

        let commit_index = if final_commit_id.is_zero() {
            None
        } else if let Some(&idx) = commit_map.get(&final_commit_id) {
            Some(idx)
        } else {
            // Validate commit header size before loading.
            let (obj_size, obj_type) = odb.read_header(final_commit_id).map_err(|e| {
                GitBlameError::Git(format!("failed to read commit header: {}", e.message()))
            })?;

            if obj_type != git2::ObjectType::Commit {
                return Err(GitBlameError::Git(format!(
                    "blame commit OID {final_commit_id} is not a commit object: {obj_type:?}"
                )));
            }

            if obj_size > MAX_COMMIT_OBJECT_BYTES {
                return Err(GitBlameError::CommitTooLarge(format!(
                    "commit {final_commit_id} exceeds {MAX_COMMIT_OBJECT_BYTES} bytes"
                )));
            }

            let commit_obj = repo.find_commit(final_commit_id).map_err(|e| {
                GitBlameError::Git(format!(
                    "failed to find commit {final_commit_id}: {}",
                    e.message()
                ))
            })?;

            let author = commit_obj.author();
            let author_when = author.when();
            let author_name = author
                .name()
                .map(str::to_string)
                .unwrap_or_else(|| String::from_utf8_lossy(author.name_bytes()).into_owned());

            let subject = commit_obj.summary().map(str::to_string).unwrap_or_else(|| {
                commit_obj
                    .message()
                    .and_then(|m| m.lines().next())
                    .unwrap_or("")
                    .to_string()
            });

            let commit_dto = GitBlameCommit {
                hash: final_commit_id.to_string(),
                author_name,
                author_email: String::from_utf8_lossy(author.email_bytes()).into_owned(),
                author_timestamp: author_when.seconds(),
                author_timezone_offset_minutes: author_when.offset_minutes(),
                subject,
            };

            let idx = commits.len();
            commits.push(commit_dto);
            commit_map.insert(final_commit_id, idx);
            Some(idx)
        };

        raw_ranges.push(GitBlameRange {
            start_line,
            line_count: lines_in_hunk,
            commit_index,
        });
    }

    // Fill Monaco display rows: if trailing newline, add terminal uncommitted row.
    let mut partitioned_ranges = partition_and_merge_ranges(raw_ranges, buffer_line_count);

    // If buffer ends with newline and last display row is not covered by blame,
    // ensure line `buffer_line_count` is uncommitted.
    if normalized_content.ends_with('\n') {
        let last_covered = partitioned_ranges
            .last()
            .map(|r| r.start_line + r.line_count - 1)
            .unwrap_or(0);
        if last_covered < buffer_line_count {
            if let Some(last) = partitioned_ranges.last_mut() {
                if last.commit_index.is_none() {
                    last.line_count += buffer_line_count - last_covered;
                } else {
                    partitioned_ranges.push(GitBlameRange {
                        start_line: last_covered + 1,
                        line_count: buffer_line_count - last_covered,
                        commit_index: None,
                    });
                }
            } else {
                partitioned_ranges.push(GitBlameRange {
                    start_line: 1,
                    line_count: buffer_line_count,
                    commit_index: None,
                });
            }
        }
    }

    ensure_head_unchanged(&repo, initial_head_oid)?;

    let status = if partitioned_ranges.iter().all(|r| r.commit_index.is_none()) {
        GitBlameStatus::Uncommitted
    } else {
        GitBlameStatus::Ready
    };

    Ok(GitBlameResponse {
        snapshot_id: input.snapshot_id.clone(),
        model_version: input.model_version,
        root_id: resolved_root.root_id,
        root_relative_path: repo_relative_path,
        base_commit_oid: Some(head_oid.to_string()),
        buffer_line_count,
        status,
        ranges: partitioned_ranges,
        commits,
    })
}

fn read_head_oid(repo: &git2::Repository) -> Result<Option<git2::Oid>, GitBlameError> {
    match repo.head() {
        Ok(head) => Ok(head.target()),
        Err(e)
            if e.code() == git2::ErrorCode::UnbornBranch
                || e.code() == git2::ErrorCode::NotFound =>
        {
            Ok(None)
        }
        Err(e) => Err(GitBlameError::Git(e.message().to_string())),
    }
}

fn ensure_head_unchanged(
    repo: &git2::Repository,
    initial_head_oid: Option<git2::Oid>,
) -> Result<(), GitBlameError> {
    if read_head_oid(repo)? != initial_head_oid {
        return Err(GitBlameError::StaleRevision);
    }
    Ok(())
}

fn validate_baseline_entry(
    repo: &git2::Repository,
    entry: &git2::TreeEntry<'_>,
) -> Result<(), GitBlameError> {
    if !matches!(entry.filemode(), 0o100644 | 0o100755)
        || entry.kind() != Some(git2::ObjectType::Blob)
    {
        return Err(GitBlameError::UnsupportedFile(
            "HEAD baseline is not a regular file".to_string(),
        ));
    }
    let odb = repo
        .odb()
        .map_err(|e| GitBlameError::Git(e.message().to_string()))?;
    let (size, kind) = odb
        .read_header(entry.id())
        .map_err(|e| GitBlameError::Git(e.message().to_string()))?;
    if kind != git2::ObjectType::Blob {
        return Err(GitBlameError::UnsupportedFile(
            "HEAD baseline object is not a blob".to_string(),
        ));
    }
    if size > MAX_BUFFER_CONTENT_BYTES {
        return Err(GitBlameError::TooLarge(format!(
            "HEAD baseline blob size ({size} bytes) exceeds limit of {MAX_BUFFER_CONTENT_BYTES} bytes"
        )));
    }
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| GitBlameError::Git(e.message().to_string()))?;
    if blob.is_binary() || blob.content().contains(&0) {
        return Err(GitBlameError::UnsupportedFile(
            "HEAD baseline blob is binary".to_string(),
        ));
    }
    Ok(())
}

/// Inspects index delta for staged renames relative to HEAD tree.
fn find_staged_rename_origin(
    repo: &git2::Repository,
    head_tree: &git2::Tree,
    target_path: &str,
) -> Result<Option<String>, GitBlameError> {
    let index = repo
        .index()
        .map_err(|e| GitBlameError::Git(format!("failed to open index: {}", e.message())))?;

    let mut diff = repo
        .diff_tree_to_index(Some(head_tree), Some(&index), None)
        .map_err(|e| {
            GitBlameError::Git(format!(
                "failed to create tree-to-index diff: {}",
                e.message()
            ))
        })?;

    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true);
    diff.find_similar(Some(&mut find_opts)).map_err(|e| {
        GitBlameError::Git(format!("failed to find similar in diff: {}", e.message()))
    })?;

    for delta in diff.deltas() {
        if delta.status() == git2::Delta::Renamed {
            if let Some(new_path) = delta.new_file().path() {
                if new_path == Path::new(target_path) {
                    if let Some(old_path) = delta.old_file().path() {
                        return Ok(Some(old_path.to_string_lossy().into_owned()));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Normalizes raw hunks into a continuous, non-overlapping partition spanning 1..=total_lines.
fn partition_and_merge_ranges(
    mut ranges: Vec<GitBlameRange>,
    total_lines: usize,
) -> Vec<GitBlameRange> {
    if total_lines == 0 {
        return Vec::new();
    }

    ranges.sort_by_key(|r| r.start_line);

    let mut merged: Vec<GitBlameRange> = Vec::new();
    let mut current_line = 1;

    for range in ranges {
        if range.start_line > current_line {
            // Gap before this range: fill with uncommitted range.
            let gap_count = range.start_line - current_line;
            if let Some(last) = merged.last_mut() {
                if last.commit_index.is_none() {
                    last.line_count += gap_count;
                } else {
                    merged.push(GitBlameRange {
                        start_line: current_line,
                        line_count: gap_count,
                        commit_index: None,
                    });
                }
            } else {
                merged.push(GitBlameRange {
                    start_line: current_line,
                    line_count: gap_count,
                    commit_index: None,
                });
            }
            current_line = range.start_line;
        }

        if let Some(last) = merged.last_mut() {
            if last.commit_index == range.commit_index
                && last.start_line + last.line_count == range.start_line
            {
                last.line_count += range.line_count;
            } else {
                merged.push(range);
            }
        } else {
            merged.push(range);
        }

        if let Some(last) = merged.last() {
            current_line = last.start_line + last.line_count;
        }
    }

    if current_line <= total_lines {
        let remaining = total_lines - current_line + 1;
        if let Some(last) = merged.last_mut() {
            if last.commit_index.is_none() {
                last.line_count += remaining;
            } else {
                merged.push(GitBlameRange {
                    start_line: current_line,
                    line_count: remaining,
                    commit_index: None,
                });
            }
        } else {
            merged.push(GitBlameRange {
                start_line: 1,
                line_count: total_lines,
                commit_index: None,
            });
        }
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_repo() -> (TempDir, git2::Repository, git2::Oid) {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        let sig = git2::Signature::now("Bob Committer", "bob@example.com").unwrap();
        let file_path = dir.path().join("code.rs");
        std::fs::write(&file_path, "fn main() {\n    println!(\"hello\");\n}\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("code.rs")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();

        let oid = {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                "feat(code): add initial code",
                &tree,
                &[],
            )
            .unwrap()
        };

        (dir, repo, oid)
    }

    #[test]
    fn test_empty_buffer_short_circuit() {
        let (dir, _repo, _oid) = setup_test_repo();
        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "".to_string(),
            snapshot_id: "snap-1".to_string(),
            model_version: 1,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Empty);
        assert_eq!(resp.buffer_line_count, 1);
        assert!(resp.ranges.is_empty());
        assert!(resp.commits.is_empty());
    }

    #[test]
    fn test_crlf_normalization_and_attribution() {
        let (dir, _repo, oid) = setup_test_repo();
        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\r\n    println!(\"hello\");\r\n}\r\n".to_string(),
            snapshot_id: "snap-2".to_string(),
            model_version: 2,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Ready);
        assert_eq!(resp.commits.len(), 1);
        assert_eq!(resp.commits[0].hash, oid.to_string());
        assert_eq!(resp.commits[0].author_name, "Bob Committer");

        // Display lines: 3 code lines + 1 trailing empty row = 4 lines.
        assert_eq!(resp.buffer_line_count, 4);
        assert_eq!(resp.ranges.len(), 2);
        // Lines 1-3 committed
        assert_eq!(resp.ranges[0].start_line, 1);
        assert_eq!(resp.ranges[0].line_count, 3);
        assert_eq!(resp.ranges[0].commit_index, Some(0));
        // Line 4 uncommitted
        assert_eq!(resp.ranges[1].start_line, 4);
        assert_eq!(resp.ranges[1].line_count, 1);
        assert_eq!(resp.ranges[1].commit_index, None);
    }

    #[test]
    fn test_dirty_buffer_modifications() {
        let (dir, _repo, oid) = setup_test_repo();
        // Modify line 2 in buffer
        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"modified\");\n}\n".to_string(),
            snapshot_id: "snap-3".to_string(),
            model_version: 3,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Ready);
        assert_eq!(resp.commits.len(), 1);
        assert_eq!(resp.commits[0].hash, oid.to_string());

        // Line 1: committed (index 0)
        // Line 2: uncommitted (None)
        // Line 3: committed (index 0)
        // Line 4: uncommitted (None)
        assert_eq!(resp.buffer_line_count, 4);
        assert_eq!(resp.ranges.len(), 4);
        assert_eq!(resp.ranges[0].commit_index, Some(0));
        assert_eq!(resp.ranges[1].commit_index, None);
        assert_eq!(resp.ranges[2].commit_index, Some(0));
        assert_eq!(resp.ranges[3].commit_index, None);
    }

    #[test]
    fn test_untracked_new_file() {
        let (dir, _repo, _oid) = setup_test_repo();
        let input = GitBlameInput {
            path: "untracked.rs".to_string(),
            worktree_path: None,
            content: "pub fn foo() {}\n".to_string(),
            snapshot_id: "snap-4".to_string(),
            model_version: 1,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Uncommitted);
        assert_eq!(resp.buffer_line_count, 2);
        assert_eq!(resp.ranges.len(), 1);
        assert_eq!(resp.ranges[0].start_line, 1);
        assert_eq!(resp.ranges[0].line_count, 2);
        assert_eq!(resp.ranges[0].commit_index, None);
        assert!(resp.commits.is_empty());
    }

    #[test]
    fn test_unborn_repository() {
        let dir = TempDir::new().unwrap();
        let _repo = git2::Repository::init(dir.path()).unwrap();

        let input = GitBlameInput {
            path: "new_file.txt".to_string(),
            worktree_path: None,
            content: "line 1\nline 2".to_string(),
            snapshot_id: "snap-5".to_string(),
            model_version: 1,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Uncommitted);
        assert_eq!(resp.base_commit_oid, None);
        assert_eq!(resp.buffer_line_count, 2);
        assert_eq!(resp.ranges.len(), 1);
        assert_eq!(resp.ranges[0].commit_index, None);
    }

    #[test]
    fn test_input_validation_oversize_rejected() {
        let dir = TempDir::new().unwrap();
        let oversized_content = "x".repeat(MAX_BUFFER_CONTENT_BYTES + 1);
        let input = GitBlameInput {
            path: "test.txt".to_string(),
            worktree_path: None,
            content: oversized_content,
            snapshot_id: "snap".to_string(),
            model_version: 1,
        };

        let err = execute_native_blame(dir.path(), &input).unwrap_err();
        match err {
            GitBlameError::TooLarge(msg) => {
                assert!(msg.contains("exceeds limit"));
            }
            _ => panic!("expected TooLarge, got: {err:?}"),
        }
    }

    #[test]
    fn test_input_validation_binary_rejected() {
        let dir = TempDir::new().unwrap();
        let input = GitBlameInput {
            path: "test.txt".to_string(),
            worktree_path: None,
            content: "hello\0world".to_string(),
            snapshot_id: "snap".to_string(),
            model_version: 1,
        };

        let err = execute_native_blame(dir.path(), &input).unwrap_err();
        match err {
            GitBlameError::UnsupportedFile(msg) => {
                assert!(msg.contains("binary/NUL"));
            }
            _ => panic!("expected UnsupportedFile, got: {err:?}"),
        }
    }

    #[test]
    fn test_input_validation_traversal_rejected() {
        let dir = TempDir::new().unwrap();
        let input = GitBlameInput {
            path: "../secret.txt".to_string(),
            worktree_path: None,
            content: "content".to_string(),
            snapshot_id: "snap".to_string(),
            model_version: 1,
        };

        let err = execute_native_blame(dir.path(), &input).unwrap_err();
        match err {
            GitBlameError::InvalidInput(msg) => {
                assert!(msg.contains("parent directory traversal"));
            }
            _ => panic!("expected InvalidInput, got: {err:?}"),
        }
    }

    #[test]
    fn test_staged_rename() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        let sig = git2::Signature::now("Carol", "carol@example.com").unwrap();
        let file_path = dir.path().join("original.txt");
        std::fs::write(&file_path, "important logic\nsecond line\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("original.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();

        let commit_oid = {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "feat: initial file", &tree, &[])
                .unwrap()
        };

        // Stage a rename: remove original.txt from index, write renamed.txt and add to index
        std::fs::remove_file(&file_path).unwrap();
        index.remove_path(Path::new("original.txt")).unwrap();
        let renamed_path = dir.path().join("renamed.txt");
        std::fs::write(&renamed_path, "important logic\nsecond line\n").unwrap();
        index.add_path(Path::new("renamed.txt")).unwrap();
        index.write().unwrap();

        let input = GitBlameInput {
            path: "renamed.txt".to_string(),
            worktree_path: None,
            content: "important logic\nsecond line\n".to_string(),
            snapshot_id: "snap-rename".to_string(),
            model_version: 1,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Ready);
        assert_eq!(resp.commits.len(), 1);
        assert_eq!(resp.commits[0].hash, commit_oid.to_string());
        assert_eq!(resp.commits[0].author_name, "Carol");
        assert_eq!(resp.ranges.len(), 2);
        assert_eq!(resp.ranges[0].commit_index, Some(0));
    }

    #[test]
    fn test_dirty_buffer_deletion() {
        let (dir, _repo, oid) = setup_test_repo();
        // Original was:
        // line 1: fn main() {
        // line 2:     println!("hello");
        // line 3: }
        // Delete line 2, buffer has only lines 1 and 3:
        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n}\n".to_string(),
            snapshot_id: "snap-del".to_string(),
            model_version: 4,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Ready);
        assert_eq!(resp.commits.len(), 1);
        assert_eq!(resp.commits[0].hash, oid.to_string());
        // Lines 1 and 2 of new buffer are from initial commit (old lines 1 and 3)
        assert_eq!(resp.ranges[0].start_line, 1);
        assert_eq!(resp.ranges[0].line_count, 2);
        assert_eq!(resp.ranges[0].commit_index, Some(0));
        // Trailing empty row
        assert_eq!(resp.ranges[1].start_line, 3);
        assert_eq!(resp.ranges[1].commit_index, None);
    }

    #[test]
    fn test_nested_repository_blame() {
        let dir = TempDir::new().unwrap();
        let _parent_repo = git2::Repository::init(dir.path()).unwrap();

        // Create a nested repository inside "nested/sub"
        let nested_dir = dir.path().join("nested/sub");
        std::fs::create_dir_all(&nested_dir).unwrap();
        let nested_repo = git2::Repository::init(&nested_dir).unwrap();

        let sig = git2::Signature::now("Dan", "dan@example.com").unwrap();
        let file_path = nested_dir.join("sub_code.rs");
        std::fs::write(&file_path, "sub repo code\n").unwrap();

        let mut index = nested_repo.index().unwrap();
        index.add_path(Path::new("sub_code.rs")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let nested_oid = {
            let tree = nested_repo.find_tree(tree_id).unwrap();
            nested_repo
                .commit(Some("HEAD"), &sig, &sig, "feat: nested commit", &tree, &[])
                .unwrap()
        };

        let input = GitBlameInput {
            path: "nested/sub/sub_code.rs".to_string(),
            worktree_path: None,
            content: "sub repo code\n".to_string(),
            snapshot_id: "snap-nested".to_string(),
            model_version: 1,
        };

        let resp = execute_native_blame(dir.path(), &input).unwrap();
        assert_eq!(resp.status, GitBlameStatus::Ready);
        assert_eq!(resp.root_id, "nested/sub");
        assert_eq!(resp.root_relative_path, "sub_code.rs");
        assert_eq!(resp.commits[0].hash, nested_oid.to_string());
        assert_eq!(resp.commits[0].author_name, "Dan");
    }

    #[test]
    fn lone_cr_buffer_preserves_committed_lines() {
        let (dir, _repo, oid) = setup_test_repo();
        let response = execute_native_blame(
            dir.path(),
            &GitBlameInput {
                path: "code.rs".to_string(),
                worktree_path: None,
                content: "fn main() {\r    println!(\"hello\");\r}\r".to_string(),
                snapshot_id: "lone-cr".to_string(),
                model_version: 1,
            },
        )
        .unwrap();
        assert_eq!(response.buffer_line_count, 4);
        assert_eq!(response.ranges[0].line_count, 3);
        assert_eq!(response.ranges[0].commit_index, Some(0));
        assert_eq!(response.commits[0].hash, oid.to_string());
        assert_eq!(response.ranges[1].commit_index, None);
    }

    #[test]
    fn mixed_line_endings_preserve_boundaries_and_unicode() {
        let (content, rows) = normalize_buffer_content("α\rβ\r\nγ\nδ\r");
        assert_eq!(content, "α\nβ\nγ\nδ\n");
        assert_eq!(rows, 5);
        assert_eq!(normalize_buffer_content(""), (String::new(), 1));
    }

    #[test]
    fn head_publication_guard_rejects_unborn_to_committed_and_head_removal() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let unborn = read_head_oid(&repo).unwrap();
        assert_eq!(unborn, None);
        let tree_oid = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Guard", "guard@example.com").unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        assert!(matches!(
            ensure_head_unchanged(&repo, unborn),
            Err(GitBlameError::StaleRevision)
        ));
        ensure_head_unchanged(&repo, Some(oid)).unwrap();
        let next = repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "next",
                &tree,
                &[&repo.find_commit(oid).unwrap()],
            )
            .unwrap();
        assert!(matches!(
            ensure_head_unchanged(&repo, Some(oid)),
            Err(GitBlameError::StaleRevision)
        ));
        repo.head().unwrap().delete().unwrap();
        assert!(matches!(
            ensure_head_unchanged(&repo, Some(next)),
            Err(GitBlameError::StaleRevision)
        ));
    }
}
