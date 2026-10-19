use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use crate::error::AppError;
use crate::git::diff::open_repo;
use crate::git::types::{
    ConflictSnapshot, ConflictStages, ConflictStatus, ConflictSummaryEntry,
    ConflictSummaryResponse, EffectiveAttributes, StageDescriptor, StageKind,
    WorktreeDescriptor, WorktreeKind,
};

pub const MAX_STAGE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB
pub const MAX_TOTAL_STAGE_BYTES: u64 = 15 * 1024 * 1024; // 15 MB
pub const MAX_WORKTREE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB
pub const MAX_LINES: usize = 50_000;
pub const MAX_LINE_LENGTH: usize = 100_000;
pub const DEFAULT_SUMMARY_LIMIT: usize = 100;
pub const MAX_SUMMARY_LIMIT: usize = 500;
pub const BINARY_SNIFF_LEN: usize = 8000;

/// Encodes raw stage path bytes into an opaque URL-safe conflictId.
pub fn encode_conflict_id(raw_path: &[u8]) -> String {
    format!("cid_{}", hex::encode(raw_path))
}

/// Decodes an opaque conflictId back to raw stage path bytes.
pub fn decode_conflict_id(conflict_id: &str) -> Option<Vec<u8>> {
    if let Some(stripped) = conflict_id.strip_prefix("cid_") {
        hex::decode(stripped).ok()
    } else {
        None
    }
}

/// Splits text into lossless line tokens, preserving line endings (LF, CRLF, or lone CR).
/// Guarantee: `tokens.concat() == s`.
pub fn split_lossless_line_tokens(s: &str) -> Vec<String> {
    match split_lossless_line_tokens_bounded(s, usize::MAX, usize::MAX) {
        Ok(tokens) => tokens,
        Err(_) => Vec::new(),
    }
}

/// Splits text into lossless line tokens with immediate bounds enforcement before allocation.
pub fn split_lossless_line_tokens_bounded(
    s: &str,
    max_lines: usize,
    max_line_len: usize,
) -> Result<Vec<String>, &'static str> {
    if s.is_empty() {
        return Ok(Vec::new());
    }
    let mut tokens = Vec::new();
    let mut start = 0;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            let line_len = (i + 1) - start;
            if line_len > max_line_len {
                return Err("line length limit exceeded");
            }
            if tokens.len() >= max_lines {
                return Err("line count limit exceeded");
            }
            tokens.push(s[start..=i].to_string());
            start = i + 1;
        } else if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                let line_len = (i + 2) - start;
                if line_len > max_line_len {
                    return Err("line length limit exceeded");
                }
                if tokens.len() >= max_lines {
                    return Err("line count limit exceeded");
                }
                tokens.push(s[start..=i + 1].to_string());
                start = i + 2;
                i += 1;
            } else {
                let line_len = (i + 1) - start;
                if line_len > max_line_len {
                    return Err("line length limit exceeded");
                }
                if tokens.len() >= max_lines {
                    return Err("line count limit exceeded");
                }
                tokens.push(s[start..=i].to_string());
                start = i + 1;
            }
        }
        i += 1;
    }
    if start < bytes.len() {
        let line_len = bytes.len() - start;
        if line_len > max_line_len {
            return Err("line length limit exceeded");
        }
        if tokens.len() >= max_lines {
            return Err("line count limit exceeded");
        }
        tokens.push(s[start..].to_string());
    }
    Ok(tokens)
}

/// Detects standard conflict markers (`<<<<<<<` and `>>>>>>>`).
pub fn detect_conflict_markers(content: &str) -> bool {
    let mut has_start = false;
    let mut has_end = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("<<<<<<<") {
            has_start = true;
        } else if trimmed.starts_with(">>>>>>>") {
            has_end = true;
        }
        if has_start && has_end {
            return true;
        }
    }
    false
}

pub fn is_binary_content(bytes: &[u8]) -> bool {
    let check_slice = if bytes.len() > BINARY_SNIFF_LEN {
        &bytes[..BINARY_SNIFF_LEN]
    } else {
        bytes
    };
    check_slice.contains(&0)
}

/// Safe join with ancestor verification to prevent traversal, Windows drive prefixes, or escaped symlinks.
pub fn verify_safe_worktree_path(base: &Path, rel: &str) -> Result<PathBuf, AppError> {
    if rel.is_empty() || rel.starts_with('/') || rel.starts_with('\\') || rel.contains('\\') {
        return Err(AppError::InvalidInput(format!("invalid path: {rel}")));
    }
    let candidate = Path::new(rel);
    if !candidate.is_relative() {
        return Err(AppError::InvalidInput(format!(
            "path must be relative: {rel}"
        )));
    }
    for comp in candidate.components() {
        match comp {
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                return Err(AppError::InvalidInput(format!(
                    "root or prefix not allowed in relative path: {rel}"
                )));
            }
            std::path::Component::ParentDir => {
                return Err(AppError::InvalidInput(format!(
                    "path traversal rejected: {rel}"
                )));
            }
            _ => {}
        }
    }

    let canonical_base = dunce::canonicalize(base).map_err(AppError::Io)?;
    let mut current = canonical_base.clone();
    for comp in candidate.components() {
        if let std::path::Component::Normal(p) = comp {
            current.push(p);
            if let Ok(meta) = std::fs::symlink_metadata(&current) {
                if meta.file_type().is_symlink() {
                    let target = dunce::canonicalize(&current).map_err(AppError::Io)?;
                    if !target.starts_with(&canonical_base) {
                        return Err(AppError::InvalidInput(format!(
                            "symlink traversal escapes root: {rel}"
                        )));
                    }
                }
            }
        }
    }
    Ok(base.join(rel))
}

