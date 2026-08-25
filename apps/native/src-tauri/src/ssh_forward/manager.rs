//! Rust-authoritative SSH forwarding lifecycle and activation ordering.

#![allow(
    clippy::result_large_err,
    clippy::too_many_arguments,
    reason = "The redacted command error is a fixed wire DTO, and the worker arguments are an explicit lifecycle context."
)]

use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc, Weak,
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
use zeroize::Zeroizing;

#[cfg(test)]
use tokio::sync::Notify;

#[cfg(test)]
use std::sync::atomic::AtomicU8;

use super::{
    connection_runtime::{
        runtime_task_key, ChildShutdown, ConnectionAdmission, ConnectionCancellation,
        ConnectionReconnectContext, ConnectionRegistry, DisconnectPlan, RuleAdmission,
        RuntimeError, SessionSlot,
    },
    credential_lease::CredentialLease,
    credential_vault::{
        arc_clock, scope_prefix_for, target_for, Clock, CredentialIdentity, CredentialKind,
        CredentialRecord, CredentialStatus, CredentialVault, VaultAuthIdentity, VaultError,
        VaultTarget, REMEMBER_FOR_DAYS,
    },
    credentials::{self, CredentialError},
    error::{SshForwardCommandError, SshForwardErrorCode},
    instance::{ClientEpochIssuer, DesktopClientContext},
    known_hosts::{ChallengeContext, HostKeyApproval, HostKeyChallengeBook, SshEndpoint},
    model::{
        AutoStartDisposition, OpenClientResult, PurgeScopeResult, SshConnectionState,
        SshForwardCredentialState, SshForwardCredentialStatus, SshForwardEventHint,
        SshForwardEventReason, SshForwardRuleState, SshForwardRuntime, SshForwardScopeActivation,
        SshForwardSnapshot, SshForwardState, SshForwardTrustRepairMetadata, SshKeyInventory,
        SshKeyInventoryItem, SshKeyInventorySource, UtcTimestamp, WireCounter,
    },
    profile::{
        canonical_connection_identity, SshConnectionProfile, SshForwardAuth, SshForwardProfile,
        SshForwardRule,
    },
    scope_retention::KnownScopesInput,
    ssh_client::{forward_socket, ChannelLimiter, SshSession, SshTransport, SshTransportError},
    store::{FeatureRuntimeLease, ScopeActivityLease, ScopeStore, SshForwardStore, StoredTrust},
};

#[cfg(windows)]
use super::store_schema::{StoredScopeConfigV2, MAX_SAVED_CONNECTIONS};

#[cfg(not(test))]
use super::credential_vault::WindowsCredentialVault;

const ACTIVE_FORWARD_LIMIT: usize = 16;
const HANDSHAKE_CONCURRENCY_LIMIT: usize = 4;
const EVENT_MIN_INTERVAL: Duration = Duration::from_millis(250);
// Transport/authentication have their own deadline; this outer bound also
// covers manager admission and finalization so the desktop caller always
// receives a result.
const CONNECT_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const WORKER_REAP_RESERVE: Duration = Duration::from_millis(250);

fn vault_error_code(error: VaultError) -> SshForwardErrorCode {
    match error {
        VaultError::Unavailable => SshForwardErrorCode::CredentialVaultUnavailable,
        VaultError::Corrupt | VaultError::InvalidIdentity | VaultError::InvalidRecord => {
            SshForwardErrorCode::CredentialVaultCorrupt
        }
        VaultError::WriteFailed => SshForwardErrorCode::CredentialNotSaved,
        VaultError::DeleteFailed => SshForwardErrorCode::CredentialDeleteFailed,
    }
}

fn credential_save_error_code(_: VaultError) -> SshForwardErrorCode {
    SshForwardErrorCode::CredentialNotSaved
}

fn store_write_error_code(error: &io::Error) -> SshForwardErrorCode {
    match error.to_string().as_str() {
        "connections_revision_conflict" => SshForwardErrorCode::ConnectionsRevisionConflict,
        "rules_revision_conflict" => SshForwardErrorCode::RulesRevisionConflict,
        "counter_exhausted" => SshForwardErrorCode::CounterExhausted,
        "scope_gone" => SshForwardErrorCode::ScopeNotActive,
        _ if error.kind() == io::ErrorKind::InvalidData => SshForwardErrorCode::StoreCorrupt,
        _ => SshForwardErrorCode::StoreIo,
    }
}

fn collection_store_error(
    store: &ScopeStore,
    error: io::Error,
    revision_code: SshForwardErrorCode,
    connections_revision: bool,
) -> SshForwardCommandError {
    let code = store_write_error_code(&error);
    let mut command = code.command_error();
    if code == revision_code {
        if let Ok(current) = store.load_scope_config() {
            if connections_revision {
                command.current_connections_revision =
                    Some(current.connections_revision.to_string());
            } else {
                command.current_rules_revision = Some(current.rules_revision.to_string());
            }
        }
    }
    command
}

fn connection_credential_target(
    connection: &SshConnectionProfile,
) -> Result<VaultTarget, SshForwardErrorCode> {
    connection_credential_target_parts(
        &connection.scope_id,
        &connection.id,
        &connection.ssh_host,
        connection.ssh_port,
        &connection.ssh_user,
        &connection.auth,
    )
}

fn connection_credential_target_parts(
    scope_id: &str,
    profile_id: &str,
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    auth: &SshForwardAuth,
) -> Result<VaultTarget, SshForwardErrorCode> {
    let endpoint = SshEndpoint::new(ssh_host, ssh_port)?;
    let auth = match auth {
        SshForwardAuth::Agent => VaultAuthIdentity::Password,
        SshForwardAuth::Key { key_id } => VaultAuthIdentity::KeyPassphrase(key_id.clone()),
    };
    target_for(&CredentialIdentity {
        scope_id: scope_id.into(),
        profile_id: profile_id.into(),
        endpoint_host: endpoint.host,
        endpoint_port: endpoint.port,
        ssh_user: ssh_user.into(),
        auth,
    })
    .map_err(vault_error_code)
}

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
    connections_revision: WireCounter,
    rules_revision: WireCounter,
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

#[derive(Clone)]
struct LoadedPassword {
    credential_attempt_id: String,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
    identity: CredentialIdentity,
    remember_for_days: u16,
}

#[derive(Clone)]
struct LoadedKeyAttempt {
    key: Arc<russh::keys::PrivateKey>,
    encrypted: bool,
    credential_attempt_id: String,
    passphrase: Zeroizing<String>,
    identity: CredentialIdentity,
    remember_for_days: u16,
}

struct ResolvedCredentials {
    key: Option<Arc<russh::keys::PrivateKey>>,
    key_encrypted: bool,
    lease: Option<Arc<CredentialLease>>,
    target: Option<VaultTarget>,
    saved_reuse: bool,
    remember_for_days: u16,
}

impl ResolvedCredentials {
    fn password(&self) -> Option<(&str, &str)> {
        self.lease.as_deref().and_then(CredentialLease::password)
    }

    fn key_passphrase(&self) -> Option<&str> {
        self.lease.as_deref().and_then(CredentialLease::passphrase)
    }

    fn is_expired(&self, now: UtcTimestamp) -> bool {
        self.lease
            .as_deref()
            .is_some_and(|lease| lease.is_expired(now))
    }
}

struct LoadedPasswordCleanup {
    manager: Arc<SshForwardManager>,
    scope_id: String,
    profile_id: String,
    key: Option<Arc<LoadedKeyAttempt>>,
    credential: Option<Arc<LoadedPassword>>,
}

impl Drop for LoadedPasswordCleanup {
    fn drop(&mut self) {
        if let Some(key) = self.key.as_ref() {
            self.manager
                .forget_loaded_key_if_same(&self.scope_id, &self.profile_id, key);
        }
        if let Some(credential) = self.credential.as_ref() {
            self.manager.forget_loaded_password_if_same(
                &self.scope_id,
                &self.profile_id,
                credential,
            );
        }
    }
}

struct ConnectionReservationGuard {
    registry: Arc<Mutex<ConnectionRegistry>>,
    connection_id: String,
    generation: WireCounter,
    cancellation: Arc<ConnectionCancellation>,
    armed: bool,
}

