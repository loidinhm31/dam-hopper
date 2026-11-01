use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use crate::session_changes::types::{
    MAX_PATH_BYTES, MAX_PATH_DEPTH, ROOT_PREFLIGHT_MAX_CANDIDATES,
    ROOT_PREFLIGHT_MAX_DURATION_SECS, ROOT_PREFLIGHT_MAX_INPUT_PATH_BYTES,
    ROOT_PREFLIGHT_MAX_METADATA_OPS, ROOT_PREFLIGHT_MAX_SCRATCH_BYTES,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootPreflightError {
    InvalidRootId(String),
    RootEscapesProject,
    GitMarkerMissing,
    BudgetExhausted(String),
    TargetUnavailable,
    Io(String),
}

impl std::fmt::Display for RootPreflightError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRootId(msg) => write!(f, "Invalid root ID: {msg}"),
            Self::RootEscapesProject => write!(f, "VCS root escapes project sandbox"),
            Self::GitMarkerMissing => write!(f, "Git marker missing in selected root"),
            Self::BudgetExhausted(msg) => write!(f, "Root preflight budget exhausted: {msg}"),
            Self::TargetUnavailable => write!(f, "Target unavailable or ambiguous"),
            Self::Io(msg) => write!(f, "Filesystem error: {msg}"),
        }
    }
}

impl std::error::Error for RootPreflightError {}

#[derive(Debug, Clone)]
pub struct ValidatedRoot {
    pub canonical_root: PathBuf,
    pub root_id: String,
    pub canonical_identity: String,
}

pub struct PreflightBudget {
    start_time: Instant,
    max_duration: Duration,
    metadata_ops: usize,
    max_metadata_ops: usize,
    scratch_bytes: usize,
    max_scratch_bytes: usize,
}

impl Default for PreflightBudget {
    fn default() -> Self {
        Self {
            start_time: Instant::now(),
            max_duration: Duration::from_secs(ROOT_PREFLIGHT_MAX_DURATION_SECS),
            metadata_ops: 0,
            max_metadata_ops: ROOT_PREFLIGHT_MAX_METADATA_OPS,
            scratch_bytes: 0,
            max_scratch_bytes: ROOT_PREFLIGHT_MAX_SCRATCH_BYTES,
        }
    }
}

impl PreflightBudget {
    pub fn new_with_limits(max_ops: usize, max_scratch: usize, max_duration: Duration) -> Self {
        Self {
            start_time: Instant::now(),
            max_duration,
            metadata_ops: 0,
            max_metadata_ops: max_ops,
            scratch_bytes: 0,
            max_scratch_bytes: max_scratch,
        }
    }

    pub fn record_op(&mut self) -> Result<(), RootPreflightError> {
        if self.start_time.elapsed() > self.max_duration {
            return Err(RootPreflightError::BudgetExhausted(
                "Preflight time limit exceeded".into(),
            ));
        }
        self.metadata_ops += 1;
        if self.metadata_ops > self.max_metadata_ops {
            return Err(RootPreflightError::BudgetExhausted(
                "Preflight metadata operations limit exceeded".into(),
            ));
        }
        Ok(())
    }

    pub fn record_scratch(&mut self, bytes: usize) -> Result<(), RootPreflightError> {
        self.scratch_bytes += bytes;
        if self.scratch_bytes > self.max_scratch_bytes {
            return Err(RootPreflightError::BudgetExhausted(
                "Preflight scratch memory limit exceeded".into(),
            ));
        }
        Ok(())
    }
}

/// Validate root path syntax and constraints before touching the filesystem.
pub fn validate_root_id_syntax(root_id: &str) -> Result<(), RootPreflightError> {
    if root_id.is_empty() {
        return Err(RootPreflightError::InvalidRootId("rootId cannot be empty".into()));
    }
    if root_id.len() > MAX_PATH_BYTES {
        return Err(RootPreflightError::InvalidRootId("rootId exceeds 4096 bytes".into()));
    }
    if root_id.contains('\0') {
        return Err(RootPreflightError::InvalidRootId("rootId contains NUL byte".into()));
    }
    if root_id.contains('*') {
        return Err(RootPreflightError::InvalidRootId("rootId contains aggregate wildcard '*'".into()));
    }

    let path = Path::new(root_id);
    if path.is_absolute() {
        return Err(RootPreflightError::InvalidRootId("rootId cannot be absolute".into()));
    }

    let mut component_count = 0;
    for component in path.components() {
        component_count += 1;
        if component_count > MAX_PATH_DEPTH {
            return Err(RootPreflightError::InvalidRootId("rootId exceeds 64 components".into()));
        }
        match component {
            Component::ParentDir => {
                return Err(RootPreflightError::InvalidRootId("parent traversal '..' is prohibited".into()));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(RootPreflightError::InvalidRootId("root prefix is prohibited".into()));
            }
            Component::CurDir => {}
            Component::Normal(c) => {
                if c.is_empty() {
                    return Err(RootPreflightError::InvalidRootId("empty path component is prohibited".into()));
                }
            }
        }
    }

    Ok(())
}

