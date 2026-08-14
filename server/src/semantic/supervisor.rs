//! Demand-driven, bounded semantic process registry.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::runtime::Handle;
use tokio::sync::{broadcast, Mutex, OwnedSemaphorePermit, RwLock, Semaphore};

use super::metrics::{SemanticMetrics, SemanticMetricsSnapshot};
use super::protocol::{
    DescriptorAvailabilityReason, DescriptorAvailabilityState, SemanticDescriptorAvailability,
    SemanticLanguage,
};
use super::registry::{RegistryError, SemanticRegistry};
use super::session::{CrashNotifier, LspSession, SessionError, SessionKey, SessionState};
use super::trust::{
    ProjectTrustStore, SemanticTrust, SemanticTrustChallenge, SemanticTrustState,
    SemanticTrustTransitionRequest, TrustRecord,
};

pub const PREWARM_DWELL_MS: u64 = 750;
pub const IDLE_GRACE_MS: u64 = 10 * 60 * 1000;
pub const CRASH_WINDOW_MS: u64 = 10 * 60 * 1000;
pub const MAX_CRASHES_IN_WINDOW: usize = 5;
pub const MAX_SESSIONS_PER_CLIENT_PROJECT: usize = 3;

#[derive(Clone)]
pub struct SemanticSupervisor {
    registry: Arc<SemanticRegistry>,
    trust_store: ProjectTrustStore,
    sessions: Arc<Mutex<HashMap<SessionKey, SessionEntry>>>,
    pending_sessions: PendingSessions,
    pending_prewarm: PendingPrewarm,
    crash_history: Arc<Mutex<HashMap<SessionKey, VecDeque<u64>>>>,
    quarantined: Arc<Mutex<HashMap<SessionKey, u64>>>,
    backoff_until: Arc<Mutex<HashMap<SessionKey, u64>>>,
    global_slots: Arc<Semaphore>,
    metrics: Arc<SemanticMetrics>,
    enabled: Arc<AtomicBool>,
    crash_notifier: CrashNotifier,
    shutting_down: Arc<AtomicBool>,
    lifecycle_generation: Arc<AtomicU64>,
    workspace_epoch: Arc<AtomicU64>,
    next_reservation: Arc<AtomicU64>,
    lifecycle_gate: Arc<RwLock<()>>,
    events: broadcast::Sender<SemanticSupervisorEvent>,
}

struct SessionEntry {
    session: Arc<LspSession>,
    _global_slot: OwnedSemaphorePermit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SemanticSessionFence {
    pub lifecycle_generation: u64,
    pub workspace_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticCapabilitySummary {
    pub available: bool,
    pub disabled_reason: Option<&'static str>,
}

fn safe_availability_reason(reason: Option<DescriptorAvailabilityReason>) -> Option<&'static str> {
    match reason {
        Some(DescriptorAvailabilityReason::ReleaseManifestMissing) => {
            Some("A signed semantic bundle is not installed on this server.")
        }
        Some(DescriptorAvailabilityReason::ReleaseManifestInvalid) => {
            Some("The signed semantic bundle is invalid on this server.")
        }
        Some(DescriptorAvailabilityReason::CapabilityUnsupported) => {
            Some("Semantic navigation is not supported on this server.")
        }
        _ => None,
    }
}

#[derive(Default)]
struct SessionAdmission {
    expected_generation: Option<u64>,
    expected_workspace_epoch: Option<u64>,
    prewarm_cancel: Option<Arc<AtomicBool>>,
    client_closed: Option<Arc<AtomicBool>>,
}

type PendingSessions = Arc<Mutex<HashMap<u64, PendingSession>>>;
type PendingPrewarm = Arc<Mutex<HashMap<PrewarmKey, PrewarmReservation>>>;

struct PrewarmReservation {
    token: u64,
    cancelled: Arc<AtomicBool>,
}

struct PendingSession {
    client_id: String,
    project_id: String,
    key: SessionKey,
}

struct SessionReservationGuard {
    pending: PendingSessions,
    token: u64,
}

impl Drop for SessionReservationGuard {
    fn drop(&mut self) {
        let pending = Arc::clone(&self.pending);
        let token = self.token;
        if let Ok(mut pending_guard) = pending.try_lock() {
            pending_guard.remove(&token);
            return;
        }
        let Ok(handle) = Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            pending.lock().await.remove(&token);
        });
    }
}

struct PrewarmReservationGuard {
    pending: PendingPrewarm,
    key: PrewarmKey,
    token: u64,
    cancelled: Arc<AtomicBool>,
}

impl Drop for PrewarmReservationGuard {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        let pending = Arc::clone(&self.pending);
        let key = self.key.clone();
        let token = self.token;
        if let Ok(mut pending_guard) = pending.try_lock() {
            if pending_guard
                .get(&key)
                .is_some_and(|reservation| reservation.token == token)
            {
                pending_guard.remove(&key);
            }
            return;
        }
        let Ok(handle) = Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            let mut pending = pending.lock().await;
            if pending
                .get(&key)
                .is_some_and(|reservation| reservation.token == token)
            {
                pending.remove(&key);
            }
        });
    }
}

