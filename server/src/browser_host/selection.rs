use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::body::Bytes;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::api::auth::AuthenticatedActor;
use crate::api::browser_host::global_session_registry;
use crate::browser_debug::{
    ArtifactSource, BrowserDebugArtifactResponse, BrowserDebugError, BrowserSelectionBoundsV1,
    BrowserSelectionV1, HandoffFence, MAX_PNG_BYTES,
};
use crate::browser_host::auth::BrowserAdmission;
use crate::browser_host::cdp::{CdpClient, CdpLifecycleEvent};
use crate::browser_host::media::{ensure_producer_for_session, get_producer};
use crate::browser_host::protocol::TargetGeometry;
use crate::browser_host::session::SessionError;
use crate::state::AppState;
const MAX_TAG_LENGTH: usize = 64;
const MAX_ROLE_LENGTH: usize = 128;
const MAX_ACCESSIBLE_NAME_LENGTH: usize = 256;
const MAX_TEXT_LENGTH: usize = 512;
const MAX_ATTRIBUTE_COUNT: usize = 12;
const MAX_ATTRIBUTE_VALUE_LENGTH: usize = 128;
const MAX_LOCATOR_LENGTH: usize = 512;
const MAX_BOUND: f64 = 1_000_000.0;
const ALLOWLISTED_EXTRACTION_JS: &str = r#"function() {
  const el = this instanceof Element ? this : (this && this.parentElement ? this.parentElement : null);
  if (!el) return null;
  const tag = ((el.tagName || 'div').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'div').slice(0, 64);
  const rect = el.getBoundingClientRect();
  const allowedAttrs = ['id', 'class', 'name', 'role', 'aria-label', 'data-testid', 'data-test', 'data-cy'];
  const attrs = {};
  for (const key of allowedAttrs) {
    const val = el.getAttribute(key);
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0) {
        attrs[key] = trimmed.slice(0, 128);
      }
    }
  }
  const rawRole = el.getAttribute('role');
  const role = typeof rawRole === 'string' && rawRole.trim().length > 0 ? rawRole.trim().slice(0, 128) : null;
  const rawLabel = el.getAttribute('aria-label');
  const ariaLabel = typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim().slice(0, 256) : null;
  const isFormControl = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el.isContentEditable);
  let text = null;
  if (!isFormControl) {
    const rawText = (el.innerText || el.textContent || '').trim();
    if (rawText.length > 0) {
      text = rawText.slice(0, 512);
    }
  }
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && parts.length < 6) {
    let part = ((cur.tagName || 'div').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'div').slice(0, 64);
    if (cur.id && /^[a-zA-Z0-9_-]+$/.test(cur.id)) {
      part += '#' + cur.id.slice(0, 64);
      parts.unshift(part);
      break;
    }
    const testId = cur.getAttribute('data-testid');
    if (testId && /^[a-zA-Z0-9_-]+$/.test(testId)) {
      part += '[data-testid="' + testId.slice(0, 64) + '"]';
      parts.unshift(part);
      break;
    }
    if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(function(c) { return c.tagName === cur.tagName; });
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        part += ':nth-of-type(' + idx + ')';
      }
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return {
    tag: tag,
    role: role,
    accessibleName: ariaLabel,
    text: text,
    attributes: attrs,
    locator: (parts.join(' > ') || tag).slice(0, 512),
    bounds: {
      x: Number.isFinite(rect.x) ? rect.x : 0,
      y: Number.isFinite(rect.y) ? rect.y : 0,
      width: Number.isFinite(rect.width) && rect.width >= 0 ? rect.width : 0,
      height: Number.isFinite(rect.height) && rect.height >= 0 ? rect.height : 0
    }
  };
}"#;
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionSummaryDto {
    pub active: bool,
    #[serde(with = "crate::browser_host::decimal_counter::nonneg")]
    pub selection_revision: u64,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub navigation_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<BrowserSelectionV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionArtifactResult {
    #[serde(flatten)]
    pub artifact: BrowserDebugArtifactResponse,
    #[serde(with = "crate::browser_host::decimal_counter::nonneg")]
    pub selection_revision: u64,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub navigation_revision: u64,
    pub selection: BrowserSelectionV1,
}

#[derive(Debug)]
pub enum SelectionError {
    Session(SessionError),
    Artifact(BrowserDebugError),
    Conflict(String),
    TerminalNotFound,
    TerminalIncarnationMismatch,
    NoSelection(String),
    Cdp(String),
}

impl From<SessionError> for SelectionError {
    fn from(err: SessionError) -> Self {
        Self::Session(err)
    }
}

impl From<BrowserDebugError> for SelectionError {
    fn from(err: BrowserDebugError) -> Self {
        Self::Artifact(err)
    }
}

pub(crate) struct SessionSelectionState {
    owner_principal: String,
    active: bool,
    selection_revision: u64,
    navigation_revision: u64,
    backend_node_id: Option<i64>,
    preview: Option<BrowserSelectionV1>,
    pending_artifacts: Vec<(Uuid, AuthenticatedActor)>,
    cancel_token: Option<CancellationToken>,
    inspect_task: Option<JoinHandle<()>>,
    /// Serializes overlay picker installation against late overlay teardown.
    overlay_gate: Arc<tokio::sync::Mutex<()>>,
    cleanup: Arc<CleanupQueue>,
}

impl SessionSelectionState {
    fn new(owner_principal: &str, navigation_revision: u64) -> Self {
        Self {
            owner_principal: owner_principal.to_string(),
            active: false,
            selection_revision: 0,
            navigation_revision,
            backend_node_id: None,
            preview: None,
            pending_artifacts: Vec::new(),
            cancel_token: None,
            inspect_task: None,
            overlay_gate: Arc::new(tokio::sync::Mutex::new(())),
            cleanup: Arc::new(CleanupQueue::default()),
        }
    }

    fn overlay_teardown(&self) -> OverlayTeardown {
        OverlayTeardown {
            gate: self.overlay_gate.clone(),
            selection_revision: self.selection_revision,
        }
    }

    fn to_summary(&self) -> SelectionSummaryDto {
        SelectionSummaryDto {
            active: self.active,
            selection_revision: self.selection_revision,
            navigation_revision: self.navigation_revision,
            preview: self.preview.clone(),
        }
    }
}

pub struct SelectionManager {
    sessions: Arc<RwLock<HashMap<String, SessionSelectionState>>>,
}

pub static GLOBAL_SELECTION_MANAGER: LazyLock<SelectionManager> =
    LazyLock::new(SelectionManager::new);

struct NavWatcher {
    id: u64,
    token: CancellationToken,
    cdp: std::sync::Weak<CdpClient>,
    page_sid: String,
}

static NAV_WATCHER_SEQ: AtomicU64 = AtomicU64::new(1);
static PAGE_GAP_SEQ: AtomicU64 = AtomicU64::new(1);

static GLOBAL_NAV_WATCHERS: LazyLock<StdMutex<HashMap<String, NavWatcher>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Navigations observed per session, published synchronously at the instant the CDP event is
/// seen, BEFORE the (possibly blocked) selection write lock is awaited. `applied` catches up once
/// the registry revision and selection invalidation are recorded. A handoff fence refuses to
/// start while a navigation is observed-but-unapplied, and its final PTY-lock check fails as
/// soon as `observed` moves, so a navigation can never be hidden behind the selection lock.
#[derive(Clone, Copy, Default)]
struct NavigationObservations {
    observed: u64,
    applied: u64,
    gap_generation: u64,
    gap_open: bool,
}

static NAVIGATION_OBSERVATIONS: LazyLock<StdMutex<HashMap<String, NavigationObservations>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// A published native navigation whose invalidation is not yet applied. Dropping it without
/// `mark_applied` (cancelled recorder) deliberately leaves the session fail-closed for handoffs
/// until its observation state is forgotten at session teardown.
struct ObservedNavigation {
    session_id: String,
}

impl ObservedNavigation {
    fn publish(session_id: &str) -> Self {
        let mut map = NAVIGATION_OBSERVATIONS.lock().unwrap();
        map.entry(session_id.to_string()).or_default().observed += 1;
        Self {
            session_id: session_id.to_string(),
        }
    }

    fn mark_applied(self) {
        let mut map = NAVIGATION_OBSERVATIONS.lock().unwrap();
        if let Some(entry) = map.get_mut(&self.session_id) {
            entry.applied += 1;
        }
    }
}

/// Observed-navigation counter for a session when none is awaiting application.
fn settled_navigation_observation(session_id: &str) -> Option<u64> {
    let mut map = NAVIGATION_OBSERVATIONS.lock().unwrap();
    let entry = map.entry(session_id.to_string()).or_default();
    (entry.observed == entry.applied && !entry.gap_open).then_some(entry.observed)
}

fn forget_navigation_observations(session_id: &str) {
    NAVIGATION_OBSERVATIONS.lock().unwrap().remove(session_id);
}

/// Number of native navigations published for `session_id` so far.
#[doc(hidden)]
pub fn observed_navigation_count(session_id: &str) -> u64 {
    NAVIGATION_OBSERVATIONS
        .lock()
        .unwrap()
        .get(session_id)
        .map_or(0, |entry| entry.observed)
}

/// A Page-session replacement whose observation remains unavailable until its exact replacement
/// watcher is installed. Dropping this value deliberately leaves the gap open.
pub struct PageObservationGap {
    session_id: String,
    generation: u64,
    observed: Option<ObservedNavigation>,
    invalidated: bool,
}

/// Publish the fence synchronously, before detaching the old Page session or awaiting any lock.
pub fn begin_page_observation_gap(session_id: &str) -> PageObservationGap {
    let mut observations = NAVIGATION_OBSERVATIONS.lock().unwrap();
    let entry = observations.entry(session_id.to_string()).or_default();
    entry.observed += 1;
    entry.gap_generation = PAGE_GAP_SEQ
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
        .expect("Page observation generation exhausted");
    entry.gap_open = true;
    let generation = entry.gap_generation;
    // Lock ordering is observations then watchers, also used by watcher installation.
    stop_session_navigation_watcher(session_id);
    PageObservationGap {
        session_id: session_id.to_string(),
        generation,
        observed: Some(ObservedNavigation { session_id: session_id.to_string() }),
        invalidated: false,
    }
}

impl PageObservationGap {
    /// Advance the navigation revision and revoke the old selection. Slow teardown is queued.
    pub async fn invalidate(&mut self, state: &AppState) {
        if self.invalidated {
            return;
        }
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        let new_rev = global_session_registry()
            .record_cdp_navigation(
                &self.session_id,
                None,
                &state.browser_host.config().allowed_target_origins,
            )
            .await;
        let invalidated = apply_navigation_invalidation(&mut map, &self.session_id, new_rev);
        if let Some(invalidated) = invalidated {
            invalidated.queue_teardown(state, &self.session_id);
        }
        self.observed.take().unwrap().mark_applied();
        self.invalidated = true;
    }

    /// Install the exact new watcher and settle only this generation. Failure or supersession
    /// leaves observation fail-closed.
    pub async fn finish(self, state: &AppState, cdp: &Arc<CdpClient>, page_sid: &str) -> bool {
        if !self.invalidated
            || !install_navigation_watcher(state, &self.session_id, cdp, page_sid, Some(self.generation)).await
        {
            return false;
        }
        let mut observations = NAVIGATION_OBSERVATIONS.lock().unwrap();
        let Some(entry) = observations.get_mut(&self.session_id) else {
            return false;
        };
        if !entry.gap_open || entry.gap_generation != self.generation {
            return false;
        }
        let watchers = GLOBAL_NAV_WATCHERS.lock().unwrap();
        if !watchers.get(&self.session_id).is_some_and(|watcher| {
            !watcher.token.is_cancelled()
                && watcher.page_sid == page_sid
                && watcher.cdp.ptr_eq(&Arc::downgrade(cdp))
        }) {
            return false;
        }
        entry.gap_open = false;
        true
    }
}

/// Holds the selection read lock (postponing navigation bookkeeping) for a handoff and
/// remembers the observed-navigation counter at acquisition.
pub(crate) struct ManagedSelectionFence {
    _guard: tokio::sync::OwnedRwLockReadGuard<HashMap<String, SessionSelectionState>>,
    session_id: String,
    observed: u64,
}

impl HandoffFence for ManagedSelectionFence {
    /// Synchronous: no native navigation was observed since the fence was acquired.
    fn is_current(&self) -> bool {
        NAVIGATION_OBSERVATIONS
            .lock()
            .unwrap()
            .get(&self.session_id)
            .is_some_and(|entry| entry.observed == self.observed && entry.applied == self.observed && !entry.gap_open)
    }
}

/// Identity of the selection generation whose overlay a teardown may disable.
#[derive(Clone)]
struct OverlayTeardown {
    gate: Arc<tokio::sync::Mutex<()>>,
    selection_revision: u64,
}

/// Work to run after an in-memory selection invalidation released the selection lock.
struct InvalidatedSelection {
    token: Option<CancellationToken>,
    task: Option<JoinHandle<()>>,
    pending: Vec<(Uuid, AuthenticatedActor)>,
    overlay: OverlayTeardown,
    cleanup: Arc<CleanupQueue>,
}

impl InvalidatedSelection {
    /// Cancels and aborts the invalidated picker immediately (cheap, never waits).
    fn stop_picker(&mut self) {
        if let Some(tok) = self.token.take() {
            tok.cancel();
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }

    /// Stops the picker now and hands the slow part (artifact unlinks, overlay CDP) to the
    /// session's cleanup queue.
    fn queue_teardown(mut self, state: &AppState, session_id: &str) {
        self.stop_picker();
        self.cleanup
            .clone()
            .submit(state, session_id, self.pending, self.overlay);
    }
}

/// Teardown owed to invalidated selections of one session, coalesced to bounded state: the
/// artifact ids still to retire (bounded by the artifact quota) plus at most one overlay
/// teardown, always the latest generation. One worker drains it in order; `drain` lets session
/// teardown and shutdown wait for it instead of leaving it detached.
#[derive(Default)]
struct CleanupQueue {
    inner: StdMutex<QueuedCleanup>,
    idle: tokio::sync::Notify,
}

#[derive(Default)]
struct QueuedCleanup {
    pending: Vec<(Uuid, AuthenticatedActor)>,
    overlay: Option<OverlayTeardown>,
    running: bool,
}

/// Marks the worker stopped (and wakes drainers) if it unwinds before finding the queue empty.
struct CleanupWorkerExit {
    queue: Arc<CleanupQueue>,
    finished: bool,
}

impl Drop for CleanupWorkerExit {
    fn drop(&mut self) {
        if !self.finished {
            self.queue.inner.lock().unwrap().running = false;
            self.queue.idle.notify_waiters();
        }
    }
}

impl CleanupQueue {
    fn submit(
        self: &Arc<Self>,
        state: &AppState,
        session_id: &str,
        pending: Vec<(Uuid, AuthenticatedActor)>,
        overlay: OverlayTeardown,
    ) {
        let start_worker = {
            let mut queued = self.inner.lock().unwrap();
            queued.pending.extend(pending);
            queued.overlay = Some(overlay);
            !std::mem::replace(&mut queued.running, true)
        };
        if start_worker {
            let (queue, state, session_id) = (self.clone(), state.clone(), session_id.to_string());
            tokio::spawn(async move { queue.run(state, session_id).await });
        }
    }

    async fn run(self: Arc<Self>, state: AppState, session_id: String) {
        let mut exit = CleanupWorkerExit {
            queue: self.clone(),
            finished: false,
        };
        loop {
            let (pending, overlay) = {
                let mut queued = self.inner.lock().unwrap();
                if queued.pending.is_empty() && queued.overlay.is_none() {
                    queued.running = false;
                    exit.finished = true;
                    drop(queued);
                    self.idle.notify_waiters();
                    return;
                }
                (std::mem::take(&mut queued.pending), queued.overlay.take())
            };
            cleanup_pending_artifacts(&state, pending).await;
            if let Some(overlay) = overlay {
                disable_overlay_if_current(&session_id, overlay).await;
            }
        }
    }

    /// Resolves once the worker has found the queue empty (immediately when none is running).
    async fn drain(&self) {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            if !self.inner.lock().unwrap().running {
                return;
            }
            idle.await;
        }
    }
}

/// Waits (bounded) for every session's queued navigation teardown; used at shutdown so no
/// cleanup worker outlives the artifact store it unlinks from.
pub async fn drain_navigation_cleanups() {
    let queues: Vec<Arc<CleanupQueue>> = {
        let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
        map.values().map(|entry| entry.cleanup.clone()).collect()
    };
    for queue in queues {
        if timeout(Duration::from_secs(5), queue.drain())
            .await
            .is_err()
        {
            warn!("queued navigation cleanup still running at shutdown deadline");
        }
    }
}
impl SelectionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_summary(
        &self,
        session_id: &str,
        principal: &str,
        current_nav_rev: u64,
    ) -> Option<SelectionSummaryDto> {
        let map = self.sessions.read().await;
        let state = map.get(session_id)?;
        if settled_navigation_observation(session_id).is_none()
            || state.owner_principal != principal
            || state.navigation_revision != current_nav_rev
        {
            return None;
        }
        Some(state.to_summary())
    }

    /// For testing or direct server-side inspect recording (verifies nav revision).
    pub async fn record_selection_preview(
        &self,
        session_id: &str,
        principal: &str,
        nav_rev: u64,
        backend_node_id: Option<i64>,
        raw_selection: Value,
    ) -> Result<SelectionSummaryDto, SelectionError> {
        let sanitized = extract_and_sanitize_selection(&raw_selection)
            .map_err(|e| SelectionError::NoSelection(e))?;
        let mut map = self.sessions.write().await;
        if settled_navigation_observation(session_id).is_none() {
            return Err(SelectionError::Conflict("navigation observation unavailable".into()));
        }
        let entry = map
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSelectionState::new(principal, nav_rev));
        if entry.owner_principal != principal {
            return Err(SelectionError::Session(SessionError::Forbidden));
        }
        if entry.navigation_revision != nav_rev {
            return Err(SelectionError::Conflict(format!(
                "stale navigationRevision (expected {}, current {})",
                nav_rev, entry.navigation_revision
            )));
        }
        entry.selection_revision = entry.selection_revision.saturating_add(1);
        entry.active = false;
        entry.backend_node_id = backend_node_id;
        entry.preview = Some(sanitized);
        Ok(entry.to_summary())
    }
}

