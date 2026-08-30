use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    command, AppHandle, Emitter, Manager, Runtime, State, Webview, WebviewBuilder, WebviewUrl,
    WebviewWindow,
};
use url::Url;

use super::{
    navigation_policy::{parse_target_url, NavigationPolicy},
    platform::{self, PlatformRelayError, PlatformRelayResult, RelayCallback},
    profile_storage::ProfileStorage,
    protocol,
};

const MAIN_LABEL: &str = "main";
const CHILD_LABEL: &str = "browser-debug";
const RELAY_EVENT: &str = "browser-debug:relay";
const RELAY_REJECTED_EVENT: &str = "browser-debug:relay-rejected";
const COMMAND_EVENT: &str = "__DAM_HOPPER_BROWSER_DEBUG_COMMAND__";
const CONFIG_GLOBAL: &str = "__DAM_HOPPER_BROWSER_DEBUG_CONFIG__";
const BRIDGE_IIFE: &str = include_str!(concat!(env!("OUT_DIR"), "/browser-debug-bridge.iife.js"));

// The child is an untrusted remote document. Wry forwards every WebView2 IPC
// message through Tauri's invoke parser, which writes malformed messages back
// with console.error. Mirroring console events over that same channel therefore
// creates an unbounded feedback loop. Keep the safe navigation relay enabled
// until console data has an isolated native transport.
const NATIVE_BRIDGE_CAPABILITIES: &[&str] = &["navigation"];

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugCreateInput {
    pub profile_id: String,
    pub url: String,
    #[serde(default)]
    pub allowed_tunnel_origins: Vec<String>,
    #[serde(default)]
    pub bounds: BrowserDebugBounds,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugBounds {
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugNavigateInput {
    pub url: String,
    #[serde(default)]
    pub allowed_tunnel_origins: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugState {
    pub label: String,
    pub profile_id: String,
    pub session_id: String,
    pub committed_url: String,
    pub committed_origin: String,
    pub generation: u64,
    pub visible: bool,
    pub relay_installed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedRelay {
    label: &'static str,
    profile_id: String,
    session_id: String,
    generation: u64,
    origin: String,
    data: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RejectedRelay {
    label: &'static str,
    profile_id: String,
    session_id: String,
    generation: u64,
    reason: &'static str,
}

struct ActiveBrowser {
    profile_id: String,
    session_id: String,
    storage: ProfileStorage,
    policy: NavigationPolicy,
    committed_url: Url,
    committed_origin: String,
    generation: u64,
    nonce: String,
    request_ids: Vec<String>,
    connect_request_id: String,
    bounds: BrowserDebugBounds,
    visible: bool,
    relay_installed: bool,
}

#[derive(Default)]
struct ControllerState {
    active: Option<ActiveBrowser>,
}

#[derive(Default)]
pub struct BrowserDebugController {
    state: Mutex<ControllerState>,
    // Child creation and teardown must not interleave. This guard spans every
    // synchronous WebView side effect in the lifecycle operation.
    lifecycle: Mutex<()>,
    main_window: Mutex<Option<WebviewWindow>>,
}

impl BrowserDebugController {
    pub fn register_main_window(&self, window: WebviewWindow) {
        *self
            .main_window
            .lock()
            .expect("browser debug main window lock") = Some(window);
    }

    fn main_window(&self) -> Result<WebviewWindow, String> {
        self.main_window
            .lock()
            .expect("browser debug main window lock")
            .clone()
            .ok_or_else(|| "browser-debug main window is unavailable".into())
    }

    pub fn create(
        self: &Arc<Self>,
        main: WebviewWindow,
        input: BrowserDebugCreateInput,
    ) -> Result<BrowserDebugState, String> {
        if main.label() != MAIN_LABEL {
            return Err("browser-debug commands are main-webview only".into());
        }
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        let target = parse_target_url(&input.url)?;
        let policy = NavigationPolicy::new(&input.allowed_tunnel_origins)?;
        if !policy.allows(&target) {
            return Err("target URL is not an approved loopback or tunnel origin".into());
        }
        validate_bounds(&input.bounds)?;
        validate_zoom(input.zoom)?;
        let storage = ProfileStorage::resolve(main.app_handle(), &input.profile_id)?;
        let nonce = random_id("nonce")?;
        let connect_request_id = random_id("request")?;
        let active = ActiveBrowser {
            profile_id: input.profile_id.clone(),
            session_id: random_id("browser-debug-session")?,
            storage,
            policy: policy.clone(),
            committed_url: target.clone(),
            committed_origin: NavigationPolicy::origin_for(&target)
                .ok_or("target has no origin")?,
            generation: 0,
            nonce,
            request_ids: vec![connect_request_id.clone()],
            connect_request_id,
            bounds: input.bounds.clone(),
            visible: input.visible,
            relay_installed: false,
        };
        {
            let state = self.state.lock().expect("browser debug state lock");
            if state.active.is_some() {
                return Err("browser-debug child already exists".into());
            }
        }
        if let Some(existing) = main.app_handle().get_webview(CHILD_LABEL) {
            existing
                .close()
                .map_err(|error| format!("close stale browser-debug child: {error}"))?;
        }
        {
            let mut state = self.state.lock().expect("browser debug state lock");
            if state.active.is_some() {
                return Err("browser-debug child already exists".into());
            }
            state.active = Some(active);
        }

        let controller = self.clone();
        let navigation_controller = self.clone();
        let page_controller = self.clone();
        let relay_session_id = self
            .state
            .lock()
            .expect("browser debug state lock")
            .active
            .as_ref()
            .map(|active| active.session_id.clone())
            .ok_or("browser-debug state missing")?;
        let relay_callback_session_id = relay_session_id.clone();
        let page_callback_session_id = relay_session_id.clone();
        let navigation_callback_session_id = relay_session_id.clone();
        let relay_callback: RelayCallback = Arc::new(move |source_url, raw| {
            let result = controller.accept_relay(&relay_callback_session_id, &source_url, &raw);
            if let Err(reason) = result {
                controller.emit_relay_rejected(&relay_callback_session_id, reason);
            }
        });
        let app_for_page = main.app_handle().clone();
        let bridge_script = bridge_bootstrap_script();
        let builder = WebviewBuilder::new(CHILD_LABEL, WebviewUrl::External(target.clone()))
            .data_directory(self.active_storage_path()?)
            .initialization_script_for_all_frames(bridge_script)
            .on_navigation(move |url| {
                navigation_controller.navigation_requested(url, &navigation_callback_session_id)
            })
            .on_page_load(move |webview, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    page_controller.page_loaded(
                        &app_for_page,
                        &webview,
                        payload.url(),
                        &page_callback_session_id,
                    );
                }
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false);

        // Keep the child as a webview of the existing main window. This is the
        // multi-webview API; no remote target capability is attached to it.
        let parent = main.as_ref().window();
        let child = match parent.add_child(
            builder,
            tauri::LogicalPosition::new(input.bounds.left, input.bounds.top),
            tauri::LogicalSize::new(input.bounds.width, input.bounds.height),
        ) {
            Ok(child) => child,
            Err(error) => {
                self.clear_state();
                return Err(format!("create browser-debug child: {error}"));
            }
        };
        if let Err(error) = child.set_zoom(input.zoom) {
            let close_error = child.close().err();
            self.clear_state();
            return Err(match close_error {
                Some(close_error) => format!(
                    "set browser-debug zoom: {error}; close browser-debug child: {close_error}"
                ),
                None => format!("set browser-debug zoom: {error}"),
            });
        }
        let relay_result = match platform::install_relay(&child, relay_callback) {
            Ok(result) => result,
            Err(PlatformRelayError::Unavailable(error)) => {
                eprintln!("browser-debug relay unavailable: {error}");
                PlatformRelayResult::Unsupported
            }
            Err(PlatformRelayError::Security(error)) => {
                let close_error = child.close().err();
                self.clear_state();
                return Err(match close_error {
                    Some(close_error) => format!(
                        "browser-debug security hook unavailable: {error}; close browser-debug child: {close_error}"
                    ),
                    None => format!("browser-debug security hook unavailable: {error}"),
                });
            }
        };
        {
            let mut state = self.state.lock().expect("browser debug state lock");
            if let Some(active) = state.active.as_mut() {
                active.relay_installed = relay_result == PlatformRelayResult::Installed;
            }
        }
        // A fast loopback page can finish before the platform relay hook is
        // attached. Prefer a redirect observed by the navigation callback,
        // then the child's current URL, so replay cannot restore stale policy
        // state after an approved redirect.
        let (committed_url, replay_generation) = {
            let state = self.state.lock().expect("browser debug state lock");
            state
                .active
                .as_ref()
                .map(|active| (active.committed_url.clone(), active.generation))
                .unzip()
        };
        let replay_url = select_replay_url(&target, committed_url, child.url().ok());
        if let (Some(replay_url), Some(replay_generation)) = (replay_url, replay_generation) {
            self.page_loaded_replay(
                main.app_handle(),
                &child,
                &replay_url,
                replay_generation,
                &relay_session_id,
            );
        }

        let visibility_result = if input.visible {
            child.show()
        } else {
            child.hide()
        };
        if let Err(error) = visibility_result {
            let action = if input.visible { "show" } else { "hide" };
            let close_error = child.close().err();
            self.clear_state();
            return Err(match close_error {
                Some(close_error) => format!(
                    "{action} browser-debug child: {error}; close browser-debug child: {close_error}"
                ),
                None => format!("{action} browser-debug child: {error}"),
            });
        }
        self.snapshot()
    }

    fn active_storage_path(&self) -> Result<std::path::PathBuf, String> {
        self.state
            .lock()
            .expect("browser debug state lock")
            .active
            .as_ref()
            .map(|active| active.storage.directory.clone())
            .ok_or_else(|| "browser-debug state missing".to_string())
    }

    fn navigation_requested(&self, url: &Url, session_id: &str) -> bool {
        let mut state = self.state.lock().expect("browser debug state lock");
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if active.session_id != session_id {
            return false;
        }
        if !active.policy.allows(url) {
            return false;
        }
        let Some(origin) = NavigationPolicy::origin_for(url) else {
            return false;
        };
        let Ok(nonce) = random_id("nonce") else {
            return false;
        };
        let Ok(connect_request_id) = random_id("request") else {
            return false;
        };
        active.generation = active.generation.saturating_add(1);
        active.nonce = nonce;
        active.connect_request_id = connect_request_id.clone();
        active.request_ids.clear();
        remember_request(active, connect_request_id);
        active.committed_url = url.clone();
        active.committed_origin = origin;
        true
    }

    fn page_loaded(&self, app: &AppHandle, webview: &Webview, url: &Url, session_id: &str) {
        self.page_loaded_inner(app, webview, url, session_id, None, false);
    }

    fn page_loaded_replay(
        &self,
        app: &AppHandle,
        webview: &Webview,
        url: &Url,
        generation: u64,
        session_id: &str,
    ) {
        self.page_loaded_inner(app, webview, url, session_id, Some(generation), true);
    }

    fn page_loaded_inner(
        &self,
        _app: &AppHandle,
        webview: &Webview,
        url: &Url,
        session_id: &str,
        expected_generation: Option<u64>,
        allow_redirect: bool,
    ) {
        let current_url = webview.url().ok();
        let (generation, nonce, request_id, origin) = {
            let mut state = self.state.lock().expect("browser debug state lock");
            let Some(active) = state.active.as_mut() else {
                return;
            };
            if active.session_id != session_id || !active.policy.allows(url) {
                return;
            }
            if current_url
                .as_ref()
                .is_some_and(|current_url| current_url != url)
            {
                return;
            }
            if let Some(expected_generation) = expected_generation {
                if active.generation != expected_generation {
                    return;
                }
            } else if !page_load_is_current(current_url.as_ref(), &active.committed_url, url) {
                // Wry does not expose WebView2's NavigationId on page-load
                // callbacks. Finished callbacks therefore only replay the
                // credentials selected by the latest navigation callback.
                return;
            }
            let Some(origin) = NavigationPolicy::origin_for(url) else {
                return;
            };
            if allow_redirect {
                active.committed_url = url.clone();
                active.committed_origin = origin;
            }
            (
                active.generation,
                active.nonce.clone(),
                active.connect_request_id.clone(),
                active.committed_origin.clone(),
            )
        };
        let config = json!({
            "label": CHILD_LABEL,
            "generation": generation,
            "nonce": nonce,
            "requestId": request_id,
            "origin": origin,
        });
        let detail = json!({
            "version": 1,
            "type": "dam-hopper:connect",
            "nonce": config["nonce"],
            "requestId": config["requestId"],
        });
        let script = format!(
            "window.{CONFIG_GLOBAL}={config};window.dispatchEvent(new CustomEvent({event},{{detail:{detail}}}));",
            config = config,
            event = serde_json::to_string(COMMAND_EVENT).unwrap_or_else(|_| "\"\"".into()),
            detail = detail,
        );
        let _ = webview.eval(script);
    }

    fn accept_relay(
        &self,
        session_id: &str,
        source_url: &str,
        raw: &str,
    ) -> Result<(), &'static str> {
        let message = protocol::parse_relay(raw)?;
        let (profile_id, generation, origin) = {
            let state = self.state.lock().expect("browser debug state lock");
            let active = state.active.as_ref().ok_or("no_active_child")?;
            if active.session_id != session_id {
                return Err("stale_child_session");
            }
            if message.label != CHILD_LABEL || message.generation != active.generation {
                return Err("stale_child_generation");
            }
            if message.nonce != active.nonce
                || !active
                    .request_ids
                    .iter()
                    .any(|id| id == &message.request_id)
            {
                return Err("invalid_nonce_or_request");
            }
            let source = Url::parse(source_url).map_err(|_| "invalid_source_url")?;
            let source_origin =
                NavigationPolicy::origin_for(&source).ok_or("invalid_source_origin")?;
            if source_origin != active.committed_origin || message.origin != source_origin {
                return Err("origin_mismatch");
            }
            if message.kind == "browser-bridge-event"
                && data_is_navigation_to_unapproved_origin(&message.payload, &active.policy)
            {
                return Err("navigation_origin_rejected");
            }
            (
                active.profile_id.clone(),
                active.generation,
                active.committed_origin.clone(),
            )
        };
        let main = self.main_window().map_err(|_| "main_window_missing")?;
        let event = AcceptedRelay {
            label: CHILD_LABEL,
            profile_id,
            session_id: session_id.to_string(),
            generation,
            origin,
            data: message.payload,
        };
        main.emit(RELAY_EVENT, event)
            .map_err(|_| "relay_emit_failed")
    }

    fn emit_relay_rejected(&self, session_id: &str, reason: &'static str) {
        let event = {
            let state = self.state.lock().expect("browser debug state lock");
            let Some(active) = state.active.as_ref() else {
                return;
            };
            if active.session_id != session_id {
                return;
            }
            RejectedRelay {
                label: CHILD_LABEL,
                profile_id: active.profile_id.clone(),
                session_id: active.session_id.clone(),
                generation: active.generation,
                reason,
            }
        };
        if let Ok(main) = self.main_window() {
            let _ = main.emit(RELAY_REJECTED_EVENT, event);
        }
    }

    fn dispatch_command(&self, app: &AppHandle, command: &str) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        let webview = app
            .get_webview(CHILD_LABEL)
            .ok_or_else(|| "browser-debug child missing".to_string())?;
        let (generation, nonce, request_id) = {
            let mut state = self.state.lock().expect("browser debug state lock");
            let active = state
                .active
                .as_mut()
                .ok_or_else(|| "browser-debug state missing".to_string())?;
            let request_id = random_id("request")?;
            remember_request(active, request_id.clone());
            (active.generation, active.nonce.clone(), request_id)
        };
        let detail = json!({
            "version": 1,
            "type": command,
            "nonce": nonce,
            "requestId": request_id,
        });
        let script = format!(
            "window.dispatchEvent(new CustomEvent({event},{{detail:{detail}}}));",
            event = serde_json::to_string(COMMAND_EVENT).map_err(|_| "encode command event")?,
            detail = detail,
        );
        let _ = generation;
        webview
            .eval(script)
            .map_err(|error| format!("dispatch browser command: {error}"))
    }

    fn navigate(&self, app: &AppHandle, input: BrowserDebugNavigateInput) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        let target = parse_target_url(&input.url)?;
        let webview = app
            .get_webview(CHILD_LABEL)
            .ok_or("browser-debug child missing")?;
        {
            let state = self.state.lock().expect("browser debug state lock");
            let active = state.active.as_ref().ok_or("browser-debug state missing")?;
            let requested_policy = NavigationPolicy::new(&input.allowed_tunnel_origins)?;
            if !requested_policy.allows(&target) || !active.policy.allows(&target) {
                return Err("navigation target is not approved".into());
            }
        }
        webview
            .navigate(target)
            .map_err(|error| format!("navigate browser-debug child: {error}"))
    }

    fn set_bounds(&self, app: &AppHandle, bounds: BrowserDebugBounds) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        validate_bounds(&bounds)?;
        let webview = app
            .get_webview(CHILD_LABEL)
            .ok_or("browser-debug child missing")?;
        webview
            .set_position(tauri::LogicalPosition::new(bounds.left, bounds.top))
            .and_then(|_| webview.set_size(tauri::LogicalSize::new(bounds.width, bounds.height)))
            .map_err(|error| format!("set browser-debug bounds: {error}"))?;
        if let Some(active) = self
            .state
            .lock()
            .expect("browser debug state lock")
            .active
            .as_mut()
        {
            active.bounds = bounds;
        }
        Ok(())
    }

    fn set_zoom(&self, app: &AppHandle, zoom: f64) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        validate_zoom(zoom)?;
        let webview = app
            .get_webview(CHILD_LABEL)
            .ok_or("browser-debug child missing")?;
        webview
            .set_zoom(zoom)
            .map_err(|error| format!("set browser-debug zoom: {error}"))?;
        Ok(())
    }

    fn set_visible(&self, app: &AppHandle, visible: bool) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        let webview = app
            .get_webview(CHILD_LABEL)
            .ok_or("browser-debug child missing")?;
        if visible {
            webview.show()
        } else {
            webview.hide()
        }
        .map_err(|error| format!("set browser-debug visibility: {error}"))?;
        if let Some(active) = self
            .state
            .lock()
            .expect("browser debug state lock")
            .active
            .as_mut()
        {
            active.visible = visible;
        }
        Ok(())
    }

    pub fn destroy<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        self.destroy_locked(app)
    }

    fn destroy_locked<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        if let Some(child) = app.get_webview(CHILD_LABEL) {
            child
                .close()
                .map_err(|error| format!("destroy browser-debug child: {error}"))?;
        }
        self.clear_state();
        Ok(())
    }
    fn clear_profile(&self, app: &AppHandle, profile_id: &str) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().expect("browser debug lifecycle lock");
        let storage = {
            let state = self.state.lock().expect("browser debug state lock");
            state.active.as_ref().and_then(|active| {
                (active.profile_id == profile_id).then(|| active.storage.clone())
            })
        };
        if storage.is_some() {
            self.destroy_locked(app)?;
        }
        let storage = storage.unwrap_or(ProfileStorage::resolve(app, profile_id)?);
        storage.clear()
    }

    fn clear_state(&self) {
        self.state.lock().expect("browser debug state lock").active = None;
    }

    fn snapshot(&self) -> Result<BrowserDebugState, String> {
        let state = self.state.lock().expect("browser debug state lock");
        let active = state
            .active
            .as_ref()
            .ok_or_else(|| "browser-debug state missing".to_string())?;
        Ok(BrowserDebugState {
            label: CHILD_LABEL.into(),
            profile_id: active.profile_id.clone(),
            session_id: active.session_id.clone(),
            committed_url: active.committed_url.to_string(),
            committed_origin: active.committed_origin.clone(),
            generation: active.generation,
            visible: active.visible,
            relay_installed: active.relay_installed,
        })
    }

    pub fn cleanup_on_main_close<R: Runtime>(&self, app: &AppHandle<R>) {
        let _ = self.destroy(app);
    }
}

