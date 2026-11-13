//! Geometry fence for raw CDP agents.
//!
//! A raw agent's `Emulation.*` command changes the native viewport of a managed page behind the
//! viewer's back. Before such a command is relayed upstream, the managed session it targets is
//! resolved (flattened session id -> native target id) and fenced synchronously: ordinary viewer
//! input is rejected, the producer drops old-geometry frames and caches, and the registry
//! advances `viewportEpoch`. Trust returns only when a native frame confirms the new geometry
//! (`ScreencastProducer::publish_governed_candidate`); nothing here guesses a projection.

use serde_json::Value;

use crate::api::browser_host::{global_input_managers, global_session_registry};
use crate::browser_host::media::get_producer;
use crate::browser_host::raw_session_targets::{RawSessionTargets, RawTarget, GEOMETRY_METHODS};

/// Inspects one raw client message before it is relayed upstream. Geometry-changing
/// `Emulation.*` commands fence the managed session(s) they target; everything else is ignored.
pub async fn handle_client_cdp_message(
    msg_str: &str,
    principal: &str,
    is_dev: bool,
    targets: &mut RawSessionTargets,
) {
    let attaches = msg_str.contains("\"Target.attachToTarget\"");
    if !attaches && !msg_str.contains("\"Emulation.") {
        return;
    }
    let Ok(msg) = serde_json::from_str::<Value>(msg_str) else {
        return;
    };
    let Some(method) = msg.get("method").and_then(Value::as_str) else {
        return;
    };
    if method == "Target.attachToTarget" {
        targets.observe_client_attach(&msg);
        return;
    }
    if !GEOMETRY_METHODS.contains(&method) {
        return;
    }
    let (target, adopt) = match targets.resolve(msg.get("sessionId").and_then(Value::as_str)) {
        RawTarget::Native(tid) => (Some(tid), true),
        RawTarget::Unmapped => (None, false),
        RawTarget::None => return,
    };
    let params = msg.get("params");
    let dim = |key: &str| {
        params
            .and_then(|p| p.get(key))
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
    };
    let (width, height, dpr) = if adopt {
        (
            dim("width"),
            dim("height"),
            params.and_then(|p| p.get("deviceScaleFactor")).and_then(Value::as_f64),
        )
    } else {
        (None, None, None)
    };
    // Detached from this future: an auth abort or deadline that drops the relay mid-fence must
    // never strand a producer in its transition state (frames suppressed, input fenced).
    let principal = principal.to_string();
    let fence = tokio::spawn(async move {
        fence_managed_geometry(&principal, is_dev, target.as_deref(), width, height, dpr).await;
    });
    let _ = fence.await;
}

/// Fences every managed session on `target_id` (all of the principal's when `None`) in order:
/// disable viewer input and producer frames, advance the registry epoch, publish the new
/// identity to both. Input is rejected for the whole window (epoch 0 is never valid).
async fn fence_managed_geometry(
    principal: &str,
    is_dev: bool,
    target_id: Option<&str>,
    width: Option<u32>,
    height: Option<u32>,
    dpr: Option<f64>,
) {
    let registry = global_session_registry();
    let session_ids = registry.sessions_for_native_target(principal, is_dev, target_id).await;
    if session_ids.is_empty() {
        return;
    }
    for id in &session_ids {
        if let Some(input) = global_input_managers().read().await.get(id).cloned() {
            input.fence_viewport_epoch().await;
        }
        if let Some(producer) = get_producer(id).await {
            producer.begin_external_geometry_fence().await;
        }
    }
    let fences = registry
        .fence_geometry_and_advance_epoch(principal, is_dev, target_id, width, height, dpr)
        .await;
    for fence in fences {
        if let Some(input) = global_input_managers().read().await.get(&fence.session_id).cloned() {
            input.set_expected_viewport_epoch(fence.viewport_epoch).await;
        }
        if let Some(producer) = get_producer(&fence.session_id).await {
            producer
                .commit_external_geometry_fence(fence.viewport_epoch, fence.geometry)
                .await;
        }
    }
}
