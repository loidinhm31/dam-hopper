use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::session_changes::binding::get_retained_session_list;
use crate::session_changes::comparison::{list_changed_files, run_comparison_scan};
use crate::session_changes::inventory::capture_inventory;
use crate::session_changes::store::{FromNowRecord, SessionChangesKey, SessionChangesRecord};
use crate::session_changes::types::*;
use crate::state::AppState;

fn error_response(status: StatusCode, code: ErrorCode, reason: impl Into<String>) -> Response {
    let body = ErrorBody {
        version: 1,
        code,
        retryable: code == ErrorCode::Busy || code == ErrorCode::Deadline,
        current_revision: None,
        reason: reason.into(),
    };
    (
        status,
        [
            (header::CACHE_CONTROL, "private, no-store"),
            (header::VARY, "Authorization, Cookie"),
        ],
        Json(body),
    )
        .into_response()
}

fn success_json<T: serde::Serialize>(val: T) -> Response {
    (
        StatusCode::OK,
        [
            (header::CACHE_CONTROL, "private, no-store"),
            (header::VARY, "Authorization, Cookie"),
        ],
        Json(val),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct StatusQuery {
    #[serde(rename = "terminalIncarnation")]
    pub terminal_incarnation: String,
    #[serde(rename = "ompSessionId", default)]
    pub omp_session_id: Option<String>,
    #[serde(rename = "expectedServerEpoch", default)]
    pub expected_server_epoch: Option<String>,
}

pub async fn get_status(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Query(query): Query<StatusQuery>,
) -> Response {
    if !is_valid_canonical_decimal_string(&query.terminal_incarnation) {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::IncarnationMismatch,
            "terminalIncarnation must be canonical decimal string",
        );
    }

    // If ompSessionId is omitted, return the retained session list for this terminal
    let Some(omp_session_id) = query.omp_session_id else {
        match get_retained_session_list(
            &state.session_changes,
            &terminal_id,
            &query.terminal_incarnation,
        ) {
            Ok(list) => return success_json(list),
            Err(code) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    code,
                    "Failed to list retained sessions",
                );
            }
        }
    };

    if let Some(expected_epoch) = query.expected_server_epoch {
        if expected_epoch != state.session_changes.server_epoch {
            return error_response(
                StatusCode::GONE,
                ErrorCode::ServerRestarted,
                "Server epoch mismatch",
            );
        }
    }

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: query.terminal_incarnation,
        omp_session_id,
        root_id: ".".into(),
    };

    let status = state.session_changes.build_status(&key);
    success_json(status)
}