fn data_is_navigation_to_unapproved_origin(value: &Value, policy: &NavigationPolicy) -> bool {
    if value.get("type").and_then(Value::as_str) != Some("dam-hopper:navigation") {
        return false;
    }
    match value
        .get("url")
        .and_then(Value::as_str)
        .and_then(|url| parse_target_url(url).ok())
    {
        Some(url) => !policy.allows(&url),
        None => true,
    }
}

fn remember_request(active: &mut ActiveBrowser, request_id: String) {
    active.request_ids.push(request_id);
    while active.request_ids.len() > 64 {
        let index = active
            .request_ids
            .iter()
            .position(|id| id != &active.connect_request_id)
            .unwrap_or(0);
        active.request_ids.remove(index);
    }
}

fn random_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 24];
    getrandom::fill(&mut bytes).map_err(|error| format!("generate {prefix}: {error}"))?;
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(format!("{prefix}-{}-{counter:x}", hex_encode(&bytes)))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
    }
    output
}

fn select_replay_url(
    requested_url: &Url,
    committed_url: Option<Url>,
    child_url: Option<Url>,
) -> Option<Url> {
    if committed_url
        .as_ref()
        .is_some_and(|url| url != requested_url)
    {
        committed_url
    } else {
        child_url.or(committed_url)
    }
}

