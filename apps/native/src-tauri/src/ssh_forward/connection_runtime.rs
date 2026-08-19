//! Memory-only ownership for established SSH connections and port children.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering},
        Arc,
    },
};

use tokio::{
    sync::{oneshot, Mutex, Notify},
    task::JoinHandle,
};

use super::{
    credential_lease::CredentialLease,
    error::SshForwardErrorCode,
    known_hosts::OfferedHostKey,
    model::{
        SshConnectionRuntime, SshConnectionState, SshForwardRuleRuntime, SshForwardRuleState,
        SshForwardRuntime, SshForwardState, UtcTimestamp, WireCounter,
    },
    profile::{LoopbackHost, ReconnectPolicy, SshConnectionProfile, SshForwardRule},
    ssh_client::{ChannelLimiter, SshSession},
};

pub(crate) const MAX_LIVE_CONNECTIONS: usize = 16;
pub(crate) const MAX_ENABLED_RULES: usize = 64;

pub(crate) fn runtime_task_key(
    connection_id: &str,
    rule_id: &str,
    generation: WireCounter,
    cancellation: &ConnectionCancellation,
) -> String {
    format!("{connection_id}:{rule_id}:{generation}:{:p}", cancellation)
}

pub(crate) struct ConnectionCancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl ConnectionCancellation {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.cancelled.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

/// Shared session indirection used by child listeners while a parent
/// connection is temporarily reconnecting. Children never retain a stale
/// session after the parent has replaced the transport.
pub(crate) struct SessionSlot {
    session: std::sync::Mutex<Option<Arc<SshSession>>>,
    changed: Notify,
    version: AtomicU64,
}

impl SessionSlot {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            session: std::sync::Mutex::new(None),
            changed: Notify::new(),
            version: AtomicU64::new(0),
        })
    }

    pub(crate) fn current(&self) -> Option<Arc<SshSession>> {
        self.session
            .lock()
            .expect("session slot mutex poisoned")
            .clone()
    }

    pub(crate) fn replace(&self, session: Option<Arc<SshSession>>) {
        {
            *self.session.lock().expect("session slot mutex poisoned") = session;
        }
        self.mark_changed();
    }

    pub(crate) fn notify_changed(&self) {
        self.mark_changed();
    }

    pub(crate) fn clear_if_matches(&self, expected: &Arc<SshSession>) -> bool {
        let cleared = {
            let mut current = self.session.lock().expect("session slot mutex poisoned");
            let matches = current
                .as_ref()
                .is_some_and(|session| Arc::ptr_eq(session, expected));
            if matches {
                *current = None;
            }
            matches
        };
        if cleared {
            self.mark_changed();
        }
        cleared
    }

    pub(crate) fn version(&self) -> u64 {
        self.version.load(Ordering::Acquire)
    }

    pub(crate) async fn wait_for_change(&self, observed: u64) {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.version() != observed {
                return;
            }
            notified.await;
        }
    }

    fn mark_changed(&self) {
        self.version.fetch_add(1, Ordering::AcqRel);
        self.changed.notify_waiters();
    }
}

