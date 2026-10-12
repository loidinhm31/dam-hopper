use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::Arc;

use crate::error::GitBlameError;
use crate::git::blame_cache::{
    BlameBaseline, BlameBaselineCache, CacheKey, HistoricalBlameSpan,
};
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
    cache: &BlameBaselineCache,
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

    let (baseline, is_cache_miss, cache_key) = match baseline_path {
        None => {
            // Case 3: File does not exist at HEAD and is not a staged rename (untracked or brand new file).
            ensure_head_unchanged(&repo, initial_head_oid)?;
            let status = if input.content.is_empty() {
                GitBlameStatus::Empty
            } else {
                GitBlameStatus::Uncommitted
            };
            return Ok(GitBlameResponse {
                snapshot_id: input.snapshot_id.clone(),
                model_version: input.model_version,
                root_id: resolved_root.root_id,
                root_relative_path: repo_relative_path,
                base_commit_oid: Some(head_oid.to_string()),
                buffer_line_count: if input.content.is_empty() { 1 } else { buffer_line_count },
                status,
                ranges: if input.content.is_empty() {
                    Vec::new()
                } else {
                    vec![GitBlameRange {
                        start_line: 1,
                        line_count: buffer_line_count,
                        commit_index: None,
                    }]
                },
                commits: Vec::new(),
            });
        }
        Some(blame_baseline_path) => {
            // Validate HEAD baseline tree entry before cache lookup.
            let entry = head_tree
                .get_path(Path::new(blame_baseline_path.as_ref()))
                .map_err(|e| {
                    GitBlameError::Git(format!("failed to resolve HEAD baseline: {}", e.message()))
                })?;
            let head_blob_oid = validate_baseline_tree_entry(&repo, &entry)?;

            let is_shallow = repo.is_shallow();

            let cache_key = if !is_shallow {
                let repository_identity = dunce::canonicalize(&resolved_root.root_path)
                    .unwrap_or_else(|_| resolved_root.root_path.clone());
                Some(CacheKey {
                    repository_identity,
                    root_id: resolved_root.root_id.clone(),
                    head_oid,
                    committed_baseline_path: blame_baseline_path.to_string(),
                })
            } else {
                None
            };

            // Check cache if not shallow.
            let cached_baseline = if let Some(key) = &cache_key {
                cache.get(key).filter(|c| c.blob_oid == head_blob_oid)
            } else {
                None
            };

            // If not cached, load blob and verify it is not binary before empty check.
            let preloaded_blob = if cached_baseline.is_none() {
                let blob = repo
                    .find_blob(head_blob_oid)
                    .map_err(|e| GitBlameError::Git(e.message().to_string()))?;
                if blob.is_binary() || blob.content().contains(&0) {
                    return Err(GitBlameError::UnsupportedFile(
                        "HEAD baseline blob is binary".to_string(),
                    ));
                }
                Some(blob)
            } else {
                None
            };

            // Case 2: Empty buffer short-circuit.
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

            if let Some(cached) = cached_baseline {
                (cached, false, cache_key)
            } else if is_shallow {
                // Shallow repository bypass: uncached, never inserted into cache.
                let fresh = load_historical_baseline(
                    &repo,
                    head_oid,
                    blame_baseline_path.as_ref(),
                    head_blob_oid,
                    preloaded_blob,
                )?;
                (fresh, false, cache_key)
            } else {
                let fresh = load_historical_baseline(
                    &repo,
                    head_oid,
                    blame_baseline_path.as_ref(),
                    head_blob_oid,
                    preloaded_blob,
                )?;
                (fresh, true, cache_key)
            }
        }
    };

    let mut commits: Vec<GitBlameCommit> = Vec::new();
    let mut commit_map: HashMap<git2::Oid, usize> = HashMap::new();
    let mut raw_ranges: Vec<GitBlameRange> = Vec::new();

    let odb = repo
        .odb()
        .map_err(|e| GitBlameError::Git(format!("failed to open ODB: {}", e.message())))?;

    visit_projected_blame_spans(
        &baseline,
        normalized_content.as_bytes(),
        |start_line, lines_in_hunk, final_commit_id| {
            if lines_in_hunk == 0 {
                return Ok(());
            }

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
            Ok(())
        },
    )?;

    // Fill Monaco display rows: if trailing newline, add terminal uncommitted row.
    let mut partitioned_ranges = partition_and_merge_ranges(raw_ranges, buffer_line_count);

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

    // Insert into cache only after HEAD stability check succeeds on cache miss.
    if is_cache_miss {
        if let Some(key) = cache_key {
            cache.insert(key, baseline);
        }
    }

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