pub async fn get_selection_summary(
    session_id: &str,
    principal: &str,
    current_nav_rev: u64,
) -> Option<SelectionSummaryDto> {
    GLOBAL_SELECTION_MANAGER
        .get_summary(session_id, principal, current_nav_rev)
        .await
}

pub async fn is_selection_live(
    session_id: &str,
    principal: &str,
    nav_rev: u64,
    sel_rev: u64,
) -> bool {
    let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
    let Some(entry) = map.get(session_id) else {
        return false;
    };
    settled_navigation_observation(session_id).is_some()
        && entry.owner_principal == principal
        && !entry.active
        && entry.navigation_revision == nav_rev
        && entry.selection_revision == sel_rev
        && entry.preview.is_some()
}

pub(crate) async fn acquire_managed_selection_fence(
    session_id: &str,
    principal: &str,
    nav_rev: u64,
    sel_rev: u64,
    artifact_id: Uuid,
) -> Option<ManagedSelectionFence> {
    let guard = GLOBAL_SELECTION_MANAGER.sessions.clone().read_owned().await;
    let dto = global_session_registry()
        .get_session(session_id, principal)
        .await
        .ok()?;
    if dto.status != "running" || crate::browser_host::decimal_counter::parse_canonical_u64(&dto.navigation_revision, false) != Some(nav_rev) {
        return None;
    }
    let entry = guard.get(session_id)?;
    if !(entry.owner_principal == principal
        && !entry.active
        && entry.navigation_revision == nav_rev
        && entry.selection_revision == sel_rev
        && entry.preview.is_some()
        && entry
            .pending_artifacts
            .iter()
            .any(|(aid, _)| *aid == artifact_id))
    {
        return None;
    }
    // A navigation observed natively but still queued behind this lock is not in the registry
    // yet: refuse instead of validating against a stale revision.
    let observed = settled_navigation_observation(session_id)?;
    Some(ManagedSelectionFence {
        _guard: guard,
        session_id: session_id.to_string(),
        observed,
    })
}

