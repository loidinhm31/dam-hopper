//! Native identity of dispatched input and the lease-expiry watcher.
//!
//! A control lease's held keys/buttons must be released on the EXACT native page session the
//! input was dispatched on, whatever later happens to the producer registry, so the identity is
//! captured when input is first held and every termination path releases through it.

use std::fmt;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use uuid::Uuid;

use super::cdp::{CdpClient, CdpError};
use super::input::{InputEvent, MouseButton, SessionInputManager};
use super::media::{
    dispatch_input_event_to_cdp, dispatch_mouse_release_css_to_cdp, keyboard_event_params,
};
use super::protocol::{TargetGeometry, COMMAND_TIMEOUT_SECS};

/// Captured native identity: the CDP connection, its flattened page session and the geometry
/// pointer fractions were projected through.
#[derive(Clone)]
pub struct NativeInputTarget {
    pub client: Arc<CdpClient>,
    pub page_session_id: String,
    pub geometry: TargetGeometry,
}

impl fmt::Debug for NativeInputTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeInputTarget")
            .field("page_session_id", &self.page_session_id)
            .finish_non_exhaustive()
    }
}

impl NativeInputTarget {
    /// Dispatches one event on this exact native identity, preserving outcome ambiguity.
    pub async fn dispatch(&self, event: &InputEvent) -> Result<(), CdpError> {
        dispatch_input_event_to_cdp(&self.client, &self.page_session_id, &self.geometry, event)
            .await
    }
}

/// Last known pointer coordinates for held-button release across UI (fractional) and CDP (CSS).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NativePointerPosition {
    Fraction(f64, f64),
    Css(f64, f64),
}

impl Default for NativePointerPosition {
    fn default() -> Self {
        Self::Fraction(0.0, 0.0)
    }
}

/// Authority-owned release command sent over a captured DevTools proxy page socket.
pub struct ProxyCleanupCommand {
    pub method: &'static str,
    pub params: serde_json::Value,
    pub reply: oneshot::Sender<Result<(), CdpError>>,
}

/// Captured DevTools proxy release channel bound to a single socket connection.
#[derive(Clone)]
pub struct DevToolsProxyReleaseRoute {
    pub conn_id: Uuid,
    pub sender: mpsc::Sender<ProxyCleanupCommand>,
}

impl fmt::Debug for DevToolsProxyReleaseRoute {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DevToolsProxyReleaseRoute")
            .field("conn_id", &self.conn_id)
            .finish_non_exhaustive()
    }
}

