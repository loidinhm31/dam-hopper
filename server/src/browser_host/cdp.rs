use std::collections::HashMap;
use std::fmt;
use std::io;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chromiumoxide_types::Command;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Notify};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, warn};

use super::command_budget::{CommandBudget, CommandReservation};
use super::diagnostics::{global_memory_controller, MemoryAdmissionController, MemoryReservation};
use super::network_policy::{NetworkPolicy, RequestKind, MAX_URL_BYTES};
use super::protocol::{
    COMMAND_TIMEOUT_SECS, MAX_COMMAND_BYTES, MAX_PENDING_COMMANDS, MAX_WRITER_QUEUE_BYTES,
    MAX_WRITER_QUEUE_MESSAGES, MAX_WS_MESSAGE_BYTES,
};

/// Per-frame bookkeeping (metadata object, ids) charged on top of the base64 payload.
const SCREENCAST_FRAME_OVERHEAD_BYTES: usize = 1024;

/// Metadata members Chromium always sends with `Page.screencastFrame`; geometry consumers rely
/// on them being finite numbers.
const SCREENCAST_METADATA_NUMBERS: [&str; 6] = [
    "offsetTop",
    "pageScaleFactor",
    "deviceWidth",
    "deviceHeight",
    "scrollOffsetX",
    "scrollOffsetY",
];

/// Per-write deadline for the actor's single writer.
const WRITE_DEADLINE: Duration = Duration::from_secs(5);
const MAX_EVENT_SESSION_ID_BYTES: usize = 256;
const MAX_LIFECYCLE_EVENT_SLOTS: usize = 8;
/// Browser Fetch decisions are one-way release messages, not caller RPC commands. Their
/// unique negative i32 ids cannot collide with positive RPC ids and retain no response owner.
const FIRST_POLICY_COMMAND_ID: i32 = -1;
/// Slots of the browser-level target lifecycle channel (created/attached/destroyed/crashed).
/// An overflow forces the consumer to re-inventory the native targets.
const MAX_TARGET_EVENT_SLOTS: usize = 128;
const MAX_TARGET_ID_BYTES: usize = 128;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_RESOURCE_TYPE_BYTES: usize = 32;
/// Result of a bounded, close-cancellable WebSocket write.
enum WriteOutcome {
    Done,
    Failed(CdpError),
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpError {
    CommandTimeout,
    /// Cancellation won before the actor began writing this command.
    CancelledBeforeWrite,
    TooManyPendingCommands { current: usize, max: usize },
    WriterQueueFull { messages: usize, bytes: usize },
    CommandTooLarge { size: usize, max: usize },
    MessageTooLarge { size: usize, max: usize },
    ConnectionClosed,
    MalformedResponse(String),
    Protocol { code: i64, message: String },
    Deserialization(String),
    Transport(String),
}

impl CdpError {
    /// Whether the command may have reached the browser and executed. `false` only when the
    /// browser state is KNOWN unchanged: errors raised before anything was written (admission and
    /// size limits) and a browser-side rejection. Everything else (timeout, lost or failing
    /// transport, unreadable answer, serialization of the command or response) is ambiguous.
    /// Exhaustive on purpose: a new variant must be classified here.
    pub fn outcome_is_ambiguous(&self) -> bool {
        match self {
            Self::CancelledBeforeWrite
            | Self::TooManyPendingCommands { .. }
            | Self::WriterQueueFull { .. }
            | Self::CommandTooLarge { .. }
            | Self::Protocol { .. } => false,
            Self::CommandTimeout
            | Self::MessageTooLarge { .. }
            | Self::ConnectionClosed
            | Self::MalformedResponse(_)
            | Self::Deserialization(_)
            | Self::Transport(_) => true,
        }
    }
}

impl fmt::Display for CdpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandTimeout => {
                write!(f, "CDP command timed out after {COMMAND_TIMEOUT_SECS}s")
            }
            Self::CancelledBeforeWrite => write!(f, "CDP command cancelled before write"),
            Self::TooManyPendingCommands { current, max } => {
                write!(f, "too many pending commands: {current} >= {max}")
            }
            Self::WriterQueueFull { messages, bytes } => {
                write!(f, "writer queue full: {messages} msgs, {bytes} bytes")
            }
            Self::CommandTooLarge { size, max } => {
                write!(f, "command too large: {size} bytes > {max} bytes")
            }
            Self::MessageTooLarge { size, max } => {
                write!(
                    f,
                    "incoming WS message too large: {size} bytes > {max} bytes"
                )
            }
            Self::ConnectionClosed => write!(f, "CDP connection closed"),
            Self::MalformedResponse(msg) => write!(f, "malformed CDP response: {msg}"),
            Self::Protocol { code, message } => write!(f, "CDP error {code}: {message}"),
            Self::Deserialization(err) => write!(f, "CDP deserialization error: {err}"),
            Self::Transport(err) => write!(f, "CDP transport error: {err}"),
        }
    }
}

impl std::error::Error for CdpError {}

#[derive(Serialize)]
struct CdpRequestWire<'a, P: Serialize, I = usize> {
    id: I,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<&'a P>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
}

/// Deserialize a field preserving presence: absent -> `None` (via `default`), explicit JSON
/// `null` -> `Some(Value::Null)`, so `"error": null` still counts as a present field.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

