use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use rand::{Rng, RngCore};
use subtle::ConstantTimeEq;

use super::reducer::AgentStatusRegistry;
use super::types::{
    validate_safe_integer, AgentStatusAvailability, AgentStatusBroadcastEvent,
    AgentStatusChangedPayload, AgentStatusError, AgentStatusRemovedPayload, AgentStatusSnapshotV1,
    ReporterAccepted, ReporterAck, ReporterHello, ReporterReport, BROADCAST_CAPACITY,
    DEFAULT_HEARTBEAT_MS, DEFAULT_LEASE_MS,
};

/// Lifecycle state for terminal-scoped capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialState {
    /// Reserved after allocating incarnation, prior to successful PTY publication.
    Pending,
    /// Activated once PTY creation commits to the live session map.
    Active,
    /// Revoked due to spawn failure, replacement, kill, exit, or server shutdown.
    Revoked,
}

/// Record of an allocated scoped credential.
#[derive(Debug, Clone)]
pub struct ScopedCredential {
    pub terminal_id: String,
    pub incarnation: u64,
    pub token: String,
    pub state: CredentialState,
}

/// Authentication result for a bearer token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenAuthResult {
    /// Valid active capability for the current terminal incarnation.
    Active {
        terminal_id: String,
        incarnation: u64,
    },
    /// Credential was reserved but child has not published live yet (retryable).
    Pending,
    /// Invalid, expired, unknown, or revoked token.
    InvalidOrRevoked,
}

/// Handle representing an active reporter connection on a terminal.
struct LiveReporterHandle {
    reporter_id: String,
    reporter_epoch: u64,
    close_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
struct CredentialStore {
    by_token: HashMap<String, ScopedCredential>,
    by_terminal: HashMap<(String, u64), String>,
    next_reporter_epoch: u64,
}

/// Guard holding a pending credential reservation.
///
/// Automatically revokes the credential on drop unless explicitly activated.
pub struct CredentialReservation {
    runtime: AgentStatusRuntime,
    terminal_id: String,
    incarnation: u64,
    token: String,
    url: String,
    activated: bool,
}

impl CredentialReservation {
    /// Scoped loopback status WebSocket URL.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Scoped secret bearer token.
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Associated terminal identifier.
    pub fn terminal_id(&self) -> &str {
        &self.terminal_id
    }

    /// Associated terminal incarnation counter.
    pub fn incarnation(&self) -> u64 {
        self.incarnation
    }

    /// Activate credential upon successful PTY publication.
    pub fn activate(mut self) {
        self.runtime.activate_credential(&self.terminal_id, self.incarnation);
        self.activated = true;
    }

    /// Explicitly revoke credential without waiting for drop.
    pub fn revoke(mut self) {
        self.runtime.revoke_credential(&self.terminal_id, self.incarnation);
        self.activated = true; // prevent double-revocation in drop
    }
}

impl Drop for CredentialReservation {
    fn drop(&mut self) {
        if !self.activated {
            self.runtime.revoke_credential(&self.terminal_id, self.incarnation);
        }
    }
}

struct Inner {
    server_epoch: u64,
    availability: RwLock<AgentStatusAvailability>,
    listener_url: RwLock<Option<String>>,
    registry: Arc<RwLock<AgentStatusRegistry>>,
    credentials: Mutex<CredentialStore>,
    reporters: Mutex<HashMap<(String, u64), LiveReporterHandle>>,
    event_tx: tokio::sync::broadcast::Sender<AgentStatusBroadcastEvent>,
    lease_abort_handle: Mutex<Option<tokio::task::AbortHandle>>,
}

/// Shared runtime managing agent status credentials, loopback admission, and semantic broadcast.
#[derive(Clone)]
pub struct AgentStatusRuntime(Arc<Inner>);

impl AgentStatusRuntime {
    /// Create a new runtime with a random server epoch and specified availability and listener URL.
    pub fn new(availability: AgentStatusAvailability, listener_url: Option<String>) -> Self {
        let mut rng = rand::thread_rng();
        let server_epoch = rng.gen_range(1..=(1u64 << 52));
        Self::with_epoch(server_epoch, availability, listener_url)
    }

