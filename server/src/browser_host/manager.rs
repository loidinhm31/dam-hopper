use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tokio::sync::{watch, Mutex};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use super::config::{evaluate_capabilities, BrowserCapabilitiesDto, BrowserHostConfig};
use super::process::{BrowserLaunchConfig, BrowserProcess, ProcessError};
use super::profile::{now_unix_ms, ManagedProfile, ManagerMetadata, ProfileError, ProfileLock, ResetStage, ResetTombstone};

pub const DEFAULT_TERMINATE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_DELETE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_START_TIMEOUT: Duration = Duration::from_secs(15);
pub const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(5);
pub const DEFAULT_RESET_WAIT_TIMEOUT: Duration = Duration::from_secs(2);

pub type FenceCallback = Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>;
pub type AdminRecheckCallback = Arc<dyn Fn() -> BoxFuture<'static, bool> + Send + Sync>;

#[derive(Default, Clone)]
pub struct ResetFenceHooks {
    pub recheck_admin: Option<AdminRecheckCallback>,
    pub sync_fence: Option<FenceCallback>,
    pub async_teardown: Option<FenceCallback>,
}

#[derive(Debug)]
pub enum ManagerError {
    Busy(String),
    CleanupPending(String),
    PermissionDenied(String),
    StaleEpoch { expected: u64, actual: u64 },
    Disabled(String),
    Process(ProcessError),
    Profile(ProfileError),
    Timeout(String),
    Internal(String),
}

impl fmt::Display for ManagerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(msg) => write!(f, "browser busy (429): {msg}"),
            Self::CleanupPending(msg) => write!(f, "browser cleanup pending (409): {msg}"),
            Self::PermissionDenied(msg) => write!(f, "browser permission denied (403): {msg}"),
            Self::StaleEpoch { expected, actual } => {
                write!(f, "stale profile epoch (expected {expected}, current {actual})")
            }
            Self::Disabled(msg) => write!(f, "browser host disabled: {msg}"),
            Self::Process(err) => write!(f, "browser process error: {err}"),
            Self::Profile(err) => write!(f, "browser profile error: {err}"),
            Self::Timeout(msg) => write!(f, "browser operation timed out: {msg}"),
            Self::Internal(msg) => write!(f, "internal browser error: {msg}"),
        }
    }
}

impl std::error::Error for ManagerError {}

impl From<ProcessError> for ManagerError {
    fn from(err: ProcessError) -> Self {
        Self::Process(err)
    }
}

