//! Public WebSocket client presence, liveness, and session binding registry.
//!
//! Provides a bounded in-memory registry for authenticated public UI WebSocket
//! connections, with RAII guards for pending upgrade reservations and live
//! connections, constant-time capability verification, monotonic membership
//! revisions, and admission fences.
//!
//! Excludes private OMP loopback WebSocket connections and HTTP SSE streams.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::watch;

use crate::api::auth::AuthenticatedActor;
use crate::idle_suspend::status::IdleSuspendClientPresenceStatusV1;

/// Default maximum number of simultaneous public UI connections (pending + live).
pub const DEFAULT_MAX_PUBLIC_CLIENTS: usize = 1024;

/// Maximum time a pending upgrade reservation is held before timing out.
pub const PENDING_UPGRADE_TIMEOUT: Duration = Duration::from_secs(30);

/// Server-originated ping interval.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// Monotonic deadline after which a silent connection is considered dead.
pub const HEARTBEAT_DEADLINE: Duration = Duration::from_secs(90);

/// Errors during client presence admission.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PresenceAdmissionError {
    #[error("Client presence capacity exceeded ({current}/{max})")]
    CapacityExceeded { current: usize, max: usize },

    #[error("Host is currently suspending; new connections rejected")]
    HostSuspending,

    #[error("Pending upgrade reservation {reservation_id} expired or not found")]
    ReservationExpired { reservation_id: u64 },

    #[error("Client connection {connection_id} already exists")]
    DuplicateConnection { connection_id: String },
}

/// Errors during capability or session verification.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CapabilityVerificationError {
    #[error("Connection {connection_id} not found in live registry")]
    NotFound { connection_id: String },

    #[error("Connection {connection_id} is in closing state")]
    Closing { connection_id: String },

    #[error("Decision capability secret mismatch")]
    CapabilityMismatch,

    #[error("Actor subject mismatch: expected {expected}, actual {actual}")]
    SubjectMismatch { expected: String, actual: String },

    #[error("Actor session ID mismatch: expected {expected:?}, actual {actual:?}")]
    SessionMismatch {
        expected: Option<String>,
        actual: Option<String>,
    },

    #[error("Actor auth version mismatch: expected {expected:?}, actual {actual:?}")]
    AuthVersionMismatch {
        expected: Option<i64>,
        actual: Option<i64>,
    },

    #[error("Actor credential version mismatch: expected {expected:?}, actual {actual:?}")]
    CredentialVersionMismatch {
        expected: Option<i64>,
        actual: Option<i64>,
    },

    #[error("Actor session deadline expired")]
    DeadlineExpired,
}

/// Errors during presence fence claims.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PresenceClaimError {
    #[error("Revision mismatch: expected {expected}, actual {actual}")]
    RevisionMismatch { expected: u64, actual: u64 },

    #[error("Live connections present: {count}")]
    LiveConnectionsPresent { count: u32 },

    #[error("Pending upgrades present: {count}")]
    PendingUpgradesPresent { count: u32 },

    #[error("Host already suspending")]
    AlreadySuspending,

    #[error("Presence unavailable / saturated")]
    Unavailable,
}

/// Computes a SHA-256 digest of the raw capability secret.
pub fn hash_capability(capability_secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(capability_secret.as_bytes());
    hasher.finalize().into()
}

/// A pending WebSocket upgrade reservation held between authentication and upgrade completion.
#[derive(Debug, Clone)]
pub struct PendingReservation {
    pub reservation_id: u64,
    pub reserved_at: Instant,
    pub actor: AuthenticatedActor,
}

/// A live authenticated public UI WebSocket client record.
#[derive(Debug, Clone)]
pub struct LiveClientRecord {
    pub connection_id: String,
    pub capability_digest: [u8; 32],
    pub subject: String,
    pub session_id: Option<String>,
    pub auth_version: Option<i64>,
    pub credential_version: Option<i64>,
    pub effective_deadline: Option<chrono::DateTime<chrono::Utc>>,
    pub connected_at: Instant,
    pub last_liveness: Instant,
    pub closing: bool,
}

