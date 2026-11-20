use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot, watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use super::cdp::{
    CdpClient, CdpError, CdpFrameTreeSnapshot, CdpLifecycleEvent, CdpOrderedEvent,
    CdpOrderedRecord, CdpStreamPosition, CdpTargetEvent, ContainmentEscalation, FrameDetachReason,
    NativeTargetInfo,
};
use super::config::{evaluate_capabilities, BrowserCapabilitiesDto, BrowserHostConfig};
use super::network_policy::NetworkPolicy;
use super::process::{
    reap_prior_tree, BrowserLaunchConfig, BrowserProcess, ContainmentIdentity, ProcessError,
    ReapTimings,
};
use super::profile::{
    now_unix_ms, ManagedProfile, ManagerMetadata, ProfileError, ProfileFaults, ProfileLock,
    ResetStage, ResetTombstone,
};
use super::session::{
    creation_marker_url, parse_creation_marker, BindOutcome, BrowserSessionDto, DownloadOwner,
    PopupAdmission, RollbackOutcome, SessionDeparture, SessionRegistry, SessionStatus, TargetClass,
};
use super::target_ownership::{
    FrameOwner, FrameSnapshotNode, OwnershipFence, RootFenceStatus, ValidityToken,
};

pub const DEFAULT_TERMINATE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_DELETE_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_START_TIMEOUT: Duration = Duration::from_secs(15);
pub const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(5);
pub const DEFAULT_RESET_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a prior browser tree gets to vanish by itself (its death watcher is mid
/// TERM-to-KILL) before a verified owner is terminated.
pub const DEFAULT_PRIOR_TREE_SETTLE: Duration = Duration::from_secs(3);
const PRIOR_TREE_TERM_GRACE: Duration = Duration::from_secs(3);
const PRIOR_TREE_PROOF: Duration = Duration::from_secs(2);

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
                write!(
                    f,
                    "stale profile epoch (expected {expected}, current {actual})"
                )
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
    /// Settle window (ms) granted to a prior browser tree before it is terminated.
    #[doc(hidden)]
    pub _prior_tree_settle_ms: Arc<AtomicU64>,
    /// Fault injection at every persisted profile boundary (tests only).
    #[doc(hidden)]
    pub profile_faults: Arc<ProfileFaults>,
    #[doc(hidden)]
    pub _test_mock_handle: Arc<parking_lot::RwLock<Option<BrowserInstanceHandle>>>,
    native: NativeHandles,
    max_targets: usize,
    pump_rx: Arc<StdMutex<Option<mpsc::Receiver<NativePumpRequest>>>>,
    next_observer_token: Arc<AtomicU64>,
    /// Fault injection for native target creation/close/publication (tests only).
    #[doc(hidden)]
    pub native_faults: Arc<NativeFaults>,
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

        let (pump_tx, pump_rx) = mpsc::channel(NATIVE_PUMP_SLOTS);
        let (events_tx, _) = broadcast::channel(NATIVE_EVENT_SLOTS);
        let global_process_count = Arc::new(AtomicUsize::new(0));
        let max_targets = config.budgets.max_targets;
        Self {
            config,
            profile_root,
            instances: Arc::new(Mutex::new(HashMap::new())),
            active_reset_workers: Arc::new(StdMutex::new(HashMap::new())),
            live_profile_epochs: Arc::new(StdRwLock::new(HashMap::new())),
            global_process_count: global_process_count.clone(),
            _global_viewer_count: Arc::new(AtomicUsize::new(0)),
            _global_raw_cdp_count: Arc::new(AtomicUsize::new(0)),
            _cancellation_token: cancellation_token,
            _simulated_reset_kill_failure: Arc::new(AtomicBool::new(false)),
            _simulated_reset_delete_failure: Arc::new(AtomicBool::new(false)),
            _simulated_reset_delay_ms: Arc::new(AtomicU64::new(0)),
            _prior_tree_settle_ms: Arc::new(AtomicU64::new(
                DEFAULT_PRIOR_TREE_SETTLE.as_millis() as u64
            )),
            profile_faults: Arc::new(ProfileFaults::default()),
            _test_mock_handle: Arc::new(parking_lot::RwLock::new(None)),
            native: NativeHandles {
                observers: Arc::new(StdMutex::new(HashMap::new())),
                containments: Arc::new(StdMutex::new(HashMap::new())),
                live_incarnations: Arc::new(StdRwLock::new(HashMap::new())),
                global_process_count: global_process_count.clone(),
                download_bindings: Arc::new(StdMutex::new(HashMap::new())),
                sinks: NativeSinks {
                    events: events_tx,
                    pump: pump_tx,
                },
            },
            max_targets,
            pump_rx: Arc::new(StdMutex::new(Some(pump_rx))),
            next_observer_token: Arc::new(AtomicU64::new(1)),
            native_faults: Arc::new(NativeFaults::default()),
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

    /// Profile handle whose durable steps run through this manager's fault injector.
    fn profile_for(&self, subject: &str, is_dev: bool) -> Result<ManagedProfile, ProfileError> {
        Ok(ManagedProfile::new(&self.profile_root, subject, is_dev)?
            .with_faults(self.profile_faults.clone()))
    }

    /// Proves the persisted prior browser tree absent before the profile is reopened. The
    /// caller holds the profile lock. Any failure to prove absence (ambiguous ownership, a
    /// survivor, an unreadable /proc) is `CleanupPending`: no launch, nothing signalled that
    /// was not verified.
    async fn reconcile_prior_tree(
        &self,
        profile: &ManagedProfile,
        identity: &ContainmentIdentity,
    ) -> Result<(), ManagerError> {
        if identity.is_empty() {
            return Ok(());
        }
        let settle = Duration::from_millis(self._prior_tree_settle_ms.load(Ordering::SeqCst));
        reap_prior_tree(
            identity,
            profile.user_data_dir(),
            ReapTimings {
                settle,
                term_grace: PRIOR_TREE_TERM_GRACE,
                proof: PRIOR_TREE_PROOF,
            },
        )
        .await
        .map_err(|e| {
            ManagerError::CleanupPending(format!(
                "prior browser process tree not proven absent; relaunch refused: {e}"
            ))
        })
    }

    /// Non-async check of live profile epoch & active reset fencing for atomic selection handoff.
    pub fn is_profile_epoch_live_sync(
        &self,
        subject: &str,
        is_dev: bool,
        expected_epoch: u64,
    ) -> bool {
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

        let profile = self.profile_for(subject, is_dev)?;
        // Read-only: a never-initialized profile starts at epoch 1; its metadata is written
        // only under the profile flock when a browser is first launched or reset.
        let profile_epoch = profile
            .load_metadata()?
            .map_or(1, |meta| meta.profile_epoch);
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
            profile_epoch,
            active_viewers: 0,
            active_raw_cdp: 0,
            _held_lock: None,
            deletion_worker: None,
        }));

        self.live_profile_epochs
            .write()
            .unwrap()
            .insert(key.clone(), profile_epoch);
        map.insert(key, inst.clone());
        Ok(inst)
    }

    /// Evaluates domain capabilities for a principal without spawning Chromium.
    pub async fn capabilities(&self, subject: &str, is_dev: bool) -> BrowserCapabilitiesDto {
        let profile = match self.profile_for(subject, is_dev) {
            Ok(p) => p,
            Err(e) => {
                let mut caps = evaluate_capabilities(&self.config, false, 1);
                caps.available = false;
                caps.unavailable_reason = Some(format!("failed to resolve profile: {e}"));
                return caps;
            }
        };

        let tombstone = profile.load_tombstone().ok().flatten();
        let meta = profile.load_metadata().ok().flatten();
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
            return Err(ManagerError::Disabled(
                "browser host is disabled in configuration".to_string(),
            ));
        }

        if let Some(mock) = self._test_mock_handle.read().clone() {
            return Ok(mock);
        }
        if let Ok(profile) = self.profile_for(subject, is_dev) {
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
                let has_worker = self.active_reset_workers.lock().unwrap().contains_key(&key);
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
        let key = Self::principal_key(subject, is_dev);
        // Reconnect: check if existing process is running and alive
        if inst.state == InstanceLifecycleState::Running {
            let alive = inst.process.as_mut().map(|p| p.try_is_alive());
            match alive {
                Some(true) => {
                    let handle = BrowserInstanceHandle {
                        subject: subject.to_string(),
                        is_dev,
                        pid: inst.process.as_ref().map(|p| p.pid()).unwrap_or_default(),
                        ws_endpoint: inst
                            .process
                            .as_ref()
                            .map(|p| p.ws_endpoint().to_string())
                            .unwrap_or_default(),
                        browser_incarnation: inst.browser_incarnation.clone().unwrap_or_default(),
                        profile_epoch: inst.profile_epoch,
                        user_data_dir: inst.profile.user_data_dir().to_path_buf(),
                    };
                    // Fail closed: a running browser whose native targets are not observed
                    // cannot enforce admission or report loss.
                    self.ensure_observer(&key, &inst_arc, &handle, false)
                        .await?;
                    return Ok(handle);
                }
                Some(false) => {
                    warn!("managed browser process died unexpectedly, terminating group and retiring native targets");
                    self.native
                        .reap_dead_instance(&key, &mut inst, true)
                        .await?;
                }
                None => {}
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

        // Reconcile the persisted containment identity UNDER the lock and BEFORE the profile is
        // reopened: the prior tree (a SIGKILLed supervisor's browser and descendants, possibly
        // still inside its death watcher's TERM-to-KILL gap) must be proven absent first.
        let abort_start = |inst: &mut InnerInstance| {
            self.global_process_count.fetch_sub(1, Ordering::SeqCst);
            inst.state = InstanceLifecycleState::Dormant;
        };
        match inst.profile.load_tombstone() {
            Ok(None) => {}
            Ok(Some(_)) => {
                abort_start(&mut inst);
                return Err(ManagerError::CleanupPending(
                    "cannot start browser while profile reset cleanup is pending".to_string(),
                ));
            }
            Err(e) => {
                abort_start(&mut inst);
                return Err(e.into());
            }
        }
        let mut meta = match inst.profile.load_or_init_metadata_locked(&lock) {
            Ok(m) => m,
            Err(e) => {
                abort_start(&mut inst);
                return Err(e.into());
            }
        };
        if let Err(e) = self
            .reconcile_prior_tree(&inst.profile, &meta.containment)
            .await
        {
            abort_start(&mut inst);
            return Err(e);
        }
        // Durable pre-launch intent: the token every process of the coming launch will carry is
        // synced BEFORE spawn, so a crash between spawn and the identity write stays verifiable.
        let launch_token = uuid::Uuid::new_v4().simple().to_string();
        meta.containment = ContainmentIdentity::launch_intent(launch_token.clone());
        meta.browser_incarnation = None;
        meta.updated_at_unix_ms = now_unix_ms();
        if let Err(e) = inst.profile.save_metadata(&meta) {
            abort_start(&mut inst);
            return Err(e.into());
        }

        // Ensure user-data directory exists with 0700 permissions
        if let Err(e) = inst.profile.ensure_user_data_dir() {
            abort_start(&mut inst);
            return Err(e.into());
        }
        let mut launch_config =
            BrowserLaunchConfig::new(inst.profile.user_data_dir().to_path_buf());
        launch_config.executable_path = self.config.executable_path.clone();
        launch_config.headless = true;
        launch_config.launch_token = Some(launch_token);

        info!(subject, is_dev, "launching supervised browser process");
        let process_res =
            timeout(DEFAULT_START_TIMEOUT, BrowserProcess::launch(launch_config)).await;
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
                return Err(ManagerError::Timeout(
                    "browser process failed to start within 15s".to_string(),
                ));
            }
        };

        let incarnation = uuid::Uuid::new_v4().to_string();
        let pid = process.pid();
        let ws_endpoint = process.ws_endpoint().to_string();

        meta.browser_incarnation = Some(incarnation.clone());
        meta.containment = process.identity();
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

        self.native
            .live_incarnations
            .write()
            .unwrap()
            .insert(key.clone(), incarnation.clone());
        let handle = BrowserInstanceHandle {
            subject: subject.to_string(),
            is_dev,
            pid,
            ws_endpoint,
            browser_incarnation: incarnation,
            profile_epoch: inst.profile_epoch,
            user_data_dir: inst.profile.user_data_dir().to_path_buf(),
        };
        // The startup blank page is closed and discovery/auto-attach enabled before the first
        // caller can use the instance; without an observer the launch fails closed.
        if let Err(err) = self.ensure_observer(&key, &inst_arc, &handle, true).await {
            self.native.live_incarnations.write().unwrap().remove(&key);
            if let Some(mut proc) = inst.process.take() {
                let _ = proc.terminate().await;
            }
            self.global_process_count.fetch_sub(1, Ordering::SeqCst);
            inst.state = InstanceLifecycleState::Dormant;
            inst._held_lock = None;
            return Err(err);
        }
        Ok(handle)
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
        let stop_key = Self::principal_key(subject, is_dev);
        let stop_incarnation = inst.browser_incarnation.clone();
        self.native.detach_observer(&stop_key);

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
                    error!(
                        subject,
                        is_dev, "timed out terminating browser process after 10s"
                    );
                    return Err(ManagerError::Timeout(
                        "termination timed out after 10s".to_string(),
                    ));
                }
            }
        }

        inst.active_viewers = 0;
        inst.active_raw_cdp = 0;
        inst._held_lock = None;
        inst.state = InstanceLifecycleState::Dormant;
        self.native
            .live_incarnations
            .write()
            .unwrap()
            .remove(&stop_key);
        if let Some(incarnation) = stop_incarnation {
            self.native
                .retire_incarnation(&incarnation, "browser instance was stopped")
                .await;
        }

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
        let Ok(profile) = self.profile_for(subject, is_dev) else {
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
        let Ok(profile) = self.profile_for(subject, is_dev) else {
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
        let Ok(profile) = self.profile_for(subject, is_dev) else {
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
                        Ok(ResetOutcome::Completed {
                            operation_id,
                            new_profile_epoch,
                        }) => {
                            return Ok(ResetStatus::Completed {
                                operation_id,
                                profile_epoch: new_profile_epoch,
                            });
                        }
                        Ok(ResetOutcome::CleanupPending {
                            operation_id,
                            profile_epoch,
                            reason,
                        }) => {
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

        let profile = self.profile_for(subject, is_dev)?;
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
                // A failed completion whose tombstone removal is not durably confirmed keeps
                // this manager CleanupPending: GET must agree with the POST outcome.
                let key = Self::principal_key(subject, is_dev);
                let confirmation_pending = match self.instances.lock().await.get(&key).cloned() {
                    Some(inst_arc) => inst_arc
                        .try_lock()
                        .map(|inst| inst.state == InstanceLifecycleState::CleanupPending)
                        // A busy instance (worker still finishing) is not yet confirmed either.
                        .unwrap_or(true),
                    None => false,
                };
                if confirmation_pending {
                    return Ok(ResetStatus::CleanupPending {
                        operation_id: operation_id.to_string(),
                        profile_epoch: meta.profile_epoch,
                        reason: Some(
                            "reset completion is not yet durably confirmed; retry the operation"
                                .to_string(),
                        ),
                    });
                }
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
        // A lock this call acquired for a dormant profile is not retained by an early return.
        let release_unused_lock = |inst: &mut InnerInstance| {
            if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                inst._held_lock = None;
            }
        };

        // Recheck live Admin authorization under the principal lock BEFORE initiating/resuming any destructive intent.
        if let Some(recheck) = &hooks.recheck_admin {
            if !recheck().await {
                release_unused_lock(&mut inst);
                return Err(ManagerError::PermissionDenied(
                    "live admin authorization revoked before reset intent".to_string(),
                ));
            }
        }

        let mut meta = match inst
            ._held_lock
            .as_ref()
            .ok_or_else(|| {
                super::profile::ProfileError::LockFailed(
                    "profile lock is not held for reset".to_string(),
                )
            })
            .and_then(|lock| inst.profile.load_or_init_metadata_locked(lock))
        {
            Ok(meta) => meta,
            Err(e) => {
                release_unused_lock(&mut inst);
                return Err(e.into());
            }
        };
        let existing_tombstone = match inst.profile.load_tombstone() {
            Ok(tombstone) => tombstone,
            Err(e) => {
                release_unused_lock(&mut inst);
                return Err(e.into());
            }
        };

        // The completed marker is sufficient ONLY when no tombstone remains: a surviving
        // tombstone means the completion never finished and is resumed below.
        if meta.last_reset_operation_id.as_deref() == Some(operation_id)
            && existing_tombstone.is_none()
        {
            info!(
                operation_id,
                "idempotent query of already-completed profile reset"
            );
            // The tombstone removal may have been left unsynced by a failed earlier attempt:
            // never acknowledge it before the directory is durable.
            if let Err(e) = inst.profile.sync_principal_dir() {
                release_unused_lock(&mut inst);
                return Err(e.into());
            }
            if inst.state == InstanceLifecycleState::CleanupPending && inst.process.is_none() {
                inst.state = InstanceLifecycleState::Dormant;
                inst._held_lock = None;
            }
            release_unused_lock(&mut inst);
            return Ok(ResetOutcome::Completed {
                operation_id: operation_id.to_string(),
                new_profile_epoch: meta.profile_epoch,
            });
        }

        // Intent persistence failures leave a (possibly visible) tombstone as the fence.
        let fail_intent = |inst: &mut InnerInstance, err: ProfileError| {
            if inst.profile.reset_file().exists() {
                inst.state = InstanceLifecycleState::CleanupPending;
            } else if !had_held_lock && inst.state == InstanceLifecycleState::Dormant {
                inst._held_lock = None;
            }
            ManagerError::from(err)
        };

        // Check existing tombstone or initialize new reset intent
        let (mut tombstone, new_epoch, finalize_only) = if let Some(existing) = existing_tombstone {
            if existing.operation_id == operation_id {
                info!(operation_id, "resuming incomplete/failed profile reset");
                let epoch = existing.target_profile_epoch;
                // The marker is only written after deletion, recreation and containment proof:
                // when it is present just the tombstone removal remains.
                let finalize_only = meta.last_reset_operation_id.as_deref() == Some(operation_id);
                if meta.profile_epoch != epoch {
                    meta.profile_epoch = epoch;
                    meta.browser_incarnation = None;
                    meta.updated_at_unix_ms = now_unix_ms();
                    if let Err(e) = inst.profile.save_metadata(&meta) {
                        return Err(fail_intent(&mut inst, e));
                    }
                }
                inst.profile_epoch = epoch;
                (existing, epoch, finalize_only)
            } else {
                release_unused_lock(&mut inst);
                return Err(ManagerError::CleanupPending(format!(
                    "profile has active tombstone from operation {}",
                    existing.operation_id
                )));
            }
        } else {
            // Validate expected profile epoch
            if meta.profile_epoch != expected_profile_epoch {
                release_unused_lock(&mut inst);
                return Err(ManagerError::StaleEpoch {
                    expected: expected_profile_epoch,
                    actual: meta.profile_epoch,
                });
            }

            let target_epoch = meta.profile_epoch.saturating_add(1);
            info!(
                subject,
                is_dev, operation_id, target_epoch, "initiating durable browser profile reset"
            );

            let tombstone = ResetTombstone {
                operation_id: operation_id.to_string(),
                target_profile_epoch: target_epoch,
                stage: ResetStage::Initiated,
                created_at_unix_ms: now_unix_ms(),
                updated_at_unix_ms: now_unix_ms(),
                error: None,
                containment: meta.containment.clone(),
            };
            // Intent and epoch are synced (file, rename, directory) before they are accepted.
            if let Err(e) = inst.profile.save_tombstone(&tombstone) {
                return Err(fail_intent(&mut inst, e));
            }

            meta.profile_epoch = target_epoch;
            meta.browser_incarnation = None;
            meta.updated_at_unix_ms = now_unix_ms();
            if let Err(e) = inst.profile.save_metadata(&meta) {
                return Err(fail_intent(&mut inst, e));
            }
            inst.profile_epoch = target_epoch;
            (tombstone, target_epoch, false)
        };
        inst.state = InstanceLifecycleState::Resetting;
        inst.active_viewers = 0;
        inst.active_raw_cdp = 0;

        // Update fast epoch map synchronously and spawn worker immediately with ZERO .await gaps
        // after durable tombstone persistence so caller cancellation cannot orphan intent.
        self.live_profile_epochs
            .write()
            .unwrap()
            .insert(key.clone(), new_epoch);
        // Native observation ends synchronously with the epoch bump: no late create can pass the
        // incarnation liveness check, and the observer never mistakes the coming termination for
        // a crash.
        let reset_incarnation = inst.browser_incarnation.clone();
        self.native.detach_observer(&key);
        self.native.live_incarnations.write().unwrap().remove(&key);

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
        let native = self.native.clone();
        let kill_fail_flag = self._simulated_reset_kill_failure.clone();
        let delete_fail_flag = self._simulated_reset_delete_failure.clone();
        let delay_ms_flag = self._simulated_reset_delay_ms.clone();
        let active_workers = self.active_reset_workers.clone();
        let subject_owned = subject.to_string();
        let op_owned = operation_id.to_string();
        let sync_fence = hooks.sync_fence;
        let async_teardown = hooks.async_teardown;
        // Persisted containment of the prior tree: the tombstone's copy, else the metadata's.
        let prior_identity = if tombstone.containment.is_empty() {
            meta.containment.clone()
        } else {
            tombstone.containment.clone()
        };
        let settle = Duration::from_millis(self._prior_tree_settle_ms.load(Ordering::SeqCst));

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

            // Every early `return Err(reason)` leaves the tombstone in place and the profile
            // CleanupPending; completion is claimed only after the last durable barrier.
            let steps: Result<(), String> = async {
                if !finalize_only {
                    persist_stage(&inst.profile, &mut tombstone, ResetStage::Terminating)?;

                    if kill_fail_flag.load(Ordering::SeqCst) {
                        return Err("simulated process kill failure".to_string());
                    }

                    if let Some(mut proc) = inst.process.take() {
                        let term_res = timeout(DEFAULT_TERMINATE_TIMEOUT, proc.terminate()).await;
                        global_process_count.fetch_sub(1, Ordering::SeqCst);
                        match term_res {
                            Ok(Ok(())) => {}
                            Ok(Err(e)) => return Err(format!("process termination failed: {e}")),
                            Err(_) => {
                                return Err("process termination timed out after 10s".to_string())
                            }
                        }
                    } else if !prior_identity.is_empty() {
                        // No live handle: reconcile the persisted identity. Only a verified
                        // owner is signalled; ambiguity or survival keeps CleanupPending.
                        reap_prior_tree(
                            &prior_identity,
                            inst.profile.user_data_dir(),
                            ReapTimings {
                                settle,
                                term_grace: PRIOR_TREE_TERM_GRACE,
                                proof: PRIOR_TREE_PROOF,
                            },
                        )
                        .await
                        .map_err(|e| format!("prior browser tree not proven absent: {e}"))?;
                    }

                    if let Some(incarnation) = &reset_incarnation {
                        native
                            .retire_incarnation(incarnation, "browser profile reset")
                            .await;
                    }

                    // All descendants are proven absent: credential deletion may begin.
                    persist_stage(&inst.profile, &mut tombstone, ResetStage::DeletingUserData)?;

                    if delete_fail_flag.load(Ordering::SeqCst) {
                        return Err("simulated user-data deletion failure".to_string());
                    }

                    let mut handle = inst.deletion_worker.take().unwrap_or_else(|| {
                        let profile_clone = inst.profile.clone();
                        tokio::task::spawn_blocking(move || profile_clone.delete_user_data())
                    });
                    match timeout(DEFAULT_DELETE_TIMEOUT, &mut handle).await {
                        Ok(Ok(Ok(()))) => {}
                        Ok(Ok(Err(e))) => return Err(format!("user-data deletion failed: {e}")),
                        Ok(Err(join_err)) => {
                            return Err(format!("user-data deletion task failed: {join_err}"))
                        }
                        Err(_) => {
                            inst.deletion_worker = Some(handle);
                            return Err("user-data deletion timed out after 10s".to_string());
                        }
                    }

                    persist_stage(
                        &inst.profile,
                        &mut tombstone,
                        ResetStage::RecreatingUserData,
                    )?;
                    inst.profile
                        .recreate_user_data()
                        .map_err(|e| format!("failed to recreate user-data dir: {e}"))?;
                }

                // Completion marker (synced), then tombstone removal (synced): the marker is
                // never visible without the deletion it vouches for, and the tombstone is
                // never removed before the marker is durable.
                meta.last_reset_operation_id = Some(op_owned.clone());
                meta.containment = ContainmentIdentity::default();
                meta.browser_incarnation = None;
                meta.updated_at_unix_ms = now_unix_ms();
                inst.profile
                    .save_metadata(&meta)
                    .map_err(|e| format!("failed to persist reset completion marker: {e}"))?;
                inst.profile
                    .clear_tombstone()
                    .map_err(|e| format!("failed to remove reset tombstone: {e}"))?;
                Ok(())
            }
            .await;

            match steps {
                Ok(()) => {
                    inst.state = InstanceLifecycleState::Dormant;
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
                }
                Err(reason) => {
                    // Record the failure only while the tombstone still exists: a removal whose
                    // directory sync failed must not be undone by resurrecting the file.
                    if inst.profile.reset_file().exists() {
                        tombstone.stage = ResetStage::Failed;
                        tombstone.error = Some(reason.clone());
                        tombstone.updated_at_unix_ms = now_unix_ms();
                        if let Err(e) = inst.profile.save_tombstone(&tombstone) {
                            warn!(error = %e, "failed to persist reset failure detail; tombstone remains the fence");
                        }
                    }
                    inst.state = InstanceLifecycleState::CleanupPending;
                    finish_worker(Ok(ResetOutcome::CleanupPending {
                        operation_id: op_owned,
                        profile_epoch: new_epoch,
                        reason,
                    }))
                    .await;
                }
            }
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

    /// Takes ownership of containing a whole browser incarnation whose children cannot be
    /// policed or stopped (a worker survived its close, a page could not be retired). Accepts
    /// the obligation synchronously and runs it on a manager-tracked task, so it is independent
    /// of the producer/interceptor that raised it: the verified process tree is terminated
    /// through the same path as a dead browser (a failed termination persists the tombstone
    /// fence and `CleanupPending`), and every session of the incarnation is retired together.
    /// Idempotent per incarnation; `shutdown_all` joins the tasks.
    pub fn contain_incarnation(
        &self,
        subject: &str,
        is_dev: bool,
        incarnation: &str,
        reason: &str,
    ) {
        let key = Self::principal_key(subject, is_dev);
        let mut tasks = self.native.containments.lock().unwrap();
        tasks.retain(|_, task| !task.is_finished());
        let slot = (key.clone(), incarnation.to_string());
        if tasks.contains_key(&slot) {
            return;
        }
        warn!(
            subject,
            is_dev, incarnation, reason, "containing browser incarnation"
        );
        let instances = self.instances.clone();
        let native = self.native.clone();
        let incarnation = incarnation.to_string();
        let task = tokio::spawn(async move {
            let inst_arc = instances.lock().await.get(&key).cloned();
            let Some(inst_arc) = inst_arc else { return };
            let mut inst = inst_arc.lock().await;
            if inst.browser_incarnation.as_deref() != Some(incarnation.as_str())
                || inst.process.is_none()
            {
                return;
            }
            if let Err(err) = native.reap_dead_instance(&key, &mut inst, true).await {
                warn!(error = %err, "containing the browser incarnation left cleanup pending");
            }
        });
        tasks.insert(slot, task);
    }

    /// Terminate all managed browser instances during server shutdown.
    pub async fn shutdown_all(&self) {
        let containments: Vec<JoinHandle<()>> = self
            .native
            .containments
            .lock()
            .unwrap()
            .drain()
            .map(|(_, task)| task)
            .collect();
        for task in containments {
            let _ = timeout(DEFAULT_TERMINATE_TIMEOUT, task).await;
        }
        info!("shutting down all managed browser host instances");
        let observers: Vec<ObserverEntry> = self
            .native
            .observers
            .lock()
            .unwrap()
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in observers {
            entry.task.abort();
        }
        self.native.live_incarnations.write().unwrap().clear();
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
                        containment: proc.identity(),
                    };
                    if let Err(e) = inst.profile.save_tombstone(&tombstone) {
                        warn!(error = %e, "shutdown tombstone not persisted; persisted process identity remains the fence");
                    }
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
                        containment: proc.identity(),
                    };
                    if let Err(e) = inst.profile.save_tombstone(&tombstone) {
                        warn!(error = %e, "shutdown tombstone not persisted; persisted process identity remains the fence");
                    }
                    inst.state = InstanceLifecycleState::CleanupPending;
                } else {
                    inst.state = InstanceLifecycleState::Dormant;
                }
            }
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

    // -----------------------------------------------------------------------------------------
    // Native target ownership: one observer per live browser incarnation.
    // -----------------------------------------------------------------------------------------

    /// Configured logical target cap shared by REST, popup and raw-created pages.
    pub fn max_targets(&self) -> usize {
        self.max_targets
    }

    /// Admitted-popup / blocked / lost notifications for the OS projection.
    pub fn subscribe_native_events(&self) -> broadcast::Receiver<NativeTargetEvent> {
        self.native.sinks.events.subscribe()
    }

    /// Claims the single consumer end of the request channel through which the observer asks the
    /// API layer to adopt popups (policy install before resume) and to clean selection state of
    /// retired sessions. Returns `None` when already claimed.
    pub fn claim_native_pump(&self) -> Option<mpsc::Receiver<NativePumpRequest>> {
        self.pump_rx.lock().unwrap().take()
    }

    /// Synchronous liveness fence for publication: the profile epoch is current, no reset is
    /// active and the browser incarnation the caller captured is still the live one.
    pub fn is_instance_live_sync(
        &self,
        subject: &str,
        is_dev: bool,
        profile_epoch: u64,
        incarnation: &str,
    ) -> bool {
        if !self.is_profile_epoch_live_sync(subject, is_dev, profile_epoch) {
            return false;
        }
        let key = Self::principal_key(subject, is_dev);
        if let Some(mock) = self._test_mock_handle.read().as_ref() {
            if mock.browser_incarnation == incarnation {
                return self.is_profile_epoch_live_sync(subject, is_dev, profile_epoch);
            }
        }
        self.native
            .live_incarnations
            .read()
            .unwrap()
            .get(&key)
            .is_some_and(|live| live == incarnation)
    }

    /// Returns the Phase 02 ownership snapshot source for DevTools target/session verification.
    pub fn devtools_ownership_source(
        &self,
        subject: &str,
        is_dev: bool,
        profile_epoch: u64,
        browser_incarnation: &str,
    ) -> DevToolsOwnershipSource {
        if !self.is_instance_live_sync(subject, is_dev, profile_epoch, browser_incarnation) {
            return DevToolsOwnershipSource::Unavailable;
        }
        let key = Self::principal_key(subject, is_dev);
        if let Some(mock) = self._test_mock_handle.read().as_ref() {
            if mock.subject == subject
                && mock.is_dev == is_dev
                && mock.profile_epoch == profile_epoch
                && mock.browser_incarnation == browser_incarnation
            {
                return DevToolsOwnershipSource::MockUnobserved;
            }
            return DevToolsOwnershipSource::Unavailable;
        }
        match self.native.live_control(&key) {
            Some(control)
                if control.profile_epoch == profile_epoch
                    && control.browser_incarnation == browser_incarnation
                    && !control.is_closed() =>
            {
                DevToolsOwnershipSource::LiveFence(DevToolsOwnershipFence {
                    inner: Arc::clone(&control.ownership_fence),
                })
            }
            _ => DevToolsOwnershipSource::Unavailable,
        }
    }

    /// Starts (or reuses) the observer of a live instance. The caller holds the instance lock.
    async fn ensure_observer(
        &self,
        key: &str,
        inst_arc: &Arc<Mutex<InnerInstance>>,
        handle: &BrowserInstanceHandle,
        initial: bool,
    ) -> Result<Arc<NativeControl>, ManagerError> {
        if let Some(control) = self.native.live_control(key) {
            if control.browser_incarnation == handle.browser_incarnation {
                return Ok(control);
            }
        }
        self.native.detach_observer(key);
        let token = self.next_observer_token.fetch_add(1, Ordering::SeqCst);
        let shared = ObserverShared {
            key: key.to_string(),
            subject: handle.subject.clone(),
            is_dev: handle.is_dev,
            max_targets: self.max_targets,
            request_policy: Arc::new(
                NetworkPolicy::from_config(&self.config, handle.is_dev).map_err(|err| {
                    ManagerError::Internal(format!("invalid browser request policy: {err}"))
                })?,
            ),
            inst: inst_arc.clone(),
            native: self.native.clone(),
            faults: self.native_faults.clone(),
            downloads: self
                .native
                .download_bindings_for(&handle.browser_incarnation),
            token,
        };
        let (control, task) = start_observer(shared, handle, initial).await?;
        self.native.observers.lock().unwrap().insert(
            key.to_string(),
            ObserverEntry {
                control: control.clone(),
                task,
                token,
            },
        );
        Ok(control)
    }

    /// Control handle of the principal's live browser. `NotRunning` is positive proof that no
    /// native page of this manager exists (no live process); `Unavailable` is ambiguous.
    pub async fn native_control(
        &self,
        subject: &str,
        is_dev: bool,
    ) -> Result<Arc<NativeControl>, NativeControlError> {
        let key = Self::principal_key(subject, is_dev);
        let mock = self._test_mock_handle.read().clone();
        if let Some(mock) = mock {
            return NativeControl::connect_unobserved(&mock, self.native_faults.clone())
                .await
                .map(Arc::new)
                .map_err(|err| NativeControlError::Unavailable(err.to_string()));
        }
        if let Some(control) = self.native.live_control(&key) {
            return Ok(control);
        }
        let Some(inst_arc) = self.instances.lock().await.get(&key).cloned() else {
            return Err(NativeControlError::NotRunning);
        };
        let mut inst = match timeout(NATIVE_CONTROL_LOCK_TIMEOUT, inst_arc.lock()).await {
            Ok(guard) => guard,
            Err(_) => {
                return Err(NativeControlError::Unavailable(
                    "browser instance is busy".to_string(),
                ))
            }
        };
        if inst.state != InstanceLifecycleState::Running {
            return Err(NativeControlError::NotRunning);
        }
        match inst.process.as_mut().map(|p| p.try_is_alive()) {
            None => return Err(NativeControlError::NotRunning),
            Some(false) => {
                // A dead browser process proves every native page of its incarnation is gone.
                return match self.native.reap_dead_instance(&key, &mut inst, true).await {
                    Ok(()) => Err(NativeControlError::NotRunning),
                    Err(err) => Err(NativeControlError::Unavailable(err.to_string())),
                };
            }
            Some(true) => {}
        }
        let handle = BrowserInstanceHandle {
            subject: subject.to_string(),
            is_dev,
            pid: inst.process.as_ref().map(|p| p.pid()).unwrap_or_default(),
            ws_endpoint: inst
                .process
                .as_ref()
                .map(|p| p.ws_endpoint().to_string())
                .unwrap_or_default(),
            browser_incarnation: inst.browser_incarnation.clone().unwrap_or_default(),
            profile_epoch: inst.profile_epoch,
            user_data_dir: inst.profile.user_data_dir().to_path_buf(),
        };
        self.ensure_observer(&key, &inst_arc, &handle, false)
            .await
            .map_err(|err| NativeControlError::Unavailable(err.to_string()))
    }
}