impl From<ProfileError> for ManagerError {
    fn from(err: ProfileError) -> Self {
        Self::Profile(err)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceLifecycleState {
    Dormant,
    Starting,
    Running,
    Stopping,
    Resetting,
    CleanupPending,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResetOutcome {
    Completed {
        operation_id: String,
        new_profile_epoch: u64,
    },
    CleanupPending {
        operation_id: String,
        profile_epoch: u64,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResetStatus {
    Completed {
        operation_id: String,
        profile_epoch: u64,
    },
    CleanupPending {
        operation_id: String,
        profile_epoch: u64,
        reason: Option<String>,
    },
    NotFound,
}

#[derive(Clone)]
struct ActiveResetWorker {
    operation_id: String,
    target_profile_epoch: u64,
    outcome_rx: watch::Receiver<Option<Result<ResetOutcome, String>>>,
}
#[derive(Debug, Clone)]
pub struct BrowserInstanceHandle {
    pub subject: String,
    pub is_dev: bool,
    pub pid: u32,
    pub ws_endpoint: String,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub user_data_dir: PathBuf,
}

struct InnerInstance {
    profile: ManagedProfile,
    state: InstanceLifecycleState,
    process: Option<BrowserProcess>,
    browser_incarnation: Option<String>,
    profile_epoch: u64,
    active_targets: HashMap<String, String>, // target_id -> url
    active_viewers: usize,
    active_raw_cdp: usize,
    _held_lock: Option<ProfileLock>,
    deletion_worker: Option<tokio::task::JoinHandle<Result<(), ProfileError>>>,
}

pub struct BrowserHostManager {
    config: BrowserHostConfig,
    profile_root: PathBuf,
    instances: Arc<Mutex<HashMap<String, Arc<Mutex<InnerInstance>>>>>,
    active_reset_workers: Arc<StdMutex<HashMap<String, ActiveResetWorker>>>,
    live_profile_epochs: Arc<StdRwLock<HashMap<String, u64>>>,
    global_process_count: Arc<AtomicUsize>,
    _global_viewer_count: Arc<AtomicUsize>,
    _global_raw_cdp_count: Arc<AtomicUsize>,
    _cancellation_token: CancellationToken,
    #[doc(hidden)]
    pub _simulated_reset_kill_failure: Arc<AtomicBool>,
    #[doc(hidden)]
    pub _simulated_reset_delete_failure: Arc<AtomicBool>,
    #[doc(hidden)]
    pub _simulated_reset_delay_ms: Arc<AtomicU64>,
    #[doc(hidden)]
    pub _test_mock_handle: Arc<parking_lot::RwLock<Option<BrowserInstanceHandle>>>,
}

impl BrowserHostManager {
    pub fn new(
        config: BrowserHostConfig,
        custom_profile_root: Option<PathBuf>,
        cancellation_token: CancellationToken,
    ) -> Self {
        let profile_root = custom_profile_root
            .or_else(|| config.profile_root.clone())
            .unwrap_or_else(|| {
                crate::config::global::dam_hopper_config_dir().join("browser-profiles")
            });

        Self {
            config,
            profile_root,
            instances: Arc::new(Mutex::new(HashMap::new())),
            active_reset_workers: Arc::new(StdMutex::new(HashMap::new())),
            live_profile_epochs: Arc::new(StdRwLock::new(HashMap::new())),
            global_process_count: Arc::new(AtomicUsize::new(0)),
            _global_viewer_count: Arc::new(AtomicUsize::new(0)),
            _global_raw_cdp_count: Arc::new(AtomicUsize::new(0)),
            _cancellation_token: cancellation_token,
            _simulated_reset_kill_failure: Arc::new(AtomicBool::new(false)),
            _simulated_reset_delete_failure: Arc::new(AtomicBool::new(false)),
            _simulated_reset_delay_ms: Arc::new(AtomicU64::new(0)),
            _test_mock_handle: Arc::new(parking_lot::RwLock::new(None)),
        }
    }
    pub fn config(&self) -> &BrowserHostConfig {
        &self.config
    }

    pub fn profile_root(&self) -> &Path {
        &self.profile_root
    }

    fn principal_key(subject: &str, is_dev: bool) -> String {
        format!("{}:{}", if is_dev { "dev" } else { "prod" }, subject)
    }

    /// Non-async check of live profile epoch & active reset fencing for atomic selection handoff.
    pub fn is_profile_epoch_live_sync(&self, subject: &str, is_dev: bool, expected_epoch: u64) -> bool {
        let key = Self::principal_key(subject, is_dev);
        if self.active_reset_workers.lock().unwrap().contains_key(&key) {
            return false;
        }
        if let Some(live_epoch) = self.live_profile_epochs.read().unwrap().get(&key).copied() {
            if live_epoch != expected_epoch {
                return false;
            }
        }
        true
    }

    async fn get_or_create_instance_inner(
        &self,
        subject: &str,
        is_dev: bool,
    ) -> Result<Arc<Mutex<InnerInstance>>, ManagerError> {
        let key = Self::principal_key(subject, is_dev);
        let mut map = self.instances.lock().await;
        if let Some(inst) = map.get(&key) {
            return Ok(inst.clone());
        }

        let profile = ManagedProfile::new(&self.profile_root, subject, is_dev)?;
        let meta = profile.load_or_init_metadata()?;
        let tombstone = profile.load_tombstone()?;

        let state = if tombstone.is_some() {
            InstanceLifecycleState::CleanupPending
        } else {
            InstanceLifecycleState::Dormant
        };

        let inst = Arc::new(Mutex::new(InnerInstance {
            profile,
            state,
            process: None,
            browser_incarnation: None,
            profile_epoch: meta.profile_epoch,
            active_targets: HashMap::new(),
            active_viewers: 0,
            active_raw_cdp: 0,
            _held_lock: None,
            deletion_worker: None,
        }));


        self.live_profile_epochs
            .write()
            .unwrap()
            .insert(key.clone(), meta.profile_epoch);
        map.insert(key, inst.clone());
        Ok(inst)
    }

    /// Evaluates domain capabilities for a principal without spawning Chromium.
    pub async fn capabilities(&self, subject: &str, is_dev: bool) -> BrowserCapabilitiesDto {
        let profile = match ManagedProfile::new(&self.profile_root, subject, is_dev) {
            Ok(p) => p,
            Err(e) => {
                let mut caps = evaluate_capabilities(&self.config, false, 1);
                caps.available = false;
                caps.unavailable_reason = Some(format!("failed to resolve profile: {e}"));
                return caps;
            }
        };

        let tombstone = profile.load_tombstone().ok().flatten();
        let meta = profile.load_or_init_metadata().ok();
        let epoch = meta.as_ref().map(|m| m.profile_epoch).unwrap_or(1);
        let managed_profile_present = profile.has_managed_profile();

        let mut caps = evaluate_capabilities(&self.config, managed_profile_present, epoch);

        if tombstone.is_some() {
            caps.available = false;
            caps.unavailable_reason = Some(
                "profile cleanup pending from prior failed reset or termination; recovery or confirmed reset required".to_string(),
            );
        }

        caps
    }

    /// Ensure a running browser instance for this principal.
    ///
    /// Reconnect reuses the live managed instance. If dead or dormant, launches new instance.
    pub async fn ensure_running(
        &self,
        subject: &str,
        is_dev: bool,
    ) -> Result<BrowserInstanceHandle, ManagerError> {
        if !self.config.enabled {
            return Err(ManagerError::Disabled("browser host is disabled in configuration".to_string()));
        }

        if let Some(mock) = self._test_mock_handle.read().clone() {
            return Ok(mock);
        }
        if let Ok(profile) = ManagedProfile::new(&self.profile_root, subject, is_dev) {
            if profile.load_tombstone().ok().flatten().is_some() {
                return Err(ManagerError::CleanupPending(
                    "cannot start browser while profile reset cleanup is pending".to_string(),
                ));
            }
        }
        let inst_arc = self.get_or_create_instance_inner(subject, is_dev).await?;
        let mut inst = match inst_arc.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                let key = Self::principal_key(subject, is_dev);
                let has_worker = self
                    .active_reset_workers
                    .lock()
                    .unwrap()
                    .contains_key(&key);
                if has_worker {
                    return Err(ManagerError::CleanupPending(
                        "cannot start browser while profile reset cleanup is active".to_string(),
                    ));
                }
                inst_arc.lock().await
            }
        };

        if inst.state == InstanceLifecycleState::CleanupPending
            || inst.state == InstanceLifecycleState::Resetting
        {
            return Err(ManagerError::CleanupPending(
                "cannot start browser while profile reset cleanup is pending".to_string(),
            ));
        }
        // Reconnect: check if existing process is running and alive
        if inst.state == InstanceLifecycleState::Running {
            if let Some(mut proc) = inst.process.take() {
                let is_alive = proc.try_is_alive();
                if is_alive {
                    let pid = proc.pid();
                    let ws_endpoint = proc.ws_endpoint().to_string();
                    inst.process = Some(proc);
                    return Ok(BrowserInstanceHandle {
                        subject: subject.to_string(),
                        is_dev,
                        pid,
                        ws_endpoint,
                        browser_incarnation: inst.browser_incarnation.clone().unwrap_or_default(),
                        profile_epoch: inst.profile_epoch,
                        user_data_dir: inst.profile.user_data_dir().to_path_buf(),
                    });
                } else {
                    warn!(pid = proc.pid(), "managed browser process died unexpectedly, terminating group and marking targets lost");
                    let term_res = proc.terminate().await;
                    inst.active_targets.clear();
                    inst.active_viewers = 0;
                    inst.active_raw_cdp = 0;
                    self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                    if let Err(e) = term_res {
                        warn!(pid = proc.pid(), error = %e, "process group cleanup unproven after crash");
                        inst.state = InstanceLifecycleState::CleanupPending;
                        let tombstone = ResetTombstone {
                            operation_id: format!("crash-{}", uuid::Uuid::new_v4()),
                            target_profile_epoch: inst.profile_epoch,
                            stage: ResetStage::Failed,
                            created_at_unix_ms: now_unix_ms(),
                            updated_at_unix_ms: now_unix_ms(),
                            error: Some(format!("process group containment unproven: {e}")),
                            process_pid: Some(proc.pid()),
                            #[cfg(unix)]
                            process_pgid: Some(proc.pgid()),
                            #[cfg(not(unix))]
                            process_pgid: None,
                        };
                        let _ = inst.profile.save_tombstone(&tombstone);
                        return Err(ManagerError::CleanupPending(format!("process group containment unproven: {e}")));
                    }
                    inst.state = InstanceLifecycleState::Dormant;
                    inst._held_lock = None;
                }
            }
        }

        // Enforce global capacity with atomic reservation
        let max_procs = self.config.budgets.max_processes;
        let mut curr = self.global_process_count.load(Ordering::SeqCst);
        loop {
            if curr >= max_procs {
                return Err(ManagerError::Busy(format!(
                    "global browser process capacity reached ({curr}/{max_procs})"
                )));
            }
            match self.global_process_count.compare_exchange_weak(
                curr,
                curr + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => break,
                Err(actual) => curr = actual,
            }
        }

        // Acquire exclusive lock for profile
        let lock = match inst.profile.lock_with_timeout(DEFAULT_LOCK_TIMEOUT).await {
            Ok(l) => l,
            Err(e) => {
                self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                return Err(e.into());
            }
        };
        inst.state = InstanceLifecycleState::Starting;

        // Ensure user-data directory exists with 0700 permissions
        if let Err(e) = inst.profile.ensure_user_data_dir() {
            self.global_process_count.fetch_sub(1, Ordering::SeqCst);
            inst.state = InstanceLifecycleState::Dormant;
            return Err(e.into());
        }
        let mut launch_config = BrowserLaunchConfig::new(inst.profile.user_data_dir().to_path_buf());
        launch_config.executable_path = self.config.executable_path.clone();
        launch_config.headless = true;

        info!(subject, is_dev, "launching supervised browser process");
        let process_res = timeout(DEFAULT_START_TIMEOUT, BrowserProcess::launch(launch_config)).await;
        let mut process = match process_res {
            Ok(Ok(p)) => p,
            Ok(Err(err)) => {
                self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                inst.state = InstanceLifecycleState::Dormant;
                return Err(ManagerError::Process(err));
            }
            Err(_) => {
                self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                inst.state = InstanceLifecycleState::Dormant;
                return Err(ManagerError::Timeout("browser process failed to start within 15s".to_string()));
            }
        };

        let incarnation = uuid::Uuid::new_v4().to_string();
        let pid = process.pid();
        let ws_endpoint = process.ws_endpoint().to_string();

        #[cfg(unix)]
        let pgid = process.pgid();
        let mut meta = match inst.profile.load_or_init_metadata() {
            Ok(m) => m,
            Err(e) => {
                self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                let _ = process.terminate().await;
                inst.state = InstanceLifecycleState::Dormant;
                return Err(e.into());
            }
        };
        meta.browser_incarnation = Some(incarnation.clone());
        meta.process_pid = Some(pid);
        #[cfg(unix)]
        {
            meta.process_pgid = Some(pgid);
        }
        meta.updated_at_unix_ms = now_unix_ms();
        if let Err(e) = inst.profile.save_metadata(&meta) {
            self.global_process_count.fetch_sub(1, Ordering::SeqCst);
            let _ = process.terminate().await;
            inst.state = InstanceLifecycleState::Dormant;
            return Err(e.into());
        }
        inst.process = Some(process);
        inst.browser_incarnation = Some(incarnation.clone());
        inst.state = InstanceLifecycleState::Running;
        inst._held_lock = Some(lock);

        Ok(BrowserInstanceHandle {
            subject: subject.to_string(),
            is_dev,
            pid,
            ws_endpoint,
            browser_incarnation: incarnation,
            profile_epoch: inst.profile_epoch,
            user_data_dir: inst.profile.user_data_dir().to_path_buf(),
        })
    }

    /// Gracefully stop the browser process for a principal without deleting credentials.
    pub async fn stop_instance(&self, subject: &str, is_dev: bool) -> Result<(), ManagerError> {
        let inst_arc = self.get_or_create_instance_inner(subject, is_dev).await?;
        let mut inst = inst_arc.lock().await;

        if inst.state != InstanceLifecycleState::Running && inst.process.is_none() {
            inst.state = InstanceLifecycleState::Dormant;
            return Ok(());
        }

        inst.state = InstanceLifecycleState::Stopping;
        info!(subject, is_dev, "stopping browser process");

        if let Some(mut proc) = inst.process.take() {
            let term_res = timeout(DEFAULT_TERMINATE_TIMEOUT, proc.terminate()).await;
            self.global_process_count.fetch_sub(1, Ordering::SeqCst);

            match term_res {
                Ok(Ok(())) => {
                    info!(subject, is_dev, "browser process successfully terminated");
                }
                Ok(Err(e)) => {
                    error!(subject, is_dev, "error terminating browser process: {e}");
                    return Err(ManagerError::Process(e));
                }
                Err(_) => {
                    error!(subject, is_dev, "timed out terminating browser process after 10s");
                    return Err(ManagerError::Timeout("termination timed out after 10s".to_string()));
                }
            }
        }

        inst.active_targets.clear();
        inst.active_viewers = 0;
        inst.active_raw_cdp = 0;
        inst._held_lock = None;
        inst.state = InstanceLifecycleState::Dormant;

        Ok(())
    }

    /// Perform confirmed browser profile reset according to architecture-contracts.md §11.
    ///
    /// Sequence:
    /// 1. Acquire lock.
    /// 2. Check idempotent operation ID.
    /// 3. Verify expected_profile_epoch.
    /// 4. Advance profileEpoch and write reset.json tombstone atomically before cancellation.
    /// 5. Fence & terminate process within 10s.
    /// 6. Delete user-data/ within 10s.
    /// 7. Recreate empty 0700 user-data/.
    /// 8. Clear tombstone and return Completed.
    /// Checks whether user-data credentials, running instance, active worker, or reset tombstone exist.
    pub async fn has_browser_credentials_or_tombstone(&self, subject: &str, is_dev: bool) -> bool {
        let key = Self::principal_key(subject, is_dev);
        if self.active_reset_workers.lock().unwrap().contains_key(&key) {
            return true;
        }
        if let Some(inst_arc) = self.instances.lock().await.get(&key).cloned() {
            if let Ok(inst) = inst_arc.try_lock() {
                if matches!(
                    inst.state,
                    InstanceLifecycleState::Running
                        | InstanceLifecycleState::Starting
                        | InstanceLifecycleState::Resetting
                        | InstanceLifecycleState::CleanupPending
                ) || inst.process.is_some()
                {
                    return true;
                }
            } else {
                return true;
            }
        }
        let Ok(profile) = ManagedProfile::new(&self.profile_root, subject, is_dev) else {
            return true;
        };
        if profile.reset_file().exists() {
            return true;
        }
        if profile.user_data_dir().exists() {
            return match std::fs::read_dir(profile.user_data_dir()) {
                Ok(mut entries) => entries.next().is_some(),
                Err(_) => true,
            };
        }
        false
    }

    /// Checks whether any persisted profile directory/metadata/tombstone exists on disk.
    pub fn has_persisted_profile_state(&self, subject: &str, is_dev: bool) -> bool {
        let Ok(profile) = ManagedProfile::new(&self.profile_root, subject, is_dev) else {
            return true;
        };
        profile.metadata_file().exists()
            || profile.user_data_dir().exists()
            || profile.reset_file().exists()
    }

    /// Checks whether an active reset tombstone or background reset worker exists.
    pub async fn has_active_tombstone(&self, subject: &str, is_dev: bool) -> bool {
        let key = Self::principal_key(subject, is_dev);
        if self.active_reset_workers.lock().unwrap().contains_key(&key) {
            return true;
        }
        let Ok(profile) = ManagedProfile::new(&self.profile_root, subject, is_dev) else {
            return false;
        };
        profile.reset_file().exists()
    }
    /// Inspects status of a specific profile reset operation without creating metadata files.
    pub async fn get_reset_status(
        &self,
        subject: &str,
        is_dev: bool,
        operation_id: &str,
    ) -> Result<ResetStatus, ManagerError> {
        let key = Self::principal_key(subject, is_dev);
        let worker_opt = self.active_reset_workers.lock().unwrap().get(&key).cloned();
        if let Some(worker) = worker_opt {
            if worker.operation_id == operation_id {
                if let Some(res) = worker.outcome_rx.borrow().clone() {
                    match res {
                        Ok(ResetOutcome::Completed { operation_id, new_profile_epoch }) => {
                            return Ok(ResetStatus::Completed {
                                operation_id,
                                profile_epoch: new_profile_epoch,
                            });
                        }
                        Ok(ResetOutcome::CleanupPending { operation_id, profile_epoch, reason }) => {
                            return Ok(ResetStatus::CleanupPending {
                                operation_id,
                                profile_epoch,
                                reason: Some(reason),
                            });
                        }
                        Err(msg) => return Err(ManagerError::Internal(msg)),
                    }
                }
                return Ok(ResetStatus::CleanupPending {
                    operation_id: worker.operation_id,
                    profile_epoch: worker.target_profile_epoch,
                    reason: Some("profile reset cleanup continuing in background".to_string()),
                });
            }
        }

        let profile = ManagedProfile::new(&self.profile_root, subject, is_dev)?;
        if let Some(tombstone) = profile.load_tombstone()? {
            if tombstone.operation_id == operation_id {
                return Ok(ResetStatus::CleanupPending {
                    operation_id: tombstone.operation_id,
                    profile_epoch: tombstone.target_profile_epoch,
                    reason: tombstone.error,
                });
            }
            return Ok(ResetStatus::NotFound);
        }

        if profile.metadata_file().exists() {
            let content = std::fs::read_to_string(profile.metadata_file())
                .map_err(|e| ManagerError::Profile(ProfileError::Io(e)))?;
            let meta: ManagerMetadata = serde_json::from_str(&content).map_err(|e| {
                ManagerError::Profile(ProfileError::CorruptMetadata(format!(
                    "cannot parse {}: {e}",
                    profile.metadata_file().display()
                )))
            })?;
            if meta.last_reset_operation_id.as_deref() == Some(operation_id) {
                return Ok(ResetStatus::Completed {
                    operation_id: operation_id.to_string(),
                    profile_epoch: meta.profile_epoch,
                });
            }
        }

        Ok(ResetStatus::NotFound)
    }

    /// Perform confirmed browser profile reset according to architecture-contracts.md §11.
    pub async fn reset_profile(
        &self,
        subject: &str,
        is_dev: bool,
        operation_id: &str,
        expected_profile_epoch: u64,
    ) -> Result<ResetOutcome, ManagerError> {
        self.reset_profile_with_fence(subject, is_dev, operation_id, expected_profile_epoch, None)
            .await
    }

    /// Perform confirmed browser profile reset, invoking `on_intent_committed` immediately after
    /// writing durable tombstone/epoch and before terminate-and-wait/deletion. Responds within 2s
    /// with CleanupPending if worker is still finishing under manager ownership.
    pub async fn reset_profile_with_fence(
        &self,
        subject: &str,
        is_dev: bool,
        operation_id: &str,
        expected_profile_epoch: u64,
        on_intent_committed: Option<FenceCallback>,
    ) -> Result<ResetOutcome, ManagerError> {
        self.reset_profile_with_hooks(
            subject,
            is_dev,
            operation_id,
            expected_profile_epoch,
            ResetFenceHooks {
                recheck_admin: None,
                sync_fence: on_intent_committed,
                async_teardown: None,
            },
        )
        .await
    }

    /// Perform confirmed browser profile reset under the principal lock:
    /// 1) Recheck live Admin admission after acquiring principal lock (if provided),
    /// 2) Write durable tombstone and bump profile epoch,
    /// 3) Invoke synchronous in-memory/artifact fence immediately,
    /// 4) Register and spawn background worker BEFORE waiting up to 2s, running bounded async CDP teardown inside the worker.
    pub async fn reset_profile_with_hooks(
        &self,
        subject: &str,
        is_dev: bool,
        operation_id: &str,
        expected_profile_epoch: u64,
        hooks: ResetFenceHooks,
    ) -> Result<ResetOutcome, ManagerError> {
        let key = Self::principal_key(subject, is_dev);

        // If a background worker for this principal is already running, wait up to 2s for same operation_id
        let existing_worker = self.active_reset_workers.lock().unwrap().get(&key).cloned();
        if let Some(worker) = existing_worker {
            if worker.operation_id != operation_id {
                return Err(ManagerError::CleanupPending(format!(
                    "profile has active reset operation {}",
                    worker.operation_id
                )));
            }
            let mut rx = worker.outcome_rx;
            let wait_res = timeout(DEFAULT_RESET_WAIT_TIMEOUT, async move {
                loop {
                    if let Some(res) = rx.borrow().clone() {
                        return res;
                    }
                    if rx.changed().await.is_err() {
                        return Err("reset worker exited unexpectedly".to_string());
                    }
                }
            })
            .await;
            return match wait_res {
                Ok(Ok(outcome)) => Ok(outcome),
                Ok(Err(msg)) => Err(ManagerError::Internal(msg)),
                Err(_) => Ok(ResetOutcome::CleanupPending {
                    operation_id: operation_id.to_string(),
                    profile_epoch: worker.target_profile_epoch,
                    reason: "profile reset cleanup continuing in background".to_string(),
                }),
            };
        }

        let inst_arc = self.get_or_create_instance_inner(subject, is_dev).await?;
        let mut inst = inst_arc.lock_owned().await;
        let had_held_lock = inst._held_lock.is_some();
        if !had_held_lock {
            inst._held_lock = Some(inst.profile.lock_with_timeout(DEFAULT_LOCK_TIMEOUT).await?);
        }

        // Recheck live Admin authorization under the principal lock BEFORE initiating/resuming any destructive intent.
        if let Some(recheck) = &hooks.recheck_admin {
            if !recheck().await {
                if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                    inst._held_lock = None;
                }
                return Err(ManagerError::PermissionDenied(
                    "live admin authorization revoked before reset intent".to_string(),
                ));
            }
        }

        let mut meta = inst.profile.load_or_init_metadata()?;

        // Check if this operation already completed successfully (idempotent duplicate)
        if meta.last_reset_operation_id.as_deref() == Some(operation_id) {
            info!(operation_id, "idempotent query of already-completed profile reset");
            if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                inst._held_lock = None;
            }
            return Ok(ResetOutcome::Completed {
                operation_id: operation_id.to_string(),
                new_profile_epoch: meta.profile_epoch,
            });
        }
        // Check existing tombstone or initialize new reset intent
        let (mut tombstone, new_epoch) = if let Some(existing) = inst.profile.load_tombstone()? {
            if existing.operation_id == operation_id {
                info!(operation_id, "resuming incomplete/failed profile reset");
                let epoch = existing.target_profile_epoch;
                meta.profile_epoch = epoch;
                inst.profile_epoch = epoch;
                let _ = inst.profile.save_metadata(&meta);
                (existing, epoch)
            } else {
                if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                    inst._held_lock = None;
                }
                return Err(ManagerError::CleanupPending(format!(
                    "profile has active tombstone from operation {}",
                    existing.operation_id
                )));
            }
        } else {
            // Validate expected profile epoch
            if meta.profile_epoch != expected_profile_epoch {
                if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                    inst._held_lock = None;
                }
                return Err(ManagerError::StaleEpoch {
                    expected: expected_profile_epoch,
                    actual: meta.profile_epoch,
                });
            }

            let target_epoch = meta.profile_epoch.saturating_add(1);
            info!(subject, is_dev, operation_id, target_epoch, "initiating durable browser profile reset");

            let tombstone = ResetTombstone {
                operation_id: operation_id.to_string(),
                target_profile_epoch: target_epoch,
                stage: ResetStage::Initiated,
                created_at_unix_ms: now_unix_ms(),
                updated_at_unix_ms: now_unix_ms(),
                error: None,
                process_pid: meta.process_pid,
                process_pgid: meta.process_pgid,
            };
            inst.profile.save_tombstone(&tombstone)?;

            meta.profile_epoch = target_epoch;
            meta.browser_incarnation = None;
            meta.updated_at_unix_ms = now_unix_ms();
            inst.profile.save_metadata(&meta)?;
            inst.profile_epoch = target_epoch;
            (tombstone, target_epoch)
        };
        inst.state = InstanceLifecycleState::Resetting;
        inst.active_targets.clear();
        inst.active_viewers = 0;
        inst.active_raw_cdp = 0;