fn page_load_is_current(current_url: Option<&Url>, committed_url: &Url, loaded_url: &Url) -> bool {
    current_url.map_or(true, |current_url| current_url == loaded_url) && committed_url == loaded_url
}

fn validate_bounds(bounds: &BrowserDebugBounds) -> Result<(), String> {
    for value in [bounds.top, bounds.left] {
        if !value.is_finite() || !(-1_000_000.0..=1_000_000.0).contains(&value) {
            return Err("browser bounds are outside the allowed range".into());
        }
    }
    for value in [bounds.width, bounds.height] {
        if !value.is_finite() || !(0.0..=1_000_000.0).contains(&value) {
            return Err("browser bounds are outside the allowed range".into());
        }
    }
    Ok(())
}

fn default_zoom() -> f64 {
    1.0
}

fn validate_zoom(zoom: f64) -> Result<(), String> {
    if !zoom.is_finite() || !(0.1..=10.0).contains(&zoom) {
        return Err("browser zoom is outside the allowed range".into());
    }
    Ok(())
}

fn ensure_main(webview: &Webview) -> Result<(), String> {
    (webview.label() == MAIN_LABEL)
        .then_some(())
        .ok_or_else(|| "browser-debug commands are main-webview only".into())
}

fn default_true() -> bool {
    true
}