struct RegistryInner {
    max_clients: usize,
    next_reservation_id: u64,
    pending: HashMap<u64, PendingReservation>,
    live: HashMap<String, LiveClientRecord>,
    membership_revision: u64,
    host_suspending: bool,
}

/// Bounded in-memory registry for public WebSocket presence and session binding.
pub struct ClientPresenceRegistry {
    inner: Mutex<RegistryInner>,
    status_tx: watch::Sender<IdleSuspendClientPresenceStatusV1>,
}
impl std::fmt::Debug for ClientPresenceRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let snap = self.snapshot();
        f.debug_struct("ClientPresenceRegistry")
            .field("connection_count", &snap.connection_count)
            .field("pending_upgrade_count", &snap.pending_upgrade_count)
            .field("revision", &snap.revision)
            .field("available", &snap.available)
            .finish()
    }
}

impl ClientPresenceRegistry {
    /// Creates a new presence registry with the default capacity.
    pub fn new() -> Arc<Self> {
        Self::with_capacity(DEFAULT_MAX_PUBLIC_CLIENTS)
    }

    /// Creates a new presence registry with an explicit capacity limit.
    pub fn with_capacity(max_clients: usize) -> Arc<Self> {
        let initial_status = IdleSuspendClientPresenceStatusV1 {
            connection_count: 0,
            pending_upgrade_count: 0,
            revision: 0,
            available: true,
        };
        let (status_tx, _) = watch::channel(initial_status);

        Arc::new(Self {
            inner: Mutex::new(RegistryInner {
                max_clients,
                next_reservation_id: 1,
                pending: HashMap::new(),
                live: HashMap::new(),
                membership_revision: 0,
                host_suspending: false,
            }),
            status_tx,
        })
    }

    fn snapshot_inner(inner: &RegistryInner) -> IdleSuspendClientPresenceStatusV1 {
        let total = inner.pending.len() + inner.live.len();
        let available = total < inner.max_clients && !inner.host_suspending;
        IdleSuspendClientPresenceStatusV1 {
            connection_count: inner.live.len() as u32,
            pending_upgrade_count: inner.pending.len() as u32,
            revision: inner.membership_revision,
            available,
        }
    }
    fn publish_inner(&self, inner: &RegistryInner) {
        let snapshot = Self::snapshot_inner(inner);
        self.status_tx.send_if_modified(|current| {
            if snapshot.revision >= current.revision {
                *current = snapshot;
                true
            } else {
                false
            }
        });
    }

    fn prune_expired_pending_inner(inner: &mut RegistryInner, now: Instant) -> bool {
        let before = inner.pending.len();
        inner.pending.retain(|_, res| {
            now.saturating_duration_since(res.reserved_at) <= PENDING_UPGRADE_TIMEOUT
        });
        if inner.pending.len() != before {
            inner.membership_revision += 1;
            true
        } else {
            false
        }
    }

    /// Reserves a pending upgrade slot after authentication succeeds, before upgrade callback.
    pub fn reserve_pending_upgrade(
        self: &Arc<Self>,
        actor: AuthenticatedActor,
    ) -> Result<PendingUpgradeGuard, PresenceAdmissionError> {
        let mut inner = self.inner.lock();
        let now = Instant::now();
        Self::prune_expired_pending_inner(&mut inner, now);

        if inner.host_suspending {
            return Err(PresenceAdmissionError::HostSuspending);
        }

        let total = inner.pending.len() + inner.live.len();
        if total >= inner.max_clients {
            return Err(PresenceAdmissionError::CapacityExceeded {
                current: total,
                max: inner.max_clients,
            });
        }

        let reservation_id = inner.next_reservation_id;
        inner.next_reservation_id = inner.next_reservation_id.wrapping_add(1);
        if inner.next_reservation_id == 0 {
            inner.next_reservation_id = 1;
        }

        inner.pending.insert(
            reservation_id,
            PendingReservation {
                reservation_id,
                reserved_at: now,
                actor,
            },
        );
        inner.membership_revision += 1;

        self.publish_inner(&inner);
        drop(inner);

        Ok(PendingUpgradeGuard {
            registry: Arc::clone(self),
            reservation_id,
            disarmed: false,
        })
    }