#[derive(Clone, Debug)]
pub enum SemanticSupervisorEvent {
    TrustChanged {
        generation: u64,
        workspace_epoch: u64,
        project_id: String,
        trust: SemanticTrust,
        policy_revision: u64,
        revoked: bool,
    },
    WorkspaceChanged {
        generation: u64,
        workspace_epoch: u64,
    },
    Shutdown {
        generation: u64,
    },
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct PrewarmKey {
    pub client_id: String,
    pub profile_id: String,
    pub project_id: String,
    pub descriptor_fingerprint: String,
    pub trust_policy_revision: u64,
    pub tab_generation: u64,
}

#[derive(Clone, Debug)]
pub struct PrewarmIntent {
    pub key: PrewarmKey,
    pub language: super::protocol::SemanticLanguage,
    pub project_root: PathBuf,
    pub trust: SemanticTrust,
    pub stable_for_ms: u64,
    pub workspace_generation: u64,
    pub workspace_epoch: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrewarmOutcome {
    Started,
    AlreadyPending,
    Reused,
}

impl SemanticSupervisor {
    pub fn new(
        registry: SemanticRegistry,
        trust_store: ProjectTrustStore,
        logical_cpus: usize,
        enabled: bool,
    ) -> Self {
        let global_cap = logical_cpus.clamp(1, 8);
        let (crash_notifier, mut crash_events) = CrashNotifier::channel();
        let crash_history = Arc::new(Mutex::new(HashMap::new()));
        let quarantined = Arc::new(Mutex::new(HashMap::new()));
        let backoff_until = Arc::new(Mutex::new(HashMap::new()));
        let sessions = Arc::new(Mutex::new(HashMap::<SessionKey, SessionEntry>::new()));
        let lifecycle_gate = Arc::new(RwLock::new(()));
        let metrics = Arc::new(SemanticMetrics::default());
        let (events, _) = broadcast::channel(128);
        let event_notifier = crash_notifier.clone();
        let event_history = Arc::clone(&crash_history);
        let event_quarantined = Arc::clone(&quarantined);
        let event_backoff = Arc::clone(&backoff_until);
        let event_metrics = Arc::clone(&metrics);
        let event_sessions = Arc::clone(&sessions);
        let event_lifecycle_gate = Arc::clone(&lifecycle_gate);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                while let Some(key) = crash_events.recv().await {
                    let _lifecycle = event_lifecycle_gate.write().await;
                    let decision = record_crash_state(
                        &key,
                        now_ms(),
                        &event_history,
                        &event_quarantined,
                        &event_backoff,
                        &event_metrics,
                    )
                    .await;
                    event_notifier.clear(&key);
                    tracing::warn!(
                        client_id = %key.client_id,
                        project_id = %key.project_id,
                        quarantined = decision.quarantined,
                        retry_after_ms = ?decision.delay_ms,
                        "semantic session crashed"
                    );
                    if let Some(entry) = event_sessions.lock().await.remove(&key) {
                        entry.session.cleanup_after_crash().await;
                    }
                }
            });
        }
        let supervisor = Self {
            registry: Arc::new(registry),
            trust_store,
            sessions,
            pending_sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_prewarm: Arc::new(Mutex::new(HashMap::new())),
            crash_history,
            quarantined,
            backoff_until,
            global_slots: Arc::new(Semaphore::new(global_cap)),
            metrics,
            enabled: Arc::new(AtomicBool::new(enabled)),
            crash_notifier,
            shutting_down: Arc::new(AtomicBool::new(false)),
            lifecycle_generation: Arc::new(AtomicU64::new(0)),
            workspace_epoch: Arc::new(AtomicU64::new(0)),
            next_reservation: Arc::new(AtomicU64::new(1)),
            lifecycle_gate,
            events,
        };
        supervisor.spawn_idle_sweeper();
        supervisor
    }

    fn spawn_idle_sweeper(&self) {
        let supervisor = self.clone();
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if supervisor.shutting_down.load(Ordering::Acquire) {
                    return;
                }
                supervisor.evict_idle(now_ms()).await;
            }
        });
    }

    pub fn registry(&self) -> Arc<SemanticRegistry> {
        Arc::clone(&self.registry)
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    /// Return raw verified bundle availability, without applying the runtime gate.
    pub fn raw_availability(&self, language: SemanticLanguage) -> SemanticDescriptorAvailability {
        self.registry.availability(language)
    }

    /// Return whether any supported bundled descriptor is ready to run.
    pub fn semantic_capability(&self) -> SemanticCapabilitySummary {
        let mut unavailable_reason = None;
        for language in [
            SemanticLanguage::Rust,
            SemanticLanguage::Typescript,
            SemanticLanguage::Javascript,
        ] {
            let availability = self.raw_availability(language);
            if availability.state == DescriptorAvailabilityState::Ready {
                return SemanticCapabilitySummary {
                    available: true,
                    disabled_reason: None,
                };
            }
            if unavailable_reason.is_none() {
                unavailable_reason = Some(safe_availability_reason(availability.reason));
            }
        }
        SemanticCapabilitySummary {
            available: false,
            disabled_reason: unavailable_reason.flatten().or(Some(
                "A valid signed semantic bundle is required on this server.",
            )),
        }
    }

    pub fn availability(&self, language: SemanticLanguage) -> SemanticDescriptorAvailability {
        let mut availability = self.registry.availability(language);
        if !self.is_enabled() {
            availability.state = DescriptorAvailabilityState::UnsupportedCapability;
            availability.reason = Some(DescriptorAvailabilityReason::CapabilityUnsupported);
        }
        availability
    }

    /// Apply a persisted semantic setting and fence all existing semantic work.
    pub async fn reconfigure(&self, enabled: bool) {
        let _lifecycle = self.lifecycle_gate.write().await;
        if self.enabled.swap(enabled, Ordering::AcqRel) == enabled {
            return;
        }
        self.cleanup_workspace_locked().await;
    }

    /// Fence a config/workspace replacement while synchronizing its semantic gate.
    pub async fn invalidate_workspace_with_enabled(&self, enabled: bool) {
        let _lifecycle = self.lifecycle_gate.write().await;
        self.enabled.store(enabled, Ordering::Release);
        self.cleanup_workspace_locked().await;
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SemanticSupervisorEvent> {
        self.events.subscribe()
    }

    /// Monotonic fence for workspace and semantic lifecycle replacements.
    pub fn lifecycle_generation(&self) -> u64 {
        self.lifecycle_generation.load(Ordering::Acquire)
    }

    pub fn is_lifecycle_current(&self, generation: u64) -> bool {
        self.lifecycle_generation() == generation
    }

    pub fn workspace_epoch(&self) -> u64 {
        self.workspace_epoch.load(Ordering::Acquire)
    }

    pub fn is_workspace_current(&self, epoch: u64) -> bool {
        self.workspace_epoch() == epoch
    }

    pub async fn lifecycle_read(&self) -> tokio::sync::OwnedRwLockReadGuard<()> {
        Arc::clone(&self.lifecycle_gate).read_owned().await
    }

    pub fn trust_state(
        &self,
        project_id: &str,
        project_root: &std::path::Path,
    ) -> Result<SemanticTrustState, SupervisorError> {
        self.trust_store
            .state(project_id, project_root)
            .map_err(SupervisorError::Trust)
    }

    pub fn issue_trust_challenge(
        &self,
        project_id: &str,
        project_root: &std::path::Path,
    ) -> Result<SemanticTrustChallenge, SupervisorError> {
        self.trust_store
            .issue_challenge(
                project_id,
                project_root,
                super::trust_store::DEFAULT_CHALLENGE_TTL_MS,
            )
            .map_err(SupervisorError::Trust)
    }

    async fn reserve_session(&self, key: &SessionKey) -> Result<u64, SupervisorError> {
        let mut pending = self.pending_sessions.lock().await;
        let sessions = self.sessions.lock().await;
        let existing = sessions
            .keys()
            .filter(|existing| {
                existing.client_id == key.client_id && existing.project_id == key.project_id
            })
            .count();
        if pending.values().any(|reservation| reservation.key == *key) {
            return Err(SupervisorError::SessionPending);
        }
        let waiting = pending
            .values()
            .filter(|reservation| {
                reservation.client_id == key.client_id && reservation.project_id == key.project_id
            })
            .count();
        if existing + waiting >= MAX_SESSIONS_PER_CLIENT_PROJECT {
            self.metrics
                .requests_rejected
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return Err(SupervisorError::ClientProjectLimit);
        }
        let token = self.next_reservation.fetch_add(1, Ordering::Relaxed);
        pending.insert(
            token,
            PendingSession {
                client_id: key.client_id.clone(),
                project_id: key.project_id.clone(),
                key: key.clone(),
            },
        );
        Ok(token)
    }

    async fn release_session(&self, token: u64) {
        self.pending_sessions.lock().await.remove(&token);
    }

    pub async fn existing_session(&self, key: &SessionKey) -> Option<Arc<LspSession>> {
        self.sessions
            .lock()
            .await
            .get(key)
            .map(|entry| Arc::clone(&entry.session))
    }

    pub async fn release_session_if(&self, key: &SessionKey, session: &Arc<LspSession>) {
        let entry = {
            let mut sessions = self.sessions.lock().await;
            if sessions
                .get(key)
                .is_some_and(|entry| Arc::ptr_eq(&entry.session, session))
            {
                sessions.remove(key)
            } else {
                None
            }
        };
        if let Some(entry) = entry {
            entry.session.shutdown().await;
        }
    }

    pub async fn ensure_session(
        &self,
        key: SessionKey,
        language: super::protocol::SemanticLanguage,
        project_root: PathBuf,
        trust: SemanticTrust,
    ) -> Result<Arc<LspSession>, SupervisorError> {
        self.ensure_session_at_generation(
            key,
            language,
            project_root,
            trust,
            SessionAdmission::default(),
        )
        .await
    }

    pub async fn ensure_session_for_client(
        &self,
        key: SessionKey,
        language: super::protocol::SemanticLanguage,
        project_root: PathBuf,
        trust: SemanticTrust,
        client_closed: Arc<AtomicBool>,
        fence: SemanticSessionFence,
    ) -> Result<Arc<LspSession>, SupervisorError> {
        self.ensure_session_at_generation(
            key,
            language,
            project_root,
            trust,
            SessionAdmission {
                expected_generation: Some(fence.lifecycle_generation),
                expected_workspace_epoch: Some(fence.workspace_epoch),
                client_closed: Some(client_closed),
                ..SessionAdmission::default()
            },
        )
        .await
    }

    async fn ensure_session_at_generation(
        &self,
        key: SessionKey,
        language: super::protocol::SemanticLanguage,
        project_root: PathBuf,
        trust: SemanticTrust,
        admission: SessionAdmission,
    ) -> Result<Arc<LspSession>, SupervisorError> {
        let SessionAdmission {
            expected_generation,
            expected_workspace_epoch,
            prewarm_cancel,
            client_closed,
        } = admission;
        if !self.is_enabled() {
            return Err(SupervisorError::Disabled);
        }
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(SupervisorError::ShuttingDown);
        }
        let lifecycle_generation = self.lifecycle_generation.load(Ordering::Acquire);
        if expected_generation.is_some_and(|expected| expected != lifecycle_generation)
            || expected_workspace_epoch.is_some_and(|expected| expected != self.workspace_epoch())
            || prewarm_cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Acquire))
            || client_closed
                .as_ref()
                .is_some_and(|closed| closed.load(Ordering::Acquire))
        {
            return Err(SupervisorError::LifecycleChanged);
        }
        key.validate()?;
        let project_root = project_root
            .canonicalize()
            .map_err(|_| SupervisorError::Session(SessionError::InvalidProjectRoot))?;
        if !project_root.is_dir() {
            return Err(SupervisorError::Session(SessionError::InvalidProjectRoot));
        }
        let expected_fingerprint = self
            .registry
            .descriptor_fingerprint(language)
            .ok_or(SupervisorError::UnsupportedCapability)?;
        if key.descriptor_fingerprint != expected_fingerprint {
            return Err(SupervisorError::DescriptorFingerprintMismatch);
        }
        let record = self.trust_store.record(&key.project_id, &project_root)?;
        if record.policy_revision != key.trust_policy_revision || record.trust != trust {
            return Err(SupervisorError::TrustPolicyChanged);
        }
        if trust == SemanticTrust::Revoked {
            return Err(SupervisorError::ProjectRevoked);
        }
        let mut crashed = false;
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(entry) = sessions.get(&key) {
                if entry.session.state() == SessionState::Crashed {
                    sessions.remove(&key);
                    crashed = true;
                } else {
                    self.metrics
                        .sessions_reused
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    return Ok(Arc::clone(&entry.session));
                }
            }
        }
        if !crashed {
            if let Some(error) = self.admission_error(&key).await {
                return Err(error);
            }
        }
        if crashed {
            if self.crash_notifier.is_pending(&key) {
                return Err(SupervisorError::Backoff { retry_after_ms: 50 });
            }
            if let Some(error) = self.admission_error(&key).await {
                return Err(error);
            }
            let decision = self.record_crash(&key, now_ms()).await;
            if decision.quarantined {
                return Err(SupervisorError::Quarantined);
            }
            return Err(SupervisorError::Backoff {
                retry_after_ms: decision.delay_ms.unwrap_or(50),
            });
        }
        let reservation = self.reserve_session(&key).await?;
        let _reservation_guard = SessionReservationGuard {
            pending: Arc::clone(&self.pending_sessions),
            token: reservation,
        };
        let global_slot = match self.global_slots.clone().try_acquire_owned() {
            Ok(slot) => slot,
            Err(_) => {
                self.evict_one_idle(now_ms()).await;
                match self.global_slots.clone().try_acquire_owned() {
                    Ok(slot) => slot,
                    Err(_) => {
                        self.release_session(reservation).await;
                        return Err(SupervisorError::GlobalLimit);
                    }
                }
            }
        };
        let bundle = match self.registry.resolve(language) {
            Ok(bundle) => bundle,
            Err(error) => {
                self.release_session(reservation).await;
                return Err(error.into());
            }
        };
        let policy = self
            .registry
            .descriptor(language)
            .ok_or(SupervisorError::UnsupportedCapability);
        let policy = match policy {
            Ok(descriptor) => descriptor.policy_for(trust),
            Err(error) => {
                self.release_session(reservation).await;
                return Err(error);
            }
        };
        let _lifecycle = self.lifecycle_gate.write().await;
        if !self.is_enabled()
            || self.shutting_down.load(Ordering::Acquire)
            || self.lifecycle_generation.load(Ordering::Acquire) != lifecycle_generation
            || expected_workspace_epoch.is_some_and(|expected| expected != self.workspace_epoch())
            || prewarm_cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Acquire))
            || client_closed
                .as_ref()
                .is_some_and(|closed| closed.load(Ordering::Acquire))
        {
            self.release_session(reservation).await;
            return Err(if self.shutting_down.load(Ordering::Acquire) {
                SupervisorError::ShuttingDown
            } else {
                SupervisorError::LifecycleChanged
            });
        }
        let current_record = match self.trust_store.record(&key.project_id, &project_root) {
            Ok(record) => record,
            Err(error) => {
                self.release_session(reservation).await;
                return Err(SupervisorError::Trust(error));
            }
        };
        if current_record.policy_revision != key.trust_policy_revision
            || current_record.trust != trust
        {
            self.release_session(reservation).await;
            return Err(if current_record.trust == SemanticTrust::Revoked {
                SupervisorError::ProjectRevoked
            } else {
                SupervisorError::TrustPolicyChanged
            });
        }
        let session = LspSession::start(
            key.clone(),
            bundle,
            project_root.clone(),
            policy,
            self.crash_notifier.clone(),
        )
        .await;
        let session = match session {
            Ok(session) => session,
            Err(error) => {
                self.release_session(reservation).await;
                return Err(error.into());
            }
        };
        if session.state() != SessionState::Ready
            || self.crash_notifier.is_pending(&key)
            || prewarm_cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Acquire))
            || client_closed
                .as_ref()
                .is_some_and(|closed| closed.load(Ordering::Acquire))
        {
            self.release_session(reservation).await;
            session.cleanup_after_crash().await;
            return Err(
                if prewarm_cancel
                    .as_ref()
                    .is_some_and(|cancel| cancel.load(Ordering::Acquire))
                {
                    SupervisorError::LifecycleChanged
                } else {
                    SupervisorError::Session(SessionError::NotReady)
                },
            );
        }
        let mut pending_sessions = self.pending_sessions.lock().await;
        if !pending_sessions.contains_key(&reservation)
            || prewarm_cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Acquire))
            || client_closed
                .as_ref()
                .is_some_and(|closed| closed.load(Ordering::Acquire))
        {
            drop(pending_sessions);
            session.cleanup_after_crash().await;
            return Err(SupervisorError::LifecycleChanged);
        }
        let mut sessions = self.sessions.lock().await;
        if session.state() != SessionState::Ready
            || self.crash_notifier.is_pending(&key)
            || prewarm_cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Acquire))
            || client_closed
                .as_ref()
                .is_some_and(|closed| closed.load(Ordering::Acquire))
        {
            drop(sessions);
            pending_sessions.remove(&reservation);
            drop(pending_sessions);
            session.cleanup_after_crash().await;
            return Err(SupervisorError::Session(SessionError::NotReady));
        }
        if let Some(entry) = sessions.get(&key) {
            let existing = Arc::clone(&entry.session);
            pending_sessions.remove(&reservation);
            drop(sessions);
            drop(pending_sessions);
            session.shutdown().await;
            return Ok(existing);
        }
        sessions.insert(
            key,
            SessionEntry {
                session: Arc::clone(&session),
                _global_slot: global_slot,
            },
        );
        pending_sessions.remove(&reservation);
        drop(sessions);
        drop(pending_sessions);
        self.metrics
            .sessions_started
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(session)
    }

    pub async fn request_prewarm(
        &self,
        intent: PrewarmIntent,
    ) -> Result<PrewarmOutcome, SupervisorError> {
        if !self.is_enabled() {
            return Err(SupervisorError::Disabled);
        }
        if intent.stable_for_ms < PREWARM_DWELL_MS {
            return Err(SupervisorError::DwellNotSatisfied);
        }
        let key = intent.key.clone();
        let token = self.next_reservation.fetch_add(1, Ordering::Relaxed);
        let prewarm_cancel = Arc::new(AtomicBool::new(false));
        let mut pending = self.pending_prewarm.lock().await;
        if pending.contains_key(&key) {
            return Ok(PrewarmOutcome::AlreadyPending);
        }
        pending.insert(
            key.clone(),
            PrewarmReservation {
                token,
                cancelled: Arc::clone(&prewarm_cancel),
            },
        );
        drop(pending);
        let _reservation_guard = PrewarmReservationGuard {
            pending: Arc::clone(&self.pending_prewarm),
            key: key.clone(),
            token,
            cancelled: Arc::clone(&prewarm_cancel),
        };
        let result = self
            .ensure_session_at_generation(
                SessionKey {
                    client_id: key.client_id.clone(),
                    profile_id: key.profile_id.clone(),
                    project_id: key.project_id.clone(),
                    descriptor_fingerprint: key.descriptor_fingerprint.clone(),
                    trust_policy_revision: key.trust_policy_revision,
                },
                intent.language,
                intent.project_root,
                intent.trust,
                SessionAdmission {
                    expected_generation: Some(intent.workspace_generation),
                    expected_workspace_epoch: Some(intent.workspace_epoch),
                    prewarm_cancel: Some(Arc::clone(&prewarm_cancel)),
                    ..SessionAdmission::default()
                },
            )
            .await;
        let mut pending = self.pending_prewarm.lock().await;
        if pending
            .get(&key)
            .is_some_and(|reservation| reservation.token == token)
        {
            pending.remove(&key);
        }
        result.map(|_| PrewarmOutcome::Started)
    }

    pub async fn evict_idle(&self, now_ms: u64) -> usize {
        self.evict_idle_limit(now_ms, None).await
    }

    async fn evict_one_idle(&self, now_ms: u64) -> usize {
        self.evict_idle_limit(now_ms, Some(1)).await
    }

    async fn evict_idle_limit(&self, now_ms: u64, limit: Option<usize>) -> usize {
        let mut removed = Vec::new();
        {
            let mut sessions = self.sessions.lock().await;
            let mut keys: Vec<_> = sessions
                .iter()
                .filter(|(_, entry)| entry.session.is_idle(now_ms, IDLE_GRACE_MS))
                .map(|(key, entry)| (key.clone(), entry.session.last_activity_ms()))
                .collect();
            keys.sort_by_key(|(_, last_activity)| *last_activity);
            if let Some(limit) = limit {
                keys.truncate(limit);
            }
            for (key, _) in keys {
                if let Some(entry) = sessions.remove(&key) {
                    removed.push(entry);
                }
            }
        }
        let removed_count = removed.len();
        for entry in removed {
            entry.session.shutdown().await;
        }
        self.metrics
            .sessions_evicted
            .fetch_add(removed_count as u64, std::sync::atomic::Ordering::Relaxed);
        removed_count
    }

    pub async fn invalidate_policy(&self, project_id: &str, current_revision: u64) {
        let entries: Vec<_> = {
            let mut sessions = self.sessions.lock().await;
            let keys: Vec<_> = sessions
                .keys()
                .filter(|key| {
                    key.project_id == project_id && key.trust_policy_revision != current_revision
                })
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| sessions.remove(&key))
                .collect()
        };
        for entry in entries {
            entry.session.shutdown().await;
        }
        self.pending_prewarm
            .lock()
            .await
            .retain(|key, reservation| {
                let keep =
                    key.project_id != project_id || key.trust_policy_revision == current_revision;
                if !keep {
                    reservation.cancelled.store(true, Ordering::Release);
                }
                keep
            });
        self.pending_sessions
            .lock()
            .await
            .retain(|_, reservation| reservation.project_id != project_id);
    }

    pub async fn release_client(&self, client_id: &str) {
        let mut pending_prewarm = self.pending_prewarm.lock().await;
        pending_prewarm.retain(|key, reservation| {
            let keep = key.client_id != client_id;
            if !keep {
                reservation.cancelled.store(true, Ordering::Release);
            }
            keep
        });
        drop(pending_prewarm);
        self.pending_sessions
            .lock()
            .await
            .retain(|_, reservation| reservation.client_id != client_id);
        let entries: Vec<_> = {
            let mut sessions = self.sessions.lock().await;
            let keys: Vec<_> = sessions
                .keys()
                .filter(|key| key.client_id == client_id)
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| sessions.remove(&key))
                .collect()
        };
        for entry in entries {
            entry.session.shutdown().await;
        }
    }

    /// Close every semantic session before a new workspace sandbox is admitted.
    pub async fn invalidate_workspace(&self) {
        let _lifecycle = self.lifecycle_gate.write().await;
        self.cleanup_workspace_locked().await;
    }

    async fn cleanup_workspace_locked(&self) {
        let generation = self.lifecycle_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let workspace_epoch = self.workspace_epoch.fetch_add(1, Ordering::AcqRel) + 1;
        let entries: Vec<_> = self
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in entries {
            entry.session.shutdown().await;
        }
        let mut pending_prewarm = self.pending_prewarm.lock().await;
        for reservation in pending_prewarm.values() {
            reservation.cancelled.store(true, Ordering::Release);
        }
        pending_prewarm.clear();
        drop(pending_prewarm);
        self.pending_sessions.lock().await.clear();
        let _ = self.events.send(SemanticSupervisorEvent::WorkspaceChanged {
            generation,
            workspace_epoch,
        });
    }

    pub async fn transition_trust(
        &self,
        request: &SemanticTrustTransitionRequest,
        project_root: &std::path::Path,
        audit_reason: &str,
        expected_workspace_epoch: u64,
    ) -> Result<TrustRecord, SupervisorError> {
        let _lifecycle = self.lifecycle_gate.write().await;
        if self.workspace_epoch() != expected_workspace_epoch {
            return Err(SupervisorError::LifecycleChanged);
        }
        let record = self
            .trust_store
            .transition(request, project_root, audit_reason)?;
        self.lifecycle_generation.fetch_add(1, Ordering::AcqRel);
        self.invalidate_policy(&record.project_id, record.policy_revision)
            .await;
        let _ = self.events.send(SemanticSupervisorEvent::TrustChanged {
            generation: self.lifecycle_generation(),
            workspace_epoch: self.workspace_epoch(),
            project_id: record.project_id.clone(),
            trust: record.trust,
            policy_revision: record.policy_revision,
            revoked: false,
        });
        Ok(record)
    }

    pub async fn revoke_project(
        &self,
        project_id: &str,
        project_root: &std::path::Path,
        audit_reason: &str,
        expected_workspace_epoch: u64,
    ) -> Result<TrustRecord, SupervisorError> {
        let _lifecycle = self.lifecycle_gate.write().await;
        if self.workspace_epoch() != expected_workspace_epoch {
            return Err(SupervisorError::LifecycleChanged);
        }
        let record = self
            .trust_store
            .revoke(project_id, project_root, audit_reason)?;
        self.lifecycle_generation.fetch_add(1, Ordering::AcqRel);
        let entries: Vec<_> = {
            let mut sessions = self.sessions.lock().await;
            let keys: Vec<_> = sessions
                .keys()
                .filter(|key| key.project_id == project_id)
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| sessions.remove(&key))
                .collect()
        };
        for entry in entries {
            entry.session.shutdown().await;
        }
        self.pending_prewarm
            .lock()
            .await
            .retain(|key, reservation| {
                let keep = key.project_id != project_id;
                if !keep {
                    reservation.cancelled.store(true, Ordering::Release);
                }
                keep
            });
        self.pending_sessions
            .lock()
            .await
            .retain(|_, reservation| reservation.project_id != project_id);
        let _ = self.events.send(SemanticSupervisorEvent::TrustChanged {
            generation: self.lifecycle_generation(),
            workspace_epoch: self.workspace_epoch(),
            project_id: record.project_id.clone(),
            trust: record.trust,
            policy_revision: record.policy_revision,
            revoked: true,
        });
        Ok(record)
    }

    pub async fn record_crash(&self, key: &SessionKey, now_ms: u64) -> CrashDecision {
        record_crash_state(
            key,
            now_ms,
            &self.crash_history,
            &self.quarantined,
            &self.backoff_until,
            &self.metrics,
        )
        .await
    }

    async fn admission_error(&self, key: &SessionKey) -> Option<SupervisorError> {
        let now = now_ms();
        let mut quarantined = self.quarantined.lock().await;
        match quarantined.get(key).copied() {
            Some(until) if until > now => {
                return Some(SupervisorError::Quarantined);
            }
            Some(_) => {
                quarantined.remove(key);
            }
            None => {}
        }
        drop(quarantined);
        let mut backoff = self.backoff_until.lock().await;
        match backoff.get(key).copied() {
            Some(until) if until > now => Some(SupervisorError::Backoff {
                retry_after_ms: until.saturating_sub(now),
            }),
            Some(_) => {
                backoff.remove(key);
                None
            }
            None => None,
        }
    }

    pub async fn shutdown(&self) {
        let _lifecycle = self.lifecycle_gate.write().await;
        self.lifecycle_generation.fetch_add(1, Ordering::AcqRel);
        self.shutting_down.store(true, Ordering::Release);
        let entries: Vec<_> = self
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in entries {
            entry.session.shutdown().await;
        }
        let mut pending_prewarm = self.pending_prewarm.lock().await;
        for reservation in pending_prewarm.values() {
            reservation.cancelled.store(true, Ordering::Release);
        }
        pending_prewarm.clear();
        drop(pending_prewarm);
        self.pending_sessions.lock().await.clear();
        self.quarantined.lock().await.clear();
        self.backoff_until.lock().await.clear();
        let _ = self.events.send(SemanticSupervisorEvent::Shutdown {
            generation: self.lifecycle_generation(),
        });
    }

    pub fn metrics(&self) -> SemanticMetricsSnapshot {
        self.metrics.snapshot()
    }
}

