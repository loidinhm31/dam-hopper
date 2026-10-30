use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::session_changes::root::{
    match_untargeted_cwd_to_project_root, validate_project_root_preflight, PreflightBudget,
};
use crate::session_changes::store::SessionChangesService;
use crate::session_changes::types::*;

#[derive(Debug, Clone)]
pub struct BoundTerminalTarget {
    pub project_name: Option<String>,
    pub worktree_path: Option<String>,
    pub canonical_root: PathBuf,
}

/// Validate launch directory and determine canonical authorized VCS root for tracking.
pub fn resolve_launch_target_binding(
    project_root: Option<&Path>,
    launch_cwd: &Path,
    configured_projects: &[PathBuf],
) -> Result<PathBuf, ErrorCode> {
    let mut budget = PreflightBudget::default();

    if let Some(proj) = project_root {
        let validated = validate_project_root_preflight(proj, ".", None, &mut budget)
            .map_err(|_| ErrorCode::TargetUnavailable)?;
        Ok(validated.canonical_root)
    } else {
        match_untargeted_cwd_to_project_root(launch_cwd, configured_projects, &mut budget)
            .map_err(|_| ErrorCode::TargetUnavailable)
    }
}

/// Retrieve retained session selector list for an exited terminal.
pub fn get_retained_session_list(
    service: &Arc<SessionChangesService>,
    terminal_id: &str,
    terminal_incarnation: &str,
) -> Result<RetainedSessionList, ErrorCode> {
    if !is_valid_canonical_decimal_string(terminal_incarnation) {
        return Err(ErrorCode::IncarnationMismatch);
    }

    let records = service.records.lock();
    let mut sessions = Vec::new();

    for (k, rec) in records.iter() {
        if k.terminal_id == terminal_id && k.terminal_incarnation == terminal_incarnation {
            sessions.push(RetainedSessionEntry {
                omp_session_id: k.omp_session_id.clone(),
                root_id: Some(k.root_id.clone()),
                baseline_id: rec.baseline_id.clone(),
                origin: rec.origin,
                state: rec.state,
                captured_at_ms: rec.captured_at_ms,
            });
            if sessions.len() >= MAX_RETAINED_IDENTITIES {
                break;
            }
        }
    }

    Ok(RetainedSessionList {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: terminal_incarnation.to_string(),
        sessions,
    })
}