    /// Create a runtime with an explicit server epoch (useful for deterministic tests).
    pub fn with_epoch(
        server_epoch: u64,
        availability: AgentStatusAvailability,
        listener_url: Option<String>,
    ) -> Self {
        let registry = Arc::new(RwLock::new(AgentStatusRegistry::new(
            server_epoch,
            availability,
        )));
        let (event_tx, _) = tokio::sync::broadcast::channel(BROADCAST_CAPACITY);

        Self(Arc::new(Inner {
            server_epoch,
            availability: RwLock::new(availability),
            listener_url: RwLock::new(listener_url),
            registry,
            credentials: Mutex::new(CredentialStore::default()),
            reporters: Mutex::new(HashMap::new()),
            event_tx,
            lease_abort_handle: Mutex::new(None),
        }))
    }

    /// Create an unqualified runtime for unsupported platforms.
    pub fn platform_unqualified() -> Self {
        Self::new(AgentStatusAvailability::PlatformUnqualified, None)
    }

    /// Create an unavailable runtime when loopback binding fails.
    pub fn unavailable() -> Self {
        Self::new(AgentStatusAvailability::Unavailable, None)
    }

    /// Server epoch generated at process start.
    pub fn server_epoch(&self) -> u64 {
        self.0.server_epoch
    }

    /// Current public subsystem availability.
    pub fn availability(&self) -> AgentStatusAvailability {
        *self.0.availability.read()
    }

    /// Listener URL if collector is actively bound.
    pub fn listener_url(&self) -> Option<String> {
        self.0.listener_url.read().clone()
    }

    /// Check if collector is ready and available for reporting.
    pub fn is_available(&self) -> bool {
        self.availability() == AgentStatusAvailability::Ready
            && self.0.listener_url.read().is_some()
    }

    /// Update listener URL and availability when collector binds.
    pub fn set_listener(&self, url: String, availability: AgentStatusAvailability) {
        *self.0.listener_url.write() = Some(url);
        *self.0.availability.write() = availability;
        let _ = self.0.registry.write().set_availability(availability);
    }

    /// Reserve a scoped credential for a pending terminal incarnation.
    ///
    /// Returns `None` if the runtime is unavailable or platform-unqualified.
    pub fn reserve_credential(
        &self,
        terminal_id: &str,
        incarnation: u64,
    ) -> Option<CredentialReservation> {
        let url = self.listener_url()?;
        if self.availability() != AgentStatusAvailability::Ready {
            return None;
        }

        let mut token_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut token_bytes);
        let token = hex::encode(token_bytes);

        let key = (terminal_id.to_string(), incarnation);
        let cred = ScopedCredential {
            terminal_id: terminal_id.to_string(),
            incarnation,
            token: token.clone(),
            state: CredentialState::Pending,
        };

        {
            let mut creds = self.0.credentials.lock();
            creds.by_token.insert(token.clone(), cred);
            creds.by_terminal.insert(key, token.clone());
        }

        Some(CredentialReservation {
            runtime: self.clone(),
            terminal_id: terminal_id.to_string(),
            incarnation,
            token,
            url,
            activated: false,
        })
    }

    /// Activate a pending credential upon committed PTY publication.
    pub fn activate_credential(&self, terminal_id: &str, incarnation: u64) -> bool {
        let mut creds = self.0.credentials.lock();
        let key = (terminal_id.to_string(), incarnation);
        if let Some(token) = creds.by_terminal.get(&key).cloned() {
            if let Some(cred) = creds.by_token.get_mut(&token) {
                if cred.state == CredentialState::Pending {
                    cred.state = CredentialState::Active;
                    return true;
                }
            }
        }
        false
    }

