use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::session_changes::binding::get_retained_session_list;
use crate::session_changes::comparison::{get_file_detail as compare_get_file_detail, list_changed_files, run_comparison_scan};
use crate::session_changes::store::SessionChangesKey;
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

fn default_root_id() -> String {
    ".".into()
}

#[derive(Deserialize)]
pub struct StatusQuery {
    #[serde(rename = "terminalIncarnation")]
    pub terminal_incarnation: String,
    #[serde(rename = "ompSessionId", default)]
    pub omp_session_id: Option<String>,
    #[serde(rename = "rootId", default = "default_root_id")]
    pub root_id: String,
    #[serde(rename = "expectedServerEpoch", default)]
    pub expected_server_epoch: Option<String>,
}

pub async fn get_status(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Query(query): Query<StatusQuery>,
) -> Response {
    if !state.session_changes.is_enabled() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::TrackingDisabled,
            "Session changes tracking is disabled",
        );
    }

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
        root_id: query.root_id,
    };

    let status = state.session_changes.build_status(&key);
    success_json(status)
}

pub async fn refresh(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Json(req): Json<RefreshRequest>,
) -> Response {
    if !state.session_changes.is_enabled() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::TrackingDisabled,
            "Session changes tracking is disabled",
        );
    }

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
        root_id: req.root_id,
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
        if rec.baseline_id != req.baseline_id {
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
        Err(ErrorCode::TrackingDisabled) => {
            error_response(StatusCode::SERVICE_UNAVAILABLE, ErrorCode::TrackingDisabled, "Tracking disabled")
        }
        Err(ErrorCode::RefreshRequired) => {
            error_response(StatusCode::CONFLICT, ErrorCode::RefreshRequired, "Comparison superseded, refresh required")
        }
        Err(code) => {
            error_response(StatusCode::BAD_REQUEST, code, "Refresh comparison failed")
        }
    }
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
    pub comparison_revision: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

pub async fn get_files(
    State(state): State<AppState>,
    Path(terminal_id): Path<String>,
    Query(query): Query<FilesQuery>,
) -> Response {
    if !state.session_changes.is_enabled() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::TrackingDisabled,
            "Session changes tracking is disabled",
        );
    }

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

    if query.cursor.is_some() && query.comparison_revision.is_none() {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Cursor queries require comparisonRevision",
        );
    }

    let revision = match &query.comparison_revision {
        Some(rev) => {
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
            if rec.baseline_id != query.baseline_id {
                return error_response(
                    StatusCode::CONFLICT,
                    ErrorCode::RefreshRequired,
                    "Baseline ID mismatch, refresh required",
                );
            }
            if rec.comparison_revision.to_string() != *rev {
                return error_response(
                    StatusCode::CONFLICT,
                    ErrorCode::RefreshRequired,
                    "Revision mismatch, refresh required",
                );
            }
            rev.clone()
        }
        None => {
            // Lazy comparison bootstrap when comparisonRevision is omitted
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
                if rec.baseline_id != query.baseline_id {
                    return error_response(
                        StatusCode::CONFLICT,
                        ErrorCode::RefreshRequired,
                        "Baseline ID mismatch, refresh required",
                    );
                }
            }

            match run_comparison_scan(&state.session_changes, &key, None).await {
                Ok(comp) => comp.comparison_revision,
                Err(ErrorCode::Busy) => {
                    return error_response(StatusCode::CONFLICT, ErrorCode::Busy, "Comparison busy");
                }
                Err(ErrorCode::RefreshRequired) => {
                    return error_response(StatusCode::CONFLICT, ErrorCode::RefreshRequired, "Comparison superseded, refresh required");
                }
                Err(code) => {
                    return error_response(StatusCode::BAD_REQUEST, code, "Lazy comparison failed");
                }
            }
        }
    };

    match list_changed_files(
        &state.session_changes,
        &key,
        &revision,
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
    if !state.session_changes.is_enabled() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::TrackingDisabled,
            "Session changes tracking is disabled",
        );
    }

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

        if rec.baseline_id != query.baseline_id {
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
    }

    match compare_get_file_detail(
        &state.session_changes,
        &key,
        &query.comparison_revision,
        &file_id,
    )
    .await
    {
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
