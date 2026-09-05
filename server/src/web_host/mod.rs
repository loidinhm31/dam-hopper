//! Dedicated non-writing static web host for DamHopper release deployments.

pub mod cache_policy;
pub mod router;
pub mod runtime_config;
pub mod safe_path;

use anyhow::{bail, Context, Result};
use router::{build_web_router, WebHostState};
use runtime_config::WebRuntimeConfig;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use crate::linux_release::version::validate_version;

/// CLI / runtime options for the dedicated web host.
#[derive(Debug, Clone)]
pub struct WebHostOptions {
    pub root: PathBuf,
    pub host: IpAddr,
    pub port: u16,
    pub runtime_config: Option<PathBuf>,
    pub release_version: Option<String>,
}

/// Validate configuration and execute the web host until shutdown signal.
pub async fn run_web_host(options: WebHostOptions) -> Result<()> {
    // 1. Root directory validation: must exist, be a directory, and not be a symlink
    let root_meta = std::fs::symlink_metadata(&options.root)
        .with_context(|| format!("static root '{}' does not exist", options.root.display()))?;

    if root_meta.file_type().is_symlink() {
        bail!(
            "static root '{}' is a symlink, which is rejected",
            options.root.display()
        );
    }

    if !root_meta.is_dir() {
        bail!(
            "static root '{}' is not a directory",
            options.root.display()
        );
    }

    // 2. Release version validation
    let release_version = match options.release_version {
        Some(ref v) => {
            validate_version(v).with_context(|| format!("invalid release version '{v}'"))?;
            v.clone()
        }
        None => env!("CARGO_PKG_VERSION").to_string(),
    };

    // 3. Runtime configuration validation and loading
    let runtime_config = match options.runtime_config {
        Some(ref path) => {
            let cfg = WebRuntimeConfig::load_from_file(path).with_context(|| {
                format!("failed to load runtime config from '{}'", path.display())
            })?;
            Some(Arc::new(cfg))
        }
        None => None,
    };

    let bind_addr = SocketAddr::new(options.host, options.port);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("failed to bind web host on {bind_addr}"))?;

    info!(
        addr = %bind_addr,
        root = %options.root.display(),
        version = %release_version,
        runtime_config = runtime_config.is_some(),
        "dam-hopper-web static host listening"
    );

    let state = WebHostState {
        root: options.root,
        release_version,
        runtime_config,
    };

    let app = build_web_router(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("web host server error")?;

    info!("dam-hopper-web static host stopped gracefully");
    Ok(())
}

/// Wait for SIGTERM or CTRL-C for graceful shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            warn!(error = %e, "failed to install ctrl-c signal handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                warn!(error = %e, "failed to install SIGTERM signal handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("received CTRL-C, initiating graceful shutdown");
        }
        _ = terminate => {
            info!("received SIGTERM, initiating graceful shutdown");
        }
    }
}
