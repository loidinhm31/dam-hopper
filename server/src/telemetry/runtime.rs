use std::{
    sync::{Arc, Mutex, RwLock},
    thread::JoinHandle,
};

use crate::config::{TelemetryCollectorConfig, TelemetryConfig};

use super::{
    codex_otlp::{
        start_collector, start_collector_at, CollectorHandle, CollectorHealth,
        CollectorHealthSnapshot,
    },
    hmac_key_path,
    sink::{CodexUsageQueue, TelemetryCmd},
    worker::{TelemetryControl, TelemetryHandle, TelemetryWorker},
    TelemetryKeyRing, TelemetryStore,
};

/// A stable, live owner for Codex OTLP usage collection.
#[derive(Clone)]
pub struct TelemetryRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    handle: Arc<RwLock<TelemetryHandle>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    collector: tokio::sync::Mutex<Option<CollectorHandle>>,
    transition: tokio::sync::Mutex<()>,
    health: CollectorHealth,
    collector_error: RwLock<Option<String>>,
    key_path: Option<std::path::PathBuf>,
    collector_secret_path: Option<std::path::PathBuf>,
    session_db_path: Option<std::path::PathBuf>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRuntimeStatus {
    pub active: bool,
    pub collector: CollectorHealthSnapshot,
    pub collector_error: Option<String>,
}

impl TelemetryRuntime {
    pub fn new() -> Self {
        Self::with_optional_paths(None, None, None)
    }

    pub fn with_session_db_path(session_db_path: std::path::PathBuf) -> Self {
        Self::with_optional_paths(None, None, Some(session_db_path))
    }

    fn with_optional_paths(
        key_path: Option<std::path::PathBuf>,
        collector_secret_path: Option<std::path::PathBuf>,
        session_db_path: Option<std::path::PathBuf>,
    ) -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                handle: Arc::new(RwLock::new(TelemetryHandle::disabled())),
                worker: Mutex::new(None),
                collector: tokio::sync::Mutex::new(None),
                transition: tokio::sync::Mutex::new(()),
                health: CollectorHealth::default(),
                collector_error: RwLock::new(None),
                key_path,
                collector_secret_path,
                session_db_path,
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_paths(
        key_path: std::path::PathBuf,
        collector_secret_path: std::path::PathBuf,
    ) -> Self {
        Self::with_optional_paths(Some(key_path), Some(collector_secret_path), None)
    }

    pub fn handle_cell(&self) -> Arc<RwLock<TelemetryHandle>> {
        self.inner.handle.clone()
    }

    pub fn handle(&self) -> TelemetryHandle {
        self.inner
            .handle
            .read()
            .expect("telemetry runtime lock poisoned")
            .clone()
    }

    pub fn status(&self) -> TelemetryRuntimeStatus {
        TelemetryRuntimeStatus {
            active: self.handle().store.is_some(),
            collector: self.inner.health.snapshot(),
            collector_error: self
                .inner
                .collector_error
                .read()
                .expect("collector error lock poisoned")
                .clone(),
        }
    }

    /// Rotate the privacy key after a successful delete-all, even when the
    /// runtime is currently disabled and therefore has no live handle/key ring.
    pub fn rotate_hmac_key_after_delete(&self) -> std::io::Result<()> {
        if let Some(keys) = self.handle().hmac_keys {
            return keys.rotate_after_delete();
        }
        let path = match self.inner.key_path.clone() {
            Some(path) => path,
            None => hmac_key_path()?,
        };
        let keys = TelemetryKeyRing::load_or_create(path)?;
        keys.rotate_after_delete()
    }

