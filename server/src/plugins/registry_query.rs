use std::collections::BTreeMap;
use std::fs;

use chrono::Utc;
use sha2::{Digest, Sha256};

use super::contract::{GrantKey, PluginMetadataItem, PluginReadUiParams, PluginReadUiResult};
use super::error::PluginError;
use super::limits::MAX_UI_DOCUMENT_BYTES;
use super::registry::PluginRegistry;
use super::registry_state::InstallationRecord;

fn has_ui_visibility(
    installation: &InstallationRecord,
    actor_subject: &str,
    project_target: &str,
) -> bool {
    let target_is_bound = installation.bindings.contains_key(project_target)
        || installation
            .bindings
            .values()
            .any(|bound_target| bound_target == project_target);
    target_is_bound
        && installation.grants.iter().any(|grant| {
            grant.actor_subject == actor_subject
                && grant.installation_id == installation.installation_id
                && (grant.configured_project_target == project_target
                    || grant.configured_project_target == "*")
        })
}

fn matches_active_ui(
    installation: &InstallationRecord,
    expected_digest: &str,
    activation_generation: u64,
) -> bool {
    installation.active_package_digest == expected_digest
        && installation.activation_generation == activation_generation
}

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
                    active_digest: inst.active_package_digest.clone(),
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
        params: &PluginReadUiParams,
    ) -> Result<PluginReadUiResult, PluginError> {
        // Keep authorization and byte selection under the same registry lock so
        // a grant, binding, disable, or activation commit cannot race the read.
        let _guard = self.state_lock.lock();
        let state = self.read_state()?;
        let inst = state
            .installations
            .get(&params.installation_id)
            .ok_or_else(|| PluginError::invalid_input("Plugin UI is unavailable"))?;

        if !inst.enabled {
            return Err(PluginError::forbidden("Plugin UI is unavailable"));
        }
        if !matches_active_ui(inst, &params.expected_digest, params.activation_generation) {
            return Err(PluginError::context_revoked("Plugin UI activation changed"));
        }
        if !has_ui_visibility(inst, &params.actor_subject, &params.project_target) {
            return Err(PluginError::forbidden(
                "Plugin UI is not authorized for this actor and target",
            ));
        }

        let pkg_key = format!(
            "{}@{}#{}",
            inst.plugin_id, inst.active_version, inst.active_package_digest
        );
        let pkg = state
            .packages
            .get(&pkg_key)
            .ok_or_else(|| PluginError::runner_unavailable("Plugin UI is unavailable"))?;
        let ui_entry = pkg
            .entrypoints
            .ui
            .as_ref()
            .ok_or_else(|| PluginError::invalid_input("Plugin has no UI entrypoint"))?;

        let ui_path = self
            .layout
            .package_dir(
                &inst.plugin_id,
                &inst.active_version,
                &inst.active_package_digest,
            )
            .join(&ui_entry.entry);
        let bytes = fs::read(&ui_path)
            .map_err(|_| PluginError::runner_unavailable("Plugin UI is unavailable"))?;
        if bytes.len() as u64 > MAX_UI_DOCUMENT_BYTES {
            return Err(PluginError::invalid_input(
                "Plugin UI exceeds the document size limit",
            ));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn installation() -> InstallationRecord {
        InstallationRecord {
            installation_id: "install-1".to_string(),
            plugin_id: "plugin.test".to_string(),
            active_package_digest: "a".repeat(64),
            active_version: "1.0.0".to_string(),
            activation_generation: 7,
            enabled: true,
            bindings: BTreeMap::from([("project-a".to_string(), "approved-source".to_string())]),
            grants: vec![GrantKey {
                actor_subject: "actor-a".to_string(),
                installation_id: "install-1".to_string(),
                configured_project_target: "project-a".to_string(),
                allowed_operations: vec!["advisor.scan".to_string()],
                allow_current_account_policy: false,
            }],
            previous_package: None,
            created_at: "2026-09-22T00:00:00Z".to_string(),
            updated_at: "2026-09-22T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn ui_visibility_requires_matching_binding_and_grant() {
        let mut inst = installation();
        assert!(has_ui_visibility(&inst, "actor-a", "project-a"));
        assert!(!has_ui_visibility(&inst, "actor-b", "project-a"));
        assert!(!has_ui_visibility(&inst, "actor-a", "project-b"));

        inst.bindings.clear();
        assert!(!has_ui_visibility(&inst, "actor-a", "project-a"));
    }

    #[test]
    fn active_ui_identity_rejects_stale_digest_or_generation() {
        let inst = installation();
        assert!(matches_active_ui(&inst, &"a".repeat(64), 7));
        assert!(!matches_active_ui(&inst, &"b".repeat(64), 7));
        assert!(!matches_active_ui(&inst, &"a".repeat(64), 6));
    }
}
