#[cfg(desktop)]
mod browser_debug;

#[cfg(desktop)]
mod ssh_forward;

#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
use tauri::{Manager, WindowEvent};

#[cfg(windows)]
pub fn run_trust_repair(arguments: &[String]) -> Result<(), String> {
    let command = ssh_forward::trust_repair::TrustRepairCommand::parse(arguments)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "trust_repair_command_required".to_string())?;
    let scope_id = match &command {
        ssh_forward::trust_repair::TrustRepairCommand::RemoveEndpoint { scope_id, .. }
        | ssh_forward::trust_repair::TrustRepairCommand::Restore { scope_id, .. } => {
            scope_id.clone()
        }
    };
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    tauri::Builder::default()
        .setup(move |app| {
            let trust_path =
                ssh_forward::trust_repair::resolved_trust_path_from_app(app.handle(), &scope_id)
                    .map_err(|error| std::io::Error::other(error.to_string()))?;
            let app_config_dir = trust_path
                .parent()
                .and_then(|scope| scope.parent())
                .and_then(|scopes| scopes.parent())
                .and_then(|root| root.parent())
                .ok_or_else(|| std::io::Error::other("invalid_trust_path"))?;
            ssh_forward::trust_repair::execute(app_config_dir, command.clone())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            std::process::exit(0);
        })
        .run(context)
        .map_err(|error| error.to_string())
}

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
            #[cfg(windows)]
            {
                let app_config_dir = app
                    .path()
                    .app_config_dir()
                    .map_err(|error| std::io::Error::other(error.to_string()))?;
                let runtime_lease =
                    ssh_forward::store::SshForwardStore::acquire_feature_runtime_lease_at(
                        &app_config_dir,
                    )
                    .map_err(|error| std::io::Error::other(error.to_string()))?;
                app.manage(runtime_lease);
            }
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
