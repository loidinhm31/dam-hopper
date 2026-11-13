use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use parking_lot::Mutex;
use tokio::sync::{mpsc, Notify};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use super::diagnostics::TrackedBhjfFrame;
use super::media::WRITE_DEADLINE;
use super::protocol::{ProducerAudioChunk, MAX_AUDIO_MESSAGE_BYTES};
use super::screencast::AudioDocAuthority;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutboundMediaPacket {
    Binary(bytes::Bytes),
    Text(String),
}

pub trait MediaPacketSink: Send + 'static {
    fn send_packet(
        &mut self,
        packet: OutboundMediaPacket,
    ) -> Pin<Box<dyn Future<Output = Result<(), &'static str>> + Send + '_>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaWriterEvent {
    FrameSent { byte_len: usize, write_duration: Duration, local_send_unix_ms: u64 },
    AudioSent { byte_len: usize, write_duration: Duration },
    ControlSent { byte_len: usize, write_duration: Duration },
    TransportFailed(&'static str),
}

#[derive(Debug)]
struct QueuedAudioSlot {
    json: String,
    byte_len: usize,
    doc_epoch: u64,
    producer_run: String,
    _chunk: ProducerAudioChunk,
}

#[derive(Default)]
struct WriterSlots {
    writer_busy_with_frame: bool,
    control_slot: Option<String>,
    frame_slot: Option<TrackedBhjfFrame>,
    audio_slot: Option<QueuedAudioSlot>,
}

enum NextWriteItem {
    Control(String),
    Frame(TrackedBhjfFrame),
    Audio(QueuedAudioSlot),
}

/// Bounded media writer handle: at most one frame in flight + one audio slot + one control slot.
#[derive(Clone)]
pub struct MediaWriterHandle {
    slots: Arc<Mutex<WriterSlots>>,
    notify: Arc<Notify>,
}

impl MediaWriterHandle {
    pub fn is_frame_busy(&self) -> bool {
        let g = self.slots.lock();
        g.writer_busy_with_frame || g.frame_slot.is_some()
    }
    pub fn enqueue_admitted_frame(&self, frame: TrackedBhjfFrame) -> bool {
        let mut g = self.slots.lock();
        if g.writer_busy_with_frame || g.frame_slot.is_some() { return false; }
        g.frame_slot = Some(frame);
        drop(g);
        self.notify.notify_one();
        true
    }
    pub fn enqueue_latest_audio(&self, sub_epoch: &str, chunk: ProducerAudioChunk) -> bool {
        let env = chunk.to_viewer_envelope(sub_epoch);
        if env.validate().is_err() { return false; }
        let Ok(json) = serde_json::to_string(&env) else { return false; };
        if json.is_empty() || json.len() > MAX_AUDIO_MESSAGE_BYTES { return false; }
        let mut g = self.slots.lock();
        g.audio_slot = Some(QueuedAudioSlot {
            byte_len: json.len(), json, doc_epoch: chunk.doc_epoch,
            producer_run: chunk.producer_run.clone(), _chunk: chunk,
        });
        drop(g);
        self.notify.notify_one();
        true
    }
    pub fn enqueue_control_text(&self, json: String) {
        self.slots.lock().control_slot = Some(json);
        self.notify.notify_one();
    }
    pub fn clear_queued(&self) {
        let mut g = self.slots.lock();
        g.control_slot = None;
        g.frame_slot = None;
        g.audio_slot = None;
    }
    /// Drops only the queued (not yet written) audio chunk; already-written bytes cannot be recalled.
    pub fn clear_audio(&self) {
        self.slots.lock().audio_slot = None;
    }
    fn take_next(&self) -> Option<NextWriteItem> {
        let mut g = self.slots.lock();
        if let Some(ctrl) = g.control_slot.take() { return Some(NextWriteItem::Control(ctrl)); }
        if let Some(frame) = g.frame_slot.take() {
            g.writer_busy_with_frame = true;
            return Some(NextWriteItem::Frame(frame));
        }
        g.audio_slot.take().map(NextWriteItem::Audio)
    }

    fn finish_frame_write(&self) {
        self.slots.lock().writer_busy_with_frame = false;
    }
}

async fn send_with_deadline<S: MediaPacketSink>(
    sink: &mut S, packet: OutboundMediaPacket, cancel: &CancellationToken,
) -> Result<Duration, &'static str> {
    let started = Instant::now();
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("cancelled"),
        res = timeout(WRITE_DEADLINE, sink.send_packet(packet)) => match res {
            Ok(Ok(())) => Ok(Instant::now().saturating_duration_since(started)),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("timeout"),
        },
    }
}

