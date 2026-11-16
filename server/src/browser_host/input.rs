use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex, MutexGuard, OwnedMutexGuard};
use tokio::time::Instant;
use uuid::Uuid;

use super::input_native_release::{spawn_expiry_watcher, NativeInputTarget};
use super::protocol::TargetGeometry;

pub const LEASE_TTL: Duration = Duration::from_secs(30);
pub const LEASE_RENEWAL_WINDOW: Duration = Duration::from_secs(5);
pub const MAX_RELIABLE_RECORDS: usize = 128;
pub const MAX_RELIABLE_BYTES: usize = 256 * 1024; // 256 KiB
pub const MAX_INSERT_TEXT_BYTES: usize = 4096;
pub const MAX_FIND_QUERY_CHARS: usize = 256;
pub const MAX_SELECTED_TEXT_BYTES: usize = 64 * 1024; // 64 KiB
pub const MAX_HELD_KEYS: usize = 64;

pub type LeaseEndHook =
    Arc<dyn Fn(u64) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;
static NEXT_LEASE_EPOCH: AtomicU64 = AtomicU64::new(1);


fn truncate_utf8_bytes(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseButton {
    None,
    Left,
    Middle,
    Right,
    Back,
    Forward,
}

impl MouseButton {
    pub fn as_cdp_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Left => "left",
            Self::Middle => "middle",
            Self::Right => "right",
            Self::Back => "back",
            Self::Forward => "forward",
        }
    }

    pub fn bitmask(&self) -> u32 {
        match self {
            Self::None => 0,
            Self::Left => 1,
            Self::Right => 2,
            Self::Middle => 4,
            Self::Back => 8,
            Self::Forward => 16,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    PointerDown {
        button: MouseButton,
        u: f64,
        v: f64,
        modifiers: u32,
    },
    PointerUp {
        button: MouseButton,
        u: f64,
        v: f64,
        modifiers: u32,
    },
    PointerMove {
        u: f64,
        v: f64,
        modifiers: u32,
    },
    PointerCancel,
    Wheel {
        u: f64,
        v: f64,
        delta_x: f64,
        delta_y: f64,
        modifiers: u32,
    },
    KeyDown {
        key: String,
        code: String,
        modifiers: u32,
    },
    KeyUp {
        key: String,
        code: String,
        modifiers: u32,
    },
    InsertText {
        text: String,
    },
}

impl InputEvent {
    pub fn is_coalescable(&self) -> bool {
        matches!(self, Self::PointerMove { .. } | Self::Wheel { .. })
    }

    pub fn estimated_bytes(&self) -> usize {
        match self {
            Self::PointerDown { .. } | Self::PointerUp { .. } => 32,
            Self::PointerMove { .. } => 24,
            Self::PointerCancel => 8,
            Self::Wheel { .. } => 40,
            Self::KeyDown { key, code, .. } | Self::KeyUp { key, code, .. } => {
                key.len() + code.len() + 16
            }
            Self::InsertText { text } => text.len() + 8,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMessage {
    pub browser_session_id: String,
    pub browser_incarnation: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub profile_epoch: u64,
    pub subscription_epoch: String,
    pub lease_token: String,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub input_seq: u64,
    #[serde(with = "crate::browser_host::decimal_counter::positive")]
    pub viewport_epoch: u64,
    pub event: InputEvent,
}

struct QueuedInput {
    origin: Option<Uuid>,
    message: InputMessage,
}

pub(crate) struct InputClaim {
    gate: Option<OwnedMutexGuard<()>>,
    changed: watch::Sender<u64>,
}

impl Drop for InputClaim {
    fn drop(&mut self) {
        drop(self.gate.take());
        self.changed.send_modify(|revision| *revision = revision.wrapping_add(1));
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum InputError {
    LeaseNotFound,
    LeaseExpired,
    LeaseConflict(String),
    NotLeaseHolder,
    SequenceGap { expected: u64, actual: u64 },
    StaleSequence { current: u64, received: u64 },
    StaleViewportEpoch { expected: u64, actual: u64 },
    QueueOverflow,
    GeometryUnavailable,
    InvalidFraction { u: f64, v: f64 },
    TextTooLong { length: usize, max: usize },
    QueryTooLong { length: usize, max: usize },
    /// Held native keys/buttons could not be released: native input is unavailable until a
    /// later release succeeds. Never reported as a successful release.
    ReleaseFailed(String),
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LeaseNotFound => write!(f, "no active lease found for this session"),
            Self::LeaseExpired => write!(f, "lease has expired"),
            Self::LeaseConflict(msg) => write!(f, "lease acquisition conflict (409): {msg}"),
            Self::NotLeaseHolder => write!(f, "caller is not the active lease holder"),
            Self::SequenceGap { expected, actual } => {
                write!(f, "input sequence gap: expected {expected}, got {actual}")
            }
            Self::StaleSequence { current, received } => {
                write!(f, "stale input sequence: current {current}, received {received}")
            }
            Self::StaleViewportEpoch { expected, actual } => {
                write!(f, "stale input viewportEpoch: expected {expected}, got {actual}")
            }
            Self::QueueOverflow => write!(f, "input queue capacity or byte limit exceeded"),
            Self::GeometryUnavailable => write!(f, "geometry unavailable for coordinate conversion"),
            Self::InvalidFraction { u, v } => {
                write!(f, "invalid image fraction (out of bounds 0..1): u={u}, v={v}")
            }
            Self::TextTooLong { length, max } => {
                write!(f, "insert text length {length} exceeds maximum {max} bytes")
            }
            Self::QueryTooLong { length, max } => {
                write!(f, "find query length {length} exceeds maximum {max} characters")
            }
            Self::ReleaseFailed(msg) => {
                write!(f, "native input release failed; input unavailable: {msg}")
            }
        }
    }
}

impl std::error::Error for InputError {}

/// Converts aspect-fit image fractions to CDP CSS layout coordinates.
///
/// Normal desktop mapping:
///   x = u * css_width
///   y = v * css_height + offset_top
///
/// Scroll offsets are metadata and are NOT added to mouse coordinates.
/// DPR rescales image only, and is never multiplied twice.
pub fn map_fraction_to_css_coords(
    u: f64,
    v: f64,
    geometry: &TargetGeometry,
) -> Result<(f64, f64), InputError> {
    if !u.is_finite() || !v.is_finite() || !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
        return Err(InputError::InvalidFraction { u, v });
    }

    if geometry.css_width <= 0.0
        || geometry.css_height <= 0.0
        || !geometry.css_width.is_finite()
        || !geometry.css_height.is_finite()
        || !geometry.offset_top.is_finite()
    {
        return Err(InputError::GeometryUnavailable);
    }
    let x = u * geometry.css_width;
    let y = v * geometry.css_height + geometry.offset_top;

    Ok((x, y))
}

#[derive(Debug, Clone)]
pub struct LeaseState {
    pub lease_epoch: u64,
    pub lease_token: String,
    pub viewer_id: String,
    pub holder_kind: String, // "human" | "agent"
    pub expires_at: Instant,
    /// Authority is fenced while an ordered native cleanup is pending.
    ending: bool,
}

/// Everything natively held on behalf of the lease, captured at press time so a release can
/// replay exactly what is down (key + code, button + last pointer position) on the original
/// native identity.
#[derive(Debug, Clone, Default)]
pub struct HeldInputState {
    /// Physical code when present; empty-code events use their logical key as fallback.
    held_keys: HashMap<(bool, String), (String, String)>,
    pub held_buttons: HashSet<MouseButton>,
    /// Last pointer position (image fractions): buttons are released where the pointer is.
    pub pointer: (f64, f64),
    pub modifiers: u32,
    /// Native identity the held input was dispatched on.
    target: Option<NativeInputTarget>,
    /// Set while a failed release left native input held (input unavailable).
    release_failed: Option<String>,
    /// Bumped on every change to the held keys/buttons: a release only forgets what it
    /// snapshotted while this generation is unchanged (compare-and-clear).
    generation: u64,
}

impl HeldInputState {
    pub fn button_release_events(&self) -> Vec<InputEvent> {
        let (u, v) = self.pointer;
        self.held_buttons
            .iter()
            .map(|button| InputEvent::PointerUp { button: *button, u, v, modifiers: 0 })
            .collect()
    }

    /// Release events for every held button and key, in that order.
    pub fn generate_release_events(&self) -> Vec<InputEvent> {
        let mut releases = self.button_release_events();
        releases.extend(self.held_keys.values().map(|(key, code)| InputEvent::KeyUp {
            key: key.clone(),
            code: code.clone(),
            modifiers: 0,
        }));
        releases
    }

    pub fn is_empty(&self) -> bool {
        self.held_keys.is_empty() && self.held_buttons.is_empty()
    }

    /// Forgets exactly what a successful release dispatched (later holds stay tracked).
    fn forget_released(&mut self, released: &[InputEvent]) {
        for event in released {
            match event {
                InputEvent::PointerUp { button, .. } => {
                    self.held_buttons.remove(button);
                }
                InputEvent::KeyUp { key, code, .. } => {
                    self.held_keys.remove(&(code.is_empty(), if code.is_empty() { key.clone() } else { code.clone() }));
                }
                _ => {}
            }
        }
        if self.is_empty() {
            self.modifiers = 0;
            self.target = None;
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MouseDispatchContext {
    pub buttons: u32,
    pub move_button: Option<MouseButton>,
    pub click_count: u32,
}

#[derive(Debug, Default)]
struct MouseDispatchTracker {
    held_buttons: HashSet<MouseButton>,
    last_click: Option<(MouseButton, f64, f64, Instant, u32)>,
}

impl MouseDispatchTracker {
    fn buttons_mask(&self) -> u32 {
        self.held_buttons.iter().fold(0u32, |acc, b| acc | b.bitmask())
    }

    fn primary_held_button(&self) -> Option<MouseButton> {
        [
            MouseButton::Left,
            MouseButton::Right,
            MouseButton::Middle,
            MouseButton::Back,
            MouseButton::Forward,
        ]
        .into_iter()
        .find(|b| self.held_buttons.contains(b))
    }
}

#[derive(Clone)]
pub struct SessionInputManager(Arc<SessionInputManagerState>);

impl std::ops::Deref for SessionInputManager {
    type Target = SessionInputManagerState;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub struct SessionInputManagerState {
    lease: Mutex<Option<LeaseState>>,
    authority_generation: AtomicU64,
    last_ended_lease: Mutex<Option<(String, u64)>>,
    last_processed_seq: Mutex<u64>,
    expected_viewport_epoch: Mutex<Option<u64>>,
    queue: Mutex<VecDeque<QueuedInput>>,
    queue_changed: watch::Sender<u64>,
    queue_dispatch: Arc<Mutex<()>>,
    total_queued_bytes: Mutex<usize>,
    held_state: Arc<Mutex<HeldInputState>>,
    dispatch_mouse: Arc<Mutex<MouseDispatchTracker>>,
    /// Unanswered submitted input requires target teardown before this manager is reused.
    native_outcome_uncertain: Arc<AtomicBool>,
    selected_text: Mutex<String>,
    lease_ttl: Duration,
    /// Orders native dispatch against native release. It guards no state: a dispatch holds it
    /// across its CDP call, a release holds it across its releases, while `lease`/`held_state`
    /// are only ever locked briefly (never across a CDP await).
    native_gate: Arc<Mutex<()>>,
    /// Blocks new leases while a producer's native session is being replaced.
    recovery_suspended: AtomicBool,
    /// A dropped control dispatch must finish cleanup before another lease or input proceeds.
    dispatch_abandoned: AtomicU64,
    /// The at-most-one native input command currently competing with a lease fence.
    active_input: std::sync::Mutex<Option<(String, super::cdp::InputCommandCancellation)>>,
    /// Publishes the live lease's expiry to the active expiry watcher.
    expiry: watch::Sender<Option<Instant>>,
    expiry_watcher_started: AtomicBool,
    lease_end_hook: std::sync::Mutex<Option<LeaseEndHook>>,
}

impl Default for SessionInputManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionInputManager {
    pub fn new() -> Self {
        Self::with_lease_ttl(LEASE_TTL)
    }

    pub fn with_lease_ttl(lease_ttl: Duration) -> Self {
        Self(Arc::new(SessionInputManagerState {
            lease: Mutex::new(None),
            authority_generation: AtomicU64::new(0),
            last_ended_lease: Mutex::new(None),
            last_processed_seq: Mutex::new(0),
            expected_viewport_epoch: Mutex::new(None),
            queue: Mutex::new(VecDeque::new()),
            queue_changed: watch::channel(0).0,
            queue_dispatch: Arc::new(Mutex::new(())),
            total_queued_bytes: Mutex::new(0),
            held_state: Arc::new(Mutex::new(HeldInputState::default())),
            selected_text: Mutex::new(String::new()),
            native_outcome_uncertain: Arc::new(AtomicBool::new(false)),
            dispatch_mouse: Arc::new(Mutex::new(MouseDispatchTracker::default())),
            lease_ttl,
            native_gate: Arc::new(Mutex::new(())),
            recovery_suspended: AtomicBool::new(false),
            dispatch_abandoned: AtomicU64::new(0),
            active_input: std::sync::Mutex::new(None),
            expiry: watch::channel(None).0,
            expiry_watcher_started: AtomicBool::new(false),
            lease_end_hook: std::sync::Mutex::new(None),
        }))
    }

    /// Production constructor: shared manager whose leases expire ACTIVELY (the watcher
    /// releases held native input at the deadline, not on the next message).
    pub fn new_shared(lease_ttl: Duration) -> Arc<Self> {
        let manager = Arc::new(Self::with_lease_ttl(lease_ttl));
        manager.start_expiry_watcher();
        manager
    }

    fn start_expiry_watcher(self: &Arc<Self>) {
        if !self.expiry_watcher_started.swap(true, Ordering::SeqCst) {
            spawn_expiry_watcher(Arc::downgrade(self), self.expiry.subscribe());
        }
    }
    pub fn set_lease_end_hook(&self, hook: LeaseEndHook) {
        *self.lease_end_hook.lock().unwrap() = Some(hook);
    }


    pub async fn is_lease_holder(&self, viewer_id: &str) -> bool {
        let guard = self.lease.lock().await;
        guard.as_ref().is_some_and(|l| !l.ending && l.viewer_id == viewer_id)
    }

    pub async fn validate_lease(&self, lease_token: &str) -> Result<(), InputError> {
        self.validate_lease_epoch(lease_token).await.map(|_| ())
    }

    pub async fn validate_lease_epoch(&self, lease_token: &str) -> Result<u64, InputError> {
        let now = Instant::now();
        let lease_guard = self.lease.lock().await;
        let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        if lease.ending {
            return Err(InputError::LeaseNotFound);
        }
        if lease.expires_at <= now {
            return Err(InputError::LeaseExpired);
        }
        Ok(lease.lease_epoch)
    }

    pub async fn is_lease_epoch_live(&self, lease_epoch: u64) -> bool {
        let now = Instant::now();
        let lease_guard = self.lease.lock().await;
        lease_guard
            .as_ref()
            .is_some_and(|l| !l.ending && l.lease_epoch == lease_epoch && l.expires_at > now)
    }

    /// Acquires cooperative control lease.
    ///
    /// Returns lease token and expires_at unix ms. A release that failed earlier (native input
    /// still held) is retried first; the lease is only granted once native state is clean.
    pub async fn acquire_lease(
        &self,
        viewer_id: &str,
        holder_kind: &str,
    ) -> Result<(String, i64), InputError> {
        let authority = self.authority_generation.load(Ordering::Acquire);
        if authority == u64::MAX {
            return Err(InputError::GeometryUnavailable);
        }
        // Keep the dispatch/release barrier until the lease is published. Otherwise a
        // concurrent revoke can complete between this check and the lease assignment.
        let gate = self.native_gate.clone().lock_owned().await;
        if self.recovery_suspended.load(Ordering::Acquire)
            || self.dispatch_abandoned.load(Ordering::Acquire) != 0
        {
            return Err(InputError::GeometryUnavailable);
        }
        let predecessor = {
            let lease = self.lease.lock().await;
            if let Some(existing) = lease.as_ref() {
                if existing.ending {
                    return Err(InputError::GeometryUnavailable);
                }
                if existing.expires_at > Instant::now() && existing.viewer_id != viewer_id {
                    return Err(InputError::LeaseConflict(format!(
                        "control is already held by viewer {}",
                        existing.viewer_id
                    )));
                }
            }
            lease.as_ref().map(|existing| existing.lease_token.clone())
        };
        // Cleanup owns the barrier independently; cancelling this request cannot abandon
        // unresolved holds, and a cancelled request never publishes a successor.
        let held = self.held_state.clone();
        let mouse = self.dispatch_mouse.clone();
        let uncertain = self.native_outcome_uncertain.clone();
        let cleanup = tokio::spawn(async move {
            let result = Self::dispatch_held_release_state(&held, &mouse, &uncertain, false).await;
            (gate, result)
        });
        let (gate, result) = cleanup.await.map_err(|_| {
            InputError::ReleaseFailed("native cleanup task failed".into())
        })?;
        result?;
        let mut lease_guard = self.lease.lock().await;
        if self.recovery_suspended.load(Ordering::Acquire)
            || self.dispatch_abandoned.load(Ordering::Acquire) != 0
            || lease_guard.as_ref().is_some_and(|lease| lease.ending)
            || lease_guard.as_ref().map(|lease| &lease.lease_token) != predecessor.as_ref()
        {
            return Err(InputError::GeometryUnavailable);
        }
        // Acquire all bookkeeping locks before removing the predecessor. No await occurs
        // between ending it and publishing the successor.
        let mut last_ended = self.last_ended_lease.lock().await;
        let mut sequence = self.last_processed_seq.lock().await;
        let mut queue = self.queue.lock().await;
        let mut bytes = self.total_queued_bytes.lock().await;
        let mut mouse = self.dispatch_mouse.lock().await;
        if self.authority_generation.load(Ordering::Acquire) != authority
            || self.recovery_suspended.load(Ordering::Acquire)
            || self.dispatch_abandoned.load(Ordering::Acquire) != 0
        {
            return Err(InputError::GeometryUnavailable);
        }
        let ended = lease_guard.take();
        let ended_epoch = ended.as_ref().map(|lease| lease.lease_epoch);
        if let Some(ended) = ended {
            *last_ended = Some((ended.lease_token, ended.lease_epoch));
        }
        queue.clear();
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        *bytes = 0;
        let now = Instant::now();

        let lease_token = Uuid::new_v4().to_string();
        let expires_at = now + self.lease_ttl;
        let expires_at_unix_ms =
            chrono::Utc::now().timestamp_millis() + self.lease_ttl.as_millis() as i64;
        let lease_epoch = NEXT_LEASE_EPOCH.fetch_add(1, Ordering::SeqCst);

        *lease_guard = Some(LeaseState {
            lease_epoch,
            lease_token: lease_token.clone(),
            viewer_id: viewer_id.to_string(),
            ending: false,
            holder_kind: holder_kind.to_string(),
            expires_at,
        });
        self.expiry.send_replace(Some(expires_at));

        *sequence = 0;
        *mouse = MouseDispatchTracker::default();
        drop(mouse);
        drop(bytes);
        drop(queue);
        drop(sequence);
        drop(last_ended);
        drop(lease_guard);
        drop(gate);
        if let Some(epoch) = ended_epoch {
            let hook = self.lease_end_hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                let task = tokio::spawn(async move { hook(epoch).await });
                let _ = task.await;
            }
        }

        Ok((lease_token, expires_at_unix_ms))
    }

    pub async fn set_expected_viewport_epoch(&self, epoch: u64) {
        *self.expected_viewport_epoch.lock().await = Some(epoch);
    }

    /// Rejects every input message until `set_expected_viewport_epoch` publishes the committed
    /// identity: epoch 0 is never a valid (positive) wire epoch, so each message is stale.
    pub async fn fence_viewport_epoch(&self) {
        *self.expected_viewport_epoch.lock().await = Some(0);
    }

    /// Renews active lease for current holder, clipping expiry to auth deadline.
    pub async fn renew_lease(
        &self,
        lease_token: &str,
        effective_deadline: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<i64, InputError> {
        self.renew_lease_with_epoch(lease_token, effective_deadline)
            .await
            .map(|(exp, _)| exp)
    }

    /// Renews active lease for current holder and returns `(expires_at_unix_ms, lease_epoch)`.
    pub async fn renew_lease_with_epoch(
        &self,
        lease_token: &str,
        effective_deadline: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(i64, u64), InputError> {
        let mut lease_guard = self.lease.lock().await;
        let now = Instant::now();
        let now_utc = chrono::Utc::now();

        let lease = lease_guard.as_mut().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        if lease.ending {
            return Err(InputError::LeaseNotFound);
        }
        if lease.expires_at <= now {
            return Err(InputError::LeaseExpired);
        }

        let mut ttl = self.lease_ttl;
        if let Some(deadline) = effective_deadline {
            let until_deadline = deadline.signed_duration_since(now_utc);
            if until_deadline.num_milliseconds() <= 0 {
                return Err(InputError::LeaseExpired);
            }
            let deadline_duration = Duration::from_millis(until_deadline.num_milliseconds() as u64);
            if deadline_duration < ttl {
                ttl = deadline_duration;
            }
        }

        lease.expires_at = now + ttl;
        self.expiry.send_replace(Some(lease.expires_at));
        let expires_at_unix_ms = now_utc.timestamp_millis() + ttl.as_millis() as i64;

        Ok((expires_at_unix_ms, lease.lease_epoch))
    }

    /// Drains in-process input without stealing records owned by control connections.
    pub async fn drain_inputs(&self) -> Vec<InputMessage> {
        let mut result = Vec::new();
        while let Some(message) = self.pop_next_input().await {
            result.push(message);
        }
        result
    }

    /// Pops the next in-process record, preserving the shared dispatch claim.
    pub async fn pop_next_input(&self) -> Option<InputMessage> {
        let (message, _claim) = self.claim_queued_from(None).await?;
        Some(message)
    }

    pub(crate) fn subscribe_input_queue(&self) -> watch::Receiver<u64> {
        self.queue_changed.subscribe()
    }

    pub(crate) async fn has_queued_from(&self, origin: Option<Uuid>) -> bool {
        self.queue.lock().await.iter().any(|item| item.origin == origin)
    }

    pub(crate) async fn claim_queued_from(&self, origin: Option<Uuid>) -> Option<(InputMessage, InputClaim)> {
        let mut queue = self.queue.lock().await;
        if queue.front().is_none_or(|item| item.origin != origin) {
            return None;
        }
        let mut bytes = self.total_queued_bytes.lock().await;
        let gate = self.queue_dispatch.clone().try_lock_owned().ok()?;
        let item = queue.pop_front().expect("checked queue head");
        *bytes = bytes.saturating_sub(item.message.event.estimated_bytes());
        Some((item.message, InputClaim { gate: Some(gate), changed: self.queue_changed.clone() }))
    }

    pub(crate) async fn discard_queued_from(&self, origin: Uuid) {
        let mut queue = self.queue.lock().await;
        let mut bytes = self.total_queued_bytes.lock().await;
        queue.retain(|item| {
            if item.origin == Some(origin) {
                *bytes = bytes.saturating_sub(item.message.event.estimated_bytes());
                false
            } else {
                true
            }
        });
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
    }


    /// Why native input is unavailable, while a failed release left keys/buttons held.
    pub async fn release_failure(&self) -> Option<String> {
        if self.native_outcome_uncertain.load(Ordering::Acquire) {
            return Some("native input outcome is unresolved; close the browser session".into());
        }
        self.held_state.lock().await.release_failed.clone()
    }

    /// Orders a geometry fence against input already in native dispatch.
    pub(crate) async fn begin_geometry_fence(&self) -> MutexGuard<'_, ()> {
        self.native_gate.lock().await
    }

    /// Serializes one native dispatch against releases. `None` when the lease was ended
    /// meanwhile (expiry, release, revoke): the queued event is then dropped, never dispatched
    /// after the release that would otherwise leave it stuck.
    pub async fn begin_dispatch(&self, lease_token: &str) -> Option<OwnedMutexGuard<()>> {
        let mut changed = self.queue_changed.subscribe();
        loop {
            changed.borrow_and_update();
            let gate = self.native_gate.clone().lock_owned().await;
            if self.native_outcome_uncertain.load(Ordering::Acquire) {
                return None;
            }
            if self.dispatch_abandoned.load(Ordering::Acquire) != 0 {
                drop(gate);
                changed.changed().await.ok()?;
                continue;
            }
            self.validate_lease(lease_token).await.ok()?;
            if self.held_state.lock().await.release_failed.is_some() {
                return None;
            }
            return Some(gate);
        }
    }

    /// Register the actor write race while holding the same lease lock used by authority fences.
    pub(crate) async fn register_input_cancellation(
        &self,
        _gate: &OwnedMutexGuard<()>,
        token: &str,
        cancellation: super::cdp::InputCommandCancellation,
    ) -> bool {
        let lease = self.lease.lock().await;
        if !lease.as_ref().is_some_and(|lease| {
            !lease.ending && lease.lease_token == token && lease.expires_at > Instant::now()
        }) {
            return false;
        }
        *self.active_input.lock().unwrap() = Some((token.to_owned(), cancellation));
        true
    }

    pub(crate) fn clear_input_cancellation(&self, cancellation: &super::cdp::InputCommandCancellation) {
        let mut active = self.active_input.lock().unwrap();
        if active.as_ref().is_some_and(|(_, current)| current.same_as(cancellation)) {
            *active = None;
        }
    }

    fn cancel_registered_input(&self, token: &str) {
        if let Some((active_token, cancellation)) = self.active_input.lock().unwrap().as_ref() {
            if active_token == token {
                cancellation.cancel_before_write();
            }
        }
    }

    // Called under `lease`; generation exhaustion permanently fences acquisition.
    fn advance_authority_generation(&self) {
        if self.authority_generation.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1)).is_err() {
            self.recovery_suspended.store(true, Ordering::Release);
        }
    }

    /// Fence lease acquisition and dispatch, then release held input on its original target.
    /// On failure the fence remains closed until the owning session is explicitly cleaned up.
    pub(crate) async fn suspend_for_recovery(&self) -> Result<(), InputError> {
        let manager = self.clone();
        tokio::spawn(async move { manager.suspend_for_recovery_owned().await })
            .await
            .unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    async fn suspend_for_recovery_owned(&self) -> Result<(), InputError> {
        {
            let mut lease = self.lease.lock().await;
            self.recovery_suspended.store(true, Ordering::Release);
            self.advance_authority_generation();
            if let Some(lease) = lease.as_mut() {
                lease.ending = true;
                self.cancel_registered_input(&lease.lease_token);
            }
        }
        let gate = self.native_gate.clone().lock_owned().await;
        self.recovery_suspended.store(true, Ordering::Release);
        let mut lease = self.lease.lock().await;
        let mut last_ended = self.last_ended_lease.lock().await;
        let mut queue = self.queue.lock().await;
        let mut bytes = self.total_queued_bytes.lock().await;
        let ended = lease.take();
        let epoch = ended.as_ref().map(|lease| lease.lease_epoch);
        if let Some(ended) = ended {
            *last_ended = Some((ended.lease_token, ended.lease_epoch));
        }
        self.expiry.send_replace(None);
        queue.clear();
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        *bytes = 0;
        let held = self.held_state.clone();
        let mouse = self.dispatch_mouse.clone();
        let uncertain = self.native_outcome_uncertain.clone();
        let hook = self.lease_end_hook.lock().unwrap().clone();
        let cleanup = tokio::spawn(async move {
            let result = Self::dispatch_held_release_state(&held, &mouse, &uncertain, false).await;
            drop(gate);
            if let (Some(epoch), Some(hook)) = (epoch, hook) {
                hook(epoch).await;
            }
            result
        });
        drop(bytes);
        drop(queue);
        drop(last_ended);
        drop(lease);
        cleanup.await.unwrap_or_else(|_| {
            Err(InputError::ReleaseFailed("native cleanup task failed".into()))
        })
    }

    pub(crate) async fn resume_after_recovery(&self) {
        let _gate = self.native_gate.lock().await;
        if self.held_state.lock().await.release_failed.is_none() {
            self.recovery_suspended.store(false, Ordering::Release);
        }
    }

    /// Releases active lease: held keys/buttons are released on the original native identity
    /// BEFORE the held state is forgotten. A failed release is `ReleaseFailed`, never success.
    pub async fn release_lease(&self, lease_token: &str) -> Result<Option<u64>, InputError> {
        let token = lease_token.to_owned();
        let ended = self
            .end_lease(
                move |lease| match lease {
                    Some(lease) if lease.lease_token != token => Err(InputError::NotLeaseHolder),
                    _ => Ok(true),
                },
                true,
            )
            .await?;
        if ended.is_some() {
            return Ok(ended);
        }
        let last = self.last_ended_lease.lock().await;
        Ok(last
            .as_ref()
            .and_then(|(tok, epoch)| (tok == lease_token).then_some(*epoch)))
    }

    /// Forces revocation of the active lease (auth cancel, session end) with native release.
    pub async fn revoke_lease(&self) -> Result<(), InputError> {
        self.end_lease(|_| Ok(true), true).await.map(|_| ())
    }

    /// Revokes the lease only while `viewer_id` still holds it (decided atomically).
    pub async fn revoke_lease_if_holder(&self, viewer_id: &str) -> Result<(), InputError> {
        let viewer_id = viewer_id.to_owned();
        self.end_lease(
            move |lease| Ok(lease.is_some_and(|l| l.viewer_id == viewer_id)),
            true,
        )
        .await
        .map(|_| ())
    }

    /// Fence this viewer synchronously, then keep native cleanup owned independently.
    pub(crate) async fn fence_control_holder(
        &self,
        viewer_id: &str,
    ) -> Option<tokio::task::JoinHandle<Result<Option<u64>, InputError>>> {
        let mut lease = self.lease.lock().await;
        let lease = lease.as_mut()?;
        if lease.viewer_id != viewer_id {
            return None;
        }
        self.advance_authority_generation();
        lease.ending = true;
        self.cancel_registered_input(&lease.lease_token);
        let token = lease.lease_token.clone();
        let manager = self.clone();
        Some(tokio::spawn(async move {
            manager.end_lease_owned(
                move |current| Ok(current.is_some_and(|lease| lease.lease_token == token)),
                true,
            ).await
        }))
    }

    /// Ends the lease at its deadline (active expiry), releasing held native input.
    pub async fn expire_if_due(&self) -> Result<(), InputError> {
        let now = Instant::now();
        self.end_lease(
            move |lease| Ok(lease.is_some_and(|l| l.expires_at <= now)),
            true,
        )
        .await
        .map(|_| ())
    }

    /// In-memory half of a revoke: the lease and queued input end immediately (no further
    /// input is accepted) while the native release is left to [`Self::release_native`]. For
    /// fences that must not wait on the browser.
    pub async fn fence_lease(&self) {
        let mut lease = self.lease.lock().await;
        self.advance_authority_generation();
        if let Some(current) = lease.as_ref() {
            if let Some((token, cancellation)) = self.active_input.lock().unwrap().as_ref() {
                if token == &current.lease_token {
                    cancellation.cancel_before_write();
                }
            }
        }
        if let Some(ended) = lease.take() {
            *self.last_ended_lease.lock().await = Some((ended.lease_token, ended.lease_epoch));
        }
        self.expiry.send_replace(None);
        let mut queue = self.queue.lock().await;
        let mut bytes = self.total_queued_bytes.lock().await;
        queue.clear();
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        *bytes = 0;
    }

    /// Releases every held key and button on the captured native identity.
    pub async fn release_native(&self) -> Result<(), InputError> {
        let gate = self.native_gate.clone().lock_owned().await;
        let held = self.held_state.clone();
        let mouse = self.dispatch_mouse.clone();
        let uncertain = self.native_outcome_uncertain.clone();
        tokio::spawn(async move {
            let result = Self::dispatch_held_release_state(&held, &mouse, &uncertain, false).await;
            drop(gate);
            result
        }).await.unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    /// PointerCancel: releases the held buttons natively (keys stay down).
    pub async fn release_pointer_buttons(&self) -> Result<(), InputError> {
        let gate = self.native_gate.clone().lock_owned().await;
        let held = self.held_state.clone();
        let mouse = self.dispatch_mouse.clone();
        let uncertain = self.native_outcome_uncertain.clone();
        tokio::spawn(async move {
            let result = Self::dispatch_held_release_state(&held, &mouse, &uncertain, true).await;
            drop(gate);
            result
        }).await.unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    pub(crate) async fn has_unresolved_native_input(&self, _gate: &OwnedMutexGuard<()>) -> bool {
        let held = self.held_state.lock().await;
        !held.is_empty() || held.release_failed.is_some()
            || self.native_outcome_uncertain.load(Ordering::Acquire)
    }

    pub(crate) async fn cancel_pointer_owned(
        self: &Arc<Self>,
        gate: OwnedMutexGuard<()>,
        token: &str,
    ) -> Result<bool, InputError> {
        let manager = self.clone();
        let token = token.to_owned();
        tokio::spawn(async move {
            match manager.dispatch_held_release(&gate, true).await {
                Ok(()) => Ok(true),
                Err(_) => {
                    manager.fail_native_dispatch_owned(gate, &token).await?;
                    Ok(false)
                }
            }
        }).await.unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    /// Releasing{target = captured identity, held = snapshot}: lease cleared, then the
    /// snapshot is released natively with no state lock across the CDP awaits.
    async fn end_lease(
        &self,
        decide: impl Fn(Option<&LeaseState>) -> Result<bool, InputError> + Send + 'static,
        run_hook: bool,
    ) -> Result<Option<u64>, InputError> {
        let manager = self.clone();
        tokio::spawn(async move { manager.end_lease_owned(decide, run_hook).await })
            .await
            .unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    async fn end_lease_owned(
        &self,
        decide: impl Fn(Option<&LeaseState>) -> Result<bool, InputError>,
        run_hook: bool,
    ) -> Result<Option<u64>, InputError> {
        let fenced_token = {
            let mut lease = self.lease.lock().await;
            if !decide(lease.as_ref())? {
                return Ok(None);
            }
            self.advance_authority_generation();
            if let Some(lease) = lease.as_mut() {
                lease.ending = true;
                self.cancel_registered_input(&lease.lease_token);
                Some(lease.lease_token.clone())
            } else {
                None
            }
        };
        let gate = self.native_gate.clone().lock_owned().await;
        let mut lease = self.lease.lock().await;
        if lease.as_ref().map(|lease| &lease.lease_token) != fenced_token.as_ref()
            || !decide(lease.as_ref())?
        {
            return Ok(None);
        }
        // Lock all bookkeeping before removing authority; cancellation before this point
        // leaves the lease and its expiry watcher intact.
        let mut last_ended = self.last_ended_lease.lock().await;
        let mut queue = self.queue.lock().await;
        let mut bytes = self.total_queued_bytes.lock().await;
        let ended_lease = lease.take();
        let ended_epoch = ended_lease.as_ref().map(|l| l.lease_epoch);
        if let Some(ended) = ended_lease {
            *last_ended = Some((ended.lease_token, ended.lease_epoch));
        }
        self.expiry.send_replace(None);
        queue.clear();
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        *bytes = 0;
        let held = self.held_state.clone();
        let mouse = self.dispatch_mouse.clone();
        let uncertain = self.native_outcome_uncertain.clone();
        let hook = self.lease_end_hook.lock().unwrap().clone();
        // This task owns the barrier and cleanup after authority is removed, even if the
        // request, websocket, or expiry watcher awaiting it is cancelled.
        let cleanup = tokio::spawn(async move {
            let result = Self::dispatch_held_release_state(&held, &mouse, &uncertain, false).await;
            drop(gate);
            if run_hook || result.is_err() {
                if let (Some(epoch), Some(hook)) = (ended_epoch, hook) {
                    hook(epoch).await;
                }
            }
            result.map(|()| ended_epoch)
        });
        drop(bytes);
        drop(queue);
        drop(last_ended);
        drop(lease);
        cleanup.await.unwrap_or_else(|_| {
            Err(InputError::ReleaseFailed("native cleanup task failed".into()))
        })
    }

    /// Snapshot under the lock, dispatch with it dropped, re-lock and forget exactly what was
    /// released. A failure keeps the held state, remembers the failure (input unavailable) and
    /// is returned.
    async fn dispatch_held_release(
        &self,
        _gate: &(),
        buttons_only: bool,
    ) -> Result<(), InputError> {
        Self::dispatch_held_release_state(&self.held_state, &self.dispatch_mouse, &self.native_outcome_uncertain, buttons_only).await
    }

    async fn dispatch_held_release_state(
        held_state: &Mutex<HeldInputState>,
        dispatch_mouse: &Mutex<MouseDispatchTracker>,
        uncertain: &AtomicBool,
        buttons_only: bool,
    ) -> Result<(), InputError> {
        if uncertain.load(Ordering::Acquire) {
            return Err(InputError::ReleaseFailed(
                "native input outcome is unresolved; close the browser session".into(),
            ));
        }
        let (target, events, generation) = {
            let held = held_state.lock().await;
            let events = if buttons_only {
                held.button_release_events()
            } else {
                held.generate_release_events()
            };
            (held.target.clone(), events, held.generation)
        };
        // A nonempty ledger without its captured target cannot be safely forgotten.
        let mut failure = (target.is_none() && !events.is_empty())
            .then(|| "native input target is unavailable".to_string());
        if let Some(target) = &target {
            for event in &events {
                if let Err(err) = target.dispatch(event).await {
                    let ambiguous = err.outcome_is_ambiguous();
                    failure.get_or_insert_with(|| err.to_string());
                    if ambiguous {
                        uncertain.store(true, Ordering::Release);
                        break;
                    }
                }
            }
        }
        let mut held = held_state.lock().await;
        match failure {
            None => {
                // A hold recorded while the release was in flight stays tracked (a later
                // release replays it); releasing an extra time is harmless, forgetting a
                // fresh press is not.
                if held.generation == generation {
                    held.forget_released(&events);
                }
                if !events.iter().any(|e| matches!(e, InputEvent::PointerUp { .. })) {
                    // No-op when only keys were released
                } else {
                    let mut dm = dispatch_mouse.lock().await;
                    for event in &events {
                        if let InputEvent::PointerUp { button, .. } = event {
                            dm.held_buttons.remove(button);
                        }
                    }
                }
                if held.is_empty() {
                    held.release_failed = None;
                }
                Ok(())
            }
            Some(err) => {
                held.release_failed = Some(err.clone());
                Err(InputError::ReleaseFailed(err))
            }
        }
    }

    /// Enqueues and validates an incoming reliable input message presented with a lease token
    /// (in-process callers that already own the token). Socket-facing code binds the lease to
    /// the authenticated viewer through [`Self::enqueue_input_for_viewer`].
    pub async fn enqueue_input(&self, msg: InputMessage) -> Result<Option<InputMessage>, InputError> {
        self.enqueue_validated(None, None, false, msg).await
    }

    /// As [`Self::enqueue_input`], but the lease must be held by `viewer_id`, the viewer
    /// authenticated on the control socket: a foreign viewer never uses another's lease.
    pub async fn enqueue_input_for_viewer(
        &self,
        viewer_id: &str,
        msg: InputMessage,
    ) -> Result<Option<InputMessage>, InputError> {
        self.enqueue_validated(Some(viewer_id), None, false, msg).await
    }

    pub(crate) async fn enqueue_socket_input(
        &self,
        viewer_id: &str,
        origin: Uuid,
        msg: InputMessage,
    ) -> Result<Option<InputMessage>, InputError> {
        self.enqueue_validated(Some(viewer_id), Some(origin), true, msg).await
    }

    /// Checks lease validity, contiguous decimal sequence, and enforces the bounded queue.
    /// Coalesces adjacent pointer moves. A sequence gap or queue overflow ends the lease
    /// with a native release.
    async fn enqueue_validated(
        &self,
        viewer: Option<&str>,
        origin: Option<Uuid>,
        defer_cleanup: bool,
        msg: InputMessage,
    ) -> Result<Option<InputMessage>, InputError> {
        let now = Instant::now();
        // Hold the lease through sequence/queue admission so a replacement cannot inherit
        // records or sequence numbers from an event validated against its predecessor.
        let mut lease_guard = self.lease.lock().await;
        if self.native_outcome_uncertain.load(Ordering::Acquire) {
            return Err(InputError::GeometryUnavailable);
        }
        let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != msg.lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        if viewer.is_some_and(|viewer| lease.viewer_id != viewer) {
            return Err(InputError::NotLeaseHolder);
        }
        if lease.ending {
            return Err(InputError::LeaseNotFound);
        }
        if lease.expires_at <= now {
            return Err(InputError::LeaseExpired);
        }

        // Validate viewport epoch
        {
            let expected_epoch_guard = self.expected_viewport_epoch.lock().await;
            if let Some(expected_epoch) = *expected_epoch_guard {
                if msg.viewport_epoch != expected_epoch {
                    return Err(InputError::StaleViewportEpoch {
                        expected: expected_epoch,
                        actual: msg.viewport_epoch,
                    });
                }
            }
        }

        // Validate text length if InsertText
        if let InputEvent::InsertText { ref text } = msg.event {
            if text.len() > MAX_INSERT_TEXT_BYTES {
                return Err(InputError::TextTooLong {
                    length: text.len(),
                    max: MAX_INSERT_TEXT_BYTES,
                });
            }
        }

        // Sequence + queue bounds under their locks; a violation is only RECORDED here and
        // acted on after the guards are gone (the revoke awaits the native release).
        let violation = {
            let mut seq_guard = self.last_processed_seq.lock().await;
            let expected = *seq_guard + 1;
            if msg.input_seq == *seq_guard {
                // Duplicate event, ignore safely
                return Ok(None);
            }
            if msg.input_seq != expected {
                // Sequence gap or out-of-order sequence: revoke lease immediately
                Some(InputError::SequenceGap { expected, actual: msg.input_seq })
            } else {
                *seq_guard = msg.input_seq;
                let msg_bytes = msg.event.estimated_bytes();
                let mut q_guard = self.queue.lock().await;
                let mut bytes_guard = self.total_queued_bytes.lock().await;
                if q_guard.len() >= MAX_RELIABLE_RECORDS
                    || *bytes_guard + msg_bytes > MAX_RELIABLE_BYTES
                {
                    Some(InputError::QueueOverflow)
                } else {
                    let coalesced = matches!(msg.event, InputEvent::PointerMove { .. })
                        && q_guard.back_mut().is_some_and(|last| {
                            let previous = &mut last.message;
                            if last.origin == origin
                                && previous.lease_token == msg.lease_token
                                && previous.subscription_epoch == msg.subscription_epoch
                                && previous.viewport_epoch == msg.viewport_epoch
                                && matches!(previous.event, InputEvent::PointerMove { .. })
                            {
                                previous.event = msg.event.clone();
                                previous.input_seq = msg.input_seq;
                                true
                            } else {
                                false
                            }
                        });
                    if !coalesced {
                        *bytes_guard += msg_bytes;
                        q_guard.push_back(QueuedInput { origin, message: msg.clone() });
                    }
                    self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
                    None
                }
            }
        };
        if violation.is_some() && defer_cleanup {
            if let Some(lease) = lease_guard.as_mut() {
                lease.ending = true;
                self.cancel_registered_input(&lease.lease_token);
            }
        }
        drop(lease_guard);
        if let Some(violation) = violation {
            let token = msg.lease_token;
            // Only the lease that violated the contract ends; a newer holder is untouched.
            if defer_cleanup {
                let manager = self.clone();
                tokio::spawn(async move {
                    if let Err(error) = manager.end_lease_owned(
                        move |lease| Ok(lease.is_some_and(|l| l.lease_token == token)),
                        true,
                    ).await {
                        tracing::warn!(%error, "input violation cleanup failed");
                    }
                });
            } else {
                let _ = self
                    .end_lease(move |lease| Ok(lease.is_some_and(|l| l.lease_token == token)), true)
                    .await;
            }
            return Err(violation);
        }
        Ok(Some(msg))
    }

    /// Record effects which may have reached Chromium before awaiting its reply. A release
    /// remains in the ledger until its own native acknowledgement arrives.
    pub async fn prepare_native_input(
        &self,
        _gate: &OwnedMutexGuard<()>,
        target: NativeInputTarget,
        event: &InputEvent,
    ) -> Result<(), InputError> {
        let mut held = self.held_state.lock().await;
        if !held.is_empty() {
            let Some(current) = &held.target else {
                return Err(InputError::GeometryUnavailable);
            };
            if !Arc::ptr_eq(&current.client, &target.client)
                || current.page_session_id != target.page_session_id
            {
                return Err(InputError::GeometryUnavailable);
            }
        } else {
            held.target = Some(target);
        }
        match event {
            InputEvent::PointerDown { button, u, v, modifiers } => {
                held.held_buttons.insert(*button);
                held.generation += 1;
                held.pointer = (*u, *v);
                held.modifiers = *modifiers;
            }
            InputEvent::KeyDown { key, code, modifiers } => {
                let identity = (code.is_empty(), if code.is_empty() { key.clone() } else { code.clone() });
                if !held.held_keys.contains_key(&identity) && held.held_keys.len() >= MAX_HELD_KEYS {
                    return Err(InputError::QueueOverflow);
                }
                held.held_keys.insert(identity, (key.clone(), code.clone()));
                held.generation += 1;
                held.modifiers = *modifiers;
            }
            InputEvent::PointerUp { u, v, modifiers, .. }
            | InputEvent::PointerMove { u, v, modifiers }
            | InputEvent::Wheel { u, v, modifiers, .. } => {
                held.pointer = (*u, *v);
                held.modifiers = *modifiers;
            }
            _ => {}
        }
        Ok(())
    }

    /// Forget releases only after Chromium confirms them.
    pub async fn confirm_native_input(&self, _gate: &OwnedMutexGuard<()>, event: &InputEvent) {
        if matches!(event, InputEvent::KeyUp { .. } | InputEvent::PointerUp { .. }) {
            let mut held = self.held_state.lock().await;
            held.forget_released(std::slice::from_ref(event));
            held.generation += 1;
        }
    }

    /// A cancelled handler fences admission synchronously, then reconciles its captured
    /// lease after the dispatch barrier becomes available.
    pub(crate) fn abandon_dispatch(
        self: &Arc<Self>,
        token: String,
        gate: Option<OwnedMutexGuard<()>>,
        mut pending: Option<super::cdp::PendingCommand>,
    ) {
        if let Some(command) = &pending {
            command.cancel_before_write();
        }
        if self.dispatch_abandoned.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1)).is_err() {
            // Saturation stays fenced rather than wrapping the admission counter to zero.
            return;
        }
        let manager = self.clone();
        tokio::spawn(async move {
            let gate = match gate {
                Some(gate) => gate,
                None => manager.native_gate.clone().lock_owned().await,
            };
            if let Some(command) = pending.take() {
                if command.wait().await.is_err_and(|error| error.outcome_is_ambiguous()) {
                    manager.mark_native_outcome_uncertain();
                }
            }
            if let Err(error) = manager.fail_native_dispatch_owned(gate, &token).await {
                tracing::warn!(error = %error, "abandoned native input cleanup failed");
            }
            manager.dispatch_abandoned.fetch_sub(1, Ordering::AcqRel);
            manager.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        });
    }

    pub(crate) fn mark_native_outcome_uncertain(&self) {
        self.native_outcome_uncertain.store(true, Ordering::Release);
    }

    /// End exactly the failed lease while still holding the native dispatch barrier.
    pub(crate) async fn fail_native_dispatch(
        self: &Arc<Self>,
        gate: OwnedMutexGuard<()>,
        token: &str,
    ) -> Result<(), InputError> {
        let manager = self.clone();
        let token = token.to_owned();
        tokio::spawn(async move { manager.fail_native_dispatch_owned(gate, &token).await })
            .await
            .unwrap_or_else(|_| Err(InputError::ReleaseFailed("native cleanup task failed".into())))
    }

    async fn fail_native_dispatch_owned(
        &self,
        gate: OwnedMutexGuard<()>,
        token: &str,
    ) -> Result<(), InputError> {
        let ended = {
            let mut lease = self.lease.lock().await;
            if lease.as_ref().is_some_and(|l| l.lease_token != token) {
                return Ok(());
            }
            lease.take()
        };
        let epoch = ended.as_ref().map(|l| l.lease_epoch);
        if let Some(ended) = ended {
            *self.last_ended_lease.lock().await = Some((ended.lease_token, ended.lease_epoch));
        }
        self.expiry.send_replace(None);
        self.queue.lock().await.clear();
        self.queue_changed.send_modify(|revision| *revision = revision.wrapping_add(1));
        *self.total_queued_bytes.lock().await = 0;
        let result = self.dispatch_held_release(&gate, false).await;
        drop(gate);
        if let Some(epoch) = epoch {
            let hook = self.lease_end_hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                hook(epoch).await;
            }
        }
        result
    }

    /// Sets cached selected text (bounded to 64 KiB on a UTF-8 char boundary).
    pub async fn set_selected_text(&self, text: &str) -> String {
        let truncated = truncate_utf8_bytes(text, MAX_SELECTED_TEXT_BYTES);
        *self.selected_text.lock().await = truncated.clone();
        truncated
    }

    /// Reads selected text if caller presents valid lease token.
    pub async fn get_selected_text(&self, lease_token: &str) -> Result<String, InputError> {
        let now = Instant::now();
        let lease_guard = self.lease.lock().await;
        let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        if lease.ending {
            return Err(InputError::LeaseNotFound);
        }
        if lease.expires_at <= now {
            return Err(InputError::LeaseExpired);
        }
        Ok(self.selected_text.lock().await.clone())
    }

    /// Computes CDP mouse button/buttons/clickCount state at native dispatch time.
    pub async fn prepare_mouse_dispatch(
        &self,
        event: &InputEvent,
        geom: &TargetGeometry,
    ) -> MouseDispatchContext {
        let mut dm = self.dispatch_mouse.lock().await;
        match event {
            InputEvent::PointerDown { button, u, v, .. } => {
                if *button != MouseButton::None {
                    dm.held_buttons.insert(*button);
                }
                let x = (u * geom.css_width).clamp(0.0, geom.css_width);
                let y = (v * geom.css_height + geom.offset_top)
                    .clamp(0.0, geom.css_height + geom.offset_top);
                let now = Instant::now();
                let click_count = match dm.last_click {
                    Some((prev_btn, px, py, prev_at, prev_count))
                        if prev_btn == *button
                            && *button != MouseButton::None
                            && now.saturating_duration_since(prev_at)
                                <= Duration::from_millis(500)
                            && (x - px).hypot(y - py) <= 5.0 =>
                    {
                        (prev_count % 3) + 1
                    }
                    _ => 1,
                };
                dm.last_click = (*button != MouseButton::None)
                    .then_some((*button, x, y, now, click_count));
                MouseDispatchContext {
                    buttons: dm.buttons_mask(),
                    move_button: None,
                    click_count,
                }
            }
            InputEvent::PointerMove { .. } => MouseDispatchContext {
                buttons: dm.buttons_mask(),
                move_button: dm.primary_held_button(),
                click_count: 1,
            },
            InputEvent::PointerUp { button, .. } => {
                dm.held_buttons.remove(button);
                let click_count = dm
                    .last_click
                    .filter(|(prev_btn, ..)| prev_btn == button)
                    .map_or(1, |(_, _, _, _, count)| count);
                MouseDispatchContext {
                    buttons: dm.buttons_mask(),
                    move_button: None,
                    click_count,
                }
            }
            InputEvent::Wheel { .. } => MouseDispatchContext {
                buttons: dm.buttons_mask(),
                move_button: None,
                click_count: 1,
            },
            _ => MouseDispatchContext::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn socket_queue_preserves_origin_and_wakes_next_owner() {
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let message = |seq, event| InputMessage {
            browser_session_id: "s".into(),
            browser_incarnation: "i".into(),
            profile_epoch: 1,
            subscription_epoch: "sub".into(),
            lease_token: token.clone(),
            input_seq: seq,
            viewport_epoch: 1,
            event,
        };
        let movement = || InputEvent::PointerMove { u: 0.5, v: 0.5, modifiers: 0 };
        manager.enqueue_socket_input("viewer", first, message(1, movement())).await.unwrap();
        manager.enqueue_socket_input("viewer", second, message(2, movement())).await.unwrap();
        let mut changed = manager.subscribe_input_queue();
        changed.borrow_and_update();
        assert!(manager.claim_queued_from(Some(second)).await.is_none());
        let (one, claim) = manager.claim_queued_from(Some(first)).await.unwrap();
        assert_eq!(one.input_seq, 1);
        assert!(manager.claim_queued_from(Some(second)).await.is_none());
        drop(claim);
        tokio::time::timeout(Duration::from_secs(2), changed.changed()).await.unwrap().unwrap();
        let (two, claim) = manager.claim_queued_from(Some(second)).await.unwrap();
        assert_eq!(two.input_seq, 2);
        drop(claim);
        let wheel = || InputEvent::Wheel { u: 0.5, v: 0.5, delta_x: 1.0, delta_y: 2.0, modifiers: 0 };
        manager.enqueue_socket_input("viewer", first, message(3, wheel())).await.unwrap();
        manager.enqueue_socket_input("viewer", second, message(4, wheel())).await.unwrap();
        manager.discard_queued_from(first).await;
        let (remaining, _) = manager.claim_queued_from(Some(second)).await.unwrap();
        assert_eq!(remaining.input_seq, 4);
    }

    #[tokio::test]
    async fn stale_abandonment_delays_but_does_not_drop_successor_input() {
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("successor", "human").await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.abandon_dispatch("obsolete-token".into(), None, None);
        let origin = Uuid::new_v4();
        let message = InputMessage {
            browser_session_id: "s".into(), browser_incarnation: "i".into(),
            profile_epoch: 1, subscription_epoch: "sub".into(), lease_token: token.clone(),
            input_seq: 1, viewport_epoch: 1, event: InputEvent::InsertText { text: "a".into() },
        };
        manager.enqueue_socket_input("successor", origin, message).await.unwrap();
        let (message, claim) = manager.claim_queued_from(Some(origin)).await.unwrap();
        let mut waiting = Box::pin(manager.begin_dispatch(&token));
        assert!(futures_util::poll!(waiting.as_mut()).is_pending());
        drop(gate);
        let dispatch = tokio::time::timeout(Duration::from_secs(2), waiting).await.unwrap();
        assert!(dispatch.is_some());
        assert_eq!(message.input_seq, 1);
        drop(dispatch);
        drop(claim);
        let next = InputMessage { input_seq: 2, ..message };
        assert!(manager.enqueue_socket_input("successor", origin, next).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn successor_text_reaches_native_after_stale_abandonment() {
        use futures_util::{SinkExt, StreamExt};
        use super::super::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use super::super::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use super::super::screencast::ScreencastProducer;
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut peer = tokio_tungstenite::accept_async(socket).await.unwrap();
            while let Some(Ok(Message::Text(text))) = peer.next().await {
                let command: serde_json::Value = serde_json::from_str(&text).unwrap();
                let result = if command["method"] == "Target.attachToTarget" {
                    serde_json::json!({"sessionId": "page"})
                } else {
                    if command["method"] == "Input.insertText" {
                        sent.send(command["params"]["text"].as_str().unwrap().to_owned()).unwrap();
                    }
                    serde_json::json!({})
                };
                if peer.send(Message::Text(serde_json::json!({"id": command["id"], "result": result}).to_string().into())).await.is_err() {
                    break;
                }
            }
        });
        let client = super::super::cdp::CdpClient::connect(&format!("ws://{address}")).await.unwrap();
        let session = Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session.clone(), "inc".into(), 1, 1, client, "target".into(),
            TargetGeometry { css_width: 800.0, css_height: 600.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0 },
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("successor", "human").await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.abandon_dispatch("old-token".into(), None, None);
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session, viewer_id: "successor",
            subscription_epoch: "sub", paired: true,
        };
        let message = |seq, text: &str| serde_json::to_string(&InputMessage {
            browser_session_id: session.clone(), browser_incarnation: "inc".into(),
            profile_epoch: 1, subscription_epoch: "sub".into(), lease_token: token.clone(),
            input_seq: seq, viewport_epoch: 1, event: InputEvent::InsertText { text: text.into() },
        }).unwrap();
        let first = message(1, "a");
        let mut dispatch = Box::pin(handle_control_text(&context, &first));
        assert!(futures_util::poll!(dispatch.as_mut()).is_pending());
        drop(gate);
        assert!(matches!(tokio::time::timeout(Duration::from_secs(2), dispatch).await.unwrap(), ControlInputOutcome::Continue));
        assert!(matches!(handle_control_text(&context, &message(2, "b")).await, ControlInputOutcome::Continue));
        assert_eq!(received.recv().await.as_deref(), Some("a"));
        assert_eq!(received.recv().await.as_deref(), Some("b"));
        GLOBAL_PRODUCERS.write().await.remove(&session);
    }

    #[tokio::test]
    async fn two_competing_control_drains_preserve_order_and_progress_after_foreign_exit() {
        use futures_util::{SinkExt, StreamExt};
        use super::super::control_input::{drain_control_input, ControlInputContext, ControlInputOutcome};
        use super::super::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use super::super::screencast::ScreencastProducer;
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let block_first = Arc::new(AtomicBool::new(false));
        let entered = Arc::new(tokio::sync::Notify::new());
        let proceed = Arc::new(tokio::sync::Notify::new());
        let (sent_tx, mut sent_rx) = tokio::sync::mpsc::unbounded_channel();
        let (bf, ent, proc_n) = (block_first.clone(), entered.clone(), proceed.clone());
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut peer = tokio_tungstenite::accept_async(socket).await.unwrap();
            while let Some(Ok(Message::Text(text))) = peer.next().await {
                let command: serde_json::Value = serde_json::from_str(&text).unwrap();
                let result = if command["method"] == "Target.attachToTarget" {
                    serde_json::json!({"sessionId": "page"})
                } else {
                    if command["method"] == "Input.insertText" {
                        let text_val = command["params"]["text"].as_str().unwrap().to_owned();
                        sent_tx.send(text_val).unwrap();
                        if bf.swap(false, Ordering::SeqCst) {
                            ent.notify_one();
                            proc_n.notified().await;
                        }
                    }
                    serde_json::json!({})
                };
                if peer.send(Message::Text(serde_json::json!({"id": command["id"], "result": result}).to_string().into())).await.is_err() {
                    break;
                }
            }
        });
        let client = super::super::cdp::CdpClient::connect(&format!("ws://{address}")).await.unwrap();
        let session = Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session.clone(), "inc".into(), 1, 1, client, "target".into(),
            TargetGeometry { css_width: 800.0, css_height: 600.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0 },
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let origin_a = Uuid::new_v4();
        let origin_b = Uuid::new_v4();
        let msg = |seq, text: &str| InputMessage {
            browser_session_id: session.clone(), browser_incarnation: "inc".into(),
            profile_epoch: 1, subscription_epoch: "sub".into(), lease_token: token.clone(),
            input_seq: seq, viewport_epoch: 1, event: InputEvent::InsertText { text: text.into() },
        };
        block_first.store(true, Ordering::SeqCst);
        manager.enqueue_socket_input("viewer", origin_a, msg(1, "1")).await.unwrap();
        let drain_a = {
            let manager = manager.clone();
            let session = session.clone();
            tokio::spawn(async move {
                let ctx = ControlInputContext {
                    input_manager: &manager, session_id: &session, viewer_id: "viewer",
                    subscription_epoch: "sub", paired: true,
                };
                drain_control_input(&ctx, Some(origin_a)).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), entered.notified()).await.unwrap();
        manager.enqueue_socket_input("viewer", origin_b, msg(2, "2")).await.unwrap();
        manager.enqueue_socket_input("viewer", origin_a, msg(3, "3")).await.unwrap();
        let drain_b = {
            let manager = manager.clone();
            let session = session.clone();
            tokio::spawn(async move {
                let ctx = ControlInputContext {
                    input_manager: &manager, session_id: &session, viewer_id: "viewer",
                    subscription_epoch: "sub", paired: true,
                };
                drain_control_input(&ctx, Some(origin_b)).await
            })
        };
        proceed.notify_one();
        assert!(matches!(tokio::time::timeout(Duration::from_secs(2), drain_a).await.unwrap().unwrap(), ControlInputOutcome::Continue));
        assert!(matches!(tokio::time::timeout(Duration::from_secs(2), drain_b).await.unwrap().unwrap(), ControlInputOutcome::Continue));
        assert_eq!(sent_rx.recv().await.as_deref(), Some("1"));
        assert_eq!(sent_rx.recv().await.as_deref(), Some("2"));
        assert_eq!(sent_rx.recv().await.as_deref(), Some("3"));

        // Now foreign head exits (origin_a disconnects without draining seq 4), freeing origin_b's seq 5.
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.enqueue_socket_input("viewer", origin_a, msg(4, "4")).await.unwrap();
        manager.enqueue_socket_input("viewer", origin_b, msg(5, "5")).await.unwrap();
        let drain_b2 = {
            let manager = manager.clone();
            let session = session.clone();
            tokio::spawn(async move {
                let ctx = ControlInputContext {
                    input_manager: &manager, session_id: &session, viewer_id: "viewer",
                    subscription_epoch: "sub", paired: true,
                };
                drain_control_input(&ctx, Some(origin_b)).await
            })
        };
        drop(gate);
        tokio::task::yield_now().await;
        manager.discard_queued_from(origin_a).await;
        assert!(matches!(tokio::time::timeout(Duration::from_secs(2), drain_b2).await.unwrap().unwrap(), ControlInputOutcome::Continue));
        assert_eq!(sent_rx.recv().await.as_deref(), Some("5"));
        GLOBAL_PRODUCERS.write().await.remove(&session);
    }

    #[tokio::test]
    async fn unrelated_viewer_disconnect_does_not_cancel_pending_acquire() {
        let manager = SessionInputManager::new();
        let gate = manager.native_gate.clone().lock_owned().await;
        let mut acquiring = Box::pin(manager.acquire_lease("owner", "human"));
        assert!(futures_util::poll!(acquiring.as_mut()).is_pending());
        assert!(manager.fence_control_holder("viewer-only").await.is_none());
        drop(gate);
        assert!(acquiring.await.is_ok());
    }

    #[tokio::test]
    async fn socket_sequence_violation_fences_without_waiting_for_native_gate() {
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let message = InputMessage {
            browser_session_id: "s".into(), browser_incarnation: "i".into(),
            profile_epoch: 1, subscription_epoch: "sub".into(),
            lease_token: token.clone(), input_seq: 2, viewport_epoch: 1,
            event: InputEvent::PointerCancel,
        };
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(2), manager.enqueue_socket_input("viewer", Uuid::new_v4(), message)).await.unwrap(),
            Err(InputError::SequenceGap { .. })
        ));
        assert!(manager.validate_lease(&token).await.is_err());
        drop(gate);
    }

    #[tokio::test]
    async fn cancelled_lease_end_still_finishes_after_dispatch_gate() {
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let finished = Arc::new(tokio::sync::Notify::new());
        let hook = finished.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        let task = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.revoke_lease().await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        task.abort();
        drop(gate);
        tokio::time::timeout(Duration::from_secs(2), finished.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(manager.acquire_lease("successor", "human").await.is_ok());
    }

    #[tokio::test]
    async fn cancelled_recovery_still_fences_and_finishes_after_dispatch_gate() {
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let finished = Arc::new(tokio::sync::Notify::new());
        let hook = finished.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        let task = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.suspend_for_recovery().await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        task.abort();
        drop(gate);
        tokio::time::timeout(Duration::from_secs(2), finished.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(matches!(manager.acquire_lease("successor", "human").await, Err(InputError::GeometryUnavailable)));
        manager.resume_after_recovery().await;
        assert!(manager.acquire_lease("successor", "human").await.is_ok());
    }

    #[tokio::test]
    async fn overlapping_abandonments_keep_admission_fenced_until_last_cleanup() {
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        let (hook_entered, hook_resume) = (entered.clone(), resume.clone());
        manager.set_lease_end_hook(Arc::new(move |_| {
            let (entered, resume) = (hook_entered.clone(), hook_resume.clone());
            Box::pin(async move {
                entered.notify_one();
                resume.notified().await;
            })
        }));
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.abandon_dispatch("stale-token".into(), None, None);
        tokio::task::yield_now().await;
        manager.abandon_dispatch(token.clone(), None, None);
        tokio::task::yield_now().await;
        drop(gate);
        tokio::time::timeout(Duration::from_secs(2), entered.notified()).await.unwrap();
        assert_eq!(manager.dispatch_abandoned.load(Ordering::Acquire), 1);
        assert!(matches!(manager.acquire_lease("successor", "human").await, Err(InputError::GeometryUnavailable)));
        resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.dispatch_abandoned.load(Ordering::Acquire) != 0 {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        assert!(manager.acquire_lease("successor", "human").await.is_ok());
    }

    #[tokio::test]
    async fn cancelled_recovery_still_releases_original_input_and_stays_suspended() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let blocked = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        let should_block = Arc::new(AtomicBool::new(false));
        let commands = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
        let (entered, proceed, block, log) =
            (blocked.clone(), resume.clone(), should_block.clone(), commands.clone());
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let command: serde_json::Value = serde_json::from_str(&text).unwrap();
                log.lock().unwrap().push(command.clone());
                if block.load(Ordering::SeqCst) {
                    entered.notify_one();
                    proceed.notified().await;
                }
                if ws.send(Message::Text(serde_json::json!({"id": command["id"], "result": {}}).to_string().into())).await.is_err() {
                    break;
                }
            }
        });
        let client = super::super::cdp::CdpClient::connect(&format!("ws://{address}")).await.unwrap();
        let target = NativeInputTarget {
            client,
            page_session_id: "original-page".into(),
            geometry: TargetGeometry {
                css_width: 1000.0, css_height: 800.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        };
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        let event = InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 };
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.prepare_native_input(&gate, target.clone(), &event).await.unwrap();
        target.dispatch(&event).await.unwrap();
        manager.confirm_native_input(&gate, &event).await;
        drop(gate);
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        should_block.store(true, Ordering::SeqCst);
        let task = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.suspend_for_recovery().await })
        };
        tokio::time::timeout(Duration::from_secs(2), blocked.notified()).await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        should_block.store(false, Ordering::SeqCst);
        resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(matches!(manager.acquire_lease("viewer", "human").await, Err(InputError::GeometryUnavailable)));
        assert!(commands.lock().unwrap().iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "original-page"));
        manager.resume_after_recovery().await;
        assert!(manager.acquire_lease("viewer", "human").await.is_ok());
    }

    #[tokio::test]
    async fn revoke_fences_acquisition_waiting_before_any_lease_exists() {
        let manager = SessionInputManager::new();
        let gate = manager.native_gate.clone().lock_owned().await;
        let mut acquiring = Box::pin(manager.acquire_lease("viewer", "human"));
        assert!(futures_util::poll!(acquiring.as_mut()).is_pending());
        let generation = manager.authority_generation.load(Ordering::Acquire);
        let revoking = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.revoke_lease().await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.authority_generation.load(Ordering::Acquire) == generation {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        drop(gate);
        assert!(matches!(acquiring.await, Err(InputError::GeometryUnavailable)));
        revoking.await.unwrap().unwrap();
        assert!(manager.acquire_lease("viewer", "human").await.is_ok());
    }

    #[tokio::test]
    async fn test_lease_acquire_renew_release() {
        let mgr = SessionInputManager::new();

        // 1. Acquire lease
        let (token, _exp) = mgr
            .acquire_lease("viewer1", "human")
            .await
            .expect("should acquire lease");

        // 2. Second viewer cannot steal lease
        let conflict = mgr.acquire_lease("viewer2", "human").await.unwrap_err();
        assert!(matches!(conflict, InputError::LeaseConflict(_)));

        // 3. Renew lease succeeds
        assert!(mgr.renew_lease(&token, None).await.is_ok());

        // 4. Non-holder cannot renew
        assert_eq!(
            mgr.renew_lease("wrong-token", None).await.unwrap_err(),
            InputError::NotLeaseHolder
        );

        mgr.release_lease(&token).await.expect("release succeeds");

        // 6. Viewer2 can now acquire
        assert!(mgr.acquire_lease("viewer2", "human").await.is_ok());
    }

    #[tokio::test]
    async fn revoke_waits_for_inflight_acquisition_and_invalidates_its_lease() {
        let manager = Arc::new(SessionInputManager::new());
        let lease_lock = manager.lease.lock().await;
        let acquiring = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.acquire_lease("viewer", "human").await })
        };

        // Park acquisition before it can publish the lease, then race revocation.
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if manager.native_gate.try_lock().is_err() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("acquisition must retain its barrier until publication");
        let revoking = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.revoke_lease().await })
        };
        drop(lease_lock);
        let result = acquiring.await.unwrap();
        revoking.await.unwrap().unwrap();
        match result {
            Ok((token, _)) => assert!(matches!(manager.validate_lease(&token).await, Err(InputError::LeaseNotFound))),
            Err(error) => assert_eq!(error, InputError::GeometryUnavailable),
        }
    }

    #[tokio::test]
    async fn recovery_fence_revokes_old_lease_and_blocks_new_control_until_resume() {
        let manager = SessionInputManager::new();
        let (old_token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        manager.suspend_for_recovery().await.unwrap();
        assert!(matches!(
            manager.validate_lease(&old_token).await,
            Err(InputError::LeaseNotFound)
        ));
        assert!(matches!(
            manager.acquire_lease("viewer", "human").await,
            Err(InputError::GeometryUnavailable)
        ));
        manager.resume_after_recovery().await;
        let (new_token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
        assert_ne!(new_token, old_token);
    }

    #[tokio::test]
    async fn test_input_sequence_gap_revokes_lease_and_releases_keys() {
        let mgr = SessionInputManager::new();
        let (token, _) = mgr.acquire_lease("viewer1", "human").await.unwrap();

        let base_msg = InputMessage {
            browser_session_id: "s1".to_string(),
            browser_incarnation: "i1".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub1".to_string(),
            lease_token: token.clone(),
            input_seq: 1,
            viewport_epoch: 1,
            event: InputEvent::KeyDown {
                key: "Shift".to_string(),
                code: "ShiftLeft".to_string(),
                modifiers: 8,
            },
        };

        // Enqueue seq 1
        assert!(mgr.enqueue_input(base_msg).await.is_ok());

        // Duplicate seq 1 dropped safely
        let dup_msg = InputMessage {
            browser_session_id: "s1".to_string(),
            browser_incarnation: "i1".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub1".to_string(),
            lease_token: token.clone(),
            input_seq: 1,
            viewport_epoch: 1,
            event: InputEvent::KeyDown {
                key: "Shift".to_string(),
                code: "ShiftLeft".to_string(),
                modifiers: 8,
            },
        };
        assert_eq!(mgr.enqueue_input(dup_msg).await.unwrap(), None);

        // Gap: send seq 3 instead of 2 -> revokes lease!
        let gap_msg = InputMessage {
            browser_session_id: "s1".to_string(),
            browser_incarnation: "i1".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub1".to_string(),
            lease_token: token.clone(),
            input_seq: 3,
            viewport_epoch: 1,
            event: InputEvent::PointerMove {
                u: 0.5,
                v: 0.5,
                modifiers: 8,
            },
        };

        let err = mgr.enqueue_input(gap_msg).await.unwrap_err();
        assert!(matches!(err, InputError::SequenceGap { expected: 2, actual: 3 }));

        // Lease is revoked
        assert_eq!(mgr.renew_lease(&token, None).await.unwrap_err(), InputError::LeaseNotFound);

        // Drain inputs verifies queue draining
        assert!(mgr.drain_inputs().await.is_empty());
    }

    #[test]
    fn test_map_fraction_to_css_coords() {
        let geo = TargetGeometry {
            css_width: 1280.0,
            css_height: 900.0,
            offset_top: 50.0,
            scroll_x: 100.0,
            scroll_y: 200.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 2.0,
        };

        // Normal centroid
        let (x, y) = map_fraction_to_css_coords(0.5, 0.5, &geo).unwrap();
        assert_eq!(x, 640.0);
        assert_eq!(y, 500.0); // 450 + 50 offset_top

        // Out-of-bounds rejected
        assert!(map_fraction_to_css_coords(-0.1, 0.5, &geo).is_err());
        assert!(map_fraction_to_css_coords(0.5, 1.1, &geo).is_err());
    }

    #[tokio::test]
    async fn test_set_selected_text_truncates_multibyte_utf8_without_panic() {
        let mgr = SessionInputManager::new();
        let (token, _) = mgr.acquire_lease("viewer1", "human").await.unwrap();

        // 1-byte prefix + 4-byte emojis straddling MAX_SELECTED_TEXT_BYTES (65536):
        // byte 65536 lands inside an emoji (1 + 16384*4 = 65537 > 65536).
        let mut s = String::from("a");
        for _ in 0..16_384 {
            s.push('🦀');
        }
        assert!(s.len() > MAX_SELECTED_TEXT_BYTES);
        assert!(!s.is_char_boundary(MAX_SELECTED_TEXT_BYTES));

        let clamped = mgr.set_selected_text(&s).await;
        assert!(clamped.len() <= MAX_SELECTED_TEXT_BYTES);
        assert_eq!(clamped.len(), 1 + 16_383 * 4);
        assert!(std::str::from_utf8(clamped.as_bytes()).is_ok());
        assert_eq!(mgr.get_selected_text(&token).await.unwrap(), clamped);

        // Also test 3-byte UTF-8 characters straddling boundary.
        let s3 = "€".repeat(25_000);
        let clamped3 = mgr.set_selected_text(&s3).await;
        assert!(clamped3.len() <= MAX_SELECTED_TEXT_BYTES);
        assert_eq!(clamped3.len() % 3, 0);
        assert_eq!(mgr.get_selected_text(&token).await.unwrap(), clamped3);
    }

    #[tokio::test]
    async fn test_prepare_mouse_dispatch_tracks_drag_buttons_and_click_count() {
        let mgr = SessionInputManager::new();
        let _ = mgr.acquire_lease("viewer1", "human").await.unwrap();
        let geo = TargetGeometry {
            css_width: 1000.0,
            css_height: 800.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        };

        let move_idle = mgr
            .prepare_mouse_dispatch(&InputEvent::PointerMove { u: 0.1, v: 0.1, modifiers: 0 }, &geo)
            .await;
        assert_eq!(move_idle, MouseDispatchContext { buttons: 0, move_button: None, click_count: 1 });

        let down1 = mgr
            .prepare_mouse_dispatch(
                &InputEvent::PointerDown { button: MouseButton::Left, u: 0.2, v: 0.2, modifiers: 0 },
                &geo,
            )
            .await;
        assert_eq!(down1, MouseDispatchContext { buttons: 1, move_button: None, click_count: 1 });

        let drag_move = mgr
            .prepare_mouse_dispatch(&InputEvent::PointerMove { u: 0.4, v: 0.2, modifiers: 0 }, &geo)
            .await;
        assert_eq!(
            drag_move,
            MouseDispatchContext { buttons: 1, move_button: Some(MouseButton::Left), click_count: 1 }
        );

        let up1 = mgr
            .prepare_mouse_dispatch(
                &InputEvent::PointerUp { button: MouseButton::Left, u: 0.4, v: 0.2, modifiers: 0 },
                &geo,
            )
            .await;
        assert_eq!(up1, MouseDispatchContext { buttons: 0, move_button: None, click_count: 1 });

        let move_after = mgr
            .prepare_mouse_dispatch(&InputEvent::PointerMove { u: 0.5, v: 0.2, modifiers: 0 }, &geo)
            .await;
        assert_eq!(move_after, MouseDispatchContext { buttons: 0, move_button: None, click_count: 1 });

        // Rapid second click at a new position starts at 1, immediate next click at same position advances to 2
        let down2 = mgr
            .prepare_mouse_dispatch(
                &InputEvent::PointerDown { button: MouseButton::Left, u: 0.4, v: 0.2, modifiers: 0 },
                &geo,
            )
            .await;
        assert_eq!(down2.click_count, 1);
        let _ = mgr
            .prepare_mouse_dispatch(
                &InputEvent::PointerUp { button: MouseButton::Left, u: 0.4, v: 0.2, modifiers: 0 },
                &geo,
            )
            .await;
        let down3 = mgr
            .prepare_mouse_dispatch(
                &InputEvent::PointerDown { button: MouseButton::Left, u: 0.4, v: 0.2, modifiers: 0 },
                &geo,
            )
            .await;
        assert_eq!(down3.click_count, 2);
    }
}