fn bridge_bootstrap_script() -> String {
    let capabilities = json!(NATIVE_BRIDGE_CAPABILITIES);
    format!(
        r#"
{BRIDGE_IIFE}
(() => {{
  const commandEvent = {command_event};
  const config = () => window.{config_global} || {{}};
  const listeners = new Set();
  const channel = {{
    source: window,
    send(event, _targetOrigin) {{
      const current = config();
      if (!window.ipc || typeof window.ipc.postMessage !== 'function') return;
      window.ipc.postMessage(JSON.stringify({{
        label: current.label,
        generation: current.generation,
        nonce: event.nonce,
        requestId: event.requestId,
        kind: 'browser-bridge-event',
        origin: window.location.origin,
        payload: event
      }}));
    }},
    subscribe(listener) {{
      listeners.add(listener);
      return () => listeners.delete(listener);
    }},
    destroy() {{ listeners.clear(); }}
  }};
  window.addEventListener(commandEvent, (event) => {{
    const current = config();
    for (const listener of listeners) listener({{
      data: event.detail,
      origin: window.location.origin,
      source: window
    }});
    void current;
  }});
  window.DamHopperBrowserBridge?.installBrowserBridge?.({{
    parentOrigin: window.location.origin,
    channel,
    capabilities: {capabilities}
  }});
}})();
"#,
        BRIDGE_IIFE = BRIDGE_IIFE,
        command_event = serde_json::to_string(COMMAND_EVENT).unwrap_or_else(|_| "\"\"".into()),
        config_global = CONFIG_GLOBAL,
        capabilities = capabilities,
    )
}