pub const MEDIA_WRITER_EVENT_CAPACITY: usize = 16;

#[derive(Default)]
struct PendingEventAggregation {
    audio_bytes: usize,
    audio_duration: Duration,
    control_bytes: usize,
    control_duration: Duration,
    frames_sent: VecDeque<MediaWriterEvent>,
    pending_transport_failed: Option<&'static str>,
}

impl PendingEventAggregation {
    fn has_pending(&self) -> bool {
        !self.frames_sent.is_empty()
            || self.audio_bytes > 0
            || self.control_bytes > 0
            || self.pending_transport_failed.is_some()
    }

    fn flush_one_with_permit(&mut self, permit: mpsc::Permit<'_, MediaWriterEvent>, w: &MediaWriterHandle) {
        if let Some(frame_ev) = self.frames_sent.pop_front() {
            permit.send(frame_ev);
            w.finish_frame_write();
            return;
        }
        if self.audio_bytes > 0 {
            let ev = MediaWriterEvent::AudioSent {
                byte_len: self.audio_bytes,
                write_duration: self.audio_duration,
            };
            self.audio_bytes = 0;
            self.audio_duration = Duration::ZERO;
            permit.send(ev);
            return;
        }
        if self.control_bytes > 0 {
            let ev = MediaWriterEvent::ControlSent {
                byte_len: self.control_bytes,
                write_duration: self.control_duration,
            };
            self.control_bytes = 0;
            self.control_duration = Duration::ZERO;
            permit.send(ev);
            return;
        }
        if let Some(err) = self.pending_transport_failed.take() {
            permit.send(MediaWriterEvent::TransportFailed(err));
        }
    }

    fn try_flush(&mut self, tx: &mpsc::Sender<MediaWriterEvent>, w: &MediaWriterHandle) {
        while let Some(frame_ev) = self.frames_sent.pop_front() {
            match tx.try_send(frame_ev) {
                Ok(()) => {
                    w.finish_frame_write();
                }
                Err(mpsc::error::TrySendError::Full(ev)) => {
                    self.frames_sent.push_front(ev);
                    return;
                }
                Err(mpsc::error::TrySendError::Closed(_)) => return,
            }
        }
        if self.audio_bytes > 0 {
            let ev = MediaWriterEvent::AudioSent {
                byte_len: self.audio_bytes,
                write_duration: self.audio_duration,
            };
            match tx.try_send(ev) {
                Ok(()) => {
                    self.audio_bytes = 0;
                    self.audio_duration = Duration::ZERO;
                }
                Err(mpsc::error::TrySendError::Full(_)) => return,
                Err(mpsc::error::TrySendError::Closed(_)) => return,
            }
        }
        if self.control_bytes > 0 {
            let ev = MediaWriterEvent::ControlSent {
                byte_len: self.control_bytes,
                write_duration: self.control_duration,
            };
            match tx.try_send(ev) {
                Ok(()) => {
                    self.control_bytes = 0;
                    self.control_duration = Duration::ZERO;
                }
                Err(mpsc::error::TrySendError::Full(_)) => return,
                Err(mpsc::error::TrySendError::Closed(_)) => return,
            }
        }
        if let Some(err) = self.pending_transport_failed.take() {
            if let Err(mpsc::error::TrySendError::Full(_)) = tx.try_send(MediaWriterEvent::TransportFailed(err)) {
                self.pending_transport_failed = Some(err);
            }
        }
    }

