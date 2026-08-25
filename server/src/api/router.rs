use std::{collections::HashSet, path::PathBuf, sync::Arc};

use axum::http::{
    header::{
        ACCEPT, ACCEPT_RANGES, AUTHORIZATION, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH,
        CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, IF_RANGE,
        LAST_MODIFIED, RANGE,
    },
    HeaderValue, Method, StatusCode, Uri,
};
use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{any, delete, get, patch, post, put},
    Router,
};
use tower_http::{
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
};

/// 10 MB — generous for config/settings payloads, blocks accidental multi-GB uploads.
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

use crate::state::AppState;

use super::{
    agent_import, agent_memory, agent_store, auth, browser_debug, commands, config, diagnostics,
    fs as fs_api, fs_image, fs_video, git, git_diff, host_actions, media_session,
    port_forward as port_forward_api, settings, ssh, system, terminal, tunnel, usage,
    usage_sessions, workspace, ws,
};

/// Build the full Axum router without cross-origin browser access.
///
/// Production startup should use [`build_router_with_origins`] with an explicit
/// allowlist when the UI is hosted separately.
pub fn build_router(state: AppState) -> Router {
    build_router_with_origins(state, Vec::new())
}

/// Build the router with an exact allowlist for credentialed browser requests.
pub fn build_router_with_origins(state: AppState, allowed_origins: Vec<HeaderValue>) -> Router {
    build_router_with_web_dir_and_origins(state, allowed_origins, static_web_dir())
}

#[cfg(test)]
pub(crate) fn build_router_with_web_dir(state: AppState, web_dir: PathBuf) -> Router {
    build_router_with_web_dir_and_origins(state, Vec::new(), web_dir)
}

