use std::collections::{HashSet, VecDeque};
use std::fmt;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

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
    pub profile_epoch: u64,
    pub subscription_epoch: String,
    pub lease_token: String,
    pub input_seq: u64,
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
    QueueOverflow,
    GeometryUnavailable,
    InvalidFraction { u: f64, v: f64 },
    TextTooLong { length: usize, max: usize },
    QueryTooLong { length: usize, max: usize },
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

#[derive(Debug, Clone, Default)]
pub struct HeldInputState {
    pub held_keys: HashSet<String>,
    pub held_buttons: HashSet<MouseButton>,
    pub modifiers: u32,
}

impl HeldInputState {
    /// Generates release events to clear all currently held keys and buttons.
    pub fn generate_release_events(&self) -> Vec<InputEvent> {
        let mut releases = Vec::new();
        for btn in &self.held_buttons {
            releases.push(InputEvent::PointerUp {
                button: *btn,
                u: 0.5,
                v: 0.5,
                modifiers: 0,
            });
        }
        for key in &self.held_keys {
            releases.push(InputEvent::KeyUp {
                key: key.clone(),
                code: key.clone(),
                modifiers: 0,
            });
        }
        releases
    }

    pub fn clear(&mut self) {
        self.held_keys.clear();
        self.held_buttons.clear();
        self.modifiers = 0;
    }
}

pub struct SessionInputManager {
    lease: Mutex<Option<LeaseState>>,
    last_processed_seq: Mutex<u64>,
    queue: Mutex<VecDeque<InputMessage>>,
    total_queued_bytes: Mutex<usize>,
    held_state: Mutex<HeldInputState>,
    selected_text: Mutex<String>,
}

impl Default for SessionInputManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionInputManager {
    pub fn new() -> Self {
        Self {
            lease: Mutex::new(None),
            last_processed_seq: Mutex::new(0),
            queue: Mutex::new(VecDeque::new()),
            total_queued_bytes: Mutex::new(0),
            held_state: Mutex::new(HeldInputState::default()),
            selected_text: Mutex::new(String::new()),
        }
    }