    fn flush_all(&mut self, tx: &mpsc::Sender<MediaWriterEvent>, w: &MediaWriterHandle) {
        while let Some(frame_ev) = self.frames_sent.pop_front() {
            let _ = tx.try_send(frame_ev);
            w.finish_frame_write();
        }
        if self.audio_bytes > 0 {
            let ev = MediaWriterEvent::AudioSent {
                byte_len: self.audio_bytes,
                write_duration: self.audio_duration,
            };
            self.audio_bytes = 0;
            self.audio_duration = Duration::ZERO;
            let _ = tx.try_send(ev);
        }
        if self.control_bytes > 0 {
            let ev = MediaWriterEvent::ControlSent {
                byte_len: self.control_bytes,
                write_duration: self.control_duration,
            };
            self.control_bytes = 0;
            self.control_duration = Duration::ZERO;
            let _ = tx.try_send(ev);
        }
        if let Some(err) = self.pending_transport_failed.take() {
            let _ = tx.try_send(MediaWriterEvent::TransportFailed(err));
        }
    }

    fn emit_event(
        &mut self,
        tx: &mpsc::Sender<MediaWriterEvent>,
        w: &MediaWriterHandle,
        event: MediaWriterEvent,
    ) {
        self.try_flush(tx, w);
        match event {
            MediaWriterEvent::FrameSent { .. } => {
                if self.frames_sent.is_empty() {
                    match tx.try_send(event) {
                        Ok(()) => {
                            w.finish_frame_write();
                        }
                        Err(mpsc::error::TrySendError::Full(ev)) => {
                            self.frames_sent.push_back(ev);
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            w.finish_frame_write();
                        }
                    }
                } else {
                    self.frames_sent.push_back(event);
                }
            }
            MediaWriterEvent::AudioSent { byte_len, write_duration } => {
                if self.audio_bytes > 0 {
                    self.audio_bytes += byte_len;
                    self.audio_duration += write_duration;
                    self.try_flush(tx, w);
                } else if let Err(mpsc::error::TrySendError::Full(_)) = tx.try_send(event) {
                    self.audio_bytes += byte_len;
                    self.audio_duration += write_duration;
                }
            }
            MediaWriterEvent::ControlSent { byte_len, write_duration } => {
                if self.control_bytes > 0 {
                    self.control_bytes += byte_len;
                    self.control_duration += write_duration;
                    self.try_flush(tx, w);
                } else if let Err(mpsc::error::TrySendError::Full(_)) = tx.try_send(event) {
                    self.control_bytes += byte_len;
                    self.control_duration += write_duration;
                }
            }
            MediaWriterEvent::TransportFailed(reason) => {
                if let Err(mpsc::error::TrySendError::Full(_)) = tx.try_send(event) {
                    self.pending_transport_failed = Some(reason);
                }
            }
        }
    }
}

