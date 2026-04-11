/// Git diff, staging, discard, and conflict resolution operations.
///
/// All path arguments are relative to the project root and validated against
/// the project root before any filesystem access (no path traversal).
/// git2::Repository is !Sync — a new handle is opened per call.
use std::path::{Path, PathBuf};

use git2::{DiffOptions, Repository};

use crate::error::AppError;
use crate::git::types::{ConflictFile, DiffFileEntry, FileDiffContent, HunkInfo};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn open_repo(path: &Path) -> Result<Repository, AppError> {
    Repository::open(path).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            AppError::GitNotFound(path.to_string_lossy().into_owned())
        } else {
            AppError::Git(e.message().to_string())
        }
    })
}

/// Validate a user-supplied relative path and resolve it against `base`.
/// Rejects `..` components and absolute paths.
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, AppError> {
    if rel.is_empty() || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(AppError::InvalidInput(format!("invalid path: {rel}")));
    }
    let candidate = Path::new(rel);
    if candidate.components().any(|c| c == std::path::Component::ParentDir) {
        return Err(AppError::InvalidInput(format!("path traversal rejected: {rel}")));
    }
    Ok(base.join(rel))
}

fn delta_status_str(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "copied",
        git2::Delta::Conflicted => "conflicted",
        _ => "unknown",
    }
}

fn detect_language(path: &str) -> String {
    let p = Path::new(path);
    // Check extensionless filenames first (Dockerfile, Makefile, etc.)
    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
        match name.to_lowercase().as_str() {
            "dockerfile" => return "dockerfile".to_string(),
            "makefile" | "gnumakefile" => return "makefile".to_string(),
            "jenkinsfile" => return "groovy".to_string(),
            _ => {}
        }
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    match ext.to_lowercase().as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "py" | "pyw" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "cpp",
        "cs" => "csharp",
        "json" | "jsonc" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "less" => "less",
        "sh" | "bash" | "zsh" | "fish" => "shell",
        "sql" => "sql",
        "xml" | "svg" => "xml",
        "dart" => "dart",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "lua" => "lua",
        "r" | "rmd" => "r",
        "ex" | "exs" => "elixir",
        "erl" | "hrl" => "erlang",
        "hs" => "haskell",
        "vim" => "vim",
        "dockerfile" => "dockerfile",
        "tf" | "tfvars" => "terraform",
        _ => "plaintext",
    }
    .to_string()
}

fn is_binary_content(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

/// Read the blob for `rel_path` at HEAD. Returns `None` if file is new (no HEAD blob).
fn read_head_blob(repo: &Repository, rel_path: &str) -> Result<Option<Vec<u8>>, AppError> {
    let head_tree = match repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
        Some(t) => t,
        None => return Ok(None),
    };
    match head_tree.get_path(Path::new(rel_path)) {
        Ok(entry) => {
            let blob = repo
                .find_blob(entry.id())
                .map_err(|e| AppError::Git(e.message().to_string()))?;
            Ok(Some(blob.content().to_vec()))
        }
        Err(_) => Ok(None),
    }
}