    pub async fn transition_lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.inner.transition.lock().await
    }

    /// Apply a validated configuration before it is persisted. On a reconfigure
    /// failure the old collector is restored and the caller can retain its old
    /// configuration on disk.
    pub async fn apply_config(
        &self,
        previous: &TelemetryConfig,
        next: &TelemetryConfig,
    ) -> Result<(), String> {
        let _transition = self.transition_lock().await;
        self.apply_config_locked(previous, next).await
    }

    pub async fn restore_config(&self, previous: &TelemetryConfig, failed: &TelemetryConfig) {
        let _transition = self.transition_lock().await;
        if let Err(error) = self.apply_config_locked(failed, previous).await {
            tracing::error!(error = %error, "Telemetry rollback failed");
        }
    }

    pub async fn retry_collector(&self, config: &TelemetryConfig) -> Result<(), String> {
        let _transition = self.transition_lock().await;
        let handle = self.handle();
        if handle.store.is_none() {
            return Err("Usage telemetry is not active".to_string());
        }
        self.restart_collector_locked(&config.collector, &config.collector, &handle)
            .await
    }

    pub async fn shutdown(&self) {
        let _transition = self.transition_lock().await;
        self.disable_locked().await;
    }

    async fn apply_config_locked(
        &self,
        previous: &TelemetryConfig,
        next: &TelemetryConfig,
    ) -> Result<(), String> {
        if !next.enabled {
            self.disable_locked().await;
            return Ok(());
        }

        if self.handle().store.is_none() {
            self.activate_locked(next).await?;
            return Ok(());
        }

        let handle = self.handle();
        let collector_changed = previous.collector != next.collector;
        if collector_changed {
            self.restart_collector_locked(&previous.collector, &next.collector, &handle)
                .await?;
        }
        if previous.detail_retention_days != next.detail_retention_days
            || previous.aggregate_retention_days != next.aggregate_retention_days
        {
            let retention_handle = handle.clone();
            let retention_config = next.clone();
            let retention = tokio::task::spawn_blocking(move || {
                apply_retention(&retention_handle, &retention_config)
            })
            .await
            .map_err(|error| format!("usage retention task failed: {error}"))?;
            if let Err(error) = retention {
                if collector_changed {
                    if let Err(rollback_error) = self
                        .restart_collector_locked(&next.collector, &previous.collector, &handle)
                        .await
                    {
                        tracing::error!(error = %rollback_error, "Telemetry collector retention rollback failed");
                    }
                }
                return Err(error);
            }
        }
        handle
            .control
            .set_excluded_projects(next.excluded_projects.clone());
        handle.control.set_enabled(!next.paused);
        Ok(())
    }

    async fn activate_locked(&self, config: &TelemetryConfig) -> Result<(), String> {
        let activation = tokio::task::spawn_blocking({
            let config = config.clone();
            let key_path = self.inner.key_path.clone();
            let session_db_path = self.inner.session_db_path.clone();
            move || build_active_handle(&config, key_path, session_db_path)
        })
        .await
        .map_err(|error| format!("telemetry activation task failed: {error}"))??;

        let (handle, worker) = activation;
        *self
            .inner
            .handle
            .write()
            .expect("telemetry runtime lock poisoned") = handle.clone();
        *self
            .inner
            .worker
            .lock()
            .expect("telemetry worker lock poisoned") = Some(worker);

        if config.collector.enabled {
            if let Err(error) = self
                .start_collector_locked(&config.collector, &handle)
                .await
            {
                // The server remains usable if optional Codex ingestion is unavailable.
                self.set_collector_error(Some(error));
            }
        }
        Ok(())
    }

    async fn disable_locked(&self) {
        let collector = self.inner.collector.lock().await.take();
        if let Some(collector) = collector {
            collector.stop().await;
        }

        let handle = self.handle();
        handle.control.set_enabled(false);
        let worker = self
            .inner
            .worker
            .lock()
            .expect("telemetry worker lock poisoned")
            .take();
        if let Some(worker) = worker {
            let sender = handle.command_tx.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Some(sender) = sender {
                    let _ = sender.send(TelemetryCmd::Shutdown);
                }
                let _ = worker.join();
            })
            .await;
        }
        *self
            .inner
            .handle
            .write()
            .expect("telemetry runtime lock poisoned") = TelemetryHandle::disabled();
        self.set_collector_error(None);
    }

    async fn restart_collector_locked(
        &self,
        previous: &TelemetryCollectorConfig,
        next: &TelemetryCollectorConfig,
        handle: &TelemetryHandle,
    ) -> Result<(), String> {
        let old_collector = self.inner.collector.lock().await.take();
        if let Some(collector) = old_collector {
            collector.stop().await;
        }
        if !next.enabled {
            self.set_collector_error(None);
            return Ok(());
        }
        match self.start_collector_locked(next, handle).await {
            Ok(()) => Ok(()),
            Err(error) => {
                if previous.enabled {
                    if let Err(rollback_error) = self.start_collector_locked(previous, handle).await
                    {
                        tracing::error!(error = %rollback_error, "Telemetry collector rollback failed");
                    }
                }
                self.set_collector_error(Some(error.clone()));
                Err(error)
            }
        }
    }

    async fn start_collector_locked(
        &self,
        config: &TelemetryCollectorConfig,
        handle: &TelemetryHandle,
    ) -> Result<(), String> {
        let collector = match &self.inner.collector_secret_path {
            Some(secret_path) => {
                start_collector_at(
                    config,
                    handle,
                    self.inner.health.clone(),
                    secret_path.clone(),
                )
                .await
            }
            None => start_collector(config, handle, self.inner.health.clone()).await,
        }
        .map_err(|_| "Unable to start the local Codex usage collector".to_string())?;
        *self.inner.collector.lock().await = Some(collector);
        self.set_collector_error(None);
        Ok(())
    }

    fn set_collector_error(&self, error: Option<String>) {
        *self
            .inner
            .collector_error
            .write()
            .expect("collector error lock poisoned") = error;
    }
}

