use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{
        global_config_path, global_registry_path, read_global_config_at, resolve_startup_config,
        ConfigResolutionInput, ConfigSource, DamHopperConfig,
    },
    crypto::load_or_create_server_setup,
    diagnostics::{DiagnosticStore, DiagnosticTracingLayer},
    fs::FsSubsystem,
    port_forward::{proc_poll_loop, PortForwardManager},
    probe_inotify_limit,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    telemetry::TelemetryRuntime,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

#[derive(Debug, Parser)]
#[command(name = "dam-hopper-server", version, about = "DamHopper Rust server")]
struct Cli {
    /// Path to a specific dam-hopper.toml registry file
    #[arg(long, env = "DAM_HOPPER_CONFIG")]
    config: Option<PathBuf>,

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

    let diagnostics = DiagnosticStore::default();
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer())
        .with(DiagnosticTracingLayer::new(diagnostics.clone()))
        .init();

    let cli = Cli::parse();

    // ── Auth token ────────────────────────────────────────────────────────────

    let token = manage_token(cli.new_token)?;
    // Print server start URL to stderr
    eprintln!(
        "\n  Server started\n  Open: http://{host}:{port}\n",
        host = cli.host,
        port = cli.port
    );

    if cli.new_token {
        return Ok(());
    }

    let gc_path = global_config_path();
    let global_config = read_global_config_at(&gc_path)
        .ok()
        .flatten()
        .unwrap_or_default();

    // ── Workspace ─────────────────────────────────────────────────────────────

    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolution = resolve_startup_config(ConfigResolutionInput {
        explicit_config: cli.config.clone(),
        workspace_dir: cli.workspace.clone(),
        global_default_workspace: global_config
            .defaults
            .as_ref()
            .and_then(|d| d.workspace.as_ref())
            .map(PathBuf::from),
        current_dir,
        registry_path: global_registry_path(),
    })?;

    let workspace_dir = resolution.workspace_dir;
    let config = resolution.config;

    match resolution.source {
        ConfigSource::EmptyFallback => {
            tracing::warn!(
                config_path = %config.config_path.display(),
                "No workspace config loaded — server will start without workspace"
            );
        }
        source => {
            tracing::info!(
                source = source.as_str(),
                config_path = %config.config_path.display(),
                workspace = config.workspace.name,
                projects = config.projects.len(),
                "Workspace config loaded"
            );
        }
    }

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

    let (persist_tx, session_store, persist_worker_handle) = {
        let parent = db_path.parent().unwrap_or(&db_path);
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(error = %e, path = %parent.display(), "Failed to create session DB directory");
            (None, None, None)
        } else {
            match dam_hopper_server::persistence::SessionStore::open(&db_path) {
                Ok(store) => {
                    tracing::info!(path = %db_path.display(), "Session store opened");
                    let store_arc = std::sync::Arc::new(store);
                    let (tx, rx) = std::sync::mpsc::sync_channel(256);
                    let worker =
                        dam_hopper_server::persistence::PersistWorker::new(rx, store_arc.clone());
                    let handle = std::thread::Builder::new()
                        .name("persist-worker".to_string())
                        .spawn(move || worker.run())
                        .expect("Failed to spawn persist worker thread");
                    (Some(tx), Some(store_arc), Some(handle))
                }
                Err(e) => {
                    tracing::warn!(error = %e, path = %db_path.display(), "Failed to open session DB");
                    (None, None, None)
                }
            }
        }
    };

    // The Codex usage runtime stays independent from the PTY manager for the
    // life of the server. A disabled runtime is cheap and can be activated by
    // Settings without changing terminal behavior.
    let telemetry_runtime = TelemetryRuntime::new();
    if config.server.telemetry.enabled {
        let disabled = dam_hopper_server::config::TelemetryConfig::default();
        if let Err(error) = telemetry_runtime
            .apply_config(&disabled, &config.server.telemetry)
            .await
        {
            tracing::warn!(error = %error, "Telemetry runtime unavailable; terminal operation continues");
        }
    }

    let pty_manager = PtySessionManager::with_persist(
        std::sync::Arc::new(event_sink.clone()),
        persist_tx.clone(), // Clone to keep sender alive until end of main() for graceful shutdown
        session_store.clone(),
    );
    pty_manager.spawn_cleanup_task();

    let tunnel_driver = std::sync::Arc::new(CloudflaredDriver);
    let tunnel_manager =
        TunnelSessionManager::new(std::sync::Arc::new(event_sink.clone()), tunnel_driver);

    // ── Port forward manager ──────────────────────────────────────────────────
    let port_forward_manager = std::sync::Arc::new(
        PortForwardManager::new(std::sync::Arc::new(event_sink.clone()))
            .with_tunnel_manager(tunnel_manager.clone())
            .with_session_store(session_store.clone()),
    );

    // Wire port_forward_manager into pty_manager before restore so relaunched
    // sessions scan stdout immediately.
    {
        let mut cell = pty_manager.port_forward_manager.write().unwrap();
        *cell = Some(std::sync::Arc::clone(&port_forward_manager));
    }

    // ── Restore sessions from persistence (Phase 06) ──────────────────────────
    if let Some(store) = &session_store {
        match dam_hopper_server::persistence::restore_sessions(store, &pty_manager, &config).await {
            Ok(count) => {
                tracing::info!(count, "Restored sessions from persistence");
                let live_session_ids = pty_manager
                    .list()
                    .into_iter()
                    .filter(|session| session.alive)
                    .map(|session| session.id)
                    .collect::<Vec<_>>();
                let seeded = port_forward_manager
                    .seed_persisted_candidates(&live_session_ids)
                    .await;
                if seeded > 0 {
                    tracing::info!(seeded, "Seeded persisted port candidates");
                }
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

    let fs = FsSubsystem::new(project_roots(&config));

    let db = if let (Ok(uri), Ok(name)) = (
        std::env::var("MONGODB_URI"),
        std::env::var("MONGODB_DATABASE"),
    ) {
        tracing::info!(%name, "Connecting to MongoDB...");
        let client_options = mongodb::options::ClientOptions::parse(&uri).await?;
        let client = mongodb::Client::with_options(client_options)?;
        Some(client.database(&name))
    } else {
        None
    };

    // Load (or generate) OPAQUE server keypair — persisted to ~/.config/dam-hopper/opaque-server-setup
    let opaque_server_setup =
        load_or_create_server_setup().expect("Failed to load or create OPAQUE server setup");

    // AppState::new() performs production safety validation for no-auth mode
    let state = AppState::new(
        workspace_dir.clone(),
        config,
        global_config,
        pty_manager.clone(),
        agent_store,
        event_sink,
        token,
        fs,
        db,
        cli.no_auth,
        tunnel_manager,
        Some(port_forward_manager.clone()),
        opaque_server_setup,
        diagnostics,
        telemetry_runtime.clone(),
    )?;

    let tunnel_manager_shutdown = state.tunnel_manager.clone();
    let browser_debug_artifacts_shutdown = state.browser_debug_artifacts.clone();
    let browser_debug_artifacts_sweeper = state.browser_debug_artifacts.clone();

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.tick().await;
        loop {
            interval.tick().await;
            browser_debug_artifacts_sweeper.sweep_expired().await;
        }
    });

    // Spawn /proc/net/tcp polling loop for port detection (Linux-only; warns on other OS).
    tokio::spawn(proc_poll_loop(port_forward_manager));

    let telemetry_shutdown = state.telemetry_runtime.clone();
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
    browser_debug_artifacts_shutdown.dispose_all().await;
    telemetry_shutdown.shutdown().await;

    // Graceful shutdown: snapshot live PTY buffers, ask the worker to flush, then wait.
    pty_manager.snapshot_live_buffers();
    if let Some(tx) = &persist_tx {
        let _ = tx.send(dam_hopper_server::persistence::PersistCmd::Shutdown);
    }
    drop(persist_tx);
    if let Some(handle) = persist_worker_handle {
        let _ = handle.join();
    }
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

fn project_roots(config: &DamHopperConfig) -> Vec<(String, std::path::PathBuf)> {
    config
        .projects
        .iter()
        .map(|project| {
            (
                project.name.clone(),
                std::path::PathBuf::from(&project.path),
            )
        })
        .collect()
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