fn validate_baseline_tree_entry(
    repo: &git2::Repository,
    entry: &git2::TreeEntry<'_>,
) -> Result<git2::Oid, GitBlameError> {
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
    Ok(entry.id())
}

/// Normalizes committed baseline bytes by stripping CR before LF.
/// Lone CR and real whitespace are preserved.
pub fn normalize_committed_baseline(baseline: &[u8]) -> (Vec<u8>, usize) {
    if baseline.is_empty() {
        return (Vec::new(), 0);
    }
    let mut normalized = Vec::with_capacity(baseline.len());
    let mut lines = usize::from(!baseline.ends_with(b"\n"));
    for (index, &byte) in baseline.iter().enumerate() {
        if byte != b'\r' || baseline.get(index + 1) != Some(&b'\n') {
            normalized.push(byte);
        }
        if byte == b'\n' {
            lines += 1;
        }
    }
    (normalized, lines)
}

#[cfg(test)]
thread_local! {
    pub(crate) static TEST_HISTORICAL_LOAD_COUNT: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);
}
fn load_historical_baseline(
    repo: &git2::Repository,
    head_oid: git2::Oid,
    baseline_path: &str,
    head_blob_oid: git2::Oid,
    preloaded_blob: Option<git2::Blob<'_>>,
) -> Result<Arc<BlameBaseline>, GitBlameError> {
    #[cfg(test)]
    TEST_HISTORICAL_LOAD_COUNT.with(|c| c.fetch_add(1, std::sync::atomic::Ordering::SeqCst));
    let blob = match preloaded_blob {
        Some(b) => b,
        None => {
            let b = repo
                .find_blob(head_blob_oid)
                .map_err(|e| GitBlameError::Git(e.message().to_string()))?;
            if b.is_binary() || b.content().contains(&0) {
                return Err(GitBlameError::UnsupportedFile(
                    "HEAD baseline blob is binary".to_string(),
                ));
            }
            b
        }
    };

    let (normalized_bytes, line_count) = normalize_committed_baseline(blob.content());

    let mut blame_opts = git2::BlameOptions::new();
    blame_opts.newest_commit(head_oid);
    let blame = repo
        .blame_file(Path::new(baseline_path), Some(&mut blame_opts))
        .map_err(|e| GitBlameError::Git(format!("failed to blame file: {}", e.message())))?;

    let mut spans = Vec::with_capacity(blame.len());
    for hunk in blame.iter() {
        spans.push(HistoricalBlameSpan {
            start_line: hunk.final_start_line(),
            line_count: hunk.lines_in_hunk(),
            final_commit_oid: hunk.final_commit_id(),
        });
    }
    spans.sort_by_key(|s| s.start_line);

    Ok(Arc::new(BlameBaseline::new(
        normalized_bytes,
        spans,
        line_count,
        head_blob_oid,
    )))
}

fn visit_projected_blame_spans(
    baseline: &BlameBaseline,
    buffer: &[u8],
    mut visit: impl FnMut(usize, usize, git2::Oid) -> Result<(), GitBlameError>,
) -> Result<(), GitBlameError> {
    // Fast path: buffer matches normalized baseline exactly.
    if buffer == baseline.bytes.as_slice() {
        for span in &baseline.spans {
            visit(span.start_line, span.line_count, span.final_commit_oid)?;
         }
        return Ok(());
    }

    let mut options = git2::DiffOptions::new();
    options.context_lines(0);
    let patch = git2::Patch::from_buffers(
        &baseline.bytes,
        None,
        buffer,
        None,
        Some(&mut options),
    )
    .map_err(|e| {
        GitBlameError::Git(format!("failed to compare blame buffer: {}", e.message()))
    })?;

    let mut old_line = 1;
    let mut new_line = 1;
    let mut span_cursor = 0;

    for index in 0..patch.num_hunks() {
        let (hunk, _) = patch.hunk(index).map_err(|e| {
            GitBlameError::Git(format!("failed to read buffer diff: {}", e.message()))
        })?;
        let old_start = hunk.old_start() as usize + usize::from(hunk.old_lines() == 0);
        let new_start = hunk.new_start() as usize + usize::from(hunk.new_lines() == 0);

        if old_start > old_line {
            visit_unchanged_spans(
                &baseline.spans,
                &mut span_cursor,
                old_line,
                new_line,
                old_start - old_line,
                &mut visit,
            )?;
        }
        if hunk.new_lines() > 0 {
            visit(new_start, hunk.new_lines() as usize, git2::Oid::zero())?;
        }
        old_line = old_start + hunk.old_lines() as usize;
        new_line = new_start + hunk.new_lines() as usize;
    }

    if baseline.line_count + 1 > old_line {
        visit_unchanged_spans(
            &baseline.spans,
            &mut span_cursor,
            old_line,
            new_line,
            baseline.line_count + 1 - old_line,
            &mut visit,
        )?;
    }
    Ok(())
}

