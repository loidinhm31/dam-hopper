use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use std::path::PathBuf as StdPathBuf;

use crate::agent_store::AgentStoreService;
use crate::commands::CommandRegistry;
use crate::config::{DamHopperConfig, GlobalConfig};
use crate::error::AppError;
use crate::fs::FsSubsystem;
use crate::pty::{BroadcastEventSink, PtySessionManager};
use crate::ssh::SshCredStore;

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
    ) -> Self {
        Self {
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
        }
    }
}