pub fn get_active_operation(repo: &git2::Repository) -> &'static str {
    match repo.state() {
        git2::RepositoryState::Merge => "merge",
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge => "rebase",
        git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
            "cherry-pick"
        }
        git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => "revert",
        git2::RepositoryState::ApplyMailbox | git2::RepositoryState::ApplyMailboxOrRebase => {
            "rebase"
        }
        git2::RepositoryState::Bisect => "bisect",
        git2::RepositoryState::Clean => {
            let git_dir = repo.path();
            if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
                "rebase"
            } else if git_dir.join("MERGE_HEAD").exists() {
                "merge"
            } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
                "cherry-pick"
            } else if git_dir.join("REVERT_HEAD").exists() {
                "revert"
            } else {
                "none"
            }
        }
    }
}

pub fn inspect_effective_attributes(repo: &git2::Repository, path: &str) -> EffectiveAttributes {
    let p = Path::new(path);

    let eol = match git2::AttrValue::from_string(
        repo.get_attr(p, "eol", git2::AttrCheckFlags::empty())
            .ok()
            .flatten(),
    ) {
        git2::AttrValue::String(s) => Some(s.to_string()),
        _ => None,
    };

    let encoding = match git2::AttrValue::from_string(
        repo.get_attr(p, "working-tree-encoding", git2::AttrCheckFlags::empty())
            .ok()
            .flatten(),
    ) {
        git2::AttrValue::String(s) => Some(s.to_string()),
        _ => None,
    };

    let ident = matches!(
        git2::AttrValue::from_string(
            repo.get_attr(p, "ident", git2::AttrCheckFlags::empty())
                .ok()
                .flatten(),
        ),
        git2::AttrValue::True
    );

    let filter_attr = git2::AttrValue::from_string(
        repo.get_attr(p, "filter", git2::AttrCheckFlags::empty())
            .ok()
            .flatten(),
    );
    let filter_qualified = match filter_attr {
        git2::AttrValue::Unspecified | git2::AttrValue::False => true,
        git2::AttrValue::String(f) if f.trim().is_empty() => true,
        _ => false,
    } && !ident && encoding.is_none();

    let text = match git2::AttrValue::from_string(
        repo.get_attr(p, "text", git2::AttrCheckFlags::empty())
            .ok()
            .flatten(),
    ) {
        git2::AttrValue::String(s) => Some(s.to_string()),
        git2::AttrValue::True => Some("true".to_string()),
        git2::AttrValue::False => Some("false".to_string()),
        _ => None,
    };

    let (core_autocrlf, core_eol) = if let Ok(cfg) = repo.config() {
        (
            cfg.get_string("core.autocrlf").ok(),
            cfg.get_string("core.eol").ok(),
        )
    } else {
        (None, None)
    };

    EffectiveAttributes {
        eol,
        encoding,
        ident,
        filter_qualified,
        text,
        core_autocrlf,
        core_eol,
    }
}

pub fn compute_attributes_fingerprint(attrs: &EffectiveAttributes) -> String {
    let mut hasher = Sha256::new();
    if let Some(eol) = &attrs.eol {
        hasher.update(eol.as_bytes());
    }
    hasher.update(b"\0");
    if let Some(enc) = &attrs.encoding {
        hasher.update(enc.as_bytes());
    }
    hasher.update(b"\0");
    hasher.update(&[attrs.ident as u8]);
    hasher.update(&[attrs.filter_qualified as u8]);
    if let Some(text) = &attrs.text {
        hasher.update(text.as_bytes());
    }
    hasher.update(b"\0");
    if let Some(c_acrlf) = &attrs.core_autocrlf {
        hasher.update(c_acrlf.as_bytes());
    }
    hasher.update(b"\0");
    if let Some(c_eol) = &attrs.core_eol {
        hasher.update(c_eol.as_bytes());
    }
    hex::encode(hasher.finalize())
}

pub fn compute_full_index_fingerprint(index: &git2::Index) -> String {
    let mut hasher = Sha256::new();
    hasher.update((index.len() as u64).to_le_bytes());
    for entry in index.iter() {
        hasher.update(&entry.path);
        hasher.update(b"\0");
        hasher.update(entry.id.as_bytes());
        hasher.update(entry.mode.to_le_bytes());
        hasher.update(entry.file_size.to_le_bytes());
        hasher.update((entry.flags & 0x3000).to_le_bytes());
        hasher.update(entry.mtime.seconds().to_le_bytes());
        hasher.update(entry.mtime.nanoseconds().to_le_bytes());
    }
    hex::encode(hasher.finalize())
}

#[derive(Clone, PartialEq, Eq)]
pub struct StateFingerprint {
    pub target_revision: String,
    pub operation: String,
    pub full_index_fingerprint: String,
    pub worktree_mtime_nanos: u64,
    pub worktree_size: u64,
    pub worktree_content_hash: Option<String>,
    pub attributes_fingerprint: String,
}

