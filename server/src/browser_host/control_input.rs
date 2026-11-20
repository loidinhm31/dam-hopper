//! Control-socket input path.
//!
//! One control text frame goes through, in order: the pair gate (an unpaired control socket
//! never reaches native input), the viewer-bound lease check, capture of the native identity,
//! and ordered native dispatch. Every lease/pointer release goes through the input manager,
//! which releases on the captured identity and reports failure instead of success.

use std::sync::Arc;
use tokio::sync::OwnedMutexGuard;
use uuid::Uuid;

use tracing::{debug, warn};

use super::cdp::{InputCommandCancellation, PendingCommand};
use super::input::{
    map_fraction_to_css_coords, InputError, InputEvent, InputMessage, PendingLedgerOp,
    SessionInputManager,
};
use super::input_native_release::{CapturedNativeIdentity, NativeInputTarget};
use super::media::{enqueue_cancellable_input, get_producer};
use super::protocol::ServerControlEvent;

/// What the control socket must do after a frame.
pub enum ControlInputOutcome {
    Continue,
    /// A native release failed: input is unavailable. The control channel is closed because
    /// native state is uncertain; the reason is surfaced to the viewer first.
    ReleaseFailed(String),
    /// Dispatch failed or its native target disappeared; the lease is terminated.
    DispatchFailed,
}

struct DispatchAbandonGuard {
    manager: Arc<SessionInputManager>,
    token: Option<String>,
    gate: Option<OwnedMutexGuard<()>>,
    pending: Option<PendingCommand>,
    pending_op: Option<PendingLedgerOp>,
    cancellation: Option<InputCommandCancellation>,
}

impl Drop for DispatchAbandonGuard {
    fn drop(&mut self) {
        if let Some(token) = self.token.take() {
            self.manager.abandon_dispatch(
                token,
                self.gate.take(),
                self.pending.take(),
                self.pending_op.take(),
            );
        }
        if let Some(cancellation) = self.cancellation.take() {
            self.manager.clear_input_cancellation(&cancellation);
        }
    }
}

pub struct ControlInputContext<'a> {
    pub input_manager: &'a Arc<SessionInputManager>,
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
    match admit_control_text(ctx, text, None).await {
        Ok(true) => drain_control_input(ctx, None).await,
        Ok(false) => ControlInputOutcome::Continue,
        Err(outcome) => outcome,
    }
}

pub(crate) async fn admit_control_text(
    ctx: &ControlInputContext<'_>,
    text: &str,
    origin: Option<Uuid>,
) -> Result<bool, ControlInputOutcome> {
    let Ok(msg) = serde_json::from_str::<InputMessage>(text) else {
        return Ok(false);
    };
    if !ctx.paired {
        warn!(viewer_id = %ctx.viewer_id, "input on an unpaired control socket dropped");
        return Ok(false);
    }
    if msg.subscription_epoch != ctx.subscription_epoch {
        warn!("subscription epoch mismatch in input message");
        return Ok(false);
    }
    let result = match origin {
        Some(origin) => ctx.input_manager.enqueue_socket_input(ctx.viewer_id, origin, msg).await,
        None => ctx.input_manager.enqueue_input_for_viewer(ctx.viewer_id, msg).await,
    };
    match result {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(err) => {
            warn!(error = ?err, "enqueue_input rejected");
            match ctx.input_manager.release_failure().await {
                Some(reason) => Err(ControlInputOutcome::ReleaseFailed(reason)),
                None if matches!(err, InputError::SequenceGap { .. } | InputError::QueueOverflow) =>
                    Err(ControlInputOutcome::DispatchFailed),
                None => Ok(false),
            }
        }
    }
}

