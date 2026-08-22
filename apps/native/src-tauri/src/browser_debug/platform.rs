use std::sync::Arc;

use tauri::{Runtime, Webview};

pub type RelayCallback = Arc<dyn Fn(String, String) + Send + Sync + 'static>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlatformRelayResult {
    Installed,
    #[allow(dead_code)]
    Unsupported,
}

/// Installs the narrow native message hook used by the injected bridge.
///
/// The platform implementations attach a narrow second listener to Wry's
/// existing `window.ipc` channel. They do not grant the target a Tauri
/// capability or route through a generic application command.
#[cfg(windows)]
pub fn install_relay<R: Runtime>(
    webview: &Webview<R>,
    callback: RelayCallback,
) -> Result<PlatformRelayResult, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DENY;
    use webview2_com::{
        take_pwstr, PermissionRequestedEventHandler, WebMessageReceivedEventHandler,
    };
    use windows::core::PWSTR;

    let error = Arc::new(std::sync::Mutex::new(None::<String>));
    let error_for_hook = error.clone();
    let result = webview.with_webview(move |native| {
        let callback = callback.clone();
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut source = PWSTR::null();
            unsafe { args.Source(&mut source)? };
            let source = take_pwstr(source);
            let mut message = PWSTR::null();
            unsafe { args.TryGetWebMessageAsString(&mut message)? };
            callback(source, take_pwstr(message));
            Ok(())
        }));
        let controller = native.controller();
        let webview = match unsafe { controller.CoreWebView2() } {
            Ok(webview) => webview,
            Err(error) => {
                *error_for_hook.lock().expect("relay error lock") = Some(error.to_string());
                return;
            }
        };
        let mut token = 0_i64;
        if let Err(error) = unsafe { webview.add_WebMessageReceived(&handler, &mut token) } {
            *error_for_hook.lock().expect("relay error lock") = Some(error.to_string());
        }
        let permission_handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)? };
            }
            Ok(())
        }));
        let mut permission_token = 0_i64;
        if let Err(error) =
            unsafe { webview.add_PermissionRequested(&permission_handler, &mut permission_token) }
        {
            *error_for_hook.lock().expect("relay error lock") = Some(error.to_string());
        }
    });
    result.map_err(|error| error.to_string())?;
    if let Some(error) = error.lock().expect("relay error lock").clone() {
        return Err(format!("install WebView2 relay: {error}"));
    }
    Ok(PlatformRelayResult::Installed)
}

#[cfg(target_os = "linux")]
pub fn install_relay<R: Runtime>(
    webview: &Webview<R>,
    callback: RelayCallback,
) -> Result<PlatformRelayResult, String> {
    use webkit2gtk::{UserContentManagerExt, WebViewExt};

    let error = Arc::new(std::sync::Mutex::new(None::<String>));
    let error_for_hook = error.clone();
    let result = webview.with_webview(move |native| {
        let inner = native.inner();
        let manager = match inner.user_content_manager() {
            Some(manager) => manager,
            None => {
                *error_for_hook.lock().expect("relay error lock") =
                    Some("WebView does not have UserContentManager".into());
                return;
            }
        };
        let source_webview = inner.clone();
        manager.connect_script_message_received(None, move |_manager, message| {
            if let Some(value) = message.js_value() {
                callback(
                    source_webview
                        .uri()
                        .map(|uri| uri.to_string())
                        .unwrap_or_default(),
                    value.to_string(),
                );
            }
        });
    });
    result.map_err(|error| error.to_string())?;
    if let Some(error) = error.lock().expect("relay error lock").clone() {
        return Err(format!("install WebKitGTK relay: {error}"));
    }
    Ok(PlatformRelayResult::Installed)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn install_relay<R: Runtime>(
    _webview: &Webview<R>,
    _callback: RelayCallback,
) -> Result<PlatformRelayResult, String> {
    Ok(PlatformRelayResult::Unsupported)
}
