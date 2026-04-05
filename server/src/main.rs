use clap::Parser;
use std::path::PathBuf;
use tracing_subscriber::{EnvFilter, fmt};

use dev_hub_server::config::load_workspace_config;

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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    let workspace_dir = cli
        .workspace
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    tracing::info!(workspace = %workspace_dir.display(), port = cli.port, "Starting dev-hub-server");

    // Validate workspace config loads correctly on startup
    match load_workspace_config(&workspace_dir) {
        Ok(cfg) => {
            tracing::info!(
                workspace = cfg.workspace.name,
                projects = cfg.projects.len(),
                "Workspace loaded"
            );
        }
        Err(e) => {
            tracing::warn!(error = %e, "Could not load workspace config — server will still start");
        }
    }

    // TODO: Phase 05 — wire up axum router and serve
    tracing::info!("Phase 01 complete — HTTP server not yet implemented");
    Ok(())
}