fn build_router_with_web_dir_and_origins(
    mut state: AppState,
    allowed_origins: Vec<HeaderValue>,
    web_dir: PathBuf,
) -> Router {
    state.cors_origins = Arc::new(
        allowed_origins
            .iter()
            .filter_map(|origin| origin.to_str().ok().map(str::to_owned))
            .collect(),
    );

    // Public routes — no auth required
    let public = Router::new()
        .route("/api/health", get(settings::health))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/status", get(auth::status))
        .route("/ws", get(ws::ws_handler));

    // Protected routes — auth middleware checks damhopper-auth cookie
    let protected = Router::new()
        // Workspace
        .route("/api/workspace/status", get(workspace::get_status))
        .route("/api/workspace", get(workspace::get_workspace))
        .route("/api/workspace/init", post(workspace::init_workspace))
        .route("/api/workspace/switch", post(workspace::switch_workspace))
        .route(
            "/api/workspace/discover",
            get(workspace::discover_projects_handler),
        )
        .route("/api/workspace/known", get(workspace::list_known))
        .route("/api/workspace/known", post(workspace::add_known))
        .route("/api/workspace/known", delete(workspace::remove_known))
        // Global config
        .route("/api/global-config", get(config::get_global_config))
        .route(
            "/api/global-config/defaults",
            post(config::update_global_defaults),
        )
        .route("/api/global-config/ui", post(config::update_global_ui))
        // Projects
        .route("/api/projects", get(config::list_projects))
        .route("/api/projects/{name}", get(config::get_project))
        .route(
            "/api/projects/{name}/status",
            get(config::get_project_status),
        )
        // Config
        .route("/api/config", get(config::get_config))
        .route("/api/config", put(config::update_config))
        .route("/api/config/projects/{name}", patch(config::update_project))
        // Usage analytics is aggregate-only and always protected by this router.
        .route("/api/usage/summary", get(usage::summary))
        .route("/api/usage/sessions", get(usage_sessions::list_sessions))
        .route("/api/usage/sessions/{id}", get(usage_sessions::get_session))
        .route("/api/usage/health", get(usage::health))
        .route(
            "/api/usage/settings",
            get(usage::get_settings)
                .post(usage::update_settings)
                .patch(usage::update_settings),
        )
        .route(
            "/api/usage/setup",
            get(usage::get_setup_status).patch(usage::update_settings),
        )
        .route("/api/usage", delete(usage::delete_all))
        // Git
        .route("/api/git/fetch", post(git::fetch_projects))
        .route("/api/git/pull", post(git::pull_projects))
        .route("/api/git/push", post(git::push_project))
        .route("/api/git/{project}/roots", get(git::get_vcs_roots))
        .route(
            "/api/git/{project}/worktrees/prune",
            post(git::prune_worktrees_route),
        )
        .route("/api/git/{project}/worktrees", get(git::get_worktrees))
        .route(
            "/api/git/{project}/worktrees",
            post(git::add_worktree_route),
        )
        .route(
            "/api/git/{project}/worktrees",
            delete(git::remove_worktree_route),
        )
        .route(
            "/api/git/{project}/branches",
            get(git::get_branches)
                .post(git::create_branch_route)
                .delete(git::delete_branch_route),
        )
        .route(
            "/api/git/{project}/branches/checkout",
            post(git::checkout_branch_route),
        )
        .route(
            "/api/git/{project}/branches/update",
            post(git::update_branch_route),
        )
        .route("/api/git/{project}/log", get(git::get_log_route))
        .route(
            "/api/git/{project}/cherry-pick",
            post(git::cherry_pick_route),
        )
        .route("/api/git/{project}/reset", post(git::reset_route))
        .route(
            "/api/git/{project}/undo-last-commit",
            post(git::undo_last_commit_route),
        )
        // Git diff / change management
        .route("/api/git/{project}/diff", get(git_diff::list_diff))
        .route(
            "/api/git/{project}/untracked",
            get(git_diff::list_untracked),
        )
        .route("/api/git/{project}/diff/file", get(git_diff::get_file_diff))
        .route("/api/git/{project}/stage", post(git_diff::stage))
        .route("/api/git/{project}/unstage", post(git_diff::unstage))
        .route("/api/git/{project}/discard", post(git_diff::discard))
        .route(
            "/api/git/{project}/discard-hunk",
            post(git_diff::discard_hunk),
        )
        .route(
            "/api/git/{project}/conflicts",
            get(git_diff::list_conflicts),
        )
        .route("/api/git/{project}/resolve", post(git_diff::resolve))
        .route("/api/git/{project}/commit", post(git_diff::commit))
        .route(
            "/api/git/{project}/commit/{hash}/files",
            get(git_diff::get_commit_files),
        )
        .route(
            "/api/git/{project}/commit/{hash}/message",
            get(git::get_commit_message_route).post(git::edit_commit_message_route),
        )
        .route(
            "/api/git/{project}/commit/{hash}/diff",
            get(git_diff::get_commit_file_diff),
        )
        .route(
            "/api/git/{project}/commit/{hash}/cherry-pick-files",
            post(git::cherry_pick_commit_files_route),
        )
        .route(
            "/api/git/{project}/commit/{hash}/drop-files",
            post(git::drop_commit_files_route),
        )
        .route(
            "/api/git/{project}/commit/{hash}/drop",
            post(git::drop_commit_route),
        )
        .route(
            "/api/git/{project}/commit/{hash}/revert",
            post(git::revert_commit_route),
        )
        .route(
            "/api/git/{project}/commit/{hash}/revert-files",
            post(git::revert_commit_files_route),
        )
        // Terminal — order matters: specific paths before parameterized
        .route("/api/terminal", post(terminal::create_session))
        .route("/api/terminal", get(terminal::list_sessions))
        .route("/api/terminal/detailed", get(terminal::list_detailed))
        .route("/api/terminal/{id}/buffer", get(terminal::get_buffer))
        .route("/api/terminal/{id}", delete(terminal::kill_session))
        .route(
            "/api/terminal/{id}/remove",
            delete(terminal::remove_session),
        )
        // Browser debug artifacts — no read/list endpoint by design.
        .route(
            "/api/browser-debug/artifacts",
            post(browser_debug::create).layer(RequestBodyLimitLayer::new(
                crate::browser_debug::MAX_SELECTION_JSON_BYTES,
            )),
        )
        .route(
            "/api/browser-debug/artifacts/{id}/png",
            put(browser_debug::upload_png).layer(RequestBodyLimitLayer::new(
                crate::browser_debug::MAX_PNG_BYTES,
            )),
        )
        .route(
            "/api/browser-debug/artifacts/{id}/handoff",
            post(browser_debug::handoff),
        )
        .route(
            "/api/browser-debug/artifacts/{id}",
            delete(browser_debug::delete),
        )
        // Tunnels
        .route(
            "/api/tunnels/install",
            get(tunnel::install_status).post(tunnel::install_cloudflared),
        )
        .route("/api/tunnels", post(tunnel::create_tunnel))
        .route("/api/tunnels", get(tunnel::list_tunnels))
        .route("/api/tunnels/{id}", delete(tunnel::stop_tunnel))
        // Port forwarding
        .route("/api/ports", get(port_forward_api::list_ports))
        // Host system metrics
        .route("/api/system/metrics", get(system::get_metrics))
        .route(
            "/api/system/resources/v1/snapshot",
            get(system::get_snapshot),
        )
        .route("/api/system/resources/v1/alerts", get(system::get_alerts))
        // Deferred host-action scaffolding stays fail-closed and out of Phase 07 scope.
        .route(
            "/api/system/actions/v1/capabilities",
            get(host_actions::capabilities),
        )
        .route(
            "/api/system/actions/v1/intents",
            post(host_actions::create_intent)
                .layer(RequestBodyLimitLayer::new(8 * 1024))
                .route_layer(middleware::from_fn(host_actions::require_action_request)),
        )
        .route(
            "/api/system/actions/v1/intents/{id}/approve",
            post(host_actions::approve_intent)
                .layer(RequestBodyLimitLayer::new(8 * 1024))
                .route_layer(middleware::from_fn(host_actions::require_action_request)),
        )
        .route(
            "/api/system/actions/v1/executions",
            post(host_actions::create_execution)
                .layer(RequestBodyLimitLayer::new(8 * 1024))
                .route_layer(middleware::from_fn(host_actions::require_action_request)),
        )
        .route(
            "/api/system/actions/v1/executions/{id}",
            get(host_actions::get_execution),
        )
        .route("/api/system/actions/v1/audit", get(host_actions::get_audit))
        // Diagnostics
        .route(
            "/api/diagnostics/export",
            post(diagnostics::export_diagnostics),
        )
        // Agent Store — static paths before dynamic
        .route("/api/agent-store/matrix", get(agent_store::get_matrix))
        .route("/api/agent-store/scan", get(agent_store::scan))
        .route("/api/agent-store/health", get(agent_store::health_check))
        .route("/api/agent-store/ship", post(agent_store::ship_item))
        .route("/api/agent-store/unship", post(agent_store::unship_item))
        .route("/api/agent-store/absorb", post(agent_store::absorb_item))
        .route(
            "/api/agent-store/bulk-ship",
            post(agent_store::bulk_ship_items),
        )
        .route("/api/agent-store", get(agent_store::list_items))
        .route(
            "/api/agent-store/{category}/{name}",
            get(agent_store::get_item),
        )
        .route(
            "/api/agent-store/{category}/{name}/content",
            get(agent_store::get_item_content),
        )
        .route(
            "/api/agent-store/{category}/{name}",
            delete(agent_store::remove_item),
        )
        // Agent Memory — static paths before dynamic
        .route(
            "/api/agent-memory/templates",
            get(agent_memory::list_templates),
        )
        .route(
            "/api/agent-memory/apply",
            post(agent_memory::apply_memory_template),
        )
        .route(
            "/api/agent-memory/{projectName}",
            get(agent_memory::list_project_memory),
        )
        .route(
            "/api/agent-memory/{projectName}/{agent}",
            get(agent_memory::get_project_memory),
        )
        .route(
            "/api/agent-memory/{projectName}/{agent}",
            put(agent_memory::update_project_memory),
        )
        // Agent Import
        .route(
            "/api/agent-import/scan",
            post(agent_import::scan_repo_handler),
        )
        .route(
            "/api/agent-import/scan-local",
            post(agent_import::scan_local_handler),
        )
        .route(
            "/api/agent-import/confirm",
            post(agent_import::import_confirm_handler),
        )
        // SSH credentials
        .route("/api/ssh/keys", get(ssh::list_keys))
        .route("/api/ssh/agent", get(ssh::check_agent))
        .route("/api/ssh/keys/load", post(ssh::load_key))
        .route(
            "/api/ssh/credentials",
            get(ssh::credential_status).delete(ssh::forget_credential),
        )
        // Commands
        .route("/api/commands/search", get(commands::search_commands))
        .route("/api/commands", get(commands::list_commands))
        // Settings
        .route("/api/settings/cache-clear", post(settings::cache_clear))
        .route("/api/settings/reset", post(settings::reset))
        .route("/api/settings/export", get(settings::export_settings))
        .route("/api/settings/import", post(settings::import_settings))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    // IDE file explorer routes.
    let ide_routes = Router::new()
        .route("/api/fs/list", get(fs_api::list))
        .route("/api/fs/read", get(fs_api::read))
        .route("/api/fs/stat", get(fs_api::stat))
        .route("/api/fs/download", get(fs_api::download))
        .route(
            "/api/fs/video/tickets",
            post(fs_video::issue_ticket).delete(fs_video::revoke_ticket),
        )
        .route(
            "/api/fs/image/tickets",
            post(fs_image::issue_ticket).delete(fs_image::revoke_ticket),
        )
        .route(
            "/api/fs/media-session",
            delete(media_session::revoke_current_session),
        )
        .route("/api/fs/language-files", get(fs_api::language_files))
        .route("/api/fs/search", get(fs_api::search))
        .route("/api/fs/search-paths", get(fs_api::search_paths))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    // Streams remain outside bearer middleware. A cookie authorizes same-origin
    // requests; ticket-only fallback is marked only for an exact allowed origin.
    let video_stream = Router::new()
        .route(
            "/api/fs/video/stream/{ticket}",
            get(fs_video::stream_ticket).head(fs_video::stream_ticket),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            mark_allowed_media_origin,
        ));
    let image_stream = Router::new()
        .route(
            "/api/fs/image/stream/{ticket}",
            get(fs_image::stream_ticket).head(fs_image::stream_ticket),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            mark_allowed_media_origin,
        ));

    let router = Router::new()
        .merge(public)
        .merge(protected)
        .merge(ide_routes)
        .merge(video_stream)
        .merge(image_stream)
        // Preserve API 404 semantics; the SPA fallback is only for browser paths.
        .route("/api", any(|| async { StatusCode::NOT_FOUND }))
        .route("/api/", any(|| async { StatusCode::NOT_FOUND }))
        .route("/api/{*path}", any(|| async { StatusCode::NOT_FOUND }))
        .fallback_service(
            ServeDir::new(&web_dir).not_found_service(ServeFile::new(web_dir.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state);

    if allowed_origins.is_empty() {
        router
    } else {
        router.layer(build_cors(&allowed_origins))
    }
}

pub(crate) async fn mark_allowed_media_origin(
    axum::extract::State(state): axum::extract::State<AppState>,
    mut request: axum::extract::Request,
    next: middleware::Next,
) -> axum::response::Response {
    if state.origin_is_allowed(request.headers()) {
        request.extensions_mut().insert(AllowedMediaOrigin);
    }
    next.run(request).await
}

#[derive(Clone, Copy)]
pub(crate) struct AllowedMediaOrigin;

fn static_web_dir() -> PathBuf {
    std::env::var_os("DAM_HOPPER_WEB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/opt/dam-hopper/web"))
}

