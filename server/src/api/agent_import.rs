use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;

use crate::agent_store::importer::{
    cleanup_import, import_from_repo, scan_local_dir, scan_repo, RepoScanItem,
};
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// POST /api/agent-import/scan  { repoUrl: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRepoBody {
    pub repo_url: String,
}

pub async fn scan_repo_handler(
    State(_state): State<AppState>,
    Json(body): Json<ScanRepoBody>,
) -> Result<impl IntoResponse, ApiError> {
    let result = scan_repo(&body.repo_url).await.map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({
        "repoUrl": result.repo_url,
        "tmpDir": result.tmp_dir,
        "items": result.items,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/agent-import/scan-local  { dirPath: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanLocalBody {
    pub dir_path: String,
}

pub async fn scan_local_handler(
    State(_state): State<AppState>,
    Json(body): Json<ScanLocalBody>,
) -> Result<impl IntoResponse, ApiError> {
    let path = std::path::Path::new(&body.dir_path);
    let result = scan_local_dir(path).await.map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({
        "dirPath": result.dir_path,
        "items": result.items,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/agent-import/confirm  { sourceDir, items, cleanup? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfirmBody {
    pub source_dir: String,
    pub items: Vec<RepoScanItem>,
    pub cleanup: Option<bool>,
}

pub async fn import_confirm_handler(
    State(state): State<AppState>,
    Json(body): Json<ImportConfirmBody>,
) -> Result<impl IntoResponse, ApiError> {
    let source_dir = std::path::Path::new(&body.source_dir);
    let store_path = state.agent_store.store_path().to_path_buf();

    let results = import_from_repo(source_dir, &body.items, &store_path)
        .await
        .map_err(ApiError::from_app)?;

    if body.cleanup.unwrap_or(false) {
        let _ = cleanup_import(source_dir).await;
    }

    Ok(Json(results))
}
