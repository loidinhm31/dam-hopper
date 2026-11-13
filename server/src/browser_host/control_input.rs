//! Control-socket input path.
//!
//! One control text frame goes through, in order: the pair gate (an unpaired control socket
//! never reaches native input), the viewer-bound lease check, capture of the native identity,
//! and ordered native dispatch. Every lease/pointer release goes through the input manager,
//! which releases on the captured identity and reports failure instead of success.

use tracing::{debug, warn};

use super::input::{InputError, InputEvent, InputMessage, SessionInputManager};
use super::input_native_release::NativeInputTarget;
use super::media::{dispatch_input_event_to_cdp, get_producer};
use super::protocol::ServerControlEvent;

/// What the control socket must do after a frame.
pub enum ControlInputOutcome {
    Continue,
    /// A native release failed: input is unavailable. The control channel is closed because
    /// native state is uncertain; the reason is surfaced to the viewer first.
    ReleaseFailed(String),
}

pub struct ControlInputContext<'a> {
    pub input_manager: &'a SessionInputManager,
    pub session_id: &'a str,
    /// Viewer authenticated on THIS control socket (from its ticket).
    pub viewer_id: &'a str,
    pub subscription_epoch: &'a str,
    /// Media producer attached and control connected for this viewer subscription.
    pub paired: bool,
}

pub fn event_kind(event: &InputEvent) -> &'static str {
    match event {
        InputEvent::PointerDown { .. } => "pointerDown",
        InputEvent::PointerUp { .. } => "pointerUp",
        InputEvent::PointerMove { .. } => "pointerMove",
        InputEvent::PointerCancel => "pointerCancel",
        InputEvent::Wheel { .. } => "wheel",
        InputEvent::KeyDown { .. } => "keyDown",
        InputEvent::KeyUp { .. } => "keyUp",
        InputEvent::InsertText { .. } => "insertText",
    }
}

/// Status frame telling the viewer native input is unavailable (failed release).
pub fn input_unavailable_json(reason: &str) -> Option<String> {
    serde_json::to_string(&ServerControlEvent::Status {
        input_available: false,
        unavailable_reason: Some(format!("nativeInputReleaseFailed: {reason}")),
    })
    .ok()
}

pub async fn handle_control_text(ctx: &ControlInputContext<'_>, text: &str) -> ControlInputOutcome {
    let Ok(msg) = serde_json::from_str::<InputMessage>(text) else {
        return ControlInputOutcome::Continue;
    };
    if !ctx.paired {
        warn!(viewer_id = %ctx.viewer_id, "input on an unpaired control socket dropped");
        return ControlInputOutcome::Continue;
    }
    if msg.subscription_epoch != ctx.subscription_epoch {
        warn!("subscription epoch mismatch in input message");
        return ControlInputOutcome::Continue;
    }

    // Native identity of this input: captured BEFORE the event is recorded as held, so any
    // later release targets the page session the key/button went down on.
    let native = match get_producer(ctx.session_id).await {
        Some(producer) => match producer.ensure_page_session().await {
            Ok(page_session_id) => Some((producer, page_session_id)),
            Err(_) => None,
        },
        None => None,
    };
    if let Some((producer, page_session_id)) = &native {
        ctx.input_manager
            .capture_native_target(NativeInputTarget {
                client: producer.cdp_client.clone(),
                page_session_id: page_session_id.clone(),
                geometry: producer.geometry().await,
            })
            .await;
    }

    if let Err(err) = ctx.input_manager.enqueue_input_for_viewer(ctx.viewer_id, msg).await {
        warn!(error = ?err, "enqueue_input rejected");
        // A sequence gap / overflow ended the lease and released natively; a failed release
        // leaves input unavailable.
        return match ctx.input_manager.release_failure().await {
            Some(reason) => ControlInputOutcome::ReleaseFailed(reason),
            None => ControlInputOutcome::Continue,
        };
    }
    let Some((producer, page_session_id)) = native else {
        return ControlInputOutcome::Continue;
    };

    while let Some(msg) = ctx.input_manager.pop_next_input().await {
        let kind = event_kind(&msg.event);
        if matches!(msg.event, InputEvent::PointerCancel) {
            if let Err(InputError::ReleaseFailed(reason)) =
                ctx.input_manager.release_pointer_buttons().await
            {
                return ControlInputOutcome::ReleaseFailed(reason);
            }
            continue;
        }
        // Pointer fractions are projected through the producer geometry; without native
        // evidence for it nothing is dispatched (no guessed projection).
        let projects = matches!(
            msg.event,
            InputEvent::PointerDown { .. }
                | InputEvent::PointerUp { .. }
                | InputEvent::PointerMove { .. }
                | InputEvent::Wheel { .. }
        );
        // Dispatch is ordered against releases: a lease ended meanwhile drops the event
        // instead of dispatching a press its release already passed.
        let Some(_dispatching) = ctx.input_manager.begin_dispatch(&msg.lease_token).await else {
            continue;
        };
        if msg.viewport_epoch != producer.viewport_epoch()
            || (projects && !producer.input_geometry_trusted())
        {
            warn!(session_id = %ctx.session_id, kind, "dropping input after geometry changed");
            continue;
        }
        let geometry = producer.geometry().await;
        debug!(session_id = %ctx.session_id, kind, "Dispatching CDP input event");
        if let Err(err) =
            dispatch_input_event_to_cdp(&producer.cdp_client, &page_session_id, &geometry, &msg.event).await
        {
            warn!(session_id = %ctx.session_id, kind, error = %err, "CDP input dispatch failed");
        }
    }
    ControlInputOutcome::Continue
}
