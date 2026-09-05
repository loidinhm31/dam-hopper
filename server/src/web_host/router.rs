//! Axum router configuration for the dedicated static web host.

use axum::{
    body::Body,
    extract::State,
    http::{header, Method, Request, Response, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::io::ReaderStream;

use super::cache_policy::{cache_control_for_path, CACHE_NO_CACHE, CACHE_NO_STORE};
use super::runtime_config::{WebHealthResponse, WebRuntimeConfig};
use super::safe_path::{resolve_static_file, should_spa_fallback};

#[derive(Clone)]
pub struct WebHostState {
    pub root: PathBuf,
    pub release_version: String,
    pub runtime_config: Option<Arc<WebRuntimeConfig>>,
}

/// Builds the dedicated web host router with strict routes, method guards, and SPA fallback.
pub fn build_web_router(state: WebHostState) -> Router {
    Router::new()
        .route("/__dam-hopper/health", get(health_handler))
        .route(
            "/__dam-hopper/runtime-config.json",
            get(runtime_config_handler),
        )
        .fallback(static_fallback_handler)
        .with_state(state)
}

/// Handler for `GET /__dam-hopper/health`.
async fn health_handler(State(state): State<WebHostState>) -> impl IntoResponse {
    let payload = WebHealthResponse::new(&state.release_version);
    let body = serde_json::to_vec(&payload).unwrap_or_default();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, CACHE_NO_STORE)
        .header(header::CONTENT_LENGTH, body.len())
        .body(Body::from(body))
        .unwrap()
}

/// Handler for `GET /__dam-hopper/runtime-config.json`.
async fn runtime_config_handler(State(state): State<WebHostState>) -> impl IntoResponse {
    let Some(cfg) = &state.runtime_config else {
        return (
            StatusCode::NOT_FOUND,
            [(header::CACHE_CONTROL, CACHE_NO_STORE)],
            "runtime config not found",
        )
            .into_response();
    };

    let body = serde_json::to_vec(cfg.as_ref()).unwrap_or_default();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, CACHE_NO_STORE)
        .header(header::CONTENT_LENGTH, body.len())
        .body(Body::from(body))
        .unwrap()
}

/// Static file and SPA fallback handler for all other routes.
async fn static_fallback_handler(
    State(state): State<WebHostState>,
    req: Request<Body>,
) -> impl IntoResponse {
    let method = req.method();
    if method != Method::GET && method != Method::HEAD {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET, HEAD")
            .body(Body::empty())
            .unwrap();
    }

    let is_head = method == Method::HEAD;
    let path = req.uri().path();

    // Reserved namespace cannot fall through to dist or SPA
    if path.starts_with("/__dam-hopper") {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CACHE_CONTROL, CACHE_NO_STORE)
            .body(Body::empty())
            .unwrap();
    }

    // Try resolving as real static file
    match resolve_static_file(&state.root, path) {
        Ok(Some(file_path)) => serve_file(&file_path, path, is_head).await,
        Ok(None) => {
            let accept = req
                .headers()
                .get(header::ACCEPT)
                .and_then(|v| v.to_str().ok());

            if should_spa_fallback(path, accept) {
                match resolve_static_file(&state.root, "/index.html") {
                    Ok(Some(index_path)) => serve_spa_index(&index_path, is_head).await,
                    _ => not_found_response(),
                }
            } else {
                not_found_response()
            }
        }
        Err(_) => not_found_response(),
    }
}

async fn serve_file(path: &PathBuf, uri_path: &str, is_head: bool) -> Response<Body> {
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return not_found_response(),
    };

    let meta = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return not_found_response(),
    };

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache_control = cache_control_for_path(uri_path);

    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::CONTENT_LENGTH, meta.len());

    if is_head {
        builder.body(Body::empty()).unwrap()
    } else {
        let stream = ReaderStream::new(file);
        builder.body(Body::from_stream(stream)).unwrap()
    }
}

async fn serve_spa_index(path: &PathBuf, is_head: bool) -> Response<Body> {
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return not_found_response(),
    };

    let meta = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return not_found_response(),
    };

    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, CACHE_NO_CACHE)
        .header(header::CONTENT_LENGTH, meta.len());

    if is_head {
        builder.body(Body::empty()).unwrap()
    } else {
        let stream = ReaderStream::new(file);
        builder.body(Body::from_stream(stream)).unwrap()
    }
}

fn not_found_response() -> Response<Body> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::empty())
        .unwrap()
}