/// Synchronously fences all selection sessions for `principal` in memory without waiting on network CDP,
/// returning pending artifact UUIDs so callers can purge artifacts without blocking.
pub async fn fence_principal_sessions_in_memory(principal: &str) -> Vec<Uuid> {
    let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
    let matching_ids: Vec<String> = map
        .iter()
        .filter(|(_, entry)| entry.owner_principal == principal)
        .map(|(sid, _)| sid.clone())
        .collect();
    let mut pending_ids = Vec::new();
    for sid in matching_ids {
        if let Some(entry) = map.remove(&sid) {
            forget_navigation_observations(&sid);
            stop_session_navigation_watcher(&sid);
            if let Some(tok) = entry.cancel_token {
                tok.cancel();
            }
            if let Some(task) = entry.inspect_task {
                task.abort();
            }
            for (aid, _) in entry.pending_artifacts {
                pending_ids.push(aid);
            }
        }
    }
    pending_ids
}
pub async fn start_selection(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
    expected_nav_rev: u64,
    inspect_point: Option<InspectPoint>,
) -> Result<SelectionSummaryDto, SelectionError> {
    let session_dto = global_session_registry()
        .get_session(session_id, principal)
        .await?;
    if session_dto.status != "running" {
        return Err(SelectionError::Conflict(format!(
            "browser session status is '{}' (expected 'running')",
            session_dto.status
        )));
    }
    let current_nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&session_dto.navigation_revision, false).unwrap_or(0);
    if current_nav_rev != expected_nav_rev {
        return Err(SelectionError::Conflict(format!(
            "stale navigationRevision (expected {}, current {})",
            expected_nav_rev, current_nav_rev
        )));
    }

    if settled_navigation_observation(session_id).is_none() {
        return Err(SelectionError::Conflict("navigation observation unavailable".into()));
    }

    let (old_token, old_task, old_pending, start_sel_rev) = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        if settled_navigation_observation(session_id).is_none() {
            return Err(SelectionError::Conflict("navigation observation unavailable".into()));
        }
        let entry = map
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSelectionState::new(principal, current_nav_rev));
        entry.owner_principal = principal.to_string();
        entry.navigation_revision = current_nav_rev;
        entry.selection_revision = entry.selection_revision.saturating_add(1);
        entry.active = inspect_point.is_none();
        entry.preview = None;
        entry.backend_node_id = None;
        let tok = entry.cancel_token.take();
        let task = entry.inspect_task.take();
        let pend = std::mem::take(&mut entry.pending_artifacts);
        (tok, task, pend, entry.selection_revision)
    };

    if let Some(tok) = old_token {
        tok.cancel();
    }
    if let Some(task) = old_task {
        task.abort();
    }
    cleanup_pending_artifacts(state, old_pending).await;

    if let Some(point) = inspect_point {
        let extracted = inspect_at_point(state, session_id, principal, is_dev, &point).await?;
        let observing =
            match ensure_producer_for_session(state, session_id, principal, is_dev).await {
                Some(producer) => match producer.ensure_page_session().await {
                    Ok(page_sid) => {
                        ensure_session_navigation_watcher(
                            state,
                            session_id,
                            &producer.cdp_client,
                            &page_sid,
                        )
                        .await
                    }
                    Err(_) => false,
                },
                None => false,
            };
        if !observing {
            return Err(SelectionError::Cdp(
                "navigation observation unavailable for session".into(),
            ));
        }
        let summary = {
            let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
            let Some(entry) = map.get_mut(session_id) else {
                return Err(SelectionError::Session(SessionError::NotFound));
            };
            if settled_navigation_observation(session_id).is_none()
                || entry.navigation_revision != current_nav_rev
                || entry.selection_revision != start_sel_rev
            {
                return Err(SelectionError::Conflict(
                    "navigation occurred during inspect".to_string(),
                ));
            }
            entry.selection_revision = entry.selection_revision.saturating_add(1);
            entry.active = false;
            entry.backend_node_id = extracted.0;
            entry.preview = Some(extracted.1);
            entry.to_summary()
        };
        return Ok(summary);
    }
    // Start background Overlay inspect observer and await inspect mode readiness
    let cancel_token = CancellationToken::new();
    let token_clone = cancel_token.clone();
    let state_clone = state.clone();
    let sid_clone = session_id.to_string();
    let principal_clone = principal.to_string();
    let (ready_tx, ready_rx) = oneshot::channel::<()>();

    let task = tokio::spawn(async move {
        run_selection_cdp_observer(
            state_clone,
            sid_clone,
            principal_clone,
            is_dev,
            current_nav_rev,
            start_sel_rev,
            true,
            token_clone,
            ready_tx,
        )
        .await;
    });
    let summary = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        let Some(entry) = map.get_mut(session_id) else {
            cancel_token.cancel();
            return Err(SelectionError::Session(SessionError::NotFound));
        };
        if settled_navigation_observation(session_id).is_none()
            || entry.selection_revision != start_sel_rev
        {
            cancel_token.cancel();
            task.abort();
            return Err(SelectionError::Conflict("navigation observation unavailable".into()));
        }
        entry.cancel_token = Some(cancel_token);
        entry.inspect_task = Some(task);
        entry.to_summary()
    };

    if let Ok(Err(_)) = timeout(Duration::from_secs(2), ready_rx).await {
        // The observer exited before becoming ready (no producer/page session/observation).
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        if let Some(entry) = map.get_mut(session_id) {
            if entry.selection_revision == start_sel_rev {
                entry.active = false;
            }
        }
        return Err(SelectionError::Cdp(
            "selection observer could not start for session".into(),
        ));
    }
    Ok(summary)
}

