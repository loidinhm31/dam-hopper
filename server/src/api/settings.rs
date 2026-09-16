use axum::{body::Bytes, extract::State, http::StatusCode, response::IntoResponse, Json};

use crate::config::read_config;
use crate::state::project_roots_from_config;
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/settings/cache-clear  (cache:clear IPC)
// ---------------------------------------------------------------------------

pub async fn cache_clear(State(state): State<AppState>) -> impl IntoResponse {
    // In the Rust server there's no in-process cache beyond RwLock fields.
    // Re-reading config is the closest equivalent.
    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    match read_config(&config_path) {
        Ok(mut cfg) => {
            {
                let timing = state.idle_suspend_timing.read().await;
                state.idle_suspend_policy.apply_to_config(&mut cfg, &timing);
            }
            state.media_tickets.revoke_all();
            state.fs.reinit_sandbox(project_roots_from_config(&cfg));
            state
                .host_resource_monitor
                .reconfigure(cfg.server.host_resources.clone())
                .await;
            *state.config.write().await = cfg;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// POST /api/settings/reset  (workspace:reset IPC)
// ---------------------------------------------------------------------------

pub async fn reset(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    state.pty_manager.dispose().map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })).into_response())
}

// ---------------------------------------------------------------------------
// GET /api/settings/export/workspace.toml
// ---------------------------------------------------------------------------

pub async fn export_workspace_settings(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let _workspace_guard = state.workspace_context_guard.read().await;
    let config_path = state.config.read().await.config_path.clone();
    let bytes = std::fs::read(&config_path).map_err(|e| {
        ApiError::from_app(crate::error::AppError::Config(format!(
            "Failed to read workspace configuration file: {e}"
        )))
    })?;

    Ok((
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/toml; charset=utf-8",
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=\"dam-hopper.toml\"",
            ),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    ))
}

// ---------------------------------------------------------------------------
// POST /api/settings/import/workspace.toml
// ---------------------------------------------------------------------------

const BACKUP_PREFIX: &str = "dam-hopper.toml.bak.";
const MAX_BACKUPS_RETAINED: usize = 5;

fn create_backup(
    target_path: &std::path::Path,
    old_bytes: &[u8],
) -> Result<String, crate::error::AppError> {
    let parent = target_path.parent().unwrap_or(std::path::Path::new("."));
    for attempt in 0..10 {
        let now = chrono::Utc::now().format("%Y%m%dT%H%M%S_%6fZ");
        let filename = format!("{BACKUP_PREFIX}{now}");
        let backup_path = parent.join(&filename);

        #[cfg(unix)]
        let file_res = {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&backup_path)
        };

        #[cfg(not(unix))]
        let file_res = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup_path);

        match file_res {
            Ok(mut file) => {
                use std::io::Write;
                if let Err(e) = file.write_all(old_bytes) {
                    let _ = std::fs::remove_file(&backup_path);
                    return Err(crate::error::AppError::Config(format!(
                        "Cannot write backup file {}: {e}",
                        backup_path.display()
                    )));
                }
                return Ok(filename);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempt < 9 => {
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }
            Err(e) => {
                return Err(crate::error::AppError::Config(format!(
                    "Cannot create backup file {}: {e}",
                    backup_path.display()
                )));
            }
        }
    }
    Err(crate::error::AppError::Config(
        "Exceeded retry attempts for backup creation".to_string(),
    ))
}

fn is_server_backup_file(name: &str) -> bool {
    if let Some(ts) = name.strip_prefix(BACKUP_PREFIX) {
        if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(ts, "%Y%m%dT%H%M%S_%6fZ") {
            return parsed.format("%Y%m%dT%H%M%S_%6fZ").to_string() == ts;
        }
    }
    false
}