/// Parse a strict, canonical origin allowlist before the server starts.
pub fn parse_cors_origins(raw_origins: Option<&str>) -> anyhow::Result<Vec<HeaderValue>> {
    let Some(raw_origins) = raw_origins.filter(|origins| !origins.trim().is_empty()) else {
        return Ok(Vec::new());
    };
    let mut canonical_origins = HashSet::new();
    let mut headers = Vec::new();
    for raw_origin in raw_origins.split(',') {
        let origin = canonical_origin(raw_origin)?;
        if !canonical_origins.insert(origin.clone()) {
            anyhow::bail!("duplicate or ambiguous CORS origin: {origin}");
        }
        headers.push(origin.parse::<HeaderValue>()?);
    }
    Ok(headers)
}

fn canonical_origin(raw_origin: &str) -> anyhow::Result<String> {
    let raw_origin = raw_origin.trim();
    if raw_origin.is_empty() || raw_origin == "*" || raw_origin.contains('#') {
        anyhow::bail!("empty and wildcard CORS origins are forbidden");
    }
    let uri: Uri = raw_origin
        .parse()
        .map_err(|_| anyhow::anyhow!("invalid CORS origin: {raw_origin}"))?;
    let scheme = uri
        .scheme_str()
        .filter(|scheme| matches!(*scheme, "http" | "https"))
        .ok_or_else(|| anyhow::anyhow!("CORS origin must use http or https: {raw_origin}"))?;
    let authority = uri
        .authority()
        .ok_or_else(|| anyhow::anyhow!("CORS origin must include a host: {raw_origin}"))?;
    if uri.path() != "/" || uri.query().is_some() || authority.as_str().contains('@') {
        anyhow::bail!("CORS origin must not include path, query, or user info: {raw_origin}");
    }
    let host = authority.host().to_ascii_lowercase();
    if host.is_empty() {
        anyhow::bail!("CORS origin must include a host: {raw_origin}");
    }
    let authority_text = authority.as_str();
    let explicit_port = if authority_text.starts_with('[') {
        authority_text
            .split_once(']')
            .is_some_and(|(_, suffix)| suffix.starts_with(':'))
    } else {
        authority_text.contains(':')
    };
    let port = authority.port_u16();
    if explicit_port && port.is_none() {
        anyhow::bail!("CORS origin has an invalid port: {raw_origin}");
    }
    let omit_port = matches!((scheme, port), ("http", Some(80)) | ("https", Some(443)));
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host
    };
    Ok(match (port, omit_port) {
        (Some(port), false) => format!("{scheme}://{host}:{port}"),
        _ => format!("{scheme}://{host}"),
    })
}

