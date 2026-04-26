use std::path::PathBuf;
use std::sync::Arc;

use opaque_ke::ServerSetup;
use tokio::sync::RwLock;

use std::path::PathBuf as StdPathBuf;

use crate::agent_store::AgentStoreService;
use crate::commands::CommandRegistry;
use crate::config::{DamHopperConfig, GlobalConfig};
use crate::crypto::{DamHopperOpaqueSuite, OpaqueRegistrations};
use crate::error::AppError;
use crate::fs::FsSubsystem;
use crate::port_forward::PortForwardManager;
use crate::pty::{BroadcastEventSink, PtySessionManager};
use crate::ssh::SshCredStore;
use crate::tunnel::TunnelSessionManager;

/// Shared application state across all Axum handlers.
///
/// Wrapped in `Arc` by Axum's `State` extractor automatically.
/// Fields that need mutation are behind `RwLock`; the PTY manager and agent
/// store carry their own internal locking.
#[derive(Clone)]
pub struct AppState {
    /// Current workspace directory (may change on workspace:switch).
    pub workspace_dir: Arc<RwLock<PathBuf>>,
    /// Parsed workspace config (reloaded on switch/update).
    pub config: Arc<RwLock<DamHopperConfig>>,
    /// Global config (known workspaces, defaults).
    pub global_config: Arc<RwLock<GlobalConfig>>,
    /// PTY session manager — internally Arc<Mutex<Inner>>, Clone is cheap.
    pub pty_manager: PtySessionManager,
    /// Central agent store service.
    /// NOTE: store path is not updated on workspace:switch — requires server restart to pick
    /// up new workspace's agent store. Phase 06 or follow-up refactor to address.
    pub agent_store: Arc<AgentStoreService>,
    /// BM25 command registry — immutable after init.
    pub command_registry: Arc<CommandRegistry>,
    /// Broadcast sink: PTY events + git progress fan-out to WebSocket clients.
    pub event_sink: BroadcastEventSink,
    /// JWT signing secret (hex UUID stored at ~/.config/dam-hopper/server-token).
    pub jwt_secret: Arc<String>,
    /// SSH credentials stored for the current session (set via /api/ssh/keys/load).
    /// Wrapped in Arc so cloning into git tasks is cheap (ref-count bump only).
    pub ssh_creds: Arc<RwLock<Option<Arc<SshCredStore>>>>,
    /// Workspace-scoped filesystem subsystem (sandbox + watcher in Phase 02).
    /// Clone is cheap — Arc-backed.
    pub fs: FsSubsystem,
    /// MongoDB Database, if configured
    pub db: Option<mongodb::Database>,
    /// Dev mode: skip authentication checks
    pub no_auth: bool,
    /// Tunnel session manager — Arc-backed, Clone is cheap.
    pub tunnel_manager: TunnelSessionManager,
    /// Port forward manager — tracks PTY-detected ports. Arc-backed, Clone is cheap.
    /// `None` on non-Linux (proc poller disabled) but stdout scan still works.
    pub port_forward_manager: Option<Arc<PortForwardManager>>,
    /// OPAQUE server keypair (long-term, persisted to disk). Shared across all connections.
    pub opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>,
    /// In-memory OPAQUE registration records (identifier → ServerRegistration).
    /// Lost on server restart — acceptable for encrypt-in-transit model.
    pub opaque_registrations: OpaqueRegistrations,
}

impl AppState {
    /// Resolve a project name to its absolute filesystem path.
    /// Returns `Err(NotFound)` if the project doesn't exist in the current config.
    pub async fn project_path(&self, name: &str) -> Result<StdPathBuf, AppError> {
        let cfg = self.config.read().await;
        cfg.projects
            .iter()
            .find(|p| p.name == name)
            .map(|p| StdPathBuf::from(&p.path))
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {name}")))
    }

    /// Create new AppState with production safety validation for no-auth mode.
    /// 
    /// Returns `Err` if:
    /// - `no_auth` is enabled with MongoDB configured (security risk)
    /// - `no_auth` is enabled in production environment (detected via RUST_ENV or ENVIRONMENT)
    pub fn new(
        workspace_dir: PathBuf,
        config: DamHopperConfig,
        global_config: GlobalConfig,
        pty_manager: PtySessionManager,
        agent_store: AgentStoreService,
        event_sink: BroadcastEventSink,
        jwt_secret: String,
        fs: FsSubsystem,
        db: Option<mongodb::Database>,
        no_auth: bool,
        tunnel_manager: TunnelSessionManager,
        port_forward_manager: Option<Arc<PortForwardManager>>,
        opaque_server_setup: ServerSetup<DamHopperOpaqueSuite>,
    ) -> anyhow::Result<Self> {
        // Production safety guards for no-auth mode
        if no_auth {
            // Prevent accidental deployment with no-auth + MongoDB configured
            if db.is_some() {
                anyhow::bail!(
                    "FATAL: --no-auth cannot be used when MongoDB is configured (MONGODB_URI is set).\n\
                     This combination is unsafe and forbidden."
                );
            }
            
            // Check for production environment indicators
            if std::env::var("RUST_ENV").unwrap_or_default() == "production" 
                || std::env::var("ENVIRONMENT").unwrap_or_default() == "production" {
                anyhow::bail!(
                    "FATAL: --no-auth is not allowed in production environment.\n\
                     Set RUST_ENV or ENVIRONMENT to 'development' for local dev."
                );
            }
            
            // Prominent multi-line warning banner
            eprintln!(concat!(
                "\n⚠️  ═══════════════════════════════════════════════════════\n",
                "⚠️  SECURITY WARNING: Authentication disabled!\n",
                "⚠️  All API requests will bypass authentication checks.\n",
                "⚠️  This mode is for LOCAL DEVELOPMENT ONLY.\n",
                "⚠️  DO NOT use in production or with sensitive data.\n",
                "⚠️  ═══════════════════════════════════════════════════════\n"
            ));
            
            tracing::error!("⚠️  NO-AUTH mode enabled — authentication bypassed");
        }

        Ok(Self {
            workspace_dir: Arc::new(RwLock::new(workspace_dir)),
            config: Arc::new(RwLock::new(config)),
            global_config: Arc::new(RwLock::new(global_config)),
            pty_manager,
            agent_store: Arc::new(agent_store),
            command_registry: Arc::new(CommandRegistry::new()),
            event_sink,
            jwt_secret: Arc::new(jwt_secret),
            ssh_creds: Arc::new(RwLock::new(None)),
            fs,
            db,
            no_auth,
            tunnel_manager,
            port_forward_manager,
            opaque_server_setup: Arc::new(opaque_server_setup),
            opaque_registrations: OpaqueRegistrations::default(),
        })
    }
}
