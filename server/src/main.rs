use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::{EnvFilter, fmt};

use dev_hub_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{global_config_path, load_workspace_config, read_global_config_at},
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};

#[derive(Debug, Parser)]
#[command(name = "dev-hub-server", version, about = "Dev-Hub Rust server")]
struct Cli {
    /// Path to workspace directory containing dev-hub.toml
    #[arg(long, env = "DEV_HUB_WORKSPACE")]
    workspace: Option<PathBuf>,

    /// Port to listen on
    #[arg(long, default_value = "4800", env = "DEV_HUB_PORT")]
    port: u16,

    /// Regenerate auth token and exit
    #[arg(long)]
    new_token: bool,

    /// Comma-separated list of allowed CORS origins (default: *)
    #[arg(long, env = "DEV_HUB_CORS_ORIGINS")]
    cors_origins: Option<String>,
}

const TOKEN_CAPACITY: usize = 512;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    // ── Auth token ────────────────────────────────────────────────────────────

    let token = manage_token(cli.new_token)?;
    // Print token to stderr (not tracing) so it doesn't land in log aggregators
    eprintln!("\n  Auth token: {token}\n  Open: http://127.0.0.1:{port}\n", port = cli.port);

    if cli.new_token {
        return Ok(());
    }

    // ── Workspace ─────────────────────────────────────────────────────────────

    let workspace_dir = cli.workspace.unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });

    let config = match load_workspace_config(&workspace_dir) {
        Ok(cfg) => {
            tracing::info!(
                workspace = cfg.workspace.name,
                projects = cfg.projects.len(),
                "Workspace loaded"
            );
            cfg
        }
        Err(e) => {
            tracing::warn!(error = %e, workspace = %workspace_dir.display(), "Could not load workspace config — server will start without workspace");
            dev_hub_server::config::DevHubConfig {
                workspace: dev_hub_server::config::WorkspaceInfo {
                    name: "unknown".into(),
                    root: ".".into(),
                },
                agent_store: None,
                projects: vec![],
                config_path: workspace_dir.join("dev-hub.toml"),
            }
        }
    };

    let gc_path = global_config_path();
    let global_config = read_global_config_at(&gc_path)
        .ok()
        .flatten()
        .unwrap_or_default();

    // ── Services ──────────────────────────────────────────────────────────────

    let (event_sink, _initial_rx) = BroadcastEventSink::new(TOKEN_CAPACITY);

    let pty_manager = PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));
    pty_manager.spawn_cleanup_task();

    let store_rel_path = config
        .agent_store
        .as_ref()
        .map(|a| a.path.clone())
        .unwrap_or_else(|| ".dev-hub/agent-store".to_string());
    let store_path = workspace_dir.join(&store_rel_path);
    let agent_store = AgentStoreService::new(store_path);
    if let Err(e) = agent_store.init().await {
        tracing::warn!(error = %e, "Agent store init failed — will retry on first use");
    }

    // ── Build state + router ──────────────────────────────────────────────────

    let allowed_origins: Vec<String> = cli
        .cors_origins
        .as_deref()
        .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
        .unwrap_or_default();

    let state = AppState::new(
        workspace_dir.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        token,
    );

    let router = build_router(state, allowed_origins);

    // ── Serve ─────────────────────────────────────────────────────────────────

    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    tracing::info!(addr = %addr, "Listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}

// ── Token management ──────────────────────────────────────────────────────────

fn token_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("~/.config"))
        .join("dev-hub")
        .join("server-token")
}

fn manage_token(regen: bool) -> anyhow::Result<String> {
    let path = token_path();

    if regen {
        let token = generate_token();
        write_token(&path, &token)?;
        println!("New token: {token}");
        return Ok(token);
    }

    if path.exists() {
        let token = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("Failed to read token file: {e}"))?;
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }

    let token = generate_token();
    write_token(&path, &token)?;
    Ok(token)
}

fn generate_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn write_token(path: &std::path::Path, token: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(token.as_bytes())?;
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, token)?;
    }

    Ok(())
}
