use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::network_policy::{validate_navigation_url, NetworkPolicyError, MAX_TITLE_BYTES};
use super::protocol::TargetGeometry;

pub const DEFAULT_MAX_TARGETS: usize = 2;
pub const MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL: usize = 128;
pub const IDEMPOTENCY_TTL: Duration = Duration::from_secs(600); // 10 minutes

pub const MIN_VIEWPORT_WIDTH: u32 = 64;
pub const MAX_VIEWPORT_WIDTH: u32 = 1920;
pub const MIN_VIEWPORT_HEIGHT: u32 = 64;
pub const MAX_VIEWPORT_HEIGHT: u32 = 1080;
pub const MIN_DPR: f64 = 1.0;
pub const MAX_DPR: f64 = 3.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    NotFound,
    Forbidden,
    Conflict(String),
    Busy(String),
    InvalidInput(String),
    PolicyViolation(String),
    Internal(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(f, "browser session not found"),
            Self::Forbidden => write!(f, "access to browser session is forbidden"),
            Self::Conflict(msg) => write!(f, "session conflict (409): {msg}"),
            Self::Busy(msg) => write!(f, "browser busy (429): {msg}"),
            Self::InvalidInput(msg) => write!(f, "invalid input (400): {msg}"),
            Self::PolicyViolation(msg) => write!(f, "policy violation (400): {msg}"),
            Self::Internal(msg) => write!(f, "internal session error (500): {msg}"),
        }
    }
}

impl std::error::Error for SessionError {}

