use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use rand::{Rng, RngCore};
use subtle::ConstantTimeEq;

use super::hook_ingress::TokenRateLimiter;
use super::reducer::AgentStatusRegistry;
use super::types::{
    AgentObservationSource, AgentStatusAvailability, AgentStatusBroadcastEvent,
    AgentStatusChangedPayload, AgentStatusError, AgentStatusRemovedPayload, AgentStatusSnapshotV1,
    PrivateHookEnvelope, ReporterAccepted, ReporterAck, ReporterHello, ReporterReport,
    TerminalAgentStatusRow, BROADCAST_CAPACITY, DEFAULT_HEARTBEAT_MS, DEFAULT_LEASE_MS,
};
use crate::pty::activity::ProcessIdentity;
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
    credential_token: String,
    close_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
struct CredentialStore {
    by_token: HashMap<String, ScopedCredential>,
    by_terminal: HashMap<(String, u64), String>,
    current_incarnations: HashMap<String, u64>,
}

impl CredentialStore {
    fn is_active(&self, key: &(String, u64), expected_token: Option<&str>) -> bool {
        if self.current_incarnations.get(&key.0) != Some(&key.1) {
            return false;
        }
        self.by_terminal
            .get(key)
            .filter(|token| expected_token.is_none_or(|expected| token.as_str() == expected))
            .and_then(|token| self.by_token.get(token))
            .is_some_and(|credential| credential.state == CredentialState::Active)
    }
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
        self.runtime
            .activate_credential(&self.terminal_id, self.incarnation);
        self.activated = true;
    }

    /// Explicitly revoke credential without waiting for drop.
    pub fn revoke(mut self) {
        self.runtime
            .revoke_credential(&self.terminal_id, self.incarnation);
        self.activated = true; // prevent double-revocation in drop
    }
}

impl Drop for CredentialReservation {
    fn drop(&mut self) {
        if !self.activated {
            self.runtime
                .revoke_credential(&self.terminal_id, self.incarnation);
        }
    }
}

struct Inner {
    server_epoch: u64,
    availability: RwLock<AgentStatusAvailability>,
    listener_url: RwLock<Option<String>>,
    hook_socket_path: RwLock<Option<std::path::PathBuf>>,
    registry: Arc<RwLock<AgentStatusRegistry>>,
    credentials: Mutex<CredentialStore>,
    reporters: Mutex<HashMap<(String, u64), LiveReporterHandle>>,
    event_tx: tokio::sync::broadcast::Sender<AgentStatusBroadcastEvent>,
    lease_abort_handle: Mutex<Option<tokio::task::AbortHandle>>,
    registered_roots: Mutex<HashMap<(String, u64), ProcessIdentity>>,
    hook_rate_limiters: Mutex<HashMap<(String, u64), TokenRateLimiter>>,
}

/// Shared runtime managing agent status credentials, loopback admission, and semantic broadcast.
#[derive(Clone)]
pub struct AgentStatusRuntime(Arc<Inner>);

#[cfg(target_os = "linux")]
fn check_process_exited(root: ProcessIdentity) -> bool {
    match crate::pty::activity::read_process_stat(std::path::Path::new("/proc"), root.pid) {
        Ok(stat) => stat.start_ticks != root.start_ticks,
        Err(_) => true,
    }
}