pub async fn cancel_selection(
    state: &AppState,
    session_id: &str,
    principal: &str,
    expected_nav_rev: u64,
) -> Result<SelectionSummaryDto, SelectionError> {
    let session_dto = global_session_registry()
        .get_session(session_id, principal)
        .await?;
    let current_nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&session_dto.navigation_revision, false).unwrap_or(0);
    if current_nav_rev != expected_nav_rev {
        return Err(SelectionError::Conflict(format!(
            "stale navigationRevision (expected {}, current {})",
            expected_nav_rev, current_nav_rev
        )));
    }

    let (old_token, old_task, old_pending, overlay, summary) = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        let entry = map
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSelectionState::new(principal, current_nav_rev));
        entry.active = false;
        entry.preview = None;
        entry.backend_node_id = None;
        entry.navigation_revision = current_nav_rev;
        let tok = entry.cancel_token.take();
        let task = entry.inspect_task.take();
        let pend = std::mem::take(&mut entry.pending_artifacts);
        (
            tok,
            task,
            pend,
            entry.overlay_teardown(),
            entry.to_summary(),
        )
    };

    if let Some(tok) = old_token {
        tok.cancel();
    }
    if let Some(task) = old_task {
        task.abort();
    }
    cleanup_pending_artifacts(state, old_pending).await;
    disable_overlay_if_current(session_id, overlay).await;

    Ok(summary)
}

/// Invalidates the selection of `session_id` for a navigation and returns what must be torn
/// down afterwards. Pure in-memory: callers hold the selection lock so the invalidation is
/// ordered with the navigation record and with the final handoff fence.
fn apply_navigation_invalidation(
    map: &mut HashMap<String, SessionSelectionState>,
    session_id: &str,
    new_nav_rev: Option<u64>,
) -> Option<InvalidatedSelection> {
    let entry = map.get_mut(session_id)?;
    entry.active = false;
    entry.preview = None;
    entry.backend_node_id = None;
    entry.selection_revision = entry.selection_revision.saturating_add(1);
    if let Some(rev) = new_nav_rev {
        entry.navigation_revision = rev;
    } else {
        entry.navigation_revision = entry.navigation_revision.saturating_add(1);
    }
    Some(InvalidatedSelection {
        token: entry.cancel_token.take(),
        task: entry.inspect_task.take(),
        pending: std::mem::take(&mut entry.pending_artifacts),
        overlay: entry.overlay_teardown(),
        cleanup: entry.cleanup.clone(),
    })
}

async fn finish_navigation_invalidation(
    state: &AppState,
    session_id: &str,
    invalidated: Option<InvalidatedSelection>,
) {
    let Some(mut invalidated) = invalidated else {
        return;
    };
    invalidated.stop_picker();
    cleanup_pending_artifacts(state, invalidated.pending).await;
    disable_overlay_if_current(session_id, invalidated.overlay).await;
}

pub async fn invalidate_on_navigation(
    state: &AppState,
    session_id: &str,
    new_nav_rev: Option<u64>,
) {
    let invalidated = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        apply_navigation_invalidation(&mut map, session_id, new_nav_rev)
    };
    finish_navigation_invalidation(state, session_id, invalidated).await;
}

/// Records a native navigation (or an observation gap that may hide one) and invalidates the
/// selection under the selection write lock. Chromium navigates regardless of that lock, so
/// the observation is first published synchronously (`ObservedNavigation`); the registry
/// revision itself cannot advance while a handoff holds the selection fence, and the handoff's
/// check under the PTY lock denies the write once the observation is published.
///
/// Returns the teardown owed to the invalidated selection (artifact unlinks, overlay CDP
/// commands). It is deliberately NOT run here: callers that keep consuming CDP events must not
/// stall on disk or CDP I/O, or a later navigation would stay unpublished behind it.
async fn record_navigation_applied(
    state: &AppState,
    session_id: &str,
    url: Option<&str>,
) -> Option<InvalidatedSelection> {
    // Published before any await: a handoff waiting on the PTY lock sees it even though the
    // registry revision below cannot advance while the handoff holds the selection fence.
    let observed = ObservedNavigation::publish(session_id);
    let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
    let new_rev = global_session_registry()
        .record_cdp_navigation(
            session_id,
            url,
            &state.browser_host.config().allowed_target_origins,
        )
        .await;
    let invalidated = apply_navigation_invalidation(&mut map, session_id, new_rev);
    observed.mark_applied();
    invalidated
}

/// [`record_navigation_applied`] followed by its teardown, for one-shot callers.
async fn record_navigation_fenced(state: &AppState, session_id: &str, url: Option<&str>) {
    let invalidated = record_navigation_applied(state, session_id, url).await;
    finish_navigation_invalidation(state, session_id, invalidated).await;
}

/// Runs an API-originated registry navigation (`navigate`/`history`/`reload`) under the
/// selection write lock and invalidates the selection with the resulting revision, so the
/// revision bump is ordered against the final handoff fence like a native navigation.
pub(crate) async fn fence_registry_navigation<T, E>(
    state: &AppState,
    session_id: &str,
    op: impl Future<Output = Result<T, E>>,
    revision_of: impl FnOnce(&T) -> Option<u64>,
) -> Result<T, E> {
    let (result, invalidated) = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        let result = op.await;
        let invalidated = match &result {
            Ok(value) => apply_navigation_invalidation(&mut map, session_id, revision_of(value)),
            Err(_) => None,
        };
        (result, invalidated)
    };
    finish_navigation_invalidation(state, session_id, invalidated).await;
    result
}

pub async fn cleanup_session(state: &AppState, session_id: &str) {
    stop_session_navigation_watcher(session_id);
    forget_navigation_observations(session_id);
    let removed = {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        map.remove(session_id)
    };
    if let Some(entry) = removed {
        if let Some(tok) = entry.cancel_token {
            tok.cancel();
        }
        if let Some(task) = entry.inspect_task {
            task.abort();
        }
        cleanup_pending_artifacts(state, entry.pending_artifacts).await;
        // Queued navigation teardown of this session finishes before the session is gone.
        entry.cleanup.drain().await;
    }
}

