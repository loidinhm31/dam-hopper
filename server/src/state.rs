use std::path::PathBuf;
use std::sync::Arc;

use axum::http::{header, HeaderMap, Uri};
use opaque_ke::ServerSetup;
use tokio::sync::RwLock;

use std::path::PathBuf as StdPathBuf;

use crate::agent_store::AgentStoreService;
use crate::browser_debug::BrowserDebugArtifactManager;
use crate::commands::CommandRegistry;
use crate::config::{DamHopperConfig, GlobalConfig};
use crate::crypto::{DamHopperOpaqueSuite, OpaqueRegistrations};
use crate::diagnostics::DiagnosticStore;
use crate::error::AppError;
use crate::fs::{FsSubsystem, ImageStreamTicketStore, MediaTicketStore, VideoStreamTicketStore};
use crate::host_actions::HostActionService;
use crate::port_forward::PortForwardManager;
use crate::pty::{BroadcastEventSink, PtySessionManager};
use crate::ssh::SshCredStore;
use crate::system::HostResourceMonitor;
use crate::telemetry::worker::TelemetryHandle;
use crate::telemetry::{codex_otlp::CodexExporterManager, TelemetryRuntime};
use crate::tunnel::TunnelSessionManager;
use crate::workspace_target::{
    ProjectTargetRef, ProjectWorktree, ResolvedProjectTarget, WorkspaceTargetError,
    WorkspaceTargetResolver,
};
use crate::workflow::{WorkflowService, WorkflowStore};

/// Shared application state across all Axum handlers.
///
/// Wrapped in `Arc` by Axum's `State` extractor automatically.
/// Fields that need mutation are behind `RwLock`; the PTY manager and agent
/// store carry their own internal locking.
#[derive(Clone)]
pub struct AppState {
    /// Legacy workspace directory field used for compatibility and display.
    ///
    /// After global-registry refactors this is typically the current
    /// `config_path` parent directory. It is not a filesystem security
    /// boundary; sandbox enforcement comes from configured project roots.
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
    /// Shared memory-only media capability store. Image and video adapters use
    /// this same generation and expiry lifecycle.
    pub media_tickets: MediaTicketStore,
    /// Memory-only, purpose-bound capabilities for browser video streaming.
    pub video_stream_tickets: VideoStreamTicketStore,
    /// Memory-only, fixed-purpose capabilities for browser image previews.
    pub image_stream_tickets: ImageStreamTicketStore,
    /// Serializes sandbox replacement against video ticket issuance.
    pub workspace_context_guard: Arc<RwLock<()>>,
    /// MongoDB Database, if configured
    pub db: Option<mongodb::Database>,
    /// Dev mode: skip authentication checks
    pub no_auth: bool,
    /// Exact origins allowed for credentialed CORS and cross-origin media/WS.
    pub cors_origins: Arc<Vec<String>>,
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
    /// Host-resource monitor for current metrics and alert state.
    pub host_resource_monitor: HostResourceMonitor,
    /// Capability-gated host remediation actions.
    pub host_actions: HostActionService,
    /// Backend diagnostics ring and JSONL persistence handle.
    pub diagnostics: DiagnosticStore,
    /// Short-lived browser selection bundles, isolated from workspace roots.
    pub browser_debug_artifacts: BrowserDebugArtifactManager,
    /// Aggregate-only telemetry query and control handle. It is disabled when
    /// telemetry initialization failed or the user has not opted in.
    pub telemetry: Arc<std::sync::RwLock<TelemetryHandle>>,
    /// Live owner of telemetry workers and the optional loopback collector.
    /// PTY creation does not depend on this runtime.
    pub telemetry_runtime: TelemetryRuntime,
    /// Owns the narrowly-scoped, secret-safe Codex OTLP configuration mutation.
    pub codex_exporter: CodexExporterManager,
    /// Serializes telemetry queries, deletion, retention, and collector changes.
    pub telemetry_coordinator: Arc<tokio::sync::Mutex<()>>,
    /// Server-authoritative, short-lived registered worktree discovery cache.
    /// Optional workflow store/service. Workflow availability never gates PTY APIs.
    pub workflow: Option<Arc<WorkflowService>>,
    pub workspace_target_resolver: WorkspaceTargetResolver,
}