/// Build hunks from a git2 Patch.
fn extract_hunks(patch: &git2::Patch) -> Result<Vec<HunkInfo>, AppError> {
    let mut hunks = Vec::new();
    for i in 0..patch.num_hunks() {
        let (hunk, _) = patch
            .hunk(i)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        hunks.push(HunkInfo {
            index: i,
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            header: String::from_utf8_lossy(hunk.header()).trim_end().to_string(),
        });
    }
    Ok(hunks)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// List all changed files (staged + unstaged + untracked).
///
/// A file modified both staged and unstaged appears twice — once with
/// `staged: true` (index vs HEAD), once with `staged: false` (workdir vs index).
/// Untracked files appear with `status: "added"` and `staged: false`.
pub fn get_diff_files(project_path: &Path) -> Result<Vec<DiffFileEntry>, AppError> {
    let repo = open_repo(project_path)?;
    let mut entries: Vec<DiffFileEntry> = Vec::new();

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let mut opts = DiffOptions::new();
    opts.include_untracked(false);

    // Staged: HEAD → index
    let staged_diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    collect_diff_entries(&staged_diff, true, &mut entries)?;

    // Unstaged: index → workdir (tracked files only)
    let unstaged_diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    collect_diff_entries(&unstaged_diff, false, &mut entries)?;

    // Untracked files (not yet `git add`ed, not ignored)
    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut status_opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    for entry in statuses.iter() {
        if entry.status().contains(git2::Status::WT_NEW) {
            if let Some(path) = entry.path() {
                entries.push(DiffFileEntry {
                    path: path.to_string(),
                    status: "added".to_string(),
                    staged: false,
                    additions: 0,
                    deletions: 0,
                    old_path: None,
                });
            }
        }
    }

    Ok(entries)
}

fn collect_diff_entries(
    diff: &git2::Diff,
    staged: bool,
    out: &mut Vec<DiffFileEntry>,
) -> Result<(), AppError> {
    for i in 0..diff.deltas().count() {
        let delta = diff
            .get_delta(i)
            .ok_or_else(|| AppError::Git("delta index out of range".to_string()))?;

        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();

        let old_path = if staged && delta.status() == git2::Delta::Renamed {
            delta
                .old_file()
                .path()
                .and_then(|p| p.to_str())
                .map(|s| s.to_string())
        } else {
            None
        };

        let (adds, dels) = match git2::Patch::from_diff(diff, i)
            .map_err(|e| AppError::Git(e.message().to_string()))?
        {
            Some(patch) => {
                let (_, a, d) = patch
                    .line_stats()
                    .map_err(|e| AppError::Git(e.message().to_string()))?;
                (a, d)
            }
            None => (0, 0), // binary
        };

        out.push(DiffFileEntry {
            path,
            status: delta_status_str(delta.status()).to_string(),
            staged,
            additions: adds,
            deletions: dels,
            old_path,
        });
    }
    Ok(())
}

/// Return HEAD blob (original) + workdir content (modified) for Monaco DiffEditor.
///
/// Note: for renamed files, `rel_path` is the new name. HEAD contains the old
/// name's blob — `original` will be None for renames. TODO: thread old_path
/// from get_diff_files through the caller to correctly show original content.
///
/// Note: HEAD blob read and workdir read are separate ops — a concurrent write
/// between them may produce a stale diff. Acceptable for a local dev tool.
pub fn get_file_diff(project_path: &Path, rel_path: &str) -> Result<FileDiffContent, AppError> {
    safe_join(project_path, rel_path)?; // validate only, don't use result here

    let repo = open_repo(project_path)?;

    // Original: HEAD blob
    let original_bytes = read_head_blob(&repo, rel_path)?;
    let is_binary_original = original_bytes
        .as_deref()
        .map(is_binary_content)
        .unwrap_or(false);

    // Modified: workdir
    let abs_path = project_path.join(rel_path);
    let modified_bytes = if abs_path.exists() {
        Some(std::fs::read(&abs_path).map_err(AppError::Io)?)
    } else {
        None
    };
    let is_binary_modified = modified_bytes
        .as_deref()
        .map(is_binary_content)
        .unwrap_or(false);

    let is_binary = is_binary_original || is_binary_modified;

    if is_binary {
        return Ok(FileDiffContent {
            path: rel_path.to_string(),
            original: None,
            modified: None,
            language: detect_language(rel_path),
            hunks: vec![],
            is_binary: true,
        });
    }

    let original = original_bytes
        .map(|b| String::from_utf8_lossy(&b).into_owned());
    let modified = modified_bytes
        .map(|b| String::from_utf8_lossy(&b).into_owned());

    // Compute hunks from workdir diff
    let hunks = compute_hunks_for_file(&repo, rel_path)?;

    Ok(FileDiffContent {
        path: rel_path.to_string(),
        original,
        modified,
        language: detect_language(rel_path),
        hunks,
        is_binary: false,
    })
}

/// Compute hunks using HEAD→workdir diff (consistent with get_file_diff's original/modified view).
///
/// Uses diff_tree_to_workdir_with_index so hunk indices match what the client
/// sees in Monaco DiffEditor, even when some changes are staged.
fn compute_hunks_for_file(repo: &Repository, rel_path: &str) -> Result<Vec<HunkInfo>, AppError> {
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(rel_path);

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    if diff.deltas().count() == 0 {
        return Ok(vec![]);
    }

    if let Some(patch) = git2::Patch::from_diff(&diff, 0)
        .map_err(|e| AppError::Git(e.message().to_string()))?
    {
        return extract_hunks(&patch);
    }

    Ok(vec![])
}

/// Stage files into the index.
///
/// For deleted files (no longer on disk), stages the deletion via `remove_path`.
/// For all other files, stages content via `add_path`.
pub fn stage_files(project_path: &Path, paths: &[&str]) -> Result<(), AppError> {
    for rel in paths {
        safe_join(project_path, rel)?;
    }
    let repo = open_repo(project_path)?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    for rel in paths {
        let abs_path = project_path.join(rel);
        if abs_path.exists() {
            index
                .add_path(Path::new(rel))
                .map_err(|e| AppError::Git(format!("stage {rel}: {}", e.message())))?;
        } else {
            // File was deleted from the working tree — stage the deletion.
            index
                .remove_path(Path::new(rel))
                .map_err(|e| AppError::Git(format!("stage deletion {rel}: {}", e.message())))?;
        }
    }
    index
        .write()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(())
}

/// Unstage files — reset index to HEAD for the given paths.
pub fn unstage_files(project_path: &Path, paths: &[&str]) -> Result<(), AppError> {
    for rel in paths {
        safe_join(project_path, rel)?;
    }
    let repo = open_repo(project_path)?;

    let head_commit = match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
        Some(c) => c,
        None => {
            // No HEAD (initial repo) — remove paths from index directly
            let mut index = repo
                .index()
                .map_err(|e| AppError::Git(e.message().to_string()))?;
            for rel in paths {
                let _ = index.remove_path(Path::new(rel));
            }
            return index
                .write()
                .map_err(|e| AppError::Git(e.message().to_string()));
        }
    };

    // reset_default requires a commit object (not a tree)
    repo.reset_default(Some(head_commit.as_object()), paths.iter().map(Path::new))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(())
}

