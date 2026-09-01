use axum::extract::{Path, State};
use axum::Json;
use uuid::Uuid;

use super::dto::{
    AbandonRequest, CreateSessionRequest, EndSessionRequest, LinkDto, LinkRequest,
    MutationDto, SessionDto, TombstoneDto, UnlinkRequest,
};
use super::mapping;
use crate::api::error::{ApiError, AppJson};
use crate::error::AppError;
use crate::state::AppState;
use crate::workflow::error::WorkflowError;
use crate::workflow::model::{
    validate_external_id, validate_harness_label, validate_run_id, validate_session_transition,
    ResourceLinkType, ResourceObservedState, SessionStatus, WorkflowEvent, WorkflowEventType,
    WorkflowResourceLink, WorkflowSession, WorkflowSource,
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
        item_id: None,
        session_id: session.map(Into::into),
        occurred_at: now,
        recorded_at: now,
        payload_json: None,
        expires_at: Some(now + 90 * 86_400_000),
    }
}

pub async fn create(
    State(state): State<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<AppJson<MutationDto<SessionDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let request_id = parse_uuid(&req.request_id)?;
    let started = mapping::parse_timestamp(&req.started_at)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;
    let resolved = service.resolve_target(&req.target).await?;
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
        if let Some(sid) = existing.session_id {
            if let Some(session) = service
                .store_call({
                    let wid = ws.id.clone();
                    move |s| s.get_session(&sid, &wid)
                })
                .await?
            {
                return Ok(AppJson(MutationDto {
                    resource: mapping::session(session),
                    replayed: true,
                    event_id: request_id,
                }));
            }
        }
        return Err(err(WorkflowError::Conflict));
    }

    let item_id_val = req
        .item_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    if let Some(i_id) = &item_id_val {
        let item = service
            .store_call({
                let wid = ws.id.clone();
                let i = i_id.clone();
                move |s| s.get_item(&i, &wid)
            })
            .await?
            .ok_or_else(|| err(WorkflowError::InvalidRequest))?;
        if item.project_name != req.target.project {
            return Err(err(WorkflowError::InvalidRequest));
        }
    }

    let session = WorkflowSession {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: req.target.project,
        worktree_path: mapping::target_path(&resolved),
        item_id: item_id_val,
        status: SessionStatus::Running,
        started_at: started,
        ended_at: None,
        source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
    };

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::SessionStarted,
        Some(&session.id),
        now,
    );
    let out = service
        .store_call(move |st| st.start_session(&session, None, Some(&ev)))
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::session(out),
        replayed: false,
        event_id: request_id,
    }))
}

pub async fn end(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<EndSessionRequest>,
) -> Result<AppJson<MutationDto<SessionDto>>, ApiError> {
    change_session_status(state, path_id, req.request_id, SessionStatus::Ended, Some(req.ended_at)).await
}

pub async fn abandon(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<AbandonRequest>,
) -> Result<AppJson<MutationDto<SessionDto>>, ApiError> {
    change_session_status(state, path_id, req.request_id, SessionStatus::Abandoned, None).await
}