impl DevToolsProxyReleaseRoute {
    async fn dispatch(&self, method: &'static str, params: serde_json::Value) -> Result<(), CdpError> {
        let (tx, rx) = oneshot::channel();
        if self
            .sender
            .send(ProxyCleanupCommand {
                method,
                params,
                reply: tx,
            })
            .await
            .is_err()
        {
            return Err(CdpError::CancelledBeforeWrite);
        }
        match tokio::time::timeout(Duration::from_secs(COMMAND_TIMEOUT_SECS), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err(CdpError::ConnectionClosed),
            Err(_) => Err(CdpError::CommandTimeout),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReleaseInputEvent {
    PointerUp {
        button: MouseButton,
        position: NativePointerPosition,
    },
    KeyUp {
        key: String,
        code: String,
    },
}

/// Exact native target/incarnation identity captured when a physical hold is reserved.
#[derive(Clone, Debug)]
pub struct CapturedNativeIdentity {
    pub native_target_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub cdp_target: Option<NativeInputTarget>,
    pub proxy_route: Option<DevToolsProxyReleaseRoute>,
}

impl CapturedNativeIdentity {
    pub fn from_cdp_target(
        target: NativeInputTarget,
        native_target_id: String,
        browser_incarnation: String,
        profile_epoch: u64,
    ) -> Self {
        Self {
            native_target_id,
            browser_incarnation,
            profile_epoch,
            cdp_target: Some(target),
            proxy_route: None,
        }
    }

    pub fn matches(&self, other: &Self) -> bool {
        if !self.native_target_id.is_empty()
            && !other.native_target_id.is_empty()
            && (self.native_target_id != other.native_target_id
                || self.browser_incarnation != other.browser_incarnation
                || self.profile_epoch != other.profile_epoch)
        {
            return false;
        }
        if let (Some(a), Some(b)) = (&self.cdp_target, &other.cdp_target) {
            if !Arc::ptr_eq(&a.client, &b.client) || a.page_session_id != b.page_session_id {
                return false;
            }
        }
        true
    }

    pub fn merge_route(&mut self, other: &Self) {
        if self.cdp_target.is_none() {
            self.cdp_target = other.cdp_target.clone();
        }
        if let Some(route) = &other.proxy_route {
            self.proxy_route = Some(route.clone());
        }
        if self.native_target_id.is_empty() && !other.native_target_id.is_empty() {
            self.native_target_id = other.native_target_id.clone();
            self.browser_incarnation = other.browser_incarnation.clone();
            self.profile_epoch = other.profile_epoch;
        }
    }

    pub async fn dispatch_release(&self, event: &ReleaseInputEvent) -> Result<(), CdpError> {
        if let Some(route) = &self.proxy_route {
            let cmd = match event {
                ReleaseInputEvent::KeyUp { key, code } => {
                    Some(("Input.dispatchKeyEvent", keyboard_event_params(key, code, 0, false)))
                }
                ReleaseInputEvent::PointerUp { button, position } => {
                    let coords = match position {
                        NativePointerPosition::Css(x, y) => Some((*x, *y)),
                        NativePointerPosition::Fraction(u, v) => {
                            self.cdp_target.as_ref().map(|t| {
                                let x = (u * t.geometry.css_width).clamp(0.0, t.geometry.css_width);
                                let y = (v * t.geometry.css_height + t.geometry.offset_top)
                                    .clamp(0.0, t.geometry.css_height + t.geometry.offset_top);
                                (x, y)
                            })
                        }
                    };
                    coords.map(|(x, y)| {
                        (
                            "Input.dispatchMouseEvent",
                            serde_json::json!({
                                "type": "mouseReleased",
                                "x": x,
                                "y": y,
                                "modifiers": 0,
                                "buttons": 0,
                                "button": button.as_cdp_str(),
                                "clickCount": 1,
                            }),
                        )
                    })
                }
            };
            if let Some((method, params)) = cmd {
                match route.dispatch(method, params).await {
                    Ok(()) => return Ok(()),
                    Err(CdpError::CancelledBeforeWrite) if self.cdp_target.is_some() => {
                        // Proxy channel closed cleanly before writing; fall back to captured internal route.
                    }
                    Err(err) => return Err(err),
                }
            }
        }
        let Some(cdp) = &self.cdp_target else {
            return Err(CdpError::ConnectionClosed);
        };
        match event {
            ReleaseInputEvent::KeyUp { key, code } => {
                cdp.dispatch(&InputEvent::KeyUp {
                    key: key.clone(),
                    code: code.clone(),
                    modifiers: 0,
                })
                .await
            }
            ReleaseInputEvent::PointerUp { button, position } => match position {
                NativePointerPosition::Fraction(u, v) => {
                    cdp.dispatch(&InputEvent::PointerUp {
                        button: *button,
                        u: *u,
                        v: *v,
                        modifiers: 0,
                    })
                    .await
                }
                NativePointerPosition::Css(x, y) => {
                    dispatch_mouse_release_css_to_cdp(
                        &cdp.client,
                        &cdp.page_session_id,
                        *button,
                        *x,
                        *y,
                    )
                    .await
                }
            },
        }
    }
}

/// Active expiry: sleeps until the lease's own deadline and ends it (releasing held native
/// input) with no incoming traffic. The watcher holds only a `Weak` manager plus the expiry
/// channel, so it ends when the manager is dropped.
pub fn spawn_expiry_watcher(
    manager: Weak<SessionInputManager>,
    mut expiry: watch::Receiver<Option<Instant>>,
) {
    tokio::spawn(async move {
        loop {
            let deadline = *expiry.borrow_and_update();
            match deadline {
                None => {
                    if expiry.changed().await.is_err() {
                        return;
                    }
                }
                Some(at) => {
                    tokio::select! {
                        changed = expiry.changed() => {
                            if changed.is_err() {
                                return;
                            }
                        }
                        _ = tokio::time::sleep_until(at) => {
                            let Some(manager) = manager.upgrade() else {
                                return;
                            };
                            if let Err(err) = manager.expire_if_due().await {
                                tracing::warn!(error = %err, "expired lease: native input release failed");
                            }
                        }
                    }
                }
            }
        }
    });
}
