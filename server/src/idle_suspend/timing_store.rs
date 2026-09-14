use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;
use toml_edit::{value, DocumentMut, Item, Table};

use crate::idle_suspend::policy::validate_timing_pair;
use crate::utils::atomic_write;

#[derive(Debug, Error)]
pub enum TimingStoreError {
    #[error("Validation failed: {0}")]
    Validation(String),
    #[error("File error: {0}")]
    Io(String),
    #[error("Malformed TOML: {0}")]
    MalformedToml(String),
    #[error("Registry target is unsafe: {0}")]
    UnsafeTarget(String),
    #[error("Reconciliation required: persistence state ambiguous")]
    ReconciliationRequired,
}

#[derive(Debug, Clone)]
pub struct IdleSuspendTimingStore {
    canonical_registry_path: PathBuf,
}

impl IdleSuspendTimingStore {
    pub fn new(canonical_registry_path: PathBuf) -> Self {
        Self {
            canonical_registry_path,
        }
    }

    pub fn canonical_path(&self) -> &Path {
        &self.canonical_registry_path
    }

    /// Atomically update only `quiet_period_seconds` and `wake_after_seconds`
    /// under `[server.idle_suspend]` in the captured registry TOML.
    pub fn persist_timing_pair(
        &self,
        quiet_period_seconds: u64,
        wake_after_seconds: u64,
    ) -> Result<(), TimingStoreError> {
        validate_timing_pair(quiet_period_seconds, wake_after_seconds)
            .map_err(TimingStoreError::Validation)?;

        self.validate_target_file()?;

        let content = fs::read_to_string(&self.canonical_registry_path)
            .map_err(|e| TimingStoreError::Io(format!("Cannot read registry: {e}")))?;

        let mut doc: DocumentMut = content
            .parse()
            .map_err(|e| TimingStoreError::MalformedToml(format!("Cannot parse TOML: {e}")))?;

        // Ensure [server] table exists
        let server_item = doc.entry("server").or_insert_with(|| Item::Table(Table::new()));
        let server_table = server_item
            .as_table_like_mut()
            .ok_or_else(|| TimingStoreError::MalformedToml("[server] must be a table".into()))?;

        // Ensure [server.idle_suspend] table exists
        let idle_item = server_table
            .entry("idle_suspend")
            .or_insert_with(|| Item::Table(Table::new()));
        let idle_table = idle_item.as_table_like_mut().ok_or_else(|| {
            TimingStoreError::MalformedToml("[server.idle_suspend] must be a table".into())
        })?;

        // Atomically replace both values as one pair
        idle_table.insert("quiet_period_seconds", value(quiet_period_seconds as i64));
        idle_table.insert("wake_after_seconds", value(wake_after_seconds as i64));

        let updated_str = doc.to_string();

        atomic_write(&self.canonical_registry_path, &updated_str)
            .map_err(|e| TimingStoreError::Io(format!("Atomic write failed: {e}")))?;

        Ok(())
    }

    fn validate_target_file(&self) -> Result<(), TimingStoreError> {
        let meta = fs::symlink_metadata(&self.canonical_registry_path)
            .map_err(|e| TimingStoreError::Io(format!("Cannot stat registry file: {e}")))?;

        if meta.file_type().is_symlink() || !meta.file_type().is_file() {
            return Err(TimingStoreError::UnsafeTarget(
                "Registry config path must be a regular file".to_string(),
            ));
        }

        Ok(())
    }
}
