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
    sink::{ChannelTelemetrySink, TelemetryCmd},
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
        Self::with_optional_paths(None, None)
    }

    fn with_optional_paths(
        key_path: Option<std::path::PathBuf>,
        collector_secret_path: Option<std::path::PathBuf>,
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
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_paths(
        key_path: std::path::PathBuf,
        collector_secret_path: std::path::PathBuf,
    ) -> Self {
        Self::with_optional_paths(Some(key_path), Some(collector_secret_path))
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
            move || build_active_handle(&config, key_path)
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
) -> Result<(TelemetryHandle, JoinHandle<()>), String> {
    let store = Arc::new(
        TelemetryStore::open(&telemetry_path(&config.db_path))
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
    let (sink, receiver) = ChannelTelemetrySink::channel_with_control(512, control.clone());
    let sender = sink.sender();
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

fn telemetry_path(value: &str) -> std::path::PathBuf {
    value
        .strip_prefix("~/")
        .map(|suffix| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(suffix)
        })
        .unwrap_or_else(|| std::path::PathBuf::from(value))
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

    fn available_port() -> u16 {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.local_addr().unwrap().port()
    }
}
