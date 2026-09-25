use std::collections::BTreeMap;
use std::fs;

use chrono::Utc;
use uuid::Uuid;

use super::contract::GrantKey;
use super::error::PluginError;
use super::package::inspect_and_validate_package;
use super::package_extract::{extract_package_archive, publish_extracted_package};
use super::registry::PluginRegistry;
use super::registry_journal::{write_journal_record, TransactionPhase, TransactionRecord};
use super::registry_state::{InstallationRecord, RegisteredPackageRecord};
use super::trust::validate_stage_approval;

impl PluginRegistry {
    pub fn approve_stage(
        &self,
        actor: &str,
        stage_id: &str,
        expected_sha256: &str,
        requested_security_revision: u64,
        initial_bindings: BTreeMap<String, String>,
        initial_grants: Vec<GrantKey>,
    ) -> Result<InstallationRecord, PluginError> {
        let review = {
            let reviews = self.stage_reviews.lock();
            if let Some(r) = reviews.get(stage_id) {
                r.clone()
            } else {
                let file = self.layout.stage_review_file(stage_id);
                if file.exists() {
                    let c = fs::read_to_string(&file).map_err(|e| {
                        PluginError::runner_unavailable(format!("Read review: {e}"))
                    })?;
                    serde_json::from_str(&c)
                        .map_err(|e| PluginError::invalid_input(format!("Parse review: {e}")))?
                } else {
                    return Err(PluginError::invalid_input(format!(
                        "Stage '{stage_id}' not found or not finished"
                    )));
                }
            }
        };

        let current_state = self.read_state()?;
        validate_stage_approval(
            &self.admin_subjects,
            actor,
            expected_sha256,
            requested_security_revision,
            current_state.security_revision,
            &review,
        )?;

        let now = Utc::now().to_rfc3339();
        let mut tx_record = TransactionRecord {
            transaction_id: review.transaction_id.clone(),
            stage_id: stage_id.to_string(),
            phase: TransactionPhase::Approved,
            actor_subject: actor.to_string(),
            plugin_id: Some(review.plugin_id.clone()),
            plugin_version: Some(review.version.clone()),
            expected_sha256: expected_sha256.to_lowercase(),
            actual_sha256: Some(review.archive_sha256.clone()),
            total_bytes: review.uncompressed_bytes,
            security_revision: current_state.security_revision,
            installation_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            error: None,
        };
        write_journal_record(&self.layout, &tx_record)?;

        // Pre-flight check under lock before doing expensive extraction
        {
            let _guard = self.state_lock.lock();
            let fresh = self.read_state()?;
            if fresh.security_revision != current_state.security_revision {
                return Err(PluginError::forbidden(
                    "Concurrent security revision advance",
                ));
            }
        }

        let stage_package = self.layout.stage_package_file(stage_id);
        let temp_extracted = self.layout.stage_dir(stage_id).join("extracted");

        let (manifest, _, _) = inspect_and_validate_package(&stage_package)?;
        extract_package_archive(&stage_package, &temp_extracted, &manifest)?;

        tx_record.phase = TransactionPhase::Extracted;
        tx_record.updated_at = Utc::now().to_rfc3339();
        write_journal_record(&self.layout, &tx_record)?;

        let _guard = self.state_lock.lock();
        let mut fresh_state = self.read_state()?;
        if fresh_state.security_revision != current_state.security_revision {
            let _ = fs::remove_dir_all(&temp_extracted);
            return Err(PluginError::forbidden(
                "Concurrent security revision advance",
            ));
        }

        publish_extracted_package(
            &self.layout,
            &temp_extracted,
            &review.plugin_id,
            &review.version,
            &review.archive_sha256,
        )?;
        let pkg_key = format!(
            "{}@{}#{}",
            review.plugin_id, review.version, review.archive_sha256
        );
        let now_str = Utc::now().to_rfc3339();
        let pkg_record = RegisteredPackageRecord {
            plugin_id: review.plugin_id.clone(),
            version: review.version.clone(),
            archive_sha256: review.archive_sha256.clone(),
            publisher: review.publisher.clone(),
            host_version_range: review.host_version_range.clone(),
            contracts: review.contracts.clone(),
            capabilities: review.capabilities.clone(),
            entrypoints: review.entrypoints.clone(),
            installed_at: now_str.clone(),
        };
        fresh_state.packages.insert(pkg_key, pkg_record);

        let installation_id = fresh_state
            .installations
            .values()
            .find(|i| i.plugin_id == review.plugin_id)
            .map(|i| i.installation_id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let existing = fresh_state.installations.get(&installation_id);
        let existing_gen = existing
            .map(|i| i.activation_generation)
            .unwrap_or(0);
        let previous_package = existing.map(|i| super::registry_state::RollbackPackageSnapshot {
            package_digest: i.active_package_digest.clone(),
            version: i.active_version.clone(),
            bindings: i.bindings.clone(),
            owner_history_source: i.owner_history_source.clone(),
            published_at: i.updated_at.clone(),
        });

        let inst_record = InstallationRecord {
            installation_id: installation_id.clone(),
            plugin_id: review.plugin_id.clone(),
            active_package_digest: review.archive_sha256.clone(),
            active_version: review.version.clone(),
            activation_generation: existing_gen + 1,
            enabled: true,
            bindings: initial_bindings,
            grants: initial_grants,
            owner_history_source: existing.and_then(|i| i.owner_history_source.clone()),
            previous_package,
            created_at: existing
                .map(|i| i.created_at.clone())
                .unwrap_or_else(|| now_str.clone()),
            updated_at: now_str.clone(),
        };

        fresh_state
            .installations
            .insert(installation_id.clone(), inst_record.clone());
        fresh_state.registry_revision += 1;
        self.write_state(&fresh_state)?;

        tx_record.phase = TransactionPhase::Registered;
        tx_record.installation_id = Some(installation_id);
        tx_record.updated_at = now_str;
        write_journal_record(&self.layout, &tx_record)?;

        let _ = fs::remove_dir_all(self.layout.stage_dir(stage_id));
        self.stage_reviews.lock().remove(stage_id);

        Ok(inst_record)
    }
}
