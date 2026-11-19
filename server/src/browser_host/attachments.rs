use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{watch, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::warn;
use uuid::Uuid;

use super::auth::{
    verify_live_admission, BrowserAdmission, LIVE_CHECK_INTERVAL, LIVE_CHECK_TIMEOUT,
};
use super::media::ViewerPermit;
use crate::state::AppState;

pub const TICKET_TTL: Duration = Duration::from_secs(30);
pub const PAIR_WAIT_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL: usize = 16;
pub const MAX_UNCONSUMED_TICKETS_GLOBAL: usize = 64;
/// Maximum identity checks in flight per supervision round.
const MAX_CONCURRENT_LIVE_CHECKS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentPurpose {
    Media,
    Control,
    AgentCdp,
}

impl fmt::Display for AttachmentPurpose {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Media => write!(f, "media"),
            Self::Control => write!(f, "control"),
            Self::AgentCdp => write!(f, "agentCdp"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentError {
    TicketNotFound,
    TicketExpired,
    PurposeMismatch {
        expected: AttachmentPurpose,
        actual: AttachmentPurpose,
    },
    OriginMismatch {
        expected: String,
        actual: String,
    },
    SessionMismatch,
    ViewerMismatch,
    SubscriptionMismatch,
    CapacityExceeded(String),
    /// The global viewer capacity is exhausted (carries the effective cap).
    ViewerCapacityExceeded(usize),
    PairNotFound(String),
    InvalidInput(String),
}

impl fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TicketNotFound => write!(f, "attachment ticket not found or already consumed"),
            Self::TicketExpired => write!(f, "attachment ticket expired"),
            Self::PurposeMismatch { expected, actual } => {
                write!(
                    f,
                    "ticket purpose mismatch: expected {expected}, got {actual}"
                )
            }
            Self::OriginMismatch { expected, actual } => {
                write!(f, "origin mismatch: expected {expected}, got {actual}")
            }
            Self::SessionMismatch => write!(f, "browserSessionId mismatch"),
            Self::ViewerMismatch => write!(f, "viewerId mismatch"),
            Self::SubscriptionMismatch => write!(f, "subscriptionEpoch mismatch"),
            Self::CapacityExceeded(msg) => write!(f, "ticket capacity exceeded (429): {msg}"),
            Self::ViewerCapacityExceeded(max) => {
                write!(f, "global active viewer capacity reached ({max})")
            }
            Self::PairNotFound(msg) => write!(f, "attachment pair not found or expired: {msg}"),
            Self::InvalidInput(msg) => write!(f, "invalid input (400): {msg}"),
        }
    }
}