    /// Acquires cooperative control lease.
    ///
    /// Returns lease token and expires_at unix ms.
    pub async fn acquire_lease(
        &self,
        viewer_id: &str,
        holder_kind: &str,
    ) -> Result<(String, i64), InputError> {
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
        let expires_at = now + LEASE_TTL;
        let expires_at_unix_ms =
            chrono::Utc::now().timestamp_millis() + LEASE_TTL.as_millis() as i64;

        *lease_guard = Some(LeaseState {
            lease_token: lease_token.clone(),
            viewer_id: viewer_id.to_string(),
            holder_kind: holder_kind.to_string(),
            expires_at,
        });

        // Reset sequence pointer on new lease acquisition
        *self.last_processed_seq.lock().await = 0;

        Ok((lease_token, expires_at_unix_ms))
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

        let mut ttl = LEASE_TTL;
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

    /// Releases active lease and returns release events for any held keys/buttons.
    pub async fn release_lease(&self, lease_token: &str) -> Result<Vec<InputEvent>, InputError> {
        let mut lease_guard = self.lease.lock().await;
        if let Some(lease) = lease_guard.as_ref() {
            if lease.lease_token != lease_token {
                return Err(InputError::NotLeaseHolder);
            }
        } else {
            return Ok(Vec::new());
        }

        *lease_guard = None;

        // Drain queue
        self.queue.lock().await.clear();
        *self.total_queued_bytes.lock().await = 0;

        // Clear and return held state releases
        let mut held = self.held_state.lock().await;
        let releases = held.generate_release_events();
        held.clear();

        Ok(releases)
    }

    /// Forces revocation of active lease (e.g. on sequence gap, queue overflow, or auth cancel).
    pub async fn revoke_lease(&self) -> Vec<InputEvent> {
        *self.lease.lock().await = None;
        self.queue.lock().await.clear();
        *self.total_queued_bytes.lock().await = 0;

        let mut held = self.held_state.lock().await;
        let releases = held.generate_release_events();
        held.clear();
        releases
    }

    /// Enqueues and validates an incoming reliable input message.
    ///
    /// Checks lease validity, contiguous decimal sequence, and enforces bounded queue.
    /// Coalesces adjacent pointerMove and wheel events.
    pub async fn enqueue_input(&self, msg: InputMessage) -> Result<Option<InputMessage>, InputError> {
        let now = Instant::now();
        // Validate lease
        {
            let lease_guard = self.lease.lock().await;
            let lease = lease_guard.as_ref().ok_or(InputError::LeaseNotFound)?;
            if lease.lease_token != msg.lease_token {
                return Err(InputError::NotLeaseHolder);
            }
            if lease.expires_at <= now {
                return Err(InputError::LeaseExpired);
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

        // Validate sequence
        let mut seq_guard = self.last_processed_seq.lock().await;
        let expected = *seq_guard + 1;

        if msg.input_seq == *seq_guard {
            // Duplicate event, ignore safely
            return Ok(None);
        }

        if msg.input_seq != expected {
            // Sequence gap or out-of-order sequence: revoke lease immediately
            drop(seq_guard);
            self.revoke_lease().await;
            return Err(InputError::SequenceGap {
                expected,
                actual: msg.input_seq,
            });
        }

        *seq_guard = msg.input_seq;

        // Check queue bounds
        let msg_bytes = msg.event.estimated_bytes();
        let mut q_guard = self.queue.lock().await;
        let mut bytes_guard = self.total_queued_bytes.lock().await;

        if q_guard.len() >= MAX_RELIABLE_RECORDS || *bytes_guard + msg_bytes > MAX_RELIABLE_BYTES {
            drop(q_guard);
            drop(bytes_guard);
            self.revoke_lease().await;
            return Err(InputError::QueueOverflow);
        }

        // Update held keys/buttons state
        {
            let mut held = self.held_state.lock().await;
            match &msg.event {
                InputEvent::PointerDown { button, modifiers, .. } => {
                    held.held_buttons.insert(*button);
                    held.modifiers = *modifiers;
                }
                InputEvent::PointerUp { button, modifiers, .. } => {
                    held.held_buttons.remove(button);
                    held.modifiers = *modifiers;
                }
                InputEvent::PointerCancel => {
                    held.held_buttons.clear();
                }
                InputEvent::KeyDown { key, modifiers, .. } => {
                    held.held_keys.insert(key.clone());
                    held.modifiers = *modifiers;
                }
                InputEvent::KeyUp { key, modifiers, .. } => {
                    held.held_keys.remove(key);
                    held.modifiers = *modifiers;
                }
                InputEvent::PointerMove { modifiers, .. } | InputEvent::Wheel { modifiers, .. } => {
                    held.modifiers = *modifiers;
                }
                _ => {}
            }
        }

        // Coalescing: coalesce adjacent pointerMove or wheel
        if msg.event.is_coalescable() {
            if let Some(last) = q_guard.back_mut() {
                if std::mem::discriminant(&last.event) == std::mem::discriminant(&msg.event) {
                    *bytes_guard = bytes_guard.saturating_sub(last.event.estimated_bytes());
                    last.event = msg.event.clone();
                    last.input_seq = msg.input_seq;
                    *bytes_guard += msg_bytes;
                    return Ok(Some(msg));
                }
            }
        }

        *bytes_guard += msg_bytes;
        q_guard.push_back(msg.clone());

        Ok(Some(msg))
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

        // 5. Release lease
        let releases = mgr.release_lease(&token).await.expect("release succeeds");
        assert!(releases.is_empty());

        // 6. Viewer2 can now acquire
        assert!(mgr.acquire_lease("viewer2", "human").await.is_ok());
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