impl AppState {
    /// Return registry config parent directory used by legacy workspace-scoped features.
    pub async fn config_dir(&self) -> StdPathBuf {
        let cfg = self.config.read().await;
        cfg.config_path
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| StdPathBuf::from("/"))
    }

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

    /// Resolve a project target after copying the configured path out of the
    /// config lock. Git and filesystem work therefore never hold that lock.
    pub async fn resolve_project_target(
        &self,
        target_ref: &ProjectTargetRef,
    ) -> Result<ResolvedProjectTarget, AppError> {
        let configured_root = self
            .workspace_target_project_path(&target_ref.project)
            .await?;
        self.workspace_target_resolver
            .resolve(target_ref, &configured_root)
            .await
    }

    pub async fn refresh_project_worktrees(
        &self,
        project: &str,
    ) -> Result<Vec<ProjectWorktree>, AppError> {
        let configured_root = self.workspace_target_project_path(project).await?;
        self.workspace_target_resolver
            .refresh_project_worktrees(&configured_root)
            .await
    }

    pub async fn invalidate_project_worktrees(&self, project_root: &std::path::Path) {
        self.workspace_target_resolver
            .invalidate(project_root)
            .await;
    }

    pub async fn workspace_target_project_path(&self, name: &str) -> Result<StdPathBuf, AppError> {
        let cfg = self.config.read().await;
        cfg.projects
            .iter()
            .find(|project| project.name == name)
            .map(|project| StdPathBuf::from(&project.path))
            .ok_or(AppError::WorkspaceTarget(
                WorkspaceTargetError::UnknownProject,
            ))
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
        diagnostics: DiagnosticStore,
        telemetry_runtime: TelemetryRuntime,
    ) -> anyhow::Result<Self> {
        pty_manager.set_diagnostics(diagnostics.clone());
        let workspace_dir = Arc::new(RwLock::new(workspace_dir));
        let host_resource_monitor = HostResourceMonitor::system(
            Arc::clone(&workspace_dir),
            event_sink.clone(),
            config.server.host_resources.clone(),
        );
        let host_action_config_dir = config
            .config_path
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let host_actions = HostActionService::new(host_action_config_dir);

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
                || std::env::var("ENVIRONMENT").unwrap_or_default() == "production"
            {
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
                "⚠️  Use only on a trusted development network.\n",
                "⚠️  DO NOT expose publicly or use with sensitive data.\n",
                "⚠️  ═══════════════════════════════════════════════════════\n"
            ));

            tracing::error!("⚠️  NO-AUTH mode enabled — authentication bypassed");
        }

        let browser_debug_artifacts = BrowserDebugArtifactManager::new()
            .map_err(|error| anyhow::anyhow!("browser debug artifacts unavailable: {error}"))?;

        let media_tickets = MediaTicketStore::new();
        let video_stream_tickets = VideoStreamTicketStore::from_media(media_tickets.clone());
        let image_stream_tickets = ImageStreamTicketStore::from_media(media_tickets.clone());

        Ok(Self {
            workspace_dir,
            config: Arc::new(RwLock::new(config)),
            global_config: Arc::new(RwLock::new(global_config)),
            pty_manager,
            agent_store: Arc::new(agent_store),
            command_registry: Arc::new(CommandRegistry::new()),
            event_sink,
            jwt_secret: Arc::new(jwt_secret),
            ssh_creds: Arc::new(RwLock::new(None)),
            fs,
            media_tickets,
            video_stream_tickets,
            image_stream_tickets,
            workspace_context_guard: Arc::new(RwLock::new(())),
            db,
            no_auth,
            cors_origins: Arc::new(Vec::new()),
            tunnel_manager,
            port_forward_manager,
            opaque_server_setup: Arc::new(opaque_server_setup),
            opaque_registrations: OpaqueRegistrations::default(),
            host_resource_monitor,
            host_actions,
            diagnostics,
            browser_debug_artifacts,
            telemetry: telemetry_runtime.handle_cell(),
            telemetry_runtime,
            codex_exporter: CodexExporterManager::default_paths()
                .map_err(|error| anyhow::anyhow!("Codex exporter manager unavailable: {error}"))?,
            telemetry_coordinator: Arc::new(tokio::sync::Mutex::new(())),
            workflow: None,
            workspace_target_resolver: WorkspaceTargetResolver::new(),
        })
    }
    /// Attach the optional workflow repository using the existing session DB connection.
    pub fn with_workflow_store(mut self, store: Option<WorkflowStore>) -> Self {
        self.workflow = store.map(|store| {
            Arc::new(WorkflowService::new(
                store,
                self.config.clone(),
                self.workspace_target_resolver.clone(),
                self.workspace_context_guard.clone(),
                self.pty_manager.clone(),
            ))
        });
        self
    }

    #[cfg(test)]
    pub fn with_codex_exporter(mut self, manager: CodexExporterManager) -> Self {
        self.codex_exporter = manager;
        self
    }

    /// Whether a request carries an exact configured or same-origin browser origin.
    pub fn origin_is_allowed(&self, headers: &HeaderMap) -> bool {
        let Some(origin) = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        if self.cors_origins.iter().any(|allowed| allowed == origin) {
            return true;
        }
        let Ok(uri) = origin.parse::<Uri>() else {
            return false;
        };
        let Some(authority) = uri.authority() else {
            return false;
        };
        if !matches!(uri.scheme_str(), Some("http" | "https"))
            || (!uri.path().is_empty() && uri.path() != "/")
            || uri.query().is_some()
            || authority.as_str().contains('@')
        {
            return false;
        }
        headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|host| authority.as_str().eq_ignore_ascii_case(host))
    }

    pub fn set_telemetry(&self, telemetry: TelemetryHandle) {
        *self
            .telemetry
            .write()
            .expect("telemetry state lock poisoned") = telemetry;
    }
}

pub fn project_roots_from_config(config: &DamHopperConfig) -> Vec<(String, StdPathBuf)> {
    config
        .projects
        .iter()
        .map(|project| (project.name.clone(), StdPathBuf::from(&project.path)))
        .collect()
}