pub async fn from_now(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(req): Json<FromNowRequest>,
) -> Response {
    if req.version != 1 {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Invalid version: must be 1",
        );
    }
    if !is_valid_canonical_decimal_string(&req.terminal_incarnation) {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::IncarnationMismatch,
            "terminalIncarnation must be canonical decimal string",
        );
    }
    if let Some(expected_epoch) = req.expected_server_epoch {
        if expected_epoch != state.session_changes.server_epoch {
            return error_response(
                StatusCode::GONE,
                ErrorCode::ServerRestarted,
                "Server epoch mismatch",
            );
        }
    }

    let key = SessionChangesKey {
        terminal_id: terminal_id.clone(),
        terminal_incarnation: req.terminal_incarnation.clone(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    // If an acknowledged baseline already exists, return it unchanged
    {
        let records = state.session_changes.records.lock();
        if let Some(rec) = records.get(&key) {
            if rec.state == StatusState::Ready || rec.state == StatusState::Incomplete {
                drop(records);
                let st = state.session_changes.build_status(&key);
                return success_json(st);
            }
        }
    }

    let inc = match req.terminal_incarnation.parse::<u64>() {
        Ok(i) => i,
        Err(_) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::IncarnationMismatch,
                "Invalid incarnation",
            );
        }
    };

    let bound = match state.session_changes.get_bound_terminal_target(&terminal_id, inc) {
        Some(b) => b,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                ErrorCode::TargetUnavailable,
                "Terminal target is not bound or incarnation mismatched",
            );
        }
    };

    let mut preflight_budget = crate::session_changes::root::PreflightBudget::default();
    let validated_root = match crate::session_changes::root::validate_project_root_preflight(
        &bound.launch_cwd,
        &req.root_id,
        None,
        &mut preflight_budget,
    ) {
        Ok(r) => r,
        Err(_) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::RootMismatch,
                "Root preflight validation failed",
            );
        }
    };
    let canonical_root = validated_root.canonical_root;
    // Acquire blocking permit
    let _permit = match state.session_changes.blocking_permits.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::Busy,
                "Scan in progress",
            );
        }
    };

    let root_clone = canonical_root.clone();
    let inventory = match tokio::task::spawn_blocking(move || {
        capture_inventory(&root_clone, Duration::from_secs(MAX_PREPARE_CAPTURE_DURATION_SECS))
    })
    .await
    {
        Ok(Ok(inv)) => inv,
        _ => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorCode::TargetUnavailable,
                "Capture failed",
            );
        }
    };

    let baseline_id = Uuid::new_v4().to_string();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let from_now_rec = FromNowRecord {
        baseline_id: baseline_id.clone(),
        captured_at_ms: now_ms,
        baseline_inventory: inventory.clone(),
        comparison_revision: 0,
    };

    let baseline_coverage = inventory.coverage.clone();
    let coverage_state = baseline_coverage.state;

    if let Err(e) = state.session_changes.try_reserve_storage(inventory.coverage.raw_bytes) {
        return error_response(StatusCode::TOO_MANY_REQUESTS, e, "Storage capacity exceeded");
    }

    {
        let mut records = state.session_changes.records.lock();
        if let Some(existing) = records.get(&key) {
            if let Some(prev_cov) = &existing.baseline_coverage {
                state.session_changes.release_storage(prev_cov.raw_bytes);
            }
        }
        let rec = records.entry(key.clone()).or_insert_with(|| SessionChangesRecord {
            registration_id: req.request_id,
            baseline_id: Some(baseline_id.clone()),
            activation_nonce: None,
            activation_receipt_id: None,
            captured_at_ms: Some(now_ms),
            prepared_at: Some(Instant::now()),
            prepared_ttl_ms: 15000,
            origin: Some(Origin::FromNow),
            state: if coverage_state == CoverageState::Complete {
                StatusState::Ready
            } else {
                StatusState::Incomplete
            },
            acknowledgment: Acknowledgment::NotApplicable,
            baseline_inventory: Some(inventory.clone()),
            baseline_coverage: Some(baseline_coverage.clone()),
            comparison: None,
            current_revision_manifest: None,
            comparison_revision: 0,
            reason: None,
            original_failed: false,
            active_from_now: Some(from_now_rec.clone()),
            recent_turn_ids: std::collections::BTreeSet::new(),
            last_settled_turn_id: None,
            dirty_settled_hint: false,
            canonical_root,
        });

        rec.baseline_id = Some(baseline_id.clone());
        rec.origin = Some(Origin::FromNow);
        rec.acknowledgment = Acknowledgment::NotApplicable;
        rec.state = if coverage_state == CoverageState::Complete {
            StatusState::Ready
        } else {
            StatusState::Incomplete
        };
        rec.captured_at_ms = Some(now_ms);
        rec.baseline_coverage = Some(baseline_coverage);
        rec.baseline_inventory = Some(inventory);
        rec.comparison = None;
        rec.current_revision_manifest = None;
        rec.comparison_revision = 0;
        rec.active_from_now = Some(from_now_rec);
        rec.original_failed = false;
        rec.reason = None;
    }

    let status = state.session_changes.build_status(&key);
    success_json(status)
}

pub async fn refresh(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(req): Json<RefreshRequest>,
) -> Response {
    if req.version != 1 {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Invalid version",
        );
    }
    if req.server_epoch != state.session_changes.server_epoch {
        return error_response(
            StatusCode::GONE,
            ErrorCode::ServerRestarted,
            "Server epoch mismatch",
        );
    }

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: req.terminal_incarnation,
        omp_session_id: req.omp_session_id,
        root_id: ".".into(),
    };
    {
        let records = state.session_changes.records.lock();
        let rec = match records.get(&key) {
            Some(r) => r,
            None => {
                return error_response(
                    StatusCode::NOT_FOUND,
                    ErrorCode::BaselineMissing,
                    "Baseline record missing",
                );
            }
        };
        if rec.baseline_id.as_deref() != Some(&req.baseline_id) {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::RefreshRequired,
                "Baseline ID mismatch, refresh required",
            );
        }
    }

    match run_comparison_scan(&state.session_changes, &key, None).await {
        Ok(comp) => success_json(comp),
        Err(ErrorCode::Busy) => {
            error_response(StatusCode::CONFLICT, ErrorCode::Busy, "Comparison busy")
        }
        Err(code) => {
            error_response(StatusCode::BAD_REQUEST, code, "Refresh comparison failed")
        }
    }
}

