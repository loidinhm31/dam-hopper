use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use dam_hopper_server::plugins::{
    PluginRegistry, PluginRegistryLayout, RunnerServer, RunnerServerConfig, SupervisorManager,
};
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "dam-hopper-plugin-runner",
    version,
    about = "Owner-account plugin runner and worker supervisor for DamHopper"
)]
struct Args {
    /// Path to the AF_UNIX pathname socket
    #[arg(long, default_value = "/run/dam-hopper/plugin-runner.sock")]
    socket_path: PathBuf,

    /// Path to durable plugin registry directory
    #[arg(long)]
    registry_dir: PathBuf,

    /// Pinned Node executable path
    #[arg(long, default_value = "node")]
    node_bin: PathBuf,

    /// Expected connecting API peer UID
    #[arg(long)]
    expected_api_uid: Option<u32>,

    /// Allow root (UID 0) peer connections
    #[arg(long, default_value_t = false)]
    allow_root_peer: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,dam_hopper_server=debug")),
        )
        .init();

    let args = Args::parse();

    tracing::info!(
        socket_path = %args.socket_path.display(),
        registry_dir = %args.registry_dir.display(),
        node_bin = %args.node_bin.display(),
        "Starting dam-hopper-plugin-runner"
    );

    let layout = PluginRegistryLayout::new(&args.registry_dir);
    let registry = Arc::new(PluginRegistry::new(layout)?);
    let supervisor_manager = Arc::new(SupervisorManager::new(registry.clone(), args.node_bin));

    let server_config = RunnerServerConfig {
        socket_path: args.socket_path,
        expected_api_uid: args.expected_api_uid,
        allow_root_peer: args.allow_root_peer,
    };

    let runner_server = RunnerServer::new(server_config, registry, supervisor_manager);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Handle SIGINT and SIGTERM for graceful shutdown
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigint = signal(SignalKind::interrupt()).expect("Failed to bind SIGINT");
            let mut sigterm = signal(SignalKind::terminate()).expect("Failed to bind SIGTERM");

            tokio::select! {
                _ = sigint.recv() => {
                    tracing::info!("Received SIGINT, initiating shutdown");
                }
                _ = sigterm.recv() => {
                    tracing::info!("Received SIGTERM, initiating shutdown");
                }
            }
        }

        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("Received Ctrl-C, initiating shutdown");
        }

        let _ = shutdown_tx.send(true);
    });

    runner_server.run(shutdown_rx).await?;
    tracing::info!("dam-hopper-plugin-runner stopped cleanly");
    Ok(())
}