async fn record_crash_state(
    key: &SessionKey,
    now_ms: u64,
    crash_history: &Mutex<HashMap<SessionKey, VecDeque<u64>>>,
    quarantined: &Mutex<HashMap<SessionKey, u64>>,
    backoff_until: &Mutex<HashMap<SessionKey, u64>>,
    metrics: &SemanticMetrics,
) -> CrashDecision {
    let count = {
        let mut history = crash_history.lock().await;
        let events = history.entry(key.clone()).or_default();
        while events
            .front()
            .is_some_and(|event| now_ms.saturating_sub(*event) > CRASH_WINDOW_MS)
        {
            events.pop_front();
        }
        events.push_back(now_ms);
        events.len()
    };
    metrics
        .sessions_crashed
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let is_quarantined = count >= MAX_CRASHES_IN_WINDOW;
    let delay_ms = match count {
        1 => 250,
        2 => 1_000,
        3 => 2_000,
        4 => 4_000,
        _ => 30_000,
    };
    if is_quarantined {
        quarantined
            .lock()
            .await
            .insert(key.clone(), now_ms.saturating_add(CRASH_WINDOW_MS));
        backoff_until.lock().await.remove(key);
    } else {
        backoff_until
            .lock()
            .await
            .insert(key.clone(), now_ms.saturating_add(delay_ms));
    }
    CrashDecision {
        delay_ms: (!is_quarantined).then_some(delay_ms),
        quarantined: is_quarantined,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CrashDecision {
    pub delay_ms: Option<u64>,
    pub quarantined: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    #[error(transparent)]
    Session(#[from] SessionError),
    #[error(transparent)]
    Trust(#[from] super::trust_store::TrustStoreError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
    #[error("semantic project trust policy changed")]
    TrustPolicyChanged,
    #[error("semantic project is revoked")]
    ProjectRevoked,
    #[error("semantic capability is unsupported")]
    UnsupportedCapability,
    #[error("semantic navigation is disabled")]
    Disabled,
    #[error("semantic descriptor fingerprint is stale")]
    DescriptorFingerprintMismatch,
    #[error("semantic session admission is already pending")]
    SessionPending,
    #[error("semantic client/project session cap reached")]
    ClientProjectLimit,
    #[error("semantic global session cap reached")]
    GlobalLimit,
    #[error("semantic session is quarantined after repeated crashes")]
    Quarantined,
    #[error("semantic session is backing off after a crash")]
    Backoff { retry_after_ms: u64 },
    #[error("semantic supervisor is shutting down")]
    ShuttingDown,
    #[error("semantic lifecycle changed before admission")]
    LifecycleChanged,
    #[error("prewarm dwell has not elapsed")]
    DwellNotSatisfied,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::bundle::{hash_payload_tree, BundleCommandSpec, BundleResolver};
    use crate::semantic::bundle_manifest::{
        BundleArchitecture, BundleArtifact, BundleDescriptor, BundleManifest, BundleOs,
    };

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    fn write_lsp_fixture(path: &std::path::Path, lifetime_seconds: &str) {
        use std::os::unix::fs::PermissionsExt;

        let body = r#"{"jsonrpc":"2.0","id":"dam-hopper-initialize","result":{"capabilities":{}}}"#;
        let script = format!(
            "#!/bin/sh\nprintf 'Content-Length: {}\\r\\n\\r\\n{}'\n/bin/sleep {}\n",
            body.len(),
            body,
            lifetime_seconds
        );
        std::fs::write(path, script).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[tokio::test]
    async fn prewarm_requires_exact_dwell_and_reuses_one_process() {
        use sha2::Digest;

        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let payload = dir.path().join("payload");
        std::fs::create_dir(&payload).unwrap();
        let executable = payload.join("rust-analyzer");
        write_lsp_fixture(&executable, "10");
        let bytes = std::fs::read(&executable).unwrap();
        let digest = hex::encode(sha2::Sha256::digest(bytes));
        let manifest = BundleManifest {
            descriptors: vec![BundleDescriptor {
                descriptor_id: "rust-analyzer".into(),
                runtime_id: "native".into(),
                language: super::super::protocol::SemanticLanguage::Rust,
                version: "1.0.0".into(),
                target: super::super::bundle_manifest::BundleTarget {
                    os: BundleOs::Linux,
                    architecture: BundleArchitecture::X86_64,
                },
                artifact: BundleArtifact {
                    sha256: digest,
                    license_id: "MIT".into(),
                    sbom_component: "rust-analyzer".into(),
                    compressed_size_bytes: 1,
                    uncompressed_size_bytes: 2 * 1024 * 1024,
                    payload_tree_sha256: hash_payload_tree(&payload).unwrap(),
                },
            }],
        };
        let resolver = BundleResolver::new(dir.path(), manifest).with_command_spec(
            "rust-analyzer",
            BundleCommandSpec::new("payload/rust-analyzer", vec![]).unwrap(),
        );
        let registry = SemanticRegistry::new(resolver);
        let descriptor_fingerprint = registry
            .descriptor_fingerprint(super::super::protocol::SemanticLanguage::Rust)
            .unwrap();
        let store = ProjectTrustStore::open(dir.path().join("trust.json")).unwrap();
        let supervisor = SemanticSupervisor::new(registry, store, 1, true);
        let key = PrewarmKey {
            client_id: "client".into(),
            profile_id: "profile".into(),
            project_id: "project".into(),
            descriptor_fingerprint: descriptor_fingerprint.clone(),
            trust_policy_revision: 0,
            tab_generation: 1,
        };
        let intent = |stable_for_ms| PrewarmIntent {
            key: key.clone(),
            language: super::super::protocol::SemanticLanguage::Rust,
            project_root: project.clone(),
            trust: SemanticTrust::Restricted,
            stable_for_ms,
            workspace_generation: supervisor.lifecycle_generation(),
            workspace_epoch: supervisor.workspace_epoch(),
        };
        assert!(matches!(
            supervisor.request_prewarm(intent(749)).await,
            Err(SupervisorError::DwellNotSatisfied)
        ));
        let warm = supervisor.request_prewarm(intent(PREWARM_DWELL_MS)).await;
        assert!(matches!(warm, Ok(PrewarmOutcome::Started)), "{warm:?}");
        assert_eq!(supervisor.metrics().sessions_started, 1);

        supervisor.reconfigure(false).await;
        assert!(matches!(
            supervisor.request_prewarm(intent(PREWARM_DWELL_MS)).await,
            Err(SupervisorError::Disabled)
        ));
        supervisor.reconfigure(true).await;
        let warm_after_enable = supervisor.request_prewarm(intent(PREWARM_DWELL_MS)).await;
        assert!(matches!(warm_after_enable, Ok(PrewarmOutcome::Started)));
        assert_eq!(supervisor.metrics().sessions_started, 2);

        assert!(supervisor
            .ensure_session(
                SessionKey {
                    client_id: "client".into(),
                    profile_id: "profile".into(),
                    project_id: "project".into(),
                    descriptor_fingerprint,
                    trust_policy_revision: 0,
                },
                super::super::protocol::SemanticLanguage::Rust,
                project,
                SemanticTrust::Restricted,
            )
            .await
            .is_ok());
        assert_eq!(supervisor.metrics().sessions_reused, 1);
        assert_eq!(supervisor.evict_idle(now_ms() + IDLE_GRACE_MS).await, 1);
        supervisor.shutdown().await;
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[tokio::test]
    async fn child_exit_is_observed_as_a_crash() {
        use sha2::Digest;

        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let payload = dir.path().join("payload");
        std::fs::create_dir(&payload).unwrap();
        let executable = payload.join("rust-analyzer");
        write_lsp_fixture(&executable, "0.1");
        let digest = hex::encode(sha2::Sha256::digest(std::fs::read(&executable).unwrap()));
        let resolver = BundleResolver::new(
            dir.path(),
            BundleManifest {
                descriptors: vec![BundleDescriptor {
                    descriptor_id: "rust-analyzer".into(),
                    runtime_id: "native".into(),
                    language: super::super::protocol::SemanticLanguage::Rust,
                    version: "1.0.0".into(),
                    target: super::super::bundle_manifest::BundleTarget {
                        os: BundleOs::Linux,
                        architecture: BundleArchitecture::X86_64,
                    },
                    artifact: BundleArtifact {
                        sha256: digest,
                        license_id: "MIT".into(),
                        sbom_component: "rust-analyzer".into(),
                        compressed_size_bytes: 1,
                        uncompressed_size_bytes: 4096,
                        payload_tree_sha256: hash_payload_tree(&payload).unwrap(),
                    },
                }],
            },
        )
        .with_command_spec(
            "rust-analyzer",
            BundleCommandSpec::new("payload/rust-analyzer", vec![]).unwrap(),
        );
        let registry = SemanticRegistry::new(resolver);
        let fingerprint = registry
            .descriptor_fingerprint(super::super::protocol::SemanticLanguage::Rust)
            .unwrap();
        let supervisor = SemanticSupervisor::new(
            registry,
            ProjectTrustStore::open(dir.path().join("trust.json")).unwrap(),
            1,
            true,
        );
        let session = supervisor
            .ensure_session(
                SessionKey {
                    client_id: "client".into(),
                    profile_id: "profile".into(),
                    project_id: "project".into(),
                    descriptor_fingerprint: fingerprint,
                    trust_policy_revision: 0,
                },
                super::super::protocol::SemanticLanguage::Rust,
                project,
                SemanticTrust::Restricted,
            )
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        assert_eq!(session.state(), SessionState::Crashed);
        let retry_key = SessionKey {
            client_id: "client".into(),
            profile_id: "profile".into(),
            project_id: "project".into(),
            descriptor_fingerprint: supervisor
                .registry()
                .descriptor_fingerprint(super::super::protocol::SemanticLanguage::Rust)
                .unwrap(),
            trust_policy_revision: 0,
        };
        assert!(matches!(
            supervisor
                .ensure_session(
                    retry_key,
                    super::super::protocol::SemanticLanguage::Rust,
                    dir.path().join("project"),
                    SemanticTrust::Restricted,
                )
                .await,
            Err(SupervisorError::Backoff { .. })
        ));
        supervisor.shutdown().await;
    }

    #[tokio::test]
    async fn reconfigure_fences_lifecycle_and_updates_gate() {
        let dir = tempfile::tempdir().unwrap();
        let supervisor = SemanticSupervisor::new(
            SemanticRegistry::new(BundleResolver::new(
                dir.path(),
                BundleManifest {
                    descriptors: vec![],
                },
            )),
            ProjectTrustStore::open(dir.path().join("trust.json")).unwrap(),
            1,
            false,
        );
        let mut events = supervisor.subscribe();
        assert!(!supervisor.is_enabled());
        supervisor.reconfigure(false).await;
        assert_eq!(supervisor.lifecycle_generation(), 0);
        assert_eq!(supervisor.workspace_epoch(), 0);
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        supervisor.reconfigure(true).await;
        assert!(supervisor.is_enabled());
        let event = events.recv().await.unwrap();
        assert!(matches!(
            event,
            SemanticSupervisorEvent::WorkspaceChanged { .. }
        ));
        assert_eq!(supervisor.lifecycle_generation(), 1);
        assert_eq!(supervisor.workspace_epoch(), 1);
        supervisor.reconfigure(false).await;
        assert!(!supervisor.is_enabled());
        assert_eq!(supervisor.lifecycle_generation(), 2);
        assert_eq!(supervisor.workspace_epoch(), 2);
        supervisor.shutdown().await;
    }

    #[tokio::test]
    async fn crash_backoff_quarantines_after_five_events() {
        let dir = tempfile::tempdir().unwrap();
        let resolver = BundleResolver::new(
            dir.path(),
            BundleManifest {
                descriptors: vec![],
            },
        );
        let supervisor = SemanticSupervisor::new(
            SemanticRegistry::new(resolver),
            ProjectTrustStore::open(dir.path().join("trust.json")).unwrap(),
            1,
            true,
        );
        let key = SessionKey {
            client_id: "c".into(),
            profile_id: "profile".into(),
            project_id: "p".into(),
            descriptor_fingerprint: "d".into(),
            trust_policy_revision: 0,
        };
        assert_eq!(supervisor.record_crash(&key, 0).await.delay_ms, Some(250));
        assert_eq!(supervisor.record_crash(&key, 1).await.delay_ms, Some(1_000));
        assert_eq!(supervisor.record_crash(&key, 2).await.delay_ms, Some(2_000));
        assert_eq!(supervisor.record_crash(&key, 3).await.delay_ms, Some(4_000));
        assert!(supervisor.record_crash(&key, 4).await.quarantined);
    }
}