    /// Promotes a pending upgrade to a live connection.
    pub fn promote_pending_to_live(
        self: &Arc<Self>,
        reservation_id: u64,
        connection_id: String,
        capability_secret: &str,
    ) -> Result<ClientPresenceGuard, PresenceAdmissionError> {
        let mut inner = self.inner.lock();
        let now = Instant::now();
        Self::prune_expired_pending_inner(&mut inner, now);

        if inner.host_suspending {
            if inner.pending.remove(&reservation_id).is_some() {
                inner.membership_revision += 1;
                self.publish_inner(&inner);
                drop(inner);
            }
            return Err(PresenceAdmissionError::HostSuspending);
        }

        let reservation = inner
            .pending
            .remove(&reservation_id)
            .ok_or(PresenceAdmissionError::ReservationExpired { reservation_id })?;

        if inner.live.contains_key(&connection_id) {
            inner.membership_revision += 1;
            self.publish_inner(&inner);
            drop(inner);
            return Err(PresenceAdmissionError::DuplicateConnection { connection_id });
        }

        let capability_digest = hash_capability(capability_secret);
        inner.live.insert(
            connection_id.clone(),
            LiveClientRecord {
                connection_id: connection_id.clone(),
                capability_digest,
                subject: reservation.actor.subject,
                session_id: reservation.actor.session_id,
                auth_version: reservation.actor.auth_version,
                credential_version: reservation.actor.credential_version,
                effective_deadline: reservation.actor.effective_deadline,
                connected_at: now,
                last_liveness: now,
                closing: false,
            },
        );
        inner.membership_revision += 1;

        self.publish_inner(&inner);
        drop(inner);

        Ok(ClientPresenceGuard {
            registry: Arc::clone(self),
            connection_id,
            disarmed: false,
        })
    }

    /// Releases a pending reservation if an upgrade failed or was cancelled before completion.
    pub fn release_pending(&self, reservation_id: u64) {
        let mut inner = self.inner.lock();
        if inner.pending.remove(&reservation_id).is_some() {
            inner.membership_revision += 1;
            self.publish_inner(&inner);
            drop(inner);
        }
    }

    /// Records pong or control frame activity from a live connection.
    pub fn record_pong(&self, connection_id: &str) {
        let mut inner = self.inner.lock();
        if let Some(record) = inner.live.get_mut(connection_id) {
            record.last_liveness = Instant::now();
        }
    }

    /// Marks a connection as closing, immediately revoking capability and decisions.
    pub fn mark_closing(&self, connection_id: &str) {
        let mut inner = self.inner.lock();
        if let Some(record) = inner.live.get_mut(connection_id) {
            if !record.closing {
                record.closing = true;
                inner.membership_revision += 1;
                self.publish_inner(&inner);
                drop(inner);
            }
        }
    }

    /// Retires a live connection completely from the registry.
    pub fn retire_live(&self, connection_id: &str) {
        let mut inner = self.inner.lock();
        if inner.live.remove(connection_id).is_some() {
            inner.membership_revision += 1;
            self.publish_inner(&inner);
            drop(inner);
        }
    }

    /// Returns whether the specified connection ID is currently live and not closing.
    pub fn is_connection_live(&self, connection_id: &str) -> bool {
        let inner = self.inner.lock();
        inner
            .live
            .get(connection_id)
            .map(|record| !record.closing)
            .unwrap_or(false)
    }

