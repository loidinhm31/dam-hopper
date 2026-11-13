use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex, MutexGuard};
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
    pub lease_token: String,
    pub viewer_id: String,
    pub holder_kind: String, // "human" | "agent"
    pub expires_at: Instant,
}

/// Everything natively held on behalf of the lease, captured at press time so a release can
/// replay exactly what is down (key + code, button + last pointer position) on the original
/// native identity.
#[derive(Debug, Clone, Default)]
pub struct HeldInputState {
    /// Pressed keys: `key` -> `code`.
    pub held_keys: HashMap<String, String>,
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
        releases.extend(self.held_keys.iter().map(|(key, code)| InputEvent::KeyUp {
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
                InputEvent::KeyUp { key, .. } => {
                    self.held_keys.remove(key);
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

pub struct SessionInputManager {
    lease: Mutex<Option<LeaseState>>,
    last_processed_seq: Mutex<u64>,
    expected_viewport_epoch: Mutex<Option<u64>>,
    queue: Mutex<VecDeque<InputMessage>>,
    total_queued_bytes: Mutex<usize>,
    held_state: Mutex<HeldInputState>,
    selected_text: Mutex<String>,
    lease_ttl: Duration,
    /// Orders native dispatch against native release. It guards no state: a dispatch holds it
    /// across its CDP call, a release holds it across its releases, while `lease`/`held_state`
    /// are only ever locked briefly (never across a CDP await).
    native_gate: Mutex<()>,
    /// Blocks new leases while a producer's native session is being replaced.
    recovery_suspended: AtomicBool,
    /// Publishes the live lease's expiry to the active expiry watcher.
    expiry: watch::Sender<Option<Instant>>,
    expiry_watcher_started: AtomicBool,
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
        Self {
            lease: Mutex::new(None),
            last_processed_seq: Mutex::new(0),
            expected_viewport_epoch: Mutex::new(None),
            queue: Mutex::new(VecDeque::new()),
            total_queued_bytes: Mutex::new(0),
            held_state: Mutex::new(HeldInputState::default()),
            selected_text: Mutex::new(String::new()),
            lease_ttl,
            native_gate: Mutex::new(()),
            recovery_suspended: AtomicBool::new(false),
            expiry: watch::channel(None).0,
            expiry_watcher_started: AtomicBool::new(false),
        }
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

    pub async fn is_lease_holder(&self, viewer_id: &str) -> bool {
        let guard = self.lease.lock().await;
        guard.as_ref().map(|l| l.viewer_id == viewer_id).unwrap_or(false)
    }

    pub async fn validate_lease(&self, lease_token: &str) -> Result<(), InputError> {
        let now = Instant::now();
        let lease_guard = self.lease.lock().await;
        let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        if lease.expires_at <= now {
            return Err(InputError::LeaseExpired);
        }
        Ok(())
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
        // Keep the dispatch/release barrier until the lease is published. Otherwise a
        // concurrent revoke can complete between this check and the lease assignment.
        let gate = self.native_gate.lock().await;
        if self.recovery_suspended.load(Ordering::Acquire) {
            return Err(InputError::GeometryUnavailable);
        }
        let pending = self.held_state.lock().await.release_failed.is_some();
        if pending {
            self.dispatch_held_release(&gate, false).await?;
        }
        let mut lease_guard = self.lease.lock().await;
        let now = Instant::now();

        if let Some(existing) = lease_guard.as_ref() {
            if existing.expires_at > now && existing.viewer_id != viewer_id {
                return Err(InputError::LeaseConflict(format!(
                    "control is already held by viewer {}",
                    existing.viewer_id
                )));
            }
        }

        let lease_token = Uuid::new_v4().to_string();
        let expires_at = now + self.lease_ttl;
        let expires_at_unix_ms =
            chrono::Utc::now().timestamp_millis() + self.lease_ttl.as_millis() as i64;

        *lease_guard = Some(LeaseState {
            lease_token: lease_token.clone(),
            viewer_id: viewer_id.to_string(),
            holder_kind: holder_kind.to_string(),
            expires_at,
        });
        self.expiry.send_replace(Some(expires_at));

        // Reset sequence pointer on new lease acquisition
        *self.last_processed_seq.lock().await = 0;

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
        let mut lease_guard = self.lease.lock().await;
        let now = Instant::now();
        let now_utc = chrono::Utc::now();

        let lease = lease_guard.as_mut().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
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

        Ok(expires_at_unix_ms)
    }

    /// Drains all currently queued input messages and resets queued bytes counter.
    pub async fn drain_inputs(&self) -> Vec<InputMessage> {
        let mut q_guard = self.queue.lock().await;
        *self.total_queued_bytes.lock().await = 0;
        q_guard.drain(..).collect()
    }

    /// Pops the next queued input message if any, updating queued bytes counter.
    pub async fn pop_next_input(&self) -> Option<InputMessage> {
        let mut q_guard = self.queue.lock().await;
        if let Some(msg) = q_guard.pop_front() {
            let mut bytes_guard = self.total_queued_bytes.lock().await;
            *bytes_guard = bytes_guard.saturating_sub(msg.event.estimated_bytes());
            Some(msg)
        } else {
            None
        }
    }

    /// Records the native identity input is dispatched on. Kept from the first hold until
    /// everything held is released, so a release always targets the ORIGINAL identity.
    pub async fn capture_native_target(&self, target: NativeInputTarget) {
        let mut held = self.held_state.lock().await;
        if held.is_empty() {
            held.target = Some(target);
        }
    }

    /// Why native input is unavailable, while a failed release left keys/buttons held.
    pub async fn release_failure(&self) -> Option<String> {
        self.held_state.lock().await.release_failed.clone()
    }

    /// Orders a geometry fence against input already in native dispatch.
    pub(crate) async fn begin_geometry_fence(&self) -> MutexGuard<'_, ()> {
        self.native_gate.lock().await
    }

    /// Serializes one native dispatch against releases. `None` when the lease was ended
    /// meanwhile (expiry, release, revoke): the queued event is then dropped, never dispatched
    /// after the release that would otherwise leave it stuck.
    pub async fn begin_dispatch(&self, lease_token: &str) -> Option<MutexGuard<'_, ()>> {
        let gate = self.native_gate.lock().await;
        self.validate_lease(lease_token).await.ok()?;
        Some(gate)
    }

    /// Fence lease acquisition and dispatch, then release held input on its original target.
    /// On failure the fence remains closed until the owning session is explicitly cleaned up.
    pub(crate) async fn suspend_for_recovery(&self) -> Result<(), InputError> {
        let gate = self.native_gate.lock().await;
        self.recovery_suspended.store(true, Ordering::Release);
        *self.lease.lock().await = None;
        self.expiry.send_replace(None);
        self.queue.lock().await.clear();
        *self.total_queued_bytes.lock().await = 0;
        self.dispatch_held_release(&gate, false).await
    }

    pub(crate) async fn resume_after_recovery(&self) {
        let _gate = self.native_gate.lock().await;
        if self.held_state.lock().await.release_failed.is_none() {
            self.recovery_suspended.store(false, Ordering::Release);
        }
    }

    /// Releases active lease: held keys/buttons are released on the original native identity
    /// BEFORE the held state is forgotten. A failed release is `ReleaseFailed`, never success.
    pub async fn release_lease(&self, lease_token: &str) -> Result<(), InputError> {
        self.end_lease(|lease| match lease {
            Some(lease) if lease.lease_token != lease_token => Err(InputError::NotLeaseHolder),
            _ => Ok(true),
        })
        .await
    }

    /// Forces revocation of the active lease (auth cancel, session end) with native release.
    pub async fn revoke_lease(&self) -> Result<(), InputError> {
        self.end_lease(|_| Ok(true)).await
    }

    /// Revokes the lease only while `viewer_id` still holds it (decided atomically).
    pub async fn revoke_lease_if_holder(&self, viewer_id: &str) -> Result<(), InputError> {
        self.end_lease(|lease| Ok(lease.is_some_and(|l| l.viewer_id == viewer_id)))
            .await
    }

    /// Ends the lease at its deadline (active expiry), releasing held native input.
    pub async fn expire_if_due(&self) -> Result<(), InputError> {
        let now = Instant::now();
        self.end_lease(|lease| Ok(lease.is_some_and(|l| l.expires_at <= now)))
            .await
    }

    /// In-memory half of a revoke: the lease and queued input end immediately (no further
    /// input is accepted) while the native release is left to [`Self::release_native`]. For
    /// fences that must not wait on the browser.
    pub async fn fence_lease(&self) {
        *self.lease.lock().await = None;
        self.expiry.send_replace(None);
        self.queue.lock().await.clear();
        *self.total_queued_bytes.lock().await = 0;
    }

    /// Releases every held key and button on the captured native identity.
    pub async fn release_native(&self) -> Result<(), InputError> {
        let gate = self.native_gate.lock().await;
        self.dispatch_held_release(&gate, false).await
    }

    /// PointerCancel: releases the held buttons natively (keys stay down).
    pub async fn release_pointer_buttons(&self) -> Result<(), InputError> {
        let gate = self.native_gate.lock().await;
        self.dispatch_held_release(&gate, true).await
    }

    /// Releasing{target = captured identity, held = snapshot}: lease cleared, then the
    /// snapshot is released natively with no state lock across the CDP awaits.
    async fn end_lease(
        &self,
        decide: impl FnOnce(Option<&LeaseState>) -> Result<bool, InputError>,
    ) -> Result<(), InputError> {
        let gate = self.native_gate.lock().await;
        {
            let mut lease = self.lease.lock().await;
            if !decide(lease.as_ref())? {
                return Ok(());
            }
            *lease = None;
        }
        self.expiry.send_replace(None);
        self.queue.lock().await.clear();
        *self.total_queued_bytes.lock().await = 0;
        self.dispatch_held_release(&gate, false).await
    }

    /// Snapshot under the lock, dispatch with it dropped, re-lock and forget exactly what was
    /// released. A failure keeps the held state, remembers the failure (input unavailable) and
    /// is returned.
    async fn dispatch_held_release(
        &self,
        _gate: &MutexGuard<'_, ()>,
        buttons_only: bool,
    ) -> Result<(), InputError> {
        let (target, events, generation) = {
            let held = self.held_state.lock().await;
            let events = if buttons_only {
                held.button_release_events()
            } else {
                held.generate_release_events()
            };
            (held.target.clone(), events, held.generation)
        };
        let mut failure = None;
        // Without a captured identity nothing was ever dispatched, so there is nothing to undo.
        if let Some(target) = &target {
            for event in &events {
                if let Err(err) = target.dispatch(event).await {
                    failure.get_or_insert(err);
                }
            }
        }
        let mut held = self.held_state.lock().await;
        match failure {
            None => {
                // A hold recorded while the release was in flight stays tracked (a later
                // release replays it); releasing an extra time is harmless, forgetting a
                // fresh press is not.
                if held.generation == generation {
                    held.forget_released(&events);
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
        self.enqueue_validated(None, msg).await
    }

    /// As [`Self::enqueue_input`], but the lease must be held by `viewer_id`, the viewer
    /// authenticated on the control socket: a foreign viewer never uses another's lease.
    pub async fn enqueue_input_for_viewer(
        &self,
        viewer_id: &str,
        msg: InputMessage,
    ) -> Result<Option<InputMessage>, InputError> {
        self.enqueue_validated(Some(viewer_id), msg).await
    }

    /// Checks lease validity, contiguous decimal sequence, and enforces the bounded queue.
    /// Coalesces adjacent pointerMove and wheel events. A sequence gap or queue overflow ends
    /// the lease with a native release (after every state lock is dropped).
    async fn enqueue_validated(
        &self,
        viewer: Option<&str>,
        msg: InputMessage,
    ) -> Result<Option<InputMessage>, InputError> {
        let now = Instant::now();
        // Validate lease
        {
            let lease_guard = self.lease.lock().await;
            let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
            if lease.lease_token != msg.lease_token {
                return Err(InputError::NotLeaseHolder);
            }
            if viewer.is_some_and(|viewer| lease.viewer_id != viewer) {
                return Err(InputError::NotLeaseHolder);
            }
            if lease.expires_at <= now {
                return Err(InputError::LeaseExpired);
            }
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
                    self.record_held(&msg.event).await;
                    let coalesced = msg.event.is_coalescable()
                        && q_guard.back_mut().is_some_and(|last| {
                            if std::mem::discriminant(&last.event)
                                == std::mem::discriminant(&msg.event)
                            {
                                *bytes_guard =
                                    bytes_guard.saturating_sub(last.event.estimated_bytes());
                                last.event = msg.event.clone();
                                last.input_seq = msg.input_seq;
                                *bytes_guard += msg_bytes;
                                true
                            } else {
                                false
                            }
                        });
                    if !coalesced {
                        *bytes_guard += msg_bytes;
                        q_guard.push_back(msg.clone());
                    }
                    None
                }
            }
        };
        if let Some(violation) = violation {
            let token = msg.lease_token;
            // Only the lease that violated the contract ends; a newer holder is untouched.
            let _ = self
                .end_lease(|lease| Ok(lease.is_some_and(|l| l.lease_token == token)))
                .await;
            return Err(violation);
        }
        Ok(Some(msg))
    }

    /// Tracks what this event leaves natively held. PointerCancel keeps its buttons tracked:
    /// they are cleared only once the native release succeeds.
    async fn record_held(&self, event: &InputEvent) {
        let mut held = self.held_state.lock().await;
        match event {
            InputEvent::PointerDown { button, u, v, modifiers } => {
                held.held_buttons.insert(*button);
                held.generation += 1;
                held.pointer = (*u, *v);
                held.modifiers = *modifiers;
            }
            InputEvent::PointerUp { button, u, v, modifiers } => {
                held.held_buttons.remove(button);
                held.generation += 1;
                held.pointer = (*u, *v);
                held.modifiers = *modifiers;
            }
            InputEvent::KeyDown { key, code, modifiers } => {
                held.held_keys.insert(key.clone(), code.clone());
                held.generation += 1;
                held.modifiers = *modifiers;
            }
            InputEvent::KeyUp { key, modifiers, .. } => {
                held.held_keys.remove(key);
                held.generation += 1;
                held.modifiers = *modifiers;
            }
            InputEvent::PointerMove { u, v, modifiers }
            | InputEvent::Wheel { u, v, modifiers, .. } => {
                held.pointer = (*u, *v);
                held.modifiers = *modifiers;
            }
            InputEvent::PointerCancel | InputEvent::InsertText { .. } => {}
        }
    }

    /// Sets cached selected text (bounded to 64 KiB).
    pub async fn set_selected_text(&self, text: &str) {
        let mut truncated = text.to_string();
        if truncated.len() > MAX_SELECTED_TEXT_BYTES {
            truncated.truncate(MAX_SELECTED_TEXT_BYTES);
        }
        *self.selected_text.lock().await = truncated;
    }

    /// Reads selected text if caller presents valid lease token.
    pub async fn get_selected_text(&self, lease_token: &str) -> Result<String, InputError> {
        let lease_guard = self.lease.lock().await;
        let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
        if lease.lease_token != lease_token {
            return Err(InputError::NotLeaseHolder);
        }
        Ok(self.selected_text.lock().await.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let (token, _) = acquiring.await.unwrap().unwrap();
        revoking.await.unwrap().unwrap();
        assert!(matches!(
            manager.validate_lease(&token).await,
            Err(InputError::LeaseNotFound)
        ));
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
}