impl From<NetworkPolicyError> for SessionError {
    fn from(err: NetworkPolicyError) -> Self {
        Self::PolicyViolation(err.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Initializing,
    Running,
    Closed,
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Initializing => write!(f, "initializing"),
            Self::Running => write!(f, "running"),
            Self::Closed => write!(f, "closed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportRequest {
    pub width: u32,
    pub height: u32,
    pub dpr: f64,
}

impl ViewportRequest {
    pub fn sanitize(&self) -> Self {
        Self {
            width: self.width.clamp(MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH),
            height: self.height.clamp(MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT),
            dpr: self.dpr.clamp(MIN_DPR, MAX_DPR),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub creation_key: String,
    pub url: String,
    pub viewport: ViewportRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLeaseSummary {
    pub viewer_id: String,
    pub holder_kind: String, // "human" | "agent"
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDialogSummary {
    pub dialog_id: String,
    pub message: String,
    pub dialog_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionDto {
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: String,
    pub navigation_revision: String,
    pub viewport_epoch: String,
    pub url: String,
    pub title: String,
    pub status: String,
    pub geometry: TargetGeometry,
    pub input_available: bool,
    pub unavailable_reason: Option<String>,
    pub dialog: Option<SessionDialogSummary>,
    pub lease: Option<SessionLeaseSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub popup_blocked: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct SessionLease {
    pub lease_token: String,
    pub viewer_id: String,
    pub holder_kind: String,
    pub expires_at: Instant,
}

#[derive(Debug, Clone)]
pub struct SessionDialog {
    pub dialog_id: String,
    pub message: String,
    pub dialog_type: String,
}

pub struct BrowserSession {
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub navigation_revision: u64,
    pub viewport_epoch: u64,
    pub url: String,
    pub title: String,
    pub status: SessionStatus,
    pub geometry: TargetGeometry,
    pub input_available: bool,
    pub unavailable_reason: Option<String>,
    pub owner_principal: String,
    pub is_dev: bool,
    pub native_target_id: Option<String>,
    pub creation_key: String,
    pub lease: Option<SessionLease>,
    pub active_dialog: Option<SessionDialog>,
    pub popup_blocked: bool,
}

impl BrowserSession {
    pub fn to_dto(&self) -> BrowserSessionDto {
        let now = Instant::now();
        let lease_summary = self.lease.as_ref().filter(|l| l.expires_at > now).map(|l| {
            let remaining = l.expires_at.saturating_duration_since(now);
            let unix_ms = chrono::Utc::now().timestamp_millis() + remaining.as_millis() as i64;
            SessionLeaseSummary {
                viewer_id: l.viewer_id.clone(),
                holder_kind: l.holder_kind.clone(),
                expires_at_unix_ms: unix_ms,
            }
        });

        let dialog_summary = self.active_dialog.as_ref().map(|d| SessionDialogSummary {
            dialog_id: d.dialog_id.clone(),
            message: d.message.clone(),
            dialog_type: d.dialog_type.clone(),
        });

        BrowserSessionDto {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            navigation_revision: self.navigation_revision.to_string(),
            viewport_epoch: self.viewport_epoch.to_string(),
            url: self.url.clone(),
            title: self.title.clone(),
            status: self.status.to_string(),
            geometry: self.geometry.clone(),
            input_available: self.input_available && self.status == SessionStatus::Running,
            unavailable_reason: self.unavailable_reason.clone(),
            dialog: dialog_summary,
            lease: lease_summary,
            popup_blocked: if self.popup_blocked { Some(true) } else { None },
        }
    }
}

#[derive(Debug, Clone)]
struct CreationRecord {
    url: String,
    viewport: ViewportRequest,
    session_id: String,
    created_at: Instant,
}

pub struct SessionRegistry {
    sessions: Arc<RwLock<HashMap<String, BrowserSession>>>,
    creation_records: Arc<RwLock<HashMap<String, HashMap<String, CreationRecord>>>>, // principal -> (creation_key -> record)
    active_target_count: Arc<AtomicUsize>,
    max_targets: usize,
}

impl SessionRegistry {
    pub fn new(max_targets: usize) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            creation_records: Arc::new(RwLock::new(HashMap::new())),
            active_target_count: Arc::new(AtomicUsize::new(0)),
            max_targets: if max_targets == 0 { DEFAULT_MAX_TARGETS } else { max_targets },
        }
    }

    pub fn max_targets(&self) -> usize {
        self.max_targets
    }

    pub fn active_target_count(&self) -> usize {
        self.active_target_count.load(Ordering::Relaxed)
    }

    /// Creates or idempotently retrieves a session.
    ///
    /// Returns (BrowserSessionDto, is_created_fresh).
    pub async fn create_or_idempotent_get(
        &self,
        principal: &str,
        is_dev: bool,
        browser_incarnation: &str,
        profile_epoch: u64,
        req: &CreateSessionRequest,
        allowed_origins: &[String],
    ) -> Result<(BrowserSessionDto, bool), SessionError> {
        // Validate creationKey as valid UUID
        Uuid::parse_str(&req.creation_key)
            .map_err(|e| SessionError::InvalidInput(format!("creationKey must be a valid UUID: {e}")))?;

        // Validate URL against policy
        let parsed_url = validate_navigation_url(&req.url, is_dev, allowed_origins)?;
        let sanitized_viewport = req.viewport.sanitize();

        // Check idempotency record for this principal
        let mut recs_guard = self.creation_records.write().await;
        let principal_recs = recs_guard.entry(principal.to_string()).or_default();

        // Prune expired records (older than 10 minutes)
        let now = Instant::now();
        principal_recs.retain(|_, r| now.duration_since(r.created_at) < IDEMPOTENCY_TTL);

        if let Some(existing_rec) = principal_recs.get(&req.creation_key) {
            // Check if parameters match
            let url_matches = existing_rec.url == req.url;
            let vp_matches = existing_rec.viewport.width == sanitized_viewport.width
                && existing_rec.viewport.height == sanitized_viewport.height
                && (existing_rec.viewport.dpr - sanitized_viewport.dpr).abs() < f64::EPSILON;

            if !url_matches || !vp_matches {
                return Err(SessionError::Conflict(
                    "creationKey reused with different url or viewport parameters".to_string(),
                ));
            }

            // Return existing session if still tracked
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&existing_rec.session_id) {
                if session.owner_principal == principal {
                    return Ok((session.to_dto(), false));
                }
            }
            // If session was closed, we still report it as previously created if retained
        }

        // Enforce capacity ceiling before allocating new target
        let current_count = self.active_target_count.load(Ordering::SeqCst);
        if current_count >= self.max_targets {
            return Err(SessionError::Busy(format!(
                "global browser target capacity ({}) reached",
                self.max_targets
            )));
        }

        // Bounded idempotency records: reject rather than evict live retry records
        if principal_recs.len() >= MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL {
            return Err(SessionError::Busy(format!(
                "idempotency record capacity ({}) reached for principal",
                MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL
            )));
        }

        let session_id = Uuid::new_v4().to_string();
        let geometry = TargetGeometry {
            css_width: sanitized_viewport.width as f64,
            css_height: sanitized_viewport.height as f64,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: sanitized_viewport.dpr,
        };

        let session = BrowserSession {
            browser_session_id: session_id.clone(),
            browser_incarnation: browser_incarnation.to_string(),
            profile_epoch,
            navigation_revision: 1,
            viewport_epoch: 1,
            url: parsed_url.to_string(),
            title: "New Tab".to_string(),
            status: SessionStatus::Running,
            geometry,
            input_available: true,
            unavailable_reason: None,
            owner_principal: principal.to_string(),
            is_dev,
            native_target_id: None,
            creation_key: req.creation_key.clone(),
            lease: None,
            active_dialog: None,
            popup_blocked: false,
        };

        let dto = session.to_dto();

        // Save session
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
            self.active_target_count.fetch_add(1, Ordering::SeqCst);
        }

        // Record idempotency
        principal_recs.insert(
            req.creation_key.clone(),
            CreationRecord {
                url: req.url.clone(),
                viewport: sanitized_viewport,
                session_id,
                created_at: now,
            },
        );

        Ok((dto, true))
    }

    pub async fn get_session(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<BrowserSessionDto, SessionError> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            // Foreign session returns 404 indistinguishable from absent
            return Err(SessionError::NotFound);
        }
        Ok(session.to_dto())
    }
    pub async fn set_native_target_id(&self, session_id: &str, native_id: String) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.native_target_id = Some(native_id);
        }
    }

    pub async fn get_native_target_id(&self, session_id: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).and_then(|s| s.native_target_id.clone())
    }

    pub async fn session_exists_for_other(&self, session_id: &str, principal: &str) -> bool {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            session.owner_principal != principal
        } else {
            false
        }
    }