fn visit_unchanged_spans(
    spans: &[HistoricalBlameSpan],
    span_cursor: &mut usize,
    mut old_line: usize,
    mut new_line: usize,
    mut count: usize,
    visit: &mut impl FnMut(usize, usize, git2::Oid) -> Result<(), GitBlameError>,
) -> Result<(), GitBlameError> {
    while count > 0 {
        while *span_cursor < spans.len()
            && spans[*span_cursor].start_line + spans[*span_cursor].line_count <= old_line
        {
            *span_cursor += 1;
        }

        let span = if *span_cursor < spans.len() && spans[*span_cursor].start_line <= old_line {
            &spans[*span_cursor]
        } else {
            match spans.binary_search_by(|s| {
                if old_line < s.start_line {
                    std::cmp::Ordering::Greater
                } else if old_line >= s.start_line + s.line_count {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            }) {
                Ok(idx) => {
                    *span_cursor = idx;
                    &spans[idx]
                }
                Err(_) => {
                    return Err(GitBlameError::Git(
                        "missing HEAD blame hunk for unchanged line".to_string(),
                    ));
                }
            }
        };

        let length = count.min(span.start_line + span.line_count - old_line);
        visit(new_line, length, span.final_commit_oid)?;
        old_line += length;
        new_line += length;
        count -= length;
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let err = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap_err();
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

        let err = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap_err();
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

        let err = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap_err();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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

        let resp = execute_native_blame(dir.path(), &input, &BlameBaselineCache::new()).unwrap();
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
            &BlameBaselineCache::new(),
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
    fn execute_uncached_legacy_blame(
        project_path: &Path,
        input: &GitBlameInput,
    ) -> Result<GitBlameResponse, GitBlameError> {
        validate_blame_input(input)?;

        let (normalized_content, buffer_line_count) = normalize_buffer_content(&input.content);

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

        let initial_head_oid = read_head_oid(&repo)?;

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

        let baseline_path = match head_tree.get_path(Path::new(&repo_relative_path)) {
            Ok(_) => Some(Cow::Borrowed(repo_relative_path.as_str())),
            Err(e) if e.code() == git2::ErrorCode::NotFound => {
                find_staged_rename_origin(&repo, &head_tree, &repo_relative_path)?.map(Cow::Owned)
            }
            Err(e) => return Err(GitBlameError::Git(e.message().to_string())),
        };

        let baseline_blob = if let Some(path) = baseline_path.as_deref() {
            let entry = head_tree.get_path(Path::new(path)).map_err(|e| {
                GitBlameError::Git(format!("failed to resolve HEAD baseline: {}", e.message()))
            })?;
            Some(validate_legacy_blob(&repo, &entry)?)
        } else {
            None
        };

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

        let mut blame_opts = git2::BlameOptions::new();
        blame_opts.newest_commit(head_oid);
        let blame = repo
            .blame_file(
                Path::new(blame_baseline_path.as_ref()),
                Some(&mut blame_opts),
            )
            .map_err(|e| GitBlameError::Git(format!("failed to blame file: {}", e.message())))?;

        let mut commits: Vec<GitBlameCommit> = Vec::new();
        let mut commit_map: HashMap<git2::Oid, usize> = HashMap::new();
        let mut raw_ranges: Vec<GitBlameRange> = Vec::new();

        let odb = repo
            .odb()
            .map_err(|e| GitBlameError::Git(format!("failed to open ODB: {}", e.message())))?;

        visit_legacy_buffer_blame_hunks(
            &blame,
            baseline_blob.as_ref().expect("baseline blob").content(),
            normalized_content.as_bytes(),
            |start_line, lines_in_hunk, final_commit_id| {
                if lines_in_hunk == 0 {
                    return Ok(());
                }

                let commit_index = if final_commit_id.is_zero() {
                    None
                } else if let Some(&idx) = commit_map.get(&final_commit_id) {
                    Some(idx)
                } else {
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
                Ok(())
            },
        )?;

        let mut partitioned_ranges = partition_and_merge_ranges(raw_ranges, buffer_line_count);

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

    fn visit_legacy_buffer_blame_hunks(
        blame: &git2::Blame<'_>,
        baseline: &[u8],
        buffer: &[u8],
        mut visit: impl FnMut(usize, usize, git2::Oid) -> Result<(), GitBlameError>,
    ) -> Result<(), GitBlameError> {
        if !baseline.windows(2).any(|pair| pair == b"\r\n") {
            let buffer_blame = blame
                .blame_buffer(buffer)
                .map_err(|e| GitBlameError::Git(format!("failed to blame buffer: {}", e.message())))?;
            for hunk in buffer_blame.iter() {
                visit(
                    hunk.final_start_line(),
                    hunk.lines_in_hunk(),
                    hunk.final_commit_id(),
                )?;
            }
            return Ok(());
        }

        let mut normalized_baseline = Vec::with_capacity(baseline.len());
        let mut baseline_lines = usize::from(!baseline.ends_with(b"\n"));
        for (index, &byte) in baseline.iter().enumerate() {
            if byte != b'\r' || baseline.get(index + 1) != Some(&b'\n') {
                normalized_baseline.push(byte);
            }
            if byte == b'\n' {
                baseline_lines += 1;
            }
        }
        let mut options = git2::DiffOptions::new();
        options.context_lines(0);
        let patch =
            git2::Patch::from_buffers(&normalized_baseline, None, buffer, None, Some(&mut options))
                .map_err(|e| {
                    GitBlameError::Git(format!("failed to compare blame buffer: {}", e.message()))
                })?;
        let mut old_line = 1;
        let mut new_line = 1;
        for index in 0..patch.num_hunks() {
            let (hunk, _) = patch.hunk(index).map_err(|e| {
                GitBlameError::Git(format!("failed to read buffer diff: {}", e.message()))
            })?;
            let old_start = hunk.old_start() as usize + usize::from(hunk.old_lines() == 0);
            let new_start = hunk.new_start() as usize + usize::from(hunk.new_lines() == 0);
            visit_legacy_unchanged_blame_hunks(blame, old_line, new_line, old_start - old_line, &mut visit)?;
            if hunk.new_lines() > 0 {
                visit(new_start, hunk.new_lines() as usize, git2::Oid::zero())?;
            }
            old_line = old_start + hunk.old_lines() as usize;
            new_line = new_start + hunk.new_lines() as usize;
        }
        visit_legacy_unchanged_blame_hunks(
            blame,
            old_line,
            new_line,
            baseline_lines + 1 - old_line,
            &mut visit,
        )?;
        Ok(())
    }

    fn visit_legacy_unchanged_blame_hunks(
        blame: &git2::Blame<'_>,
        mut old_line: usize,
        mut new_line: usize,
        mut count: usize,
        visit: &mut impl FnMut(usize, usize, git2::Oid) -> Result<(), GitBlameError>,
    ) -> Result<(), GitBlameError> {
        while count > 0 {
            let hunk = blame.get_line(old_line).ok_or_else(|| {
                GitBlameError::Git("missing HEAD blame hunk for unchanged line".to_string())
            })?;
            let length = count.min(hunk.final_start_line() + hunk.lines_in_hunk() - old_line);
            visit(new_line, length, hunk.final_commit_id())?;
            old_line += length;
            new_line += length;
            count -= length;
        }
        Ok(())
    }

    fn validate_legacy_blob<'repo>(
        repo: &'repo git2::Repository,
        entry: &git2::TreeEntry<'_>,
    ) -> Result<git2::Blob<'repo>, GitBlameError> {
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
        Ok(blob)
    }

    #[test]
    fn test_cache_lifecycle_and_reuse() {
        let (dir, repo, _oid) = setup_test_repo();
        let cache = BlameBaselineCache::new();

        let initial_loads = TEST_HISTORICAL_LOAD_COUNT.with(|c| c.load(std::sync::atomic::Ordering::SeqCst));

        // 1. Initial clean request -> cache miss, loads baseline once
        let input_clean = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"hello\");\n}\n".to_string(),
            snapshot_id: "snap-clean-1".to_string(),
            model_version: 1,
        };
        let resp1 = execute_native_blame(dir.path(), &input_clean, &cache).unwrap();
        assert_eq!(resp1.status, GitBlameStatus::Ready);
        assert_eq!(resp1.snapshot_id, "snap-clean-1");
        assert_eq!(resp1.model_version, 1);
        assert_eq!(cache.len(), 1);
        assert_eq!(
            TEST_HISTORICAL_LOAD_COUNT.with(|c| c.load(std::sync::atomic::Ordering::SeqCst)),
            initial_loads + 1
        );

        // 2. Repeat clean request -> cache hit! Zero new historical loads!
        let input_clean_repeat = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"hello\");\n}\n".to_string(),
            snapshot_id: "snap-clean-2".to_string(),
            model_version: 2,
        };
        let resp2 = execute_native_blame(dir.path(), &input_clean_repeat, &cache).unwrap();
        assert_eq!(resp2.status, GitBlameStatus::Ready);
        assert_eq!(resp2.snapshot_id, "snap-clean-2");
        assert_eq!(resp2.model_version, 2);
        assert_eq!(resp2.ranges, resp1.ranges);
        assert_eq!(resp2.commits, resp1.commits);
        assert_eq!(cache.len(), 1);
        assert_eq!(
            TEST_HISTORICAL_LOAD_COUNT.with(|c| c.load(std::sync::atomic::Ordering::SeqCst)),
            initial_loads + 1,
            "repeat clean request must not invoke historical loader"
        );

        // 3. Dirty edit to code.rs -> cache hit for baseline! Zero new historical loads!
        let input_dirty = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"dirty edit\");\n}\n".to_string(),
            snapshot_id: "snap-dirty-3".to_string(),
            model_version: 3,
        };
        let resp3 = execute_native_blame(dir.path(), &input_dirty, &cache).unwrap();
        assert_eq!(resp3.status, GitBlameStatus::Ready);
        assert_eq!(resp3.snapshot_id, "snap-dirty-3");
        assert_eq!(resp3.model_version, 3);
        assert_eq!(cache.len(), 1);
        assert_eq!(resp3.ranges[1].commit_index, None);
        assert_eq!(
            TEST_HISTORICAL_LOAD_COUNT.with(|c| c.load(std::sync::atomic::Ordering::SeqCst)),
            initial_loads + 1,
            "dirty buffer request must reuse historical baseline"
        );

        // 4. Advance HEAD by committing a change to another file (code.rs blob unchanged, but head_oid moves)
        let file_path2 = dir.path().join("second.rs");
        std::fs::write(&file_path2, "pub fn second() {}\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("second.rs")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let sig = git2::Signature::now("Alice", "alice@example.com").unwrap();
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _new_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "feat: second file", &tree, &[&head_commit])
            .unwrap();

        // 5. Blaming code.rs under new HEAD -> head_oid changed -> cache miss -> exactly 1 new load
        let resp4 = execute_native_blame(dir.path(), &input_clean, &cache).unwrap();
        assert_eq!(resp4.status, GitBlameStatus::Ready);
        assert_eq!(cache.len(), 2);
        assert_eq!(
            TEST_HISTORICAL_LOAD_COUNT.with(|c| c.load(std::sync::atomic::Ordering::SeqCst)),
            initial_loads + 2,
            "new HEAD causes exactly one additional load for code.rs"
        );
    }

    #[test]
    fn test_shallow_repository_bypass() {
        let (dir, repo, _oid) = setup_test_repo();
        let cache = BlameBaselineCache::new();

        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"hello\");\n}\n".to_string(),
            snapshot_id: "snap-shallow-1".to_string(),
            model_version: 1,
        };

        // 1. Initial request on non-shallow repo -> populates cache
        let resp1 = execute_native_blame(dir.path(), &input, &cache).unwrap();
        assert_eq!(resp1.status, GitBlameStatus::Ready);
        assert_eq!(cache.len(), 1);

        // 2. Simulate shallow clone by writing HEAD OID to .git/shallow
        let shallow_file = repo.path().join("shallow");
        let head_oid = repo.head().unwrap().target().unwrap();
        std::fs::write(&shallow_file, format!("{}\n", head_oid)).unwrap();
        assert!(repo.is_shallow(), "repository should be detected as shallow");

        // 3. Request on now-shallow repo -> must bypass cache lookup and not write to cache
        let resp2 = execute_native_blame(dir.path(), &input, &cache).unwrap();
        assert_eq!(resp2.status, GitBlameStatus::Ready);
        assert_eq!(resp2.buffer_line_count, 4);

        // 4. Request on fresh empty cache with shallow repo -> cache stays empty
        let fresh_cache = BlameBaselineCache::new();
        let resp3 = execute_native_blame(dir.path(), &input, &fresh_cache).unwrap();
        assert_eq!(resp3.status, GitBlameStatus::Ready);
        assert_eq!(fresh_cache.len(), 0);
        assert_eq!(fresh_cache.retained_bytes(), 0);
    }

    #[test]
    fn test_cross_repository_cache_isolation() {
        let (dir1, _repo1, _oid1) = setup_test_repo();
        let (dir2, _repo2, _oid2) = setup_test_repo();
        let cache = BlameBaselineCache::new();

        let input = GitBlameInput {
            path: "code.rs".to_string(),
            worktree_path: None,
            content: "fn main() {\n    println!(\"hello\");\n}\n".to_string(),
            snapshot_id: "snap-iso".to_string(),
            model_version: 1,
        };

        let resp1 = execute_native_blame(dir1.path(), &input, &cache).unwrap();
        assert_eq!(cache.len(), 1);

        let resp2 = execute_native_blame(dir2.path(), &input, &cache).unwrap();
        assert_eq!(cache.len(), 2, "different repositories must not share cache entries");
        assert_eq!(resp1.status, resp2.status);
    }

    #[test]
    fn test_staged_rename_origin_changes_with_fixed_head() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Rename", "rename@example.com").unwrap();

        std::fs::write(dir.path().join("origin1.txt"), "content one\n").unwrap();
        std::fs::write(dir.path().join("origin2.txt"), "content two\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("origin1.txt")).unwrap();
        index.add_path(Path::new("origin2.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "feat: two origins",
            &repo.find_tree(tree_id).unwrap(),
            &[],
        )
        .unwrap();

        let cache = BlameBaselineCache::new();

        // 1. Stage rename origin1.txt -> dest.txt
        std::fs::remove_file(dir.path().join("origin1.txt")).unwrap();
        index.remove_path(Path::new("origin1.txt")).unwrap();
        std::fs::write(dir.path().join("dest.txt"), "content one\n").unwrap();
        index.add_path(Path::new("dest.txt")).unwrap();
        index.write().unwrap();

        let input1 = GitBlameInput {
            path: "dest.txt".to_string(),
            worktree_path: None,
            content: "content one\n".to_string(),
            snapshot_id: "snap-ren1".to_string(),
            model_version: 1,
        };
        let resp1 = execute_native_blame(dir.path(), &input1, &cache).unwrap();
        assert_eq!(resp1.status, GitBlameStatus::Ready);
        assert_eq!(cache.len(), 1);

        // 2. Stage rename origin2.txt -> dest.txt instead (HEAD fixed)
        std::fs::write(dir.path().join("origin1.txt"), "content one\n").unwrap();
        index.add_path(Path::new("origin1.txt")).unwrap();
        std::fs::remove_file(dir.path().join("origin2.txt")).unwrap();
        index.remove_path(Path::new("origin2.txt")).unwrap();
        std::fs::write(dir.path().join("dest.txt"), "content two\n").unwrap();
        index.add_path(Path::new("dest.txt")).unwrap();
        index.write().unwrap();

        let input2 = GitBlameInput {
            path: "dest.txt".to_string(),
            worktree_path: None,
            content: "content two\n".to_string(),
            snapshot_id: "snap-ren2".to_string(),
            model_version: 2,
        };
        let resp2 = execute_native_blame(dir.path(), &input2, &cache).unwrap();
        assert_eq!(resp2.status, GitBlameStatus::Ready);
        assert_eq!(cache.len(), 2, "changing staged rename origin must resolve anew");
    }

    #[test]
    fn test_head_change_during_execution_avoids_cache_publication() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Guard", "guard@example.com").unwrap();

        let file_path = dir.path().join("guarded.txt");
        std::fs::write(&file_path, "guarded content\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("guarded.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let initial_oid = repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "initial commit",
                &repo.find_tree(tree_id).unwrap(),
                &[],
            )
            .unwrap();

        let cache = BlameBaselineCache::new();

        assert!(matches!(
            ensure_head_unchanged(&repo, None),
            Err(GitBlameError::StaleRevision)
        ));

        // Advance HEAD before checking against initial_oid
        std::fs::write(&file_path, "next content\n").unwrap();
        index.add_path(Path::new("guarded.txt")).unwrap();
        index.write().unwrap();
        let tree_id2 = index.write_tree().unwrap();
        let _next_oid = repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "second commit",
                &repo.find_tree(tree_id2).unwrap(),
                &[&repo.find_commit(initial_oid).unwrap()],
            )
            .unwrap();

        assert!(matches!(
            ensure_head_unchanged(&repo, Some(initial_oid)),
            Err(GitBlameError::StaleRevision)
        ));
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_differential_repeated_identical_lines_multiple_authors() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        let sig1 = git2::Signature::now("Alice", "alice@example.com").unwrap();
        let sig2 = git2::Signature::now("Bob", "bob@example.com").unwrap();
        let sig3 = git2::Signature::now("Charlie", "charlie@example.com").unwrap();

        let file_path = dir.path().join("multi.txt");
        // Commit 1 by Alice
        std::fs::write(&file_path, "dup\nline A\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("multi.txt")).unwrap();
        index.write().unwrap();
        let tree_id1 = index.write_tree().unwrap();
        let c1 = repo
            .commit(Some("HEAD"), &sig1, &sig1, "c1", &repo.find_tree(tree_id1).unwrap(), &[])
            .unwrap();

        // Commit 2 by Bob
        std::fs::write(&file_path, "dup\nline A\ndup\n").unwrap();
        index.add_path(Path::new("multi.txt")).unwrap();
        index.write().unwrap();
        let tree_id2 = index.write_tree().unwrap();
        let c2 = repo
            .commit(
                Some("HEAD"),
                &sig2,
                &sig2,
                "c2",
                &repo.find_tree(tree_id2).unwrap(),
                &[&repo.find_commit(c1).unwrap()],
            )
            .unwrap();

        // Commit 3 by Charlie
        std::fs::write(&file_path, "dup\nline A\ndup\nline B\ndup\n").unwrap();
        index.add_path(Path::new("multi.txt")).unwrap();
        index.write().unwrap();
        let tree_id3 = index.write_tree().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig3,
            &sig3,
            "c3",
            &repo.find_tree(tree_id3).unwrap(),
            &[&repo.find_commit(c2).unwrap()],
        )
        .unwrap();

        let cache = BlameBaselineCache::new();

        let test_contents = vec![
            "dup\nline A\ndup\nline B\ndup\n",
            "new start\ndup\nline A\ndup\nline B\ndup\n",
            "dup\nline A\nmiddle edit\ndup\nline B\ndup\n",
            "dup\nline A\ndup\nline B\ndup\nnew end\n",
            "dup modified\nline A\ndup\nline B\ndup\n",
            "dup\nline A\ndup modified\nline B\ndup\n",
            "dup\nline A\ndup\nline B\ndup modified\n",
            "line A\ndup\nline B\ndup\n",
            "dup\ndup\ndup\n",
            "dup\nline A\ndup\nline B\ndup",
        ];

        for (i, content) in test_contents.into_iter().enumerate() {
            let input = GitBlameInput {
                path: "multi.txt".to_string(),
                worktree_path: None,
                content: content.to_string(),
                snapshot_id: format!("snap-diff-{}", i),
                model_version: i as i64,
            };

            let legacy = execute_uncached_legacy_blame(dir.path(), &input).unwrap();
            let cached = execute_native_blame(dir.path(), &input, &cache).unwrap();

            assert_eq!(cached, legacy, "case {i} full response mismatch");
        }
    }

    #[test]
    fn test_differential_insertions_and_deletions() {
        let (dir, _repo, _oid) = setup_test_repo();
        let cache = BlameBaselineCache::new();

        let cases = vec![
            "// header\nfn main() {\n    println!(\"hello\");\n}\n",
            "fn main() {\n    let x = 42;\n    println!(\"hello\");\n}\n",
            "fn main() {\n    println!(\"hello\");\n}\n// footer\n",
            "    println!(\"hello\");\n}\n",
            "fn main() {\n}\n",
            "fn main() {\n    println!(\"hello\");\n",
            "class Foo { bar() {} }\n",
            "",
            "fn main() {\n    println!(\"hello\");\n}",
        ];

        for (idx, content) in cases.into_iter().enumerate() {
            let input = GitBlameInput {
                path: "code.rs".to_string(),
                worktree_path: None,
                content: content.to_string(),
                snapshot_id: format!("snap-ins-del-{}", idx),
                model_version: idx as i64,
            };

            let legacy = execute_uncached_legacy_blame(dir.path(), &input).unwrap();
            let cached = execute_native_blame(dir.path(), &input, &cache).unwrap();

            assert_eq!(cached, legacy, "case {idx} full response mismatch");
        }
    }

    #[test]
    fn test_differential_line_endings_and_unicode() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Uni", "uni@example.com").unwrap();

        let file_path = dir.path().join("uni.rs");
        let baseline_text = "fn привет() {\r\n    println!(\"世界 🚀\");\r\n    let α = 1;\r\n}\r\n";
        std::fs::write(&file_path, baseline_text).unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("uni.rs")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "feat: unicode and crlf",
            &repo.find_tree(tree_id).unwrap(),
            &[],
        )
        .unwrap();

        let cache = BlameBaselineCache::new();

        let variations = vec![
            "fn привет() {\r\n    println!(\"世界 🚀\");\r\n    let α = 1;\r\n}\r\n",
            "fn привет() {\n    println!(\"世界 🚀\");\n    let α = 1;\n}\n",
            "fn привет() {\r    println!(\"世界 🚀\");\r    let α = 1;\r}\r",
            "fn привет() {\n    println!(\"мир 🌍\");\n    let α = 1;\n}\n",
            "fn привет() {\n\tprintln!(\"世界 🚀\");\n    let α = 1;\n}\n",
        ];

        for (idx, content) in variations.into_iter().enumerate() {
            let input = GitBlameInput {
                path: "uni.rs".to_string(),
                worktree_path: None,
                content: content.to_string(),
                snapshot_id: format!("snap-uni-{}", idx),
                model_version: idx as i64,
            };

            let legacy = execute_uncached_legacy_blame(dir.path(), &input).unwrap();
            let cached = execute_native_blame(dir.path(), &input, &cache).unwrap();

            assert_eq!(cached, legacy, "variation {idx} full response mismatch");
        }
    }

    #[test]
    fn test_differential_staged_rename() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Rename", "rename@example.com").unwrap();

        let original_file = dir.path().join("old.txt");
        std::fs::write(&original_file, "line 1\nline 2\nline 3\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("old.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "feat: initial file",
            &repo.find_tree(tree_id).unwrap(),
            &[],
        )
        .unwrap();

        std::fs::remove_file(&original_file).unwrap();
        index.remove_path(Path::new("old.txt")).unwrap();
        let renamed_file = dir.path().join("new.txt");
        std::fs::write(&renamed_file, "line 1\nline 2\nline 3\n").unwrap();
        index.add_path(Path::new("new.txt")).unwrap();
        index.write().unwrap();

        let cache = BlameBaselineCache::new();

        let variants = vec![
            "line 1\nline 2\nline 3\n",
            "line 1\nmodified line 2\nline 3\n",
            "added top\nline 1\nline 2\nline 3\n",
        ];

        for (idx, content) in variants.into_iter().enumerate() {
            let input = GitBlameInput {
                path: "new.txt".to_string(),
                worktree_path: None,
                content: content.to_string(),
                snapshot_id: format!("snap-ren-{}", idx),
                model_version: idx as i64,
            };

            let legacy = execute_uncached_legacy_blame(dir.path(), &input).unwrap();
            let cached = execute_native_blame(dir.path(), &input, &cache).unwrap();

            assert_eq!(cached, legacy, "rename variant {idx} full response mismatch");
        }
    }

    #[test]
    fn test_differential_dirty_range_across_historical_hunks() {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig1 = git2::Signature::now("Auth1", "auth1@example.com").unwrap();
        let sig2 = git2::Signature::now("Auth2", "auth2@example.com").unwrap();

        let file_path = dir.path().join("multi_hunk.txt");
        std::fs::write(&file_path, "hunk1_line1\nhunk1_line2\nhunk1_line3\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("multi_hunk.txt")).unwrap();
        index.write().unwrap();
        let tree_id1 = index.write_tree().unwrap();
        let c1 = repo
            .commit(Some("HEAD"), &sig1, &sig1, "hunk 1", &repo.find_tree(tree_id1).unwrap(), &[])
            .unwrap();

        std::fs::write(
            &file_path,
            "hunk1_line1\nhunk1_line2\nhunk1_line3\nhunk2_line1\nhunk2_line2\nhunk2_line3\n",
        )
        .unwrap();
        index.add_path(Path::new("multi_hunk.txt")).unwrap();
        index.write().unwrap();
        let tree_id2 = index.write_tree().unwrap();
        repo.commit(
            Some("HEAD"),
            &sig2,
            &sig2,
            "hunk 2",
            &repo.find_tree(tree_id2).unwrap(),
            &[&repo.find_commit(c1).unwrap()],
        )
        .unwrap();

        let cache = BlameBaselineCache::new();

        let content_spanning =
            "hunk1_line1\nhunk1_line2\nspanning_edit_line\nhunk2_line2\nhunk2_line3\n";
        let input = GitBlameInput {
            path: "multi_hunk.txt".to_string(),
            worktree_path: None,
            content: content_spanning.to_string(),
            snapshot_id: "snap-spanning".to_string(),
            model_version: 1,
        };

        let legacy = execute_uncached_legacy_blame(dir.path(), &input).unwrap();
        let cached = execute_native_blame(dir.path(), &input, &cache).unwrap();

        assert_eq!(cached, legacy, "spanning edit full response mismatch");
    }
}