fn next_counter(value: WireCounter) -> Result<WireCounter, RuntimeError> {
    match value.increment() {
        Ok(next) => Ok(next),
        Err(_) => Err(RuntimeError::CounterExhausted),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeError {
    InvalidArgument,
    CounterExhausted,
    ConnectionNotFound,
    ConnectionLimit,
    ConnectionNotEstablished,
    ConnectionCancelled,
    HostKeyIdentityMissing,
    StaleConnectionGeneration(WireCounter),
    RuleLimit,
    StaleRuleGeneration(WireCounter),
    PortConflict,
}

impl RuntimeError {
    pub(crate) fn code(self) -> SshForwardErrorCode {
        match self {
            Self::InvalidArgument => SshForwardErrorCode::InvalidArgument,
            Self::CounterExhausted => SshForwardErrorCode::CounterExhausted,
            Self::ConnectionNotFound => SshForwardErrorCode::ConnectionRequired,
            Self::ConnectionLimit => SshForwardErrorCode::ConnectionLimit,
            Self::ConnectionNotEstablished => SshForwardErrorCode::ConnectionNotEstablished,
            Self::ConnectionCancelled => SshForwardErrorCode::ActivationSuperseded,
            Self::HostKeyIdentityMissing => SshForwardErrorCode::Internal,
            Self::StaleConnectionGeneration(_) => SshForwardErrorCode::StaleConnectionGeneration,
            Self::RuleLimit => SshForwardErrorCode::RuleLimit,
            Self::StaleRuleGeneration(_) => SshForwardErrorCode::StaleRuleGeneration,
            Self::PortConflict => SshForwardErrorCode::PortConflict,
        }
    }
}

pub(crate) struct ForwardChild {
    pub(crate) rule: SshForwardRule,
    pub(crate) generation: WireCounter,
    pub(crate) state: SshForwardRuleState,
    pub(crate) active_channels: Arc<AtomicU16>,
    state_changed: Arc<Notify>,
    pub(crate) state_changed_at: UtcTimestamp,
    pub(crate) started_at: Option<UtcTimestamp>,
    pub(crate) error_code: Option<SshForwardErrorCode>,
    pub(crate) task_key: Option<String>,
    pub(crate) stop_tx: Option<oneshot::Sender<std::time::Instant>>,
    pub(crate) worker: Option<JoinHandle<()>>,
}

impl ForwardChild {
    fn new(rule: SshForwardRule, generation: WireCounter) -> Self {
        Self {
            rule,
            generation,
            state: SshForwardRuleState::Opening,
            active_channels: Arc::new(AtomicU16::new(0)),
            state_changed: Arc::new(Notify::new()),
            state_changed_at: UtcTimestamp::now(),
            started_at: None,
            error_code: None,
            task_key: None,
            stop_tx: None,
            worker: None,
        }
    }

    fn snapshot(&self, connection_generation: WireCounter) -> SshForwardRuleRuntime {
        SshForwardRuleRuntime {
            rule_id: self.rule.id.clone(),
            connection_profile_id: self.rule.connection_profile_id.clone(),
            connection_generation,
            generation: self.generation,
            state: self.state,
            bind_host: LoopbackHost,
            local_port: self.rule.local_port,
            active_channels: self.active_channels.load(Ordering::Acquire),
            state_changed_at: self.state_changed_at,
            started_at: self.started_at,
            error_code: self.error_code,
        }
    }
}

pub(crate) struct ConnectionEntry {
    pub(crate) profile: SshConnectionProfile,
    pub(crate) generation: WireCounter,
    pub(crate) state: SshConnectionState,
    pub(crate) retry_attempt: u8,
    pub(crate) state_changed_at: UtcTimestamp,
    pub(crate) started_at: Option<UtcTimestamp>,
    pub(crate) error_code: Option<SshForwardErrorCode>,
    pub(crate) session: Option<Arc<SshSession>>,
    pub(crate) session_slot: Arc<SessionSlot>,
    pub(crate) reconnect_owner: Option<String>,
    pub(crate) credential_lease: Option<Arc<CredentialLease>>,
    pub(crate) accepted_host_key: Option<OfferedHostKey>,
    pub(crate) channel_limiter: ChannelLimiter,
    pub(crate) children: HashMap<String, ForwardChild>,
    pub(crate) lifecycle: Arc<Mutex<()>>,
    pub(crate) cancellation: Arc<ConnectionCancellation>,
}

impl ConnectionEntry {
    fn new(profile: SshConnectionProfile, generation: WireCounter) -> Self {
        Self {
            profile,
            generation,
            state: SshConnectionState::Authenticating,
            retry_attempt: 0,
            state_changed_at: UtcTimestamp::now(),
            started_at: None,
            error_code: None,
            session: None,
            session_slot: SessionSlot::new(),
            reconnect_owner: None,
            credential_lease: None,
            accepted_host_key: None,
            channel_limiter: ChannelLimiter::default(),
            children: HashMap::new(),
            lifecycle: Arc::new(Mutex::new(())),
            cancellation: ConnectionCancellation::new(),
        }
    }

    fn active_channels(&self) -> u16 {
        self.children
            .values()
            .map(|child| child.active_channels.load(Ordering::Acquire))
            .fold(0, u16::saturating_add)
    }

    fn snapshot(&self) -> SshConnectionRuntime {
        SshConnectionRuntime {
            connection_profile_id: self.profile.id.clone(),
            generation: self.generation,
            state: self.state,
            retry_attempt: self.retry_attempt,
            active_channels: self.active_channels(),
            state_changed_at: self.state_changed_at,
            started_at: self.started_at,
            error_code: self.error_code,
        }
    }
}

pub(crate) enum ConnectionAdmission {
    Reserved(ConnectionReservation),
    AlreadyCurrent(WireCounter),
}

pub(crate) struct ConnectionReservation {
    pub(crate) generation: WireCounter,
    pub(crate) cancellation: Arc<ConnectionCancellation>,
}

pub(crate) enum RuleAdmission {
    Reserved(RuleReservation),
    AlreadyCurrent,
    InProgress(Arc<Notify>),
    ReplaceRequired(WireCounter),
}

pub(crate) struct RuleReservation {
    pub(crate) rule: SshForwardRule,
    pub(crate) connection_generation: WireCounter,
    pub(crate) generation: WireCounter,
    pub(crate) cancellation: Arc<ConnectionCancellation>,
    pub(crate) session_slot: Arc<SessionSlot>,
    pub(crate) limiter: ChannelLimiter,
    pub(crate) active_channels: Arc<AtomicU16>,
}

pub(crate) struct ConnectionReconnectContext {
    pub(crate) profile: SshConnectionProfile,
    pub(crate) generation: WireCounter,
    pub(crate) session: Option<Arc<SshSession>>,
    pub(crate) credential_lease: Option<Arc<CredentialLease>>,
    pub(crate) session_slot: Arc<SessionSlot>,
    pub(crate) cancellation: Arc<ConnectionCancellation>,
    pub(crate) policy: ReconnectPolicy,
}

pub(crate) struct ChildShutdown {
    pub(crate) task_key: Option<String>,
    pub(crate) stop_tx: Option<oneshot::Sender<std::time::Instant>>,
    pub(crate) worker: Option<JoinHandle<()>>,
}

pub(crate) struct DisconnectPlan {
    pub(crate) generation: WireCounter,
    pub(crate) children: Vec<ChildShutdown>,
    pub(crate) session: Option<Arc<SshSession>>,
}

pub(crate) struct RuleDisablePlan {
    pub(crate) generation: WireCounter,
    pub(crate) child: ChildShutdown,
}

pub(crate) struct ConnectionRegistry {
    entries: HashMap<String, ConnectionEntry>,
}

impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub(crate) fn reserve_connection(
        &mut self,
        profile: SshConnectionProfile,
        expected_generation: WireCounter,
    ) -> Result<ConnectionAdmission, RuntimeError> {
        profile
            .validate()
            .map_err(|_| RuntimeError::InvalidArgument)?;
        if let Some(entry) = self.entries.get(&profile.id) {
            if entry.generation != expected_generation {
                return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
            }
            if entry.state == SshConnectionState::Established {
                return Ok(ConnectionAdmission::AlreadyCurrent(entry.generation));
            }
            if entry.state != SshConnectionState::Disconnected {
                return Err(RuntimeError::ConnectionNotEstablished);
            }
        } else if expected_generation != WireCounter::ZERO {
            return Err(RuntimeError::StaleConnectionGeneration(WireCounter::ZERO));
        }
        if self
            .entries
            .values()
            .filter(|entry| !matches!(entry.state, SshConnectionState::Disconnected))
            .count()
            >= MAX_LIVE_CONNECTIONS
        {
            return Err(RuntimeError::ConnectionLimit);
        }
        let generation = next_counter(expected_generation)?;
        self.entries.insert(
            profile.id.clone(),
            ConnectionEntry::new(profile.clone(), generation),
        );
        let cancellation = self
            .entries
            .get(&profile.id)
            .expect("reserved connection was inserted")
            .cancellation
            .clone();
        Ok(ConnectionAdmission::Reserved(ConnectionReservation {
            generation,
            cancellation,
        }))
    }

    pub(crate) fn commit_established(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        session: Arc<SshSession>,
        credential_lease: Option<Arc<CredentialLease>>,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Authenticating {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        if entry.cancellation.is_cancelled() {
            return Err(RuntimeError::ConnectionCancelled);
        }
        let accepted_host_key = session
            .verified_host_key()
            .ok_or(RuntimeError::HostKeyIdentityMissing)?;
        entry.session = Some(Arc::clone(&session));
        entry.session_slot.replace(Some(session));
        entry.credential_lease = credential_lease;
        entry.accepted_host_key = Some(accepted_host_key);
        entry.state = SshConnectionState::Established;
        entry.started_at = Some(UtcTimestamp::now());
        entry.state_changed_at = UtcTimestamp::now();
        entry.error_code = None;
        Ok(())
    }

    pub(crate) fn set_established_error(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        error_code: SshForwardErrorCode,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Established {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        entry.error_code = Some(error_code);
        entry.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn fail_connection(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        error_code: SshForwardErrorCode,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        entry.cancellation.cancel();
        entry.session = None;
        entry.session_slot.replace(None);
        entry.reconnect_owner = None;
        entry.credential_lease = None;
        entry.accepted_host_key = None;
        entry.state = SshConnectionState::Disconnected;
        entry.error_code = Some(error_code);
        entry.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn begin_reconnect(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        owner: &str,
    ) -> Result<Option<ConnectionReconnectContext>, RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        let session = if entry.state == SshConnectionState::Reconnecting {
            if entry.reconnect_owner.is_some() {
                return Ok(None);
            }
            None
        } else if entry.state == SshConnectionState::Established {
            if entry.session_slot.current().is_some() {
                return Ok(None);
            }
            let Some(session) = entry.session.take() else {
                return Ok(None);
            };
            Some(session)
        } else {
            return Ok(None);
        };
        let mut enabled = false;
        let mut max_attempts = 0;
        for child in entry.children.values() {
            if child.state == SshForwardRuleState::On && child.rule.reconnect.enabled {
                enabled = true;
                max_attempts = max_attempts.max(child.rule.reconnect.max_attempts);
            }
        }
        entry.state = SshConnectionState::Reconnecting;
        entry.retry_attempt = 0;
        entry.error_code = None;
        entry.state_changed_at = UtcTimestamp::now();
        entry.reconnect_owner = Some(owner.to_owned());
        entry.session_slot.replace(None);
        Ok(Some(ConnectionReconnectContext {
            profile: entry.profile.clone(),
            generation: entry.generation,
            session,
            credential_lease: entry.credential_lease.clone(),
            session_slot: Arc::clone(&entry.session_slot),
            cancellation: Arc::clone(&entry.cancellation),
            policy: ReconnectPolicy {
                enabled,
                max_attempts,
            },
        }))
    }

    pub(crate) fn set_reconnect_attempt(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        attempt: u8,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Reconnecting {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        entry.retry_attempt = attempt;
        entry.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn finish_reconnect(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        session: Arc<SshSession>,
        credential_lease: Option<Arc<CredentialLease>>,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Reconnecting {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        if entry.cancellation.is_cancelled() {
            return Err(RuntimeError::ConnectionCancelled);
        }
        let accepted_host_key = session
            .verified_host_key()
            .ok_or(RuntimeError::HostKeyIdentityMissing)?;
        entry.accepted_host_key = Some(accepted_host_key);
        entry.session = Some(Arc::clone(&session));
        entry.session_slot.replace(Some(session));
        entry.reconnect_owner = None;
        entry.credential_lease = credential_lease;
        entry.state = SshConnectionState::Established;
        entry.retry_attempt = 0;
        entry.error_code = None;
        entry.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn fail_reconnect(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        error_code: SshForwardErrorCode,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Reconnecting {
            return Ok(());
        }
        entry.cancellation.cancel();
        entry.session = None;
        entry.session_slot.replace(None);
        entry.reconnect_owner = None;
        entry.credential_lease = None;
        entry.accepted_host_key = None;
        entry.state = SshConnectionState::Disconnected;
        entry.error_code = Some(error_code);
        entry.state_changed_at = UtcTimestamp::now();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        for child in entry.children.values_mut() {
            if child.state != SshForwardRuleState::Off {
                if let Some(stop_tx) = child.stop_tx.take() {
                    let _ = stop_tx.send(deadline);
                }
                child.state = SshForwardRuleState::Failed;
                child.error_code = Some(error_code);
                child.state_changed.notify_waiters();
                child.state_changed_at = UtcTimestamp::now();
            }
        }
        Ok(())
    }

    pub(crate) fn abandon_reconnect(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        owner: &str,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation
            || entry.state != SshConnectionState::Reconnecting
            || entry.reconnect_owner.as_deref() != Some(owner)
        {
            return Ok(false);
        }
        entry.reconnect_owner = None;
        entry.state_changed_at = UtcTimestamp::now();
        entry.session_slot.notify_changed();
        Ok(true)
    }

    pub(crate) fn is_reconnect_owner(
        &self,
        connection_id: &str,
        generation: WireCounter,
        owner: &str,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        Ok(entry.state == SshConnectionState::Reconnecting
            && entry.reconnect_owner.as_deref() == Some(owner))
    }

    pub(crate) fn has_reconnectable_rules(
        &self,
        connection_id: &str,
        generation: WireCounter,
        excluded_rule_id: &str,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        Ok(entry.children.iter().any(|(rule_id, child)| {
            rule_id != excluded_rule_id
                && child.state == SshForwardRuleState::On
                && child.rule.reconnect.enabled
        }))
    }

    pub(crate) fn retain_authenticating_session(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        session: Arc<SshSession>,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Authenticating {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        entry.accepted_host_key = session.verified_host_key();
        entry.session = Some(Arc::clone(&session));
        entry.session_slot.replace(Some(session));
        Ok(())
    }

    pub(crate) fn begin_disconnect(
        &mut self,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<Option<DisconnectPlan>, RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != expected_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state == SshConnectionState::Disconnected {
            return Ok(None);
        }
        let generation = next_counter(entry.generation)?;
        let child_generations = entry
            .children
            .iter()
            .map(|(rule_id, child)| {
                next_counter(child.generation).map(|generation| (rule_id.clone(), generation))
            })
            .collect::<Result<Vec<_>, _>>()?;
        entry.cancellation.cancel();
        let mut children = Vec::with_capacity(entry.children.len());
        for (rule_id, child_generation) in child_generations {
            let child = entry
                .children
                .get_mut(&rule_id)
                .expect("child generation preflight preserved the child");
            child.generation = child_generation;
            child.state = SshForwardRuleState::Closing;
            child.state_changed.notify_waiters();
            children.push(ChildShutdown {
                task_key: child.task_key.take(),
                stop_tx: child.stop_tx.take(),
                worker: child.worker.take(),
            });
        }
        entry.state = SshConnectionState::Disconnecting;
        entry.generation = generation;
        entry.credential_lease.take();
        entry.reconnect_owner = None;
        entry.session_slot.replace(None);
        entry.state_changed_at = UtcTimestamp::now();
        Ok(Some(DisconnectPlan {
            generation,
            children,
            session: entry.session.take(),
        }))
    }

    pub(crate) fn begin_disconnect_if_matches(
        &mut self,
        connection_id: &str,
        expected_generation: WireCounter,
        cancellation: &Arc<ConnectionCancellation>,
    ) -> Result<Option<DisconnectPlan>, RuntimeError> {
        let Some(entry) = self.entries.get(connection_id) else {
            return Ok(None);
        };
        if entry.generation != expected_generation
            || !Arc::ptr_eq(&entry.cancellation, cancellation)
        {
            return Ok(None);
        }
        self.begin_disconnect(connection_id, expected_generation)
    }

    pub(crate) fn finish_disconnect(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        for child in entry.children.values_mut() {
            child.state = SshForwardRuleState::Off;
            child.state_changed.notify_waiters();
            child.task_key = None;
            child.state_changed_at = UtcTimestamp::now();
        }
        entry.state = SshConnectionState::Disconnected;
        entry.session = None;
        entry.session_slot.replace(None);
        entry.credential_lease = None;
        entry.accepted_host_key = None;
        entry.error_code = None;
        entry.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn retain_disconnect_session(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        session: Arc<SshSession>,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Disconnecting {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        entry.session = Some(Arc::clone(&session));
        entry.session_slot.replace(Some(session));
        Ok(())
    }

    pub(crate) fn discard_connection(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        self.entries.remove(connection_id);
        Ok(())
    }

    pub(crate) fn remove_if_disconnected(
        &mut self,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        self.ensure_disconnected(connection_id, expected_generation)?;
        self.entries.remove(connection_id);
        Ok(())
    }

    pub(crate) fn ensure_disconnected(
        &self,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let Some(entry) = self.entries.get(connection_id) else {
            return Ok(());
        };
        if entry.generation != expected_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Disconnected {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        Ok(())
    }

    pub(crate) fn discard_connection_if_matches(
        &mut self,
        connection_id: &str,
        generation: WireCounter,
        cancellation: &Arc<ConnectionCancellation>,
    ) -> Result<(), RuntimeError> {
        let Some(entry) = self.entries.get(connection_id) else {
            return Ok(());
        };
        if entry.generation != generation {
            return Ok(());
        }
        if !Arc::ptr_eq(&entry.cancellation, cancellation) {
            return Ok(());
        }
        self.entries.remove(connection_id);
        Ok(())
    }

    pub(crate) fn reserve_rule(
        &mut self,
        rule: SshForwardRule,
        connection_generation: WireCounter,
        expected_rule_generation: WireCounter,
    ) -> Result<RuleAdmission, RuntimeError> {
        rule.validate().map_err(|_| RuntimeError::InvalidArgument)?;
        let (
            scope_matches,
            current_generation,
            current_state,
            current_child_generation,
            current_child_state,
            current_child_rule,
            current_child_state_changed,
        ) = {
            let entry = self
                .entries
                .get(&rule.connection_profile_id)
                .ok_or(RuntimeError::ConnectionNotFound)?;
            let child = entry.children.get(&rule.id);
            (
                entry.profile.scope_id == rule.scope_id,
                entry.generation,
                entry.state,
                child.map(|value| value.generation),
                child.map(|value| value.state),
                child.map(|value| value.rule.clone()),
                child.map(|value| Arc::clone(&value.state_changed)),
            )
        };
        if !scope_matches {
            return Err(RuntimeError::InvalidArgument);
        }
        if current_generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(current_generation));
        }
        if self
            .entries
            .get(&rule.connection_profile_id)
            .is_some_and(|entry| entry.cancellation.is_cancelled())
        {
            return Err(RuntimeError::ConnectionCancelled);
        }
        if current_state != SshConnectionState::Established
            || self
                .entries
                .get(&rule.connection_profile_id)
                .and_then(|entry| entry.session.as_ref())
                .is_none()
        {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        if let Some(current_generation) = current_child_generation {
            if current_generation != expected_rule_generation {
                return Err(RuntimeError::StaleRuleGeneration(current_generation));
            }
            if matches!(
                current_child_state.expect("child generation implies state"),
                SshForwardRuleState::Opening
                    | SshForwardRuleState::On
                    | SshForwardRuleState::Closing
            ) {
                if current_child_rule
                    .as_ref()
                    .is_some_and(|current_rule| current_rule != &rule)
                {
                    return Ok(RuleAdmission::ReplaceRequired(
                        current_child_generation.expect("child state implies generation"),
                    ));
                }
                return match current_child_state {
                    Some(SshForwardRuleState::On) => Ok(RuleAdmission::AlreadyCurrent),
                    Some(SshForwardRuleState::Opening | SshForwardRuleState::Closing) => {
                        Ok(RuleAdmission::InProgress(
                            current_child_state_changed.expect("child state implies notification"),
                        ))
                    }
                    _ => Err(RuntimeError::StaleRuleGeneration(
                        current_child_generation.expect("child state implies generation"),
                    )),
                };
            }
        } else if expected_rule_generation != WireCounter::ZERO {
            return Err(RuntimeError::StaleRuleGeneration(WireCounter::ZERO));
        }
        if self.active_rule_count() >= MAX_ENABLED_RULES {
            return Err(RuntimeError::RuleLimit);
        }
        if self.port_conflict(rule.local_port, &rule.id) {
            return Err(RuntimeError::PortConflict);
        }
        let generation = next_counter(expected_rule_generation)?;
        let active_channels = Arc::new(AtomicU16::new(0));
        let entry = self
            .entries
            .get_mut(&rule.connection_profile_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        entry.children.insert(
            rule.id.clone(),
            ForwardChild {
                active_channels: Arc::clone(&active_channels),
                ..ForwardChild::new(rule.clone(), generation)
            },
        );
        Ok(RuleAdmission::Reserved(RuleReservation {
            rule,
            connection_generation,
            generation,
            cancellation: Arc::clone(&entry.cancellation),
            session_slot: Arc::clone(&entry.session_slot),
            limiter: entry.channel_limiter.clone(),
            active_channels,
        }))
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Commit arguments are the generation-checked listener ownership tuple."
    )]
    pub(crate) fn commit_rule(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        generation: WireCounter,
        stop_tx: oneshot::Sender<std::time::Instant>,
        start_tx: oneshot::Sender<()>,
        worker: JoinHandle<()>,
    ) -> Result<(), (RuntimeError, JoinHandle<()>)> {
        let Some(entry) = self.entries.get_mut(connection_id) else {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::ConnectionNotFound, worker));
        };
        if entry.generation != connection_generation {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((
                RuntimeError::StaleConnectionGeneration(entry.generation),
                worker,
            ));
        }
        if entry.cancellation.is_cancelled() {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::ConnectionCancelled, worker));
        }
        if entry.state != SshConnectionState::Established || entry.session.is_none() {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::ConnectionNotEstablished, worker));
        }
        let Some(child) = entry.children.get_mut(rule_id) else {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::StaleRuleGeneration(WireCounter::ZERO), worker));
        };
        if child.generation != generation {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::StaleRuleGeneration(child.generation), worker));
        }
        if child.state != SshForwardRuleState::Opening {
            worker.abort();
            drop(stop_tx);
            drop(start_tx);
            return Err((RuntimeError::StaleRuleGeneration(child.generation), worker));
        }
        child.stop_tx = Some(stop_tx);
        child.worker = Some(worker);
        child.task_key = Some(runtime_task_key(
            connection_id,
            rule_id,
            generation,
            entry.cancellation.as_ref(),
        ));
        child.state = SshForwardRuleState::On;
        child.state_changed.notify_waiters();
        child.started_at = Some(UtcTimestamp::now());
        child.state_changed_at = UtcTimestamp::now();
        child.error_code = None;
        let _ = start_tx.send(());
        Ok(())
    }

    pub(crate) fn fail_rule(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        generation: WireCounter,
        error_code: SshForwardErrorCode,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        let child = entry
            .children
            .get_mut(rule_id)
            .ok_or(RuntimeError::StaleRuleGeneration(WireCounter::ZERO))?;
        if child.generation != generation {
            return Err(RuntimeError::StaleRuleGeneration(child.generation));
        }
        child.state = SshForwardRuleState::Failed;
        child.state_changed.notify_waiters();
        child.error_code = Some(error_code);
        child.task_key = None;
        child.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn begin_disable_rule(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        expected_rule_generation: WireCounter,
    ) -> Result<Option<RuleDisablePlan>, RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        let Some(child) = entry.children.get_mut(rule_id) else {
            if expected_rule_generation == WireCounter::ZERO {
                return Ok(None);
            }
            return Err(RuntimeError::StaleRuleGeneration(WireCounter::ZERO));
        };
        if child.generation != expected_rule_generation {
            return Err(RuntimeError::StaleRuleGeneration(child.generation));
        }
        if child.state == SshForwardRuleState::Off {
            return Ok(None);
        }
        let generation = next_counter(child.generation)?;
        child.generation = generation;
        child.state = SshForwardRuleState::Closing;
        child.state_changed.notify_waiters();
        child.state_changed_at = UtcTimestamp::now();
        Ok(Some(RuleDisablePlan {
            generation,
            child: ChildShutdown {
                task_key: child.task_key.take(),
                stop_tx: child.stop_tx.take(),
                worker: child.worker.take(),
            },
        }))
    }

    pub(crate) fn finish_disable_rule(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        let child = entry
            .children
            .get_mut(rule_id)
            .ok_or(RuntimeError::StaleRuleGeneration(WireCounter::ZERO))?;
        if child.generation != generation {
            return Err(RuntimeError::StaleRuleGeneration(child.generation));
        }
        child.state = SshForwardRuleState::Off;
        child.state_changed.notify_waiters();
        child.error_code = None;
        child.started_at = None;
        child.state_changed_at = UtcTimestamp::now();
        Ok(())
    }

    pub(crate) fn remove_rule(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        expected_rule_generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        self.ensure_rule_removable(
            connection_id,
            connection_generation,
            rule_id,
            expected_rule_generation,
        )?;
        self.entries
            .get_mut(connection_id)
            .expect("validated connection remains present")
            .children
            .remove(rule_id);
        Ok(())
    }

    pub(crate) fn ensure_rule_removable(
        &self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        expected_rule_generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        let child = entry
            .children
            .get(rule_id)
            .ok_or(RuntimeError::StaleRuleGeneration(WireCounter::ZERO))?;
        if child.generation != expected_rule_generation {
            return Err(RuntimeError::StaleRuleGeneration(child.generation));
        }
        if !matches!(
            child.state,
            SshForwardRuleState::Off | SshForwardRuleState::Failed
        ) {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        Ok(())
    }

    pub(crate) fn lifecycle(&self, connection_id: &str) -> Result<Arc<Mutex<()>>, RuntimeError> {
        self.entries
            .get(connection_id)
            .map(|entry| Arc::clone(&entry.lifecycle))
            .ok_or(RuntimeError::ConnectionNotFound)
    }

    pub(crate) fn cancel_connection(
        &self,
        connection_id: &str,
        expected_generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != expected_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        entry.cancellation.cancel();
        Ok(())
    }

    pub(crate) fn worker_exited(
        &mut self,
        connection_id: &str,
        connection_generation: WireCounter,
        rule_id: &str,
        rule_generation: WireCounter,
        cancellation: &Arc<ConnectionCancellation>,
        error_code: SshForwardErrorCode,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get_mut(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != connection_generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if !Arc::ptr_eq(&entry.cancellation, cancellation) {
            return Ok(false);
        }
        let child = entry
            .children
            .get_mut(rule_id)
            .ok_or(RuntimeError::StaleRuleGeneration(WireCounter::ZERO))?;
        if child.generation != rule_generation {
            return Err(RuntimeError::StaleRuleGeneration(child.generation));
        }
        if child.state != SshForwardRuleState::On {
            return Ok(false);
        }
        child.state = SshForwardRuleState::Failed;
        child.state_changed.notify_waiters();
        child.error_code = Some(error_code);
        child.task_key = None;
        child.state_changed_at = UtcTimestamp::now();
        Ok(true)
    }

    pub(crate) fn rule_generation(
        &self,
        connection_id: &str,
        rule_id: &str,
    ) -> Result<Option<WireCounter>, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        Ok(entry.children.get(rule_id).map(|child| child.generation))
    }

    pub(crate) fn rule_definitions(
        &self,
        connection_id: &str,
    ) -> Result<Vec<(String, WireCounter, SshForwardRule)>, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        let mut values = entry
            .children
            .iter()
            .map(|(rule_id, child)| (rule_id.clone(), child.generation, child.rule.clone()))
            .collect::<Vec<_>>();
        values.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(values)
    }

    pub(crate) fn rule_is_in_progress(
        &self,
        connection_id: &str,
        rule_id: &str,
        expected_generation: WireCounter,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        Ok(entry.children.get(rule_id).is_some_and(|child| {
            child.generation == expected_generation
                && matches!(
                    child.state,
                    SshForwardRuleState::Opening | SshForwardRuleState::Closing
                )
        }))
    }

    pub(crate) fn profile_or_rule_is_active(&self, scope_id: &str, id: &str) -> bool {
        self.entries.values().any(|entry| {
            entry.profile.scope_id == scope_id
                && entry.state != SshConnectionState::Disconnected
                && (entry.profile.id == id || entry.children.contains_key(id))
        })
    }

    pub(crate) fn connection_keys(&self) -> Vec<(String, WireCounter, Arc<Mutex<()>>)> {
        let mut keys = self
            .entries
            .iter()
            .map(|(id, entry)| (id.clone(), entry.generation, Arc::clone(&entry.lifecycle)))
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| left.0.cmp(&right.0));
        keys
    }

    pub(crate) fn connection_handle(
        &self,
        connection_id: &str,
    ) -> Option<(WireCounter, Arc<Mutex<()>>, Arc<ConnectionCancellation>)> {
        self.entries.get(connection_id).map(|entry| {
            (
                entry.generation,
                Arc::clone(&entry.lifecycle),
                Arc::clone(&entry.cancellation),
            )
        })
    }

    pub(crate) fn clear_if_disconnected(&mut self) {
        if self
            .entries
            .values()
            .all(|entry| entry.state == SshConnectionState::Disconnected)
        {
            self.entries.clear();
        }
    }

    pub(crate) fn force_close(&mut self) {
        for entry in self.entries.values_mut() {
            for child in entry.children.values_mut() {
                child.task_key.take();
                child.stop_tx.take();
                if let Some(worker) = child.worker.take() {
                    worker.abort();
                }
            }
            entry.cancellation.cancel();
            entry.session.take();
            entry.session_slot.replace(None);
            entry.reconnect_owner = None;
            entry.credential_lease.take();
        }
        self.entries.clear();
    }

    pub(crate) fn connection_snapshots_for_scope(
        &self,
        scope_id: &str,
    ) -> Vec<SshConnectionRuntime> {
        let mut values = self
            .entries
            .values()
            .filter(|entry| entry.profile.scope_id == scope_id)
            .map(ConnectionEntry::snapshot)
            .collect::<Vec<_>>();
        values.sort_by(|left, right| left.connection_profile_id.cmp(&right.connection_profile_id));
        values
    }

    #[cfg(test)]
    pub(crate) fn rule_snapshots(&self) -> Vec<SshForwardRuleRuntime> {
        let mut values = self
            .entries
            .values()
            .flat_map(|entry| {
                entry
                    .children
                    .values()
                    .map(|child| child.snapshot(entry.generation))
            })
            .collect::<Vec<_>>();
        values.sort_by(|left, right| left.rule_id.cmp(&right.rule_id));
        values
    }

    pub(crate) fn rule_snapshots_for_scope(&self, scope_id: &str) -> Vec<SshForwardRuleRuntime> {
        let mut values = self
            .entries
            .values()
            .filter(|entry| entry.profile.scope_id == scope_id)
            .flat_map(|entry| {
                entry
                    .children
                    .values()
                    .filter(|child| child.rule.scope_id == scope_id)
                    .map(|child| child.snapshot(entry.generation))
            })
            .collect::<Vec<_>>();
        values.sort_by(|left, right| left.rule_id.cmp(&right.rule_id));
        values
    }

    pub(crate) fn ensure_established(
        &self,
        connection_id: &str,
        generation: WireCounter,
    ) -> Result<(), RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        if entry.state != SshConnectionState::Established || entry.session.is_none() {
            return Err(RuntimeError::ConnectionNotEstablished);
        }
        if entry.cancellation.is_cancelled() {
            return Err(RuntimeError::ConnectionCancelled);
        }
        Ok(())
    }

    pub(crate) fn is_reconnecting(
        &self,
        connection_id: &str,
        generation: WireCounter,
    ) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .get(connection_id)
            .ok_or(RuntimeError::ConnectionNotFound)?;
        if entry.generation != generation {
            return Err(RuntimeError::StaleConnectionGeneration(entry.generation));
        }
        Ok(entry.state == SshConnectionState::Reconnecting)
    }

    fn active_rule_count(&self) -> usize {
        self.entries
            .values()
            .flat_map(|entry| entry.children.values())
            .filter(|child| {
                matches!(
                    child.state,
                    SshForwardRuleState::Opening
                        | SshForwardRuleState::On
                        | SshForwardRuleState::Closing
                )
            })
            .count()
    }

    fn port_conflict(&self, port: u16, except_rule_id: &str) -> bool {
        self.entries.values().any(|entry| {
            entry.children.values().any(|child| {
                child.rule.id != except_rule_id
                    && child.rule.local_port == port
                    && matches!(
                        child.state,
                        SshForwardRuleState::Opening
                            | SshForwardRuleState::On
                            | SshForwardRuleState::Closing
                    )
            })
        })
    }

    #[cfg(test)]
    pub(crate) fn state(&self, connection_id: &str) -> Option<SshConnectionState> {
        self.entries.get(connection_id).map(|entry| entry.state)
    }
}