#[command]
pub async fn browser_debug_create(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    input: BrowserDebugCreateInput,
) -> Result<BrowserDebugState, String> {
    ensure_main(&webview)?;
    state.create(state.main_window()?, input)
}

#[command]
pub fn browser_debug_navigate(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    input: BrowserDebugNavigateInput,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.navigate(webview.app_handle(), input)
}

#[command]
pub fn browser_debug_command(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    command: String,
) -> Result<(), String> {
    ensure_main(&webview)?;
    let command = match command.as_str() {
        "dam-hopper:start-picker"
        | "dam-hopper:stop-picker"
        | "dam-hopper:go-back"
        | "dam-hopper:go-forward"
        | "dam-hopper:reload" => command,
        _ => return Err("unsupported browser-debug command".into()),
    };
    state.dispatch_command(webview.app_handle(), &command)
}

#[command]
pub fn browser_debug_set_bounds(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    bounds: BrowserDebugBounds,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.set_bounds(webview.app_handle(), bounds)
}

#[command]
pub fn browser_debug_set_zoom(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    zoom: f64,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.set_zoom(webview.app_handle(), zoom)
}

#[command]
pub fn browser_debug_set_visible(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    visible: bool,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.set_visible(webview.app_handle(), visible)
}

#[command]
pub fn browser_debug_destroy(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.destroy(webview.app_handle())
}