/// Minimal routing envelope. Every field is an untyped `Value` so that a structurally wrong
/// response (e.g. string error code) still routes to its owner instead of failing the whole
/// envelope; typed validation of the required response happens per owner afterwards.
#[derive(Deserialize)]
struct IncomingEnvelope {
    #[serde(default, deserialize_with = "present")]
    id: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    method: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    result: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    error: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    params: Option<Value>,
    #[serde(rename = "sessionId", default, deserialize_with = "present")]
    session_id: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CdpErrorWire {
    code: i64,
    message: String,
}

/// One `Page.screencastFrame`. The base64 payload is charged to the global payload budget for as
/// long as any clone of this `Arc` lives (broadcast slot, receiver, encoded candidate), so the
/// producer shares it instead of copying. A frame the budget could not admit keeps its identity
/// (the native ACK must still be sent) but carries no payload and `memory_admitted == false`.
#[derive(Debug)]
pub struct ScreencastFrameData {
    pub session_id: String,
    pub frame_session_id: i64,
    pub data_base64: String,
    pub metadata: Value,
    pub native_capture_time_unix_ms: Option<u64>,
    pub received_at: std::time::Instant,
    pub server_received_unix_ms: u64,
    pub memory_admitted: bool,
    _reservation: Option<MemoryReservation>,
}

/// Extracts and validates optional CDP `Page.ScreencastFrameMetadata.timestamp` (seconds since Unix
/// epoch) into finite positive milliseconds within a plausible upper envelope (`<= 2100-01-01 UTC`,
/// well within JS safe integer range). Missing, non-finite, non-positive, or implausible values
/// return `None` rather than fabricating capture time.
pub fn parse_native_capture_time_unix_ms(metadata: &Value) -> Option<u64> {
    const MAX_PLAUSIBLE_CAPTURE_UNIX_MS: u64 = 4_102_444_800_000; // 2100-01-01T00:00:00Z
    let raw_ts = metadata.get("timestamp")?.as_f64()?;
    if !raw_ts.is_finite() || raw_ts <= 0.0 {
        return None;
    }
    let ms_f64 = (raw_ts * 1000.0).round();
    if !ms_f64.is_finite()
        || ms_f64 < 1.0
        || ms_f64 > (MAX_PLAUSIBLE_CAPTURE_UNIX_MS as f64)
    {
        return None;
    }
    Some(ms_f64 as u64)
}
#[derive(Debug, Clone)]
pub enum CdpLifecycleEvent {
    FrameNavigated {
        session_id: Option<String>,
        is_main_frame: bool,
        frame_id: Option<String>,
        url: Option<String>,
        loader_id: Option<String>,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    NavigatedWithinDocument {
        session_id: Option<String>,
        frame_id: Option<String>,
        url: Option<String>,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    InspectNodeRequested {
        session_id: Option<String>,
        backend_node_id: i64,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    Overflow,
}

/// Bounded projection of CDP `TargetInfo` for a top-level target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeTargetInfo {
    pub target_id: String,
    pub target_type: String,
    /// Empty when the browser sent no URL or an oversize one.
    pub url: String,
    pub opener_id: Option<String>,
}

/// Browser-level target lifecycle events (events without a CDP `sessionId`). They feed the
/// manager-owned native target observer; a lost event is reported as `Overflow`.
#[derive(Debug, Clone)]
pub enum CdpTargetEvent {
    Created {
        info: NativeTargetInfo,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    /// Flattened auto-attach of a top-level target; `waiting_for_debugger` means the target is
    /// paused until `Runtime.runIfWaitingForDebugger` is sent on `session_id`.
    Attached {
        session_id: String,
        info: NativeTargetInfo,
        waiting_for_debugger: bool,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    /// Flattened auto-attach of a child target (such as a cross-origin OOPIF `iframe`) scoped to
    /// `parent_session_id`.
    ChildAttached {
        parent_session_id: String,
        session_id: String,
        info: NativeTargetInfo,
        waiting_for_debugger: bool,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    Destroyed {
        target_id: String,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    Crashed {
        target_id: String,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    Overflow,
}

/// Synchronously transfers browser-wide containment to the process owner before the
/// policy transport can disappear. Independent of every producer/page lifetime.
pub type ContainmentEscalation = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
struct BrowserRequestPolicy {
    policy: Arc<NetworkPolicy>,
    escalate: ContainmentEscalation,
}

type SharedRequestPolicy = Arc<std::sync::RwLock<Option<BrowserRequestPolicy>>>;

pub trait CdpNavigationListener: Send + Sync {
    fn on_navigation_dispatched(
        &self,
        session_id: Option<&str>,
        call_id: usize,
        method: &str,
        explicit_epoch: Option<u64>,
        expected_url: Option<&str>,
    ) -> bool;
    fn on_navigation_response(
        &self,
        session_id: Option<&str>,
        call_id: usize,
        method: &str,
        loader_id: Option<&str>,
        failed: bool,
    );
    fn on_frame_navigated(
        &self,
        session_id: Option<&str>,
        is_main_frame: bool,
        loader_id: Option<&str>,
    );
    fn on_navigated_within_document(
        &self,
        session_id: Option<&str>,
        frame_id: Option<&str>,
        url: Option<&str>,
        navigation_type: Option<&str>,
    );
}

type SharedNavListeners = Arc<std::sync::Mutex<Vec<std::sync::Weak<dyn CdpNavigationListener>>>>;

fn classify_nav_method(method: &str) -> Option<&'static str> {
    match method {
        "Page.navigate" => Some("Page.navigate"),
        "Page.reload" => Some("Page.reload"),
        "Page.navigateToHistoryEntry" => Some("Page.navigateToHistoryEntry"),
        "Page.stopLoading" => Some("Page.stopLoading"),
        _ => None,
    }
}

fn notify_nav_dispatched(
    listeners: &SharedNavListeners,
    session_id: Option<&str>,
    call_id: usize,
    method: &str,
    explicit_epoch: Option<u64>,
    expected_url: Option<&str>,
) -> bool {
    let mut admitted = true;
    let mut guard = listeners.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|w| {
        if let Some(l) = w.upgrade() {
            if !l.on_navigation_dispatched(
                session_id,
                call_id,
                method,
                explicit_epoch,
                expected_url,
            ) {
                admitted = false;
            }
            true
        } else {
            false
        }
    });
    admitted
}

fn notify_nav_response(
    listeners: &SharedNavListeners,
    session_id: Option<&str>,
    call_id: usize,
    method: &str,
    loader_id: Option<&str>,
    failed: bool,
) {
    let mut guard = listeners.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|w| {
        if let Some(l) = w.upgrade() {
            l.on_navigation_response(session_id, call_id, method, loader_id, failed);
            true
        } else {
            false
        }
    });
}

fn notify_frame_navigated(
    listeners: &SharedNavListeners,
    session_id: Option<&str>,
    is_main_frame: bool,
    loader_id: Option<&str>,
) {
    let mut guard = listeners.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|w| {
        if let Some(l) = w.upgrade() {
            l.on_frame_navigated(session_id, is_main_frame, loader_id);
            true
        } else {
            false
        }
    });
}

fn notify_navigated_within_document(
    listeners: &SharedNavListeners,
    session_id: Option<&str>,
    frame_id: Option<&str>,
    url: Option<&str>,
    navigation_type: Option<&str>,
) {
    let mut guard = listeners.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|w| {
        if let Some(l) = w.upgrade() {
            l.on_navigated_within_document(session_id, frame_id, url, navigation_type);
            true
        } else {
            false
        }
    });
}

struct PendingRequest {
    sender: oneshot::Sender<Result<Value, CdpError>>,
    deadline: Instant,
    nav_meta: Option<(Option<String>, &'static str)>,
    /// Keeps the command slot and payload bytes reserved until the request leaves the map.
    _reservation: CommandReservation,
}

/// Shared race between a lease fence and the actor's start-of-write claim.
#[derive(Clone)]
pub(crate) struct InputCommandCancellation(Arc<AtomicU8>);

impl InputCommandCancellation {
    pub(crate) fn new() -> Self {
        Self(Arc::new(AtomicU8::new(0)))
    }

    pub(crate) fn cancel_before_write(&self) -> bool {
        match self.0.compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) | Err(2) => true,
            Err(_) => false,
        }
    }

    pub(crate) fn same_as(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

enum ActorMessage {
    SendCommand {
        id: usize,
        json: String,
        reservation: CommandReservation,
        sender: oneshot::Sender<Result<Value, CdpError>>,
        deadline: Instant,
        nav_meta: Option<(Option<String>, &'static str)>,
        cancellation: Option<InputCommandCancellation>,
    },
}

/// Stats recorded by the bounded CDP actor
#[derive(Debug, Default)]
pub struct CdpActorStats {
    pub unknown_events_count: AtomicU64,
    pub total_commands_sent: AtomicU64,
    /// Peak payload bytes reserved across queued + in-flight commands (serialized length, a
    /// logical budget; not allocator capacity or transport buffering).
    pub peak_queued_bytes: AtomicU64,
    pub screencast_frames_received: AtomicU64,
    pub screencast_frames_acked: AtomicU64,
}

/// `io::Write` sink that reserves budget bytes *before* each append: the serialized length of a
/// command is always covered by the shared budget. This is a logical payload budget; `Vec`
/// growth slack and transport buffering are not counted.
struct BudgetedWriter<'a> {
    buf: Vec<u8>,
    reservation: &'a mut CommandReservation,
    stats: &'a CdpActorStats,
    failure: Option<CdpError>,
}

impl io::Write for BudgetedWriter<'_> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        let next = self.buf.len() + data.len();
        if next > MAX_COMMAND_BYTES {
            self.failure = Some(CdpError::CommandTooLarge {
                size: next,
                max: MAX_COMMAND_BYTES,
            });
            return Err(io::Error::other("command exceeds per-command limit"));
        }
        match self.reservation.grow(data.len()) {
            Ok(total) => {
                self.stats
                    .peak_queued_bytes
                    .fetch_max(total as u64, Ordering::Relaxed);
            }
            Err(err) => {
                self.failure = Some(err);
                return Err(io::Error::other("command byte budget exhausted"));
            }
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Writer side of one connection actor. Replaced wholesale when the connection is re-established.
#[derive(Clone)]
struct ActorLink {
    command_tx: mpsc::Sender<ActorMessage>,
    close_notify: Arc<Notify>,
    /// Sender lives in a monitor until the actor task and its transport have been dropped.
    transport_closed: tokio::sync::watch::Receiver<()>,
}

/// State that outlives a connection: every actor generation publishes into the same event
/// channels, so existing subscribers keep receiving after a reconnect.
#[derive(Clone)]
struct ActorShared {
    screencast_tx: tokio::sync::broadcast::Sender<Arc<ScreencastFrameData>>,
    event_tx: tokio::sync::broadcast::Sender<Arc<CdpLifecycleEvent>>,
    target_tx: tokio::sync::broadcast::Sender<Arc<CdpTargetEvent>>,
    memory_controller: Arc<MemoryAdmissionController>,
    stats: Arc<CdpActorStats>,
    request_policy: SharedRequestPolicy,
    nav_listeners: SharedNavListeners,
}

impl ActorShared {
    /// Spawns one connection actor over `ws_stream` and returns its writer side.
    fn spawn_actor<S>(&self, ws_stream: S) -> ActorLink
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + Unpin
            + 'static,
    {
        let (command_tx, command_rx) = mpsc::channel(MAX_WRITER_QUEUE_MESSAGES);
        let close_notify = Arc::new(Notify::new());
        let actor = CdpActor {
            ws_stream,
            command_rx,
            close_notify: close_notify.clone(),
            screencast_tx: self.screencast_tx.clone(),
            event_tx: self.event_tx.clone(),
            target_tx: self.target_tx.clone(),
            memory_controller: self.memory_controller.clone(),
            pending_commands: HashMap::with_capacity(MAX_PENDING_COMMANDS),
            stats: self.stats.clone(),
            request_policy: self.request_policy.clone(),
            policy_write: None,
            next_policy_id: FIRST_POLICY_COMMAND_ID,
            nav_listeners: self.nav_listeners.clone(),
        };
        let actor_task = tokio::spawn(actor.run());
        let (transport_alive, transport_closed) = tokio::sync::watch::channel(());
        tokio::spawn(async move {
            let _ = actor_task.await;
            drop(transport_alive);
        });
        ActorLink {
            command_tx,
            close_notify,
            transport_closed,
        }
    }
}

/// A command that is already queued for the actor writer; awaiting it only waits for the response.
pub struct PendingCommand {
    receiver: oneshot::Receiver<Result<Value, CdpError>>,
    deadline: Instant,
    cancellation: Option<InputCommandCancellation>,
}

impl PendingCommand {
    /// Waits for the response, the command deadline, or actor loss.
    pub async fn wait(mut self) -> Result<Value, CdpError> {
        self.wait_mut().await
    }

    pub(crate) async fn wait_mut(&mut self) -> Result<Value, CdpError> {
        let result = tokio::select! {
            res = &mut self.receiver => {
                match res {
                    Ok(result) => result,
                    Err(_) => Err(CdpError::ConnectionClosed),
                }
            }
            _ = tokio::time::sleep_until(self.deadline) => {
                Err(CdpError::CommandTimeout)
            }
        };
        if result.is_err() && self.cancellation.as_ref().is_some_and(InputCommandCancellation::cancel_before_write) {
            Err(CdpError::CancelledBeforeWrite)
        } else {
            result
        }
    }

    /// Atomically suppress an input command if the actor has not started its write.
    pub(crate) fn cancel_before_write(&self) {
        if let Some(state) = &self.cancellation {
            state.cancel_before_write();
        }
    }
}

/// One `Page.screencastFrameAck` that was admitted to the actor queue. Created synchronously, so
/// the single ACK attempt for a frame never depends on the response of an earlier command.
pub struct PendingAck {
    command: PendingCommand,
    stats: Arc<CdpActorStats>,
}

impl PendingAck {
    /// Resolves once Chromium answered the ACK; any error leaves the ACK outcome ambiguous.
    pub async fn wait(self) -> Result<(), CdpError> {
        self.command.wait().await?;
        self.stats
            .screencast_frames_acked
            .fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

pub struct CdpClient {
    next_call_id: AtomicU64,
    link: std::sync::RwLock<ActorLink>,
    /// Browser endpoint this client dialed; `None` for clients wrapped around a caller transport.
    endpoint: Option<String>,
    /// Serializes reconnects so exactly one new actor replaces a dead one.
    reconnect_gate: tokio::sync::Mutex<()>,
    budget: Arc<CommandBudget>,
    screencast_rx_broadcast: tokio::sync::broadcast::Sender<Arc<ScreencastFrameData>>,
    event_rx_broadcast: tokio::sync::broadcast::Sender<Arc<CdpLifecycleEvent>>,
    target_rx_broadcast: tokio::sync::broadcast::Sender<Arc<CdpTargetEvent>>,
    memory_controller: Arc<MemoryAdmissionController>,
    stats: Arc<CdpActorStats>,
    request_policy: SharedRequestPolicy,
    policy_setup: tokio::sync::Mutex<bool>,
    nav_listeners: SharedNavListeners,
}

impl CdpClient {
    /// Connect to a CDP WebSocket endpoint with bounded buffers and actor loops.
    pub async fn connect(ws_url: &str) -> Result<Arc<Self>, CdpError> {
        let ws_stream = Self::dial(ws_url).await?;
        Ok(Self::build(
            ws_stream,
            global_memory_controller().clone(),
            Some(ws_url.to_string()),
        ))
    }

    async fn dial(
        ws_url: &str,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        CdpError,
    > {
        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
        config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);
        let (ws_stream, _) =
            tokio_tungstenite::connect_async_with_config(ws_url, Some(config), false)
                .await
                .map_err(|e| CdpError::Transport(e.to_string()))?;
        Ok(ws_stream)
    }

    /// Construct a CdpClient from an existing WebSocketStream (allows unit testing with loopback).
    /// Such a client cannot [`reconnect`](Self::reconnect): it does not know an endpoint.
    pub fn from_ws_stream<S>(ws_stream: S) -> Arc<Self>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + Unpin
            + 'static,
    {
        Self::from_ws_stream_with_memory_controller(ws_stream, global_memory_controller().clone())
    }

    /// Construct a CdpClient using an explicit memory admission controller (for bounded budget tests).
    pub fn from_ws_stream_with_memory_controller<S>(
        ws_stream: S,
        memory_controller: Arc<MemoryAdmissionController>,
    ) -> Arc<Self>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + Unpin
            + 'static,
    {
        Self::build(ws_stream, memory_controller, None)
    }

    fn build<S>(
        ws_stream: S,
        memory_controller: Arc<MemoryAdmissionController>,
        endpoint: Option<String>,
    ) -> Arc<Self>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + Unpin
            + 'static,
    {
        let (screencast_tx, _) = tokio::sync::broadcast::channel(2);
        let (event_tx, _) = tokio::sync::broadcast::channel(MAX_LIFECYCLE_EVENT_SLOTS);
        let request_policy = Arc::new(std::sync::RwLock::new(None));
        let (target_tx, _) = tokio::sync::broadcast::channel(MAX_TARGET_EVENT_SLOTS);
        let stats = Arc::new(CdpActorStats::default());
        let nav_listeners: SharedNavListeners = Arc::new(std::sync::Mutex::new(Vec::new()));

        let shared = ActorShared {
            screencast_tx: screencast_tx.clone(),
            event_tx: event_tx.clone(),
            target_tx: target_tx.clone(),
            memory_controller: memory_controller.clone(),
            stats: stats.clone(),
            request_policy: request_policy.clone(),
            nav_listeners: nav_listeners.clone(),
        };
        let link = shared.spawn_actor(ws_stream);

        Arc::new(Self {
            next_call_id: AtomicU64::new(1),
            link: std::sync::RwLock::new(link),
            endpoint,
            reconnect_gate: tokio::sync::Mutex::new(()),
            budget: CommandBudget::with_memory(
                MAX_PENDING_COMMANDS,
                MAX_WRITER_QUEUE_BYTES,
                memory_controller.clone(),
            ),
            screencast_rx_broadcast: screencast_tx,
            event_rx_broadcast: event_tx,
            request_policy,
            policy_setup: tokio::sync::Mutex::new(false),
            target_rx_broadcast: target_tx,
            memory_controller,
            stats,
            nav_listeners,
        })
    }

    fn link(&self) -> ActorLink {
        self.link.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Replaces a dead connection actor with a fresh one over a new transport to the same
    /// endpoint. Existing subscribers keep their channels; every Page session of the old
    /// connection is gone, so callers must attach new ones. No-op while the actor is alive.
    ///
    /// Refused for clients that never dialed an endpoint and for clients carrying the
    /// browser-wide request policy: that interception is bound to the connection and must be
    /// re-established by its owner, never silently dropped.
    pub async fn reconnect(&self) -> Result<(), CdpError> {
        let _gate = self.reconnect_gate.lock().await;
        let link = self.link();
        if !link.command_tx.is_closed() {
            return Ok(());
        }
        // Queue closure precedes transport teardown; never overlap actor generations.
        let mut transport_closed = link.transport_closed;
        let _ = transport_closed.changed().await;
        let Some(endpoint) = self.endpoint.as_deref() else {
            return Err(CdpError::Transport(
                "CDP client has no endpoint to reconnect to".to_string(),
            ));
        };
        if *self.policy_setup.lock().await {
            return Err(CdpError::Protocol {
                code: -1,
                message: "browser request policy is bound to its connection; cannot reconnect"
                    .to_string(),
            });
        }
        let ws_stream = Self::dial(endpoint).await?;
        let shared = ActorShared {
            screencast_tx: self.screencast_rx_broadcast.clone(),
            event_tx: self.event_rx_broadcast.clone(),
            target_tx: self.target_rx_broadcast.clone(),
            memory_controller: self.memory_controller.clone(),
            stats: self.stats.clone(),
            request_policy: self.request_policy.clone(),
            nav_listeners: self.nav_listeners.clone(),
        };
        let link = shared.spawn_actor(ws_stream);
        *self.link.write().unwrap_or_else(|e| e.into_inner()) = link;
        Ok(())
    }

    pub fn register_navigation_listener(
        &self,
        listener: std::sync::Weak<dyn CdpNavigationListener>,
    ) {
        let mut guard = self.nav_listeners.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|w| w.strong_count() > 0);
        guard.push(listener);
    }

    pub fn stats(&self) -> &CdpActorStats {
        &self.stats
    }

    pub fn subscribe_screencast(
        &self,
    ) -> tokio::sync::broadcast::Receiver<Arc<ScreencastFrameData>> {
        self.screencast_rx_broadcast.subscribe()
    }

    pub fn subscribe_events(&self) -> tokio::sync::broadcast::Receiver<Arc<CdpLifecycleEvent>> {
        self.event_rx_broadcast.subscribe()
    }

    /// Installs one browser-owned interceptor before publishing any managed Page session.
    /// Browser Fetch wraps every URLLoaderFactory, including nested worker main scripts;
    /// dedicated-worker targets do not implement Fetch themselves.
    pub async fn install_browser_request_policy(
        &self,
        policy: Arc<NetworkPolicy>,
        escalate: ContainmentEscalation,
    ) -> Result<(), CdpError> {
        let mut ready = self.policy_setup.lock().await;
        if self.is_closed() {
            return Err(CdpError::ConnectionClosed);
        }
        {
            let mut installed = self.request_policy.write().unwrap_or_else(|e| e.into_inner());
            if let Some(existing) = installed.as_ref() {
                if existing.policy != policy {
                    return Err(CdpError::Protocol {
                        code: -1,
                        message: "browser request policy cannot change within an incarnation".into(),
                    });
                }
            } else {
                *installed = Some(BrowserRequestPolicy { policy, escalate: escalate.clone() });
            }
        }
        if *ready {
            return Ok(());
        }
        if let Err(err) = self.send_command(
            "Fetch.enable",
            Some(serde_json::json!({
                "patterns": [{ "urlPattern": "*", "requestStage": "Request" }]
            })),
            None,
        ).await {
            escalate("browser-wide request interception could not be installed");
            self.close().await;
            return Err(err);
        }
        *ready = true;
        Ok(())
    }

    /// Subscribes to browser-level target lifecycle events.
    pub fn subscribe_target_events(&self) -> tokio::sync::broadcast::Receiver<Arc<CdpTargetEvent>> {
        self.target_rx_broadcast.subscribe()
    }

    /// True once the actor refuses commands; transport teardown may still be in progress.
    pub fn is_closed(&self) -> bool {
        self.link().command_tx.is_closed()
    }

    /// Resolves after the current actor task has exited and dropped its transport.
    pub async fn closed(&self) {
        let mut transport_closed = self.link().transport_closed;
        let _ = transport_closed.changed().await;
    }

    pub fn memory_controller(&self) -> &Arc<MemoryAdmissionController> {
        &self.memory_controller
    }

    /// Send a low-level CDP command with method, params, and optional sessionId.
    pub async fn send_command(
        &self,
        method: &str,
        params: Option<Value>,
        session_id: Option<&str>,
    ) -> Result<Value, CdpError> {
        let expected_url = params
            .as_ref()
            .and_then(|p| p.get("url"))
            .and_then(Value::as_str)
            .map(str::to_string);
        self.dispatch(
            method,
            params.as_ref(),
            session_id,
            None,
            expected_url.as_deref(),
        )
        .await
    }

    /// Send a navigation CDP command bound to an explicit captured navigation revision epoch.
    pub async fn send_navigation_command(
        &self,
        method: &str,
        params: Option<Value>,
        session_id: Option<&str>,
        explicit_epoch: Option<u64>,
        expected_url: Option<&str>,
    ) -> Result<Value, CdpError> {
        let param_url = params
            .as_ref()
            .and_then(|p| p.get("url"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let eff_url = expected_url.or(param_url.as_deref());
        self.dispatch(method, params.as_ref(), session_id, explicit_epoch, eff_url)
            .await
    }

    /// Admission order: non-waiting slot reservation, byte-reserving bounded serialization,
    /// pre-enqueue navigation listener binding, and non-waiting enqueue. Every failure drops
    /// the reservation and rolls back any registered navigation dispatch.
    async fn dispatch<P: Serialize>(
        &self,
        method: &str,
        params: Option<&P>,
        session_id: Option<&str>,
        explicit_epoch: Option<u64>,
        expected_url: Option<&str>,
    ) -> Result<Value, CdpError> {
        self.enqueue(method, params, session_id, explicit_epoch, expected_url, None)?
            .wait()
            .await
    }

    /// Synchronous half of [`dispatch`](Self::dispatch): everything up to and including the
    /// non-waiting actor enqueue. Never awaits the browser.
    fn enqueue<P: Serialize>(
        &self,
        method: &str,
        params: Option<&P>,
        session_id: Option<&str>,
        explicit_epoch: Option<u64>,
        expected_url: Option<&str>,
        cancellation: Option<InputCommandCancellation>,
    ) -> Result<PendingCommand, CdpError> {
        let mut reservation = self.budget.reserve_slot()?;

        let call_id = self.next_call_id.fetch_add(1, Ordering::SeqCst) as usize;
        let wire = CdpRequestWire {
            id: call_id,
            method,
            params,
            session_id,
        };
        let mut writer = BudgetedWriter {
            buf: Vec::new(),
            reservation: &mut reservation,
            stats: &self.stats,
            failure: None,
        };
        if let Err(err) = serde_json::to_writer(&mut writer, &wire) {
            return Err(writer
                .failure
                .take()
                .unwrap_or_else(|| CdpError::Deserialization(err.to_string())));
        }
        let json =
            String::from_utf8(writer.buf).map_err(|e| CdpError::Deserialization(e.to_string()))?;

        let (sender, receiver) = oneshot::channel();
        let deadline = Instant::now() + Duration::from_secs(COMMAND_TIMEOUT_SECS);

        let nav_method = classify_nav_method(method);
        let nav_meta = nav_method.map(|m| (session_id.map(str::to_string), m));
        if let Some(m) = nav_method {
            if !notify_nav_dispatched(
                &self.nav_listeners,
                session_id,
                call_id,
                m,
                explicit_epoch,
                expected_url,
            ) {
                return Err(CdpError::Protocol {
                    code: -32000,
                    message: "stale navigation epoch superseded before dispatch".to_string(),
                });
            }
        }
        // The queue holds at most MAX_WRITER_QUEUE_MESSAGES unwritten commands; a full queue
        // is reported immediately rather than waiting with the payload retained.
        if let Err(err) = self.link().command_tx.try_send(ActorMessage::SendCommand {
            id: call_id,
            json,
            reservation,
            sender,
            deadline,
            nav_meta,
            cancellation: cancellation.clone(),
        }) {
            if let Some(m) = nav_method {
                notify_nav_response(&self.nav_listeners, session_id, call_id, m, None, true);
            }
            return Err(match err {
                mpsc::error::TrySendError::Full(_) => CdpError::WriterQueueFull {
                    messages: MAX_WRITER_QUEUE_MESSAGES,
                    bytes: self.budget.bytes_in_use(),
                },
                mpsc::error::TrySendError::Closed(_) => CdpError::ConnectionClosed,
            });
        }
        self.stats
            .total_commands_sent
            .fetch_add(1, Ordering::Relaxed);

        Ok(PendingCommand { receiver, deadline, cancellation })
    }

    /// Queue one input command with a cancellation race against the actor's write claim.
    pub(crate) fn enqueue_cancellable_input(
        &self,
        method: &str,
        params: &Value,
        session_id: &str,
        cancellation: InputCommandCancellation,
    ) -> Result<PendingCommand, CdpError> {
        self.enqueue(method, Some(params), Some(session_id), None, None, Some(cancellation))
    }

    /// Send a strongly typed command from chromiumoxide_types / chromiumoxide_cdp.
    pub async fn send_typed<C: Command>(
        &self,
        cmd: C,
        session_id: Option<&str>,
    ) -> Result<C::Response, CdpError> {
        let method = cmd.identifier().to_string();
        let res_val = self.dispatch(&method, Some(&cmd), session_id, None, None).await?;
        C::response_from_value(res_val).map_err(|e| CdpError::MalformedResponse(e.to_string()))
    }

    /// Acknowledge a screencast frame to Chromium (releasing run credit) independently of viewer
    /// consumption, waiting for the response.
    pub async fn ack_screencast_frame(
        &self,
        session_id: &str,
        frame_session_id: i64,
    ) -> Result<(), CdpError> {
        self.enqueue_screencast_ack(session_id, frame_session_id)?
            .wait()
            .await
    }

    /// Admits one `Page.screencastFrameAck` to the actor queue without waiting for anything:
    /// the attempt is made (or refused) before this returns, whatever happened to earlier ACKs.
    /// The response is awaited separately through the returned [`PendingAck`].
    pub fn enqueue_screencast_ack(
        &self,
        session_id: &str,
        frame_session_id: i64,
    ) -> Result<PendingAck, CdpError> {
        use chromiumoxide_cdp::cdp::browser_protocol::page::ScreencastFrameAckParams;
        use chromiumoxide_types::Method;
        let params = ScreencastFrameAckParams::new(frame_session_id);
        let method = params.identifier().to_string();
        let command = self.enqueue(&method, Some(&params), Some(session_id), None, None, None)?;
        Ok(PendingAck {
            command,
            stats: self.stats.clone(),
        })
    }

    /// Request actor shutdown. Never waits on the command queue.
    pub async fn close(&self) {
        self.link().close_notify.notify_one();
    }
}

struct CdpActor<S> {
    ws_stream: S,
    command_rx: mpsc::Receiver<ActorMessage>,
    close_notify: Arc<Notify>,
    screencast_tx: tokio::sync::broadcast::Sender<Arc<ScreencastFrameData>>,
    event_tx: tokio::sync::broadcast::Sender<Arc<CdpLifecycleEvent>>,
    target_tx: tokio::sync::broadcast::Sender<Arc<CdpTargetEvent>>,
    memory_controller: Arc<MemoryAdmissionController>,
    pending_commands: HashMap<usize, PendingRequest>,
    stats: Arc<CdpActorStats>,
    request_policy: SharedRequestPolicy,
    /// At most one decision exists, and it is written before another event is read.
    policy_write: Option<(String, MemoryReservation)>,
    next_policy_id: i32,
    nav_listeners: SharedNavListeners,
}

impl<S> CdpActor<S>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
        + Send
        + Unpin
        + 'static,
{
    async fn run(mut self) {
        let mut sweep_interval = tokio::time::interval(Duration::from_millis(500));

        loop {
            tokio::select! {
                // Command submission from clients
                cmd_opt = self.command_rx.recv() => {
                    match cmd_opt {
                        Some(ActorMessage::SendCommand { id, json, reservation, sender, deadline, nav_meta, cancellation }) => {
                            // Caller cancellation check: skip command if caller abandoned the request before dequeue
                            if sender.is_closed() {
                                if let Some((ref sid, m)) = nav_meta {
                                    notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                                }
                                debug!(id, "command caller cancelled before dequeue");
                                continue;
                            }

                            if Instant::now() >= deadline {
                                if let Some((ref sid, m)) = nav_meta {
                                    notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                                }
                                let _ = sender.send(Err(CdpError::CommandTimeout));
                                continue;
                            }
                            if let Some(state) = &cancellation {
                                if state.0.compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire).is_err() {
                                    let _ = sender.send(Err(CdpError::CancelledBeforeWrite));
                                    continue;
                                }
                            }

                            // Bounded, close-cancellable write so peer stalls cannot hold the actor
                            match self.write_message(Message::Text(json.into())).await {
                                WriteOutcome::Done => {}
                                WriteOutcome::Failed(e) => {
                                    if let Some((ref sid, m)) = nav_meta {
                                        notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                                    }
                                    drop(reservation);
                                    let _ = sender.send(Err(e));
                                    self.shutdown(CdpError::ConnectionClosed, false).await;
                                    break;
                                }
                                WriteOutcome::Closed => {
                                    if let Some((ref sid, m)) = nav_meta {
                                        notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                                    }
                                    drop(reservation);
                                    let _ = sender.send(Err(CdpError::ConnectionClosed));
                                    self.shutdown(CdpError::ConnectionClosed, true).await;
                                    break;
                                }
                            }

                            self.pending_commands.insert(id, PendingRequest {
                                sender,
                                deadline,
                                nav_meta,
                                _reservation: reservation,
                            });
                        }
                        None => {
                            self.shutdown(CdpError::ConnectionClosed, true).await;
                            break;
                        }
                    }
                }

                _ = self.close_notify.notified() => {
                    self.shutdown(CdpError::ConnectionClosed, true).await;
                    break;
                }

                // Incoming messages from browser
                incoming = self.ws_stream.next() => {
                    let outcome = match incoming {
                        Some(Ok(Message::Text(text))) => self.handle_incoming_message(text.len(), Some(text.as_str())),
                        Some(Ok(Message::Binary(bin))) => {
                            self.handle_incoming_message(bin.len(), std::str::from_utf8(&bin).ok())
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            match self.write_message(Message::Pong(payload)).await {
                                WriteOutcome::Done => Ok(()),
                                WriteOutcome::Failed(e) => Err(e),
                                WriteOutcome::Closed => Err(CdpError::ConnectionClosed),
                            }
                        }
                        Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => Ok(()),
                        Some(Ok(Message::Close(_))) | None => {
                            self.shutdown(CdpError::ConnectionClosed, false).await;
                            break;
                        }
                        Some(Err(err)) => {
                            warn!("CDP transport read error: {}", err);
                            self.shutdown(CdpError::Transport(err.to_string()), false).await;
                            break;
                        }
                    };
                    if outcome.is_ok() {
                        if let Some((json, _reservation)) = self.policy_write.take() {
                            match self.write_message(Message::Text(json.into())).await {
                                WriteOutcome::Done => {}
                                WriteOutcome::Failed(err) => {
                                    self.shutdown(err, false).await;
                                    break;
                                }
                                WriteOutcome::Closed => {
                                    self.shutdown(CdpError::ConnectionClosed, true).await;
                                    break;
                                }
                            }
                        }
                    }
                    // Unrouteable framing or oversize: no owner can be identified, close the actor.
                    if let Err(err) = outcome {
                        error!("closing CDP actor: {}", err);
                        self.shutdown(err, true).await;
                        break;
                    }
                }

                // Periodic sweep of expired commands and abandoned senders
                _ = sweep_interval.tick() => {
                    let now = Instant::now();
                    let mut expired_or_closed = Vec::new();
                    for (id, req) in &self.pending_commands {
                        if now >= req.deadline || req.sender.is_closed() {
                            expired_or_closed.push(*id);
                        }
                    }
                    for id in expired_or_closed {
                        if let Some(req) = self.pending_commands.remove(&id) {
                            if let Some((ref sid, m)) = req.nav_meta {
                                notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                            }
                            if !req.sender.is_closed() {
                                let _ = req.sender.send(Err(CdpError::CommandTimeout));
                            }
                        }
                    }
                }
            }
        }
    }

    /// Size-check then route one WebSocket data message. `Err` means the framing is unusable
    /// and the whole connection must close.
    fn handle_incoming_message(&mut self, len: usize, text: Option<&str>) -> Result<(), CdpError> {
        if len > MAX_WS_MESSAGE_BYTES {
            return Err(CdpError::MessageTooLarge {
                size: len,
                max: MAX_WS_MESSAGE_BYTES,
            });
        }
        let text = text.ok_or_else(|| {
            CdpError::MalformedResponse("binary frame is not valid UTF-8".to_string())
        })?;
        self.handle_incoming_text(text)
    }

    /// Routes one CDP message. Returns `Err` only for unrouteable framing (invalid JSON,
    /// non-object, unusable id/method). A routeable response with a bad payload fails only
    /// its owner.
    fn handle_incoming_text(&mut self, text: &str) -> Result<(), CdpError> {
        // serde derives also accept JSON arrays positionally; a CDP message is always an object.
        if !text.trim_start().starts_with('{') {
            return Err(CdpError::MalformedResponse(
                "frame is not a JSON object".to_string(),
            ));
        }
        let env: IncomingEnvelope = match serde_json::from_str(text) {
            Ok(env) => env,
            Err(_) => {
                let sanitized = sanitize_cdp_json_escapes(text);
                serde_json::from_str(&sanitized)
                    .map_err(|e| CdpError::MalformedResponse(format!("unparseable frame: {e}")))?
            }
        };

        // An `id` marks a command response.
        if let Some(id_val) = env.id {
            if let Some(id) = id_val.as_i64().filter(|id| *id < 0) {
                if id < i64::from(self.next_policy_id) + 1 || id > i64::from(FIRST_POLICY_COMMAND_ID) {
                    return Err(CdpError::MalformedResponse("unissued request-policy response id".into()));
                }
                // A navigation may cancel an interception before its decision arrives. A
                match response_outcome(env.result, env.error) {
                    Ok(_) => {}
                    Err(CdpError::Protocol {
                        code: -32602 | -32000,
                        ..
                    }) => {
                        // Chromium FindJob / InterceptedRequest reports this when navigation or
                        // abort already canceled the paused loader.
                    }
                    Err(err) => return Err(err),
                }
                return Ok(());
            }
            let id = id_val
                .as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or_else(|| CdpError::MalformedResponse(
                    "response id is not a command integer".into(),
                ))?;
            // Unknown id: owner already timed out or was cancelled; nothing to fail.
            if let Some(pending) = self.pending_commands.remove(&id) {
                let outcome = response_outcome(env.result, env.error);
                if let Some((ref sid, m)) = pending.nav_meta {
                    match &outcome {
                        Ok(val) => {
                            let has_err = val
                                .get("errorText")
                                .and_then(Value::as_str)
                                .is_some_and(|s| !s.is_empty());
                            let loader_id = val
                                .get("loaderId")
                                .and_then(Value::as_str)
                                .filter(|s| !s.is_empty() && s.len() <= MAX_EVENT_SESSION_ID_BYTES);
                            notify_nav_response(
                                &self.nav_listeners,
                                sid.as_deref(),
                                id,
                                m,
                                loader_id,
                                has_err,
                            );
                        }
                        Err(_) => {
                            notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
                        }
                    }
                }
                let _ = pending.sender.send(outcome);
            }
            return Ok(());
        }

        // Otherwise it must be an event with a string `method`.
        match env.method {
            Some(Value::String(method)) if method == "Page.screencastFrame" => {
                self.handle_screencast_frame(env.session_id, env.params)
            }
            Some(Value::String(method))
                if matches!(
                    method.as_str(),
                    "Overlay.inspectNodeRequested"
                        | "Page.frameNavigated"
                        | "Page.navigatedWithinDocument"
                ) =>
            {
                let session_id = match env.session_id {
                    Some(Value::String(s)) if s.len() <= MAX_EVENT_SESSION_ID_BYTES => Some(s),
                    Some(Value::String(_)) => {
                        let _ = self.event_tx.send(Arc::new(CdpLifecycleEvent::Overflow));
                        return Ok(());
                    }
                    _ => None,
                };
                let params = env.params.as_ref();
                let projected = match method.as_str() {
                    "Page.frameNavigated" => {
                        let is_main_frame =
                            params.and_then(|p| p.pointer("/frame/parentId")).is_none();
                        let frame_id = params
                            .and_then(|p| p.pointer("/frame/id"))
                            .and_then(Value::as_str)
                            .filter(|id| !id.is_empty() && id.len() <= MAX_EVENT_SESSION_ID_BYTES)
                            .map(str::to_string);
                        let url = params
                            .and_then(|p| p.pointer("/frame/url"))
                            .and_then(Value::as_str)
                            .filter(|u| u.len() <= MAX_URL_BYTES)
                            .map(str::to_string);
                        let loader_id = params
                            .and_then(|p| p.pointer("/frame/loaderId"))
                            .and_then(Value::as_str)
                            .filter(|id| !id.is_empty() && id.len() <= MAX_EVENT_SESSION_ID_BYTES)
                            .map(str::to_string);
                        notify_frame_navigated(
                            &self.nav_listeners,
                            session_id.as_deref(),
                            is_main_frame,
                            loader_id.as_deref(),
                        );
                        let bytes = std::mem::size_of::<CdpLifecycleEvent>()
                            + session_id.as_ref().map_or(0, String::len)
                            + frame_id.as_ref().map_or(0, String::len)
                            + url.as_ref().map_or(0, String::len)
                            + loader_id.as_ref().map_or(0, String::len);
                        match self.memory_controller.try_reserve(bytes) {
                            Ok(res) => CdpLifecycleEvent::FrameNavigated {
                                session_id,
                                is_main_frame,
                                frame_id,
                                url,
                                loader_id,
                                _reservation: Some(Arc::new(res)),
                            },
                            Err(_) => CdpLifecycleEvent::Overflow,
                        }
                    }
                    "Page.navigatedWithinDocument" => {
                        let frame_id = params
                            .and_then(|p| p.get("frameId"))
                            .and_then(Value::as_str)
                            .filter(|id| !id.is_empty() && id.len() <= MAX_EVENT_SESSION_ID_BYTES);
                        let url = params
                            .and_then(|p| p.get("url"))
                            .and_then(Value::as_str)
                            .filter(|u| u.len() <= MAX_URL_BYTES)
                            .map(str::to_string);
                        let nav_type = params
                            .and_then(|p| p.get("navigationType"))
                            .and_then(Value::as_str)
                            .filter(|t| !t.is_empty() && t.len() <= 32);
                        notify_navigated_within_document(
                            &self.nav_listeners,
                            session_id.as_deref(),
                            frame_id,
                            url.as_deref(),
                            nav_type,
                        );
                        let bytes = std::mem::size_of::<CdpLifecycleEvent>()
                            + session_id.as_ref().map_or(0, String::len)
                            + frame_id.map_or(0, str::len)
                            + url.as_ref().map_or(0, String::len);
                        match self.memory_controller.try_reserve(bytes) {
                            Ok(res) => CdpLifecycleEvent::NavigatedWithinDocument {
                                session_id,
                                frame_id: frame_id.map(str::to_string),
                                url,
                                _reservation: Some(Arc::new(res)),
                            },
                            Err(_) => CdpLifecycleEvent::Overflow,
                        }
                    }
                    _ => {
                        let Some(backend_node_id) = params
                            .and_then(|p| p.get("backendNodeId"))
                            .and_then(Value::as_i64)
                        else {
                            return Ok(());
                        };
                        let bytes = std::mem::size_of::<CdpLifecycleEvent>()
                            + session_id.as_ref().map_or(0, String::len);
                        match self.memory_controller.try_reserve(bytes) {
                            Ok(res) => CdpLifecycleEvent::InspectNodeRequested {
                                session_id,
                                backend_node_id,
                                _reservation: Some(Arc::new(res)),
                            },
                            Err(_) => CdpLifecycleEvent::Overflow,
                        }
                    }
                };
                let _ = self.event_tx.send(Arc::new(projected));
                Ok(())
            }
            Some(Value::String(method)) if method == "Fetch.requestPaused" => {
                self.decide_request(env.session_id.as_ref(), env.params.as_ref())
            }
            Some(Value::String(method)) if method == "Target.attachedToTarget" => {
                match env.session_id {
                    None => self.publish_target_event(method.as_str(), env.params.as_ref()),
                    Some(Value::String(parent_sid))
                        if !parent_sid.is_empty()
                            && parent_sid.len() <= MAX_EVENT_SESSION_ID_BYTES =>
                    {
                        self.publish_child_target_event(parent_sid, env.params.as_ref());
                    }
                    _ => {}
                }
                Ok(())
            }
            Some(Value::String(method))
                if env.session_id.is_none()
                    && matches!(
                        method.as_str(),
                        "Target.targetCreated" | "Target.targetDestroyed" | "Target.targetCrashed"
                    ) =>
            {
                self.publish_target_event(method.as_str(), env.params.as_ref());
                Ok(())
            }
            Some(Value::String(_)) => {
                // Ignore unknown event with bounded counter; no queue allocation
                self.stats
                    .unknown_events_count
                    .fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
            _ => Err(CdpError::MalformedResponse(
                "message has neither a response id nor an event method".to_string(),
            )),
        }
    }

    /// Evaluates and serializes one browser-session decision. There is no cross-target
    /// broadcast, event backlog, or per-request round-trip wait: the actor writes this
    /// decision before reading the next event. Redirect hops receive independent verdicts.
    fn decide_request(
        &mut self,
        session_id: Option<&Value>,
        params: Option<&Value>,
    ) -> Result<(), CdpError> {
        // Session-scoped Fetch belongs to another owner (e.g. the manager's refused-page
        // quarantine). Never continue those requests or displace that owner's policy.
        if session_id.is_some() {
            return Ok(());
        }
        let installed = self.request_policy.read().unwrap_or_else(|e| e.into_inner()).clone();
        let Some(installed) = installed else {
            return Ok(());
        };
        let request_id = params.and_then(|p| p.get("requestId")).and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= MAX_REQUEST_ID_BYTES)
            .ok_or_else(|| CdpError::MalformedResponse("Fetch.requestPaused: invalid requestId".into()))?;
        let url = params.and_then(|p| p.pointer("/request/url")).and_then(Value::as_str)
            .filter(|url| url.len() <= MAX_URL_BYTES).unwrap_or("");
        let resource_type = params.and_then(|p| p.get("resourceType")).and_then(Value::as_str)
            .filter(|kind| !kind.is_empty() && kind.len() <= MAX_RESOURCE_TYPE_BYTES)
            .ok_or_else(|| CdpError::MalformedResponse("Fetch.requestPaused: invalid resourceType".into()))?;
        let kind = if resource_type == "Document" {
            RequestKind::Navigation
        } else {
            RequestKind::Subresource
        };
        let verdict = installed.policy.check_request(url, kind);
        let (method, error_reason) = match verdict {
            Ok(()) => ("Fetch.continueRequest", None),
            Err(err) => {
                debug!(error = %err, "Browser request denied by network policy");
                ("Fetch.failRequest", Some("AccessDenied"))
            }
        };
        let raw_headers = params.and_then(|p| p.pointer("/request/headers"));
        let extra_header_bytes = if error_reason.is_none() {
            super::stealth::estimate_headless_header_override_bytes(raw_headers).unwrap_or(0)
        } else {
            0
        };
        let total_budget = 256usize
            .saturating_add(request_id.len().saturating_mul(6))
            .saturating_add(extra_header_bytes);
        if total_budget > super::protocol::MAX_COMMAND_BYTES {
            return Err(CdpError::Transport(
                "request-policy header override exceeds command budget".into(),
            ));
        }
        // Reserve before allocating the rewritten headers or bounded serialization; request ids
        // and header strings may need JSON escaping (six bytes per input byte).
        let reservation = self
            .memory_controller
            .try_reserve(total_budget)
            .map_err(|_| CdpError::Transport("request-policy memory admission failed".into()))?;
        let headers = if extra_header_bytes > 0 {
            super::stealth::sanitize_headless_request_headers(raw_headers)
        } else {
            None
        };
        #[derive(Serialize)]
        struct Decision<'a> {
            #[serde(rename = "requestId")]
            request_id: &'a str,
            #[serde(rename = "errorReason", skip_serializing_if = "Option::is_none")]
            error_reason: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            headers: Option<Vec<Value>>,
        }
        let decision = Decision {
            request_id,
            error_reason,
            headers,
        };
        let json = serde_json::to_string(&CdpRequestWire {
            id: self.next_policy_id,
            method,
            params: Some(&decision),
            session_id: None,
        }).map_err(|e| CdpError::Deserialization(e.to_string()))?;
        self.next_policy_id = self.next_policy_id.checked_sub(1)
            .ok_or_else(|| CdpError::Transport("request-policy command ids exhausted".into()))?;
        self.policy_write = Some((json, reservation));
        Ok(())
    }

    /// Projects a browser-level `Target.*` lifecycle event into bounded owned data. Anything that
    /// cannot be bounded or identified becomes `Overflow` (the consumer re-inventories).
    fn publish_target_event(&self, method: &str, params: Option<&Value>) {
        let event = self.project_target_event(method, params);
        let _ = self.target_tx.send(Arc::new(event));
    }

    fn publish_child_target_event(&self, parent_session_id: String, params: Option<&Value>) {
        if let CdpTargetEvent::Attached {
            session_id,
            info,
            waiting_for_debugger,
            _reservation,
        } = self.project_target_event("Target.attachedToTarget", params)
        {
            let _ = self.target_tx.send(Arc::new(CdpTargetEvent::ChildAttached {
                parent_session_id,
                session_id,
                info,
                waiting_for_debugger,
                _reservation,
            }));
        }
    }

    fn project_target_event(&self, method: &str, params: Option<&Value>) -> CdpTargetEvent {
        let str_at = |ptr: &str, max: usize| -> Option<String> {
            params
                .and_then(|p| p.pointer(ptr))
                .and_then(Value::as_str)
                .filter(|s| s.len() <= max)
                .map(str::to_string)
        };
        let reserve = |bytes: usize| self.memory_controller.try_reserve(bytes).ok().map(Arc::new);
        match method {
            "Target.targetDestroyed" | "Target.targetCrashed" => {
                let Some(target_id) = str_at("/targetId", MAX_TARGET_ID_BYTES) else {
                    return CdpTargetEvent::Overflow;
                };
                let bytes = std::mem::size_of::<CdpTargetEvent>() + target_id.len();
                let Some(res) = reserve(bytes) else {
                    return CdpTargetEvent::Overflow;
                };
                if method == "Target.targetDestroyed" {
                    CdpTargetEvent::Destroyed {
                        target_id,
                        _reservation: Some(res),
                    }
                } else {
                    CdpTargetEvent::Crashed {
                        target_id,
                        _reservation: Some(res),
                    }
                }
            }
            _ => {
                let Some(target_id) = str_at("/targetInfo/targetId", MAX_TARGET_ID_BYTES) else {
                    return CdpTargetEvent::Overflow;
                };
                let target_type =
                    str_at("/targetInfo/type", MAX_RESOURCE_TYPE_BYTES).unwrap_or_default();
                let url = str_at("/targetInfo/url", MAX_URL_BYTES).unwrap_or_default();
                let opener_id = str_at("/targetInfo/openerId", MAX_TARGET_ID_BYTES);
                let info = NativeTargetInfo {
                    target_id,
                    target_type,
                    url,
                    opener_id,
                };
                let info_bytes = std::mem::size_of::<CdpTargetEvent>()
                    + info.target_id.len()
                    + info.target_type.len()
                    + info.url.len()
                    + info.opener_id.as_ref().map_or(0, String::len);
                if method == "Target.targetCreated" {
                    let Some(res) = reserve(info_bytes) else {
                        return CdpTargetEvent::Overflow;
                    };
                    return CdpTargetEvent::Created {
                        info,
                        _reservation: Some(res),
                    };
                }
                let Some(session_id) = str_at("/sessionId", MAX_EVENT_SESSION_ID_BYTES) else {
                    return CdpTargetEvent::Overflow;
                };
                let waiting_for_debugger = params
                    .and_then(|p| p.get("waitingForDebugger"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let Some(res) = reserve(info_bytes + session_id.len()) else {
                    return CdpTargetEvent::Overflow;
                };
                CdpTargetEvent::Attached {
                    session_id,
                    info,
                    waiting_for_debugger,
                    _reservation: Some(res),
                }
            }
        }
    }

    /// Required fields of a known event stay validated. A malformed `Page.screencastFrame` has no
    /// routable owner and would strand the native frame credit, so it closes the actor instead of
    /// being silently dropped. Contract for the producer (phase05): actor closure is an ambiguous
    /// run failure and must start a fresh flattened Page session (architecture-contracts.md).
    fn handle_screencast_frame(
        &self,
        session_id: Option<Value>,
        params: Option<Value>,
    ) -> Result<(), CdpError> {
        let malformed =
            |what: &str| CdpError::MalformedResponse(format!("Page.screencastFrame: {what}"));
        let Some(Value::String(session_id)) = session_id else {
            return Err(malformed("missing string sessionId"));
        };
        let Some(Value::Object(mut map)) = params else {
            return Err(malformed("params is not an object"));
        };
        let Some(frame_session_id) = map.get("sessionId").and_then(Value::as_i64) else {
            return Err(malformed("params.sessionId is not an integer"));
        };
        let Some(Value::String(data_base64)) = map.remove("data") else {
            return Err(malformed("params.data is not a string"));
        };
        let Some(metadata @ Value::Object(_)) = map.remove("metadata") else {
            return Err(malformed("params.metadata is not an object"));
        };
        for key in SCREENCAST_METADATA_NUMBERS {
            if !metadata
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
            {
                return Err(malformed(&format!(
                    "params.metadata.{key} is not a finite number"
                )));
            }
        }
        let native_capture_time_unix_ms = parse_native_capture_time_unix_ms(&metadata);
        // Retain only the supported numeric members: an arbitrary extra member would otherwise
        // keep up to a whole WebSocket message alive under the fixed per-frame overhead. The
        // capture timestamp was read above, so it is not retained.
        let metadata = {
            let mut kept = serde_json::Map::with_capacity(SCREENCAST_METADATA_NUMBERS.len());
            for key in SCREENCAST_METADATA_NUMBERS {
                if let Some(value) = metadata.get(key) {
                    kept.insert(key.to_string(), value.clone());
                }
            }
            Value::Object(kept)
        };
        let received_at = std::time::Instant::now();
        let server_received_unix_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
        // Charge the retained payload before publishing it; the transient parse buffer is bounded
        // by the WebSocket message cap. Over budget: drop the payload now, keep the ACK identity.
        let retained = data_base64.len() + session_id.len() + SCREENCAST_FRAME_OVERHEAD_BYTES;
        let (data_base64, reservation) = match self.memory_controller.try_reserve(retained) {
            Ok(reservation) => (data_base64, Some(reservation)),
            Err(_) => (String::new(), None),
        };
        let frame = Arc::new(ScreencastFrameData {
            session_id,
            frame_session_id,
            data_base64,
            metadata,
            native_capture_time_unix_ms,
            received_at,
            server_received_unix_ms,
            memory_admitted: reservation.is_some(),
            _reservation: reservation,
        });
        self.stats
            .screencast_frames_received
            .fetch_add(1, Ordering::Relaxed);
        let _ = self.screencast_tx.send(frame);
        Ok(())
    }

    /// Bounded write that also yields to `close()`; never waits past WRITE_DEADLINE. While a
    /// write is stalled (<= WRITE_DEADLINE) the single actor task does not read or sweep; callers
    /// keep their own command deadlines, so they are never held past them. Independent
    /// read-during-write is NOT provided.
    async fn write_message(&mut self, msg: Message) -> WriteOutcome {
        tokio::select! {
            res = tokio::time::timeout(WRITE_DEADLINE, self.ws_stream.send(msg)) => match res {
                Ok(Ok(())) => WriteOutcome::Done,
                Ok(Err(e)) => WriteOutcome::Failed(CdpError::Transport(e.to_string())),
                Err(_) => WriteOutcome::Failed(CdpError::Transport(
                    "WebSocket write deadline exceeded (5s)".to_string(),
                )),
            },
            _ = self.close_notify.notified() => WriteOutcome::Closed,
        }
    }

    /// Fail every pending owner with `err`, optionally attempt a bounded WS close.
    async fn shutdown(&mut self, err: CdpError, close_ws: bool) {
        // Disconnecting Fetch releases its native interception. Transfer containment before
        // closing the transport; the obligation must outlive every page/producer.
        if let Some(installed) = self.request_policy.write().unwrap_or_else(|e| e.into_inner()).take() {
            (installed.escalate)("browser request-policy transport closed");
        }
        self.fail_all(err);
        if close_ws {
            let _ = tokio::time::timeout(WRITE_DEADLINE, self.ws_stream.close()).await;
        }
    }

    /// Fail in-flight owners and every command still queued for the writer, and refuse new
    /// submissions, so no caller waits on the (bounded) WS close or its own deadline.
    fn fail_all(&mut self, err: CdpError) {
        // A policy-command rejection can terminate the actor without answering any of the
        // unrelated commands already written to Chromium. Their outcomes are ambiguous.
        let pending_error = match &err {
            CdpError::Protocol { .. } => {
                CdpError::Transport(format!("CDP actor terminated after {err}"))
            }
            _ => err.clone(),
        };
        self.command_rx.close();
        while let Ok(ActorMessage::SendCommand { id, sender, nav_meta, .. }) = self.command_rx.try_recv() {
            if let Some((ref sid, m)) = nav_meta {
                notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
            }
            let _ = sender.send(Err(err.clone()));
        }
        for (id, req) in self.pending_commands.drain() {
            if let Some((ref sid, m)) = req.nav_meta {
                notify_nav_response(&self.nav_listeners, sid.as_deref(), id, m, None, true);
            }
            let _ = req.sender.send(Err(pending_error.clone()));
        }
    }
}

/// Typed validation of a routed command response.
fn response_outcome(result: Option<Value>, error: Option<Value>) -> Result<Value, CdpError> {
    match (result, error) {
        (None, Some(err @ Value::Object(_))) => match serde_json::from_value::<CdpErrorWire>(err) {
            Ok(e) => Err(CdpError::Protocol {
                code: e.code,
                message: e.message,
            }),
            Err(e) => Err(CdpError::MalformedResponse(format!(
                "invalid error envelope: {e}"
            ))),
        },
        (None, Some(_)) => Err(CdpError::MalformedResponse(
            "error is not an object".to_string(),
        )),
        (Some(res @ Value::Object(_)), None) => Ok(res),
        (Some(_), None) => Err(CdpError::MalformedResponse(
            "result is not an object".to_string(),
        )),
        (Some(_), Some(_)) => Err(CdpError::MalformedResponse(
            "response carries both result and error".to_string(),
        )),
        (None, None) => Err(CdpError::MalformedResponse(
            "response missing both result and error".to_string(),
        )),
    }
}

/// Replaces unpaired UTF-16 surrogates (`\uD800`..`\uDFFF`) and truncated `\u` hex escapes
/// inside JSON string literals (which Chromium's `Fetch.requestPaused` emits when serializing
/// or truncating binary/WTF-16 `postData`) with `\ufffd` so `serde_json` can parse the frame.
fn sanitize_cdp_json_escapes(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len() + 16);
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if !in_string {
            if b == b'"' {
                in_string = true;
            }
            let ch = text[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        if b == b'"' {
            in_string = false;
            out.push('"');
            i += 1;
            continue;
        }
        if b != b'\\' {
            let ch = text[i..].chars().next().unwrap();
            if (ch as u32) < 0x20 {
                out.push_str("\\ufffd");
            } else {
                out.push(ch);
            }
            i += ch.len_utf8();
            continue;
        }
        if i + 1 >= bytes.len() {
            out.push_str("\\\\");
            break;
        }
        match bytes[i + 1] {
            b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => {
                out.push('\\');
                out.push(bytes[i + 1] as char);
                i += 2;
            }
            b'u' => {
                let mut hex_len = 0;
                while hex_len < 4
                    && i + 2 + hex_len < bytes.len()
                    && bytes[i + 2 + hex_len].is_ascii_hexdigit()
                {
                    hex_len += 1;
                }
                if hex_len < 4 {
                    out.push_str("\\ufffd");
                    i += 2 + hex_len;
                    continue;
                }
                let code = u16::from_str_radix(&text[i + 2..i + 6], 16).unwrap_or(0xFFFD);
                if (0xD800..=0xDBFF).contains(&code) {
                    let valid_low = if i + 12 <= bytes.len()
                        && bytes[i + 6] == b'\\'
                        && bytes[i + 7] == b'u'
                        && bytes[i + 8..i + 12].iter().all(u8::is_ascii_hexdigit)
                    {
                        u16::from_str_radix(&text[i + 8..i + 12], 16)
                            .ok()
                            .filter(|low| (0xDC00..=0xDFFF).contains(low))
                    } else {
                        None
                    };
                    if valid_low.is_some() {
                        out.push_str(&text[i..i + 12]);
                        i += 12;
                    } else {
                        out.push_str("\\ufffd");
                        i += 6;
                    }
                } else if (0xDC00..=0xDFFF).contains(&code) {
                    out.push_str("\\ufffd");
                    i += 6;
                } else {
                    out.push_str(&text[i..i + 6]);
                    i += 6;
                }
            }
            _ => {
                out.push_str("\\ufffd");
                i += 2;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{Sink, Stream};
    use std::pin::Pin;
    use std::sync::atomic::AtomicBool;
    use std::task::{Context, Poll};
    struct MockChannelWs {
        tx: mpsc::Sender<Message>,
        rx: mpsc::Receiver<Result<Message, tokio_tungstenite::tungstenite::Error>>,
    }

    impl Stream for MockChannelWs {
        type Item = Result<Message, tokio_tungstenite::tungstenite::Error>;
        fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            self.rx.poll_recv(cx)
        }
    }

    impl Sink<Message> for MockChannelWs {
        type Error = tokio_tungstenite::tungstenite::Error;
        fn poll_ready(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn start_send(self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
            let _ = self.tx.try_send(item);
            Ok(())
        }
        fn poll_flush(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn poll_close(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn test_actor_skips_cancelled_command_on_dequeue() {
        let (command_tx, command_rx) = mpsc::channel(MAX_WRITER_QUEUE_MESSAGES);
        let (screencast_tx, _) = tokio::sync::broadcast::channel(2);
        let stats = Arc::new(CdpActorStats::default());
        // Two slots: both commands hold one until the actor dequeues them.
        let budget = CommandBudget::new(2, MAX_WRITER_QUEUE_BYTES);

        let (sent_tx, mut sent_rx) = mpsc::channel::<Message>(10);
        let (_in_tx, in_rx) = mpsc::channel(10);
        let ws_stream = MockChannelWs {
            tx: sent_tx,
            rx: in_rx,
        };

        // 1. Enqueue a command whose caller dropped the receiver (caller cancelled)
        let (sender1, receiver1) = oneshot::channel();
        drop(receiver1); // caller abandoned
        command_tx
            .send(ActorMessage::SendCommand {
                id: 1,
                json: r#"{"id":1,"method":"Test.abandoned"}"#.to_string(),
                reservation: budget.reserve_slot().unwrap(),
                sender: sender1,
                deadline: Instant::now() + Duration::from_secs(10),
                nav_meta: None,
                cancellation: None,
            })
            .await
            .unwrap();

        // 2. Enqueue a valid command whose caller is listening
        let (sender2, _receiver2) = oneshot::channel();
        command_tx
            .send(ActorMessage::SendCommand {
                id: 2,
                json: r#"{"id":2,"method":"Test.valid"}"#.to_string(),
                reservation: budget.reserve_slot().unwrap(),
                sender: sender2,
                deadline: Instant::now() + Duration::from_secs(10),
                nav_meta: None,
                cancellation: None,
            })
            .await
            .unwrap();

        // 3. Spawn actor
        let (event_tx, _) = tokio::sync::broadcast::channel(8);
        let actor = CdpActor {
            ws_stream,
            command_rx,
            close_notify: Arc::new(Notify::new()),
            screencast_tx,
            event_tx,
            request_policy: Arc::new(std::sync::RwLock::new(None)),
            policy_write: None,
            next_policy_id: FIRST_POLICY_COMMAND_ID,
            nav_listeners: Arc::new(std::sync::Mutex::new(Vec::new())),
            target_tx: tokio::sync::broadcast::channel(8).0,
            pending_commands: HashMap::with_capacity(MAX_PENDING_COMMANDS),
            memory_controller: global_memory_controller().clone(),
            stats,
        };
        tokio::spawn(actor.run());

        // 4. Verify: Test.abandoned is skipped; the ONLY message sent to WebSocket is Test.valid
        let msg = tokio::time::timeout(Duration::from_millis(500), sent_rx.recv())
            .await
            .expect("timed out waiting for message")
            .expect("channel closed");

        let text = match msg {
            Message::Text(t) => t,
            _ => panic!("expected text message"),
        };
        assert!(
            text.contains("Test.valid"),
            "expected Test.valid, got: {text}"
        );
        assert!(
            !text.contains("Test.abandoned"),
            "Test.abandoned should have been skipped!"
        );

        // The skipped command's reservation is released on dequeue; only the in-flight one remains.
        assert!(
            budget.reserve_slot().is_ok(),
            "cancelled command leaked its slot"
        );
    }

    /// Sink whose writes never complete, modelling a stalled peer/writer. `entered` is
    /// notified when the actor first blocks in a write.
    struct StalledWs {
        entered: Arc<Notify>,
    }

    impl Stream for StalledWs {
        type Item = Result<Message, tokio_tungstenite::tungstenite::Error>;
        fn poll_next(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            Poll::Pending
        }
    }

    impl Sink<Message> for StalledWs {
        type Error = tokio_tungstenite::tungstenite::Error;
        fn poll_ready(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            self.entered.notify_one();
            Poll::Pending
        }
        fn start_send(self: Pin<&mut Self>, _item: Message) -> Result<(), Self::Error> {
            Ok(())
        }
        fn poll_flush(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Pending
        }
        fn poll_close(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Pending
        }
    }

    /// Poll `cond` until true or 2s of (virtual or real) time elapse.
    async fn eventually(mut cond: impl FnMut() -> bool) {
        for _ in 0..2000 {
            if cond() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("condition not met within 2s");
    }

    #[tokio::test]
    async fn closed_waits_for_transport_drop_not_just_command_queue_closure() {
        let client = CdpClient::from_ws_stream(StalledWs {
            entered: Arc::new(Notify::new()),
        });
        client.close().await;
        eventually(|| client.is_closed()).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), client.closed()).await.is_err(),
            "a stalled websocket close has not dropped the transport"
        );
        tokio::time::timeout(Duration::from_secs(6), client.closed())
            .await
            .expect("bounded websocket close eventually drops the transport");
    }

    #[tokio::test]
    async fn test_stalled_writer_saturation_then_close_releases_everything() {
        let entered = Arc::new(Notify::new());
        let client = CdpClient::from_ws_stream(StalledWs {
            entered: entered.clone(),
        });

        // The first command enters the actor's write and stalls there.
        let first = {
            let c = client.clone();
            tokio::spawn(async move { c.send_command("Test.first", None, None).await })
        };
        tokio::time::timeout(Duration::from_secs(1), entered.notified())
            .await
            .expect("actor never entered the stalled write");

        // With the writer stalled and the queue empty, 100 more callers: exactly the queue capacity
        // is admitted; every other caller fails immediately without waiting or retaining JSON.
        let mut handles = Vec::new();
        for _ in 0..100 {
            let c = client.clone();
            handles.push(tokio::spawn(async move {
                c.send_command("Test.stalled", None, None).await
            }));
        }
        let rejected_expected = 100 - MAX_WRITER_QUEUE_MESSAGES;
        eventually(|| handles.iter().filter(|h| h.is_finished()).count() == rejected_expected)
            .await;
        assert!(
            !first.is_finished(),
            "in-flight stalled write must still be pending"
        );
        let in_use = client.budget.bytes_in_use();
        assert!(
            in_use > 0 && in_use <= (MAX_WRITER_QUEUE_MESSAGES + 1) * 64,
            "reserved bytes {in_use}"
        );

        // close() must cancel the stalled write and release every queued + in-flight reservation.
        client.close().await;
        let first_res = tokio::time::timeout(Duration::from_secs(1), first)
            .await
            .expect("first hung")
            .unwrap();
        assert_eq!(first_res, Err(CdpError::ConnectionClosed));
        for h in handles {
            let res = tokio::time::timeout(Duration::from_secs(1), h)
                .await
                .expect("caller hung")
                .unwrap();
            assert!(
                matches!(
                    res,
                    Err(CdpError::WriterQueueFull { .. }) | Err(CdpError::ConnectionClosed)
                ),
                "unexpected result {res:?}"
            );
        }
        eventually(|| client.budget.bytes_in_use() == 0).await;
        assert_all_slots_reusable(&client);
    }

    #[tokio::test]
    async fn test_oversized_command_rejected_before_budget_is_retained() {
        let client = CdpClient::from_ws_stream(StalledWs {
            entered: Arc::new(Notify::new()),
        });
        let big = serde_json::json!({ "payload": "x".repeat(MAX_COMMAND_BYTES + 100) });
        let res = client.send_command("Test.large", Some(big), None).await;
        assert!(matches!(res, Err(CdpError::CommandTooLarge { .. })));
        // The failed attempt released everything it reserved while serializing.
        assert_eq!(client.budget.bytes_in_use(), 0);
        assert_all_slots_reusable(&client);
    }

    fn mock_client() -> (
        Arc<CdpClient>,
        mpsc::Receiver<Message>,
        mpsc::Sender<Result<Message, tokio_tungstenite::tungstenite::Error>>,
    ) {
        let (sent_tx, sent_rx) = mpsc::channel::<Message>(MAX_PENDING_COMMANDS);
        let (in_tx, in_rx) = mpsc::channel(8);
        (
            CdpClient::from_ws_stream(MockChannelWs {
                tx: sent_tx,
                rx: in_rx,
            }),
            sent_rx,
            in_tx,
        )
    }

    #[tokio::test(start_paused = true)]
    async fn test_reservation_released_after_deadline_expiry() {
        let (client, mut sent_rx, _in_tx) = mock_client();
        let res = client.send_command("Test.never_answered", None, None).await;
        assert_eq!(res, Err(CdpError::CommandTimeout));
        assert!(
            sent_rx.recv().await.is_some(),
            "command must have been written"
        );
        // The deadline sweep, not the response path, frees the slot and bytes.
        eventually(|| client.budget.bytes_in_use() == 0).await;
        assert_all_slots_reusable(&client);
    }

    #[tokio::test(start_paused = true)]
    async fn test_reservation_released_after_caller_cancellation() {
        let (client, mut sent_rx, _in_tx) = mock_client();
        let caller = {
            let c = client.clone();
            tokio::spawn(async move { c.send_command("Test.cancelled", None, None).await })
        };
        assert!(
            sent_rx.recv().await.is_some(),
            "command must be in flight before cancelling"
        );
        assert!(client.budget.bytes_in_use() > 0);
        caller.abort();
        eventually(|| client.budget.bytes_in_use() == 0).await;
        assert_all_slots_reusable(&client);
    }

    #[tokio::test(start_paused = true)]
    async fn test_reservation_released_on_connection_teardown() {
        let (client, mut sent_rx, in_tx) = mock_client();
        let caller = {
            let c = client.clone();
            tokio::spawn(async move { c.send_command("Test.torn_down", None, None).await })
        };
        assert!(sent_rx.recv().await.is_some());
        drop(in_tx); // peer closes: stream ends
        assert_eq!(caller.await.unwrap(), Err(CdpError::ConnectionClosed));
        eventually(|| client.budget.bytes_in_use() == 0).await;
        assert_all_slots_reusable(&client);
    }

    fn assert_all_slots_reusable(client: &CdpClient) {
        let mut slots = Vec::new();
        for _ in 0..MAX_PENDING_COMMANDS {
            slots.push(
                client
                    .budget
                    .reserve_slot()
                    .expect("all 64 slots must be reusable"),
            );
        }
        assert!(matches!(
            client.budget.reserve_slot(),
            Err(CdpError::TooManyPendingCommands {
                current: 64,
                max: 64
            })
        ));
        let per_slot_bytes = 2_097_152 / MAX_PENDING_COMMANDS;
        for s in slots.iter_mut() {
            s.grow(per_slot_bytes)
                .expect("budget bytes must be reusable");
        }
        assert_eq!(
            client.budget.bytes_in_use(),
            per_slot_bytes * MAX_PENDING_COMMANDS
        );
        drop(slots);
        assert_eq!(client.budget.bytes_in_use(), 0);
    }

    #[tokio::test]
    async fn test_slot_saturation_never_invokes_serializer() {
        let client = CdpClient::from_ws_stream(StalledWs {
            entered: Arc::new(Notify::new()),
        });
        let mut reservations = Vec::new();
        for _ in 0..MAX_PENDING_COMMANDS {
            reservations.push(
                client
                    .budget
                    .reserve_slot()
                    .expect("slot reserve should succeed"),
            );
        }
        assert!(matches!(
            client.budget.reserve_slot(),
            Err(CdpError::TooManyPendingCommands {
                current: 64,
                max: 64
            })
        ));

        let invoked = Arc::new(AtomicBool::new(false));
        struct SpySerialize(Arc<AtomicBool>);
        impl Serialize for SpySerialize {
            fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
                self.0.store(true, Ordering::SeqCst);
                Err(serde::ser::Error::custom("should never be serialized"))
            }
        }

        let res = client
            .dispatch("Test.probe", Some(&SpySerialize(invoked.clone())), None, None, None)
            .await;
        assert!(matches!(
            res,
            Err(CdpError::TooManyPendingCommands {
                current: 64,
                max: 64
            })
        ));
        assert!(
            !invoked.load(Ordering::SeqCst),
            "custom serializer must never be invoked at slot saturation"
        );
        drop(reservations);
        assert_all_slots_reusable(&client);
    }

    #[tokio::test]
    async fn test_successful_response_makes_all_slots_and_bytes_reusable() {
        let (client, mut sent_rx, in_tx) = mock_client();
        let cmd_task = {
            let c = client.clone();
            tokio::spawn(async move {
                c.send_command(
                    "Test.successful",
                    Some(serde_json::json!({ "arg": "val" })),
                    None,
                )
                .await
            })
        };
        let sent_msg = sent_rx.recv().await.expect("command should reach writer");
        let wire: serde_json::Value = match sent_msg {
            Message::Text(t) => serde_json::from_str(&t).expect("valid json wire"),
            _ => panic!("expected text message"),
        };
        let id = wire["id"].as_i64().expect("command id");

        let response = serde_json::json!({
            "id": id,
            "result": { "status": "ok" }
        });
        in_tx
            .send(Ok(Message::Text(response.to_string().into())))
            .await
            .expect("send response");

        let res = cmd_task.await.unwrap().expect("command should succeed");
        assert_eq!(res["status"], "ok");

        eventually(|| client.budget.bytes_in_use() == 0).await;
        assert_all_slots_reusable(&client);
    }

    #[tokio::test]
    async fn test_lifecycle_events_project_bounded_fields_and_overflow_on_budget_exhaustion() {
        use super::super::diagnostics::MemoryAdmissionController;

        let controller = MemoryAdmissionController::new(256);
        let (in_tx, in_rx) = mpsc::channel(16);
        let (sent_tx, _sent_rx) = mpsc::channel(16);
        let client = CdpClient::from_ws_stream_with_memory_controller(
            MockChannelWs {
                tx: sent_tx,
                rx: in_rx,
            },
            controller.clone(),
        );
        let mut rx = client.subscribe_events();

        // Send a huge 100 KiB arbitrary payload alongside Page.frameNavigated
        let huge_blob = "x".repeat(100 * 1024);
        let evt_msg = serde_json::json!({
            "method": "Page.frameNavigated",
            "sessionId": "psid-1",
            "params": {
                "frame": { "url": "https://example.test/next" },
                "unusedHugePayload": huge_blob
            }
        });
        in_tx
            .send(Ok(Message::Text(evt_msg.to_string().into())))
            .await
            .unwrap();

        let evt = rx.recv().await.unwrap();
        match &*evt {
            CdpLifecycleEvent::FrameNavigated {
                session_id,
                is_main_frame,
                url,
                ..
            } => {
                assert_eq!(session_id.as_deref(), Some("psid-1"));
                assert!(*is_main_frame);
                assert_eq!(url.as_deref(), Some("https://example.test/next"));
            }
            other => panic!("unexpected projected event: {other:?}"),
        }
        // Retained reservation only accounts for small projected fields, never the 100 KiB blob
        let retained = controller.current_reserved_bytes();
        assert!(
            retained > 0 && retained <= 256,
            "unexpected retained bytes: {retained}"
        );

        // Fill remaining budget and verify subsequent event emits Overflow fail-closed
        let hold = controller.try_reserve(256 - retained).unwrap();
        let evt_msg2 = serde_json::json!({
            "method": "Page.navigatedWithinDocument",
            "sessionId": "psid-1",
            "params": { "url": "https://example.test/spa" }
        });
        in_tx
            .send(Ok(Message::Text(evt_msg2.to_string().into())))
            .await
            .unwrap();

        let overflow_evt = rx.recv().await.unwrap();
        assert!(matches!(&*overflow_evt, CdpLifecycleEvent::Overflow));

        drop(hold);
        drop(evt);
        drop(overflow_evt);
        // Force ring slot drop by clearing broadcast channel on client close
        client.close().await;
        eventually(|| controller.current_reserved_bytes() == 0).await;
    }

    fn screencast_frame_msg(data: &str, id: i64) -> Message {
        Message::Text(
            serde_json::json!({
                "method": "Page.screencastFrame",
                "sessionId": "page-1",
                "params": {
                    "data": data,
                    "sessionId": id,
                    "metadata": {
                        "offsetTop": 0, "pageScaleFactor": 1.0, "deviceWidth": 1280,
                        "deviceHeight": 720, "scrollOffsetX": 0, "scrollOffsetY": 0
                    }
                }
            })
            .to_string()
            .into(),
        )
    }

    #[tokio::test]
    async fn test_screencast_ingress_is_charged_until_last_holder_and_over_budget_keeps_ack_identity() {
        use super::super::diagnostics::MemoryAdmissionController;

        let controller = MemoryAdmissionController::new(16 * 1024);
        let (in_tx, in_rx) = mpsc::channel(16);
        let (sent_tx, _sent_rx) = mpsc::channel(16);
        let client = CdpClient::from_ws_stream_with_memory_controller(
            MockChannelWs { tx: sent_tx, rx: in_rx },
            controller.clone(),
        );
        let mut rx = client.subscribe_screencast();

        // Admitted: the payload is charged for as long as any clone of the frame lives.
        let payload = "A".repeat(4000);
        in_tx.send(Ok(screencast_frame_msg(&payload, 1))).await.unwrap();
        let admitted = rx.recv().await.unwrap();
        assert!(admitted.memory_admitted);
        assert_eq!(admitted.data_base64.len(), 4000);
        assert!(controller.current_reserved_bytes() >= 4000);
        let second_holder = admitted.clone();
        drop(admitted);
        assert!(controller.current_reserved_bytes() >= 4000, "a remaining holder keeps the charge");
        drop(second_holder);
        // Last holder gone (the broadcast slot is released once its only receiver read it).
        eventually(|| controller.current_reserved_bytes() == 0).await;

        // Over budget: payload dropped immediately, identity kept so the ACK can still be sent.
        let hold = controller.try_reserve(16 * 1024 - 512).unwrap();
        in_tx.send(Ok(screencast_frame_msg(&payload, 7))).await.unwrap();
        let refused = rx.recv().await.unwrap();
        assert!(!refused.memory_admitted);
        assert!(refused.data_base64.is_empty());
        assert_eq!(refused.frame_session_id, 7);
        assert_eq!(refused.session_id, "page-1");
        assert!(!client.is_closed(), "memory pressure must not close the actor");
        drop(hold);
    }

    #[tokio::test]
    async fn test_screencast_retains_only_supported_metadata_and_keeps_capture_time() {
        use super::super::diagnostics::MemoryAdmissionController;

        let controller = MemoryAdmissionController::new(1024 * 1024);
        let (in_tx, in_rx) = mpsc::channel(16);
        let (sent_tx, _sent_rx) = mpsc::channel(16);
        let client = CdpClient::from_ws_stream_with_memory_controller(
            MockChannelWs { tx: sent_tx, rx: in_rx },
            controller,
        );
        let mut rx = client.subscribe_screencast();
        let msg = serde_json::json!({
            "method": "Page.screencastFrame",
            "sessionId": "page-1",
            "params": {
                "data": "AAAA",
                "sessionId": 3,
                "metadata": {
                    "offsetTop": 0, "pageScaleFactor": 1.0, "deviceWidth": 1280,
                    "deviceHeight": 720, "scrollOffsetX": 0, "scrollOffsetY": 0,
                    "timestamp": 1_700_000_000.5,
                    "unexpectedHugeMember": "x".repeat(100 * 1024)
                }
            }
        });
        in_tx.send(Ok(Message::Text(msg.to_string().into()))).await.unwrap();
        let frame = rx.recv().await.unwrap();

        let kept = frame.metadata.as_object().expect("metadata object");
        assert_eq!(kept.len(), SCREENCAST_METADATA_NUMBERS.len());
        assert!(kept.get("unexpectedHugeMember").is_none());
        assert_eq!(frame.native_capture_time_unix_ms, Some(1_700_000_000_500));
    }

    #[tokio::test]
    async fn test_failed_growth_of_an_already_charged_command_reservation_leaks_nothing() {
        use super::super::diagnostics::MemoryAdmissionController;

        let controller = MemoryAdmissionController::new(100);
        let budget = CommandBudget::with_memory(4, 1000, controller.clone());
        let mut held = budget.reserve_slot().unwrap();
        held.grow(80).unwrap();
        let mut other = budget.reserve_slot().unwrap();
        other.grow(10).unwrap();

        // `held` already owns a global reservation; growing it past the ceiling must fail cleanly.
        assert!(held.grow(20).is_err());
        assert_eq!(controller.current_reserved_bytes(), 90);
        assert_eq!(budget.bytes_in_use(), 90);
        assert_eq!(held.reserved_bytes(), 80);

        drop(held);
        drop(other);
        assert_eq!(controller.current_reserved_bytes(), 0);
        assert_eq!(budget.bytes_in_use(), 0);
    }

    #[tokio::test]
    async fn test_command_bytes_are_charged_globally_and_failed_growth_leaks_nothing() {
        use super::super::diagnostics::MemoryAdmissionController;

        let controller = MemoryAdmissionController::new(100);
        let budget = CommandBudget::with_memory(4, 1000, controller.clone());
        let mut a = budget.reserve_slot().unwrap();
        let mut b = budget.reserve_slot().unwrap();

        a.grow(60).unwrap();
        assert_eq!(controller.current_reserved_bytes(), 60);
        a.grow(10).unwrap();
        assert_eq!(controller.current_reserved_bytes(), 70);

        // Local budget would allow it; the global ceiling refuses and nothing leaks.
        assert!(b.grow(40).is_err());
        assert_eq!(controller.current_reserved_bytes(), 70);
        assert_eq!(budget.bytes_in_use(), 70);
        b.grow(30).unwrap();
        assert_eq!(controller.current_reserved_bytes(), 100);

        drop(a);
        assert_eq!(controller.current_reserved_bytes(), 30);
        drop(b);
        assert_eq!(controller.current_reserved_bytes(), 0);
        assert_eq!(budget.bytes_in_use(), 0);
    }

    #[tokio::test]
    async fn test_request_paused_with_lone_surrogate_and_truncated_hex_escapes_in_post_data_stays_alive() {
        use crate::browser_host::config::BrowserHostConfig;
        use crate::browser_host::network_policy::NetworkPolicy;

        let controller = MemoryAdmissionController::new(64 * 1024);
        let (in_tx, in_rx) = mpsc::channel(16);
        let (out_tx, mut out_rx) = mpsc::channel(16);
        let client = CdpClient::from_ws_stream_with_memory_controller(
            MockChannelWs {
                tx: out_tx,
                rx: in_rx,
            },
            controller,
        );
        let policy = Arc::new(NetworkPolicy::from_config(&BrowserHostConfig::default(), false).unwrap());
        let escalated = Arc::new(AtomicBool::new(false));
        let esc_clone = escalated.clone();

        let install_fut = client.install_browser_request_policy(
            policy,
            Arc::new(move |_| {
                esc_clone.store(true, Ordering::SeqCst);
            }),
        );
        let reply_fut = async {
            let Message::Text(cmd) = out_rx.recv().await.unwrap() else {
                panic!("expected Fetch.enable");
            };
            let parsed: Value = serde_json::from_str(&cmd).unwrap();
            assert_eq!(parsed["method"], "Fetch.enable");
            in_tx
                .send(Ok(Message::Text(
                    serde_json::json!({ "id": parsed["id"], "result": {} })
                        .to_string()
                        .into(),
                )))
                .await
                .unwrap();
        };
        tokio::join!(install_fut, reply_fut).0.unwrap();

        for (req_id, raw_frame) in [
            (
                "post-lone-surrogate",
                r#"{"method":"Fetch.requestPaused","params":{"requestId":"post-lone-surrogate","request":{"url":"https://accounts.google.com/v3/signin","headers":{"User-Agent":"Mozilla/5.0 Chrome/140.0.0.0"},"postData":"binary\uD800payload\uDC00end"},"resourceType":"Fetch"}}"#,
            ),
            (
                "post-truncated-hex",
                r#"{"method":"Fetch.requestPaused","params":{"requestId":"post-truncated-hex","request":{"url":"https://challenges.cloudflare.com/turnstile","headers":{"User-Agent":"Mozilla/5.0 Chrome/140.0.0.0"},"postData":"truncated\u00"},"resourceType":"Ping"}}"#,
            ),
            (
                "post-surrogate-newline",
                r#"{"method":"Fetch.requestPaused","params":{"requestId":"post-surrogate-newline","request":{"url":"https://example.com/log","headers":{"User-Agent":"Mozilla/5.0 Chrome/140.0.0.0"},"postData":"lead\uD83D\ntrail"},"resourceType":"XHR"}}"#,
            ),
        ] {
            in_tx
                .send(Ok(Message::Text(raw_frame.to_string().into())))
                .await
                .unwrap();
            let Message::Text(decision_txt) = out_rx.recv().await.unwrap() else {
                panic!("expected Fetch.continueRequest");
            };
            let decision: Value = serde_json::from_str(&decision_txt).unwrap();
            assert_eq!(decision["method"], "Fetch.continueRequest");
            assert_eq!(decision["params"]["requestId"], req_id);
        }
        assert!(!client.is_closed());
        assert!(!escalated.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn policy_rejection_does_not_claim_pending_command_was_rejected() {
        use crate::browser_host::config::BrowserHostConfig;
        use crate::browser_host::network_policy::NetworkPolicy;

        let (in_tx, in_rx) = mpsc::channel(16);
        let (out_tx, mut out_rx) = mpsc::channel(16);
        let client = CdpClient::from_ws_stream_with_memory_controller(
            MockChannelWs { tx: out_tx, rx: in_rx },
            MemoryAdmissionController::new(64 * 1024),
        );
        let policy = Arc::new(NetworkPolicy::from_config(&BrowserHostConfig::default(), false).unwrap());
        let install = client.install_browser_request_policy(policy, Arc::new(|_| {}));
        let reply = async {
            let Message::Text(command) = out_rx.recv().await.unwrap() else { panic!("expected Fetch.enable") };
            let command: Value = serde_json::from_str(&command).unwrap();
            in_tx.send(Ok(Message::Text(serde_json::json!({"id": command["id"], "result": {}}).to_string().into()))).await.unwrap();
        };
        tokio::join!(install, reply).0.unwrap();

        let rejected_client = client.clone();
        let rejected = tokio::spawn(async move {
            rejected_client.send_command("Page.stopScreencast", None, None).await
        });
        let Message::Text(command) = out_rx.recv().await.unwrap() else { panic!("expected stop command") };
        let command: Value = serde_json::from_str(&command).unwrap();
        in_tx.send(Ok(Message::Text(serde_json::json!({
            "id": command["id"], "error": {"code": -32603, "message": "stop rejected"}
        }).to_string().into()))).await.unwrap();
        let error = tokio::time::timeout(Duration::from_secs(2), rejected).await.unwrap().unwrap().unwrap_err();
        assert!(!error.outcome_is_ambiguous(), "owned rejection must remain definite: {error:?}");

        let pending_client = client.clone();
        let pending = tokio::spawn(async move {
            pending_client.send_command("Page.stopScreencast", None, None).await
        });
        let Message::Text(command) = out_rx.recv().await.unwrap() else { panic!("expected stop command") };
        let command: Value = serde_json::from_str(&command).unwrap();
        assert_eq!(command["method"], "Page.stopScreencast");
        in_tx.send(Ok(Message::Text(serde_json::json!({
            "method": "Fetch.requestPaused",
            "params": {"requestId": "request", "request": {"url": "https://example.com"}, "resourceType": "Document"}
        }).to_string().into()))).await.unwrap();
        let Message::Text(decision) = out_rx.recv().await.unwrap() else { panic!("expected policy decision") };
        let decision: Value = serde_json::from_str(&decision).unwrap();
        in_tx.send(Ok(Message::Text(serde_json::json!({
            "id": decision["id"], "error": {"code": -32603, "message": "policy failed"}
        }).to_string().into()))).await.unwrap();
        let error = tokio::time::timeout(Duration::from_secs(2), pending).await.unwrap().unwrap().unwrap_err();
        assert!(error.outcome_is_ambiguous(), "unanswered stop must be ambiguous: {error:?}");
    }
}

#[cfg(test)]
mod outcome_classification_tests {
    use super::CdpError;

    #[tokio::test]
    async fn cancelled_unwritten_command_stays_definite_after_deadline() {
        let cancellation = super::InputCommandCancellation::new();
        let (_sender, receiver) = tokio::sync::oneshot::channel();
        let pending = super::PendingCommand {
            receiver,
            deadline: tokio::time::Instant::now(),
            cancellation: Some(cancellation.clone()),
        };
        assert!(cancellation.cancel_before_write());
        assert!(matches!(pending.wait().await, Err(CdpError::CancelledBeforeWrite)));
    }

    #[test]
    fn only_pre_send_rejections_and_browser_errors_prove_the_command_did_not_execute() {
        let definite = [
            CdpError::CancelledBeforeWrite,
            CdpError::TooManyPendingCommands { current: 64, max: 64 },
            CdpError::WriterQueueFull { messages: 1, bytes: 1 },
            CdpError::CommandTooLarge { size: 2, max: 1 },
            CdpError::Protocol { code: -32000, message: "rejected".into() },
        ];
        for error in definite {
            assert!(!error.outcome_is_ambiguous(), "{error:?} proves the command did not execute");
        }
        let ambiguous = [
            CdpError::CommandTimeout,
            CdpError::MessageTooLarge { size: 2, max: 1 },
            CdpError::ConnectionClosed,
            CdpError::MalformedResponse("x".into()),
            CdpError::Deserialization("x".into()),
            CdpError::Transport("x".into()),
        ];
        for error in ambiguous {
            assert!(error.outcome_is_ambiguous(), "{error:?} may have executed");
        }
    }
}
