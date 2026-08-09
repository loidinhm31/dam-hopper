#[cfg(desktop)]
mod browser_debug;

#[cfg(desktop)]
mod ssh_forward;

#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let controller = Arc::new(browser_debug::controller::BrowserDebugController::default());

    #[cfg(desktop)]
    let builder = builder
        .manage(controller.clone())
        .invoke_handler(tauri::generate_handler![
            browser_debug::controller::browser_debug_create,
            browser_debug::controller::browser_debug_navigate,
            browser_debug::controller::browser_debug_command,
            browser_debug::controller::browser_debug_set_bounds,
            browser_debug::controller::browser_debug_set_visible,
            browser_debug::controller::browser_debug_destroy,
            browser_debug::controller::browser_debug_clear_data,
        ])
        .setup(move |app| {
            let main = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("main_window_missing"))?;
            ssh_forward::ensure_main_window(main.label()).map_err(std::io::Error::other)?;
            controller.register_main_window(main.clone());
            let app_handle = app.handle().clone();
            let controller = controller.clone();
            main.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    controller.cleanup_on_main_close(&app_handle);
                }
            });
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running DamHopper native client");
}
