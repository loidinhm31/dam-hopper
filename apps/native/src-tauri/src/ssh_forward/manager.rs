//! Rust-authoritative SSH forwarding lifecycle and activation ordering.

#![allow(
    clippy::result_large_err,
    clippy::too_many_arguments,
    reason = "The redacted command error is a fixed wire DTO, and the worker arguments are an explicit lifecycle context."
)]

use std::{
    collections::HashMap,
    io,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex, Semaphore},
    task::{AbortHandle, JoinHandle, JoinSet},
    time::{interval, sleep, timeout},
};

#[cfg(test)]
use std::sync::atomic::AtomicU8;

#[cfg(test)]
use tokio::sync::Notify;

use super::{
    credentials::{self, CredentialError},
    error::{SshForwardCommandError, SshForwardErrorCode},
    instance::{ClientEpochIssuer, DesktopClientContext},
    known_hosts::{ChallengeContext, HostKeyApproval, HostKeyChallengeBook, SshEndpoint},
    model::{
        AutoStartDisposition, OpenClientResult, PurgeScopeResult, SshForwardEventHint,
        SshForwardEventReason, SshForwardRuntime, SshForwardScopeActivation, SshForwardSnapshot,
        SshForwardState, SshKeyInventory, SshKeyInventoryItem, UtcTimestamp, WireCounter,
    },
    profile::SshForwardProfile,
    scope_retention::KnownScopesInput,
    ssh_client::{forward_socket, SshSession, SshTransportError},
    store::{FeatureRuntimeLease, ScopeActivityLease, ScopeStore, SshForwardStore, StoredTrust},
};

const ACTIVE_FORWARD_LIMIT: usize = 16;
const HANDSHAKE_CONCURRENCY_LIMIT: usize = 4;
const EVENT_MIN_INTERVAL: Duration = Duration::from_millis(250);
const WORKER_SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const WORKER_REAP_RESERVE: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Eq, PartialEq)]
struct ActivationIntent {
    latest_client_epoch: WireCounter,
    latest_activation_token: WireCounter,
    desired_scope_id: Option<String>,
}

#[derive(Clone)]
struct ActiveScope {
    id: String,
    generation: WireCounter,
    store: Arc<ScopeStore>,
    profiles_revision: WireCounter,
    trust_revision: WireCounter,
    _activity_lease: Arc<ScopeActivityLease>,
}

struct RuntimeEntry {
    generation: WireCounter,
    state: SshForwardState,
    local_port: u16,
    retry_attempt: u8,
    disposition: AutoStartDisposition,
    changed_at: UtcTimestamp,
    started_at: Option<UtcTimestamp>,
    error_code: Option<SshForwardErrorCode>,
    active_channels: Arc<AtomicU16>,
    suspended: bool,
    stop_tx: Option<oneshot::Sender<Instant>>,
    worker: Option<JoinHandle<()>>,
}

impl RuntimeEntry {
    fn stopped(generation: WireCounter, port: u16) -> Self {
        Self {
            generation,
            state: SshForwardState::Stopped,
            local_port: port,
            retry_attempt: 0,
            active_channels: Arc::new(AtomicU16::new(0)),
            disposition: AutoStartDisposition::NotRequested,
            changed_at: UtcTimestamp::now(),
            started_at: None,
            error_code: None,
            suspended: false,
            stop_tx: None,
            worker: None,
        }
    }

    fn snapshot(&self, profile_id: &str) -> SshForwardRuntime {
        SshForwardRuntime {
            profile_id: profile_id.into(),
            generation: self.generation,
            state: self.state,
            bind_host: Default::default(),
            local_port: self.local_port,
            retry_attempt: self.retry_attempt,
            active_channels: self.active_channels.load(Ordering::Acquire),
            auto_start_disposition: self.disposition,
            state_changed_at: self.changed_at,
            started_at: self.started_at,
            error_code: self.error_code,
        }
    }
}

#[cfg(test)]
#[repr(u8)]
#[derive(Clone, Copy)]
enum ActivationBarrierPoint {
    AfterIntent = 1,
    BeforeStop = 2,
    AfterStop = 3,
    AfterLoad = 4,
    BeforeCommit = 5,
    BeforeAutoStart = 6,
    BeforePublish = 7,
}

#[cfg(test)]
struct ActivationTestBarrier {
    point: AtomicU8,
    entered: Notify,
    release: Notify,
}

#[cfg(test)]
impl ActivationTestBarrier {
    fn new() -> Self {
        Self {
            point: AtomicU8::new(0),
            entered: Notify::new(),
            release: Notify::new(),
        }
    }

    fn enable(&self, point: ActivationBarrierPoint) {
        self.point.store(point as u8, Ordering::Release);
    }

    async fn wait_entered(&self) {
        self.entered.notified().await;
    }

    fn release(&self) {
        self.release.notify_one();
    }

    async fn pause_if_enabled(&self, point: ActivationBarrierPoint) {
        if self.point.load(Ordering::Acquire) == point as u8 {
            self.entered.notify_one();
            self.release.notified().await;
        }
    }
}

pub(crate) struct SshForwardManager {
    store: Arc<SshForwardStore>,
    _runtime_lease: FeatureRuntimeLease,
    identity: String,
    issuer: Mutex<ClientEpochIssuer>,
    intent: Mutex<ActivationIntent>,
    intent_admission_gate: Mutex<()>,
    command_gate: Mutex<()>,
    active_scope: Mutex<Option<ActiveScope>>,
    runtimes: Arc<Mutex<HashMap<String, RuntimeEntry>>>,
    challenges: Mutex<HostKeyChallengeBook>,
    app: Mutex<Option<AppHandle>>,
    event_times: Mutex<HashMap<String, Instant>>,
    abort_handles: std::sync::Mutex<HashMap<String, AbortHandle>>,
    handshake_gate: Arc<Semaphore>,
    shutting_down: AtomicBool,
    #[cfg(test)]
    activation_test_barrier: Arc<ActivationTestBarrier>,
}

impl SshForwardManager {
    pub(crate) fn new(app_config_dir: &Path) -> Result<Self, SshForwardCommandError> {
        let runtime_lease = SshForwardStore::acquire_feature_runtime_lease_at(app_config_dir)
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let store = Arc::new(
            SshForwardStore::open(app_config_dir)
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
        );
        let identity = store
            .load_or_create_desktop_instance()
            .map_err(|_| SshForwardErrorCode::IdentityCorrupt.command_error())?;
        let issuer =
            ClientEpochIssuer::new(identity.clone()).map_err(|code| code.command_error())?;
        Ok(Self {
            store,
            _runtime_lease: runtime_lease,
            identity,
            issuer: Mutex::new(issuer),
            intent: Mutex::new(ActivationIntent {
                latest_client_epoch: WireCounter::ZERO,
                latest_activation_token: WireCounter::ZERO,
                desired_scope_id: None,
            }),
            intent_admission_gate: Mutex::new(()),
            command_gate: Mutex::new(()),
            active_scope: Mutex::new(None),
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            challenges: Mutex::new(HostKeyChallengeBook::default()),
            app: Mutex::new(None),
            event_times: Mutex::new(HashMap::new()),
            abort_handles: std::sync::Mutex::new(HashMap::new()),
            handshake_gate: Arc::new(Semaphore::new(HANDSHAKE_CONCURRENCY_LIMIT)),
            shutting_down: AtomicBool::new(false),
            #[cfg(test)]
            activation_test_barrier: Arc::new(ActivationTestBarrier::new()),
        })
    }

