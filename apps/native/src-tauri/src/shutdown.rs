//! One bounded disposal owner for SSH forwarding and Browser Debug.

use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Runtime};

use crate::{
    browser_debug::controller::BrowserDebugController, ssh_forward::manager::SshForwardManager,
};

const RUNNING: u8 = 0;
const DISPOSING: u8 = 1;
const DISPOSED: u8 = 2;
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

pub(crate) struct NativeShutdownCoordinator {
    state: AtomicU8,
    manager: Arc<SshForwardManager>,
    browser_debug: Arc<BrowserDebugController>,
}

impl NativeShutdownCoordinator {
    pub(crate) fn new(
        manager: Arc<SshForwardManager>,
        browser_debug: Arc<BrowserDebugController>,
    ) -> Self {
        Self {
            state: AtomicU8::new(RUNNING),
            manager,
            browser_debug,
        }
    }

    #[allow(dead_code)]
    pub(crate) fn is_disposed(&self) -> bool {
        self.state.load(Ordering::Acquire) == DISPOSED
    }

    pub(crate) fn should_prevent_exit(&self) -> bool {
        self.state.load(Ordering::Acquire) != DISPOSED
    }

    pub(crate) fn begin_disposal(&self) -> bool {
        self.state
            .compare_exchange(RUNNING, DISPOSING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(crate) fn trigger<R: Runtime>(self: &Arc<Self>, app: AppHandle<R>) {
        self.trigger_with_exit(app, |app| app.exit(0));
    }

    fn trigger_with_exit<R, F>(self: &Arc<Self>, app: AppHandle<R>, exit: F)
    where
        R: Runtime,
        F: FnOnce(AppHandle<R>) + Send + 'static,
    {
        if !self.begin_disposal() {
            return;
        }
        let coordinator = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            coordinator.dispose_resources(&app).await;
            exit(app);
        });
    }

    async fn dispose_resources<R: Runtime>(&self, app: &AppHandle<R>) {
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        let manager = Arc::clone(&self.manager);
        let browser_debug = Arc::clone(&self.browser_debug);
        let cleanup_app = app.clone();
        let cleanup = tauri::async_runtime::spawn_blocking(move || {
            browser_debug.cleanup_on_main_close(&cleanup_app);
        });
        let manager_dispose = async {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let _ = tokio::time::timeout(remaining, manager.dispose()).await;
        };
        let browser_cleanup = async {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let _ = tokio::time::timeout(remaining, cleanup).await;
        };
        tokio::join!(manager_dispose, browser_cleanup);
        self.manager.force_close();
        self.state.store(DISPOSED, Ordering::Release);
    }

    pub(crate) fn force_close_now(&self) {
        self.manager.force_close();
        self.state.store(DISPOSED, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use super::{NativeShutdownCoordinator, DISPOSED, DISPOSING, RUNNING, SHUTDOWN_GRACE};
    use crate::{
        browser_debug::controller::BrowserDebugController, ssh_forward::manager::SshForwardManager,
    };

    fn temp_config_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("dam-hopper-shutdown-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn shutdown_contract_is_single_owner_and_bounded() {
        assert_eq!(RUNNING, 0);
        assert_eq!(DISPOSING, 1);
        assert_eq!(DISPOSED, 2);
        assert_eq!(SHUTDOWN_GRACE, Duration::from_secs(5));
    }

    #[tokio::test]
    async fn close_and_exit_disposal_is_one_shot_and_bounded() {
        let config = temp_config_dir();
        let manager = Arc::new(SshForwardManager::new(&config).unwrap());
        let coordinator = Arc::new(NativeShutdownCoordinator::new(
            Arc::clone(&manager),
            Arc::new(BrowserDebugController::default()),
        ));
        let app = tauri::test::mock_app();

        let exits = Arc::new(AtomicUsize::new(0));
        let first_exits = Arc::clone(&exits);
        coordinator.trigger_with_exit(app.handle().clone(), move |_| {
            first_exits.fetch_add(1, Ordering::AcqRel);
        });
        let second_exits = Arc::clone(&exits);
        coordinator.trigger_with_exit(app.handle().clone(), move |_| {
            second_exits.fetch_add(1, Ordering::AcqRel);
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            while !coordinator.is_disposed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(exits.load(Ordering::Acquire), 1);
        assert!(!coordinator.should_prevent_exit());
        assert!(manager.is_shutting_down());
        assert!(!coordinator.begin_disposal());

        drop(coordinator);
        drop(app);
        drop(manager);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn updater_relaunch_remains_blocked_at_runtime() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
        assert!(config["plugins"].get("updater").is_none());
        let source = include_str!("lib.rs");
        assert!(!source.contains("plugin::updater"));
        assert!(!source.contains("restart("));
        assert!(!source.contains("relaunch("));
    }
}
