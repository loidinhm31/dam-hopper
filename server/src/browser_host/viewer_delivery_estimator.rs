use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use crate::browser_host::protocol::{DiscardReason, HeartbeatTelemetry};
pub const OBSERVATION_WINDOW: Duration = Duration::from_secs(1);
pub const EWMA_ALPHA: f64 = 0.25;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SampleProvenance { Warming, Idle, ApplicationLimited, Busy, AckStarved }
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientTelemetryCorroboration {
    pub last_sample_ms: u32, pub decoded_frames_total: u64, pub replaced_frames_total: u64,
    pub last_decode_ms: Option<f64>, pub decode_ms_ewma: Option<f64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerDeliverySnapshot {
    pub browser_session_id: String, pub viewer_id: String, pub subscription_epoch: String,
    pub producer_run: Option<String>, pub sample_provenance: SampleProvenance,
    pub application_limited: bool, pub ack_starved_pressure: bool, pub warming: bool,
    pub window_elapsed_ms: u64, pub window_acked_drawn_bytes: u64, pub window_discarded_bytes: u64,
    pub total_acked_drawn_bytes: u64, pub total_discarded_bytes: u64,
    pub estimated_delivered_kbps: Option<f64>, pub useful_drawn_kbps: Option<f64>,
    pub delivered_kbps_ewma: Option<f64>, pub useful_drawn_kbps_ewma: Option<f64>,
    pub audio_kbps_ewma: f64, pub min_service_baseline_ms: Option<f64>, pub service_ewma_ms: Option<f64>,
    pub frame_bytes_ewma: Option<f64>,
    pub oldest_outstanding_age_ms: u64, pub outstanding_frames: usize, pub outstanding_bytes: usize,
    pub has_pending_frame: bool, pub last_queued_duration_ms: Option<f64>,
    pub last_write_duration_ms: Option<f64>, pub write_duration_ewma_ms: Option<f64>,
    pub video_bytes_written: u64, pub audio_bytes_written: u64, pub control_bytes_written: u64,
    pub pending_replacements: u64, pub intentional_pacing_holds: u64, pub broadcast_lagged_frames: u64,
    pub last_native_capture_time_unix_ms: Option<u64>, pub last_server_receipt_unix_ms: Option<u64>,
    pub last_local_send_unix_ms: Option<u64>, pub client_corroboration: ClientTelemetryCorroboration,
}

#[derive(Debug, Clone, Default)]
struct EstimatorAccumulators {
    current_producer_run: Option<String>, window_acked_drawn_bytes: u64, window_discarded_bytes: u64,
    last_window_acked_bytes: u64, last_window_discarded_bytes: u64, last_window_elapsed_ms: u64,
    window_audio_bytes: u64, window_completions: u32, window_deliveries: u32,
    window_credit_saturated: bool, window_pacing_held: bool,
    total_acked_drawn_bytes: u64, total_discarded_bytes: u64,
    estimated_delivered_kbps: Option<f64>, useful_drawn_kbps: Option<f64>,
    delivered_kbps_ewma: Option<f64>, useful_drawn_kbps_ewma: Option<f64>, audio_kbps_ewma: f64,
    min_service_baseline_ms: Option<f64>, service_ewma_ms: Option<f64>, frame_bytes_ewma: Option<f64>,
    last_queued_duration_ms: Option<f64>, last_write_duration_ms: Option<f64>, write_duration_ewma_ms: Option<f64>,
    video_bytes_written: u64, audio_bytes_written: u64, control_bytes_written: u64,
    pending_replacements: u64, intentional_pacing_holds: u64, broadcast_lagged_frames: u64,
    last_native_capture_time_unix_ms: Option<u64>, last_server_receipt_unix_ms: Option<u64>,
    last_local_send_unix_ms: Option<u64>, client_corroboration: ClientTelemetryCorroboration,
}

#[derive(Debug, Clone)]
pub struct ViewerDeliveryEstimator {
    subscription_epoch: String, warming: bool, window_started_at: Instant,
    last_provenance: SampleProvenance, acc: EstimatorAccumulators,
}

fn ewma(prev: Option<f64>, sample: f64) -> Option<f64> {
    Some(prev.map_or(sample, |cur| EWMA_ALPHA * sample + (1.0 - EWMA_ALPHA) * cur))
}
impl ViewerDeliveryEstimator {
    pub fn new(subscription_epoch: String, now: Instant) -> Self {
        Self { subscription_epoch, warming: true, window_started_at: now, last_provenance: SampleProvenance::Warming, acc: EstimatorAccumulators::default() }
    }
    pub fn on_frame_candidate(&mut self, producer_run: &str, native_capture_ms: Option<u64>, server_receipt_ms: Option<u64>, now: Instant) {
        if self.acc.current_producer_run.as_deref() != Some(producer_run) {
            self.acc.current_producer_run = Some(producer_run.to_string());
            self.warming = true; self.last_provenance = SampleProvenance::Warming;
            self.reset_active_window(now);
            self.acc.last_window_acked_bytes = 0; self.acc.last_window_discarded_bytes = 0; self.acc.last_window_elapsed_ms = 0;
            self.acc.estimated_delivered_kbps = None; self.acc.useful_drawn_kbps = None;
            self.acc.delivered_kbps_ewma = None; self.acc.useful_drawn_kbps_ewma = None;
            self.acc.service_ewma_ms = None; self.acc.frame_bytes_ewma = None;
            self.acc.client_corroboration = ClientTelemetryCorroboration::default();
        }
        self.acc.last_native_capture_time_unix_ms = native_capture_ms;
        if server_receipt_ms.is_some() { self.acc.last_server_receipt_unix_ms = server_receipt_ms; }
    }
    pub fn on_frame_admitted(&mut self, queued_duration: Option<Duration>, credits_saturated: bool) {
        self.acc.window_deliveries = self.acc.window_deliveries.saturating_add(1);
        self.acc.window_credit_saturated |= credits_saturated;
        if let Some(q) = queued_duration { self.acc.last_queued_duration_ms = Some(q.as_secs_f64() * 1000.0); }
    }
    pub fn record_credit_pending_hold(&mut self, replaced_existing_pending: bool) {
        self.acc.window_credit_saturated = true;
        if replaced_existing_pending { self.acc.pending_replacements = self.acc.pending_replacements.saturating_add(1); }
    }
    pub fn record_intentional_pacing_hold(&mut self) {
        self.acc.window_pacing_held = true;
        self.acc.intentional_pacing_holds = self.acc.intentional_pacing_holds.saturating_add(1);
    }
    pub fn record_broadcast_lag(&mut self, lagged_frames: u64) {
        self.acc.broadcast_lagged_frames = self.acc.broadcast_lagged_frames.saturating_add(lagged_frames);
    }
    fn record_write_timing(&mut self, write_duration: Duration) {
        let ms = write_duration.as_secs_f64() * 1000.0;
        self.acc.last_write_duration_ms = Some(ms);
        self.acc.write_duration_ewma_ms = ewma(self.acc.write_duration_ewma_ms, ms);
    }
    pub fn record_frame_write(&mut self, bytes: usize, write_duration: Duration, local_send_unix_ms: u64) {
        self.acc.video_bytes_written = self.acc.video_bytes_written.saturating_add(bytes as u64);
        self.record_write_timing(write_duration);
        self.acc.last_local_send_unix_ms = Some(local_send_unix_ms);
    }
    pub fn record_audio_write(&mut self, bytes: usize, write_duration: Duration) {
        self.acc.audio_bytes_written = self.acc.audio_bytes_written.saturating_add(bytes as u64);
        self.acc.window_audio_bytes = self.acc.window_audio_bytes.saturating_add(bytes as u64);
        self.record_write_timing(write_duration);
    }
    pub fn record_control_write(&mut self, bytes: usize, write_duration: Duration) {
        self.acc.control_bytes_written = self.acc.control_bytes_written.saturating_add(bytes as u64);
        self.record_write_timing(write_duration);
    }
    pub fn on_credit_completed(&mut self, producer_run: &str, frame_bytes: usize, service_duration: Duration, is_discard: bool, discard_reason: Option<DiscardReason>, decode_ms: Option<f64>) {
        let bytes = frame_bytes as u64;
        if is_discard { self.acc.total_discarded_bytes = self.acc.total_discarded_bytes.saturating_add(bytes); }
        else { self.acc.total_acked_drawn_bytes = self.acc.total_acked_drawn_bytes.saturating_add(bytes); }
        if self.acc.current_producer_run.as_deref() != Some(producer_run) { return; }
        let non_congestion = matches!(discard_reason, Some(DiscardReason::Hidden | DiscardReason::Obsolete | DiscardReason::OwnerChanged));
        if !non_congestion {
            if is_discard { self.acc.window_discarded_bytes = self.acc.window_discarded_bytes.saturating_add(bytes); }
            else { self.acc.window_acked_drawn_bytes = self.acc.window_acked_drawn_bytes.saturating_add(bytes); }
            self.acc.window_completions = self.acc.window_completions.saturating_add(1);
            let service_ms = service_duration.as_secs_f64() * 1000.0;
            self.acc.min_service_baseline_ms = Some(self.acc.min_service_baseline_ms.map_or(service_ms, |c| c.min(service_ms)));
            self.acc.service_ewma_ms = ewma(self.acc.service_ewma_ms, service_ms);
            self.acc.frame_bytes_ewma = ewma(self.acc.frame_bytes_ewma, frame_bytes as f64);
        }
        if let Some(ms) = decode_ms {
            self.acc.client_corroboration.last_decode_ms = Some(ms);
            self.acc.client_corroboration.decode_ms_ewma = ewma(self.acc.client_corroboration.decode_ms_ewma, ms);
        }
    }
    pub fn record_heartbeat_telemetry(&mut self, telemetry: HeartbeatTelemetry) {
        let c = &mut self.acc.client_corroboration;
        c.last_sample_ms = telemetry.sample_ms;
        c.decoded_frames_total = c.decoded_frames_total.saturating_add(u64::from(telemetry.decoded_frames));
        c.replaced_frames_total = c.replaced_frames_total.saturating_add(u64::from(telemetry.replaced_frames));
        if let Some(val) = telemetry.decode_ms_ewma { c.decode_ms_ewma = Some(val); }
    }
    pub fn advance_window_if_due(&mut self, outstanding_frames: usize, oldest_age: Duration, has_pending: bool, now: Instant) {
        let elapsed = now.saturating_duration_since(self.window_started_at);
        if elapsed < OBSERVATION_WINDOW { return; }
        let secs = elapsed.as_secs_f64().max(0.001);
        let audio_kbps = (self.acc.window_audio_bytes as f64 * 8.0) / (secs * 1000.0);
        self.acc.audio_kbps_ewma = EWMA_ALPHA * audio_kbps + (1.0 - EWMA_ALPHA) * self.acc.audio_kbps_ewma;
        let total_bytes = self.acc.window_acked_drawn_bytes + self.acc.window_discarded_bytes;
        let is_busy = self.acc.window_credit_saturated && self.acc.window_completions > 0;
        if self.acc.window_completions == 0 && outstanding_frames > 0 && oldest_age >= OBSERVATION_WINDOW {
            self.last_provenance = SampleProvenance::AckStarved;
        } else if total_bytes > 0 && is_busy {
            let (delivered, useful) = ((total_bytes as f64 * 8.0) / (secs * 1000.0), (self.acc.window_acked_drawn_bytes as f64 * 8.0) / (secs * 1000.0));
            self.acc.estimated_delivered_kbps = Some(delivered); self.acc.useful_drawn_kbps = Some(useful);
            self.acc.delivered_kbps_ewma = ewma(self.acc.delivered_kbps_ewma, delivered);
            self.acc.useful_drawn_kbps_ewma = ewma(self.acc.useful_drawn_kbps_ewma, useful);
            self.warming = false; self.last_provenance = SampleProvenance::Busy;
        } else if self.acc.window_completions == 0 && self.acc.window_deliveries == 0 && outstanding_frames == 0 && !has_pending {
            self.last_provenance = SampleProvenance::Idle;
        } else {
            self.last_provenance = SampleProvenance::ApplicationLimited;
        }
        self.acc.last_window_acked_bytes = self.acc.window_acked_drawn_bytes;
        self.acc.last_window_discarded_bytes = self.acc.window_discarded_bytes;
        self.acc.last_window_elapsed_ms = elapsed.as_millis() as u64;
        self.reset_active_window(now);
    }
    fn reset_active_window(&mut self, now: Instant) {
        self.window_started_at = now;
        self.acc.window_acked_drawn_bytes = 0; self.acc.window_discarded_bytes = 0; self.acc.window_audio_bytes = 0;
        self.acc.window_completions = 0; self.acc.window_deliveries = 0;
        self.acc.window_credit_saturated = false; self.acc.window_pacing_held = false;
    }
    pub fn snapshot(&mut self, browser_session_id: &str, viewer_id: &str, outstanding_frames: usize, outstanding_bytes: usize, oldest_age: Duration, has_pending: bool, now: Instant) -> ViewerDeliverySnapshot {
        self.advance_window_if_due(outstanding_frames, oldest_age, has_pending, now);
        let active_elapsed_ms = now.saturating_duration_since(self.window_started_at).as_millis() as u64;
        let use_last = self.acc.window_completions == 0 && self.acc.last_window_elapsed_ms > 0;
        let ack_starved = self.last_provenance == SampleProvenance::AckStarved || (outstanding_frames > 0 && self.acc.window_completions == 0 && oldest_age >= OBSERVATION_WINDOW);
        let provenance = if ack_starved { SampleProvenance::AckStarved } else { self.last_provenance };
        let application_limited = matches!(provenance, SampleProvenance::Idle | SampleProvenance::ApplicationLimited | SampleProvenance::Warming) && !ack_starved;
        ViewerDeliverySnapshot {
            browser_session_id: browser_session_id.to_string(), viewer_id: viewer_id.to_string(), subscription_epoch: self.subscription_epoch.clone(),
            producer_run: self.acc.current_producer_run.clone(), sample_provenance: provenance, application_limited, ack_starved_pressure: ack_starved,
            warming: self.warming, window_elapsed_ms: if use_last { self.acc.last_window_elapsed_ms } else { active_elapsed_ms },
            window_acked_drawn_bytes: if use_last { self.acc.last_window_acked_bytes } else { self.acc.window_acked_drawn_bytes },
            window_discarded_bytes: if use_last { self.acc.last_window_discarded_bytes } else { self.acc.window_discarded_bytes },
            total_acked_drawn_bytes: self.acc.total_acked_drawn_bytes, total_discarded_bytes: self.acc.total_discarded_bytes,
            estimated_delivered_kbps: self.acc.estimated_delivered_kbps, useful_drawn_kbps: self.acc.useful_drawn_kbps,
            delivered_kbps_ewma: self.acc.delivered_kbps_ewma, useful_drawn_kbps_ewma: self.acc.useful_drawn_kbps_ewma,
            audio_kbps_ewma: self.acc.audio_kbps_ewma, min_service_baseline_ms: self.acc.min_service_baseline_ms, service_ewma_ms: self.acc.service_ewma_ms,
            frame_bytes_ewma: self.acc.frame_bytes_ewma,
            oldest_outstanding_age_ms: oldest_age.as_millis() as u64, outstanding_frames, outstanding_bytes, has_pending_frame: has_pending,
            last_queued_duration_ms: self.acc.last_queued_duration_ms, last_write_duration_ms: self.acc.last_write_duration_ms,
            write_duration_ewma_ms: self.acc.write_duration_ewma_ms, video_bytes_written: self.acc.video_bytes_written,
            audio_bytes_written: self.acc.audio_bytes_written, control_bytes_written: self.acc.control_bytes_written,
            pending_replacements: self.acc.pending_replacements, intentional_pacing_holds: self.acc.intentional_pacing_holds,
            broadcast_lagged_frames: self.acc.broadcast_lagged_frames, last_native_capture_time_unix_ms: self.acc.last_native_capture_time_unix_ms,
            last_server_receipt_unix_ms: self.acc.last_server_receipt_unix_ms, last_local_send_unix_ms: self.acc.last_local_send_unix_ms,
            client_corroboration: self.acc.client_corroboration,
        }
    }
}