pub(crate) async fn drain_control_input(
    ctx: &ControlInputContext<'_>,
    origin: Option<Uuid>,
) -> ControlInputOutcome {
    let mut changed = ctx.input_manager.subscribe_input_queue();
    loop {
        changed.borrow_and_update();
        let (msg, _claim) = match ctx.input_manager.claim_queued_from(origin).await {
            Some(claim) => claim,
            None if !ctx.input_manager.has_queued_from(origin).await => break,
            None => {
                if changed.changed().await.is_err() {
                    break;
                }
                continue;
            }
        };
        let kind = event_kind(&msg.event);
        // Arm before sleeping or waiting on the gate: a dequeued release must not
        // disappear if the socket handler is cancelled while pacing or while another
        // native operation owns the gate.
        let mut abandon = DispatchAbandonGuard {
            manager: ctx.input_manager.clone(),
            token: Some(msg.lease_token.clone()),
            gate: None,
            pending: None,
            pending_op: None,
            cancellation: None,
        };
        if origin.is_some() {
            if let Some(delay) = ctx
                .input_manager
                .compute_human_mouse_pacing_delay(&msg.event)
                .await
            {
                tokio::time::sleep(delay).await;
            }
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
        // Resolve only after the claim is armed, so cancellation cannot lose a release.
        let native = match get_producer(ctx.session_id).await {
            Some(producer) => match producer.ensure_page_session().await {
                Ok(page_session_id) => Some((producer, page_session_id)),
                Err(_) => None,
            },
            None => None,
        };
        let Some((producer, page_session_id)) = native else {
            if let Some(gate) = ctx.input_manager.begin_dispatch(&msg.lease_token).await {
                abandon.token = None;
                if let Err(InputError::ReleaseFailed(reason)) =
                    ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
                {
                    return ControlInputOutcome::ReleaseFailed(reason);
                }
            }
            return ControlInputOutcome::DispatchFailed;
        };
        let Some(dispatching) = ctx.input_manager.begin_dispatch(&msg.lease_token).await else {
            abandon.token = None;
            continue;
        };
        abandon.gate = Some(dispatching);
        if matches!(msg.event, InputEvent::PointerCancel) {
            let gate = abandon.gate.take().expect("dispatch gate");
            let result = ctx.input_manager.cancel_pointer_owned(gate, &msg.lease_token).await;
            abandon.token = None;
            match result {
                Ok(true) => {}
                Ok(false) => return ControlInputOutcome::DispatchFailed,
                Err(InputError::ReleaseFailed(reason)) => return ControlInputOutcome::ReleaseFailed(reason),
                Err(_) => return ControlInputOutcome::DispatchFailed,
            }
            continue;
        }
        if msg.viewport_epoch != producer.viewport_epoch()
            || (projects && !producer.input_geometry_trusted())
        {
            warn!(session_id = %ctx.session_id, kind, "input geometry changed");
            if !ctx.input_manager.has_unresolved_native_input(abandon.gate.as_ref().expect("dispatch gate")).await {
                abandon.token = None;
                continue;
            }
            let gate = abandon.gate.take().expect("dispatch gate");
            abandon.token = None;
            if let Err(InputError::ReleaseFailed(reason)) =
                ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
            {
                return ControlInputOutcome::ReleaseFailed(reason);
            }
            return ControlInputOutcome::DispatchFailed;
        }
        let geometry = producer.geometry().await;
        let fraction = match &msg.event {
            InputEvent::PointerDown { u, v, .. }
            | InputEvent::PointerUp { u, v, .. }
            | InputEvent::PointerMove { u, v, .. }
            | InputEvent::Wheel { u, v, .. } => Some((*u, *v)),
            _ => None,
        };
        if fraction.is_some_and(|(u, v)| map_fraction_to_css_coords(u, v, &geometry).is_err()) {
            if !ctx.input_manager.has_unresolved_native_input(abandon.gate.as_ref().expect("dispatch gate")).await {
                abandon.token = None;
                continue;
            }
            let gate = abandon.gate.take().expect("dispatch gate");
            abandon.token = None;
            if let Err(InputError::ReleaseFailed(reason)) =
                ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
            {
                return ControlInputOutcome::ReleaseFailed(reason);
            }
            return ControlInputOutcome::DispatchFailed;
        }
        let target = NativeInputTarget {
            client: producer.cdp_client.clone(),
            page_session_id: page_session_id.clone(),
            geometry: geometry.clone(),
        };
        let identity = CapturedNativeIdentity::from_cdp_target(
            target,
            producer.target_id().to_string(),
            producer.browser_incarnation().to_string(),
            msg.profile_epoch,
        );
        let pending_op = match ctx
            .input_manager
            .prepare_native_input_with_identity(
                abandon.gate.as_ref().expect("dispatch gate"),
                identity,
                &msg.event,
            )
            .await
        {
            Ok(op) => op,
            Err(_) => {
                let gate = abandon.gate.take().expect("dispatch gate");
                abandon.token = None;
                if let Err(InputError::ReleaseFailed(reason)) =
                    ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
                {
                    return ControlInputOutcome::ReleaseFailed(reason);
                }
                return ControlInputOutcome::DispatchFailed;
            }
        };
        abandon.pending_op = pending_op;
        debug!(session_id = %ctx.session_id, kind, "Dispatching CDP input event");
        let mouse_ctx = ctx
            .input_manager
            .prepare_mouse_dispatch(&msg.event, &geometry)
            .await;
        let cancellation = InputCommandCancellation::new();
        if !ctx.input_manager.register_input_cancellation(
            abandon.gate.as_ref().expect("dispatch gate"),
            &msg.lease_token,
            cancellation.clone(),
        ).await {
            if let Some(op) = abandon.pending_op.take() {
                ctx.input_manager
                    .reject_native_op(abandon.gate.as_ref().expect("dispatch gate"), op)
                    .await;
            }
            return ControlInputOutcome::DispatchFailed;
        }
        abandon.cancellation = Some(cancellation.clone());
        let result = match enqueue_cancellable_input(
            &producer.cdp_client,
            &page_session_id,
            &geometry,
            &msg.event,
            mouse_ctx,
            cancellation,
        ) {
            Ok(Some(command)) => {
                abandon.pending = Some(command);
                let result = abandon.pending.as_mut().expect("pending command").wait_mut().await;
                abandon.pending = None;
                match result {
                    Ok(_) => Ok(()),
                    Err(err) => {
                        if let Some(op) = abandon.pending_op.take() {
                            if err.outcome_is_ambiguous() {
                                ctx.input_manager
                                    .mark_native_op_ambiguous(
                                        abandon.gate.as_ref().expect("dispatch gate"),
                                        op,
                                    )
                                    .await;
                            } else {
                                ctx.input_manager
                                    .reject_native_op(
                                        abandon.gate.as_ref().expect("dispatch gate"),
                                        op,
                                    )
                                    .await;
                            }
                        } else if err.outcome_is_ambiguous() {
                            ctx.input_manager.mark_native_outcome_uncertain();
                        }
                        Err(err)
                    }
                }
            }
            Ok(None) => {
                if let Some(op) = abandon.pending_op.take() {
                    ctx.input_manager
                        .reject_native_op(abandon.gate.as_ref().expect("dispatch gate"), op)
                        .await;
                }
                let gate = abandon.gate.take().expect("dispatch gate");
                abandon.token = None;
                if let Err(InputError::ReleaseFailed(reason)) =
                    ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
                {
                    return ControlInputOutcome::ReleaseFailed(reason);
                }
                return ControlInputOutcome::DispatchFailed;
            }
            Err(error) => {
                if let Some(op) = abandon.pending_op.take() {
                    if error.outcome_is_ambiguous() {
                        ctx.input_manager
                            .mark_native_op_ambiguous(
                                abandon.gate.as_ref().expect("dispatch gate"),
                                op,
                            )
                            .await;
                    } else {
                        ctx.input_manager
                            .reject_native_op(
                                abandon.gate.as_ref().expect("dispatch gate"),
                                op,
                            )
                            .await;
                    }
                } else if error.outcome_is_ambiguous() {
                    ctx.input_manager.mark_native_outcome_uncertain();
                }
                Err(error)
            }
        };
        if let Err(err) = result {
            warn!(session_id = %ctx.session_id, kind, error = %err, "CDP input dispatch failed");
            let gate = abandon.gate.take().expect("dispatch gate");
            abandon.token = None;
            if let Err(InputError::ReleaseFailed(reason)) =
                ctx.input_manager.fail_native_dispatch(gate, &msg.lease_token).await
            {
                return ControlInputOutcome::ReleaseFailed(reason);
            }
            return ControlInputOutcome::DispatchFailed;
        }
        if let Some(op) = abandon.pending_op.take() {
            ctx.input_manager
                .confirm_native_op(abandon.gate.as_ref().expect("dispatch gate"), op)
                .await;
        }
        abandon.token = None;
    }
    ControlInputOutcome::Continue
}
