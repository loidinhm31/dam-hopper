use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex, RwLock};
use uuid::Uuid;

use super::network_policy::{validate_navigation_url, NetworkPolicyError, MAX_TITLE_BYTES};
use super::protocol::{ServerControlEvent, TargetGeometry};

pub const MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL: usize = 128;
pub const IDEMPOTENCY_TTL: Duration = Duration::from_secs(600); // 10 minutes

/// Prefix of the URL fragment that tags a native page with the logical session it was created
/// for (`about:blank#dh-<browserSessionId>`). A lost `Target.createTarget` response is
/// reconciled by finding the page carrying this marker; the fragment is replaced as soon as the
/// session performs its first managed navigation.
pub const CREATION_MARKER_PREFIX: &str = "dh-";

/// URL of the native page created for `session_id` (carries the creation marker).
pub fn creation_marker_url(session_id: &str) -> String {
    format!("about:blank#{CREATION_MARKER_PREFIX}{session_id}")
}

/// Extracts the session id from a creation-marker URL; `None` for any other URL.
pub fn parse_creation_marker(url: &str) -> Option<&str> {
    let id = url
        .strip_prefix("about:blank#")?
        .strip_prefix(CREATION_MARKER_PREFIX)?;
    Uuid::parse_str(id).ok().map(|_| id)
}

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
    /// The native Chromium target could not be created, reconciled or closed. The logical
    /// session keeps its identity and capacity until the native outcome is proven.
    NativeUnavailable(String),
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
            Self::NativeUnavailable(msg) => {
                write!(f, "native browser target unavailable (502): {msg}")
            }
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
    /// Capacity reserved, native creation pending (single-flight) or failed ambiguously.
    Initializing,
    Running,
    /// Close requested; native absence not yet proven. Capacity is still held.
    Closing,
    /// Native target proven gone (destroyed, crash, browser stopped). Slot already freed.
    Lost,
    /// Native absence proven (or never existed). Slot freed.
    Closed,
}

impl SessionStatus {
    /// Statuses whose native page may still exist and therefore hold a logical target slot.
    pub fn holds_slot(self) -> bool {
        matches!(self, Self::Initializing | Self::Running | Self::Closing)
    }
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Initializing => write!(f, "initializing"),
            Self::Running => write!(f, "running"),
            Self::Closing => write!(f, "closing"),
            Self::Lost => write!(f, "lost"),
            Self::Closed => write!(f, "closed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportRequest {
    pub width: u32,
    pub height: u32,
    #[serde(alias = "deviceScaleFactor")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLeaseSummary {
    pub viewer_id: String,
    pub holder_kind: String, // "human" | "agent"
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDialogSummary {
    pub dialog_id: String,
    pub message: String,
    pub dialog_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub pending_api_navigation_at: Option<Instant>,
    pub popup_blocked: bool,
    pub created_at: Instant,
    /// Set when the session becomes `Closed` or `Lost`; drives TTL reaping.
    pub retired_at: Option<Instant>,
    /// A `Target.createTarget` was sent for this session: a page may exist even when the
    /// response was lost, so retries reconcile by creation marker before creating again.
    pub native_create_attempted: bool,
    /// Lazily allocated, single latest-state slot; never a queue of navigation events.
    updates: Option<watch::Sender<ServerControlEvent>>,
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

    fn updated_event(&self) -> ServerControlEvent {
        ServerControlEvent::SessionUpdated {
            session: Box::new(self.to_dto()),
        }
    }

    /// Called under the registry write lock, so snapshots and mutations share one ordering.
    /// No DTO allocation without receivers. Terminal publication also closes their channel.
    fn publish_update(&mut self) {
        let Some(updates) = self.updates.take() else {
            return;
        };
        if updates.receiver_count() == 0 {
            return;
        }
        updates.send_replace(self.updated_event());
        if self.status.holds_slot() {
            self.updates = Some(updates);
        }
    }

    fn retire(&mut self, status: SessionStatus, reason: Option<String>) {
        self.status = status;
        self.input_available = false;
        self.lease = None;
        self.active_dialog = None;
        if self.unavailable_reason.is_none() || reason.is_some() {
            self.unavailable_reason = reason;
        }
        if self.retired_at.is_none() {
            self.retired_at = Some(Instant::now());
        }
        self.publish_update();
    }
}

/// Immutable view of the publication-relevant state of one session.
#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    pub dto: BrowserSessionDto,
    pub status: SessionStatus,
    pub native_create_attempted: bool,
    pub native_target_id: Option<String>,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub is_dev: bool,
}

#[derive(Debug, Clone)]
struct CreationRecord {
    url: String,
    viewport: ViewportRequest,
    session_id: String,
    created_at: Instant,
}

/// A native page admitted without a REST create (raw CDP or startup inventory): it holds one
/// logical target slot but has no browser session.
#[derive(Debug, Clone)]
struct RawTarget {
    owner_principal: String,
}

#[derive(Default)]
struct RegistryInner {
    sessions: HashMap<String, BrowserSession>,
    /// principal -> (creation_key -> record)
    creation_records: HashMap<String, HashMap<String, CreationRecord>>,
    /// (browser_incarnation, native_target_id) -> raw slot
    raw_targets: HashMap<(String, String), RawTarget>,
    /// Single-flight creation/publication gate per session id.
    gates: HashMap<String, Arc<Mutex<()>>>,
}

impl RegistryInner {
    fn occupied(&self) -> usize {
        self.sessions
            .values()
            .filter(|s| s.status.holds_slot())
            .count()
            + self.raw_targets.len()
    }