pub async fn create_managed_selection_artifact(
    state: &AppState,
    session_id: &str,
    admission: &BrowserAdmission,
    actor: &AuthenticatedActor,
    selection_revision: u64,
    expected_nav_rev: Option<u64>,
    terminal_id: String,
    terminal_incarnation: u64,
    include_png: Option<bool>,
) -> Result<SelectionArtifactResult, SelectionError> {
    // 1. Recheck Browser session & owner & navigation revision
    let session_dto = global_session_registry()
        .get_session(session_id, &admission.principal)
        .await?;
    if session_dto.status != "running" {
        return Err(SelectionError::Conflict(format!(
            "browser session status is '{}' (expected 'running')",
            session_dto.status
        )));
    }
    let current_nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&session_dto.navigation_revision, false).unwrap_or(0);
    if let Some(expected) = expected_nav_rev {
        if expected != current_nav_rev {
            return Err(SelectionError::Conflict(format!(
                "stale navigationRevision (expected {expected}, current {current_nav_rev})"
            )));
        }
    }

    // 2. Recheck selection preview & revision under lock
    let selection = {
        let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
        if settled_navigation_observation(session_id).is_none() {
            return Err(SelectionError::Conflict("navigation observation unavailable".into()));
        }
        let entry = map.get(session_id).ok_or_else(|| {
            SelectionError::NoSelection("no selection recorded for session".into())
        })?;
        if entry.owner_principal != admission.principal {
            return Err(SelectionError::Session(SessionError::Forbidden));
        }
        if entry.navigation_revision != current_nav_rev {
            return Err(SelectionError::Conflict(
                "selection invalidated by navigation".to_string(),
            ));
        }
        if entry.selection_revision != selection_revision {
            return Err(SelectionError::Conflict(format!(
                "stale selectionRevision (expected {}, current {})",
                selection_revision, entry.selection_revision
            )));
        }
        entry
            .preview
            .clone()
            .ok_or_else(|| SelectionError::NoSelection("no element selected".into()))?
    };

    if !selection.is_valid() {
        return Err(SelectionError::Artifact(
            BrowserDebugError::InvalidSelection,
        ));
    }

    // 3. Recheck selected terminal & incarnation
    let live_inc = state
        .pty_manager
        .live_incarnation(&terminal_id)
        .ok_or(SelectionError::TerminalNotFound)?;
    if live_inc != terminal_incarnation {
        return Err(SelectionError::TerminalIncarnationMismatch);
    }

    // 4. Create ManagedBrowser artifact atomically (rechecking admission, selection & terminal before publish)
    let profile_epoch = crate::browser_host::decimal_counter::parse_canonical_u64(&session_dto.profile_epoch, false).unwrap_or(1);
    let browser_incarnation = session_dto.browser_incarnation.clone();
    let mut artifact = state
        .browser_debug_artifacts
        .create_managed_checked(
            actor,
            ArtifactSource::ManagedBrowser {
                principal: admission.principal.clone(),
                profile_epoch,
                browser_incarnation,
            },
            (session_id.to_string(), current_nav_rev, selection_revision),
            terminal_id.clone(),
            terminal_incarnation,
            selection.clone(),
            &state.pty_manager,
        )
        .await?;

    let artifact_uuid = Uuid::parse_str(&artifact.artifact_id)
        .map_err(|_| SelectionError::Artifact(BrowserDebugError::NotFound))?;

    // Track pending artifact for navigation/cancel invalidation (verify selection still live under lock!)
    {
        let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
        let valid_now = map.get(session_id).is_some_and(|entry| {
            entry.owner_principal == admission.principal
                && !entry.active
                && entry.navigation_revision == current_nav_rev
                && entry.selection_revision == selection_revision
        });
        if !valid_now {
            drop(map);
            invalidate_artifact(state, artifact_uuid).await;
            return Err(SelectionError::Conflict(
                "selection changed before artifact registration".to_string(),
            ));
        }
        if let Some(entry) = map.get_mut(session_id) {
            entry.pending_artifacts.push((artifact_uuid, actor.clone()));
        }
    }

    // 5. Capture optional explicit bounded CDP PNG (within 4MiB)
    let want_png = include_png.unwrap_or(true);
    if want_png {
        let png_res = capture_selection_png(
            state,
            session_id,
            &admission.principal,
            admission.is_dev,
            &selection.bounds,
            &session_dto.geometry,
        )
        .await;

        match png_res {
            Ok(png_bytes) => {
                // Recheck session/owner/navigation revision/selection revision/terminal incarnation BEFORE PNG upload
                let recheck_ok = recheck_before_png_completion(
                    state,
                    session_id,
                    &admission.principal,
                    current_nav_rev,
                    selection_revision,
                    &terminal_id,
                    terminal_incarnation,
                )
                .await;

                if let Err(err) = recheck_ok {
                    invalidate_artifact(state, artifact_uuid).await;
                    remove_pending_artifact(session_id, artifact_uuid).await;
                    return Err(err);
                }

                match state
                    .browser_debug_artifacts
                    .upload_png(artifact_uuid, actor, png_bytes)
                    .await
                {
                    Ok(updated) => {
                        artifact = updated;
                    }
                    Err(err) => {
                        invalidate_artifact(state, artifact_uuid).await;
                        remove_pending_artifact(session_id, artifact_uuid).await;
                        return Err(SelectionError::Artifact(err));
                    }
                }
            }
            Err(err) => {
                if include_png == Some(true) {
                    invalidate_artifact(state, artifact_uuid).await;
                    remove_pending_artifact(session_id, artifact_uuid).await;
                    return Err(err);
                }
                debug!(
                    session_id,
                    error = ?err,
                    "optional selection PNG capture skipped because CDP target unavailable"
                );
            }
        }
    }
    Ok(SelectionArtifactResult {
        artifact,
        selection_revision,
        navigation_revision: current_nav_rev,
        selection,
    })
}

async fn recheck_before_png_completion(
    state: &AppState,
    session_id: &str,
    principal: &str,
    expected_nav_rev: u64,
    expected_sel_rev: u64,
    terminal_id: &str,
    expected_terminal_incarnation: u64,
) -> Result<(), SelectionError> {
    let session_dto = global_session_registry()
        .get_session(session_id, principal)
        .await?;
    if session_dto.status != "running" {
        return Err(SelectionError::Conflict(
            "session no longer running before PNG completion".to_string(),
        ));
    }
    let current_nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&session_dto.navigation_revision, false).unwrap_or(0);
    if current_nav_rev != expected_nav_rev {
        return Err(SelectionError::Conflict(
            "navigation changed before PNG completion".to_string(),
        ));
    }
    {
        let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
        let entry = map.get(session_id).ok_or_else(|| {
            SelectionError::NoSelection("selection cleared before PNG completion".into())
        })?;
        if entry.navigation_revision != expected_nav_rev
            || entry.selection_revision != expected_sel_rev
            || entry.preview.is_none()
        {
            return Err(SelectionError::Conflict(
                "selection invalidated before PNG completion".to_string(),
            ));
        }
    }
    let live_inc = state
        .pty_manager
        .live_incarnation(terminal_id)
        .ok_or(SelectionError::TerminalNotFound)?;
    if live_inc != expected_terminal_incarnation {
        return Err(SelectionError::TerminalIncarnationMismatch);
    }
    Ok(())
}

/// Drops a terminal artifact's live-selection registration (idempotent).
pub(crate) async fn remove_pending_artifact(session_id: &str, artifact_id: Uuid) {
    let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
    if let Some(entry) = map.get_mut(session_id) {
        entry.pending_artifacts.retain(|(id, _)| *id != artifact_id);
    }
}

/// Number of artifacts still registered against the session's live selection.
pub async fn pending_artifact_registration_count(session_id: &str) -> usize {
    let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
    map.get(session_id)
        .map_or(0, |entry| entry.pending_artifacts.len())
}

/// Invalidates an artifact; a denied unlink stays charged and retryable inside the store.
async fn invalidate_artifact(state: &AppState, id: Uuid) {
    if let Err(error) = state.browser_debug_artifacts.force_invalidate(id).await {
        warn!(artifact_id = %id, error = %error, "selection artifact cleanup deferred for retry");
    }
}

async fn cleanup_pending_artifacts(state: &AppState, pending: Vec<(Uuid, AuthenticatedActor)>) {
    for (id, _) in pending {
        invalidate_artifact(state, id).await;
    }
}
/// Disables native picking for a teardown, but only while the selection generation it was
/// captured for is still current. Serialized with picker installation on the session's overlay
/// gate, so a late teardown of an old selection never switches off a newer picker.
async fn disable_overlay_if_current(session_id: &str, overlay: OverlayTeardown) {
    let _gate = overlay.gate.lock().await;
    if current_selection_revision(session_id).await == Some(overlay.selection_revision) {
        disable_overlay_inspect_best_effort(session_id).await;
    }
}

async fn current_selection_revision(session_id: &str) -> Option<u64> {
    let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
    map.get(session_id).map(|entry| entry.selection_revision)
}

