use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::{EnvFilter, fmt};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{global_config_path, load_workspace_config, read_global_config_at},
    fs::FsSubsystem,
    probe_inotify_limit,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

#[derive(Debug, Parser)]
#[command(name = "dam-hopper-server", version, about = "DamHopper Rust server")]
struct Cli {
    /// Path to workspace directory containing dam-hopper.toml
    #[arg(long, env = "DAM_HOPPER_WORKSPACE")]
    workspace: Option<PathBuf>,

    /// Port to listen on
    #[arg(long, default_value = "4800", env = "DAM_HOPPER_PORT")]
    port: u16,

    /// Host address to bind (default: 0.0.0.0 — all interfaces including Tailscale)
    #[arg(long, default_value = "0.0.0.0", env = "DAM_HOPPER_HOST")]
    host: std::net::IpAddr,

    /// Regenerate auth token and exit
    #[arg(long)]
    new_token: bool,

    /// Comma-separated list of allowed CORS origins (default: *)
    #[arg(long, env = "DAM_HOPPER_CORS_ORIGINS")]
    cors_origins: Option<String>,

    /// Skip authentication (dev mode) — all requests bypass auth middleware
    #[arg(long, env = "DAM_HOPPER_NO_AUTH")]
    no_auth: bool,
}

const TOKEN_CAPACITY: usize = 512;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    // ── Auth token ────────────────────────────────────────────────────────────

    let token = manage_token(cli.new_token)?;
    // Print server start URL to stderr
    eprintln!("\n  Server started\n  Open: http://{host}:{port}\n", host = cli.host, port = cli.port);

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
            dam_hopper_server::config::DamHopperConfig {
                workspace: dam_hopper_server::config::WorkspaceInfo {
                    name: "unknown".into(),
                    root: ".".into(),
                },
                agent_store: None,
                server: dam_hopper_server::config::ServerConfig::default(),
                projects: vec![],
                features: dam_hopper_server::config::FeaturesConfig::default(),
                config_path: workspace_dir.join("dam-hopper.toml"),
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

    // ── Session persistence ───────────────────────────────────────────────────
    // Always enabled. DB path comes from config (default: ~/.config/dam-hopper/sessions.db).

    let db_path = if config.server.session_db_path.starts_with("~/") {
        let suffix = config.server.session_db_path.strip_prefix("~/").unwrap();
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(suffix)
    } else if config.server.session_db_path == "~" {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"))
    } else {
        PathBuf::from(&config.server.session_db_path)
    };

    let (persist_tx, session_store) = {
        let parent = db_path.parent().unwrap_or(&db_path);
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(error = %e, path = %parent.display(), "Failed to create session DB directory");
            (None, None)
        } else {
            match dam_hopper_server::persistence::SessionStore::open(&db_path) {
                Ok(store) => {
                    tracing::info!(path = %db_path.display(), "Session store opened");
                    let store_arc = std::sync::Arc::new(store);
                    let (tx, rx) = std::sync::mpsc::sync_channel(256);
                    let worker = dam_hopper_server::persistence::PersistWorker::new(rx, store_arc.clone());
                    std::thread::Builder::new()
                        .name("persist-worker".to_string())
                        .spawn(move || worker.run())
                        .expect("Failed to spawn persist worker thread");
                    (Some(tx), Some(store_arc))
                }
                Err(e) => {
                    tracing::warn!(error = %e, path = %db_path.display(), "Failed to open session DB");
                    (None, None)
                }
            }
        }
    };

    let pty_manager = PtySessionManager::with_persist(
        std::sync::Arc::new(event_sink.clone()),
        persist_tx.clone(), // Clone to keep sender alive until end of main() for graceful shutdown
        session_store.clone(),
    );
    pty_manager.spawn_cleanup_task();

    // ── Restore sessions from persistence (Phase 06) ──────────────────────────
    if let Some(store) = &session_store {
        match dam_hopper_server::persistence::restore_sessions(
            store,
            &pty_manager,
            &config,
        )
        .await
        {
            Ok(count) => {
                tracing::info!(count, "Restored sessions from persistence");
            }
            Err(e) => {
                tracing::warn!(error = %e, "Failed to restore sessions from persistence");
            }
        }
    }

    let store_rel_path = config
        .agent_store
        .as_ref()
        .map(|a| a.path.clone())
        .unwrap_or_else(|| ".dam-hopper/agent-store".to_string());
    let store_path = workspace_dir.join(&store_rel_path);
    let agent_store = AgentStoreService::new(store_path);
    if let Err(e) = agent_store.init().await {
        tracing::warn!(error = %e, "Agent store init failed — will retry on first use");
    }

    probe_inotify_limit();

    // ── Build state + router ──────────────────────────────────────────────────

    let allowed_origins: Vec<String> = cli
        .cors_origins
        .as_deref()
        .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
        .unwrap_or_default();

    // Use the directory that actually contains dam-hopper.toml as the sandbox root.
    // workspace_dir is the raw CLI arg / CWD, which may differ from the config
    // location when the server is started from a subdirectory (e.g. server/).
    // config.config_path is canonicalized by read_config(), so its parent is
    // always the true workspace root that project paths are relative to.
    let fs_root = config
        .config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| workspace_dir.clone());
    let fs = FsSubsystem::new(fs_root);

    let db = if let (Ok(uri), Ok(name)) = (std::env::var("MONGODB_URI"), std::env::var("MONGODB_DATABASE")) {
        tracing::info!(%name, "Connecting to MongoDB...");
        let client_options = mongodb::options::ClientOptions::parse(&uri).await?;
        let client = mongodb::Client::with_options(client_options)?;
        Some(client.database(&name))
    } else {
        None
    };

    let tunnel_driver = std::sync::Arc::new(CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(
        std::sync::Arc::new(event_sink.clone()),
        tunnel_driver,
    );

    // AppState::new() performs production safety validation for no-auth mode
    let state = AppState::new(
        workspace_dir.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        token,
        fs,
        db,
        cli.no_auth,
        tunnel_manager,
    )?;

    let tunnel_manager_shutdown = state.tunnel_manager.clone();
    let router = build_router(state, allowed_origins);

    // ── Serve ─────────────────────────────────────────────────────────────────

    let addr = SocketAddr::new(cli.host, cli.port);
    tracing::info!(addr = %addr, "Listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;

    #[cfg(unix)]
    let shutdown_signal = async {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).unwrap_or_else(|_| {
            // fallback: never fires, but ctrl_c still works
            signal(SignalKind::hangup()).expect("failed to install SIGTERM handler")
        });
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = sigterm.recv() => {},
        }
    };

    #[cfg(not(unix))]
    let shutdown_signal = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    // Reap all tunnel children before exit — no orphaned cloudflared processes.
    tunnel_manager_shutdown.dispose_all().await;

    // Graceful shutdown: drop persist_tx to signal worker thread, then wait for clean exit
    // When persist_tx is dropped here, worker detects channel disconnect and flushes all pending buffers
    drop(persist_tx);
    tracing::info!("Server shutdown complete");

    Ok(())
}

// ── Token management ──────────────────────────────────────────────────────────

fn token_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("~/.config"))
        .join("dam-hopper")
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