    fn gate(&mut self, session_id: &str) -> Arc<Mutex<()>> {
        self.gates
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Drops expired idempotency records, then retired sessions whose required retry TTL has
    /// elapsed. Live records, and results still promised by an unexpired creation record, are
    /// preserved. Returns the number of reaped sessions.
    fn reap(&mut self, now: Instant) -> usize {
        for records in self.creation_records.values_mut() {
            records.retain(|_, r| now.saturating_duration_since(r.created_at) < IDEMPOTENCY_TTL);
        }
        self.creation_records
            .retain(|_, records| !records.is_empty());
        let promised: std::collections::HashSet<&str> = self
            .creation_records
            .values()
            .flat_map(|records| records.values().map(|r| r.session_id.as_str()))
            .collect();
        let expired: Vec<String> = self
            .sessions
            .iter()
            .filter(|(id, s)| {
                if promised.contains(id.as_str()) {
                    return false;
                }
                match s.status {
                    SessionStatus::Closed | SessionStatus::Lost => s
                        .retired_at
                        .is_some_and(|at| now.saturating_duration_since(at) >= IDEMPOTENCY_TTL),
                    // A creation that never obtained native identity and whose retry window is
                    // over cannot be resumed anymore; free its reserved slot.
                    SessionStatus::Initializing => {
                        s.native_target_id.is_none()
                            && now.saturating_duration_since(s.created_at) >= IDEMPOTENCY_TTL
                    }
                    SessionStatus::Running | SessionStatus::Closing => false,
                }
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &expired {
            self.sessions.remove(id);
            self.gates.remove(id);
        }
        expired.len()
    }
}

/// Identity of one session leaving the live set, for resource retirement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDeparture {
    pub session_id: String,
    pub principal: String,
    pub browser_incarnation: String,
    /// `Closed` when a requested close was proven; `Lost` when the page vanished unrequested.
    pub outcome: SessionStatus,
}

/// Outcome of binding a native page to a pending logical session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindOutcome {
    /// The page is (now) the session's native identity.
    Bound,
    /// The session already has a different native page; the offered page is surplus.
    Surplus { existing: String },
    /// The session is not awaiting native identity (closed, lost, other incarnation, unknown).
    NotPending,
}

/// Classification of a native page by the registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetClass {
    Session {
        session_id: String,
        status: SessionStatus,
    },
    Raw,
    Unknown,
}

#[allow(clippy::large_enum_variant)] // transient admission result carrying the session DTO
#[derive(Debug, Clone)]
pub enum PopupAdmission {
    /// Slot reserved: the popup is a new `Initializing` session awaiting policy adoption.
    Admitted {
        session: BrowserSessionDto,
        parent_session_id: String,
        principal: String,
        is_dev: bool,
    },
    /// Cap reached: the opener session is flagged `popupBlocked`; the caller closes the page.
    Blocked { parent_session_id: String },
    /// The opener is not a managed session of this incarnation.
    NotAPopup,
}

/// What `begin_close` found for a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloseAction {
    /// Already `Closed`, or `Lost` (promoted to `Closed`): nothing native remains.
    Retired,
    /// Session is `Closing`; the caller must prove native absence of `target_id` (or, when the
    /// identity is unknown, of any page carrying the creation marker).
    Native {
        target_id: Option<String>,
        browser_incarnation: String,
        is_dev: bool,
    },
}

/// What `rollback_creation` did with a failed pending creation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RollbackOutcome {
    /// No native page identity: the pending session and its record were removed.
    Removed,
    /// A native page exists: the session is `Closing` until the caller proves its absence.
    Closing {
        target_id: String,
    },
    NoOp,
}

#[allow(clippy::large_enum_variant)] // transient reservation result carrying the session DTO
pub enum CreateReservation {
    /// Idempotent hit on a committed/retired session: no native work is needed.
    Existing(BrowserSessionDto),
    /// Capacity is reserved for `session_id` (fresh or retried). The caller drives native
    /// creation under the session's single-flight gate (`session_gate`); whoever finds the
    /// session still `Initializing` under the gate is the single leader.
    Pending { session_id: String },
}

pub struct CreateParams<'a> {
    pub principal: &'a str,
    pub is_dev: bool,
    pub browser_incarnation: &'a str,
    pub profile_epoch: u64,
    pub request: &'a CreateSessionRequest,
    pub allowed_origins: &'a [String],
    /// Configured logical target cap (shared by REST, popup and raw-created pages).
    pub max_targets: usize,
}

fn initial_geometry(viewport: &ViewportRequest) -> TargetGeometry {
    TargetGeometry {
        css_width: viewport.width as f64,
        css_height: viewport.height as f64,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: viewport.dpr,
    }
}