#[command]
pub fn browser_debug_clear_data(
    webview: Webview,
    state: State<'_, Arc<BrowserDebugController>>,
    profile_id: String,
) -> Result<(), String> {
    ensure_main(&webview)?;
    state.clear_profile(webview.app_handle(), &profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERMISSION_MANIFEST: &str = include_str!("../../permissions/browser-debug.toml");
    const CAPABILITY_MANIFEST: &str = include_str!("../../capabilities/browser-debug.json");

    fn permission_commands(manifest: &str) -> Vec<&str> {
        manifest
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix('"'))
            .filter_map(|line| line.strip_suffix("\","))
            .collect()
    }

    #[test]
    fn permission_manifest_allows_exactly_the_browser_debug_commands() {
        assert_eq!(
            permission_commands(PERMISSION_MANIFEST),
            vec![
                "browser_debug_create",
                "browser_debug_navigate",
                "browser_debug_command",
                "browser_debug_set_bounds",
                "browser_debug_set_zoom",
                "browser_debug_set_visible",
                "browser_debug_destroy",
                "browser_debug_clear_data",
            ]
        );
    }

    #[test]
    fn capability_grants_browser_debug_to_the_main_window() {
        let capability: serde_json::Value = serde_json::from_str(CAPABILITY_MANIFEST).unwrap();
        assert_eq!(capability["identifier"], "browser-debug-main");
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["browser-debug"])
        );
    }

    #[test]
    fn generated_ids_are_bounded_and_distinct() {
        let first = random_id("nonce").unwrap();
        let second = random_id("nonce").unwrap();
        assert_ne!(first, second);
        assert!(first.len() <= protocol::MAX_NONCE_LENGTH);
    }

    #[test]
    fn bounds_allow_negative_positions_but_reject_invalid_dimensions() {
        assert!(validate_bounds(&BrowserDebugBounds {
            width: 1.0,
            height: 1.0,
            ..Default::default()
        })
        .is_ok());
        assert!(validate_bounds(&BrowserDebugBounds {
            top: -1.0,
            ..Default::default()
        })
        .is_ok());
        assert!(validate_bounds(&BrowserDebugBounds {
            left: -1.0,
            ..Default::default()
        })
        .is_ok());
        assert!(validate_bounds(&BrowserDebugBounds {
            width: -1.0,
            ..Default::default()
        })
        .is_err());
        assert!(validate_bounds(&BrowserDebugBounds {
            top: f64::NAN,
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn zoom_validation_rejects_non_finite_or_extreme_values() {
        assert!(validate_zoom(0.8).is_ok());
        assert!(validate_zoom(0.1).is_ok());
        assert!(validate_zoom(0.0).is_err());
        assert!(validate_zoom(f64::NAN).is_err());
        assert!(validate_zoom(10.1).is_err());
    }

    #[test]
    fn replay_url_preserves_redirect_state() {
        let requested = Url::parse("http://localhost:3001/").unwrap();
        let redirected = Url::parse("http://localhost:3001/login").unwrap();

        assert_eq!(
            select_replay_url(
                &requested,
                Some(redirected.clone()),
                Some(requested.clone())
            ),
            Some(redirected.clone())
        );
        assert_eq!(
            select_replay_url(
                &requested,
                Some(requested.clone()),
                Some(redirected.clone())
            ),
            Some(redirected)
        );
        assert_eq!(
            select_replay_url(&requested, Some(requested.clone()), Some(requested.clone())),
            Some(requested)
        );
    }

    #[test]
    fn page_load_validation_rejects_stale_or_failed_urls() {
        let latest = Url::parse("http://localhost:3001/latest").unwrap();
        let stale = Url::parse("http://localhost:3001/stale").unwrap();

        assert!(!page_load_is_current(Some(&latest), &latest, &stale));
        assert!(!page_load_is_current(Some(&stale), &latest, &latest));
        assert!(page_load_is_current(Some(&latest), &latest, &latest));
        assert!(page_load_is_current(None, &latest, &latest));
    }

    #[test]
    fn native_bridge_does_not_mirror_console_events_over_tauri_ipc() {
        assert_eq!(NATIVE_BRIDGE_CAPABILITIES, ["navigation"]);
    }

    #[test]
    fn bootstrap_does_not_install_viewport_shortcuts_in_the_child() {
        let script = bridge_bootstrap_script();
        assert!(!script.contains("browser-debug-viewport-step"));
        assert!(!script.contains("event.code === 'Equal'"));
        assert!(!script.contains("event.code === 'Minus'"));
    }

    #[test]
    fn navigation_events_cannot_escape_the_active_policy() {
        let policy = NavigationPolicy::new(["https://demo.trycloudflare.com/"]).unwrap();
        assert!(!data_is_navigation_to_unapproved_origin(
            &json!({
                "type": "dam-hopper:navigation",
                "url": "https://demo.trycloudflare.com/"
            }),
            &policy,
        ));
        assert!(data_is_navigation_to_unapproved_origin(
            &json!({
                "type": "dam-hopper:navigation",
                "url": "https://example.com/"
            }),
            &NavigationPolicy::new(["https://demo.trycloudflare.com/"]).unwrap(),
        ));
        assert!(data_is_navigation_to_unapproved_origin(
            &json!({
                "type": "dam-hopper:navigation",
                "url": "not a url"
            }),
            &policy,
        ));
    }
}
