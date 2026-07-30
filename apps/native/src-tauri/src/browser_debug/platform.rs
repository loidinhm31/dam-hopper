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
/// The Windows implementation attaches a second WebView2 message listener to
/// Wry's existing `window.ipc` channel. It does not grant the target a Tauri
/// capability or route through a generic application command. Other desktop
/// engines remain build-only until their equivalent hook is verified.
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

#[cfg(not(windows))]
pub fn install_relay<R: Runtime>(
    _webview: &Webview<R>,
    _callback: RelayCallback,
) -> Result<PlatformRelayResult, String> {
    Ok(PlatformRelayResult::Unsupported)
}