fn build_active_handle(
    config: &TelemetryConfig,
    key_path: Option<std::path::PathBuf>,
    session_db_path: Option<std::path::PathBuf>,
) -> Result<(TelemetryHandle, JoinHandle<()>), String> {
    let telemetry_db_path = telemetry_path(&config.db_path);
    if let Some(session_db_path) = session_db_path {
        ensure_distinct_database_paths(&session_db_path, &telemetry_db_path)?;
    }
    let store = Arc::new(
        TelemetryStore::open(&telemetry_db_path)
            .map_err(|_| "Unable to open usage storage".to_string())?,
    );
    let key_path = key_path.map(Ok).unwrap_or_else(|| {
        hmac_key_path().map_err(|_| "Unable to initialize usage privacy key".to_string())
    })?;
    let keys = Arc::new(
        TelemetryKeyRing::load_or_create(key_path)
            .map_err(|_| "Unable to initialize usage privacy key".to_string())?,
    );
    let control = Arc::new(TelemetryControl::new(
        !config.paused,
        config.excluded_projects.clone(),
    ));
    let (queue, receiver) = CodexUsageQueue::channel(512);
    let sender = queue.sender();
    let worker = TelemetryWorker::new(receiver, store.clone())
        .spawn()
        .map_err(|_| "Unable to start usage worker".to_string())?;
    let handle = TelemetryHandle::active(control, store, Some(sender)).with_hmac_keys(keys);
    if let Err(error) = apply_retention(&handle, config) {
        handle.control.set_enabled(false);
        if let Some(sender) = &handle.command_tx {
            let _ = sender.send(TelemetryCmd::Shutdown);
        }
        let _ = worker.join();
        return Err(error);
    }
    Ok((handle, worker))
}

fn apply_retention(handle: &TelemetryHandle, config: &TelemetryConfig) -> Result<(), String> {
    let (completion_tx, completion_rx) = std::sync::mpsc::sync_channel(1);
    let sender = handle
        .command_tx
        .as_ref()
        .ok_or_else(|| "Usage worker unavailable".to_string())?;
    sender
        .send(TelemetryCmd::ApplyRetention {
            now_utc_ms: chrono::Utc::now().timestamp_millis(),
            detail_retention_days: config.detail_retention_days,
            aggregate_retention_days: config.aggregate_retention_days,
            completion: completion_tx,
        })
        .map_err(|_| "Usage worker unavailable".to_string())?;
    completion_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "Usage retention operation timed out".to_string())?
        .map_err(|_| "Usage retention operation failed".to_string())
}

pub(crate) fn telemetry_path(value: &str) -> std::path::PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    }
    value
        .strip_prefix("~/")
        .map(|suffix| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(suffix)
        })
        .unwrap_or_else(|| std::path::PathBuf::from(value))
}

pub(crate) fn ensure_distinct_database_paths(
    session_db_path: &std::path::Path,
    telemetry_db_path: &std::path::Path,
) -> Result<(), String> {
    let normalized_session = normalized_database_path(session_db_path)?;
    let normalized_telemetry = normalized_database_path(telemetry_db_path)?;
    if normalized_session == normalized_telemetry
        || same_file_identity(&normalized_session, &normalized_telemetry)?
    {
        return Err("telemetry and session databases must use different files".to_string());
    }
    Ok(())
}

fn normalized_database_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| "unable to resolve database path".to_string())?
            .join(path)
    };
    if let Ok(canonical) = std::fs::canonicalize(&absolute) {
        return Ok(canonical);
    }
    let parent = absolute
        .parent()
        .ok_or_else(|| "unable to resolve database path".to_string())?;
    let file_name = absolute
        .file_name()
        .ok_or_else(|| "unable to resolve database path".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    Ok(canonical_parent.join(file_name))
}