// Keep the legacy runtime types referenced while the command facade is being
// migrated in Phase 04. This prevents accidental reuse of their semantics in
// the new registry and documents the one-way boundary.
#[allow(dead_code)]
fn _legacy_state_types(_: SshForwardRuntime, _: SshForwardState) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_forward::credential_vault::{CredentialIdentity, VaultAuthIdentity};
    use crate::ssh_forward::profile::{ReconnectPolicy, SshForwardAuth};

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";
    const SCOPE_2: &str = "d1f5890a-55d7-46ca-949b-0d63972f0a68";

    fn timestamp() -> UtcTimestamp {
        UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap()
    }

    fn connection(id: &str) -> SshConnectionProfile {
        SshConnectionProfile {
            id: id.into(),
            scope_id: SCOPE.into(),
            name: id.into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            created_at: timestamp(),
            updated_at: timestamp(),
        }
    }

    fn rule(id: &str, connection_id: &str, port: u16) -> SshForwardRule {
        SshForwardRule {
            id: id.into(),
            scope_id: SCOPE.into(),
            connection_profile_id: connection_id.into(),
            name: id.into(),
            local_port: port,
            target_host: LoopbackHost,
            target_port: 5432,
            desired_enabled: true,
            reconnect: ReconnectPolicy {
                enabled: true,
                max_attempts: 1,
            },
            created_at: timestamp(),
            updated_at: timestamp(),
        }
    }

    #[test]
    fn connection_admission_is_bounded_and_generation_safe() {
        let mut registry = ConnectionRegistry::new();
        let id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let admission = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap();
        let ConnectionAdmission::Reserved(reservation) = admission else {
            panic!("first connect must reserve");
        };
        assert_eq!(reservation.generation.to_string(), "1");
        assert!(matches!(
            registry.reserve_connection(connection(id), WireCounter::ZERO),
            Err(RuntimeError::StaleConnectionGeneration(_))
        ));
        registry.entries.get_mut(id).unwrap().state = SshConnectionState::Established;
        assert!(matches!(
            registry.reserve_connection(connection(id), reservation.generation),
            Ok(ConnectionAdmission::AlreadyCurrent(_))
        ));
    }

    #[test]
    fn established_connection_can_expose_a_nonfatal_credential_warning() {
        let mut registry = ConnectionRegistry::new();
        let id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        registry.entries.get_mut(id).unwrap().state = SshConnectionState::Established;
        registry
            .set_established_error(
                id,
                reservation.generation,
                SshForwardErrorCode::CredentialNotSaved,
            )
            .unwrap();
        assert_eq!(
            registry.entries.get(id).unwrap().error_code,
            Some(SshForwardErrorCode::CredentialNotSaved)
        );
    }

    #[test]
    fn connection_admission_rejects_an_inflight_authentication() {
        let mut registry = ConnectionRegistry::new();
        let id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        assert!(matches!(
            registry.reserve_connection(connection(id), reservation.generation),
            Err(RuntimeError::ConnectionNotEstablished)
        ));
    }

    #[test]
    fn disconnect_clears_the_live_credential_lease_before_teardown() {
        let mut registry = ConnectionRegistry::new();
        let id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        let identity = CredentialIdentity {
            scope_id: SCOPE.into(),
            profile_id: id.into(),
            endpoint_host: "bastion.example".into(),
            endpoint_port: 22,
            ssh_user: "operator".into(),
            auth: VaultAuthIdentity::Password,
        };
        registry.entries.get_mut(id).unwrap().credential_lease = Some(Arc::new(
            CredentialLease::new_password(identity, "attempt", "operator", "secret"),
        ));
        assert!(registry.entries.get(id).unwrap().credential_lease.is_some());
        let plan = registry
            .begin_disconnect(id, reservation.generation)
            .unwrap()
            .unwrap();
        assert!(registry.entries.get(id).unwrap().credential_lease.is_none());
        assert!(plan.session.is_none());
    }

    #[test]
    fn stale_reservation_cleanup_cannot_remove_a_reused_generation() {
        let mut registry = ConnectionRegistry::new();
        let id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(old) = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        registry
            .fail_connection(id, old.generation, SshForwardErrorCode::SshConnectFailed)
            .unwrap();
        registry.clear_if_disconnected();
        let ConnectionAdmission::Reserved(current) = registry
            .reserve_connection(connection(id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("reused connection must reserve");
        };
        registry
            .discard_connection_if_matches(id, current.generation, &old.cancellation)
            .unwrap();
        assert_eq!(registry.state(id), Some(SshConnectionState::Authenticating));
        assert!(!Arc::ptr_eq(&old.cancellation, &current.cancellation));
    }

    #[test]
    fn profile_or_rule_activity_covers_v2_registry_entries() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let rule_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap();
        registry
            .entries
            .get_mut(connection_id)
            .unwrap()
            .children
            .insert(
                rule_id.into(),
                ForwardChild::new(rule(rule_id, connection_id, 15432), WireCounter::ZERO),
            );
        assert!(registry.profile_or_rule_is_active(SCOPE, connection_id));
        assert!(registry.profile_or_rule_is_active(SCOPE, rule_id));
        assert!(!registry.profile_or_rule_is_active(SCOPE_2, rule_id));
        registry.entries.get_mut(connection_id).unwrap().state = SshConnectionState::Disconnected;
        assert!(!registry.profile_or_rule_is_active(SCOPE, rule_id));
    }

    #[test]
    fn runtime_snapshots_are_filtered_by_scope() {
        let mut registry = ConnectionRegistry::new();
        let current_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let other_id = "f1634e77-0b5b-4b21-bd2f-462c9e3b7a96";
        registry
            .reserve_connection(connection(current_id), WireCounter::ZERO)
            .unwrap();
        let mut other = connection(other_id);
        other.scope_id = SCOPE_2.into();
        registry
            .reserve_connection(other, WireCounter::ZERO)
            .unwrap();

        let current = registry.connection_snapshots_for_scope(SCOPE);
        let other = registry.connection_snapshots_for_scope(SCOPE_2);
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].connection_profile_id, current_id);
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].connection_profile_id, other_id);
        assert!(registry.rule_snapshots_for_scope(SCOPE).is_empty());
    }

    #[test]
    fn live_connection_cap_counts_authenticating_entries() {
        let mut registry = ConnectionRegistry::new();
        let mut generations = Vec::new();
        for index in 0..MAX_LIVE_CONNECTIONS {
            let id = format!("{index:08x}-0000-4000-8000-000000000000");
            let ConnectionAdmission::Reserved(reservation) = registry
                .reserve_connection(connection(&id), WireCounter::ZERO)
                .unwrap()
            else {
                panic!("each fresh connection should reserve");
            };
            generations.push(reservation.generation);
        }
        assert_eq!(generations.len(), MAX_LIVE_CONNECTIONS);
        assert!(matches!(
            registry.reserve_connection(
                connection("f1634e77-0b5b-4b21-bd2f-462c9e3b7a96"),
                WireCounter::ZERO
            ),
            Err(RuntimeError::ConnectionLimit)
        ));
    }

    #[test]
    fn rule_admission_rejects_stale_parent_and_duplicate_ports() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let connection = connection(connection_id);
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection, WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        let connection_generation = reservation.generation;
        let mut wrong_scope = rule("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", connection_id, 15432);
        wrong_scope.scope_id = SCOPE_2.into();
        assert!(matches!(
            registry.reserve_rule(wrong_scope, connection_generation, WireCounter::ZERO),
            Err(RuntimeError::InvalidArgument)
        ));
        assert!(matches!(
            registry.reserve_rule(
                rule("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", connection_id, 15432),
                connection_generation,
                WireCounter::ZERO
            ),
            Err(RuntimeError::ConnectionNotEstablished)
        ));
        assert_eq!(
            registry.state(connection_id),
            Some(SshConnectionState::Authenticating)
        );
        let _ = reservation;
    }

    #[test]
    fn disconnect_invalidates_parent_and_child_generations() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        registry
            .entries
            .get_mut(connection_id)
            .unwrap()
            .children
            .insert(
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0".into(),
                ForwardChild::new(
                    rule("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", connection_id, 15432),
                    WireCounter::parse("1").unwrap(),
                ),
            );

        let plan = registry
            .begin_disconnect(connection_id, reservation.generation)
            .unwrap()
            .unwrap();
        assert_eq!(plan.generation.to_string(), "2");
        assert_eq!(
            registry.state(connection_id),
            Some(SshConnectionState::Disconnecting)
        );
        assert_eq!(
            registry
                .rule_snapshots()
                .into_iter()
                .find(|runtime| runtime.rule_id == "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0")
                .map(|runtime| runtime.state),
            Some(SshForwardRuleState::Closing)
        );
        assert_eq!(
            registry
                .rule_generation(connection_id, "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0")
                .unwrap(),
            Some(WireCounter::parse("2").unwrap())
        );
        registry
            .finish_disconnect(connection_id, plan.generation)
            .unwrap();
        assert_eq!(
            registry.state(connection_id),
            Some(SshConnectionState::Disconnected)
        );
        assert_eq!(
            registry
                .rule_snapshots()
                .into_iter()
                .find(|runtime| runtime.rule_id == "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0")
                .map(|runtime| runtime.state),
            Some(SshForwardRuleState::Off)
        );
        let ConnectionAdmission::Reserved(next) = registry
            .reserve_connection(connection(connection_id), plan.generation)
            .unwrap()
        else {
            panic!("a disconnected connection should be reusable");
        };
        assert_eq!(next.generation.to_string(), "3");
    }

    #[test]
    fn disconnect_counter_exhaustion_does_not_partially_mutate_children() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap();
        let max = WireCounter::parse(&u64::MAX.to_string()).unwrap();
        registry
            .entries
            .get_mut(connection_id)
            .unwrap()
            .children
            .insert(
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0".into(),
                ForwardChild::new(
                    rule("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", connection_id, 15432),
                    max,
                ),
            );
        assert!(matches!(
            registry.begin_disconnect(connection_id, WireCounter::parse("1").unwrap()),
            Err(RuntimeError::CounterExhausted)
        ));
        assert_eq!(
            registry.state(connection_id),
            Some(SshConnectionState::Authenticating)
        );
        assert_eq!(
            registry
                .rule_generation(connection_id, "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0")
                .unwrap(),
            Some(max)
        );
    }

    #[test]
    fn port_conflict_excludes_the_same_rule_and_isolates_siblings() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap();
        registry
            .entries
            .get_mut(connection_id)
            .unwrap()
            .children
            .insert(
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0".into(),
                ForwardChild {
                    state: SshForwardRuleState::On,
                    ..ForwardChild::new(
                        rule("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", connection_id, 15432),
                        WireCounter::parse("1").unwrap(),
                    )
                },
            );
        assert!(registry.port_conflict(15432, "another-rule"));
        assert!(!registry.port_conflict(15432, "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0"));
        assert!(!registry.port_conflict(15433, "another-rule"));
    }

    #[test]
    fn worker_exit_marks_only_the_current_on_child_failed() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let rule_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        let entry = registry.entries.get_mut(connection_id).unwrap();
        entry.state = SshConnectionState::Established;
        entry.children.insert(
            rule_id.into(),
            ForwardChild {
                state: SshForwardRuleState::On,
                ..ForwardChild::new(
                    rule(rule_id, connection_id, 15432),
                    WireCounter::parse("1").unwrap(),
                )
            },
        );
        assert!(registry
            .worker_exited(
                connection_id,
                reservation.generation,
                rule_id,
                WireCounter::parse("1").unwrap(),
                &reservation.cancellation,
                SshForwardErrorCode::BindFailed,
            )
            .unwrap());
        assert_eq!(
            registry
                .rule_snapshots()
                .into_iter()
                .find(|runtime| runtime.rule_id == rule_id)
                .map(|runtime| runtime.state),
            Some(SshForwardRuleState::Failed)
        );
        assert!(matches!(
            registry.worker_exited(
                connection_id,
                reservation.generation,
                rule_id,
                WireCounter::ZERO,
                &reservation.cancellation,
                SshForwardErrorCode::BindFailed,
            ),
            Err(RuntimeError::StaleRuleGeneration(_))
        ));
    }

    #[test]
    fn stale_worker_exit_cannot_mutate_a_reused_connection_instance() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let rule_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        let ConnectionAdmission::Reserved(old) = registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        let old_cancellation = Arc::clone(&old.cancellation);
        {
            let entry = registry.entries.get_mut(connection_id).unwrap();
            entry.state = SshConnectionState::Established;
            entry.children.insert(
                rule_id.into(),
                ForwardChild {
                    state: SshForwardRuleState::On,
                    ..ForwardChild::new(
                        rule(rule_id, connection_id, 15432),
                        WireCounter::parse("1").unwrap(),
                    )
                },
            );
        }
        let plan = registry
            .begin_disconnect(connection_id, old.generation)
            .unwrap()
            .expect("established connection must disconnect");
        registry
            .finish_disconnect(connection_id, plan.generation)
            .unwrap();
        registry.clear_if_disconnected();

        let ConnectionAdmission::Reserved(current) = registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("reused connection must reserve");
        };
        let entry = registry.entries.get_mut(connection_id).unwrap();
        entry.state = SshConnectionState::Established;
        entry.children.insert(
            rule_id.into(),
            ForwardChild {
                state: SshForwardRuleState::On,
                ..ForwardChild::new(
                    rule(rule_id, connection_id, 15432),
                    WireCounter::parse("1").unwrap(),
                )
            },
        );

        assert!(!registry
            .worker_exited(
                connection_id,
                current.generation,
                rule_id,
                WireCounter::parse("1").unwrap(),
                &old_cancellation,
                SshForwardErrorCode::BindFailed,
            )
            .unwrap());
        assert_eq!(
            registry
                .rule_snapshots()
                .into_iter()
                .find(|runtime| runtime.rule_id == rule_id)
                .map(|runtime| runtime.state),
            Some(SshForwardRuleState::On)
        );
    }

    #[test]
    fn missing_rule_disable_is_a_zero_generation_cleanup_noop() {
        let mut registry = ConnectionRegistry::new();
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let ConnectionAdmission::Reserved(reservation) = registry
            .reserve_connection(connection(connection_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        assert!(registry
            .begin_disable_rule(
                connection_id,
                reservation.generation,
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0",
                WireCounter::ZERO,
            )
            .unwrap()
            .is_none());
        assert!(matches!(
            registry.begin_disable_rule(
                connection_id,
                reservation.generation,
                "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0",
                WireCounter::parse("1").unwrap(),
            ),
            Err(RuntimeError::StaleRuleGeneration(_))
        ));
    }

    #[test]
    fn removed_inactive_rule_is_not_projected_after_reconciliation() {
        for state in [SshForwardRuleState::Off, SshForwardRuleState::Failed] {
            let mut registry = ConnectionRegistry::new();
            let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
            let ConnectionAdmission::Reserved(reservation) = registry
                .reserve_connection(connection(connection_id), WireCounter::ZERO)
                .unwrap()
            else {
                panic!("first connect must reserve");
            };
            let rule_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
            registry
                .entries
                .get_mut(connection_id)
                .unwrap()
                .children
                .insert(
                    rule_id.into(),
                    ForwardChild {
                        state,
                        ..ForwardChild::new(
                            rule(rule_id, connection_id, 15432),
                            WireCounter::parse("2").unwrap(),
                        )
                    },
                );
            registry
                .remove_rule(
                    connection_id,
                    reservation.generation,
                    rule_id,
                    WireCounter::parse("2").unwrap(),
                )
                .unwrap();
            assert!(registry.rule_snapshots().is_empty());
        }
    }

    #[test]
    fn removed_disconnected_connection_does_not_clear_siblings() {
        let mut registry = ConnectionRegistry::new();
        let deleted_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let retained_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        let ConnectionAdmission::Reserved(deleted) = registry
            .reserve_connection(connection(deleted_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("first connect must reserve");
        };
        registry
            .fail_connection(
                deleted_id,
                deleted.generation,
                SshForwardErrorCode::SshConnectFailed,
            )
            .unwrap();
        let ConnectionAdmission::Reserved(retained) = registry
            .reserve_connection(connection(retained_id), WireCounter::ZERO)
            .unwrap()
        else {
            panic!("second connect must reserve");
        };

        registry
            .remove_if_disconnected(deleted_id, deleted.generation)
            .unwrap();
        assert!(registry
            .connection_snapshots_for_scope(SCOPE)
            .iter()
            .all(|snapshot| snapshot.connection_profile_id != deleted_id));
        assert!(registry
            .connection_snapshots_for_scope(SCOPE)
            .iter()
            .any(|snapshot| snapshot.connection_profile_id == retained_id
                && snapshot.generation == retained.generation));
    }

    #[tokio::test]
    async fn connection_cancellation_wakes_waiters() {
        let cancellation = ConnectionCancellation::new();
        let waiter = {
            let cancellation = Arc::clone(&cancellation);
            tokio::spawn(async move { cancellation.cancelled().await })
        };
        cancellation.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn already_cancelled_connection_wakes_late_waiters() {
        let cancellation = ConnectionCancellation::new();
        cancellation.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(1), cancellation.cancelled())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn session_slot_version_prevents_a_lost_wakeup() {
        let slot = SessionSlot::new();
        let observed = slot.version();
        slot.notify_changed();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            slot.wait_for_change(observed),
        )
        .await
        .unwrap();
        assert_ne!(slot.version(), observed);
    }

    #[tokio::test]
    async fn reconnect_owner_handoff_wakes_a_waiting_child() {
        let registry = Arc::new(Mutex::new(ConnectionRegistry::new()));
        let connection_id = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
        let rule_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        let generation;
        let slot;
        {
            let mut registry = registry.lock().await;
            let ConnectionAdmission::Reserved(reservation) = registry
                .reserve_connection(connection(connection_id), WireCounter::ZERO)
                .unwrap()
            else {
                panic!("reconnect test connection must reserve");
            };
            generation = reservation.generation;
            let entry = registry.entries.get_mut(connection_id).unwrap();
            entry.state = SshConnectionState::Reconnecting;
            entry.reconnect_owner = Some("owner-a".into());
            entry.children.insert(
                rule_id.into(),
                ForwardChild {
                    state: SshForwardRuleState::On,
                    ..ForwardChild::new(
                        rule(rule_id, connection_id, 15432),
                        WireCounter::parse("1").unwrap(),
                    )
                },
            );
            slot = Arc::clone(&entry.session_slot);
        }

        let waiter_registry = Arc::clone(&registry);
        let waiter_slot = Arc::clone(&slot);
        let waiter = tokio::spawn(async move {
            let observed = waiter_slot.version();
            waiter_slot.wait_for_change(observed).await;
            waiter_registry
                .lock()
                .await
                .begin_reconnect(connection_id, generation, "owner-b")
                .unwrap()
                .is_some()
        });

        tokio::task::yield_now().await;
        assert!(registry
            .lock()
            .await
            .abandon_reconnect(connection_id, generation, "owner-a")
            .unwrap());

        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
                .await
                .unwrap()
                .unwrap()
        );
    }

    #[test]
    fn counter_exhaustion_is_reported_instead_of_wrapping() {
        let max = WireCounter::parse(&u64::MAX.to_string()).unwrap();
        assert_eq!(next_counter(max), Err(RuntimeError::CounterExhausted));
    }
}
