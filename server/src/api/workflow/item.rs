use axum::extract::{Path, State};
use axum::Json;
use uuid::Uuid;

use super::dto::{CreateItemRequest, DeleteRequest, ItemDto, MutationDto, PatchItemRequest, TombstoneDto};
use super::mapping;
use crate::api::error::{ApiError, AppJson};
use crate::error::AppError;
use crate::state::AppState;
use crate::workflow::error::WorkflowError;
use crate::workflow::model::{
    validate_item_hierarchy, validate_item_transition, validate_title, ItemStatus,
    WorkflowEvent, WorkflowEventType, WorkflowItem, WorkflowSource,
};

fn err(e: WorkflowError) -> ApiError {
    ApiError::from(AppError::Workflow(e))
}

fn parse_uuid(v: &str) -> Result<String, ApiError> {
    Uuid::parse_str(v)
        .map(|_| v.to_owned())
        .map_err(|_| err(WorkflowError::InvalidRequest))
}

fn create_event(
    id: &str,
    ws: &str,
    kind: WorkflowEventType,
    item: Option<&str>,
    now: u64,
) -> WorkflowEvent {
    WorkflowEvent {
        id: id.into(),
        workspace_id: ws.into(),
        event_type: kind,
        source: WorkflowSource::Manual,
        project_name: None,
        worktree_path: None,
        item_id: item.map(Into::into),
        session_id: None,
        occurred_at: now,
        recorded_at: now,
        payload_json: None,
        expires_at: Some(now + 90 * 86_400_000),
    }
}

pub async fn create(
    State(state): State<AppState>,
    Json(req): Json<CreateItemRequest>,
) -> Result<AppJson<MutationDto<ItemDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let request_id = parse_uuid(&req.request_id)?;

    validate_title(req.title.trim()).map_err(|_| err(WorkflowError::LimitExceeded))?;

    let resolved = service.resolve_target(&req.target).await?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    // Check idempotency replay
    if let Some(existing) = service
        .store_call({
            let rid = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&rid, &wid)
        })
        .await?
    {
        if let Some(item_id) = existing.item_id {
            if let Some(item) = service
                .store_call({
                    let wid = ws.id.clone();
                    move |s| s.get_item(&item_id, &wid)
                })
                .await?
            {
                return Ok(AppJson(MutationDto {
                    resource: mapping::item(item),
                    replayed: true,
                    event_id: request_id,
                }));
            }
        }
        return Err(err(WorkflowError::Conflict));
    }

    // Validate parent hierarchy and project ownership
    let parent_id_val = req
        .parent_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    let parent_kind = if let Some(ref p_id) = parent_id_val {
        let parent = service
            .store_call({
                let p = p_id.clone();
                let wid = ws.id.clone();
                move |s| s.get_item(&p, &wid)
            })
            .await?
            .ok_or_else(|| err(WorkflowError::InvalidRequest))?;

        if parent.project_name != req.target.project {
            return Err(err(WorkflowError::InvalidRequest));
        }
        Some(parent.kind)
    } else {
        None
    };

    validate_item_hierarchy(req.kind, parent_kind)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;

    let item = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: req.target.project,
        worktree_path: mapping::target_path(&resolved),
        parent_id: parent_id_val,
        kind: req.kind,
        title: req.title.trim().into(),
        summary: req.summary,
        status: req.status.unwrap_or(ItemStatus::Backlog),
        sort_order: req.sort_order.unwrap_or(0),
        source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
        completed_at: None,
        archived_at: None,
    };

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::ItemCreated,
        Some(&item.id),
        now,
    );
    let out = service
        .store_call(move |s| s.create_item(&item, Some(&ev)))
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::item(out),
        replayed: false,
        event_id: request_id,
    }))
}

pub async fn patch(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<PatchItemRequest>,
) -> Result<AppJson<MutationDto<ItemDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let item_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&req.request_id)?;
    let expected = mapping::parse_timestamp(&req.updated_at)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    let current = service
        .store_call({
            let i = item_id.clone();
            let w = ws.id.clone();
            move |s| s.get_item(&i, &w)
        })
        .await?
        .ok_or_else(|| err(WorkflowError::NotFound))?;

    // Check replay
    if let Some(existing_ev) = service
        .store_call({
            let rid = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&rid, &wid)
        })
        .await?
    {
        if existing_ev.item_id.as_deref() == Some(&item_id) {
            return Ok(AppJson(MutationDto {
                resource: mapping::item(current),
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    if current.updated_at != expected {
        return Err(err(WorkflowError::Conflict));
    }

    if let Some(ref t) = req.title {
        validate_title(t.trim()).map_err(|_| err(WorkflowError::LimitExceeded))?;
    }

    if let Some(new_status) = req.status {
        validate_item_transition(current.status, new_status)
            .map_err(|_| err(WorkflowError::InvalidTransition))?;
    }

    let wt = match &req.target {
        Some(t) => {
            let resolved = service.resolve_target(t).await?;
            Some(mapping::target_path(&resolved))
        }
        None => None,
    };

    let title = req.title.map(|t| t.trim().to_owned());
    let summary = req.summary;
    let status = req.status;
    let sort_order = req.sort_order;

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::ItemUpdated,
        Some(&item_id),
        now,
    );

    let out = service
        .store_call(move |s| {
            s.update_item_cas(
                &item_id,
                &ws.id,
                title.as_deref(),
                summary.as_ref().map(|opt| opt.as_deref()),
                status,
                sort_order,
                wt.as_ref().map(|opt| opt.as_deref()),
                now,
                expected,
                Some(&ev),
            )
        })
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::item(out),
        replayed: false,
        event_id: request_id,
    }))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<DeleteRequest>,
) -> Result<AppJson<MutationDto<TombstoneDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let item_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&req.request_id)?;
    let expected = mapping::parse_timestamp(&req.updated_at)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    // Check replay
    if let Some(existing_ev) = service
        .store_call({
            let rid = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&rid, &wid)
        })
        .await?
    {
        if existing_ev.item_id.as_deref() == Some(&item_id) {
            return Ok(AppJson(MutationDto {
                resource: TombstoneDto {
                    resource_type: "item".into(),
                    id: item_id,
                    parent_id: None,
                    deleted_at: mapping::timestamp(existing_ev.occurred_at),
                },
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    let existing = service
        .store_call({
            let i = item_id.clone();
            let w = ws.id.clone();
            move |s| s.get_item(&i, &w)
        })
        .await?
        .ok_or_else(|| err(WorkflowError::NotFound))?;
    if existing.updated_at != expected {
        return Err(err(WorkflowError::Conflict));
    }

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::ItemDeleted,
        Some(&item_id),
        now,
    );

    service
        .store_call({
            let i = item_id.clone();
            let w = ws.id.clone();
            move |s| s.delete_item_cas(&i, &w, expected, Some(&ev))
        })
        .await?;

    Ok(AppJson(MutationDto {
        resource: TombstoneDto {
            resource_type: "item".into(),
            id: item_id,
            parent_id: existing.parent_id,
            deleted_at: mapping::timestamp(now),
        },
        replayed: false,
        event_id: request_id,
    }))
}