pub struct SessionRegistry {
    inner: RwLock<RegistryInner>,
    /// Mirror of `RegistryInner::occupied`, refreshed after every mutation under the lock.
    active_target_count: AtomicUsize,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(RegistryInner::default()),
            active_target_count: AtomicUsize::new(0),
        }
    }

    /// Logical target slots currently held (sessions that may still own a native page plus
    /// admitted raw pages).
    pub fn active_target_count(&self) -> usize {
        self.active_target_count.load(Ordering::SeqCst)
    }

    fn publish_count(&self, inner: &RegistryInner) {
        self.active_target_count
            .store(inner.occupied(), Ordering::SeqCst);
    }

    /// Reserves capacity for a creation and records its idempotency key, or resolves an
    /// idempotent retry. `live` is evaluated under the registry lock: a reset or logout that
    /// advanced the epoch before this call is rejected, and one that advances it afterwards
    /// closes the inserted session through its fence (which needs this same lock).
    pub async fn reserve_creation(
        &self,
        p: &CreateParams<'_>,
        live: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<CreateReservation, SessionError> {
        Uuid::parse_str(&p.request.creation_key).map_err(|e| {
            SessionError::InvalidInput(format!("creationKey must be a valid UUID: {e}"))
        })?;
        let parsed_url = validate_navigation_url(&p.request.url, p.is_dev, p.allowed_origins)?;
        let viewport = p.request.viewport.sanitize();

        let mut inner = self.inner.write().await;
        if !live() {
            return Err(SessionError::Conflict(
                "browser profile or instance changed while the session was being created"
                    .to_string(),
            ));
        }
        let now = Instant::now();
        inner.reap(now);

        let existing = inner
            .creation_records
            .get(p.principal)
            .and_then(|recs| recs.get(&p.request.creation_key))
            .cloned();
        if let Some(rec) = existing {
            let vp_matches = rec.viewport.width == viewport.width
                && rec.viewport.height == viewport.height
                && (rec.viewport.dpr - viewport.dpr).abs() < f64::EPSILON;
            if rec.url != p.request.url || !vp_matches {
                return Err(SessionError::Conflict(
                    "creationKey reused with different url or viewport parameters".to_string(),
                ));
            }
            if let Some(session) = inner.sessions.get(&rec.session_id) {
                if session.owner_principal == p.principal {
                    if session.status == SessionStatus::Initializing {
                        let session_id = rec.session_id.clone();
                        return Ok(CreateReservation::Pending { session_id });
                    }
                    return Ok(CreateReservation::Existing(session.to_dto()));
                }
            }
        }

        if inner.occupied() >= p.max_targets {
            return Err(SessionError::Busy(format!(
                "global browser target capacity ({}) reached",
                p.max_targets
            )));
        }
        let record_count = inner
            .creation_records
            .get(p.principal)
            .map_or(0, HashMap::len);
        if record_count >= MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL {
            return Err(SessionError::Busy(format!(
                "idempotency record capacity ({}) reached for principal",
                MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL
            )));
        }

        let session_id = Uuid::new_v4().to_string();
        let session = BrowserSession {
            browser_session_id: session_id.clone(),
            browser_incarnation: p.browser_incarnation.to_string(),
            profile_epoch: p.profile_epoch,
            navigation_revision: 1,
            viewport_epoch: 1,
            url: parsed_url.to_string(),
            title: "New Tab".to_string(),
            status: SessionStatus::Initializing,
            geometry: initial_geometry(&viewport),
            input_available: false,
            unavailable_reason: None,
            owner_principal: p.principal.to_string(),
            is_dev: p.is_dev,
            native_target_id: None,
            creation_key: p.request.creation_key.clone(),
            lease: None,
            active_dialog: None,
            popup_blocked: false,
            pending_api_navigation_at: None,
            created_at: now,
            retired_at: None,
            native_create_attempted: false,
            updates: None,
        };
        inner.sessions.insert(session_id.clone(), session);
        inner
            .creation_records
            .entry(p.principal.to_string())
            .or_default()
            .insert(
                p.request.creation_key.clone(),
                CreationRecord {
                    url: p.request.url.clone(),
                    viewport,
                    session_id: session_id.clone(),
                    created_at: now,
                },
            );
        self.publish_count(&inner);
        Ok(CreateReservation::Pending { session_id })
    }

    /// Inserts a `Running` session with no native page, bypassing native creation. Test support
    /// for suites that attach mock producers; production creation goes through
    /// `reserve_creation` and the manager-owned native allocation.
    #[doc(hidden)]
    pub async fn insert_running_for_test(
        &self,
        principal: &str,
        is_dev: bool,
        browser_incarnation: &str,
        profile_epoch: u64,
        req: &CreateSessionRequest,
        allowed_origins: &[String],
    ) -> Result<(BrowserSessionDto, bool), SessionError> {
        let params = CreateParams {
            principal,
            is_dev,
            browser_incarnation,
            profile_epoch,
            request: req,
            allowed_origins,
            max_targets: usize::MAX,
        };
        match self.reserve_creation(&params, &|| true).await? {
            CreateReservation::Existing(dto) => Ok((dto, false)),
            CreateReservation::Pending { session_id } => {
                let mut inner = self.inner.write().await;
                let session = inner
                    .sessions
                    .get_mut(&session_id)
                    .ok_or(SessionError::NotFound)?;
                let fresh = session.status == SessionStatus::Initializing;
                if fresh {
                    session.status = SessionStatus::Running;
                    session.input_available = true;
                    session.publish_update();
                }
                Ok((session.to_dto(), fresh))
            }
        }
    }

    pub async fn get_session(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<BrowserSessionDto, SessionError> {
        let inner = self.inner.read().await;
        let session = inner
            .sessions
            .get(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            // Foreign session returns 404 indistinguishable from absent
            return Err(SessionError::NotFound);
        }
        Ok(session.to_dto())
    }

    /// Subscribe to exactly the session/runtime authorized by a consumed attachment ticket.
    /// Creating/subscribing under the mutation lock closes the snapshot/subscription race;
    /// callers read the receiver's initial value before awaiting subsequent changes.
    pub async fn subscribe_session(
        &self,
        session_id: &str,
        principal: &str,
        is_dev: bool,
        profile_epoch: u64,
        browser_incarnation: &str,
    ) -> Result<watch::Receiver<ServerControlEvent>, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner.sessions.get_mut(session_id).ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal
            || session.is_dev != is_dev
            || session.profile_epoch != profile_epoch
            || session.browser_incarnation != browser_incarnation
        {
            return Err(SessionError::NotFound);
        }
        if let Some(updates) = &session.updates {
            return Ok(updates.subscribe());
        }
        let (updates, receiver) = watch::channel(session.updated_event());
        if session.status.holds_slot() {
            session.updates = Some(updates);
        }
        Ok(receiver)
    }

    pub async fn snapshot(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<SessionSnapshot, SessionError> {
        let inner = self.inner.read().await;
        let session = inner
            .sessions
            .get(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        Ok(SessionSnapshot {
            dto: session.to_dto(),
            status: session.status,
            native_target_id: session.native_target_id.clone(),
            browser_incarnation: session.browser_incarnation.clone(),
            profile_epoch: session.profile_epoch,
            native_create_attempted: session.native_create_attempted,
            is_dev: session.is_dev,
        })
    }

    /// Per-session single-flight gate for creation/publication of its producer.
    pub async fn session_gate(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<Arc<Mutex<()>>, SessionError> {
        let mut inner = self.inner.write().await;
        match inner.sessions.get(session_id) {
            Some(s) if s.owner_principal == principal => {}
            _ => return Err(SessionError::NotFound),
        }
        Ok(inner.gate(session_id))
    }

    pub async fn get_native_target_id(&self, session_id: &str) -> Option<String> {
        let inner = self.inner.read().await;
        inner
            .sessions
            .get(session_id)
            .and_then(|s| s.native_target_id.clone())
    }

    /// Offers a native page as the identity of a session awaiting one. Idempotent for the same
    /// page; a different page is `Surplus` (the caller closes it, never the bound one).
    pub async fn bind_native_target(
        &self,
        session_id: &str,
        browser_incarnation: &str,
        target_id: &str,
    ) -> BindOutcome {
        let mut inner = self.inner.write().await;
        let Some(session) = inner.sessions.get_mut(session_id) else {
            return BindOutcome::NotPending;
        };
        if session.browser_incarnation != browser_incarnation
            || !matches!(
                session.status,
                SessionStatus::Initializing | SessionStatus::Running
            )
        {
            return BindOutcome::NotPending;
        }
        match &session.native_target_id {
            Some(existing) if existing == target_id => BindOutcome::Bound,
            Some(existing) => BindOutcome::Surplus {
                existing: existing.clone(),
            },
            None => {
                session.native_target_id = Some(target_id.to_string());
                session.unavailable_reason = None;
                session.publish_update();
                BindOutcome::Bound
            }
        }
    }

    /// Records that a native create is about to be sent for a pending session.
    pub async fn mark_create_attempted(&self, session_id: &str) {
        let mut inner = self.inner.write().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            session.native_create_attempted = true;
        }
    }

    /// Records why native creation of a pending session has not completed (still retryable).
    pub async fn note_creation_error(&self, session_id: &str, message: &str) {
        let mut inner = self.inner.write().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            if session.status == SessionStatus::Initializing {
                session.unavailable_reason = Some(message.to_string());
                session.publish_update();
            }
        }
    }

    /// Publishes a pending session as `Running`. Fails when the session was closed/lost/reaped
    /// in the meantime or when `live` (evaluated under the lock) reports a changed
    /// epoch/incarnation, so a late create can never resurrect across reset or logout.
    pub async fn commit_running(
        &self,
        session_id: &str,
        live: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.status != SessionStatus::Initializing || session.native_target_id.is_none() {
            return Err(SessionError::Conflict(format!(
                "session is {} and can no longer be published",
                session.status
            )));
        }
        if !live() {
            return Err(SessionError::Conflict(
                "browser profile or instance changed before the session was published".to_string(),
            ));
        }
        session.status = SessionStatus::Running;
        session.input_available = true;
        session.unavailable_reason = None;
        session.publish_update();
        Ok(session.to_dto())
    }

    /// Abandons a creation that failed after reservation. Without native identity the pending
    /// session and its idempotency record are removed (same-key retry starts fresh); with one
    /// the session becomes `Closing` so its slot is held until absence is proven.
    pub async fn rollback_creation(&self, session_id: &str) -> RollbackOutcome {
        let mut inner = self.inner.write().await;
        let Some(session) = inner.sessions.get_mut(session_id) else {
            return RollbackOutcome::NoOp;
        };
        if session.status != SessionStatus::Initializing {
            return RollbackOutcome::NoOp;
        }
        if let Some(target_id) = session.native_target_id.clone() {
            session.status = SessionStatus::Closing;
            session.input_available = false;
            session.publish_update();
            self.publish_count(&inner);
            return RollbackOutcome::Closing { target_id };
        }
        let principal = session.owner_principal.clone();
        let key = session.creation_key.clone();
        session.retire(SessionStatus::Closed, None);
        inner.sessions.remove(session_id);
        inner.gates.remove(session_id);
        if let Some(recs) = inner.creation_records.get_mut(&principal) {
            if recs.get(&key).is_some_and(|r| r.session_id == session_id) {
                recs.remove(&key);
            }
        }
        self.publish_count(&inner);
        RollbackOutcome::Removed
    }

    /// Starts (or resumes) closing a session: it becomes `Closing`, keeping identity and slot
    /// until absence is proven via `finish_close`. A `Lost`/`Closed` session has nothing native
    /// left.
    pub async fn begin_close(
        &self,
        session_id: &str,
        principal: &str,
    ) -> Result<CloseAction, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        match session.status {
            SessionStatus::Closed => Ok(CloseAction::Retired),
            SessionStatus::Lost => {
                session.retire(SessionStatus::Closed, None);
                Ok(CloseAction::Retired)
            }
            SessionStatus::Initializing | SessionStatus::Running | SessionStatus::Closing => {
                session.status = SessionStatus::Closing;
                session.input_available = false;
                session.lease = None;
                session.active_dialog = None;
                session.publish_update();
                let action = CloseAction::Native {
                    target_id: session.native_target_id.clone(),
                    browser_incarnation: session.browser_incarnation.clone(),
                    is_dev: session.is_dev,
                };
                self.publish_count(&inner);
                Ok(action)
            }
        }
    }

    /// Native absence of a `Closing` session is proven: free its slot. With `forget` the
    /// session and its idempotency record are dropped (a failed creation never promised a
    /// result); otherwise the retired record is kept for its retry TTL.
    pub async fn finish_close(&self, session_id: &str, forget: bool) {
        let mut inner = self.inner.write().await;
        let Some(session) = inner.sessions.get_mut(session_id) else {
            return;
        };
        if session.status == SessionStatus::Closing {
            session.retire(SessionStatus::Closed, None);
        }
        if forget && session.status == SessionStatus::Closed {
            let principal = session.owner_principal.clone();
            let key = session.creation_key.clone();
            inner.sessions.remove(session_id);
            inner.gates.remove(session_id);
            if let Some(recs) = inner.creation_records.get_mut(&principal) {
                if recs.get(&key).is_some_and(|r| r.session_id == session_id) {
                    recs.remove(&key);
                }
            }
        }
        self.publish_count(&inner);
    }

    /// Classifies a native page against the registry.
    pub async fn classify_target(&self, browser_incarnation: &str, target_id: &str) -> TargetClass {
        let inner = self.inner.read().await;
        if let Some(s) = inner.sessions.values().find(|s| {
            s.browser_incarnation == browser_incarnation
                && s.native_target_id.as_deref() == Some(target_id)
                && s.status.holds_slot()
        }) {
            return TargetClass::Session {
                session_id: s.browser_session_id.clone(),
                status: s.status,
            };
        }
        if inner
            .raw_targets
            .contains_key(&(browser_incarnation.to_string(), target_id.to_string()))
        {
            return TargetClass::Raw;
        }
        TargetClass::Unknown
    }

    /// Admits an unmanaged native page (raw CDP create, startup inventory) against the shared
    /// cap. Raw authority is not a cap exemption: `false` means the caller must close it.
    pub async fn admit_raw(
        &self,
        browser_incarnation: &str,
        principal: &str,
        target_id: &str,
        max_targets: usize,
    ) -> bool {
        let mut inner = self.inner.write().await;
        let key = (browser_incarnation.to_string(), target_id.to_string());
        if inner.raw_targets.contains_key(&key) {
            return true;
        }
        if inner.occupied() >= max_targets {
            return false;
        }
        inner.raw_targets.insert(
            key,
            RawTarget {
                owner_principal: principal.to_string(),
            },
        );
        self.publish_count(&inner);
        true
    }

    /// Admits a `window.open` popup of a managed session against the shared cap. An admitted
    /// popup is a new `Initializing` session bound to the page; it is published after the
    /// request policy has been installed on it.
    pub async fn admit_popup(
        &self,
        browser_incarnation: &str,
        opener_target_id: &str,
        target_id: &str,
        url: &str,
        max_targets: usize,
    ) -> PopupAdmission {
        let mut inner = self.inner.write().await;
        let Some(parent_id) = inner
            .sessions
            .values()
            .find(|s| {
                s.browser_incarnation == browser_incarnation
                    && s.native_target_id.as_deref() == Some(opener_target_id)
                    && s.status.holds_slot()
            })
            .map(|s| s.browser_session_id.clone())
        else {
            return PopupAdmission::NotAPopup;
        };
        if inner.occupied() >= max_targets {
            if let Some(parent) = inner.sessions.get_mut(&parent_id) {
                parent.popup_blocked = true;
                parent.publish_update();
            }
            return PopupAdmission::Blocked {
                parent_session_id: parent_id,
            };
        }
        let parent = &inner.sessions[&parent_id];
        let principal = parent.owner_principal.clone();
        let is_dev = parent.is_dev;
        let session_id = Uuid::new_v4().to_string();
        let session = BrowserSession {
            browser_session_id: session_id.clone(),
            browser_incarnation: parent.browser_incarnation.clone(),
            profile_epoch: parent.profile_epoch,
            navigation_revision: 1,
            viewport_epoch: 1,
            url: url.to_string(),
            title: "Popup".to_string(),
            status: SessionStatus::Initializing,
            geometry: parent.geometry.clone(),
            input_available: false,
            unavailable_reason: None,
            owner_principal: principal.clone(),
            is_dev,
            native_target_id: Some(target_id.to_string()),
            creation_key: Uuid::new_v4().to_string(),
            lease: None,
            active_dialog: None,
            popup_blocked: false,
            pending_api_navigation_at: None,
            created_at: Instant::now(),
            retired_at: None,
            native_create_attempted: false,
            updates: None,
        };
        let dto = session.to_dto();
        inner.sessions.insert(session_id, session);
        self.publish_count(&inner);
        PopupAdmission::Admitted {
            session: dto,
            parent_session_id: parent_id,
            principal,
            is_dev,
        }
    }

    /// A native page is proven gone (destroyed event). A `Closing` session becomes `Closed`;
    /// a live one becomes `Lost`. Slots are freed only here, on proven absence.
    pub async fn native_destroyed(
        &self,
        browser_incarnation: &str,
        target_id: &str,
    ) -> Option<SessionDeparture> {
        let mut inner = self.inner.write().await;
        if inner
            .raw_targets
            .remove(&(browser_incarnation.to_string(), target_id.to_string()))
            .is_some()
        {
            self.publish_count(&inner);
            return None;
        }
        let departure = inner
            .sessions
            .values_mut()
            .find(|s| {
                s.browser_incarnation == browser_incarnation
                    && s.native_target_id.as_deref() == Some(target_id)
                    && s.status.holds_slot()
            })
            .map(|s| Self::depart(s, "native target was destroyed"));
        self.publish_count(&inner);
        departure
    }

    /// Every native page of a browser incarnation is gone (crash, stop, reset): retire all of
    /// its sessions and raw slots.
    pub async fn retire_incarnation(
        &self,
        browser_incarnation: &str,
        reason: &str,
    ) -> Vec<SessionDeparture> {
        let mut inner = self.inner.write().await;
        inner
            .raw_targets
            .retain(|(incarnation, _), _| incarnation != browser_incarnation);
        let departures = inner
            .sessions
            .values_mut()
            .filter(|s| s.browser_incarnation == browser_incarnation && s.status.holds_slot())
            .map(|s| Self::depart(s, reason))
            .collect();
        self.publish_count(&inner);
        departures
    }

    fn depart(session: &mut BrowserSession, reason: &str) -> SessionDeparture {
        let outcome = if session.status == SessionStatus::Closing {
            SessionStatus::Closed
        } else {
            SessionStatus::Lost
        };
        let reason = (outcome == SessionStatus::Lost).then(|| reason.to_string());
        session.retire(outcome, reason);
        SessionDeparture {
            session_id: session.browser_session_id.clone(),
            principal: session.owner_principal.clone(),
            browser_incarnation: session.browser_incarnation.clone(),
            outcome,
        }
    }

    /// Principal-wide fence (reset/logout): closes every non-closed session and releases the
    /// principal's raw slots in one critical section. Returns the ids that were closed.
    pub async fn close_principal_sessions(&self, principal: &str) -> Vec<String> {
        let mut inner = self.inner.write().await;
        let mut closed = Vec::new();
        for s in inner.sessions.values_mut() {
            if s.owner_principal == principal && s.status != SessionStatus::Closed {
                s.retire(SessionStatus::Closed, None);
                closed.push(s.browser_session_id.clone());
            }
        }
        inner
            .raw_targets
            .retain(|_, raw| raw.owner_principal != principal);
        self.publish_count(&inner);
        closed
    }

    /// `(session_id, native_target_id)` of every slot-holding session of an incarnation that
    /// has a native identity; used to detect pages that vanished while events were lost.
    pub async fn bound_targets(&self, browser_incarnation: &str) -> Vec<(String, String)> {
        let inner = self.inner.read().await;
        inner
            .sessions
            .values()
            .filter(|s| s.browser_incarnation == browser_incarnation && s.status.holds_slot())
            .filter_map(|s| {
                s.native_target_id
                    .clone()
                    .map(|t| (s.browser_session_id.clone(), t))
            })
            .collect()
    }

    /// Drops raw slots of an incarnation whose page is no longer in `present` (inventory proof
    /// of absence after lost destroy events).
    pub async fn retain_raw_targets(
        &self,
        browser_incarnation: &str,
        present: &std::collections::HashSet<&str>,
    ) {
        let mut inner = self.inner.write().await;
        inner.raw_targets.retain(|(incarnation, target_id), _| {
            incarnation != browser_incarnation || present.contains(target_id.as_str())
        });
        self.publish_count(&inner);
    }
    pub async fn session_exists_for_other(&self, session_id: &str, principal: &str) -> bool {
        let inner = self.inner.read().await;
        if let Some(session) = inner.sessions.get(session_id) {
            session.owner_principal != principal
        } else {
            false
        }
    }

    /// Lists every session of the principal that is not `Closed`, including `Closing` and
    /// `Lost` ones so their truth stays observable until deleted or reaped.
    pub async fn list_sessions(&self, principal: &str) -> Vec<BrowserSessionDto> {
        let inner = self.inner.read().await;
        inner
            .sessions
            .values()
            .filter(|s| s.owner_principal == principal && s.status != SessionStatus::Closed)
            .map(|s| s.to_dto())
            .collect()
    }

    /// Removes retired sessions whose retry TTL elapsed at `now` (see `RegistryInner::reap`).
    pub async fn reap_expired_at(&self, now: Instant) -> usize {
        let mut inner = self.inner.write().await;
        let reaped = inner.reap(now);
        self.publish_count(&inner);
        reaped
    }

    /// Number of session records retained (live and retired), for retention checks.
    pub async fn retained_session_count(&self) -> usize {
        self.inner.read().await.sessions.len()
    }

    pub async fn navigate(
        &self,
        session_id: &str,
        principal: &str,
        raw_url: &str,
        expected_revision: u64,
        allowed_origins: &[String],
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status != SessionStatus::Running {
            return Err(SessionError::Conflict(format!(
                "cannot navigate {} session",
                session.status
            )));
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
        session.publish_update();

        Ok(session.to_dto())
    }

    pub async fn history(
        &self,
        session_id: &str,
        principal: &str,
        direction: &str,
        expected_revision: u64,
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status != SessionStatus::Running {
            return Err(SessionError::Conflict(format!(
                "cannot navigate history on {} session",
                session.status
            )));
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
        session.publish_update();

        Ok(session.to_dto())
    }

    pub async fn reload(
        &self,
        session_id: &str,
        principal: &str,
        expected_revision: u64,
    ) -> Result<BrowserSessionDto, SessionError> {
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status != SessionStatus::Running {
            return Err(SessionError::Conflict(format!(
                "cannot reload {} session",
                session.status
            )));
        }

        if session.navigation_revision != expected_revision {
            return Err(SessionError::Conflict(format!(
                "stale navigationRevision (expected {}, current {})",
                expected_revision, session.navigation_revision
            )));
        }

        session.navigation_revision = session.navigation_revision.saturating_add(1);
        session.publish_update();

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
        let mut inner = self.inner.write().await;
        let session = inner
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        if session.owner_principal != principal {
            return Err(SessionError::NotFound);
        }
        if session.status != SessionStatus::Running {
            return Err(SessionError::Conflict(format!(
                "cannot update viewport of {} session",
                session.status
            )));
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
        session.publish_update();

        Ok(session.to_dto())
    }

    pub async fn update_title(&self, session_id: &str, title: &str) {
        let mut inner = self.inner.write().await;
        if let Some(s) = inner.sessions.get_mut(session_id) {
            let mut end = title.len().min(MAX_TITLE_BYTES);
            while !title.is_char_boundary(end) {
                end -= 1;
            }
            if s.title != title[..end] {
                s.title = title[..end].to_string();
                s.publish_update();
            }
        }
    }
    /// Marks that an API-originated navigation (`navigate`/`history`/`reload`) just bumped
    /// `navigation_revision` and is dispatching CDP navigation, so the immediate CDP
    /// `Page.frameNavigated` / `Page.navigatedWithinDocument` update synchronizes `url`
    /// without double-incrementing `navigation_revision`.
    pub async fn mark_api_navigation_pending(&self, session_id: &str) {
        let mut inner = self.inner.write().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            session.pending_api_navigation_at = Some(Instant::now());
        }
    }

    /// Record an asynchronous renderer-initiated navigation (e.g. link click, History API pushState,
    /// or fragment change) observed via CDP, bumping `navigation_revision` and updating `url` if valid.
    pub async fn record_cdp_navigation(
        &self,
        session_id: &str,
        raw_url: Option<&str>,
        allowed_origins: &[String],
    ) -> Option<u64> {
        let mut inner = self.inner.write().await;
        let session = inner.sessions.get_mut(session_id)?;
        if !matches!(
            session.status,
            SessionStatus::Initializing | SessionStatus::Running
        ) {
            return None;
        }
        let skip_bump = session
            .pending_api_navigation_at
            .take()
            .is_some_and(|at| at.elapsed() < Duration::from_secs(5));
        if !skip_bump {
            session.navigation_revision = session.navigation_revision.saturating_add(1);
        }
        if let Some(url) = raw_url {
            if let Ok(parsed) = validate_navigation_url(url, session.is_dev, allowed_origins) {
                session.url = parsed.to_string();
            }
        }
        session.publish_update();
        Some(session.navigation_revision)
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
        let mut inner = self.inner.write().await;
        for s in inner.sessions.values_mut() {
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
                    s.publish_update();
                }
            }
        }
    }

    pub async fn reset_for_test(&self) {
        let mut inner = self.inner.write().await;
        *inner = RegistryInner::default();
        self.publish_count(&inner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(key: &str, url: &str) -> CreateSessionRequest {
        CreateSessionRequest {
            creation_key: key.to_string(),
            url: url.to_string(),
            viewport: ViewportRequest {
                width: 1280,
                height: 900,
                dpr: 1.0,
            },
        }
    }

    fn params<'a>(
        principal: &'a str,
        req: &'a CreateSessionRequest,
        allowed: &'a [String],
        max_targets: usize,
    ) -> CreateParams<'a> {
        CreateParams {
            principal,
            is_dev: true,
            browser_incarnation: "inc1",
            profile_epoch: 1,
            request: req,
            allowed_origins: allowed,
            max_targets,
        }
    }

    async fn reserve(
        registry: &SessionRegistry,
        p: &CreateParams<'_>,
    ) -> Result<CreateReservation, SessionError> {
        registry.reserve_creation(p, &|| true).await
    }

    fn pending_id(r: CreateReservation) -> String {
        match r {
            CreateReservation::Pending { session_id } => session_id,
            CreateReservation::Existing(_) => panic!("expected pending reservation"),
        }
    }

    #[tokio::test]
    async fn test_idempotent_session_creation() {
        let registry = SessionRegistry::new();
        let creation_key = Uuid::new_v4().to_string();
        let req = request(&creation_key, "http://127.0.0.1:5173/test");
        let allowed = vec!["http://127.0.0.1:5173".to_string()];

        // 1. Fresh reservation holds a slot while pending.
        let id1 = pending_id(
            reserve(&registry, &params("user1", &req, &allowed, 2))
                .await
                .unwrap(),
        );
        assert_eq!(registry.active_target_count(), 1);

        // 2. Same-key retry while pending coalesces onto the same session (no second slot).
        let id1b = pending_id(
            reserve(&registry, &params("user1", &req, &allowed, 2))
                .await
                .unwrap(),
        );
        assert_eq!(id1, id1b);
        assert_eq!(registry.active_target_count(), 1);

        // 3. Replay with same key but different url returns Conflict 409
        let req_diff_url = request(&creation_key, "http://127.0.0.1:5173/other");
        let err = reserve(&registry, &params("user1", &req_diff_url, &allowed, 2))
            .await
            .err()
            .unwrap();
        assert!(matches!(err, SessionError::Conflict(_)));

        // 4. Different key reserves a second target
        let req2 = request(&Uuid::new_v4().to_string(), "http://127.0.0.1:5173/test2");
        let id2 = pending_id(
            reserve(&registry, &params("user1", &req2, &allowed, 2))
                .await
                .unwrap(),
        );
        assert_ne!(id1, id2);
        assert_eq!(registry.active_target_count(), 2);

        // 5. Third target exceeds cap (2) -> Busy 429
        let req3 = request(&Uuid::new_v4().to_string(), "http://127.0.0.1:5173/test3");
        let err_busy = reserve(&registry, &params("user1", &req3, &allowed, 2))
            .await
            .err()
            .unwrap();
        assert!(matches!(err_busy, SessionError::Busy(_)));

        // 6. Publishing makes the retry an idempotent hit that is not fresh.
        assert_eq!(
            registry.bind_native_target(&id1, "inc1", "T1").await,
            BindOutcome::Bound
        );
        registry.commit_running(&id1, &|| true).await.unwrap();
        match reserve(&registry, &params("user1", &req, &allowed, 2))
            .await
            .unwrap()
        {
            CreateReservation::Existing(dto) => assert_eq!(dto.browser_session_id, id1),
            CreateReservation::Pending { .. } => {
                panic!("running session must be an idempotent hit")
            }
        }
    }

    #[tokio::test]
    async fn test_isolation_between_principals() {
        let registry = SessionRegistry::new();
        let req = request(&Uuid::new_v4().to_string(), "about:blank");
        let (dto, _) = registry
            .insert_running_for_test("alice", true, "inc1", 1, &req, &[])
            .await
            .unwrap();

        // Alice can get her session
        assert!(registry
            .get_session(&dto.browser_session_id, "alice")
            .await
            .is_ok());

        // Bob cannot see Alice's session (returns NotFound indistinguishable from absent)
        assert_eq!(
            registry
                .get_session(&dto.browser_session_id, "bob")
                .await
                .unwrap_err(),
            SessionError::NotFound
        );

        // Bob listing sessions sees none
        assert_eq!(registry.list_sessions("bob").await.len(), 0);
        // Alice listing sessions sees 1
        assert_eq!(registry.list_sessions("alice").await.len(), 1);
    }

    #[tokio::test]
    async fn test_reserve_fenced_by_live_check() {
        let registry = SessionRegistry::new();
        let req = request(&Uuid::new_v4().to_string(), "about:blank");
        let err = registry
            .reserve_creation(&params("alice", &req, &[], 2), &|| false)
            .await
            .err()
            .unwrap();
        assert!(matches!(err, SessionError::Conflict(_)));
        assert_eq!(registry.active_target_count(), 0);
        assert_eq!(registry.retained_session_count().await, 0);
    }

    #[tokio::test]
    async fn test_closing_keeps_slot_until_absence_and_retired_records_are_reaped() {
        let registry = SessionRegistry::new();
        let req = request(&Uuid::new_v4().to_string(), "about:blank");
        let id = pending_id(
            reserve(&registry, &params("alice", &req, &[], 1))
                .await
                .unwrap(),
        );
        registry.bind_native_target(&id, "inc1", "T1").await;
        registry.commit_running(&id, &|| true).await.unwrap();

        let action = registry.begin_close(&id, "alice").await.unwrap();
        assert!(matches!(action, CloseAction::Native { .. }));
        assert_eq!(registry.active_target_count(), 1, "Closing keeps its slot");
        // A repeated close resumes the same Closing identity.
        assert!(matches!(
            registry.begin_close(&id, "alice").await.unwrap(),
            CloseAction::Native { .. }
        ));

        registry.finish_close(&id, false).await;
        assert_eq!(registry.active_target_count(), 0);

        // Within the retry TTL the retired result is still promised.
        let early = Instant::now() + IDEMPOTENCY_TTL - Duration::from_secs(5);
        assert_eq!(registry.reap_expired_at(early).await, 0);
        assert_eq!(registry.retained_session_count().await, 1);
        let late = Instant::now() + IDEMPOTENCY_TTL + Duration::from_secs(5);
        assert_eq!(registry.reap_expired_at(late).await, 1);
        assert_eq!(registry.retained_session_count().await, 0);
    }
}

#[cfg(test)]
#[path = "session-state-tests.rs"]
mod state_tests;
