use axum::{
    Router,
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post, put},
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use axum::http::{
    header::{AUTHORIZATION, CONTENT_TYPE, ACCEPT, COOKIE},
    Method,
};

/// 10 MB — generous for config/settings payloads, blocks accidental multi-GB uploads.
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

use crate::state::AppState;

use super::{
    agent_import, agent_memory, agent_store, auth, commands, config, fs as fs_api, git, settings,
    ssh, terminal, workspace, ws,
};

/// Build the full Axum router with auth middleware, CORS, and all routes.
pub fn build_router(state: AppState, allowed_origins: Vec<String>) -> Router {
    let cors = build_cors(&allowed_origins);

    // Public routes — no auth required
    let public = Router::new()
        .route("/api/health", get(settings::health))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/status", get(auth::status))
        .route("/ws", get(ws::ws_handler));

    // Protected routes — auth middleware checks devhub-auth cookie
    let protected = Router::new()
        // Workspace
        .route("/api/workspace/status", get(workspace::get_status))
        .route("/api/workspace", get(workspace::get_workspace))
        .route("/api/workspace/init", post(workspace::init_workspace))
        .route("/api/workspace/switch", post(workspace::switch_workspace))
        .route("/api/workspace/known", get(workspace::list_known))
        .route("/api/workspace/known", post(workspace::add_known))
        .route("/api/workspace/known", delete(workspace::remove_known))
        // Global config
        .route("/api/global-config", get(config::get_global_config))
        .route("/api/global-config/defaults", post(config::update_global_defaults))
        // Projects
        .route("/api/projects", get(config::list_projects))
        .route("/api/projects/{name}", get(config::get_project))
        .route("/api/projects/{name}/status", get(config::get_project_status))
        // Config
        .route("/api/config", get(config::get_config))
        .route("/api/config", put(config::update_config))
        .route("/api/config/projects/{name}", patch(config::update_project))
        // Git
        .route("/api/git/fetch", post(git::fetch_projects))
        .route("/api/git/pull", post(git::pull_projects))
        .route("/api/git/push", post(git::push_project))
        .route("/api/git/{project}/worktrees", get(git::get_worktrees))
        .route("/api/git/{project}/worktrees", post(git::add_worktree_route))
        .route("/api/git/{project}/worktrees", delete(git::remove_worktree_route))
        .route("/api/git/{project}/branches", get(git::get_branches))
        .route("/api/git/{project}/branches/update", post(git::update_branch_route))
        // Terminal — order matters: specific paths before parameterized
        .route("/api/terminal", post(terminal::create_session))
        .route("/api/terminal", get(terminal::list_sessions))
        .route("/api/terminal/detailed", get(terminal::list_detailed))
        .route("/api/terminal/{id}/buffer", get(terminal::get_buffer))
        .route("/api/terminal/{id}", delete(terminal::kill_session))
        .route("/api/terminal/{id}/remove", delete(terminal::remove_session))
        // Agent Store — static paths before dynamic
        .route("/api/agent-store/matrix", get(agent_store::get_matrix))
        .route("/api/agent-store/scan", get(agent_store::scan))
        .route("/api/agent-store/health", get(agent_store::health_check))
        .route("/api/agent-store/ship", post(agent_store::ship_item))
        .route("/api/agent-store/unship", post(agent_store::unship_item))
        .route("/api/agent-store/absorb", post(agent_store::absorb_item))
        .route("/api/agent-store/bulk-ship", post(agent_store::bulk_ship_items))
        .route("/api/agent-store", get(agent_store::list_items))
        .route("/api/agent-store/{category}/{name}", get(agent_store::get_item))
        .route("/api/agent-store/{category}/{name}/content", get(agent_store::get_item_content))
        .route("/api/agent-store/{category}/{name}", delete(agent_store::remove_item))
        // Agent Memory — static paths before dynamic
        .route("/api/agent-memory/templates", get(agent_memory::list_templates))
        .route("/api/agent-memory/apply", post(agent_memory::apply_memory_template))
        .route("/api/agent-memory/{projectName}", get(agent_memory::list_project_memory))
        .route("/api/agent-memory/{projectName}/{agent}", get(agent_memory::get_project_memory))
        .route("/api/agent-memory/{projectName}/{agent}", put(agent_memory::update_project_memory))
        // Agent Import
        .route("/api/agent-import/scan", post(agent_import::scan_repo_handler))
        .route("/api/agent-import/scan-local", post(agent_import::scan_local_handler))
        .route("/api/agent-import/confirm", post(agent_import::import_confirm_handler))
        // SSH credentials
        .route("/api/ssh/keys", get(ssh::list_keys))
        .route("/api/ssh/agent", get(ssh::check_agent))
        .route("/api/ssh/keys/load", post(ssh::load_key))
        // Commands
        .route("/api/commands/search", get(commands::search_commands))
        .route("/api/commands", get(commands::list_commands))
        // Settings
        .route("/api/settings/cache-clear", post(settings::cache_clear))
        .route("/api/settings/reset", post(settings::reset))
        .route("/api/settings/export", get(settings::export_settings))
        .route("/api/settings/import", post(settings::import_settings))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    // IDE file explorer routes — only registered when feature flag is on.
    // When off, any /api/fs/* request falls through to the SPA catch-all → 404.
    let ide_routes = if state.ide_explorer {
        Router::new()
            .route("/api/fs/list", get(fs_api::list))
            .route("/api/fs/read", get(fs_api::read))
            .route("/api/fs/stat", get(fs_api::stat))
            .route("/api/fs/download", get(fs_api::download))
            .route("/api/fs/search", get(fs_api::search))
            .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth))
    } else {
        Router::new()
    };

    Router::new()
        .merge(public)
        .merge(protected)
        .merge(ide_routes)
        .layer(cors)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

fn build_cors(allowed_origins: &[String]) -> CorsLayer {
    // tower-http 0.6 panics if allow_credentials(true) is combined with Any methods or headers.
    let methods = [
        Method::GET, Method::POST, Method::PUT, Method::PATCH,
        Method::DELETE, Method::OPTIONS, Method::HEAD,
    ];
    let headers = [AUTHORIZATION, CONTENT_TYPE, ACCEPT, COOKIE];

    if allowed_origins.is_empty() || allowed_origins.iter().any(|o| o == "*") {
        // Mirror the request Origin back — `*` is rejected by browsers when credentials are sent.
        CorsLayer::new()
            .allow_origin(AllowOrigin::mirror_request())
            .allow_methods(methods)
            .allow_headers(headers)
            .allow_credentials(true)
    } else {
        let origins: Vec<axum::http::HeaderValue> = allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(methods)
            .allow_headers(headers)
            .allow_credentials(true)
    }
}
