use axum::{Json, extract::{Path, State}, response::IntoResponse};
use serde::Deserialize;
use std::path::PathBuf;

use crate::agent_store::{
    AgentType,
    memory::{
        TemplateContext, ProjectContext, WorkspaceContext,
        apply_template, get_memory_file, list_memory_templates, update_memory_file,
    },
};
use crate::state::AppState;

use super::error::ApiError;

// ---------------------------------------------------------------------------
// GET /api/agent-memory/templates
// ---------------------------------------------------------------------------

pub async fn list_templates(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let templates = list_memory_templates(state.agent_store.store_path())
        .await
        .map_err(ApiError::from_app)?;
    Ok(Json(templates))
}

// ---------------------------------------------------------------------------
// GET /api/agent-memory/:projectName
// ---------------------------------------------------------------------------

pub async fn list_project_memory(
    State(state): State<AppState>,
    Path(project_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Returns memory file content for all agent types in this project
    let project_path = resolve_project(&state, &project_name).await?;
    let mut result = serde_json::json!({});

    for agent in AgentType::all() {
        let content = get_memory_file(&project_path, *agent).await.ok().flatten();
        result[agent.to_string()] = serde_json::json!({
            "agent": agent,
            "content": content,
        });
    }
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// GET /api/agent-memory/:projectName/:agent
// ---------------------------------------------------------------------------

pub async fn get_project_memory(
    State(state): State<AppState>,
    Path((project_name, agent_str)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let agent = parse_agent(&agent_str)?;
    let project_path = resolve_project(&state, &project_name).await?;
    let content = get_memory_file(&project_path, agent).await.map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({
        "projectName": project_name,
        "agent": agent_str,
        "content": content,
    })))
}

// ---------------------------------------------------------------------------
// PUT /api/agent-memory/:projectName/:agent  { content: string }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UpdateMemoryBody {
    pub content: String,
}

pub async fn update_project_memory(
    State(state): State<AppState>,
    Path((project_name, agent_str)): Path<(String, String)>,
    Json(body): Json<UpdateMemoryBody>,
) -> Result<impl IntoResponse, ApiError> {
    let agent = parse_agent(&agent_str)?;
    let project_path = resolve_project(&state, &project_name).await?;
    update_memory_file(&project_path, agent, &body.content).await.map_err(ApiError::from_app)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// POST /api/agent-memory/apply  { projectName, agent, templateName, context? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTemplateBody {
    pub project_name: String,
    pub agent: String,
    pub template_name: String,
    pub write: Option<bool>,
}

pub async fn apply_memory_template(
    State(state): State<AppState>,
    Json(body): Json<ApplyTemplateBody>,
) -> Result<impl IntoResponse, ApiError> {
    let agent = parse_agent(&body.agent)?;
    let project_path = resolve_project(&state, &body.project_name).await?;

    let (project_type, tags, workspace_name) = {
        let cfg = state.config.read().await;
        let proj = cfg.projects.iter().find(|p| p.name == body.project_name)
            .ok_or_else(|| ApiError::from_app(crate::error::AppError::NotFound(
                format!("Project not found: {}", body.project_name),
            )))?;
        (
            proj.project_type.to_string(),
            proj.tags.clone(),
            cfg.workspace.name.clone(),
        )
    };

    let tags_joined = tags.as_ref().map(|t| t.join(", ")).unwrap_or_default();
    let ctx = TemplateContext {
        project: ProjectContext {
            name: body.project_name.clone(),
            path: project_path.to_string_lossy().into_owned(),
            project_type,
            tags,
            tags_joined,
        },
        workspace: WorkspaceContext {
            name: workspace_name,
            root: state.workspace_dir.read().await.to_string_lossy().into_owned(),
        },
        agent: body.agent.clone(),
    };

    let rendered = apply_template(
        state.agent_store.store_path(),
        &body.template_name,
        &ctx,
    ).await.map_err(ApiError::from_app)?;

    if body.write.unwrap_or(false) {
        update_memory_file(&project_path, agent, &rendered).await.map_err(ApiError::from_app)?;
    }

    Ok(Json(serde_json::json!({ "content": rendered })))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn resolve_project(state: &AppState, name: &str) -> Result<PathBuf, ApiError> {
    state.project_path(name).await.map_err(ApiError::from_app)
}

fn parse_agent(s: &str) -> Result<AgentType, ApiError> {
    match s {
        "claude" => Ok(AgentType::Claude),
        "gemini" => Ok(AgentType::Gemini),
        _ => Err(ApiError::from_app(crate::error::AppError::InvalidInput(
            format!("Unknown agent type: {s}"),
        ))),
    }
}
