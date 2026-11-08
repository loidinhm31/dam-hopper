use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing::warn;
use uuid::Uuid;

use super::auth::{verify_live_admission, BrowserAdmission, LIVE_CHECK_INTERVAL};
use crate::state::AppState;

pub const TICKET_TTL: Duration = Duration::from_secs(30);
pub const PAIR_WAIT_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL: usize = 16;
pub const MAX_UNCONSUMED_TICKETS_GLOBAL: usize = 64;

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
    PurposeMismatch { expected: AttachmentPurpose, actual: AttachmentPurpose },
    OriginMismatch { expected: String, actual: String },
    SessionMismatch,
    ViewerMismatch,
    SubscriptionMismatch,
    CapacityExceeded(String),
    PairNotFound(String),
    InvalidInput(String),
}

impl fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TicketNotFound => write!(f, "attachment ticket not found or already consumed"),
            Self::TicketExpired => write!(f, "attachment ticket expired"),
            Self::PurposeMismatch { expected, actual } => {
                write!(f, "ticket purpose mismatch: expected {expected}, got {actual}")
            }
            Self::OriginMismatch { expected, actual } => {
                write!(f, "origin mismatch: expected {expected}, got {actual}")
            }
            Self::SessionMismatch => write!(f, "browserSessionId mismatch"),
            Self::ViewerMismatch => write!(f, "viewerId mismatch"),
            Self::SubscriptionMismatch => write!(f, "subscriptionEpoch mismatch"),
            Self::CapacityExceeded(msg) => write!(f, "ticket capacity exceeded (429): {msg}"),
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
}

struct PairedSlot {
    media_connected: bool,
    control_connected: bool,
    created_at: Instant,
    first_connected_at: Option<Instant>,
    cancel_token: CancellationToken,
}

pub struct AttachmentManager {
    tickets: Arc<RwLock<HashMap<[u8; 32], StoredTicket>>>, // sha256 -> ticket
    active_connections: Arc<RwLock<HashMap<Uuid, ActiveAttachment>>>,
    pairs: Arc<RwLock<HashMap<(String, String), PairedSlot>>>, // (viewer_id, subscription_epoch) -> slot
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