impl std::error::Error for AttachmentError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueTicketRequest {
    pub purpose: AttachmentPurpose,
    pub browser_session_id: Option<String>,
    pub viewer_id: Option<String>,
    pub subscription_epoch: Option<String>,
    pub browser_incarnation: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub profile_epoch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueTicketResponse {
    pub ticket: String,
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
struct StoredTicket {
    purpose: AttachmentPurpose,
    principal: String,
    is_dev: bool,
    auth_session_id: Option<String>,
    auth_version: Option<i64>,
    credential_version: Option<i64>,
    effective_deadline: Option<DateTime<Utc>>,
    profile_epoch: u64,
    browser_incarnation: String,
    browser_session_id: Option<String>,
    viewer_id: Option<String>,
    subscription_epoch: Option<String>,
    expected_origin: Option<String>,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
pub struct AdmittedAttachment {
    pub purpose: AttachmentPurpose,
    pub principal: String,
    pub is_dev: bool,
    pub auth_session_id: Option<String>,
    pub auth_version: Option<i64>,
    pub credential_version: Option<i64>,
    pub effective_deadline: Option<DateTime<Utc>>,
    pub profile_epoch: u64,
    pub browser_incarnation: String,
    pub browser_session_id: Option<String>,
    pub viewer_id: Option<String>,
    pub subscription_epoch: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ActiveAttachment {
    pub connection_id: Uuid,
    pub purpose: AttachmentPurpose,
    pub principal: String,
    pub auth_session_id: Option<String>,
    pub auth_version: Option<i64>,
    pub credential_version: Option<i64>,
    pub effective_deadline: Option<DateTime<Utc>>,
    pub browser_session_id: Option<String>,
    pub viewer_id: Option<String>,
    pub subscription_epoch: Option<String>,
    pub cancel_token: CancellationToken,
    pub admitted_at: Instant,
    /// Identity of the pair slot this connection joined (media/control only), so a stale
    /// connection can never tear down a newer slot that reuses the same key.
    pub pair_id: Option<Uuid>,
}

type PairKey = (String, String, String, String); // (principal, session_id, viewer_id, subscription_epoch)

/// The pair's single global viewer permit, shared by its sockets. Each socket's task owns a
/// clone for its whole life, so capacity returns exactly when the last socket task ends (or an
/// upgrade that never started is dropped): handler teardown, task abort and runtime shutdown
/// all release it without going through the attachment registry.
pub type PairPermit = Arc<ViewerPermit>;

/// Registration result of one media/control socket.
pub struct PairRegistration {
    pub connection_id: Uuid,
    pub cancel_token: CancellationToken,
    pub permit: PairPermit,
}

/// One viewer pair: the media and control socket of one (viewer, subscription) identity.
struct PairedSlot {
    id: Uuid,
    media_connected: bool,
    control_connected: bool,
    /// Media socket registered AND its producer attached; only then may the pair be ready.
    media_attached: bool,
    /// The media producer attach failed: the pair never pairs with a control socket.
    media_failed: bool,
    /// Weak: the sockets own the capacity, the registry only lets the mate share it.
    permit: std::sync::Weak<ViewerPermit>,
    auth_session_id: Option<String>,
    auth_version: Option<i64>,
    credential_version: Option<i64>,
    profile_epoch: u64,
    browser_incarnation: String,
    cancel_token: CancellationToken,
    /// Publishes pair readiness (media attached + control connected) to the control socket.
    ready: watch::Sender<bool>,
}

impl PairedSlot {
    fn is_ready(&self) -> bool {
        self.media_attached && self.control_connected
    }

    fn publish_ready(&self) {
        self.ready.send_replace(self.is_ready());
    }
}

fn pair_key_of(conn: &ActiveAttachment) -> Option<PairKey> {
    Some((
        conn.principal.clone(),
        conn.browser_session_id.clone()?,
        conn.viewer_id.clone()?,
        conn.subscription_epoch.clone()?,
    ))
}

pub struct AttachmentManager {
    tickets: Arc<RwLock<HashMap<[u8; 32], StoredTicket>>>, // sha256 -> ticket
    active_connections: Arc<RwLock<HashMap<Uuid, ActiveAttachment>>>,
    pairs: Arc<RwLock<HashMap<PairKey, PairedSlot>>>,
    global_ticket_count: Arc<AtomicUsize>,
    supervisor_started: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for AttachmentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AttachmentManager {
    pub fn new() -> Self {
        Self {
            tickets: Arc::new(RwLock::new(HashMap::new())),
            active_connections: Arc::new(RwLock::new(HashMap::new())),
            pairs: Arc::new(RwLock::new(HashMap::new())),
            global_ticket_count: Arc::new(AtomicUsize::new(0)),
            supervisor_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Issues a single-use 256-bit random capability ticket.
    ///
    /// Stores ONLY the SHA-256 hash in memory. Expiry is clipped by auth deadline.
    pub async fn issue_ticket(
        &self,
        admission: &BrowserAdmission,
        req: &IssueTicketRequest,
        origin: Option<&str>,
    ) -> Result<IssueTicketResponse, AttachmentError> {
        // Validate required fields for Media/Control
        if req.purpose == AttachmentPurpose::Media || req.purpose == AttachmentPurpose::Control {
            if req.browser_session_id.is_none() {
                return Err(AttachmentError::InvalidInput(
                    "browserSessionId is required for media and control tickets".to_string(),
                ));
            }
            if req.viewer_id.is_none() {
                return Err(AttachmentError::InvalidInput(
                    "viewerId is required for media and control tickets".to_string(),
                ));
            }
            if req.subscription_epoch.is_none() {
                return Err(AttachmentError::InvalidInput(
                    "subscriptionEpoch is required for media and control tickets".to_string(),
                ));
            }
        }

        let now = Instant::now();
        let now_utc = Utc::now();

        // Calculate TTL clipped to auth deadline
        let mut ttl = TICKET_TTL;
        if let Some(deadline) = admission.effective_deadline {
            let until_deadline = deadline.signed_duration_since(now_utc);
            if until_deadline.num_milliseconds() <= 0 {
                return Err(AttachmentError::TicketExpired);
            }
            let deadline_duration = Duration::from_millis(until_deadline.num_milliseconds() as u64);
            if deadline_duration < ttl {
                ttl = deadline_duration;
            }
        }

        // Generate 256-bit (32 byte) random ticket
        let mut raw_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut raw_bytes);
        let ticket_str = URL_SAFE_NO_PAD.encode(raw_bytes);

        // Compute SHA-256 hash
        let mut hasher = Sha256::new();
        hasher.update(&raw_bytes);
        let hash: [u8; 32] = hasher.finalize().into();

        let expires_at = now + ttl;
        let expires_at_unix_ms = now_utc.timestamp_millis() + ttl.as_millis() as i64;

        let stored = StoredTicket {
            purpose: req.purpose,
            principal: admission.principal.clone(),
            is_dev: admission.is_dev,
            auth_session_id: admission.session_id.clone(),
            auth_version: admission.auth_version,
            credential_version: admission.credential_version,
            effective_deadline: admission.effective_deadline,
            profile_epoch: req.profile_epoch,
            browser_incarnation: req.browser_incarnation.clone(),
            browser_session_id: req.browser_session_id.clone(),
            viewer_id: req.viewer_id.clone(),
            subscription_epoch: req.subscription_epoch.clone(),
            expected_origin: origin.map(|s| s.to_string()),
            expires_at,
        };

        {
            // Single write-lock transaction: prune expired, check per-principal AND global
            // caps against the pruned map, insert. No cap check reads state outside the lock,
            // so concurrent issuers cannot be admitted past a cap and expired tickets never
            // count toward saturation.
            let mut tickets = self.tickets.write().await;
            let lock_now = Instant::now();
            tickets.retain(|_, t| t.expires_at > lock_now);

            let principal_count = tickets
                .values()
                .filter(|t| t.principal == admission.principal)
                .count();
            if principal_count >= MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL {
                self.global_ticket_count
                    .store(tickets.len(), Ordering::SeqCst);
                return Err(AttachmentError::CapacityExceeded(
                    "principal unconsumed ticket limit reached".to_string(),
                ));
            }
            if tickets.len() >= MAX_UNCONSUMED_TICKETS_GLOBAL {
                self.global_ticket_count
                    .store(tickets.len(), Ordering::SeqCst);
                return Err(AttachmentError::CapacityExceeded(
                    "global unconsumed ticket limit reached".to_string(),
                ));
            }

            tickets.insert(hash, stored);
            self.global_ticket_count
                .store(tickets.len(), Ordering::SeqCst);
        }

        Ok(IssueTicketResponse {
            ticket: ticket_str,
            expires_at_unix_ms,
        })
    }

    /// Atomically consumes a single-use ticket by raw ticket string.
    ///
    /// Validates purpose, expiry, origin. Returns admitted attachment metadata.
    pub async fn consume_ticket(
        &self,
        raw_ticket: &str,
        expected_purpose: AttachmentPurpose,
        actual_origin: Option<&str>,
    ) -> Result<AdmittedAttachment, AttachmentError> {
        let raw_bytes = URL_SAFE_NO_PAD
            .decode(raw_ticket.trim())
            .map_err(|_| AttachmentError::TicketNotFound)?;

        if raw_bytes.len() != 32 {
            return Err(AttachmentError::TicketNotFound);
        }

        let mut hasher = Sha256::new();
        hasher.update(&raw_bytes);
        let hash: [u8; 32] = hasher.finalize().into();

        // Atomic removal (single-use)
        let stored = {
            let mut tickets = self.tickets.write().await;
            let ticket = tickets
                .remove(&hash)
                .ok_or(AttachmentError::TicketNotFound)?;
            self.global_ticket_count
                .store(tickets.len(), Ordering::SeqCst);
            ticket
        };

        let now = Instant::now();
        if now > stored.expires_at {
            return Err(AttachmentError::TicketExpired);
        }

        if stored.purpose != expected_purpose {
            return Err(AttachmentError::PurposeMismatch {
                expected: expected_purpose,
                actual: stored.purpose,
            });
        }

        if let Some(expected_orig) = &stored.expected_origin {
            let actual = actual_origin.unwrap_or_default();
            if actual != expected_orig {
                return Err(AttachmentError::OriginMismatch {
                    expected: expected_orig.clone(),
                    actual: actual.to_string(),
                });
            }
        }

        Ok(AdmittedAttachment {
            purpose: stored.purpose,
            principal: stored.principal,
            is_dev: stored.is_dev,
            auth_session_id: stored.auth_session_id,
            auth_version: stored.auth_version,
            credential_version: stored.credential_version,
            effective_deadline: stored.effective_deadline,
            profile_epoch: stored.profile_epoch,
            browser_incarnation: stored.browser_incarnation,
            browser_session_id: stored.browser_session_id,
            viewer_id: stored.viewer_id,
            subscription_epoch: stored.subscription_epoch,
        })
    }

    /// Registers a non-pair attachment (agent CDP). Media and control sockets are admitted
    /// only through [`Self::register_pair_connection`], which binds the pair's global permit.
    pub async fn register_connection(
        &self,
        admitted: &AdmittedAttachment,
    ) -> Result<(Uuid, CancellationToken), AttachmentError> {
        if matches!(
            admitted.purpose,
            AttachmentPurpose::Media | AttachmentPurpose::Control
        ) {
            return Err(AttachmentError::InvalidInput(
                "media and control sockets register through register_pair_connection".to_string(),
            ));
        }
        Ok(self
            .insert_active(admitted, CancellationToken::new(), None)
            .await)
    }

    /// Registers a media or control socket into its (viewer, subscription) pair.
    ///
    /// The first socket of a pair acquires the pair's ONE global viewer permit through
    /// `acquire_permit` and arms the mate deadline timer; the mate shares that permit (never a
    /// second one). Every socket's task must keep `PairRegistration::permit` alive until it ends.
    pub async fn register_pair_connection<F>(
        &self,
        admitted: &AdmittedAttachment,
        acquire_permit: F,
    ) -> Result<PairRegistration, AttachmentError>
    where
        F: FnOnce() -> Result<ViewerPermit, AttachmentError>,
    {
        let purpose = admitted.purpose;
        if !matches!(purpose, AttachmentPurpose::Media | AttachmentPurpose::Control) {
            return Err(AttachmentError::InvalidInput(
                "only media and control sockets form a pair".to_string(),
            ));
        }
        let pair_key: PairKey = (
            admitted.principal.clone(),
            admitted.browser_session_id.clone().unwrap_or_default(),
            admitted.viewer_id.clone().unwrap_or_default(),
            admitted.subscription_epoch.clone().unwrap_or_default(),
        );
        let (pair_id, cancel_token, permit, armed_deadline) = {
            let mut pairs = self.pairs.write().await;
            // A slot whose sockets are all gone (no permit holder left, no failed attach) is
            // stale: it is replaced instead of blocking the identity forever.
            let stale = pairs
                .get(&pair_key)
                .is_some_and(|slot| slot.permit.strong_count() == 0 && !slot.media_failed);
            if stale {
                if let Some(old) = pairs.remove(&pair_key) {
                    old.cancel_token.cancel();
                }
            }
            let mut armed_deadline = None;
            let permit = if let Some(slot) = pairs.get(&pair_key) {
                if slot.profile_epoch != admitted.profile_epoch
                    || slot.browser_incarnation != admitted.browser_incarnation
                {
                    return Err(AttachmentError::SessionMismatch);
                }
                if slot.auth_session_id != admitted.auth_session_id
                    || slot.auth_version != admitted.auth_version
                    || slot.credential_version != admitted.credential_version
                {
                    return Err(AttachmentError::ViewerMismatch);
                }
                let permit = match slot.permit.upgrade() {
                    Some(permit) if !slot.media_failed => permit,
                    _ => {
                        return Err(AttachmentError::PairNotFound(
                            "media producer attach failed for this viewer subscription"
                                .to_string(),
                        ));
                    }
                };
                let duplicate = match purpose {
                    AttachmentPurpose::Media => slot.media_connected,
                    _ => slot.control_connected,
                };
                if duplicate {
                    return Err(AttachmentError::CapacityExceeded(format!(
                        "{purpose} socket already connected for this viewer subscription"
                    )));
                }
                permit
            } else {
                let permit = Arc::new(acquire_permit()?);
                let slot = PairedSlot {
                    id: Uuid::new_v4(),
                    media_connected: false,
                    control_connected: false,
                    media_attached: false,
                    media_failed: false,
                    permit: Arc::downgrade(&permit),
                    auth_session_id: admitted.auth_session_id.clone(),
                    auth_version: admitted.auth_version,
                    credential_version: admitted.credential_version,
                    profile_epoch: admitted.profile_epoch,
                    browser_incarnation: admitted.browser_incarnation.clone(),
                    cancel_token: CancellationToken::new(),
                    ready: watch::channel(false).0,
                };
                armed_deadline = Some((slot.id, slot.cancel_token.clone()));
                pairs.insert(pair_key.clone(), slot);
                permit
            };
            let slot = pairs.get_mut(&pair_key).expect("slot present under the write lock");
            match purpose {
                AttachmentPurpose::Media => slot.media_connected = true,
                _ => slot.control_connected = true,
            }
            slot.publish_ready();
            (slot.id, slot.cancel_token.child_token(), permit, armed_deadline)
        };
        if let Some((slot_id, slot_token)) = armed_deadline {
            self.spawn_pair_reaper(pair_key, slot_id, slot_token);
        }
        let (connection_id, cancel_token) = self
            .insert_active(admitted, cancel_token, Some(pair_id))
            .await;
        Ok(PairRegistration { connection_id, cancel_token, permit })
    }

    async fn insert_active(
        &self,
        admitted: &AdmittedAttachment,
        cancel_token: CancellationToken,
        pair_id: Option<Uuid>,
    ) -> (Uuid, CancellationToken) {
        let connection_id = Uuid::new_v4();
        let active = ActiveAttachment {
            connection_id,
            purpose: admitted.purpose,
            principal: admitted.principal.clone(),
            auth_session_id: admitted.auth_session_id.clone(),
            auth_version: admitted.auth_version,
            credential_version: admitted.credential_version,
            effective_deadline: admitted.effective_deadline,
            browser_session_id: admitted.browser_session_id.clone(),
            viewer_id: admitted.viewer_id.clone(),
            subscription_epoch: admitted.subscription_epoch.clone(),
            cancel_token: cancel_token.clone(),
            admitted_at: Instant::now(),
            pair_id,
        };
        self.active_connections
            .write()
            .await
            .insert(connection_id, active);
        (connection_id, cancel_token)
    }

    /// Independent timer: a pair that is not ready when `PAIR_WAIT_TIMEOUT` elapses is torn
    /// down (its sockets cancelled, its permit released) with no later traffic required.
    fn spawn_pair_reaper(&self, key: PairKey, slot_id: Uuid, slot_token: CancellationToken) {
        let pairs = self.pairs.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = slot_token.cancelled() => {}
                _ = tokio::time::sleep(PAIR_WAIT_TIMEOUT) => {
                    let mut pairs = pairs.write().await;
                    let expired = pairs
                        .get(&key)
                        .is_some_and(|slot| slot.id == slot_id && !slot.is_ready());
                    if expired {
                        if let Some(slot) = pairs.remove(&key) {
                            warn!(
                                session_id = %key.1,
                                viewer_id = %key.2,
                                "viewer pair incomplete at deadline; reaping its sockets"
                            );
                            slot.cancel_token.cancel();
                        }
                    }
                }
            }
        });
    }

    /// Marks the pair's media producer attached (media socket is about to be upgraded). The
    /// pair becomes ready once its control socket is also connected.
    pub async fn mark_media_attached(&self, connection_id: Uuid) -> bool {
        self.with_pair_slot(connection_id, |slot| {
            slot.media_attached = true;
            slot.publish_ready();
        })
        .await
    }

    /// The media producer attach failed: the pair never becomes ready and the control socket
    /// can no longer join it. The caller drops its permit clone so no capacity stays held
    /// behind the inert media socket.
    pub async fn fail_media_attach(&self, connection_id: Uuid) -> bool {
        self.with_pair_slot(connection_id, |slot| {
            slot.media_attached = false;
            slot.media_failed = true;
            slot.publish_ready();
        })
        .await
    }

    /// Pair-readiness watch (media attached + control connected) for a registered socket.
    pub async fn subscribe_pair(&self, connection_id: Uuid) -> Option<watch::Receiver<bool>> {
        let mut receiver = None;
        self.with_pair_slot(connection_id, |slot| receiver = Some(slot.ready.subscribe()))
            .await;
        receiver
    }

    async fn with_pair_slot(
        &self,
        connection_id: Uuid,
        apply: impl FnOnce(&mut PairedSlot),
    ) -> bool {
        let conns = self.active_connections.read().await;
        let Some(conn) = conns.get(&connection_id) else {
            return false;
        };
        let (Some(pair_id), Some(key)) = (conn.pair_id, pair_key_of(conn)) else {
            return false;
        };
        let mut pairs = self.pairs.write().await;
        match pairs.get_mut(&key) {
            Some(slot) if slot.id == pair_id => {
                apply(slot);
                true
            }
            _ => false,
        }
    }

    /// Verifies that `viewer_id` currently owns a live, ready media+control attachment pair
    /// bound to the exact principal, auth session, browser session, profile epoch, and browser
    /// incarnation. Never falls back to principal-only matching.
    pub async fn has_admitted_viewer_pair(
        &self,
        admission: &BrowserAdmission,
        browser_session_id: &str,
        viewer_id: &str,
        profile_epoch: u64,
        browser_incarnation: &str,
    ) -> bool {
        let conns = self.active_connections.read().await;
        let pairs = self.pairs.read().await;
        pairs.iter().any(|((principal, bsid, vid, _sub), slot)| {
            principal == &admission.principal
                && bsid == browser_session_id
                && vid == viewer_id
                && slot.is_ready()
                && !slot.media_failed
                && !slot.cancel_token.is_cancelled()
                && slot.permit.strong_count() > 0
                && slot.profile_epoch == profile_epoch
                && slot.browser_incarnation == browser_incarnation
                && slot.auth_session_id == admission.session_id
                && slot.auth_version == admission.auth_version
                && slot.credential_version == admission.credential_version
                && conns.values().any(|conn| {
                    conn.pair_id == Some(slot.id)
                        && conn.purpose == AttachmentPurpose::Control
                        && !conn.cancel_token.is_cancelled()
                        && conn.principal == admission.principal
                        && conn.auth_session_id == admission.session_id
                        && conn.auth_version == admission.auth_version
                        && conn.credential_version == admission.credential_version
                })
        })
    }

    pub async fn unregister_connection(&self, connection_id: Uuid) {
        let mut conns = self.active_connections.write().await;
        if let Some(conn) = conns.remove(&connection_id) {
            conn.cancel_token.cancel();
            if let (Some(pair_id), Some(key)) = (conn.pair_id, pair_key_of(&conn)) {
                let mut pairs = self.pairs.write().await;
                if pairs.get(&key).is_some_and(|slot| slot.id == pair_id) {
                    if let Some(slot) = pairs.remove(&key) {
                        slot.cancel_token.cancel();
                    }
                }
            }
        }
    }

    /// Targeted revocation: revokes connections matching the specified auth_session_id.
    ///
    /// Sibling logins for the same principal remain running!
    pub async fn revoke_by_auth_session(
        &self,
        principal: &str,
        session_id: &str,
    ) -> Vec<(String, String)> {
        let mut cancelled_pairs: Vec<(String, String, String, String)> = Vec::new();
        let mut cancelled_viewers: Vec<(String, String)> = Vec::new();
        {
            let mut conns = self.active_connections.write().await;
            conns.retain(|_, c| {
                if c.principal == principal && c.auth_session_id.as_deref() == Some(session_id) {
                    c.cancel_token.cancel();
                    if let (Some(bsid), Some(vid)) = (&c.browser_session_id, &c.viewer_id) {
                        cancelled_viewers.push((bsid.clone(), vid.clone()));
                        if let Some(sub) = &c.subscription_epoch {
                            cancelled_pairs.push((
                                principal.to_string(),
                                bsid.clone(),
                                vid.clone(),
                                sub.clone(),
                            ));
                        }
                    }
                    false
                } else {
                    true
                }
            });
        }

        if !cancelled_pairs.is_empty() {
            let mut pairs = self.pairs.write().await;
            for key in cancelled_pairs {
                if let Some(slot) = pairs.remove(&key) {
                    slot.cancel_token.cancel();
                }
            }
        }

        // Invalidate tickets issued for this session
        {
            let mut tickets = self.tickets.write().await;
            tickets.retain(|_, t| {
                !(t.principal == principal && t.auth_session_id.as_deref() == Some(session_id))
            });
            self.global_ticket_count
                .store(tickets.len(), Ordering::SeqCst);
        }

        cancelled_viewers
    }

    /// Principal-wide revocation (e.g. on profile reset or user disable).
    pub async fn revoke_all_for_principal(&self, principal: &str) {
        {
            let mut conns = self.active_connections.write().await;
            conns.retain(|_, c| {
                if c.principal == principal {
                    c.cancel_token.cancel();
                    false
                } else {
                    true
                }
            });
        }

        {
            let mut pairs = self.pairs.write().await;
            pairs.retain(|(p, _, _, _), slot| {
                if p == principal {
                    slot.cancel_token.cancel();
                    false
                } else {
                    true
                }
            });
        }

        let mut tickets = self.tickets.write().await;
        tickets.retain(|_, t| t.principal != principal);
        self.global_ticket_count
            .store(tickets.len(), Ordering::SeqCst);
    }
    /// Revokes everything bound to a browser session when it closes: its sockets, its pair
    /// slots (releasing their global permits) and every unconsumed ticket, so a ticket issued
    /// before the close can never be consumed after it.
    pub async fn revoke_by_browser_session(&self, session_id: &str) {
        {
            let mut conns = self.active_connections.write().await;
            conns.retain(|_, c| {
                if c.browser_session_id.as_deref() == Some(session_id) {
                    c.cancel_token.cancel();
                    false
                } else {
                    true
                }
            });
        }
        {
            let mut pairs = self.pairs.write().await;
            pairs.retain(|(_, sid, _, _), slot| {
                if sid == session_id {
                    slot.cancel_token.cancel();
                    false
                } else {
                    true
                }
            });
        }
        let mut tickets = self.tickets.write().await;
        tickets.retain(|_, t| t.browser_session_id.as_deref() != Some(session_id));
        self.global_ticket_count
            .store(tickets.len(), Ordering::SeqCst);
    }

    /// Runs one supervision round over every registered attachment.
    ///
    /// Connections sharing an auth identity (principal, session, versions, deadline) share ONE
    /// check. Distinct identities are checked concurrently (at most `MAX_CONCURRENT_LIVE_CHECKS`
    /// in flight) under one absolute `LIVE_CHECK_TIMEOUT` deadline that also covers the wait for
    /// a concurrency permit (a timeout counts as a failed check), so neither a slow or
    /// unavailable store nor the number of identities can serialize rounds: a revoked or
    /// unverifiable identity is cancelled within one `LIVE_CHECK_INTERVAL` plus
    /// `LIVE_CHECK_TIMEOUT` (5s healthy / 7s error). Pairing waits and setup are covered
    /// because connections are registered (and therefore supervised) before either begins.
    pub async fn run_live_check_round<F, Fut, E>(&self, is_dev: bool, check: F)
    where
        F: Fn(BrowserAdmission) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), E>> + Send + 'static,
        E: fmt::Display + Send + 'static,
    {
        type IdentityKey = (
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<DateTime<Utc>>,
        );
        let mut groups: HashMap<IdentityKey, (BrowserAdmission, Vec<Uuid>)> = HashMap::new();
        {
            let conns = self.active_connections.read().await;
            for c in conns.values() {
                let key = (
                    c.principal.clone(),
                    c.auth_session_id.clone(),
                    c.auth_version,
                    c.credential_version,
                    c.effective_deadline,
                );
                groups
                    .entry(key)
                    .or_insert_with(|| {
                        (
                            BrowserAdmission {
                                principal: c.principal.clone(),
                                is_dev,
                                session_id: c.auth_session_id.clone(),
                                auth_version: c.auth_version,
                                credential_version: c.credential_version,
                                effective_deadline: c.effective_deadline,
                            },
                            Vec::new(),
                        )
                    })
                    .1
                    .push(c.connection_id);
            }
        }
        if groups.is_empty() {
            return;
        }

        let check = Arc::new(check);
        let permits = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_LIVE_CHECKS));
        // One absolute deadline for the whole round: waiting for a concurrency permit counts
        // against it, so identities beyond the permit count can neither extend the round nor
        // postpone the next one. An identity that could not be verified by the deadline
        // (queued or slow) fails closed.
        let round_deadline = tokio::time::Instant::now() + LIVE_CHECK_TIMEOUT;
        let mut checks = tokio::task::JoinSet::new();
        for (_, (adm, conn_ids)) in groups {
            let check = check.clone();
            let permits = permits.clone();
            checks.spawn(async move {
                let verified = tokio::time::timeout_at(round_deadline, async {
                    let _permit = permits.acquire_owned().await.ok();
                    check(adm.clone()).await
                })
                .await;
                let verdict = match verified {
                    Ok(Ok(())) => None,
                    Ok(Err(err)) => Some(err.to_string()),
                    Err(_) => Some("live check timed out".to_string()),
                };
                (adm, conn_ids, verdict)
            });
        }
        while let Some(joined) = checks.join_next().await {
            let Ok((adm, conn_ids, Some(reason))) = joined else {
                continue;
            };
            warn!(
                principal = %adm.principal,
                connections = conn_ids.len(),
                error = %reason,
                "Live auth check failed: cancelling attachment sockets"
            );
            for conn_id in conn_ids {
                // `unregister_connection` cancels the token and releases its pairing slot.
                self.unregister_connection(conn_id).await;
            }
        }
    }