// ---------------------------------------------------------------------------------------------
// Native target ownership internals
// ---------------------------------------------------------------------------------------------

const NATIVE_EVENT_SLOTS: usize = 64;
const NATIVE_PUMP_SLOTS: usize = 64;
const NATIVE_CONTROL_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const OBSERVER_INIT_TIMEOUT: Duration = Duration::from_secs(10);
const OBSERVER_RECONNECT_ATTEMPTS: usize = 3;
const OBSERVER_RECONNECT_DELAY: Duration = Duration::from_millis(250);
const POPUP_ADOPTION_TIMEOUT: Duration = Duration::from_secs(8);
const PENDING_CLOSE_SWEEP: Duration = Duration::from_millis(500);
const PENDING_CLOSE_GRACE: Duration = Duration::from_secs(1);
const CLOSE_VERIFY_ATTEMPTS: usize = 30;
const CLOSE_VERIFY_INTERVAL: Duration = Duration::from_millis(100);
const TARGET_ABSENT_VERIFY_ATTEMPTS: usize = 10;
const TARGET_ABSENT_VERIFY_INTERVAL: Duration = Duration::from_millis(25);
const MAX_REJECTED_TARGETS: usize = 256;
const MAX_OBSERVER_CHILD_FRAME_ROOTS: usize = 64;
/// Shared across all ordered frame-attachment records; overflow retires the observer.
const MAX_OBSERVER_FRAME_ATTACHMENTS: usize = 4096;
const MAX_PENDING_FRAME_TREE_RETRIES: usize = 64;
/// Consecutive parent-session swap re-requests for one child-root chain. Retries and page-driven requests start fresh; non-swap topology changes reseed without a budget.
const MAX_CHILD_ROOT_RESEEDS: u8 = 4;
/// Detaches retained per in-flight snapshot; overflow fails closed.
const MAX_PENDING_FRAME_DETACHES: usize = 64;
const FRAME_TREE_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAX_TARGET_ID_LEN: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevToolsRootFenceStatus {
    Available { generation: u64, epoch: u64 },
    Pending,
    Retired,
}

#[derive(Clone)]
pub struct DevToolsOwnershipFence {
    inner: Arc<OwnershipFence>,
}

impl DevToolsOwnershipFence {
    pub fn subscribe_state(&self) -> tokio::sync::watch::Receiver<u64> {
        self.inner.subscribe_state()
    }

