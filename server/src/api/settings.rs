use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::read_config;
use crate::error::AppError;
use crate::state::project_roots_from_config;
use crate::state::AppState;
use crate::utils::atomic_write;

use super::error::ApiError;

const SEMANTIC_UNAVAILABLE_FALLBACK: &str =
    "A valid signed semantic bundle is required on this server.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticNavigationSettings {
    pub enabled: bool,
    pub available: bool,
    pub disabled_reason: Option<&'static str>,
}

fn semantic_settings(state: &AppState, enabled: bool) -> SemanticNavigationSettings {
    let capability = state.semantic_supervisor.semantic_capability();
    let disabled_reason = (!capability.available).then(|| {
        capability
            .disabled_reason
            .unwrap_or(SEMANTIC_UNAVAILABLE_FALLBACK)
    });
    SemanticNavigationSettings {
        enabled,
        available: capability.available,
        disabled_reason,
    }
}

/// GET /api/settings/semantic-navigation.
pub async fn get_semantic_navigation(State(state): State<AppState>) -> impl IntoResponse {
    let _workspace_context = state.workspace_context_guard.read().await;
    let enabled = state.config.read().await.server.semantic.enabled;
    Json(semantic_settings(&state, enabled))
}

/// PATCH /api/settings/semantic-navigation with `{ "enabled": boolean }`.
pub async fn update_semantic_navigation(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let enabled = parse_semantic_patch(&body)?;
    let _workspace_context = state.workspace_context_guard.write().await;
    let current_path = state.config.read().await.config_path.clone();
    let original = std::fs::read_to_string(&current_path).map_err(|error| {
        ApiError::from_app(AppError::Config(format!(
            "Cannot read active config: {error}"
        )))
    })?;

    if enabled && !state.semantic_supervisor.semantic_capability().available {
        let reason = state
            .semantic_supervisor
            .semantic_capability()
            .disabled_reason
            .unwrap_or(SEMANTIC_UNAVAILABLE_FALLBACK);
        return Err(ApiError::from_app(AppError::Conflict(reason.to_string())));
    }

    let mut document: toml::Value = toml::from_str(&original)
        .map_err(|error| ApiError::from_app(AppError::Config(error.to_string())))?;
    patch_semantic_enabled(&mut document, enabled)?;
    let serialized = toml::to_string_pretty(&document)
        .map_err(|error| ApiError::from_app(AppError::Internal(error.to_string())))?;
    atomic_write(&current_path, &serialized).map_err(ApiError::from_app)?;

    let reloaded = match read_config(&current_path) {
        Ok(config) => config,
        Err(error) => {
            if let Some(response) =
                rollback_or_desynchronize(atomic_write(&current_path, &original), enabled)
            {
                return Err(response);
            }
            return Err(ApiError::from_app(error));
        }
    };
    if reloaded.server.semantic.enabled != enabled {
        let original_error = AppError::Config(
            "Active config did not persist semantic navigation setting".to_string(),
        );
        if let Some(response) =
            rollback_or_desynchronize(atomic_write(&current_path, &original), enabled)
        {
            return Err(response);
        }
        return Err(ApiError::from_app(original_error));
    }

    state.semantic_supervisor.reconfigure(enabled).await;
    *state.config.write().await = reloaded;
    let current = state.config.read().await.server.semantic.enabled;
    Ok(Json(semantic_settings(&state, current)))
}

fn rollback_or_desynchronize(
    rollback: Result<(), AppError>,
    requested_enabled: bool,
) -> Option<ApiError> {
    if rollback.is_ok() {
        return None;
    }
    tracing::error!(
        setting = "server.semantic.enabled",
        requested_enabled,
        "semantic navigation config rollback failed; persistence is desynchronized"
    );
    Some(ApiError::from_app(
        AppError::ConfigPersistenceDesynchronized,
    ))
}

fn parse_semantic_patch(body: &Value) -> Result<bool, ApiError> {
    let object = body.as_object().ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput(
            "Semantic settings must be an object".to_string(),
        ))
    })?;
    if object.len() != 1 || !object.contains_key("enabled") {
        return Err(ApiError::from_app(AppError::InvalidInput(
            "Semantic settings only accept the enabled boolean".to_string(),
        )));
    }
    object
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            ApiError::from_app(AppError::InvalidInput(
                "Semantic settings enabled must be a boolean".to_string(),
            ))
        })
}