        let current_global = self.global_ticket_count.load(Ordering::SeqCst);
        if current_global >= MAX_UNCONSUMED_TICKETS_GLOBAL {
            return Err(AttachmentError::CapacityExceeded(
                "global unconsumed ticket limit reached".to_string(),
            ));
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
            let mut tickets = self.tickets.write().await;
            // Prune expired tickets
            tickets.retain(|_, t| t.expires_at > now);

            // Check per-principal limit
            let principal_count = tickets
                .values()
                .filter(|t| t.principal == admission.principal)
                .count();

            if principal_count >= MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL {
                return Err(AttachmentError::CapacityExceeded(
                    "principal unconsumed ticket limit reached".to_string(),
                ));
            }

            tickets.insert(hash, stored);
            self.global_ticket_count.store(tickets.len(), Ordering::SeqCst);
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
            let ticket = tickets.remove(&hash).ok_or(AttachmentError::TicketNotFound)?;
            self.global_ticket_count.store(tickets.len(), Ordering::SeqCst);
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
            let actual = actual_origin.unwrap_or_default().trim_end_matches('/');
            let expected = expected_orig.trim_end_matches('/');
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(AttachmentError::OriginMismatch {
                    expected: expected.to_string(),
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

    /// Registers an admitted attachment connection and binds its pair/lifecycle.
    pub async fn register_connection(
        &self,
        admitted: &AdmittedAttachment,
    ) -> Result<(Uuid, CancellationToken), AttachmentError> {
        let connection_id = Uuid::new_v4();
        let mut cancel_token = CancellationToken::new();
        // For Media or Control, pair them under (viewer_id, subscription_epoch)
        if admitted.purpose == AttachmentPurpose::Media || admitted.purpose == AttachmentPurpose::Control {
            let viewer_id = admitted.viewer_id.as_deref().unwrap_or_default().to_string();
            let sub_epoch = admitted.subscription_epoch.as_deref().unwrap_or_default().to_string();
            let pair_key = (viewer_id, sub_epoch);

            let mut pairs = self.pairs.write().await;
            let now = Instant::now();

            // Prune expired pairs (older than 30s or first connected > 15s ago without mate)
            pairs.retain(|_, slot| {
                if now.duration_since(slot.created_at) > TICKET_TTL {
                    slot.cancel_token.cancel();
                    return false;
                }
                if let Some(first_at) = slot.first_connected_at {
                    if !(slot.media_connected && slot.control_connected)
                        && now.duration_since(first_at) > PAIR_WAIT_TIMEOUT
                    {
                        slot.cancel_token.cancel();
                        return false;
                    }
                }
                true
            });

            let slot = pairs.entry(pair_key).or_insert_with(|| PairedSlot {
                media_connected: false,
                control_connected: false,
                created_at: now,
                first_connected_at: None,
                cancel_token: CancellationToken::new(),
            });

            cancel_token = slot.cancel_token.child_token();

            match admitted.purpose {
                AttachmentPurpose::Media => {
                    if slot.media_connected {
                        return Err(AttachmentError::CapacityExceeded(
                            "media socket already connected for this viewer subscription".to_string(),
                        ));
                    }
                    slot.media_connected = true;
                    if slot.first_connected_at.is_none() {
                        slot.first_connected_at = Some(now);
                    }
                }
                AttachmentPurpose::Control => {
                    if slot.control_connected {
                        return Err(AttachmentError::CapacityExceeded(
                            "control socket already connected for this viewer subscription".to_string(),
                        ));
                    }
                    slot.control_connected = true;
                    if slot.first_connected_at.is_none() {
                        slot.first_connected_at = Some(now);
                    }
                }
                _ => {}
            }
        }

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
        };
        {
            let mut conns = self.active_connections.write().await;
            conns.insert(connection_id, active);
        }

        Ok((connection_id, cancel_token))
    }

    pub async fn unregister_connection(&self, connection_id: Uuid) {
        let mut conns = self.active_connections.write().await;
        if let Some(conn) = conns.remove(&connection_id) {
            conn.cancel_token.cancel();
            if let (Some(viewer_id), Some(sub_epoch)) = (conn.viewer_id, conn.subscription_epoch) {
                let mut pairs = self.pairs.write().await;
                if let Some(slot) = pairs.remove(&(viewer_id, sub_epoch)) {
                    slot.cancel_token.cancel();
                }
            }
        }
    }

    /// Targeted revocation: revokes connections matching the specified auth_session_id.
    ///
    /// Sibling logins for the same principal remain running!
    pub async fn revoke_by_auth_session(&self, principal: &str, session_id: &str) {
        let mut conns = self.active_connections.write().await;
        conns.retain(|_, c| {
            if c.principal == principal && c.auth_session_id.as_deref() == Some(session_id) {
                c.cancel_token.cancel();
                false
            } else {
                true
            }
        });

        // Invalidate tickets issued for this session
        let mut tickets = self.tickets.write().await;
        tickets.retain(|_, t| {
            !(t.principal == principal && t.auth_session_id.as_deref() == Some(session_id))
        });
        self.global_ticket_count.store(tickets.len(), Ordering::SeqCst);
    }

    /// Principal-wide revocation (e.g. on profile reset or user disable).
    pub async fn revoke_all_for_principal(&self, principal: &str) {
        let mut conns = self.active_connections.write().await;
        conns.retain(|_, c| {
            if c.principal == principal {
                c.cancel_token.cancel();
                false
            } else {
                true
            }
        });

        let mut tickets = self.tickets.write().await;
        tickets.retain(|_, t| t.principal != principal);
        self.global_ticket_count.store(tickets.len(), Ordering::SeqCst);
    }

    /// Revokes connections bound to a browser session when it closes.
    pub async fn revoke_by_browser_session(&self, session_id: &str) {
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

    /// Starts the background auth supervisor loop.
    pub fn start_supervisor(self: Arc<Self>, state: AppState) {
        if self.supervisor_started.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(LIVE_CHECK_INTERVAL);
            interval.tick().await;

            loop {
                interval.tick().await;

                // Collect distinct active principals and sessions
                let checks: Vec<(Uuid, BrowserAdmission, CancellationToken)> = {
                    let conns = self.active_connections.read().await;
                    conns
                        .values()
                        .map(|c| {
                            let adm = BrowserAdmission {
                                principal: c.principal.clone(),
                                is_dev: state.no_auth,
                                session_id: c.auth_session_id.clone(),
                                auth_version: c.auth_version,
                                credential_version: c.credential_version,
                                effective_deadline: c.effective_deadline,
                            };
                            (c.connection_id, adm, c.cancel_token.clone())
                        })
                        .collect()
                };

                for (conn_id, adm, cancel_token) in checks {
                    if let Err(err) = verify_live_admission(&state, &adm).await {
                        warn!(
                            %conn_id,
                            principal = %adm.principal,
                            error = %err,
                            "Live auth check failed: cancelling attachment socket"
                        );
                        cancel_token.cancel();
                        self.unregister_connection(conn_id).await;
                    }
                }
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
            .consume_ticket(&resp.ticket, AttachmentPurpose::Media, Some("http://localhost:5173"))
            .await
            .expect("first consume should succeed");
        assert_eq!(consumed.principal, "admin1");
        assert_eq!(consumed.browser_session_id.as_deref(), Some("bsess1"));

        // Replay fails (single-use)
        let replay_res = mgr
            .consume_ticket(&resp.ticket, AttachmentPurpose::Media, Some("http://localhost:5173"))
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
            .consume_ticket(&resp.ticket, AttachmentPurpose::Control, Some("http://localhost:5173"))
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
            .consume_ticket(&resp2.ticket, AttachmentPurpose::Media, Some("http://evil.com"))
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

        let c1 = mgr.consume_ticket(&t1.ticket, AttachmentPurpose::Media, None).await.unwrap();
        let c2 = mgr.consume_ticket(&t2.ticket, AttachmentPurpose::Media, None).await.unwrap();

        let (_id1, cancel1) = mgr.register_connection(&c1).await.unwrap();
        let (_id2, cancel2) = mgr.register_connection(&c2).await.unwrap();

        // Revoke session-A
        mgr.revoke_by_auth_session("admin1", "session-A").await;

        // cancel1 must be cancelled
        assert!(cancel1.is_cancelled());
        // cancel2 (session-B) must NOT be cancelled (sibling profile preserved)
        assert!(!cancel2.is_cancelled());
    }
}