    pub fn root_snapshot_status(
        &self,
        principal: &str,
        is_dev: bool,
        browser_incarnation: &str,
        profile_epoch: u64,
        logical_session_id: &str,
        native_target_id: &str,
    ) -> DevToolsRootFenceStatus {
        match self.inner.root_snapshot_status(
            principal,
            is_dev,
            browser_incarnation,
            profile_epoch,
            logical_session_id,
            native_target_id,
        ) {
            RootFenceStatus::Available { generation, epoch } => {
                DevToolsRootFenceStatus::Available { generation, epoch }
            }
            RootFenceStatus::Pending => DevToolsRootFenceStatus::Pending,
            RootFenceStatus::Retired => DevToolsRootFenceStatus::Retired,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn owns_child_target(
        &self,
        principal: &str,
        is_dev: bool,
        browser_incarnation: &str,
        profile_epoch: u64,
        logical_session_id: &str,
        native_target_id: &str,
        child_target_id: &str,
    ) -> Option<(u64, u64)> {
        self.inner.owns_child_target(
            principal,
            is_dev,
            browser_incarnation,
            profile_epoch,
            logical_session_id,
            native_target_id,
            child_target_id,
        )
    }

    pub fn is_generation_epoch_live(&self, generation: u64, epoch: u64) -> bool {
        self.inner.is_generation_epoch_live(generation, epoch)
    }
}

#[derive(Clone)]
pub enum DevToolsOwnershipSource {
    MockUnobserved,
    LiveFence(DevToolsOwnershipFence),
    Unavailable,
}

/// Notifications of native target decisions, for the OS projection.
#[allow(clippy::large_enum_variant)] // short-lived broadcast payload carrying the session DTO
#[derive(Debug, Clone)]
pub enum NativeTargetEvent {
    /// A `window.open` popup passed the shared cap and policy install and is now a session.
    PopupAdmitted {
        parent_session_id: String,
        session: BrowserSessionDto,
    },
    /// A popup was refused (cap reached or policy adoption failed) and its page closed.
    PopupBlocked {
        parent_session_id: String,
        reason: String,
    },
    /// An unmanaged page (raw CDP create) exceeded the shared cap and was closed.
    TargetBlocked {
        browser_incarnation: String,
        target_id: String,
        reason: String,
    },
    /// A running session's native page is gone (destroyed, crash, browser stopped). No DOM
    /// continuity is implied: a later session is a new page.
    SessionLost {
        browser_session_id: String,
        browser_incarnation: String,
        reason: String,
    },
}

/// Requests from the observer to the API layer, which owns the application state needed to
/// build producers and clean selection artifacts.
pub enum NativePumpRequest {
    /// Install the request policy on a paused popup, publish it, and reply when it may resume.
    AdoptPopup(PopupAdoption),
    /// Sessions left the live set; clean the state that needs `AppState`.
    SessionsRetired(Vec<String>),
}

pub struct PopupAdoption {
    pub session_id: String,
    pub principal: String,
    pub is_dev: bool,
    pub reply: oneshot::Sender<Result<BrowserSessionDto, String>>,
}

/// Fault injection for the native create/close/publication paths (tests only).
#[derive(Default)]
pub struct NativeFaults {
    /// Next N `Target.createTarget` responses are discarded after Chrome executed them.
    pub drop_create_responses: AtomicUsize,
    /// Next N creates are refused as if Chrome rejected `Target.createTarget` (no page exists).
    pub refuse_create: AtomicUsize,
    /// Next N creation-marker reconciliations fail.
    pub fail_reconcile: AtomicUsize,
    /// Next N `Target.closeTarget` attempts fail before reaching Chrome.
    pub fail_close: AtomicUsize,
    pub delay_before_reserve_ms: AtomicU64,
    pub delay_before_create_ms: AtomicU64,
    pub delay_before_commit_ms: AtomicU64,
}

impl NativeFaults {
    /// Consumes one pending injected fault of `counter`.
    pub fn take(counter: &AtomicUsize) -> bool {
        counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
    }

    pub async fn delay(ms: &AtomicU64) {
        let ms = ms.load(Ordering::SeqCst);
        if ms > 0 {
            sleep(Duration::from_millis(ms)).await;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeControlError {
    /// No live managed process: every native page is proven absent.
    NotRunning,
    /// The browser may be running but cannot be controlled right now (ambiguous).
    Unavailable(String),
}

impl fmt::Display for NativeControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRunning => write!(f, "browser is not running"),
            Self::Unavailable(msg) => write!(f, "native browser control unavailable: {msg}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeCreateError {
    /// Chrome refused the create: no page exists.
    Definitive(String),
    /// Transport failure, timeout or lost response: a page may exist.
    Ambiguous(String),
}

impl fmt::Display for NativeCreateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Definitive(msg) | Self::Ambiguous(msg) => f.write_str(msg),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeCloseOutcome {
    /// The page is proven absent from the browser's target inventory.
    Absent,
    /// Absence could not be proven; the caller keeps identity and capacity.
    Unconfirmed(String),
}

/// Control handle of one live browser incarnation, backed by the observer's browser-level CDP
/// connection. Create, reconcile and close all run through it so outcomes feed the same
/// ledger the observer maintains.
pub struct NativeControl {
    pub subject: String,
    pub is_dev: bool,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub ws_endpoint: String,
    client: Arc<CdpClient>,
    ownership_fence: Arc<OwnershipFence>,
    faults: Arc<NativeFaults>,
    /// Mock CDP endpoints (tests) have no target inventory: a response without `targetInfos`
    /// means "no pages". Never set for a real browser.
    inventory_optional: bool,
    cached_ua_params: tokio::sync::Mutex<Option<Value>>,
}

impl NativeControl {
    /// Control handle straight on a CDP endpoint without an observer: used only for the
    /// `_test_mock_handle` seam, where no manager-owned process exists.
    async fn connect_unobserved(
        handle: &BrowserInstanceHandle,
        faults: Arc<NativeFaults>,
    ) -> Result<Self, CdpError> {
        Ok(Self {
            subject: handle.subject.clone(),
            is_dev: handle.is_dev,
            browser_incarnation: handle.browser_incarnation.clone(),
            profile_epoch: handle.profile_epoch,
            ws_endpoint: handle.ws_endpoint.clone(),
            client: CdpClient::connect(&handle.ws_endpoint).await?,
            ownership_fence: Arc::new(OwnershipFence::new()),
            faults,
            inventory_optional: true,
            cached_ua_params: tokio::sync::Mutex::new(None),
        })
    }

    async fn ua_override_params(&self) -> Value {
        if let Some(cached) = self.cached_ua_params.lock().await.clone() {
            return cached;
        }
        let version = self
            .client
            .send_command("Browser.getVersion", None, None)
            .await
            .ok();
        let params =
            super::stealth::ChromeIdentity::from_get_version(version.as_ref())
                .user_agent_override_params();
        if version.is_some() {
            *self.cached_ua_params.lock().await = Some(params.clone());
        }
        params
    }

    /// Lists the browser's page targets.
    pub async fn list_pages(&self) -> Result<Vec<NativeTargetInfo>, CdpError> {
        let value = self
            .client
            .send_command("Target.getTargets", None, None)
            .await?;
        let Some(infos) = value.get("targetInfos").and_then(Value::as_array) else {
            if self.inventory_optional {
                return Ok(Vec::new());
            }
            return Err(CdpError::MalformedResponse(
                "getTargets without targetInfos".into(),
            ));
        };
        Ok(infos
            .iter()
            .filter_map(parse_target_info)
            .filter(|info| info.target_type == "page")
            .collect())
    }

    /// Creates the native page for `session_id` at the marker URL. The marker lets a lost
    /// response be reconciled later; it is replaced by the first managed navigation.
    pub async fn create_page(&self, session_id: &str) -> Result<String, NativeCreateError> {
        NativeFaults::delay(&self.faults.delay_before_create_ms).await;
        if NativeFaults::take(&self.faults.refuse_create) {
            return Err(NativeCreateError::Definitive(
                "Target.createTarget was refused".to_string(),
            ));
        }
        let result = self
            .client
            .send_command(
                "Target.createTarget",
                Some(json!({ "url": creation_marker_url(session_id) })),
                None,
            )
            .await;
        if NativeFaults::take(&self.faults.drop_create_responses) {
            return Err(NativeCreateError::Ambiguous(
                "Target.createTarget response was lost".to_string(),
            ));
        }
        match result {
            Ok(value) => value
                .get("targetId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= MAX_TARGET_ID_LEN)
                .map(str::to_string)
                .ok_or_else(|| {
                    NativeCreateError::Ambiguous(
                        "Target.createTarget response carried no targetId".to_string(),
                    )
                }),
            Err(CdpError::Protocol { message, .. }) => Err(NativeCreateError::Definitive(message)),
            Err(err) => Err(NativeCreateError::Ambiguous(err.to_string())),
        }
    }

    /// Finds the page carrying `session_id`'s creation marker. `Ok(None)` is a positive
    /// absence at the time of the inventory.
    pub async fn find_creation_page(&self, session_id: &str) -> Result<Option<String>, CdpError> {
        if NativeFaults::take(&self.faults.fail_reconcile) {
            return Err(CdpError::Transport(
                "simulated reconcile failure".to_string(),
            ));
        }
        Ok(self
            .list_pages()
            .await?
            .into_iter()
            .find(|page| parse_creation_marker(&page.url) == Some(session_id))
            .map(|page| page.target_id))
    }

    /// Closes `target_id` and verifies its absence in the target inventory. Anything short of a
    /// positive absence is `Unconfirmed`, so callers keep the session's identity, producer and
    /// capacity.
    pub async fn close_page(&self, target_id: &str) -> NativeCloseOutcome {
        if NativeFaults::take(&self.faults.fail_close) {
            return NativeCloseOutcome::Unconfirmed("simulated Target.closeTarget failure".into());
        }
        let sent = self
            .client
            .send_command(
                "Target.closeTarget",
                Some(json!({ "targetId": target_id })),
                None,
            )
            .await;
        let mut last_error = match &sent {
            Ok(value) if value.get("success").and_then(Value::as_bool) == Some(false) => {
                Some("Target.closeTarget reported success=false".to_string())
            }
            Ok(_) => None,
            Err(err) => Some(err.to_string()),
        };
        for attempt in 0..CLOSE_VERIFY_ATTEMPTS {
            match self.list_pages().await {
                Ok(pages) if pages.iter().all(|p| p.target_id != target_id) => {
                    return NativeCloseOutcome::Absent;
                }
                Ok(_) => {}
                Err(err) => last_error = Some(err.to_string()),
            }
            if attempt + 1 < CLOSE_VERIFY_ATTEMPTS {
                sleep(CLOSE_VERIFY_INTERVAL).await;
            }
        }
        NativeCloseOutcome::Unconfirmed(
            last_error.unwrap_or_else(|| "page is still listed after Target.closeTarget".into()),
        )
    }

    pub fn is_closed(&self) -> bool {
        self.client.is_closed()
    }

    /// Confirms via `Target.getTargets` that `target_id` (any target type) is no longer present.
    /// Fails closed (`false`) if the inventory cannot be read or `target_id` remains listed.
    async fn confirm_target_absent(&self, target_id: &str) -> bool {
        for attempt in 0..TARGET_ABSENT_VERIFY_ATTEMPTS {
            let Ok(value) = self
                .client
                .send_command("Target.getTargets", None, None)
                .await
            else {
                return false;
            };
            let Some(infos) = value.get("targetInfos").and_then(Value::as_array) else {
                return false;
            };
            let still_present = infos
                .iter()
                .any(|info| info.get("targetId").and_then(Value::as_str) == Some(target_id));
            if !still_present {
                return true;
            }
            if attempt + 1 < TARGET_ABSENT_VERIFY_ATTEMPTS {
                sleep(TARGET_ABSENT_VERIFY_INTERVAL).await;
            }
        }
        false
    }

    fn revoke_observer_authority(&self) {
        self.ownership_fence.retire_current();
    }
}

/// Returns true only for CDP protocol errors proving the target or flattened session was already closed.
fn is_session_or_target_gone_error(error: &CdpError) -> bool {
    match error {
        CdpError::Protocol { code, message } => {
            let msg = message.to_ascii_lowercase();
            *code == -32001
                || msg.contains("session with given id not found")
                || msg.contains("no target with given id found")
                || msg.contains("target closed")
                || msg.contains("inspected target navigated or closed")
        }
        _ => false,
    }
}

fn parse_target_info(value: &Value) -> Option<NativeTargetInfo> {
    let str_field = |name: &str, max: usize| {
        value
            .get(name)
            .and_then(Value::as_str)
            .filter(|s| s.len() <= max)
            .map(str::to_string)
    };
    Some(NativeTargetInfo {
        target_id: str_field("targetId", MAX_TARGET_ID_LEN).filter(|s| !s.is_empty())?,
        target_type: str_field("type", 32).unwrap_or_default(),
        url: str_field("url", 4096).unwrap_or_default(),
        opener_id: str_field("openerId", MAX_TARGET_ID_LEN),
    })
}

struct ObserverEntry {
    control: Arc<NativeControl>,
    task: JoinHandle<()>,
    token: u64,
}

/// (principal key, browser incarnation) of an in-flight containment.
type ContainmentSlot = (String, String);

#[derive(Clone)]
struct NativeSinks {
    events: broadcast::Sender<NativeTargetEvent>,
    pump: mpsc::Sender<NativePumpRequest>,
}

const MAX_DOWNLOAD_GUIDS: usize = 128;
const DOWNLOAD_MAP_RESERVATION_BYTES: usize = 256 * 1024;
const TERMINAL_GUID_RETENTION: Duration = Duration::from_secs(5 * 60);

// Monotonic per browser incarnation. Fixed storage bounds replay memory; saturation only increases
// fail-closed false positives, so bits must never be cleared while the incarnation remains live.
#[derive(Clone)]
struct ExpiredGuidFilter {
    bits: [u64; 256],
}

impl Default for ExpiredGuidFilter {
    fn default() -> Self {
        Self { bits: [0; 256] }
    }
}

impl ExpiredGuidFilter {
    fn indexes(guid: &str) -> [usize; 4] {
        use std::hash::{Hash, Hasher};
        let mut first = std::collections::hash_map::DefaultHasher::new();
        guid.hash(&mut first);
        let a = first.finish();
        let mut second = std::collections::hash_map::DefaultHasher::new();
        1u8.hash(&mut second);
        guid.hash(&mut second);
        let b = second.finish() | 1;
        let mask = self::EXPIRED_GUID_FILTER_BITS - 1;
        std::array::from_fn(|i| a.wrapping_add((i as u64).wrapping_mul(b)) as usize & mask)
    }

    fn contains(&self, guid: &str) -> bool {
        Self::indexes(guid)
            .into_iter()
            .all(|index| self.bits[index / 64] & (1u64 << (index % 64)) != 0)
    }

    fn insert(&mut self, guid: &str) {
        for index in Self::indexes(guid) {
            self.bits[index / 64] |= 1u64 << (index % 64);
        }
    }
}

const EXPIRED_GUID_FILTER_BITS: usize = 256 * 64;

struct DownloadBindings {
    entries: HashMap<String, GuidEntry>,
    expired: ExpiredGuidFilter,
    filter_reservation: Option<super::diagnostics::MemoryReservation>,
    map_reservation: Option<super::diagnostics::MemoryReservation>,
    reservations: HashMap<String, super::diagnostics::MemoryReservation>,
}

impl Default for DownloadBindings {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            expired: ExpiredGuidFilter::default(),
            filter_reservation: None,
            map_reservation: None,
            reservations: HashMap::new(),
        }
    }
}

impl DownloadBindings {
    fn expire_terminal_entries(&mut self, now: Instant) {
        let expired: Vec<_> = self
            .entries
            .iter()
            .filter_map(|(guid, entry)| match entry {
                GuidEntry::Tombstone => Some(guid.clone()),
                GuidEntry::Bound(binding)
                    if binding.terminal_at.is_some_and(|at| {
                        now.saturating_duration_since(at) >= TERMINAL_GUID_RETENTION
                    }) =>
                {
                    Some(guid.clone())
                }
                _ => None,
            })
            .collect();
        for guid in expired {
            self.entries.remove(&guid);
            self.reservations.remove(&guid);
            self.expired.insert(&guid);
        }
    }

    fn reserve_begin(&mut self, guid: &str, binding: &DownloadBinding) -> Option<u64> {
        self.expire_terminal_entries(Instant::now());
        if let Some(existing) = self.entries.get(guid) {
            return match classify_download_begin(Some(existing), binding) {
                DownloadBeginDisposition::Conflicting => {
                    self.entries.insert(guid.to_string(), GuidEntry::Tombstone);
                    None
                }
                DownloadBeginDisposition::Duplicate | DownloadBeginDisposition::Poisoned => None,
                DownloadBeginDisposition::New => unreachable!(),
            };
        }
        if self.expired.contains(guid) {
            return None;
        }
        if self.entries.len() >= MAX_DOWNLOAD_GUIDS {
            self.expired.insert(guid);
            return None;
        }
        if self.filter_reservation.is_none() {
            self.filter_reservation =
                match super::diagnostics::global_memory_controller().try_reserve(2 * 1024) {
                    Ok(reservation) => Some(reservation),
                    Err(_) => {
                        self.expired.insert(guid);
                        return None;
                    }
                };
        }
        if self.map_reservation.is_none() {
            self.map_reservation = match super::diagnostics::global_memory_controller()
                .try_reserve(DOWNLOAD_MAP_RESERVATION_BYTES)
            {
                Ok(reservation) => Some(reservation),
                Err(_) => {
                    self.expired.insert(guid);
                    return None;
                }
            };
        }
        let Some(reservation) = NEXT_DOWNLOAD_RESERVATION
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |next| {
                next.checked_add(1)
            })
            .ok()
        else {
            self.expired.insert(guid);
            return None;
        };
        let memory = match super::diagnostics::global_memory_controller().try_reserve(16 * 1024) {
            Ok(memory) => memory,
            Err(_) => {
                self.expired.insert(guid);
                return None;
            }
        };
        self.reservations.insert(guid.to_string(), memory);
        self.entries.insert(
            guid.to_string(),
            GuidEntry::Pending {
                reservation,
                owner: binding.owner.clone(),
            },
        );
        Some(reservation)
    }
}
static NEXT_DOWNLOAD_RESERVATION: AtomicU64 = AtomicU64::new(1);
/// Manager state the observer tasks and lifecycle paths share.
#[derive(Clone)]
struct NativeHandles {
    observers: Arc<StdMutex<HashMap<String, ObserverEntry>>>,
    /// (principal key, incarnation) -> in-flight containment of that whole incarnation.
    containments: Arc<StdMutex<HashMap<ContainmentSlot, JoinHandle<()>>>>,
    /// principal key -> live browser incarnation (publication fence).
    live_incarnations: Arc<StdRwLock<HashMap<String, String>>>,
    global_process_count: Arc<AtomicUsize>,
    download_bindings: Arc<StdMutex<HashMap<String, Arc<StdMutex<DownloadBindings>>>>>,
    sinks: NativeSinks,
}

impl NativeHandles {
    fn download_bindings_for(&self, incarnation: &str) -> Arc<StdMutex<DownloadBindings>> {
        let mut bindings = self.download_bindings.lock().unwrap();
        bindings
            .entry(incarnation.to_string())
            .or_insert_with(|| Arc::new(StdMutex::new(DownloadBindings::default())))
            .clone()
    }
    fn live_control(&self, key: &str) -> Option<Arc<NativeControl>> {
        self.observers
            .lock()
            .unwrap()
            .get(key)
            .map(|entry| entry.control.clone())
            .filter(|control| !control.is_closed())
    }

    /// Stops observing; intentional shutdown paths call this before terminating the process so
    /// the closing connection is never mistaken for a crash.
    fn detach_observer(&self, key: &str) {
        let entry = self.observers.lock().unwrap().remove(key);
        if let Some(entry) = entry {
            entry.control.revoke_observer_authority();
            entry.task.abort();
        }
    }

    /// Every page of the incarnation is gone: retire its sessions/raw slots and their resources.
    async fn retire_incarnation(&self, incarnation: &str, reason: &str) {
        let departures = crate::api::browser_host::global_session_registry()
            .retire_incarnation(incarnation, reason)
            .await;
        announce_departures(&self.sinks, departures, reason).await;
        self.download_bindings.lock().unwrap().remove(incarnation);
    }

    /// Reaps a browser process found dead: terminates its group, frees the process slot,
    /// records an unproven containment as a tombstone, and retires the incarnation's native
    /// state (a dead browser proves its pages are gone). `abort_observer` is false when called
    /// from the observer task itself.
    async fn reap_dead_instance(
        &self,
        key: &str,
        inst: &mut InnerInstance,
        abort_observer: bool,
    ) -> Result<(), ManagerError> {
        let incarnation = inst.browser_incarnation.clone();
        let entry = self.observers.lock().unwrap().remove(key);
        if let Some(entry) = entry {
            entry.control.revoke_observer_authority();
            if abort_observer {
                entry.task.abort();
            }
        }
        self.live_incarnations.write().unwrap().remove(key);
        let result = match inst.process.take() {
            None => Ok(()),
            Some(mut proc) => {
                let term_res = proc.terminate().await;
                inst.active_viewers = 0;
                inst.active_raw_cdp = 0;
                self.global_process_count.fetch_sub(1, Ordering::SeqCst);
                match term_res {
                    Ok(()) => {
                        inst.state = InstanceLifecycleState::Dormant;
                        inst._held_lock = None;
                        Ok(())
                    }
                    Err(e) => {
                        warn!(pid = proc.pid(), error = %e, "process group cleanup unproven after crash");
                        inst.state = InstanceLifecycleState::CleanupPending;
                        let tombstone = ResetTombstone {
                            operation_id: format!("crash-{}", uuid::Uuid::new_v4()),
                            target_profile_epoch: inst.profile_epoch,
                            stage: ResetStage::Failed,
                            created_at_unix_ms: now_unix_ms(),
                            updated_at_unix_ms: now_unix_ms(),
                            error: Some(format!("process group containment unproven: {e}")),
                            containment: proc.identity(),
                        };
                        if let Err(e) = inst.profile.save_tombstone(&tombstone) {
                            warn!(error = %e, "crash tombstone not persisted; persisted process identity remains the fence");
                        }
                        Err(ManagerError::CleanupPending(format!(
                            "process group containment unproven: {e}"
                        )))
                    }
                }
            }
        };
        if let Some(incarnation) = incarnation {
            self.retire_incarnation(&incarnation, "browser process died")
                .await;
        }
        result
    }
}

/// Retires the stateless resources of departed sessions immediately and hands the state-bound
/// cleanup (selection artifacts) to the API-layer pump.
async fn announce_departures(sinks: &NativeSinks, departures: Vec<SessionDeparture>, reason: &str) {
    if departures.is_empty() {
        return;
    }
    let mut ids = Vec::with_capacity(departures.len());
    for departure in &departures {
        crate::api::browser_host::retire_session_native_resources(&departure.session_id).await;
        if departure.outcome == SessionStatus::Lost {
            let _ = sinks.events.send(NativeTargetEvent::SessionLost {
                browser_session_id: departure.session_id.clone(),
                browser_incarnation: departure.browser_incarnation.clone(),
                reason: reason.to_string(),
            });
        }
        ids.push(departure.session_id.clone());
    }
    if sinks
        .pump
        .try_send(NativePumpRequest::SessionsRetired(ids))
        .is_err()
    {
        debug!("native pump unavailable; selection cleanup of retired sessions deferred");
    }
}

#[derive(Clone)]
struct ObserverShared {
    key: String,
    subject: String,
    is_dev: bool,
    max_targets: usize,
    request_policy: Arc<NetworkPolicy>,
    inst: Arc<Mutex<InnerInstance>>,
    native: NativeHandles,
    faults: Arc<NativeFaults>,
    downloads: Arc<StdMutex<DownloadBindings>>,
    token: u64,
}

struct PendingPopup {
    session_id: String,
    parent_session_id: String,
    principal: String,
    is_dev: bool,
}

struct ChildFrameAttachment {
    parent_session_id: String,
    logical_frame_id: String,
}

struct PendingChildResume {
    attach_sequence: u64,
    target_id: String,
}

struct FrameTreeRetry {
    owner: FrameOwner,
    token: ValidityToken,
    child_parent_session: Option<String>,
    child_attach_sequence: Option<u64>,
    reseed_budget: u8,
    next_attempt: Instant,
}

#[derive(Default)]
struct ObserverState {
    /// Pages the observer decided to close; ignored when their events repeat.
    rejected: HashSet<String>,
    /// Refused pages whose close is deferred until their paused attach has been handled: a
    /// paused popup closed before it is resumed would hang its opener's `window.open`.
    pending_close: HashMap<String, Instant>,
    /// Admitted popups awaiting their paused attach for policy adoption.
    pending_popups: HashMap<String, PendingPopup>,
    frame_sessions: HashSet<String>,
    frame_attached: HashMap<(String, String), (String, u64)>,
    /// Created from ordered `ChildAttached` records and retained through snapshot admission.
    pending_children: HashMap<String, (String, u64)>,
    /// Paused child targets stay inert until their exact frame snapshot is admitted.
    pending_child_resumes: HashMap<String, PendingChildResume>,
    child_target_ids: HashMap<String, String>,
    child_frame_roots: HashMap<String, ChildFrameAttachment>,
    owners: HashMap<String, FrameOwner>,
    pending_frames: HashMap<usize, PendingFrameTree>,
    /// One bounded, coalesced retry intent per session; intent grants no ownership.
    frame_tree_retries: HashMap<String, FrameTreeRetry>,
}

impl ObserverState {
    fn reject(&mut self, target_id: &str) {
        if self.rejected.len() >= MAX_REJECTED_TARGETS {
            self.rejected.clear();
        }
        self.rejected.insert(target_id.to_string());
    }

    fn queue_frame_tree_retry(
        &mut self,
        session_id: String,
        owner: FrameOwner,
        token: ValidityToken,
        child_parent_session: Option<String>,
        child_attach_sequence: Option<u64>,
        reseed_budget: u8,
    ) -> bool {
        let next_attempt = Instant::now() + FRAME_TREE_RETRY_DELAY;
        if let Some(retry) = self.frame_tree_retries.get_mut(&session_id) {
            retry.owner = owner;
            retry.token = token;
            retry.child_parent_session = child_parent_session;
            retry.child_attach_sequence = child_attach_sequence;
            retry.reseed_budget = reseed_budget;
            retry.next_attempt = retry.next_attempt.min(next_attempt);
            true
        } else if self.frame_tree_retries.len() < MAX_PENDING_FRAME_TREE_RETRIES {
            self.frame_tree_retries.insert(
                session_id,
                FrameTreeRetry {
                    owner,
                    token,
                    child_parent_session,
                    child_attach_sequence,
                    reseed_budget,
                    next_attempt,
                },
            );
            true
        } else {
            false
        }
    }
}

/// One frame detach seen while a snapshot is in flight; root relevance is decided at admission.
struct PendingDetach {
    session_id: String,
    frame_id: String,
    removed: bool,
}

struct PendingFrameTree {
    session_id: String,
    owner: FrameOwner,
    token: ValidityToken,
    child_parent_session: Option<String>,
    child_attach_sequence: Option<u64>,
    barrier: Option<CdpStreamPosition>,
    result: Option<CdpFrameTreeSnapshot>,
    changed: bool,
    detached: Vec<PendingDetach>,
    detach_overflow: bool,
    reseed_budget: u8,
}

static NEXT_ATTACHMENT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn parse_frame_tree(result: &Value) -> Option<Vec<FrameSnapshotNode>> {
    parse_frame_tree_with_external_root(result, false)
}

fn parse_child_frame_tree(result: &Value) -> Option<Vec<FrameSnapshotNode>> {
    parse_frame_tree_with_external_root(result, true)
}

fn parse_frame_tree_with_external_root(
    result: &Value,
    allow_external_root_parent: bool,
) -> Option<Vec<FrameSnapshotNode>> {
    let root = result.get("frameTree")?;
    let mut stack = vec![(root, None::<&str>, 1usize)];
    let mut nodes = Vec::new();
    let mut ids = HashSet::new();
    while let Some((tree, expected_parent, depth)) = stack.pop() {
        if depth > 4096 || nodes.len() >= 4096 {
            return None;
        }
        let frame = tree.get("frame")?.as_object()?;
        let id = frame.get("id")?.as_str()?;
        let parent = match frame.get("parentId") {
            Some(value) => Some(value.as_str()?),
            None => None,
        };
        let url = frame.get("url")?.as_str()?;
        let is_root = nodes.is_empty();
        if id.is_empty()
            || id.len() > 256
            || url.len() > 8192
            || parent.is_some_and(|parent| parent.is_empty() || parent.len() > 256)
            || (parent != expected_parent && !(is_root && allow_external_root_parent))
            || (is_root && allow_external_root_parent && parent == Some(id))
            || !ids.insert(id)
        {
            return None;
        }
        nodes.push(FrameSnapshotNode {
            frame_id: id.to_string(),
            parent_frame_id: parent.map(str::to_string),
        });
        if let Some(children) = tree.get("childFrames") {
            for child in children.as_array()? {
                stack.push((child, Some(id), depth + 1));
                if stack.len() + nodes.len() > 4096 {
                    return None;
                }
            }
        }
    }
    if allow_external_root_parent
        && nodes
            .first()
            .and_then(|root| root.parent_frame_id.as_deref())
            .is_some_and(|parent| ids.contains(parent))
    {
        return None;
    }
    Some(nodes)
}

fn parent_has_active_or_pending_frame_tree(
    state: &ObserverState,
    parent_session_id: &str,
    owner: &FrameOwner,
    token: ValidityToken,
) -> bool {
    let mut current = parent_session_id;
    for _ in 0..64 {
        if state.owners.get(current) != Some(owner) {
            return false;
        }
        if state.frame_sessions.contains(current)
            || state.pending_frames.values().any(|pending| {
                pending.session_id == current
                    && pending.owner == *owner
                    && pending.token == token
            })
            || state
                .frame_tree_retries
                .get(current)
                .is_some_and(|retry| retry.owner == *owner && retry.token == token)
        {
            return true;
        }
        let Some((next_parent, _)) = state.pending_children.get(current) else {
            return false;
        };
        current = next_parent.as_str();
    }
    false
}

fn child_root_matches_attachment(
    state: &ObserverState,
    parent_session: &str,
    root: &FrameSnapshotNode,
    attach_sequence: u64,
    owner: &FrameOwner,
) -> bool {
    let Some((parent_frame_id, evidence_sequence)) = state
        .frame_attached
        .get(&(parent_session.to_string(), root.frame_id.clone()))
    else {
        return false;
    };
    root.parent_frame_id.as_deref() == Some(parent_frame_id.as_str())
        && root.parent_frame_id.as_deref() != Some(root.frame_id.as_str())
        && state.frame_sessions.contains(parent_session)
        && state.owners.get(parent_session) == Some(owner)
        && parent_frame_predates_child_attach(Some(*evidence_sequence), attach_sequence)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DownloadTerminal {
    Completed,
    Canceled,
}

#[derive(Clone)]
struct DownloadBinding {
    frame_owner: FrameOwner,
    source_session_id: Option<String>,
    source_frame_id: String,
    connection_token: ValidityToken,
    owner: DownloadOwner,
    filename: String,
    terminal: Option<DownloadTerminal>,
    terminal_at: Option<Instant>,
    terminal_path: Option<String>,
    terminal_received_bytes: Option<u64>,
    terminal_total_bytes: Option<u64>,
}

impl DownloadBinding {
    fn new(
        frame_owner: FrameOwner,
        source_session_id: Option<String>,
        source_frame_id: String,
        connection_token: ValidityToken,
        filename: String,
    ) -> Self {
        let owner = DownloadOwner {
            principal: frame_owner.principal.clone(),
            is_dev: frame_owner.is_dev,
            browser_incarnation: frame_owner.browser_incarnation.clone(),
            profile_epoch: frame_owner.profile_epoch,
            session_id: frame_owner.logical_session_id.clone(),
            native_target_id: frame_owner.native_target_id.clone(),
        };
        Self {
            frame_owner,
            source_session_id,
            source_frame_id,
            connection_token,
            owner,
            filename,
            terminal: None,
            terminal_at: None,
            terminal_path: None,
            terminal_received_bytes: None,
            terminal_total_bytes: None,
        }
    }
}

#[derive(Clone)]
enum GuidEntry {
    Pending {
        reservation: u64,
        owner: DownloadOwner,
    },
    Bound(DownloadBinding),
    Tombstone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadBeginDisposition {
    New,
    Duplicate,
    Conflicting,
    Poisoned,
}

fn classify_download_begin(
    existing: Option<&GuidEntry>,
    candidate: &DownloadBinding,
) -> DownloadBeginDisposition {
    match existing {
        None => DownloadBeginDisposition::New,
        Some(GuidEntry::Pending { owner, .. })
            if download_owner_matches_frame(owner, &candidate.frame_owner) =>
        {
            DownloadBeginDisposition::Duplicate
        }
        Some(GuidEntry::Pending { .. }) => DownloadBeginDisposition::Conflicting,
        Some(GuidEntry::Tombstone) => DownloadBeginDisposition::Poisoned,
        Some(GuidEntry::Bound(previous))
            if download_owner_matches_frame(&previous.owner, &candidate.frame_owner) =>
        {
            DownloadBeginDisposition::Duplicate
        }
        Some(GuidEntry::Bound(_)) => DownloadBeginDisposition::Conflicting,
    }
}

fn download_owner_matches_frame(owner: &DownloadOwner, frame: &FrameOwner) -> bool {
    owner.principal == frame.principal
        && owner.is_dev == frame.is_dev
        && owner.browser_incarnation == frame.browser_incarnation
        && owner.profile_epoch == frame.profile_epoch
        && owner.session_id == frame.logical_session_id
        && owner.native_target_id == frame.native_target_id
}

fn download_progress_allowed(
    binding: &DownloadBinding,
    connection_token: ValidityToken,
    session_id: Option<&str>,
    proven_sessions: &HashSet<String>,
    session_owners: &HashMap<String, FrameOwner>,
    progress: &str,
    received_bytes: u64,
    total_bytes: u64,
    file_path: Option<&str>,
) -> bool {
    if binding.source_frame_id.is_empty() || binding.source_frame_id.len() > 256 {
        return false;
    }
    let emitter_is_bound = session_id.is_none_or(|session_id| {
        (binding
            .connection_token
            .belongs_to_same_connection(connection_token)
            && binding.source_session_id.as_deref() == Some(session_id))
            || (proven_sessions.contains(session_id)
                && session_owners
                    .get(session_id)
                    .is_some_and(|frame| download_owner_matches_frame(&binding.owner, frame)))
    });
    emitter_is_bound
        && match binding.terminal {
            None => true,
            Some(DownloadTerminal::Completed) => {
                progress == "completed"
                    && binding
                        .terminal_path
                        .as_deref()
                        .is_none_or(|path| file_path.is_none_or(|candidate| candidate == path))
                    && binding
                        .terminal_received_bytes
                        .is_none_or(|previous| received_bytes == previous)
                    && binding
                        .terminal_total_bytes
                        .is_none_or(|previous| total_bytes == previous)
            }
            Some(DownloadTerminal::Canceled) => false,
        }
}

async fn dispatch_download_will_begin(
    registry: &SessionRegistry,
    downloads: &StdMutex<DownloadBindings>,
    fence: &OwnershipFence,
    token: ValidityToken,
    state: &ObserverState,
    session_id: Option<&str>,
    frame_id: &str,
    guid: &str,
    suggested_filename: &str,
) {
    if guid.is_empty() || guid.len() > 256 || suggested_filename.len() > 8192 {
        return;
    }
    debug!(session_id = ?session_id, frame_id, "CDP download begin received");
    let mut matches = state
        .frame_sessions
        .iter()
        .filter(|session| session_id.is_none_or(|id| id == session.as_str()))
        .filter_map(|session| {
            fence
                .lookup(token, session, frame_id)
                .map(|owner| (session.clone(), owner))
        });
    let Some((_, owner)) = matches.next() else {
        debug!(
            frame_id,
            frame_sessions = state.frame_sessions.len(),
            "download begin rejected: no proven frame owner",
        );
        return;
    };
    if matches.any(|(_, matched_owner)| matched_owner != owner) {
        debug!(
            frame_id,
            "download begin rejected: conflicting frame owners"
        );
        return;
    }
    let binding = DownloadBinding::new(
        owner,
        session_id.map(str::to_string),
        frame_id.to_string(),
        token,
        suggested_filename.to_string(),
    );
    let Some(reservation) = downloads.lock().unwrap().reserve_begin(guid, &binding) else {
        debug!(frame_id, "download begin rejected by GUID reservation");
        return;
    };
    let committed = registry
        .record_download_will_begin_fenced(
            fence,
            token,
            &binding.owner,
            guid.to_string(),
            binding.filename.clone(),
        )
        .await;
    debug!(
        committed,
        frame_id, "download begin ownership commit result"
    );
    let mut downloads = downloads.lock().unwrap();
    if let Some(entry) = downloads.entries.get_mut(guid) {
        if matches!(entry, GuidEntry::Pending { reservation: id, .. } if *id == reservation) {
            *entry = if committed {
                GuidEntry::Bound(binding)
            } else {
                GuidEntry::Tombstone
            };
        }
    }
}

async fn dispatch_download_progress(
    registry: &SessionRegistry,
    downloads: &StdMutex<DownloadBindings>,
    fence: &OwnershipFence,
    token: ValidityToken,
    state: &ObserverState,
    session_id: Option<&str>,
    guid: &str,
    progress: &str,
    received_bytes: u64,
    total_bytes: u64,
    file_path: Option<&str>,
) {
    if !matches!(progress, "inProgress" | "completed" | "canceled") {
        return;
    }
    let Some(GuidEntry::Bound(binding)) = downloads.lock().unwrap().entries.get(guid).cloned()
    else {
        debug!(session_id = ?session_id, "download progress ignored without a bound begin");
        return;
    };
    if !download_progress_allowed(
        &binding,
        token,
        session_id,
        &state.frame_sessions,
        &state.owners,
        progress,
        received_bytes,
        total_bytes,
        file_path,
    ) {
        return;
    }
    let terminal = match progress {
        "completed" => Some(DownloadTerminal::Completed),
        "canceled" => Some(DownloadTerminal::Canceled),
        _ => None,
    };
    if registry
        .record_download_progress_fenced(
            fence,
            token,
            &binding.owner,
            guid.to_string(),
            binding.filename.clone(),
            progress.to_string(),
            received_bytes,
            total_bytes,
            file_path.map(str::to_string),
        )
        .await
    {
        if let Some(terminal) = terminal {
            let mut downloads = downloads.lock().unwrap();
            if let Some(GuidEntry::Bound(current)) = downloads.entries.get_mut(guid) {
                if current.frame_owner == binding.frame_owner
                    && current.source_frame_id == binding.source_frame_id
                {
                    current.terminal = Some(terminal);
                    current.terminal_at.get_or_insert_with(Instant::now);
                    if file_path.is_some() {
                        current.terminal_path = file_path.map(str::to_string);
                    }
                    current.terminal_received_bytes = Some(received_bytes);
                    current.terminal_total_bytes = Some(total_bytes);
                }
            }
        }
    }
}

async fn dispatch_download_lifecycle_event(
    registry: &SessionRegistry,
    downloads: &StdMutex<DownloadBindings>,
    fence: &OwnershipFence,
    token: ValidityToken,
    state: &ObserverState,
    event: &CdpLifecycleEvent,
) {
    match event {
        CdpLifecycleEvent::DownloadWillBegin {
            session_id,
            frame_id: Some(frame_id),
            guid,
            suggested_filename,
            ..
        } => {
            dispatch_download_will_begin(
                registry,
                downloads,
                fence,
                token,
                state,
                session_id.as_deref(),
                frame_id,
                guid,
                suggested_filename,
            )
            .await;
        }
        CdpLifecycleEvent::DownloadWillBegin {
            session_id,
            frame_id: None,
            ..
        } => {
            debug!(session_id = ?session_id, "CDP download begin omitted frame id");
        }
        CdpLifecycleEvent::DownloadProgress {
            session_id,
            guid,
            state: progress,
            received_bytes,
            total_bytes,
            file_path,
            ..
        } => {
            dispatch_download_progress(
                registry,
                downloads,
                fence,
                token,
                state,
                session_id.as_deref(),
                guid,
                progress,
                *received_bytes,
                *total_bytes,
                file_path.as_deref(),
            )
            .await;
        }
        _ => {}
    }
}

fn parent_frame_predates_child_attach(
    evidence_sequence: Option<u64>,
    attach_sequence: u64,
) -> bool {
    evidence_sequence.is_some_and(|sequence| sequence < attach_sequence)
}
/// A child-target root keeps an external parentId, so CDP's session-local
/// `is_main_frame` check cannot identify its navigation. Require the ordered parent
/// attachment provenance before treating it as a child-target reseed.
fn is_child_root_navigation(
    state: &ObserverState,
    session_id: &str,
    frame_id: &str,
    parent_frame_id: Option<&str>,
) -> bool {
    let Some((parent_session, attach_sequence)) = state.pending_children.get(session_id) else {
        return false;
    };
    if state
        .child_frame_roots
        .get(session_id)
        .is_some_and(|attachment| {
            attachment.parent_session_id.as_str() != parent_session.as_str()
                || attachment.logical_frame_id != frame_id
        })
    {
        return false;
    }
    let Some((recorded_parent, evidence_sequence)) = state
        .frame_attached
        .get(&(parent_session.clone(), frame_id.to_string()))
    else {
        return false;
    };
    Some(recorded_parent.as_str()) == parent_frame_id
        && parent_frame_predates_child_attach(Some(*evidence_sequence), *attach_sequence)
}

fn frame_navigation_reseeds_snapshot(state: &ObserverState, event: &CdpLifecycleEvent) -> bool {
    let CdpLifecycleEvent::FrameNavigated {
        session_id: Some(session_id),
        is_main_frame,
        frame_id,
        parent_frame_id,
        ..
    } = event
    else {
        return false;
    };
    *is_main_frame
        || frame_id.as_deref().is_some_and(|frame_id| {
            is_child_root_navigation(state, session_id, frame_id, parent_frame_id.as_deref())
        })
}

/// The first record establishes the subscription's baseline; subsequent records must be
/// contiguous within that same connection generation.
fn ordered_position_follows(previous: Option<CdpStreamPosition>, next: CdpStreamPosition) -> bool {
    match previous {
        None => true,
        Some(previous) => {
            previous.generation == next.generation
                && previous.sequence.checked_add(1) == Some(next.sequence)
        }
    }
}

#[cfg(test)]
mod ordered_position_tests {
    use super::super::session::{CreateSessionRequest, SessionRegistry, ViewportRequest};
    use super::super::target_ownership::FrameSnapshotNode;
    use super::{
        attachment_session_closure, child_root_matches_attachment, child_root_swap_reseed_budget,
        child_sessions_to_retire, classify_download_begin, dispatch_download_lifecycle_event,
        download_progress_allowed, frame_detach_preserved_parent,
        frame_navigation_reseeds_snapshot, is_child_root_navigation, mark_pending_frame_detached,
        ordered_position_follows, parent_frame_predates_child_attach, parse_child_frame_tree,
        parse_frame_tree, record_frame_attachment, retire_detached_frame,
        retire_frame_attachment_subtree, CdpLifecycleEvent, CdpStreamPosition,
        ChildFrameAttachment, DownloadBeginDisposition, DownloadBinding, DownloadBindings,
        DownloadTerminal, FrameDetachReason, FrameOwner, GuidEntry, ObserverState, OwnershipFence,
        PendingDetach, PendingFrameTree, ValidityToken, MAX_CHILD_ROOT_RESEEDS,
        MAX_OBSERVER_FRAME_ATTACHMENTS, MAX_PENDING_FRAME_DETACHES, MAX_PENDING_FRAME_TREE_RETRIES,
    };
    use serde_json::json;
    use std::collections::HashSet;
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;
    #[test]
    fn child_root_navigation_requires_current_parent_attachment_provenance() {
        let mut state = ObserverState::default();
        state
            .pending_children
            .insert("child-session".into(), ("parent-session".into(), 10));
        state.frame_attached.insert(
            ("parent-session".into(), "root-frame".into()),
            ("outer-frame".into(), 9),
        );
        state.child_frame_roots.insert(
            "child-session".into(),
            ChildFrameAttachment {
                parent_session_id: "parent-session".into(),
                logical_frame_id: "root-frame".into(),
            },
        );

        assert!(is_child_root_navigation(
            &state,
            "child-session",
            "root-frame",
            Some("outer-frame"),
        ));
        let root_navigation = CdpLifecycleEvent::FrameNavigated {
            session_id: Some("child-session".into()),
            is_main_frame: false,
            frame_id: Some("root-frame".into()),
            parent_frame_id: Some("outer-frame".into()),
            url: None,
            loader_id: None,
            _reservation: None,
        };
        assert!(frame_navigation_reseeds_snapshot(&state, &root_navigation));
        let nested_navigation = CdpLifecycleEvent::FrameNavigated {
            session_id: Some("child-session".into()),
            is_main_frame: false,
            frame_id: Some("nested-frame".into()),
            parent_frame_id: Some("root-frame".into()),
            url: None,
            loader_id: None,
            _reservation: None,
        };
        assert!(!frame_navigation_reseeds_snapshot(
            &state,
            &nested_navigation
        ));
        assert!(!is_child_root_navigation(
            &state,
            "child-session",
            "nested-frame",
            Some("root-frame"),
        ));
        assert!(!is_child_root_navigation(
            &state,
            "child-session",
            "root-frame",
            Some("unexpected-parent"),
        ));

        state.child_frame_roots.remove("child-session");
        assert!(is_child_root_navigation(
            &state,
            "child-session",
            "root-frame",
            Some("outer-frame"),
        ));
        state.frame_attached.insert(
            ("parent-session".into(), "root-frame".into()),
            ("outer-frame".into(), 10),
        );
        assert!(!is_child_root_navigation(
            &state,
            "child-session",
            "root-frame",
            Some("outer-frame"),
        ));
    }
    #[test]
    fn frame_tree_retry_intents_are_coalesced_and_bounded() {
        let mut state = ObserverState::default();
        let owner = download_owner();
        let token = connection_token();
        assert!(state.queue_frame_tree_retry("child".into(), owner.clone(), token, None, None, 1));
        assert!(state.queue_frame_tree_retry("child".into(), owner.clone(), token, None, None, 2));
        assert_eq!(state.frame_tree_retries.len(), 1);
        assert_eq!(
            state.frame_tree_retries.get("child").unwrap().reseed_budget,
            2
        );

        for index in 0..MAX_PENDING_FRAME_TREE_RETRIES {
            let expected = index + 1 < MAX_PENDING_FRAME_TREE_RETRIES;
            assert_eq!(
                state.queue_frame_tree_retry(
                    format!("session-{index}"),
                    owner.clone(),
                    token,
                    None,
                    None,
                    MAX_CHILD_ROOT_RESEEDS,
                ),
                expected,
            );
        }
        assert_eq!(
            state.frame_tree_retries.len(),
            MAX_PENDING_FRAME_TREE_RETRIES
        );
        assert!(!state
            .frame_tree_retries
            .contains_key(&format!("session-{}", MAX_PENDING_FRAME_TREE_RETRIES - 1,)));
    }
    #[test]
    fn detach_flags_scope_to_recorded_frames_and_overflow_fails_closed() {
        let mut state = ObserverState::default();
        state
            .pending_frames
            .insert(1, child_root_pending(MAX_CHILD_ROOT_RESEEDS));
        mark_pending_frame_detached(&mut state, "parent", "frame-a", FrameDetachReason::Remove);
        mark_pending_frame_detached(&mut state, "parent", "frame-b", FrameDetachReason::Remove);
        let pending = state.pending_frames.get(&1).unwrap();
        assert!(pending.changed);
        assert!(!pending.detach_overflow);
        assert_eq!(pending.detached.len(), 2);

        for index in 0..MAX_PENDING_FRAME_DETACHES {
            mark_pending_frame_detached(
                &mut state,
                "parent",
                &format!("frame-{index}"),
                FrameDetachReason::Swap,
            );
        }
        assert!(state.pending_frames.get(&1).unwrap().detach_overflow);
    }
    fn child_root_pending(reseed_budget: u8) -> PendingFrameTree {
        PendingFrameTree {
            session_id: "child".into(),
            owner: download_owner(),
            token: connection_token(),
            child_parent_session: Some("parent".into()),
            child_attach_sequence: Some(10),
            barrier: None,
            result: None,
            changed: false,
            detached: Vec::new(),
            detach_overflow: false,
            reseed_budget,
        }
    }
    #[test]
    fn child_root_swap_reseed_is_budgeted_and_root_remove_revokes() {
        let mut state = ObserverState::default();
        state
            .pending_frames
            .insert(1, child_root_pending(MAX_CHILD_ROOT_RESEEDS));
        mark_pending_frame_detached(&mut state, "parent", "frame-a", FrameDetachReason::Swap);
        let pending = state.pending_frames.get(&1).unwrap();
        let detaches: Vec<&PendingDetach> = pending.detached.iter().collect();
        assert_eq!(
            child_root_swap_reseed_budget(pending, &detaches),
            Some(MAX_CHILD_ROOT_RESEEDS - 1)
        );
        assert_eq!(
            child_root_swap_reseed_budget(&child_root_pending(0), &detaches),
            None
        );

        mark_pending_frame_detached(&mut state, "parent", "frame-a", FrameDetachReason::Remove);
        let pending = state.pending_frames.get(&1).unwrap();
        let detaches: Vec<&PendingDetach> = pending.detached.iter().collect();
        assert_eq!(child_root_swap_reseed_budget(pending, &detaches), None);
    }
    #[test]
    fn child_root_swap_reseed_rejects_child_session_and_second_root() {
        let mut state = ObserverState::default();
        state
            .pending_frames
            .insert(1, child_root_pending(MAX_CHILD_ROOT_RESEEDS));
        mark_pending_frame_detached(&mut state, "child", "frame-a", FrameDetachReason::Swap);
        let pending = state.pending_frames.get(&1).unwrap();
        let detaches: Vec<&PendingDetach> = pending.detached.iter().collect();
        assert_eq!(child_root_swap_reseed_budget(pending, &detaches), None);

        let mut state = ObserverState::default();
        state
            .pending_frames
            .insert(1, child_root_pending(MAX_CHILD_ROOT_RESEEDS));
        mark_pending_frame_detached(&mut state, "parent", "frame-a", FrameDetachReason::Swap);
        mark_pending_frame_detached(&mut state, "child", "frame-a", FrameDetachReason::Swap);
        let pending = state.pending_frames.get(&1).unwrap();
        let detaches: Vec<&PendingDetach> = pending.detached.iter().collect();
        assert_eq!(child_root_swap_reseed_budget(pending, &detaches), None);
    }
    #[test]
    fn pending_attachment_closure_includes_indirect_children_only() {
        let mut state = ObserverState::default();
        state
            .pending_children
            .insert("child".into(), ("parent".into(), 10));
        state
            .pending_children
            .insert("grandchild".into(), ("child".into(), 11));
        state
            .pending_children
            .insert("sibling".into(), ("parent".into(), 12));

        let closure = attachment_session_closure(&state, ["parent".to_string()]);

        assert_eq!(
            closure,
            HashSet::from([
                "parent".to_string(),
                "child".to_string(),
                "grandchild".to_string(),
                "sibling".to_string()
            ]),
        );
    }
    #[test]
    fn frame_detach_retires_descendant_attachment_evidence_only() {
        let mut state = ObserverState::default();
        state
            .frame_attached
            .insert(("page".into(), "root".into()), ("".into(), 1));
        state
            .frame_attached
            .insert(("page".into(), "child".into()), ("root".into(), 2));
        state
            .frame_attached
            .insert(("page".into(), "grandchild".into()), ("child".into(), 3));
        state
            .frame_attached
            .insert(("page".into(), "sibling".into()), ("root".into(), 4));
        state
            .frame_attached
            .insert(("other".into(), "child".into()), ("root".into(), 5));

        retire_frame_attachment_subtree(&mut state, "page", "child", None);

        assert!(state
            .frame_attached
            .contains_key(&("page".into(), "root".into())));
        assert!(!state
            .frame_attached
            .contains_key(&("page".into(), "child".into())));
        assert!(!state
            .frame_attached
            .contains_key(&("page".into(), "grandchild".into())));
        assert!(state
            .frame_attached
            .contains_key(&("page".into(), "sibling".into())));
        assert!(state
            .frame_attached
            .contains_key(&("other".into(), "child".into())));
    }

    #[test]
    fn frame_swap_preserves_only_matching_attachment_parent_evidence() {
        let mut state = ObserverState::default();
        state
            .frame_attached
            .insert(("page".into(), "child".into()), ("root".into(), 2));
        state
            .frame_attached
            .insert(("page".into(), "grandchild".into()), ("child".into(), 3));

        let preserved_parent =
            frame_detach_preserved_parent(&state, "page", "child", FrameDetachReason::Swap);
        assert_eq!(preserved_parent.as_deref(), Some("root"));
        assert_eq!(
            frame_detach_preserved_parent(&state, "page", "child", FrameDetachReason::Remove),
            None,
        );
        retire_frame_attachment_subtree(&mut state, "page", "child", preserved_parent.as_deref());

        assert_eq!(
            state.frame_attached.get(&("page".into(), "child".into())),
            Some(&("root".into(), 2)),
        );
        assert!(!state
            .frame_attached
            .contains_key(&("page".into(), "grandchild".into())));
    }
    #[test]
    fn logical_frame_detach_retires_every_attached_target() {
        let mut state = ObserverState::default();
        state.child_frame_roots.insert(
            "old-target".into(),
            ChildFrameAttachment {
                parent_session_id: "page".into(),
                logical_frame_id: "iframe".into(),
            },
        );
        state.child_frame_roots.insert(
            "replacement-target".into(),
            ChildFrameAttachment {
                parent_session_id: "page".into(),
                logical_frame_id: "iframe".into(),
            },
        );
        let retired_frames = HashSet::from(["iframe".to_string()]);
        let mut retired = child_sessions_to_retire(&state, "page", &retired_frames);
        retired.sort();
        assert_eq!(
            retired,
            ["old-target".to_string(), "replacement-target".to_string()]
        );
    }

    #[test]
    fn accepts_baseline_and_only_contiguous_positions_in_same_generation() {
        let at = |generation, sequence| CdpStreamPosition {
            generation,
            sequence,
        };
        assert!(ordered_position_follows(None, at(2, 17)));
        assert!(ordered_position_follows(Some(at(2, 17)), at(2, 18)));
        assert!(!ordered_position_follows(Some(at(2, 17)), at(2, 19)));
        assert!(!ordered_position_follows(Some(at(2, 17)), at(2, 17)));
        assert!(!ordered_position_follows(Some(at(2, 17)), at(3, 18)));
        assert!(!ordered_position_follows(Some(at(2, u64::MAX)), at(2, 0)));
    }

    #[test]
    fn frame_tree_requires_unique_connected_parent_links_and_bounded_values() {
        let tree = json!({"frameTree": {
            "frame": {"id": "root", "url": "https://example.test/"},
            "childFrames": [{"frame": {"id": "child", "parentId": "root", "url": "about:blank"}}]
        }});
        assert_eq!(parse_frame_tree(&tree).unwrap().len(), 2);
        let mut invalid = tree.clone();
        invalid["frameTree"]["childFrames"][0]["frame"]["parentId"] = json!("other");
        assert!(parse_frame_tree(&invalid).is_none());
        invalid["frameTree"]["childFrames"][0]["frame"]["parentId"] = json!("root");
        invalid["frameTree"]["childFrames"][0]["frame"]["id"] = json!("root");
        assert!(parse_frame_tree(&invalid).is_none());
        invalid["frameTree"]["frame"]["url"] = json!("x".repeat(8193));
        assert!(parse_frame_tree(&invalid).is_none());
    }
    #[test]
    fn child_snapshot_external_parent_must_match_causal_attachment() {
        let tree = json!({"frameTree": {
            "frame": {"id": "oopif-root", "parentId": "container", "url": "https://example.test/"},
            "childFrames": [{
                "frame": {"id": "nested", "parentId": "oopif-root", "url": "about:blank"}
            }]
        }});
        assert!(parse_frame_tree(&tree).is_none());
        let nodes = parse_child_frame_tree(&tree).unwrap();
        assert_eq!(nodes[0].parent_frame_id.as_deref(), Some("container"));
        assert_eq!(nodes[1].parent_frame_id.as_deref(), Some("oopif-root"));

        let mut self_parent = tree.clone();
        self_parent["frameTree"]["frame"]["parentId"] = json!("oopif-root");
        assert!(parse_child_frame_tree(&self_parent).is_none());
        let mut returned_parent = tree.clone();
        returned_parent["frameTree"]["childFrames"][0]["frame"]["id"] = json!("container");
        returned_parent["frameTree"]["childFrames"][0]["frame"]["parentId"] = json!("oopif-root");
        assert!(parse_child_frame_tree(&returned_parent).is_none());
        let owner = download_owner();
        let mut state = ObserverState::default();
        state.frame_sessions.insert("parent-session".into());
        state.owners.insert("parent-session".into(), owner.clone());
        state.frame_attached.insert(
            ("parent-session".into(), "oopif-root".into()),
            ("container".into(), 4),
        );
        assert!(child_root_matches_attachment(
            &state,
            "parent-session",
            &nodes[0],
            5,
            &owner,
        ));

        state.frame_attached.insert(
            ("parent-session".into(), "oopif-root".into()),
            ("different-container".into(), 4),
        );
        assert!(!child_root_matches_attachment(
            &state,
            "parent-session",
            &nodes[0],
            5,
            &owner,
        ));
        let mut invalid_nested = tree;
        invalid_nested["frameTree"]["childFrames"][0]["frame"]["parentId"] = json!("wrong");
        assert!(parse_child_frame_tree(&invalid_nested).is_none());
    }

    #[test]
    fn swap_retirement_preserves_container_and_reseeds_replacement_child() {
        let fence = OwnershipFence::new();
        let token = fence.token(fence.start_next_generation().unwrap()).unwrap();
        let owner = download_owner();
        assert!(fence.seed_snapshot(
            token,
            "parent",
            owner.clone(),
            &[
                FrameSnapshotNode {
                    frame_id: "root".into(),
                    parent_frame_id: None
                },
                FrameSnapshotNode {
                    frame_id: "container".into(),
                    parent_frame_id: Some("root".into())
                },
                FrameSnapshotNode {
                    frame_id: "iframe".into(),
                    parent_frame_id: Some("container".into())
                },
                FrameSnapshotNode {
                    frame_id: "sibling".into(),
                    parent_frame_id: Some("root".into())
                },
            ]
        ));
        assert!(fence.install(token, || true, || {}));
        assert!(fence.seed_child_snapshot(
            token,
            "old-target",
            "parent",
            "container",
            "iframe",
            &owner,
            &[
                FrameSnapshotNode {
                    frame_id: "iframe".into(),
                    parent_frame_id: None
                },
                FrameSnapshotNode {
                    frame_id: "nested".into(),
                    parent_frame_id: Some("iframe".into())
                },
            ]
        ));
        assert!(fence.seed_child_snapshot(
            token,
            "nested-target",
            "old-target",
            "iframe",
            "nested-root",
            &owner,
            &[FrameSnapshotNode {
                frame_id: "nested-root".into(),
                parent_frame_id: None
            },]
        ));

        let mut state = ObserverState::default();
        state
            .frame_attached
            .insert(("parent".into(), "iframe".into()), ("container".into(), 4));
        state.child_frame_roots.insert(
            "old-target".into(),
            ChildFrameAttachment {
                parent_session_id: "parent".into(),
                logical_frame_id: "iframe".into(),
            },
        );
        state.owners.insert("old-target".into(), owner.clone());
        state.owners.insert("nested-target".into(), owner.clone());
        state.frame_sessions.insert("old-target".into());
        state.frame_sessions.insert("nested-target".into());
        state
            .pending_children
            .insert("nested-target".into(), ("old-target".into(), 6));
        state.child_frame_roots.insert(
            "nested-target".into(),
            ChildFrameAttachment {
                parent_session_id: "old-target".into(),
                logical_frame_id: "iframe".into(),
            },
        );
        state.owners.insert("parent".into(), owner.clone());
        state.frame_sessions.insert("parent".into());

        state.pending_frames.insert(
            7,
            PendingFrameTree {
                session_id: "pending-target".into(),
                owner: owner.clone(),
                token,
                child_parent_session: Some("parent".into()),
                child_attach_sequence: Some(6),
                barrier: None,
                result: None,
                changed: false,
                detached: Vec::new(),
                detach_overflow: false,
                reseed_budget: MAX_CHILD_ROOT_RESEEDS,
            },
        );
        retire_detached_frame(
            &fence,
            &mut state,
            token,
            "parent",
            "iframe",
            Some("container"),
            FrameDetachReason::Swap,
        );
        let pending = state.pending_frames.get(&7).unwrap();
        assert!(pending.changed);
        assert!(pending
            .detached
            .iter()
            .any(|detach| detach.session_id == "parent"
                && detach.frame_id == "iframe"
                && !detach.removed));
        assert!(!pending.detach_overflow);
        assert!(state
            .frame_attached
            .contains_key(&("parent".into(), "iframe".into())));
        assert!(!state.child_frame_roots.contains_key("old-target"));
        assert!(!state.child_frame_roots.contains_key("nested-target"));
        assert!(!state.owners.contains_key("old-target"));
        assert!(!state.owners.contains_key("nested-target"));
        assert_eq!(fence.lookup(token, "old-target", "iframe"), None);
        assert_eq!(fence.lookup(token, "old-target", "nested"), None);
        assert_eq!(fence.lookup(token, "nested-target", "nested-root"), None);
        assert_eq!(
            fence.lookup(token, "parent", "container"),
            Some(owner.clone())
        );
        assert_eq!(
            fence.lookup(token, "parent", "sibling"),
            Some(owner.clone())
        );

        assert!(record_frame_attachment(
            &fence,
            &mut state,
            "parent",
            "iframe",
            "container",
            10,
        ));
        assert!(fence.attach_descendant(token, "parent", "iframe", "container"));
        let tree = json!({"frameTree": {
            "frame": {"id": "iframe", "parentId": "container", "url": "https://example.test/"},
            "childFrames": [{
                "frame": {"id": "replacement-nested", "parentId": "iframe", "url": "about:blank"}
            }]
        }});
        let mut nodes = parse_child_frame_tree(&tree).unwrap();
        assert!(child_root_matches_attachment(
            &state, "parent", &nodes[0], 11, &owner
        ));
        nodes[0].parent_frame_id = None;
        assert!(fence.seed_child_snapshot(
            token,
            "replacement-target",
            "parent",
            "container",
            "iframe",
            &owner,
            &nodes,
        ));
        state.child_frame_roots.insert(
            "replacement-target".into(),
            ChildFrameAttachment {
                parent_session_id: "parent".into(),
                logical_frame_id: "iframe".into(),
            },
        );
        state
            .owners
            .insert("replacement-target".into(), owner.clone());
        state.frame_sessions.insert("replacement-target".into());
        assert_eq!(
            fence.lookup(token, "replacement-target", "replacement-nested"),
            Some(owner.clone())
        );

        retire_detached_frame(
            &fence,
            &mut state,
            token,
            "parent",
            "iframe",
            None,
            FrameDetachReason::Remove,
        );
        assert!(!state
            .frame_attached
            .contains_key(&("parent".into(), "iframe".into())));
        assert!(!state.child_frame_roots.contains_key("replacement-target"));
        assert_eq!(
            fence.lookup(token, "replacement-target", "replacement-nested"),
            None
        );
        assert_eq!(fence.lookup(token, "parent", "container"), Some(owner));
    }

    #[test]
    fn frame_attachment_capacity_updates_existing_facts_and_retires_unretainable_authority() {
        let fence = OwnershipFence::new();
        let token = fence.token(fence.start_next_generation().unwrap()).unwrap();
        let owner = download_owner();
        assert!(fence.seed_snapshot(
            token,
            "parent-session",
            owner.clone(),
            &[FrameSnapshotNode {
                frame_id: "container".into(),
                parent_frame_id: None
            },]
        ));
        assert!(fence.install(token, || true, || {}));
        let mut state = ObserverState::default();
        for index in 0..MAX_OBSERVER_FRAME_ATTACHMENTS {
            assert!(record_frame_attachment(
                &fence,
                &mut state,
                "parent-session",
                &format!("frame-{index}"),
                "container",
                index as u64,
            ));
        }
        assert_eq!(state.frame_attached.len(), MAX_OBSERVER_FRAME_ATTACHMENTS);
        assert!(record_frame_attachment(
            &fence,
            &mut state,
            "parent-session",
            "frame-0",
            "replacement-container",
            9_000,
        ));
        assert_eq!(
            state
                .frame_attached
                .get(&("parent-session".into(), "frame-0".into())),
            Some(&("replacement-container".into(), 9_000)),
        );
        assert_eq!(
            fence.lookup(token, "parent-session", "container"),
            Some(owner.clone())
        );
        assert!(!record_frame_attachment(
            &fence,
            &mut state,
            "parent-session",
            "unretained-frame",
            "container",
            9_001,
        ));
        assert_eq!(state.frame_attached.len(), MAX_OBSERVER_FRAME_ATTACHMENTS);
        assert!(!state
            .frame_attached
            .contains_key(&("parent-session".into(), "unretained-frame".into(),)));
        assert_eq!(fence.lookup(token, "parent-session", "container"), None);
        let mut stale_publish = false;
        assert!(!fence.commit(token, || stale_publish = true));
        assert!(!stale_publish);
        assert!(!fence.seed_snapshot(
            token,
            "late-snapshot",
            owner,
            &[FrameSnapshotNode {
                frame_id: "late".into(),
                parent_frame_id: None
            },]
        ));
    }

    fn download_owner() -> FrameOwner {
        FrameOwner {
            principal: "alice".into(),
            is_dev: true,
            browser_incarnation: "incarnation".into(),
            profile_epoch: 1,
            logical_session_id: "logical".into(),
            native_target_id: "target".into(),
            attachment_generation: 7,
        }
    }
    fn connection_token() -> ValidityToken {
        let fence = OwnershipFence::new();
        let connection = fence.start_next_generation().unwrap();
        fence.token(connection).unwrap()
    }

    #[test]
    fn child_frame_proof_requires_parent_frame_event_before_child_attach() {
        assert!(parent_frame_predates_child_attach(Some(4), 5));
        assert!(!parent_frame_predates_child_attach(Some(5), 5));
        assert!(!parent_frame_predates_child_attach(Some(6), 5));
        assert!(!parent_frame_predates_child_attach(None, 5));
    }

    #[test]
    fn download_guid_binding_is_idempotent_and_never_rebound() {
        let owner = download_owner();
        let token = connection_token();
        let binding = DownloadBinding::new(
            owner.clone(),
            Some("page-a".into()),
            "frame-a".into(),
            token,
            "file.txt".into(),
        );
        let same_owner_other_session = DownloadBinding::new(
            owner.clone(),
            Some("page-b".into()),
            "frame-b".into(),
            token,
            "different.txt".into(),
        );
        let conflicting = DownloadBinding::new(
            FrameOwner {
                logical_session_id: "other".into(),
                ..owner
            },
            Some("page-c".into()),
            "frame-c".into(),
            token,
            "other.txt".into(),
        );
        assert_eq!(
            classify_download_begin(None, &binding),
            DownloadBeginDisposition::New
        );
        let retained = GuidEntry::Bound(binding.clone());
        assert_eq!(
            classify_download_begin(Some(&retained), &same_owner_other_session),
            DownloadBeginDisposition::Duplicate,
        );
        assert_eq!(
            classify_download_begin(Some(&retained), &conflicting),
            DownloadBeginDisposition::Conflicting,
        );
        let poisoned = GuidEntry::Tombstone;
        assert_eq!(
            classify_download_begin(Some(&poisoned), &binding),
            DownloadBeginDisposition::Poisoned,
        );
        let pending = GuidEntry::Pending {
            reservation: 1,
            owner: binding.owner.clone(),
        };
        assert_eq!(
            classify_download_begin(Some(&pending), &binding),
            DownloadBeginDisposition::Duplicate,
        );
        assert_eq!(
            classify_download_begin(Some(&pending), &conflicting),
            DownloadBeginDisposition::Conflicting,
        );
    }

    #[test]
    fn download_progress_validates_emitter_without_current_frame_lookup() {
        use std::collections::{HashMap, HashSet};

        let owner = download_owner();
        let token = connection_token();
        let binding = DownloadBinding::new(
            owner.clone(),
            Some("source".into()),
            "frame".into(),
            token,
            "file.txt".into(),
        );
        let no_sessions = HashMap::new();
        assert!(download_progress_allowed(
            &binding,
            token,
            Some("source"),
            &HashSet::new(),
            &no_sessions,
            "inProgress",
            0,
            0,
            None,
        ));
        assert!(!download_progress_allowed(
            &binding,
            token,
            Some("foreign"),
            &HashSet::new(),
            &no_sessions,
            "inProgress",
            0,
            0,
            None,
        ));
        assert!(download_progress_allowed(
            &binding,
            token,
            None,
            &HashSet::new(),
            &no_sessions,
            "inProgress",
            0,
            0,
            None,
        ));
        let new_token = connection_token();
        let replacement = FrameOwner {
            attachment_generation: 8,
            ..owner.clone()
        };
        let replacement_sessions = HashMap::from([("replacement".to_string(), replacement)]);
        let no_proven_sessions = HashSet::new();
        assert!(!download_progress_allowed(
            &binding,
            new_token,
            Some("replacement"),
            &no_proven_sessions,
            &replacement_sessions,
            "inProgress",
            0,
            0,
            None,
        ));
        let proven_sessions = HashSet::from(["replacement".to_string()]);
        assert!(download_progress_allowed(
            &binding,
            new_token,
            Some("replacement"),
            &proven_sessions,
            &replacement_sessions,
            "inProgress",
            0,
            0,
            None,
        ));
        assert!(!download_progress_allowed(
            &binding,
            new_token,
            Some("source"),
            &no_proven_sessions,
            &no_sessions,
            "inProgress",
            0,
            0,
            None,
        ));

        let mut completed = binding.clone();
        completed.terminal = Some(DownloadTerminal::Completed);
        completed.terminal_path = Some("/tmp/file.txt".into());
        completed.terminal_received_bytes = Some(12);
        completed.terminal_total_bytes = Some(12);
        assert!(download_progress_allowed(
            &completed,
            new_token,
            None,
            &HashSet::new(),
            &no_sessions,
            "completed",
            12,
            12,
            Some("/tmp/file.txt"),
        ));
        assert!(!download_progress_allowed(
            &completed,
            new_token,
            None,
            &HashSet::new(),
            &no_sessions,
            "completed",
            12,
            12,
            Some("/tmp/other.txt"),
        ));
        assert!(!download_progress_allowed(
            &completed,
            new_token,
            None,
            &HashSet::new(),
            &no_sessions,
            "completed",
            11,
            12,
            Some("/tmp/file.txt"),
        ));
        assert!(!download_progress_allowed(
            &completed,
            new_token,
            None,
            &HashSet::new(),
            &no_sessions,
            "inProgress",
            12,
            12,
            None,
        ));
        completed.terminal = Some(DownloadTerminal::Canceled);
        assert!(!download_progress_allowed(
            &completed,
            new_token,
            None,
            &HashSet::new(),
            &no_sessions,
            "completed",
            12,
            12,
            Some("/tmp/file.txt"),
        ));
    }

    #[test]
    fn expired_guids_are_compacted_without_rebinding() {
        use super::{DownloadBindings, GuidEntry, TERMINAL_GUID_RETENTION};
        use std::time::{Duration, Instant};

        let now = Instant::now();
        let binding = DownloadBinding::new(
            download_owner(),
            Some("source".into()),
            "frame".into(),
            connection_token(),
            "file.txt".into(),
        );
        let mut expired_binding = binding.clone();
        expired_binding.terminal_at = Some(now - TERMINAL_GUID_RETENTION - Duration::from_secs(1));
        let mut live_binding = binding;
        live_binding.terminal_at = Some(now);
        let mut downloads = DownloadBindings::default();
        downloads
            .entries
            .insert("expired".into(), GuidEntry::Bound(expired_binding));
        downloads
            .entries
            .insert("live".into(), GuidEntry::Bound(live_binding));
        downloads
            .entries
            .insert("tombstone".into(), GuidEntry::Tombstone);

        downloads.expire_terminal_entries(now);

        assert!(!downloads.entries.contains_key("expired"));
        assert!(!downloads.entries.contains_key("tombstone"));
        assert!(downloads.expired.contains("expired"));
        assert!(downloads.expired.contains("tombstone"));
        assert!(downloads.entries.contains_key("live"));
        let candidate = DownloadBinding::new(
            download_owner(),
            Some("source".into()),
            "frame".into(),
            connection_token(),
            "file.txt".into(),
        );
        assert!(downloads.reserve_begin("expired", &candidate).is_none());
        assert!(downloads.reserve_begin("tombstone", &candidate).is_none());
        assert!(downloads.reserve_begin("live", &candidate).is_none());
    }

    #[test]
    fn dispatcher_guid_reservation_rejects_duplicate_conflict_and_stale_rebind() {
        use super::DownloadBindings;

        let original = DownloadBinding::new(
            download_owner(),
            Some("source-a".into()),
            "frame-a".into(),
            connection_token(),
            "a.txt".into(),
        );
        let mut competing = DownloadBinding::new(
            download_owner(),
            Some("source-b".into()),
            "frame-b".into(),
            connection_token(),
            "b.txt".into(),
        );
        competing.frame_owner.native_target_id = "other-target".into();
        competing.owner.native_target_id = "other-target".into();

        let mut downloads = DownloadBindings::default();
        assert!(downloads.reserve_begin("guid-a", &original).is_some());
        assert!(downloads.reserve_begin("guid-a", &original).is_none());
        assert!(downloads.reserve_begin("guid-a", &competing).is_none());
        assert!(matches!(
            downloads.entries.get("guid-a"),
            Some(GuidEntry::Tombstone)
        ));
        assert!(downloads.reserve_begin("guid-a", &original).is_none());
    }
    #[test]
    fn capacity_denials_remain_poisoned_after_filter_saturation() {
        use super::{DownloadBindings, ExpiredGuidFilter, GuidEntry, MAX_DOWNLOAD_GUIDS};

        let candidate = DownloadBinding::new(
            download_owner(),
            Some("source".into()),
            "frame".into(),
            connection_token(),
            "file.txt".into(),
        );
        let mut downloads = DownloadBindings::default();
        for index in 0..MAX_DOWNLOAD_GUIDS {
            downloads.entries.insert(
                format!("active-{index}"),
                GuidEntry::Pending {
                    reservation: index as u64,
                    owner: candidate.owner.clone(),
                },
            );
        }
        assert!(downloads
            .reserve_begin("capacity-denied", &candidate)
            .is_none());
        assert!(downloads.expired.contains("capacity-denied"));
        downloads.entries.remove("active-0");
        assert!(downloads
            .reserve_begin("capacity-denied", &candidate)
            .is_none());

        let mut saturated = ExpiredGuidFilter::default();
        for index in 0..20_000 {
            saturated.insert(&format!("retired-{index}"));
        }
        for index in 0..20_000 {
            assert!(saturated.contains(&format!("retired-{index}")));
        }
    }

    #[tokio::test]
    async fn manager_download_dispatch_isolates_owner_dtos_and_notifications() {
        let registry = SessionRegistry::new();
        let mut owners = Vec::new();
        for (target, frame, generation) in [("T1", "frame-a", 1), ("T2", "frame-b", 2)] {
            let request = CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".into(),
                viewport: ViewportRequest {
                    width: 800,
                    height: 600,
                    dpr: 1.0,
                },
            };
            let (dto, _) = registry
                .insert_running_for_test("alice", true, "inc1", 1, &request, &[])
                .await
                .unwrap();
            assert!(matches!(
                registry
                    .bind_native_target(&dto.browser_session_id, "inc1", target)
                    .await,
                super::super::session::BindOutcome::Bound
            ));
            owners.push((
                target,
                frame,
                FrameOwner {
                    principal: "alice".into(),
                    is_dev: true,
                    browser_incarnation: "inc1".into(),
                    profile_epoch: 1,
                    logical_session_id: dto.browser_session_id,
                    native_target_id: target.into(),
                    attachment_generation: generation,
                },
            ));
        }

        let fence = OwnershipFence::new();
        let connection = fence.start_next_generation().unwrap();
        let token = fence.token(connection).unwrap();
        let mut state = ObserverState::default();
        for (target, frame, owner) in &owners {
            assert!(fence.seed_snapshot(
                token,
                target,
                owner.clone(),
                &[FrameSnapshotNode {
                    frame_id: (*frame).into(),
                    parent_frame_id: None
                }],
            ));
            state.frame_sessions.insert((*target).into());
            state.owners.insert((*target).into(), owner.clone());
        }
        assert!(fence.install(token, || true, || {}));

        let (_, frame_a, owner_a) = &owners[0];
        let (target_b, frame_b, owner_b) = &owners[1];
        let mut updates_a = registry
            .subscribe_session(&owner_a.logical_session_id, "alice", true, 1, "inc1")
            .await
            .unwrap();
        let mut updates_b = registry
            .subscribe_session(&owner_b.logical_session_id, "alice", true, 1, "inc1")
            .await
            .unwrap();
        updates_a.borrow_and_update();
        updates_b.borrow_and_update();
        let downloads = StdMutex::new(DownloadBindings::default());

        fn begin_event(frame_id: &str, guid: &str, filename: &str) -> CdpLifecycleEvent {
            CdpLifecycleEvent::DownloadWillBegin {
                session_id: None,
                frame_id: Some(frame_id.into()),
                guid: guid.into(),
                suggested_filename: filename.into(),
                _reservation: None,
            }
        }
        fn progress_event(
            session_id: Option<&str>,
            guid: &str,
            state: &str,
            received_bytes: u64,
            total_bytes: u64,
            file_path: Option<&str>,
        ) -> CdpLifecycleEvent {
            CdpLifecycleEvent::DownloadProgress {
                session_id: session_id.map(str::to_string),
                guid: guid.into(),
                state: state.into(),
                received_bytes,
                total_bytes,
                file_path: file_path.map(str::to_string),
                _reservation: None,
            }
        }

        dispatch_download_lifecycle_event(
            &registry,
            &downloads,
            &fence,
            token,
            &state,
            &begin_event(frame_a, "guid-a", "a.txt"),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(1), updates_a.changed())
            .await
            .expect("owner A begin notification timeout")
            .unwrap();
        assert!(!updates_b.has_changed().unwrap());

        dispatch_download_lifecycle_event(
            &registry,
            &downloads,
            &fence,
            token,
            &state,
            &begin_event(frame_b, "guid-b", "b.txt"),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(1), updates_b.changed())
            .await
            .expect("owner B begin notification timeout")
            .unwrap();
        assert!(!updates_a.has_changed().unwrap());

        dispatch_download_lifecycle_event(
            &registry,
            &downloads,
            &fence,
            token,
            &state,
            &progress_event(Some(target_b), "guid-a", "inProgress", 4, 10, None),
        )
        .await;
        assert!(!updates_a.has_changed().unwrap());
        assert!(!updates_b.has_changed().unwrap());
        dispatch_download_lifecycle_event(
            &registry,
            &downloads,
            &fence,
            token,
            &state,
            &progress_event(None, "guid-a", "completed", 10, 10, Some("/host/a.txt")),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(1), updates_a.changed())
            .await
            .expect("owner A progress notification timeout")
            .unwrap();
        assert!(!updates_b.has_changed().unwrap());

        dispatch_download_lifecycle_event(
            &registry,
            &downloads,
            &fence,
            token,
            &state,
            &progress_event(Some(target_b), "guid-b", "canceled", 4, 10, None),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(1), updates_b.changed())
            .await
            .expect("owner B progress notification timeout")
            .unwrap();
        assert!(!updates_a.has_changed().unwrap());

        let download_a = registry
            .get_session(&owner_a.logical_session_id, "alice")
            .await
            .unwrap()
            .last_download
            .unwrap();
        let download_b = registry
            .get_session(&owner_b.logical_session_id, "alice")
            .await
            .unwrap()
            .last_download
            .unwrap();
        assert_eq!(
            (
                download_a.guid.as_str(),
                download_a.suggested_filename.as_str(),
                download_a.state.as_str()
            ),
            ("guid-a", "a.txt", "completed")
        );
        assert_eq!(download_a.file_path.as_deref(), Some("/host/a.txt"));
        assert_eq!(
            (
                download_b.guid.as_str(),
                download_b.suggested_filename.as_str(),
                download_b.state.as_str()
            ),
            ("guid-b", "b.txt", "canceled")
        );
        assert_eq!(download_b.file_path, None);
        let update_a = updates_a.borrow().clone();
        let super::super::protocol::ServerControlEvent::SessionUpdated { session } = update_a
        else {
            panic!("owner A notification was not a session update");
        };
        assert_eq!(session.browser_session_id, owner_a.logical_session_id);
        let notified_a = session.last_download.unwrap();
        assert_eq!(notified_a.guid, "guid-a");
        assert_eq!(notified_a.suggested_filename, "a.txt");
        assert_eq!(notified_a.state, "completed");
        assert_eq!(notified_a.received_bytes, 10);
        assert_eq!(notified_a.total_bytes, 10);
        assert_eq!(notified_a.file_path.as_deref(), Some("/host/a.txt"));

        let update_b = updates_b.borrow().clone();
        let super::super::protocol::ServerControlEvent::SessionUpdated { session } = update_b
        else {
            panic!("owner B notification was not a session update");
        };
        assert_eq!(session.browser_session_id, owner_b.logical_session_id);
        let notified_b = session.last_download.unwrap();
        assert_eq!(notified_b.guid, "guid-b");
        assert_eq!(notified_b.suggested_filename, "b.txt");
        assert_eq!(notified_b.state, "canceled");
        assert_eq!(notified_b.received_bytes, 4);
        assert_eq!(notified_b.total_bytes, 10);
        assert_eq!(notified_b.file_path, None);
    }

    #[tokio::test]
    async fn retry_overflow_and_invalid_state_close_paused_children_without_resuming() {
        use super::{
            BrowserHostConfig, BrowserHostManager, BrowserInstanceHandle, FrameTreeRetry,
            InnerInstance, InstanceLifecycleState, NativeControl, NativeFaults, NetworkPolicy,
            ObserverShared, PendingChildResume,
        };
        use futures_util::{SinkExt, StreamExt};
        use std::sync::{Arc, Mutex as StdMutex};
        use tokio::sync::{mpsc, Mutex};
        use tokio_tungstenite::tungstenite::Message;
        use tokio_util::sync::CancellationToken;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let commands = Arc::new(StdMutex::new(
            Vec::<(String, Option<String>, Option<String>)>::new(),
        ));
        let recorded = commands.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
                let method = cmd["method"].as_str().unwrap().to_string();
                let target_id = cmd["params"]["targetId"].as_str().map(str::to_string);
                let session_id = cmd["sessionId"].as_str().map(str::to_string);
                recorded
                    .lock()
                    .unwrap()
                    .push((method.clone(), target_id, session_id));
                let result = if method == "Target.getTargets" {
                    json!({ "targetInfos": [] })
                } else {
                    json!({ "success": true })
                };
                let reply = json!({ "id": cmd["id"], "result": result });
                if ws
                    .send(Message::Text(reply.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        let tmp = tempfile::tempdir().unwrap();
        let manager = BrowserHostManager::new(
            BrowserHostConfig::default(),
            Some(tmp.path().to_path_buf()),
            CancellationToken::new(),
        );
        let profile = manager.profile_for("alice", true).unwrap();
        let handle = BrowserInstanceHandle {
            subject: "alice".into(),
            is_dev: true,
            pid: 1,
            ws_endpoint: format!("ws://{addr}"),
            browser_incarnation: "incarnation".into(),
            profile_epoch: 1,
            user_data_dir: profile.user_data_dir().to_path_buf(),
        };
        let control = Arc::new(
            NativeControl::connect_unobserved(&handle, Arc::new(NativeFaults::default()))
                .await
                .unwrap(),
        );
        let inst = Arc::new(Mutex::new(InnerInstance {
            profile,
            state: InstanceLifecycleState::Running,
            process: None,
            browser_incarnation: Some("incarnation".into()),
            profile_epoch: 1,
            active_viewers: 0,
            active_raw_cdp: 0,
            _held_lock: None,
            deletion_worker: None,
        }));
        let shared = ObserverShared {
            key: BrowserHostManager::principal_key("alice", true),
            subject: "alice".into(),
            is_dev: true,
            max_targets: 8,
            request_policy: Arc::new(
                NetworkPolicy::from_config(&BrowserHostConfig::default(), true).unwrap(),
            ),
            inst,
            native: manager.native.clone(),
            faults: Arc::new(NativeFaults::default()),
            downloads: manager.native.download_bindings_for("incarnation"),
            token: 1,
        };

        let conn = control.ownership_fence.start_next_generation().unwrap();
        let token = control.ownership_fence.token(conn).unwrap();
        let owner = download_owner();
        let (frame_tx, _frame_rx) = mpsc::channel(4);

        // 1. Retry queue overflow during request_frame_tree_with_budget closes paused child.
        let mut state = ObserverState::default();
        state.owners.insert("parent".into(), owner.clone());
        state.frame_sessions.insert("parent".into());
        for index in 0..64 {
            state
                .pending_frames
                .insert(index + 1, child_root_pending(MAX_CHILD_ROOT_RESEEDS));
        }
        for index in 0..MAX_PENDING_FRAME_TREE_RETRIES {
            assert!(state.queue_frame_tree_retry(
                format!("queued-{index}"),
                owner.clone(),
                token,
                None,
                None,
                MAX_CHILD_ROOT_RESEEDS,
            ));
        }
        state.owners.insert("overflow-child".into(), owner.clone());
        state
            .pending_children
            .insert("overflow-child".into(), ("parent".into(), 5));
        state.pending_child_resumes.insert(
            "overflow-child".into(),
            PendingChildResume {
                attach_sequence: 5,
                target_id: "TARGET-OVERFLOW".into(),
            },
        );
        shared
            .request_frame_tree_with_budget(
                &control,
                &mut state,
                "overflow-child",
                owner.clone(),
                token,
                Some("parent".into()),
                Some(5),
                MAX_CHILD_ROOT_RESEEDS,
                &frame_tx,
            )
            .await;
        assert!(!state.pending_child_resumes.contains_key("overflow-child"));
        assert!(!state.pending_children.contains_key("overflow-child"));
        assert!(!state.owners.contains_key("overflow-child"));
        assert!(state.rejected.contains("TARGET-OVERFLOW"));

        // 2. Owner mismatch, unrecognized child retry state, and invalidated token all close paused children.
        let mut state = ObserverState::default();
        state.owners.insert("parent".into(), owner.clone());
        state.frame_sessions.insert("parent".into());

        // Owner mismatch
        state.owners.insert(
            "mismatch-child".into(),
            FrameOwner {
                attachment_generation: 99,
                ..owner.clone()
            },
        );
        state
            .pending_children
            .insert("mismatch-child".into(), ("parent".into(), 6));
        state.pending_child_resumes.insert(
            "mismatch-child".into(),
            PendingChildResume {
                attach_sequence: 6,
                target_id: "TARGET-MISMATCH".into(),
            },
        );
        state.frame_tree_retries.insert(
            "mismatch-child".into(),
            FrameTreeRetry {
                owner: owner.clone(),
                token,
                child_parent_session: Some("parent".into()),
                child_attach_sequence: Some(6),
                reseed_budget: MAX_CHILD_ROOT_RESEEDS,
                next_attempt: std::time::Instant::now() - Duration::from_secs(1),
            },
        );

        // Unrecognized retry state (missing pending_children record)
        state
            .owners
            .insert("unrecognized-child".into(), owner.clone());
        state.pending_child_resumes.insert(
            "unrecognized-child".into(),
            PendingChildResume {
                attach_sequence: 7,
                target_id: "TARGET-UNRECOGNIZED".into(),
            },
        );
        state.frame_tree_retries.insert(
            "unrecognized-child".into(),
            FrameTreeRetry {
                owner: owner.clone(),
                token,
                child_parent_session: Some("parent".into()),
                child_attach_sequence: Some(7),
                reseed_budget: MAX_CHILD_ROOT_RESEEDS,
                next_attempt: std::time::Instant::now() - Duration::from_secs(1),
            },
        );

        // Token invalidated
        assert!(control.ownership_fence.invalidate(conn));
        let fresh_token = control.ownership_fence.token(conn).unwrap();
        state
            .owners
            .insert("stale-token-child".into(), owner.clone());
        state
            .pending_children
            .insert("stale-token-child".into(), ("parent".into(), 8));
        state.pending_child_resumes.insert(
            "stale-token-child".into(),
            PendingChildResume {
                attach_sequence: 8,
                target_id: "TARGET-STALE-TOKEN".into(),
            },
        );
        state.frame_tree_retries.insert(
            "stale-token-child".into(),
            FrameTreeRetry {
                owner,
                token,
                child_parent_session: Some("parent".into()),
                child_attach_sequence: Some(8),
                reseed_budget: MAX_CHILD_ROOT_RESEEDS,
                next_attempt: std::time::Instant::now() - Duration::from_secs(1),
            },
        );
        assert_ne!(token, fresh_token);

        shared
            .retry_pending_frame_trees(&control, &mut state, &frame_tx)
            .await;

        assert!(state.frame_tree_retries.is_empty());
        assert!(state.pending_child_resumes.is_empty());
        for (session, target) in [
            ("mismatch-child", "TARGET-MISMATCH"),
            ("unrecognized-child", "TARGET-UNRECOGNIZED"),
            ("stale-token-child", "TARGET-STALE-TOKEN"),
        ] {
            assert!(!state.pending_children.contains_key(session));
            assert!(!state.owners.contains_key(session));
            assert!(state.rejected.contains(target));
        }

        let recorded = commands.lock().unwrap();
        assert!(!recorded
            .iter()
            .any(|(method, _, _)| method == "Runtime.runIfWaitingForDebugger"));
        for target in [
            "TARGET-OVERFLOW",
            "TARGET-MISMATCH",
            "TARGET-UNRECOGNIZED",
            "TARGET-STALE-TOKEN",
        ] {
            assert!(
                recorded.iter().any(|(method, tid, _)| {
                    method == "Target.closeTarget" && tid.as_deref() == Some(target)
                }),
                "missing Target.closeTarget for {target}"
            );
        }
    }

    #[tokio::test]
    async fn absent_target_during_recursive_setup_does_not_close_observer_while_live_target_fails_closed(
    ) {
        use super::{
            BrowserHostConfig, BrowserHostManager, BrowserInstanceHandle, InnerInstance,
            InstanceLifecycleState, NativeControl, NativeFaults, NetworkPolicy, ObserverShared,
            ObserverState,
        };
        use futures_util::{SinkExt, StreamExt};
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        use tokio::sync::{mpsc, Mutex};
        use tokio_tungstenite::tungstenite::Message;
        use tokio_util::sync::CancellationToken;

        async fn spawn_mock_cdp(
            target_still_present: Arc<AtomicBool>,
            setup_error_code: i64,
            setup_error_msg: &'static str,
        ) -> std::net::SocketAddr {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                while let Some(Ok(Message::Text(text))) = ws.next().await {
                    let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
                    let method = cmd["method"].as_str().unwrap();
                    let reply = match method {
                        "Page.enable" => json!({
                            "id": cmd["id"],
                            "error": { "code": setup_error_code, "message": setup_error_msg }
                        }),
                        "Target.getTargets" => {
                            let infos = if target_still_present.load(Ordering::SeqCst) {
                                json!([{ "targetId": "TARGET-GONE-RACE", "type": "page", "url": "about:blank" }])
                            } else {
                                json!([])
                            };
                            json!({ "id": cmd["id"], "result": { "targetInfos": infos } })
                        }
                        _ => json!({ "id": cmd["id"], "result": {} }),
                    };
                    if ws
                        .send(Message::Text(reply.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            });
            addr
        }

        async fn setup_shared(
            addr: std::net::SocketAddr,
        ) -> (ObserverShared, Arc<NativeControl>, tempfile::TempDir) {
            let tmp = tempfile::tempdir().unwrap();
            let manager = BrowserHostManager::new(
                BrowserHostConfig::default(),
                Some(tmp.path().to_path_buf()),
                CancellationToken::new(),
            );
            let profile = manager.profile_for("alice", true).unwrap();
            let handle = BrowserInstanceHandle {
                subject: "alice".into(),
                is_dev: true,
                pid: 1,
                ws_endpoint: format!("ws://{addr}"),
                browser_incarnation: "incarnation".into(),
                profile_epoch: 1,
                user_data_dir: profile.user_data_dir().to_path_buf(),
            };
            let control = Arc::new(
                NativeControl::connect_unobserved(&handle, Arc::new(NativeFaults::default()))
                    .await
                    .unwrap(),
            );
            let inst = Arc::new(Mutex::new(InnerInstance {
                profile,
                state: InstanceLifecycleState::Running,
                process: None,
                browser_incarnation: Some("incarnation".into()),
                profile_epoch: 1,
                active_viewers: 0,
                active_raw_cdp: 0,
                _held_lock: None,
                deletion_worker: None,
            }));
            let shared = ObserverShared {
                key: BrowserHostManager::principal_key("alice", true),
                subject: "alice".into(),
                is_dev: true,
                max_targets: 8,
                request_policy: Arc::new(
                    NetworkPolicy::from_config(&BrowserHostConfig::default(), true).unwrap(),
                ),
                inst,
                native: manager.native.clone(),
                faults: Arc::new(NativeFaults::default()),
                downloads: manager.native.download_bindings_for("incarnation"),
                token: 1,
            };
            (shared, control, tmp)
        }

        // Case 1: -32001 ("Session with given id not found.") + target absent -> no containment/close.
        let addr_absent = spawn_mock_cdp(
            Arc::new(AtomicBool::new(false)),
            -32001,
            "Session with given id not found.",
        )
        .await;
        let (shared_absent, control_absent, _tmp1) = setup_shared(addr_absent).await;
        let mut state = ObserverState::default();
        let (frame_tx, _frame_rx) = mpsc::channel(4);
        assert!(
            !shared_absent
                .retain_page_session(
                    &control_absent,
                    &mut state,
                    "sess-absent",
                    "TARGET-GONE-RACE",
                    true,
                    None,
                    &frame_tx,
                )
                .await
        );
        tokio::task::yield_now().await;
        assert!(
            !control_absent.is_closed(),
            "absent target during setup must not close observer client"
        );

        // Case 2: -32001 + target STILL present -> fail closed and close observer client.
        let addr_present = spawn_mock_cdp(
            Arc::new(AtomicBool::new(true)),
            -32001,
            "Session with given id not found.",
        )
        .await;
        let (shared_present, control_present, _tmp2) = setup_shared(addr_present).await;
        let mut state = ObserverState::default();
        assert!(
            !shared_present
                .retain_page_session(
                    &control_present,
                    &mut state,
                    "sess-present",
                    "TARGET-GONE-RACE",
                    true,
                    None,
                    &frame_tx,
                )
                .await
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(1), control_present.client.closed())
                .await
                .is_ok()
                && control_present.is_closed(),
            "live target failing recursive setup must close observer client"
        );

        // Case 3: non-gone error (-32603) even if target absent -> fail closed and close observer client.
        let addr_other =
            spawn_mock_cdp(Arc::new(AtomicBool::new(false)), -32603, "Internal error").await;
        let (shared_other, control_other, _tmp3) = setup_shared(addr_other).await;
        let mut state = ObserverState::default();
        assert!(
            !shared_other
                .retain_page_session(
                    &control_other,
                    &mut state,
                    "sess-other",
                    "TARGET-GONE-RACE",
                    true,
                    None,
                    &frame_tx,
                )
                .await
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(1), control_other.client.closed())
                .await
                .is_ok()
                && control_other.is_closed(),
            "unexpected protocol error during setup must close observer client"
        );
    }

    #[tokio::test]
    async fn worker_child_attached_applies_cached_ua_override_and_resumes_and_oopif_admits_during_parent_frame_tree(
    ) {
        use super::{
            BrowserHostConfig, BrowserHostManager, BrowserInstanceHandle, FrameOwner,
            InnerInstance, InstanceLifecycleState, NativeControl, NativeFaults, NativeTargetInfo,
            NetworkPolicy, ObserverShared, ObserverState, OwnershipFence, PendingFrameTree,
        };
        use crate::browser_host::cdp::{CdpStreamPosition, CdpTargetEvent};
        use futures_util::{SinkExt, StreamExt};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex as StdMutex,
        };
        use tokio::sync::{mpsc, Mutex};
        use tokio_tungstenite::tungstenite::Message;
        use tokio_util::sync::CancellationToken;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let get_version_count = Arc::new(AtomicUsize::new(0));
        let recorded = Arc::new(StdMutex::new(Vec::<(String, Option<String>, serde_json::Value)>::new()));
        let get_version_count_srv = get_version_count.clone();
        let recorded_srv = recorded.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
                let method = cmd["method"].as_str().unwrap().to_string();
                let sid = cmd["sessionId"].as_str().map(str::to_string);
                recorded_srv
                    .lock()
                    .unwrap()
                    .push((method.clone(), sid.clone(), cmd["params"].clone()));
                let reply = match method.as_str() {
                    "Browser.getVersion" => {
                        get_version_count_srv.fetch_add(1, Ordering::SeqCst);
                        json!({
                            "id": cmd["id"],
                            "result": {
                                "product": "Chrome/156.0.8078.79",
                                "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36"
                            }
                        })
                    }
                    "Emulation.setUserAgentOverride" if sid.as_deref() == Some("worker-err") => {
                        json!({
                            "id": cmd["id"],
                            "error": { "code": -32601, "message": "not supported" }
                        })
                    }
                    _ => json!({ "id": cmd["id"], "result": {} }),
                };
                if ws
                    .send(Message::Text(reply.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        let tmp = tempfile::tempdir().unwrap();
        let manager = BrowserHostManager::new(
            BrowserHostConfig::default(),
            Some(tmp.path().to_path_buf()),
            CancellationToken::new(),
        );
        let profile = manager.profile_for("alice", true).unwrap();
        let handle = BrowserInstanceHandle {
            subject: "alice".into(),
            is_dev: true,
            pid: 1,
            ws_endpoint: format!("ws://{addr}"),
            browser_incarnation: "inc-worker".into(),
            profile_epoch: 1,
            user_data_dir: profile.user_data_dir().to_path_buf(),
        };
        let control = Arc::new(
            NativeControl::connect_unobserved(&handle, Arc::new(NativeFaults::default()))
                .await
                .unwrap(),
        );
        let inst = Arc::new(Mutex::new(InnerInstance {
            profile,
            state: InstanceLifecycleState::Running,
            process: None,
            browser_incarnation: Some("inc-worker".into()),
            profile_epoch: 1,
            active_viewers: 0,
            active_raw_cdp: 0,
            _held_lock: None,
            deletion_worker: None,
        }));
        let shared = ObserverShared {
            key: BrowserHostManager::principal_key("alice", true),
            subject: "alice".into(),
            is_dev: true,
            max_targets: 8,
            request_policy: Arc::new(
                NetworkPolicy::from_config(&BrowserHostConfig::default(), true).unwrap(),
            ),
            inst,
            native: manager.native.clone(),
            faults: Arc::new(NativeFaults::default()),
            downloads: manager.native.download_bindings_for("inc-worker"),
            token: 1,
        };

        let fence = OwnershipFence::new();
        let conn = fence.start_next_generation().unwrap();
        let token = fence.token(conn).unwrap();
        let owner = FrameOwner {
            principal: "alice".into(),
            is_dev: true,
            browser_incarnation: "inc-worker".into(),
            profile_epoch: 1,
            logical_session_id: "logical-1".into(),
            native_target_id: "PAGE-1".into(),
            attachment_generation: 1,
        };
        let mut state = ObserverState::default();
        state.owners.insert("page-sess".into(), owner.clone());
        state.pending_frames.insert(
            1,
            PendingFrameTree {
                session_id: "page-sess".into(),
                owner: owner.clone(),
                token,
                child_parent_session: None,
                child_attach_sequence: None,
                barrier: None,
                result: None,
                changed: false,
                detached: Vec::new(),
                detach_overflow: false,
                reseed_budget: 2,
            },
        );
        let (frame_tx, _frame_rx) = mpsc::channel(4);

        // 1. Paused OOPIF attaching while parent's Page.getFrameTree is still in flight is queued, not closed.
        let iframe_ev = CdpTargetEvent::ChildAttached {
            parent_session_id: "page-sess".into(),
            session_id: "oopif-sess".into(),
            info: NativeTargetInfo {
                target_id: "OOPIF-TARGET".into(),
                target_type: "iframe".into(),
                url: "https://challenges.cloudflare.com/turnstile".into(),
                opener_id: None,
            },
            waiting_for_debugger: true,
            _reservation: None,
        };
        shared
            .handle_event(
                &control,
                &mut state,
                &iframe_ev,
                Some(token),
                CdpStreamPosition { generation: 1, sequence: 10 },
                &frame_tx,
            )
            .await;
        assert!(state.pending_children.contains_key("oopif-sess"));
        assert!(state.pending_child_resumes.contains_key("oopif-sess"));
        assert!(!state.rejected.contains("OOPIF-TARGET"));

        // 2. Worker attaches: receives cached full-version UA override then resumes & detaches.
        for worker_sid in ["worker-ok", "worker-err"] {
            let worker_ev = CdpTargetEvent::ChildAttached {
                parent_session_id: "oopif-sess".into(),
                session_id: worker_sid.into(),
                info: NativeTargetInfo {
                    target_id: format!("T-{worker_sid}"),
                    target_type: "worker".into(),
                    url: "blob:https://challenges.cloudflare.com/w".into(),
                    opener_id: None,
                },
                waiting_for_debugger: true,
                _reservation: None,
            };
            shared
                .handle_event(
                    &control,
                    &mut state,
                    &worker_ev,
                    Some(token),
                    CdpStreamPosition { generation: 1, sequence: 11 },
                    &frame_tx,
                )
                .await;
        }
        assert_eq!(get_version_count.load(Ordering::SeqCst), 1);

        // 3. Revoked parent (owners present, no active/pending frame tree) still fails closed for paused iframe.
        state.pending_frames.clear();
        let revoked_iframe_ev = CdpTargetEvent::ChildAttached {
            parent_session_id: "page-sess".into(),
            session_id: "oopif-revoked".into(),
            info: NativeTargetInfo {
                target_id: "OOPIF-REVOKED".into(),
                target_type: "iframe".into(),
                url: "https://challenges.cloudflare.com/turnstile".into(),
                opener_id: None,
            },
            waiting_for_debugger: true,
            _reservation: None,
        };
        shared
            .handle_event(
                &control,
                &mut state,
                &revoked_iframe_ev,
                Some(token),
                CdpStreamPosition { generation: 1, sequence: 12 },
                &frame_tx,
            )
            .await;
        assert!(state.rejected.contains("OOPIF-REVOKED"));

        let cmds = recorded.lock().unwrap();
        assert!(cmds.iter().any(|(m, s, p)| {
            m == "Emulation.setUserAgentOverride"
                && s.as_deref() == Some("worker-ok")
                && p["userAgentMetadata"]["fullVersion"] == "156.0.8078.79"
        }));
        assert!(cmds.iter().any(|(m, s, p)| {
            m == "Target.setAutoAttach"
                && s.as_deref() == Some("worker-ok")
                && p["waitForDebuggerOnStart"] == true
        }));
        assert!(cmds.iter().any(|(m, s, p)| {
            m == "Runtime.evaluate"
                && s.as_deref() == Some("worker-ok")
                && p["expression"]
                    .as_str()
                    .is_some_and(|e| e.contains("Symbol.for('dh.ws')"))
        }));
        assert!(cmds.iter().any(|(m, s, _)| {
            m == "Runtime.runIfWaitingForDebugger" && s.as_deref() == Some("worker-ok")
        }));
        assert!(cmds.iter().any(|(m, s, _)| {
            m == "Runtime.runIfWaitingForDebugger" && s.as_deref() == Some("worker-err")
        }));
        assert!(!cmds.iter().any(|(m, _, p)| {
            m == "Target.detachFromTarget"
                && (p["sessionId"] == "worker-ok" || p["sessionId"] == "worker-err")
        }));
        assert!(cmds.iter().any(|(m, _, p)| {
            m == "Target.closeTarget" && p["targetId"] == "OOPIF-REVOKED"
        }));

        // 4. Pre-existing child frame seeded from parent Page.getFrameTree at sequence 0
        // predates an OOPIF ChildAttached that arrived while the snapshot was in flight (seq 10).
        state.frame_sessions.insert("page-sess".into());
        assert!(record_frame_attachment(
            &control.ownership_fence,
            &mut state,
            "page-sess",
            "CHILD-FRAME-1",
            "MAIN-FRAME",
            0,
        ));
        let child_root = FrameSnapshotNode {
            frame_id: "CHILD-FRAME-1".into(),
            parent_frame_id: Some("MAIN-FRAME".into()),
        };
        assert!(child_root_matches_attachment(
            &state,
            "page-sess",
            &child_root,
            10,
            &owner,
        ));
    }
}
fn retire_target_frames(
    control: &NativeControl,
    state: &mut ObserverState,
    downloads: &StdMutex<DownloadBindings>,
    target_id: &str,
    token: Option<ValidityToken>,
) {
    let sessions: HashSet<String> = state
        .owners
        .iter()
        .filter(|(_, owner)| owner.native_target_id == target_id)
        .map(|(session, _)| session.clone())
        .collect();
    for session in &sessions {
        if let Some(token) = token {
            control.ownership_fence.retire_session(token, session);
        }
        state.owners.remove(session);
        state.frame_sessions.remove(session);
    }
    state
        .frame_tree_retries
        .retain(|session, _| !sessions.contains(session));
    let mut downloads = downloads.lock().unwrap();
    downloads.expire_terminal_entries(Instant::now());
    for entry in downloads.entries.values_mut() {
        if matches!(entry, GuidEntry::Pending { owner, .. } if owner.native_target_id == target_id)
            || matches!(entry, GuidEntry::Bound(binding) if binding.owner.native_target_id == target_id)
        {
            *entry = GuidEntry::Tombstone;
        }
    }
    state
        .frame_attached
        .retain(|(session, _), _| !sessions.contains(session));
    state.child_frame_roots.retain(|child, attachment| {
        !sessions.contains(child) && !sessions.contains(&attachment.parent_session_id)
    });
    state
        .child_target_ids
        .retain(|child, _| !sessions.contains(child));
    state
        .pending_children
        .retain(|child, (parent, _)| !sessions.contains(child) && !sessions.contains(parent));
    state.pending_frames.retain(|_, pending| {
        !sessions.contains(&pending.session_id)
            && pending
                .child_parent_session
                .as_ref()
                .is_none_or(|parent| !sessions.contains(parent))
    });
    state
        .pending_child_resumes
        .retain(|session, _| !sessions.contains(session));
}

fn retire_session_frames(
    control: &NativeControl,
    state: &mut ObserverState,
    session_id: &str,
    token: Option<ValidityToken>,
) -> Vec<String> {
    retire_sessions_frames(control, state, [session_id.to_string()], token)
}

fn attachment_session_closure(
    state: &ObserverState,
    roots: impl IntoIterator<Item = String>,
) -> HashSet<String> {
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    for (child, (parent, _)) in &state.pending_children {
        children_by_parent
            .entry(parent.clone())
            .or_default()
            .push(child.clone());
    }
    let mut sessions = HashSet::new();
    let mut pending = Vec::new();
    for root in roots {
        if sessions.insert(root.clone()) {
            pending.push(root);
        }
    }
    while let Some(parent) = pending.pop() {
        if let Some(children) = children_by_parent.get(&parent) {
            for child in children {
                if sessions.insert(child.clone()) {
                    pending.push(child.clone());
                }
            }
        }
    }
    sessions
}

fn retire_sessions_frames(
    control: &NativeControl,
    state: &mut ObserverState,
    roots: impl IntoIterator<Item = String>,
    token: Option<ValidityToken>,
) -> Vec<String> {
    clear_attachment_sessions(&control.ownership_fence, state, roots, token, true)
}

fn clear_attachment_sessions(
    fence: &OwnershipFence,
    state: &mut ObserverState,
    roots: impl IntoIterator<Item = String>,
    token: Option<ValidityToken>,
    remove_owners: bool,
) -> Vec<String> {
    let sessions = attachment_session_closure(state, roots);
    if let Some(token) = token {
        fence.retire_sessions(token, &sessions);
    }
    for session in &sessions {
        if remove_owners {
            state.owners.remove(session);
        }
        state.frame_sessions.remove(session);
    }
    state
        .frame_attached
        .retain(|(session, _), _| !sessions.contains(session));
    state
        .pending_children
        .retain(|child, (parent, _)| !sessions.contains(child) && !sessions.contains(parent));
    state.child_frame_roots.retain(|child, attachment| {
        !sessions.contains(child) && !sessions.contains(&attachment.parent_session_id)
    });
    state
        .child_target_ids
        .retain(|child, _| !sessions.contains(child));
    state.pending_frames.retain(|_, pending| {
        !sessions.contains(&pending.session_id)
            && pending
                .child_parent_session
                .as_ref()
                .is_none_or(|parent| !sessions.contains(parent))
    });
    state
        .frame_tree_retries
        .retain(|session, _| !sessions.contains(session));
    let mut orphaned_paused_targets = Vec::new();
    state.pending_child_resumes.retain(|session, resume| {
        if sessions.contains(session) {
            orphaned_paused_targets.push(resume.target_id.clone());
            false
        } else {
            true
        }
    });
    orphaned_paused_targets
}
fn revoke_pending_attachment(
    control: &NativeControl,
    state: &mut ObserverState,
    pending: &PendingFrameTree,
) -> Vec<String> {
    clear_attachment_sessions(
        &control.ownership_fence,
        state,
        [pending.session_id.clone()],
        Some(pending.token),
        pending.child_parent_session.is_some(),
    )
}
/// Budget for re-requesting a child root after its parent session swaps the root frame; `None` means revoke.
fn child_root_swap_reseed_budget(
    pending: &PendingFrameTree,
    root_detaches: &[&PendingDetach],
) -> Option<u8> {
    let parent = pending.child_parent_session.as_deref()?;
    let [only] = root_detaches else { return None };
    (only.session_id.as_str() == parent && !only.removed && pending.reseed_budget > 0)
        .then(|| pending.reseed_budget - 1)
}

/// Records a detach against each pending tree it may affect; root relevance is decided at admission.
fn mark_pending_frame_detached(
    state: &mut ObserverState,
    session_id: &str,
    frame_id: &str,
    reason: FrameDetachReason,
) {
    for pending in state.pending_frames.values_mut().filter(|pending| {
        pending.session_id == session_id
            || pending.child_parent_session.as_deref() == Some(session_id)
    }) {
        pending.changed = true;
        if let Some(existing) = pending
            .detached
            .iter_mut()
            .find(|detach| detach.session_id == session_id && detach.frame_id == frame_id)
        {
            existing.removed |= reason != FrameDetachReason::Swap;
        } else if pending.detached.len() < MAX_PENDING_FRAME_DETACHES {
            pending.detached.push(PendingDetach {
                session_id: session_id.to_string(),
                frame_id: frame_id.to_string(),
                removed: reason != FrameDetachReason::Swap,
            });
        } else {
            pending.detach_overflow = true;
        }
    }
}
fn retire_frame_attachment_subtree(
    state: &mut ObserverState,
    session_id: &str,
    frame_id: &str,
    preserved_parent: Option<&str>,
) -> HashSet<String> {
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for ((session, child), (parent, _)) in &state.frame_attached {
        if session == session_id {
            children
                .entry(parent.clone())
                .or_default()
                .push(child.clone());
        }
    }
    let mut pending = vec![frame_id.to_string()];
    let mut retired = HashSet::new();
    while let Some(frame) = pending.pop() {
        if !retired.insert(frame.clone()) {
            continue;
        }
        if let Some(descendants) = children.get(&frame) {
            pending.extend(descendants.iter().cloned());
        }
    }
    state
        .frame_attached
        .retain(|(session, frame), (parent, _)| {
            session != session_id
                || !retired.contains(frame)
                || (frame == frame_id && preserved_parent == Some(parent.as_str()))
        });
    retired
}
fn frame_detach_preserved_parent(
    state: &ObserverState,
    session_id: &str,
    frame_id: &str,
    reason: FrameDetachReason,
) -> Option<String> {
    if reason == FrameDetachReason::Swap {
        state
            .frame_attached
            .get(&(session_id.to_string(), frame_id.to_string()))
            .map(|(parent, _)| parent.clone())
    } else {
        None
    }
}

fn record_frame_attachment(
    fence: &OwnershipFence,
    state: &mut ObserverState,
    session_id: &str,
    frame_id: &str,
    parent_frame_id: &str,
    sequence: u64,
) -> bool {
    let key = (session_id.to_string(), frame_id.to_string());
    if !state.frame_attached.contains_key(&key)
        && state.frame_attached.len() >= MAX_OBSERVER_FRAME_ATTACHMENTS
    {
        fence.retire_current();
        return false;
    }
    state
        .frame_attached
        .insert(key, (parent_frame_id.to_string(), sequence));
    true
}

fn child_sessions_to_retire(
    state: &ObserverState,
    parent_session: &str,
    retired_frames: &HashSet<String>,
) -> Vec<String> {
    state
        .child_frame_roots
        .iter()
        .filter(|(_, attachment)| {
            attachment.parent_session_id == parent_session
                && retired_frames.contains(&attachment.logical_frame_id)
        })
        .map(|(child_session, _)| child_session.clone())
        .collect()
}

fn retire_detached_frame(
    fence: &OwnershipFence,
    state: &mut ObserverState,
    token: ValidityToken,
    session_id: &str,
    frame_id: &str,
    preserved_parent: Option<&str>,
    reason: FrameDetachReason,
) -> Vec<String> {
    mark_pending_frame_detached(state, session_id, frame_id, reason);
    let retired_frames =
        retire_frame_attachment_subtree(state, session_id, frame_id, preserved_parent);
    let child_sessions = child_sessions_to_retire(state, session_id, &retired_frames);
    let mut orphaned_paused_targets = Vec::new();
    if !child_sessions.is_empty() {
        orphaned_paused_targets.extend(clear_attachment_sessions(
            fence,
            state,
            child_sessions,
            Some(token),
            true,
        ));
    }
    if let Some((sessions, session_root_retired)) =
        fence.detach_frame_and_sessions(token, session_id, frame_id)
    {
        if session_root_retired {
            let mut roots = sessions;
            roots.insert(session_id.to_string());
            orphaned_paused_targets.extend(clear_attachment_sessions(
                fence,
                state,
                roots,
                Some(token),
                false,
            ));
        } else {
            let child_sessions = sessions
                .into_iter()
                .filter(|child| child != session_id)
                .collect::<Vec<_>>();
            orphaned_paused_targets.extend(clear_attachment_sessions(
                fence,
                state,
                child_sessions,
                Some(token),
                true,
            ));
        }
    }
    orphaned_paused_targets
}

enum PageDisposition {
    Ignored,
    Managed,
    Raw,
    Popup,
    Rejected,
}

/// Connects the observer's browser-level CDP client, enables discovery and paused auto-attach,
/// reconciles the initial inventory and spawns the event loop. Returns only after the inventory
/// (and, for a fresh launch, the closing of the startup blank page) is done.
async fn start_observer(
    shared: ObserverShared,
    handle: &BrowserInstanceHandle,
    initial: bool,
) -> Result<(Arc<NativeControl>, JoinHandle<()>), ManagerError> {
    let (control, events) = connect_control(&shared, handle).await?;
    let (ready_tx, ready_rx) = oneshot::channel();
    let task_control = control.clone();
    let task = tokio::spawn(run_observer(
        shared,
        task_control,
        events,
        ready_tx,
        initial,
    ));
    match timeout(OBSERVER_INIT_TIMEOUT, ready_rx).await {
        Ok(Ok(Ok(()))) => Ok((control, task)),
        Ok(Ok(Err(msg))) => {
            task.abort();
            Err(ManagerError::Internal(format!(
                "native target observation failed to start: {msg}"
            )))
        }
        Ok(Err(_)) | Err(_) => {
            task.abort();
            Err(ManagerError::Timeout(
                "native target observation did not start in time".to_string(),
            ))
        }
    }
}

async fn connect_control(
    shared: &ObserverShared,
    handle: &BrowserInstanceHandle,
) -> Result<
    (
        Arc<NativeControl>,
        broadcast::Receiver<Arc<CdpOrderedRecord>>,
    ),
    ManagerError,
> {
    let ownership_fence = Arc::new(OwnershipFence::new());
    let client =
        CdpClient::connect_with_ownership_fence(&handle.ws_endpoint, ownership_fence.clone())
            .await
            .map_err(|e| {
                ManagerError::Internal(format!("native target observer connect failed: {e}"))
            })?;
    // Subscribed before discovery is enabled so no lifecycle event can precede the receiver.
    let events = client.subscribe_ordered_events();
    // Fetch's browser handler applies to newly created factories; it does not refresh
    // factories that existed before this connection. Establish policy before exposing
    // any native control, then retire only the startup workers with unknown provenance.
    let escalate = shared.policy_containment(&handle.browser_incarnation);
    client
        .install_browser_request_policy(shared.request_policy.clone(), escalate.clone())
        .await
        .map_err(|err| ManagerError::Internal(format!("browser request policy setup: {err}")))?;
    if let Err(err) = retire_pre_policy_workers(&client).await {
        escalate("pre-policy worker termination could not be proven");
        client.close().await;
        return Err(ManagerError::Internal(format!(
            "browser startup worker reconciliation: {err}"
        )));
    }
    let downloads_dir = super::cdp::resolve_host_downloads_dir();
    if let Err(err) = client
        .send_command(
            "Browser.setDownloadBehavior",
            Some(json!({
                "behavior": "allow",
                "downloadPath": downloads_dir.to_string_lossy(),
                "eventsEnabled": true,
            })),
            None,
        )
        .await
    {
        client.close().await;
        return Err(ManagerError::Internal(format!(
            "native download event setup failed: {err}"
        )));
    }
    let control = Arc::new(NativeControl {
        subject: shared.subject.clone(),
        is_dev: shared.is_dev,
        browser_incarnation: handle.browser_incarnation.clone(),
        profile_epoch: handle.profile_epoch,
        ws_endpoint: handle.ws_endpoint.clone(),
        client,
        faults: shared.faults.clone(),
        ownership_fence,
        inventory_optional: false,
        cached_ua_params: tokio::sync::Mutex::new(None),
    });
    Ok((control, events))
}

/// Profile data/registrations stay intact. Only running workers that could retain a
/// pre-policy loader factory are stopped; later page navigation restarts them under Fetch.
async fn retire_pre_policy_workers(client: &CdpClient) -> Result<(), CdpError> {
    let inventory = client.send_command("Target.getTargets", None, None).await?;
    let infos = inventory
        .get("targetInfos")
        .and_then(Value::as_array)
        .ok_or_else(|| CdpError::MalformedResponse("getTargets without targetInfos".into()))?;
    let mut workers = Vec::new();
    for info in infos {
        if matches!(
            info.get("type").and_then(Value::as_str),
            Some("worker" | "service_worker" | "shared_worker")
        ) {
            if workers.len() >= MAX_REJECTED_TARGETS {
                return Err(CdpError::MalformedResponse(
                    "startup worker inventory exceeds bound".into(),
                ));
            }
            let id = info
                .get("targetId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= MAX_TARGET_ID_LEN)
                .ok_or_else(|| {
                    CdpError::MalformedResponse("startup worker has invalid targetId".into())
                })?;
            workers.push(id.to_string());
        }
    }
    if workers.is_empty() {
        return Ok(());
    }
    warn!(
        count = workers.len(),
        "retiring startup workers with pre-policy loader factories"
    );
    for id in &workers {
        // The proof, not a successful close acknowledgement, establishes containment.
        let _ = client
            .send_command("Target.closeTarget", Some(json!({"targetId": id})), None)
            .await;
    }
    for attempt in 0..CLOSE_VERIFY_ATTEMPTS {
        let inventory = client.send_command("Target.getTargets", None, None).await?;
        let infos = inventory
            .get("targetInfos")
            .and_then(Value::as_array)
            .ok_or_else(|| CdpError::MalformedResponse("getTargets without targetInfos".into()))?;
        workers.retain(|id| {
            infos
                .iter()
                .any(|info| info.get("targetId").and_then(Value::as_str) == Some(id.as_str()))
        });
        if workers.is_empty() {
            return Ok(());
        }
        if attempt + 1 < CLOSE_VERIFY_ATTEMPTS {
            // A service worker can still be starting when the first close is accepted.
            // Reclose only surviving original ids; workers born after policy installation
            // have policed factories and must keep running. Absence remains the proof.
            sleep(CLOSE_VERIFY_INTERVAL).await;
            for id in &workers {
                let _ = client
                    .send_command("Target.closeTarget", Some(json!({"targetId": id})), None)
                    .await;
            }
        }
    }
    Err(CdpError::Transport(
        "pre-policy worker remains in native inventory".into(),
    ))
}

async fn run_observer(
    shared: ObserverShared,
    mut control: Arc<NativeControl>,
    mut events: broadcast::Receiver<Arc<CdpOrderedRecord>>,
    ready: oneshot::Sender<Result<(), String>>,
    initial: bool,
) {
    // Covers bounded observer provenance maps plus peak local traversal/staging scratch.
    let _observer_state_reservation =
        match super::diagnostics::global_memory_controller().try_reserve(8 * 1024 * 1024) {
            Ok(reservation) => reservation,
            Err(error) => {
                let _ = ready.send(Err(format!(
                    "observer state memory admission failed: {error}"
                )));
                return;
            }
        };
    let mut state = ObserverState::default();
    let (frame_tx, mut frame_rx) =
        mpsc::channel::<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>(64);
    let mut position = None;
    let mut sweep = tokio::time::interval(PENDING_CLOSE_SWEEP);
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    match shared.init(&control, &mut state, initial).await {
        Ok(()) => {
            let _ = ready.send(Ok(()));
        }
        Err(msg) => {
            let _ = ready.send(Err(msg));
            return;
        }
    }
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(record) => {
                    let contiguous = ordered_position_follows(position, record.position);
                    let lost = !contiguous
                        || matches!(&record.event, CdpOrderedEvent::Overflow | CdpOrderedEvent::Disconnected)
                        || matches!(&record.event, CdpOrderedEvent::Lifecycle(event) if matches!(&**event, CdpLifecycleEvent::Overflow))
                        || matches!(&record.event, CdpOrderedEvent::Target(event) if matches!(&**event, CdpTargetEvent::Overflow));
                    if lost {
                        warn!("native ordered event stream lost authority; dropping observer");
                        // Lost attach events may leave pages paused and unobserved. Retire the
                        // policy transport even if another caller still holds a control clone;
                        // its shutdown transfers containment to the browser process owner.
                        shared.drop_entry();
                        control.client.close().await;
                        return;
                    }
                    position = Some(record.position);
                    match &record.event {
                        CdpOrderedEvent::Target(event) => {
                            shared.handle_event(&control, &mut state, event, record.validity_token, record.position, &frame_tx).await;
                        }
                        CdpOrderedEvent::SessionDetached { session_id, .. } => {
                            let paused_targets = retire_session_frames(&control, &mut state, session_id, record.validity_token);
                            shared.refuse_and_close_targets(&control, &mut state, paused_targets).await;
                        }
                        CdpOrderedEvent::Lifecycle(event) => {
                            if let Some(token) = record.validity_token {
                                shared.dispatch_lifecycle(&control, &mut state, token, record.position, event, &frame_tx).await;
                            }
                        }
                        CdpOrderedEvent::FrameTreeBarrier { command_id } => {
                            if let Some(pending) = state.pending_frames.get_mut(command_id) {
                                if record.validity_token == Some(pending.token) {
                                    pending.barrier = Some(record.position);
                                } else {
                                    pending.changed = true;
                                    pending.barrier = Some(record.position);
                                }
                            }
                            shared.finish_frame_tree(&control, &mut state, *command_id, &frame_tx).await;
                        }
                        CdpOrderedEvent::Overflow | CdpOrderedEvent::Disconnected => unreachable!(),
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    warn!("native ordered event stream lagged; dropping observer");
                    shared.drop_entry();
                    control.client.close().await;
                    return;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    shared.drop_entry();
                    control.client.close().await;
                    return;
                }
            },
            Some((id, token, result)) = frame_rx.recv() => {
                if state.pending_frames.get(&id).is_some_and(|pending| pending.token == token) {
                    if let Some(result) = result {
                        state.pending_frames.get_mut(&id).unwrap().result = Some(result);
                        shared.finish_frame_tree(&control, &mut state, id, &frame_tx).await;
                    } else if let Some(pending) = state.pending_frames.remove(&id) {
                        if pending.detach_overflow
                            || !state.queue_frame_tree_retry(
                                pending.session_id.clone(), pending.owner.clone(), pending.token,
                                pending.child_parent_session.clone(), pending.child_attach_sequence, pending.reseed_budget,
                            )
                        {
                            shared.revoke_pending_frame_tree(&control, &mut state, &pending).await;
                        }
                    }
                } else if result.is_none() {
                    if let Some(pending) = state.pending_frames.remove(&id) {
                        shared.revoke_pending_frame_tree(&control, &mut state, &pending).await;
                    }
                }
            },
            _ = sweep.tick() => {
                shared.retry_pending_frame_trees(&control, &mut state, &frame_tx).await;
                shared.flush_pending_close(&control, &mut state, PENDING_CLOSE_GRACE).await;
            }
            _ = control.client.closed() => {
                match shared.recover(&control).await {
                    Some((next, next_events)) => {
                        control = next;
                        events = next_events;
                        state = ObserverState::default();
                        position = None;
                        if let Err(msg) = shared.init(&control, &mut state, false).await {
                            warn!(error = %msg, "native target observer could not re-initialize");
                            shared.drop_entry();
                            return;
                        }
                    }
                    None => return,
                }
            }
        }
    }
}

impl ObserverShared {
    /// Weak captures avoid a cycle through the observer's client and its actor policy.
    fn policy_containment(&self, incarnation: &str) -> ContainmentEscalation {
        let inst = Arc::downgrade(&self.inst);
        let observers = Arc::downgrade(&self.native.observers);
        let containments = Arc::downgrade(&self.native.containments);
        let live_incarnations = Arc::downgrade(&self.native.live_incarnations);
        let global_process_count = Arc::downgrade(&self.native.global_process_count);
        let download_bindings = Arc::downgrade(&self.native.download_bindings);
        let sinks = self.native.sinks.clone();
        let key = self.key.clone();
        let incarnation = incarnation.to_string();
        Arc::new(move |reason| {
            let (
                Some(inst),
                Some(observers),
                Some(containments),
                Some(live_incarnations),
                Some(global_process_count),
                Some(download_bindings),
            ) = (
                inst.upgrade(),
                observers.upgrade(),
                containments.upgrade(),
                live_incarnations.upgrade(),
                global_process_count.upgrade(),
                download_bindings.upgrade(),
            )
            else {
                return;
            };
            let mut tasks = containments.lock().unwrap();
            let slot = (key.clone(), incarnation.clone());
            if tasks.get(&slot).is_some_and(|task| !task.is_finished()) {
                return;
            }
            warn!(reason, "containing browser request-policy incarnation");
            let native = NativeHandles {
                observers,
                containments: containments.clone(),
                live_incarnations,
                global_process_count,
                download_bindings,
                sinks: sinks.clone(),
            };
            let key = key.clone();
            let incarnation = incarnation.clone();
            tasks.insert(
                slot,
                tokio::spawn(async move {
                    let mut inst = inst.lock().await;
                    if inst.browser_incarnation.as_deref() != Some(incarnation.as_str())
                        || inst.process.is_none()
                    {
                        return;
                    }
                    if let Err(err) = native.reap_dead_instance(&key, &mut inst, true).await {
                        warn!(error = %err, "request-policy containment left cleanup pending");
                    }
                }),
            );
        })
    }

    fn registry(&self) -> &'static super::session::SessionRegistry {
        crate::api::browser_host::global_session_registry()
    }

    /// Removes this observer's entry without aborting the running task.
    fn drop_entry(&self) {
        let mut map = self.native.observers.lock().unwrap();
        if map.get(&self.key).is_some_and(|e| e.token == self.token) {
            map.remove(&self.key);
        }
    }

    fn is_registered(&self) -> bool {
        self.native
            .observers
            .lock()
            .unwrap()
            .get(&self.key)
            .is_some_and(|e| e.token == self.token)
    }

    async fn init(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        initial: bool,
    ) -> Result<(), String> {
        let client = &control.client;
        client
            .send_command(
                "Target.setDiscoverTargets",
                Some(json!({ "discover": true })),
                None,
            )
            .await
            .map_err(|e| format!("Target.setDiscoverTargets: {e}"))?;
        // New pages (including `window.open` popups) start paused so the request policy can
        // be installed before their first request; the observer resumes every one it pauses.
        client
            .send_command(
                "Target.setAutoAttach",
                Some(json!({
                    "autoAttach": true,
                    "waitForDebuggerOnStart": true,
                    "flatten": true,
                    "filter": [{ "type": "page" }, { "exclude": true }],
                })),
                None,
            )
            .await
            .map_err(|e| format!("Target.setAutoAttach: {e}"))?;
        self.reconcile_inventory(control, state, initial).await
    }

    /// Compares the browser's page inventory with the ledger. `initial` marks a fresh launch:
    /// every pre-existing page is the startup blank page and is closed (it must never hold an
    /// untracked page outside the shared cap).
    async fn reconcile_inventory(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        initial: bool,
    ) -> Result<(), String> {
        let pages = control
            .list_pages()
            .await
            .map_err(|e| format!("Target.getTargets: {e}"))?;
        if initial {
            for page in &pages {
                state.reject(&page.target_id);
                // Not provably gone: it keeps occupying a slot and is retried, never hidden.
                self.close_refused_page(control, state, &page.target_id)
                    .await;
            }
            return Ok(());
        }
        let present: HashSet<&str> = pages.iter().map(|p| p.target_id.as_str()).collect();
        // A refused page the inventory no longer lists is proven absent.
        state
            .pending_close
            .retain(|id, _| present.contains(id.as_str()));
        for (_, target_id) in self
            .registry()
            .bound_targets(&control.browser_incarnation)
            .await
        {
            if !present.contains(target_id.as_str()) {
                self.target_gone(control, &target_id).await;
            }
        }
        self.registry()
            .retain_raw_targets(&control.browser_incarnation, &present)
            .await;
        for page in &pages {
            self.observe_page(control, state, page).await;
        }
        // Pages found by inventory were never paused by this observer: close refusals now.
        self.flush_pending_close(control, state, Duration::ZERO)
            .await;
        Ok(())
    }

    async fn target_gone(&self, control: &Arc<NativeControl>, target_id: &str) {
        if let Some(departure) = self
            .registry()
            .native_destroyed(&control.browser_incarnation, target_id)
            .await
        {
            announce_departures(
                &self.native.sinks,
                vec![departure],
                "native target was destroyed",
            )
            .await;
        }
    }

    /// Marks a page refused: it is closed once its paused attach (if any) has been released.
    fn close_refused(&self, state: &mut ObserverState, id: &str) {
        state.reject(id);
        state.pending_close.insert(id.to_string(), Instant::now());
    }

    /// Closes a refused page. Only a proven absence ends the obligation; otherwise the page
    /// keeps a capacity slot (raw charge, unless a session already holds it) and stays in
    /// `pending_close`, so the sweep retries until the browser inventory no longer lists it.
    async fn close_refused_page(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        id: &str,
    ) {
        match control.close_page(id).await {
            NativeCloseOutcome::Absent => {
                state.pending_close.remove(id);
                self.target_gone(control, id).await;
            }
            NativeCloseOutcome::Unconfirmed(reason) => {
                warn!(error = %reason, "refused native page could not be proven closed; retrying");
                if matches!(
                    self.registry()
                        .classify_target(&control.browser_incarnation, id)
                        .await,
                    TargetClass::Unknown
                ) {
                    self.registry()
                        .admit_raw(&control.browser_incarnation, &self.subject, id, usize::MAX)
                        .await;
                }
                state.pending_close.insert(id.to_string(), Instant::now());
            }
        }
    }

    /// Closes refused pages whose attach event never arrived within `min_age`; failed closes
    /// are retried on later sweeps.
    async fn flush_pending_close(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        min_age: Duration,
    ) {
        let due: Vec<String> = state
            .pending_close
            .iter()
            .filter(|(_, since)| since.elapsed() >= min_age)
            .map(|(id, _)| id.clone())
            .collect();
        for id in due {
            self.close_refused_page(control, state, &id).await;
        }
    }

    /// Classifies and admits one page. Idempotent: events repeat per page.
    async fn observe_page(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        info: &NativeTargetInfo,
    ) -> PageDisposition {
        if info.target_type != "page" {
            return PageDisposition::Ignored;
        }
        if state.pending_popups.contains_key(&info.target_id) {
            return PageDisposition::Popup;
        }
        if state.rejected.contains(&info.target_id)
            || state.pending_close.contains_key(&info.target_id)
        {
            return PageDisposition::Rejected;
        }
        let incarnation = &control.browser_incarnation;
        match self
            .registry()
            .classify_target(incarnation, &info.target_id)
            .await
        {
            TargetClass::Session { .. } => return PageDisposition::Managed,
            TargetClass::Raw => return PageDisposition::Raw,
            TargetClass::Unknown => {}
        }
        // Creation marker: the page of a pending REST create (possibly whose response was lost).
        if let Some(session_id) = parse_creation_marker(&info.url) {
            return match self
                .registry()
                .bind_native_target(session_id, incarnation, &info.target_id)
                .await
            {
                BindOutcome::Bound => PageDisposition::Managed,
                // A second page for the same creation, or a creation that no longer exists:
                // proven surplus, closed (never the bound page).
                BindOutcome::Surplus { .. } | BindOutcome::NotPending => {
                    self.close_refused(state, &info.target_id);
                    PageDisposition::Rejected
                }
            };
        }
        if let Some(opener) = &info.opener_id {
            match self
                .registry()
                .admit_popup(
                    incarnation,
                    opener,
                    &info.target_id,
                    &info.url,
                    self.max_targets,
                )
                .await
            {
                PopupAdmission::Admitted {
                    session,
                    parent_session_id,
                    principal,
                    is_dev,
                } => {
                    state.pending_popups.insert(
                        info.target_id.clone(),
                        PendingPopup {
                            session_id: session.browser_session_id.clone(),
                            parent_session_id,
                            principal,
                            is_dev,
                        },
                    );
                    return PageDisposition::Popup;
                }
                PopupAdmission::Blocked { parent_session_id } => {
                    self.close_refused(state, &info.target_id);
                    let _ = self
                        .native
                        .sinks
                        .events
                        .send(NativeTargetEvent::PopupBlocked {
                            parent_session_id,
                            reason: format!(
                                "browser target capacity ({}) reached",
                                self.max_targets
                            ),
                        });
                    return PageDisposition::Rejected;
                }
                // Opener is not a managed session (e.g. a raw-created page): ordinary raw page.
                PopupAdmission::NotAPopup => {}
            }
        }
        // Raw authority is not a cap exemption.
        if self
            .registry()
            .admit_raw(
                incarnation,
                &self.subject,
                &info.target_id,
                self.max_targets,
            )
            .await
        {
            PageDisposition::Raw
        } else {
            self.close_refused(state, &info.target_id);
            let _ = self
                .native
                .sinks
                .events
                .send(NativeTargetEvent::TargetBlocked {
                    browser_incarnation: incarnation.clone(),
                    target_id: info.target_id.clone(),
                    reason: format!("browser target capacity ({}) reached", self.max_targets),
                });
            PageDisposition::Rejected
        }
    }

    async fn configure_recursive_session(
        &self,
        control: &Arc<NativeControl>,
        session_id: &str,
    ) -> Result<(), CdpError> {
        let client = &control.client;
        client
            .send_command("Page.enable", None, Some(session_id))
            .await?;
        let ua_params = control.ua_override_params().await;
        super::screencast::apply_stealth_before_resume(
            client,
            session_id,
            &ua_params,
        )
        .await?;
        client
            .send_command(
                "Target.setAutoAttach",
                Some(json!({
                    "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true,
                    "filter": [{ "type": "iframe" }, { "type": "worker" }, { "exclude": true }]
                })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    async fn confirm_gone_for_page_setup(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        target_id: &str,
        token: Option<ValidityToken>,
        error: &CdpError,
    ) -> bool {
        if is_session_or_target_gone_error(error) && control.confirm_target_absent(target_id).await
        {
            retire_target_frames(control, state, &self.downloads, target_id, token);
            self.target_gone(control, target_id).await;
            return true;
        }
        false
    }

    async fn retain_page_session(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        session_id: &str,
        target_id: &str,
        waiting: bool,
        token: Option<ValidityToken>,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) -> bool {
        if let Err(error) = self.configure_recursive_session(control, session_id).await {
            if self
                .confirm_gone_for_page_setup(control, state, target_id, token, &error)
                .await
            {
                debug!(
                    %error, session_id, target_id, target_type = "page",
                    "page target closed before recursive session setup completed",
                );
                return false;
            }
            warn!(
                %error, session_id, target_id, target_type = "page", waiting_for_debugger = waiting,
                "recursive page session setup failed",
            );
            (self.policy_containment(&control.browser_incarnation))(
                "page recursive attachment setup failed",
            );
            control.client.close().await;
            return false;
        }
        if let (
            Some(token),
            TargetClass::Session {
                session_id: logical_id,
                status,
            },
        ) = (
            token,
            self.registry()
                .classify_target(&control.browser_incarnation, target_id)
                .await,
        ) {
            if matches!(status, SessionStatus::Initializing | SessionStatus::Running) {
                if let Ok(snapshot) = self.registry().snapshot(&logical_id, &self.subject).await {
                    if snapshot.is_dev == self.is_dev
                        && snapshot.browser_incarnation == control.browser_incarnation
                        && snapshot.profile_epoch == control.profile_epoch
                        && snapshot.native_target_id.as_deref() == Some(target_id)
                        && matches!(
                            snapshot.status,
                            SessionStatus::Initializing | SessionStatus::Running
                        )
                    {
                        if let Ok(generation) = NEXT_ATTACHMENT_GENERATION.fetch_update(
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                            |n| n.checked_add(1),
                        ) {
                            let owner = FrameOwner {
                                principal: self.subject.clone(),
                                is_dev: self.is_dev,
                                browser_incarnation: control.browser_incarnation.clone(),
                                profile_epoch: control.profile_epoch,
                                logical_session_id: logical_id,
                                native_target_id: target_id.to_string(),
                                attachment_generation: generation,
                            };
                            state.owners.insert(session_id.to_string(), owner.clone());
                            self.request_frame_tree(
                                control, state, session_id, owner, token, None, None, frame_tx,
                            )
                            .await;
                        }
                    }
                }
            }
        }
        if waiting {
            if let Err(error) = control
                .client
                .send_command("Runtime.runIfWaitingForDebugger", None, Some(session_id))
                .await
            {
                if self
                    .confirm_gone_for_page_setup(control, state, target_id, token, &error)
                    .await
                {
                    debug!(
                        %error, session_id, target_id, target_type = "page",
                        "page target closed before debugger resume completed",
                    );
                    return false;
                }
                warn!(
                    %error, session_id, target_id, target_type = "page",
                    "page debugger resume failed",
                );
                (self.policy_containment(&control.browser_incarnation))("page resume failed");
                control.client.close().await;
                return false;
            }
        }
        true
    }

    async fn request_frame_tree(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        session_id: &str,
        owner: FrameOwner,
        token: ValidityToken,
        child_parent_session: Option<String>,
        child_attach_sequence: Option<u64>,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        self.request_frame_tree_with_budget(
            control,
            state,
            session_id,
            owner,
            token,
            child_parent_session,
            child_attach_sequence,
            MAX_CHILD_ROOT_RESEEDS,
            frame_tx,
        )
        .await;
    }

    async fn request_frame_tree_with_budget(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        session_id: &str,
        owner: FrameOwner,
        token: ValidityToken,
        child_parent_session: Option<String>,
        child_attach_sequence: Option<u64>,
        reseed_budget: u8,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        if state
            .pending_frames
            .values()
            .any(|pending| pending.session_id == session_id)
        {
            state.frame_tree_retries.remove(session_id);
            return;
        }
        let is_child = child_parent_session.is_some();
        if state.pending_frames.len() >= 64 {
            if !state.queue_frame_tree_retry(
                session_id.to_string(),
                owner,
                token,
                child_parent_session,
                child_attach_sequence,
                reseed_budget,
            ) {
                self.revoke_frame_tree_session(control, state, session_id, Some(token), is_child)
                    .await;
            }
            return;
        }
        let Ok(permit) = frame_tx.clone().try_reserve_owned() else {
            if !state.queue_frame_tree_retry(
                session_id.to_string(),
                owner,
                token,
                child_parent_session,
                child_attach_sequence,
                reseed_budget,
            ) {
                self.revoke_frame_tree_session(control, state, session_id, Some(token), is_child)
                    .await;
            }
            return;
        };
        let Ok(request) = control.client.begin_frame_tree_snapshot(Some(session_id)) else {
            if !state.queue_frame_tree_retry(
                session_id.to_string(),
                owner,
                token,
                child_parent_session,
                child_attach_sequence,
                reseed_budget,
            ) {
                self.revoke_frame_tree_session(control, state, session_id, Some(token), is_child)
                    .await;
            }
            return;
        };
        state.frame_tree_retries.remove(session_id);
        let id = request.command_id();
        state.pending_frames.insert(
            id,
            PendingFrameTree {
                session_id: session_id.to_string(),
                owner,
                token,
                child_parent_session,
                child_attach_sequence,
                barrier: None,
                result: None,
                changed: false,
                detached: Vec::new(),
                detach_overflow: false,
                reseed_budget,
            },
        );
        tokio::spawn(async move {
            let result = timeout(Duration::from_secs(10), request.wait())
                .await
                .ok()
                .and_then(Result::ok);
            permit.send((id, token, result));
        });
    }

    async fn retry_pending_frame_trees(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        let now = Instant::now();
        let due: Vec<String> = state
            .frame_tree_retries
            .iter()
            .filter(|(_, retry)| retry.next_attempt <= now)
            .map(|(session_id, _)| session_id.clone())
            .collect();
        for session_id in due {
            let Some(retry) = state.frame_tree_retries.remove(&session_id) else {
                continue;
            };
            let is_child = retry.child_parent_session.is_some();
            if !control.ownership_fence.observe(retry.token, || {})
                || state.owners.get(&session_id) != Some(&retry.owner)
            {
                self.revoke_frame_tree_session(
                    control,
                    state,
                    &session_id,
                    Some(retry.token),
                    is_child,
                )
                .await;
                continue;
            }
            match (
                retry.child_parent_session.as_deref(),
                retry.child_attach_sequence,
                state.pending_children.get(&session_id),
            ) {
                (None, None, _) => {}
                (Some(parent), Some(sequence), Some((current_parent, current_sequence)))
                    if parent == current_parent
                        && sequence == *current_sequence
                        && state.owners.get(parent) == Some(&retry.owner) =>
                {
                    if !state.frame_sessions.contains(parent) {
                        if !state.queue_frame_tree_retry(
                            session_id.clone(),
                            retry.owner.clone(),
                            retry.token,
                            retry.child_parent_session.clone(),
                            retry.child_attach_sequence,
                            retry.reseed_budget,
                        ) {
                            self.revoke_frame_tree_session(
                                control,
                                state,
                                &session_id,
                                Some(retry.token),
                                true,
                            )
                            .await;
                        }
                        continue;
                    }
                }
                _ => {
                    self.revoke_frame_tree_session(
                        control,
                        state,
                        &session_id,
                        Some(retry.token),
                        true,
                    )
                    .await;
                    continue;
                }
            }
            self.request_frame_tree_with_budget(
                control,
                state,
                &session_id,
                retry.owner,
                retry.token,
                retry.child_parent_session,
                retry.child_attach_sequence,
                retry.reseed_budget,
                frame_tx,
            )
            .await;
        }
    }

    async fn refuse_and_close_targets(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        target_ids: Vec<String>,
    ) {
        for target_id in target_ids {
            self.close_refused(state, &target_id);
            self.close_refused_page(control, state, &target_id).await;
        }
    }

    async fn revoke_frame_tree_session(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        session_id: &str,
        token: Option<ValidityToken>,
        remove_owners: bool,
    ) {
        let paused_targets = clear_attachment_sessions(
            &control.ownership_fence,
            state,
            [session_id.to_string()],
            token,
            remove_owners,
        );
        self.refuse_and_close_targets(control, state, paused_targets)
            .await;
    }

    async fn revoke_pending_frame_tree(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        pending: &PendingFrameTree,
    ) {
        let mut paused_targets = revoke_pending_attachment(control, state, pending);
        let session_id = &pending.session_id;
        if let Some(attach_sequence) = pending.child_attach_sequence {
            if let Some(resume) = state.pending_child_resumes.remove(session_id) {
                if resume.attach_sequence == attach_sequence
                    && !paused_targets.contains(&resume.target_id)
                {
                    paused_targets.push(resume.target_id);
                }
            }
        }
        self.refuse_and_close_targets(control, state, paused_targets)
            .await;
    }
    async fn resume_proven_child(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        session_id: &str,
        attach_sequence: u64,
        token: ValidityToken,
    ) {
        let Some((parent_session, current_sequence)) = state.pending_children.get(session_id)
        else {
            return;
        };
        let Some(owner) = state.owners.get(session_id) else {
            return;
        };
        if *current_sequence != attach_sequence
            || state.owners.get(parent_session) != Some(owner)
            || !state.frame_sessions.contains(session_id)
            || !state
                .pending_child_resumes
                .get(session_id)
                .is_some_and(|resume| resume.attach_sequence == attach_sequence)
        {
            return;
        }
        state.pending_child_resumes.remove(session_id);
        let child_target_id = state.child_target_ids.get(session_id).cloned();
        if let Err(error) = control
            .client
            .send_command("Runtime.runIfWaitingForDebugger", None, Some(session_id))
            .await
        {
            if is_session_or_target_gone_error(&error) {
                if let Some(target_id) = child_target_id.as_deref() {
                    if control.confirm_target_absent(target_id).await {
                        debug!(
                            %error, session_id, target_id,
                            "proven iframe closed before debugger resume completed",
                        );
                        let paused_targets =
                            retire_session_frames(control, state, session_id, Some(token));
                        self.refuse_and_close_targets(control, state, paused_targets)
                            .await;
                        return;
                    }
                }
            }
            warn!(%error, session_id, "proven iframe debugger resume failed");
            (self.policy_containment(&control.browser_incarnation))("iframe resume failed");
            control.client.close().await;
        }
    }
    async fn finish_frame_tree(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        id: usize,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        if !state
            .pending_frames
            .get(&id)
            .is_some_and(|p| p.barrier.is_some() && p.result.is_some())
        {
            return;
        }
        let mut pending = state.pending_frames.remove(&id).unwrap();
        let result = pending.result.take().unwrap();
        if pending.barrier != Some(result.position)
            || result.command_id != id
            || state.owners.get(&pending.session_id) != Some(&pending.owner)
        {
            self.revoke_pending_frame_tree(control, state, &pending)
                .await;
            return;
        }
        if pending.changed {
            if pending.detach_overflow {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            }
            let root_frame_id =
                if !pending.detached.is_empty() || pending.child_parent_session.is_some() {
                    let tree = if pending.child_parent_session.is_some() {
                        parse_child_frame_tree(&result.result)
                    } else {
                        parse_frame_tree(&result.result)
                    };
                    let Some(nodes) = tree else {
                        self.revoke_pending_frame_tree(control, state, &pending)
                            .await;
                        return;
                    };
                    let Some(root) = nodes.first() else {
                        self.revoke_pending_frame_tree(control, state, &pending)
                            .await;
                        return;
                    };
                    if let Some(parent_session) = pending.child_parent_session.as_deref() {
                        let Some(attach_sequence) = pending.child_attach_sequence else {
                            self.revoke_pending_frame_tree(control, state, &pending)
                                .await;
                            return;
                        };
                        if !child_root_matches_attachment(
                            state,
                            parent_session,
                            root,
                            attach_sequence,
                            &pending.owner,
                        ) {
                            self.revoke_pending_frame_tree(control, state, &pending)
                                .await;
                            return;
                        }
                    }
                    Some(root.frame_id.clone())
                } else {
                    None
                };
            let mut reseed_budget = pending.reseed_budget;
            if let Some(root_frame_id) = root_frame_id.as_ref() {
                let root_detaches: Vec<&PendingDetach> = pending
                    .detached
                    .iter()
                    .filter(|detach| {
                        &detach.frame_id == root_frame_id
                            && (detach.session_id == pending.session_id
                                || pending.child_parent_session.as_deref()
                                    == Some(detach.session_id.as_str()))
                    })
                    .collect();
                if !root_detaches.is_empty() {
                    let Some(next_budget) = child_root_swap_reseed_budget(&pending, &root_detaches)
                    else {
                        self.revoke_pending_frame_tree(control, state, &pending)
                            .await;
                        return;
                    };
                    reseed_budget = next_budget;
                }
            }
            if pending.child_parent_session.is_some() && root_frame_id.is_none() {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            }
            self.request_frame_tree_with_budget(
                control,
                state,
                &pending.session_id,
                pending.owner,
                pending.token,
                pending.child_parent_session,
                pending.child_attach_sequence,
                reseed_budget,
                frame_tx,
            )
            .await;
            return;
        }
        let Ok(snapshot) = self
            .registry()
            .snapshot(&pending.owner.logical_session_id, &pending.owner.principal)
            .await
        else {
            self.revoke_pending_frame_tree(control, state, &pending)
                .await;
            return;
        };
        if snapshot.is_dev != pending.owner.is_dev
            || snapshot.browser_incarnation != pending.owner.browser_incarnation
            || snapshot.profile_epoch != pending.owner.profile_epoch
            || snapshot.native_target_id.as_deref() != Some(pending.owner.native_target_id.as_str())
            || !matches!(
                snapshot.status,
                SessionStatus::Initializing | SessionStatus::Running
            )
        {
            self.revoke_pending_frame_tree(control, state, &pending)
                .await;
            return;
        }
        let parsed = if pending.child_parent_session.is_some() {
            parse_child_frame_tree(&result.result)
        } else {
            parse_frame_tree(&result.result)
        };
        let Some(mut nodes) = parsed else {
            self.revoke_pending_frame_tree(control, state, &pending)
                .await;
            return;
        };
        let mut child_attachment = None;
        let installed = if let Some(parent_session) = pending.child_parent_session.as_deref() {
            let Some(root_frame) = nodes.first() else {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            };
            let Some(attach_sequence) = pending.child_attach_sequence else {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            };
            if !child_root_matches_attachment(
                state,
                parent_session,
                root_frame,
                attach_sequence,
                &pending.owner,
            ) {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            }
            if state.child_frame_roots.len() >= MAX_OBSERVER_CHILD_FRAME_ROOTS
                && !state.child_frame_roots.contains_key(&pending.session_id)
            {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            }
            let root_frame_id = root_frame.frame_id.clone();
            let Some(containing_parent_frame_id) = root_frame.parent_frame_id.clone() else {
                self.revoke_pending_frame_tree(control, state, &pending)
                    .await;
                return;
            };
            child_attachment = Some(ChildFrameAttachment {
                parent_session_id: parent_session.to_string(),
                logical_frame_id: root_frame_id.clone(),
            });
            nodes[0].parent_frame_id = None;
            let child_target_id = state
                .child_target_ids
                .get(&pending.session_id)
                .map(String::as_str);
            control.ownership_fence.seed_child_snapshot_with_target(
                pending.token,
                &pending.session_id,
                parent_session,
                &containing_parent_frame_id,
                &root_frame_id,
                child_target_id,
                &pending.owner,
                &nodes,
            )
        } else {
            control.ownership_fence.seed_snapshot(
                pending.token,
                &pending.session_id,
                pending.owner.clone(),
                &nodes,
            )
        };
        if installed {
            // Seed pre-existing child frames discovered inside this snapshot with sequence 0
            // (predating all ordered stream events `attach_sequence >= 1`) so an OOPIF that
            // attached before this snapshot completed still satisfies `parent_frame_predates_child_attach`.
            for node in &nodes {
                if let Some(parent_frame_id) = node.parent_frame_id.as_deref() {
                    let key = (pending.session_id.clone(), node.frame_id.clone());
                    if !state.frame_attached.contains_key(&key)
                        && !record_frame_attachment(
                            &control.ownership_fence,
                            state,
                            &pending.session_id,
                            &node.frame_id,
                            parent_frame_id,
                            0,
                        )
                    {
                        self.revoke_pending_frame_tree(control, state, &pending)
                            .await;
                        return;
                    }
                }
            }
            if let Some(attachment) = child_attachment {
                state
                    .child_frame_roots
                    .insert(pending.session_id.clone(), attachment);
            }
            state.frame_sessions.insert(pending.session_id.clone());
            state
                .owners
                .insert(pending.session_id.clone(), pending.owner.clone());
            if pending.child_parent_session.is_some() {
                if let Some(attach_sequence) = pending.child_attach_sequence {
                    self.resume_proven_child(
                        control,
                        state,
                        &pending.session_id,
                        attach_sequence,
                        pending.token,
                    )
                    .await;
                }
            }
            let children: Vec<_> = state
                .pending_children
                .iter()
                .filter(|(_, (parent, _))| parent == &pending.session_id)
                .map(|(child, (_, sequence))| (child.clone(), *sequence))
                .collect();
            for (child, attach_sequence) in children {
                if state.owners.get(&child) == Some(&pending.owner) {
                    self.request_frame_tree(
                        control,
                        state,
                        &child,
                        pending.owner.clone(),
                        pending.token,
                        Some(pending.session_id.clone()),
                        Some(attach_sequence),
                        frame_tx,
                    )
                    .await;
                }
            }
        } else {
            self.revoke_pending_frame_tree(control, state, &pending)
                .await;
        }
    }

    async fn dispatch_lifecycle(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        token: ValidityToken,
        position: CdpStreamPosition,
        event: &CdpLifecycleEvent,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        let fence = &control.ownership_fence;
        let topology_session = match event {
            CdpLifecycleEvent::FrameAttached { session_id, .. }
            | CdpLifecycleEvent::FrameDetached { session_id, .. }
            | CdpLifecycleEvent::FrameNavigated { session_id, .. } => session_id.as_deref(),
            _ => None,
        };
        if let Some(session_id) = topology_session {
            for pending in state.pending_frames.values_mut().filter(|pending| {
                pending.session_id == session_id
                    || pending.child_parent_session.as_deref() == Some(session_id)
            }) {
                pending.changed = true;
            }
        }
        if let CdpLifecycleEvent::DownloadWillBegin {
            session_id,
            frame_id,
            ..
        } = event
        {
            debug!(
                sequence = position.sequence,
                session_id = ?session_id,
                frame_id = ?frame_id,
                "ordered CDP download begin lifecycle event",
            );
        }
        match event {
            CdpLifecycleEvent::FrameAttached {
                session_id: Some(session),
                frame_id,
                parent_frame_id,
                ..
            } => {
                if !record_frame_attachment(
                    fence,
                    state,
                    session,
                    frame_id,
                    parent_frame_id,
                    position.sequence,
                ) {
                    self.drop_entry();
                    control.client.close().await;
                    return;
                }
                fence.attach_descendant(token, session, frame_id, parent_frame_id);
            }
            CdpLifecycleEvent::FrameDetached {
                session_id: Some(session),
                frame_id,
                reason,
                ..
            } => {
                let preserved_parent =
                    frame_detach_preserved_parent(state, session, frame_id, *reason);
                let paused_targets = retire_detached_frame(
                    fence,
                    state,
                    token,
                    session,
                    frame_id,
                    preserved_parent.as_deref(),
                    *reason,
                );
                self.refuse_and_close_targets(control, state, paused_targets)
                    .await;
            }
            CdpLifecycleEvent::FrameNavigated {
                session_id: Some(session),
                ..
            } if frame_navigation_reseeds_snapshot(state, event) => {
                if let Some(owner) = state.owners.get(session).cloned() {
                    if let Some((parent_session, attach_sequence)) =
                        state.pending_children.get(session).cloned()
                    {
                        let mut sessions = HashSet::from([session.clone()]);
                        loop {
                            let children: Vec<_> = state
                                .pending_children
                                .iter()
                                .filter(|(_, (parent, _))| sessions.contains(parent))
                                .map(|(child, _)| child.clone())
                                .collect();
                            let before = sessions.len();
                            sessions.extend(children);
                            if sessions.len() == before {
                                break;
                            }
                        }
                        for child_session in &sessions {
                            if child_session == session {
                                fence.retire_session_for_reseed(token, child_session);
                            } else {
                                fence.retire_session(token, child_session);
                            }
                        }
                        state.pending_frames.retain(|_, pending| {
                            !sessions.contains(&pending.session_id)
                                && pending
                                    .child_parent_session
                                    .as_ref()
                                    .is_none_or(|parent| !sessions.contains(parent))
                        });
                        state.pending_children.retain(|child, (parent, _)| {
                            child == session
                                || (!sessions.contains(child) && !sessions.contains(parent))
                        });
                        state
                            .frame_tree_retries
                            .retain(|child_session, _| !sessions.contains(child_session));
                        state
                            .frame_sessions
                            .retain(|child_session| !sessions.contains(child_session));
                        state
                            .frame_attached
                            .retain(|(child_session, _), _| !sessions.contains(child_session));
                        state.child_frame_roots.retain(|child, attachment| {
                            !sessions.contains(child)
                                && !sessions.contains(&attachment.parent_session_id)
                        });
                        state
                            .child_target_ids
                            .retain(|child, _| child == session || !sessions.contains(child));
                        state.owners.retain(|child_session, _| {
                            child_session == session || !sessions.contains(child_session)
                        });
                        let mut paused_targets = Vec::new();
                        state.pending_child_resumes.retain(|child_session, resume| {
                            if child_session != session && sessions.contains(child_session) {
                                paused_targets.push(resume.target_id.clone());
                                false
                            } else {
                                true
                            }
                        });
                        self.refuse_and_close_targets(control, state, paused_targets)
                            .await;
                        self.request_frame_tree(
                            control,
                            state,
                            session,
                            owner,
                            token,
                            Some(parent_session),
                            Some(attach_sequence),
                            frame_tx,
                        )
                        .await;
                    } else {
                        let owned_sessions: HashSet<_> = state
                            .owners
                            .iter()
                            .filter(|(_, candidate)| *candidate == &owner)
                            .map(|(owned_session, _)| owned_session.clone())
                            .collect();
                        state
                            .pending_frames
                            .retain(|_, pending| pending.owner != owner);
                        state
                            .frame_tree_retries
                            .retain(|_, retry| retry.owner != owner);
                        state
                            .frame_sessions
                            .retain(|owned_session| !owned_sessions.contains(owned_session));
                        state.frame_attached.retain(|(owned_session, _), _| {
                            !owned_sessions.contains(owned_session)
                        });
                        state
                            .child_frame_roots
                            .retain(|child, _| !owned_sessions.contains(child));
                        state
                            .child_target_ids
                            .retain(|child, _| child == session || !owned_sessions.contains(child));
                        state.pending_children.retain(|child, (parent, _)| {
                            !owned_sessions.contains(child) && !owned_sessions.contains(parent)
                        });
                        state.owners.retain(|owned_session, _| {
                            owned_session == session || !owned_sessions.contains(owned_session)
                        });
                        let mut paused_targets = Vec::new();
                        state.pending_child_resumes.retain(|owned_session, resume| {
                            if owned_session != session && owned_sessions.contains(owned_session) {
                                paused_targets.push(resume.target_id.clone());
                                false
                            } else {
                                true
                            }
                        });
                        self.refuse_and_close_targets(control, state, paused_targets)
                            .await;
                        fence.retire_owner(token, &owner);
                        self.request_frame_tree(
                            control, state, session, owner, token, None, None, frame_tx,
                        )
                        .await;
                    }
                }
            }
            CdpLifecycleEvent::FrameNavigated {
                session_id: Some(session),
                frame_id: Some(frame_id),
                parent_frame_id: Some(parent),
                ..
            } => {
                let paused_targets = retire_detached_frame(
                    fence,
                    state,
                    token,
                    session,
                    frame_id,
                    Some(parent),
                    FrameDetachReason::Remove,
                );
                self.refuse_and_close_targets(control, state, paused_targets)
                    .await;
                fence.attach_descendant(token, session, frame_id, parent);
            }
            CdpLifecycleEvent::DownloadWillBegin { .. }
            | CdpLifecycleEvent::DownloadProgress { .. } => {
                dispatch_download_lifecycle_event(
                    self.registry(),
                    &self.downloads,
                    fence,
                    token,
                    state,
                    event,
                )
                .await;
            }
            _ => {}
        }
    }

    async fn handle_event(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        event: &CdpTargetEvent,
        token: Option<ValidityToken>,
        position: CdpStreamPosition,
        frame_tx: &mpsc::Sender<(usize, ValidityToken, Option<CdpFrameTreeSnapshot>)>,
    ) {
        match event {
            CdpTargetEvent::Created { info, .. } => {
                self.observe_page(control, state, info).await;
            }
            CdpTargetEvent::Attached {
                session_id,
                info,
                waiting_for_debugger,
                ..
            } => {
                let disposition = self.observe_page(control, state, info).await;
                if matches!(disposition, PageDisposition::Popup) {
                    if let Some((parent_session_id, session)) = self
                        .adopt_popup(control, state, info, session_id, *waiting_for_debugger)
                        .await
                    {
                        if self
                            .retain_page_session(
                                control,
                                state,
                                session_id,
                                &info.target_id,
                                *waiting_for_debugger,
                                token,
                                frame_tx,
                            )
                            .await
                        {
                            let _ =
                                self.native
                                    .sinks
                                    .events
                                    .send(NativeTargetEvent::PopupAdmitted {
                                        parent_session_id,
                                        session,
                                    });
                        }
                    }
                } else if matches!(disposition, PageDisposition::Rejected) {
                    // Never let a refused page issue a request: hold its requests paused,
                    // resume it (so its opener is not blocked), then close it.
                    refuse_attached(control, session_id, *waiting_for_debugger).await;
                    if state.pending_close.contains_key(&info.target_id) {
                        self.close_refused_page(control, state, &info.target_id)
                            .await;
                    }
                } else if matches!(disposition, PageDisposition::Managed | PageDisposition::Raw) {
                    self.retain_page_session(
                        control,
                        state,
                        session_id,
                        &info.target_id,
                        *waiting_for_debugger,
                        token,
                        frame_tx,
                    )
                    .await;
                } else {
                    release_attached(control, session_id, *waiting_for_debugger).await;
                }
            }
            CdpTargetEvent::ChildAttached {
                parent_session_id,
                session_id,
                info,
                waiting_for_debugger,
                ..
            } => {
                if info.target_type == "iframe" {
                    if let Err(error) = self.configure_recursive_session(control, session_id).await
                    {
                        if is_session_or_target_gone_error(&error)
                            && control.confirm_target_absent(&info.target_id).await
                        {
                            debug!(
                                %error, session_id, parent_session_id, target_id = %info.target_id,
                                "iframe target closed before recursive session setup completed",
                            );
                            return;
                        }
                        warn!(
                            %error, session_id, parent_session_id, target_id = %info.target_id,
                            target_type = %info.target_type, waiting_for_debugger = waiting_for_debugger,
                            "iframe recursive session setup failed",
                        );
                        (self.policy_containment(&control.browser_incarnation))(
                            "iframe recursive attachment setup failed",
                        );
                        control.client.close().await;
                    } else {
                        let owner = state.owners.get(parent_session_id).cloned();
                        let tracked = owner.is_some() && state.pending_children.len() < 64;
                        let paused_admitted = matches!(
                            (token, owner.as_ref()),
                            (Some(tok), Some(parent_owner))
                                if parent_has_active_or_pending_frame_tree(
                                    state,
                                    parent_session_id,
                                    parent_owner,
                                    tok,
                                )
                        );
                        if *waiting_for_debugger && !(tracked && paused_admitted) {
                            // Paused without exact admission: never resumed, closed instead.
                            self.close_refused(state, &info.target_id);
                            self.close_refused_page(control, state, &info.target_id)
                                .await;
                        } else if let (true, Some(owner)) = (tracked, owner) {
                            state.pending_children.insert(
                                session_id.clone(),
                                (parent_session_id.clone(), position.sequence),
                            );
                            state
                                .child_target_ids
                                .insert(session_id.clone(), info.target_id.clone());
                            state.owners.insert(session_id.clone(), owner.clone());
                            if *waiting_for_debugger {
                                state.pending_child_resumes.insert(
                                    session_id.clone(),
                                    PendingChildResume {
                                        attach_sequence: position.sequence,
                                        target_id: info.target_id.clone(),
                                    },
                                );
                            }
                            if state.frame_sessions.contains(parent_session_id) {
                                if let Some(token) = token {
                                    self.request_frame_tree(
                                        control,
                                        state,
                                        session_id,
                                        owner,
                                        token,
                                        Some(parent_session_id.clone()),
                                        Some(position.sequence),
                                        frame_tx,
                                    )
                                    .await;
                                }
                            }
                        }
                    }
                } else if info.target_type.as_str() == "worker" {
                    let ua_params = control.ua_override_params().await;
                    let ua_fut = control.client.send_command(
                        "Emulation.setUserAgentOverride",
                        Some(ua_params),
                        Some(session_id),
                    );
                    let auto_attach_fut = control.client.send_command(
                        "Target.setAutoAttach",
                        Some(json!({
                            "autoAttach": true,
                            "waitForDebuggerOnStart": true,
                            "flatten": true,
                            "filter": [{ "type": "worker" }, { "exclude": true }]
                        })),
                        Some(session_id),
                    );
                    let eval_fut = control.client.send_command(
                        "Runtime.evaluate",
                        Some(json!({ "expression": super::stealth::WORKER_STEALTH_SCRIPT })),
                        Some(session_id),
                    );
                    // Resume without detaching: Target.detachFromTarget disables Blink's
                    // InspectorEmulationAgent on the worker and reverts userAgentMetadata.
                    // The flattened session retires naturally on Target.detachedFromTarget.
                    if *waiting_for_debugger {
                        let resume_fut = control.client.send_command(
                            "Runtime.runIfWaitingForDebugger",
                            None,
                            Some(session_id),
                        );
                        let (ua_res, _, _, resume_res) =
                            tokio::join!(ua_fut, auto_attach_fut, eval_fut, resume_fut);
                        if let Err(error) = ua_res {
                            debug!(
                                %error, session_id, target_type = %info.target_type,
                                "worker Emulation.setUserAgentOverride skipped"
                            );
                        }
                        if let Err(error) = resume_res {
                            debug!(
                                %error, session_id, target_type = %info.target_type,
                                "worker Runtime.runIfWaitingForDebugger failed"
                            );
                        }
                    } else {
                        let (ua_res, _, _) = tokio::join!(ua_fut, auto_attach_fut, eval_fut);
                        if let Err(error) = ua_res {
                            debug!(
                                %error, session_id, target_type = %info.target_type,
                                "worker Emulation.setUserAgentOverride skipped"
                            );
                        }
                    }
                } else {
                    release_attached(control, session_id, *waiting_for_debugger).await;
                }
            }
            CdpTargetEvent::Destroyed { target_id, .. } => {
                retire_target_frames(control, state, &self.downloads, target_id, token);
                state.rejected.remove(target_id);
                state.pending_close.remove(target_id);
                state.pending_popups.remove(target_id);
                self.target_gone(control, target_id).await;
            }
            CdpTargetEvent::Crashed { target_id, .. } => {
                // Crash retires attribution immediately; native capacity remains occupied until absence
                // is independently proven.
                retire_target_frames(control, state, &self.downloads, target_id, token);
                match control.close_page(target_id).await {
                    NativeCloseOutcome::Absent => self.target_gone(control, target_id).await,
                    NativeCloseOutcome::Unconfirmed(reason) => {
                        warn!(error = %reason, "crashed native page could not be proven closed");
                    }
                }
            }
            CdpTargetEvent::Overflow => {
                if let Err(msg) = self.reconcile_inventory(control, state, false).await {
                    warn!(error = %msg, "native target re-inventory failed after event loss");
                }
            }
        }
    }

    /// Installs the request policy on a paused admitted popup (through the API-layer pump),
    /// then resumes it. Any failure closes the popup (fail closed); it is never resumed
    /// without policy.
    async fn adopt_popup(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        info: &NativeTargetInfo,
        attached_session: &str,
        waiting_for_debugger: bool,
    ) -> Option<(String, BrowserSessionDto)> {
        let Some(popup) = state.pending_popups.remove(&info.target_id) else {
            release_attached(control, attached_session, waiting_for_debugger).await;
            return None;
        };
        let failure = if !waiting_for_debugger {
            "popup could not be paused for request-policy installation".to_string()
        } else {
            let (reply, answer) = oneshot::channel();
            let request = NativePumpRequest::AdoptPopup(PopupAdoption {
                session_id: popup.session_id.clone(),
                principal: popup.principal.clone(),
                is_dev: popup.is_dev,
                reply,
            });
            if self.native.sinks.pump.try_send(request).is_err() {
                "no consumer available to install the request policy".to_string()
            } else {
                match timeout(POPUP_ADOPTION_TIMEOUT, answer).await {
                    Ok(Ok(Ok(session))) => {
                        return Some((popup.parent_session_id, session));
                    }
                    Ok(Ok(Err(msg))) => msg,
                    Ok(Err(_)) => "popup adoption was abandoned".to_string(),
                    Err(_) => "popup adoption timed out".to_string(),
                }
            }
        };
        warn!(session_id = %popup.session_id, reason = %failure, "popup refused");
        if waiting_for_debugger {
            refuse_attached(control, attached_session, true).await;
        }
        if let RollbackOutcome::Closing { target_id } =
            self.registry().rollback_creation(&popup.session_id).await
        {
            state.reject(&target_id);
            if control.close_page(&target_id).await == NativeCloseOutcome::Absent {
                self.registry().finish_close(&popup.session_id, true).await;
            } else {
                // Not proven gone: the session stays `Closing` (slot held) and the sweep keeps
                // retrying the close until absence is proven.
                state.pending_close.insert(target_id, Instant::now());
            }
        }
        crate::api::browser_host::retire_session_native_resources(&popup.session_id).await;
        let _ = self
            .native
            .sinks
            .events
            .send(NativeTargetEvent::PopupBlocked {
                parent_session_id: popup.parent_session_id,
                reason: failure,
            });
        None
    }

    /// The observer's connection closed. A dead browser process retires the incarnation; a
    /// live one is re-connected and re-inventoried. `None` ends the observer. Liveness is
    /// re-probed on every attempt: the socket closes while the process is still exiting, so a
    /// single early probe can see a dying process as alive.
    async fn recover(
        &self,
        control: &Arc<NativeControl>,
    ) -> Option<(
        Arc<NativeControl>,
        broadcast::Receiver<Arc<CdpOrderedRecord>>,
    )> {
        for attempt in 0..=OBSERVER_RECONNECT_ATTEMPTS {
            if !self.is_registered() {
                return None;
            }
            let handle = self.probe_process(control).await?;
            if let Ok((next, events)) = connect_control(self, &handle).await {
                if let Some(entry) = self.native.observers.lock().unwrap().get_mut(&self.key) {
                    if entry.token == self.token {
                        entry.control = next.clone();
                    }
                }
                return Some((next, events));
            }
            if attempt < OBSERVER_RECONNECT_ATTEMPTS {
                sleep(OBSERVER_RECONNECT_DELAY).await;
            }
        }
        // Alive but unreachable: nothing is proven lost, nothing is controllable. The entry is
        // dropped so the next `native_control` call re-attaches.
        self.drop_entry();
        None
    }

    /// Handle of the still-live process of this observer's incarnation. `None` when the
    /// incarnation was replaced, or when the process is dead (its native state is then retired).
    async fn probe_process(&self, control: &Arc<NativeControl>) -> Option<BrowserInstanceHandle> {
        let mut inst = self.inst.lock().await;
        if inst.browser_incarnation.as_deref() != Some(control.browser_incarnation.as_str()) {
            self.drop_entry();
            return None;
        }
        if !inst.process.as_mut().is_some_and(|p| p.try_is_alive()) {
            warn!("browser connection closed and process is dead; retiring native targets");
            if let Err(err) = self
                .native
                .reap_dead_instance(&self.key, &mut inst, false)
                .await
            {
                warn!(error = %err, "dead browser reap left cleanup pending");
            }
            return None;
        }
        Some(BrowserInstanceHandle {
            subject: self.subject.clone(),
            is_dev: self.is_dev,
            pid: inst.process.as_ref().map(|p| p.pid()).unwrap_or_default(),
            ws_endpoint: control.ws_endpoint.clone(),
            browser_incarnation: control.browser_incarnation.clone(),
            profile_epoch: control.profile_epoch,
            user_data_dir: inst.profile.user_data_dir().to_path_buf(),
        })
    }
}

/// Resumes (if it was paused by the observer's auto-attach) and detaches the observer's session
/// of a page that needs no further observation.
async fn release_attached(control: &Arc<NativeControl>, session_id: &str, waiting: bool) {
    if waiting {
        let _ = control
            .client
            .send_command("Runtime.runIfWaitingForDebugger", None, Some(session_id))
            .await;
    }
    let _ = control
        .client
        .send_command(
            "Target.detachFromTarget",
            Some(json!({ "sessionId": session_id })),
            None,
        )
        .await;
}

/// Resumes a refused page so its opener is not left blocked, holding every request it would
/// issue paused (the observer never continues them) until the caller closes it. The session
/// stays attached: detaching would release the paused requests.
async fn refuse_attached(control: &Arc<NativeControl>, session_id: &str, waiting: bool) {
    if !waiting {
        return;
    }
    let _ = control
        .client
        .send_command(
            "Fetch.enable",
            Some(json!({ "patterns": [{ "urlPattern": "*" }] })),
            Some(session_id),
        )
        .await;
    let _ = control
        .client
        .send_command("Runtime.runIfWaitingForDebugger", None, Some(session_id))
        .await;
}

/// Durably records a reset stage; failure stops the reset (progress is never claimed unsynced).
fn persist_stage(
    profile: &ManagedProfile,
    tombstone: &mut ResetTombstone,
    stage: ResetStage,
) -> Result<(), String> {
    tombstone.stage = stage;
    tombstone.updated_at_unix_ms = now_unix_ms();
    profile
        .save_tombstone(tombstone)
        .map_err(|e| format!("failed to persist reset stage {stage:?}: {e}"))
}

#[cfg(test)]
mod startup_policy_tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    async fn startup_browser(disappears: bool) -> (Arc<CdpClient>, mpsc::UnboundedReceiver<Value>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut closes = HashMap::<String, usize>::new();
            let mut inventories = 0usize;
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let command: Value = serde_json::from_str(&text).unwrap();
                let result = match command["method"].as_str().unwrap() {
                    "Target.getTargets" => {
                        inventories += 1;
                        let mut infos = vec![json!({"targetId":"PAGE","type":"page"})];
                        for (id, kind) in [
                            ("OLD-SW", "service_worker"),
                            ("OLD-SHARED", "shared_worker"),
                        ] {
                            if !disappears || closes.get(id).copied().unwrap_or(0) < 2 {
                                infos.push(json!({"targetId":id,"type":kind}));
                            }
                        }
                        if inventories > 1 {
                            infos
                                .push(json!({"targetId":"NEW-POLICED-SW","type":"service_worker"}));
                        }
                        json!({"targetInfos":infos})
                    }
                    "Target.closeTarget" => {
                        *closes
                            .entry(command["params"]["targetId"].as_str().unwrap().to_string())
                            .or_default() += 1;
                        // First close succeeds while still starting. Only a second close
                        // stops it; persistent survivors never disappear.
                        json!({"success":true})
                    }
                    _ => json!({}),
                };
                let reply = json!({"id":command["id"],"result":result});
                tx.send(command).unwrap();
                if ws
                    .send(Message::Text(reply.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        (
            CdpClient::connect(&format!("ws://{addr}")).await.unwrap(),
            rx,
        )
    }

    #[tokio::test]
    async fn startup_reconciliation_recloses_only_starting_original_workers() {
        let (client, mut commands) = startup_browser(true).await;
        retire_pre_policy_workers(&client).await.unwrap();
        let mut closed = Vec::new();
        while let Ok(command) = commands.try_recv() {
            if command["method"] == "Target.closeTarget" {
                closed.push(command["params"]["targetId"].as_str().unwrap().to_string());
            }
        }
        assert_eq!(closed, ["OLD-SW", "OLD-SHARED", "OLD-SW", "OLD-SHARED"]);
    }

    #[tokio::test]
    async fn startup_reconciliation_rejects_worker_that_survives_successful_close() {
        let (client, _commands) = startup_browser(false).await;
        assert!(matches!(
            retire_pre_policy_workers(&client).await,
            Err(CdpError::Transport(_))
        ));
    }
}