    /// Revoke credential for a terminal incarnation.
    pub fn revoke_credential(&self, terminal_id: &str, incarnation: u64) {
        let key = (terminal_id.to_string(), incarnation);
        {
            let mut creds = self.0.credentials.lock();
            if let Some(token) = creds.by_terminal.remove(&key) {
                creds.by_token.remove(&token);
            }
        }
        // Disconnect any active reporter connection
        let mut reporters = self.0.reporters.lock();
        if let Some(mut handle) = reporters.remove(&key) {
            if let Some(tx) = handle.close_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Remove a terminal from registry and capabilities upon PTY retirement.
    pub fn remove_terminal(
        &self,
        terminal_id: &str,
        incarnation: u64,
    ) -> Result<Option<AgentStatusRemovedPayload>, AgentStatusError> {
        self.revoke_credential(terminal_id, incarnation);
        let payload = {
            let mut reg = self.0.registry.write();
            reg.remove_terminal(terminal_id, incarnation)?
        };
        if let Some(p) = &payload {
            let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Removed(p.clone()));
        }
        Ok(payload)
    }

    /// Authenticate a bearer token presented on WebSocket handshake.
    pub fn authenticate_bearer(&self, token: &str) -> TokenAuthResult {
        let creds = self.0.credentials.lock();
        if let Some(cred) = creds.by_token.get(token) {
            let is_match: bool = token.as_bytes().ct_eq(cred.token.as_bytes()).into();
            if is_match {
                match cred.state {
                    CredentialState::Active => TokenAuthResult::Active {
                        terminal_id: cred.terminal_id.clone(),
                        incarnation: cred.incarnation,
                    },
                    CredentialState::Pending => TokenAuthResult::Pending,
                    CredentialState::Revoked => TokenAuthResult::InvalidOrRevoked,
                }
            } else {
                TokenAuthResult::InvalidOrRevoked
            }
        } else {
            TokenAuthResult::InvalidOrRevoked
        }
    }

    /// Admit a reporter connection after validating hello payload.
    pub fn admit_reporter(
        &self,
        terminal_id: &str,
        incarnation: u64,
        hello: &ReporterHello,
        close_tx: tokio::sync::oneshot::Sender<()>,
    ) -> Result<ReporterAccepted, AgentStatusError> {
        let now_ms = crate::pty::session::now_ms();
        let (reporter_epoch, row) = {
            let mut reporters = self.0.reporters.lock();
            let key = (terminal_id.to_string(), incarnation);

            if let Some(existing) = reporters.get_mut(&key) {
                if existing.reporter_id == hello.reporter_id {
                    // Same reporter reconnect: close old socket cleanly
                    if let Some(tx) = existing.close_tx.take() {
                        let _ = tx.send(());
                    }
                } else {
                    // Different reporter: reject while old is live
                    return Err(AgentStatusError::ReporterOccupied {
                        active: existing.reporter_id.clone(),
                    });
                }
            }

            let mut creds = self.0.credentials.lock();
            creds.next_reporter_epoch = creds.next_reporter_epoch.saturating_add(1);
            let reporter_epoch = creds.next_reporter_epoch;
            validate_safe_integer("reporter_epoch", reporter_epoch)?;

            let mut reg = self.0.registry.write();
            let row = reg.admit_reporter(
                terminal_id.to_string(),
                incarnation,
                reporter_epoch,
                hello,
                now_ms,
            )?;

            reporters.insert(
                key,
                LiveReporterHandle {
                    reporter_id: hello.reporter_id.clone(),
                    reporter_epoch,
                    close_tx: Some(close_tx),
                },
            );

            (reporter_epoch, row)
        };

        let server_epoch = self.server_epoch();
        let revision = self.0.registry.read().revision;
        let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
            AgentStatusChangedPayload {
                server_epoch,
                revision,
                row,
                attention: None,
            },
        ));