/// Discard all workdir changes to a file — restore to HEAD.
pub fn discard_file(project_path: &Path, rel_path: &str) -> Result<(), AppError> {
    safe_join(project_path, rel_path)?;
    let repo = open_repo(project_path)?;

    let mut cb = git2::build::CheckoutBuilder::new();
    cb.path(rel_path).force();
    repo.checkout_head(Some(&mut cb))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(())
}

/// Discard a specific hunk in a file via content manipulation.
///
/// Uses HEAD→workdir diff (same as get_file_diff) so hunk_index from the
/// client's Monaco DiffEditor matches exactly. Preserves the file's original
/// line endings (LF or CRLF).
///
/// Note: symlinks within the repo could potentially redirect writes outside
/// the project root. This is acceptable for a local dev tool with bearer-token
/// auth — the user already has filesystem access. Canonical path validation
/// would require the file to exist (chicken-and-egg for new files).
///
/// Note: for renamed files, this reverts using the new path's HEAD blob. If
/// the rename is detected, the old blob should be used — tracked as a TODO.
pub fn discard_hunk(
    project_path: &Path,
    rel_path: &str,
    hunk_index: usize,
) -> Result<(), AppError> {
    let abs_path = safe_join(project_path, rel_path)?;
    let repo = open_repo(project_path)?;

    // HEAD blob
    let original_bytes = read_head_blob(&repo, rel_path)?
        .ok_or_else(|| AppError::Git(format!("no HEAD blob for {rel_path}")))?;
    if is_binary_content(&original_bytes) {
        return Err(AppError::InvalidInput("binary file — cannot discard hunk".to_string()));
    }
    let original_content = String::from_utf8_lossy(&original_bytes).into_owned();

    // Workdir
    let modified_bytes = std::fs::read(&abs_path).map_err(AppError::Io)?;
    if is_binary_content(&modified_bytes) {
        return Err(AppError::InvalidInput("binary file — cannot discard hunk".to_string()));
    }
    let modified_content = String::from_utf8_lossy(&modified_bytes).into_owned();

    // Detect line ending from modified file; preserve it in the output
    let line_ending = if modified_content.contains("\r\n") { "\r\n" } else { "\n" };

    // Use HEAD→workdir diff — same view as get_file_diff — so hunk indices match
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(rel_path);
    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    if diff.deltas().count() == 0 {
        return Ok(());
    }

    let patch = git2::Patch::from_diff(&diff, 0)
        .map_err(|e| AppError::Git(e.message().to_string()))?
        .ok_or_else(|| AppError::Git("binary patch".to_string()))?;

    if hunk_index >= patch.num_hunks() {
        return Err(AppError::InvalidInput(format!(
            "hunk index {hunk_index} out of range ({})",
            patch.num_hunks()
        )));
    }

    let (hunk, _) = patch
        .hunk(hunk_index)
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    // Normalize to LF for manipulation, then re-apply detected line ending
    let orig_lines: Vec<&str> = original_content
        .split('\n')
        .map(|l| l.trim_end_matches('\r'))
        .collect();
    let mod_lines: Vec<&str> = modified_content
        .split('\n')
        .map(|l| l.trim_end_matches('\r'))
        .collect();

    let new_start = hunk.new_start() as usize;
    let new_count = hunk.new_lines() as usize;
    let old_start = hunk.old_start() as usize;
    let old_count = hunk.old_lines() as usize;

    // git2 line numbers are 1-based; convert to 0-based indices
    let new_start_idx = new_start.saturating_sub(1);
    let new_end_idx = (new_start_idx + new_count).min(mod_lines.len());
    let old_start_idx = old_start.saturating_sub(1);
    let old_end_idx = (old_start_idx + old_count).min(orig_lines.len());

    let mut result: Vec<&str> = Vec::with_capacity(mod_lines.len());
    result.extend_from_slice(&mod_lines[..new_start_idx]);
    if old_count > 0 {
        result.extend_from_slice(&orig_lines[old_start_idx..old_end_idx]);
    }
    result.extend_from_slice(&mod_lines[new_end_idx..]);

    let new_content = result.join(line_ending);
    std::fs::write(&abs_path, new_content).map_err(AppError::Io)?;
    Ok(())
}

