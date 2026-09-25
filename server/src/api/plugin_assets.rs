use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, HeaderName, HeaderValue, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum_extra::extract::CookieJar;
use serde::Deserialize;

use crate::api::auth;
use crate::api::auth::AuthenticatedActor;
use crate::plugins::error::{PluginError, PluginErrorCode};
use crate::state::AppState;
use crate::workspace_target::ProjectTargetRef;

const X_CONTENT_TYPE_OPTIONS: HeaderName = HeaderName::from_static("x-content-type-options");
const CONTENT_SECURITY_POLICY: HeaderName = HeaderName::from_static("content-security-policy");
const X_PLUGIN_UI_SHA256: HeaderName = HeaderName::from_static("x-plugin-ui-sha256");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUiAssetQuery {
    pub project: String,
    pub worktree_path: Option<String>,
    pub active_digest: String,
    pub activation_generation: u64,
}

pub async fn require_inert_asset_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let response = auth::require_auth(State(state), jar, request, next).await;
    if response.status() == StatusCode::UNAUTHORIZED {
        empty_error(StatusCode::UNAUTHORIZED)
    } else {
        response
    }
}

pub async fn plugin_ui_asset_handler(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(installation_id): Path<String>,
    Query(query): Query<PluginUiAssetQuery>,
) -> Response {
    if state.no_auth {
        return empty_error(StatusCode::FORBIDDEN);
    }
    let Some(Extension(actor)) = actor else {
        return empty_error(StatusCode::UNAUTHORIZED);
    };

    let configured_root = match state.workspace_target_project_path(&query.project).await {
        Ok(path) => path,
        Err(_) => return empty_error(StatusCode::NOT_FOUND),
    };
    let target = ProjectTargetRef {
        project: query.project,
        worktree_path: query.worktree_path,
    };

    match state
        .plugin_service
        .read_ui_asset(
            &actor,
            &installation_id,
            &target,
            &configured_root,
            &query.active_digest,
            query.activation_generation,
            state.no_auth,
        )
        .await
    {
        Ok(asset) => {
            let mut response = asset.bytes.into_response();
            let headers = response.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
            headers.insert(
                X_PLUGIN_UI_SHA256,
                HeaderValue::from_str(&asset.sha256)
                    .expect("verified SHA-256 is always a valid header value"),
            );
            headers.insert(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment; filename=\"plugin-ui.bin\""),
            );
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, no-store"),
            );
            headers.insert(
                CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("default-src 'none'; sandbox"),
            );
            response
        }
        Err(error) => empty_error(status_for_error(&error)),
    }
}

fn status_for_error(error: &PluginError) -> StatusCode {
    match error.code {
        PluginErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
        PluginErrorCode::Forbidden | PluginErrorCode::SourcePermissionDenied => {
            StatusCode::FORBIDDEN
        }
        PluginErrorCode::SourceMissing | PluginErrorCode::SourceNotConfigured => {
            StatusCode::NOT_FOUND
        }
        PluginErrorCode::InvalidInput | PluginErrorCode::DetailChangedOrMissing => {
            StatusCode::BAD_REQUEST
        }
        PluginErrorCode::ContextRevoked | PluginErrorCode::SnapshotExpired => StatusCode::GONE,
        PluginErrorCode::Overloaded => StatusCode::TOO_MANY_REQUESTS,
        PluginErrorCode::DeadlineExceeded => StatusCode::GATEWAY_TIMEOUT,
        PluginErrorCode::Cancelled => StatusCode::CONFLICT,
        PluginErrorCode::Incompatible
        | PluginErrorCode::WorkerFailed
        | PluginErrorCode::RunnerUnavailable
        | PluginErrorCode::RuntimeUnavailable => StatusCode::SERVICE_UNAVAILABLE,
    }
}

fn empty_error(status: StatusCode) -> Response {
    let mut response = status.into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    response
}