/// Direct one-root preflight validation for configured projects.
pub fn validate_project_root_preflight(
    project_path: &Path,
    root_id: &str,
    cwd_hint: Option<&str>,
    budget: &mut PreflightBudget,
) -> Result<ValidatedRoot, RootPreflightError> {
    validate_root_id_syntax(root_id)?;
    budget.record_scratch(root_id.len())?;

    budget.record_op()?;
    let canonical_project = dunce::canonicalize(project_path)
        .map_err(|e| RootPreflightError::Io(format!("Cannot canonicalize project path: {e}")))?;
    budget.record_scratch(canonical_project.as_os_str().len())?;

    let candidate = if root_id == "." {
        canonical_project.clone()
    } else {
        budget.record_op()?;
        let joined = canonical_project.join(root_id);
        budget.record_scratch(joined.as_os_str().len())?;
        dunce::canonicalize(&joined)
            .map_err(|e| RootPreflightError::Io(format!("Cannot canonicalize target root: {e}")))?
    };

    if !candidate.starts_with(&canonical_project) {
        return Err(RootPreflightError::RootEscapesProject);
    }

    // Direct .git marker check: marker must exist directly in candidate directory
    budget.record_op()?;
    let git_marker = candidate.join(".git");
    budget.record_scratch(git_marker.as_os_str().len())?;

    budget.record_op()?;
    let marker_meta = std::fs::symlink_metadata(&git_marker)
        .map_err(|_| RootPreflightError::GitMarkerMissing)?;

    if !marker_meta.is_dir() && !marker_meta.is_file() {
        return Err(RootPreflightError::GitMarkerMissing);
    }

    // If cwd_hint is provided, validate syntax and containment within candidate root
    if let Some(hint) = cwd_hint {
        if hint.len() <= MAX_PATH_BYTES && !hint.contains('\0') {
            budget.record_scratch(hint.len())?;
            budget.record_op()?;
            if let Ok(canon_hint) = dunce::canonicalize(hint) {
                budget.record_scratch(canon_hint.as_os_str().len())?;
                // hint is acceptable if it starts with candidate
                let _ = canon_hint.starts_with(&candidate);
            }
        }
    }

    let canonical_identity = candidate.to_string_lossy().to_string();

    Ok(ValidatedRoot {
        canonical_root: candidate,
        root_id: root_id.to_string(),
        canonical_identity,
    })
}

/// For untargeted terminals: find matching configured project sandbox root.
pub fn match_untargeted_cwd_to_project_root(
    canonical_launch_cwd: &Path,
    configured_project_roots: &[PathBuf],
    budget: &mut PreflightBudget,
) -> Result<PathBuf, RootPreflightError> {
    if configured_project_roots.len() > ROOT_PREFLIGHT_MAX_CANDIDATES {
        return Err(RootPreflightError::BudgetExhausted(
            "Configured candidate roots exceed 128".into(),
        ));
    }

    let mut total_input_bytes = 0;
    for r in configured_project_roots {
        total_input_bytes += r.as_os_str().len();
    }
    if total_input_bytes > ROOT_PREFLIGHT_MAX_INPUT_PATH_BYTES {
        return Err(RootPreflightError::BudgetExhausted(
            "Configured candidate root paths exceed 512 KiB".into(),
        ));
    }

    let mut matches = Vec::new();
    for root in configured_project_roots {
        budget.record_op()?;
        if let Ok(canon) = dunce::canonicalize(root) {
            if canonical_launch_cwd.starts_with(&canon) {
                matches.push(canon);
            }
        }
    }

    if matches.len() != 1 {
        // Zero or ambiguous matches => targetUnavailable
        return Err(RootPreflightError::TargetUnavailable);
    }

    Ok(matches.remove(0))
}
