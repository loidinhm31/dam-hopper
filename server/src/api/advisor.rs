use axum::{
    extract::{Extension, State},
    Json,
};
use serde::Deserialize;

use crate::advisor::{
    AdvisorError, AdvisorSettingsDto, AdvisorSettingsUpdateDto, AdvisorStatusDto,
    HistoryDetailParamsDto, HistoryDetailResultDto, HistoryPageParamsDto,
    HistoryPageResultDto, HistoryRefreshResultDto, HistorySummaryParamsDto,
    HistorySummaryResultDto,
};
use crate::api::auth::AuthenticatedActor;
use crate::config::write_config;
use crate::state::AppState;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRefreshRequestDto {
    #[serde(default, alias = "projectId")]
    pub project_id: Option<String>,
}

async fn check_advisor_enabled(state: &AppState) -> Result<(), AdvisorError> {
    if !state.config.read().await.server.advisor.enabled {
        return Err(AdvisorError::Disabled);
    }
    Ok(())
}

/// GET /api/advisor/status — returns host advisor availability and toggle status.
/// Accessible to administrators even when Advisor is disabled.
pub async fn advisor_status_handler(
    State(state): State<AppState>,
    Extension(_actor): Extension<AuthenticatedActor>,
) -> Json<AdvisorStatusDto> {
    let enabled = state.config.read().await.server.advisor.enabled;
    Json(state.advisor_service.status(enabled))
}

/// PATCH /api/advisor/settings — updates server-level Advisor enable toggle.
/// Accessible to administrators even when Advisor is disabled.
pub async fn advisor_settings_update_handler(
    State(state): State<AppState>,
    Extension(_actor): Extension<AuthenticatedActor>,
    Json(body): Json<AdvisorSettingsUpdateDto>,
) -> Result<Json<AdvisorSettingsDto>, AdvisorError> {
    let _guard = state.advisor_settings_lock.lock().await;
    let mut config = state.config.read().await.clone();
    config.server.advisor.enabled = body.enabled;
    config
        .server
        .validate()
        .map_err(AdvisorError::InvalidInput)?;
    write_config(&config.config_path, &config)
        .map_err(|e| AdvisorError::Internal(e.to_string()))?;

    if !body.enabled {
        state.advisor_service.clear_snapshots().await;
    }

    *state.config.write().await = config;
    Ok(Json(AdvisorSettingsDto {
        enabled: body.enabled,
    }))
}

/// POST /api/advisor/history/refresh — rescans history directory and creates a snapshot.
pub async fn history_refresh_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    body: Option<Json<HistoryRefreshRequestDto>>,
) -> Result<Json<HistoryRefreshResultDto>, AdvisorError> {
    check_advisor_enabled(&state).await?;
    let target = body.and_then(|b| b.project_id.clone());
    let res = state
        .advisor_service
        .refresh(&actor.subject, target.as_deref())
        .await?;
    Ok(Json(res))
}

/// POST /api/advisor/history/summary — returns aggregated metrics for a snapshot.
pub async fn history_summary_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Json(body): Json<HistorySummaryParamsDto>,
) -> Result<Json<HistorySummaryResultDto>, AdvisorError> {
    check_advisor_enabled(&state).await?;
    let res = state.advisor_service.summary(&actor.subject, body).await?;
    Ok(Json(res))
}

/// POST /api/advisor/history/page — paginates history entries with HMAC-signed cursor.
pub async fn history_page_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Json(body): Json<HistoryPageParamsDto>,
) -> Result<Json<HistoryPageResultDto>, AdvisorError> {
    check_advisor_enabled(&state).await?;
    let res = state.advisor_service.page(&actor.subject, body).await?;
    Ok(Json(res))
}

/// POST /api/advisor/history/detail — fetches sanitized execution and outcome detail.
pub async fn history_detail_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Json(body): Json<HistoryDetailParamsDto>,
) -> Result<Json<HistoryDetailResultDto>, AdvisorError> {
    check_advisor_enabled(&state).await?;
    let res = state.advisor_service.detail(&actor.subject, body).await?;
    Ok(Json(res))
}