    pub(crate) async fn attach_app(&self, app: AppHandle) {
        *self.app.lock().await = Some(app);
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::Acquire)
    }

    pub(crate) async fn open_client(
        &self,
        known_scopes: KnownScopesInput,
    ) -> Result<OpenClientResult, SshForwardCommandError> {
        self.ensure_running()?;
        let context = {
            let _admission = self.intent_admission_gate.lock().await;
            self.ensure_running()?;
            let context = {
                let mut issuer = self.issuer.lock().await;
                issuer.open_client().map_err(|code| code.command_error())?
            };
            let mut intent = self.intent.lock().await;
            intent.latest_client_epoch = context.client_epoch;
            intent.latest_activation_token = WireCounter::ZERO;
            context
        };
        let _command = self.command_gate.lock().await;
        self.ensure_running()?;
        for scope in self
            .store
            .enumerate_scopes()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
        {
            scope
                .reconcile_known_scope(&known_scopes, UtcTimestamp::now())
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        }
        let active = self.active_scope.lock().await.clone();
        Ok(OpenClientResult {
            context,
            activation_token_floor: WireCounter::ZERO,
            active_scope_id: active.as_ref().map(|scope| scope.id.clone()),
            scope_generation: active
                .as_ref()
                .map_or(WireCounter::ZERO, |scope| scope.generation),
        })
    }

    pub(crate) async fn activate_scope(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: Option<String>,
    ) -> Result<SshForwardScopeActivation, SshForwardCommandError> {
        self.ensure_running()?;
        let key = self
            .admit_activation(context, token, scope_id.clone())
            .await?;
        #[cfg(test)]
        self.activation_test_barrier
            .pause_if_enabled(ActivationBarrierPoint::AfterIntent)
            .await;
        let same_scope = self
            .active_scope
            .lock()
            .await
            .as_ref()
            .is_some_and(|active| Some(active.id.as_str()) == scope_id.as_deref());
        let staged_scope = if !same_scope {
            if let Some(id) = scope_id.clone() {
                let store = Arc::new(
                    self.store
                        .scope(&id)
                        .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
                );
                let activity_lease = Arc::new(
                    store
                        .acquire_activity_lease()
                        .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
                );
                let profiles = store
                    .load_profiles()
                    .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
                let trust = store
                    .load_trust()
                    .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
                self.check_intent(key).await?;
                let generation = self.next_scope_generation().await?;
                Some(ActiveScope {
                    id,
                    generation,
                    store,
                    profiles_revision: profiles.revision(),
                    trust_revision: trust.revision(),
                    _activity_lease: activity_lease,
                })
            } else {
                None
            }
        } else {
            None
        };
        #[cfg(test)]
        self.activation_test_barrier
            .pause_if_enabled(ActivationBarrierPoint::AfterLoad)
            .await;
        self.check_intent(key).await?;
        let _command = self.command_gate.lock().await;
        self.ensure_running()?;
        self.check_intent(key).await?;
        let same_scope = self
            .active_scope
            .lock()
            .await
            .as_ref()
            .is_some_and(|active| Some(active.id.as_str()) == scope_id.as_deref());
        if !same_scope {
            #[cfg(test)]
            self.activation_test_barrier
                .pause_if_enabled(ActivationBarrierPoint::BeforeStop)
                .await;
            self.stop_all_workers().await;
            #[cfg(test)]
            self.activation_test_barrier
                .pause_if_enabled(ActivationBarrierPoint::AfterStop)
                .await;
            self.ensure_running()?;
            self.check_intent(key).await?;
            let _admission = self.intent_admission_gate.lock().await;
            self.check_intent(key).await?;
            #[cfg(test)]
            self.activation_test_barrier
                .pause_if_enabled(ActivationBarrierPoint::BeforeCommit)
                .await;
            self.commit_scope(key, staged_scope).await?;
            self.runtimes.lock().await.clear();
        } else if scope_id.is_some() {
            self.restore_suspended_scope(context, token, key).await?;
        }
        self.check_intent(key).await?;
        if !same_scope && scope_id.is_some() {
            #[cfg(test)]
            self.activation_test_barrier
                .pause_if_enabled(ActivationBarrierPoint::BeforeAutoStart)
                .await;
            if let Err(error) = self.auto_start_scope(context, token, key).await {
                self.stop_all_workers().await;
                return Err(error);
            }
        }
        let snapshot = match scope_id.as_ref() {
            Some(id) => match self.snapshot_inner(context, token, id).await {
                Ok(snapshot) => Some(snapshot),
                Err(error) => {
                    self.stop_all_workers().await;
                    return Err(error);
                }
            },
            None => None,
        };
        if let Err(error) = self.check_intent(key).await {
            self.stop_all_workers().await;
            return Err(error);
        }
        #[cfg(test)]
        self.activation_test_barrier
            .pause_if_enabled(ActivationBarrierPoint::BeforePublish)
            .await;
        self.emit_hint(None, SshForwardEventReason::ProfilesChanged)
            .await;
        if let Err(error) = self.check_intent(key).await {
            self.stop_all_workers().await;
            return Err(error);
        }
        Ok(SshForwardScopeActivation {
            context: context.clone(),
            activation_token: token,
            scope_id,
            scope_generation: snapshot
                .as_ref()
                .map_or(WireCounter::ZERO, |value| value.scope_generation),
            snapshot,
        })
    }

    pub(crate) async fn snapshot(
        &self,
        request: &super::model::ScopeContextInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.checked_scope(
            &request.context,
            request.activation_token,
            &request.scope_id,
            request.scope_generation,
        )
        .await?;
        self.snapshot_inner(
            &request.context,
            request.activation_token,
            &request.scope_id,
        )
        .await
    }

    async fn snapshot_inner(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        self.ensure_context(context, token).await?;
        let active = self
            .active_scope
            .lock()
            .await
            .clone()
            .ok_or_else(|| SshForwardErrorCode::ScopeNotActive.command_error())?;
        if active.id != scope_id {
            return Err(SshForwardErrorCode::ScopeNotActive.command_error());
        }
        let profiles = active
            .store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let runtimes = self.runtimes.lock().await;
        let mut runtime_values = runtimes
            .iter()
            .map(|(id, runtime)| runtime.snapshot(id))
            .collect::<Vec<_>>();
        runtime_values.sort_by(|left, right| left.profile_id.cmp(&right.profile_id));
        drop(runtimes);
        let mut challenges = self.challenges.lock().await;
        let mut snapshot = SshForwardSnapshot {
            context: context.clone(),
            scope_id: scope_id.into(),
            activation_token: token,
            scope_generation: active.generation,
            profiles_revision: profiles.revision(),
            trust_revision: active
                .store
                .load_trust()
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
                .revision(),
            profiles: profiles
                .profiles()
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
            runtimes: runtime_values,
            host_key_challenges: challenges.snapshot(UtcTimestamp::now(), scope_id),
        };
        drop(challenges);
        snapshot
            .profiles
            .sort_by(|left, right| left.id.cmp(&right.id));
        self.ensure_context(context, token).await?;
        Ok(snapshot)
    }

    pub(crate) async fn create_profile(
        &self,
        input: &super::model::CreateProfileInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        let store = self
            .checked_scope(
                &input.request.context,
                input.request.activation_token,
                &input.request.scope_id,
                input.request.scope_generation,
            )
            .await?;
        let current = store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_revision(
            current.revision(),
            input.request.expected_profiles_revision,
            SshForwardErrorCode::ProfilesRevisionConflict,
        )?;
        let mut profiles = current
            .profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        if profiles.len() >= 64 {
            return Err(SshForwardErrorCode::ProfileLimit.command_error());
        }
        if input.profile.scope_id != input.request.scope_id
            || profiles
                .iter()
                .any(|profile| profile.id == input.profile.id)
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        input
            .profile
            .validate()
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        profiles.push(input.profile.clone());
        let next = super::store::StoredProfiles::from_profiles(&input.request.scope_id, profiles)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed_revision = {
            let _admission = self.intent_admission_gate.lock().await;
            let store = self
                .checked_scope(
                    &input.request.context,
                    input.request.activation_token,
                    &input.request.scope_id,
                    input.request.scope_generation,
                )
                .await?;
            let committed = store
                .replace_profiles(input.request.expected_profiles_revision, next)
                .map_err(|_| SshForwardErrorCode::ProfilesRevisionConflict.command_error())?;
            committed.revision()
        };
        self.update_profile_revision(committed_revision).await;
        self.emit_hint(
            Some(input.profile.id.clone()),
            SshForwardEventReason::ProfilesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn update_profile(
        &self,
        input: &super::model::UpdateProfileInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        let store = self
            .checked_scope(
                &input.request.context,
                input.request.activation_token,
                &input.request.scope_id,
                input.request.scope_generation,
            )
            .await?;
        let current = store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_revision(
            current.revision(),
            input.request.expected_profiles_revision,
            SshForwardErrorCode::ProfilesRevisionConflict,
        )?;
        self.check_profile_generation(&input.profile_id, input.expected_generation)
            .await?;
        let mut profiles = current
            .profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let Some(index) = profiles
            .iter()
            .position(|profile| profile.id == input.profile_id)
        else {
            return Err(SshForwardErrorCode::ProfileNotFound.command_error());
        };
        if self.profile_is_active(&input.profile_id).await {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        if input.profile.id != input.profile_id || input.profile.scope_id != input.request.scope_id
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        input
            .profile
            .validate()
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        profiles[index] = input.profile.clone();
        let next = super::store::StoredProfiles::from_profiles(&input.request.scope_id, profiles)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed_revision = {
            let _admission = self.intent_admission_gate.lock().await;
            let store = self
                .checked_scope(
                    &input.request.context,
                    input.request.activation_token,
                    &input.request.scope_id,
                    input.request.scope_generation,
                )
                .await?;
            self.check_profile_generation(&input.profile_id, input.expected_generation)
                .await?;
            if self.profile_is_active(&input.profile_id).await {
                return Err(SshForwardErrorCode::ProfileActive.command_error());
            }
            let committed = store
                .replace_profiles(input.request.expected_profiles_revision, next)
                .map_err(|_| SshForwardErrorCode::ProfilesRevisionConflict.command_error())?;
            committed.revision()
        };
        self.update_profile_revision(committed_revision).await;
        self.emit_hint(
            Some(input.profile_id.clone()),
            SshForwardEventReason::ProfilesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn delete_profile(
        &self,
        input: &super::model::DeleteProfileInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        let store = self
            .checked_scope(
                &input.request.context,
                input.request.activation_token,
                &input.request.scope_id,
                input.request.scope_generation,
            )
            .await?;
        let current = store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_revision(
            current.revision(),
            input.request.expected_profiles_revision,
            SshForwardErrorCode::ProfilesRevisionConflict,
        )?;
        self.check_profile_generation(&input.profile_id, input.expected_generation)
            .await?;
        if self.profile_is_active(&input.profile_id).await {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        let profiles = current
            .profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        if !profiles
            .iter()
            .any(|profile| profile.id == input.profile_id)
        {
            return Err(SshForwardErrorCode::ProfileNotFound.command_error());
        }
        let next_profiles = profiles
            .into_iter()
            .filter(|profile| profile.id != input.profile_id)
            .collect();
        let next =
            super::store::StoredProfiles::from_profiles(&input.request.scope_id, next_profiles)
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let committed_revision = {
            let _admission = self.intent_admission_gate.lock().await;
            let store = self
                .checked_scope(
                    &input.request.context,
                    input.request.activation_token,
                    &input.request.scope_id,
                    input.request.scope_generation,
                )
                .await?;
            self.check_profile_generation(&input.profile_id, input.expected_generation)
                .await?;
            if self.profile_is_active(&input.profile_id).await {
                return Err(SshForwardErrorCode::ProfileActive.command_error());
            }
            let committed = store
                .replace_profiles(input.request.expected_profiles_revision, next)
                .map_err(|_| SshForwardErrorCode::ProfilesRevisionConflict.command_error())?;
            self.challenges
                .lock()
                .await
                .clear_profile(&input.request.scope_id, &input.profile_id);
            committed.revision()
        };
        self.update_profile_revision(committed_revision).await;
        self.emit_hint(
            Some(input.profile_id.clone()),
            SshForwardEventReason::ProfilesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn start(
        self: &Arc<Self>,
        input: &super::model::ProfileLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.start_inner(input).await
    }

    async fn start_inner(
        self: &Arc<Self>,
        input: &super::model::ProfileLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let store = self
            .checked_scope(
                &input.context,
                input.activation_token,
                &input.scope_id,
                input.scope_generation,
            )
            .await?;
        let profiles = store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let profile = profiles
            .profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .into_iter()
            .find(|profile| profile.id == input.profile_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        let trust = store
            .load_trust()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let current_runtime = self
            .runtimes
            .lock()
            .await
            .get(&input.profile_id)
            .map(|runtime| (runtime.generation, runtime.state));
        if let Some((generation, SshForwardState::Failed)) = current_runtime {
            if self.challenges.lock().await.has_profile_generation(
                UtcTimestamp::now(),
                &input.scope_id,
                &input.profile_id,
                ChallengeContext {
                    client_epoch: input.context.client_epoch,
                    activation_token: input.activation_token,
                    scope_generation: input.scope_generation,
                    generation,
                },
                &input.context.desktop_instance_id,
                &input.context.manager_session_id,
            ) {
                return self
                    .snapshot_inner(&input.context, input.activation_token, &input.scope_id)
                    .await;
            }
        }
        let mut retired_workers = Vec::new();
        let (generation, already_active) = {
            let _admission = self.intent_admission_gate.lock().await;
            self.checked_scope(
                &input.context,
                input.activation_token,
                &input.scope_id,
                input.scope_generation,
            )
            .await?;
            let mut runtimes = self.runtimes.lock().await;
            if let Some(existing) = runtimes.get(&input.profile_id) {
                let unregistered_worker = existing.worker.is_none()
                    && matches!(
                        existing.state,
                        SshForwardState::Starting
                            | SshForwardState::Running
                            | SshForwardState::Reconnecting
                    );
                if existing.generation != input.expected_generation && !unregistered_worker {
                    return Err(self.generation_error(existing.generation));
                }
                if matches!(
                    existing.state,
                    SshForwardState::Starting
                        | SshForwardState::Running
                        | SshForwardState::Reconnecting
                ) && existing.worker.is_some()
                {
                    (existing.generation, true)
                } else {
                    let active_count = runtimes
                        .values()
                        .filter(|runtime| {
                            matches!(
                                runtime.state,
                                SshForwardState::Starting
                                    | SshForwardState::Running
                                    | SshForwardState::Reconnecting
                            )
                        })
                        .count();
                    if active_count >= ACTIVE_FORWARD_LIMIT {
                        return Err(SshForwardErrorCode::ActiveForwardLimit.command_error());
                    }
                    let next = input
                        .expected_generation
                        .increment()
                        .map_err(|_| SshForwardErrorCode::CounterExhausted.command_error())?;
                    let disposition = existing.disposition;
                    if let Some(existing) = runtimes.get_mut(&input.profile_id) {
                        if let Some(worker) = existing.worker.take() {
                            retired_workers.push((existing.stop_tx.take(), worker));
                        } else {
                            existing.stop_tx.take();
                        }
                    }
                    runtimes.insert(
                        input.profile_id.clone(),
                        RuntimeEntry {
                            generation: next,
                            state: SshForwardState::Starting,
                            local_port: profile.local_port,
                            retry_attempt: 0,
                            active_channels: Arc::new(AtomicU16::new(0)),
                            disposition,
                            changed_at: UtcTimestamp::now(),
                            started_at: None,
                            error_code: None,
                            suspended: false,
                            stop_tx: None,
                            worker: None,
                        },
                    );
                    (next, false)
                }
            } else if input.expected_generation != WireCounter::ZERO {
                return Err(self.generation_error(WireCounter::ZERO));
            } else {
                let active_count = runtimes
                    .values()
                    .filter(|runtime| {
                        matches!(
                            runtime.state,
                            SshForwardState::Starting
                                | SshForwardState::Running
                                | SshForwardState::Reconnecting
                        )
                    })
                    .count();
                if active_count >= ACTIVE_FORWARD_LIMIT {
                    return Err(SshForwardErrorCode::ActiveForwardLimit.command_error());
                }
                let next = input
                    .expected_generation
                    .increment()
                    .map_err(|_| SshForwardErrorCode::CounterExhausted.command_error())?;
                runtimes.insert(
                    input.profile_id.clone(),
                    RuntimeEntry {
                        generation: next,
                        state: SshForwardState::Starting,
                        local_port: profile.local_port,
                        retry_attempt: 0,
                        active_channels: Arc::new(AtomicU16::new(0)),
                        disposition: AutoStartDisposition::NotRequested,
                        changed_at: UtcTimestamp::now(),
                        started_at: None,
                        error_code: None,
                        suspended: false,
                        stop_tx: None,
                        worker: None,
                    },
                );
                (next, false)
            }
        };
        if already_active {
            return self
                .snapshot_inner(&input.context, input.activation_token, &input.scope_id)
                .await;
        }
        self.close_workers(retired_workers).await;
        self.abort_and_remove_handle(&input.profile_id);
        let registration = {
            let _admission = self.intent_admission_gate.lock().await;
            let result = self
                .checked_scope(
                    &input.context,
                    input.activation_token,
                    &input.scope_id,
                    input.scope_generation,
                )
                .await;
            if let Err(error) = result {
                if let Some(runtime) = self.runtimes.lock().await.get_mut(&input.profile_id) {
                    if runtime.generation == generation && runtime.worker.is_none() {
                        runtime.state = SshForwardState::Stopped;
                        runtime.suspended = false;
                        runtime.changed_at = UtcTimestamp::now();
                    }
                }
                Err(error)
            } else {
                let (stop_tx, stop_rx) = oneshot::channel::<Instant>();
                let (finished_tx, finished_rx) = oneshot::channel();
                let manager = Arc::clone(self);
                let context = input.context.clone();
                let scope_id = input.scope_id.clone();
                let profile_id = input.profile_id.clone();
                let token = input.activation_token;
                let scope_generation = input.scope_generation;
                let active_channels = self
                    .runtimes
                    .lock()
                    .await
                    .get(&input.profile_id)
                    .map(|runtime| Arc::clone(&runtime.active_channels));
                let task = tokio::spawn(async move {
                    manager
                        .run_profile(
                            profile,
                            trust,
                            context,
                            token,
                            scope_id,
                            scope_generation,
                            profile_id,
                            generation,
                            active_channels.unwrap_or_else(|| Arc::new(AtomicU16::new(0))),
                            stop_rx,
                        )
                        .await;
                    let _ = finished_tx.send(());
                });
                let abort_handle = task.abort_handle();
                self.abort_handles
                    .lock()
                    .expect("abort handle mutex poisoned")
                    .insert(input.profile_id.clone(), abort_handle);
                if let Some(runtime) = self.runtimes.lock().await.get_mut(&input.profile_id) {
                    runtime.stop_tx = Some(stop_tx);
                    runtime.worker = Some(task);
                    let manager = Arc::clone(self);
                    let profile_id = input.profile_id.clone();
                    tokio::spawn(async move {
                        let _ = finished_rx.await;
                        manager.worker_finished(&profile_id, generation).await;
                    });
                    if self.is_shutting_down() {
                        self.abort_and_remove_handle(&input.profile_id);
                    }
                } else {
                    task.abort();
                    self.abort_and_remove_handle(&input.profile_id);
                }
                Ok(())
            }
        };
        registration?;
        if self.is_shutting_down() {
            self.abort_and_remove_handle(&input.profile_id);
        }
        self.emit_hint(
            Some(input.profile_id.clone()),
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    pub(crate) async fn stop(
        &self,
        input: &super::model::ProfileLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.stop_inner(input).await
    }

    async fn stop_inner(
        &self,
        input: &super::model::ProfileLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let mut missing_runtime = false;
        let worker = {
            let _admission = self.intent_admission_gate.lock().await;
            self.checked_scope(
                &input.context,
                input.activation_token,
                &input.scope_id,
                input.scope_generation,
            )
            .await?;
            let mut runtimes = self.runtimes.lock().await;
            match runtimes.get_mut(&input.profile_id) {
                Some(runtime) => {
                    if runtime.generation != input.expected_generation {
                        return Err(self.generation_error(runtime.generation));
                    }
                    runtime.state = SshForwardState::Stopped;
                    runtime.error_code = None;
                    runtime.suspended = false;
                    runtime.changed_at = UtcTimestamp::now();
                    runtime.disposition = AutoStartDisposition::NotRequested;
                    let stop_tx = runtime.stop_tx.take();
                    runtime.worker.take().map(|worker| (stop_tx, worker))
                }
                None => {
                    if input.expected_generation != WireCounter::ZERO {
                        return Err(self.generation_error(WireCounter::ZERO));
                    }
                    missing_runtime = true;
                    None
                }
            }
        };
        if missing_runtime {
            return self
                .snapshot_inner(&input.context, input.activation_token, &input.scope_id)
                .await;
        }
        if let Some(worker) = worker {
            self.close_workers(vec![worker]).await;
        }
        self.abort_and_remove_handle(&input.profile_id);
        self.challenges
            .lock()
            .await
            .clear_profile(&input.scope_id, &input.profile_id);
        self.emit_hint(
            Some(input.profile_id.clone()),
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    pub(crate) async fn restart(
        self: &Arc<Self>,
        input: &super::model::ProfileLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.checked_scope(
            &input.context,
            input.activation_token,
            &input.scope_id,
            input.scope_generation,
        )
        .await?;
        let current_runtime = self
            .runtimes
            .lock()
            .await
            .get(&input.profile_id)
            .map(|runtime| (runtime.generation, runtime.state));
        if let Some((generation, SshForwardState::Failed)) = current_runtime {
            if self.challenges.lock().await.has_profile_generation(
                UtcTimestamp::now(),
                &input.scope_id,
                &input.profile_id,
                ChallengeContext {
                    client_epoch: input.context.client_epoch,
                    activation_token: input.activation_token,
                    scope_generation: input.scope_generation,
                    generation,
                },
                &input.context.desktop_instance_id,
                &input.context.manager_session_id,
            ) {
                return self
                    .snapshot_inner(&input.context, input.activation_token, &input.scope_id)
                    .await;
            }
        }
        self.stop_inner(input).await?;
        let mut next = input.clone();
        next.expected_generation = input.expected_generation;
        self.start_inner(&next).await
    }

    pub(crate) async fn list_keys(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        generation: WireCounter,
    ) -> Result<SshKeyInventory, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.checked_scope(context, token, scope_id, generation)
            .await?;
        let mut keys = credentials::agent_inventory()
            .await
            .map_err(map_credential_error)?;
        keys.extend(credentials::safe_key_inventory().map_err(map_credential_error)?);
        if !credentials::is_bounded_inventory(keys.len()) {
            return Err(SshForwardErrorCode::KeyUnsafe.command_error());
        }
        keys.sort_by(|left, right| left.key_id.cmp(&right.key_id));
        self.ensure_context(context, token).await?;
        Ok(SshKeyInventory {
            context: context.clone(),
            scope_id: scope_id.into(),
            scope_generation: generation,
            keys: keys
                .into_iter()
                .map(|key| SshKeyInventoryItem {
                    key_id: key.key_id,
                    label: key.label,
                    algorithm: key.algorithm,
                    fingerprint: key.fingerprint,
                })
                .collect(),
        })
    }

    pub(crate) async fn approve_host(
        &self,
        input: &super::model::ApproveHostInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        let store = self
            .checked_scope(
                &input.context,
                input.activation_token,
                &input.scope_id,
                input.scope_generation,
            )
            .await?;
        self.check_profile_generation(&input.profile_id, input.expected_generation)
            .await?;
        let trust = store
            .load_trust()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_revision(
            trust.revision(),
            input.expected_trust_revision,
            SshForwardErrorCode::TrustRevisionConflict,
        )?;
        let approval = HostKeyApproval {
            challenge_id: input.challenge_id.clone(),
            algorithm: input.algorithm.clone(),
            fingerprint: input.fingerprint.clone(),
            expected_generation: input.expected_generation,
            expected_trust_revision: input.expected_trust_revision,
        };
        let committed_revision = {
            let _admission = self.intent_admission_gate.lock().await;
            let store = self
                .checked_scope(
                    &input.context,
                    input.activation_token,
                    &input.scope_id,
                    input.scope_generation,
                )
                .await?;
            self.check_profile_generation(&input.profile_id, input.expected_generation)
                .await?;
            let approved = self
                .challenges
                .lock()
                .await
                .approve(
                    UtcTimestamp::now(),
                    &approval,
                    ChallengeContext {
                        client_epoch: input.context.client_epoch,
                        activation_token: input.activation_token,
                        scope_generation: input.scope_generation,
                        generation: input.expected_generation,
                    },
                    &input.scope_id,
                    &input.context.desktop_instance_id,
                    &input.context.manager_session_id,
                    &input.profile_id,
                )
                .map_err(|code| code.command_error())?;
            let mut next = trust;
            next.entries.push(approved.record);
            let committed = store
                .replace_trust(input.expected_trust_revision, next)
                .map_err(|_| SshForwardErrorCode::TrustRevisionConflict.command_error())?;
            committed.revision()
        };
        self.update_trust_revision(committed_revision).await;
        self.emit_hint(
            Some(input.profile_id.clone()),
            SshForwardEventReason::TrustChanged,
        )
        .await;
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    pub(crate) async fn purge_scope(
        &self,
        input: &super::model::PurgeScopeInput,
    ) -> Result<PurgeScopeResult, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        self.ensure_context(&input.context, input.activation_token)
            .await?;
        if self
            .active_scope
            .lock()
            .await
            .as_ref()
            .is_some_and(|active| active.id == input.scope_id)
            || self.intent.lock().await.desired_scope_id.as_deref() == Some(input.scope_id.as_str())
        {
            return Err(SshForwardErrorCode::ScopeActive.command_error());
        }
        let purged = match self.store.existing_scope(&input.scope_id) {
            Ok(store) => store
                .purge_if_deleted(&input.known_scopes)
                .map_err(|_| SshForwardErrorCode::ScopePurgeFailed.command_error())?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(_) => return Err(SshForwardErrorCode::ScopePurgeFailed.command_error()),
        };
        self.ensure_context(&input.context, input.activation_token)
            .await?;
        Ok(PurgeScopeResult {
            scope_id: input.scope_id.clone(),
            purged,
        })
    }

    pub(crate) async fn dispose(&self) {
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        let _command = self.command_gate.lock().await;
        self.stop_all_workers().await;
        *self.active_scope.lock().await = None;
        self.runtimes.lock().await.clear();
    }

    /// Emergency fallback after bounded graceful disposal; it only aborts tasks.
    pub(crate) fn force_close(&self) {
        self.shutting_down.store(true, Ordering::Release);
        let aborts = self
            .abort_handles
            .lock()
            .expect("abort handle mutex poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for handle in aborts {
            handle.abort();
        }
        self.abort_handles
            .lock()
            .expect("abort handle mutex poisoned")
            .clear();
        let runtimes = Arc::clone(&self.runtimes);
        match runtimes.try_lock() {
            Ok(mut runtimes) => {
                abort_runtime_entries(&mut runtimes);
                self.abort_handles
                    .lock()
                    .expect("abort handle mutex poisoned")
                    .clear();
            }
            Err(_) => defer_runtime_cleanup(Arc::clone(&runtimes)),
        };
    }

    async fn run_profile(
        self: Arc<Self>,
        profile: SshForwardProfile,
        trust: StoredTrust,
        context: DesktopClientContext,
        token: WireCounter,
        scope_id: String,
        scope_generation: WireCounter,
        profile_id: String,
        generation: WireCounter,
        active_channels: Arc<AtomicU16>,
        mut stop_rx: oneshot::Receiver<Instant>,
    ) {
        let endpoint = match SshEndpoint::new(&profile.ssh_host, profile.ssh_port) {
            Ok(endpoint) => endpoint,
            Err(code) => {
                self.fail_runtime(&profile_id, generation, code).await;
                return;
            }
        };
        let initial_connect = tokio::select! {
            _ = &mut stop_rx => return,
            permit = self.handshake_gate.acquire() => {
                let Ok(permit) = permit else {
                    self.fail_runtime(&profile_id, generation, SshForwardErrorCode::SshConnectFailed).await;
                    return;
                };
                let result = tokio::select! {
                    _ = &mut stop_rx => return,
                    result = SshSession::connect(&endpoint, &profile.ssh_user, &profile.auth, &trust) => result,
                };
                drop(permit);
                result
            }
        };
        let session = match initial_connect {
            Ok(session) => session,
            Err(error) => {
                if let SshTransportError::HostKeyRejected(offered) = &error {
                    let mut challenges = self.challenges.lock().await;
                    let _ = challenges.issue_or_repeat(
                        UtcTimestamp::now(),
                        ChallengeContext {
                            client_epoch: context.client_epoch,
                            activation_token: token,
                            scope_generation,
                            generation,
                        },
                        &scope_id,
                        &context.desktop_instance_id,
                        &context.manager_session_id,
                        &profile_id,
                        &endpoint,
                        offered,
                        trust.revision(),
                    );
                }
                self.fail_runtime(&profile_id, generation, error.error_code())
                    .await;
                return;
            }
        };
        let listener = match TcpListener::bind(("127.0.0.1", profile.local_port)).await {
            Ok(listener) => listener,
            Err(_) => {
                self.fail_runtime(&profile_id, generation, SshForwardErrorCode::LocalPortInUse)
                    .await;
                let _ = timeout(Duration::from_secs(5), session.close()).await;
                return;
            }
        };
        if !self.mark_running(&profile_id, generation).await {
            let _ = timeout(Duration::from_secs(5), session.close()).await;
            return;
        }
        let mut session = Some(session);
        let listener = listener;
        let limiter = super::ssh_client::ChannelLimiter::default();
        let mut channel_tasks = JoinSet::new();
        let mut keepalive = interval(Duration::from_secs(30));
        let mut stop_deadline = None;
        loop {
            while channel_tasks.try_join_next().is_some() {}
            tokio::select! {
                stopped = &mut stop_rx => {
                    stop_deadline = Some(stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE));
                    break;
                }
                accepted = listener.accept() => {
                    let Ok((socket, _)) = accepted else {
                        self.fail_runtime(&profile_id, generation, SshForwardErrorCode::BindFailed).await;
                        break;
                    };
                    let Some(permit) = limiter.try_acquire() else { continue; };
                    let channel = tokio::select! {
                        stopped = &mut stop_rx => {
                            stop_deadline = Some(stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE));
                            break;
                        }
                        result = session.as_mut().expect("session exists").open_direct_tcpip("127.0.0.1", profile.target_port, profile.local_port) => {
                            let Ok(channel) = result else { continue; };
                            channel
                        }
                    };
                    let channel_count = Arc::clone(&active_channels);
                    channel_count.fetch_add(1, Ordering::AcqRel);
                    channel_tasks.spawn(async move {
                        let _counter = ActiveChannelGuard(channel_count);
                        let _ = forward_socket(socket, channel, permit).await;
                    });
                }
                _ = keepalive.tick() => {
                    if session
                        .as_mut()
                        .expect("session exists")
                        .send_keepalive()
                        .await
                        .is_ok()
                    {
                        continue;
                    }
                    abort_channel_tasks(&mut channel_tasks, Instant::now() + WORKER_SHUTDOWN_GRACE).await;
                    if let Some(old_session) = session.take() {
                        let _ = timeout(WORKER_SHUTDOWN_GRACE, old_session.close()).await;
                    }
                    self.set_reconnecting(&profile_id, generation).await;
                    match self
                        .reconnect_session(&listener, &endpoint, &profile, &trust, &mut stop_rx)
                        .await
                    {
                        ReconnectResult::Connected(next) => {
                            session = Some(next);
                            if !self.mark_running(&profile_id, generation).await {
                                if let Some(next) = session.take() {
                                    let _ = timeout(WORKER_SHUTDOWN_GRACE, next.close()).await;
                                }
                                break;
                            }
                        }
                        ReconnectResult::Cancelled(deadline) => {
                            stop_deadline = Some(deadline);
                            break;
                        }
                        ReconnectResult::Failed(code) => {
                            self.fail_runtime(&profile_id, generation, code).await;
                            break;
                        }
                    }
                }
            }
        }
        // Drop the listener before waiting for child cleanup so Stop/scope switch/exit
        // makes the loopback port unreachable immediately.
        drop(listener);
        let deadline = stop_deadline.unwrap_or_else(|| Instant::now() + WORKER_SHUTDOWN_GRACE);
        abort_channel_tasks(&mut channel_tasks, deadline).await;
        if let Some(session) = session {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if !remaining.is_zero() {
                let _ = timeout(remaining, session.close()).await;
            }
        }
    }

    async fn reconnect_session(
        self: &Arc<Self>,
        listener: &TcpListener,
        endpoint: &SshEndpoint,
        profile: &SshForwardProfile,
        trust: &StoredTrust,
        stop_rx: &mut oneshot::Receiver<Instant>,
    ) -> ReconnectResult {
        if !profile.reconnect.enabled {
            return ReconnectResult::Failed(SshForwardErrorCode::SshConnectFailed);
        }
        for attempt in 1..=profile.reconnect.max_attempts {
            let backoff = sleep(Duration::from_secs(u64::from(attempt.min(30))));
            tokio::pin!(backoff);
            loop {
                tokio::select! {
                    stopped = &mut *stop_rx => {
                        return ReconnectResult::Cancelled(
                            stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE),
                        );
                    }
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else {
                            return ReconnectResult::Failed(SshForwardErrorCode::BindFailed);
                        };
                        drop(socket);
                    }
                    _ = &mut backoff => break,
                }
            }

            let manager = Arc::clone(self);
            let final_attempt = attempt == profile.reconnect.max_attempts;
            let endpoint = endpoint.clone();
            let profile = profile.clone();
            let trust = trust.clone();
            let mut connect =
                tokio::spawn(
                    async move { manager.connect_session(&endpoint, &profile, &trust).await },
                );
            loop {
                tokio::select! {
                    stopped = &mut *stop_rx => {
                        connect.abort();
                        let _ = connect.await;
                        return ReconnectResult::Cancelled(
                            stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE),
                        );
                    }
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else {
                            connect.abort();
                            let _ = connect.await;
                            return ReconnectResult::Failed(SshForwardErrorCode::BindFailed);
                        };
                        // Keep the bind reservation but reject admission while SSH is down.
                        drop(socket);
                    }
                    result = &mut connect => match result {
                        Ok(Ok(session)) => return ReconnectResult::Connected(session),
                        Ok(Err(error)) if final_attempt => {
                            return ReconnectResult::Failed(error.error_code());
                        }
                        Ok(Err(_)) => break,
                        Err(_) => return ReconnectResult::Failed(SshForwardErrorCode::SshConnectFailed),
                    }
                }
            }
        }
        ReconnectResult::Failed(SshForwardErrorCode::SshConnectFailed)
    }

    async fn connect_session(
        &self,
        endpoint: &SshEndpoint,
        profile: &SshForwardProfile,
        trust: &StoredTrust,
    ) -> Result<SshSession, SshTransportError> {
        let permit = self
            .handshake_gate
            .acquire()
            .await
            .map_err(|_| SshTransportError::Connect)?;
        let result = SshSession::connect(endpoint, &profile.ssh_user, &profile.auth, trust).await;
        drop(permit);
        result
    }

    async fn auto_start_scope(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        key: ActivationKey,
    ) -> Result<(), SshForwardCommandError> {
        let Some(active) = self.active_scope.lock().await.clone() else {
            return Ok(());
        };
        let profiles = active
            .store
            .load_profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .profiles()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let candidates = profiles
            .into_iter()
            .filter(|profile| profile.auto_start)
            .collect::<Vec<_>>();
        let (admitted, skipped) = partition_auto_start_candidates(candidates);
        let mut queued_ids = Vec::with_capacity(admitted.len());
        let mut reserved_ids = Vec::with_capacity(admitted.len() + skipped.len());
        for profile in &admitted {
            if let Err(error) = self.check_intent(key).await {
                self.runtimes
                    .lock()
                    .await
                    .retain(|profile_id, _| !reserved_ids.iter().any(|id| id == profile_id));
                return Err(error);
            }
            let mut runtime = RuntimeEntry::stopped(WireCounter::ZERO, profile.local_port);
            runtime.disposition = AutoStartDisposition::Queued;
            queued_ids.push(profile.id.clone());
            reserved_ids.push(profile.id.clone());
            self.runtimes
                .lock()
                .await
                .insert(profile.id.clone(), runtime);
        }
        for profile in &skipped {
            if let Err(error) = self.check_intent(key).await {
                self.runtimes
                    .lock()
                    .await
                    .retain(|profile_id, _| !reserved_ids.iter().any(|id| id == profile_id));
                return Err(error);
            }
            let mut runtime = RuntimeEntry::stopped(WireCounter::ZERO, profile.local_port);
            runtime.disposition = AutoStartDisposition::SkippedActiveLimit;
            runtime.error_code = Some(SshForwardErrorCode::AutoStartSkippedLimit);
            reserved_ids.push(profile.id.clone());
            self.runtimes
                .lock()
                .await
                .insert(profile.id.clone(), runtime);
        }
        if let Err(error) = self.check_intent(key).await {
            self.remove_reserved_runtimes(&reserved_ids).await;
            return Err(error);
        }

        // Reservation above fixes deterministic admission order. Launching the
        // independent starts together lets the worker-level handshake semaphore
        // use its configured concurrency of four without changing that order.
        let mut starts = JoinSet::new();
        for profile in admitted {
            let manager = Arc::clone(self);
            let input = super::model::ProfileLifecycleInput {
                context: context.clone(),
                activation_token: token,
                scope_id: active.id.clone(),
                scope_generation: active.generation,
                profile_id: profile.id,
                expected_generation: WireCounter::ZERO,
            };
            starts.spawn(async move { manager.start_inner(&input).await });
        }
        while let Some(result) = starts.join_next().await {
            match result {
                Ok(Ok(_)) | Err(_) => {}
                Ok(Err(error)) if error.code == SshForwardErrorCode::ActivationSuperseded => {
                    self.remove_queued_auto_start_runtimes(&queued_ids).await;
                    return Err(error);
                }
                Ok(Err(_)) => {}
            }
        }
        Ok(())
    }

    async fn remove_reserved_runtimes(&self, profile_ids: &[String]) {
        self.runtimes
            .lock()
            .await
            .retain(|profile_id, _| !profile_ids.iter().any(|id| id == profile_id));
    }

    async fn remove_queued_auto_start_runtimes(&self, profile_ids: &[String]) {
        self.runtimes.lock().await.retain(|profile_id, runtime| {
            !(runtime.state == SshForwardState::Stopped
                && runtime.disposition == AutoStartDisposition::Queued
                && profile_ids.iter().any(|id| id == profile_id))
        });
    }

    async fn restore_suspended_scope(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        key: ActivationKey,
    ) -> Result<(), SshForwardCommandError> {
        let Some(active) = self.active_scope.lock().await.clone() else {
            return Ok(());
        };
        let suspended = self
            .runtimes
            .lock()
            .await
            .iter()
            .filter(|(_, runtime)| runtime.suspended && runtime.worker.is_none())
            .map(|(profile_id, runtime)| (profile_id.clone(), runtime.generation))
            .collect::<Vec<_>>();
        for (profile_id, generation) in suspended {
            self.check_intent(key).await?;
            self.start_inner(&super::model::ProfileLifecycleInput {
                context: context.clone(),
                activation_token: token,
                scope_id: active.id.clone(),
                scope_generation: active.generation,
                profile_id,
                expected_generation: generation,
            })
            .await?;
        }
        Ok(())
    }

    async fn mark_running(&self, profile_id: &str, generation: WireCounter) -> bool {
        let mut runtimes = self.runtimes.lock().await;
        let Some(runtime) = runtimes.get_mut(profile_id) else {
            return false;
        };
        if runtime.generation != generation || runtime.state != SshForwardState::Starting {
            return false;
        }
        runtime.state = SshForwardState::Running;
        if runtime.disposition == AutoStartDisposition::Queued {
            runtime.disposition = AutoStartDisposition::Started;
        }
        runtime.started_at = Some(UtcTimestamp::now());
        runtime.changed_at = UtcTimestamp::now();
        true
    }

    async fn set_reconnecting(&self, profile_id: &str, generation: WireCounter) {
        if let Some(runtime) = self.runtimes.lock().await.get_mut(profile_id) {
            if runtime.generation == generation
                && matches!(
                    runtime.state,
                    SshForwardState::Starting
                        | SshForwardState::Running
                        | SshForwardState::Reconnecting
                )
            {
                runtime.state = SshForwardState::Reconnecting;
                runtime.changed_at = UtcTimestamp::now();
            }
        }
        self.emit_hint(
            Some(profile_id.into()),
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
    }

    async fn fail_runtime(
        &self,
        profile_id: &str,
        generation: WireCounter,
        code: SshForwardErrorCode,
    ) {
        if let Some(runtime) = self.runtimes.lock().await.get_mut(profile_id) {
            if runtime.generation == generation
                && matches!(
                    runtime.state,
                    SshForwardState::Starting
                        | SshForwardState::Running
                        | SshForwardState::Reconnecting
                )
            {
                runtime.state = SshForwardState::Failed;
                runtime.error_code = Some(code);
                runtime.changed_at = UtcTimestamp::now();
            }
        }
        self.emit_hint(
            Some(profile_id.into()),
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
    }

    async fn worker_finished(&self, profile_id: &str, generation: WireCounter) {
        // A worker cannot await its own JoinHandle. Dropping the matching completed
        // handle here releases its task resources while preserving a newer generation.
        let completed_current_generation = {
            let mut runtimes = self.runtimes.lock().await;
            if let Some(runtime) = runtimes.get_mut(profile_id) {
                if runtime.generation == generation {
                    runtime.stop_tx.take();
                    runtime.worker.take();
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };
        if completed_current_generation {
            self.abort_handles
                .lock()
                .expect("abort handle mutex poisoned")
                .remove(profile_id);
        }
    }

    async fn stop_all_workers(&self) {
        let workers = {
            let mut runtimes = self.runtimes.lock().await;
            runtimes
                .values_mut()
                .filter_map(|runtime| {
                    if matches!(
                        runtime.state,
                        SshForwardState::Starting
                            | SshForwardState::Running
                            | SshForwardState::Reconnecting
                    ) {
                        runtime.suspended = true;
                        runtime.state = SshForwardState::Stopped;
                        runtime.error_code = None;
                        runtime.changed_at = UtcTimestamp::now();
                    }
                    let stop_tx = runtime.stop_tx.take();
                    runtime.worker.take().map(|worker| (stop_tx, worker))
                })
                .collect::<Vec<_>>()
        };
        self.close_workers(workers).await;
        self.abort_handles
            .lock()
            .expect("abort handle mutex poisoned")
            .clear();
    }

    fn abort_and_remove_handle(&self, profile_id: &str) {
        if let Some(handle) = self
            .abort_handles
            .lock()
            .expect("abort handle mutex poisoned")
            .remove(profile_id)
        {
            handle.abort();
        }
    }

    async fn close_workers(
        &self,
        workers: Vec<(Option<oneshot::Sender<Instant>>, JoinHandle<()>)>,
    ) {
        self.close_workers_until(workers, Instant::now() + WORKER_SHUTDOWN_GRACE)
            .await;
    }

    async fn close_workers_until(
        &self,
        workers: Vec<(Option<oneshot::Sender<Instant>>, JoinHandle<()>)>,
        deadline: Instant,
    ) {
        let mut pending = JoinSet::new();
        let mut aborts = Vec::with_capacity(workers.len());
        for (stop_tx, worker) in workers {
            if let Some(stop_tx) = stop_tx {
                let _ = stop_tx.send(deadline);
            }
            aborts.push(worker.abort_handle());
            pending.spawn(async move {
                let _ = worker.await;
            });
        }

        // All workers get the stop signal before any await. Join them concurrently
        // and reserve the final slice to force cancellation and reap their joins.
        let reap_start = deadline - WORKER_REAP_RESERVE;
        while !pending.is_empty() {
            let remaining = reap_start.saturating_duration_since(Instant::now());
            if remaining.is_zero() || timeout(remaining, pending.join_next()).await.is_err() {
                break;
            }
        }
        if pending.is_empty() {
            return;
        }

        for abort in aborts {
            abort.abort();
        }
        while !pending.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() || timeout(remaining, pending.join_next()).await.is_err() {
                break;
            }
        }
    }

    async fn checked_scope(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        generation: WireCounter,
    ) -> Result<Arc<ScopeStore>, SshForwardCommandError> {
        self.ensure_context(context, token).await?;
        let active = self
            .active_scope
            .lock()
            .await
            .clone()
            .ok_or_else(|| SshForwardErrorCode::ScopeNotActive.command_error())?;
        if active.id != scope_id {
            return Err(SshForwardErrorCode::ScopeNotActive.command_error());
        }
        if active.generation != generation {
            return Err(self.scope_generation_error(active.generation));
        }
        Ok(active.store)
    }

    async fn ensure_context(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        self.ensure_running()?;
        if context.desktop_instance_id != self.identity {
            return Err(SshForwardErrorCode::DesktopInstanceMismatch.command_error());
        }
        let manager_session_id = {
            let issuer = self.issuer.lock().await;
            issuer.manager_session_id().to_owned()
        };
        if context.manager_session_id != manager_session_id {
            return Err(SshForwardErrorCode::ManagerSessionMismatch.command_error());
        }
        let intent = self.intent.lock().await;
        if context.client_epoch != intent.latest_client_epoch {
            return Err(SshForwardErrorCode::ClientEpochStale.command_error());
        }
        if token != intent.latest_activation_token {
            return Err(SshForwardErrorCode::ActivationSuperseded.command_error());
        }
        Ok(())
    }

    async fn admit_activation(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: Option<String>,
    ) -> Result<ActivationKey, SshForwardCommandError> {
        let _admission = self.intent_admission_gate.lock().await;
        if context.desktop_instance_id != self.identity {
            return Err(SshForwardErrorCode::DesktopInstanceMismatch.command_error());
        }
        let manager_session_id = {
            let issuer = self.issuer.lock().await;
            issuer.manager_session_id().to_owned()
        };
        if context.manager_session_id != manager_session_id {
            return Err(SshForwardErrorCode::ManagerSessionMismatch.command_error());
        }
        let mut intent = self.intent.lock().await;
        record_activation_intent(&mut intent, context.client_epoch, token, scope_id)
            .map_err(|code| code.command_error())?;
        Ok(ActivationKey {
            client_epoch: context.client_epoch,
            activation_token: token,
        })
    }

    async fn check_intent(&self, key: ActivationKey) -> Result<(), SshForwardCommandError> {
        let current = {
            let intent = self.intent.lock().await;
            (intent.latest_client_epoch, intent.latest_activation_token)
        };
        if current == (key.client_epoch, key.activation_token) {
            Ok(())
        } else {
            Err(SshForwardErrorCode::ActivationSuperseded.command_error())
        }
    }

    async fn commit_scope(
        &self,
        key: ActivationKey,
        next: Option<ActiveScope>,
    ) -> Result<(), SshForwardCommandError> {
        let current = {
            let intent = self.intent.lock().await;
            (intent.latest_client_epoch, intent.latest_activation_token)
        };
        if current != (key.client_epoch, key.activation_token) {
            return Err(SshForwardErrorCode::ActivationSuperseded.command_error());
        }
        *self.active_scope.lock().await = next;
        Ok(())
    }

    async fn next_scope_generation(&self) -> Result<WireCounter, SshForwardCommandError> {
        self.active_scope.lock().await.as_ref().map_or(
            Ok(WireCounter::parse("1").unwrap()),
            |active| {
                active
                    .generation
                    .increment()
                    .map_err(|_| SshForwardErrorCode::CounterExhausted.command_error())
            },
        )
    }

    async fn check_profile_generation(
        &self,
        profile_id: &str,
        expected: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        if let Some(runtime) = self.runtimes.lock().await.get(profile_id) {
            if runtime.generation != expected {
                return Err(self.generation_error(runtime.generation));
            }
        } else if expected != WireCounter::ZERO {
            return Err(self.generation_error(WireCounter::ZERO));
        }
        Ok(())
    }

    async fn profile_is_active(&self, profile_id: &str) -> bool {
        self.runtimes
            .lock()
            .await
            .get(profile_id)
            .is_some_and(|runtime| {
                !matches!(
                    runtime.state,
                    SshForwardState::Stopped | SshForwardState::Failed
                )
            })
    }

    async fn update_profile_revision(&self, revision: WireCounter) {
        if let Some(active) = self.active_scope.lock().await.as_mut() {
            active.profiles_revision = revision;
        }
    }

    async fn update_trust_revision(&self, revision: WireCounter) {
        if let Some(active) = self.active_scope.lock().await.as_mut() {
            active.trust_revision = revision;
        }
    }

    fn check_revision(
        &self,
        current: WireCounter,
        expected: WireCounter,
        code: SshForwardErrorCode,
    ) -> Result<(), SshForwardCommandError> {
        if current == expected {
            Ok(())
        } else {
            let mut error = code.command_error();
            if code == SshForwardErrorCode::TrustRevisionConflict {
                error.current_trust_revision = Some(current.to_string());
            } else {
                error.current_profiles_revision = Some(current.to_string());
            }
            Err(error)
        }
    }

    fn generation_error(&self, current: WireCounter) -> SshForwardCommandError {
        let mut error = SshForwardErrorCode::GenerationConflict.command_error();
        error.current_generation = Some(current.to_string());
        error
    }

    fn scope_generation_error(&self, current: WireCounter) -> SshForwardCommandError {
        let mut error = SshForwardErrorCode::ScopeGenerationConflict.command_error();
        error.current_scope_generation = Some(current.to_string());
        error
    }

    fn ensure_running(&self) -> Result<(), SshForwardCommandError> {
        if self.is_shutting_down() {
            Err(SshForwardErrorCode::ShutdownInProgress.command_error())
        } else {
            Ok(())
        }
    }

    async fn emit_hint(&self, profile_id: Option<String>, reason: SshForwardEventReason) {
        let Some(app) = self.app.lock().await.clone() else {
            return;
        };
        let now = Instant::now();
        let key = profile_id.clone().unwrap_or_default();
        let mut times = self.event_times.lock().await;
        if times
            .get(&key)
            .is_some_and(|last| now.duration_since(*last) < EVENT_MIN_INTERVAL)
        {
            return;
        }
        times.insert(key, now);
        drop(times);
        let active = self.active_scope.lock().await.clone();
        let Some(active) = active else {
            return;
        };
        let intent = self.intent.lock().await.clone();
        let manager_session_id = {
            let issuer = self.issuer.lock().await;
            issuer.manager_session_id().to_owned()
        };
        let _ = app.emit(
            "ssh-forward:changed",
            SshForwardEventHint {
                desktop_instance_id: self.identity.clone(),
                manager_session_id,
                client_epoch: intent.latest_client_epoch,
                activation_token: intent.latest_activation_token,
                scope_id: active.id,
                scope_generation: active.generation,
                profiles_revision: active.profiles_revision,
                trust_revision: active.trust_revision,
                profile_id,
                generation: None,
                reason,
            },
        );
    }
}

fn partition_auto_start_candidates(
    mut candidates: Vec<SshForwardProfile>,
) -> (Vec<SshForwardProfile>, Vec<SshForwardProfile>) {
    candidates.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    let split = candidates.len().min(ACTIVE_FORWARD_LIMIT);
    let skipped = candidates.split_off(split);
    (candidates, skipped)
}

fn record_activation_intent(
    intent: &mut ActivationIntent,
    client_epoch: WireCounter,
    activation_token: WireCounter,
    scope_id: Option<String>,
) -> Result<(), SshForwardErrorCode> {
    if client_epoch != intent.latest_client_epoch {
        return Err(SshForwardErrorCode::ClientEpochStale);
    }
    if activation_token <= intent.latest_activation_token {
        return Err(SshForwardErrorCode::ActivationSuperseded);
    }
    intent.latest_activation_token = activation_token;
    intent.desired_scope_id = scope_id;
    Ok(())
}

#[derive(Clone, Copy, Debug)]
struct ActivationKey {
    client_epoch: WireCounter,
    activation_token: WireCounter,
}

struct ActiveChannelGuard(Arc<AtomicU16>);

impl Drop for ActiveChannelGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

enum ReconnectResult {
    Connected(SshSession),
    Cancelled(Instant),
    Failed(SshForwardErrorCode),
}

fn abort_runtime_entries(runtimes: &mut HashMap<String, RuntimeEntry>) {
    for runtime in runtimes.values_mut() {
        if let Some(worker) = runtime.worker.take() {
            worker.abort();
        }
        runtime.stop_tx.take();
    }
    runtimes.clear();
}

fn defer_runtime_cleanup(runtimes: Arc<Mutex<HashMap<String, RuntimeEntry>>>) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            let mut runtimes = runtimes.lock().await;
            abort_runtime_entries(&mut runtimes);
        });
    } else {
        std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            runtime.block_on(async move {
                let mut runtimes = runtimes.lock().await;
                abort_runtime_entries(&mut runtimes);
            });
        });
    }
}

async fn abort_channel_tasks(tasks: &mut JoinSet<()>, deadline: Instant) {
    tasks.abort_all();
    while !tasks.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() || timeout(remaining, tasks.join_next()).await.is_err() {
            return;
        }
    }
}

fn map_credential_error(error: CredentialError) -> SshForwardCommandError {
    SshForwardErrorCode::from_credential(error).command_error()
}

fn _unused_duration() -> Duration {
    Duration::from_secs(5)
}

impl SshForwardErrorCode {
    fn from_credential(error: CredentialError) -> Self {
        match error {
            CredentialError::AgentUnavailable => Self::AgentUnavailable,
            CredentialError::KeyNotFound => Self::KeyNotFound,
            CredentialError::KeyUnsafe | CredentialError::InvalidInventory => Self::KeyUnsafe,
            CredentialError::KeyEncrypted => Self::KeyEncryptedUseAgent,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        net::SocketAddr,
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    use russh::{
        keys::{ssh_key::LineEnding, Algorithm, PrivateKey},
        server::{Auth, Handler, Server as ServerTrait},
    };
    use tokio::net::{TcpListener, TcpStream};

    use super::{
        abort_channel_tasks, partition_auto_start_candidates, record_activation_intent,
        ActivationBarrierPoint, ActivationIntent, ActivationKey, RuntimeEntry, SshForwardManager,
        ACTIVE_FORWARD_LIMIT, HANDSHAKE_CONCURRENCY_LIMIT,
    };
    use crate::ssh_forward::{
        error::SshForwardErrorCode,
        known_hosts::{ChallengeContext, OfferedHostKey, SshEndpoint},
        model::{
            ApproveHostInput, ProfileLifecycleInput, PurgeScopeInput, SshForwardState,
            UtcTimestamp, WireCounter,
        },
        profile::{LoopbackHost, ReconnectPolicy, SshForwardAuth, SshForwardProfile},
        scope_retention::KnownScopesInput,
        store::StoredProfiles,
    };

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";
    const SCOPE_2: &str = "d1f5890a-55d7-46ca-949b-0d63972f0a68";

    struct WorkerDropGuard(Arc<AtomicUsize>);

    impl Drop for WorkerDropGuard {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::AcqRel);
        }
    }

    #[derive(Clone)]
    struct TestSshServer;

    impl ServerTrait for TestSshServer {
        type Handler = Self;

        fn new_client(&mut self, _: Option<SocketAddr>) -> Self {
            self.clone()
        }
    }

    impl Handler for TestSshServer {
        type Error = russh::Error;

        async fn auth_publickey(
            &mut self,
            _: &str,
            _: &russh::keys::ssh_key::PublicKey,
        ) -> Result<Auth, Self::Error> {
            Ok(Auth::Accept)
        }
    }

    fn temp_config_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dam-hopper-phase04-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    async fn wait_for_token(manager: &Arc<SshForwardManager>, token: WireCounter) {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if manager.intent.lock().await.latest_activation_token == token {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn install_listener_worker(
        manager: &SshForwardManager,
        profile_id: &str,
    ) -> (SocketAddr, tokio::sync::oneshot::Receiver<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            let listener = listener;
            let _ = stop_rx.await;
            drop(listener);
            let _ = closed_tx.send(());
        });
        let mut runtime = RuntimeEntry::stopped(WireCounter::parse("1").unwrap(), address.port());
        runtime.state = SshForwardState::Running;
        runtime.stop_tx = Some(stop_tx);
        runtime.worker = Some(worker);
        manager
            .runtimes
            .lock()
            .await
            .insert(profile_id.into(), runtime);
        (address, closed_rx)
    }

    async fn assert_unreachable(address: SocketAddr) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if TcpStream::connect(address).await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("loopback listener remained reachable for five seconds");
    }

    fn auto_start_profile(index: usize) -> SshForwardProfile {
        SshForwardProfile {
            id: format!("{index:08x}-0000-4000-8000-000000000000"),
            scope_id: SCOPE.into(),
            name: format!("forward-{index}"),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            local_port: 20_000 + index as u16,
            target_host: LoopbackHost,
            target_port: 5_000 + index as u16,
            auto_start: true,
            reconnect: ReconnectPolicy {
                enabled: true,
                max_attempts: 1,
            },
            created_at: UtcTimestamp::parse(&format!("2026-08-10T12:34:{index:02}.000Z")).unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:35:00.000Z").unwrap(),
        }
    }

    #[test]
    fn auto_start_admission_is_sorted_and_marks_excess_profiles_skipped() {
        let mut profiles = (0..ACTIVE_FORWARD_LIMIT + 2)
            .map(auto_start_profile)
            .collect::<Vec<_>>();
        profiles.reverse();
        let (admitted, skipped) = partition_auto_start_candidates(profiles);
        assert_eq!(admitted.len(), ACTIVE_FORWARD_LIMIT);
        assert_eq!(skipped.len(), 2);
        assert_eq!(admitted.first().unwrap().id, auto_start_profile(0).id);
        assert_eq!(admitted.last().unwrap().id, auto_start_profile(15).id);
        assert_eq!(skipped[0].id, auto_start_profile(16).id);
        assert_eq!(skipped[1].id, auto_start_profile(17).id);
    }

    #[test]
    fn activation_keys_are_numeric_at_decimal_boundaries() {
        let nine = ActivationKey {
            client_epoch: WireCounter::parse("9").unwrap(),
            activation_token: WireCounter::parse("9").unwrap(),
        };
        let ten = ActivationKey {
            client_epoch: WireCounter::parse("10").unwrap(),
            activation_token: WireCounter::parse("1").unwrap(),
        };
        assert!(ten.client_epoch > nine.client_epoch);
        assert!(WireCounter::parse("99").unwrap() < WireCounter::parse("100").unwrap());
    }

    #[test]
    fn one_thousand_activation_schedules_keep_only_the_maximum_intent() {
        for schedule in 0..1_000u64 {
            let epoch = WireCounter::parse("1").unwrap();
            let mut intent = ActivationIntent {
                latest_client_epoch: epoch,
                latest_activation_token: WireCounter::ZERO,
                desired_scope_id: None,
            };
            let mut order = (1..=32u64).collect::<Vec<_>>();
            let mut seed = schedule.wrapping_add(1);
            for index in (1..order.len()).rev() {
                seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
                order.swap(index, (seed as usize) % (index + 1));
            }
            for token in order {
                let _ = record_activation_intent(
                    &mut intent,
                    epoch,
                    WireCounter::parse(&token.to_string()).unwrap(),
                    None,
                );
            }
            assert_eq!(intent.latest_activation_token.value(), 32);
            intent.latest_client_epoch = WireCounter::parse("2").unwrap();
            intent.latest_activation_token = WireCounter::ZERO;
            assert!(record_activation_intent(
                &mut intent,
                WireCounter::parse("2").unwrap(),
                WireCounter::parse("1").unwrap(),
                None,
            )
            .is_ok());
            assert!(matches!(
                record_activation_intent(
                    &mut intent,
                    WireCounter::parse("1").unwrap(),
                    WireCounter::parse("999").unwrap(),
                    None,
                ),
                Err(SshForwardErrorCode::ClientEpochStale)
            ));
        }
    }

    #[tokio::test]
    async fn activation_barriers_cover_each_slow_boundary() {
        let points = [
            ActivationBarrierPoint::AfterIntent,
            ActivationBarrierPoint::BeforeStop,
            ActivationBarrierPoint::AfterStop,
            ActivationBarrierPoint::AfterLoad,
            ActivationBarrierPoint::BeforeCommit,
            ActivationBarrierPoint::BeforeAutoStart,
            ActivationBarrierPoint::BeforePublish,
        ];
        for (index, point) in points.into_iter().enumerate() {
            let config = temp_config_dir(&format!("activation-barrier-{index}"));
            let manager = Arc::new(SshForwardManager::new(&config).unwrap());
            let opened = manager
                .open_client(KnownScopesInput::Available {
                    ids: vec![SCOPE.into()],
                })
                .await
                .unwrap();
            manager.activation_test_barrier.enable(point);
            let activation_manager = Arc::clone(&manager);
            let context = opened.context.clone();
            let activation = tokio::spawn(async move {
                activation_manager
                    .activate_scope(
                        &context,
                        WireCounter::parse("1").unwrap(),
                        Some(SCOPE.into()),
                    )
                    .await
            });
            tokio::time::timeout(
                Duration::from_secs(1),
                manager.activation_test_barrier.wait_entered(),
            )
            .await
            .unwrap();
            manager.activation_test_barrier.release();
            activation.await.unwrap().unwrap();
            drop(manager);
            std::fs::remove_dir_all(config).unwrap();
        }
    }

    #[tokio::test]
    async fn randomized_activation_schedules_commit_only_the_maximum_intent() {
        let config = temp_config_dir("activation-schedules");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into(), SCOPE_2.into()],
            })
            .await
            .unwrap();
        let mut order = (1..=1_000u64).collect::<Vec<_>>();
        let mut seed = 0x9e37_79b9_u64;
        for index in (1..order.len()).rev() {
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            order.swap(index, (seed as usize) % (index + 1));
        }
        let mut tasks = Vec::with_capacity(order.len());
        for token in order {
            let manager = Arc::clone(&manager);
            let context = opened.context.clone();
            let scope = if token % 2 == 0 { SCOPE } else { SCOPE_2 };
            tasks.push(tokio::spawn(async move {
                manager
                    .activate_scope(
                        &context,
                        WireCounter::parse(&token.to_string()).unwrap(),
                        Some(scope.into()),
                    )
                    .await
            }));
        }
        for task in tasks {
            let _ = task.await.unwrap();
        }
        assert_eq!(
            manager.intent.lock().await.latest_activation_token,
            WireCounter::parse("1000").unwrap()
        );
        assert_eq!(
            manager
                .active_scope
                .lock()
                .await
                .as_ref()
                .map(|scope| scope.id.as_str()),
            Some(SCOPE)
        );
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn delayed_a_b_c_activation_commits_only_c() {
        let config = temp_config_dir("abc");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available { ids: vec![] })
            .await
            .unwrap();
        let command_gate = manager.command_gate.lock().await;

        let a_manager = Arc::clone(&manager);
        let a_context = opened.context.clone();
        let a = tokio::spawn(async move {
            a_manager
                .activate_scope(&a_context, WireCounter::parse("1").unwrap(), None)
                .await
        });
        wait_for_token(&manager, WireCounter::parse("1").unwrap()).await;

        let b_manager = Arc::clone(&manager);
        let b_context = opened.context.clone();
        let b = tokio::spawn(async move {
            b_manager
                .activate_scope(&b_context, WireCounter::parse("2").unwrap(), None)
                .await
        });
        wait_for_token(&manager, WireCounter::parse("2").unwrap()).await;

        let c_manager = Arc::clone(&manager);
        let c_context = opened.context.clone();
        let c = tokio::spawn(async move {
            c_manager
                .activate_scope(&c_context, WireCounter::parse("3").unwrap(), None)
                .await
        });
        wait_for_token(&manager, WireCounter::parse("3").unwrap()).await;
        drop(command_gate);

        assert_eq!(
            a.await.unwrap().unwrap_err().code,
            SshForwardErrorCode::ActivationSuperseded
        );
        assert_eq!(
            b.await.unwrap().unwrap_err().code,
            SshForwardErrorCode::ActivationSuperseded
        );
        assert!(c.await.unwrap().is_ok());
        assert!(manager.active_scope.lock().await.is_none());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn new_client_epoch_rejects_old_high_token() {
        let config = temp_config_dir("epoch");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let first = manager
            .open_client(KnownScopesInput::Available { ids: vec![] })
            .await
            .unwrap();
        let second = manager
            .open_client(KnownScopesInput::Available { ids: vec![] })
            .await
            .unwrap();

        let stale = manager
            .admit_activation(&first.context, WireCounter::parse("999").unwrap(), None)
            .await
            .unwrap_err();
        assert_eq!(stale.code, SshForwardErrorCode::ClientEpochStale);
        assert!(manager
            .admit_activation(&second.context, WireCounter::parse("1").unwrap(), None,)
            .await
            .is_ok());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn manager_restart_rejects_previous_session_context() {
        let config = temp_config_dir("restart");
        let first_context = {
            let manager = Arc::new(SshForwardManager::new(&config).unwrap());
            manager
                .open_client(KnownScopesInput::Available { ids: vec![] })
                .await
                .unwrap()
                .context
        };
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let error = manager
            .activate_scope(&first_context, WireCounter::parse("1").unwrap(), None)
            .await
            .unwrap_err();
        assert_eq!(error.code, SshForwardErrorCode::ManagerSessionMismatch);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn same_scope_reload_preserves_scope_generation() {
        let config = temp_config_dir("reload");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let first = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let first_activation = manager
            .activate_scope(
                &first.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let second = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let second_activation = manager
            .activate_scope(
                &second.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        assert_eq!(
            first_activation.scope_generation,
            second_activation.scope_generation
        );
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn purge_requires_inactive_scope_and_is_idempotent() {
        let config = temp_config_dir("purge");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let first = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        manager
            .activate_scope(
                &first.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let active_error = manager
            .purge_scope(&PurgeScopeInput {
                context: first.context.clone(),
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                known_scopes: KnownScopesInput::Available { ids: vec![] },
            })
            .await
            .unwrap_err();
        assert_eq!(active_error.code, SshForwardErrorCode::ScopeActive);

        manager
            .activate_scope(&first.context, WireCounter::parse("2").unwrap(), None)
            .await
            .unwrap();
        let second = manager
            .open_client(KnownScopesInput::Available { ids: vec![] })
            .await
            .unwrap();
        let input = PurgeScopeInput {
            context: second.context,
            activation_token: WireCounter::ZERO,
            scope_id: SCOPE.into(),
            known_scopes: KnownScopesInput::Available { ids: vec![] },
        };
        assert!(manager.purge_scope(&input).await.unwrap().purged);
        assert!(!manager.purge_scope(&input).await.unwrap().purged);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn purge_rejects_scope_while_activation_is_staged() {
        let config = temp_config_dir("purge-staged");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        manager
            .activation_test_barrier
            .enable(ActivationBarrierPoint::AfterLoad);
        let activation_manager = Arc::clone(&manager);
        let activation_context = opened.context.clone();
        let activation = tokio::spawn(async move {
            activation_manager
                .activate_scope(
                    &activation_context,
                    WireCounter::parse("1").unwrap(),
                    Some(SCOPE.into()),
                )
                .await
        });
        manager.activation_test_barrier.wait_entered().await;
        assert!(manager.active_scope.lock().await.is_none());
        let error = manager
            .purge_scope(&PurgeScopeInput {
                context: opened.context,
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                known_scopes: KnownScopesInput::Available { ids: vec![] },
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, SshForwardErrorCode::ScopeActive);
        manager.activation_test_barrier.release();
        activation.await.unwrap().unwrap();
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn repeated_challenge_blocks_restart_until_stop_clears_it() {
        let config = temp_config_dir("challenge");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let activation = manager
            .activate_scope(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let profile_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let mut profile = auto_start_profile(0);
        profile.id = profile_id.into();
        profile.auto_start = false;
        let scope = manager.store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(
                WireCounter::ZERO,
                StoredProfiles::from_profiles(SCOPE, vec![profile]).unwrap(),
            )
            .unwrap();
        let mut runtime = RuntimeEntry::stopped(WireCounter::parse("1").unwrap(), 20_000);
        runtime.state = SshForwardState::Failed;
        manager
            .runtimes
            .lock()
            .await
            .insert(profile_id.into(), runtime);
        let endpoint = SshEndpoint::new("bastion.example", 22).unwrap();
        let offered = OfferedHostKey::from_russh(
            PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
                .unwrap()
                .public_key(),
        )
        .unwrap();
        let challenge_context = ChallengeContext {
            client_epoch: opened.context.client_epoch,
            activation_token: WireCounter::parse("1").unwrap(),
            scope_generation: activation.scope_generation,
            generation: WireCounter::parse("1").unwrap(),
        };
        let first = manager
            .challenges
            .lock()
            .await
            .issue_or_repeat(
                UtcTimestamp::now(),
                challenge_context,
                SCOPE,
                &opened.context.desktop_instance_id,
                &opened.context.manager_session_id,
                profile_id,
                &endpoint,
                &offered,
                WireCounter::ZERO,
            )
            .unwrap();
        let repeated = manager
            .challenges
            .lock()
            .await
            .issue_or_repeat(
                UtcTimestamp::now(),
                challenge_context,
                SCOPE,
                &opened.context.desktop_instance_id,
                &opened.context.manager_session_id,
                profile_id,
                &endpoint,
                &offered,
                WireCounter::ZERO,
            )
            .unwrap();
        assert_eq!(first.challenge_id, repeated.challenge_id);
        let input = ProfileLifecycleInput {
            context: opened.context,
            activation_token: WireCounter::parse("1").unwrap(),
            scope_id: SCOPE.into(),
            scope_generation: activation.scope_generation,
            profile_id: profile_id.into(),
            expected_generation: WireCounter::parse("1").unwrap(),
        };
        let start_snapshot = manager.start(&input).await.unwrap();
        assert_eq!(start_snapshot.host_key_challenges.len(), 1);
        let restart_snapshot = manager.restart(&input).await.unwrap();
        assert_eq!(restart_snapshot.host_key_challenges.len(), 1);
        let approved = manager
            .approve_host(&ApproveHostInput {
                context: input.context.clone(),
                activation_token: input.activation_token,
                scope_id: SCOPE.into(),
                scope_generation: input.scope_generation,
                profile_id: profile_id.into(),
                expected_generation: WireCounter::parse("1").unwrap(),
                challenge_id: first.challenge_id,
                algorithm: repeated.algorithm,
                fingerprint: repeated.fingerprint,
                expected_trust_revision: WireCounter::ZERO,
            })
            .await
            .unwrap();
        assert!(approved.host_key_challenges.is_empty());
        assert_eq!(
            approved.runtimes[0].generation,
            WireCounter::parse("1").unwrap()
        );
        assert_eq!(approved.runtimes[0].state, SshForwardState::Failed);
        manager.stop(&input).await.unwrap();
        assert_eq!(manager.challenges.lock().await.len(), 0);
        drop(scope);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn production_worker_listener_closes_after_stop() {
        let config = temp_config_dir("production-listener");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        let client_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        crate::ssh_forward::ssh_client::install_test_private_key(
            client_key
                .to_openssh(LineEnding::LF)
                .unwrap()
                .to_string()
                .into_bytes(),
        );

        let socket = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let server_address = socket.local_addr().unwrap();
        let server_config = russh::server::Config {
            keys: vec![host_key.clone()],
            auth_rejection_time: Duration::from_millis(0),
            auth_rejection_time_initial: Some(Duration::from_millis(0)),
            ..Default::default()
        };
        let (server_ready_tx, server_ready_rx) = tokio::sync::oneshot::channel();
        let server_task = tokio::spawn(async move {
            let mut server = TestSshServer;
            let running_server = server.run_on_socket(Arc::new(server_config), &socket);
            let server_handle = running_server.handle();
            let _ = server_ready_tx.send(server_handle);
            running_server.await
        });
        let server_handle = server_ready_rx.await.unwrap();

        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let activation = manager
            .activate_scope(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let scope = manager.store.scope(SCOPE).unwrap();
        let local_socket = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let local_port = local_socket.local_addr().unwrap().port();
        drop(local_socket);
        let profile_id = "f1f5890a-55d7-46ca-949b-0d63972f0a68";
        let profile = SshForwardProfile {
            id: profile_id.into(),
            scope_id: SCOPE.into(),
            name: "production-listener".into(),
            ssh_host: "127.0.0.1".into(),
            ssh_port: server_address.port(),
            ssh_user: "tester".into(),
            auth: SshForwardAuth::Key {
                key_id: crate::ssh_forward::ssh_client::TEST_PRIVATE_KEY_ID.into(),
            },
            local_port,
            target_host: LoopbackHost,
            target_port: 9,
            auto_start: false,
            reconnect: ReconnectPolicy {
                enabled: false,
                max_attempts: 1,
            },
            created_at: UtcTimestamp::parse("2026-08-14T10:00:00.000Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-14T10:00:00.000Z").unwrap(),
        };
        scope
            .replace_profiles(
                WireCounter::ZERO,
                StoredProfiles::from_profiles(SCOPE, vec![profile]).unwrap(),
            )
            .unwrap();
        let input = ProfileLifecycleInput {
            context: opened.context,
            activation_token: WireCounter::parse("1").unwrap(),
            scope_id: SCOPE.into(),
            scope_generation: activation.scope_generation,
            profile_id: profile_id.into(),
            expected_generation: WireCounter::ZERO,
        };
        manager.start(&input).await.unwrap();
        let challenge = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let failed = manager
                    .runtimes
                    .lock()
                    .await
                    .get(profile_id)
                    .is_some_and(|runtime| runtime.state == SshForwardState::Failed);
                if failed {
                    if let Some(challenge) = manager
                        .challenges
                        .lock()
                        .await
                        .snapshot(UtcTimestamp::now(), SCOPE)
                        .into_iter()
                        .next()
                    {
                        return challenge;
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("production forwarding worker did not issue host-key challenge");
        let approved = manager
            .approve_host(&ApproveHostInput {
                context: input.context.clone(),
                activation_token: input.activation_token,
                scope_id: SCOPE.into(),
                scope_generation: input.scope_generation,
                profile_id: profile_id.into(),
                expected_generation: WireCounter::parse("1").unwrap(),
                challenge_id: challenge.challenge_id,
                algorithm: challenge.algorithm,
                fingerprint: challenge.fingerprint,
                expected_trust_revision: WireCounter::ZERO,
            })
            .await
            .unwrap();
        assert!(approved.host_key_challenges.is_empty());
        let mut explicit_start = input.clone();
        explicit_start.expected_generation = WireCounter::parse("1").unwrap();
        manager.start(&explicit_start).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if manager
                    .runtimes
                    .lock()
                    .await
                    .get(profile_id)
                    .is_some_and(|runtime| {
                        runtime.generation == WireCounter::parse("2").unwrap()
                            && runtime.state == SshForwardState::Running
                    })
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("explicit start after host-key approval did not reach running state");
        assert!(TcpStream::connect(("127.0.0.1", local_port)).await.is_ok());

        let mut stop_input = explicit_start;
        stop_input.expected_generation = WireCounter::parse("2").unwrap();
        manager.stop(&stop_input).await.unwrap();
        assert_unreachable(SocketAddr::from(([127, 0, 0, 1], local_port))).await;
        server_handle.shutdown("test complete".into());
        tokio::time::timeout(Duration::from_secs(1), server_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        drop(scope);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn stop_closes_manager_listener_within_five_seconds() {
        let config = temp_config_dir("stop-listener");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let activation = manager
            .activate_scope(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let (address, closed) = install_listener_worker(&manager, "probe").await;
        assert!(TcpStream::connect(address).await.is_ok());

        let started = Instant::now();
        manager
            .stop(&ProfileLifecycleInput {
                context: opened.context,
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
                profile_id: "probe".into(),
                expected_generation: WireCounter::parse("1").unwrap(),
            })
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), closed)
            .await
            .unwrap()
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_unreachable(address).await;
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn scope_switch_closes_manager_listener() {
        let config = temp_config_dir("switch-listener");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        manager
            .activate_scope(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                Some(SCOPE.into()),
            )
            .await
            .unwrap();
        let (address, closed) = install_listener_worker(&manager, "probe").await;
        assert!(TcpStream::connect(address).await.is_ok());

        manager
            .activate_scope(&opened.context, WireCounter::parse("2").unwrap(), None)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), closed)
            .await
            .unwrap()
            .unwrap();
        assert_unreachable(address).await;
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn dispose_closes_manager_listener_before_returning() {
        let config = temp_config_dir("dispose-listener");
        let manager = SshForwardManager::new(&config).unwrap();
        let (address, closed) = install_listener_worker(&manager, "probe").await;
        assert!(TcpStream::connect(address).await.is_ok());

        manager.dispose().await;
        tokio::time::timeout(Duration::from_secs(1), closed)
            .await
            .unwrap()
            .unwrap();
        assert!(manager.is_shutting_down());
        assert_unreachable(address).await;
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn force_close_reaps_runtime_entries_after_lock_contention() {
        let config = temp_config_dir("force-close-lock");
        let manager = SshForwardManager::new(&config).unwrap();
        let (_address, _closed) = install_listener_worker(&manager, "probe").await;
        let runtimes = manager.runtimes.lock().await;
        manager.force_close();
        drop(runtimes);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if manager.runtimes.lock().await.is_empty() {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn force_close_reaps_runtime_entries_without_tokio_runtime() {
        let config = temp_config_dir("force-close-no-runtime");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        runtime.block_on(install_listener_worker(&manager, "probe"));
        let runtimes = runtime.block_on(manager.runtimes.lock());
        let manager_for_thread = Arc::clone(&manager);
        std::thread::spawn(move || manager_for_thread.force_close())
            .join()
            .unwrap();
        drop(runtimes);
        runtime.block_on(async {
            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    if manager.runtimes.lock().await.is_empty() {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        });
        drop(manager);
        drop(runtime);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn graceful_stop_signals_all_workers_and_joins_them() {
        let config = temp_config_dir("worker-reap");
        let manager = SshForwardManager::new(&config).unwrap();
        let observed = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<Instant>();
            let observed = Arc::clone(&observed);
            workers.push((
                Some(stop_tx),
                tokio::spawn(async move {
                    assert!(stop_rx.await.unwrap() > Instant::now());
                    observed.fetch_add(1, Ordering::AcqRel);
                }),
            ));
        }
        manager.close_workers(workers).await;
        assert_eq!(observed.load(Ordering::Acquire), 2);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn forced_worker_cancellation_reaps_every_join_before_deadline() {
        let config = temp_config_dir("forced-worker-reap");
        let manager = SshForwardManager::new(&config).unwrap();
        let observed = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (stop_tx, _stop_rx) = tokio::sync::oneshot::channel::<Instant>();
            let observed = Arc::clone(&observed);
            workers.push((
                Some(stop_tx),
                tokio::spawn(async move {
                    let _guard = WorkerDropGuard(observed);
                    std::future::pending::<()>().await;
                }),
            ));
        }
        manager
            .close_workers_until(workers, Instant::now() + Duration::from_secs(1))
            .await;
        assert_eq!(observed.load(Ordering::Acquire), 2);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn aborted_channel_tasks_are_drained_before_worker_returns() {
        let mut tasks = tokio::task::JoinSet::new();
        tasks.spawn(async { std::future::pending::<()>().await });
        abort_channel_tasks(&mut tasks, Instant::now() + Duration::from_secs(1)).await;
        assert!(tasks.is_empty());
    }

    #[tokio::test]
    async fn handshake_gate_never_exceeds_four_concurrent_connects() {
        let gate = Arc::new(tokio::sync::Semaphore::new(HANDSHAKE_CONCURRENCY_LIMIT));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let gate = Arc::clone(&gate);
            let active = Arc::clone(&active);
            let maximum = Arc::clone(&maximum);
            tasks.push(tokio::spawn(async move {
                let _permit = gate.acquire().await.unwrap();
                let current = active.fetch_add(1, Ordering::AcqRel) + 1;
                let mut observed = maximum.load(Ordering::Acquire);
                while current > observed {
                    match maximum.compare_exchange(
                        observed,
                        current,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ) {
                        Ok(_) => break,
                        Err(next) => observed = next,
                    }
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
                active.fetch_sub(1, Ordering::AcqRel);
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(maximum.load(Ordering::Acquire), HANDSHAKE_CONCURRENCY_LIMIT);
    }
}
