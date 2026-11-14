//! GET /qualification/stream-metrics: everything reachable through public production APIs.
//! Counters, per-viewer delivery snapshots, memory reservation, and the shared capture tier
//! of `?session=`. Per-viewer controller stage is not exported by production; viewers record it
//! from the `streamQuality` frames instead.

use axum::extract::Query;
use axum::Json;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::Ordering::Relaxed;

use dam_hopper_server::browser_host::capture_tier::CaptureTierState;
use dam_hopper_server::browser_host::diagnostics::{global_memory_controller, global_stream_diagnostics};

pub fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn ladder_json(state: &CaptureTierState) -> Value {
    let ladder = state.ladder();
    let stages: Vec<Value> = (0..ladder.len())
        .map(|i| {
            let s = ladder.stage(i);
            json!({"stage": i, "fps": s.fps, "jpegQuality": s.jpeg_quality,
                   "scalePermille": s.scale_permille, "tier": ladder.tier_of(i)})
        })
        .collect();
    let c = state.ceilings();
    json!({"ceilings": {"fps": c.fps, "jpegQuality": c.jpeg_quality,
                        "maxWidth": c.max_width, "maxHeight": c.max_height},
           "stages": stages,
           "downscaleInputQualified": state.downscale_input_qualified()})
}

pub async fn stream_metrics(Query(q): Query<HashMap<String, String>>) -> Json<Value> {
    let d = global_stream_diagnostics();
    let mem = global_memory_controller();
    let counters = json!({
        "eventsReceived": d.events_received.load(Relaxed), "eventsAdmitted": d.events_admitted.load(Relaxed),
        "eventsDropped": d.events_dropped.load(Relaxed), "acksEnqueued": d.acks_enqueued.load(Relaxed),
        "acksFailed": d.acks_failed.load(Relaxed), "jpegBytesTotal": d.jpeg_bytes_total.load(Relaxed),
        "deliveredFrames": d.delivered_frames.load(Relaxed), "acksReceived": d.acks_received.load(Relaxed),
        "discardsReceived": d.discards_received.load(Relaxed), "screenshotCount": d.screenshot_count.load(Relaxed),
        "periodicScreenshotViolations": d.periodic_screenshot_violations.load(Relaxed),
        "zeroDemandStops": d.zero_demand_stops.load(Relaxed), "demandStarts": d.demand_starts.load(Relaxed),
        "broadcastLaggedFrames": d.broadcast_lagged_frames.load(Relaxed),
    });
    let mut event_counts: BTreeMap<String, u64> = BTreeMap::new();
    for e in d.export_qualification_events() {
        *event_counts.entry(e.kind).or_default() += 1;
    }
    let capture = match q.get("session") {
        Some(id) => match dam_hopper_server::browser_host::media::get_producer(id).await {
            Some(p) => {
                let cap = p.capture_state();
                json!({"current": &*cap.current(), "effective": cap.effective().as_deref(),
                       "ladder": ladder_json(cap), "frameSeq": p.frame_seq().to_string(),
                       "viewportEpoch": p.viewport_epoch().to_string(),
                       "producerRun": p.current_run().await.map(|r| r.to_string())})
            }
            None => Value::Null,
        },
        None => Value::Null,
    };
    Json(json!({
        "unixMs": chrono::Utc::now().timestamp_millis(),
        "policy": env_or("QUAL_POLICY_LABEL", "unlabeled"),
        "counters": counters,
        "qualificationEventCounts": event_counts,
        "viewers": d.export_viewer_snapshots(),
        "memory": {"currentReservedBytes": mem.current_reserved_bytes(),
                   "peakReservedBytes": mem.peak_reserved_bytes(),
                   "uniqueBuffers": mem.unique_buffer_count(),
                   "activeClones": mem.active_clone_count(), "rejections": mem.rejection_count()},
        "capture": capture,
    }))
}
