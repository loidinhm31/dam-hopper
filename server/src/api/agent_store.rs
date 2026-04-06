use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use std::path::PathBuf;

use crate::agent_store::{
    AgentItemCategory, AgentType, DistributionMethod,
    distributor,
    scanner::scan_project,
};
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// GET /api/agent-store?category=<cat>
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CategoryQuery {
    pub category: Option<AgentItemCategory>,
}

pub async fn list_items(
    State(state): State<AppState>,
    Query(q): Query<CategoryQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let items = state.agent_store.list(q.category).await.map_err(ApiError::from_app)?;
    Ok(Json(items))
}

// ---------------------------------------------------------------------------
// GET /api/agent-store/:category/:name
// ---------------------------------------------------------------------------

pub async fn get_item(
    State(state): State<AppState>,
    Path((category, name)): Path<(AgentItemCategory, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let item = state.agent_store.get(&name, category).await.map_err(ApiError::from_app)?;
    item.map(|i| Json(i).into_response())
        .ok_or_else(|| ApiError::from_app(crate::error::AppError::NotFound(format!("Item not found: {name}"))))
}

// ---------------------------------------------------------------------------
// GET /api/agent-store/:category/:name/content?fileName=<file>
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentQuery {
    pub file_name: Option<String>,
}

pub async fn get_item_content(
    State(state): State<AppState>,
    Path((category, name)): Path<(AgentItemCategory, String)>,
    Query(q): Query<ContentQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let content = state.agent_store
        .get_content(&name, category, q.file_name.as_deref())
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "content": content })))
}

// ---------------------------------------------------------------------------
// DELETE /api/agent-store/:category/:name
// ---------------------------------------------------------------------------

pub async fn remove_item(
    State(state): State<AppState>,
    Path((category, name)): Path<(AgentItemCategory, String)>,
) -> Result<impl IntoResponse, ApiError> {
    state.agent_store.remove(&name, category).await.map_err(ApiError::from_app)?;
    Ok((StatusCode::NO_CONTENT, ()))
}

// ---------------------------------------------------------------------------
// POST /api/agent-store/ship
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipBody {
    pub item_name: String,
    pub category: AgentItemCategory,
    pub project_name: String,
    pub agent: AgentType,
    pub method: Option<DistributionMethod>,
}

pub async fn ship_item(
    State(state): State<AppState>,
    Json(body): Json<ShipBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = resolve_project(&state, &body.project_name).await?;
    let method = body.method.unwrap_or(DistributionMethod::Symlink);
    let result = distributor::ship(
        state.agent_store.store_path(),
        &body.item_name,
        body.category,
        &project_path,
        body.agent,
        method,
    ).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// POST /api/agent-store/unship
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnshipBody {
    pub item_name: String,
    pub category: AgentItemCategory,
    pub project_name: String,
    pub agent: AgentType,
    pub force: Option<bool>,
}

pub async fn unship_item(
    State(state): State<AppState>,
    Json(body): Json<UnshipBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = resolve_project(&state, &body.project_name).await?;
    let result = distributor::unship(
        state.agent_store.store_path(),
        &body.item_name,
        body.category,
        &project_path,
        body.agent,
        body.force.unwrap_or(false),
    ).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// POST /api/agent-store/absorb
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsorbBody {
    pub item_name: String,
    pub category: AgentItemCategory,
    pub project_name: String,
    pub agent: AgentType,
}

pub async fn absorb_item(
    State(state): State<AppState>,
    Json(body): Json<AbsorbBody>,
) -> Result<impl IntoResponse, ApiError> {
    let project_path = resolve_project(&state, &body.project_name).await?;
    let result = distributor::absorb(
        state.agent_store.store_path(),
        &body.item_name,
        body.category,
        &project_path,
        body.agent,
    ).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// POST /api/agent-store/bulk-ship
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkShipBodyItem {
    pub name: String,
    pub category: AgentItemCategory,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkShipBodyProject {
    pub project_name: String,
    pub agent: AgentType,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkShipBody {
    pub items: Vec<BulkShipBodyItem>,
    pub projects: Vec<BulkShipBodyProject>,
    pub method: Option<DistributionMethod>,
}

pub async fn bulk_ship_items(
    State(state): State<AppState>,
    Json(body): Json<BulkShipBody>,
) -> Result<impl IntoResponse, ApiError> {
    let method = body.method.unwrap_or(DistributionMethod::Symlink);
    let store_path = state.agent_store.store_path().to_path_buf();

    let mut project_paths: Vec<(PathBuf, AgentType)> = Vec::new();
    for pb in &body.projects {
        let path = resolve_project(&state, &pb.project_name).await?;
        project_paths.push((path, pb.agent));
    }

    let items_ref: Vec<(&str, AgentItemCategory)> = body.items.iter()
        .map(|i| (i.name.as_str(), i.category))
        .collect();
    let projects_ref: Vec<(&std::path::Path, AgentType)> = project_paths.iter()
        .map(|(p, a)| (p.as_path(), *a))
        .collect();

    let results = distributor::bulk_ship(&store_path, &items_ref, &projects_ref, method).await;
    Ok(Json(results))
}

// ---------------------------------------------------------------------------
// GET /api/agent-store/matrix
// ---------------------------------------------------------------------------

pub async fn get_matrix(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let store_path = state.agent_store.store_path().to_path_buf();
    let items = state.agent_store.list(None).await.map_err(ApiError::from_app)?;
    let cfg = state.config.read().await;

    let items_ref: Vec<(&str, AgentItemCategory)> = items.iter()
        .map(|i| (i.name.as_str(), i.category))
        .collect();
    let projects: Vec<(String, PathBuf)> = cfg.projects.iter()
        .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
        .collect();
    let projects_ref: Vec<(&str, &std::path::Path)> = projects.iter()
        .map(|(n, p)| (n.as_str(), p.as_path()))
        .collect();

    let matrix = distributor::get_distribution_matrix(
        &store_path,
        &items_ref,
        &projects_ref,
        AgentType::all(),
    ).await;

    Ok(Json(matrix))
}

// ---------------------------------------------------------------------------
// GET /api/agent-store/scan
// ---------------------------------------------------------------------------

pub async fn scan(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let project_paths: Vec<(String, PathBuf)> = {
        let cfg = state.config.read().await;
        cfg.projects.iter()
            .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
            .collect()
    };

    let mut join_set = tokio::task::JoinSet::new();
    for (name, path) in project_paths {
        join_set.spawn(async move { scan_project(&name, &path).await });
    }

    let mut results = Vec::new();
    while let Some(r) = join_set.join_next().await {
        if let Ok(scan_result) = r {
            results.push(scan_result);
        }
    }
    Ok(Json(results))
}

// ---------------------------------------------------------------------------
// GET /api/agent-store/health
// ---------------------------------------------------------------------------

pub async fn health_check(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let store_path = state.agent_store.store_path().to_path_buf();
    let cfg = state.config.read().await;
    let projects: Vec<(String, PathBuf)> = cfg.projects.iter()
        .map(|p| (p.name.clone(), PathBuf::from(&p.path)))
        .collect();
    drop(cfg);

    let projects_ref: Vec<(&str, &std::path::Path)> = projects.iter()
        .map(|(n, p)| (n.as_str(), p.as_path()))
        .collect();

    let result = distributor::health_check(
        &store_path,
        &projects_ref,
        AgentType::all(),
    ).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async fn resolve_project(state: &AppState, name: &str) -> Result<PathBuf, ApiError> {
    state.project_path(name).await.map_err(ApiError::from_app)
}