    /// Starts the background auth supervisor loop.
    pub fn start_supervisor(&'static self, state: AppState) {
        if self
            .supervisor_started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(LIVE_CHECK_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            interval.tick().await;

            loop {
                interval.tick().await;
                let state = state.clone();
                self.run_live_check_round(state.no_auth, move |adm| {
                    let state = state.clone();
                    async move { verify_live_admission(&state, &adm).await }
                })
                .await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ticket_single_use_and_atomic_consume() {
        let mgr = AttachmentManager::new();
        let adm = BrowserAdmission {
            principal: "admin1".to_string(),
            is_dev: false,
            session_id: Some("sess1".to_string()),
            auth_version: Some(1),
            credential_version: Some(1),
            effective_deadline: None,
        };

        let req = IssueTicketRequest {
            purpose: AttachmentPurpose::Media,
            browser_session_id: Some("bsess1".to_string()),
            viewer_id: Some("view1".to_string()),
            subscription_epoch: Some("sub1".to_string()),
            browser_incarnation: "inc1".to_string(),
            profile_epoch: 1,
        };

        let resp = mgr
            .issue_ticket(&adm, &req, Some("http://localhost:5173"))
            .await
            .expect("ticket issue should succeed");

        // First consume succeeds
        let consumed = mgr
            .consume_ticket(
                &resp.ticket,
                AttachmentPurpose::Media,
                Some("http://localhost:5173"),
            )
            .await
            .expect("first consume should succeed");
        assert_eq!(consumed.principal, "admin1");
        assert_eq!(consumed.browser_session_id.as_deref(), Some("bsess1"));

        // Replay fails (single-use)
        let replay_res = mgr
            .consume_ticket(
                &resp.ticket,
                AttachmentPurpose::Media,
                Some("http://localhost:5173"),
            )
            .await;
        assert_eq!(replay_res.unwrap_err(), AttachmentError::TicketNotFound);
    }

    #[tokio::test]
    async fn test_purpose_and_origin_mismatch_rejected() {
        let mgr = AttachmentManager::new();
        let adm = BrowserAdmission {
            principal: "admin1".to_string(),
            is_dev: false,
            session_id: None,
            auth_version: None,
            credential_version: None,
            effective_deadline: None,
        };

        let req = IssueTicketRequest {
            purpose: AttachmentPurpose::Media,
            browser_session_id: Some("bsess1".to_string()),
            viewer_id: Some("view1".to_string()),
            subscription_epoch: Some("sub1".to_string()),
            browser_incarnation: "inc1".to_string(),
            profile_epoch: 1,
        };

        let resp = mgr
            .issue_ticket(&adm, &req, Some("http://localhost:5173"))
            .await
            .unwrap();

        // Purpose mismatch (requesting Control with Media ticket)
        let err = mgr
            .consume_ticket(
                &resp.ticket,
                AttachmentPurpose::Control,
                Some("http://localhost:5173"),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AttachmentError::PurposeMismatch { .. }));

        // Issue another ticket for origin test
        let resp2 = mgr
            .issue_ticket(&adm, &req, Some("http://localhost:5173"))
            .await
            .unwrap();

        // Origin mismatch
        let err2 = mgr
            .consume_ticket(
                &resp2.ticket,
                AttachmentPurpose::Media,
                Some("http://evil.com"),
            )
            .await
            .unwrap_err();
        assert!(matches!(err2, AttachmentError::OriginMismatch { .. }));
    }

    #[tokio::test]
    async fn test_targeted_revoke_preserves_sibling_sessions() {
        let mgr = AttachmentManager::new();
        let adm1 = BrowserAdmission {
            principal: "admin1".to_string(),
            is_dev: false,
            session_id: Some("session-A".to_string()),
            auth_version: Some(1),
            credential_version: Some(1),
            effective_deadline: None,
        };
        let adm2 = BrowserAdmission {
            principal: "admin1".to_string(),
            is_dev: false,
            session_id: Some("session-B".to_string()),
            auth_version: Some(1),
            credential_version: Some(1),
            effective_deadline: None,
        };

        let req1 = IssueTicketRequest {
            purpose: AttachmentPurpose::Media,
            browser_session_id: Some("bsess1".to_string()),
            viewer_id: Some("v1".to_string()),
            subscription_epoch: Some("s1".to_string()),
            browser_incarnation: "inc1".to_string(),
            profile_epoch: 1,
        };
        let req2 = IssueTicketRequest {
            purpose: AttachmentPurpose::Media,
            browser_session_id: Some("bsess2".to_string()),
            viewer_id: Some("v2".to_string()),
            subscription_epoch: Some("s2".to_string()),
            browser_incarnation: "inc1".to_string(),
            profile_epoch: 1,
        };

        let t1 = mgr.issue_ticket(&adm1, &req1, None).await.unwrap();
        let t2 = mgr.issue_ticket(&adm2, &req2, None).await.unwrap();

        let c1 = mgr
            .consume_ticket(&t1.ticket, AttachmentPurpose::Media, None)
            .await
            .unwrap();
        let c2 = mgr
            .consume_ticket(&t2.ticket, AttachmentPurpose::Media, None)
            .await
            .unwrap();

        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let permit = || {
            ViewerPermit::try_acquire_in(&COUNTER, 8).map_err(|_| AttachmentError::ViewerCapacityExceeded(8))
        };
        let reg1 = mgr.register_pair_connection(&c1, permit).await.unwrap();
        let reg2 = mgr.register_pair_connection(&c2, permit).await.unwrap();
        let (cancel1, cancel2) = (reg1.cancel_token.clone(), reg2.cancel_token.clone());

        // Revoke session-A
        mgr.revoke_by_auth_session("admin1", "session-A").await;

        // cancel1 must be cancelled
        assert!(cancel1.is_cancelled());
        // cancel2 (session-B) must NOT be cancelled (sibling profile preserved)
        assert!(!cancel2.is_cancelled());
    }

    fn pair_admission(session: &str, viewer: &str, purpose: AttachmentPurpose) -> AdmittedAttachment {
        AdmittedAttachment {
            purpose,
            principal: "alice".to_string(),
            is_dev: false,
            auth_session_id: Some("auth-1".to_string()),
            auth_version: Some(1),
            credential_version: Some(1),
            effective_deadline: None,
            profile_epoch: 1,
            browser_incarnation: "inc-1".to_string(),
            browser_session_id: Some(session.to_string()),
            viewer_id: Some(viewer.to_string()),
            subscription_epoch: Some("sub-1".to_string()),
        }
    }

    fn counter_permit(
        counter: &'static AtomicUsize,
        cap: usize,
    ) -> impl FnOnce() -> Result<ViewerPermit, AttachmentError> {
        move || {
            ViewerPermit::try_acquire_in(counter, cap)
                .map_err(|_| AttachmentError::ViewerCapacityExceeded(cap))
        }
    }

    #[tokio::test]
    async fn pair_shares_one_permit_and_returns_it_with_its_last_socket() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let mgr = AttachmentManager::new();
        let media = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Media), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        let control = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Control), || {
                panic!("the mate must not acquire a second permit")
            })
            .await
            .unwrap();
        assert_eq!(COUNTER.load(Ordering::SeqCst), 1);
        mgr.unregister_connection(media.connection_id).await;
        drop(media);
        assert_eq!(COUNTER.load(Ordering::SeqCst), 1, "the mate's task still owns the permit");
        drop(control);
        assert_eq!(COUNTER.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn half_pair_is_reaped_by_its_own_timer_and_ready_pair_survives() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let mgr = AttachmentManager::new();
        let solo = mgr
            .register_pair_connection(&pair_admission("solo", "v", AttachmentPurpose::Control), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        let media = mgr
            .register_pair_connection(&pair_admission("both", "v", AttachmentPurpose::Media), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        let control = mgr
            .register_pair_connection(&pair_admission("both", "v", AttachmentPurpose::Control), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        assert!(mgr.mark_media_attached(media.connection_id).await);
        let mut ready = mgr.subscribe_pair(control.connection_id).await.unwrap();
        assert!(*ready.borrow_and_update(), "attached media + connected control is ready");
        let mut solo_ready = mgr.subscribe_pair(solo.connection_id).await.unwrap();
        assert!(!*solo_ready.borrow_and_update(), "a control socket alone is never ready");

        // Let the reaper tasks arm their timers, then pass the pair deadline.
        tokio::task::yield_now().await;
        tokio::time::advance(PAIR_WAIT_TIMEOUT + Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(solo.cancel_token.is_cancelled(), "half pair reaped with no traffic");
        assert!(!media.cancel_token.is_cancelled() && !control.cancel_token.is_cancelled());
        assert!(mgr.subscribe_pair(solo.connection_id).await.is_none(), "reaped slot is gone");
        drop(solo);
        assert_eq!(COUNTER.load(Ordering::SeqCst), 1, "reaped pair's capacity returned");
    }

    #[tokio::test(start_paused = true)]
    async fn stale_connection_never_removes_a_newer_slot_for_the_same_key() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let mgr = AttachmentManager::new();
        let old = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Media), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(PAIR_WAIT_TIMEOUT + Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(old.cancel_token.is_cancelled());
        let new = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Media), counter_permit(&COUNTER, 4))
            .await
            .unwrap();
        mgr.unregister_connection(old.connection_id).await;
        assert!(!new.cancel_token.is_cancelled(), "old socket's cleanup tore down the new slot");
        assert!(mgr.mark_media_attached(new.connection_id).await);
    }

    #[tokio::test]
    async fn failed_media_attach_blocks_control_pairing_and_capacity_is_capped_per_pair() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let mgr = AttachmentManager::new();
        let media = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Media), counter_permit(&COUNTER, 1))
            .await
            .unwrap();
        assert!(mgr.fail_media_attach(media.connection_id).await);
        let err = mgr
            .register_pair_connection(&pair_admission("s", "v", AttachmentPurpose::Control), || panic!("no permit for a failed pair"))
            .await
            .err()
            .unwrap();
        assert!(matches!(err, AttachmentError::PairNotFound(_)), "{err}");
        // Capacity 1 is held by the pair: another viewer is refused until the pair's task ends.
        let busy = mgr
            .register_pair_connection(&pair_admission("s2", "v2", AttachmentPurpose::Control), counter_permit(&COUNTER, 1))
            .await
            .err()
            .unwrap();
        assert_eq!(busy, AttachmentError::ViewerCapacityExceeded(1));
        drop(media);
        assert_eq!(COUNTER.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn close_revokes_pair_slots_and_unconsumed_tickets_of_the_session() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let mgr = AttachmentManager::new();
        let admission = BrowserAdmission {
            principal: "alice".to_string(),
            is_dev: false,
            session_id: Some("auth-1".to_string()),
            auth_version: Some(1),
            credential_version: Some(1),
            effective_deadline: None,
        };
        let request = |session: &str| IssueTicketRequest {
            purpose: AttachmentPurpose::Media,
            browser_session_id: Some(session.to_string()),
            viewer_id: Some("v".to_string()),
            subscription_epoch: Some("sub-1".to_string()),
            browser_incarnation: "inc-1".to_string(),
            profile_epoch: 1,
        };
        let closed = mgr.issue_ticket(&admission, &request("closing"), None).await.unwrap();
        let other = mgr.issue_ticket(&admission, &request("other"), None).await.unwrap();
        let reg = mgr
            .register_pair_connection(&pair_admission("closing", "v", AttachmentPurpose::Control), counter_permit(&COUNTER, 4))
            .await
            .unwrap();

        mgr.revoke_by_browser_session("closing").await;

        assert!(reg.cancel_token.is_cancelled());
        assert!(mgr.subscribe_pair(reg.connection_id).await.is_none(), "slot dropped with the session");
        assert_eq!(
            mgr.consume_ticket(&closed.ticket, AttachmentPurpose::Media, None).await.unwrap_err(),
            AttachmentError::TicketNotFound,
            "ticket issued before the close must not be consumable after it"
        );
        assert!(mgr.consume_ticket(&other.ticket, AttachmentPurpose::Media, None).await.is_ok());
    }
}