fn capture_state_fingerprint(
    repo: &git2::Repository,
    index: &git2::Index,
    worktree_file: Option<&Path>,
    path_for_attrs: Option<&str>,
) -> StateFingerprint {
    let target_revision = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string())
        .unwrap_or_default();
    let operation = get_active_operation(repo).to_string();
    let full_index_fingerprint = compute_full_index_fingerprint(index);
    let (worktree_mtime_nanos, worktree_size, worktree_content_hash) = if let Some(p) = worktree_file {
        if let Ok(meta) = std::fs::symlink_metadata(p) {
            let nanos = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0);
            let size = meta.len();
            let hash = if meta.file_type().is_file() && size <= MAX_WORKTREE_BYTES {
                if let Ok(bytes) = std::fs::read(p) {
                    Some(hex::encode(Sha256::digest(&bytes)))
                } else {
                    None
                }
            } else {
                None
            };
            (nanos, size, hash)
        } else {
            (0, 0, None)
        }
    } else {
        (0, 0, None)
    };
    let attributes_fingerprint = if let Some(rel) = path_for_attrs {
        let attrs = inspect_effective_attributes(repo, rel);
        compute_attributes_fingerprint(&attrs)
    } else {
        String::new()
    };
    StateFingerprint {
        target_revision,
        operation,
        full_index_fingerprint,
        worktree_mtime_nanos,
        worktree_size,
        worktree_content_hash,
        attributes_fingerprint,
    }
}

pub struct SnapshotInput<'a> {
    pub canonical_root: &'a str,
    pub canonical_worktree: &'a str,
    pub state: &'a StateFingerprint,
    pub conflict_path: &'a str,
    pub stages: &'a ConflictStages,
    pub worktree: &'a WorktreeDescriptor,
    pub effective_attrs: &'a EffectiveAttributes,
    pub worktree_content_hash: Option<&'a str>,
}

pub fn compute_snapshot_version(input: &SnapshotInput<'_>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.canonical_root.as_bytes());
    hasher.update(b"\0");
    hasher.update(input.canonical_worktree.as_bytes());
    hasher.update(b"\0");
    hasher.update(input.state.target_revision.as_bytes());
    hasher.update(b"\0");
    hasher.update(input.state.operation.as_bytes());
    hasher.update(b"\0");
    hasher.update(input.state.full_index_fingerprint.as_bytes());
    hasher.update(b"\0");
    hasher.update(input.conflict_path.as_bytes());
    hasher.update(b"\0");

    let hash_stage = |h: &mut Sha256, st: &StageDescriptor| {
        h.update(st.stage.to_le_bytes());
        if let Some(p) = &st.path {
            h.update(p.as_bytes());
        }
        if let Some(oid) = &st.oid {
            h.update(oid.as_bytes());
        }
        h.update(st.mode.to_le_bytes());
        h.update(st.byte_size.to_le_bytes());
        h.update(&[st.kind as u8]);
    };

    if let Some(base) = &input.stages.base {
        hash_stage(&mut hasher, base);
    }
    hash_stage(&mut hasher, &input.stages.ours);
    hash_stage(&mut hasher, &input.stages.theirs);

    hasher.update(&[input.worktree.exists as u8]);
    hasher.update(&[input.worktree.kind as u8]);
    hasher.update(input.worktree.mode.to_le_bytes());
    hasher.update(input.worktree.byte_length.to_le_bytes());
    hasher.update(&[input.worktree.has_conflict_markers as u8]);
    hasher.update(&[input.worktree.is_dirty_vs_stages as u8]);

    if let Some(h) = input.worktree_content_hash {
        hasher.update(h.as_bytes());
    }

    hasher.update(input.state.attributes_fingerprint.as_bytes());
    hasher.update(b"\0");

    if let Some(eol) = &input.effective_attrs.eol {
        hasher.update(eol.as_bytes());
    }
    if let Some(enc) = &input.effective_attrs.encoding {
        hasher.update(enc.as_bytes());
    }
    hasher.update(&[input.effective_attrs.ident as u8]);
    hasher.update(&[input.effective_attrs.filter_qualified as u8]);
    if let Some(t) = &input.effective_attrs.text {
        hasher.update(t.as_bytes());
    }
    if let Some(a) = &input.effective_attrs.core_autocrlf {
        hasher.update(a.as_bytes());
    }
    if let Some(e) = &input.effective_attrs.core_eol {
        hasher.update(e.as_bytes());
    }
    hex::encode(hasher.finalize())
}