    pub async fn list_sessions(&self, principal: &str) -> Vec<BrowserSessionDto> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .filter(|s| s.owner_principal == principal && s.status != SessionStatus::Closed)
            .map(|s| s.to_dto())
            .collect()
    }

    pub async fn delete_session(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<(), SessionError> {
        let mut sessions = self.sessions.write().await;
        let session = match sessions.get_mut(session_id) {
            Some(s) => s,
            None => {
                // Idempotent delete: if creation records had it or it's absent, 404 or 200
                return Ok(());
            }
        };

        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }

        if session.status != SessionStatus::Closed {
            session.status = SessionStatus::Closed;
            session.input_available = false;
            session.lease = None;
            session.active_dialog = None;
            self.active_target_count.fetch_sub(1, Ordering::SeqCst);
        }

        Ok(())
    }

    pub async fn navigate(
        &self,
        session_id: &str,
        principal: &str,
        raw_url: &str,
        expected_revision: u64,
        allowed_origins: &[String],
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status == SessionStatus::Closed {
            return Err(SessionError::Conflict("cannot navigate closed session".to_string()));
        }

        if session.navigation_revision != expected_revision {
            return Err(SessionError::Conflict(format!(
                "stale navigationRevision (expected {}, current {})",
                expected_revision, session.navigation_revision
            )));
        }

        let parsed = validate_navigation_url(raw_url, session.is_dev, allowed_origins)?;
        session.url = parsed.to_string();
        session.navigation_revision = session.navigation_revision.saturating_add(1);

        Ok(session.to_dto())
    }

    pub async fn history(
        &self,
        session_id: &str,
        principal: &str,
        direction: &str,
        expected_revision: u64,
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status == SessionStatus::Closed {
            return Err(SessionError::Conflict("cannot navigate history on closed session".to_string()));
        }

        if session.navigation_revision != expected_revision {
            return Err(SessionError::Conflict(format!(
                "stale navigationRevision (expected {}, current {})",
                expected_revision, session.navigation_revision
            )));
        }

        if direction != "back" && direction != "forward" {
            return Err(SessionError::InvalidInput(
                "history direction must be 'back' or 'forward'".to_string(),
            ));
        }

        // In practice this triggers CDP Page.navigateToHistoryEntry; we advance revision
        session.navigation_revision = session.navigation_revision.saturating_add(1);

        Ok(session.to_dto())
    }

    pub async fn reload(
        &self,
        session_id: &str,
        principal: &str,
        expected_revision: u64,
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status == SessionStatus::Closed {
            return Err(SessionError::Conflict("cannot reload closed session".to_string()));
        }

        if session.navigation_revision != expected_revision {
            return Err(SessionError::Conflict(format!(
                "stale navigationRevision (expected {}, current {})",
                expected_revision, session.navigation_revision
            )));
        }

        session.navigation_revision = session.navigation_revision.saturating_add(1);

        Ok(session.to_dto())
    }

    pub async fn update_viewport(
        &self,
        session_id: &str,
        principal: &str,
        expected_viewport_epoch: u64,
        width: u32,
        height: u32,
        dpr: f64,
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status == SessionStatus::Closed {
            return Err(SessionError::Conflict("cannot update viewport of closed session".to_string()));
        }
        if session.viewport_epoch != expected_viewport_epoch {
            return Err(SessionError::Conflict(format!(
                "stale viewportEpoch (expected {}, current {})",
                expected_viewport_epoch, session.viewport_epoch
            )));
        }

        let clamped_w = width.clamp(MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
        let clamped_h = height.clamp(MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
        let clamped_dpr = dpr.clamp(MIN_DPR, MAX_DPR);

        // Epoch advances before command
        session.viewport_epoch = session.viewport_epoch.saturating_add(1);
        session.geometry.css_width = clamped_w as f64;
        session.geometry.css_height = clamped_h as f64;
        session.geometry.dpr = clamped_dpr;

        Ok(session.to_dto())
    }

    /// Handles popup creation.
    ///
    /// If cap is exceeded, sets popup_blocked on parent session and returns None.
    pub async fn handle_popup_created(
        &self,
        parent_session_id: &str,
        native_target_id: &str,
        url: &str,
    ) -> Result<Option<BrowserSessionDto>, SessionError> {
        let mut sessions = self.sessions.write().await;
        let parent = sessions.get_mut(parent_session_id).ok_or(SessionError::NotFound)?;
        let principal = parent.owner_principal.clone();
        let is_dev = parent.is_dev;
        let incarnation = parent.browser_incarnation.clone();
        let profile_epoch = parent.profile_epoch;
        let geometry = parent.geometry.clone();

        let current_count = self.active_target_count.load(Ordering::SeqCst);
        if current_count >= self.max_targets {
            parent.popup_blocked = true;
            return Ok(None);
        }

        let new_session_id = Uuid::new_v4().to_string();
        let new_session = BrowserSession {
            browser_session_id: new_session_id.clone(),
            browser_incarnation: incarnation,
            profile_epoch,
            navigation_revision: 1,
            viewport_epoch: 1,
            url: url.to_string(),
            title: "Popup".to_string(),
            status: SessionStatus::Running,
            geometry,
            input_available: true,
            unavailable_reason: None,
            owner_principal: principal,
            is_dev,
            native_target_id: Some(native_target_id.to_string()),
            creation_key: Uuid::new_v4().to_string(),
            lease: None,
            active_dialog: None,
            popup_blocked: false,
        };

        let dto = new_session.to_dto();
        sessions.insert(new_session_id, new_session);
        self.active_target_count.fetch_add(1, Ordering::SeqCst);

        Ok(Some(dto))
    }

    pub async fn update_title(&self, session_id: &str, title: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(s) = sessions.get_mut(session_id) {
            let mut truncated = title.to_string();
            if truncated.len() > MAX_TITLE_BYTES {
                truncated.truncate(MAX_TITLE_BYTES);
            }
            s.title = truncated;
        }
    }

    pub async fn close_principal_sessions(&self, principal: &str) {
        let mut sessions = self.sessions.write().await;
        let mut closed_count = 0;
        for s in sessions.values_mut() {
            if s.owner_principal == principal && s.status != SessionStatus::Closed {
                s.status = SessionStatus::Closed;
                s.input_available = false;
                s.lease = None;
                s.active_dialog = None;
                closed_count += 1;
            }
        }
        self.active_target_count.fetch_sub(closed_count, Ordering::SeqCst);
    }
    pub async fn fence_geometry_and_advance_epoch(
        &self,
        principal: &str,
        is_dev: bool,
        target_id: Option<&str>,
        width: Option<u32>,
        height: Option<u32>,
        dpr: Option<f64>,
    ) {
        let mut sessions = self.sessions.write().await;
        for s in sessions.values_mut() {
            if s.owner_principal == principal && s.is_dev == is_dev {
                let matches_target = match (target_id, &s.native_target_id) {
                    (Some(tid), Some(st_id)) => tid == st_id,
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                if matches_target {
                    s.viewport_epoch = s.viewport_epoch.saturating_add(1);
                    if let (Some(w), Some(h)) = (width, height) {
                        if w > 0 && h > 0 && (dpr.is_none() || dpr.unwrap() > 0.0) {
                            s.geometry.css_width = w as f64;
                            s.geometry.css_height = h as f64;
                            if let Some(d) = dpr {
                                s.geometry.dpr = d;
                            }
                            s.input_available = true;
                        } else {
                            s.input_available = false;
                        }
                    } else {
                        s.input_available = false;
                    }
                }
            }
        }
    }

    pub async fn reset_for_test(&self) {
        let mut sessions = self.sessions.write().await;
        sessions.clear();
        let mut recs = self.creation_records.write().await;
        recs.clear();
        self.active_target_count.store(0, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_idempotent_session_creation() {
        let registry = SessionRegistry::new(2);
        let creation_key = Uuid::new_v4().to_string();
        let req = CreateSessionRequest {
            creation_key: creation_key.clone(),
            url: "http://127.0.0.1:5173/test".to_string(),
            viewport: ViewportRequest {
                width: 1280,
                height: 900,
                dpr: 1.0,
            },
        };

        let allowed = vec!["http://127.0.0.1:5173".to_string()];

        // 1. Fresh creation
        let (dto1, is_fresh) = registry
            .create_or_idempotent_get("user1", true, "inc1", 1, &req, &allowed)
            .await
            .expect("should create session");
        assert!(is_fresh);
        assert_eq!(dto1.url, "http://127.0.0.1:5173/test");
        assert_eq!(registry.active_target_count(), 1);

        // 2. Replay with identical key and params returns same session with is_fresh = false
        let (dto2, is_fresh2) = registry
            .create_or_idempotent_get("user1", true, "inc1", 1, &req, &allowed)
            .await
            .expect("should return idempotent session");
        assert!(!is_fresh2);
        assert_eq!(dto1.browser_session_id, dto2.browser_session_id);
        assert_eq!(registry.active_target_count(), 1);

        // 3. Replay with same key but different url returns Conflict 409
        let req_diff_url = CreateSessionRequest {
            creation_key: creation_key.clone(),
            url: "http://127.0.0.1:5173/other".to_string(),
            viewport: req.viewport.clone(),
        };
        let err = registry
            .create_or_idempotent_get("user1", true, "inc1", 1, &req_diff_url, &allowed)
            .await
            .unwrap_err();
        assert!(matches!(err, SessionError::Conflict(_)));

        // 4. Different key creates second target
        let req2 = CreateSessionRequest {
            creation_key: Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:5173/test2".to_string(),
            viewport: req.viewport.clone(),
        };
        let (dto3, is_fresh3) = registry
            .create_or_idempotent_get("user1", true, "inc1", 1, &req2, &allowed)
            .await
            .expect("should create second session");
        assert!(is_fresh3);
        assert_ne!(dto1.browser_session_id, dto3.browser_session_id);
        assert_eq!(registry.active_target_count(), 2);

        // 5. Third target exceeds cap (2) -> Busy 429
        let req3 = CreateSessionRequest {
            creation_key: Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:5173/test3".to_string(),
            viewport: req.viewport.clone(),
        };
        let err_busy = registry
            .create_or_idempotent_get("user1", true, "inc1", 1, &req3, &allowed)
            .await
            .unwrap_err();
        assert!(matches!(err_busy, SessionError::Busy(_)));
    }

    #[tokio::test]
    async fn test_isolation_between_principals() {
        let registry = SessionRegistry::new(2);
        let req = CreateSessionRequest {
            creation_key: Uuid::new_v4().to_string(),
            url: "about:blank".to_string(),
            viewport: ViewportRequest {
                width: 1280,
                height: 900,
                dpr: 1.0,
            },
        };

        let (dto, _) = registry
            .create_or_idempotent_get("alice", true, "inc1", 1, &req, &[])
            .await
            .unwrap();

        // Alice can get her session
        assert!(registry.get_session(&dto.browser_session_id, "alice").await.is_ok());

        // Bob cannot see Alice's session (returns NotFound indistinguishable from absent)
        assert_eq!(
            registry.get_session(&dto.browser_session_id, "bob").await.unwrap_err(),
            SessionError::NotFound
        );

        // Bob listing sessions sees none
        assert_eq!(registry.list_sessions("bob").await.len(), 0);
        // Alice listing sessions sees 1
        assert_eq!(registry.list_sessions("alice").await.len(), 1);
    }
}