        // Update fast epoch map synchronously and spawn worker immediately with ZERO .await gaps
        // after durable tombstone persistence so caller cancellation cannot orphan intent.
        self.live_profile_epochs
            .write()
            .unwrap()
            .insert(key.clone(), new_epoch);

        let (tx, mut rx) = watch::channel::<Option<Result<ResetOutcome, String>>>(None);
        {
            let mut workers = self.active_reset_workers.lock().unwrap();
            workers.insert(
                key.clone(),
                ActiveResetWorker {
                    operation_id: operation_id.to_string(),
                    target_profile_epoch: new_epoch,
                    outcome_rx: rx.clone(),
                },
            );
        }

        let global_process_count = self.global_process_count.clone();
        let kill_fail_flag = self._simulated_reset_kill_failure.clone();
        let delete_fail_flag = self._simulated_reset_delete_failure.clone();
        let delay_ms_flag = self._simulated_reset_delay_ms.clone();
        let active_workers = self.active_reset_workers.clone();
        let subject_owned = subject.to_string();
        let op_owned = operation_id.to_string();
        let sync_fence = hooks.sync_fence;
        let async_teardown = hooks.async_teardown;

        tokio::spawn(async move {
            let finish_worker = |outcome: Result<ResetOutcome, String>| async {
                active_workers.lock().unwrap().remove(&key);
                let _ = tx.send(Some(outcome));
            };

            // In-memory fence + artifact disk cleanup & network/CDP teardown INSIDE worker ownership
            // and covered by the 2s caller response deadline.
            if let Some(sync_cb) = sync_fence {
                sync_cb().await;
            }
            if let Some(teardown_cb) = async_teardown {
                teardown_cb().await;
            }
            let delay_ms = delay_ms_flag.load(Ordering::SeqCst);
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            tombstone.stage = ResetStage::Terminating;
            tombstone.updated_at_unix_ms = now_unix_ms();
            let _ = inst.profile.save_tombstone(&tombstone);

            if kill_fail_flag.load(Ordering::SeqCst) {
                tombstone.stage = ResetStage::Failed;
                tombstone.error = Some("simulated process kill failure".to_string());
                let _ = inst.profile.save_tombstone(&tombstone);
                inst.state = InstanceLifecycleState::CleanupPending;
                finish_worker(Ok(ResetOutcome::CleanupPending {
                    operation_id: op_owned,
                    profile_epoch: new_epoch,
                    reason: "simulated process kill failure".to_string(),
                }))
                .await;
                return;
            }

            if let Some(mut proc) = inst.process.take() {
                let term_res = timeout(DEFAULT_TERMINATE_TIMEOUT, proc.terminate()).await;
                global_process_count.fetch_sub(1, Ordering::SeqCst);

                match term_res {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        tombstone.stage = ResetStage::Failed;
                        tombstone.error = Some(format!("process termination failed: {e}"));
                        let _ = inst.profile.save_tombstone(&tombstone);
                        inst.state = InstanceLifecycleState::CleanupPending;
                        finish_worker(Ok(ResetOutcome::CleanupPending {
                            operation_id: op_owned,
                            profile_epoch: new_epoch,
                            reason: format!("process termination failed: {e}"),
                        }))
                        .await;
                        return;
                    }
                    Err(_) => {
                        tombstone.stage = ResetStage::Failed;
                        tombstone.error = Some("process termination timed out after 10s".to_string());
                        let _ = inst.profile.save_tombstone(&tombstone);
                        inst.state = InstanceLifecycleState::CleanupPending;
                        finish_worker(Ok(ResetOutcome::CleanupPending {
                            operation_id: op_owned,
                            profile_epoch: new_epoch,
                            reason: "process termination timed out after 10s".to_string(),
                        }))
                        .await;
                        return;
                    }
                }
            } else if let Some(pgid) = tombstone.process_pgid.or(meta.process_pgid) {
                if pgid <= 1 {
                    tombstone.stage = ResetStage::Failed;
                    tombstone.error = Some(format!("invalid non-positive PGID {pgid}"));
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                    finish_worker(Ok(ResetOutcome::CleanupPending {
                        operation_id: op_owned,
                        profile_epoch: new_epoch,
                        reason: format!("invalid non-positive PGID {pgid}"),
                    }))
                    .await;
                    return;
                }
                #[cfg(unix)]
                {
                    use nix::sys::signal::killpg;
                    use nix::unistd::Pid;
                    let pg = Pid::from_raw(pgid);
                    match killpg(pg, None) {
                        Err(nix::errno::Errno::ESRCH) => {}
                        Ok(()) => {
                            tombstone.stage = ResetStage::Failed;
                            tombstone.error = Some(format!(
                                "prior browser process group {pgid} still active on restart; unverified ownership"
                            ));
                            let _ = inst.profile.save_tombstone(&tombstone);
                            inst.state = InstanceLifecycleState::CleanupPending;
                            finish_worker(Ok(ResetOutcome::CleanupPending {
                                operation_id: op_owned,
                                profile_epoch: new_epoch,
                                reason: format!(
                                    "prior browser process group {pgid} still active on restart; unverified ownership"
                                ),
                            }))
                            .await;
                            return;
                        }
                        Err(e) => {
                            tombstone.stage = ResetStage::Failed;
                            tombstone.error = Some(format!("OS probe error on PGID {pgid}: {e}"));
                            let _ = inst.profile.save_tombstone(&tombstone);
                            inst.state = InstanceLifecycleState::CleanupPending;
                            finish_worker(Ok(ResetOutcome::CleanupPending {
                                operation_id: op_owned,
                                profile_epoch: new_epoch,
                                reason: format!("OS probe error on PGID {pgid}: {e}"),
                            }))
                            .await;
                            return;
                        }
                    }
                }
            }

            // Step 6: Delete user-data/ within 10s
            tombstone.stage = ResetStage::DeletingUserData;
            tombstone.updated_at_unix_ms = now_unix_ms();
            let _ = inst.profile.save_tombstone(&tombstone);

            if delete_fail_flag.load(Ordering::SeqCst) {
                tombstone.stage = ResetStage::Failed;
                tombstone.error = Some("simulated user-data deletion failure".to_string());
                let _ = inst.profile.save_tombstone(&tombstone);
                inst.state = InstanceLifecycleState::CleanupPending;
                finish_worker(Ok(ResetOutcome::CleanupPending {
                    operation_id: op_owned,
                    profile_epoch: new_epoch,
                    reason: "simulated user-data deletion failure".to_string(),
                }))
                .await;
                return;
            }

            let mut handle = inst.deletion_worker.take().unwrap_or_else(|| {
                let profile_clone = inst.profile.clone();
                tokio::task::spawn_blocking(move || profile_clone.delete_user_data())
            });

            let del_res = timeout(DEFAULT_DELETE_TIMEOUT, &mut handle).await;
            match del_res {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(e))) => {
                    tombstone.stage = ResetStage::Failed;
                    tombstone.error = Some(format!("user-data deletion failed: {e}"));
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                    finish_worker(Ok(ResetOutcome::CleanupPending {
                        operation_id: op_owned,
                        profile_epoch: new_epoch,
                        reason: format!("user-data deletion failed: {e}"),
                    }))
                    .await;
                    return;
                }
                Ok(Err(join_err)) => {
                    tombstone.stage = ResetStage::Failed;
                    tombstone.error = Some(format!("user-data deletion task failed: {join_err}"));
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                    finish_worker(Ok(ResetOutcome::CleanupPending {
                        operation_id: op_owned,
                        profile_epoch: new_epoch,
                        reason: format!("user-data deletion task failed: {join_err}"),
                    }))
                    .await;
                    return;
                }
                Err(_) => {
                    inst.deletion_worker = Some(handle);
                    tombstone.stage = ResetStage::Failed;
                    tombstone.error = Some("user-data deletion timed out after 10s".to_string());
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                    finish_worker(Ok(ResetOutcome::CleanupPending {
                        operation_id: op_owned,
                        profile_epoch: new_epoch,
                        reason: "user-data deletion timed out after 10s".to_string(),
                    }))
                    .await;
                    return;
                }
            }

            // Step 7: Recreate empty user-data/ with 0700 permissions
            tombstone.stage = ResetStage::RecreatingUserData;
            tombstone.updated_at_unix_ms = now_unix_ms();
            let _ = inst.profile.save_tombstone(&tombstone);

            if let Err(e) = inst.profile.recreate_user_data() {
                tombstone.stage = ResetStage::Failed;
                tombstone.error = Some(format!("failed to recreate user-data dir: {e}"));
                let _ = inst.profile.save_tombstone(&tombstone);
                inst.state = InstanceLifecycleState::CleanupPending;
                finish_worker(Ok(ResetOutcome::CleanupPending {
                    operation_id: op_owned,
                    profile_epoch: new_epoch,
                    reason: format!("failed to recreate user-data dir: {e}"),
                }))
                .await;
                return;
            }

            // Step 8: Clear tombstone and finish
            meta.last_reset_operation_id = Some(op_owned.clone());
            meta.process_pid = None;
            meta.process_pgid = None;
            let _ = inst.profile.save_metadata(&meta);
            if let Err(e) = inst.profile.clear_tombstone() {
                inst.state = InstanceLifecycleState::CleanupPending;
                finish_worker(Err(format!("failed to clear tombstone: {e}")))
                    .await;
                return;
            }
            inst.state = InstanceLifecycleState::Dormant;
            inst.active_targets.clear();
            inst.active_viewers = 0;
            inst.active_raw_cdp = 0;
            inst.deletion_worker = None;
            inst._held_lock = None;
            info!(
                subject = %subject_owned,
                is_dev,
                operation_id = %op_owned,
                new_epoch,
                "browser profile reset completed successfully"
            );

            finish_worker(Ok(ResetOutcome::Completed {
                operation_id: op_owned,
                new_profile_epoch: new_epoch,
            }))
            .await;
        });

        let wait_res = timeout(DEFAULT_RESET_WAIT_TIMEOUT, async move {
            loop {
                if let Some(res) = rx.borrow().clone() {
                    return res;
                }
                if rx.changed().await.is_err() {
                    return Err("reset worker exited unexpectedly".to_string());
                }
            }
        })
        .await;

        match wait_res {
            Ok(Ok(outcome)) => Ok(outcome),
            Ok(Err(msg)) => Err(ManagerError::Internal(msg)),
            Err(_) => Ok(ResetOutcome::CleanupPending {
                operation_id: operation_id.to_string(),
                profile_epoch: new_epoch,
                reason: "profile reset cleanup continuing in background".to_string(),
            }),
        }
    }
    /// Terminate all managed browser instances during server shutdown.
    pub async fn shutdown_all(&self) {
        info!("shutting down all managed browser host instances");
        let instances = {
            let map = self.instances.lock().await;
            map.values().cloned().collect::<Vec<_>>()
        };

        for inst_arc in instances {
            let mut inst = inst_arc.lock().await;
            if let Some(mut proc) = inst.process.take() {
                let term_res = timeout(DEFAULT_TERMINATE_TIMEOUT, proc.terminate()).await;
                if let Ok(Err(e)) = term_res {
                    warn!(error = %e, "process termination unproven during server shutdown");
                    let tombstone = ResetTombstone {
                        operation_id: format!("shutdown-{}", uuid::Uuid::new_v4()),
                        target_profile_epoch: inst.profile_epoch,
                        stage: ResetStage::Failed,
                        created_at_unix_ms: now_unix_ms(),
                        updated_at_unix_ms: now_unix_ms(),
                        error: Some(format!("shutdown containment unproven: {e}")),
                        process_pid: Some(proc.pid()),
                        #[cfg(unix)]
                        process_pgid: Some(proc.pgid()),
                        #[cfg(not(unix))]
                        process_pgid: None,
                    };
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                } else if term_res.is_err() {
                    warn!("process termination timed out during server shutdown");
                    let tombstone = ResetTombstone {
                        operation_id: format!("shutdown-{}", uuid::Uuid::new_v4()),
                        target_profile_epoch: inst.profile_epoch,
                        stage: ResetStage::Failed,
                        created_at_unix_ms: now_unix_ms(),
                        updated_at_unix_ms: now_unix_ms(),
                        error: Some("shutdown containment timed out".to_string()),
                        process_pid: Some(proc.pid()),
                        #[cfg(unix)]
                        process_pgid: Some(proc.pgid()),
                        #[cfg(not(unix))]
                        process_pgid: None,
                    };
                    let _ = inst.profile.save_tombstone(&tombstone);
                    inst.state = InstanceLifecycleState::CleanupPending;
                } else {
                    inst.state = InstanceLifecycleState::Dormant;
                }
            }
            inst.active_targets.clear();
            inst.active_viewers = 0;
            inst.active_raw_cdp = 0;
        }
        self.global_process_count.store(0, Ordering::SeqCst);
    }

    pub async fn register_agent_cdp(&self, subject: &str, is_dev: bool) {
        if let Ok(inst_arc) = self.get_or_create_instance_inner(subject, is_dev).await {
            let mut inst = inst_arc.lock().await;
            inst.active_raw_cdp += 1;
            self._global_raw_cdp_count.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub async fn unregister_agent_cdp(&self, subject: &str, is_dev: bool) {
        if let Ok(inst_arc) = self.get_or_create_instance_inner(subject, is_dev).await {
            let mut inst = inst_arc.lock().await;
            inst.active_raw_cdp = inst.active_raw_cdp.saturating_sub(1);
            self._global_raw_cdp_count.fetch_sub(1, Ordering::SeqCst);
        }
    }

    pub async fn register_agent_target(&self, subject: &str, is_dev: bool, target_id: &str, url: &str) {
        if let Ok(inst_arc) = self.get_or_create_instance_inner(subject, is_dev).await {
            let mut inst = inst_arc.lock().await;
            if inst.active_targets.len() < 64 || inst.active_targets.contains_key(target_id) {
                inst.active_targets.insert(target_id.to_string(), url.to_string());
            }
        }
    }

    pub async fn unregister_agent_target(&self, subject: &str, is_dev: bool, target_id: &str) {
        if let Ok(inst_arc) = self.get_or_create_instance_inner(subject, is_dev).await {
            let mut inst = inst_arc.lock().await;
            inst.active_targets.remove(target_id);
        }
    }

    pub async fn get_active_targets(&self, subject: &str, is_dev: bool) -> HashMap<String, String> {
        if let Ok(inst_arc) = self.get_or_create_instance_inner(subject, is_dev).await {
            let inst = inst_arc.lock().await;
            inst.active_targets.clone()
        } else {
            HashMap::new()
        }
    }
}