async fn disable_overlay_inspect_best_effort(session_id: &str) {
    if let Some(producer) = get_producer(session_id).await {
        if let Ok(page_sid) = producer.ensure_page_session().await {
            let _ = producer
                .cdp_client
                .send_command(
                    "Overlay.setInspectMode",
                    Some(json!({ "mode": "none" })),
                    Some(&page_sid),
                )
                .await;
            let _ = producer
                .cdp_client
                .send_command("Overlay.hideHighlight", None, Some(&page_sid))
                .await;
        }
    }
}

async fn inspect_at_point(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
    point: &InspectPoint,
) -> Result<(Option<i64>, BrowserSelectionV1), SelectionError> {
    if !point.x.is_finite() || !point.y.is_finite() || point.x < 0.0 || point.y < 0.0 {
        return Err(SelectionError::NoSelection("invalid inspect point".into()));
    }

    let producer = ensure_producer_for_session(state, session_id, principal, is_dev)
        .await
        .ok_or_else(|| SelectionError::Cdp("no active browser target for session".into()))?;
    let page_sid = producer
        .ensure_page_session()
        .await
        .map_err(|e| SelectionError::Cdp(e.to_string()))?;

    let _ = producer
        .cdp_client
        .send_command("DOM.enable", None, Some(&page_sid))
        .await;
    let _ = producer
        .cdp_client
        .send_command("Overlay.enable", None, Some(&page_sid))
        .await;
    let _ = producer
        .cdp_client
        .send_command(
            "DOM.getDocument",
            Some(json!({ "depth": 0 })),
            Some(&page_sid),
        )
        .await;

    let node_res = producer
        .cdp_client
        .send_command(
            "DOM.getNodeForLocation",
            Some(json!({
                "x": point.x.round() as i64,
                "y": point.y.round() as i64,
                "includeUserAgentShadowDOM": false,
                "ignorePointerEventsNone": false
            })),
            Some(&page_sid),
        )
        .await
        .map_err(|e| SelectionError::Cdp(e.to_string()))?;

    let backend_node_id = node_res
        .get("backendNodeId")
        .and_then(Value::as_i64)
        .ok_or_else(|| SelectionError::NoSelection("no DOM element at inspect point".into()))?;

    let resolved = producer
        .cdp_client
        .send_command(
            "DOM.resolveNode",
            Some(json!({ "backendNodeId": backend_node_id })),
            Some(&page_sid),
        )
        .await
        .map_err(|e| SelectionError::Cdp(e.to_string()))?;

    let object_id = resolved
        .pointer("/object/objectId")
        .and_then(Value::as_str)
        .ok_or_else(|| SelectionError::NoSelection("unable to resolve DOM element".into()))?
        .to_string();

    let call_res = producer
        .cdp_client
        .send_command(
            "Runtime.callFunctionOn",
            Some(json!({
                "objectId": object_id,
                "functionDeclaration": ALLOWLISTED_EXTRACTION_JS,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await;

    let _ = producer
        .cdp_client
        .send_command(
            "Runtime.releaseObject",
            Some(json!({ "objectId": object_id })),
            Some(&page_sid),
        )
        .await;

    let val = call_res.map_err(|e| SelectionError::Cdp(e.to_string()))?;
    let raw_sel = val
        .pointer("/result/value")
        .ok_or_else(|| SelectionError::NoSelection("element extraction returned empty".into()))?;

    let selection = extract_and_sanitize_selection(raw_sel).map_err(SelectionError::NoSelection)?;

    let _ = producer
        .cdp_client
        .send_command(
            "Overlay.highlightNode",
            Some(json!({
                "backendNodeId": backend_node_id,
                "highlightConfig": default_highlight_config()
            })),
            Some(&page_sid),
        )
        .await;

    Ok((Some(backend_node_id), selection))
}

async fn capture_selection_png(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
    bounds: &BrowserSelectionBoundsV1,
    geometry: &TargetGeometry,
) -> Result<Bytes, SelectionError> {
    let producer = ensure_producer_for_session(state, session_id, principal, is_dev)
        .await
        .ok_or_else(|| SelectionError::Cdp("no active browser target for PNG capture".into()))?;
    let page_sid = producer
        .ensure_page_session()
        .await
        .map_err(|e| SelectionError::Cdp(e.to_string()))?;

    let geom = producer.geometry().await;
    let css_w = if geom.css_width > 0.0 {
        geom.css_width
    } else {
        geometry.css_width.max(1.0)
    };
    let css_h = if geom.css_height > 0.0 {
        geom.css_height
    } else {
        geometry.css_height.max(1.0)
    };

    let clip_x = bounds.x.clamp(0.0, (css_w - 1.0).max(0.0));
    let clip_y = bounds.y.clamp(0.0, (css_h - 1.0).max(0.0));
    let max_w = (css_w - clip_x).max(1.0).min(1920.0);
    let max_h = (css_h - clip_y).max(1.0).min(1080.0);
    let clip_w = if bounds.width > 0.0 {
        bounds.width.clamp(1.0, max_w)
    } else {
        max_w.min(200.0)
    };
    let clip_h = if bounds.height > 0.0 {
        bounds.height.clamp(1.0, max_h)
    } else {
        max_h.min(200.0)
    };

    for scale in [1.0_f64, 0.5_f64] {
        let params = json!({
            "format": "png",
            "clip": {
                "x": clip_x,
                "y": clip_y,
                "width": clip_w,
                "height": clip_h,
                "scale": scale
            },
            "fromSurface": true
        });
        let res = producer
            .cdp_client
            .send_command("Page.captureScreenshot", Some(params), Some(&page_sid))
            .await
            .map_err(|e| SelectionError::Cdp(e.to_string()))?;

        let b64 = res.get("data").and_then(Value::as_str).ok_or_else(|| {
            SelectionError::Cdp("Page.captureScreenshot missing base64 data".into())
        })?;

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| SelectionError::Cdp(format!("invalid PNG base64: {e}")))?;

        if decoded.len() <= MAX_PNG_BYTES {
            return Ok(Bytes::from(decoded));
        }
    }

    Err(SelectionError::Artifact(BrowserDebugError::TooLarge))
}

pub(crate) fn stop_session_navigation_watcher(session_id: &str) {
    if let Some(watcher) = GLOBAL_NAV_WATCHERS.lock().unwrap().remove(session_id) {
        watcher.token.cancel();
    }
}

/// Removes the exact watcher registration (matched by id) on every task exit: normal return,
/// closed stream, panic or abort. A newer watcher registered for the same session is untouched.
struct NavWatcherRegistration {
    session_id: String,
    id: u64,
}

impl Drop for NavWatcherRegistration {
    fn drop(&mut self) {
        let mut watchers = GLOBAL_NAV_WATCHERS.lock().unwrap();
        if watchers
            .get(&self.session_id)
            .is_some_and(|w| w.id == self.id)
        {
            watchers.remove(&self.session_id);
        }
    }
}


/// Starts a persistent session-lifetime CDP navigation watcher decoupled from the one-shot picker.
/// Subscribes to projected `CdpLifecycleEvent`s and enables `Page` domain events before returning.
///
/// Returns whether navigation observation is live. A lagged or overflowed event stream may hide
/// a navigation: it is treated as one (selection invalidated, revision advanced) and observation
/// resumes on the same registration. A closed stream or a failed `Page.enable` leaves no
/// registration behind and reports `false`, so callers keep selection unavailable until a later
/// call restores observation.
pub(crate) async fn ensure_session_navigation_watcher(
    state: &AppState,
    session_id: &str,
    cdp: &Arc<CdpClient>,
    page_sid: &str,
) -> bool {
    install_navigation_watcher(state, session_id, cdp, page_sid, None).await
}

async fn install_navigation_watcher(
    state: &AppState,
    session_id: &str,
    cdp: &Arc<CdpClient>,
    page_sid: &str,
    gap: Option<u64>,
) -> bool {
    let generation = {
        let mut observations = NAVIGATION_OBSERVATIONS.lock().unwrap();
        let entry = observations.entry(session_id.to_string()).or_default();
        if match gap {
            Some(generation) => !entry.gap_open || entry.gap_generation != generation,
            None => entry.gap_open || entry.observed != entry.applied,
        } {
            return false;
        }
        let watchers = GLOBAL_NAV_WATCHERS.lock().unwrap();
        if let Some(watcher) = watchers.get(session_id).filter(|w| !w.token.is_cancelled()) {
            return watcher.page_sid == page_sid && watcher.cdp.ptr_eq(&Arc::downgrade(cdp));
        }
        entry.gap_generation
    };

    let event_rx = cdp.subscribe_events();
    if cdp
        .send_command("Page.enable", None, Some(page_sid))
        .await
        .is_err()
    {
        warn!(
            session_id,
            "Navigation watcher could not enable Page events; observation unavailable"
        );
        return false;
    }

    let cancel_token = CancellationToken::new();
    let watcher_id = NAV_WATCHER_SEQ.fetch_add(1, Ordering::Relaxed);
    {
        let observations = NAVIGATION_OBSERVATIONS.lock().unwrap();
        let Some(entry) = observations.get(session_id) else {
            return false;
        };
        if entry.gap_generation != generation || match gap {
            Some(expected) => !entry.gap_open || generation != expected,
            None => entry.gap_open || entry.observed != entry.applied,
        } {
            return false;
        }
        let mut watchers = GLOBAL_NAV_WATCHERS.lock().unwrap();
        if let Some(watcher) = watchers.get(session_id).filter(|w| !w.token.is_cancelled()) {
            return watcher.page_sid == page_sid && watcher.cdp.ptr_eq(&Arc::downgrade(cdp));
        }
        watchers.insert(
            session_id.to_string(),
            NavWatcher {
                id: watcher_id,
                token: cancel_token.clone(),
                cdp: Arc::downgrade(cdp),
                page_sid: page_sid.to_string(),
            },
        );
    }

    let state_clone = state.clone();
    let sid_owned = session_id.to_string();
    let page_sid_owned = page_sid.to_string();

    tokio::spawn(async move {
        let _registration = NavWatcherRegistration {
            session_id: sid_owned.clone(),
            id: watcher_id,
        };
        let mut event_rx = event_rx;
        // Disk and CDP teardown of invalidated selections is queued on the session's bounded,
        // coalescing cleanup queue (drained by session teardown and shutdown); ingestion never
        // waits for it, so a navigation that lands during a slow unlink is observed (and
        // published) immediately.
        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => break,
                evt_res = event_rx.recv() => {
                    let evt = match evt_res {
                        Ok(e) => e,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            warn!(session_id = %sid_owned, skipped, "Navigation watcher CDP event stream lagged; invalidating selection and resuming observation");
                            record_navigation_queue_cleanup(&state_clone, &sid_owned, None).await;
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            warn!(session_id = %sid_owned, "Navigation watcher CDP event stream closed; invalidating selection");
                            record_navigation_queue_cleanup(&state_clone, &sid_owned, None).await;
                            break;
                        }
                    };
                    match &*evt {
                        CdpLifecycleEvent::Overflow => {
                            warn!(session_id = %sid_owned, "Lifecycle event budget overflowed; invalidating selection and resuming observation");
                            record_navigation_queue_cleanup(&state_clone, &sid_owned, None).await;
                        }
                        CdpLifecycleEvent::FrameNavigated { session_id: evt_sid, is_main_frame, url, .. } => {
                            if evt_sid.as_deref() != Some(page_sid_owned.as_str()) {
                                continue;
                            }
                            if *is_main_frame {
                                record_navigation_queue_cleanup(&state_clone, &sid_owned, url.as_deref()).await;
                            }
                        }
                        CdpLifecycleEvent::NavigatedWithinDocument { session_id: evt_sid, url, .. } => {
                            if evt_sid.as_deref() != Some(page_sid_owned.as_str()) {
                                continue;
                            }
                            record_navigation_queue_cleanup(&state_clone, &sid_owned, url.as_deref()).await;
                        }
                        CdpLifecycleEvent::InspectNodeRequested { .. } => {}
                    }
                }
            }
        }
    });
    true
}