fn same_file_identity(left: &std::path::Path, right: &std::path::Path) -> Result<bool, String> {
    let left_metadata = match std::fs::metadata(left) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("unable to inspect database path".to_string()),
    };
    let right_metadata = match std::fs::metadata(right) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("unable to inspect database path".to_string()),
    };

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        return Ok(left_metadata.dev() == right_metadata.dev()
            && left_metadata.ino() == right_metadata.ino());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return Ok(
            left_metadata.volume_serial_number() == right_metadata.volume_serial_number()
                && left_metadata.file_index() == right_metadata.file_index(),
        );
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (left_metadata, right_metadata);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(temp: &tempfile::TempDir, enabled: bool) -> TelemetryConfig {
        TelemetryConfig {
            enabled,
            db_path: temp.path().join("usage.db").display().to_string(),
            ..TelemetryConfig::default()
        }
    }

    #[tokio::test]
    async fn activation_and_disable_keep_codex_runtime_state_consistent() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = TelemetryRuntime::with_paths(
            temp.path().join("usage.key"),
            temp.path().join("collector-token"),
        );
        let disabled = config(&temp, false);
        let active = config(&temp, true);

        runtime.apply_config(&disabled, &active).await.unwrap();
        assert!(runtime.status().active);
        assert!(runtime.handle().control.is_enabled());

        runtime.apply_config(&active, &disabled).await.unwrap();
        assert!(!runtime.status().active);
        assert!(!runtime.handle().control.is_enabled());

        runtime.apply_config(&disabled, &active).await.unwrap();
        assert!(runtime.handle().control.is_enabled());
        runtime.shutdown().await;
    }

    #[test]
    fn disabled_runtime_can_rotate_the_persisted_privacy_key() {
        let temp = tempfile::tempdir().unwrap();
        let key_path = temp.path().join("usage.key");
        let before = TelemetryKeyRing::load_or_create(key_path.clone()).unwrap();
        let old_digest = before.digest(b"delete-all-test", &[b"old"]);
        drop(before);

        let runtime =
            TelemetryRuntime::with_paths(key_path.clone(), temp.path().join("collector-token"));
        runtime.rotate_hmac_key_after_delete().unwrap();
        let after = TelemetryKeyRing::load_or_create(key_path).unwrap();
        assert_ne!(old_digest, after.digest(b"delete-all-test", &[b"old"]));
    }

    #[tokio::test]
    async fn collector_reconfigure_failure_restores_the_previous_listener() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = TelemetryRuntime::with_paths(
            temp.path().join("usage.key"),
            temp.path().join("collector-token"),
        );
        let disabled = config(&temp, false);
        let mut active = config(&temp, true);
        active.collector.enabled = true;
        active.collector.port = available_port();
        runtime.apply_config(&disabled, &active).await.unwrap();
        assert!(runtime.status().collector.running);

        let blocker = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let mut conflicting = active.clone();
        conflicting.collector.port = blocker.local_addr().unwrap().port();
        assert!(runtime.apply_config(&active, &conflicting).await.is_err());
        assert!(runtime.status().collector.running);
        runtime.shutdown().await;
    }

    #[tokio::test]
    async fn activation_rejects_a_shared_session_and_telemetry_database() {
        let temp = tempfile::tempdir().unwrap();
        let shared_path = temp.path().join("shared.db");
        let runtime = TelemetryRuntime::with_session_db_path(shared_path.clone());
        let disabled = config(&temp, false);
        let mut active = config(&temp, true);
        active.db_path = shared_path.display().to_string();

        let error = runtime.apply_config(&disabled, &active).await.unwrap_err();
        assert!(error.contains("different files"));
        assert!(!runtime.status().active);
    }

    #[test]
    fn database_path_guard_accepts_distinct_paths() {
        let temp = tempfile::tempdir().unwrap();
        assert!(ensure_distinct_database_paths(
            &temp.path().join("sessions.db"),
            &temp.path().join("telemetry.db"),
        )
        .is_ok());
    }

    #[test]
    fn database_path_guard_rejects_the_same_path() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("shared.db");
        assert!(ensure_distinct_database_paths(&path, &path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn database_path_guard_rejects_symlinked_paths() {
        let temp = tempfile::tempdir().unwrap();
        let telemetry = temp.path().join("telemetry.db");
        let session = temp.path().join("sessions.db");
        std::fs::write(&telemetry, []).unwrap();
        std::os::unix::fs::symlink(&telemetry, &session).unwrap();

        assert!(ensure_distinct_database_paths(&session, &telemetry).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn database_path_guard_rejects_hard_linked_paths() {
        let temp = tempfile::tempdir().unwrap();
        let telemetry = temp.path().join("telemetry.db");
        let session = temp.path().join("sessions.db");
        std::fs::write(&telemetry, []).unwrap();
        std::fs::hard_link(&telemetry, &session).unwrap();

        assert!(ensure_distinct_database_paths(&session, &telemetry).is_err());
    }

    fn available_port() -> u16 {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.local_addr().unwrap().port()
    }
}
