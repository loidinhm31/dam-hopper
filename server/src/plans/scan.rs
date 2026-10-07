use std::path::Path;

use thiserror::Error;

use crate::fs::error::FsError;
use crate::fs::secure_path::{self, FileMarkerKind};
use crate::plans::dto::*;

pub const MAX_VISITED_ENTRIES: usize = 5000;
pub const MAX_RELATIVE_PATH_BYTES: usize = 4096;
pub const MAX_PATH_COMPONENTS: usize = 32;
pub const MAX_WATCH_PATHS: usize = 33;
pub const MAX_JSON_BYTES: usize = 2 * 1024 * 1024; // 2 MiB

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlansError {
    #[error("invalid query parameter")]
    InvalidQuery(&'static str),

    #[error("path rejected")]
    PathRejected(&'static str),

    #[error("permission denied")]
    PermissionDenied,

    #[error("not found")]
    NotFound(&'static str),

    #[error("target changed")]
    TargetChanged,

    #[error("response too large")]
    ResponseTooLarge,

    #[error("filesystem unavailable")]
    FsUnavailable,

    #[error("read failed")]
    ReadFailed,
}

impl PlansError {
    pub fn status_code(&self) -> u16 {
        match self {
            PlansError::InvalidQuery(_) => 400,
            PlansError::PathRejected(_) | PlansError::PermissionDenied => 403,
            PlansError::NotFound(_) => 404,
            PlansError::TargetChanged => 409,
            PlansError::ResponseTooLarge => 413,
            PlansError::FsUnavailable => 503,
            PlansError::ReadFailed => 500,
        }
    }

    pub fn api_code(&self) -> &'static str {
        match self {
            PlansError::InvalidQuery(_) => "PLANS_INVALID_QUERY",
            PlansError::PathRejected(_) => "PLANS_PATH_REJECTED",
            PlansError::PermissionDenied => "PLANS_PERMISSION_DENIED",
            PlansError::NotFound(_) => "PLANS_NOT_FOUND",
            PlansError::TargetChanged => "PLANS_TARGET_CHANGED",
            PlansError::ResponseTooLarge => "PLANS_RESPONSE_TOO_LARGE",
            PlansError::FsUnavailable => "PLANS_FS_UNAVAILABLE",
            PlansError::ReadFailed => "PLANS_READ_FAILED",
        }
    }
}

impl From<FsError> for PlansError {
    fn from(err: FsError) -> Self {
        match err {
            FsError::NotFound => PlansError::NotFound("item not found"),
            FsError::PathEscape | FsError::MutationRefused(_) => {
                PlansError::PathRejected("path access rejected")
            }
            FsError::PermissionDenied => PlansError::PermissionDenied,
            FsError::TooLarge(_) => PlansError::ResponseTooLarge,
            FsError::Unavailable => PlansError::FsUnavailable,
            FsError::Conflict => PlansError::TargetChanged,
            FsError::InvalidName(_) => PlansError::InvalidQuery("invalid name"),
            FsError::Io(_) => PlansError::ReadFailed,
        }
    }
}

pub fn is_utility_basename(name: &str) -> bool {
    name.eq_ignore_ascii_case("reports")
        || name.eq_ignore_ascii_case("research")
        || name.eq_ignore_ascii_case("templates")
        || name.eq_ignore_ascii_case("scout")
        || name.eq_ignore_ascii_case("node_modules")
}

pub fn validate_plans_relative_path(path: &str) -> Result<String, PlansError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok("plans".to_string());
    }
    if trimmed.len() > MAX_RELATIVE_PATH_BYTES {
        return Err(PlansError::InvalidQuery("path exceeds maximum length"));
    }
    if trimmed.contains('\0') {
        return Err(PlansError::InvalidQuery("path contains null byte"));
    }
    let p = Path::new(trimmed);
    if p.is_absolute() {
        return Err(PlansError::PathRejected("path must be relative"));
    }

    let mut components = Vec::new();
    for c in p.components() {
        match c {
            std::path::Component::Normal(name) => {
                let s = name
                    .to_str()
                    .ok_or(PlansError::InvalidQuery("invalid UTF-8 in path"))?;
                components.push(s);
            }
            std::path::Component::CurDir => continue,
            _ => return Err(PlansError::PathRejected("path traversal not allowed")),
        }
    }

    if components.is_empty() {
        return Ok("plans".to_string());
    }
    if components.len() > MAX_PATH_COMPONENTS {
        return Err(PlansError::PathRejected("path exceeds component limit"));
    }
    if components[0] != "plans" {
        return Err(PlansError::PathRejected(
            "path must be within plans directory",
        ));
    }
    Ok(components.join("/"))
}