        Ok(ReporterAccepted {
            kind: "accepted".to_string(),
            server_epoch,
            reporter_epoch,
            heartbeat_ms: DEFAULT_HEARTBEAT_MS,
            lease_ms: DEFAULT_LEASE_MS,
        })
    }

    /// Apply an incoming report from an admitted reporter.
    pub fn apply_report(
        &self,
        terminal_id: &str,
        incarnation: u64,
        reporter_epoch: u64,
        report: ReporterReport,
    ) -> Result<ReporterAck, AgentStatusError> {
        let seq = report.seq;
        let now_ms = crate::pty::session::now_ms();
        let output = {
            let mut reg = self.0.registry.write();
            reg.apply_report(terminal_id, incarnation, reporter_epoch, report, now_ms)?
        };

        if output.state_changed {
            if let Some(row) = output.row {
                let server_epoch = self.server_epoch();
                let revision = self.0.registry.read().revision;
                let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
                    AgentStatusChangedPayload {
                        server_epoch,
                        revision,
                        row,
                        attention: output.attention,
                    },
                ));
            }
        }

        Ok(ReporterAck::new(seq))
    }

    /// Mark terminal as unknown when reporter socket disconnects.
    pub fn mark_unknown_on_disconnect(
        &self,
        terminal_id: &str,
        incarnation: u64,
        reporter_epoch: u64,
    ) {
        let key = (terminal_id.to_string(), incarnation);
        {
            let mut reporters = self.0.reporters.lock();
            if let Some(handle) = reporters.get(&key) {
                if handle.reporter_epoch == reporter_epoch {
                    reporters.remove(&key);
                }
            }
        }

        let res = {
            let mut reg = self.0.registry.write();
            reg.mark_unknown(terminal_id, incarnation, reporter_epoch)
        };

        if let Ok(output) = res {
            if output.state_changed {
                if let Some(row) = output.row {
                    let server_epoch = self.server_epoch();
                    let revision = self.0.registry.read().revision;
                    let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
                        AgentStatusChangedPayload {
                            server_epoch,
                            revision,
                            row,
                            attention: output.attention,
                        },
                    ));
                }
            }
        }
    }

    /// Read public snapshot.
    pub fn snapshot(&self) -> AgentStatusSnapshotV1 {
        self.0.registry.read().snapshot()
    }

    /// Subscribe to semantic agent status broadcast events.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentStatusBroadcastEvent> {
        self.0.event_tx.subscribe()
    }

    /// Send a broadcast event directly.
    pub fn broadcast_event(&self, event: AgentStatusBroadcastEvent) {
        let _ = self.0.event_tx.send(event);
    }

    /// Check lease expirations and broadcast changes for expired terminals using defaults.
    pub fn check_leases(&self) -> Result<usize, AgentStatusError> {
        let now_ms = crate::pty::session::now_ms();
        self.check_leases_with_time(now_ms, DEFAULT_LEASE_MS)
    }

    /// Check lease expirations with explicit time and lease parameters.
    pub fn check_leases_with_time(
        &self,
        now_ms: u64,
        lease_ms: u64,
    ) -> Result<usize, AgentStatusError> {
        let (outputs, revision) = {
            let mut reg = self.0.registry.write();
            let outputs = reg.check_leases(now_ms, lease_ms)?;
            let revision = reg.revision;
            (outputs, revision)
        };

        let mut changed_count = 0;
        let server_epoch = self.server_epoch();

        for output in outputs {
            if output.state_changed {
                changed_count += 1;
                if let Some(row) = output.row {
                    // Prune hung reporter connection and signal close on lease expiration
                    {
                        let mut reporters = self.0.reporters.lock();
                        let key = (row.id.clone(), row.incarnation);
                        if let Some(mut handle) = reporters.remove(&key) {
                            if let Some(tx) = handle.close_tx.take() {
                                let _ = tx.send(());
                            }
                        }
                    }
                    let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
                        AgentStatusChangedPayload {
                            server_epoch,
                            revision,
                            row,
                            attention: output.attention,
                        },
                    ));
                }
            }
        }

        Ok(changed_count)
    }

    /// Start background lease checking task.
    pub fn start_lease_task(&self, interval: std::time::Duration) {
        let runtime = self.clone();
        let handle = tokio::spawn(async move {
            let mut timer = tokio::time::interval(interval);
            timer.tick().await; // skip immediate first tick
            loop {
                timer.tick().await;
                if let Err(e) = runtime.check_leases() {
                    tracing::warn!(error = %e, "Agent status lease check error");
                }
            }
        });
        *self.0.lease_abort_handle.lock() = Some(handle.abort_handle());
    }

    /// Stop background tasks and close all active connections.
    pub fn shutdown(&self) {
        if let Some(handle) = self.0.lease_abort_handle.lock().take() {
            handle.abort();
        }

        // Close all live reporters
        let mut reporters = self.0.reporters.lock();
        for (_, mut handle) in reporters.drain() {
            if let Some(tx) = handle.close_tx.take() {
                let _ = tx.send(());
            }
        }

        *self.0.availability.write() = AgentStatusAvailability::Unavailable;
        let _ = self.0.registry.write().set_availability(AgentStatusAvailability::Unavailable);
    }
}
