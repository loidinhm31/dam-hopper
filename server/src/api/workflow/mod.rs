pub mod cursor;
pub mod dto;
pub mod item;
pub mod mapping;
pub mod note;
pub mod purge;
pub mod session;

use axum::extract::{Query, State};

use self::dto::{EventsDto, EventsQuery, OverviewDto};
use crate::api::error::{ApiError, AppJson};
use crate::state::AppState;
use crate::workflow::error::WorkflowError;

pub async fn overview(
    State(state): State<AppState>,
) -> Result<AppJson<OverviewDto>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| ApiError::from(crate::error::AppError::Workflow(WorkflowError::StoreUnavailable)))?;
    let now = mapping::now_ms();
    let ws = service
        .workspace(now)
        .await
        .map_err(|e| ApiError::from(crate::error::AppError::Workflow(e)))?;
    let ws_id = ws.id.clone();
    let raw = service
        .store_call(move |store| {
            store.get_overview(
                &ws_id,
                now,
                crate::workflow::MAX_OVERVIEW_PROJECTS,
                crate::workflow::MAX_OVERVIEW_ITEMS,
                crate::workflow::MAX_OVERVIEW_SESSIONS,
            )
        })
        .await
        .map_err(|e| ApiError::from(crate::error::AppError::Workflow(e)))?;
    Ok(AppJson(mapping::overview(raw, ws.id, ws.name, now)))
}

pub async fn events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Result<AppJson<EventsDto>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| ApiError::from(crate::error::AppError::Workflow(WorkflowError::StoreUnavailable)))?;
    let (locator, name, _) = service
        .scope()
        .await
        .map_err(|e| ApiError::from(crate::error::AppError::Workflow(e)))?;
    let now = mapping::now_ms();
    let ws = service
        .store_call(move |store| store.get_or_create_workspace(&locator, &name, now))
        .await
        .map_err(|e| ApiError::from(crate::error::AppError::Workflow(e)))?;

    let (at, id) = query
        .cursor
        .as_deref()
        .map(cursor::decode)
        .transpose()
        .map_err(|_| ApiError::from(crate::error::AppError::Workflow(WorkflowError::InvalidRequest)))?
        .unwrap_or((None, None));

    let limit = match query.limit {
        Some(value) if !(1..=crate::workflow::MAX_HISTORY_LIMIT).contains(&value) => {
            return Err(ApiError::from(crate::error::AppError::Workflow(
                WorkflowError::LimitExceeded,
            )))
        }
        Some(value) => value,
        None => crate::workflow::DEFAULT_HISTORY_LIMIT,
    };

    let rows = service
        .store_call(move |store| {
            store.list_events_keyset(&ws.id, at, id.as_deref(), limit + 1)
        })
        .await
        .map_err(|e| ApiError::from(crate::error::AppError::Workflow(e)))?;

    let has_more = rows.len() > limit;
    let next = if has_more {
        rows.get(limit - 1)
            .map(|e| cursor::encode(e.recorded_at, &e.id))
    } else {
        None
    };
    let rows = rows.into_iter().take(limit).map(mapping::event).collect();
    Ok(AppJson(EventsDto {
        events: rows,
        next_cursor: next,
    }))
}