pub fn compute_watch_paths(rel_path: &str) -> Vec<String> {
    let mut paths = Vec::new();
    paths.push(".".to_string());
    let normalized = rel_path.trim_matches('/');
    let mut current = String::new();
    for part in normalized.split('/') {
        if part.is_empty() {
            continue;
        }
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(part);
        paths.push(current.clone());
    }
    paths.sort();
    paths.dedup();
    if paths.len() > MAX_WATCH_PATHS {
        paths.truncate(MAX_WATCH_PATHS);
    }
    paths
}

pub fn scan_plan_folders(
    root: &Path,
    requested_path: &str,
    target: PlanTarget,
) -> Result<PlanFoldersResponse, PlansError> {
    let normalized_path = validate_plans_relative_path(requested_path)?;
    let watch_paths = compute_watch_paths(&normalized_path);

    let marker = match secure_path::probe_file_marker(root, Path::new(&normalized_path)) {
        Ok(m) => m,
        Err(e) => return Err(PlansError::from(e)),
    };

    match marker {
        FileMarkerKind::NotFound => {
            if normalized_path == "plans" {
                return Ok(PlanFoldersResponse {
                    target,
                    path: "plans".to_string(),
                    kind: PlanFolderKind::Collection,
                    folder_state: PlanFolderState::Missing,
                    folders: Vec::new(),
                    listing: FolderListing {
                        complete: true,
                        entries_visited: 0,
                        limits_reached: Vec::new(),
                    },
                    watch_paths: vec![".".to_string()],
                    diagnostics: Vec::new(),
                });
            }
            return Err(PlansError::NotFound("folder not found"));
        }
        FileMarkerKind::Symlink => {
            return Err(PlansError::PathRejected("symlink paths are not allowed"));
        }
        FileMarkerKind::RegularFile { .. } | FileMarkerKind::Other => {
            return Err(PlansError::PathRejected("path is not a directory"));
        }
        FileMarkerKind::Directory => {}
    }

    let plan_md_rel = format!("{}/plan.md", normalized_path);
    let has_regular_plan_md = match secure_path::probe_file_marker(root, Path::new(&plan_md_rel)) {
        Ok(FileMarkerKind::RegularFile { .. }) => true,
        _ => false,
    };

    if has_regular_plan_md {
        return Ok(PlanFoldersResponse {
            target,
            path: normalized_path,
            kind: PlanFolderKind::Plan,
            folder_state: PlanFolderState::Present,
            folders: Vec::new(),
            listing: FolderListing {
                complete: true,
                entries_visited: 0,
                limits_reached: Vec::new(),
            },
            watch_paths,
            diagnostics: Vec::new(),
        });
    }

    let kind = if normalized_path == "plans" {
        PlanFolderKind::Collection
    } else {
        PlanFolderKind::Group
    };

    let (raw_entries, complete) = match secure_path::read_immediate_dir(
        root,
        Path::new(&normalized_path),
        MAX_VISITED_ENTRIES,
    ) {
        Ok(res) => res,
        Err(e) => return Err(PlansError::from(e)),
    };

    let entries_visited = raw_entries.len();
    let mut limits_reached = Vec::new();
    if !complete {
        limits_reached.push("entries".to_string());
    }

    let mut folders = Vec::new();
    for entry in raw_entries {
        if entry.name.starts_with('.') {
            continue;
        }
        if is_utility_basename(&entry.name) {
            continue;
        }
        if entry.is_symlink {
            continue;
        }
        if !entry.is_dir {
            continue;
        }
        let child_path = format!("{}/{}", normalized_path, entry.name);
        folders.push(FolderEntry {
            path: child_path,
            name: entry.name,
        });
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));

    let mut response = PlanFoldersResponse {
        target,
        path: normalized_path,
        kind,
        folder_state: PlanFolderState::Present,
        folders,
        listing: FolderListing {
            complete,
            entries_visited,
            limits_reached,
        },
        watch_paths,
        diagnostics: Vec::new(),
    };

    if json_byte_len(&response)? > MAX_JSON_BYTES {
        response
            .listing
            .limits_reached
            .push("response-bytes".to_string());
        response.listing.complete = false;

        // Count the final envelope and each retained whole entry once. This includes
        // JSON escaping and commas without allocating or repeatedly encoding prefixes.
        let mut folders = std::mem::take(&mut response.folders);
        let mut bytes = json_byte_len(&response)?;
        if bytes > MAX_JSON_BYTES {
            return Err(PlansError::ResponseTooLarge);
        }
        let mut retained = 0;
        for folder in &folders {
            let entry_bytes = json_byte_len(folder)? + usize::from(retained > 0);
            if entry_bytes > MAX_JSON_BYTES - bytes {
                break;
            }
            bytes += entry_bytes;
            retained += 1;
        }
        folders.truncate(retained);
        response.folders = folders;
    }

    Ok(response)
}