async fn change_session_status(
    state: AppState,
    path_id: String,
    rid: String,
    status: SessionStatus,
    end_time_str: Option<String>,
) -> Result<AppJson<MutationDto<SessionDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let session_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&rid)?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    let current = service
        .store_call({
            let i = session_id.clone();
            let w = ws.id.clone();
            move |s| s.get_session(&i, &w)
        })
        .await?
        .ok_or_else(|| err(WorkflowError::NotFound))?;

    // Check replay
    if let Some(existing) = service
        .store_call({
            let r = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&r, &wid)
        })
        .await?
    {
        if existing.session_id.as_deref() == Some(&session_id) {
            return Ok(AppJson(MutationDto {
                resource: mapping::session(current),
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    let ended = end_time_str
        .map(|v| mapping::parse_timestamp(&v).map_err(|_| err(WorkflowError::InvalidRequest)))
        .transpose()?;

    if status == SessionStatus::Ended && ended.is_none() {
        return Err(err(WorkflowError::InvalidRequest));
    }

    if let Some(e) = ended {
        if e < current.started_at {
            return Err(err(WorkflowError::InvalidRequest));
        }
    }

    validate_session_transition(current.status, status)
        .map_err(|_| err(WorkflowError::InvalidTransition))?;

    let ev_kind = if status == SessionStatus::Ended {
        WorkflowEventType::SessionEnded
    } else {
        WorkflowEventType::SessionAbandoned
    };
    let ev = create_event(&request_id, &ws.id, ev_kind, Some(&session_id), now);

    let out = service
        .store_call(move |s| {
            s.update_session_status(&session_id, &ws.id, status, ended, now, Some(&ev))
        })
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::session(out),
        replayed: false,
        event_id: request_id,
    }))
}

pub async fn link(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<LinkRequest>,
) -> Result<AppJson<MutationDto<LinkDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let session_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&req.request_id)?;

    validate_external_id(&req.external_id)
        .map_err(|_| err(WorkflowError::LimitExceeded))?;

    if req.resource_type == ResourceLinkType::Terminal
        && (req.harness_label.is_some() || req.run_id.is_some())
    {
        return Err(err(WorkflowError::InvalidRequest));
    }

    if req.resource_type == ResourceLinkType::Agent {
        if req.incarnation.is_some() {
            return Err(err(WorkflowError::InvalidRequest));
        }
        if let Some(h) = &req.harness_label {
            validate_harness_label(h).map_err(|_| err(WorkflowError::LimitExceeded))?;
        }
        if let Some(r) = &req.run_id {
            validate_run_id(r).map_err(|_| err(WorkflowError::LimitExceeded))?;
        }
    }

    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    let session = service
        .store_call({
            let i = session_id.clone();
            let w = ws.id.clone();
            move |s| s.get_session(&i, &w)
        })
        .await?
        .ok_or_else(|| err(WorkflowError::NotFound))?;

    // Check replay
    if let Some(existing) = service
        .store_call({
            let r = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&r, &wid)
        })
        .await?
    {
        if existing.session_id.as_deref() == Some(&session_id) {
            let links = service
                .store_call({
                    let s_id = session_id.clone();
                    move |s| s.get_links_for_session(&s_id)
                })
                .await?;
            if let Some(l) = links
                .into_iter()
                .find(|l| l.resource_type == req.resource_type && l.external_id == req.external_id)
            {
                return Ok(AppJson(MutationDto {
                    resource: mapping::link(l),
                    replayed: true,
                    event_id: request_id,
                }));
            }
        }
        return Err(err(WorkflowError::Conflict));
    }

    if req.resource_type == ResourceLinkType::Terminal {
        let pty_sessions = service.pty_manager.list();
        let pty_match = pty_sessions.into_iter().find(|p| {
            p.id == req.external_id
                && (req.incarnation.is_none() || Some(p.incarnation) == req.incarnation)
        });
        match pty_match {
            Some(p) => {
                if p.project.as_deref() != Some(session.project_name.as_str())
                    || p.worktree_path.as_deref() != session.worktree_path.as_deref()
                {
                    return Err(err(WorkflowError::TargetUnavailable));
                }
            }
            None => {
                return Err(err(WorkflowError::TargetUnavailable));
            }
        }
    }

    let link_item = WorkflowResourceLink {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        resource_type: req.resource_type,
        external_id: req.external_id,
        incarnation: req.incarnation,
        harness_label: req.harness_label,
        run_id: req.run_id,
        observed_state: ResourceObservedState::Attached,
        suggested_end_time: None,
        first_seen_at: now,
        last_seen_at: now,
        link_source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
    };

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::ResourceLinked,
        Some(&session_id),
        now,
    );
    let out = service
        .store_call(move |s| s.link_resource(&link_item, Some(&ev)))
        .await?;

    Ok(AppJson(MutationDto {
        resource: mapping::link(out),
        replayed: false,
        event_id: request_id,
    }))
}

pub async fn unlink(
    State(state): State<AppState>,
    Path(path_id): Path<String>,
    Json(req): Json<UnlinkRequest>,
) -> Result<AppJson<MutationDto<TombstoneDto>>, ApiError> {
    let service = state
        .workflow
        .ok_or_else(|| err(WorkflowError::StoreUnavailable))?;
    let session_id = parse_uuid(&path_id)?;
    let request_id = parse_uuid(&req.request_id)?;
    let expected = mapping::parse_timestamp(&req.updated_at)
        .map_err(|_| err(WorkflowError::InvalidRequest))?;
    let now = mapping::now_ms();
    let ws = service.workspace(now).await?;

    // Check replay
    if let Some(existing) = service
        .store_call({
            let r = request_id.clone();
            let wid = ws.id.clone();
            move |s| s.get_event(&r, &wid)
        })
        .await?
    {
        if existing.session_id.as_deref() == Some(&session_id) {
            return Ok(AppJson(MutationDto {
                resource: TombstoneDto {
                    resource_type: "link".into(),
                    id: format!("{}:{}", req.resource_type.as_str(), req.external_id),
                    parent_id: Some(session_id),
                    deleted_at: mapping::timestamp(existing.occurred_at),
                },
                replayed: true,
                event_id: request_id,
            }));
        }
        return Err(err(WorkflowError::Conflict));
    }

    let links = service
        .store_call({
            let i = session_id.clone();
            move |s| s.get_links_for_session(&i)
        })
        .await?;

    let l = links
        .into_iter()
        .find(|l| l.resource_type == req.resource_type && l.external_id == req.external_id)
        .ok_or_else(|| err(WorkflowError::NotFound))?;

    if l.updated_at != expected {
        return Err(err(WorkflowError::Conflict));
    }

    let ev = create_event(
        &request_id,
        &ws.id,
        WorkflowEventType::ResourceUnlinked,
        Some(&session_id),
        now,
    );

    let s_id = session_id.clone();
    service
        .store_call(move |s| s.unlink_resource(&s_id, req.resource_type, &req.external_id, Some(&ev)))
        .await?;

    Ok(AppJson(MutationDto {
        resource: TombstoneDto {
            resource_type: "link".into(),
            id: l.id,
            parent_id: Some(session_id),
            deleted_at: mapping::timestamp(now),
        },
        replayed: false,
        event_id: request_id,
    }))
}
