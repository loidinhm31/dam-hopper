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

use super::cdp::{CdpClient, CdpError, CdpTargetEvent, NativeTargetInfo};
use super::config::{evaluate_capabilities, BrowserCapabilitiesDto, BrowserHostConfig};
use super::process::{
    reap_prior_tree, BrowserLaunchConfig, BrowserProcess, ContainmentIdentity, ProcessError,
    ReapTimings,
};
use super::profile::{
    now_unix_ms, ManagedProfile, ManagerMetadata, ProfileError, ProfileFaults, ProfileLock,
    ResetStage, ResetTombstone,
};
use super::session::{
    creation_marker_url, parse_creation_marker, BindOutcome, BrowserSessionDto, PopupAdmission,
    RollbackOutcome, SessionDeparture, SessionStatus, TargetClass,
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
            inst: inst_arc.clone(),
            native: self.native.clone(),
            faults: self.native_faults.clone(),
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
const MAX_REJECTED_TARGETS: usize = 256;
const MAX_TARGET_ID_LEN: usize = 128;

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
    faults: Arc<NativeFaults>,
    /// Mock CDP endpoints (tests) have no target inventory: a response without `targetInfos`
    /// means "no pages". Never set for a real browser.
    inventory_optional: bool,
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
            faults,
            inventory_optional: true,
        })
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

/// Manager state the observer tasks and lifecycle paths share.
#[derive(Clone)]
struct NativeHandles {
    observers: Arc<StdMutex<HashMap<String, ObserverEntry>>>,
    /// (principal key, incarnation) -> in-flight containment of that whole incarnation.
    containments: Arc<StdMutex<HashMap<ContainmentSlot, JoinHandle<()>>>>,
    /// principal key -> live browser incarnation (publication fence).
    live_incarnations: Arc<StdRwLock<HashMap<String, String>>>,
    global_process_count: Arc<AtomicUsize>,
    sinks: NativeSinks,
}

impl NativeHandles {
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
        if let Some(entry) = self.observers.lock().unwrap().remove(key) {
            entry.task.abort();
        }
    }

    /// Every page of the incarnation is gone: retire its sessions/raw slots and their resources.
    async fn retire_incarnation(&self, incarnation: &str, reason: &str) {
        let departures = crate::api::browser_host::global_session_registry()
            .retire_incarnation(incarnation, reason)
            .await;
        announce_departures(&self.sinks, departures, reason).await;
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
        if let Some(entry) = self.observers.lock().unwrap().remove(key) {
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
    inst: Arc<Mutex<InnerInstance>>,
    native: NativeHandles,
    faults: Arc<NativeFaults>,
    token: u64,
}

struct PendingPopup {
    session_id: String,
    parent_session_id: String,
    principal: String,
    is_dev: bool,
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
}

impl ObserverState {
    fn reject(&mut self, target_id: &str) {
        if self.rejected.len() >= MAX_REJECTED_TARGETS {
            self.rejected.clear();
        }
        self.rejected.insert(target_id.to_string());
    }
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
) -> Result<(Arc<NativeControl>, broadcast::Receiver<Arc<CdpTargetEvent>>), ManagerError> {
    let client = CdpClient::connect(&handle.ws_endpoint).await.map_err(|e| {
        ManagerError::Internal(format!("native target observer connect failed: {e}"))
    })?;
    // Subscribed before discovery is enabled so no lifecycle event can precede the receiver.
    let events = client.subscribe_target_events();
    let control = Arc::new(NativeControl {
        subject: shared.subject.clone(),
        is_dev: shared.is_dev,
        browser_incarnation: handle.browser_incarnation.clone(),
        profile_epoch: handle.profile_epoch,
        ws_endpoint: handle.ws_endpoint.clone(),
        client,
        faults: shared.faults.clone(),
        inventory_optional: false,
    });
    Ok((control, events))
}

async fn run_observer(
    shared: ObserverShared,
    mut control: Arc<NativeControl>,
    mut events: broadcast::Receiver<Arc<CdpTargetEvent>>,
    ready: oneshot::Sender<Result<(), String>>,
    initial: bool,
) {
    let mut state = ObserverState::default();
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
                Ok(event) => shared.handle_event(&control, &mut state, &event).await,
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if let Err(msg) = shared.reconcile_inventory(&control, &mut state, false).await {
                        warn!(error = %msg, "native target re-inventory failed after event loss");
                    }
                }
                Err(broadcast::error::RecvError::Closed) => {
                    shared.drop_entry();
                    return;
                }
            },
            _ = sweep.tick() => {
                shared.flush_pending_close(&control, &mut state, PENDING_CLOSE_GRACE).await;
            }
            _ = control.client.closed() => {
                match shared.recover(&control).await {
                    Some((next, next_events)) => {
                        control = next;
                        events = next_events;
                        state = ObserverState::default();
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

    async fn handle_event(
        &self,
        control: &Arc<NativeControl>,
        state: &mut ObserverState,
        event: &CdpTargetEvent,
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
                    self.adopt_popup(control, state, info, session_id, *waiting_for_debugger)
                        .await;
                } else if matches!(disposition, PageDisposition::Rejected) {
                    // Never let a refused page issue a request: hold its requests paused,
                    // resume it (so its opener is not blocked), then close it.
                    refuse_attached(control, session_id, *waiting_for_debugger).await;
                    if state.pending_close.contains_key(&info.target_id) {
                        self.close_refused_page(control, state, &info.target_id)
                            .await;
                    }
                } else {
                    release_attached(control, session_id, *waiting_for_debugger).await;
                }
            }
            CdpTargetEvent::Destroyed { target_id, .. } => {
                state.rejected.remove(target_id);
                state.pending_close.remove(target_id);
                state.pending_popups.remove(target_id);
                self.target_gone(control, target_id).await;
            }
            CdpTargetEvent::Crashed { target_id, .. } => {
                // The page is unusable but not yet proven gone: close it; verified absence then
                // frees its slot.
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
    ) {
        let Some(popup) = state.pending_popups.remove(&info.target_id) else {
            release_attached(control, attached_session, waiting_for_debugger).await;
            return;
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
                        release_attached(control, attached_session, true).await;
                        let _ = self
                            .native
                            .sinks
                            .events
                            .send(NativeTargetEvent::PopupAdmitted {
                                parent_session_id: popup.parent_session_id,
                                session,
                            });
                        return;
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
    }

    /// The observer's connection closed. A dead browser process retires the incarnation; a
    /// live one is re-connected and re-inventoried. `None` ends the observer. Liveness is
    /// re-probed on every attempt: the socket closes while the process is still exiting, so a
    /// single early probe can see a dying process as alive.
    async fn recover(
        &self,
        control: &Arc<NativeControl>,
    ) -> Option<(Arc<NativeControl>, broadcast::Receiver<Arc<CdpTargetEvent>>)> {
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
