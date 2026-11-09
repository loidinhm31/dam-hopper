use std::collections::HashMap;
use std::fmt;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
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
use super::network_policy::MAX_URL_BYTES;
use super::protocol::{
    COMMAND_TIMEOUT_SECS, MAX_COMMAND_BYTES, MAX_PENDING_COMMANDS, MAX_WRITER_QUEUE_BYTES,
    MAX_WRITER_QUEUE_MESSAGES, MAX_WS_MESSAGE_BYTES,
};

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
/// Result of a bounded, close-cancellable WebSocket write.
enum WriteOutcome {
    Done,
    Failed(CdpError),
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpError {
    CommandTimeout,
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

impl fmt::Display for CdpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandTimeout => {
                write!(f, "CDP command timed out after {COMMAND_TIMEOUT_SECS}s")
            }
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
struct CdpRequestWire<'a, P: Serialize> {
    id: usize,
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

#[derive(Debug)]
pub struct ScreencastFrameData {
    pub session_id: String,
    pub frame_session_id: i64,
    pub data_base64: String,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub enum CdpLifecycleEvent {
    FrameNavigated {
        session_id: Option<String>,
        is_main_frame: bool,
        url: Option<String>,
        _reservation: Option<Arc<MemoryReservation>>,
    },
    NavigatedWithinDocument {
        session_id: Option<String>,
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

struct PendingRequest {
    sender: oneshot::Sender<Result<Value, CdpError>>,
    deadline: Instant,
    /// Keeps the command slot and payload bytes reserved until the request leaves the map.
    _reservation: CommandReservation,
}

enum ActorMessage {
    SendCommand {
        id: usize,
        json: String,
        reservation: CommandReservation,
        sender: oneshot::Sender<Result<Value, CdpError>>,
        deadline: Instant,
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

pub struct CdpClient {
    next_call_id: AtomicU64,
    command_tx: mpsc::Sender<ActorMessage>,
    close_notify: Arc<Notify>,
    budget: Arc<CommandBudget>,
    screencast_rx_broadcast: tokio::sync::broadcast::Sender<Arc<ScreencastFrameData>>,
    event_rx_broadcast: tokio::sync::broadcast::Sender<Arc<CdpLifecycleEvent>>,
    memory_controller: Arc<MemoryAdmissionController>,
    stats: Arc<CdpActorStats>,
}

impl CdpClient {
    /// Connect to a CDP WebSocket endpoint with bounded buffers and actor loops.
    pub async fn connect(ws_url: &str) -> Result<Arc<Self>, CdpError> {
        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(MAX_WS_MESSAGE_BYTES);
        config.max_frame_size = Some(MAX_WS_MESSAGE_BYTES);

        let (ws_stream, _) =
            tokio_tungstenite::connect_async_with_config(ws_url, Some(config), false)
                .await
                .map_err(|e| CdpError::Transport(e.to_string()))?;

        Ok(Self::from_ws_stream(ws_stream))
    }

    /// Construct a CdpClient from an existing WebSocketStream (allows unit testing with loopback).
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
        let (command_tx, command_rx) = mpsc::channel(MAX_WRITER_QUEUE_MESSAGES);
        let (screencast_tx, _) = tokio::sync::broadcast::channel(2);
        let (event_tx, _) = tokio::sync::broadcast::channel(MAX_LIFECYCLE_EVENT_SLOTS);
        let stats = Arc::new(CdpActorStats::default());
        let close_notify = Arc::new(Notify::new());

        let actor = CdpActor {
            ws_stream,
            command_rx,
            close_notify: close_notify.clone(),
            screencast_tx: screencast_tx.clone(),
            event_tx: event_tx.clone(),
            memory_controller: memory_controller.clone(),
            pending_commands: HashMap::with_capacity(MAX_PENDING_COMMANDS),
            stats: stats.clone(),
        };

        tokio::spawn(actor.run());

        Arc::new(Self {
            next_call_id: AtomicU64::new(1),
            command_tx,
            close_notify,
            budget: CommandBudget::new(MAX_PENDING_COMMANDS, MAX_WRITER_QUEUE_BYTES),
            screencast_rx_broadcast: screencast_tx,
            event_rx_broadcast: event_tx,
            memory_controller,
            stats,
        })
    }

    pub fn stats(&self) -> &CdpActorStats {
        &self.stats
    }

    pub fn subscribe_screencast(
        &self,
    ) -> tokio::sync::broadcast::Receiver<Arc<ScreencastFrameData>> {
        self.screencast_rx_broadcast.subscribe()
    }

    pub fn subscribe_events(
        &self,
    ) -> tokio::sync::broadcast::Receiver<Arc<CdpLifecycleEvent>> {
        self.event_rx_broadcast.subscribe()
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
        self.dispatch(method, params.as_ref(), session_id).await
    }

    /// Admission order: non-waiting slot reservation, byte-reserving bounded serialization,
    /// non-waiting enqueue. Every failure drops the reservation, so nothing is retained
    /// outside the shared 64-command / 2 MiB budget.
    async fn dispatch<P: Serialize>(
        &self,
        method: &str,
        params: Option<&P>,
        session_id: Option<&str>,
    ) -> Result<Value, CdpError> {
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

        // The queue holds at most MAX_WRITER_QUEUE_MESSAGES unwritten commands; a full queue
        // is reported immediately rather than waiting with the payload retained.
        if let Err(err) = self.command_tx.try_send(ActorMessage::SendCommand {
            id: call_id,
            json,
            reservation,
            sender,
            deadline,
        }) {
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

        tokio::select! {
            res = receiver => {
                match res {
                    Ok(result) => result,
                    Err(_) => Err(CdpError::ConnectionClosed),
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                Err(CdpError::CommandTimeout)
            }
        }
    }

    /// Send a strongly typed command from chromiumoxide_types / chromiumoxide_cdp.
    pub async fn send_typed<C: Command>(
        &self,
        cmd: C,
        session_id: Option<&str>,
    ) -> Result<C::Response, CdpError> {
        let method = cmd.identifier().to_string();
        let res_val = self.dispatch(&method, Some(&cmd), session_id).await?;
        C::response_from_value(res_val).map_err(|e| CdpError::MalformedResponse(e.to_string()))
    }

    /// Acknowledge a screencast frame to Chromium (releasing run credit) independently of viewer consumption.
    pub async fn ack_screencast_frame(
        &self,
        session_id: &str,
        frame_session_id: i64,
    ) -> Result<(), CdpError> {
        let ack_params =
            chromiumoxide_cdp::cdp::browser_protocol::page::ScreencastFrameAckParams::new(
                frame_session_id,
            );
        let _ = self.send_typed(ack_params, Some(session_id)).await?;
        self.stats
            .screencast_frames_acked
            .fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Request actor shutdown. Never waits on the command queue.
    pub async fn close(&self) {
        self.close_notify.notify_one();
    }
}

struct CdpActor<S> {
    ws_stream: S,
    command_rx: mpsc::Receiver<ActorMessage>,
    close_notify: Arc<Notify>,
    screencast_tx: tokio::sync::broadcast::Sender<Arc<ScreencastFrameData>>,
    event_tx: tokio::sync::broadcast::Sender<Arc<CdpLifecycleEvent>>,
    memory_controller: Arc<MemoryAdmissionController>,
    pending_commands: HashMap<usize, PendingRequest>,
    stats: Arc<CdpActorStats>,
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
                        Some(ActorMessage::SendCommand { id, json, reservation, sender, deadline }) => {
                            // Caller cancellation check: skip command if caller abandoned the request before dequeue
                            if sender.is_closed() {
                                debug!(id, "command caller cancelled before dequeue");
                                continue;
                            }

                            if Instant::now() >= deadline {
                                let _ = sender.send(Err(CdpError::CommandTimeout));
                                continue;
                            }

                            // Bounded, close-cancellable write so peer stalls cannot hold the actor
                            match self.write_message(Message::Text(json.into())).await {
                                WriteOutcome::Done => {}
                                WriteOutcome::Failed(e) => {
                                    drop(reservation);
                                    let _ = sender.send(Err(e));
                                    self.shutdown(CdpError::ConnectionClosed, false).await;
                                    break;
                                }
                                WriteOutcome::Closed => {
                                    drop(reservation);
                                    let _ = sender.send(Err(CdpError::ConnectionClosed));
                                    self.shutdown(CdpError::ConnectionClosed, true).await;
                                    break;
                                }
                            }

                            self.pending_commands.insert(id, PendingRequest {
                                sender,
                                deadline,
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
        let env: IncomingEnvelope = serde_json::from_str(text)
            .map_err(|e| CdpError::MalformedResponse(format!("unparseable frame: {e}")))?;

        // An `id` marks a command response.
        if let Some(id_val) = env.id {
            let id = id_val
                .as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or_else(|| {
                    CdpError::MalformedResponse(
                        "response id is not an unsigned integer".to_string(),
                    )
                })?;
            // Unknown id: owner already timed out or was cancelled; nothing to fail.
            if let Some(pending) = self.pending_commands.remove(&id) {
                let _ = pending.sender.send(response_outcome(env.result, env.error));
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
                        let is_main_frame = params
                            .and_then(|p| p.pointer("/frame/parentId"))
                            .is_none();
                        let url = params
                            .and_then(|p| p.pointer("/frame/url"))
                            .and_then(Value::as_str)
                            .filter(|u| u.len() <= MAX_URL_BYTES)
                            .map(str::to_string);
                        let bytes = std::mem::size_of::<CdpLifecycleEvent>()
                            + session_id.as_ref().map_or(0, String::len)
                            + url.as_ref().map_or(0, String::len);
                        match self.memory_controller.try_reserve(bytes) {
                            Ok(res) => CdpLifecycleEvent::FrameNavigated {
                                session_id,
                                is_main_frame,
                                url,
                                _reservation: Some(Arc::new(res)),
                            },
                            Err(_) => CdpLifecycleEvent::Overflow,
                        }
                    }
                    "Page.navigatedWithinDocument" => {
                        let url = params
                            .and_then(|p| p.get("url"))
                            .and_then(Value::as_str)
                            .filter(|u| u.len() <= MAX_URL_BYTES)
                            .map(str::to_string);
                        let bytes = std::mem::size_of::<CdpLifecycleEvent>()
                            + session_id.as_ref().map_or(0, String::len)
                            + url.as_ref().map_or(0, String::len);
                        match self.memory_controller.try_reserve(bytes) {
                            Ok(res) => CdpLifecycleEvent::NavigatedWithinDocument {
                                session_id,
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
        let frame = Arc::new(ScreencastFrameData {
            session_id,
            frame_session_id,
            data_base64,
            metadata,
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
        self.fail_all(err);
        if close_ws {
            let _ = tokio::time::timeout(WRITE_DEADLINE, self.ws_stream.close()).await;
        }
    }

    /// Fail in-flight owners and every command still queued for the writer, and refuse new
    /// submissions, so no caller waits on the (bounded) WS close or its own deadline.
    fn fail_all(&mut self, err: CdpError) {
        self.command_rx.close();
        while let Ok(ActorMessage::SendCommand { sender, .. }) = self.command_rx.try_recv() {
            let _ = sender.send(Err(err.clone()));
        }
        for (_, req) in self.pending_commands.drain() {
            let _ = req.sender.send(Err(err.clone()));
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
            .dispatch("Test.probe", Some(&SpySerialize(invoked.clone())), None)
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
            MockChannelWs { tx: sent_tx, rx: in_rx },
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
            CdpLifecycleEvent::FrameNavigated { session_id, is_main_frame, url, .. } => {
                assert_eq!(session_id.as_deref(), Some("psid-1"));
                assert!(*is_main_frame);
                assert_eq!(url.as_deref(), Some("https://example.test/next"));
            }
            other => panic!("unexpected projected event: {other:?}"),
        }
        // Retained reservation only accounts for small projected fields, never the 100 KiB blob
        let retained = controller.current_reserved_bytes();
        assert!(retained > 0 && retained <= 256, "unexpected retained bytes: {retained}");

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
}
