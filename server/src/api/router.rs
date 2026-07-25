use axum::http::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE},
    Method,
};
use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
};

/// 10 MB — generous for config/settings payloads, blocks accidental multi-GB uploads.
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

use crate::state::AppState;

use super::{
    agent_import, agent_memory, agent_store, auth, browser_debug, commands, config, diagnostics,
    fs as fs_api, git, git_diff, port_forward as port_forward_api, settings, ssh, system, terminal,
    tunnel, usage, workspace, ws,
};

/// Build the full Axum router with auth middleware, CORS, and all routes.
pub fn build_router(state: AppState, allowed_origins: Vec<String>) -> Router {
    let cors = build_cors(&allowed_origins);

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
        .route("/api/usage/health", get(usage::health))
        .route(
            "/api/usage/settings",
            get(usage::get_settings).patch(usage::update_settings),
        )
        .route("/api/usage", delete(usage::delete_all))
        // Git
        .route("/api/git/fetch", post(git::fetch_projects))
        .route("/api/git/pull", post(git::pull_projects))
        .route("/api/git/push", post(git::push_project))
        .route("/api/git/{project}/roots", get(git::get_vcs_roots))
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
        .route("/api/fs/search", get(fs_api::search))
        .route("/api/fs/search-paths", get(fs_api::search_paths))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

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
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
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