fn build_cors(allowed_origins: &[HeaderValue]) -> CorsLayer {
    // Explicit methods and headers are required when credentials are enabled.
    let methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ];
    let headers = [
        AUTHORIZATION,
        CONTENT_TYPE,
        ACCEPT,
        RANGE,
        IF_RANGE,
        IF_NONE_MATCH,
        IF_MODIFIED_SINCE,
    ];
    let exposed_headers = [
        ACCEPT_RANGES,
        CONTENT_RANGE,
        CONTENT_LENGTH,
        CONTENT_DISPOSITION,
        ETAG,
        LAST_MODIFIED,
        CACHE_CONTROL,
    ];

    CorsLayer::new()
        .allow_origin(allowed_origins.to_vec())
        .allow_methods(methods)
        .allow_headers(headers)
        .expose_headers(exposed_headers)
        .allow_credentials(true)
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request, routing::get, Router};
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn cors_origin_parser_rejects_dangerous_and_ambiguous_input() {
        for origin in [
            "*",
            "https://trusted.example,https://trusted.example",
            "https://trusted.example,https://trusted.example:443",
            "https://trusted.example/path",
            "https://trusted.example#fragment",
            "https://trusted.example:not-a-port",
            "https://trusted.example:99999",
            "https://user@trusted.example",
        ] {
            assert!(parse_cors_origins(Some(origin)).is_err(), "{origin}");
        }
        assert_eq!(
            parse_cors_origins(Some("https://Trusted.Example:443"))
                .unwrap()
                .as_slice(),
            [HeaderValue::from_static("https://trusted.example")]
        );
        assert_eq!(
            parse_cors_origins(Some("http://Trusted.Example:80"))
                .unwrap()
                .as_slice(),
            [HeaderValue::from_static("http://trusted.example")]
        );
        assert!(parse_cors_origins(None).unwrap().is_empty());
    }

    #[tokio::test]
    async fn cors_allows_only_configured_origin_and_varies_by_origin() {
        let router = Router::new()
            .route("/probe", get(|| async { "ok" }))
            .layer(build_cors(&[HeaderValue::from_static(
                "https://trusted.example",
            )]));
        let trusted = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/probe")
                    .header("Origin", "https://trusted.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            trusted.headers()["access-control-allow-origin"],
            "https://trusted.example"
        );
        assert_eq!(
            trusted.headers()["access-control-allow-credentials"],
            "true"
        );
        assert!(trusted.headers()["vary"]
            .to_str()
            .unwrap()
            .contains("origin"));

        let preflight = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/probe")
                    .header("Origin", "https://trusted.example")
                    .header("Access-Control-Request-Method", "HEAD")
                    .header("Access-Control-Request-Headers", "range")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(preflight.status(), StatusCode::OK);
        assert_eq!(
            preflight.headers()["access-control-allow-origin"],
            "https://trusted.example"
        );
        assert!(preflight.headers()["access-control-allow-methods"]
            .to_str()
            .unwrap()
            .contains("HEAD"));
        assert!(preflight.headers()["access-control-allow-headers"]
            .to_str()
            .unwrap()
            .contains("range"));

        let denied = router
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/probe")
                    .header("Origin", "https://attacker.example")
                    .header("Access-Control-Request-Method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(denied
            .headers()
            .get("access-control-allow-origin")
            .is_none());
    }
}