pub fn spawn_media_writer<S, F>(
    mut sink: S,
    cancel: CancellationToken,
    mut doc_rx: Option<tokio::sync::watch::Receiver<AudioDocAuthority>>,
    is_audio_admissible: F,
) -> (MediaWriterHandle, mpsc::Receiver<MediaWriterEvent>, tokio::task::JoinHandle<()>)
where
    S: MediaPacketSink,
    F: Fn(&str, u64) -> bool + Send + Sync + 'static,
{
    let handle = MediaWriterHandle {
        slots: Arc::new(Mutex::new(WriterSlots::default())),
        notify: Arc::new(Notify::new()),
    };
    let (tx, rx) = mpsc::channel(MEDIA_WRITER_EVENT_CAPACITY);
    let w = handle.clone();
    let join = tokio::spawn(async move {
        let mut agg = PendingEventAggregation::default();
        loop {
            agg.try_flush(&tx, &w);
            let item = loop {
                if cancel.is_cancelled() {
                    w.clear_queued();
                    agg.flush_all(&tx, &w);
                    return;
                }
                agg.try_flush(&tx, &w);
                let notified = w.notify.notified();
                if let Some(next) = w.take_next() {
                    break next;
                }
                if agg.has_pending() {
                    tokio::select! {
                        biased;
                        _ = cancel.cancelled() => {
                            w.clear_queued();
                            agg.flush_all(&tx, &w);
                            return;
                        }
                        res = tx.reserve() => {
                            match res {
                                Ok(permit) => {
                                    agg.flush_one_with_permit(permit, &w);
                                }
                                Err(_) => {
                                    w.clear_queued();
                                    return;
                                }
                            }
                        }
                        _ = notified => {}
                    }
                } else {
                    tokio::select! {
                        biased;
                        _ = cancel.cancelled() => {
                            w.clear_queued();
                            agg.flush_all(&tx, &w);
                            return;
                        }
                        _ = notified => {}
                    }
                }
            };
            match item {
                NextWriteItem::Control(text) => {
                    let byte_len = text.len();
                    match send_with_deadline(&mut sink, OutboundMediaPacket::Text(text), &cancel).await {
                        Ok(write_duration) => {
                            agg.emit_event(&tx, &w, MediaWriterEvent::ControlSent { byte_len, write_duration });
                        }
                        Err(e) => {
                            w.clear_queued();
                            cancel.cancel();
                            agg.emit_event(&tx, &w, MediaWriterEvent::TransportFailed(e));
                            return;
                        }
                    }
                }
                NextWriteItem::Frame(frame) => {
                    let (byte_len, payload) = (frame.byte_length(), frame.clone_data());
                    let res = send_with_deadline(&mut sink, OutboundMediaPacket::Binary(payload), &cancel).await;
                    drop(frame);
                    match res {
                        Ok(write_duration) => {
                            let local_send_unix_ms = Utc::now().timestamp_millis().max(0) as u64;
                            agg.emit_event(&tx, &w, MediaWriterEvent::FrameSent { byte_len, write_duration, local_send_unix_ms });
                        }
                        Err(e) => {
                            w.clear_queued();
                            w.finish_frame_write();
                            cancel.cancel();
                            agg.emit_event(&tx, &w, MediaWriterEvent::TransportFailed(e));
                            return;
                        }
                    }
                }
                NextWriteItem::Audio(a) => {
                    // 1. Check doc authority BEFORE handing item to sink
                    if !is_audio_admissible(&a.producer_run, a.doc_epoch)
                        || doc_rx.as_mut().is_some_and(|r| !r.borrow_and_update().is_admissible(a.doc_epoch))
                    {
                        drop(a._chunk);
                        continue;
                    }

                    let pkt = OutboundMediaPacket::Text(a.json);
                    // 2. Hand item to sink; if interrupted mid-flush, sink may have buffered item,
                    // so transport MUST be retired rather than reused with released reservation.
                    let send_fut = send_with_deadline(&mut sink, pkt, &cancel);
                    let (res, interrupted_by_doc_change) = if let Some(r) = doc_rx.as_mut() {
                        tokio::select! {
                            biased;
                            _ = r.changed() => (Err("doc_changed"), true),
                            res = send_fut => (res, false),
                        }
                    } else {
                        (send_fut.await, false)
                    };

                    if interrupted_by_doc_change {
                        cancel.cancel();
                        w.clear_queued();
                        agg.emit_event(
                            &tx,
                            &w,
                            MediaWriterEvent::TransportFailed("doc authority changed during write; transport retired"),
                        );
                        drop(a._chunk);
                        return;
                    }

                    drop(a._chunk);
                    match res {
                        Ok(write_duration) => {
                            agg.emit_event(&tx, &w, MediaWriterEvent::AudioSent { byte_len: a.byte_len, write_duration });
                        }
                        Err(e) => {
                            w.clear_queued();
                            cancel.cancel();
                            agg.emit_event(&tx, &w, MediaWriterEvent::TransportFailed(e));
                            return;
                        }
                    }
                }
            }
        }
    });
    (handle, rx, join)
}
