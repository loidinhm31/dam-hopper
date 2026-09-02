use axum::extract::{Path, State};
use axum::Json;
use uuid::Uuid;

use super::dto::{CreateNoteRequest, DeleteRequest, MutationDto, NoteDto, TombstoneDto};
use super::mapping;
use crate::api::error::{ApiError, AppJson};
use crate::error::AppError;
use crate::state::AppState;
use crate::workflow::error::WorkflowError;
use crate::workflow::model::{
    validate_note_body, WorkflowEvent, WorkflowEventType, WorkflowNote, WorkflowSource,
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
    session: Option<&str>,
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
        session_id: session.map(Into::into),
        occurred_at: now,
        recorded_at: now,
        payload_json: None,
        expires_at: Some(now + 90 * 86_400_000),
    }
}

pub async fn create(
    State(state): State<AppState>,
    Json(req): Json<CreateNoteRequest>,
) -> Result<AppJson<MutationDto<NoteDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let request_id = parse_uuid(&req.request_id)?;

    validate_note_body(&req.body).map_err(|_| err(WorkflowError::LimitExceeded))?;

    let item_id_val = req
        .item_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    let session_id_val = req
        .session_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;

    if item_id_val.is_none() && session_id_val.is_none() {
        return Err(err(WorkflowError::InvalidRequest));
    }

    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    // Check replay
    if let Some(_existing) = service
        .store_call({
            let rid = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&rid, &wid)
        })
        .await?
    {
        let notes = if let Some(ref i) = item_id_val {
            service
                .store_call({
                    let item_id = i.clone();
                    let wid = ws.id.clone();
                    move |s| s.list_notes_for_item(&item_id, &wid, false)
                })
                .await?
        } else if let Some(ref sid) = session_id_val {
            service
                .store_call({
                    let s_id = sid.clone();
                    let wid = ws.id.clone();
                    move |s| s.list_notes_for_session(&s_id, &wid, false)
                })
                .await?
        } else {
            Vec::new()
        };

        if let Some(n) = notes.into_iter().find(|n| n.body == req.body) {
            return Ok(AppJson(MutationDto {
                resource: mapping::note(n),
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    // Verify parent item / session existence
    if let Some(ref i) = item_id_val {
        let item = service
            .store_call({
                let i_id = i.clone();
                let wid = ws.id.clone();
                move |s| s.get_item(&i_id, &wid)
            })
            .await?;
        if item.is_none() {
            return Err(err(WorkflowError::NotFound));
        }
    }

    if let Some(ref sid) = session_id_val {
        let session = service
            .store_call({
                let s_id = sid.clone();
                let wid = ws.id.clone();
                move |s| s.get_session(&s_id, &wid)
            })
            .await?;
        if session.is_none() {
            return Err(err(WorkflowError::NotFound));
        }
    }

    let note = WorkflowNote {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        item_id: item_id_val.clone(),
        session_id: session_id_val.clone(),
        body: req.body,
        source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::NoteAdded,
        item_id_val.as_deref(),
        session_id_val.as_deref(),
        now,
    );

    let out = service
        .store_call(move |s| s.create_note(&note, Some(&ev)))
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::note(out),
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
    let note_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&req.request_id)?;
    let expected = mapping::parse_timestamp(&req.updated_at)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    // Check replay
    if let Some(existing) = service
        .store_call({
            let rid = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&rid, &wid)
        })
        .await?
    {
        if existing.event_type == WorkflowEventType::NoteDeleted {
            return Ok(AppJson(MutationDto {
                resource: TombstoneDto {
                    resource_type: "note".into(),
                    id: note_id,
                    parent_id: existing.item_id,
                    deleted_at: mapping::timestamp(existing.occurred_at),
                },
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    let note = service
        .store_call({
            let i = note_id.clone();
            let w = ws.id.clone();
            move |s| s.get_note(&i, &w)
        })
        .await?
        .ok_or_else(|| err(WorkflowError::NotFound))?;

    if note.updated_at != expected {
        return Err(err(WorkflowError::Conflict));
    }

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::NoteDeleted,
        note.item_id.as_deref(),
        note.session_id.as_deref(),
        now,
    );

    service
        .store_call(move |s| {
            s.soft_delete_note_cas(&note_id, &ws.id, now, expected, Some(&ev))
        })
        .await?;

    Ok(AppJson(MutationDto {
        resource: TombstoneDto {
            resource_type: "note".into(),
            id: note.id,
            parent_id: note.item_id,
            deleted_at: mapping::timestamp(now),
        },
        replayed: false,
        event_id: request_id,
    }))
}