/// Returns a bounded deterministic summary of unmerged index entries.
pub fn get_conflicts_summary(
    root_path: &Path,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<ConflictSummaryResponse, AppError> {
    let repo = open_repo(root_path)?;
    let index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let target_revision = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string())
        .unwrap_or_default();

    let offset = if let Some(cur) = cursor {
        if let Some(cur_str) = cur.strip_prefix("v1:") {
            let parts: Vec<&str> = cur_str.split(':').collect();
            if parts.len() == 2 {
                if parts[0] != target_revision {
                    return Err(AppError::InvalidInput(
                        "Stale cursor: target revision has changed since cursor was issued".into(),
                    ));
                }
                parts[1].parse::<usize>().map_err(|_| {
                    AppError::InvalidInput("Malformed cursor offset".into())
                })?
            } else {
                return Err(AppError::InvalidInput("Malformed cursor format".into()));
            }
        } else {
            return Err(AppError::InvalidInput("Unsupported cursor version".into()));
        }
    } else {
        0
    };

    if !index.has_conflicts() {
        return Ok(ConflictSummaryResponse {
            target_revision,
            entries: Vec::new(),
            truncated: false,
            next_cursor: None,
        });
    }

    let page_limit = limit
        .unwrap_or(DEFAULT_SUMMARY_LIMIT)
        .clamp(1, MAX_SUMMARY_LIMIT);

    let mut entries = Vec::new();
    let mut total_unmerged_count = 0;

    let conflicts_iter = index
        .conflicts()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    for conflict_res in conflicts_iter {
        let conflict = conflict_res.map_err(|e| AppError::Git(e.message().to_string()))?;
        let primary_entry = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref());

        let raw_path = match primary_entry {
            Some(e) => &e.path,
            None => continue,
        };

        let current_index = total_unmerged_count;
        total_unmerged_count += 1;

        if current_index < offset {
            continue;
        }

        if entries.len() >= page_limit {
            continue;
        }

        let (display_path, is_non_utf8) = match std::str::from_utf8(raw_path) {
            Ok(s) => (s.to_string(), false),
            Err(_) => (String::from_utf8_lossy(raw_path).into_owned(), true),
        };
        let conflict_id = encode_conflict_id(raw_path);

        let ancestor_present = conflict.ancestor.is_some();
        let our_present = conflict.our.is_some();
        let their_present = conflict.their.is_some();

        let our_mode = conflict.our.as_ref().map(|e| e.mode).unwrap_or(0);
        let their_mode = conflict.their.as_ref().map(|e| e.mode).unwrap_or(0);
        let ancestor_mode = conflict.ancestor.as_ref().map(|e| e.mode).unwrap_or(0);

        let is_symlink_mode = |m: u32| (m & 0o170000) == 0o120000;
        let is_gitlink_mode = |m: u32| (m & 0o170000) == 0o160000;

        let has_symlink = is_symlink_mode(our_mode)
            || is_symlink_mode(their_mode)
            || is_symlink_mode(ancestor_mode);
        let has_gitlink = is_gitlink_mode(our_mode)
            || is_gitlink_mode(their_mode)
            || is_gitlink_mode(ancestor_mode);

        let (status, unsupported_reason) = if is_non_utf8 {
            (
                ConflictStatus::Unsupported,
                Some("Non-UTF-8 path not supported for in-editor mutation".to_string()),
            )
        } else if has_symlink {
            (
                ConflictStatus::Unsupported,
                Some("Symlink conflict not supported in text resolver".to_string()),
            )
        } else if has_gitlink {
            (
                ConflictStatus::Unsupported,
                Some("Submodule gitlink conflict not supported".to_string()),
            )
        } else {
            let rename_mismatch = match (&conflict.our, &conflict.their) {
                (Some(o), Some(t)) => o.path != t.path,
                _ => false,
            };

            if rename_mismatch {
                (
                    ConflictStatus::Unsupported,
                    Some("Complex rename conflict with mismatched stage paths".to_string()),
                )
            } else if ancestor_present && our_present && their_present {
                (ConflictStatus::BothModified, None)
            } else if !ancestor_present && our_present && their_present {
                (ConflictStatus::BothAdded, None)
            } else if our_present && !their_present {
                (ConflictStatus::DeleteModify, None)
            } else if !our_present && their_present {
                (ConflictStatus::ModifyDelete, None)
            } else {
                (
                    ConflictStatus::Unsupported,
                    Some("Unrecognized unmerged stage combination".to_string()),
                )
            }
        };

        // Bounded binary detection: attributes -> known extension -> bounded ODB sniff (<= 8KB)
        let mut is_binary = false;
        let diff_attr = git2::AttrValue::from_string(
            repo.get_attr(Path::new(&display_path), "diff", git2::AttrCheckFlags::empty())
                .ok()
                .flatten(),
        );
        if matches!(diff_attr, git2::AttrValue::False) {
            is_binary = true;
        } else if matches!(diff_attr, git2::AttrValue::True) {
            is_binary = false;
        } else {
            let is_known_binary_ext = {
                let p = Path::new(&display_path);
                match p.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
                    Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" | "pdf" | "zip"
                        | "tar" | "gz" | "bz2" | "7z" | "exe" | "dll" | "so" | "dylib"
                        | "bin" | "dat" | "pyc" | "class" | "wasm") => true,
                    _ => false,
                }
            };

            if is_known_binary_ext {
                is_binary = true;
            } else if let Ok(odb) = repo.odb() {
                let sample_oid = conflict
                    .our
                    .as_ref()
                    .or(conflict.their.as_ref())
                    .or(conflict.ancestor.as_ref())
                    .map(|e| e.id);
                if let Some(oid) = sample_oid {
                    if !oid.is_zero() {
                        if let Ok((size, _)) = odb.read_header(oid) {
                            if size <= BINARY_SNIFF_LEN {
                                if let Ok(obj) = odb.read(oid) {
                                    if is_binary_content(obj.data()) {
                                        is_binary = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        entries.push(ConflictSummaryEntry {
            conflict_id,
            path: display_path,
            status,
            is_binary,
            unsupported_reason,
        });
    }

    let truncated = total_unmerged_count > (offset + entries.len());
    let next_cursor = if truncated {
        Some(format!("v1:{}:{}", target_revision, offset + entries.len()))
    } else {
        None
    };

    Ok(ConflictSummaryResponse {
        target_revision,
        entries,
        truncated,
        next_cursor,
    })
}

/// Returns a coherent on-demand snapshot of a conflict with pre-allocation bounds
/// and before/after state coherence checks.
pub fn get_conflict_snapshot(
    root_path: &Path,
    conflict_id: &str,
) -> Result<ConflictSnapshot, AppError> {
    if conflict_id.len() > 4096 {
        return Err(AppError::InvalidInput("conflictId exceeds maximum allowed length".into()));
    }
    let repo = open_repo(root_path)?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let canonical_root = dunce::canonicalize(root_path)
        .map_err(AppError::Io)?
        .to_string_lossy()
        .into_owned();
    let canonical_worktree = repo
        .workdir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical_root.clone());

    let target_raw_path = decode_conflict_id(conflict_id).ok_or_else(|| {
        AppError::InvalidInput(format!("Invalid conflictId format: {conflict_id}"))
    })?;
    // Find the specific unmerged conflict in the index
    let conflicts_iter = index
        .conflicts()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let mut matched_conflict = None;
    for conflict_res in conflicts_iter {
        let c = conflict_res.map_err(|e| AppError::Git(e.message().to_string()))?;
        let primary = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        if let Some(entry) = primary {
            if entry.path == target_raw_path {
                matched_conflict = Some(c);
                break;
            }
        }
    }

    let conflict = match matched_conflict {
        Some(c) => c,
        None => {
            return Err(AppError::NotFound(format!(
                "Conflict not found in unmerged index for conflictId: {conflict_id}"
            )));
        }
    };

    let display_path = match std::str::from_utf8(&target_raw_path) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let lossy_path = String::from_utf8_lossy(&target_raw_path).into_owned();
            let before_state = capture_state_fingerprint(&repo, &index, None, None);
            let build_unsupported_stage = |stage_num: u16, entry_opt: Option<&git2::IndexEntry>| -> StageDescriptor {
                match entry_opt {
                    Some(e) => StageDescriptor {
                        stage: stage_num,
                        path: Some(lossy_path.clone()),
                        oid: Some(e.id.to_string()),
                        mode: e.mode,
                        byte_size: 0,
                        kind: StageKind::Unsupported,
                        text_tokens: None,
                    },
                    None => StageDescriptor {
                        stage: stage_num,
                        path: None,
                        oid: None,
                        mode: 0,
                        byte_size: 0,
                        kind: StageKind::Missing,
                        text_tokens: None,
                    },
                }
            };
            let empty_stages = ConflictStages {
                base: conflict.ancestor.as_ref().map(|_| build_unsupported_stage(1, conflict.ancestor.as_ref())),
                ours: build_unsupported_stage(2, conflict.our.as_ref()),
                theirs: build_unsupported_stage(3, conflict.their.as_ref()),
            };
            let empty_worktree = WorktreeDescriptor {
                exists: false,
                kind: WorktreeKind::Missing,
                mode: 0,
                byte_length: 0,
                text_tokens: None,
                has_conflict_markers: false,
                is_dirty_vs_stages: false,
            };
            let empty_attrs = EffectiveAttributes {
                eol: None,
                encoding: None,
                ident: false,
                filter_qualified: false,
                text: None,
                core_autocrlf: None,
                core_eol: None,
            };
            let snapshot_input = SnapshotInput {
                canonical_root: &canonical_root,
                canonical_worktree: &canonical_worktree,
                state: &before_state,
                conflict_path: &lossy_path,
                stages: &empty_stages,
                worktree: &empty_worktree,
                effective_attrs: &empty_attrs,
                worktree_content_hash: None,
            };
            let snapshot_version = compute_snapshot_version(&snapshot_input);
            return Ok(ConflictSnapshot {
                conflict_id: conflict_id.to_string(),
                path: lossy_path,
                repository_root: canonical_root,
                worktree_root: canonical_worktree,
                snapshot_version,
                full_index_fingerprint: before_state.full_index_fingerprint,
                status: ConflictStatus::Unsupported,
                unsupported_reason: Some(
                    "Non-UTF-8 path not supported for in-editor mutation".to_string(),
                ),
                stages: empty_stages,
                worktree: empty_worktree,
                effective_attributes: empty_attrs,
                target_revision: Some(before_state.target_revision),
                operation: Some(before_state.operation),
            });
        }
    };
    let safe_disk_path = verify_safe_worktree_path(root_path, &display_path)?;

    // Step 8: Capture before-state fingerprint
    let before_state =
        capture_state_fingerprint(&repo, &index, Some(&safe_disk_path), Some(&display_path));
    let odb = repo
        .odb()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    // Load Stage Descriptors with pre-allocation bounds (using ODB read_header)
    let mut total_stage_bytes: u64 = 0;

    let build_stage = |stage_num: u16,
                           entry_opt: Option<&git2::IndexEntry>,
                           total_bytes: &mut u64|
     -> Result<StageDescriptor, AppError> {
        let entry = match entry_opt {
            Some(e) => e,
            None => {
                return Ok(StageDescriptor {
                    stage: stage_num,
                    path: None,
                    oid: None,
                    mode: 0,
                    byte_size: 0,
                    kind: StageKind::Missing,
                    text_tokens: None,
                });
            }
        };

        let stage_path = String::from_utf8_lossy(&entry.path).into_owned();
        let oid_str = entry.id.to_string();
        let mode = entry.mode;

        // Check for gitlink (submodule) or symlink modes
        let is_gitlink = (mode & 0o170000) == 0o160000;
        let is_symlink = (mode & 0o170000) == 0o120000;
        if is_gitlink || is_symlink {
            return Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size: 0,
                kind: StageKind::Unsupported,
                text_tokens: None,
            });
        }

        if entry.id.is_zero() {
            return Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size: 0,
                kind: StageKind::Text,
                text_tokens: Some(Vec::new()),
            });
        }

        // Pre-allocation check: inspect ODB header without loading blob content
        let (odb_size, obj_type) = match odb.read_header(entry.id) {
            Ok(h) => h,
            Err(_) => {
                return Ok(StageDescriptor {
                    stage: stage_num,
                    path: Some(stage_path),
                    oid: Some(oid_str),
                    mode,
                    byte_size: 0,
                    kind: StageKind::ReadError,
                    text_tokens: None,
                });
            }
        };
        if obj_type != git2::ObjectType::Blob {
            return Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size: odb_size as u64,
                kind: StageKind::Unsupported,
                text_tokens: None,
            });
        }

        let byte_size = odb_size as u64;
        *total_bytes = total_bytes.saturating_add(byte_size);

        if byte_size > MAX_STAGE_BYTES || *total_bytes > MAX_TOTAL_STAGE_BYTES {
            return Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size,
                kind: StageKind::Unsupported,
                text_tokens: None,
            });
        }

        let blob = match repo.find_blob(entry.id) {
            Ok(b) => b,
            Err(_) => {
                return Ok(StageDescriptor {
                    stage: stage_num,
                    path: Some(stage_path),
                    oid: Some(oid_str),
                    mode,
                    byte_size,
                    kind: StageKind::ReadError,
                    text_tokens: None,
                });
            }
        };
        let content = blob.content();
        if is_binary_content(content) {
            return Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size,
                kind: StageKind::Binary,
                text_tokens: None,
            });
        }

        match std::str::from_utf8(content) {
            Err(_) => Ok(StageDescriptor {
                stage: stage_num,
                path: Some(stage_path),
                oid: Some(oid_str),
                mode,
                byte_size,
                kind: StageKind::InvalidEncoding,
                text_tokens: None,
            }),
            Ok(valid_text) => {
                match split_lossless_line_tokens_bounded(valid_text, MAX_LINES, MAX_LINE_LENGTH) {
                    Err(_) => Ok(StageDescriptor {
                        stage: stage_num,
                        path: Some(stage_path),
                        oid: Some(oid_str),
                        mode,
                        byte_size,
                        kind: StageKind::Unsupported,
                        text_tokens: None,
                    }),
                    Ok(tokens) => Ok(StageDescriptor {
                        stage: stage_num,
                        path: Some(stage_path),
                        oid: Some(oid_str),
                        mode,
                        byte_size,
                        kind: StageKind::Text,
                        text_tokens: Some(tokens),
                    }),
                }
            }
        }
    };

    let base_descriptor = if conflict.ancestor.is_some() {
        Some(build_stage(
            1,
            conflict.ancestor.as_ref(),
            &mut total_stage_bytes,
        )?)
    } else {
        None
    };

    let ours_descriptor = build_stage(2, conflict.our.as_ref(), &mut total_stage_bytes)?;
    let theirs_descriptor = build_stage(3, conflict.their.as_ref(), &mut total_stage_bytes)?;

    let mut stages = ConflictStages {
        base: base_descriptor,
        ours: ours_descriptor,
        theirs: theirs_descriptor,
    };

    // Inspect Worktree on disk with bounded reading
    let mut worktree_content_hash = None;
    let worktree_meta = std::fs::symlink_metadata(&safe_disk_path);

    let mut worktree = match worktree_meta {
        Err(e) => {
            let kind = if e.kind() == std::io::ErrorKind::NotFound {
                WorktreeKind::Missing
            } else {
                WorktreeKind::Unreadable
            };
            WorktreeDescriptor {
                exists: false,
                kind,
                mode: 0,
                byte_length: 0,
                text_tokens: None,
                has_conflict_markers: false,
                is_dirty_vs_stages: false,
            }
        }
        Ok(meta) => {
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::MetadataExt;
                meta.mode()
            };
            #[cfg(not(unix))]
            let mode = 0o100644;

            let file_type = meta.file_type();

            if file_type.is_symlink() {
                WorktreeDescriptor {
                    exists: true,
                    kind: WorktreeKind::Symlink,
                    mode,
                    byte_length: 0,
                    text_tokens: None,
                    has_conflict_markers: false,
                    is_dirty_vs_stages: true,
                }
            } else if file_type.is_dir() {
                WorktreeDescriptor {
                    exists: true,
                    kind: WorktreeKind::Directory,
                    mode,
                    byte_length: 0,
                    text_tokens: None,
                    has_conflict_markers: false,
                    is_dirty_vs_stages: true,
                }
            } else if !file_type.is_file() {
                WorktreeDescriptor {
                    exists: true,
                    kind: WorktreeKind::Unreadable,
                    mode,
                    byte_length: 0,
                    text_tokens: None,
                    has_conflict_markers: false,
                    is_dirty_vs_stages: true,
                }
            } else {
                let byte_length = meta.len();
                if byte_length > MAX_WORKTREE_BYTES {
                    WorktreeDescriptor {
                        exists: true,
                        kind: WorktreeKind::Regular,
                        mode,
                        byte_length,
                        text_tokens: None,
                        has_conflict_markers: false,
                        is_dirty_vs_stages: true,
                    }
                } else {
                    use std::io::Read;
                    let mut disk_bytes = Vec::new();
                    let read_res = std::fs::File::open(&safe_disk_path).and_then(|mut f| {
                        f.by_ref()
                            .take(MAX_WORKTREE_BYTES + 1)
                            .read_to_end(&mut disk_bytes)
                    });
                    if read_res.is_err() {
                        WorktreeDescriptor {
                            exists: true,
                            kind: WorktreeKind::Unreadable,
                            mode,
                            byte_length: 0,
                            text_tokens: None,
                            has_conflict_markers: false,
                            is_dirty_vs_stages: true,
                        }
                    } else if disk_bytes.len() as u64 > MAX_WORKTREE_BYTES {
                        WorktreeDescriptor {
                            exists: true,
                            kind: WorktreeKind::Regular,
                            mode,
                            byte_length: disk_bytes.len() as u64,
                            text_tokens: None,
                            has_conflict_markers: false,
                            is_dirty_vs_stages: true,
                        }
                    } else {
                        let content_hash = hex::encode(Sha256::digest(&disk_bytes));
                        worktree_content_hash = Some(content_hash);

                        let is_bin = is_binary_content(&disk_bytes);
                        let mut has_markers = false;
                        let mut tokens = None;

                        if !is_bin {
                            if let Ok(s) = std::str::from_utf8(&disk_bytes) {
                                has_markers = detect_conflict_markers(s);
                                if let Ok(t) = split_lossless_line_tokens_bounded(
                                    s,
                                    MAX_LINES,
                                    MAX_LINE_LENGTH,
                                ) {
                                    tokens = Some(t);
                                }
                            }
                        }

                        // Check if dirty vs any present stage (size check first)
                        let matches_any_stage = {
                            let check_match = |st_desc: &StageDescriptor| {
                                if st_desc.byte_size != disk_bytes.len() as u64 {
                                    return false;
                                }
                                if let Some(oid_str) = &st_desc.oid {
                                    if let Ok(oid) = git2::Oid::from_str(oid_str) {
                                        if let Ok(b) = repo.find_blob(oid) {
                                            return b.content() == disk_bytes.as_slice();
                                        }
                                    }
                                }
                                false
                            };
                            stages.base.as_ref().map(check_match).unwrap_or(false)
                                || check_match(&stages.ours)
                                || check_match(&stages.theirs)
                        };

                        WorktreeDescriptor {
                            exists: true,
                            kind: WorktreeKind::Regular,
                            mode,
                            byte_length: disk_bytes.len() as u64,
                            text_tokens: tokens,
                            has_conflict_markers: has_markers,
                            is_dirty_vs_stages: !matches_any_stage,
                        }
                    }
                }
            }
        }
    };

    let effective_attributes = inspect_effective_attributes(&repo, &display_path);

    // Re-read index and verify after-state
    index.read(true).map_err(|e| AppError::Git(e.message().to_string()))?;
    let after_state = capture_state_fingerprint(&repo, &index, Some(&safe_disk_path), Some(&display_path));

    if before_state != after_state {
        return Err(AppError::ConflictStateChanged);
    }

    let (mut status, mut unsupported_reason) = {
        let our_mode = conflict.our.as_ref().map(|e| e.mode).unwrap_or(0);
        let their_mode = conflict.their.as_ref().map(|e| e.mode).unwrap_or(0);
        let ancestor_mode = conflict.ancestor.as_ref().map(|e| e.mode).unwrap_or(0);

        let is_symlink_mode = |m: u32| (m & 0o170000) == 0o120000;
        let is_gitlink_mode = |m: u32| (m & 0o170000) == 0o160000;

        let has_symlink = is_symlink_mode(our_mode)
            || is_symlink_mode(their_mode)
            || is_symlink_mode(ancestor_mode);
        let has_gitlink = is_gitlink_mode(our_mode)
            || is_gitlink_mode(their_mode)
            || is_gitlink_mode(ancestor_mode);

        if has_symlink {
            (
                ConflictStatus::Unsupported,
                Some("Symlink conflict not supported in text resolver".to_string()),
            )
        } else if has_gitlink {
            (
                ConflictStatus::Unsupported,
                Some("Submodule gitlink conflict not supported".to_string()),
            )
        } else {
            let rename_mismatch = match (&conflict.our, &conflict.their) {
                (Some(o), Some(t)) => o.path != t.path,
                _ => false,
            };

            if rename_mismatch {
                (
                    ConflictStatus::Unsupported,
                    Some("Complex rename conflict with mismatched stage paths".to_string()),
                )
            } else if conflict.ancestor.is_some() && conflict.our.is_some() && conflict.their.is_some() {
                (ConflictStatus::BothModified, None)
            } else if conflict.ancestor.is_none() && conflict.our.is_some() && conflict.their.is_some() {
                (ConflictStatus::BothAdded, None)
            } else if conflict.our.is_some() && conflict.their.is_none() {
                (ConflictStatus::DeleteModify, None)
            } else if conflict.our.is_none() && conflict.their.is_some() {
                (ConflictStatus::ModifyDelete, None)
            } else {
                (
                    ConflictStatus::Unsupported,
                    Some("Unrecognized unmerged stage combination".to_string()),
                )
            }
        }
    };

    if !effective_attributes.filter_qualified {
        status = ConflictStatus::Unsupported;
        unsupported_reason = Some("File has custom or unqualified filter conversion".to_string());
        if let Some(base) = &mut stages.base {
            if base.kind != StageKind::Missing {
                base.kind = StageKind::Unsupported;
                base.text_tokens = None;
            }
        }
        if stages.ours.kind != StageKind::Missing {
            stages.ours.kind = StageKind::Unsupported;
            stages.ours.text_tokens = None;
        }
        if stages.theirs.kind != StageKind::Missing {
            stages.theirs.kind = StageKind::Unsupported;
            stages.theirs.text_tokens = None;
        }
        worktree.text_tokens = None;
    }
    let snapshot_input = SnapshotInput {
        canonical_root: &canonical_root,
        canonical_worktree: &canonical_worktree,
        state: &after_state,
        conflict_path: &display_path,
        stages: &stages,
        worktree: &worktree,
        effective_attrs: &effective_attributes,
        worktree_content_hash: worktree_content_hash.as_deref(),
    };

    let snapshot_version = compute_snapshot_version(&snapshot_input);

    Ok(ConflictSnapshot {
        conflict_id: conflict_id.to_string(),
        path: display_path,
        repository_root: canonical_root,
        worktree_root: canonical_worktree,
        snapshot_version,
        full_index_fingerprint: after_state.full_index_fingerprint,
        status,
        unsupported_reason,
        stages,
        worktree,
        effective_attributes,
        target_revision: Some(after_state.target_revision),
        operation: Some(after_state.operation),
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lossless_line_tokens_invariants() {
        let cases = [
            "",
            "single line without newline",
            "single line with lf\n",
            "single line with crlf\r\n",
            "line 1\r\nline 2\nline 3",
            "trailing crlf\r\n",
            "multiple\n\n\nnewlines\n",
            "\r\n\r\n",
            "lone\rcarriage\rreturn",
        ];

        for case in cases {
            let tokens = split_lossless_line_tokens(case);
            let joined: String = tokens.concat();
            assert_eq!(
                joined, case,
                "Tokens concatenated must reproduce original input verbatim"
            );
        }

        assert!(split_lossless_line_tokens("").is_empty());
        assert_eq!(
            split_lossless_line_tokens("a\nb\r\nc"),
            vec!["a\n", "b\r\n", "c"]
        );
    }

    #[test]
    fn test_split_lossless_line_tokens_bounded_rejections() {
        assert!(split_lossless_line_tokens_bounded("a\nb\nc", 2, 100).is_err());
        assert!(split_lossless_line_tokens_bounded("very long line\n", 10, 5).is_err());
        assert!(split_lossless_line_tokens_bounded("ok line\n", 10, 20).is_ok());
    }

    #[test]
    fn test_encode_decode_conflict_id_lossless() {
        let raw_ascii = b"src/index.ts";
        let cid1 = encode_conflict_id(raw_ascii);
        assert!(cid1.starts_with("cid_"));
        assert_eq!(decode_conflict_id(&cid1).as_deref(), Some(raw_ascii.as_slice()));

        // Non-UTF-8 bytes preserved losslessly
        let raw_non_utf8 = b"invalid_\xFF\xFE_path.txt";
        let cid2 = encode_conflict_id(raw_non_utf8);
        assert_eq!(
            decode_conflict_id(&cid2).as_deref(),
            Some(raw_non_utf8.as_slice())
        );

        // Bad prefix or invalid hex returns None
        assert_eq!(decode_conflict_id("not_a_cid"), None);
        assert_eq!(decode_conflict_id("cid_nothex!"), None);
    }

    #[test]
    fn test_detect_conflict_markers_boundary() {
        assert!(!detect_conflict_markers("normal text\nwith regular lines"));
        assert!(!detect_conflict_markers("<<<<<<< only start marker\nrest of file"));
        assert!(!detect_conflict_markers(">>>>>>> only end marker\nrest of file"));
        assert!(detect_conflict_markers(
            "<<<<<<< ours\nours content\n=======\ntheirs content\n>>>>>>> theirs\n"
        ));
        assert!(detect_conflict_markers(
            "  <<<<<<< indented\nmiddle\n  >>>>>>> indented\n"
        ));
    }

    #[test]
    fn test_is_binary_content_detection() {
        assert!(!is_binary_content(b"hello world\n"));
        assert!(!is_binary_content(b"\xEF\xBB\xBFUTF8 BOM text"));
        assert!(is_binary_content(b"hello\x00world"));
        assert!(is_binary_content(b"\x89PNG\r\n\x1a\n\x00\x00\x00"));
    }

    #[test]
    fn test_snapshot_version_sensitivity() {
        let state1 = StateFingerprint {
            target_revision: "rev1".to_string(),
            operation: "merge".to_string(),
            full_index_fingerprint: "idx1".to_string(),
            worktree_mtime_nanos: 100,
            worktree_size: 50,
            worktree_content_hash: Some("contenthash1".to_string()),
            attributes_fingerprint: "attrfp1".to_string(),
        };
        let stages = ConflictStages {
            base: None,
            ours: StageDescriptor {
                stage: 2,
                path: Some("file.txt".to_string()),
                oid: Some("1111111111111111111111111111111111111111".to_string()),
                mode: 0o100644,
                byte_size: 10,
                kind: StageKind::Text,
                text_tokens: Some(vec!["ours\n".to_string()]),
            },
            theirs: StageDescriptor {
                stage: 3,
                path: Some("file.txt".to_string()),
                oid: Some("2222222222222222222222222222222222222222".to_string()),
                mode: 0o100644,
                byte_size: 12,
                kind: StageKind::Text,
                text_tokens: Some(vec!["theirs\n".to_string()]),
            },
        };
        let worktree = WorktreeDescriptor {
            exists: true,
            kind: WorktreeKind::Regular,
            mode: 0o100644,
            byte_length: 20,
            text_tokens: Some(vec!["disk\n".to_string()]),
            has_conflict_markers: true,
            is_dirty_vs_stages: true,
        };
        let attrs = EffectiveAttributes {
            eol: Some("lf".to_string()),
            encoding: None,
            ident: false,
            filter_qualified: true,
            text: None,
            core_autocrlf: None,
            core_eol: None,
        };

        let input1 = SnapshotInput {
            canonical_root: "/repo",
            canonical_worktree: "/worktree",
            state: &state1,
            conflict_path: "file.txt",
            stages: &stages,
            worktree: &worktree,
            effective_attrs: &attrs,
            worktree_content_hash: Some("diskcontenthash1"),
        };

        let hash1 = compute_snapshot_version(&input1);
        let hash1_repeat = compute_snapshot_version(&input1);
        assert_eq!(hash1, hash1_repeat, "Identical inputs must yield identical hash");

        // Changing operation changes hash
        let mut state_op_changed = state1.clone();
        state_op_changed.operation = "rebase".to_string();
        let input_op_changed = SnapshotInput {
            state: &state_op_changed,
            ..input1
        };
        let hash_op_changed = compute_snapshot_version(&input_op_changed);
        assert_ne!(hash1, hash_op_changed);

        // Changing worktree content hash changes hash
        let input_content_changed = SnapshotInput {
            worktree_content_hash: Some("diskcontenthash2"),
            ..input1
        };
        let hash_content_changed = compute_snapshot_version(&input_content_changed);
        assert_ne!(hash1, hash_content_changed);
    }
}
