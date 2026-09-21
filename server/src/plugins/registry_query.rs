use std::collections::BTreeMap;
use std::fs;

use chrono::Utc;
use sha2::{Digest, Sha256};

use super::contract::{GrantKey, PluginMetadataItem, PluginReadUiResult};
use super::error::PluginError;
use super::limits::MAX_UI_DOCUMENT_BYTES;
use super::registry::PluginRegistry;
use super::registry_state::InstallationRecord;

impl PluginRegistry {
    pub fn list_plugins(&self) -> Result<(Vec<PluginMetadataItem>, u64), PluginError> {
        let state = self.read_state()?;
        let mut items = Vec::new();
        for inst in state.installations.values() {
            let pkg_key = format!(
                "{}@{}#{}",
                inst.plugin_id, inst.active_version, inst.active_package_digest
            );
            if let Some(pkg) = state.packages.get(&pkg_key) {
                items.push(PluginMetadataItem {
                    id: inst.installation_id.clone(),
                    version: inst.active_version.clone(),
                    publisher: pkg.publisher.clone(),
                    capabilities: pkg.capabilities.clone(),
                    has_ui: pkg.entrypoints.ui.is_some(),
                    active_generation: inst.activation_generation,
                    enabled: inst.enabled,
                });
            }
        }
        Ok((items, state.registry_revision))
    }

    pub fn get_installation(
        &self,
        installation_id: &str,
    ) -> Result<Option<InstallationRecord>, PluginError> {
        let state = self.read_state()?;
        Ok(state.installations.get(installation_id).cloned())
    }

    pub fn read_ui_bytes(
        &self,
        installation_id: &str,
        expected_digest: &str,
    ) -> Result<PluginReadUiResult, PluginError> {
        let state = self.read_state()?;
        let inst = state.installations.get(installation_id).ok_or_else(|| {
            PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
        })?;

        if !inst.enabled {
            return Err(PluginError::forbidden(format!(
                "Installation '{installation_id}' is disabled"
            )));
        }

        if inst.active_package_digest != expected_digest.to_lowercase() {
            return Err(PluginError::invalid_input(format!(
                "Active digest mismatch: expected {}, active is {}",
                expected_digest, inst.active_package_digest
            )));
        }

        let pkg_key = format!(
            "{}@{}#{}",
            inst.plugin_id, inst.active_version, inst.active_package_digest
        );
        let pkg = state.packages.get(&pkg_key).ok_or_else(|| {
            PluginError::runner_unavailable(format!("Package '{pkg_key}' missing from registry"))
        })?;

        let ui_entry = pkg.entrypoints.ui.as_ref().ok_or_else(|| {
            PluginError::invalid_input(format!("Plugin '{}' has no UI entrypoint", inst.plugin_id))
        })?;

        let ui_path = self
            .layout
            .package_dir(
                &inst.plugin_id,
                &inst.active_version,
                &inst.active_package_digest,
            )
            .join(&ui_entry.entry);
        if !ui_path.exists() {
            return Err(PluginError::runner_unavailable(format!(
                "UI file missing at '{}'",
                ui_path.display()
            )));
        }

        let bytes = fs::read(&ui_path)
            .map_err(|e| PluginError::runner_unavailable(format!("Failed to read UI file: {e}")))?;

        if bytes.len() as u64 > MAX_UI_DOCUMENT_BYTES {
            return Err(PluginError::invalid_input(format!(
                "UI size exceeds {MAX_UI_DOCUMENT_BYTES} limit"
            )));
        }

        let sha256 = hex::encode(Sha256::digest(&bytes));
        use base64::Engine;
        let base64_content = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(PluginReadUiResult {
            raw_bytes_base64: base64_content,
            sha256,
            size: bytes.len(),
        })
    }

    pub fn update_grants(
        &self,
        actor: &str,
        installation_id: &str,
        expected_security_rev: u64,
        new_grants: Vec<GrantKey>,
    ) -> Result<InstallationRecord, PluginError> {
        if !self.admin_subjects.is_admin(actor) {
            return Err(PluginError::unauthorized("Actor is not authorized admin"));
        }

        let _guard = self.state_lock.lock();
        let mut state = self.read_state()?;
        if state.security_revision != expected_security_rev {
            return Err(PluginError::forbidden(format!(
                "Security revision mismatch: expected {}, current is {}",
                expected_security_rev, state.security_revision
            )));
        }

        let inst = state
            .installations
            .get_mut(installation_id)
            .ok_or_else(|| {
                PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
            })?;

        inst.grants = new_grants;
        inst.updated_at = Utc::now().to_rfc3339();
        let result = inst.clone();

        state.security_revision += 1;
        state.registry_revision += 1;
        self.write_state(&state)?;

        Ok(result)
    }

    pub fn update_bindings(
        &self,
        actor: &str,
        installation_id: &str,
        expected_registry_rev: u64,
        new_bindings: BTreeMap<String, String>,
    ) -> Result<InstallationRecord, PluginError> {
        if !self.admin_subjects.is_admin(actor) {
            return Err(PluginError::unauthorized("Actor is not authorized admin"));
        }

        let _guard = self.state_lock.lock();
        let mut state = self.read_state()?;
        if state.registry_revision != expected_registry_rev {
            return Err(PluginError::forbidden(format!(
                "Registry revision mismatch: expected {}, current is {}",
                expected_registry_rev, state.registry_revision
            )));
        }

        let inst = state
            .installations
            .get_mut(installation_id)
            .ok_or_else(|| {
                PluginError::invalid_input(format!("Installation '{installation_id}' not found"))
            })?;

        inst.bindings = new_bindings;
        inst.updated_at = Utc::now().to_rfc3339();
        let result = inst.clone();

        state.registry_revision += 1;
        self.write_state(&state)?;

        Ok(result)
    }
}