    /// Verifies that a decision capability matches the live connection record and current actor.
    pub fn verify_decision_capability(
        &self,
        connection_id: &str,
        candidate_capability: &str,
        current_actor: &AuthenticatedActor,
    ) -> Result<(), CapabilityVerificationError> {
        let inner = self.inner.lock();
        let record =
            inner
                .live
                .get(connection_id)
                .ok_or_else(|| CapabilityVerificationError::NotFound {
                    connection_id: connection_id.to_string(),
                })?;

        if record.closing {
            return Err(CapabilityVerificationError::Closing {
                connection_id: connection_id.to_string(),
            });
        }

        let candidate_digest = hash_capability(candidate_capability);
        if !bool::from(candidate_digest.ct_eq(&record.capability_digest)) {
            return Err(CapabilityVerificationError::CapabilityMismatch);
        }

        if record.subject != current_actor.subject {
            return Err(CapabilityVerificationError::SubjectMismatch {
                expected: record.subject.clone(),
                actual: current_actor.subject.clone(),
            });
        }

        if record.session_id != current_actor.session_id {
            return Err(CapabilityVerificationError::SessionMismatch {
                expected: record.session_id.clone(),
                actual: current_actor.session_id.clone(),
            });
        }

        if record.auth_version != current_actor.auth_version {
            return Err(CapabilityVerificationError::AuthVersionMismatch {
                expected: record.auth_version,
                actual: current_actor.auth_version,
            });
        }

        if record.credential_version != current_actor.credential_version {
            return Err(CapabilityVerificationError::CredentialVersionMismatch {
                expected: record.credential_version,
                actual: current_actor.credential_version,
            });
        }

        if let Some(deadline) = record.effective_deadline {
            if chrono::Utc::now() >= deadline {
                return Err(CapabilityVerificationError::DeadlineExpired);
            }
        }

        Ok(())
    }