/// Applies a native navigation and queues the teardown it owes instead of awaiting it.
async fn record_navigation_queue_cleanup(state: &AppState, session_id: &str, url: Option<&str>) {
    if let Some(invalidated) = record_navigation_applied(state, session_id, url).await {
        invalidated.queue_teardown(state, session_id);
    }
}

/// Runs a dedicated lightweight CDP Overlay event observer attached to the target.
/// Handles `Overlay.inspectNodeRequested`, `Overlay.nodeHighlightRequested`, and `Page.frameNavigated`.
async fn run_selection_cdp_observer(
    state: AppState,
    session_id: String,
    principal: String,
    is_dev: bool,
    expected_nav_rev: u64,
    expected_sel_rev: u64,
    watch_inspect: bool,
    cancel_token: CancellationToken,
    ready_tx: oneshot::Sender<()>,
) {
    let Some(producer) = ensure_producer_for_session(&state, &session_id, &principal, is_dev).await
    else {
        debug!(
            session_id,
            "Selection observer: browser producer unavailable"
        );
        return;
    };
    let Ok(page_sid) = producer.ensure_page_session().await else {
        debug!(
            session_id,
            "Selection observer: failed to attach page session"
        );
        return;
    };

    let cdp = producer.cdp_client.clone();
    if !ensure_session_navigation_watcher(&state, &session_id, &cdp, &page_sid).await {
        warn!(
            session_id,
            "Selection observer: navigation observation unavailable; selection stays unavailable"
        );
        record_navigation_fenced(&state, &session_id, None).await;
        return;
    }
    let mut event_rx = cdp.subscribe_events();
    if watch_inspect {
        // Serialized with overlay teardown, and skipped once a newer selection replaced this
        // picker, so an obsolete picker can never re-enable native picking over a newer state.
        let gate = {
            let map = GLOBAL_SELECTION_MANAGER.sessions.read().await;
            map.get(&session_id).map(|entry| entry.overlay_gate.clone())
        };
        let _gate = match &gate {
            Some(gate) => Some(gate.lock().await),
            None => None,
        };
        if current_selection_revision(&session_id).await == Some(expected_sel_rev) {
            let dom_res = cdp.send_command("DOM.enable", None, Some(&page_sid)).await;
            let ov_res = cdp
                .send_command("Overlay.enable", None, Some(&page_sid))
                .await;
            let im_res = cdp
                .send_command(
                    "Overlay.setInspectMode",
                    Some(json!({
                        "mode": "searchForNode",
                        "highlightConfig": default_highlight_config()
                    })),
                    Some(&page_sid),
                )
                .await;
            debug!(
                session_id,
                ?dom_res,
                ?ov_res,
                ?im_res,
                "Overlay inspect mode initialized"
            );
        }
    }
    let _ = ready_tx.send(());

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                if watch_inspect {
                    let _ = cdp
                        .send_command(
                            "Overlay.setInspectMode",
                            Some(json!({ "mode": "none" })),
                            Some(&page_sid),
                        )
                        .await;
                }
                break;
            }
            evt_res = event_rx.recv() => {
                let evt = match evt_res {
                    Ok(e) => e,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        warn!(session_id, "Selection CDP event stream lagged; invalidating selection");
                        record_navigation_fenced(&state, &session_id, None).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                match &*evt {
                    CdpLifecycleEvent::Overflow => {
                        record_navigation_fenced(&state, &session_id, None).await;
                        break;
                    }
                    CdpLifecycleEvent::FrameNavigated { session_id: evt_sid, is_main_frame: true, .. }
                    | CdpLifecycleEvent::NavigatedWithinDocument { session_id: evt_sid, .. } => {
                        if evt_sid.as_deref() == Some(page_sid.as_str()) {
                            break;
                        }
                    }
                    CdpLifecycleEvent::FrameNavigated { is_main_frame: false, .. } => {}
                    CdpLifecycleEvent::InspectNodeRequested { session_id: evt_sid, backend_node_id, .. }
                        if watch_inspect =>
                    {
                        if evt_sid.as_deref() != Some(page_sid.as_str()) {
                            continue;
                        }
                        let bn_id = *backend_node_id;
                        if let Ok(resolved) = cdp
                            .send_command("DOM.resolveNode", Some(json!({ "backendNodeId": bn_id })), Some(&page_sid))
                            .await
                        {
                            if let Some(obj_id) = resolved.pointer("/object/objectId").and_then(Value::as_str).map(str::to_string) {
                                let call_res = cdp
                                    .send_command(
                                        "Runtime.callFunctionOn",
                                        Some(json!({
                                            "objectId": obj_id,
                                            "functionDeclaration": ALLOWLISTED_EXTRACTION_JS,
                                            "returnByValue": true
                                        })),
                                        Some(&page_sid),
                                    )
                                    .await;
                                let _ = cdp
                                    .send_command("Runtime.releaseObject", Some(json!({ "objectId": obj_id })), Some(&page_sid))
                                    .await;

                                if let Ok(val) = call_res {
                                    if let Some(raw_sel) = val.pointer("/result/value") {
                                        if let Ok(sel) = extract_and_sanitize_selection(raw_sel) {
                                            {
                                                let mut map = GLOBAL_SELECTION_MANAGER.sessions.write().await;
                                                if let Some(entry) = map.get_mut(&session_id) {
                                                    if entry.active
                                                        && entry.navigation_revision == expected_nav_rev
                                                        && entry.selection_revision == expected_sel_rev
                                                    {
                                                        entry.selection_revision = entry.selection_revision.saturating_add(1);
                                                        entry.active = false;
                                                        entry.backend_node_id = Some(bn_id);
                                                        entry.preview = Some(sel);
                                                    }
                                                }
                                            }
                                            let _ = cdp
                                                .send_command("Overlay.setInspectMode", Some(json!({ "mode": "none" })), Some(&page_sid))
                                                .await;
                                            let _ = cdp
                                                .send_command(
                                                    "Overlay.highlightNode",
                                                    Some(json!({ "backendNodeId": bn_id, "highlightConfig": default_highlight_config() })),
                                                    Some(&page_sid),
                                                )
                                                .await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    CdpLifecycleEvent::InspectNodeRequested { .. } => {}
                }
            }
        }
    }
}

fn default_highlight_config() -> Value {
    json!({
        "showInfo": true,
        "contentColor": { "r": 111, "g": 168, "b": 220, "a": 0.66 },
        "paddingColor": { "r": 147, "g": 196, "b": 125, "a": 0.55 },
        "borderColor": { "r": 255, "g": 229, "b": 153, "a": 0.66 },
        "marginColor": { "r": 246, "g": 178, "b": 107, "a": 0.66 }
    })
}

/// Strictly sanitizes and allowlists untrusted DOM/Runtime extraction JSON into `BrowserSelectionV1`.
/// Drops form values, passwords, HTML markup, console secrets, and control characters.
pub fn extract_and_sanitize_selection(raw: &Value) -> Result<BrowserSelectionV1, String> {
    let obj = raw
        .as_object()
        .ok_or_else(|| "selection payload must be an object".to_string())?;

    let raw_tag = obj
        .get("tag")
        .and_then(Value::as_str)
        .unwrap_or("div")
        .to_ascii_lowercase();
    let mut tag: String = raw_tag
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(MAX_TAG_LENGTH)
        .collect();
    if tag.is_empty() || !tag.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        tag = "div".to_string();
    }

    let is_form_control = matches!(tag.as_str(), "input" | "textarea" | "select");

    let role = obj
        .get("role")
        .and_then(Value::as_str)
        .and_then(|s| sanitize_optional_text(s, MAX_ROLE_LENGTH));

    let accessible_name = obj
        .get("accessibleName")
        .and_then(Value::as_str)
        .and_then(|s| sanitize_optional_text(s, MAX_ACCESSIBLE_NAME_LENGTH));

    // Never include text for form controls / password fields
    let text = if is_form_control {
        None
    } else {
        obj.get("text")
            .and_then(Value::as_str)
            .and_then(|s| sanitize_optional_text(s, MAX_TEXT_LENGTH))
    };

    let mut attributes = std::collections::BTreeMap::new();
    if let Some(attr_obj) = obj.get("attributes").and_then(Value::as_object) {
        for (k, v) in attr_obj {
            if attributes.len() >= MAX_ATTRIBUTE_COUNT {
                break;
            }
            if !matches!(
                k.as_str(),
                "id" | "class"
                    | "name"
                    | "role"
                    | "aria-label"
                    | "data-testid"
                    | "data-test"
                    | "data-cy"
            ) {
                continue;
            }
            if let Some(val_str) = v.as_str() {
                if let Some(clean_val) = sanitize_optional_text(val_str, MAX_ATTRIBUTE_VALUE_LENGTH)
                {
                    attributes.insert(k.clone(), clean_val);
                }
            }
        }
    }

    let locator = obj
        .get("locator")
        .and_then(Value::as_str)
        .and_then(|s| sanitize_optional_text(s, MAX_LOCATOR_LENGTH))
        .unwrap_or_else(|| tag.clone());

    let bounds_obj = obj.get("bounds").and_then(Value::as_object);
    let clamp_coord = |key: &str| -> f64 {
        let v = bounds_obj
            .and_then(|b| b.get(key))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if v.is_finite() {
            v.clamp(-MAX_BOUND, MAX_BOUND)
        } else {
            0.0
        }
    };
    let clamp_dim = |key: &str| -> f64 {
        let v = bounds_obj
            .and_then(|b| b.get(key))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if v.is_finite() && v >= 0.0 {
            v.clamp(0.0, MAX_BOUND)
        } else {
            0.0
        }
    };

    let selection = BrowserSelectionV1 {
        version: 1,
        tag,
        role,
        accessible_name,
        text,
        attributes,
        locator,
        bounds: BrowserSelectionBoundsV1 {
            x: clamp_coord("x"),
            y: clamp_coord("y"),
            width: clamp_dim("width"),
            height: clamp_dim("height"),
        },
    };

    if !selection.is_valid() {
        return Err("sanitized selection failed BrowserSelectionV1 validation".to_string());
    }

    Ok(selection)
}

fn sanitize_optional_text(value: &str, max_bytes: usize) -> Option<String> {
    let mut cleaned = String::with_capacity(value.len().min(max_bytes));
    let mut prev_ws = false;
    for ch in value.chars() {
        if ch.is_control() {
            if (ch == '\n' || ch == '\r' || ch == '\t') && !prev_ws && !cleaned.is_empty() {
                if cleaned.len() + 1 > max_bytes {
                    break;
                }
                cleaned.push(' ');
                prev_ws = true;
            }
            continue;
        }
        let ch_len = ch.len_utf8();
        if cleaned.len() + ch_len > max_bytes {
            break;
        }
        cleaned.push(ch);
        prev_ws = ch.is_whitespace();
    }
    let trimmed = cleaned.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_secrets_control_chars_and_form_text() {
        let raw = json!({
            "tag": "INPUT",
            "role": "textbox\x07",
            "accessibleName": "Password",
            "text": "super-secret-password-value",
            "value": "secret123",
            "innerHTML": "<script>alert(1)</script>",
            "attributes": {
                "id": "pwd-field",
                "type": "password",
                "data-secret": "nope",
                "data-testid": "login-pwd",
                "onclick": "evil()"
            },
            "locator": "form > input#pwd-field",
            "bounds": { "x": 10.5, "y": 20.0, "width": 200.0, "height": 32.0 }
        });

        let sel = extract_and_sanitize_selection(&raw).unwrap();
        assert_eq!(sel.tag, "input");
        assert_eq!(sel.role.as_deref(), Some("textbox"));
        assert_eq!(sel.accessible_name.as_deref(), Some("Password"));
        // Form control text must be omitted
        assert!(sel.text.is_none());
        // Only allowlisted attributes kept
        assert_eq!(sel.attributes.len(), 2);
        assert_eq!(
            sel.attributes.get("id").map(String::as_str),
            Some("pwd-field")
        );
        assert_eq!(
            sel.attributes.get("data-testid").map(String::as_str),
            Some("login-pwd")
        );
        assert!(!sel.attributes.contains_key("type"));
        assert!(!sel.attributes.contains_key("data-secret"));
        assert!(!sel.attributes.contains_key("onclick"));
        assert!(sel.is_valid());
    }

    #[test]
    fn sanitize_truncates_oversized_fields_at_utf8_boundaries() {
        let long_text = "é".repeat(400); // 800 bytes
        let raw = json!({
            "tag": "button",
            "text": long_text,
            "locator": "a".repeat(700),
            "bounds": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0 }
        });
        let sel = extract_and_sanitize_selection(&raw).unwrap();
        assert!(sel.text.as_ref().unwrap().len() <= MAX_TEXT_LENGTH);
        assert!(sel.locator.len() <= MAX_LOCATOR_LENGTH);
        assert!(sel.is_valid());
    }
}
