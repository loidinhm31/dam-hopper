#[cfg(desktop)]
mod browser_debug;

#[cfg(desktop)]
mod ssh_forward;

#[cfg(windows)]
mod shutdown;

#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
use tauri::{Manager, WindowEvent};

#[cfg(windows)]
fn handle_main_close_requested<Prevent, Trigger>(prevent_close: Prevent, trigger: Trigger)
where
    Prevent: FnOnce(),
    Trigger: FnOnce(),
{
    prevent_close();
    trigger();
}

#[cfg(windows)]
fn handle_exit_requested<Prevent, Trigger>(
    should_prevent_exit: bool,
    prevent_exit: Prevent,
    trigger: Trigger,
) where
    Prevent: FnOnce(),
    Trigger: FnOnce(),
{
    if should_prevent_exit {
        prevent_exit();
        trigger();
    }
}

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
    let builder = builder.manage(controller.clone());

    #[cfg(windows)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        browser_debug::controller::browser_debug_create,
        browser_debug::controller::browser_debug_navigate,
        browser_debug::controller::browser_debug_command,
        browser_debug::controller::browser_debug_set_bounds,
        browser_debug::controller::browser_debug_set_visible,
        browser_debug::controller::browser_debug_destroy,
        browser_debug::controller::browser_debug_clear_data,
        ssh_forward::commands::ssh_forward_open_client,
        ssh_forward::commands::ssh_forward_activate_scope,
        ssh_forward::commands::ssh_forward_snapshot,
        ssh_forward::commands::ssh_forward_create_profile,
        ssh_forward::commands::ssh_forward_update_profile,
        ssh_forward::commands::ssh_forward_delete_profile,
        ssh_forward::commands::ssh_forward_start,
        ssh_forward::commands::ssh_forward_stop,
        ssh_forward::commands::ssh_forward_restart,
        ssh_forward::commands::ssh_forward_list_keys,
        ssh_forward::commands::ssh_forward_approve_host,
        ssh_forward::commands::ssh_forward_purge_scope,
    ]);

    #[cfg(all(desktop, not(windows)))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        browser_debug::controller::browser_debug_create,
        browser_debug::controller::browser_debug_navigate,
        browser_debug::controller::browser_debug_command,
        browser_debug::controller::browser_debug_set_bounds,
        browser_debug::controller::browser_debug_set_visible,
        browser_debug::controller::browser_debug_destroy,
        browser_debug::controller::browser_debug_clear_data,
    ]);

    #[cfg(desktop)]
    let builder = builder.setup(move |app| {
        #[cfg(windows)]
        {
            let app_config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let manager = Arc::new(
                ssh_forward::manager::SshForwardManager::new(&app_config_dir)
                    .map_err(|error| std::io::Error::other(error.message))?,
            );
            tauri::async_runtime::block_on(manager.attach_app(app.handle().clone()));
            app.manage(manager.clone());
            let shutdown = Arc::new(shutdown::NativeShutdownCoordinator::new(
                manager,
                controller.clone(),
            ));
            app.manage(shutdown.clone());
        }
        let main = app
            .get_webview_window("main")
            .ok_or_else(|| std::io::Error::other("main_window_missing"))?;
        ssh_forward::ensure_main_window(main.label()).map_err(std::io::Error::other)?;
        controller.register_main_window(main.clone());
        let app_handle = app.handle().clone();
        let controller = controller.clone();
        let main_label = main.label().to_string();
        #[cfg(windows)]
        let shutdown = app
            .state::<Arc<shutdown::NativeShutdownCoordinator>>()
            .inner()
            .clone();
        main.on_window_event(move |event| match event {
            #[cfg(windows)]
            WindowEvent::CloseRequested { api, .. } if main_label == "main" => {
                handle_main_close_requested(
                    || api.prevent_close(),
                    || shutdown.trigger(app_handle.clone()),
                );
            }
            WindowEvent::Destroyed => {
                controller.cleanup_on_main_close(&app_handle);
            }
            _ => {}
        });
        Ok(())
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building DamHopper native client");
    app.run(move |app_handle, event| {
        #[cfg(windows)]
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let coordinator = app_handle
                    .state::<Arc<shutdown::NativeShutdownCoordinator>>()
                    .inner()
                    .clone();
                handle_exit_requested(
                    coordinator.should_prevent_exit(),
                    || api.prevent_exit(),
                    || coordinator.trigger(app_handle.clone()),
                );
            }
            tauri::RunEvent::Exit => {
                app_handle
                    .state::<Arc<shutdown::NativeShutdownCoordinator>>()
                    .inner()
                    .force_close_now();
            }
            _ => {}
        }
    });
}

#[cfg(all(test, windows))]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use super::{handle_exit_requested, handle_main_close_requested};

    #[test]
    fn close_request_prevents_close_and_starts_one_disposal() {
        let prevented = Arc::new(AtomicUsize::new(0));
        let triggered = Arc::new(AtomicUsize::new(0));
        let prevented_copy = Arc::clone(&prevented);
        let triggered_copy = Arc::clone(&triggered);
        handle_main_close_requested(
            move || {
                prevented_copy.fetch_add(1, Ordering::AcqRel);
            },
            move || {
                triggered_copy.fetch_add(1, Ordering::AcqRel);
            },
        );
        assert_eq!(prevented.load(Ordering::Acquire), 1);
        assert_eq!(triggered.load(Ordering::Acquire), 1);
    }

    #[test]
    fn exit_request_only_prevents_while_disposal_is_pending() {
        let prevented = Arc::new(AtomicUsize::new(0));
        let triggered = Arc::new(AtomicUsize::new(0));
        handle_exit_requested(
            true,
            || {
                prevented.fetch_add(1, Ordering::AcqRel);
            },
            || {
                triggered.fetch_add(1, Ordering::AcqRel);
            },
        );
        handle_exit_requested(false, || unreachable!(), || unreachable!());
        assert_eq!(prevented.load(Ordering::Acquire), 1);
        assert_eq!(triggered.load(Ordering::Acquire), 1);
    }
}