fn default_root_id() -> String {
    ".".into()
}

#[derive(Deserialize)]
pub struct FilesQuery {
    #[serde(rename = "terminalIncarnation")]
    pub terminal_incarnation: String,
    #[serde(rename = "ompSessionId")]
    pub omp_session_id: String,
    #[serde(rename = "rootId", default = "default_root_id")]
    pub root_id: String,
    #[serde(rename = "serverEpoch")]
    pub server_epoch: String,
    #[serde(rename = "baselineId")]
    pub baseline_id: String,
    #[serde(rename = "comparisonRevision")]
    pub comparison_revision: String,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

pub async fn get_files(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Query(query): Query<FilesQuery>,
) -> Response {
    if query.server_epoch != state.session_changes.server_epoch {
        return error_response(
            StatusCode::GONE,
            ErrorCode::ServerRestarted,
            "Server epoch mismatch",
        );
    }

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: query.terminal_incarnation,
        omp_session_id: query.omp_session_id,
        root_id: query.root_id,
    };

    {
        let records = state.session_changes.records.lock();
        let rec = match records.get(&key) {
            Some(r) => r,
            None => {
                return error_response(
                    StatusCode::NOT_FOUND,
                    ErrorCode::BaselineMissing,
                    "Baseline not found",
                );
            }
        };
        if rec.baseline_id.as_deref() != Some(&query.baseline_id) {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::RefreshRequired,
                "Baseline ID mismatch, refresh required",
            );
        }
    }
    match list_changed_files(
        &state.session_changes,
        &key,
        &query.comparison_revision,
        query.cursor.as_deref(),
        query.limit,
    ) {
        Ok(page) => success_json(page),
        Err(ErrorCode::RefreshRequired) => error_response(
            StatusCode::CONFLICT,
            ErrorCode::RefreshRequired,
            "Revision has advanced",
        ),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code, "Failed to list files"),
    }
}

#[derive(Deserialize)]
pub struct FileDetailQuery {
    #[serde(rename = "terminalIncarnation")]
    pub terminal_incarnation: String,
    #[serde(rename = "ompSessionId")]
    pub omp_session_id: String,
    #[serde(rename = "rootId", default = "default_root_id")]
    pub root_id: String,
    #[serde(rename = "serverEpoch")]
    pub server_epoch: String,
    #[serde(rename = "baselineId")]
    pub baseline_id: String,
    #[serde(rename = "comparisonRevision")]
    pub comparison_revision: String,
}

pub async fn get_file_detail(
    State(state): State<AppState>,
    Path((terminal_id, file_id)): Path<(String, String)>,
    Query(query): Query<FileDetailQuery>,
) -> Response {
    if query.server_epoch != state.session_changes.server_epoch {
        return error_response(
            StatusCode::GONE,
            ErrorCode::ServerRestarted,
            "Server epoch mismatch",
        );
    }

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: query.terminal_incarnation,
        omp_session_id: query.omp_session_id,
        root_id: query.root_id,
    };

    let records = state.session_changes.records.lock();
    let rec = match records.get(&key) {
        Some(r) => r,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                ErrorCode::BaselineMissing,
                "Baseline not found",
            );
        }
    };

    if rec.baseline_id.as_deref() != Some(&query.baseline_id) {
        return error_response(
            StatusCode::CONFLICT,
            ErrorCode::RefreshRequired,
            "Baseline mismatch, refresh required",
        );
    }

    if rec.comparison_revision.to_string() != query.comparison_revision {
        return error_response(
            StatusCode::CONFLICT,
            ErrorCode::RefreshRequired,
            "Revision mismatch, refresh required",
        );
    }
    drop(records);

    match crate::session_changes::comparison::get_file_detail(
        &state.session_changes,
        &key,
        &query.comparison_revision,
        &file_id,
    ) {
        Ok(detail) => success_json(detail),
        Err(ErrorCode::FileMissing) => {
            error_response(StatusCode::NOT_FOUND, ErrorCode::FileMissing, "File missing")
        }
        Err(ErrorCode::RefreshRequired) => error_response(
            StatusCode::CONFLICT,
            ErrorCode::RefreshRequired,
            "Revision has advanced",
        ),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code, "Failed to get file detail"),
    }
}