/// List all conflicted files with ancestor/ours/theirs content.
pub fn get_conflicts(project_path: &Path) -> Result<Vec<ConflictFile>, AppError> {
    let repo = open_repo(project_path)?;
    let index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    if !index.has_conflicts() {
        return Ok(vec![]);
    }

    let mut conflicts: Vec<ConflictFile> = Vec::new();

    for conflict_result in index
        .conflicts()
        .map_err(|e| AppError::Git(e.message().to_string()))?
    {
        let conflict = conflict_result.map_err(|e| AppError::Git(e.message().to_string()))?;

        let path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .and_then(|e| std::str::from_utf8(&e.path).ok().map(|s| s.to_string()))
            .unwrap_or_default();

        let ancestor = conflict
            .ancestor
            .as_ref()
            .and_then(|e| read_blob_utf8(&repo, e.id))
            .flatten();
        let ours = conflict
            .our
            .as_ref()
            .and_then(|e| read_blob_utf8(&repo, e.id))
            .flatten();
        let theirs = conflict
            .their
            .as_ref()
            .and_then(|e| read_blob_utf8(&repo, e.id))
            .flatten();

        conflicts.push(ConflictFile { path, ancestor, ours, theirs });
    }

    Ok(conflicts)
}

fn read_blob_utf8(repo: &Repository, oid: git2::Oid) -> Option<Option<String>> {
    if oid.is_zero() {
        return Some(None);
    }
    match repo.find_blob(oid) {
        Ok(blob) => {
            if is_binary_content(blob.content()) {
                Some(None)
            } else {
                Some(Some(String::from_utf8_lossy(blob.content()).into_owned()))
            }
        }
        Err(_) => None,
    }
}

/// Write resolved content and stage the file, clearing the conflict.
pub fn resolve_conflict(
    project_path: &Path,
    rel_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let abs_path = safe_join(project_path, rel_path)?;
    std::fs::write(&abs_path, content).map_err(AppError::Io)?;

    let repo = open_repo(project_path)?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    index
        .add_path(Path::new(rel_path))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    index
        .write()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(())
}

/// Create a commit from the current index with the given message.
/// Returns the new commit's hash as a hex string.
pub fn commit_files(project_path: &Path, message: &str) -> Result<String, AppError> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("commit message cannot be empty".into()));
    }
    let repo = open_repo(project_path)?;
    let sig = repo.signature().map_err(|e| {
        AppError::Git(format!(
            "git user not configured (set user.name and user.email): {}",
            e.message()
        ))
    })?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let tree_id = index
        .write_tree()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let parents: Vec<git2::Commit> = match repo.head() {
        Ok(head) => vec![head
            .peel_to_commit()
            .map_err(|e| AppError::Git(e.message().to_string()))?],
        Err(_) => vec![],
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, trimmed, &tree, &parent_refs)
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(oid.to_string())
}
