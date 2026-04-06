use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use std::path::PathBuf as StdPathBuf;

use crate::agent_store::AgentStoreService;
use crate::commands::CommandRegistry;
use crate::config::{DevHubConfig, GlobalConfig};
use crate::error::AppError;
use crate::pty::{BroadcastEventSink, PtySessionManager};

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
    pub config: Arc<RwLock<DevHubConfig>>,
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
    /// Auth token (hex UUID stored at ~/.config/dev-hub/server-token).
    pub auth_token: Arc<String>,
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
        config: DevHubConfig,
        global_config: GlobalConfig,
        pty_manager: PtySessionManager,
        agent_store: AgentStoreService,
        event_sink: BroadcastEventSink,
        auth_token: String,
    ) -> Self {
        Self {
            workspace_dir: Arc::new(RwLock::new(workspace_dir)),
            config: Arc::new(RwLock::new(config)),
            global_config: Arc::new(RwLock::new(global_config)),
            pty_manager,
            agent_store: Arc::new(agent_store),
            command_registry: Arc::new(CommandRegistry::new()),
            event_sink,
            auth_token: Arc::new(auth_token),
        }
    }
}