impl ConnectionReservationGuard {
    fn new(
        registry: Arc<Mutex<ConnectionRegistry>>,
        connection_id: &str,
        generation: WireCounter,
        cancellation: Arc<ConnectionCancellation>,
    ) -> Self {
        Self {
            registry,
            connection_id: connection_id.to_owned(),
            generation,
            cancellation,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ConnectionReservationGuard {
    fn drop(&mut self) {
        if self.armed {
            match self.registry.try_lock() {
                Ok(mut registry) => {
                    let _ = registry.discard_connection_if_matches(
                        &self.connection_id,
                        self.generation,
                        &self.cancellation,
                    );
                }
                Err(_) => defer_connection_reservation_cleanup(
                    Arc::clone(&self.registry),
                    self.connection_id.clone(),
                    self.generation,
                    Arc::clone(&self.cancellation),
                ),
            }
        }
    }
}

impl RuntimeEntry {
    #[cfg(test)]
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
    BeforeV2CollectionCommit = 8,
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

    fn disable(&self) {
        self.point.store(0, Ordering::Release);
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
    app_config_dir: PathBuf,
    executable_path: String,
    identity: String,
    issuer: Mutex<ClientEpochIssuer>,
    intent: Mutex<ActivationIntent>,
    intent_admission_gate: Mutex<()>,
    command_gate: Mutex<()>,
    rule_reconciliation_gate: Mutex<()>,
    connection_admission_gate: Mutex<()>,
    active_scope: Mutex<Option<ActiveScope>>,
    runtimes: Arc<Mutex<HashMap<String, RuntimeEntry>>>,
    /// V2 connection/rule registry. The legacy map remains only as a
    /// compatibility projection until Phase 04 removes its command aliases.
    connection_registry: Arc<Mutex<ConnectionRegistry>>,
    loaded_keys: std::sync::Mutex<HashMap<(String, String), Arc<LoadedKeyAttempt>>>,
    loaded_passwords: std::sync::Mutex<HashMap<(String, String), Arc<LoadedPassword>>>,
    rejected_credentials: std::sync::Mutex<HashSet<String>>,
    credential_vault: Arc<dyn CredentialVault>,
    clock: Arc<dyn Clock>,
    challenges: Mutex<HostKeyChallengeBook>,
    app: Mutex<Option<AppHandle>>,
    event_times: Mutex<HashMap<String, Instant>>,
    abort_handles: std::sync::Mutex<HashMap<String, AbortHandle>>,
    v2_abort_handles: std::sync::Mutex<HashMap<String, AbortHandle>>,
    handshake_gate: Arc<Semaphore>,
    shutdown_cancellation: Arc<ConnectionCancellation>,
    shutting_down: AtomicBool,
    #[cfg(test)]
    activation_test_barrier: Arc<ActivationTestBarrier>,
}

impl SshForwardManager {
    pub(crate) fn new(app_config_dir: &Path) -> Result<Self, SshForwardCommandError> {
        #[cfg(test)]
        let credential_vault: Arc<dyn CredentialVault> =
            Arc::new(super::credential_vault::fake::FakeCredentialVault::new());
        #[cfg(not(test))]
        let credential_vault: Arc<dyn CredentialVault> = Arc::new(WindowsCredentialVault::new());
        Self::new_with_dependencies(app_config_dir, credential_vault, arc_clock())
    }

    fn new_with_dependencies(
        app_config_dir: &Path,
        credential_vault: Arc<dyn CredentialVault>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, SshForwardCommandError> {
        let runtime_lease = SshForwardStore::acquire_feature_runtime_lease_at(app_config_dir)
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let store = Arc::new(
            SshForwardStore::open(app_config_dir)
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
        );
        let identity = store
            .load_or_create_desktop_instance()
            .map_err(|_| SshForwardErrorCode::IdentityCorrupt.command_error())?;
        let executable_path = std::env::current_exe()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .to_string_lossy()
            .into_owned();
        let issuer =
            ClientEpochIssuer::new(identity.clone()).map_err(|code| code.command_error())?;
        // Expiry is logical and must be enforced before any reconnect. Physical
        // cleanup is opportunistic; a vault cleanup failure must not make live
        // startup unsafe or expose native error details.
        let _ = credential_vault.sweep_expired(clock.now());
        Ok(Self {
            store,
            _runtime_lease: runtime_lease,
            app_config_dir: app_config_dir.to_path_buf(),
            executable_path,
            identity,
            issuer: Mutex::new(issuer),
            intent: Mutex::new(ActivationIntent {
                latest_client_epoch: WireCounter::ZERO,
                latest_activation_token: WireCounter::ZERO,
                desired_scope_id: None,
            }),
            intent_admission_gate: Mutex::new(()),
            command_gate: Mutex::new(()),
            rule_reconciliation_gate: Mutex::new(()),
            connection_admission_gate: Mutex::new(()),
            active_scope: Mutex::new(None),
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            connection_registry: Arc::new(Mutex::new(ConnectionRegistry::new())),
            loaded_keys: std::sync::Mutex::new(HashMap::new()),
            loaded_passwords: std::sync::Mutex::new(HashMap::new()),
            rejected_credentials: std::sync::Mutex::new(HashSet::new()),
            credential_vault,
            clock,
            challenges: Mutex::new(HostKeyChallengeBook::default()),
            app: Mutex::new(None),
            event_times: Mutex::new(HashMap::new()),
            abort_handles: std::sync::Mutex::new(HashMap::new()),
            v2_abort_handles: std::sync::Mutex::new(HashMap::new()),
            handshake_gate: Arc::new(Semaphore::new(HANDSHAKE_CONCURRENCY_LIMIT)),
            shutdown_cancellation: ConnectionCancellation::new(),
            shutting_down: AtomicBool::new(false),
            #[cfg(test)]
            activation_test_barrier: Arc::new(ActivationTestBarrier::new()),
        })
    }

    fn resolve_credentials(
        &self,
        scope_id: &str,
        profile_id: &str,
        endpoint_host: &str,
        endpoint_port: u16,
        ssh_user: &str,
        auth: &SshForwardAuth,
        staged_key: Option<&Arc<LoadedKeyAttempt>>,
        staged_password: Option<&Arc<LoadedPassword>>,
    ) -> Result<ResolvedCredentials, SshForwardErrorCode> {
        if staged_password.is_some() && matches!(auth, SshForwardAuth::Key { .. }) {
            return Err(SshForwardErrorCode::InvalidArgument);
        }
        if let Some(staged) = staged_password {
            let target = target_for(&staged.identity)
                .map_err(|_| SshForwardErrorCode::CredentialVaultCorrupt)?;
            let lease = CredentialLease::new_password(
                staged.identity.clone(),
                staged.credential_attempt_id.clone(),
                staged.username.to_string(),
                staged.password.to_string(),
            );
            return Ok(ResolvedCredentials {
                key: None,
                key_encrypted: false,
                lease: Some(Arc::new(lease)),
                target: Some(target),
                saved_reuse: false,
                remember_for_days: staged.remember_for_days,
            });
        }
        if let Some(staged) = staged_key {
            let target = target_for(&staged.identity)
                .map_err(|_| SshForwardErrorCode::CredentialVaultCorrupt)?;
            let lease = CredentialLease::new_key_passphrase(
                staged.identity.clone(),
                staged.credential_attempt_id.clone(),
                staged.passphrase.to_string(),
            );
            return Ok(ResolvedCredentials {
                key: Some(Arc::clone(&staged.key)),
                key_encrypted: staged.encrypted,
                lease: Some(Arc::new(lease)),
                target: Some(target),
                saved_reuse: false,
                remember_for_days: staged.remember_for_days,
            });
        }

        if matches!(auth, SshForwardAuth::Agent) {
            // Passwords are an explicit fallback credential for agent-mode
            // profiles. Never allow a saved password to silently change a
            // profile configured for a specific local key.
            let password_identity = CredentialIdentity {
                scope_id: scope_id.into(),
                profile_id: profile_id.into(),
                endpoint_host: endpoint_host.into(),
                endpoint_port,
                ssh_user: ssh_user.into(),
                auth: VaultAuthIdentity::Password,
            };
            let password_target = target_for(&password_identity)
                .map_err(|_| SshForwardErrorCode::CredentialVaultCorrupt)?;
            let password_rejected = self
                .rejected_credentials
                .lock()
                .expect("rejected credential mutex poisoned")
                .contains(password_target.identity_digest());
            let password_read = if password_rejected {
                None
            } else {
                self.credential_vault
                    .load(&password_target, self.clock.now())
                    .ok()
            };
            if password_read
                .as_ref()
                .is_some_and(|read| read.status == CredentialStatus::Saved)
            {
                let record = password_read
                    .and_then(|read| read.credential)
                    .ok_or(SshForwardErrorCode::CredentialVaultCorrupt)?;
                let lease = CredentialLease::from_record(
                    password_identity,
                    "vault",
                    record,
                    Some(ssh_user.into()),
                )
                .ok_or(SshForwardErrorCode::CredentialVaultCorrupt)?;
                return Ok(ResolvedCredentials {
                    key: None,
                    key_encrypted: false,
                    lease: Some(Arc::new(lease)),
                    target: Some(password_target),
                    saved_reuse: true,
                    remember_for_days: 0,
                });
            }
        }

        if let SshForwardAuth::Key { key_id } = auth {
            let identity = CredentialIdentity {
                scope_id: scope_id.into(),
                profile_id: profile_id.into(),
                endpoint_host: endpoint_host.into(),
                endpoint_port,
                ssh_user: ssh_user.into(),
                auth: VaultAuthIdentity::KeyPassphrase(key_id.clone()),
            };
            let target =
                target_for(&identity).map_err(|_| SshForwardErrorCode::CredentialVaultCorrupt)?;
            let rejected = self
                .rejected_credentials
                .lock()
                .expect("rejected credential mutex poisoned")
                .contains(target.identity_digest());
            let read = if rejected {
                None
            } else {
                self.credential_vault.load(&target, self.clock.now()).ok()
            };
            if read
                .as_ref()
                .is_some_and(|read| read.status == CredentialStatus::Saved)
            {
                let record = read
                    .and_then(|read| read.credential)
                    .ok_or(SshForwardErrorCode::CredentialVaultCorrupt)?;
                let lease = Arc::new(
                    CredentialLease::from_record(identity, "vault", record, None)
                        .ok_or(SshForwardErrorCode::CredentialVaultCorrupt)?,
                );
                let loaded = match credentials::load_safe_key(key_id, lease.passphrase()) {
                    Ok(loaded) => loaded,
                    Err(error) => {
                        let resolved = ResolvedCredentials {
                            key: None,
                            key_encrypted: false,
                            lease: Some(Arc::clone(&lease)),
                            target: Some(target.clone()),
                            saved_reuse: true,
                            remember_for_days: 0,
                        };
                        let code = SshForwardErrorCode::from_credential(error);
                        return Err(self
                            .mark_saved_credential_rejected(&resolved)
                            .err()
                            .unwrap_or(code));
                    }
                };
                return Ok(ResolvedCredentials {
                    key: Some(Arc::new(loaded.key)),
                    key_encrypted: loaded.encrypted,
                    lease: Some(lease),
                    target: Some(target),
                    saved_reuse: true,
                    remember_for_days: 0,
                });
            }
            return Ok(ResolvedCredentials {
                key: None,
                key_encrypted: false,
                lease: None,
                target: None,
                saved_reuse: false,
                remember_for_days: 0,
            });
        }
        Ok(ResolvedCredentials {
            key: None,
            key_encrypted: false,
            lease: None,
            target: None,
            saved_reuse: false,
            remember_for_days: 0,
        })
    }

    fn resolve_live_credentials(
        &self,
        scope_id: &str,
        profile_id: &str,
        endpoint_host: &str,
        endpoint_port: u16,
        ssh_user: &str,
        auth: &SshForwardAuth,
        loaded_key: Option<&Arc<LoadedKeyAttempt>>,
        lease: Arc<CredentialLease>,
    ) -> Result<ResolvedCredentials, SshForwardErrorCode> {
        let identity = lease.identity();
        if identity.scope_id != scope_id
            || identity.profile_id != profile_id
            || identity.endpoint_host != endpoint_host
            || identity.endpoint_port != endpoint_port
            || identity.ssh_user != ssh_user
        {
            return Err(SshForwardErrorCode::CredentialRejected);
        }
        let target =
            target_for(identity).map_err(|_| SshForwardErrorCode::CredentialVaultCorrupt)?;
        let rejected = target_for(identity).ok().is_some_and(|entry| {
            self.rejected_credentials
                .lock()
                .expect("rejected credential mutex poisoned")
                .contains(entry.identity_digest())
        });
        if rejected {
            return Err(SshForwardErrorCode::CredentialRejected);
        }
        let key_id = match (auth, &identity.auth) {
            (SshForwardAuth::Agent, VaultAuthIdentity::Password) => None,
            (SshForwardAuth::Agent, VaultAuthIdentity::KeyPassphrase(key_id)) => {
                Some(key_id.as_str())
            }
            (SshForwardAuth::Key { key_id }, VaultAuthIdentity::KeyPassphrase(saved_key_id))
                if key_id == saved_key_id =>
            {
                Some(key_id.as_str())
            }
            _ => return Err(SshForwardErrorCode::CredentialRejected),
        };
        let (key, key_encrypted) = if let Some(key_id) = key_id {
            let loaded = loaded_key
                .filter(|loaded| loaded.identity == *identity)
                .map(|loaded| (Arc::clone(&loaded.key), loaded.encrypted));
            match loaded {
                Some((key, encrypted)) => (Some(key), encrypted),
                None => match credentials::load_safe_key(key_id, lease.passphrase()) {
                    Ok(loaded) => (Some(Arc::new(loaded.key)), loaded.encrypted),
                    Err(error) => {
                        let failed = ResolvedCredentials {
                            key: None,
                            key_encrypted: false,
                            lease: Some(Arc::clone(&lease)),
                            target: Some(target.clone()),
                            saved_reuse: lease.saved_reuse(),
                            remember_for_days: 0,
                        };
                        let code = SshForwardErrorCode::from_credential(error);
                        return Err(self
                            .mark_saved_credential_rejected(&failed)
                            .err()
                            .unwrap_or(code));
                    }
                },
            }
        } else {
            (None, false)
        };
        Ok(ResolvedCredentials {
            key,
            key_encrypted,
            lease: Some(lease.clone()),
            target: Some(target),
            saved_reuse: lease.saved_reuse(),
            remember_for_days: 0,
        })
    }

    fn save_credential_if_requested(
        &self,
        resolved: &mut ResolvedCredentials,
        auth: &SshForwardAuth,
    ) -> Result<(), VaultError> {
        if resolved.saved_reuse || resolved.remember_for_days != REMEMBER_FOR_DAYS {
            return Ok(());
        }
        let Some(target) = resolved.target.as_ref() else {
            return Ok(());
        };
        let Some(lease) = resolved.lease.as_ref() else {
            return Ok(());
        };
        let (kind, secret) = if let Some((_, password)) = lease.password() {
            if !matches!(auth, SshForwardAuth::Agent) {
                return Ok(());
            }
            (CredentialKind::Password, password)
        } else if let Some(passphrase) = lease.passphrase() {
            if !matches!(auth, SshForwardAuth::Key { .. }) {
                // Agent authentication may fall back to a staged local key,
                // but an agent success must never cause that passphrase to be
                // persisted accidentally.
                return Ok(());
            }
            if !resolved.key_encrypted {
                return Ok(());
            }
            (CredentialKind::KeyPassphrase, passphrase)
        } else {
            return Ok(());
        };
        let record =
            CredentialRecord::new(kind, secret, target.identity_digest(), self.clock.now())?;
        self.credential_vault.save(target, &record)?;
        self.rejected_credentials
            .lock()
            .expect("rejected credential mutex poisoned")
            .remove(target.identity_digest());
        resolved.lease = Some(Arc::new(lease.with_expiry(record.expires_at)));
        Ok(())
    }

    fn ensure_credential_fresh(
        &self,
        resolved: &ResolvedCredentials,
    ) -> Result<(), SshTransportError> {
        if resolved.is_expired(self.clock.now()) {
            Err(SshTransportError::Credential(
                SshForwardErrorCode::CredentialExpired,
            ))
        } else {
            Ok(())
        }
    }

    fn mark_saved_credential_rejected(
        &self,
        resolved: &ResolvedCredentials,
    ) -> Result<(), SshForwardErrorCode> {
        if !resolved.saved_reuse {
            return Ok(());
        }
        let Some(target) = resolved.target.as_ref() else {
            return Ok(());
        };
        self.rejected_credentials
            .lock()
            .expect("rejected credential mutex poisoned")
            .insert(target.identity_digest().to_owned());
        match self
            .credential_vault
            .mark_rejected(target, self.clock.now())
        {
            Ok(()) => Ok(()),
            Err(_mark_error) => match self.credential_vault.forget(target) {
                Ok(()) => {
                    self.rejected_credentials
                        .lock()
                        .expect("rejected credential mutex poisoned")
                        .remove(target.identity_digest());
                    Ok(())
                }
                Err(_) => {
                    // Keep the in-memory quarantine and fail closed. The
                    // persistence failure itself is retryable infrastructure
                    // state, but reusing this live lease is never safe.
                    Err(SshForwardErrorCode::CredentialRejected)
                }
            },
        }
    }

    fn forget_saved_connection_credentials(
        &self,
        connection: &SshConnectionProfile,
    ) -> Result<(), SshForwardErrorCode> {
        let target = connection_credential_target(connection)?;
        self.credential_vault
            .forget(&target)
            .map_err(vault_error_code)?;
        self.rejected_credentials
            .lock()
            .expect("rejected credential mutex poisoned")
            .remove(target.identity_digest());
        Ok(())
    }

    fn forget_changed_connection_credentials(
        &self,
        previous: &SshConnectionProfile,
        next: &SshConnectionProfile,
    ) -> Result<(), SshForwardErrorCode> {
        let previous_identity = canonical_connection_identity(previous)
            .map_err(|_| SshForwardErrorCode::InvalidArgument)?;
        let next_identity = canonical_connection_identity(next)
            .map_err(|_| SshForwardErrorCode::InvalidArgument)?;
        if previous_identity == next_identity {
            return Ok(());
        }
        self.forget_saved_connection_credentials(previous)
    }

    pub(crate) async fn attach_app(&self, app: AppHandle) {
        *self.app.lock().await = Some(app);
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::Acquire)
    }

    fn register_v2_abort_handle(&self, task_key: String, handle: AbortHandle) {
        self.v2_abort_handles
            .lock()
            .expect("v2 abort handle mutex poisoned")
            .insert(task_key, handle);
    }

    fn remove_v2_abort_handle(&self, task_key: &str) {
        self.v2_abort_handles
            .lock()
            .expect("v2 abort handle mutex poisoned")
            .remove(task_key);
    }

    fn abort_v2_tasks(&self) {
        let handles = self
            .v2_abort_handles
            .lock()
            .expect("v2 abort handle mutex poisoned")
            .drain()
            .map(|(_, handle)| handle)
            .collect::<Vec<_>>();
        for handle in handles {
            handle.abort();
        }
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
        // A new desktop client epoch invalidates the previous live lease. The
        // vault entry remains durable and will be revalidated on the next
        // explicit connect.
        self.stop_all_workers().await;
        self.stop_all_connections().await?;
        self.clear_live_secrets();
        let _ = self.credential_vault.sweep_expired(self.clock.now());
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
                let config = store
                    .load_scope_config()
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
                    connections_revision: config.connections_revision,
                    rules_revision: config.rules_revision,
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
            self.stop_all_connections().await?;
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
                let _ = self.stop_all_connections().await;
                return Err(error);
            }
        }
        let snapshot = match scope_id.as_ref() {
            Some(id) => match self.snapshot_inner(context, token, id).await {
                Ok(snapshot) => Some(snapshot),
                Err(error) => {
                    self.stop_all_workers().await;
                    let _ = self.stop_all_connections().await;
                    return Err(error);
                }
            },
            None => None,
        };
        if let Err(error) = self.check_intent(key).await {
            self.stop_all_workers().await;
            let _ = self.stop_all_connections().await;
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
            let _ = self.stop_all_connections().await;
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
        let v2 = active
            .store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let connections = v2
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let rules = v2
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let (connection_runtimes, rule_runtimes) = {
            let registry = self.connection_registry.lock().await;
            (
                registry.connection_snapshots_for_scope(scope_id),
                registry.rule_snapshots_for_scope(scope_id),
            )
        };
        let credential_states = connections
            .iter()
            .map(|connection| self.credential_state(scope_id, connection))
            .collect::<Vec<_>>();
        let trust = active
            .store
            .load_trust()
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
            connections_revision: v2.connections_revision,
            rules_revision: v2.rules_revision,
            trust_revision: trust.revision(),
            connections,
            rules,
            connection_runtimes,
            rule_runtimes,
            credential_states,
            profiles: profiles
                .profiles()
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?,
            runtimes: runtime_values,
            host_key_challenges: challenges.snapshot(UtcTimestamp::now(), scope_id),
            trust_repair: Some(self.trust_repair_metadata(scope_id)?),
        };
        drop(challenges);
        snapshot
            .profiles
            .sort_by(|left, right| left.id.cmp(&right.id));
        self.ensure_context(context, token).await?;
        Ok(snapshot)
    }

    fn credential_state(
        &self,
        scope_id: &str,
        connection: &SshConnectionProfile,
    ) -> SshForwardCredentialState {
        let identity = CredentialIdentity {
            scope_id: scope_id.to_owned(),
            profile_id: connection.id.clone(),
            endpoint_host: connection.ssh_host.clone(),
            endpoint_port: connection.ssh_port,
            ssh_user: connection.ssh_user.clone(),
            auth: match &connection.auth {
                SshForwardAuth::Agent => VaultAuthIdentity::Password,
                SshForwardAuth::Key { key_id } => VaultAuthIdentity::KeyPassphrase(key_id.clone()),
            },
        };
        let (credential_status, expires_at) = match target_for(&identity) {
            Ok(target) => match self.credential_vault.load(&target, self.clock.now()) {
                Ok(read) => (read.status, read.expires_at),
                Err(_) => (CredentialStatus::Unavailable, None),
            },
            Err(_) => (CredentialStatus::Unavailable, None),
        };
        SshForwardCredentialState {
            connection_profile_id: connection.id.clone(),
            status: match credential_status {
                CredentialStatus::None => SshForwardCredentialStatus::None,
                CredentialStatus::Saved => SshForwardCredentialStatus::Saved,
                CredentialStatus::Rejected => SshForwardCredentialStatus::Rejected,
                CredentialStatus::Expired => SshForwardCredentialStatus::Expired,
                CredentialStatus::Unavailable => SshForwardCredentialStatus::Unavailable,
            },
            expires_at,
        }
    }

    fn trust_repair_metadata(
        &self,
        scope_id: &str,
    ) -> Result<SshForwardTrustRepairMetadata, SshForwardCommandError> {
        let trust_path = super::trust_repair::resolved_trust_path(&self.app_config_dir, scope_id)
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        Ok(SshForwardTrustRepairMetadata {
            trust_path: trust_path.to_string_lossy().into_owned(),
            executable_path: self.executable_path.clone(),
        })
    }

    pub(crate) async fn create_connection(
        &self,
        input: &super::model::CreateConnectionInput,
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_connections_revision(
            current.connections_revision,
            input.request.expected_connections_revision,
        )?;
        if input.connection.scope_id != input.request.scope_id
            || input.connection.validate().is_err()
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let mut connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        if connections.len() >= MAX_SAVED_CONNECTIONS {
            return Err(SshForwardErrorCode::ProfileLimit.command_error());
        }
        let identity = canonical_connection_identity(&input.connection)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        if connections.iter().any(|connection| {
            connection.id == input.connection.id
                || canonical_connection_identity(connection)
                    .is_ok_and(|candidate| candidate == identity)
        }) {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        connections.push(input.connection.clone());
        let rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        // Commit the profile first so a store failure cannot erase the old
        // vault entry. Cleanup is compensated by restoring the old profile if
        // the vault deletion itself fails.
        let committed = store
            .replace_connections(input.request.expected_connections_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::ConnectionsRevisionConflict,
                    true,
                )
            })?;
        self.update_connections_revision(committed.connections_revision)
            .await;
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::ConnectionsChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn update_connection(
        &self,
        input: &super::model::UpdateConnectionInput,
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_connections_revision(
            current.connections_revision,
            input.request.expected_connections_revision,
        )?;
        self.check_connection_generation(
            &input.request.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        if self
            .connection_is_active(&input.request.scope_id, &input.connection_profile_id)
            .await
            || input.connection.id != input.connection_profile_id
            || input.connection.scope_id != input.request.scope_id
            || input.connection.validate().is_err()
        {
            return Err(
                if self
                    .connection_is_active(&input.request.scope_id, &input.connection_profile_id)
                    .await
                {
                    SshForwardErrorCode::ProfileActive.command_error()
                } else {
                    SshForwardErrorCode::InvalidArgument.command_error()
                },
            );
        }
        let mut connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let position = connections
            .iter()
            .position(|connection| connection.id == input.connection_profile_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        let previous_connection = connections[position].clone();
        let identity = canonical_connection_identity(&input.connection)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        if connections.iter().enumerate().any(|(index, connection)| {
            index != position
                && canonical_connection_identity(connection)
                    .is_ok_and(|candidate| candidate == identity)
        }) {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        connections[position] = input.connection.clone();
        let rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed = store
            .replace_connections(input.request.expected_connections_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::ConnectionsRevisionConflict,
                    true,
                )
            })?;
        if let Err(code) =
            self.forget_changed_connection_credentials(&previous_connection, &input.connection)
        {
            let rollback = store.replace_connections(committed.connections_revision, current);
            let rolled_back = match rollback {
                Ok(config) => config,
                Err(_) => return Err(SshForwardErrorCode::CredentialCleanupPending.command_error()),
            };
            self.update_connections_revision(rolled_back.connections_revision)
                .await;
            self.emit_collection_hint_checked(
                &input.request.scope_id,
                input.request.scope_generation,
                input.request.activation_token,
                SshForwardEventReason::ConnectionsChanged,
            )
            .await;
            return Err(code.command_error());
        }
        self.update_connections_revision(committed.connections_revision)
            .await;
        self.clear_live_secrets_for_profile(&input.request.scope_id, &input.connection_profile_id);
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::ConnectionsChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn delete_connection(
        &self,
        input: &super::model::DeleteConnectionInput,
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_connections_revision(
            current.connections_revision,
            input.request.expected_connections_revision,
        )?;
        self.check_connection_generation(
            &input.request.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        if self
            .connection_is_active(&input.request.scope_id, &input.connection_profile_id)
            .await
        {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        let mut connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let deleted_connection = connections
            .iter()
            .find(|connection| connection.id == input.connection_profile_id)
            .cloned()
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        let rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        if rules
            .iter()
            .any(|rule| rule.connection_profile_id == input.connection_profile_id)
        {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        connections.retain(|connection| connection.id != input.connection_profile_id);
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        if input.expected_generation != WireCounter::ZERO {
            self.connection_registry
                .lock()
                .await
                .ensure_disconnected(&input.connection_profile_id, input.expected_generation)
                .map_err(|error| error.code().command_error())?;
        }
        #[cfg(test)]
        self.activation_test_barrier
            .pause_if_enabled(ActivationBarrierPoint::BeforeV2CollectionCommit)
            .await;
        // Commit the deletion first so a store failure cannot erase the
        // saved credential. Roll back the profile before reporting a vault
        // cleanup failure, keeping the runtime generation removable later.
        let committed = store
            .replace_connections(input.request.expected_connections_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::ConnectionsRevisionConflict,
                    true,
                )
            })?;
        if let Err(code) = self.forget_saved_connection_credentials(&deleted_connection) {
            let rollback =
                store.replace_connections(committed.connections_revision, current.clone());
            let rolled_back = match rollback {
                Ok(config) => config,
                Err(_) => return Err(SshForwardErrorCode::CredentialCleanupPending.command_error()),
            };
            self.update_connections_revision(rolled_back.connections_revision)
                .await;
            self.emit_collection_hint_checked(
                &input.request.scope_id,
                input.request.scope_generation,
                input.request.activation_token,
                SshForwardEventReason::ConnectionsChanged,
            )
            .await;
            return Err(code.command_error());
        }
        if input.expected_generation != WireCounter::ZERO {
            let removal = self
                .connection_registry
                .lock()
                .await
                .remove_if_disconnected(&input.connection_profile_id, input.expected_generation);
            if let Err(error) = removal {
                let rollback = store.replace_connections(committed.connections_revision, current);
                let rolled_back = match rollback {
                    Ok(config) => config,
                    Err(_) => {
                        return Err(SshForwardErrorCode::CredentialCleanupPending.command_error())
                    }
                };
                self.update_connections_revision(rolled_back.connections_revision)
                    .await;
                self.emit_collection_hint_checked(
                    &input.request.scope_id,
                    input.request.scope_generation,
                    input.request.activation_token,
                    SshForwardEventReason::ConnectionsChanged,
                )
                .await;
                return Err(error.code().command_error());
            }
        }
        self.update_connections_revision(committed.connections_revision)
            .await;
        self.clear_live_secrets_for_profile(&input.request.scope_id, &input.connection_profile_id);
        self.challenges
            .lock()
            .await
            .clear_profile(&input.request.scope_id, &input.connection_profile_id);
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::ConnectionsChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn create_rule(
        self: &Arc<Self>,
        input: &super::model::CreateRuleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _rule_reconciliation = self.rule_reconciliation_gate.lock().await;
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_rules_revision(
            current.rules_revision,
            input.request.expected_rules_revision,
        )?;
        self.check_connection_generation(
            &input.request.scope_id,
            &input.request.connection_profile_id,
            input.request.expected_connection_generation,
        )
        .await?;
        if input.rule.scope_id != input.request.scope_id
            || input.rule.connection_profile_id != input.request.connection_profile_id
            || input.rule.validate().is_err()
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        if !connections
            .iter()
            .any(|connection| connection.id == input.request.connection_profile_id)
        {
            return Err(SshForwardErrorCode::ProfileNotFound.command_error());
        }
        let mut rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        if rules.len() >= 64 || rules.iter().any(|rule| rule.id == input.rule.id) {
            return Err(if rules.len() >= 64 {
                SshForwardErrorCode::RuleLimit.command_error()
            } else {
                SshForwardErrorCode::InvalidArgument.command_error()
            });
        }
        rules.push(input.rule.clone());
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed = store
            .replace_rules_with_activity_lease(input.request.expected_rules_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::RulesRevisionConflict,
                    false,
                )
            })?;
        self.update_rules_revision_for_scope(
            &input.request.scope_id,
            input.request.scope_generation,
            committed.rules_revision,
        )
        .await;
        let should_reconcile = self
            .connection_registry
            .lock()
            .await
            .ensure_established(
                &input.request.connection_profile_id,
                input.request.expected_connection_generation,
            )
            .is_ok();
        drop(_command);
        drop(_rule_reconciliation);
        if should_reconcile {
            self.enable_desired_rules(
                &input.request.context,
                input.request.activation_token,
                &input.request.scope_id,
                input.request.scope_generation,
                &input.request.connection_profile_id,
                input.request.expected_connection_generation,
            )
            .await;
        }
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::RulesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn update_rule(
        self: &Arc<Self>,
        input: &super::model::UpdateRuleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _rule_reconciliation = self.rule_reconciliation_gate.lock().await;
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_rules_revision(
            current.rules_revision,
            input.request.expected_rules_revision,
        )?;
        self.check_connection_generation(
            &input.request.scope_id,
            &input.request.connection_profile_id,
            input.request.expected_connection_generation,
        )
        .await?;
        self.check_rule_generation(
            &input.request.scope_id,
            &input.rule_id,
            input.expected_rule_generation,
        )
        .await?;
        if self
            .rule_is_active(&input.request.scope_id, &input.rule_id)
            .await
        {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        if input.rule.id != input.rule_id
            || input.rule.scope_id != input.request.scope_id
            || input.rule.connection_profile_id != input.request.connection_profile_id
            || input.rule.validate().is_err()
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        if !connections
            .iter()
            .any(|connection| connection.id == input.request.connection_profile_id)
        {
            return Err(SshForwardErrorCode::ProfileNotFound.command_error());
        }
        let mut rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let position = rules
            .iter()
            .position(|rule| rule.id == input.rule_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        if rules[position].connection_profile_id != input.request.connection_profile_id {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        rules[position] = input.rule.clone();
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed = store
            .replace_rules_with_activity_lease(input.request.expected_rules_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::RulesRevisionConflict,
                    false,
                )
            })?;
        self.update_rules_revision(committed.rules_revision).await;
        let should_reconcile = self
            .connection_registry
            .lock()
            .await
            .ensure_established(
                &input.request.connection_profile_id,
                input.request.expected_connection_generation,
            )
            .is_ok();
        drop(_command);
        drop(_rule_reconciliation);
        if should_reconcile {
            self.enable_desired_rules(
                &input.request.context,
                input.request.activation_token,
                &input.request.scope_id,
                input.request.scope_generation,
                &input.request.connection_profile_id,
                input.request.expected_connection_generation,
            )
            .await;
        }
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::RulesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    pub(crate) async fn delete_rule(
        &self,
        input: &super::model::DeleteRuleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _rule_reconciliation = self.rule_reconciliation_gate.lock().await;
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
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        self.check_rules_revision(
            current.rules_revision,
            input.request.expected_rules_revision,
        )?;
        self.check_connection_generation(
            &input.request.scope_id,
            &input.request.connection_profile_id,
            input.request.expected_connection_generation,
        )
        .await?;
        self.check_rule_generation(
            &input.request.scope_id,
            &input.rule_id,
            input.expected_rule_generation,
        )
        .await?;
        if self
            .rule_is_active(&input.request.scope_id, &input.rule_id)
            .await
        {
            return Err(SshForwardErrorCode::ProfileActive.command_error());
        }
        let connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let mut rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let position = rules
            .iter()
            .position(|rule| {
                rule.id == input.rule_id
                    && rule.connection_profile_id == input.request.connection_profile_id
            })
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        rules.remove(position);
        let next = StoredScopeConfigV2::from_models(&input.request.scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        if input.expected_rule_generation != WireCounter::ZERO {
            self.connection_registry
                .lock()
                .await
                .ensure_rule_removable(
                    &input.request.connection_profile_id,
                    input.request.expected_connection_generation,
                    &input.rule_id,
                    input.expected_rule_generation,
                )
                .map_err(|error| error.code().command_error())?;
        }
        #[cfg(test)]
        self.activation_test_barrier
            .pause_if_enabled(ActivationBarrierPoint::BeforeV2CollectionCommit)
            .await;
        let committed = store
            .replace_rules_with_activity_lease(input.request.expected_rules_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::RulesRevisionConflict,
                    false,
                )
            })?;
        if input.expected_rule_generation != WireCounter::ZERO {
            let removal = self.connection_registry.lock().await.remove_rule(
                &input.request.connection_profile_id,
                input.request.expected_connection_generation,
                &input.rule_id,
                input.expected_rule_generation,
            );
            if let Err(error) = removal {
                let rollback =
                    store.replace_rules_with_activity_lease(committed.rules_revision, current);
                let rolled_back = match rollback {
                    Ok(config) => config,
                    Err(_) => return Err(SshForwardErrorCode::StoreIo.command_error()),
                };
                self.update_rules_revision(rolled_back.rules_revision).await;
                self.emit_collection_hint_checked(
                    &input.request.scope_id,
                    input.request.scope_generation,
                    input.request.activation_token,
                    SshForwardEventReason::RulesChanged,
                )
                .await;
                return Err(error.code().command_error());
            }
        }
        self.update_rules_revision(committed.rules_revision).await;
        self.emit_collection_hint_checked(
            &input.request.scope_id,
            input.request.scope_generation,
            input.request.activation_token,
            SshForwardEventReason::RulesChanged,
        )
        .await;
        self.snapshot_inner(
            &input.request.context,
            input.request.activation_token,
            &input.request.scope_id,
        )
        .await
    }

    async fn start_inner(
        self: &Arc<Self>,
        input: &super::model::ProfileLifecycleInput,
        allow_loaded_password: bool,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let loaded_password = allow_loaded_password
            .then(|| {
                self.take_loaded_password(
                    &input.scope_id,
                    &input.profile_id,
                    input.credential_attempt_id.as_deref(),
                )
            })
            .flatten();
        let loaded_key = self
            .loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .get(&(input.scope_id.clone(), input.profile_id.clone()))
            .cloned();
        let _loaded_key_cleanup = LoadedPasswordCleanup {
            manager: Arc::clone(self),
            scope_id: input.scope_id.clone(),
            profile_id: input.profile_id.clone(),
            key: loaded_key.clone(),
            credential: None,
        };
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
                let loaded_password_for_worker = loaded_password.clone();
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
                            loaded_key,
                            loaded_password_for_worker,
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

    /// Internal connection worker used by the v2 connect command.
    async fn connect_connection(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        self.ensure_running()?;
        let loaded_key = self
            .loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .get(&(scope_id.to_owned(), connection_id.to_owned()))
            .cloned();
        let loaded_password = self
            .loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .get(&(scope_id.to_owned(), connection_id.to_owned()))
            .cloned();
        let _credential_cleanup = LoadedPasswordCleanup {
            manager: Arc::clone(self),
            scope_id: scope_id.to_owned(),
            profile_id: connection_id.to_owned(),
            key: loaded_key.clone(),
            credential: loaded_password.clone(),
        };
        let (_config, profile, trust, admission) = {
            let _command = self.command_gate.lock().await;
            let _intent_admission = self.intent_admission_gate.lock().await;
            self.ensure_running()?;
            let store = self
                .checked_scope(context, token, scope_id, scope_generation)
                .await?;
            let config = store
                .load_scope_config()
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
            let profile = config
                .connections()
                .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
                .into_iter()
                .find(|profile| profile.id == connection_id)
                .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
            let trust = store
                .load_trust()
                .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
            let _admission_gate = self.connection_admission_gate.lock().await;
            self.ensure_running()?;
            let admission = self
                .connection_registry
                .lock()
                .await
                .reserve_connection(profile.clone(), expected_generation)
                .map_err(runtime_command_error)?;
            (config, profile, trust, admission)
        };
        let (generation, cancellation) = match admission {
            ConnectionAdmission::AlreadyCurrent(generation) => {
                self.ensure_running()?;
                self.enable_desired_rules(
                    context,
                    token,
                    scope_id,
                    scope_generation,
                    connection_id,
                    generation,
                )
                .await;
                return self
                    .finalize_established_connection(
                        context,
                        token,
                        scope_id,
                        scope_generation,
                        connection_id,
                        generation,
                    )
                    .await;
            }
            ConnectionAdmission::Reserved(reservation) => {
                (reservation.generation, reservation.cancellation)
            }
        };
        let mut reservation_cleanup = ConnectionReservationGuard::new(
            Arc::clone(&self.connection_registry),
            connection_id,
            generation,
            Arc::clone(&cancellation),
        );
        if self.is_shutting_down() {
            cancellation.cancel();
            let _ = self
                .connection_registry
                .lock()
                .await
                .discard_connection(connection_id, generation);
            reservation_cleanup.disarm();
            return Err(SshForwardErrorCode::ShutdownInProgress.command_error());
        }
        let lifecycle = self
            .connection_registry
            .lock()
            .await
            .lifecycle(connection_id)
            .map_err(runtime_command_error)?;
        let _lifecycle = lifecycle.lock().await;
        let endpoint = match SshEndpoint::new(&profile.ssh_host, profile.ssh_port) {
            Ok(endpoint) => endpoint,
            Err(code) => {
                let _ = self.connection_registry.lock().await.fail_connection(
                    connection_id,
                    generation,
                    code,
                );
                reservation_cleanup.disarm();
                return Err(code.command_error());
            }
        };
        let permit = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                let _ = self.connection_registry.lock().await.fail_connection(
                    connection_id,
                    generation,
                    SshForwardErrorCode::ActivationSuperseded,
                );
                reservation_cleanup.disarm();
                return Err(SshForwardErrorCode::ActivationSuperseded.command_error());
            }
            _ = self.shutdown_cancellation.cancelled() => {
                let _ = self.connection_registry.lock().await.discard_connection(
                    connection_id,
                    generation,
                );
                reservation_cleanup.disarm();
                return Err(SshForwardErrorCode::ShutdownInProgress.command_error());
            }
            result = self.handshake_gate.acquire() => match result {
                Ok(permit) => permit,
                Err(_) => {
                let _ = self.connection_registry.lock().await.fail_connection(
                    connection_id,
                    generation,
                    SshForwardErrorCode::SshConnectFailed,
                );
                reservation_cleanup.disarm();
                return Err(SshForwardErrorCode::SshConnectFailed.command_error());
                }
            }
        };
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                drop(permit);
                let _ = self.connection_registry.lock().await.fail_connection(
                    connection_id,
                    generation,
                    SshForwardErrorCode::ActivationSuperseded,
                );
                reservation_cleanup.disarm();
                return Err(SshForwardErrorCode::ActivationSuperseded.command_error());
            }
            _ = self.shutdown_cancellation.cancelled() => {
                drop(permit);
                let _ = self.connection_registry.lock().await.discard_connection(
                    connection_id,
                    generation,
                );
                reservation_cleanup.disarm();
                return Err(SshForwardErrorCode::ShutdownInProgress.command_error());
            }
            result = async {
                let deadline = SshTransport::handshake_deadline();
                let transport = match SshTransport::connect_until(&endpoint, &trust, deadline).await {
                    Ok(transport) => transport,
                    Err(error) => return Err((error, None)),
                };
                let resolved = match self.resolve_credentials(
                    scope_id,
                    connection_id,
                    &endpoint.host,
                    endpoint.port,
                    &profile.ssh_user,
                    &profile.auth,
                    loaded_key.as_ref(),
                    loaded_password.as_ref(),
                ) {
                    Ok(resolved) => resolved,
                    Err(code) => return Err((SshTransportError::Credential(code), None)),
                };
                if let Err(error) = self.ensure_credential_fresh(&resolved) {
                    return Err((error, Some(resolved)));
                }
                let session = match transport
                    .authenticate_until(
                        &profile.ssh_user,
                        &profile.auth,
                        resolved.key.clone(),
                        resolved.password(),
                        resolved.key_passphrase(),
                        deadline,
                    )
                    .await
                {
                    Ok(session) => session,
                    Err(error) => return Err((error, Some(resolved))),
                };
                Ok::<_, (SshTransportError, Option<ResolvedCredentials>)>((
                    session, resolved,
                ))
            } => result,
        };
        drop(permit);
        let (session, mut resolved) = match result {
            Ok((session, resolved)) => (Arc::new(session), resolved),
            Err((error, resolved)) => {
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
                        scope_id,
                        &context.desktop_instance_id,
                        &context.manager_session_id,
                        connection_id,
                        &endpoint,
                        offered,
                        trust.revision(),
                    );
                }
                let mut error_code = error.error_code();
                if matches!(&error, SshTransportError::Authentication) {
                    // A failed automatic reuse is quarantined without changing
                    // its fixed expiry. A staged attempt remains eligible for
                    // explicit replacement on the next connect.
                    if let Some(resolved) = resolved.as_ref() {
                        if let Err(code) = self.mark_saved_credential_rejected(resolved) {
                            error_code = code;
                        }
                    }
                }
                self.connection_registry
                    .lock()
                    .await
                    .fail_connection(connection_id, generation, error_code)
                    .map_err(runtime_command_error)?;
                reservation_cleanup.disarm();
                return self.snapshot_inner(context, token, scope_id).await;
            }
        };
        let credential_save_error = self
            .save_credential_if_requested(&mut resolved, &profile.auth)
            .err()
            .map(credential_save_error_code);
        let shutdown = self.is_shutting_down();
        let cancelled = cancellation.is_cancelled();
        if shutdown || cancelled {
            let close_failed = session.close().await.is_err();
            if close_failed
                && self
                    .connection_registry
                    .lock()
                    .await
                    .retain_authenticating_session(connection_id, generation, Arc::clone(&session))
                    .is_ok()
            {
                reservation_cleanup.disarm();
                drop(_lifecycle);
                return Err(SshForwardErrorCode::ShutdownTimeout.command_error());
            }
            if shutdown {
                let _ = self
                    .connection_registry
                    .lock()
                    .await
                    .discard_connection(connection_id, generation);
            } else {
                let _ = self.connection_registry.lock().await.fail_connection(
                    connection_id,
                    generation,
                    SshForwardErrorCode::ActivationSuperseded,
                );
            }
            reservation_cleanup.disarm();
            drop(_lifecycle);
            let code = if shutdown {
                SshForwardErrorCode::ShutdownInProgress
            } else {
                SshForwardErrorCode::ActivationSuperseded
            };
            return Err(code.command_error());
        }
        drop(_lifecycle);
        let _intent_admission = self.intent_admission_gate.lock().await;
        let _connection_admission = self.connection_admission_gate.lock().await;
        let lifecycle = self
            .connection_registry
            .lock()
            .await
            .lifecycle(connection_id)
            .map_err(runtime_command_error)?;
        let _lifecycle = lifecycle.lock().await;
        let commit = match self
            .checked_scope(context, token, scope_id, scope_generation)
            .await
        {
            Ok(_) => self
                .connection_registry
                .lock()
                .await
                .commit_established(
                    connection_id,
                    generation,
                    Arc::clone(&session),
                    resolved.lease.clone(),
                )
                .map_err(runtime_command_error),
            Err(error) => Err(error),
        };
        if let Err(error) = commit {
            drop(_intent_admission);
            let close_failed = session.close().await.is_err();
            if close_failed
                && self
                    .connection_registry
                    .lock()
                    .await
                    .retain_authenticating_session(connection_id, generation, Arc::clone(&session))
                    .is_ok()
            {
                reservation_cleanup.disarm();
                drop(_lifecycle);
                return Err(SshForwardErrorCode::ShutdownTimeout.command_error());
            }
            let _ = self
                .connection_registry
                .lock()
                .await
                .discard_connection(connection_id, generation);
            reservation_cleanup.disarm();
            drop(_lifecycle);
            return Err(error);
        }
        if let Some(error_code) = credential_save_error {
            let _ = self.connection_registry.lock().await.set_established_error(
                connection_id,
                generation,
                error_code,
            );
        }
        drop(_intent_admission);
        drop(_connection_admission);
        reservation_cleanup.disarm();
        drop(_lifecycle);
        self.enable_desired_rules(
            context,
            token,
            scope_id,
            scope_generation,
            connection_id,
            generation,
        )
        .await;
        self.finalize_established_connection(
            context,
            token,
            scope_id,
            scope_generation,
            connection_id,
            generation,
        )
        .await
    }

    async fn finalize_established_connection(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        generation: WireCounter,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        self.ensure_running()?;
        let _command = self.command_gate.lock().await;
        let _connection_admission = self.connection_admission_gate.lock().await;
        self.checked_scope(context, token, scope_id, scope_generation)
            .await?;
        let lifecycle = self
            .connection_registry
            .lock()
            .await
            .lifecycle(connection_id)
            .map_err(runtime_command_error)?;
        let _lifecycle = lifecycle.lock().await;
        self.connection_registry
            .lock()
            .await
            .ensure_established(connection_id, generation)
            .map_err(runtime_command_error)?;
        self.emit_connection_hint_checked(
            scope_id,
            scope_generation,
            token,
            connection_id.to_owned(),
            generation,
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
        self.snapshot_inner(context, token, scope_id).await
    }

    async fn disconnect_connection(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _command = self.command_gate.lock().await;
        let _connection_admission = self.connection_admission_gate.lock().await;
        self.checked_scope(context, token, scope_id, scope_generation)
            .await?;
        self.connection_registry
            .lock()
            .await
            .cancel_connection(connection_id, expected_generation)
            .map_err(runtime_command_error)?;
        let lifecycle = self
            .connection_registry
            .lock()
            .await
            .lifecycle(connection_id)
            .map_err(runtime_command_error)?;
        let _lifecycle = lifecycle.lock().await;
        let plan = self
            .connection_registry
            .lock()
            .await
            .begin_disconnect(connection_id, expected_generation)
            .map_err(runtime_command_error)?;
        let mut event_generation = expected_generation;
        self.forget_loaded_password(scope_id, connection_id);
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .remove(&(scope_id.to_owned(), connection_id.to_owned()));
        if let Some(plan) = plan {
            let generation = plan.generation;
            event_generation = generation;
            if let Some(session) = self.close_disconnect_plan(plan).await {
                self.connection_registry
                    .lock()
                    .await
                    .retain_disconnect_session(connection_id, generation, session)
                    .map_err(runtime_command_error)?;
                let mut error = SshForwardErrorCode::ShutdownTimeout.command_error();
                error.current_generation = Some(generation.to_string());
                return Err(error);
            }
            self.connection_registry
                .lock()
                .await
                .finish_disconnect(connection_id, generation)
                .map_err(runtime_command_error)?;
        }
        self.checked_scope(context, token, scope_id, scope_generation)
            .await?;
        self.emit_connection_hint_checked(
            scope_id,
            scope_generation,
            token,
            connection_id.to_owned(),
            event_generation,
            SshForwardEventReason::RuntimeChanged,
        )
        .await;
        self.snapshot_inner(context, token, scope_id).await
    }

    async fn set_rule_enabled(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        expected_rule_generation: WireCounter,
        enabled: bool,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let _rule_reconciliation = self.rule_reconciliation_gate.lock().await;
        let _command = self.command_gate.lock().await;
        let store = self
            .checked_scope(context, token, scope_id, scope_generation)
            .await?;
        self.check_connection_generation(scope_id, connection_id, connection_generation)
            .await?;
        let current = store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let connections = current
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let mut rules = current
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?;
        let rule = rules
            .iter_mut()
            .find(|rule| rule.id == rule_id && rule.connection_profile_id == connection_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        rule.desired_enabled = enabled;
        let next = StoredScopeConfigV2::from_models(scope_id, connections, rules)
            .map_err(|_| SshForwardErrorCode::InvalidArgument.command_error())?;
        let committed = store
            .replace_rules_with_activity_lease(current.rules_revision, next)
            .map_err(|error| {
                collection_store_error(
                    &store,
                    error,
                    SshForwardErrorCode::RulesRevisionConflict,
                    false,
                )
            })?;
        self.update_rules_revision_for_scope(scope_id, scope_generation, committed.rules_revision)
            .await;

        let connection_established = self
            .connection_registry
            .lock()
            .await
            .ensure_established(connection_id, connection_generation)
            .is_ok();
        let runtime_result = if !connection_established {
            // A disconnected connection can still save the desired intent.
            // Reconciliation will materialize an enabled rule after Connect.
            Ok(())
        } else if enabled {
            match committed.rules() {
                Ok(rules) => match rules
                    .into_iter()
                    .find(|rule| rule.id == rule_id && rule.connection_profile_id == connection_id)
                {
                    Some(rule) => {
                        self.enable_rule_impl(
                            context,
                            token,
                            scope_id,
                            scope_generation,
                            rule,
                            connection_generation,
                            expected_rule_generation,
                            true,
                        )
                        .await
                    }
                    None => Err(SshForwardErrorCode::ProfileNotFound.command_error()),
                },
                Err(_) => Err(SshForwardErrorCode::StoreCorrupt.command_error()),
            }
        } else {
            self.disable_rule(
                context,
                token,
                scope_id,
                scope_generation,
                connection_id,
                connection_generation,
                rule_id,
                expected_rule_generation,
            )
            .await
        };
        if let Err(error) = runtime_result {
            let rollback = store
                .replace_rules_with_activity_lease(committed.rules_revision, current)
                .map_err(|error| {
                    collection_store_error(
                        &store,
                        error,
                        SshForwardErrorCode::RulesRevisionConflict,
                        false,
                    )
                });
            let rolled_back = match rollback {
                Ok(config) => config,
                Err(error) => {
                    // Durable-first quarantine: the committed desired intent
                    // remains authoritative when compensation is unavailable.
                    // The failed runtime state is already recorded and the
                    // next connection reconciliation will retry that intent.
                    self.update_rules_revision_for_scope(
                        scope_id,
                        scope_generation,
                        committed.rules_revision,
                    )
                    .await;
                    self.emit_collection_hint_checked(
                        scope_id,
                        scope_generation,
                        token,
                        SshForwardEventReason::RulesChanged,
                    )
                    .await;
                    return Err(error);
                }
            };
            self.update_rules_revision_for_scope(
                scope_id,
                scope_generation,
                rolled_back.rules_revision,
            )
            .await;
            self.emit_collection_hint_checked(
                scope_id,
                scope_generation,
                token,
                SshForwardEventReason::RulesChanged,
            )
            .await;
            return Err(error);
        }
        let rule_generation = self
            .connection_registry
            .lock()
            .await
            .rule_generation(connection_id, rule_id)
            .map_err(runtime_command_error)?
            .unwrap_or(expected_rule_generation);
        self.checked_scope(context, token, scope_id, scope_generation)
            .await?;
        self.emit_rule_hint_checked(
            scope_id,
            scope_generation,
            token,
            connection_id.to_owned(),
            rule_id.to_owned(),
            connection_generation,
            rule_generation,
            SshForwardEventReason::RuntimeChanged,
            false,
        )
        .await;
        self.emit_collection_hint_checked(
            scope_id,
            scope_generation,
            token,
            SshForwardEventReason::RulesChanged,
        )
        .await;
        self.snapshot_inner(context, token, scope_id).await
    }

    pub(crate) async fn connect(
        self: &Arc<Self>,
        input: &super::model::ConnectionLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        if let Some(expected_attempt) = input.credential_attempt_id.as_deref() {
            let key_matches = self
                .loaded_keys
                .lock()
                .expect("loaded key mutex poisoned")
                .get(&(input.scope_id.clone(), input.connection_profile_id.clone()))
                .is_some_and(|loaded| loaded.credential_attempt_id == expected_attempt);
            let password_matches = self
                .loaded_passwords
                .lock()
                .expect("loaded password mutex poisoned")
                .get(&(input.scope_id.clone(), input.connection_profile_id.clone()))
                .is_some_and(|loaded| loaded.credential_attempt_id == expected_attempt);
            if !key_matches && !password_matches {
                return Err(SshForwardErrorCode::InvalidArgument.command_error());
            }
        }
        self.connect_with_timeout(input, CONNECT_COMMAND_TIMEOUT)
            .await
    }

    async fn connect_with_timeout(
        self: &Arc<Self>,
        input: &super::model::ConnectionLifecycleInput,
        command_timeout: Duration,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        let result = timeout(
            command_timeout,
            self.connect_connection(
                &input.context,
                input.activation_token,
                &input.scope_id,
                input.scope_generation,
                &input.connection_profile_id,
                input.expected_generation,
            ),
        )
        .await;
        if let Ok(result) = result {
            return result;
        }

        if let Some(generation) = self
            .cleanup_timed_out_connection(&input.connection_profile_id, input.expected_generation)
            .await
        {
            self.emit_connection_hint_checked(
                &input.scope_id,
                input.scope_generation,
                input.activation_token,
                input.connection_profile_id.clone(),
                generation,
                SshForwardEventReason::RuntimeChanged,
            )
            .await;
        }
        let mut error = SshForwardErrorCode::SshConnectTimeout.command_error();
        error.connection_profile_id = Some(input.connection_profile_id.clone());
        Err(error)
    }

    async fn cleanup_timed_out_connection(
        &self,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Option<WireCounter> {
        let Some(attempt_generation) = expected_generation.increment().ok() else {
            return None;
        };
        let Some((generation, lifecycle, cancellation)) = self
            .connection_registry
            .lock()
            .await
            .connection_handle(connection_id)
        else {
            return None;
        };
        if generation != attempt_generation {
            return None;
        }
        cancellation.cancel();
        let deadline = Instant::now() + WORKER_SHUTDOWN_GRACE;
        let _connection_admission = timeout(
            deadline.saturating_duration_since(Instant::now()),
            self.connection_admission_gate.lock(),
        )
        .await
        .ok()?;
        let _lifecycle = timeout(
            deadline.saturating_duration_since(Instant::now()),
            lifecycle.lock(),
        )
        .await
        .ok()?;
        let plan = self
            .connection_registry
            .lock()
            .await
            .begin_disconnect_if_matches(connection_id, generation, &cancellation)
            .ok()??;
        let next_generation = plan.generation;
        let failed_session = self.close_disconnect_plan_until(plan, deadline).await;
        let mut registry = self.connection_registry.lock().await;
        if let Some(session) = failed_session {
            let _ = registry.retain_disconnect_session(connection_id, next_generation, session);
        } else {
            let _ = registry.finish_disconnect(connection_id, next_generation);
            registry.clear_if_disconnected();
        }
        Some(next_generation)
    }

    pub(crate) async fn disconnect(
        &self,
        input: &super::model::ConnectionLifecycleInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        self.disconnect_connection(
            &input.context,
            input.activation_token,
            &input.scope_id,
            input.scope_generation,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await
    }

    pub(crate) async fn set_rule_enabled_v2(
        self: &Arc<Self>,
        input: &super::model::SetRuleEnabledInput,
    ) -> Result<SshForwardSnapshot, SshForwardCommandError> {
        self.set_rule_enabled(
            &input.context,
            input.activation_token,
            &input.scope_id,
            input.scope_generation,
            &input.connection_profile_id,
            input.expected_connection_generation,
            &input.rule_id,
            input.expected_rule_generation,
            input.enabled,
        )
        .await
    }

    async fn enable_rule(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        rule: SshForwardRule,
        connection_generation: WireCounter,
        expected_rule_generation: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        self.enable_rule_impl(
            context,
            token,
            scope_id,
            scope_generation,
            rule,
            connection_generation,
            expected_rule_generation,
            false,
        )
        .await
    }

    async fn enable_rule_impl(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        rule: SshForwardRule,
        connection_generation: WireCounter,
        expected_rule_generation: WireCounter,
        command_gate_held: bool,
    ) -> Result<(), SshForwardCommandError> {
        let rule_for_retry = rule.clone();
        let admission = {
            let _command = if command_gate_held {
                None
            } else {
                Some(self.command_gate.lock().await)
            };
            let _intent_admission = self.intent_admission_gate.lock().await;
            self.checked_scope(context, token, scope_id, scope_generation)
                .await?;
            let lifecycle = self
                .connection_registry
                .lock()
                .await
                .lifecycle(&rule.connection_profile_id)
                .map_err(runtime_command_error)?;
            let _lifecycle = lifecycle.lock().await;
            self.connection_registry
                .lock()
                .await
                .reserve_rule(rule, connection_generation, expected_rule_generation)
                .map_err(runtime_command_error)?
        };
        let reservation = match admission {
            RuleAdmission::AlreadyCurrent => return Ok(()),
            RuleAdmission::InProgress(state_changed) => {
                let notified = state_changed.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                let still_in_progress = self
                    .connection_registry
                    .lock()
                    .await
                    .rule_is_in_progress(
                        &rule_for_retry.connection_profile_id,
                        &rule_for_retry.id,
                        expected_rule_generation,
                    )
                    .map_err(runtime_command_error)?;
                if still_in_progress {
                    notified.await;
                }
                return Box::pin(self.enable_rule_impl(
                    context,
                    token,
                    scope_id,
                    scope_generation,
                    rule_for_retry,
                    connection_generation,
                    expected_rule_generation,
                    command_gate_held,
                ))
                .await;
            }
            RuleAdmission::ReplaceRequired(current_rule_generation) => {
                self.disable_rule(
                    context,
                    token,
                    scope_id,
                    scope_generation,
                    &rule_for_retry.connection_profile_id,
                    connection_generation,
                    &rule_for_retry.id,
                    current_rule_generation,
                )
                .await?;
                let expected_rule_generation = self
                    .connection_registry
                    .lock()
                    .await
                    .rule_generation(&rule_for_retry.connection_profile_id, &rule_for_retry.id)
                    .map_err(runtime_command_error)?
                    .unwrap_or(WireCounter::ZERO);
                return Box::pin(self.enable_rule_impl(
                    context,
                    token,
                    scope_id,
                    scope_generation,
                    rule_for_retry,
                    connection_generation,
                    expected_rule_generation,
                    command_gate_held,
                ))
                .await;
            }
            RuleAdmission::Reserved(reservation) => reservation,
        };
        let listener = match TcpListener::bind(("127.0.0.1", reservation.rule.local_port)).await {
            Ok(listener) => listener,
            Err(_) => {
                let failed = self
                    .connection_registry
                    .lock()
                    .await
                    .fail_rule(
                        &reservation.rule.connection_profile_id,
                        reservation.connection_generation,
                        &reservation.rule.id,
                        reservation.generation,
                        SshForwardErrorCode::PortConflict,
                    )
                    .is_ok();
                if failed {
                    self.emit_rule_hint_checked(
                        scope_id,
                        scope_generation,
                        token,
                        reservation.rule.connection_profile_id.clone(),
                        reservation.rule.id.clone(),
                        reservation.connection_generation,
                        reservation.generation,
                        SshForwardEventReason::RuntimeChanged,
                        true,
                    )
                    .await;
                }
                return Err(SshForwardErrorCode::PortConflict.command_error());
            }
        };
        let _command = if command_gate_held {
            None
        } else {
            Some(self.command_gate.lock().await)
        };
        let _intent_admission = self.intent_admission_gate.lock().await;
        if let Err(error) = self
            .checked_scope(context, token, scope_id, scope_generation)
            .await
        {
            let _ = self.connection_registry.lock().await.fail_rule(
                &reservation.rule.connection_profile_id,
                reservation.connection_generation,
                &reservation.rule.id,
                reservation.generation,
                SshForwardErrorCode::ActivationSuperseded,
            );
            return Err(error);
        }
        let (stop_tx, stop_rx) = oneshot::channel();
        let (start_tx, start_rx) = oneshot::channel();
        let task_key = runtime_task_key(
            &reservation.rule.connection_profile_id,
            &reservation.rule.id,
            reservation.generation,
            reservation.cancellation.as_ref(),
        );
        let worker = tokio::spawn(run_rule_worker(
            Arc::downgrade(self),
            task_key.clone(),
            context.clone(),
            scope_id.to_owned(),
            scope_generation,
            token,
            reservation.rule.connection_profile_id.clone(),
            reservation.connection_generation,
            reservation.rule.id.clone(),
            reservation.generation,
            start_rx,
            listener,
            reservation.session_slot,
            reservation.rule.target_port,
            reservation.rule.local_port,
            stop_rx,
            reservation.limiter,
            reservation.active_channels,
            reservation.cancellation,
        ));
        self.register_v2_abort_handle(task_key.clone(), worker.abort_handle());
        if let Err((error, worker)) = self.connection_registry.lock().await.commit_rule(
            &reservation.rule.connection_profile_id,
            reservation.connection_generation,
            &reservation.rule.id,
            reservation.generation,
            stop_tx,
            start_tx,
            worker,
        ) {
            self.remove_v2_abort_handle(&task_key);
            let _ = worker.await;
            let error_code = error.code();
            let failed = self
                .connection_registry
                .lock()
                .await
                .fail_rule(
                    &reservation.rule.connection_profile_id,
                    reservation.connection_generation,
                    &reservation.rule.id,
                    reservation.generation,
                    error_code,
                )
                .is_ok();
            if failed {
                self.emit_rule_hint_checked(
                    scope_id,
                    scope_generation,
                    token,
                    reservation.rule.connection_profile_id.clone(),
                    reservation.rule.id.clone(),
                    reservation.connection_generation,
                    reservation.generation,
                    SshForwardEventReason::RuntimeChanged,
                    true,
                )
                .await;
            }
            return Err(runtime_command_error(error));
        }
        Ok(())
    }

    async fn disable_rule(
        &self,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        expected_rule_generation: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        self.checked_scope(context, token, scope_id, scope_generation)
            .await?;
        let lifecycle = self
            .connection_registry
            .lock()
            .await
            .lifecycle(connection_id)
            .map_err(runtime_command_error)?;
        let _lifecycle = lifecycle.lock().await;
        let plan = self
            .connection_registry
            .lock()
            .await
            .begin_disable_rule(
                connection_id,
                connection_generation,
                rule_id,
                expected_rule_generation,
            )
            .map_err(runtime_command_error)?;
        let Some(plan) = plan else {
            return Ok(());
        };
        self.close_child_shutdown(plan.child).await;
        self.connection_registry
            .lock()
            .await
            .finish_disable_rule(
                connection_id,
                connection_generation,
                rule_id,
                plan.generation,
            )
            .map_err(runtime_command_error)?;
        Ok(())
    }

    async fn enable_desired_rules(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        connection_generation: WireCounter,
    ) {
        let _rule_reconciliation = self.rule_reconciliation_gate.lock().await;
        let config = match self
            .checked_scope(context, token, scope_id, scope_generation)
            .await
        {
            Ok(store) => match store.load_scope_config() {
                Ok(config) => config,
                Err(_) => return,
            },
            Err(_) => return,
        };
        let desired_rules = match config.rules() {
            Ok(rules) => rules
                .into_iter()
                .filter(|rule| rule.connection_profile_id == connection_id)
                .filter(|rule| rule.desired_enabled)
                .map(|rule| (rule.id.clone(), rule))
                .collect::<HashMap<_, _>>(),
            Err(_) => return,
        };
        let live_rules = match self
            .connection_registry
            .lock()
            .await
            .rule_definitions(connection_id)
        {
            Ok(rules) => rules,
            Err(_) => return,
        };
        for (rule_id, generation, live_rule) in live_rules {
            let stale_definition = match desired_rules.get(&rule_id) {
                Some(desired_rule) => desired_rule != &live_rule,
                None => true,
            };
            if stale_definition
                && self
                    .disable_rule(
                        context,
                        token,
                        scope_id,
                        scope_generation,
                        connection_id,
                        connection_generation,
                        &rule_id,
                        generation,
                    )
                    .await
                    .is_ok()
            {
                let cleanup_generation = self
                    .connection_registry
                    .lock()
                    .await
                    .rule_generation(connection_id, &rule_id)
                    .ok()
                    .flatten();
                if let Some(cleanup_generation) = cleanup_generation {
                    let _ = self.connection_registry.lock().await.remove_rule(
                        connection_id,
                        connection_generation,
                        &rule_id,
                        cleanup_generation,
                    );
                }
            }
        }
        let mut rules = desired_rules.into_values().collect::<Vec<_>>();
        rules.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        for rule in rules {
            let expected_rule_generation = match self
                .connection_registry
                .lock()
                .await
                .rule_generation(connection_id, &rule.id)
            {
                Ok(Some(generation)) => generation,
                Ok(None) => WireCounter::ZERO,
                Err(_) => continue,
            };
            if self
                .enable_rule(
                    context,
                    token,
                    scope_id,
                    scope_generation,
                    rule,
                    connection_generation,
                    expected_rule_generation,
                )
                .await
                .is_err()
            {
                // A bad sibling rule must not tear down an established
                // connection or hide the healthy children from the snapshot.
            }
        }
    }

    async fn close_disconnect_plan(&self, plan: DisconnectPlan) -> Option<Arc<SshSession>> {
        self.close_disconnect_plan_until(plan, Instant::now() + WORKER_SHUTDOWN_GRACE)
            .await
    }

    async fn close_disconnect_plan_until(
        &self,
        plan: DisconnectPlan,
        deadline: Instant,
    ) -> Option<Arc<SshSession>> {
        let mut workers = Vec::new();
        let mut task_keys = Vec::new();
        for child in plan.children {
            if let Some(task_key) = child.task_key {
                task_keys.push(task_key);
            }
            if let Some(worker) = child.worker {
                workers.push((child.stop_tx, worker));
            } else if let Some(stop_tx) = child.stop_tx {
                let _ = stop_tx.send(deadline);
            }
        }
        self.close_workers(workers).await;
        let failed_session = if let Some(session) = plan.session {
            match timeout(
                deadline.saturating_duration_since(Instant::now()),
                session.close(),
            )
            .await
            {
                Ok(Ok(())) => None,
                _ => Some(session),
            }
        } else {
            None
        };
        for task_key in task_keys {
            self.remove_v2_abort_handle(&task_key);
        }
        failed_session
    }

    async fn close_child_shutdown(&self, child: ChildShutdown) {
        let deadline = Instant::now() + WORKER_SHUTDOWN_GRACE;
        let task_key = child.task_key;
        if let Some(worker) = child.worker {
            self.close_workers(vec![(child.stop_tx, worker)]).await;
        } else if let Some(stop_tx) = child.stop_tx {
            let _ = stop_tx.send(deadline);
        }
        if let Some(task_key) = task_key {
            self.remove_v2_abort_handle(&task_key);
        }
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
        let mut keys = match credentials::agent_inventory().await {
            Ok(keys) => keys,
            Err(CredentialError::AgentUnavailable) => Vec::new(),
            Err(error) => return Err(map_credential_error(error)),
        };
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
                    encrypted: key.encrypted,
                    source: match key.source {
                        credentials::KeySource::Agent => SshKeyInventorySource::Agent,
                        credentials::KeySource::Local => SshKeyInventorySource::Local,
                    },
                })
                .collect(),
        })
    }

    #[cfg(windows)]
    pub(crate) async fn load_connection_key(
        &self,
        input: &super::model::LoadConnectionKeyInput,
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
        self.check_connection_generation(
            &input.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        if input.key_id.is_empty()
            || input.key_id.len() > 128
            || !input
                .key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || input.passphrase.len() > 4096
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let connection = store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
            .into_iter()
            .find(|connection| connection.id == input.connection_profile_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        if !matches!(connection.auth, SshForwardAuth::Agent)
            && !matches!(&connection.auth, SshForwardAuth::Key { key_id } if key_id == &input.key_id)
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let endpoint = SshEndpoint::new(&connection.ssh_host, connection.ssh_port)
            .map_err(|code| code.command_error())?;
        let loaded = credentials::load_safe_key(&input.key_id, Some(input.passphrase.as_str()))
            .map_err(map_credential_error)?;
        let identity = CredentialIdentity {
            scope_id: input.scope_id.clone(),
            profile_id: input.connection_profile_id.clone(),
            endpoint_host: endpoint.host,
            endpoint_port: endpoint.port,
            ssh_user: connection.ssh_user.clone(),
            auth: VaultAuthIdentity::KeyPassphrase(input.key_id.clone()),
        };
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .insert(
                (input.scope_id.clone(), input.connection_profile_id.clone()),
                Arc::new(LoadedKeyAttempt {
                    key: Arc::new(loaded.key),
                    encrypted: loaded.encrypted,
                    credential_attempt_id: input
                        .credential_attempt_id
                        .clone()
                        .unwrap_or_else(|| "v2".into()),
                    passphrase: input.passphrase.clone(),
                    identity,
                    remember_for_days: input.remember_for_days,
                }),
            );
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .remove(&(input.scope_id.clone(), input.connection_profile_id.clone()));
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    #[cfg(windows)]
    pub(crate) async fn load_connection_password(
        &self,
        input: &super::model::LoadConnectionPasswordInput,
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
        self.check_connection_generation(
            &input.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        if input.username.trim().is_empty()
            || input.username.chars().count() > 64
            || input.username.chars().any(char::is_control)
            || input.password.is_empty()
            || input.password.len() > 4096
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let connection = store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
            .into_iter()
            .find(|connection| connection.id == input.connection_profile_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        if !matches!(connection.auth, SshForwardAuth::Agent)
            || input.username != connection.ssh_user
        {
            return Err(SshForwardErrorCode::InvalidArgument.command_error());
        }
        let endpoint = SshEndpoint::new(&connection.ssh_host, connection.ssh_port)
            .map_err(|code| code.command_error())?;
        let identity = CredentialIdentity {
            scope_id: input.scope_id.clone(),
            profile_id: input.connection_profile_id.clone(),
            endpoint_host: endpoint.host,
            endpoint_port: endpoint.port,
            ssh_user: input.username.clone(),
            auth: VaultAuthIdentity::Password,
        };
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .insert(
                (input.scope_id.clone(), input.connection_profile_id.clone()),
                Arc::new(LoadedPassword {
                    credential_attempt_id: input.credential_attempt_id.clone(),
                    username: Zeroizing::new(input.username.clone()),
                    password: input.password.clone(),
                    identity,
                    remember_for_days: input.remember_for_days,
                }),
            );
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .remove(&(input.scope_id.clone(), input.connection_profile_id.clone()));
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    pub(crate) async fn forget_credential(
        &self,
        input: &super::model::ForgetCredentialInput,
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
        self.check_connection_generation(
            &input.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        let connection = store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
            .into_iter()
            .find(|connection| connection.id == input.connection_profile_id)
            .ok_or_else(|| SshForwardErrorCode::ProfileNotFound.command_error())?;
        let identity = CredentialIdentity {
            scope_id: input.scope_id.clone(),
            profile_id: connection.id.clone(),
            endpoint_host: connection.ssh_host.clone(),
            endpoint_port: connection.ssh_port,
            ssh_user: connection.ssh_user.clone(),
            auth: match &connection.auth {
                SshForwardAuth::Agent => VaultAuthIdentity::Password,
                SshForwardAuth::Key { key_id } => VaultAuthIdentity::KeyPassphrase(key_id.clone()),
            },
        };
        let target = target_for(&identity)
            .map_err(vault_error_code)
            .map_err(SshForwardErrorCode::command_error)?;
        self.credential_vault
            .forget(&target)
            .map_err(vault_error_code)
            .map_err(SshForwardErrorCode::command_error)?;
        self.forget_loaded_password(&input.scope_id, &input.connection_profile_id);
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .remove(&(input.scope_id.clone(), input.connection_profile_id.clone()));
        self.rejected_credentials
            .lock()
            .expect("rejected credential mutex poisoned")
            .remove(target.identity_digest());
        self.snapshot_inner(&input.context, input.activation_token, &input.scope_id)
            .await
    }

    pub(crate) async fn approve_connection_host(
        &self,
        input: &super::model::ApproveConnectionHostInput,
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
        self.check_connection_generation(
            &input.scope_id,
            &input.connection_profile_id,
            input.expected_generation,
        )
        .await?;
        let connection_exists = store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?
            .connections()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
            .into_iter()
            .any(|connection| connection.id == input.connection_profile_id);
        if !connection_exists {
            return Err(SshForwardErrorCode::ProfileNotFound.command_error());
        }
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
            self.check_connection_generation(
                &input.scope_id,
                &input.connection_profile_id,
                input.expected_generation,
            )
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
                    &input.connection_profile_id,
                )
                .map_err(|code| code.command_error())?;
            let committed = store
                .replace_trust(input.expected_trust_revision, {
                    let mut next = trust.clone();
                    next.entries.push(approved.record);
                    next
                })
                .map_err(|_| SshForwardErrorCode::TrustRevisionConflict.command_error())?;
            committed.revision()
        };
        self.update_trust_revision(committed_revision).await;
        self.clear_live_secrets_for_profile(&input.scope_id, &input.connection_profile_id);
        self.emit_runtime_hint(
            None,
            None,
            Some(input.connection_profile_id.clone()),
            None,
            Some(input.expected_generation),
            None,
            Some((
                input.scope_id.clone(),
                input.scope_generation,
                input.activation_token,
            )),
            SshForwardEventReason::TrustChanged,
            true,
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
        let (purged, scope_missing) = match self.store.existing_scope(&input.scope_id) {
            Ok(store) => (
                store
                    .purge_if_deleted(&input.known_scopes)
                    .map_err(|_| SshForwardErrorCode::ScopePurgeFailed.command_error())?,
                false,
            ),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (false, true),
            Err(_) => return Err(SshForwardErrorCode::ScopePurgeFailed.command_error()),
        };
        if purged || scope_missing {
            let scope_prefix = scope_prefix_for(&input.scope_id)
                .map_err(vault_error_code)
                .map_err(SshForwardErrorCode::command_error)?;
            self.credential_vault
                .forget_scope(&scope_prefix)
                .map_err(vault_error_code)
                .map_err(SshForwardErrorCode::command_error)?;
        }
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
        self.shutdown_cancellation.cancel();
        let _command = self.command_gate.lock().await;
        self.stop_all_workers().await;
        let _ = self.stop_all_connections().await;
        *self.active_scope.lock().await = None;
        self.runtimes.lock().await.clear();
        self.clear_live_secrets();
    }

    /// Emergency fallback after bounded graceful disposal; it only aborts tasks.
    pub(crate) fn force_close(&self) {
        self.shutting_down.store(true, Ordering::Release);
        self.shutdown_cancellation.cancel();
        self.abort_v2_tasks();
        self.clear_live_secrets();
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
        if let Ok(mut registry) = self.connection_registry.try_lock() {
            registry.force_close();
        } else {
            defer_registry_cleanup(Arc::clone(&self.connection_registry));
        }
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

    fn forget_loaded_password(&self, scope_id: &str, profile_id: &str) {
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .remove(&(scope_id.to_owned(), profile_id.to_owned()));
    }

    fn clear_live_secrets(&self) {
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .clear();
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .clear();
    }

    fn clear_live_secrets_for_profile(&self, scope_id: &str, profile_id: &str) {
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .remove(&(scope_id.to_owned(), profile_id.to_owned()));
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .remove(&(scope_id.to_owned(), profile_id.to_owned()));
    }

    fn forget_loaded_key_if_same(
        &self,
        scope_id: &str,
        profile_id: &str,
        key: &Arc<LoadedKeyAttempt>,
    ) {
        let mut loaded_keys = self.loaded_keys.lock().expect("loaded key mutex poisoned");
        let key_id = (scope_id.to_owned(), profile_id.to_owned());
        if loaded_keys
            .get(&key_id)
            .is_some_and(|current| Arc::ptr_eq(current, key))
        {
            loaded_keys.remove(&key_id);
        }
    }

    fn take_loaded_password(
        &self,
        scope_id: &str,
        profile_id: &str,
        credential_attempt_id: Option<&str>,
    ) -> Option<Arc<LoadedPassword>> {
        let credential = self
            .loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .remove(&(scope_id.to_owned(), profile_id.to_owned()));
        credential.filter(|credential| {
            credential_attempt_id
                .is_some_and(|attempt_id| attempt_id == credential.credential_attempt_id)
        })
    }

    fn forget_loaded_password_if_same(
        &self,
        scope_id: &str,
        profile_id: &str,
        credential: &Arc<LoadedPassword>,
    ) {
        let mut loaded_passwords = self
            .loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned");
        let key = (scope_id.to_owned(), profile_id.to_owned());
        if loaded_passwords
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, credential))
        {
            loaded_passwords.remove(&key);
        }
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
        loaded_key: Option<Arc<LoadedKeyAttempt>>,
        loaded_password: Option<Arc<LoadedPassword>>,
        mut stop_rx: oneshot::Receiver<Instant>,
    ) {
        let _loaded_password_cleanup = LoadedPasswordCleanup {
            manager: Arc::clone(&self),
            scope_id: scope_id.clone(),
            profile_id: profile_id.clone(),
            key: loaded_key.clone(),
            credential: loaded_password.clone(),
        };
        let endpoint = match SshEndpoint::new(&profile.ssh_host, profile.ssh_port) {
            Ok(endpoint) => endpoint,
            Err(code) => {
                self.fail_runtime(&profile_id, generation, code).await;
                return;
            }
        };
        let initial_connect = tokio::select! {
            _ = &mut stop_rx => return,
            result = self.connect_session(
                &endpoint,
                &profile,
                &trust,
                loaded_key.clone(),
                loaded_password.clone(),
                None,
                true,
            ) => result,
        };
        let (session, credential_lease, credential_save_error) = match initial_connect {
            Ok(result) => result,
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
        if let Some(error_code) = credential_save_error {
            self.set_runtime_error(&profile_id, generation, error_code)
                .await;
        }
        let mut session = Some(session);
        let mut credential_lease = credential_lease;
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
                        .reconnect_session(
                            &listener,
                            &endpoint,
                            &profile,
                            &trust,
                            &mut stop_rx,
                            loaded_key.clone(),
                            loaded_password.clone(),
                            credential_lease.clone(),
                        )
                        .await
                    {
                        ReconnectResult::Connected(next, next_lease, save_error) => {
                            session = Some(next);
                            credential_lease = next_lease;
                            if !self.mark_running(&profile_id, generation).await {
                                if let Some(next) = session.take() {
                                    let _ = timeout(WORKER_SHUTDOWN_GRACE, next.close()).await;
                                }
                                break;
                            }
                            if let Some(error_code) = save_error {
                                self.set_runtime_error(&profile_id, generation, error_code)
                                    .await;
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
        loaded_key: Option<Arc<LoadedKeyAttempt>>,
        loaded_password: Option<Arc<LoadedPassword>>,
        live_lease: Option<Arc<CredentialLease>>,
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
            let loaded_key = loaded_key.clone();
            let loaded_password = loaded_password.clone();
            let live_lease = live_lease.clone();
            let mut connect = tokio::spawn(async move {
                manager
                    .connect_session(
                        &endpoint,
                        &profile,
                        &trust,
                        loaded_key,
                        loaded_password,
                        live_lease,
                        false,
                    )
                    .await
            });
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
                        Ok(Ok((session, lease, save_error))) => {
                            return ReconnectResult::Connected(session, lease, save_error)
                        }
                        Ok(Err(error)) if error.is_terminal_auth() => {
                            return ReconnectResult::Failed(error.error_code());
                        }
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
        loaded_key: Option<Arc<LoadedKeyAttempt>>,
        loaded_password: Option<Arc<LoadedPassword>>,
        live_lease: Option<Arc<CredentialLease>>,
        save_credential: bool,
    ) -> Result<
        (
            SshSession,
            Option<Arc<CredentialLease>>,
            Option<SshForwardErrorCode>,
        ),
        SshTransportError,
    > {
        let permit = self
            .handshake_gate
            .acquire()
            .await
            .map_err(|_| SshTransportError::Connect)?;
        let result = async {
            let deadline = SshTransport::handshake_deadline();
            let transport = SshTransport::connect_until(endpoint, trust, deadline).await?;
            let mut resolved = match live_lease {
                Some(lease) => self
                    .resolve_live_credentials(
                        &profile.scope_id,
                        &profile.id,
                        &endpoint.host,
                        endpoint.port,
                        &profile.ssh_user,
                        &profile.auth,
                        loaded_key.as_ref(),
                        lease,
                    )
                    .map_err(SshTransportError::Credential)?,
                None => self
                    .resolve_credentials(
                        &profile.scope_id,
                        &profile.id,
                        &endpoint.host,
                        endpoint.port,
                        &profile.ssh_user,
                        &profile.auth,
                        loaded_key.as_ref(),
                        loaded_password.as_ref(),
                    )
                    .map_err(SshTransportError::Credential)?,
            };
            self.ensure_credential_fresh(&resolved)?;
            let session = match transport
                .authenticate_until(
                    &profile.ssh_user,
                    &profile.auth,
                    resolved.key.clone(),
                    resolved.password(),
                    resolved.key_passphrase(),
                    deadline,
                )
                .await
            {
                Ok(session) => session,
                Err(error) => {
                    if matches!(&error, SshTransportError::Authentication) {
                        if let Err(code) = self.mark_saved_credential_rejected(&resolved) {
                            return Err(SshTransportError::Credential(code));
                        }
                    }
                    return Err(error);
                }
            };
            let save_error = save_credential
                .then(|| self.save_credential_if_requested(&mut resolved, &profile.auth))
                .and_then(|result| result.err())
                .map(credential_save_error_code);
            Ok((session, resolved.lease, save_error))
        }
        .await;
        drop(permit);
        result
    }

    async fn connect_v2_session(
        &self,
        profile: &SshConnectionProfile,
        trust: &StoredTrust,
        live_lease: Option<Arc<CredentialLease>>,
    ) -> Result<(SshSession, Option<Arc<CredentialLease>>), SshTransportError> {
        let permit = self
            .handshake_gate
            .acquire()
            .await
            .map_err(|_| SshTransportError::Connect)?;
        let result = async {
            let endpoint = SshEndpoint::new(&profile.ssh_host, profile.ssh_port)
                .map_err(SshTransportError::Credential)?;
            let deadline = SshTransport::handshake_deadline();
            let transport = SshTransport::connect_until(&endpoint, trust, deadline).await?;
            let resolved = match live_lease {
                Some(lease) => self
                    .resolve_live_credentials(
                        &profile.scope_id,
                        &profile.id,
                        &endpoint.host,
                        endpoint.port,
                        &profile.ssh_user,
                        &profile.auth,
                        None,
                        lease,
                    )
                    .map_err(SshTransportError::Credential)?,
                None => self
                    .resolve_credentials(
                        &profile.scope_id,
                        &profile.id,
                        &endpoint.host,
                        endpoint.port,
                        &profile.ssh_user,
                        &profile.auth,
                        None,
                        None,
                    )
                    .map_err(SshTransportError::Credential)?,
            };
            self.ensure_credential_fresh(&resolved)?;
            let session = match transport
                .authenticate_until(
                    &profile.ssh_user,
                    &profile.auth,
                    resolved.key.clone(),
                    resolved.password(),
                    resolved.key_passphrase(),
                    deadline,
                )
                .await
            {
                Ok(session) => session,
                Err(error) => {
                    if matches!(&error, SshTransportError::Authentication) {
                        if let Err(code) = self.mark_saved_credential_rejected(&resolved) {
                            return Err(SshTransportError::Credential(code));
                        }
                    }
                    return Err(error);
                }
            };
            Ok((session, resolved.lease))
        }
        .await;
        drop(permit);
        result
    }

    async fn release_v2_reconnect_owner(
        &self,
        scope_id: &str,
        scope_generation: WireCounter,
        token: WireCounter,
        connection_id: &str,
        connection_generation: WireCounter,
        owner: &str,
    ) {
        let action = {
            let mut registry = self.connection_registry.lock().await;
            if !registry
                .is_reconnect_owner(connection_id, connection_generation, owner)
                .unwrap_or(false)
            {
                None
            } else if registry
                .has_reconnectable_rules(connection_id, connection_generation, owner)
                .unwrap_or(false)
            {
                let _ = registry.abandon_reconnect(connection_id, connection_generation, owner);
                Some(false)
            } else {
                let changed = registry
                    .fail_reconnect(
                        connection_id,
                        connection_generation,
                        SshForwardErrorCode::SshConnectFailed,
                    )
                    .is_ok();
                Some(changed)
            }
        };
        if action == Some(true) {
            self.emit_connection_hint_checked(
                scope_id,
                scope_generation,
                token,
                connection_id.to_owned(),
                connection_generation,
                SshForwardEventReason::RuntimeChanged,
            )
            .await;
        }
    }

    async fn reconnect_v2_connection(
        self: &Arc<Self>,
        context: &DesktopClientContext,
        token: WireCounter,
        scope_id: &str,
        scope_generation: WireCounter,
        connection_id: &str,
        connection_generation: WireCounter,
        owner: &str,
        lost_session: Option<Arc<SshSession>>,
        listener: &TcpListener,
        stop_rx: &mut oneshot::Receiver<Instant>,
        session_slot: &Arc<SessionSlot>,
        cancellation: &Arc<ConnectionCancellation>,
    ) -> bool {
        if let Some(lost_session) = lost_session {
            if !session_slot.clear_if_matches(&lost_session) && session_slot.current().is_some() {
                return true;
            }
        }
        let reconnect = loop {
            if session_slot.current().is_some() {
                return true;
            }
            match self.connection_registry.lock().await.begin_reconnect(
                connection_id,
                connection_generation,
                owner,
            ) {
                Ok(Some(reconnect)) => break reconnect,
                Ok(None) => {
                    if session_slot.current().is_some() {
                        return true;
                    }
                    if cancellation.is_cancelled() {
                        return false;
                    }
                    let still_reconnecting = self
                        .connection_registry
                        .lock()
                        .await
                        .is_reconnecting(connection_id, connection_generation)
                        .unwrap_or(false);
                    if !still_reconnecting {
                        return false;
                    }
                    let observed = session_slot.version();
                    let changed = session_slot.wait_for_change(observed);
                    tokio::pin!(changed);
                    tokio::select! {
                        stopped = &mut *stop_rx => {
                            let _ = stopped;
                            self.release_v2_reconnect_owner(
                                scope_id,
                                scope_generation,
                                token,
                                connection_id,
                                connection_generation,
                                owner,
                            )
                            .await;
                            return false;
                        }
                        _ = cancellation.cancelled() => return false,
                        accepted = listener.accept() => {
                            if accepted.is_err() {
                                return false;
                            }
                        }
                        _ = &mut changed => {}
                    }
                }
                Err(_) => return false,
            }
        };
        let ConnectionReconnectContext {
            profile,
            generation,
            session,
            credential_lease,
            session_slot: _reconnect_slot,
            cancellation: reconnect_cancellation,
            policy,
        } = reconnect;
        let cancellation = reconnect_cancellation;
        if let Some(session) = session {
            let _ = timeout(WORKER_SHUTDOWN_GRACE, session.close()).await;
        }
        let fail = |code| async move {
            let _ = self.connection_registry.lock().await.fail_reconnect(
                connection_id,
                generation,
                code,
            );
            self.emit_connection_hint_checked(
                scope_id,
                scope_generation,
                token,
                connection_id.to_owned(),
                generation,
                SshForwardEventReason::RuntimeChanged,
            )
            .await;
            false
        };
        if !policy.enabled || policy.max_attempts == 0 {
            return fail(SshForwardErrorCode::SshConnectFailed).await;
        }
        let active = match self.active_scope.lock().await.clone() {
            Some(active) if active.id == scope_id && active.generation == scope_generation => {
                active
            }
            _ => return fail(SshForwardErrorCode::ScopeNotActive).await,
        };
        let trust = match active.store.load_trust() {
            Ok(trust) => trust,
            Err(_) => return fail(SshForwardErrorCode::StoreIo).await,
        };
        let endpoint = match SshEndpoint::new(&profile.ssh_host, profile.ssh_port) {
            Ok(endpoint) => endpoint,
            Err(code) => return fail(code).await,
        };
        let mut last_error = SshForwardErrorCode::SshConnectFailed;
        for attempt in 1..=policy.max_attempts {
            if cancellation.is_cancelled() {
                return false;
            }
            if self
                .connection_registry
                .lock()
                .await
                .set_reconnect_attempt(connection_id, generation, attempt)
                .is_err()
            {
                return false;
            }
            self.emit_connection_hint_checked(
                scope_id,
                scope_generation,
                token,
                connection_id.to_owned(),
                generation,
                SshForwardEventReason::RuntimeChanged,
            )
            .await;
            let delay = sleep(Duration::from_secs(
                1_u64 << u32::from((attempt - 1).min(4)),
            ));
            tokio::pin!(delay);
            loop {
                tokio::select! {
                    stopped = &mut *stop_rx => {
                        let _ = stopped;
                        self.release_v2_reconnect_owner(
                            scope_id,
                            scope_generation,
                            token,
                            connection_id,
                            connection_generation,
                            owner,
                        )
                        .await;
                        return false;
                    }
                    _ = cancellation.cancelled() => return false,
                    accepted = listener.accept() => {
                        if accepted.is_err() {
                            return false;
                        }
                    }
                    _ = &mut delay => break,
                }
            }
            let connect = self.connect_v2_session(&profile, &trust, credential_lease.clone());
            tokio::pin!(connect);
            let result = loop {
                tokio::select! {
                    stopped = &mut *stop_rx => {
                        let _ = stopped;
                        self.release_v2_reconnect_owner(
                            scope_id,
                            scope_generation,
                            token,
                            connection_id,
                            connection_generation,
                            owner,
                        )
                        .await;
                        return false;
                    }
                    _ = cancellation.cancelled() => return false,
                    accepted = listener.accept() => {
                        if accepted.is_err() {
                            return false;
                        }
                    }
                    result = &mut connect => break result,
                }
            };
            match result {
                Ok((session, lease)) => {
                    let session = Arc::new(session);
                    let committed = self
                        .connection_registry
                        .lock()
                        .await
                        .finish_reconnect(connection_id, generation, Arc::clone(&session), lease)
                        .is_ok();
                    if committed {
                        self.emit_connection_hint_checked(
                            scope_id,
                            scope_generation,
                            token,
                            connection_id.to_owned(),
                            generation,
                            SshForwardEventReason::RuntimeChanged,
                        )
                        .await;
                        return true;
                    }
                    let _ = timeout(WORKER_SHUTDOWN_GRACE, session.close()).await;
                    return false;
                }
                Err(error) => {
                    last_error = error.error_code();
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
                            scope_id,
                            &context.desktop_instance_id,
                            &context.manager_session_id,
                            connection_id,
                            &endpoint,
                            offered,
                            trust.revision(),
                        );
                    }
                    let terminal = error.is_terminal_auth()
                        || matches!(
                            error,
                            SshTransportError::HostKeyRejected(_)
                                | SshTransportError::HostKeyChanged(_)
                                | SshTransportError::HostKeyAlgorithmChanged(_)
                                | SshTransportError::HostKeyAlgorithmUnsupported(_)
                        );
                    if terminal || attempt == policy.max_attempts {
                        return fail(last_error).await;
                    }
                }
            }
        }
        fail(last_error).await
    }

    async fn auto_start_scope(
        self: &Arc<Self>,
        _context: &DesktopClientContext,
        _token: WireCounter,
        key: ActivationKey,
    ) -> Result<(), SshForwardCommandError> {
        let Some(active) = self.active_scope.lock().await.clone() else {
            return Ok(());
        };
        let config = active
            .store
            .load_scope_config()
            .map_err(|_| SshForwardErrorCode::StoreIo.command_error())?;
        let mut desired_rules = config
            .rules()
            .map_err(|_| SshForwardErrorCode::StoreCorrupt.command_error())?
            .into_iter()
            .filter(|rule| rule.desired_enabled)
            .collect::<Vec<_>>();
        desired_rules.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        // Scope activation only rehydrates the desired set. Authentication and
        // listener admission begin at explicit connect/setRuleEnabled commands.
        // Iterating in wire order makes supersession deterministic without
        // authorizing any network activity from persisted flags.
        for _rule in desired_rules {
            self.check_intent(key).await?;
        }
        self.check_intent(key).await?;
        Ok(())
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
            self.start_inner(
                &super::model::ProfileLifecycleInput {
                    context: context.clone(),
                    activation_token: token,
                    scope_id: active.id.clone(),
                    scope_generation: active.generation,
                    profile_id,
                    expected_generation: generation,
                    credential_attempt_id: None,
                },
                false,
            )
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

    async fn set_runtime_error(
        &self,
        profile_id: &str,
        generation: WireCounter,
        error_code: SshForwardErrorCode,
    ) {
        let changed = {
            let mut runtimes = self.runtimes.lock().await;
            let Some(runtime) = runtimes.get_mut(profile_id) else {
                return;
            };
            if runtime.generation != generation || runtime.state != SshForwardState::Running {
                return;
            }
            runtime.error_code = Some(error_code);
            runtime.changed_at = UtcTimestamp::now();
            true
        };
        if changed {
            self.emit_hint(
                Some(profile_id.into()),
                SshForwardEventReason::RuntimeChanged,
            )
            .await;
        }
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
        // A terminal failure is actionable UI state. Bypass the normal runtime
        // hint throttle so a fast connect failure cannot be hidden behind the
        // preceding start hint.
        self.event_times
            .lock()
            .await
            .remove(&format!("profile:{profile_id}"));
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

    async fn stop_all_connections(&self) -> Result<(), SshForwardCommandError> {
        let _admission_gate = self.connection_admission_gate.lock().await;
        let keys = self.connection_registry.lock().await.connection_keys();
        let mut teardown_failed = false;
        for (connection_id, generation, lifecycle) in keys {
            let _ = self
                .connection_registry
                .lock()
                .await
                .cancel_connection(&connection_id, generation);
            let _lifecycle = lifecycle.lock().await;
            let plan = self
                .connection_registry
                .lock()
                .await
                .begin_disconnect(&connection_id, generation);
            let plan = match plan {
                Ok(Some(plan)) => plan,
                Ok(None) => continue,
                Err(_) => {
                    teardown_failed = true;
                    continue;
                }
            };
            let next_generation = plan.generation;
            let failed_session = self.close_disconnect_plan(plan).await;
            if let Some(session) = failed_session {
                let _ = self
                    .connection_registry
                    .lock()
                    .await
                    .retain_disconnect_session(&connection_id, next_generation, session);
                teardown_failed = true;
                continue;
            }
            let _ = self
                .connection_registry
                .lock()
                .await
                .finish_disconnect(&connection_id, next_generation);
        }
        self.connection_registry
            .lock()
            .await
            .clear_if_disconnected();
        self.abort_v2_tasks();
        if teardown_failed {
            Err(SshForwardErrorCode::ShutdownTimeout.command_error())
        } else {
            Ok(())
        }
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
        let next_scope_id = next.as_ref().map(|scope| scope.id.as_str());
        self.loaded_keys
            .lock()
            .expect("loaded key mutex poisoned")
            .retain(|(scope_id, _), _| Some(scope_id.as_str()) == next_scope_id);
        self.loaded_passwords
            .lock()
            .expect("loaded password mutex poisoned")
            .retain(|(scope_id, _), _| Some(scope_id.as_str()) == next_scope_id);
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

    async fn check_connection_generation(
        &self,
        scope_id: &str,
        connection_profile_id: &str,
        expected: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        let current = self
            .connection_registry
            .lock()
            .await
            .connection_snapshots_for_scope(scope_id)
            .into_iter()
            .find(|runtime| runtime.connection_profile_id == connection_profile_id)
            .map(|runtime| runtime.generation)
            .unwrap_or(WireCounter::ZERO);
        if current != expected {
            let mut error = SshForwardErrorCode::StaleConnectionGeneration.command_error();
            error.connection_profile_id = Some(connection_profile_id.to_owned());
            error.current_generation = Some(current.to_string());
            return Err(error);
        }
        Ok(())
    }

    async fn check_rule_generation(
        &self,
        scope_id: &str,
        rule_id: &str,
        expected: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        let current = self
            .connection_registry
            .lock()
            .await
            .rule_snapshots_for_scope(scope_id)
            .into_iter()
            .find(|runtime| runtime.rule_id == rule_id)
            .map(|runtime| runtime.generation)
            .unwrap_or(WireCounter::ZERO);
        if current != expected {
            let mut error = SshForwardErrorCode::StaleRuleGeneration.command_error();
            error.rule_id = Some(rule_id.to_owned());
            error.current_generation = Some(current.to_string());
            return Err(error);
        }
        Ok(())
    }

    async fn connection_is_active(&self, scope_id: &str, connection_profile_id: &str) -> bool {
        self.connection_registry
            .lock()
            .await
            .connection_snapshots_for_scope(scope_id)
            .into_iter()
            .find(|runtime| runtime.connection_profile_id == connection_profile_id)
            .is_some_and(|runtime| runtime.state != SshConnectionState::Disconnected)
    }

    async fn rule_is_active(&self, scope_id: &str, rule_id: &str) -> bool {
        self.connection_registry
            .lock()
            .await
            .rule_snapshots_for_scope(scope_id)
            .into_iter()
            .find(|runtime| runtime.rule_id == rule_id)
            .is_some_and(|runtime| {
                !matches!(
                    runtime.state,
                    SshForwardRuleState::Off | SshForwardRuleState::Failed
                )
            })
    }

    async fn update_connections_revision(&self, revision: WireCounter) {
        if let Some(active) = self.active_scope.lock().await.as_mut() {
            active.connections_revision = revision;
        }
    }

    async fn update_rules_revision(&self, revision: WireCounter) {
        if let Some(active) = self.active_scope.lock().await.as_mut() {
            active.rules_revision = revision;
        }
    }

    async fn update_rules_revision_for_scope(
        &self,
        scope_id: &str,
        scope_generation: WireCounter,
        revision: WireCounter,
    ) {
        if let Some(active) = self.active_scope.lock().await.as_mut() {
            if active.id == scope_id && active.generation == scope_generation {
                active.rules_revision = revision;
            }
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

    fn check_connections_revision(
        &self,
        current: WireCounter,
        expected: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        if current == expected {
            Ok(())
        } else {
            let mut error = SshForwardErrorCode::ConnectionsRevisionConflict.command_error();
            error.current_connections_revision = Some(current.to_string());
            Err(error)
        }
    }

    fn check_rules_revision(
        &self,
        current: WireCounter,
        expected: WireCounter,
    ) -> Result<(), SshForwardCommandError> {
        if current == expected {
            Ok(())
        } else {
            let mut error = SshForwardErrorCode::RulesRevisionConflict.command_error();
            error.current_rules_revision = Some(current.to_string());
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
        self.emit_runtime_hint(
            profile_id, None, None, None, None, None, None, reason, false,
        )
        .await;
    }

    async fn emit_connection_hint_checked(
        &self,
        scope_id: &str,
        scope_generation: WireCounter,
        token: WireCounter,
        connection_profile_id: String,
        connection_generation: WireCounter,
        reason: SshForwardEventReason,
    ) {
        self.emit_runtime_hint(
            None,
            None,
            Some(connection_profile_id),
            None,
            Some(connection_generation),
            None,
            Some((scope_id.to_owned(), scope_generation, token)),
            reason,
            false,
        )
        .await;
    }

    async fn emit_collection_hint_checked(
        &self,
        scope_id: &str,
        scope_generation: WireCounter,
        token: WireCounter,
        reason: SshForwardEventReason,
    ) {
        self.emit_runtime_hint(
            None,
            None,
            None,
            None,
            None,
            None,
            Some((scope_id.to_owned(), scope_generation, token)),
            reason,
            true,
        )
        .await;
    }

    async fn emit_rule_hint_checked(
        &self,
        scope_id: &str,
        scope_generation: WireCounter,
        token: WireCounter,
        connection_profile_id: String,
        rule_id: String,
        connection_generation: WireCounter,
        rule_generation: WireCounter,
        reason: SshForwardEventReason,
        bypass_throttle: bool,
    ) {
        self.emit_runtime_hint(
            None,
            None,
            Some(connection_profile_id),
            Some(rule_id),
            Some(connection_generation),
            Some(rule_generation),
            Some((scope_id.to_owned(), scope_generation, token)),
            reason,
            bypass_throttle,
        )
        .await;
    }

    async fn emit_runtime_hint(
        &self,
        profile_id: Option<String>,
        generation: Option<WireCounter>,
        connection_profile_id: Option<String>,
        rule_id: Option<String>,
        connection_generation: Option<WireCounter>,
        rule_generation: Option<WireCounter>,
        scope_guard: Option<(String, WireCounter, WireCounter)>,
        reason: SshForwardEventReason,
        bypass_throttle: bool,
    ) {
        let Some(app) = self.app.lock().await.clone() else {
            return;
        };
        let active = self.active_scope.lock().await.clone();
        let Some(mut active) = active else {
            return;
        };
        let mut intent = self.intent.lock().await.clone();
        if let Some((scope_id, scope_generation, token)) = scope_guard.as_ref() {
            if active.id != *scope_id
                || active.generation != *scope_generation
                || intent.latest_activation_token != *token
            {
                return;
            }
        }
        let now = Instant::now();
        let key = if let Some(rule_id) = rule_id.as_deref() {
            format!("rule:{rule_id}")
        } else if let Some(connection_id) = connection_profile_id.as_deref() {
            format!("connection:{connection_id}")
        } else {
            format!("profile:{}", profile_id.as_deref().unwrap_or_default())
        };
        let mut times = self.event_times.lock().await;
        if !bypass_throttle
            && times
                .get(&key)
                .is_some_and(|last| now.duration_since(*last) < EVENT_MIN_INTERVAL)
        {
            return;
        }
        times.insert(key, now);
        drop(times);
        let manager_session_id = {
            let issuer = self.issuer.lock().await;
            issuer.manager_session_id().to_owned()
        };
        if scope_guard.is_some() {
            let latest_active = self.active_scope.lock().await.clone();
            let latest_intent = self.intent.lock().await.clone();
            let Some(latest_active) = latest_active else {
                return;
            };
            if scope_guard
                .as_ref()
                .is_some_and(|(scope_id, scope_generation, token)| {
                    latest_active.id != *scope_id
                        || latest_active.generation != *scope_generation
                        || latest_intent.latest_activation_token != *token
                })
            {
                return;
            }
            active = latest_active;
            intent = latest_intent;
        }
        let _ = app.emit(
            "ssh-forward:changed",
            SshForwardEventHint {
                desktop_instance_id: self.identity.clone(),
                manager_session_id,
                client_epoch: intent.latest_client_epoch,
                activation_token: intent.latest_activation_token,
                scope_id: active.id,
                scope_generation: active.generation,
                connections_revision: active.connections_revision,
                rules_revision: active.rules_revision,
                profiles_revision: active.profiles_revision,
                trust_revision: active.trust_revision,
                profile_id,
                generation,
                connection_profile_id,
                rule_id,
                connection_generation,
                rule_generation,
                reason,
            },
        );
    }
}

fn runtime_command_error(error: RuntimeError) -> SshForwardCommandError {
    let mut command = error.code().command_error();
    match error {
        RuntimeError::StaleConnectionGeneration(current)
        | RuntimeError::StaleRuleGeneration(current) => {
            command.current_generation = Some(current.to_string());
        }
        RuntimeError::InvalidArgument
        | RuntimeError::CounterExhausted
        | RuntimeError::ConnectionNotFound
        | RuntimeError::ConnectionLimit
        | RuntimeError::ConnectionNotEstablished
        | RuntimeError::ConnectionCancelled
        | RuntimeError::HostKeyIdentityMissing
        | RuntimeError::RuleLimit
        | RuntimeError::PortConflict => {}
    }
    command
}

async fn run_rule_worker(
    manager: Weak<SshForwardManager>,
    task_key: String,
    context: DesktopClientContext,
    scope_id: String,
    scope_generation: WireCounter,
    token: WireCounter,
    connection_id: String,
    connection_generation: WireCounter,
    rule_id: String,
    rule_generation: WireCounter,
    start_rx: oneshot::Receiver<()>,
    listener: TcpListener,
    session_slot: Arc<SessionSlot>,
    target_port: u16,
    local_port: u16,
    mut stop_rx: oneshot::Receiver<Instant>,
    limiter: ChannelLimiter,
    active_channels: Arc<AtomicU16>,
    cancellation: Arc<ConnectionCancellation>,
) {
    if start_rx.await.is_err() {
        return;
    }
    let mut channel_tasks = JoinSet::new();
    let mut keepalive = interval(Duration::from_secs(30));
    let mut stop_deadline = None;
    loop {
        while channel_tasks.try_join_next().is_some() {}
        if session_slot.current().is_none() {
            if let Some(manager) = manager.upgrade() {
                if !manager
                    .reconnect_v2_connection(
                        &context,
                        token,
                        &scope_id,
                        scope_generation,
                        &connection_id,
                        connection_generation,
                        &rule_id,
                        None,
                        &listener,
                        &mut stop_rx,
                        &session_slot,
                        &cancellation,
                    )
                    .await
                {
                    stop_deadline = Some(Instant::now() + WORKER_SHUTDOWN_GRACE);
                    break;
                }
            }
        }
        tokio::select! {
            stopped = &mut stop_rx => {
                stop_deadline = Some(stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE));
                break;
            }
            accepted = listener.accept() => {
                let Ok((socket, _)) = accepted else { break; };
                let Some(permit) = limiter.try_acquire() else { continue; };
                let Some(session) = session_slot.current() else {
                    drop(permit);
                    continue;
                };
                let channel = tokio::select! {
                    stopped = &mut stop_rx => {
                        stop_deadline = Some(stopped.unwrap_or_else(|_| Instant::now() + WORKER_SHUTDOWN_GRACE));
                        break;
                    }
                    result = session.open_direct_tcpip("127.0.0.1", target_port, local_port) => {
                        result
                    }
                };
                let channel = match channel {
                    Ok(channel) => channel,
                    Err(error) => {
                        drop(socket);
                        drop(permit);
                        let transport_lost = error.is_parent_transport_loss();
                        if transport_lost {
                            abort_channel_tasks(
                                &mut channel_tasks,
                                Instant::now() + WORKER_SHUTDOWN_GRACE,
                            )
                            .await;
                            if let Some(manager) = manager.upgrade() {
                                if !manager
                                    .reconnect_v2_connection(
                                        &context,
                                        token,
                                        &scope_id,
                                        scope_generation,
                                        &connection_id,
                                        connection_generation,
                                        &rule_id,
                                        Some(Arc::clone(&session)),
                                        &listener,
                                        &mut stop_rx,
                                        &session_slot,
                                        &cancellation,
                                    )
                                    .await
                                {
                                    stop_deadline = Some(Instant::now() + WORKER_SHUTDOWN_GRACE);
                                    break;
                                }
                            }
                        }
                        continue;
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
                let Some(session) = session_slot.current() else { continue; };
                if session.send_keepalive().await.is_err() {
                    abort_channel_tasks(
                        &mut channel_tasks,
                        Instant::now() + WORKER_SHUTDOWN_GRACE,
                    )
                    .await;
                    if let Some(manager) = manager.upgrade() {
                        if !manager
                            .reconnect_v2_connection(
                                &context,
                                token,
                                &scope_id,
                                scope_generation,
                                &connection_id,
                                connection_generation,
                                &rule_id,
                                Some(Arc::clone(&session)),
                                &listener,
                                &mut stop_rx,
                                &session_slot,
                                &cancellation,
                            )
                            .await
                        {
                            stop_deadline = Some(Instant::now() + WORKER_SHUTDOWN_GRACE);
                            break;
                        }
                    }
                }
            }
        }
    }
    drop(listener);
    let deadline = stop_deadline.unwrap_or_else(|| Instant::now() + WORKER_SHUTDOWN_GRACE);
    abort_channel_tasks(&mut channel_tasks, deadline).await;
    if let Some(manager) = manager.upgrade() {
        manager
            .release_v2_reconnect_owner(
                &scope_id,
                scope_generation,
                token,
                &connection_id,
                connection_generation,
                &rule_id,
            )
            .await;
        manager.remove_v2_abort_handle(&task_key);
        let changed = manager
            .connection_registry
            .lock()
            .await
            .worker_exited(
                &connection_id,
                connection_generation,
                &rule_id,
                rule_generation,
                &cancellation,
                SshForwardErrorCode::BindFailed,
            )
            .unwrap_or(false);
        if changed {
            manager
                .emit_rule_hint_checked(
                    &scope_id,
                    scope_generation,
                    token,
                    connection_id,
                    rule_id,
                    connection_generation,
                    rule_generation,
                    SshForwardEventReason::RuntimeChanged,
                    true,
                )
                .await;
        }
    }
}

#[cfg(test)]
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
    Connected(
        SshSession,
        Option<Arc<CredentialLease>>,
        Option<SshForwardErrorCode>,
    ),
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

fn defer_registry_cleanup(registry: Arc<Mutex<ConnectionRegistry>>) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            registry.lock().await.force_close();
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
                registry.lock().await.force_close();
            });
        });
    }
}

fn defer_connection_reservation_cleanup(
    registry: Arc<Mutex<ConnectionRegistry>>,
    connection_id: String,
    generation: WireCounter,
    cancellation: Arc<ConnectionCancellation>,
) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            let _ = registry.lock().await.discard_connection_if_matches(
                &connection_id,
                generation,
                &cancellation,
            );
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
                let _ = registry.lock().await.discard_connection_if_matches(
                    &connection_id,
                    generation,
                    &cancellation,
                );
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
            CredentialError::InvalidPassphrase => Self::KeyPassphraseInvalid,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io,
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
    use zeroize::Zeroizing;

    use super::{
        abort_channel_tasks, connection_credential_target, credential_save_error_code,
        partition_auto_start_candidates, record_activation_intent, store_write_error_code,
        vault_error_code, ActivationBarrierPoint, ActivationIntent, ActivationKey,
        ConnectionAdmission, ConnectionReservationGuard, CredentialLease, LoadedPassword,
        LoadedPasswordCleanup, ResolvedCredentials, RuntimeEntry, SshForwardManager,
        ACTIVE_FORWARD_LIMIT, HANDSHAKE_CONCURRENCY_LIMIT,
    };
    use crate::ssh_forward::{
        credential_vault::{
            fake::{FakeClock, FakeCredentialVault},
            target_for, CredentialIdentity, CredentialKind, CredentialRecord, CredentialStatus,
            CredentialVault, VaultAuthIdentity, VaultError,
        },
        error::SshForwardErrorCode,
        model::{
            ApproveConnectionHostInput, ConnectionLifecycleInput, ConnectionMutationInput,
            CreateConnectionInput, CreateRuleInput, DeleteConnectionInput, DeleteRuleInput,
            PurgeScopeInput, RuleMutationInput, ScopeContextInput, SetRuleEnabledInput,
            SshConnectionState, SshForwardRuleState, SshForwardState, UpdateConnectionInput,
            UpdateRuleInput, UtcTimestamp, WireCounter,
        },
        profile::{
            LoopbackHost, ReconnectPolicy, SshConnectionProfile, SshForwardAuth, SshForwardProfile,
            SshForwardRule,
        },
        scope_retention::KnownScopesInput,
    };

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";
    const SCOPE_2: &str = "d1f5890a-55d7-46ca-949b-0d63972f0a68";

    struct WorkerDropGuard(Arc<AtomicUsize>);

    #[test]
    fn store_write_failures_keep_their_specific_error_class() {
        assert_eq!(
            store_write_error_code(&io::Error::new(
                io::ErrorKind::InvalidData,
                "connections_revision_conflict",
            )),
            SshForwardErrorCode::ConnectionsRevisionConflict
        );
        assert_eq!(
            store_write_error_code(&io::Error::new(
                io::ErrorKind::InvalidData,
                "counter_exhausted",
            )),
            SshForwardErrorCode::CounterExhausted
        );
        assert_eq!(
            store_write_error_code(&io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid_store_toml",
            )),
            SshForwardErrorCode::StoreCorrupt
        );
        assert_eq!(
            store_write_error_code(&io::Error::new(
                io::ErrorKind::PermissionDenied,
                "permission_denied",
            )),
            SshForwardErrorCode::StoreIo
        );
    }

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

    fn v2_connection(auth: SshForwardAuth) -> SshConnectionProfile {
        let timestamp = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "bastion".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth,
            created_at: timestamp,
            updated_at: timestamp,
        }
    }

    #[tokio::test]
    async fn active_manager_rule_mutations_use_scope_activity_lease() {
        let config = temp_config_dir("active-manager-rule-mutations");
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
        let connection = v2_connection(SshForwardAuth::Agent);
        let created_connection = manager
            .create_connection(&CreateConnectionInput {
                request: ConnectionMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: WireCounter::ZERO,
                },
                connection: connection.clone(),
            })
            .await
            .unwrap();
        let timestamp = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let rule = SshForwardRule {
            id: "a1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            connection_profile_id: connection.id.clone(),
            name: "web".into(),
            local_port: 18_080,
            target_host: LoopbackHost,
            target_port: 80,
            desired_enabled: true,
            reconnect: ReconnectPolicy {
                enabled: false,
                max_attempts: 1,
            },
            created_at: timestamp,
            updated_at: timestamp,
        };
        let created_rule = tokio::time::timeout(
            Duration::from_secs(1),
            manager.create_rule(&CreateRuleInput {
                request: RuleMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_rules_revision: created_connection.rules_revision,
                    connection_profile_id: connection.id.clone(),
                    expected_connection_generation: WireCounter::ZERO,
                },
                rule: rule.clone(),
            }),
        )
        .await
        .unwrap()
        .unwrap();
        let updated_rule = SshForwardRule {
            name: "web-updated".into(),
            target_port: 8080,
            updated_at: timestamp,
            ..rule.clone()
        };
        let updated = tokio::time::timeout(
            Duration::from_secs(1),
            manager.update_rule(&UpdateRuleInput {
                request: RuleMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_rules_revision: created_rule.rules_revision,
                    connection_profile_id: connection.id.clone(),
                    expected_connection_generation: WireCounter::ZERO,
                },
                rule_id: rule.id.clone(),
                expected_rule_generation: WireCounter::ZERO,
                rule: updated_rule,
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(updated.rules[0].target_port, 8080);
        let connection_generation = {
            let mut registry = manager.connection_registry.lock().await;
            let ConnectionAdmission::Reserved(reservation) = registry
                .reserve_connection(connection.clone(), WireCounter::ZERO)
                .unwrap()
            else {
                panic!("disconnected test connection must reserve");
            };
            registry
                .fail_connection(
                    &connection.id,
                    reservation.generation,
                    SshForwardErrorCode::SshConnectFailed,
                )
                .unwrap();
            reservation.generation
        };
        let toggled = tokio::time::timeout(
            Duration::from_secs(1),
            manager.set_rule_enabled_v2(&SetRuleEnabledInput {
                context: opened.context.clone(),
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
                connection_profile_id: connection.id.clone(),
                expected_connection_generation: connection_generation,
                rule_id: rule.id.clone(),
                expected_rule_generation: WireCounter::ZERO,
                enabled: false,
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(!toggled.rules[0].desired_enabled);
        let deleted = tokio::time::timeout(
            Duration::from_secs(1),
            manager.delete_rule(&DeleteRuleInput {
                request: RuleMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_rules_revision: toggled.rules_revision,
                    connection_profile_id: connection.id,
                    expected_connection_generation: connection_generation,
                },
                rule_id: rule.id,
                expected_rule_generation: WireCounter::ZERO,
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(deleted.rules.is_empty());

        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn v2_connection_credential_cleanup_tracks_identity_changes() {
        let config = temp_config_dir("v2-connection-credential-cleanup");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let connection = v2_connection(SshForwardAuth::Agent);
        let target = connection_credential_target(&connection).unwrap();
        vault
            .save(
                &target,
                &CredentialRecord::new(
                    CredentialKind::Password,
                    "secret",
                    target.identity_digest(),
                    now,
                )
                .unwrap(),
            )
            .unwrap();

        let renamed = SshConnectionProfile {
            name: "renamed".into(),
            ..connection.clone()
        };
        manager
            .forget_changed_connection_credentials(&connection, &renamed)
            .unwrap();
        assert_eq!(
            vault.load(&target, now).unwrap().status,
            CredentialStatus::Saved
        );

        let moved = SshConnectionProfile {
            ssh_host: "other.example".into(),
            ..connection.clone()
        };
        manager
            .forget_changed_connection_credentials(&connection, &moved)
            .unwrap();
        assert_eq!(
            vault.load(&target, now).unwrap().status,
            CredentialStatus::None
        );

        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn v2_connection_cleanup_failure_keeps_profile_and_secret() {
        let config = temp_config_dir("v2-connection-cleanup-failure");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = Arc::new(
            SshForwardManager::new_with_dependencies(
                &config,
                Arc::clone(&vault) as Arc<dyn CredentialVault>,
                Arc::clone(&clock) as Arc<dyn super::Clock>,
            )
            .unwrap(),
        );
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
        let connection = v2_connection(SshForwardAuth::Agent);
        let created = manager
            .create_connection(&CreateConnectionInput {
                request: ConnectionMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: WireCounter::ZERO,
                },
                connection: connection.clone(),
            })
            .await
            .unwrap();
        let target = connection_credential_target(&connection).unwrap();
        vault
            .save(
                &target,
                &CredentialRecord::new(
                    CredentialKind::Password,
                    "secret",
                    target.identity_digest(),
                    now,
                )
                .unwrap(),
            )
            .unwrap();
        vault.set_failures(false, false, true);

        let moved = SshConnectionProfile {
            ssh_host: "other.example".into(),
            ..connection.clone()
        };
        let update = manager
            .update_connection(&UpdateConnectionInput {
                request: ConnectionMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: created.connections_revision,
                },
                connection_profile_id: connection.id.clone(),
                expected_generation: WireCounter::ZERO,
                connection: moved,
            })
            .await
            .unwrap_err();
        assert_eq!(update.code, SshForwardErrorCode::CredentialDeleteFailed);
        let after_update = manager
            .snapshot(&ScopeContextInput {
                context: opened.context.clone(),
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
            })
            .await
            .unwrap();
        assert_eq!(after_update.connections, vec![connection.clone()]);
        assert!(vault.contains(&target));

        let delete = manager
            .delete_connection(&DeleteConnectionInput {
                request: ConnectionMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: after_update.connections_revision,
                },
                connection_profile_id: connection.id.clone(),
                expected_generation: WireCounter::ZERO,
            })
            .await
            .unwrap_err();
        assert_eq!(delete.code, SshForwardErrorCode::CredentialDeleteFailed);
        let after_delete = manager
            .snapshot(&ScopeContextInput {
                context: opened.context,
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
            })
            .await
            .unwrap();
        assert_eq!(after_delete.connections, vec![connection.clone()]);
        assert!(vault.contains(&target));

        vault.set_failures(false, false, false);
        let failed_generation = {
            let mut registry = manager.connection_registry.lock().await;
            let ConnectionAdmission::Reserved(reservation) = registry
                .reserve_connection(connection.clone(), WireCounter::ZERO)
                .unwrap()
            else {
                panic!("failed connection must reserve");
            };
            registry
                .fail_connection(
                    &connection.id,
                    reservation.generation,
                    SshForwardErrorCode::SshConnectFailed,
                )
                .unwrap();
            reservation.generation
        };
        manager
            .activation_test_barrier
            .enable(ActivationBarrierPoint::BeforeV2CollectionCommit);
        let delete_manager = Arc::clone(&manager);
        let delete_context = after_delete.context.clone();
        let delete_id = connection.id.clone();
        let delete_expected_revision = after_delete.connections_revision;
        let delete_scope_generation = activation.scope_generation;
        let delete_task = tokio::spawn(async move {
            delete_manager
                .delete_connection(&DeleteConnectionInput {
                    request: ConnectionMutationInput {
                        context: delete_context,
                        activation_token: WireCounter::parse("1").unwrap(),
                        scope_id: SCOPE.into(),
                        scope_generation: delete_scope_generation,
                        expected_connections_revision: delete_expected_revision,
                    },
                    connection_profile_id: delete_id,
                    expected_generation: failed_generation,
                })
                .await
        });
        tokio::time::timeout(
            Duration::from_secs(1),
            manager.activation_test_barrier.wait_entered(),
        )
        .await
        .unwrap();
        let external_store = manager
            .active_scope
            .lock()
            .await
            .as_ref()
            .expect("scope remains active")
            .store
            .clone();
        let external_current = external_store.load_scope_config().unwrap();
        external_store
            .replace_connections(external_current.connections_revision, external_current)
            .unwrap();
        manager.activation_test_barrier.release();
        let conflict = delete_task.await.unwrap().unwrap_err();
        assert_eq!(
            conflict.code,
            SshForwardErrorCode::ConnectionsRevisionConflict
        );
        let after_conflict = manager
            .snapshot(&ScopeContextInput {
                context: after_delete.context.clone(),
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
            })
            .await
            .unwrap();
        assert_eq!(
            conflict.current_connections_revision,
            Some(after_conflict.connections_revision.to_string())
        );
        assert_eq!(after_conflict.connections, vec![connection.clone()]);
        assert!(after_conflict
            .connection_runtimes
            .iter()
            .any(|runtime| runtime.connection_profile_id == connection.id
                && runtime.generation == failed_generation));

        manager.activation_test_barrier.disable();
        let deleted = manager
            .delete_connection(&DeleteConnectionInput {
                request: ConnectionMutationInput {
                    context: after_delete.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: after_conflict.connections_revision,
                },
                connection_profile_id: connection.id,
                expected_generation: failed_generation,
            })
            .await
            .unwrap();
        assert!(deleted.connections.is_empty());
        assert!(deleted.connection_runtimes.is_empty());
        assert!(!vault.contains(&target));

        drop(external_store);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn loaded_password_cleanup_is_identity_safe() {
        let config = temp_config_dir("loaded-password-cleanup");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let key = (SCOPE.to_owned(), "profile".to_owned());
        let credential = Arc::new(LoadedPassword {
            credential_attempt_id: "attempt-1".to_owned(),
            username: Zeroizing::new("operator".to_owned()),
            password: Zeroizing::new("secret".to_owned()),
            identity: CredentialIdentity {
                scope_id: SCOPE.into(),
                profile_id: "profile".into(),
                endpoint_host: "host.example".into(),
                endpoint_port: 22,
                ssh_user: "operator".into(),
                auth: VaultAuthIdentity::Password,
            },
            remember_for_days: 0,
        });
        manager
            .loaded_passwords
            .lock()
            .unwrap()
            .insert(key.clone(), Arc::clone(&credential));

        drop(LoadedPasswordCleanup {
            manager: Arc::clone(&manager),
            scope_id: SCOPE.to_owned(),
            profile_id: "profile".to_owned(),
            key: None,
            credential: Some(Arc::clone(&credential)),
        });
        assert!(!manager.loaded_passwords.lock().unwrap().contains_key(&key));

        manager
            .loaded_passwords
            .lock()
            .unwrap()
            .insert(key.clone(), Arc::clone(&credential));
        assert!(manager
            .take_loaded_password(SCOPE, "profile", Some("attempt-1"))
            .is_some());
        assert!(manager.loaded_passwords.lock().unwrap().get(&key).is_none());
        manager
            .loaded_passwords
            .lock()
            .unwrap()
            .insert(key.clone(), Arc::clone(&credential));
        let replacement = Arc::new(LoadedPassword {
            credential_attempt_id: "attempt-2".to_owned(),
            username: Zeroizing::new("replacement".to_owned()),
            password: Zeroizing::new("new-secret".to_owned()),
            identity: CredentialIdentity {
                scope_id: SCOPE.into(),
                profile_id: "profile".into(),
                endpoint_host: "host.example".into(),
                endpoint_port: 22,
                ssh_user: "replacement".into(),
                auth: VaultAuthIdentity::Password,
            },
            remember_for_days: 0,
        });
        manager
            .loaded_passwords
            .lock()
            .unwrap()
            .insert(key.clone(), Arc::clone(&replacement));
        drop(LoadedPasswordCleanup {
            manager: Arc::clone(&manager),
            scope_id: SCOPE.to_owned(),
            profile_id: "profile".to_owned(),
            key: None,
            credential: Some(credential),
        });
        assert!(manager
            .loaded_passwords
            .lock()
            .unwrap()
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &replacement)));

        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn credential_resolution_prefers_the_exact_saved_identity_and_quarantines_it() {
        let config = temp_config_dir("credential-resolution");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        let target = target_for(&identity).unwrap();
        let record = CredentialRecord::new(
            CredentialKind::Password,
            "secret",
            target.identity_digest(),
            now,
        )
        .unwrap();
        vault.save(&target, &record).unwrap();

        let resolved = manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                None,
            )
            .unwrap();
        assert!(resolved.saved_reuse);
        assert_eq!(resolved.password(), Some(("operator", "secret")));
        manager.mark_saved_credential_rejected(&resolved).unwrap();
        let rejected = vault.load(&target, now).unwrap();
        assert_eq!(rejected.status, CredentialStatus::Rejected);
        assert!(manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                None,
            )
            .unwrap()
            .lease
            .is_none());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn rejection_persistence_failure_keeps_live_lease_quarantined() {
        let config = temp_config_dir("rejection-persistence-failure");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        let vault_entry = target_for(&identity).unwrap();
        vault
            .save(
                &vault_entry,
                &CredentialRecord::new(
                    CredentialKind::Password,
                    "secret",
                    vault_entry.identity_digest(),
                    now,
                )
                .unwrap(),
            )
            .unwrap();
        let resolved = manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                None,
            )
            .unwrap();
        let lease = resolved.lease.clone().unwrap();
        vault.set_failures(false, true, true);
        assert_eq!(
            manager.mark_saved_credential_rejected(&resolved),
            Err(SshForwardErrorCode::CredentialRejected)
        );
        let live_result = manager.resolve_live_credentials(
            SCOPE,
            "profile",
            "bastion.example",
            22,
            "operator",
            &SshForwardAuth::Agent,
            None,
            lease,
        );
        assert_eq!(
            live_result.err(),
            Some(SshForwardErrorCode::CredentialRejected)
        );
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn unencrypted_key_passphrase_is_never_saved() {
        let config = temp_config_dir("unencrypted-key-passphrase");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::KeyPassphrase("workstation".into()),
        };
        let vault_entry = target_for(&identity).unwrap();
        let mut resolved = ResolvedCredentials {
            key: None,
            key_encrypted: false,
            lease: Some(Arc::new(CredentialLease::new_key_passphrase(
                identity,
                "attempt",
                "irrelevant",
            ))),
            target: Some(vault_entry.clone()),
            saved_reuse: false,
            remember_for_days: 30,
        };
        manager
            .save_credential_if_requested(
                &mut resolved,
                &SshForwardAuth::Key {
                    key_id: "workstation".into(),
                },
            )
            .unwrap();
        assert_eq!(
            vault.load(&vault_entry, now).unwrap().status,
            CredentialStatus::None
        );
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn credential_save_failure_is_reported_as_a_nonfatal_warning() {
        let config = temp_config_dir("credential-save-warning");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        let target = target_for(&identity).unwrap();
        let mut resolved = ResolvedCredentials {
            key: None,
            key_encrypted: false,
            lease: Some(Arc::new(CredentialLease::new_password(
                identity, "attempt", "operator", "secret",
            ))),
            target: Some(target),
            saved_reuse: false,
            remember_for_days: 30,
        };
        vault.set_failures(false, true, false);
        let save_error = manager
            .save_credential_if_requested(&mut resolved, &SshForwardAuth::Agent)
            .unwrap_err();
        assert_eq!(
            vault_error_code(save_error),
            SshForwardErrorCode::CredentialNotSaved
        );
        for error in [
            VaultError::Unavailable,
            VaultError::Corrupt,
            VaultError::InvalidIdentity,
            VaultError::InvalidRecord,
            VaultError::WriteFailed,
            VaultError::DeleteFailed,
        ] {
            assert_eq!(
                credential_save_error_code(error),
                SshForwardErrorCode::CredentialNotSaved
            );
        }
        assert!(resolved.lease.is_some());

        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn saved_password_cannot_downgrade_key_authentication() {
        let config = temp_config_dir("credential-kind-isolation");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let password_identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        let password_target = target_for(&password_identity).unwrap();
        vault
            .save(
                &password_target,
                &CredentialRecord::new(
                    CredentialKind::Password,
                    "secret",
                    password_target.identity_digest(),
                    now,
                )
                .unwrap(),
            )
            .unwrap();

        let resolved = manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Key {
                    key_id: "workstation".into(),
                },
                None,
                None,
            )
            .unwrap();
        assert!(!resolved.saved_reuse);
        assert!(resolved.password().is_none());
        assert!(resolved.lease.is_none());
        assert!(vault
            .load(&password_target, now)
            .unwrap()
            .credential
            .is_some());

        let staged = Arc::new(LoadedPassword {
            credential_attempt_id: "attempt".into(),
            username: Zeroizing::new("operator".into()),
            password: Zeroizing::new("staged-secret".into()),
            identity: password_identity,
            remember_for_days: 30,
        });
        assert!(matches!(
            manager.resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Key {
                    key_id: "workstation".into(),
                },
                None,
                Some(&staged),
            ),
            Err(SshForwardErrorCode::InvalidArgument)
        ));

        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn reconnect_reuses_the_live_lease_without_reading_the_vault() {
        let config = temp_config_dir("live-credential-lease");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        vault.set_failures(true, false, false);
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: "profile".into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        let lease = Arc::new(CredentialLease::new_password(
            identity, "attempt", "operator", "secret",
        ));
        let resolved = manager
            .resolve_live_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                lease,
            )
            .unwrap();
        assert_eq!(resolved.password(), Some(("operator", "secret")));
        assert!(!resolved.saved_reuse);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn vault_read_failure_does_not_block_direct_auth_modes() {
        let config = temp_config_dir("vault-read-failure-direct-auth");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        vault.set_failures(true, false, false);

        for auth in [
            SshForwardAuth::Agent,
            SshForwardAuth::Key {
                key_id: "workstation".into(),
            },
        ] {
            let resolved = manager
                .resolve_credentials(
                    SCOPE,
                    "profile",
                    "bastion.example",
                    22,
                    "operator",
                    &auth,
                    None,
                    None,
                )
                .unwrap();
            assert!(resolved.lease.is_none());
        }
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn successful_staged_credential_replaces_the_entry_with_a_new_fixed_term() {
        let config = temp_config_dir("credential-replacement");
        let now = UtcTimestamp::parse("2026-08-17T00:00:00.000Z").unwrap();
        let clock = Arc::new(FakeClock::new(now));
        let vault = Arc::new(FakeCredentialVault::new());
        let manager = SshForwardManager::new_with_dependencies(
            &config,
            Arc::clone(&vault) as Arc<dyn CredentialVault>,
            Arc::clone(&clock) as Arc<dyn super::Clock>,
        )
        .unwrap();
        let staged = Arc::new(LoadedPassword {
            credential_attempt_id: "attempt-1".into(),
            username: Zeroizing::new("operator".into()),
            password: Zeroizing::new("first".into()),
            identity: CredentialIdentity {
                scope_id: SCOPE.into(),
                profile_id: "profile".into(),
                endpoint_host: "bastion.example".into(),
                endpoint_port: 22,
                ssh_user: "operator".into(),
                auth: VaultAuthIdentity::Password,
            },
            remember_for_days: 30,
        });
        let mut first = manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                Some(&staged),
            )
            .unwrap();
        let target = first.target.clone().unwrap();
        manager
            .save_credential_if_requested(&mut first, &SshForwardAuth::Agent)
            .unwrap();
        let first_expiry = vault.load(&target, now).unwrap().expires_at.unwrap();
        assert!(first.is_expired(first_expiry));
        clock.set(first_expiry);
        let reconnect = manager
            .resolve_live_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                first.lease.clone().unwrap(),
            )
            .unwrap();
        assert!(manager.ensure_credential_fresh(&reconnect).is_err());

        let later = now.checked_add_seconds(60).unwrap();
        clock.set(later);
        let replacement = LoadedPassword {
            password: Zeroizing::new("second".into()),
            credential_attempt_id: "attempt-2".into(),
            ..staged.as_ref().clone()
        };
        let mut second = manager
            .resolve_credentials(
                SCOPE,
                "profile",
                "bastion.example",
                22,
                "operator",
                &SshForwardAuth::Agent,
                None,
                Some(&Arc::new(replacement)),
            )
            .unwrap();
        manager
            .save_credential_if_requested(&mut second, &SshForwardAuth::Agent)
            .unwrap();
        let saved = vault.load(&target, later).unwrap();
        assert_eq!(saved.status, CredentialStatus::Saved);
        assert!(saved.expires_at.unwrap() > first_expiry);
        assert_eq!(saved.credential.unwrap().secret.as_str(), "second");
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
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

    #[tokio::test]
    async fn force_close_aborts_v2_workers_when_registry_lock_is_contended() {
        let config = temp_config_dir("force-close-v2-lock");
        let manager = SshForwardManager::new(&config).unwrap();
        let connection = SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        let worker = tokio::spawn(async {
            std::future::pending::<()>().await;
        });
        manager.register_v2_abort_handle("v2-probe".into(), worker.abort_handle());
        let mut registry = manager.connection_registry.lock().await;
        assert!(matches!(
            registry.reserve_connection(connection, WireCounter::ZERO),
            Ok(super::super::connection_runtime::ConnectionAdmission::Reserved(_))
        ));
        manager.force_close();
        assert!(worker.await.is_err());
        drop(registry);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if manager
                    .connection_registry
                    .lock()
                    .await
                    .connection_keys()
                    .is_empty()
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(manager
            .v2_abort_handles
            .lock()
            .expect("v2 abort handle mutex poisoned")
            .is_empty());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn late_v2_connect_is_rejected_after_force_close() {
        let config = temp_config_dir("late-v2-connect");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        manager.force_close();
        let error = manager
            .connect_connection(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                WireCounter::parse("1").unwrap(),
                "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
                WireCounter::ZERO,
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, SshForwardErrorCode::ShutdownInProgress);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn v2_connect_reaches_established_after_host_approval() {
        let config = temp_config_dir("v2-connect-established");
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
            keys: vec![host_key],
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
        let _server_handle = server_ready_rx.await.unwrap();

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
        let timestamp = UtcTimestamp::parse("2026-08-19T00:00:00.000Z").unwrap();
        let connection = SshConnectionProfile {
            id: "e2634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "local-test".into(),
            ssh_host: "127.0.0.1".into(),
            ssh_port: server_address.port(),
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Key {
                key_id: crate::ssh_forward::ssh_client::TEST_PRIVATE_KEY_ID.into(),
            },
            created_at: timestamp,
            updated_at: timestamp,
        };
        manager
            .create_connection(&CreateConnectionInput {
                request: ConnectionMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_connections_revision: WireCounter::ZERO,
                },
                connection: connection.clone(),
            })
            .await
            .unwrap();

        let first = tokio::time::timeout(
            Duration::from_secs(5),
            manager.connect_connection(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                activation.scope_generation,
                &connection.id,
                WireCounter::ZERO,
            ),
        )
        .await
        .expect("initial V2 connect did not return a host-key challenge")
        .unwrap();
        let challenge = first
            .host_key_challenges
            .iter()
            .find(|challenge| challenge.connection_profile_id == connection.id)
            .cloned()
            .expect("V2 connect did not publish a host-key challenge");
        let approved = manager
            .approve_connection_host(&ApproveConnectionHostInput {
                context: opened.context.clone(),
                activation_token: WireCounter::parse("1").unwrap(),
                scope_id: SCOPE.into(),
                scope_generation: activation.scope_generation,
                connection_profile_id: connection.id.clone(),
                expected_generation: WireCounter::parse("1").unwrap(),
                challenge_id: challenge.challenge_id,
                algorithm: challenge.algorithm,
                fingerprint: challenge.fingerprint,
                expected_trust_revision: first.trust_revision,
            })
            .await
            .unwrap();
        let generation = approved
            .connection_runtimes
            .iter()
            .find(|runtime| runtime.connection_profile_id == connection.id)
            .expect("approved connection runtime is missing")
            .generation;

        let connected = tokio::time::timeout(
            Duration::from_secs(5),
            manager.connect_connection(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                activation.scope_generation,
                &connection.id,
                generation,
            ),
        )
        .await
        .expect("V2 connect did not finish")
        .unwrap();
        let connected_runtime = connected
            .connection_runtimes
            .iter()
            .find(|runtime| runtime.connection_profile_id == connection.id)
            .expect("connected runtime is missing");
        assert_eq!(connected_runtime.state, SshConnectionState::Established);
        let connected_generation = connected_runtime.generation;

        let local_port = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            listener.local_addr().unwrap().port()
        };
        let rule = SshForwardRule {
            id: "f2634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            connection_profile_id: connection.id.clone(),
            name: "local-forward".into(),
            local_port,
            target_host: LoopbackHost,
            target_port: server_address.port(),
            desired_enabled: true,
            reconnect: ReconnectPolicy {
                enabled: false,
                max_attempts: 1,
            },
            created_at: timestamp,
            updated_at: timestamp,
        };
        let with_rule = manager
            .create_rule(&CreateRuleInput {
                request: RuleMutationInput {
                    context: opened.context.clone(),
                    activation_token: WireCounter::parse("1").unwrap(),
                    scope_id: SCOPE.into(),
                    scope_generation: activation.scope_generation,
                    expected_rules_revision: connected.rules_revision,
                    connection_profile_id: connection.id.clone(),
                    expected_connection_generation: connected_generation,
                },
                rule: rule.clone(),
            })
            .await
            .unwrap();
        let runtime = with_rule
            .rule_runtimes
            .iter()
            .find(|runtime| runtime.rule_id == rule.id)
            .expect("created desired-enabled rule runtime is missing");
        assert_eq!(runtime.state, SshForwardRuleState::On);
        assert_eq!(runtime.error_code, None);

        server_task.abort();
        let _ = server_task.await;
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn connect_command_timeout_releases_a_stuck_native_operation() {
        let config = temp_config_dir("connect-command-timeout");
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let opened = manager
            .open_client(KnownScopesInput::Available {
                ids: vec![SCOPE.into()],
            })
            .await
            .unwrap();
        let input = ConnectionLifecycleInput {
            context: opened.context,
            activation_token: WireCounter::parse("1").unwrap(),
            scope_id: SCOPE.into(),
            scope_generation: WireCounter::parse("1").unwrap(),
            connection_profile_id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            expected_generation: WireCounter::ZERO,
            credential_attempt_id: None,
        };
        let (started, error) = {
            let _command = manager.command_gate.lock().await;
            let started = Instant::now();
            let error = manager
                .connect_with_timeout(&input, Duration::from_millis(10))
                .await
                .unwrap_err();
            (started, error)
        };

        assert_eq!(error.code, SshForwardErrorCode::SshConnectTimeout);
        assert!(started.elapsed() < Duration::from_secs(1));
        let connection = SshConnectionProfile {
            id: input.connection_profile_id.clone(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        assert!(matches!(
            manager
                .connection_registry
                .lock()
                .await
                .reserve_connection(connection, WireCounter::ZERO),
            Ok(ConnectionAdmission::Reserved(_))
        ));
        manager
            .cleanup_timed_out_connection(&input.connection_profile_id, WireCounter::ZERO)
            .await;
        assert!(manager
            .connection_registry
            .lock()
            .await
            .connection_keys()
            .is_empty());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn disconnect_connection_cancels_a_reserved_authentication() {
        let config = temp_config_dir("disconnect-v2-authentication");
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
        let connection = SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        let mut registry = manager.connection_registry.lock().await;
        assert!(matches!(
            registry.reserve_connection(connection, WireCounter::ZERO),
            Ok(super::super::connection_runtime::ConnectionAdmission::Reserved(_))
        ));
        drop(registry);
        let snapshot = manager
            .disconnect_connection(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                activation.scope_generation,
                "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
                WireCounter::parse("1").unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(snapshot.scope_id, SCOPE);
        assert_eq!(
            manager
                .connection_registry
                .lock()
                .await
                .state("e1634e77-b0b5-4b21-bd2f-462c9e3b7a96"),
            Some(crate::ssh_forward::model::SshConnectionState::Disconnected)
        );
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn disable_rule_is_idempotent_when_no_child_exists() {
        let config = temp_config_dir("disable-v2-no-child");
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
        let connection = SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        assert!(matches!(
            manager
                .connection_registry
                .lock()
                .await
                .reserve_connection(connection, WireCounter::ZERO),
            Ok(super::super::connection_runtime::ConnectionAdmission::Reserved(_))
        ));
        manager
            .disable_rule(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                activation.scope_generation,
                "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
                WireCounter::parse("1").unwrap(),
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0",
                WireCounter::ZERO,
            )
            .await
            .unwrap();
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn enable_rule_rejects_a_reserved_connection_before_binding() {
        let config = temp_config_dir("enable-v2-not-established");
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
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let connection = SshConnectionProfile {
            id: connection_id.into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        assert!(matches!(
            manager
                .connection_registry
                .lock()
                .await
                .reserve_connection(connection, WireCounter::ZERO),
            Ok(super::super::connection_runtime::ConnectionAdmission::Reserved(_))
        ));
        let rule = SshForwardRule {
            id: "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0".into(),
            scope_id: SCOPE.into(),
            connection_profile_id: connection_id.into(),
            name: "probe-rule".into(),
            local_port: 15_432,
            target_host: LoopbackHost,
            target_port: 9,
            desired_enabled: false,
            reconnect: ReconnectPolicy {
                enabled: false,
                max_attempts: 1,
            },
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        let error = manager
            .enable_rule(
                &opened.context,
                WireCounter::parse("1").unwrap(),
                SCOPE,
                activation.scope_generation,
                rule,
                WireCounter::parse("1").unwrap(),
                WireCounter::ZERO,
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, SshForwardErrorCode::ConnectionNotEstablished);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn stop_all_connections_cancels_authentication_before_lifecycle_wait() {
        let config = temp_config_dir("stop-v2-authentication");
        let manager = SshForwardManager::new(&config).unwrap();
        let connection = SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        let cancellation = {
            let mut registry = manager.connection_registry.lock().await;
            let super::super::connection_runtime::ConnectionAdmission::Reserved(reservation) =
                registry
                    .reserve_connection(connection, WireCounter::ZERO)
                    .unwrap()
            else {
                panic!("fresh connection should reserve");
            };
            reservation.cancellation
        };
        let waiter = {
            let cancellation = Arc::clone(&cancellation);
            tokio::spawn(async move { cancellation.cancelled().await })
        };
        manager.stop_all_connections().await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(manager
            .connection_registry
            .lock()
            .await
            .connection_keys()
            .is_empty());
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[tokio::test]
    async fn dropped_connection_reservation_is_reaped() {
        let config = temp_config_dir("dropped-v2-reservation");
        let manager = SshForwardManager::new(&config).unwrap();
        let connection = SshConnectionProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "probe".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        };
        let (generation, cancellation) = {
            let mut registry = manager.connection_registry.lock().await;
            let super::super::connection_runtime::ConnectionAdmission::Reserved(reservation) =
                registry
                    .reserve_connection(connection, WireCounter::ZERO)
                    .unwrap()
            else {
                panic!("fresh connection should reserve");
            };
            (reservation.generation, reservation.cancellation)
        };
        {
            let _guard = ConnectionReservationGuard::new(
                Arc::clone(&manager.connection_registry),
                "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
                generation,
                cancellation,
            );
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if manager
                    .connection_registry
                    .lock()
                    .await
                    .connection_keys()
                    .is_empty()
                {
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