fn json_byte_len(value: &impl serde::Serialize) -> Result<usize, PlansError> {
    struct ByteCounter(usize);

    impl std::io::Write for ByteCounter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| std::io::Error::other("JSON byte count overflow"))?;
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let mut counter = ByteCounter(0);
    serde_json::to_writer(&mut counter, value).map_err(|_| PlansError::ReadFailed)?;
    Ok(counter.0)
}

pub fn read_selected_plan(
    root: &Path,
    plan_path: &str,
    target: PlanTarget,
) -> Result<SelectedPlanResponse, PlansError> {
    let normalized_path = validate_plans_relative_path(plan_path)?;
    if normalized_path == "plans" {
        return Err(PlansError::InvalidQuery("plan path cannot be root plans"));
    }

    match secure_path::probe_file_marker(root, Path::new(&normalized_path)) {
        Ok(FileMarkerKind::Directory) => {}
        Ok(FileMarkerKind::NotFound) => {
            return Err(PlansError::NotFound("plan directory not found"));
        }
        Ok(FileMarkerKind::Symlink) => {
            return Err(PlansError::PathRejected(
                "symlink plan directory not allowed",
            ));
        }
        _ => return Err(PlansError::PathRejected("plan path is not a directory")),
    }

    let plan_md_rel = format!("{}/plan.md", normalized_path);
    match secure_path::probe_file_marker(root, Path::new(&plan_md_rel)) {
        Ok(FileMarkerKind::RegularFile { .. }) => {}
        Ok(FileMarkerKind::NotFound) => {
            return Err(PlansError::NotFound("plan.md not found"));
        }
        Ok(FileMarkerKind::Symlink) => {
            return Err(PlansError::NotFound("symlink plan.md not allowed"));
        }
        _ => return Err(PlansError::NotFound("plan.md is not a regular file")),
    }

    let plan_snap_res = secure_path::read_regular_snapshot(
        root,
        Path::new(&plan_md_rel),
        MAX_DOCUMENT_BYTES as u64,
    );

    let (plan_state, plan_bytes, plan_size, plan_modified) = match plan_snap_res {
        Ok(snap) => (
            PlanDocumentState::Readable,
            Some(snap.bytes),
            Some(snap.size_bytes),
            snap.modified_at,
        ),
        Err(FsError::TooLarge(size)) => (PlanDocumentState::Oversize, None, Some(size), None),
        Err(FsError::Conflict) => (PlanDocumentState::Changed, None, None, None),
        Err(_) => (PlanDocumentState::Unreadable, None, None, None),
    };

    let progress_md_rel = format!("{}/progress.md", normalized_path);
    let (progress_state, progress_bytes, progress_size, progress_modified, progress_diag) =
        match secure_path::probe_file_marker(root, Path::new(&progress_md_rel)) {
            Ok(FileMarkerKind::NotFound) => (PlanDocumentState::Absent, None, None, None, None),
            Ok(FileMarkerKind::Symlink) => (
                PlanDocumentState::Unreadable,
                None,
                None,
                None,
                Some(Diagnostic {
                    code: DIAG_PROGRESS_UNREADABLE.to_string(),
                    path: Some(progress_md_rel.clone()),
                    line: None,
                    message: "progress.md is a symlink and cannot be read".to_string(),
                }),
            ),
            Ok(FileMarkerKind::RegularFile { .. }) => {
                match secure_path::read_regular_snapshot(
                    root,
                    Path::new(&progress_md_rel),
                    MAX_DOCUMENT_BYTES as u64,
                ) {
                    Ok(snap) => (
                        PlanDocumentState::Readable,
                        Some(snap.bytes),
                        Some(snap.size_bytes),
                        snap.modified_at,
                        None,
                    ),
                    Err(FsError::TooLarge(size)) => (
                        PlanDocumentState::Oversize,
                        None,
                        Some(size),
                        None,
                        Some(Diagnostic {
                            code: DIAG_DOCUMENT_TOO_LARGE.to_string(),
                            path: Some(progress_md_rel.clone()),
                            line: None,
                            message: "progress.md exceeds 64 KiB maximum size".to_string(),
                        }),
                    ),
                    Err(FsError::Conflict) => (
                        PlanDocumentState::Changed,
                        None,
                        None,
                        None,
                        Some(Diagnostic {
                            code: DIAG_DOCUMENT_CHANGED.to_string(),
                            path: Some(progress_md_rel.clone()),
                            line: None,
                            message: "progress.md changed during read".to_string(),
                        }),
                    ),
                    Err(_) => (
                        PlanDocumentState::Unreadable,
                        None,
                        None,
                        None,
                        Some(Diagnostic {
                            code: DIAG_PROGRESS_UNREADABLE.to_string(),
                            path: Some(progress_md_rel.clone()),
                            line: None,
                            message: "progress.md could not be read".to_string(),
                        }),
                    ),
                }
            }
            _ => (
                PlanDocumentState::Unreadable,
                None,
                None,
                None,
                Some(Diagnostic {
                    code: DIAG_PROGRESS_UNREADABLE.to_string(),
                    path: Some(progress_md_rel.clone()),
                    line: None,
                    message: "progress.md is not a regular file".to_string(),
                }),
            ),
        };

    let plan_doc = DocumentSnapshot {
        path: &plan_md_rel,
        state: plan_state,
        bytes: plan_bytes.as_deref(),
        size_bytes: plan_size,
        modified_at: plan_modified,
    };

    let prog_doc = DocumentSnapshot {
        path: &progress_md_rel,
        state: progress_state,
        bytes: progress_bytes.as_deref(),
        size_bytes: progress_size,
        modified_at: progress_modified,
    };

    let mut file_plan = crate::plans::parser::parse_plan(&normalized_path, &plan_doc, &prog_doc);

    if let Some(diag) = progress_diag {
        if !file_plan
            .diagnostics
            .iter()
            .any(|d| d.code == diag.code && d.path == diag.path)
        {
            file_plan.diagnostics.push(diag);
        }
    }

    let watch_paths = compute_watch_paths(&normalized_path);
    let diagnostics = file_plan.diagnostics.clone();

    let response = SelectedPlanResponse {
        target,
        plan: file_plan,
        watch_paths,
        diagnostics,
    };

    let json_bytes = serde_json::to_vec(&response).map_err(|_| PlansError::ReadFailed)?;
    if json_bytes.len() > MAX_JSON_BYTES {
        return Err(PlansError::ResponseTooLarge);
    }

    Ok(response)
}
