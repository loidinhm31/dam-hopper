//! DamHopper static web host binary entry point.

use clap::Parser;
use std::net::IpAddr;
use std::path::PathBuf;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use dam_hopper_server::web_host::{run_web_host, WebHostOptions};

#[derive(Debug, Parser)]
#[command(
    name = "dam-hopper-web",
    version,
    about = "Dedicated static web host for DamHopper"
)]
struct Cli {
    /// Path to static web dist directory
    #[arg(long, env = "DAM_HOPPER_WEB_ROOT")]
    root: PathBuf,

    /// Host address to bind (default: 0.0.0.0)
    #[arg(long, default_value = "0.0.0.0", env = "DAM_HOPPER_WEB_HOST")]
    host: IpAddr,

    /// Port to listen on (default: 4802)
    #[arg(long, default_value = "4802", env = "DAM_HOPPER_WEB_PORT")]
    port: u16,

    /// Path to optional runtime-config.json
    #[arg(long, env = "DAM_HOPPER_WEB_RUNTIME_CONFIG")]
    runtime_config: Option<PathBuf>,

    /// Override release version for health checks (defaults to CARGO_PKG_VERSION)
    #[arg(long, env = "DAM_HOPPER_WEB_RELEASE_VERSION")]
    release_version: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer())
        .init();

    let cli = Cli::parse();

    let options = WebHostOptions {
        root: cli.root,
        host: cli.host,
        port: cli.port,
        runtime_config: cli.runtime_config,
        release_version: cli.release_version,
    };

    run_web_host(options).await
}