    /// Returns all connection IDs whose `last_liveness` elapsed exceeds `max_age`.
    pub fn check_heartbeat_deadlines(&self, max_age: Duration) -> Vec<String> {
        let inner = self.inner.lock();
        let now = Instant::now();
        inner
            .live
            .iter()
            .filter_map(|(id, record)| {
                if !record.closing && now.saturating_duration_since(record.last_liveness) > max_age
                {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    /// Prunes any expired pending reservations and updates the watch channel if any were removed.
    pub fn prune_expired_pending(&self) -> usize {
        let mut inner = self.inner.lock();
        let before = inner.pending.len();
        if Self::prune_expired_pending_inner(&mut inner, Instant::now()) {
            let removed = before.saturating_sub(inner.pending.len());
            self.publish_inner(&inner);
            drop(inner);
            removed
        } else {
            0
        }
    }

    /// Returns a current public presence snapshot without lock contention.
    pub fn snapshot(&self) -> IdleSuspendClientPresenceStatusV1 {
        self.status_tx.borrow().clone()
    }

    /// Subscribes to public presence changes.
    pub fn subscribe(&self) -> watch::Receiver<IdleSuspendClientPresenceStatusV1> {
        self.status_tx.subscribe()
    }

    /// Sets or clears the host-suspending admission fence.
    pub fn set_host_suspending(&self, suspending: bool) {
        let mut inner = self.inner.lock();
        if inner.host_suspending != suspending {
            inner.host_suspending = suspending;
            inner.membership_revision += 1;
            self.publish_inner(&inner);
            drop(inner);
        }
    }

    /// Returns whether the host is currently in suspending admission fence.
    pub fn is_host_suspending(&self) -> bool {
        self.inner.lock().host_suspending
    }

    /// Atomically claims the zero-client presence admission fence for automatic handoff.
    pub fn try_claim_no_client_fence(
        &self,
        expected_revision: u64,
    ) -> Result<u64, PresenceClaimError> {
        let mut inner = self.inner.lock();
        let now = Instant::now();
        Self::prune_expired_pending_inner(&mut inner, now);

        if !inner.live.is_empty() {
            return Err(PresenceClaimError::LiveConnectionsPresent {
                count: inner.live.len() as u32,
            });
        }

        if !inner.pending.is_empty() {
            return Err(PresenceClaimError::PendingUpgradesPresent {
                count: inner.pending.len() as u32,
            });
        }

        let total = inner.pending.len() + inner.live.len();
        if total >= inner.max_clients {
            return Err(PresenceClaimError::Unavailable);
        }

        if inner.host_suspending {
            return Err(PresenceClaimError::AlreadySuspending);
        }

        if inner.membership_revision != expected_revision {
            return Err(PresenceClaimError::RevisionMismatch {
                expected: expected_revision,
                actual: inner.membership_revision,
            });
        }

        inner.host_suspending = true;
        inner.membership_revision += 1;

        let new_revision = inner.membership_revision;
        self.publish_inner(&inner);
        drop(inner);

        Ok(new_revision)
    }
    /// Atomically verifies that an approving connection is live, matches the expected actor,
    /// and sets the host-suspending admission fence under the presence registry lock.
    pub fn try_claim_approved_client_fence(
        &self,
        connection_id: &str,
        expected_actor: &AuthenticatedActor,
    ) -> Result<u64, PresenceClaimError> {
        let mut inner = self.inner.lock();
        let now = Instant::now();
        Self::prune_expired_pending_inner(&mut inner, now);

        if inner.host_suspending {
            return Err(PresenceClaimError::AlreadySuspending);
        }

        let Some(record) = inner.live.get(connection_id) else {
            return Err(PresenceClaimError::Unavailable);
        };

        if record.closing {
            return Err(PresenceClaimError::Unavailable);
        }

        if record.subject != expected_actor.subject {
            return Err(PresenceClaimError::Unavailable);
        }

        if record.session_id != expected_actor.session_id
            || record.auth_version != expected_actor.auth_version
            || record.credential_version != expected_actor.credential_version
        {
            return Err(PresenceClaimError::Unavailable);
        }

        if let Some(deadline) = record.effective_deadline {
            if chrono::Utc::now() >= deadline {
                return Err(PresenceClaimError::Unavailable);
            }
        }

        inner.host_suspending = true;
        inner.membership_revision += 1;
        self.publish_inner(&inner);

        Ok(inner.membership_revision)
    }

    /// Releases the host-suspending admission fence after a failed or cancelled attempt.
    pub fn release_host_suspending(&self) {
        self.set_host_suspending(false);
    }
}

/// RAII guard for a pending upgrade reservation.
#[derive(Debug)]
pub struct PendingUpgradeGuard {
    registry: Arc<ClientPresenceRegistry>,
    reservation_id: u64,
    disarmed: bool,
}

impl PendingUpgradeGuard {
    pub fn reservation_id(&self) -> u64 {
        self.reservation_id
    }

    /// Promotes this pending reservation to a live client connection.
    pub fn promote(
        mut self,
        connection_id: String,
        capability_secret: &str,
    ) -> Result<ClientPresenceGuard, PresenceAdmissionError> {
        self.disarmed = true;
        self.registry
            .promote_pending_to_live(self.reservation_id, connection_id, capability_secret)
    }

    /// Explicitly releases the reservation without promoting.
    pub fn release(mut self) {
        self.disarmed = true;
        self.registry.release_pending(self.reservation_id);
    }
}

impl Drop for PendingUpgradeGuard {
    fn drop(&mut self) {
        if !self.disarmed {
            self.registry.release_pending(self.reservation_id);
        }
    }
}

/// RAII guard for a live client connection.
#[derive(Debug)]
pub struct ClientPresenceGuard {
    registry: Arc<ClientPresenceRegistry>,
    connection_id: String,
    disarmed: bool,
}

impl ClientPresenceGuard {
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }

    /// Records pong or control frame activity.
    pub fn record_pong(&self) {
        self.registry.record_pong(&self.connection_id);
    }
    /// Checks if this connection's last liveness exceeds `max_age`.
    pub fn check_deadline(&self, max_age: Duration) -> bool {
        let inner = self.registry.inner.lock();
        if let Some(record) = inner.live.get(&self.connection_id) {
            !record.closing
                && Instant::now().saturating_duration_since(record.last_liveness) > max_age
        } else {
            true
        }
    }

    /// Marks this connection as closing to immediately revoke capability.
    pub fn mark_closing(&self) {
        self.registry.mark_closing(&self.connection_id);
    }

    /// Explicitly retires this connection from the registry.
    pub fn retire(mut self) {
        self.disarmed = true;
        self.registry.retire_live(&self.connection_id);
    }
}

impl Drop for ClientPresenceGuard {
    fn drop(&mut self) {
        if !self.disarmed {
            self.registry.retire_live(&self.connection_id);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_presence_pending_reservation_and_promotion() {
        let registry = ClientPresenceRegistry::new();
        let actor = AuthenticatedActor::dev_user();

        let initial = registry.snapshot();
        assert_eq!(initial.connection_count, 0);
        assert_eq!(initial.pending_upgrade_count, 0);
        assert_eq!(initial.revision, 0);
        assert!(initial.available);

        // Reserve pending
        let pending_guard = registry
            .reserve_pending_upgrade(actor)
            .expect("reserve pending");
        let reserved_snap = registry.snapshot();
        assert_eq!(reserved_snap.connection_count, 0);
        assert_eq!(reserved_snap.pending_upgrade_count, 1);
        assert_eq!(reserved_snap.revision, 1);

        // Promote to live
        let connection_id = "conn-test-1".to_string();
        let capability_secret = "secret-test-abc".to_string();
        let live_guard = pending_guard
            .promote(connection_id.clone(), &capability_secret)
            .expect("promote live");
        let live_snap = registry.snapshot();
        assert_eq!(live_snap.connection_count, 1);
        assert_eq!(live_snap.pending_upgrade_count, 0);
        assert_eq!(live_snap.revision, 2);

        // Drop live guard -> retires
        drop(live_guard);
        let retired_snap = registry.snapshot();
        assert_eq!(retired_snap.connection_count, 0);
        assert_eq!(retired_snap.pending_upgrade_count, 0);
        assert_eq!(retired_snap.revision, 3);
    }

    #[test]
    fn test_client_presence_pending_guard_drop_releases() {
        let registry = ClientPresenceRegistry::new();
        let actor = AuthenticatedActor::dev_user();

        let pending_guard = registry.reserve_pending_upgrade(actor).expect("reserve");
        assert_eq!(registry.snapshot().pending_upgrade_count, 1);

        drop(pending_guard);
        let snap = registry.snapshot();
        assert_eq!(snap.pending_upgrade_count, 0);
        assert_eq!(snap.revision, 2);
    }

    #[test]
    fn test_client_presence_capacity_limit_and_overflow() {
        let registry = ClientPresenceRegistry::with_capacity(2);
        let actor = AuthenticatedActor::dev_user();

        let p1 = registry.reserve_pending_upgrade(actor.clone()).unwrap();
        let _l1 = p1.promote("conn-1".into(), "sec-1").unwrap();

        let p2 = registry.reserve_pending_upgrade(actor.clone()).unwrap();
        // At capacity (1 live + 1 pending == 2) -> available is false
        let at_cap_snap = registry.snapshot();
        assert_eq!(at_cap_snap.connection_count, 1);
        assert_eq!(at_cap_snap.pending_upgrade_count, 1);
        assert!(!at_cap_snap.available);

        // Third attempt exceeds capacity
        let p3_err = registry.reserve_pending_upgrade(actor.clone()).unwrap_err();
        assert_eq!(
            p3_err,
            PresenceAdmissionError::CapacityExceeded { current: 2, max: 2 }
        );

        // Release p2 -> back to available
        p2.release();
        let avail_snap = registry.snapshot();
        assert_eq!(avail_snap.connection_count, 1);
        assert_eq!(avail_snap.pending_upgrade_count, 0);
        assert!(avail_snap.available);
    }

    #[test]
    fn test_client_presence_capability_verification_and_actors() {
        let registry = ClientPresenceRegistry::new();
        let deadline = chrono::Utc::now() + chrono::Duration::hours(1);
        let actor = AuthenticatedActor::with_session(
            "alice",
            Some(3600),
            "sess-1",
            5,
            2,
            deadline,
            crate::auth::model::UserRole::User,
        );

        let p = registry.reserve_pending_upgrade(actor.clone()).unwrap();
        let conn_id = "conn-alice".to_string();
        let sec = "super-secret-capability-token";
        let live_guard = p.promote(conn_id.clone(), sec).unwrap();

        // Matching actor and secret -> Ok
        assert!(registry
            .verify_decision_capability(&conn_id, sec, &actor)
            .is_ok());

        // Wrong secret -> CapabilityMismatch
        let err = registry
            .verify_decision_capability(&conn_id, "wrong-secret", &actor)
            .unwrap_err();
        assert_eq!(err, CapabilityVerificationError::CapabilityMismatch);

        // Wrong subject -> SubjectMismatch
        let mut wrong_subject = actor.clone();
        wrong_subject.subject = "bob".to_string();
        let err = registry
            .verify_decision_capability(&conn_id, sec, &wrong_subject)
            .unwrap_err();
        assert_eq!(
            err,
            CapabilityVerificationError::SubjectMismatch {
                expected: "alice".into(),
                actual: "bob".into(),
            }
        );

        // Wrong session -> SessionMismatch
        let mut wrong_session = actor.clone();
        wrong_session.session_id = Some("sess-2".into());
        let err = registry
            .verify_decision_capability(&conn_id, sec, &wrong_session)
            .unwrap_err();
        assert_eq!(
            err,
            CapabilityVerificationError::SessionMismatch {
                expected: Some("sess-1".into()),
                actual: Some("sess-2".into()),
            }
        );

        // Wrong auth_version -> AuthVersionMismatch
        let mut wrong_auth = actor.clone();
        wrong_auth.auth_version = Some(6);
        let err = registry
            .verify_decision_capability(&conn_id, sec, &wrong_auth)
            .unwrap_err();
        assert_eq!(
            err,
            CapabilityVerificationError::AuthVersionMismatch {
                expected: Some(5),
                actual: Some(6),
            }
        );

        // Wrong credential_version -> CredentialVersionMismatch
        let mut wrong_cred = actor.clone();
        wrong_cred.credential_version = Some(3);
        let err = registry
            .verify_decision_capability(&conn_id, sec, &wrong_cred)
            .unwrap_err();
        assert_eq!(
            err,
            CapabilityVerificationError::CredentialVersionMismatch {
                expected: Some(2),
                actual: Some(3),
            }
        );

        // Mark closing -> Closing
        live_guard.mark_closing();
        let err = registry
            .verify_decision_capability(&conn_id, sec, &actor)
            .unwrap_err();
        assert_eq!(
            err,
            CapabilityVerificationError::Closing {
                connection_id: conn_id.clone(),
            }
        );
    }

    #[test]
    fn test_client_presence_heartbeat_deadlines_and_pongs() {
        let registry = ClientPresenceRegistry::new();
        let actor = AuthenticatedActor::dev_user();
        let p = registry.reserve_pending_upgrade(actor).unwrap();
        let live_guard = p.promote("conn-heartbeat".into(), "sec").unwrap();

        // Connection should not exceed deadline of 10s right now
        assert!(!live_guard.check_deadline(Duration::from_secs(10)));

        // Deadline check with Duration::ZERO should catch it
        std::thread::sleep(Duration::from_millis(5));
        assert!(live_guard.check_deadline(Duration::from_millis(1)));

        let dead = registry.check_heartbeat_deadlines(Duration::from_millis(1));
        assert_eq!(dead, vec!["conn-heartbeat".to_string()]);

        // Record pong refreshes it
        live_guard.record_pong();
        assert!(!live_guard.check_deadline(Duration::from_secs(10)));
    }

    #[test]
    fn test_client_presence_no_client_fence() {
        let registry = ClientPresenceRegistry::new();
        assert_eq!(registry.snapshot().revision, 0);

        // Claim fence with expected revision 0
        let new_rev = registry.try_claim_no_client_fence(0).expect("claim fence");
        assert_eq!(new_rev, 1);
        assert!(registry.is_host_suspending());
        assert!(!registry.snapshot().available);

        // Attempting to reserve while suspending fails
        let err = registry
            .reserve_pending_upgrade(AuthenticatedActor::dev_user())
            .unwrap_err();
        assert_eq!(err, PresenceAdmissionError::HostSuspending);

        // Attempting to claim again fails with AlreadySuspending
        let err = registry.try_claim_no_client_fence(1).unwrap_err();
        assert_eq!(err, PresenceClaimError::AlreadySuspending);

        // Release host suspending
        registry.release_host_suspending();
        assert!(!registry.is_host_suspending());
        assert!(registry.snapshot().available);

        // If a client exists, claim fence fails with LiveConnectionsPresent
        let p = registry
            .reserve_pending_upgrade(AuthenticatedActor::dev_user())
            .unwrap();
        let _l = p.promote("live-1".into(), "sec").unwrap();
        let current_rev = registry.snapshot().revision;
        let err = registry.try_claim_no_client_fence(current_rev).unwrap_err();
        assert_eq!(err, PresenceClaimError::LiveConnectionsPresent { count: 1 });
    }
}
