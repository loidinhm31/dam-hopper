mod cursor;
mod dto;
mod mapping;

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};

use crate::{
    error::AppError,
    state::AppState,
    telemetry::queries::{
        agent_root_aggregates, agent_run_tree, agent_terminal_associations, list_agent_run_roots,
    },
};

use self::{
    cursor::{decode_cursor, encode_cursor, parse_list_query, SessionListParams},
    dto::{SessionDetailResponse, SessionListResponse, SessionRange},
    mapping::{group_terminals, node_dtos, summary_dto},
};
use super::error::ApiError;

const MAX_TREE_NODES: usize = 256;
const MAX_TREE_DEPTH: u16 = 16;

pub(crate) async fn list_sessions(
    State(state): State<AppState>,
    Query(params): Query<SessionListParams>,
) -> Result<impl IntoResponse, ApiError> {
    let _coordination = state.telemetry_coordinator.lock().await;
    let (mut query, cursor, explicit_range) = parse_list_query(params, super::usage::now_ms())?;
    if let Some(cursor) = cursor {
        let (decoded, from, to) =
            decode_cursor(cursor, &query, explicit_range, state.jwt_secret.as_str())?;
        query.from_utc_ms = from;
        query.to_utc_ms = to;
        query.cursor = Some(decoded);
    }

    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let store = telemetry.store.as_ref().ok_or_else(unavailable)?;
    let mut roots = list_agent_run_roots(store, &query).map_err(store_error)?;
    let has_next = roots.len() > query.limit;
    roots.truncate(query.limit);

    let root_ids = roots
        .iter()
        .map(|root| root.run_id.clone())
        .collect::<Vec<_>>();
    let aggregates = agent_root_aggregates(store, &root_ids).map_err(store_error)?;
    let aggregate_by_root = aggregates
        .into_iter()
        .map(|aggregate| (String::from(aggregate.root_run_id.clone()), aggregate))
        .collect::<HashMap<_, _>>();
    let terminals_by_run =
        group_terminals(agent_terminal_associations(store, &root_ids).map_err(store_error)?);
    let sessions = roots
        .iter()
        .filter_map(|root| {
            let key = String::from(root.run_id.clone());
            aggregate_by_root.get(&key).map(|aggregate| {
                summary_dto(
                    root,
                    aggregate,
                    terminals_by_run.get(&key).cloned().unwrap_or_default(),
                )
            })
        })
        .collect();
    let next_cursor = has_next
        .then(|| roots.last())
        .flatten()
        .map(|root| encode_cursor(root, &query, state.jwt_secret.as_str()))
        .transpose()?;

    Ok(Json(SessionListResponse {
        range: SessionRange {
            from: query.from_utc_ms,
            to: query.to_utc_ms,
        },
        sessions,
        next_cursor,
        paused: !telemetry.control.is_enabled(),
    }))
}

pub(crate) async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let id = cursor::parse_digest(id)?;
    let _coordination = state.telemetry_coordinator.lock().await;
    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let store = telemetry.store.as_ref().ok_or_else(unavailable)?;
    let tree = agent_run_tree(store, &id, MAX_TREE_DEPTH, MAX_TREE_NODES).map_err(store_error)?;
    if tree.is_empty() {
        return Err(not_found());
    }
    let truncated =
        tree.len() > MAX_TREE_NODES || tree.iter().any(|node| node.depth > MAX_TREE_DEPTH);
    let nodes = tree
        .into_iter()
        .filter(|node| node.depth <= MAX_TREE_DEPTH)
        .take(MAX_TREE_NODES)
        .collect::<Vec<_>>();
    let root = nodes.first().ok_or_else(not_found)?.summary.clone();
    let aggregate = agent_root_aggregates(store, std::slice::from_ref(&id))
        .map_err(store_error)?
        .into_iter()
        .next()
        .ok_or_else(not_found)?;
    let terminals = group_terminals(
        agent_terminal_associations(store, std::slice::from_ref(&id)).map_err(store_error)?,
    )
    .remove(&String::from(id.clone()))
    .unwrap_or_default();

    Ok(Json(SessionDetailResponse {
        session: summary_dto(&root, &aggregate, terminals),
        nodes: node_dtos(&nodes),
        truncated,
        max_nodes: MAX_TREE_NODES,
        max_depth: MAX_TREE_DEPTH,
        paused: !telemetry.control.is_enabled(),
    }))
}

fn not_found() -> ApiError {
    ApiError::from_app(AppError::NotFound("Usage session not found".to_string()))
}

pub(super) fn unavailable() -> ApiError {
    ApiError::from_app(AppError::Unavailable(
        "Usage analytics unavailable".to_string(),
    ))
}

fn store_error(_: crate::telemetry::store::TelemetryStoreError) -> ApiError {
    unavailable()
}