#[cfg(not(target_os = "linux"))]
fn check_process_exited(_root: ProcessIdentity) -> bool {
    false
}

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
            hook_socket_path: RwLock::new(None),
            registry,
            credentials: Mutex::new(CredentialStore::default()),
            reporters: Mutex::new(HashMap::new()),
            event_tx,
            lease_abort_handle: Mutex::new(None),
            registered_roots: Mutex::new(HashMap::new()),
            hook_rate_limiters: Mutex::new(HashMap::new()),
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

    /// Update the Unix domain socket path for native hook ingress.
    pub fn set_hook_socket_path(&self, path: Option<std::path::PathBuf>) {
        *self.0.hook_socket_path.write() = path;
    }

    /// Retrieve the Unix domain socket path for native hook ingress if bound.
    pub fn hook_socket_path(&self) -> Option<std::path::PathBuf> {
        self.0.hook_socket_path.read().clone()
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
            if creds
                .current_incarnations
                .get(terminal_id)
                .is_some_and(|current| {
                    *current > incarnation
                        || (*current == incarnation && !creds.by_terminal.contains_key(&key))
                })
            {
                return None;
            }
            creds
                .current_incarnations
                .insert(terminal_id.to_string(), incarnation);
            if let Some(old_token) = creds.by_terminal.insert(key, token.clone()) {
                creds.by_token.remove(&old_token);
            }
            creds.by_token.insert(token.clone(), cred);
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
        // All capability revocations serialize with admission and report commits.
        let mut reporters = self.0.reporters.lock();
        let mut creds = self.0.credentials.lock();
        if let Some(token) = creds.by_terminal.remove(&key) {
            creds.by_token.remove(&token);
        }
        if let Some(mut handle) = reporters.remove(&key) {
            if let Some(tx) = handle.close_tx.take() {
                let _ = tx.send(());
            }
        }
        self.clear_terminal_root(terminal_id, incarnation);
        self.0.hook_rate_limiters.lock().remove(&key);
        let changed = {
            let mut reg = self.0.registry.write();
            reg.get_row(terminal_id, incarnation).and_then(|row| {
                reg.mark_unknown(terminal_id, incarnation, row.reporter_epoch)
                    .ok()
                    .map(|output| (output, reg.revision))
            })
        };
        drop(creds);
        drop(reporters);
        if let Some((output, revision)) = changed {
            if output.state_changed {
                if let Some(row) = output.row {
                    let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
                        AgentStatusChangedPayload {
                            server_epoch: self.server_epoch(),
                            revision,
                            row,
                            attention: None,
                        },
                    ));
                }
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
            let _ = self
                .0
                .event_tx
                .send(AgentStatusBroadcastEvent::Removed(p.clone()));
        }
        Ok(payload)
    }
    /// Register the child process identity rooted at a PTY spawn for a terminal incarnation.
    pub fn register_terminal_root(
        &self,
        terminal_id: &str,
        incarnation: u64,
        root: ProcessIdentity,
    ) {
        let mut roots = self.0.registered_roots.lock();
        roots.insert((terminal_id.to_string(), incarnation), root);
    }

    /// Retrieve the registered root process identity for a terminal incarnation.
    pub fn get_terminal_root(
        &self,
        terminal_id: &str,
        incarnation: u64,
    ) -> Option<ProcessIdentity> {
        let roots = self.0.registered_roots.lock();
        roots.get(&(terminal_id.to_string(), incarnation)).copied()
    }

    /// Clear the registered root process identity for a terminal incarnation.
    pub fn clear_terminal_root(&self, terminal_id: &str, incarnation: u64) {
        let mut roots = self.0.registered_roots.lock();
        roots.remove(&(terminal_id.to_string(), incarnation));
    }

    /// Check and consume rate limit for native command hook requests on a terminal incarnation.
    pub fn check_hook_rate_limit(&self, terminal_id: &str, incarnation: u64) -> bool {
        let mut limiters = self.0.hook_rate_limiters.lock();
        let limiter = limiters
            .entry((terminal_id.to_string(), incarnation))
            .or_default();
        limiter.check_and_consume()
    }

    /// Check if a live, persistent OMP reporter is currently connected to a terminal.
    pub fn has_live_omp_reporter(&self, terminal_id: &str, incarnation: u64) -> bool {
        let reporters = self.0.reporters.lock();
        reporters.contains_key(&(terminal_id.to_string(), incarnation))
    }

    /// Apply an authenticated native hook event to the status runtime.
    ///
    /// Native hooks are expiring observations and cannot evict a live OMP reporter.
    pub fn apply_hook_event(
        &self,
        terminal_id: &str,
        incarnation: u64,
        envelope: &PrivateHookEnvelope,
        now_ms: u64,
    ) -> Result<Option<TerminalAgentStatusRow>, AgentStatusError> {
        // Capture process identity and generation together. Off-lock exit proof
        // must never authorize replacement of a different owner at commit.
        let prior_owner = self
            .0
            .registry
            .read()
            .get_native_owner(terminal_id, incarnation);
        let exited_owner = if let Some(prior) = prior_owner {
            if prior.root != envelope.root_process {
                if !check_process_exited(prior.root) {
                    return Err(AgentStatusError::AuthorityLost(
                        "prior native root is still running".to_string(),
                    ));
                }
                Some(prior)
            } else {
                None
            }
        } else {
            None
        };

        // 2. Consistent commit lock order: reporters -> credentials -> registered_roots -> registry
        let key = (terminal_id.to_string(), incarnation);
        let reporters = self.0.reporters.lock();
        if reporters.contains_key(&key) {
            return Err(AgentStatusError::AuthorityLost(
                "terminal is occupied by live OMP reporter".to_string(),
            ));
        }
        let credentials = self.0.credentials.lock();
        if !credentials.is_active(&key, None) {
            return Err(AgentStatusError::CapabilityRevoked);
        }

        // Revalidate registered PTY root at commit
        let roots = self.0.registered_roots.lock();
        let Some(registered_root) = roots.get(&key).copied() else {
            return Err(AgentStatusError::CapabilityRevoked);
        };
        if !envelope
            .process_ancestry
            .iter()
            .any(|p| *p == registered_root)
        {
            return Err(AgentStatusError::UnverifiableProcessAncestry(
                "registered PTY root mismatch at commit".to_string(),
            ));
        }

        let (output, revision) = {
            let mut reg = self.0.registry.write();
            let output = reg.apply_hook_with_prior_exited(
                terminal_id,
                incarnation,
                envelope,
                now_ms,
                exited_owner,
            )?;
            (output, reg.revision)
        };
        drop(roots);
        drop(credentials);
        drop(reporters);

        if let Some(row) = &output.row {
            if output.state_changed || output.attention.is_some() {
                let _ = self.0.event_tx.send(AgentStatusBroadcastEvent::Changed(
                    AgentStatusChangedPayload {
                        server_epoch: self.server_epoch(),
                        revision,
                        row: row.clone(),
                        attention: output.attention,
                    },
                ));
            }
        }

        Ok(output.row)
    }

    /// Authenticate a bearer token presented on WebSocket handshake.
    pub fn authenticate_bearer(&self, token: &str) -> TokenAuthResult {
        let creds = self.0.credentials.lock();
        if let Some(cred) = creds.by_token.get(token) {
            let is_match: bool = token.as_bytes().ct_eq(cred.token.as_bytes()).into();
            let key = (cred.terminal_id.clone(), cred.incarnation);
            if is_match
                && creds
                    .by_terminal
                    .get(&key)
                    .is_some_and(|current| current == token)
                && creds.current_incarnations.get(&cred.terminal_id) == Some(&cred.incarnation)
            {
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
        expected_token: &str,
        hello: &ReporterHello,
        close_tx: tokio::sync::oneshot::Sender<()>,
    ) -> Result<ReporterAccepted, AgentStatusError> {
        let now_ms = crate::pty::session::now_ms();
        let (reporter_epoch, row, revision) = {
            let mut reporters = self.0.reporters.lock();
            let key = (terminal_id.to_string(), incarnation);
            let creds = self.0.credentials.lock();
            if !creds.is_active(&key, Some(expected_token)) {
                return Err(AgentStatusError::CapabilityRevoked);
            }
            if let Some(existing) = reporters.get(&key) {
                if existing.reporter_id != hello.reporter_id {
                    return Err(AgentStatusError::ReporterOccupied {
                        active: existing.reporter_id.clone(),
                    });
                }
            }

            let mut reg = self.0.registry.write();
            let row = reg.admit_reporter(terminal_id.to_string(), incarnation, hello, now_ms)?;
            let reporter_epoch = row.reporter_epoch;
            if let Some(existing) = reporters.get_mut(&key) {
                if let Some(tx) = existing.close_tx.take() {
                    let _ = tx.send(());
                }
            }

            reporters.insert(
                key,
                LiveReporterHandle {
                    reporter_id: hello.reporter_id.clone(),
                    reporter_epoch,
                    credential_token: expected_token.to_string(),
                    close_tx: Some(close_tx),
                },
            );

            (reporter_epoch, row, reg.revision)
        };

        let server_epoch = self.server_epoch();
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
        let (output, revision) = {
            // Lease expiry, disconnect, revocation and report application share
            // this lock order. A queued frame cannot outlive its socket lease.
            let reporters = self.0.reporters.lock();
            let key = (terminal_id.to_string(), incarnation);
            let Some(handle) = reporters.get(&key) else {
                return Err(AgentStatusError::AuthorityLost(
                    "reporter connection is no longer active".to_string(),
                ));
            };
            if handle.reporter_epoch != reporter_epoch {
                return Err(AgentStatusError::StaleReporterEpoch {
                    current: handle.reporter_epoch,
                    got: reporter_epoch,
                });
            }
            let credentials = self.0.credentials.lock();
            if !credentials.is_active(&key, Some(&handle.credential_token)) {
                return Err(AgentStatusError::CapabilityRevoked);
            }
            let mut reg = self.0.registry.write();
            let output =
                reg.apply_report(terminal_id, incarnation, reporter_epoch, report, now_ms)?;
            (output, reg.revision)
        };

        if output.state_changed {
            if let Some(row) = output.row {
                let server_epoch = self.server_epoch();
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
        let (res, revision) = {
            let mut reporters = self.0.reporters.lock();
            if let Some(handle) = reporters.get(&key) {
                if handle.reporter_epoch == reporter_epoch {
                    reporters.remove(&key);
                }
            }
            let mut reg = self.0.registry.write();
            let res = reg.mark_unknown(terminal_id, incarnation, reporter_epoch);
            (res, reg.revision)
        };

        if let Ok(output) = res {
            if output.state_changed {
                if let Some(row) = output.row {
                    let server_epoch = self.server_epoch();
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
        // Consistent lock order: reporters before registry
        let mut reporters = self.0.reporters.lock();
        let (outputs, revision) = {
            let mut reg = self.0.registry.write();
            let outputs = reg.check_leases(now_ms, lease_ms)?;
            let revision = reg.revision;
            (outputs, revision)
        };

        let mut changed_count = 0;
        let server_epoch = self.server_epoch();
        let mut events_to_send = Vec::new();

        for output in outputs {
            if output.state_changed {
                changed_count += 1;
                if let Some(row) = output.row {
                    // Reporter epoch and source fence: prune hung reporter connection
                    // ONLY if row origin is Lifecycle and epoch matches active handle.
                    // Hook observations have no live reporter handle and cannot prune OMP.
                    if row.source == AgentObservationSource::Lifecycle {
                        let key = (row.id.clone(), row.incarnation);
                        if let Some(handle) = reporters.get(&key) {
                            if handle.reporter_epoch == row.reporter_epoch {
                                if let Some(mut handle) = reporters.remove(&key) {
                                    if let Some(tx) = handle.close_tx.take() {
                                        let _ = tx.send(());
                                    }
                                }
                            }
                        }
                    }
                    events_to_send.push(AgentStatusChangedPayload {
                        server_epoch,
                        revision,
                        row,
                        attention: output.attention,
                    });
                }
            }
        }

        drop(reporters);

        for payload in events_to_send {
            let _ = self
                .0
                .event_tx
                .send(AgentStatusBroadcastEvent::Changed(payload));
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

        *self.0.hook_socket_path.write() = None;
        *self.0.availability.write() = AgentStatusAvailability::Unavailable;
        let _ = self
            .0
            .registry
            .write()
            .set_availability(AgentStatusAvailability::Unavailable);
    }
}
