use axum::extract::{Query, State};
use axum::Json;

use super::dto::{PurgeDto, PurgeQuery, PurgeRequest};
use super::mapping;
use crate::api::error::{ApiError, AppJson};
use crate::error::AppError;
use crate::state::AppState;
use crate::workflow::error::WorkflowError;

fn err(e: WorkflowError) -> ApiError {
    ApiError::from(AppError::Workflow(e))
}

pub async fn purge(
    State(state): State<AppState>,
    Query(query): Query<PurgeQuery>,
    body: Option<Json<PurgeRequest>>,
) -> Result<AppJson<PurgeDto>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;

    let before_str = body
        .and_then(|Json(b)| b.before)
        .or(query.before)
        .ok_or_else(|| err(WorkflowError::InvalidRequest))?;

    let before_ms = mapping::parse_timestamp(&before_str)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;

    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    let mut events_deleted = 0;
    let mut notes_deleted = 0;

    loop {
        let (e, n) = service
            .store_call({
                let w = ws.id.clone();
                move |s| s.purge_history_before(&w, before_ms, 500)
            })
            .await?;

        events_deleted += e;
        notes_deleted += n;

        if e < 500 && n < 500 {
            break;
        }
        tokio::task::yield_now().await;
    }

    Ok(AppJson(PurgeDto {
        events_deleted,
        notes_deleted,
    }))
}
