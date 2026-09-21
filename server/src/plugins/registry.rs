use std::collections::HashMap;
use std::fs;

use parking_lot::Mutex;

use super::error::PluginError;
use super::registry_layout::PluginRegistryLayout;
use super::registry_recovery::run_crash_recovery;
use super::registry_state::RegistryV1Record;
use super::stage::ActiveStageUpload;
use super::trust::{AdminSubjectList, StageReviewDto};

pub struct PluginRegistry {
    pub layout: PluginRegistryLayout,
    pub admin_subjects: AdminSubjectList,
    pub state_lock: Mutex<()>,
    pub active_stages: Mutex<HashMap<String, ActiveStageUpload>>,
    pub stage_reviews: Mutex<HashMap<String, StageReviewDto>>,
}

impl PluginRegistry {
    pub fn new(
        layout: PluginRegistryLayout,
        admin_subjects: AdminSubjectList,
    ) -> Result<Self, PluginError> {
        layout.ensure_layout()?;

        let registry_file = layout.registry_file();
        if !registry_file.exists() {
            let initial = RegistryV1Record::new_empty(admin_subjects.config_digest());
            let bytes = serde_json::to_vec_pretty(&initial).map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to serialize initial registry: {e}"
                ))
            })?;
            crate::linux_release::durable_fs::atomic_write_file(
                &registry_file,
                &bytes,
                Some(0o600),
            )
            .map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to write initial registry: {e}"))
            })?;
        } else {
            let content = fs::read_to_string(&registry_file).map_err(|e| {
                PluginError::runner_unavailable(format!("Failed to read registry: {e}"))
            })?;
            let record: RegistryV1Record = serde_json::from_str(&content).map_err(|e| {
                PluginError::invalid_input(format!("Registry corruption detected: {e}"))
            })?;
            record.validate()?;
        }

        run_crash_recovery(&layout)?;

        Ok(Self {
            layout,
            admin_subjects,
            state_lock: Mutex::new(()),
            active_stages: Mutex::new(HashMap::new()),
            stage_reviews: Mutex::new(HashMap::new()),
        })
    }

    pub fn read_state(&self) -> Result<RegistryV1Record, PluginError> {
        let path = self.layout.registry_file();
        let content = fs::read_to_string(&path).map_err(|e| {
            PluginError::runner_unavailable(format!("Failed to read registry: {e}"))
        })?;
        let record: RegistryV1Record = serde_json::from_str(&content)
            .map_err(|e| PluginError::invalid_input(format!("Registry corrupted: {e}")))?;
        record.validate()?;
        Ok(record)
    }

    pub fn write_state(&self, record: &RegistryV1Record) -> Result<(), PluginError> {
        record.validate()?;
        let path = self.layout.registry_file();
        let bytes = serde_json::to_vec_pretty(record).map_err(|e| {
            PluginError::invalid_input(format!("Failed to serialize registry: {e}"))
        })?;
        crate::linux_release::durable_fs::atomic_write_file(&path, &bytes, Some(0o600)).map_err(
            |e| PluginError::runner_unavailable(format!("Failed to write registry: {e}")),
        )?;
        if let Some(parent) = path.parent() {
            let _ = crate::linux_release::durable_fs::sync_dir(parent);
        }
        Ok(())
    }

    pub fn record_installation_failure(
        &self,
        installation_id: &str,
        reason: &str,
    ) -> Result<(), PluginError> {
        let _guard = self.state_lock.lock();
        let mut state = self.read_state()?;
        if let Some(inst) = state.installations.get_mut(installation_id) {
            inst.enabled = false;
            inst.updated_at = chrono::Utc::now().to_rfc3339();
            state.registry_revision += 1;
            self.write_state(&state)?;
            tracing::warn!(
                installation_id,
                reason,
                "Recorded installation failure and disabled plugin in registry"
            );
            Ok(())
        } else {
            Err(PluginError::invalid_input(format!(
                "Installation '{installation_id}' not found"
            )))
        }
    }

    pub fn set_installation_enabled(
        &self,
        installation_id: &str,
        enabled: bool,
    ) -> Result<super::registry_state::InstallationRecord, PluginError> {
        let _guard = self.state_lock.lock();
        let mut state = self.read_state()?;
        if let Some(inst) = state.installations.get_mut(installation_id) {
            inst.enabled = enabled;
            if enabled {
                inst.activation_generation += 1;
            }
            inst.updated_at = chrono::Utc::now().to_rfc3339();
            let updated = inst.clone();
            state.registry_revision += 1;
            self.write_state(&state)?;
            Ok(updated)
        } else {
            Err(PluginError::invalid_input(format!(
                "Installation '{installation_id}' not found"
            )))
        }
    }
}