fn prune_backups(parent: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    let mut backup_files = Vec::new();
    for entry in entries.flatten() {
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_server_backup_file(&name) {
                    backup_files.push((name, entry.path()));
                }
            }
        }
    }
    backup_files.sort_by(|a, b| b.0.cmp(&a.0));
    if backup_files.len() > MAX_BACKUPS_RETAINED {
        for (_, path) in &backup_files[MAX_BACKUPS_RETAINED..] {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWorkspaceResponse {
    pub imported: bool,
    pub file_name: String,
    pub backup_file_name: String,
    pub workspace_name: Option<String>,
}

pub async fn import_workspace_settings(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Json<ImportWorkspaceResponse>, ApiError> {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let is_toml = content_type
        .split(';')
        .next()
        .map(|s| s.trim().eq_ignore_ascii_case("application/toml"))
        .unwrap_or(false);
    if !is_toml {
        return Err(ApiError::from_app(
            crate::error::AppError::UnsupportedMediaType(
                "Content-Type must be application/toml".to_string(),
            ),
        ));
    }

    let toml_str = std::str::from_utf8(&body).map_err(|_| {
        ApiError::from_app(crate::error::AppError::InvalidInput(
            "Request body must be valid UTF-8 TOML".to_string(),
        ))
    })?;

    let initial_path = state.config.read().await.config_path.clone();
    let _workspace_guard = state.workspace_context_guard.write().await;
    let current_path = state.config.read().await.config_path.clone();
    if current_path != initial_path {
        return Err(ApiError::from_app(crate::error::AppError::Conflict(
            "Workspace changed during admission".to_string(),
        )));
    }

    let old_bytes = std::fs::read(&current_path).map_err(|e| {
        ApiError::from_app(crate::error::AppError::Config(format!(
            "Cannot read active config file {}: {e}",
            current_path.display()
        )))
    })?;
    let current_cfg = state.config.read().await.clone();

    let candidate_cfg = crate::config::parse_config_str_at_path(toml_str, &current_path)
        .map_err(ApiError::from_app)?;

    crate::config::validate_protected_config_replacement(&current_cfg, &candidate_cfg)
        .map_err(ApiError::from_app)?;

    let backup_file_name =
        create_backup(&current_path, &old_bytes).map_err(ApiError::from_app)?;

    if let Err(write_err) = crate::utils::fs::atomic_write_bytes(&current_path, &body) {
        let parent = current_path.parent().unwrap_or(std::path::Path::new("."));
        let backup_path = parent.join(&backup_file_name);
        let _ = std::fs::remove_file(&backup_path);
        return Err(ApiError::from_app(write_err));
    }

    if let Err(reload_err) = crate::api::config::reload_config_locked(&state).await {
        let restore_res = crate::utils::fs::atomic_write_bytes(&current_path, &old_bytes);
        let reload_restore_res = crate::api::config::reload_config_locked(&state).await;
        let parent = current_path.parent().unwrap_or(std::path::Path::new("."));
        let backup_path = parent.join(&backup_file_name);
        if restore_res.is_ok() && reload_restore_res.is_ok() {
            let _ = std::fs::remove_file(&backup_path);
            return Err(ApiError::from_app(crate::error::AppError::Internal(format!(
                "Failed to reload imported config, restored previous configuration: {}",
                reload_err.0
            ))));
        } else {
            return Err(ApiError::from_app(crate::error::AppError::Internal(format!(
                "Failed to reload imported config and automatic recovery failed (disk: {}, runtime: {}). Backup retained at {}: {}",
                restore_res.is_ok(),
                reload_restore_res.is_ok(),
                backup_file_name,
                reload_err.0
            ))));
        }
    }

    let parent = current_path.parent().unwrap_or(std::path::Path::new("."));
    prune_backups(parent);

    let workspace_name = candidate_cfg.workspace.name.clone();
    Ok(Json(ImportWorkspaceResponse {
        imported: true,
        file_name: "dam-hopper.toml".to_string(),
        backup_file_name,
        workspace_name: Some(workspace_name),
    }))
}
// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

pub async fn health(_state: State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "schemaVersion": 1,
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "role": "api",
    }))
}