fn patch_semantic_enabled(document: &mut toml::Value, enabled: bool) -> Result<(), ApiError> {
    let root = document.as_table_mut().ok_or_else(|| {
        ApiError::from_app(AppError::InvalidInput(
            "Active config root must be a TOML table".to_string(),
        ))
    })?;
    let server = root
        .entry("server")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            ApiError::from_app(AppError::InvalidInput(
                "Active config server must be a TOML table".to_string(),
            ))
        })?;
    let semantic = server
        .entry("semantic")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            ApiError::from_app(AppError::InvalidInput(
                "Active config semantic must be a TOML table".to_string(),
            ))
        })?;
    semantic.insert("enabled".to_string(), toml::Value::Boolean(enabled));
    Ok(())
}

// ---------------------------------------------------------------------------
// POST /api/settings/cache-clear  (cache:clear IPC)
// ---------------------------------------------------------------------------

pub async fn cache_clear(State(state): State<AppState>) -> impl IntoResponse {
    // In the Rust server there's no in-process cache beyond RwLock fields.
    // Re-reading config is the closest equivalent.
    let _workspace_context = state.workspace_context_guard.write().await;
    let config_path = state.config.read().await.config_path.clone();
    match read_config(&config_path) {
        Ok(cfg) => {
            state
                .semantic_supervisor
                .invalidate_workspace_with_enabled(cfg.server.semantic.enabled)
                .await;
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

pub async fn reset(State(state): State<AppState>) -> impl IntoResponse {
    // Stop all PTY and semantic sessions — equivalent to workspace reset
    state.pty_manager.dispose();
    state.semantic_supervisor.invalidate_workspace().await;
    Json(serde_json::json!({ "ok": true })).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/settings/export
// ---------------------------------------------------------------------------

pub async fn export_settings(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let gc = state.global_config.read().await;
    let export = serde_json::json!({
        "config": *cfg,
        "globalConfig": *gc,
    });
    Json(export).into_response()
}

// ---------------------------------------------------------------------------
// POST /api/settings/import  { config?, globalConfig? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBody {
    pub global_config: Option<crate::config::GlobalConfig>,
}

pub async fn import_settings(
    State(state): State<AppState>,
    Json(body): Json<ImportBody>,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(gc) = body.global_config {
        let gc_path = crate::config::global_config_path();
        crate::config::write_global_config_at(&gc_path, &gc).map_err(ApiError::from_app)?;
        *state.global_config.write().await = gc;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

pub async fn health(_state: State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_patch_requires_one_boolean_field() {
        assert!(parse_semantic_patch(&serde_json::json!({"enabled": true}))
            .is_ok_and(|enabled| enabled));
        assert!(parse_semantic_patch(&serde_json::json!({"enabled": "true"})).is_err());
        assert!(
            parse_semantic_patch(&serde_json::json!({"enabled": false, "extra": true})).is_err()
        );
    }

    #[test]
    fn semantic_toml_patch_preserves_unrelated_values() {
        let mut document: toml::Value = toml::from_str(
            r#"workspace = { name = "demo" }
[server.telemetry]
enabled = true
"#,
        )
        .unwrap();
        assert!(patch_semantic_enabled(&mut document, true).is_ok());
        assert_eq!(document["workspace"]["name"].as_str(), Some("demo"));
        assert_eq!(
            document["server"]["telemetry"]["enabled"].as_bool(),
            Some(true)
        );
        assert_eq!(
            document["server"]["semantic"]["enabled"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn failed_rollback_returns_explicit_desynchronization_error() {
        let response =
            rollback_or_desynchronize(Err(AppError::Config("rollback failed".to_string())), true)
                .expect("failed rollback must return an API error");
        assert!(matches!(
            &response.0,
            AppError::ConfigPersistenceDesynchronized
        ));
        assert_eq!(
            response.0.api_code(),
            Some("CONFIG_PERSISTENCE_DESYNCHRONIZED")
        );
    }

    #[test]
    fn successful_rollback_preserves_original_error() {
        assert!(rollback_or_desynchronize(Ok(()), false).is_none());
    }
}
